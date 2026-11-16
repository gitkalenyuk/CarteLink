//! Model capabilities (reasoning controls, context window) read from the
//! engine's model registry through the engine host's `/_cartelink/caps`.
//! Refreshed in the background; lookups never wait on the network.

use std::collections::HashMap;
use std::sync::Arc;

use arc_swap::ArcSwap;
use serde::{Deserialize, Serialize};

use crate::util::uncloak;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ModelCaps {
    pub thinking: bool,
    #[serde(skip_serializing_if = "is_zero")]
    pub min: i64,
    #[serde(skip_serializing_if = "is_zero")]
    pub max: i64,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub zero_allowed: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub dynamic_allowed: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub levels: Vec<String>,
    pub effort: bool,
    #[serde(rename = "type", skip_serializing_if = "String::is_empty")]
    pub kind: String,
    #[serde(skip_serializing_if = "is_zero")]
    pub context: i64,
    #[serde(skip_serializing_if = "is_zero")]
    pub max_output: i64,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub config_update: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub providers: Vec<String>,
}

fn is_zero(v: &i64) -> bool {
    *v == 0
}

#[derive(Default)]
pub struct CapsStore {
    map: ArcSwap<HashMap<String, ModelCaps>>,
}

impl CapsStore {
    pub fn replace(&self, m: HashMap<String, ModelCaps>) {
        self.map.store(Arc::new(m));
    }

    pub fn all(&self) -> Arc<HashMap<String, ModelCaps>> {
        self.map.load_full()
    }

    /// Capabilities of one model; provider-prefixed ("openrouter/x") and
    /// suffixed ("x(high)") ids fall back to their base name.
    pub fn get(&self, model: &str) -> ModelCaps {
        if model.is_empty() {
            return ModelCaps::default();
        }
        let map = self.map.load();
        let key = uncloak(model.trim()).to_ascii_lowercase();
        if let Some(c) = map.get(&key) {
            return c.clone();
        }
        if let Some(i) = key.rfind('/')
            && let Some(c) = map.get(&key[i + 1..])
        {
            return c.clone();
        }
        if let Some(i) = key.find('(').filter(|&i| i > 0)
            && let Some(c) = map.get(key[..i].trim())
        {
            return c.clone();
        }
        ModelCaps::default()
    }
}
