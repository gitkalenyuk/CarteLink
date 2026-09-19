// Package config holds VisionGateGo's persisted configuration.
// It mirrors the VisionGate (Electron) config schema so configs and habits
// transfer 1:1: same fields, same defaults, same normalization rules.
package config

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Version is the app version reported in /health and the UI.
const Version = "1.0.0"

// Routing mirrors the Electron app's routing section.
type Routing struct {
	DefaultProviderID string            `json:"defaultProviderId"`
	DefaultModel      string            `json:"defaultModel"`
	ModelMap          map[string]string `json:"modelMap"`
	Tiers             struct {
		Haiku  string `json:"haiku"`
		Sonnet string `json:"sonnet"`
		Opus   string `json:"opus"`
	} `json:"tiers"`
}

// Vision mirrors the vision pipeline section.
type Vision struct {
	Enabled    bool   `json:"enabled"`
	Mode       string `json:"mode"` // "describe"
	ProviderID string `json:"providerId"`
	Model      string `json:"model"`
	Prompt     string `json:"prompt"`
}

// Cliproxy mirrors the CLIProxyAPI sidecar section.
type Cliproxy struct {
	Enabled          bool     `json:"enabled"`
	AutoStart        bool     `json:"autoStart"`
	Port             int      `json:"port"`
	Host             string   `json:"host"`
	APIKeys          []string `json:"apiKeys"`
	BinaryPath       string   `json:"binaryPath"`
	ExtraConfigYAML  string   `json:"extraConfigYAML,omitempty"` // raw YAML passthrough for advanced users
	ManagementSecret string   `json:"managementSecret"`
}

// Provider mirrors normProvider() in the Electron main.js.
type Provider struct {
	ID           string            `json:"id"`
	Label        string            `json:"label"`
	BaseURL      string            `json:"baseUrl"`
	Format       string            `json:"format"` // "openai" | "anthropic" | "gemini"
	Keys         []string          `json:"keys"`
	Models       []string          `json:"models"`
	ExtraHeaders map[string]string `json:"extraHeaders,omitempty"`
	Enabled      bool              `json:"enabled"`
}

// Config is the on-disk schema (config.json inside Home()).
type Config struct {
	Port           int        `json:"port"`
	APIKey         string     `json:"apiKey"`
	RequireKey     bool       `json:"requireKey"`
	AutoStart      bool       `json:"autoStart"`
	StartMinimized bool       `json:"startMinimized"`
	Theme          string     `json:"theme"`
	Accent         string     `json:"accent"`
	Providers      []Provider `json:"providers"`
	Routing        Routing    `json:"routing"`
	Vision         Vision     `json:"vision"`
	Cliproxy       Cliproxy   `json:"cliproxy"`
	ModelBlacklist []string   `json:"modelBlacklist"`
}

// Home returns the app data root. VISIONGATE_HOME redirects everything —
// lets a second copy run beside the first with its own settings (same trick
// as the Electron app's userData override).
// If an adjacent "data" directory or a ".portable" file exists next to the
// executable, portable mode is auto-selected so everything stays self-contained.
func Home() string {
	if h := strings.TrimSpace(os.Getenv("VISIONGATE_HOME")); h != "" {
		return h
	}
	if exePath, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exePath)
		if fi, err := os.Stat(filepath.Join(exeDir, "data")); err == nil && fi.IsDir() {
			return exeDir
		}
		if _, err := os.Stat(filepath.Join(exeDir, ".portable")); err == nil {
			return exeDir
		}
	}
	base, err := os.UserConfigDir()
	if err != nil {
		base = "."
	}
	return filepath.Join(base, "VisionGateGo")
}

// ConfigPath is the main config file location.
func ConfigPath() string { return filepath.Join(Home(), "config.json") }

func DataDir() string { return filepath.Join(Home(), "data") }

func ErrorLogPath() string { return filepath.Join(DataDir(), "error.log") }

// CliproxyDir is where sidecar files live: config.yaml, auths/, logs/.
func CliproxyDir() string     { return filepath.Join(DataDir(), "cliproxy") }
func CliproxyAuthDir() string { return filepath.Join(CliproxyDir(), "auths") }
func CliproxyLogsDir() string { return filepath.Join(CliproxyDir(), "logs") }

// ErrCorrupt is wrapped by Load when config.json exists but is not valid
// JSON. The broken file is moved aside (config.json.corrupt-<time>) and
// defaults are returned, so the caller can warn the user and continue.
var ErrCorrupt = errors.New("config.json is corrupt")

// Load reads the config, falling back to defaults for a missing file. A
// corrupt file is backed up (never silently overwritten) and reported via
// ErrCorrupt; the returned config is still usable.
func Load() (*Config, error) {
	cfg := Defaults()
	raw, err := os.ReadFile(ConfigPath())
	if err == nil && len(strings.TrimSpace(string(raw))) > 0 {
		if jsonErr := json.Unmarshal(raw, cfg); jsonErr != nil {
			backup := ConfigPath() + ".corrupt-" + time.Now().Format("20060102-150405")
			_ = os.Rename(ConfigPath(), backup)
			cfg = Defaults()
			Normalize(cfg)
			return cfg, fmt.Errorf("%w: %v (backup: %s)", ErrCorrupt, jsonErr, backup)
		}
	}
	Normalize(cfg)
	return cfg, nil
}

// DisplayHost renders a bind host as something a client can connect to:
// wildcard binds ("", 0.0.0.0, ::) become 127.0.0.1.
func DisplayHost(h string) string {
	switch strings.TrimSpace(h) {
	case "", "0.0.0.0", "::", "[::]":
		return "127.0.0.1"
	}
	return strings.TrimSpace(h)
}

// Clone returns a deep copy of the config (slices and maps are copied), so
// handlers can mutate a copy and swap it in atomically.
func (c *Config) Clone() *Config {
	b, err := json.Marshal(c)
	if err != nil {
		cp := *c
		return &cp
	}
	out := &Config{}
	if err := json.Unmarshal(b, out); err != nil {
		cp := *c
		return &cp
	}
	return out
}

// Save persists the config with 2-space indent (matches the Electron format).
func (c *Config) Save() error {
	if err := os.MkdirAll(Home(), 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(ConfigPath(), b, 0o644)
}

// Defaults mirrors DEFAULTS in the Electron main.js. The generated API key is
// random, matching genKey() there ("vg-" + 48 hex chars).
func Defaults() *Config {
	c := &Config{
		Port:           8787,
		RequireKey:     true,
		AutoStart:      true,
		Theme:          "dark",
		Accent:         "#7c6cff",
		Providers:      []Provider{},
		ModelBlacklist: []string{},
	}
	c.Routing.ModelMap = map[string]string{}
	c.Vision = Vision{Mode: "describe"}
	c.Cliproxy = Cliproxy{Port: 8317, Host: "127.0.0.1", APIKeys: []string{}}
	return c
}

// Normalize mirrors the load-time fixups: normProvider + normCliproxy.
func Normalize(c *Config) {
	if c.Port < 1 || c.Port > 65535 {
		c.Port = 8787
	}
	if c.APIKey == "" {
		c.APIKey = "vg-" + randomHex(24)
	}
	if c.Theme == "" {
		c.Theme = "dark"
	}
	if c.Accent == "" {
		c.Accent = "#7c6cff"
	}
	if c.Vision.Mode == "" {
		c.Vision.Mode = "describe"
	}
	if c.Routing.ModelMap == nil {
		c.Routing.ModelMap = map[string]string{}
	}
	norm := make([]Provider, 0, len(c.Providers))
	for _, p := range c.Providers {
		p.ID = strings.TrimSpace(p.ID)
		p.Label = strings.TrimSpace(p.Label)
		if p.ID == "" && p.Label == "" {
			continue
		}
		if p.ID == "" {
			p.ID = "p-" + randomHex(4)
		}
		if p.Label == "" {
			p.Label = p.ID
		}
		p.BaseURL = strings.TrimRight(strings.TrimSpace(p.BaseURL), "/")
		p.Format = normFormat(p.Format)
		p.Keys = cleanStrings(p.Keys)
		p.Models = cleanStrings(p.Models)
		if p.ExtraHeaders == nil {
			p.ExtraHeaders = map[string]string{}
		}
		norm = append(norm, p)
	}
	c.Providers = norm
	c.ModelBlacklist = cleanStrings(c.ModelBlacklist)
	c.Cliproxy = NormCliproxy(c.Cliproxy)
	// Keep the engine's client keys aligned with the UI toggle: when the key
	// is required but none were configured for the engine, use the VisionGate
	// key; when not required the engine accepts anything (empty api-keys).
	if c.RequireKey && len(c.Cliproxy.APIKeys) == 0 && c.APIKey != "" {
		c.Cliproxy.APIKeys = []string{c.APIKey}
	}
}

// NormCliproxy mirrors normCliproxy() in the Electron main.js: trims fields,
// validates the port, and generates the management secret on first use.
func NormCliproxy(c Cliproxy) Cliproxy {
	c.Host = strings.TrimSpace(c.Host)
	if c.Host == "" {
		c.Host = "127.0.0.1"
	}
	if c.Port < 1 || c.Port > 65535 {
		c.Port = 8317
	}
	c.APIKeys = cleanStrings(c.APIKeys)
	c.BinaryPath = strings.TrimSpace(c.BinaryPath)
	c.ManagementSecret = strings.TrimSpace(c.ManagementSecret)
	if c.ManagementSecret == "" {
		c.ManagementSecret = "vgcpa-" + randomHex(18)
	}
	return c
}

func normFormat(f string) string {
	switch strings.TrimSpace(f) {
	case "anthropic":
		return "anthropic"
	case "gemini":
		return "gemini"
	default:
		return "openai"
	}
}

func cleanStrings(in []string) []string {
	out := make([]string, 0, len(in))
	for _, s := range in {
		if t := strings.TrimSpace(s); t != "" {
			out = append(out, t)
		}
	}
	return out
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// PortFrom parses a port string with a fallback (mirrors validPort(v, fb)).
func PortFrom(s string, fallback int) int {
	n, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil || n < 1 || n > 65535 {
		return fallback
	}
	return n
}
