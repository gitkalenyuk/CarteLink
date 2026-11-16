//! The public listener: one port for the model API, the UI and its control API.

use std::net::{IpAddr, SocketAddr};
use std::sync::Mutex;

use axum::Router;
use axum::extract::connect_info::Connected;
use axum::serve::IncomingStream;
use tokio::net::TcpListener;
use tokio::sync::oneshot;

/// Both ends of the client's connection: the local end tells a LAN client
/// apart from this computer connecting through its own LAN address.
#[derive(Clone, Copy, Debug)]
pub struct Conn {
    pub remote: SocketAddr,
    pub local: SocketAddr,
}

impl Connected<IncomingStream<'_, TcpListener>> for Conn {
    fn connect_info(stream: IncomingStream<'_, TcpListener>) -> Self {
        let remote = *stream.remote_addr();
        let local = stream.io().local_addr().unwrap_or(remote);
        Conn { remote, local }
    }
}

impl Conn {
    /// The connection comes from this computer: loopback, or the same address
    /// on both ends (Host set to one LAN address). Never decided by headers.
    pub fn is_local(&self) -> bool {
        let r = canonical(self.remote.ip());
        r.is_loopback() || r == canonical(self.local.ip())
    }
}

fn canonical(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V6(v6) => v6.to_ipv4_mapped().map(IpAddr::V4).unwrap_or(IpAddr::V6(v6)),
        v4 => v4,
    }
}

#[derive(Default)]
pub struct ServerControl {
    stop: Mutex<Option<oneshot::Sender<()>>>,
}

/// The address to bind for a configured host ("" = all interfaces).
fn bind_addr(host: &str, port: u16) -> String {
    let h = host.trim().trim_matches(['[', ']']);
    if h.is_empty() {
        format!("0.0.0.0:{port}")
    } else if h.contains(':') {
        format!("[{h}]:{port}")
    } else {
        format!("{h}:{port}")
    }
}

pub fn port_free(host: &str, port: u16) -> bool {
    std::net::TcpListener::bind(bind_addr(host, port)).is_ok()
}

/// `port` when it is free, else the next free one nearby, else any.
pub fn pick_free_port(host: &str, port: u16) -> (u16, bool) {
    if port_free(host, port) {
        return (port, false);
    }
    for p in port.saturating_add(1)..=port.saturating_add(100) {
        if port_free(host, p) {
            return (p, true);
        }
    }
    match std::net::TcpListener::bind(bind_addr(host, 0)).and_then(|l| l.local_addr()) {
        Ok(a) => (a.port(), true),
        Err(_) => (port, false),
    }
}

impl ServerControl {
    /// Stops the current listener (used when the new address needs its port).
    pub fn stop(&self) {
        if let Some(old) = self.stop.lock().unwrap_or_else(|e| e.into_inner()).take() {
            let _ = old.send(());
        }
    }

    /// Binds host:port and serves `router` there. A previous listener is shut
    /// down only after the new one is bound (a failed bind leaves it running).
    pub async fn serve(&self, host: &str, port: u16, router: Router) -> std::io::Result<()> {
        let listener = TcpListener::bind(bind_addr(host, port)).await?;
        let (tx, rx) = oneshot::channel::<()>();
        if let Some(old) = self.stop.lock().unwrap_or_else(|e| e.into_inner()).replace(tx) {
            let _ = old.send(());
        }
        tracing::info!("gateway listening on {}", bind_addr(host, port));
        tokio::spawn(async move {
            let svc = router.into_make_service_with_connect_info::<Conn>();
            if let Err(e) = axum::serve(listener, svc)
                .with_graceful_shutdown(async move {
                    let _ = rx.await;
                })
                .await
            {
                tracing::error!("gateway server: {e}");
            }
        });
        Ok(())
    }
}
