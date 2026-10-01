package web

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"

	"cartelgate/internal/config"
)

// cleanModel drops a "provider:" prefix (UI convention) and spaces.
func cleanModel(m string) string {
	m = strings.TrimSpace(m)
	if i := strings.Index(m, ":"); i > 0 && !strings.Contains(m, "://") {
		m = m[i+1:]
	}
	return m
}

func decodeBody(r *http.Request, v any) error {
	return json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(v)
}

// apiRoutingApplyAll: POST /api/routing/apply-all {model} — one model for
// everything: tiers, default model, exact swaps and table rows.
func (a *App) apiRoutingApplyAll(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Model string `json:"model"`
	}
	if err := decodeBody(r, &req); err != nil {
		jsonWrite(w, http.StatusBadRequest, anyMap{"ok": false, "error": "invalid body"})
		return
	}
	model := cleanModel(req.Model)
	if model == "" {
		jsonWrite(w, http.StatusBadRequest, anyMap{"ok": false, "error": "model is empty"})
		return
	}
	cfg, err := a.UpdateConfig(func(c *config.Config) error {
		c.Routing.ApplyAll(model)
		// The switcher shows which preset is live; a manual choice that
		// matches neither preset leaves it unmarked.
		sw := &c.Desktop.Switcher
		switch {
		case sw.Model1 != "" && cleanModel(sw.Model1) == model:
			sw.Active = 1
		case sw.Model2 != "" && cleanModel(sw.Model2) == model:
			sw.Active = 2
		default:
			sw.Active = 0
		}
		sw.AutoArmed = sw.AutoSwitch && sw.Active == 1
		return nil
	})
	if err != nil {
		jsonWrite(w, http.StatusInternalServerError, anyMap{"ok": false, "error": err.Error()})
		return
	}
	jsonWrite(w, http.StatusOK, anyMap{"ok": true, "routing": cfg.Routing})
}

func (a *App) switcherState(cfg *config.Config) anyMap {
	sw := cfg.Desktop.Switcher
	return anyMap{
		"ok":         true,
		"enabled":    sw.Enabled,
		"model1":     sw.Model1,
		"model2":     sw.Model2,
		"active":     sw.Active,
		"autoSwitch": sw.AutoSwitch,
		"autoArmed":  sw.AutoArmed,
		"current":    currentMainModel(cfg),
		"lang":       cfg.Desktop.Lang,
		"available":  a.switcherAvailable(),
		"authed":     a.IsAuthenticated(),
	}
}

func (a *App) switcherAvailable() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.switcherFn != nil
}

// currentMainModel is the model most requests go to right now.
func currentMainModel(cfg *config.Config) string {
	t := cfg.Routing.Tiers
	for _, m := range []string{t.Sonnet, t.Main, cfg.Routing.DefaultModel, t.Opus, t.Haiku} {
		if m = cleanModel(m); m != "" {
			return m
		}
	}
	return ""
}

// apiSwitcherGet: GET /api/switcher
func (a *App) apiSwitcherGet(w http.ResponseWriter, r *http.Request) {
	jsonWrite(w, http.StatusOK, a.switcherState(a.snapshotConfig()))
}

// apiSwitcherPut: PUT /api/switcher {model1?, model2?, enabled?}
// Changing the model of the live preset applies it right away.
func (a *App) apiSwitcherPut(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Model1     *string `json:"model1"`
		Model2     *string `json:"model2"`
		Enabled    *bool   `json:"enabled"`
		AutoSwitch *bool   `json:"autoSwitch"`
	}
	if err := decodeBody(r, &req); err != nil {
		jsonWrite(w, http.StatusBadRequest, anyMap{"ok": false, "error": "invalid body"})
		return
	}
	cfg, err := a.UpdateConfig(func(c *config.Config) error {
		sw := &c.Desktop.Switcher
		if req.Model1 != nil {
			sw.Model1 = cleanModel(*req.Model1)
			if sw.Active == 1 && sw.Model1 != "" {
				c.Routing.ApplyAll(sw.Model1)
			}
		}
		if req.Model2 != nil {
			sw.Model2 = cleanModel(*req.Model2)
			if sw.Active == 2 && sw.Model2 != "" {
				c.Routing.ApplyAll(sw.Model2)
			}
		}
		if req.Enabled != nil {
			sw.Enabled = *req.Enabled
		}
		if req.AutoSwitch != nil {
			sw.AutoSwitch = *req.AutoSwitch
			// Turning it on while preset 1 is live arms it right away.
			sw.AutoArmed = *req.AutoSwitch && sw.Active == 1
		}
		return nil
	})
	if err != nil {
		jsonWrite(w, http.StatusInternalServerError, anyMap{"ok": false, "error": err.Error()})
		return
	}
	if req.Enabled != nil {
		a.showSwitcher(*req.Enabled)
	}
	jsonWrite(w, http.StatusOK, a.switcherState(cfg))
}

// apiSwitcherSwitch: POST /api/switcher/switch {to?: 1|2} — apply the other
// preset (or the given one) to everything.
func (a *App) apiSwitcherSwitch(w http.ResponseWriter, r *http.Request) {
	var req struct {
		To int `json:"to"`
	}
	_ = decodeBody(r, &req)
	cfg, err := a.UpdateConfig(func(c *config.Config) error {
		sw := &c.Desktop.Switcher
		to := req.To
		if to != 1 && to != 2 {
			to = 1
			if sw.Active == 1 {
				to = 2
			}
		}
		model := sw.Model1
		if to == 2 {
			model = sw.Model2
		}
		if model == "" {
			return errors.New("model " + strconv.Itoa(to) + " is not selected")
		}
		c.Routing.ApplyAll(model)
		sw.Active = to
		sw.AutoArmed = sw.AutoSwitch && to == 1
		return nil
	})
	if err != nil {
		jsonWrite(w, http.StatusBadRequest, anyMap{"ok": false, "error": err.Error()})
		return
	}
	jsonWrite(w, http.StatusOK, a.switcherState(cfg))
}

// showSwitcher opens or hides the floating window (no-op without a GUI).
func (a *App) showSwitcher(show bool) {
	a.mu.Lock()
	f := a.switcherFn
	a.mu.Unlock()
	if f != nil {
		go f(show)
	}
}

// SwitcherClosed is called when the user closes the floating window with
// its own close button: the option is switched off.
func (a *App) SwitcherClosed() {
	_, _ = a.UpdateConfig(func(c *config.Config) error {
		c.Desktop.Switcher.Enabled = false
		return nil
	})
}

// SwitcherMoved remembers the window position.
func (a *App) SwitcherMoved(x, y int) {
	_, _ = a.UpdateConfig(func(c *config.Config) error {
		c.Desktop.Switcher.Pos = &[2]int{x, y}
		return nil
	})
}

// apiErrorsGet: GET /api/errors?limit=N
func (a *App) apiErrorsGet(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 {
		limit = 200
	}
	jsonWrite(w, http.StatusOK, anyMap{"ok": true, "total": a.errLog.Total(), "errors": a.errLog.List(limit)})
}

// apiErrorsClear: POST /api/errors/clear
func (a *App) apiErrorsClear(w http.ResponseWriter, r *http.Request) {
	a.errLog.Clear()
	jsonWrite(w, http.StatusOK, anyMap{"ok": true})
}

// SwitcherAutoAdvance moves the switcher to preset 2 after the first request
// that preset 1 answered successfully. It is a one-shot: applying preset 1
// again re-arms it, so the pattern is "warm up on model 1, then work on
// model 2" rather than a flip-flop on every request.
func (a *App) SwitcherAutoAdvance(resolved string) {
	cfg := a.snapshotConfig()
	sw := cfg.Desktop.Switcher
	if !sw.AutoSwitch || !sw.AutoArmed || sw.Active != 1 || sw.Model2 == "" {
		return
	}
	if m := cleanModel(sw.Model1); m != "" && resolved != "" && !strings.EqualFold(m, cleanModel(resolved)) {
		return
	}
	next, err := a.UpdateConfig(func(c *config.Config) error {
		s := &c.Desktop.Switcher
		if !s.AutoSwitch || !s.AutoArmed || s.Active != 1 || s.Model2 == "" {
			return errAutoSwitchRaced
		}
		c.Routing.ApplyAll(s.Model2)
		s.Active = 2
		s.AutoArmed = false
		return nil
	})
	if err == nil {
		log.Printf("switcher: first answer from %s — switched everything to %s", sw.Model1, next.Desktop.Switcher.Model2)
	}
}

// errAutoSwitchRaced aborts the update when another request got there first.
var errAutoSwitchRaced = errors.New("auto-switch already applied")
