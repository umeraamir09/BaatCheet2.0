# BaatCheet — Mission

> Discord, minus everything a small friend group doesn't use.

## What it is
A lightweight desktop app for **one** friend group — target ceiling **~10 people** for v1. Native-fast, idle-light, carrying over your existing Discord identity so migration is instant.

## The three loops
Everything else (servers, roles, channels, bots, nitro, threads) is overhead this group doesn't need. The product is just:

1. **Talk to one friend** — 1:1 text + voice.
2. **Talk to everyone** — one shared hangout lobby: group voice on one side, group text on the other.
3. **See who's around** — real-time presence/status list.

## The hard constraint
The app must sit idle at low CPU/RAM while a game is running, and voice must not stutter or spike CPU. This shapes the shell choice (Tauri, not Electron) more than almost anything else in this plan.

## Non-goals (explicitly not building)
- Multi-server / channel hierarchy.
- Roles, permissions, moderation tooling.
- Bots, integrations, store, nitro-style upsells.
- A password system — Discord is the sole identity provider.
- **Offline push notifications** (app fully closed) — out of scope for v1; in-app + OS notifications while running only.
- Group sizes past ~10 — not designing for it in v1.

## v1 product decisions
- **Message history: retained forever** for v1. For a ≤10-person group, Convex storage grows slowly; no GC logic in v1. Revisit only if it becomes a problem.
- **Offline push: deferred.** No APNs/FCM-equivalent delivery mechanism in v1.
- **Identity: Discord OAuth2 (Authorization Code + PKCE)** — no separate signup, username/display-name/avatar pulled from Discord `/users/@me` on first login.

## Look & feel
Discord-derived visual language — dark base theme, familiar type scale/spacing, familiar mute/deafen/call iconography — but pared down: fewer nested panels, no server/channel hierarchy to render.
