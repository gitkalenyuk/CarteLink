//go:build !devnoauth

package web

// authGateEnabled is compiled in: release builds always require the Telegram
// membership gate (it cannot be switched off from config.json).
const authGateEnabled = true
