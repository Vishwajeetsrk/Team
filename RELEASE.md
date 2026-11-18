# Vishwajeet Team v0.7.0 [AI Company]

**A local hive of Claude Code, Antigravity, Codex, Gemini, Cursor, Grok & Copilot agents that run themselves.**
Messaging, routing, and remembering, coordinated by your orchestrator, who you talk to. Local-first and 100% free open source.

### → [**Vishwajeet Team on GitHub**](https://github.com/Vishwajeetsrk/Team)

---

## What's new in 0.7.0

**Secrets, sharing, a guardrail, and failover diagnostics — all local-first.** This release adds bundled agent CLIs for using saved secrets and one-time file links, an opt-in guardrail with standing rules, reliable prompt submission, and a read-only failover event stream.

- **Use saved secrets from any agent.** `md-secret list/run/get` pulls provider keys and your custom secrets from the app's encrypted store, so a key added after an agent started works at once — no restart, no key shown on screen. Manage names in Settings → Connections → Keys and secrets.
- **Share a page or file on a one-time link.** `md-share page|file` creates a password-protected, expiring link to something in the agent's own workspace, through a lazily-opened local tunnel. Files work once; pages can be one-time or time-boxed.
- **Opt-in guardrail (#716).** Standing rules every agent keeps even after compaction. Each rule can log, ask you on an ASK ME card, or block the tool call. Approvals are one-shot and expire in an hour. Off by default — with no rules, nothing changes.
- **More reliable prompt delivery (#695).** Submitted prompts are now confirmed against the terminal's response, with one bounded Enter retry and a "needs manual Enter" cue if the TUI still parks the text.
- **Slack replies from pasted prompts (#694).** The standing authorization to reply lives in trusted context, so the orchestrator no longer refuses to post a reply that arrived as a paste.
- **Failover diagnostics (#731).** A read-only lifecycle event stream with per-agent generation correlation, so a supervisor can tell a real restart from a stale event.
- **Faster office floor.** Pathfinding is now O(n) instead of O(n²) — agents repathing as they walk cost far less.
- **Before this release** (v0.6.0): one-click owner approvals delivered from the card (#713), OpenCode model delivery fixed (#703), and Windows grok-hooks install fixed (#749).

### 100% Free

**Vishwajeet Team** is completely free, local-first, and open-source under the MIT License. Every capability is unlocked on your local machine with no paywalls, subscriptions, or license keys required.

---

## ⤓ Downloads

Latest builds for every platform from [Releases](https://github.com/Vishwajeetsrk/Team/releases):

### 🍎 macOS
| Build | File |
|---|---|
| Universal (Apple Silicon + Intel) | [`Vishwajeet-Team-0.7.0-mac-universal.dmg`](https://github.com/Vishwajeetsrk/Team/releases/latest/download/Vishwajeet-Team-0.7.0-mac-universal.dmg) |

### 🪟 Windows
| Build | File |
|---|---|
| Installer (x64), *recommended* | [`Vishwajeet-Team-0.7.0-win-x64-setup.exe`](https://github.com/Vishwajeetsrk/Team/releases/latest/download/Vishwajeet-Team-0.7.0-win-x64-setup.exe) |
| Portable (x64, no install) | [`Vishwajeet-Team-0.7.0-win-x64-portable.exe`](https://github.com/Vishwajeetsrk/Team/releases/latest/download/Vishwajeet-Team-0.7.0-win-x64-portable.exe) |

### 🐧 Linux
| Build | File |
|---|---|
| AppImage (x86_64) | [`Vishwajeet-Team-0.7.0-linux-x86_64.AppImage`](https://github.com/Vishwajeetsrk/Team/releases/latest/download/Vishwajeet-Team-0.7.0-linux-x86_64.AppImage) |

### 📦 Source
[Source code (zip)](https://github.com/Vishwajeetsrk/Team/archive/refs/tags/v0.7.0.zip) · [Source code (tar.gz)](https://github.com/Vishwajeetsrk/Team/archive/refs/tags/v0.7.0.tar.gz)

---

## License & Credits

- Source code licensed under the **MIT License**. Copyright (c) 2026 Vishwajeet.
- Bundled pixel-art tilesets: **Modern Interiors - RPG Tileset [16X16]** by [LimeZu](https://limezu.itch.io/moderninteriors), used under the Complete Version licence. Credit to LimeZu is preserved in `LICENSE-ASSETS` and `ATTRIBUTION.md`.
