package web

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html"
	"net"
	"net/http"
	"net/url"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"cartelgate/internal/config"
)

func (a *App) apiAuthStatus(w http.ResponseWriter, r *http.Request) {
	status, reason, user, brokerUrl, enabled := a.AuthStatus()
	jsonWrite(w, http.StatusOK, anyMap{
		"ok":        true,
		"enabled":   enabled,
		"status":    status,
		"reason":    reason,
		"user":      user,
		"brokerUrl": brokerUrl,
	})
}

func (a *App) apiAuthLogin(w http.ResponseWriter, r *http.Request) {
	cfg := a.snapshotConfig()
	if !cfg.Auth.Enabled {
		jsonWrite(w, http.StatusOK, anyMap{"ok": true, "status": "authorized"})
		return
	}

	brokerUrl := cfg.Auth.BrokerURL
	if brokerUrl == "" {
		brokerUrl = config.DefaultBrokerURL
	}
	brokerUrl = strings.TrimRight(brokerUrl, "/")

	nonceBytes := make([]byte, 16)
	_, _ = rand.Read(nonceBytes)
	nonce := hex.EncodeToString(nonceBytes)

	a.authMu.Lock()
	if a.loopbackSrv != nil {
		_ = a.loopbackSrv.Close()
		a.loopbackSrv = nil
	}
	a.loopbackNonce = nonce
	a.authStatus = "awaiting"
	a.authReason = ""
	a.authMu.Unlock()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		jsonWrite(w, http.StatusInternalServerError, anyMap{"ok": false, "error": "failed to bind loopback: " + err.Error()})
		return
	}

	port := listener.Addr().(*net.TCPAddr).Port
	mux := http.NewServeMux()
	server := &http.Server{Handler: mux}

	a.authMu.Lock()
	a.loopbackSrv = server
	a.authMu.Unlock()

	mux.HandleFunc("/done", func(lw http.ResponseWriter, lr *http.Request) {
		q := lr.URL.Query()
		st := q.Get("state")
		a.authMu.Lock()
		expectedNonce := a.loopbackNonce
		a.authMu.Unlock()

		if st == "" || st != expectedNonce {
			lw.WriteHeader(http.StatusForbidden)
			_, _ = lw.Write([]byte("bad state"))
			return
		}

		okVal := q.Get("ok")
		memberVal := q.Get("member")
		errVal := q.Get("error")
		sessionVal := q.Get("session")
		nameVal := q.Get("name")
		uidVal := q.Get("uid")
		reasonVal := q.Get("reason")
		if reasonVal == "" && errVal != "" {
			reasonVal = errVal
		}

		user := &config.AuthUser{
			ID:       uidVal,
			Name:     nameVal,
			Username: q.Get("username"),
		}

		// Decode base64-encoded user JSON from yt-cartel broker
		if userB64 := q.Get("user"); userB64 != "" {
			if raw, err := base64.StdEncoding.DecodeString(userB64); err == nil {
				var uObj struct {
					ID        any    `json:"id"`
					FirstName string `json:"first_name"`
					LastName  string `json:"last_name"`
					Username  string `json:"username"`
					Name      string `json:"name"`
				}
				if err := json.Unmarshal(raw, &uObj); err == nil {
					if uObj.ID != nil {
						user.ID = fmt.Sprint(uObj.ID)
					}
					if uObj.FirstName != "" {
						user.Name = uObj.FirstName
						if uObj.LastName != "" {
							user.Name += " " + uObj.LastName
						}
					} else if uObj.Name != "" {
						user.Name = uObj.Name
					}
					if uObj.Username != "" {
						user.Username = uObj.Username
					}
				}
			}
		}

		lw.Header().Set("Content-Type", "text/html; charset=utf-8")

		isFailed := (errVal != "") || (sessionVal == "") || (memberVal == "0") || (okVal == "0" || okVal == "false")
		if isFailed {
			title := "Вхід не вдався"
			msg := "Спробуй ще раз із застосунку."
			if memberVal == "0" || reasonVal == "not_member" {
				title = "Ти ще не в Secret YT_cartel 🧠"
				msg = "Для доступу до CarteLink потрібно бути учасником закритої спільноти Secret YT_cartel 🧠."
			}
			lw.WriteHeader(http.StatusOK)
			_, _ = lw.Write([]byte(renderAuthResultHtml(title, msg, false)))

			a.authMu.Lock()
			if memberVal == "0" || reasonVal == "not_member" {
				a.authStatus = "denied"
				a.authReason = "not_member"
			} else {
				a.authStatus = "need_login"
				a.authReason = reasonVal
			}
			a.authMu.Unlock()
			a.closeLoopbackSoon()
			return
		}

		// Save session candidate and immediately verify with the backend
		a.SetAuthSession(sessionVal, user)
		verified := a.VerifyAuthLive()

		if !verified {
			lw.WriteHeader(http.StatusOK)
			_, _ = lw.Write([]byte(renderAuthResultHtml("Ти ще не в Secret YT_cartel 🧠", "Для доступу до CarteLink потрібно бути учасником закритої спільноти Secret YT_cartel 🧠.", false)))
			a.closeLoopbackSoon()
			return
		}

		lw.WriteHeader(http.StatusOK)
		_, _ = lw.Write([]byte(renderAuthResultHtml("Готово! ✨", "Ти увійшов. Повертайся у застосунок CarteLink — доступ відкрито.", true)))

		a.closeLoopbackSoon()
	})

	go func() {
		_ = server.Serve(listener)
	}()

	// Safety timeout: 5 minutes
	time.AfterFunc(5*time.Minute, func() {
		a.authMu.Lock()
		if a.loopbackSrv == server {
			_ = a.loopbackSrv.Close()
			a.loopbackSrv = nil
			if a.authStatus == "awaiting" {
				a.authStatus = "need_login"
			}
		}
		a.authMu.Unlock()
	})

	cb := fmt.Sprintf("http://127.0.0.1:%d/done?state=%s", port, nonce)
	authUrl := fmt.Sprintf("%s/app-auth.html?cb=%s", brokerUrl, url.QueryEscape(cb))

	openBrowserUrl(authUrl)

	jsonWrite(w, http.StatusOK, anyMap{
		"ok":      true,
		"status":  "awaiting",
		"authUrl": authUrl,
	})
}

func (a *App) closeLoopbackSoon() {
	go func() {
		time.Sleep(1 * time.Second)
		a.authMu.Lock()
		if a.loopbackSrv != nil {
			_ = a.loopbackSrv.Close()
			a.loopbackSrv = nil
		}
		a.authMu.Unlock()
	}()
}

func (a *App) apiAuthLogout(w http.ResponseWriter, r *http.Request) {
	a.authMu.Lock()
	a.authStatus = "need_login"
	a.authReason = "logout"
	a.authSession = ""
	a.authUser = nil
	if a.loopbackSrv != nil {
		_ = a.loopbackSrv.Close()
		a.loopbackSrv = nil
	}
	a.authMu.Unlock()

	a.mu.Lock()
	a.cfg.Auth.Session = ""
	a.cfg.Auth.User = nil
	_ = a.cfg.Save()
	a.mu.Unlock()

	jsonWrite(w, http.StatusOK, anyMap{"ok": true, "status": "need_login"})
}

func (a *App) apiAuthRecheck(w http.ResponseWriter, r *http.Request) {
	ok := a.VerifyAuthLive()
	status, reason, user, brokerUrl, enabled := a.AuthStatus()
	jsonWrite(w, http.StatusOK, anyMap{
		"ok":        ok,
		"status":    status,
		"reason":    reason,
		"user":      user,
		"brokerUrl": brokerUrl,
		"enabled":   enabled,
	})
}

func renderAuthResultHtml(title, msg string, ok bool) string {
	accent := "#2aabee"
	icon := "✓"
	if !ok {
		accent = "#ff5c6c"
		icon = "×"
	}
	return fmt.Sprintf(`<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>CarteLink</title>
<style>
html,body{height:100%%;margin:0}
body{display:grid;place-items:center;background:#0a0b0f;color:#eef0f6;font-family:Inter,-apple-system,Segoe UI,Roboto,sans-serif;padding:20px}
.c{max-width:440px;text-align:center;padding:36px 30px;border:1px solid rgba(255,255,255,0.08);border-radius:20px;background:#141720;box-shadow:0 24px 60px rgba(0,0,0,.6)}
.d{width:56px;height:56px;border-radius:16px;margin:0 auto 16px;background:%s;display:grid;place-items:center;font-size:28px;color:#fff;font-weight:700}
.h{font-size:22px;font-weight:800;margin:6px 0 10px}
.m{color:#9297a8;line-height:1.6;font-size:15px}
.foot{font-size:12px;color:#5f667a;margin-top:24px}
</style>
</head>
<body>
<div class="c">
  <div class="d">%s</div>
  <div class="h">%s</div>
  <div class="m">%s</div>
  <div class="foot">Secret YT_cartel 🧠 · CarteLink</div>
</div>
</body>
</html>`, accent, icon, html.EscapeString(title), html.EscapeString(msg))
}

func openBrowserUrl(u string) {
	switch runtime.GOOS {
	case "windows":
		_ = exec.Command("rundll32", "url.dll,FileProtocolHandler", u).Start()
	case "darwin":
		_ = exec.Command("open", u).Start()
	default:
		_ = exec.Command("xdg-open", u).Start()
	}
}
