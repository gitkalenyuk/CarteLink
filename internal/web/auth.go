package web

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"cartelgate/internal/config"
)

// offlineGrace is how long a session that was verified once keeps working
// while the broker cannot be reached (no internet, Vercel down).
const offlineGrace = 24 * time.Hour

// Auth states reported to the UI:
//
//	authorized — access open
//	checking   — a saved session is being verified (first start / after grace)
//	need_login — no or invalid session
//	awaiting   — browser login in progress
//	denied     — not a member of the CarteLink group (or trial-only)
//	offline    — broker unreachable and the offline grace has run out
func authGateOn() bool { return authGateEnabled }

// IsAuthenticated reports whether model traffic may pass.
func (a *App) IsAuthenticated() bool {
	if !authGateOn() {
		return true
	}
	a.authMu.Lock()
	defer a.authMu.Unlock()
	return a.authStatus == "authorized"
}

// AuthStatus returns the current Telegram authentication state.
func (a *App) AuthStatus() (status string, reason string, user *config.AuthUser, enabled bool) {
	a.authMu.Lock()
	defer a.authMu.Unlock()
	return a.authStatus, a.authReason, a.authUser, authGateOn()
}

func (a *App) setAuth(status, reason string) {
	a.authMu.Lock()
	a.authStatus, a.authReason = status, reason
	a.authMu.Unlock()
}

// SetAuthSession stores a fresh session from the browser login.
func (a *App) SetAuthSession(session string, user *config.AuthUser) {
	a.authMu.Lock()
	a.authSession = session
	a.authUser = user
	a.authStatus = "checking"
	a.authReason = ""
	a.authMu.Unlock()

	a.mu.Lock()
	cfg := a.cfg.Clone()
	cfg.Auth.Session = session
	cfg.Auth.User = user
	cfg.Auth.LastVerified = 0
	_ = cfg.Save()
	a.cfg = cfg
	a.mu.Unlock()
}

// InitAuth initializes auth state on startup. A saved session that was
// verified within the offline grace opens access at once (then re-checks in
// the background); otherwise the UI waits for the live check.
func (a *App) InitAuth() {
	if !authGateOn() {
		a.setAuth("authorized", "")
		return
	}
	cfg := a.snapshotConfig()
	if cfg.Auth.Session == "" {
		a.setAuth("need_login", "")
		return
	}
	a.authMu.Lock()
	a.authSession = cfg.Auth.Session
	a.authUser = cfg.Auth.User
	if withinGrace(cfg.Auth.LastVerified) {
		a.authStatus = "authorized"
	} else {
		a.authStatus = "checking"
	}
	a.authMu.Unlock()
	go a.VerifyAuthLive()
}

func withinGrace(last int64) bool {
	if last <= 0 {
		return false
	}
	t := time.Unix(last, 0)
	return !t.After(time.Now().Add(time.Minute)) && time.Since(t) < offlineGrace
}

// VerifyAuthLive re-checks the session with the broker. Membership is decided
// by the broker for the "cartelink" app (APP_GROUP_CARTELINK); only the
// "private" tier is accepted — trial access is not allowed in CarteLink.
func (a *App) VerifyAuthLive() bool {
	if !authGateOn() {
		a.setAuth("authorized", "")
		return true
	}
	a.authMu.Lock()
	session := a.authSession
	a.authMu.Unlock()
	if session == "" {
		a.setAuth("need_login", "")
		return false
	}

	res, err := callVerify(session)
	if err != nil {
		// Broker unreachable or broken: keep access only within the grace.
		log.Println("[CarteLink auth] verify unavailable:", err)
		if withinGrace(a.snapshotConfig().Auth.LastVerified) {
			a.setAuth("authorized", "")
			return true
		}
		a.setAuth("offline", err.Error())
		return false
	}

	switch {
	case res.OK && (res.Tier == "" || res.Tier == "private"):
		a.authMu.Lock()
		if a.authSession != session {
			// Logged out (or in as someone else) while the broker was answering.
			a.authMu.Unlock()
			return false
		}
		a.authStatus, a.authReason = "authorized", ""
		a.authUser = mergeUser(a.authUser, res.User)
		user := a.authUser
		a.authMu.Unlock()
		a.mu.Lock()
		cfg := a.cfg.Clone()
		cfg.Auth.User = user
		cfg.Auth.LastVerified = time.Now().Unix()
		_ = cfg.Save()
		a.cfg = cfg
		a.mu.Unlock()
		return true
	case res.OK: // e.g. tier "trial"
		a.setAuth("denied", "not_member")
		log.Println("[CarteLink auth] denied: tier", res.Tier, "is not allowed")
		return false
	case res.Reason == "config" || res.Reason == "tg_error":
		// The broker itself is misconfigured / Telegram API failed — not the
		// user's fault: same rule as unreachable.
		log.Println("[CarteLink auth] broker error:", res.Reason, res.Detail)
		if withinGrace(a.snapshotConfig().Auth.LastVerified) {
			a.setAuth("authorized", "")
			return true
		}
		a.setAuth("offline", res.Reason)
		return false
	case res.Reason == "no_auth" || res.Reason == "bad_hash" || res.Reason == "expired" || res.Reason == "no_init":
		a.setAuth("need_login", "session_expired")
		return false
	default: // not_member, trial_available, trial_left, trial_expired
		a.setAuth("denied", "not_member")
		log.Println("[CarteLink auth] access denied:", res.Reason)
		return false
	}
}

type verifyUser struct {
	ID        any    `json:"id"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
	Name      string `json:"name"`
	Username  string `json:"username"`
}

type verifyResult struct {
	OK     bool        `json:"ok"`
	Reason string      `json:"reason"`
	Detail string      `json:"detail"`
	Tier   string      `json:"tier"`
	User   *verifyUser `json:"user"`
}

// callVerify posts the session to the broker. Any transport failure, 5xx or
// undecodable body is returned as an error (treated as "broker unreachable").
func callVerify(session string) (*verifyResult, error) {
	payload, _ := json.Marshal(map[string]any{
		"initData": "",
		"app":      true,
		"appId":    config.AuthAppID,
		"session":  session,
	})
	req, err := http.NewRequest(http.MethodPost, strings.TrimRight(config.BrokerURL, "/")+"/api/auth/verify", bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Cookie", "ytc_session="+session)
	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 500 {
		return nil, fmt.Errorf("broker HTTP %d", resp.StatusCode)
	}
	var r verifyResult
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
		return nil, fmt.Errorf("broker reply: %w", err)
	}
	return &r, nil
}

// mergeUser keeps what the login delivered (name, @username) when the verify
// reply only carries the id — the broker's cookie path returns {id} alone.
func mergeUser(cur *config.AuthUser, v *verifyUser) *config.AuthUser {
	out := &config.AuthUser{}
	if cur != nil {
		*out = *cur
	}
	if v == nil {
		return out
	}
	if v.ID != nil {
		out.ID = strings.TrimSpace(fmt.Sprint(v.ID))
	}
	name := strings.TrimSpace(strings.TrimSpace(v.FirstName + " " + v.LastName))
	if name == "" {
		name = strings.TrimSpace(v.Name)
	}
	if name != "" {
		out.Name = name
	}
	if u := strings.TrimPrefix(strings.TrimSpace(v.Username), "@"); u != "" {
		out.Username = u
	}
	return out
}

// StartAuthWatchdog re-checks membership every 5 minutes (and retries
// sooner while offline/checking).
func (a *App) StartAuthWatchdog() {
	go func() {
		last := time.Now()
		for {
			time.Sleep(30 * time.Second)
			status, _, _, _ := a.AuthStatus()
			due := time.Since(last) >= 5*time.Minute
			if (status == "offline" || status == "checking") && time.Since(last) >= time.Minute {
				due = true
			}
			if !due || status == "need_login" || status == "awaiting" {
				continue
			}
			last = time.Now()
			a.VerifyAuthLive()
		}
	}()
}
