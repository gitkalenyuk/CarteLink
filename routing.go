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
			switch tier {
			case "fast":
				return t.Fast
			case "main":
				return t.Main
			case "max":
				return t.Max
			}
		}
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
		if r.Tiers.Fast != "" {
			out = append(out, "cartelink-fast")
		}
		if r.Tiers.Main != "" {
			out = append(out, "cartelink-main")
		}
		if r.Tiers.Max != "" {
			out = append(out, "cartelink-max")
		}
	}
	for k, v := range r.ModelMap {
		if v != "" && !strings.ContainsAny(k, "*?[") {
			out = append(out, k)
		}
	}
	return out
}
