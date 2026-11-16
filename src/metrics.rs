//! Usage statistics. The backend alone drains the engine's usage-queue
//! (never the UI) and keeps totals, per-model stats, hourly buckets for the
//! charts and the latest records in `data/metrics.json`.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::util::{jint, now_ms, parse_time_ms};

const HISTORY_KEEP: usize = 1000;
const HOUR_MS: i64 = 3_600_000;
const HOURLY_KEEP_MS: i64 = 31 * 24 * HOUR_MS;
const ACCOUNT_HOURLY_KEEP_MS: i64 = 7 * 24 * HOUR_MS;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct ModelStat {
    pub requests: i64,
    pub input: i64,
    pub output: i64,
    pub cached: i64,
    pub reasoning: i64,
    pub total: i64,
    pub failed: i64,
    /// Sum and count of full answer times the engine reported (latency_ms).
    pub latency_sum: i64,
    pub latency_n: i64,
    /// Sum and count of times to the first token (ttft_ms, streams).
    pub ttft_sum: i64,
    pub ttft_n: i64,
}

/// Requests of one program (named by `apps::app_name`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct AppStat {
    /// Counted by the gateway when an answer ends.
    pub requests: i64,
    pub failed: i64,
    pub last: i64,
    pub latency_sum: i64,
    pub latency_n: i64,
    /// From usage records that carry the program's User-Agent.
    pub tokens: i64,
}

/// Requests one account (engine auth_index) served.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct AccountStat {
    pub requests: i64,
    pub failed: i64,
    pub tokens: i64,
    pub last: i64,
    pub latency_sum: i64,
    pub latency_n: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct HourBucket {
    pub ok: i64,
    pub failed: i64,
    pub tokens: i64,
}

/// Requests made with one client key (counted by the gateway itself).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct KeyStat {
    pub requests: i64,
    pub failed: i64,
    pub last: i64,
    /// Local day ("2026-11-16") `day_requests` counts in (daily key limits).
    pub day: String,
    pub day_requests: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct MetricsState {
    pub total_input: i64,
    pub total_output: i64,
    pub total_cached: i64,
    pub total_reasoning: i64,
    pub total_tokens: i64,
    pub total_requests: i64,
    pub total_success: i64,
    pub total_failed: i64,
    pub model_stats: BTreeMap<String, ModelStat>,
    /// Newest first.
    pub history: Vec<Map<String, Value>>,
    /// Hour start (unix ms, as a string key) → bucket.
    pub hourly: BTreeMap<String, HourBucket>,
    pub key_stats: BTreeMap<String, KeyStat>,
    /// Program name → requests.
    pub app_stats: BTreeMap<String, AppStat>,
    /// Engine auth_index → requests that account served.
    pub account_stats: BTreeMap<String, AccountStat>,
    /// Engine auth_index → hour start (unix ms as a string) → bucket; 7 days.
    pub account_hourly: BTreeMap<String, BTreeMap<String, HourBucket>>,
    /// Unix ms when counting started (or was last cleared).
    pub since: i64,
    pub last_updated: String,
}

pub struct Metrics {
    path: PathBuf,
    state: Mutex<MetricsState>,
    dirty: AtomicBool,
}

impl Metrics {
    pub fn open(path: PathBuf) -> Self {
        let mut state: MetricsState = match std::fs::read(&path) {
            Ok(b) if !b.is_empty() => match serde_json::from_slice(&b) {
                Ok(s) => s,
                Err(e) => {
                    let backup = path.with_extension("json.broken");
                    let _ = std::fs::write(&backup, &b);
                    tracing::warn!("metrics.json could not be read ({e}); kept as {}", backup.display());
                    MetricsState::default()
                }
            },
            _ => MetricsState::default(),
        };
        if state.since == 0 {
            state.since = now_ms();
        }
        // 2.x files have no hourly buckets: rebuild them from the history.
        if state.hourly.is_empty() && !state.history.is_empty() {
            let hist = state.history.clone();
            for r in hist.iter().rev() {
                add_hourly(&mut state, r);
            }
        }
        Metrics { path, state: Mutex::new(state), dirty: AtomicBool::new(false) }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, MetricsState> {
        self.state.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Adds records popped from the usage-queue (oldest first).
    pub fn ingest(&self, records: Vec<Map<String, Value>>) {
        if records.is_empty() {
            return;
        }
        let mut s = self.lock();
        for r in &records {
            s.total_requests += 1;
            let failed = r.get("failed").and_then(Value::as_bool).unwrap_or(false);
            if failed {
                s.total_failed += 1;
            } else {
                s.total_success += 1;
            }
            let model = r.get("model").and_then(Value::as_str).filter(|m| !m.is_empty()).unwrap_or("unknown").to_string();
            let (inp, out, cac, rea, tot) = tokens_of(r);
            s.total_input += inp;
            s.total_output += out;
            s.total_cached += cac;
            s.total_reasoning += rea;
            s.total_tokens += tot;
            let st = s.model_stats.entry(model).or_default();
            st.requests += 1;
            if failed {
                st.failed += 1;
            }
            st.input += inp;
            st.output += out;
            st.cached += cac;
            st.reasoning += rea;
            st.total += tot;
            let latency = jint(r.get("latency_ms"));
            if latency > 0 {
                st.latency_sum += latency;
                st.latency_n += 1;
            }
            let ttft = jint(r.get("ttft_ms"));
            if ttft > 0 {
                st.ttft_sum += ttft;
                st.ttft_n += 1;
            }
            add_hourly(&mut s, r);
            if let Some(ua) = r.get("user_agent").and_then(Value::as_str).filter(|u| !u.trim().is_empty()) {
                s.app_stats.entry(crate::apps::app_name(ua)).or_default().tokens += tot;
            }
            if let Some(idx) = r.get("auth_index").and_then(Value::as_str).map(str::trim).filter(|i| !i.is_empty()) {
                let ts = record_time(r);
                let acc = s.account_stats.entry(idx.to_string()).or_default();
                acc.requests += 1;
                if failed {
                    acc.failed += 1;
                }
                acc.tokens += tot;
                acc.last = acc.last.max(ts);
                if latency > 0 {
                    acc.latency_sum += latency;
                    acc.latency_n += 1;
                }
                let hour = ts - ts.rem_euclid(HOUR_MS);
                let b = s.account_hourly.entry(idx.to_string()).or_default().entry(hour.to_string()).or_default();
                if failed {
                    b.failed += 1;
                } else {
                    b.ok += 1;
                }
                b.tokens += tot;
            }
        }
        let mut hist: Vec<Map<String, Value>> = records.into_iter().rev().collect();
        hist.append(&mut s.history);
        hist.truncate(HISTORY_KEEP);
        s.history = hist;
        let now = now_ms();
        let cutoff = now - HOURLY_KEEP_MS;
        s.hourly.retain(|k, _| k.parse::<i64>().map(|h| h >= cutoff).unwrap_or(false));
        let acc_cutoff = now - ACCOUNT_HOURLY_KEEP_MS;
        for buckets in s.account_hourly.values_mut() {
            buckets.retain(|k, _| k.parse::<i64>().map(|h| h >= acc_cutoff).unwrap_or(false));
        }
        s.account_hourly.retain(|_, b| !b.is_empty());
        drop(s);
        self.dirty.store(true, Ordering::Release);
    }

    /// Counts one request made with a client key (id "main" for the gateway key).
    pub fn count_key(&self, key_id: &str, failed: bool) {
        let mut s = self.lock();
        let k = s.key_stats.entry(key_id.to_string()).or_default();
        k.requests += 1;
        if failed {
            k.failed += 1;
        }
        k.last = now_ms();
        drop(s);
        self.dirty.store(true, Ordering::Release);
    }

    /// Counts one admitted request of a key towards its daily limit. Err when
    /// `limit` (0 = none) is already reached today; the count survives restarts.
    pub fn take_daily(&self, key_id: &str, day: &str, limit: u32) -> Result<(), i64> {
        let mut s = self.lock();
        let k = s.key_stats.entry(key_id.to_string()).or_default();
        let r = take_day_slot(k, day, limit);
        drop(s);
        if r.is_ok() {
            self.dirty.store(true, Ordering::Release);
        }
        r
    }

    /// One finished request of a program (named by `apps::app_name`).
    pub fn count_app(&self, name: &str, failed: bool, ms: u64) {
        let mut s = self.lock();
        let st = s.app_stats.entry(name.to_string()).or_default();
        st.requests += 1;
        if failed {
            st.failed += 1;
        }
        st.latency_sum += ms as i64;
        st.latency_n += 1;
        st.last = now_ms();
        drop(s);
        self.dirty.store(true, Ordering::Release);
    }

    pub fn app_stats(&self) -> BTreeMap<String, AppStat> {
        self.lock().app_stats.clone()
    }

    pub fn account_stats(&self) -> (BTreeMap<String, AccountStat>, BTreeMap<String, BTreeMap<String, HourBucket>>) {
        let s = self.lock();
        (s.account_stats.clone(), s.account_hourly.clone())
    }

    pub fn forget_key(&self, key_id: &str) {
        self.lock().key_stats.remove(key_id);
        self.dirty.store(true, Ordering::Release);
    }

    pub fn snapshot(&self) -> MetricsState {
        self.lock().clone()
    }

    /// Only what the charts need (history is large).
    pub fn key_stats(&self) -> BTreeMap<String, KeyStat> {
        self.lock().key_stats.clone()
    }

    pub fn clear(&self) {
        let mut s = self.lock();
        let keys = std::mem::take(&mut s.key_stats);
        // Today's count stays: clearing statistics must not lift a daily limit.
        let key_stats = keys.into_iter().map(|(k, v)| (k, KeyStat { day: v.day, day_requests: v.day_requests, ..Default::default() })).collect();
        *s = MetricsState { since: now_ms(), key_stats, ..Default::default() };
        drop(s);
        self.dirty.store(true, Ordering::Release);
        self.flush();
    }

    /// Writes the file when something changed since the last flush.
    pub fn flush(&self) {
        if !self.dirty.swap(false, Ordering::AcqRel) {
            return;
        }
        let data = {
            let mut s = self.lock();
            s.last_updated = jiff::Timestamp::now().to_string();
            serde_json::to_vec(&*s)
        };
        match data {
            Ok(d) => {
                if let Err(e) = crate::paths::write_atomic(&self.path, &d) {
                    tracing::warn!("save metrics: {e}");
                    self.dirty.store(true, Ordering::Release);
                }
            }
            Err(e) => tracing::warn!("encode metrics: {e}"),
        }
    }
}

fn tokens_of(r: &Map<String, Value>) -> (i64, i64, i64, i64, i64) {
    let Some(Value::Object(t)) = r.get("tokens") else { return (0, 0, 0, 0, 0) };
    let inp = jint(t.get("input_tokens"));
    let out = jint(t.get("output_tokens"));
    let mut cac = jint(t.get("cached_tokens"));
    if cac == 0 {
        cac = jint(t.get("cache_read_tokens"));
    }
    let rea = jint(t.get("reasoning_tokens"));
    let mut tot = jint(t.get("total_tokens"));
    if tot == 0 {
        tot = inp + out;
    }
    (inp, out, cac, rea, tot)
}

/// The daily counter of one key: starts over on a new day, refuses at `limit`.
fn take_day_slot(k: &mut KeyStat, day: &str, limit: u32) -> Result<(), i64> {
    if k.day != day {
        k.day = day.to_string();
        k.day_requests = 0;
    }
    if limit > 0 && k.day_requests >= limit as i64 {
        return Err(k.day_requests);
    }
    k.day_requests += 1;
    Ok(())
}

/// Requests a key made on `day` (0 when the counter is from another day).
pub fn day_count(k: &KeyStat, day: &str) -> i64 {
    if k.day == day { k.day_requests } else { 0 }
}

/// Average of a sum over a count (0 when nothing was counted).
pub fn avg(sum: i64, n: i64) -> i64 {
    if n > 0 { sum / n } else { 0 }
}

fn record_time(r: &Map<String, Value>) -> i64 {
    r.get("timestamp").and_then(Value::as_str).map(parse_time_ms).filter(|&t| t > 0).unwrap_or_else(now_ms)
}

fn add_hourly(s: &mut MetricsState, r: &Map<String, Value>) {
    let ts = record_time(r);
    let hour = ts - ts.rem_euclid(HOUR_MS);
    let failed = r.get("failed").and_then(Value::as_bool).unwrap_or(false);
    let (_, _, _, _, tot) = tokens_of(r);
    let b = s.hourly.entry(hour.to_string()).or_default();
    if failed {
        b.failed += 1;
    } else {
        b.ok += 1;
    }
    b.tokens += tot;
}

/// Parses one usage-queue answer: a JSON array of objects or of JSON strings.
pub fn parse_queue(raw: &[u8]) -> Vec<Map<String, Value>> {
    let Ok(Value::Array(items)) = serde_json::from_slice::<Value>(raw) else { return vec![] };
    items
        .into_iter()
        .filter_map(|it| match it {
            Value::Object(m) => Some(m),
            Value::String(s) => serde_json::from_str::<Map<String, Value>>(&s).ok(),
            _ => None,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn ingest_counts() {
        let dir = std::env::temp_dir().join(format!("cl-metrics-{}", crate::util::random_hex(4)));
        let m = Metrics::open(dir.join("metrics.json"));
        let recs = parse_queue(
            json!([
                {"model":"a","failed":false,"timestamp":"2026-11-16T10:20:00Z","tokens":{"input_tokens":10,"output_tokens":5}},
                "{\"model\":\"a\",\"failed\":true}"
            ])
            .to_string()
            .as_bytes(),
        );
        m.ingest(recs);
        let s = m.snapshot();
        assert_eq!(s.total_requests, 2);
        assert_eq!(s.total_failed, 1);
        assert_eq!(s.total_tokens, 15);
        assert_eq!(s.model_stats["a"].requests, 2);
        assert_eq!(s.history[0]["failed"], true);
        m.flush();
        let again = Metrics::open(dir.join("metrics.json"));
        assert_eq!(again.snapshot().total_requests, 2);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn accounts_apps_and_speed() {
        let dir = std::env::temp_dir().join(format!("cl-metrics-{}", crate::util::random_hex(4)));
        let m = Metrics::open(dir.join("metrics.json"));
        let ts = jiff::Timestamp::now().to_string();
        m.ingest(vec![
            serde_json::from_value(json!({"model":"a","timestamp":ts,"auth_index":"7","latency_ms":1000,"ttft_ms":200,
                "user_agent":"claude-cli/2.1","tokens":{"total_tokens":30}}))
            .unwrap(),
            serde_json::from_value(json!({"model":"a","timestamp":ts,"auth_index":"7","latency_ms":3000,"failed":true,"tokens":{}})).unwrap(),
            // Old records without the new fields still count as before.
            serde_json::from_value(json!({"model":"a"})).unwrap(),
        ]);
        m.count_app("Claude Code", false, 500);
        m.count_app("Claude Code", true, 1500);
        let s = m.snapshot();
        let st = &s.model_stats["a"];
        assert_eq!((st.requests, st.latency_n, avg(st.latency_sum, st.latency_n)), (3, 2, 2000));
        assert_eq!((st.ttft_n, st.ttft_sum), (1, 200));
        let acc = &s.account_stats["7"];
        assert_eq!((acc.requests, acc.failed, acc.tokens, avg(acc.latency_sum, acc.latency_n)), (2, 1, 30, 2000));
        let hours = &s.account_hourly["7"];
        assert_eq!(hours.len(), 1);
        let b = hours.values().next().unwrap();
        assert_eq!((b.ok, b.failed, b.tokens), (1, 1, 30));
        let app = &s.app_stats["Claude Code"];
        assert_eq!((app.requests, app.failed, app.tokens, avg(app.latency_sum, app.latency_n)), (2, 1, 30, 1000));
        // Files written before these fields existed still load.
        let old: MetricsState =
            serde_json::from_str(r#"{"total_requests":5,"model_stats":{"x":{"requests":5}},"key_stats":{"main":{"requests":1}}}"#).unwrap();
        assert_eq!(old.model_stats["x"].latency_n, 0);
        assert!(old.account_stats.is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn daily_counts() {
        let mut k = KeyStat::default();
        assert!(take_day_slot(&mut k, "2026-11-16", 2).is_ok());
        assert!(take_day_slot(&mut k, "2026-11-16", 2).is_ok());
        assert!(take_day_slot(&mut k, "2026-11-16", 2).is_err());
        assert_eq!(day_count(&k, "2026-11-16"), 2);
        assert_eq!(day_count(&k, "2026-11-17"), 0);
        assert!(take_day_slot(&mut k, "2026-11-17", 2).is_ok());
        assert_eq!(k.day_requests, 1);

        let dir = std::env::temp_dir().join(format!("cl-metrics-{}", crate::util::random_hex(4)));
        let m = Metrics::open(dir.join("metrics.json"));
        assert!(m.take_daily("k1", "d", 1).is_ok());
        assert!(m.take_daily("k1", "d", 1).is_err());
        m.clear();
        // Clearing statistics keeps today's count (the limit still holds).
        assert!(m.take_daily("k1", "d", 1).is_err());
        let again = Metrics::open(dir.join("metrics.json"));
        assert!(again.take_daily("k1", "d", 1).is_err(), "survives a restart");
        let _ = std::fs::remove_dir_all(dir);
    }
}
