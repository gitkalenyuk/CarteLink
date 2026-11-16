//! The full HTTP surface of the gateway port.

use axum::Router;
use axum::http::{HeaderValue, StatusCode, Uri, header};
use axum::middleware;
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::get;
use include_dir::{Dir, include_dir};

static UI: Dir<'static> = include_dir!("$CARGO_MANIFEST_DIR/ui");

pub fn router() -> Router {
    Router::new()
        .route("/", get(|| async { Redirect::temporary("/ui/") }))
        .route("/ui", get(|| async { Redirect::temporary("/ui/") }))
        .route("/ui/", get(|| async { ui_file("index.html") }))
        .route("/ui/{*path}", get(|uri: Uri| async move { ui_file(uri.path().trim_start_matches("/ui/")) }))
        .nest("/api", crate::api::router())
        .fallback(crate::proxy::handle)
        .layer(middleware::from_fn(crate::proxy::local_gate))
}

/// Serves an embedded UI file. Never cached: a new build must show at once.
fn ui_file(path: &str) -> Response {
    let path = if path.is_empty() { "index.html" } else { path };
    if path.contains("..") || path.contains(':') || path.starts_with(['/', '\\']) || path.contains('\\') {
        return StatusCode::NOT_FOUND.into_response();
    }
    // Development: CARTELINK_UI_DIR serves the UI from disk (edit, reload, no rebuild).
    let body: Vec<u8> = match std::env::var_os("CARTELINK_UI_DIR") {
        Some(dir) => match std::fs::read(std::path::Path::new(&dir).join(path)) {
            Ok(b) => b,
            Err(_) => return (StatusCode::NOT_FOUND, "not found").into_response(),
        },
        None => match UI.get_file(path) {
            Some(f) => f.contents().to_vec(),
            None => return (StatusCode::NOT_FOUND, "not found").into_response(),
        },
    };
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let mut r = body.into_response();
    let ct = if mime.type_() == "text" || mime.subtype() == "javascript" || mime.subtype() == "json" {
        format!("{mime}; charset=utf-8")
    } else {
        mime.to_string()
    };
    if let Ok(v) = HeaderValue::from_str(&ct) {
        r.headers_mut().insert(header::CONTENT_TYPE, v);
    }
    r.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache, no-store, must-revalidate"));
    r.headers_mut().insert("x-content-type-options", HeaderValue::from_static("nosniff"));
    r.headers_mut().insert("referrer-policy", HeaderValue::from_static("no-referrer"));
    r
}
