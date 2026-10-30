// Package config holds CarteLink's persisted configuration (config.json).
package config

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Version is the app version reported in /health and the UI.
const Version = "2.6.0"

// AppName is the product name used in window titles, logs and messages.
const AppName = "CarteLink"

// KeyPrefix / SecretPrefix mark generated client keys and management secrets.
const (
	KeyPrefix    = "cl-"
	SecretPrefix = "cl-mgmt-"
	// ScopedKeyPrefix marks keys limited to chosen models (see ScopedKey). A key
	// with this prefix that is not in Config.ScopedKeys is refused, never treated
	// as a full-access key.
	ScopedKeyPrefix = "cl-api-"
)

// legacyHomeName is the data directory of the previous product name; it is
// copied over on first start so existing accounts and settings survive.
var legacyHomeNames = []string{"CartelGate", "VisionGateGo"}

// BrokerURL is the Telegram auth broker. It is compiled in (override only at
// build time: -ldflags "-X cartelgate/internal/config.BrokerURL=https://...") so
// the access gate cannot be redirected from config.json.
var BrokerURL = "https://yt-cartel.vercel.app"

// AuthAppID identifies CarteLink to the broker; the broker checks the group
// configured for it (APP_GROUP_CARTELINK on Vercel).
const AuthAppID = "cartelink"

// DefaultPort is the fixed gateway port clients are configured for.
const DefaultPort = 8317

// schemaVersion is bumped when Load needs a one-time migration.
const schemaVersion = 2

type AuthUser struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Username string `json:"username,omitempty"`
}

// AuthConfig persists the Telegram session. Enabled/BrokerURL are legacy
// fields: they are read for compatibility but ignored — the gate is always on
// and the broker URL is compiled in.
type AuthConfig struct {
	Enabled      bool      `json:"enabled"`
	BrokerURL    string    `json:"brokerUrl,omitempty"`
	Session      string    `json:"session,omitempty"`
	User         *AuthUser `json:"user,omitempty"`
	LastVerified int64     `json:"lastVerified,omitempty"` // unix time of the last successful broker check
}

// Desktop holds window/tray preferences (autostart itself lives in the OS).
type Desktop struct {
	CloseToTray bool `json:"closeToTray"`
	// Lang is the UI language code ("uk", "en", …); empty = Ukrainian.
	Lang     string   `json:"lang,omitempty"`
	Switcher Switcher `json:"switcher"`
}

// Switcher is the always-on-top model switcher window: two preset models and
// which of them is applied right now (1 or 2; 0 = neither yet).
type Switcher struct {
	Enabled bool   `json:"enabled"`
	Model1  string `json:"model1,omitempty"`
	Model2  string `json:"model2,omitempty"`
	Active  int    `json:"active,omitempty"`
	// AutoSwitch: after the first successful request answered by model 1,
	// everything switches to model 2 by itself (one-shot per activation of
	// preset 1; switching back to 1 arms it again).
	AutoSwitch bool `json:"autoSwitch,omitempty"`
	// autoArmed is persisted so the one-shot survives a restart.
	AutoArmed bool `json:"autoArmed,omitempty"`
	// Pos is the last window position (screen pixels); nil = default corner.
	Pos *[2]int `json:"pos,omitempty"`
}

// Routing holds the model-mapping rules applied by the gateway middleware.
//
// Mode "tiers" (default): Claude Code tiers (haiku/sonnet/opus in a claude-*
// name) plus three universal tiers reached through exact aliases
// (cartelink-fast/main/max and the legacy cursor-*/codex-*/cascade-* names);
// ModelMap holds exact "official model" swaps on top.
// Mode "table": only ModelMap applies — an explicit "client model -> real
// model" table (keys may end with * as a prefix wildcard).
type Routing struct {
	Mode              string            `json:"mode,omitempty"` // "tiers" | "table"
	DefaultProviderID string            `json:"defaultProviderId"`
	DefaultModel      string            `json:"defaultModel"`
	ModelMap          map[string]string `json:"modelMap"`
	Tiers             Tiers             `json:"tiers"`
	// UnmappedStrategy: "smart" (default — a model the engine does not serve
	// goes to DefaultModel), "passthrough", or "always" (every unmapped model
	// goes to DefaultModel).
	UnmappedStrategy string `json:"unmappedStrategy,omitempty"`
	// CustomPoints are user-added rows of the "exact swaps" list (mode
	// "tiers"): a label and the client model name. The target lives in
	// ModelMap[Model] like the built-in official names.
	CustomPoints []CustomPoint `json:"customPoints,omitempty"`
}

// CustomPoint is one user-defined exact swap row.
type CustomPoint struct {
	Label string `json:"label"`
	Model string `json:"model"`
}

// ApplyAll makes one model answer everything: every tier, the default model
// and every existing exact swap / table row.
func (r *Routing) ApplyAll(model string) {
	model = strings.TrimSpace(model)
	t := &r.Tiers
	t.Haiku, t.Sonnet, t.Opus, t.Fast, t.Main, t.Max = model, model, model, model, model, model
	r.DefaultModel = model
	r.DefaultProviderID = ""
	for k := range r.ModelMap {
		r.ModelMap[k] = model
	}
	for _, cp := range r.CustomPoints {
		r.ModelMap[cp.Model] = model
	}
}

// Tiers are the tier targets. The Cursor*/Codex*/Windsurf* fields are legacy
// (2.2.0) and are folded into Fast/Main/Max by Normalize.
type Tiers struct {
	Haiku  string `json:"haiku"`
	Sonnet string `json:"sonnet"`
	Opus   string `json:"opus"`

	Fast string `json:"fast,omitempty"`
	Main string `json:"main,omitempty"`
	Max  string `json:"max,omitempty"`

	CursorSmall   string `json:"cursorSmall,omitempty"`
	CursorSonnet  string `json:"cursorSonnet,omitempty"`
	CursorPrimary string `json:"cursorPrimary,omitempty"`
	CodexMini     string `json:"codexMini,omitempty"`
	CodexSmart    string `json:"codexSmart,omitempty"`
	CodexReason   string `json:"codexReason,omitempty"`
	WindsurfFast  string `json:"windsurfFast,omitempty"`
	WindsurfBase  string `json:"windsurfBase,omitempty"`
	WindsurfAdv   string `json:"windsurfAdv,omitempty"`
}

// TierAliases lists the exact client model names that select each universal
// tier. Matching is case-insensitive and exact — never a substring.
var TierAliases = map[string][]string{
	"fast": {"cartelink-fast", "claude-cartelink-fast", "cursor-small", "codex-mini", "windsurf-fast", "cascade-fast"},
	"main": {"cartelink-main", "claude-cartelink-main", "cursor-sonnet", "cursor-primary", "cursor-default", "codex-smart", "codex-default", "windsurf-base", "cascade-base"},
	"max":  {"cartelink-max", "claude-cartelink-max", "codex-reason", "windsurf-adv", "cascade-adv", "cascade-advanced"},
}

// Cliproxy is the embedded-engine section: where it listens and its keys.
type Cliproxy struct {
	Port             int      `json:"port"`
	Host             string   `json:"host"`
	APIKeys          []string `json:"apiKeys"`
	ExtraConfigYAML  string   `json:"extraConfigYAML,omitempty"` // raw YAML passthrough for advanced users
	ManagementSecret string   `json:"managementSecret"`
}

// Provider is a user-visible model source: an OAuth account transferred from
// the Accounts page (BaseURL "embedded://cliproxy") or a manual entry.
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

// ScopedKey is a client key that sees and accepts only the listed models. It
// skips the routing (tiers, default model, switcher): the program asks for one
// of its models by name and gets exactly that model.
type ScopedKey struct {
	ID     string   `json:"id"`
	Name   string   `json:"name"`
	Key    string   `json:"key"`
	Models []string `json:"models"`
}

// Prompting injects a system prompt (and an optional AGENT.md) into every
// model request, and can ask models that support it to think harder.
type Prompting struct {
	Enabled bool `json:"enabled"`
	// Mode: "prepend" (before the client's own prompt, default), "append",
	// or "replace" (the client's system prompt is dropped).
	Mode string `json:"mode,omitempty"`
	Text string `json:"text,omitempty"`
	// AgentMD is the contents of an AGENT.md-style file, appended after Text.
	AgentMD        string `json:"agentMd,omitempty"`
	AgentMDName    string `json:"agentMdName,omitempty"`
	AgentMDEnabled bool   `json:"agentMdEnabled,omitempty"`
	// Scope limits injection: "all" (default), "anthropic", "openai".
	Scope    string   `json:"scope,omitempty"`
	Thinking Thinking `json:"thinking"`
}

// Thinking is the reasoning-budget / effort override. It is applied only to
// models the engine reports as supporting it (see /api/model-info).
type Thinking struct {
	Enabled bool `json:"enabled"`
	// Level: "off" | "low" | "medium" | "high" | "max" | "dynamic".
	Level string `json:"level,omitempty"`
	// Budget overrides Level with an explicit token budget (0 = use Level).
	Budget int `json:"budget,omitempty"`
	// Override replaces a value the client already sent (default: keep the
	// client's own choice).
	Override bool `json:"override,omitempty"`
}

// ThinkingLevels are the valid Thinking.Level values, weakest first.
var ThinkingLevels = []string{"off", "low", "medium", "high", "max", "dynamic"}

// Config is the on-disk schema (config.json inside Home()).
type Config struct {
	Schema     int        `json:"schema,omitempty"`
	APIKey     string     `json:"apiKey"`
	RequireKey bool       `json:"requireKey"`
	Auth       AuthConfig `json:"auth"`
	Providers  []Provider `json:"providers"`
	Routing    Routing    `json:"routing"`
	Cliproxy   Cliproxy   `json:"cliproxy"`
	// ScopedKeys have their own endpoints (/api/scoped-keys); a config save
	// never changes them.
	ScopedKeys     []ScopedKey `json:"scopedKeys,omitempty"`
	ModelBlacklist []string    `json:"modelBlacklist"`
	Prompting      Prompting   `json:"prompting"`
	Desktop        Desktop     `json:"desktop"`
	// HiddenAccounts are account-provider ids the user removed; the Accounts
	// page must not re-create them automatically.
	HiddenAccounts []string `json:"hiddenAccounts,omitempty"`
}

// Home returns the app data root. CARTELINK_HOME (or the legacy
// CARTELGATE_HOME / VISIONGATE_HOME) redirects everything — lets a second copy run beside the
// first with its own settings.
// If an adjacent "data" directory or a ".portable" file exists next to the
// executable, portable mode is auto-selected so everything stays self-contained.
// On first start the previous product's data directory is copied over.
func Home() string {
	if h := strings.TrimSpace(os.Getenv("CARTELINK_HOME")); h != "" {
		return h
	}
	if h := strings.TrimSpace(os.Getenv("CARTELGATE_HOME")); h != "" {
		return h
	}
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
	home := filepath.Join(base, AppName)
	for _, leg := range legacyHomeNames {
		migrateLegacyHome(filepath.Join(base, leg), home)
	}
	return home
}

// migrateLegacyHome copies the old data directory to the new location once
// (only when the new one does not exist yet). The old directory is left in
// place so the previous build keeps working.
func migrateLegacyHome(from, to string) {
	if _, err := os.Stat(to); err == nil {
		return
	}
	if fi, err := os.Stat(from); err != nil || !fi.IsDir() {
		return
	}
	_ = copyTree(from, to)
}

func copyTree(src, dst string) error {
	return filepath.WalkDir(src, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(src, p)
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			// Skip browser profiles/caches and Electron-era leftovers: large,
			// recreated anyway, and not used by CarteLink.
			if p != src && skipMigrateDir(d.Name()) {
				return filepath.SkipDir
			}
			return os.MkdirAll(target, 0o755)
		}
		if skipMigrateFile(d.Name()) {
			return nil
		}
		in, err := os.Open(p)
		if err != nil {
			return err
		}
		defer in.Close()
		out, err := os.Create(target)
		if err != nil {
			return err
		}
		defer out.Close()
		_, err = io.Copy(out, in)
		return err
	})
}

func skipMigrateDir(name string) bool {
	switch name {
	case "EBWebView", "Cache", "Code Cache", "GPUCache", "DawnGraphiteCache", "DawnWebGPUCache",
		"Local Storage", "Session Storage", "Network", "Shared Dictionary", "blob_storage",
		"oauth-browser", "logs":
		return true
	}
	return strings.HasPrefix(name, "chatgpt-profile")
}

func skipMigrateFile(name string) bool {
	switch name {
	case "chats.json", "chatgpt-accounts.json", "log.txt", "log.txt.old", "Local State", "Preferences", "SharedStorage":
		return true
	}
	return strings.HasSuffix(name, ".log") || strings.Contains(name, ".log.")
}

// ConfigPath is the main config file location.
func ConfigPath() string { return filepath.Join(Home(), "config.json") }

func DataDir() string { return filepath.Join(Home(), "data") }

// CliproxyDir is where engine files live: config.yaml, auths/, logs/.
func CliproxyDir() string     { return filepath.Join(DataDir(), "cliproxy") }
func CliproxyAuthDir() string { return filepath.Join(CliproxyDir(), "auths") }
func CliproxyLogsDir() string { return filepath.Join(CliproxyDir(), "logs") }

// CliproxyPluginsDir holds engine plugins installed from the plugin store.
func CliproxyPluginsDir() string { return filepath.Join(CliproxyDir(), "plugins") }

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

// Save persists the config with 2-space indent. The write is atomic (temp
// file + rename) so a crash mid-save never leaves a truncated config.json.
func (c *Config) Save() error {
	if err := os.MkdirAll(Home(), 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return WriteFileAtomic(ConfigPath(), b)
}

// WriteFileAtomic writes data to a temp file next to path and renames it over.
func WriteFileAtomic(path string, data []byte) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return os.WriteFile(path, data, 0o644)
	}
	return nil
}

// Defaults returns a fresh config. The API key is generated on Normalize.
func Defaults() *Config {
	c := &Config{
		RequireKey:     true,
		Auth:           AuthConfig{Enabled: true},
		Providers:      []Provider{},
		ModelBlacklist: []string{},
		Desktop:        Desktop{CloseToTray: true},
	}
	c.Routing.Mode = "tiers"
	c.Routing.ModelMap = map[string]string{}
	c.Routing.UnmappedStrategy = "smart"
	c.Cliproxy = Cliproxy{Port: DefaultPort, Host: "127.0.0.1", APIKeys: []string{}}
	return c
}

// NewKey generates a client key ("cl-" + 48 hex chars).
func NewKey() string { return KeyPrefix + randomHex(24) }

// NewScopedKey generates a model-limited client key ("cl-api-" + 48 hex chars).
func NewScopedKey() string { return ScopedKeyPrefix + randomHex(24) }

// FindScopedKey returns the scoped key with this exact value, or nil.
func (c *Config) FindScopedKey(key string) *ScopedKey {
	for i := range c.ScopedKeys {
		if c.ScopedKeys[i].Key == key {
			return &c.ScopedKeys[i]
		}
	}
	return nil
}

// CleanScopedModels trims a model list and drops duplicates (case-insensitive).
func CleanScopedModels(in []string) []string {
	out := make([]string, 0, len(in))
	seen := map[string]bool{}
	for _, m := range cleanStrings(in) {
		if k := strings.ToLower(m); !seen[k] {
			seen[k] = true
			out = append(out, m)
		}
	}
	return out
}

// normScopedKeys tidies the scoped keys and rebuilds the engine's client key
// list: the plain keys first (the first one is shown as the main key), then
// the scoped keys. Only scoped keys we have a record of go to the engine.
func normScopedKeys(c *Config) {
	norm := make([]ScopedKey, 0, len(c.ScopedKeys))
	for _, k := range c.ScopedKeys {
		k.Key = strings.TrimSpace(k.Key)
		if k.Key == "" {
			continue
		}
		k.ID = strings.TrimSpace(k.ID)
		if k.ID == "" {
			k.ID = "k-" + randomHex(4)
		}
		k.Name = strings.TrimSpace(k.Name)
		// An empty list stays empty: the key then gets no models at all.
		k.Models = CleanScopedModels(k.Models)
		norm = append(norm, k)
	}
	c.ScopedKeys = norm
	keys := make([]string, 0, len(c.Cliproxy.APIKeys)+len(norm)+1)
	for _, k := range c.Cliproxy.APIKeys {
		if !strings.HasPrefix(k, ScopedKeyPrefix) {
			keys = append(keys, k)
		}
	}
	// Keep the engine's client keys aligned with the UI toggle: when the key
	// is required but none were configured for the engine, use the gateway
	// key; when not required the engine accepts anything (empty api-keys).
	if c.RequireKey {
		if len(keys) == 0 && c.APIKey != "" {
			keys = append(keys, c.APIKey)
		}
		for _, k := range norm {
			keys = append(keys, k.Key)
		}
	}
	c.Cliproxy.APIKeys = keys
}

// Normalize applies load-time fixups: generated key, trimmed providers,
// validated engine section.
func Normalize(c *Config) {
	if c.APIKey == "" {
		c.APIKey = NewKey()
	}
	// The gate cannot be switched off or redirected from config.json.
	c.Auth.Enabled = true
	c.Auth.BrokerURL = ""
	if c.Routing.ModelMap == nil {
		c.Routing.ModelMap = map[string]string{}
	}
	if c.Routing.Mode != "table" {
		c.Routing.Mode = "tiers"
	}
	switch c.Routing.UnmappedStrategy {
	case "passthrough", "always", "smart":
	default:
		// "", "default", "fallback", "default_model" (<= 2.2.0) -> smart.
		c.Routing.UnmappedStrategy = "smart"
	}
	foldLegacyTiers(&c.Routing.Tiers)
	c.Routing.CustomPoints = cleanCustomPoints(c.Routing.CustomPoints)
	if a := c.Desktop.Switcher.Active; a != 1 && a != 2 {
		c.Desktop.Switcher.Active = 0
	}
	c.Desktop.Switcher.Model1 = strings.TrimSpace(c.Desktop.Switcher.Model1)
	c.Desktop.Switcher.Model2 = strings.TrimSpace(c.Desktop.Switcher.Model2)
	c.Desktop.Lang = strings.TrimSpace(c.Desktop.Lang)
	normPrompting(&c.Prompting)
	if c.Schema < schemaVersion {
		// <= 2.2.0 silently saved an auto-moved port (8318...8417) when 8317
		// was busy; clients stay configured for 8317, so go back to it once.
		if c.Cliproxy.Port > DefaultPort && c.Cliproxy.Port <= DefaultPort+100 {
			c.Cliproxy.Port = DefaultPort
		}
		c.Schema = schemaVersion
	}
	c.HiddenAccounts = cleanStrings(c.HiddenAccounts)
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
	normScopedKeys(c)
}

// normPrompting validates the system-prompt section.
func normPrompting(p *Prompting) {
	switch p.Mode {
	case "append", "replace":
	default:
		p.Mode = "prepend"
	}
	switch p.Scope {
	case "anthropic", "openai":
	default:
		p.Scope = "all"
	}
	valid := false
	for _, l := range ThinkingLevels {
		if p.Thinking.Level == l {
			valid = true
		}
	}
	if !valid {
		p.Thinking.Level = "medium"
	}
	if p.Thinking.Budget < 0 {
		p.Thinking.Budget = 0
	}
	p.AgentMDName = strings.TrimSpace(p.AgentMDName)
}

// foldLegacyTiers moves the 2.2.0 per-client tier fields into the universal
// Fast/Main/Max tiers (first non-empty wins) and clears them.
func foldLegacyTiers(t *Tiers) {
	first := func(cur string, vals ...string) string {
		if cur != "" {
			return cur
		}
		for _, v := range vals {
			if v = strings.TrimSpace(v); v != "" {
				return v
			}
		}
		return ""
	}
	t.Fast = first(t.Fast, t.CursorSmall, t.CodexMini, t.WindsurfFast)
	t.Main = first(t.Main, t.CursorSonnet, t.CursorPrimary, t.CodexSmart, t.WindsurfBase)
	t.Max = first(t.Max, t.CodexReason, t.WindsurfAdv)
	t.CursorSmall, t.CursorSonnet, t.CursorPrimary = "", "", ""
	t.CodexMini, t.CodexSmart, t.CodexReason = "", "", ""
	t.WindsurfFast, t.WindsurfBase, t.WindsurfAdv = "", "", ""
}

// NormCliproxy trims fields, validates the port, and generates the
// management secret on first use.
func NormCliproxy(c Cliproxy) Cliproxy {
	c.Host = strings.TrimSpace(c.Host)
	if c.Host == "" {
		c.Host = "127.0.0.1"
	}
	if c.Port < 1 || c.Port > 65535 {
		c.Port = DefaultPort
	}
	c.APIKeys = cleanStrings(c.APIKeys)
	c.ManagementSecret = strings.TrimSpace(c.ManagementSecret)
	if c.ManagementSecret == "" {
		c.ManagementSecret = SecretPrefix + randomHex(18)
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

// cleanCustomPoints trims rows, drops ones without a model name and keeps
// the first row for each model (case-insensitive).
func cleanCustomPoints(in []CustomPoint) []CustomPoint {
	out := make([]CustomPoint, 0, len(in))
	seen := map[string]bool{}
	for _, p := range in {
		p.Model = strings.TrimSpace(p.Model)
		p.Label = strings.TrimSpace(p.Label)
		k := strings.ToLower(p.Model)
		if p.Model == "" || seen[k] {
			continue
		}
		seen[k] = true
		if p.Label == "" {
			p.Label = p.Model
		}
		out = append(out, p)
	}
	return out
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

// PortFrom parses a port string with a fallback.
func PortFrom(s string, fallback int) int {
	n, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil || n < 1 || n > 65535 {
		return fallback
	}
	return n
}
