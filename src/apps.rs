//! Which program sent a request, by its User-Agent: friendly names for the
//! per-program statistics, the request inspector and the live feed.

/// Distinctive substrings (lower case) → program name. Checked in order, so
/// forks come before what they were forked from (Kilo/Roo before Cline) and
/// specific apps before the generic SDKs and browsers they embed.
const BY_SUBSTRING: &[(&[&str], &str)] = &[
    (&["claude-cli", "claude-code", "claude code"], "Claude Code"),
    (&["codex"], "Codex"),
    (&["cursor"], "Cursor"),
    (&["kilo-code", "kilocode", "kilo code"], "Kilo Code"),
    (&["roo-code", "roocode", "roo code", "roo-cline"], "Roo Code"),
    (&["cline"], "Cline"),
    (&["opencode"], "OpenCode"),
    (&["qwen-code", "qwencode", "qwen code"], "Qwen Code"),
    (&["gemini-cli", "geminicli", "gemini cli"], "Gemini CLI"),
    (&["open-webui", "openwebui", "open webui"], "Open WebUI"),
    (&["librechat"], "LibreChat"),
    (&["cherrystudio", "cherry-studio", "cherry studio"], "Cherry Studio"),
    (&["chatbox"], "Chatbox"),
    (&["windsurf", "codeium"], "Windsurf"),
    (&["jetbrains", "intellij", "pycharm", "webstorm", "goland", "phpstorm", "rubymine", "clion", "android studio"], "JetBrains"),
    (&["copilot"], "GitHub Copilot"),
];

/// Short names that are only trusted as a whole product token ("Zed/0.150",
/// never a "zed" inside another word).
const BY_TOKEN: &[(&str, &str)] =
    &[("zed", "Zed"), ("goose", "Goose"), ("crush", "Crush"), ("aider", "Aider"), ("continue", "Continue"), ("curl", "curl")];

/// A friendly program name for a User-Agent ("Інше" when there is none).
pub fn app_name(user_agent: &str) -> String {
    let ua = user_agent.trim();
    if ua.is_empty() {
        return "Інше".into();
    }
    let low = ua.to_ascii_lowercase();
    if let Some((_, name)) = BY_SUBSTRING.iter().find(|(needles, _)| needles.iter().any(|n| low.contains(n))) {
        return (*name).into();
    }
    let tokens: Vec<&str> = low.split(|c: char| c.is_whitespace() || matches!(c, '/' | '(' | ')' | ';' | ',')).filter(|t| !t.is_empty()).collect();
    if let Some((_, name)) = BY_TOKEN.iter().find(|(t, _)| tokens.contains(t)) {
        return (*name).into();
    }
    // Official SDKs: "OpenAI/Python 1.x", "OpenAI/JS 4.x", "Anthropic/Python 0.x".
    if low.starts_with("openai/") || low.contains("openai-python") || low.contains("openai-node") || low.starts_with("asyncopenai/") {
        return "OpenAI SDK".into();
    }
    if low.starts_with("anthropic/") || low.contains("anthropic-sdk") || low.contains("anthropic-typescript") || low.contains("anthropic-python") {
        return "Anthropic SDK".into();
    }
    if low.starts_with("mozilla/") {
        return "Браузер".into();
    }
    let first = ua.split_whitespace().next().unwrap_or("").split('/').next().unwrap_or("").trim();
    if first.is_empty() { "Інше".into() } else { crate::util::truncate_chars(first, 40) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_programs() {
        for (ua, want) in [
            ("claude-cli/2.1.3 (external, cli)", "Claude Code"),
            ("codex_cli_rs/0.58.0 (Windows 10.0.26100; x86_64) WindowsTerminal", "Codex"),
            ("Cursor/1.7 Electron", "Cursor"),
            ("Kilo-Code/4.1", "Kilo Code"),
            ("RooCode/3.2", "Roo Code"),
            ("Cline/3.30.1", "Cline"),
            ("opencode/0.15 ai-sdk", "OpenCode"),
            ("QwenCode/0.1 (linux)", "Qwen Code"),
            ("GeminiCLI/0.9.0 (win32; x64)", "Gemini CLI"),
            ("Open-WebUI/0.6", "Open WebUI"),
            ("LibreChat/0.8", "LibreChat"),
            ("Mozilla/5.0 CherryStudio/1.6 Chrome/138", "Cherry Studio"),
            ("Mozilla/5.0 xyz Chatbox/1.15", "Chatbox"),
            ("Windsurf/1.12", "Windsurf"),
            ("JetBrains AI Assistant / IntelliJ IDEA 2026.1", "JetBrains"),
            ("GitHubCopilotChat/0.31", "GitHub Copilot"),
            ("Zed/0.210.4 (windows; x86_64)", "Zed"),
            ("goose/1.9", "Goose"),
            ("crush/0.7", "Crush"),
            ("aider/0.86 litellm", "Aider"),
            ("Continue/1.2 (vscode)", "Continue"),
            ("OpenAI/Python 1.109.1", "OpenAI SDK"),
            ("OpenAI/JS 5.20.0", "OpenAI SDK"),
            ("Anthropic/Python 0.68.0", "Anthropic SDK"),
            ("curl/8.9.1", "curl"),
            ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141", "Браузер"),
        ] {
            assert_eq!(app_name(ua), want, "{ua}");
        }
    }

    #[test]
    fn fallbacks() {
        assert_eq!(app_name(""), "Інше");
        assert_eq!(app_name("   "), "Інше");
        assert_eq!(app_name("python-requests/2.32"), "python-requests");
        assert_eq!(app_name("Go-http-client/1.1"), "Go-http-client");
        // Short names never match inside other words.
        assert_eq!(app_name("authorized-zedless/1"), "authorized-zedless");
        assert_eq!(app_name("discontinued/1"), "discontinued");
    }
}
