//! Error log: the latest failed requests and app-level problems, kept in
//! memory and appended to `data/errors.jsonl` so it survives restarts.
//! Repeats of one error within a minute fold into one entry with a counter.

use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::util::{now_ms, truncate_chars};

const KEEP: usize = 500;
const COMPACT_AT: usize = 2000;
const MERGE_MS: i64 = 60_000;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct ErrorEntry {
    /// Unix ms of the last occurrence.
    pub t: i64,
    #[serde(skip_serializing_if = "is_zero")]
    pub first: i64,
    pub count: u32,
    pub status: u16,
    /// "upstream" (the engine/provider answered an error), "gateway" (CarteLink
    /// refused), "auto" (CarteLink fixed something by itself), "app".
    pub kind: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub method: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub path: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub model: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub resolved: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub client: String,
    /// Name of the API key the request came with (scoped keys only).
    #[serde(skip_serializing_if = "String::is_empty")]
    pub key: String,
    pub message: String,
}

fn is_zero(v: &i64) -> bool {
    *v == 0
}

impl ErrorEntry {
    fn same(&self, o: &ErrorEntry) -> bool {
        self.status == o.status
            && self.kind == o.kind
            && self.path == o.path
            && self.model == o.model
            && self.resolved == o.resolved
            && self.message == o.message
    }
}

struct Inner {
    entries: Vec<ErrorEntry>,
    file_lines: usize,
}

pub struct ErrorLog {
    path: PathBuf,
    inner: Mutex<Inner>,
}

impl ErrorLog {
    pub fn open(path: PathBuf) -> Self {
        let mut entries: Vec<ErrorEntry> = Vec::new();
        let mut file_lines = 0;
        if let Ok(text) = std::fs::read_to_string(&path) {
            for line in text.lines() {
                let Ok(e) = serde_json::from_str::<ErrorEntry>(line) else { continue };
                if e.t <= 0 {
                    continue;
                }
                file_lines += 1;
                // Merged repeats are appended again with the new count: keep the latest copy.
                if let Some(last) = entries.last_mut()
                    && e.first != 0
                    && last.first == e.first
                    && last.same(&e)
                {
                    *last = e;
                    continue;
                }
                entries.push(e);
            }
        }
        if entries.len() > KEEP {
            entries.drain(..entries.len() - KEEP);
        }
        ErrorLog { path, inner: Mutex::new(Inner { entries, file_lines }) }
    }

    /// Records an error and returns the stored entry (for live updates).
    pub fn add(&self, mut e: ErrorEntry) -> ErrorEntry {
        let now = now_ms();
        e.t = now;
        e.message = truncate_chars(e.message.trim(), 1000);
        if e.message.is_empty() {
            e.message = format!("HTTP {}", e.status);
        }
        e.count = e.count.max(1);
        e.client = truncate_chars(&e.client, 80);
        tracing::warn!(status = e.status, kind = %e.kind, path = %e.path, model = %e.model, resolved = %e.resolved, "{}", e.message);
        let mut g = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(last) = g.entries.last_mut()
            && last.same(&e)
            && now - last.t < MERGE_MS
        {
            last.count += 1;
            last.t = now;
            let copy = last.clone();
            self.append_locked(&mut g, &copy);
            return copy;
        }
        e.first = now;
        g.entries.push(e.clone());
        if g.entries.len() > KEEP {
            let n = g.entries.len() - KEEP;
            g.entries.drain(..n);
        }
        self.append_locked(&mut g, &e);
        e
    }

    fn append_locked(&self, g: &mut Inner, e: &ErrorEntry) {
        if g.file_lines >= COMPACT_AT {
            let mut out = String::new();
            for x in &g.entries {
                if let Ok(s) = serde_json::to_string(x) {
                    out.push_str(&s);
                    out.push('\n');
                }
            }
            if crate::paths::write_atomic(&self.path, out.as_bytes()).is_ok() {
                g.file_lines = g.entries.len();
            }
            return;
        }
        let Ok(line) = serde_json::to_string(e) else { return };
        if let Some(dir) = self.path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&self.path)
            && writeln!(f, "{line}").is_ok()
        {
            g.file_lines += 1;
        }
    }

    /// Up to `limit` entries, newest first.
    pub fn list(&self, limit: usize) -> Vec<ErrorEntry> {
        let g = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        g.entries.iter().rev().take(if limit == 0 { usize::MAX } else { limit }).cloned().collect()
    }

    pub fn total(&self) -> usize {
        self.inner.lock().unwrap_or_else(|p| p.into_inner()).entries.len()
    }

    /// Sum of counts since `since_ms` (for the navigation badge).
    pub fn count_since(&self, since_ms: i64) -> u64 {
        let g = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        g.entries.iter().filter(|e| e.t >= since_ms && e.kind != "auto").map(|e| e.count as u64).sum()
    }

    pub fn clear(&self) {
        let mut g = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        g.entries.clear();
        g.file_lines = 0;
        let _ = std::fs::write(&self.path, b"");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merges_and_reloads() {
        let dir = std::env::temp_dir().join(format!("cl-errlog-{}", crate::util::random_hex(4)));
        let path = dir.join("errors.jsonl");
        let log = ErrorLog::open(path.clone());
        let e = ErrorEntry { status: 429, kind: "upstream".into(), message: "slow".into(), ..Default::default() };
        log.add(e.clone());
        log.add(e.clone());
        log.add(ErrorEntry { status: 500, kind: "upstream".into(), message: "boom".into(), ..Default::default() });
        let l = log.list(10);
        assert_eq!(l.len(), 2);
        assert_eq!(l[1].count, 2);
        let again = ErrorLog::open(path);
        assert_eq!(again.list(10).len(), 2);
        assert_eq!(again.list(10)[1].count, 2);
        let _ = std::fs::remove_dir_all(dir);
    }
}
