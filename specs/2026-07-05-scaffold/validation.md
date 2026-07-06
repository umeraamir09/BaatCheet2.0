# Phase 0 — Scaffold: Validation

How to know the implementation succeeded and can be merged. Per Decision D5, merge requires **automated gates green AND a manual smoke test**.

## Automated gates (must all pass)
- [ ] `bun run lint` exits 0 (ESLint, no errors).
- [ ] `bun run typecheck` exits 0 (`tsc --noEmit`).
- [ ] `bun tauri build` completes and emits a release binary for the current platform.

## Manual smoke test (reactive Convex wiring — Decision D6)
1. `bun tauri dev` launches the BaatCheet window.
2. The window renders the `counter.value` from Convex, large, centered, styled via Tailwind (dark base).
3. With the window open, open the Convex Cloud dashboard and change the counter doc's `value`.
4. The number in the Tauri window updates to the new value **without a refresh or restart** — proving the reactive subscription works end-to-end.

## Deep-link scheme check (register-only, no flow)
- [ ] Invoking `baatcheet://callback` from the OS (e.g. Start → Run / browser address bar) opens the BaatCheet window. No auth handling logic is expected — only scheme registration.

## Repo hygiene
- [ ] Tool versions recorded (Rust, Node, bun, Tauri CLI) in README prerequisites.
- [ ] Discord Client ID stored in env, not committed (no secrets in repo).
- [ ] `.gitignore` covers `node_modules`, `dist`, `src-tauri/target`, Convex `.env.local`.
- [ ] README has dev/run commands (`bun install`, `bun tauri dev`, `bun run lint`, `bun run typecheck`).

## Explicitly NOT validated here (out of scope — later phases)
- ~~Discord OAuth2 + PKCE login flow~~ → Phase 1.
- ~~Presence / status list~~ → Phase 2.
- ~~DM text chat~~ → Phase 3.
- ~~Voice (1:1 or group)~~ → Phases 4, 6.
- ~~Full Discord-derived theme~~ → Phase 7.
- ~~Idle CPU/RAM profiling under gaming load~~ → Phase 7.
- ~~Self-hosted Convex / LiveKit / coturn on Coolify~~ → later (D1 defers Convex self-hosting to a later phase; v1 dev uses Convex Cloud).

## Merge criteria
All automated gates green + manual smoke steps 1–4 confirmed + deep-link scheme check passing + repo hygiene box-checked. Anything in the "NOT validated here" list is explicitly allowed to be absent.
