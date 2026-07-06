# BaatCheet — Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Desktop shell | **Tauri** (Rust core + OS-native webview) | No bundled Chromium — single-digit-to-low-tens MB, idle-light on RAM/CPU. The biggest lever for the "don't touch my FPS" requirement. |
| Frontend | **React + TypeScript + Vite (SPA)** | Chosen over Next.js static export — no SSR is useful for a desktop app, so Vite SPA is the simpler Tauri integration. |
| Styling | **Tailwind CSS** | Fast to hand-tune a Discord-like dark theme. |
| Auth | **Discord OAuth2 — Authorization Code + PKCE**, custom-implemented | Public desktop client, no safe client-secret storage → PKCE. Tauri registers `baatcheet://callback` custom URI scheme so the OAuth redirect returns straight into the app after the system browser step. No auth vendor (Clerk etc.) — only one provider, no user-management UI. |
| Realtime data (chat, presence, session) | **Convex (self-hosted)** | Reactive subscriptions → live presence + chat with no manual websocket/polling. Runs on the Oracle VM behind Coolify. |
| Voice — 1:1 calls | **WebRTC, direct peer-to-peer** | No server relay needed for 2 people; lowest latency, zero extra infra. |
| Voice — group lobby | **LiveKit (self-hosted SFU)** | Mesh WebRTC breaks past a handful of peers. LiveKit is open-source, self-hostable, ships official React client SDKs. Another service on the same Coolify VM. |
| STUN/TURN | **Single self-hosted coturn, shared** | One coturn on the Coolify VM serves both 1:1 WebRTC and as LiveKit fallback when direct UDP is blocked (strict NAT/firewalls). Single thing to operate. |
| Session persistence | Long-lived refresh token | Discord access tokens expire ~1 week; refresh silently in background so friends aren't re-authenticating constantly. |
| Native notifications | **Tauri notification API** | Incoming call / DM alerts without a heavyweight in-app toast system. |
| Updates | **Tauri built-in updater** | Ship patches without manual redownload. |

## Deployment target
- **Oracle VM behind Coolify** — Convex, LiveKit, and coturn all deploy as services on the same VM.
- Desktop binaries ship via Tauri's updater.

## Out of stack for v1
- Any auth vendor / user-management UI.
- APNs/FCM-equivalent push delivery infra.
- A separate TURN per voice path — consolidated on one coturn.
