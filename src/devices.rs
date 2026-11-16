//! Other devices on the local network: the addresses this gateway can be
//! reached at, and QR codes of them for phones.

use std::net::{IpAddr, Ipv4Addr, UdpSocket};

use serde::Serialize;

pub const MAX_QR_TEXT: usize = 2048;

#[derive(Debug, Serialize)]
pub struct Lan {
    /// The gateway listens beyond this computer.
    pub lan: bool,
    pub host: String,
    pub port: u16,
    pub ips: Vec<String>,
    pub urls: Vec<String>,
}

pub fn is_loopback_host(h: &str) -> bool {
    let h = h.trim().trim_matches(['[', ']']);
    h.eq_ignore_ascii_case("localhost") || h.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback())
}

fn is_any_host(h: &str) -> bool {
    matches!(h.trim(), "" | "0.0.0.0" | "::" | "[::]")
}

/// The address this machine uses to reach the network (no packet is sent:
/// connecting a UDP socket only picks the route).
pub fn primary_ipv4() -> Option<Ipv4Addr> {
    let s = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    s.connect((Ipv4Addr::new(192, 0, 2, 1), 9)).ok()?;
    match s.local_addr().ok()?.ip() {
        IpAddr::V4(ip) if !ip.is_loopback() && !ip.is_unspecified() => Some(ip),
        _ => None,
    }
}

pub fn lan_info(host: &str, port: u16, primary: Option<Ipv4Addr>) -> Lan {
    let lan = !is_loopback_host(host);
    let mut ips = Vec::new();
    if lan {
        if is_any_host(host) {
            ips.extend(primary.map(|ip| ip.to_string()));
        } else if let Ok(IpAddr::V4(ip)) = host.trim().parse::<IpAddr>() {
            ips.push(ip.to_string());
        } else if !host.contains(':') {
            // A host name the user typed.
            ips.push(host.trim().to_string());
        }
    }
    let urls = ips.iter().map(|ip| format!("http://{ip}:{port}/v1")).collect();
    Lan { lan, host: host.to_string(), port, ips, urls }
}

/// The text as an SVG QR code (black on white, with the quiet zone).
pub fn qr_svg(text: &str) -> Result<String, String> {
    if text.is_empty() {
        return Err("text is empty".into());
    }
    if text.len() > MAX_QR_TEXT {
        return Err("text is longer than 2 KB".into());
    }
    let code = qrcode::QrCode::new(text.as_bytes()).map_err(|e| e.to_string())?;
    Ok(code
        .render::<qrcode::render::svg::Color>()
        .dark_color(qrcode::render::svg::Color("#000"))
        .light_color(qrcode::render::svg::Color("#fff"))
        .quiet_zone(true)
        .min_dimensions(240, 240)
        .build())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_hosts() {
        for h in ["127.0.0.1", "localhost", "::1", "[::1]", "127.0.0.5"] {
            assert!(is_loopback_host(h), "{h}");
        }
        for h in ["0.0.0.0", "", "192.168.1.5", "::"] {
            assert!(!is_loopback_host(h), "{h}");
        }
    }

    #[test]
    fn lan_addresses() {
        let p = Some(Ipv4Addr::new(192, 168, 1, 20));
        let l = lan_info("127.0.0.1", 8317, p);
        assert!(!l.lan && l.ips.is_empty() && l.urls.is_empty());
        let l = lan_info("0.0.0.0", 8317, p);
        assert!(l.lan);
        assert_eq!(l.urls, ["http://192.168.1.20:8317/v1"]);
        let l = lan_info("10.0.0.7", 9000, p);
        assert_eq!(l.ips, ["10.0.0.7"]);
    }

    #[test]
    fn qr_is_svg() {
        let s = qr_svg("http://192.168.1.20:8317/v1").unwrap();
        assert!(s.starts_with("<?xml") || s.starts_with("<svg"));
        assert!(s.contains("<svg") && s.contains("#000") && s.contains("#fff"));
        assert!(qr_svg("").is_err());
        assert!(qr_svg(&"x".repeat(MAX_QR_TEXT + 1)).is_err());
    }
}
