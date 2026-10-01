package main

import (
	"path"
	"strings"

	"cartelgate/internal/config"
)

// stripProvider drops a "provider:" prefix (UI convention) — the engine routes
// by bare model name.
func stripProvider(s string) string {
	if i := strings.Index(s, ":"); i >= 0 && !strings.Contains(s, "://") {
		return s[i+1:]
	}
	return s
}

// resolveModelName maps a client-requested model name through the routing
// config without knowing which models the engine serves ("smart" fallback
// then behaves like passthrough). See resolveModel.
func resolveModelName(cfg *config.Config, want string) string {
	return resolveModel(cfg, want, nil)
}

// resolveModel maps a client-requested model name through the routing config.
//
// Precedence:
//  1. ModelMap exact hit (both modes), then ModelMap "prefix*" wildcard.
//  2. Mode "tiers" only: Claude Code tiers — a claude-* name containing
//     haiku/sonnet/opus; universal tiers — exact aliases (config.TierAliases).
//  3. Unmapped: empty/"*" → DefaultModel; strategy "always" → DefaultModel;
//     "smart" → DefaultModel only when known() says the engine does not serve
//     the model; "passthrough" → unchanged.
//
// Matching is exact or by explicit prefix — never a bare substring, so e.g.
// "gemini-*" can never be caught by a "mini" rule.
func resolveModel(cfg *config.Config, want string, known func(string) bool) string {
	r := &cfg.Routing
	want = strip1M(want)
	uncloaked := uncloakClaudeDDModel(want)
	lw := strings.ToLower(strings.TrimSpace(uncloaked))

	if m, ok := lookupMap(r.ModelMap, want, uncloaked); ok {
		return stripProvider(m)
	}

	if r.Mode != "table" {
		if m := tierTarget(r, lw); m != "" {
			if mapped, ok := r.ModelMap[m]; ok && mapped != "" {
				m = mapped
			}
			return stripProvider(m)
		}
	}

	def := stripProvider(strings.TrimSpace(r.DefaultModel))
	if lw == "" || lw == "*" {
		if def != "" {
			return def
		}
		return uncloaked
	}
	if def != "" {
		switch r.UnmappedStrategy {
		case "always":
			return def
		case "smart":
			if known != nil && !known(uncloaked) {
				return def
			}
		}
	}
	return uncloaked
}

// lookupMap finds an exact (case-insensitive) or "prefix*" entry.
func lookupMap(mm map[string]string, names ...string) (string, bool) {
	if len(mm) == 0 {
		return "", false
	}
	for _, n := range names {
		if v, ok := mm[n]; ok && v != "" {
			return v, true
		}
	}
	for _, n := range names {
		ln := strings.ToLower(n)
		for k, v := range mm {
			if v == "" {
				continue
			}
			lk := strings.ToLower(k)
			if lk == ln {
				return v, true
			}
			if strings.ContainsAny(lk, "*?[") {
				if ok, _ := path.Match(lk, ln); ok {
					return v, true
				}
			}
		}
	}
	return "", false
}

// tierTarget returns the configured tier model for a (lower-cased) client
// model name, or "".
func tierTarget(r *config.Routing, lw string) string {
	t := r.Tiers
	if strings.HasPrefix(lw, "claude") {
		switch {
		case strings.Contains(lw, "haiku") && t.Haiku != "":
			return t.Haiku
		case strings.Contains(lw, "sonnet") && t.Sonnet != "":
			return t.Sonnet
		case strings.Contains(lw, "opus") && t.Opus != "":
			return t.Opus
		}
	}
	for tier, aliases := range config.TierAliases {
		for _, a := range aliases {
			if lw != a {
				continue
			}
			return universalTier(r, tier)
		}
	}
	return ""
}

// universalTier is the model behind cartelink-fast/main/max. A tier left
// empty follows its Claude Code counterpart (fast → Haiku, main → Sonnet,
// max → Opus) and then the default model, so configuring only the Claude
// tiers (or only a default) still makes the universal aliases work.
func universalTier(r *config.Routing, tier string) string {
	t := r.Tiers
	pick := func(vals ...string) string {
		for _, v := range vals {
			if strings.TrimSpace(v) != "" {
				return v
			}
		}
		return ""
	}
	switch tier {
	case "fast":
		return pick(t.Fast, t.Haiku, r.DefaultModel)
	case "main":
		return pick(t.Main, t.Sonnet, r.DefaultModel)
	case "max":
		return pick(t.Max, t.Opus, r.DefaultModel)
	}
	return ""
}

// servedAliases lists the client-facing names that currently resolve to a
// real model: set universal-tier aliases and non-wildcard table keys. Used
// to advertise them in /v1/models.
func servedAliases(cfg *config.Config) []string {
	r := &cfg.Routing
	var out []string
	if r.Mode != "table" {
		for _, tier := range []string{"fast", "main", "max"} {
			if universalTier(r, tier) != "" {
				out = append(out, "cartelink-"+tier)
			}
		}
	}
	for k, v := range r.ModelMap {
		if v != "" && !strings.ContainsAny(k, "*?[") {
			out = append(out, k)
		}
	}
	return out
}

// claudePickerEntries are the /v1/models entries Claude Code shows in its
// /model picker (gateway model discovery keeps only "claude" ids): the main
// model under its real name, and fast/max only when they differ from it.
//
// Claude Code assumes a 200K window for every model it does not know and
// ignores what /v1/models says about limits. The one thing it honours is a
// "[1m]" suffix on the model id (it strips the suffix before sending), so an
// entry whose model really has a 1M+ window carries it. ctxOf returns a
// model's context window (0 = unknown); nil means unknown for all.
func claudePickerEntries(cfg *config.Config, ctxOf func(string) int) []catalogModel {
	entry := func(id, label, model string) catalogModel {
		if ctxOf != nil && ctxOf(model) >= oneMillion {
			return catalogModel{ID: id + "[1m]", DisplayName: label + model + " · 1M", OwnedBy: "cartelink"}
		}
		return catalogModel{ID: id, DisplayName: label + model, OwnedBy: "cartelink"}
	}
	main := resolveModel(cfg, "claude-cartelink-main", nil)
	if main == "" || main == "claude-cartelink-main" {
		return nil
	}
	out := []catalogModel{entry("claude-cartelink-main", "CarteLink: ", main)}
	for _, tier := range []struct{ id, label string }{
		{"claude-cartelink-fast", "CarteLink fast: "},
		{"claude-cartelink-max", "CarteLink max: "},
	} {
		if m := resolveModel(cfg, tier.id, nil); m != "" && m != tier.id && m != main {
			out = append(out, entry(tier.id, tier.label, m))
		}
	}
	return out
}

// oneMillion is the window Claude Code assumes for a "[1m]" model id.
const oneMillion = 1_000_000

// strip1M removes Claude Code's client-side "[1m]" context marker, in case a
// client sends it along.
func strip1M(model string) string {
	if n := len(model); n > 4 && strings.EqualFold(model[n-4:], "[1m]") {
		return strings.TrimSpace(model[:n-4])
	}
	return model
}
