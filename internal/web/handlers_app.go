package web

import (
	"encoding/json"
	"io"
	"net/http"
	"runtime"

	"cartelgate/internal/config"
	"cartelgate/internal/desktop"
)

// apiAppPing: GET /api/app/ping — lets a second launch recognise this copy.
func (a *App) apiAppPing(w http.ResponseWriter, r *http.Request) {
	jsonWrite(w, http.StatusOK, anyMap{"app": config.AppName, "home": config.Home(), "version": config.Version})
}

// apiAppShow: POST /api/app/show — bring the window (or a browser tab) up.
func (a *App) apiAppShow(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	f := a.showFn
	a.mu.Unlock()
	if f != nil {
		go f()
	}
	jsonWrite(w, http.StatusOK, anyMap{"ok": true})
}

// apiAppSettingsGet: GET /api/app/settings — autostart and tray behaviour.
func (a *App) apiAppSettingsGet(w http.ResponseWriter, r *http.Request) {
	cfg := a.snapshotConfig()
	jsonWrite(w, http.StatusOK, anyMap{
		"ok":            true,
		"platform":      runtime.GOOS,
		"autostart":     desktop.AutostartEnabled(),
		"closeToTray":   cfg.Desktop.CloseToTray,
		"trayAvailable": desktop.TraySupported(),
	})
}

// apiAppSettingsPut: PUT /api/app/settings {autostart?, closeToTray?}
func (a *App) apiAppSettingsPut(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Autostart   *bool `json:"autostart"`
		CloseToTray *bool `json:"closeToTray"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&req); err != nil {
		jsonWrite(w, http.StatusBadRequest, anyMap{"ok": false, "error": "invalid body"})
		return
	}
	if req.Autostart != nil {
		if err := desktop.SetAutostart(*req.Autostart); err != nil {
			jsonWrite(w, http.StatusInternalServerError, anyMap{"ok": false, "error": "автозапуск: " + err.Error()})
			return
		}
	}
	if req.CloseToTray != nil {
		a.mu.Lock()
		cfg := a.cfg.Clone()
		cfg.Desktop.CloseToTray = *req.CloseToTray
		err := cfg.Save()
		if err == nil {
			a.cfg = cfg
		}
		a.mu.Unlock()
		if err != nil {
			jsonWrite(w, http.StatusInternalServerError, anyMap{"ok": false, "error": err.Error()})
			return
		}
	}
	a.apiAppSettingsGet(w, r)
}
