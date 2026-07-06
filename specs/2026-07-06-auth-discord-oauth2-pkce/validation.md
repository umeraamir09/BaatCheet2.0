# Phase 1 — Auth (Discord OAuth2 + PKCE): Validation

How to know the implementation succeeded and can be merged. Per Decision D6, merge requires **automated gates green AND four manual smokes**.

## Automated gates (must all pass)
- [ ] `bun run lint` exits 0 (ESLint, no errors) — inherited from Phase 0.
- [ ] `bun run typecheck` exits 0 (`tsc --noEmit`) — inherited from Phase 0.
- [ ] `bun tauri build` completes and emits a release binary for the current platform — inherited from Phase 0.
- [ ] No client secret anywhere in the tree: `git grep -iE "client_secret|clientSecret"` in tracked files returns nothing (Decision D1 — PKCE public client; no secret at all).

## Manual smoke 1 — Cold-start login with avatar (the Phase-1 DoD first half)
1. Clear the secure store (or use a fresh machine profile) so no refresh token exists.
2. `bun tauri dev` launches the BaatCheet window → shows the bare "Continue with Discord" button.
3. Click the button → **system browser** (not an in-app webview) opens Discord's consent screen.
4. Consent → browser redirects to `baatcheet://callback` → the BaatCheet window comes forward and shows the authenticated state.
5. The window renders the user's **avatar** (fetched via `/users/@me`) + username/display name.
- [ ] Pass: avatar visible in-app after consenting via the system browser; no manual URL paste needed.

## Manual smoke 2 — Kill + reopen restores the session WITHOUT re-consent (the Phase-1 DoD second half)
1. While authenticated (smoke 1 done), close the BaatCheet window fully (`Ctrl+W` / window close; ensure the process is gone).
2. `bun tauri dev` (or open the binary) again — **no browser, no consent screen**.
3. The window lands authenticated, avatar visible, within ~1s.
4. Confirm the Convex `users` doc for this Discord id still exists and shows the same `displayName` + `avatarUrl`.
- [ ] Pass: reopen restores the session silently; no Discord round-trip to consent; avatar present.

## Manual smoke 3 — Token near expiry triggers silent refresh (Decision D2 proactive path)
1. Force the stored `expires_at` to ~30s in the future (e.g. temporarily shorten in dev, or set a short `expires_in` override in dev mode) and re-launch.
2. Observe the proactive timer fire before the expiry; the access token in secure store rotates (and Discord rotates the refresh token too — confirm `refresh_token` value changed).
3. Immediately after refresh, `/users/@me` (or any protected call) still returns 200; no user-visible interruption.
4. Trigger a synthetic 401 from a Discord API call in dev (e.g. temporarily corrupt the access token) → the reactive-retry wrapper refreshes once, retries the request once → succeeds; the user sees nothing unless the retry also fails.
5. Force a refresh failure (corrupt the stored refresh token) → triggering a refresh → app clears the secure store and falls back to the "Continue with Discord" screen (Decision D2 — no half-states).
- [ ] Pass: proactive refresh fires before expiry with rotated tokens; one 401 recovers transparently; revoked refresh token cleanly returns to login.

## Manual smoke 4 — Log out clears the session (Decision D3)
1. While authenticated, click "Log out".
2. Confirm: secure store no longer holds access/refresh token + expires_at (checked via a dev-only command or by relaunching and seeing the login screen).
3. Confirm: the "Continue with Discord" button is showing again; no background refresh timer is pending (no stray "reconnecting…" indicator).
4. Confirm: **no network call** to Discord's `/oauth2/revoke` was made (Phase 1 deliberately drops tokens locally and does not revoke — out of scope per `requirements.md`).
5. Relaunch BaatCheet → login screen, not the authenticated window.
- [ ] Pass: log-out drops local tokens only, no Discord revoke call, no leftover background work, relaunch shows the login screen.

## Repo hygiene + Phase-1-specific checks
- [ ] Refresh token + access token are in the **Tauri secure store**, not in plaintext files, not in localStorage, not in a committed env file. Verify by searching tracked files for credential-shaped strings: `git grep -iE "refresh[_-]?token|access[_-]?token"` returns nothing outside of code identifiers (no literal values).
- [ ] The Convex `users` table schema (`convex/schema.ts`) declares the `users` doc; the Phase-1 login writes/upserts it on both fresh login and session restore (smoke 2 step 4 confirms it persists).
- [ ] Discord OAuth scopes requested by the flow are exactly `identify` (Decision D4) — verify in the auth URL emitted by `start_discord_login`: no `email`, no `guilds`, no `connections`.
- [ ] OAuth `state` parameter is generated, sent, and validated on the deep-link return (else the code is rejected silently) — verify by tampering with `state` in the callback URL and confirming no token exchange happens.
- [ ] Deep-link callback handles the **cold-launch-into-callback** case: close the app completely, navigate a browser to a `baatcheet://callback?code=...&state=...` URL (or replay the redirect) → app launches, validates, and lands authenticated. Confirms task group 3.1's cold-launch handling.
- [ ] README Phase 1 section present: scopes (`identify`), PKCE S256, secure-store usage, the `users` Convex table, the four smokes.
- [ ] `.gitignore` continues to cover `node_modules`, `dist`, `src-tauri/target`, Convex `.env.local`, and any new Phase-1 dev `.env` used to shorten `expires_in` for smoke 3.

## Explicitly NOT validated here (out of scope — later phases)
- ~~Presence / status list~~ → Phase 2.
- ~~1:1 DM text chat~~ → Phase 3.
- ~~Voice (1:1 or group)~~ → Phases 4, 6.
- ~~Multi-account / account switching~~ — not on the v1 roadmap (`specs/mission.md`).
- ~~Token revocation via Discord `/oauth2/revoke`~~ → not in v1 (Decision D3 drops tokens locally; smoke 4 step 4 confirms no revoke call).
- ~~Periodic `/users/@me` re-sync (cron-style)~~ → not in v1; profile updated opportunistically on login only.
- ~~Full Discord-derived theme~~ → Phase 7 (Phase 1 button + avatar are unstyled).
- ~~Idle CPU/RAM profiling under gaming load~~ → Phase 7 (Phase 1 must not poll in the background, but is not profiled here).

## Merge criteria
All automated gates green + manual smokes 1–4 passing + repo-hygiene + Phase-1-specific checks box-checked. Anything in the "NOT validated here" list is explicitly allowed to be absent. The Phase-1 DoD from `specs/roadmap.md` is satisfied when smokes 1 + 2 pass: *cold start → "Continue with Discord" → landed back in-app authenticated, avatar visible. Killing and reopening the app restores the session without re-consent.*
