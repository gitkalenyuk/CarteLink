package web

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"cartelgate/internal/config"
)

// ModelUsageStat aggregates usage metrics for a specific model.
type ModelUsageStat struct {
	Requests  int64 `json:"requests"`
	Input     int64 `json:"input"`
	Output    int64 `json:"output"`
	Cached    int64 `json:"cached"`
	Reasoning int64 `json:"reasoning"`
	Total     int64 `json:"total"`
	Failed    int64 `json:"failed"`
}

// MetricsState represents the persistent metrics data saved to data/metrics.json.
type MetricsState struct {
	TotalInput     int64                      `json:"total_input"`
	TotalOutput    int64                      `json:"total_output"`
	TotalCached    int64                      `json:"total_cached"`
	TotalReasoning int64                      `json:"total_reasoning"`
	TotalTokens    int64                      `json:"total_tokens"`
	TotalRequests  int64                      `json:"total_requests"`
	TotalSuccess   int64                      `json:"total_success"`
	TotalFailed    int64                      `json:"total_failed"`
	ModelStats     map[string]*ModelUsageStat `json:"model_stats"`
	History        []map[string]any           `json:"history"`
	LastUpdated    time.Time                  `json:"last_updated"`
}

// MetricsStore manages thread-safe access and persistence for usage metrics.
type MetricsStore struct {
	mu       sync.RWMutex
	filePath string
	state    MetricsState
}

// NewMetricsStore initializes the store from data/metrics.json.
func NewMetricsStore(filePath string) *MetricsStore {
	ms := &MetricsStore{
		filePath: filePath,
		state: MetricsState{
			ModelStats: make(map[string]*ModelUsageStat),
			History:    make([]map[string]any, 0),
		},
	}
	ms.load()
	return ms
}

func (ms *MetricsStore) load() {
	ms.mu.Lock()
	defer ms.mu.Unlock()

	raw, err := os.ReadFile(ms.filePath)
	if err != nil {
		return
	}
	var loaded MetricsState
	if err := json.Unmarshal(raw, &loaded); err == nil {
		if loaded.ModelStats == nil {
			loaded.ModelStats = make(map[string]*ModelUsageStat)
		}
		if loaded.History == nil {
			loaded.History = make([]map[string]any, 0)
		}
		ms.state = loaded
	}
}

// Save persists the current state to disk.
func (ms *MetricsStore) Save() error {
	ms.mu.RLock()
	defer ms.mu.RUnlock()

	_ = os.MkdirAll(filepath.Dir(ms.filePath), 0o755)
	ms.state.LastUpdated = time.Now()
	data, err := json.MarshalIndent(ms.state, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(ms.filePath, data, 0o644)
}

// Ingest adds newly popped records from the usage-queue.
func (ms *MetricsStore) Ingest(records []map[string]any) {
	if len(records) == 0 {
		return
	}

	ms.mu.Lock()
	for _, r := range records {
		ms.state.TotalRequests++
		failed, _ := r["failed"].(bool)
		if failed {
			ms.state.TotalFailed++
		} else {
			ms.state.TotalSuccess++
		}

		mName, _ := r["model"].(string)
		if mName == "" {
			mName = "unknown"
		}
		st, ok := ms.state.ModelStats[mName]
		if !ok {
			st = &ModelUsageStat{}
			ms.state.ModelStats[mName] = st
		}
		st.Requests++
		if failed {
			st.Failed++
		}

		// Parse token counts
		if tok, ok := r["tokens"].(map[string]any); ok {
			inp := toInt64(tok["input_tokens"])
			out := toInt64(tok["output_tokens"])
			cac := toInt64(tok["cached_tokens"])
			if cac == 0 {
				cac = toInt64(tok["cache_read_tokens"])
			}
			rea := toInt64(tok["reasoning_tokens"])
			tot := toInt64(tok["total_tokens"])
			if tot == 0 {
				tot = inp + out
			}

			ms.state.TotalInput += inp
			ms.state.TotalOutput += out
			ms.state.TotalCached += cac
			ms.state.TotalReasoning += rea
			ms.state.TotalTokens += tot

			st.Input += inp
			st.Output += out
			st.Cached += cac
			st.Reasoning += rea
			st.Total += tot
		}
	}

	// Prepend newest records to history, bounded to 1000 items
	newHistory := append(records, ms.state.History...)
	if len(newHistory) > 1000 {
		newHistory = newHistory[:1000]
	}
	ms.state.History = newHistory
	ms.mu.Unlock()

	_ = ms.Save()
}

func toInt64(v any) int64 {
	switch n := v.(type) {
	case float64:
		return int64(n)
	case int64:
		return n
	case int:
		return int64(n)
	case json.Number:
		i, _ := n.Int64()
		return i
	default:
		return 0
	}
}

// Clear resets all accumulated metrics and wipes the history file.
func (ms *MetricsStore) Clear() {
	ms.mu.Lock()
	ms.state = MetricsState{
		ModelStats:  make(map[string]*ModelUsageStat),
		History:     make([]map[string]any, 0),
		LastUpdated: time.Now(),
	}
	ms.mu.Unlock()
	_ = ms.Save()
}

// Snapshot returns a copy of the current state.
func (ms *MetricsStore) Snapshot() MetricsState {
	ms.mu.RLock()
	defer ms.mu.RUnlock()

	cp := ms.state
	cp.ModelStats = make(map[string]*ModelUsageStat, len(ms.state.ModelStats))
	for k, v := range ms.state.ModelStats {
		valCopy := *v
		cp.ModelStats[k] = &valCopy
	}
	cp.History = append([]map[string]any(nil), ms.state.History...)
	return cp
}

// StartMetricsCollector starts a background loop polling the engine's usage-queue.
func (a *App) StartMetricsCollector() {
	if a.metricsStore == nil {
		metricsPath := filepath.Join(config.DataDir(), "metrics.json")
		a.metricsStore = NewMetricsStore(metricsPath)
	}

	go func() {
		ticker := time.NewTicker(3 * time.Second)
		defer ticker.Stop()

		for range ticker.C {
			if a.Paused() || !a.EngineRunning() {
				continue
			}

			// Pop up to 100 queued records from the embedded engine
			status, raw, _ := a.mgmtRequest(http.MethodGet, "/v0/management/usage-queue?count=100", nil)
			if status != http.StatusOK || len(raw) == 0 {
				continue
			}

			var items []any
			if err := json.Unmarshal(raw, &items); err != nil || len(items) == 0 {
				continue
			}

			records := make([]map[string]any, 0, len(items))
			for _, it := range items {
				switch v := it.(type) {
				case map[string]any:
					records = append(records, v)
				case string:
					var m map[string]any
					if err := json.Unmarshal([]byte(v), &m); err == nil && m != nil {
						records = append(records, m)
					}
				}
			}

			if len(records) > 0 {
				a.metricsStore.Ingest(records)
			}
		}
	}()
}

// apiMetricsGet returns the aggregated metrics state along with current auth-files quotas.
func (a *App) apiMetricsGet(w http.ResponseWriter, r *http.Request) {
	if a.metricsStore == nil {
		metricsPath := filepath.Join(config.DataDir(), "metrics.json")
		a.metricsStore = NewMetricsStore(metricsPath)
	}

	snapshot := a.metricsStore.Snapshot()

	// Also fetch auth-files for account quotas
	var authFiles any
	if a.EngineRunning() && !a.Paused() {
		status, raw, _ := a.mgmtRequest(http.MethodGet, "/v0/management/auth-files", nil)
		if status == http.StatusOK {
			var af any
			if json.Unmarshal(raw, &af) == nil {
				authFiles = af
			}
		}
	}

	jsonWrite(w, http.StatusOK, anyMap{
		"ok":         true,
		"metrics":    snapshot,
		"auth_files": authFiles,
	})
}

// apiMetricsClear resets the persistent metrics.
func (a *App) apiMetricsClear(w http.ResponseWriter, r *http.Request) {
	if a.metricsStore != nil {
		a.metricsStore.Clear()
	}
	jsonWrite(w, http.StatusOK, anyMap{"ok": true})
}
