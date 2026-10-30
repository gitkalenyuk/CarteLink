package main

import (
	"net"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// localOnlyGate keeps everything except the model API on this computer. With
// Host 0.0.0.0 the whole port is on the network, and the panel has no auth of
// its own: the control API hands out the gateway key and the management secret.
// It reports whether the request may go on; otherwise it has answered 403.
func localOnlyGate(c *gin.Context) bool {
	if isLocalClient(c.Request) {
		// With Host set to one LAN address this computer connects through that
		// address, and the engine's Management API accepts only 127.0.0.1/::1.
		if !addrIP(c.Request.RemoteAddr).IsLoopback() {
			c.Request.RemoteAddr = "127.0.0.1:0"
		}
		return true
	}
	if networkAllowedPath(c.Request.URL.Path) {
		return true
	}
	c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
		"error": gin.H{
			"type":    "local_only",
			"message": "CarteLink: this address works only on the computer running the app; other devices can use the model API (/v1) with a key.",
		},
	})
	return false
}

// networkAllowedPath is the whole surface other devices can reach: the routes
// that check the API key themselves, and healthz. It is an allowlist so that a
// new engine route (OAuth callbacks, plugins, keep-alive…) stays closed.
func networkAllowedPath(p string) bool {
	if p == "/healthz" || p == "/models" {
		return true
	}
	for _, prefix := range []string{"/v1/", "/v1beta/", "/openai/v1/", "/backend-api/codex/"} {
		if strings.HasPrefix(p, prefix) {
			return true
		}
	}
	return false
}

// isLocalClient reports whether the connection comes from this computer. Only
// the socket addresses count, never Host or X-Forwarded-For, which the client
// writes. A source equal to the destination is local too: with Host set to one
// LAN address the window and the management proxy connect through that address.
func isLocalClient(r *http.Request) bool {
	remote := addrIP(r.RemoteAddr)
	if remote == nil {
		return false
	}
	if remote.IsLoopback() {
		return true
	}
	local, ok := r.Context().Value(http.LocalAddrContextKey).(net.Addr)
	return ok && remote.Equal(addrIP(local.String()))
}

// addrIP returns the IP of a "host:port" address, nil if it has none.
func addrIP(addr string) net.IP {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return nil
	}
	return net.ParseIP(host)
}
