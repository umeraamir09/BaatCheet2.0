# Phase 0 — Scaffold: Requirements

Feature dir: `specs/2026-07-05-scaffold/`
Roadmap phase: **Phase 0 — Scaffold** (`specs/roadmap.md`)
Mission ref: `specs/mission.md` · Stack ref: `specs/tech-stack.md`

## Goal
Empty-but-wired app shell and prereqs in place before any feature. By the end of this phase, `cargo tauri dev` launches a Tauri window that renders a **live, reactive** Convex query result. No features.

## In scope
- Tauri **v2** + Vite + React + TypeScript bootstrapped and running locally.
- Tailwind CSS wired and producing a dark base theme token (enough to verify the pipeline; full theme is Phase 7).
- Convex client wired and a **reactive** query proven (mutate a doc from the Convex dashboard → value updates live in the Tauri window, no refresh).
- Discord OAuth application registered on the Discord Developer Portal; `baatcheet://callback` deep-link scheme claimed in the Tauri config. Client ID recorded in env. (The OAuth flow itself is Phase 1.)
- Repo conventions: git, ESLint + Prettier, typecheck, and a build that produces a Tauri dev + release binary.

## Out of scope (deferred)
- The Discord OAuth2 + PKCE **flow** → Phase 1.
- Presence, DM text, any chat → Phases 2–3.
- Any voice (1:1 or group) → Phases 4, 6.
- Full Discord-derived theme → Phase 7.
- Self-hosting Convex / LiveKit / coturn on Coolify → later phases (see Decision D1).

## Decisions (locked for this phase)
- **D1 — Convex Cloud (hosted) for v1 dev.** Phase 0 wires the client to Convex Cloud, not self-hosted. This is a **dev-time deviation from `specs/tech-stack.md`** (which specifies self-hosted Convex on Coolify). Self-hosting is deferred; migration to the Coolify VM happens in a later phase once the app is further along. `tech-stack.md` should be updated to record this as the v1-dev posture when we revisit it.
- **D2 — Package manager: `bun`.** All install/run commands use bun (`bun install`, `bunx`, `bun run`).
- **D3 — Tauri v2.** Current stable; v2 plugin model, desktop-first, mobile-ready later if ever needed.
- **D4 — Lint/format: ESLint + Prettier.** Two-config setup, TS + React rules.
- **D5 — Validation: automated gates + manual smoke.** Lint, typecheck, and `cargo tauri build` must pass; plus a manual smoke test confirming the live reactive query.
- **D6 — Convex smoke shape: reactive doc.** A single doc (e.g. a `counter` with a `value` number field) read via `useQuery`; mutating it from the Convex dashboard updates the Tauri window live. Proves reactivity, not just a one-time read.

## Context
- The hard constraint from the mission (idle-light while gaming) is satisfied at the shell level by choosing Tauri over Electron; Phase 0 doesn't profile yet (that's Phase 7) but must not introduce obvious bloat.
- Identity is Discord-only (`specs/mission.md`); Phase 0 only registers the OAuth app and claims the redirect scheme so Phase 1 can implement the flow cleanly.

## User-performed prerequisites (not agent-executable)
- **Discord OAuth application**: created on https://discord.com/developers/applications by the user; redirect URI set to `baatcheet://callback`. The resulting **Client ID** is handed to the agent to put in env. (Client secret is NOT needed — PKCE flow, public client.)
- **Convex Cloud project**: created by the user (or agent if credentials available); the deploy URL + dev URL are handed to the agent for wiring.
