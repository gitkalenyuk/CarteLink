//go:build devnoauth

package web

// Development builds only (go build -tags devnoauth): no Telegram gate, so
// the UI can be tested with an isolated CARTELINK_HOME. Never ship this.
const authGateEnabled = false
