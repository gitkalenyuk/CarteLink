// Scoped API keys: the "API-ключі" page. Each key sees only its own models; the
// enforcement lives in the root middleware (scoped.go in package main).
package web

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"cartelgate/internal/config"
)

const scopedNameMax = 80

var errScopedKeyNotFound = errors.New("API key not found")

// apiScopedKeys: GET/POST /api/scoped-keys, PUT/DELETE /api/scoped-keys/<id>.
func (a *App) apiScopedKeys(w http.ResponseWriter, r *http.Request, id string) {
	switch {
	case id == "" && r.Method == http.MethodGet:
		cfg := a.snapshotConfig()
		keys := cfg.ScopedKeys
		if keys == nil {
			keys = []config.ScopedKey{}
		}
		jsonWrite(w, http.StatusOK, anyMap{"ok": true, "keys": keys, "requireKey": cfg.RequireKey})
	case id == "" && r.Method == http.MethodPost:
		a.scopedKeyCreate(w, r)
	case id != "" && r.Method == http.MethodPut:
		a.scopedKeyUpdate(w, r, id)
	case id != "" && r.Method == http.MethodDelete:
		a.scopedKeyDelete(w, id)
	default:
		jsonWrite(w, http.StatusNotFound, anyMap{"ok": false, "error": "unknown endpoint"})
	}
}

// readScopedKeyForm reads and validates {"name","models"}.
func readScopedKeyForm(r *http.Request) (string, []string, error) {
	var req struct {
		Name   string   `json:"name"`
		Models []string `json:"models"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		return "", nil, errors.New("invalid request: " + err.Error())
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return "", nil, errors.New("name is required")
	}
	if len([]rune(name)) > scopedNameMax {
		return "", nil, errors.New("name is too long")
	}
	models := config.CleanScopedModels(req.Models)
	if len(models) == 0 {
		return "", nil, errors.New("choose at least one model")
	}
	return name, models, nil
}

func (a *App) scopedKeyCreate(w http.ResponseWriter, r *http.Request) {
	name, models, err := readScopedKeyForm(r)
	if err != nil {
		jsonWrite(w, http.StatusBadRequest, anyMap{"ok": false, "error": err.Error()})
		return
	}
	created := config.ScopedKey{ID: "k-" + randomHex(4), Name: name, Key: config.NewScopedKey(), Models: models}
	// The record is saved before the engine learns the key, so the key is
	// never accepted without its limits.
	cfg, err := a.UpdateConfig(func(c *config.Config) error {
		c.ScopedKeys = append(c.ScopedKeys, created)
		return nil
	})
	if err != nil {
		a.writeScopedErr(w, err)
		return
	}
	if err := a.pushClientKeys(cfg); err != nil {
		a.writeScopedErr(w, err)
		return
	}
	jsonWrite(w, http.StatusOK, anyMap{"ok": true, "key": created})
}

func (a *App) scopedKeyUpdate(w http.ResponseWriter, r *http.Request, id string) {
	name, models, err := readScopedKeyForm(r)
	if err != nil {
		jsonWrite(w, http.StatusBadRequest, anyMap{"ok": false, "error": err.Error()})
		return
	}
	// Limits are read per request, so the change applies at once; the engine's
	// key list is not affected.
	var updated config.ScopedKey
	_, err = a.UpdateConfig(func(c *config.Config) error {
		for i := range c.ScopedKeys {
			if c.ScopedKeys[i].ID == id {
				c.ScopedKeys[i].Name = name
				c.ScopedKeys[i].Models = models
				updated = c.ScopedKeys[i]
				return nil
			}
		}
		return errScopedKeyNotFound
	})
	if err != nil {
		a.writeScopedErr(w, err)
		return
	}
	jsonWrite(w, http.StatusOK, anyMap{"ok": true, "key": updated})
}

func (a *App) scopedKeyDelete(w http.ResponseWriter, id string) {
	// Once the record is gone the middleware refuses the key, whatever the
	// engine's list still says.
	cfg, err := a.UpdateConfig(func(c *config.Config) error {
		for i := range c.ScopedKeys {
			if c.ScopedKeys[i].ID == id {
				c.ScopedKeys = append(c.ScopedKeys[:i], c.ScopedKeys[i+1:]...)
				return nil
			}
		}
		return errScopedKeyNotFound
	})
	if err != nil {
		a.writeScopedErr(w, err)
		return
	}
	if err := a.pushClientKeys(cfg); err != nil {
		a.writeScopedErr(w, err)
		return
	}
	jsonWrite(w, http.StatusOK, anyMap{"ok": true})
}

func (a *App) writeScopedErr(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	if errors.Is(err, errScopedKeyNotFound) {
		status = http.StatusNotFound
	}
	jsonWrite(w, status, anyMap{"ok": false, "error": err.Error()})
}

// pushClientKeys brings config.yaml and the running engine in line with cfg
// (SyncYAML merges into the copy, the live config is never mutated).
func (a *App) pushClientKeys(cfg *config.Config) error {
	cp := cfg.Clone()
	if err := a.SyncYAML(cp); err != nil {
		return err
	}
	if cp.RequireKey {
		_, _, _ = a.mgmtRequest(http.MethodPut, "/v0/management/api-keys", mustJSON(cp.Cliproxy.APIKeys))
	}
	return nil
}
