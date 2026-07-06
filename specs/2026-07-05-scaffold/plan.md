# Phase 0 — Scaffold: Plan

Numbered task groups. Each is independently reviewable. Commands assume Windows/PowerShell + `bun`.

## 1. Dev prerequisites (verify/install + pin)
- 1.1 Verify Rust toolchain: `rustc --version`, `cargo --version`. Install via rustup if missing. Record the version in a `.tool-versions` or `README` "prerequisites" note.
- 1.2 Verify Node: `node --version` (needed for tooling ecosystem even though bun is the PM).
- 1.3 Verify/install `bun`: `bun --version`.
- 1.4 Install Tauri CLI: `bun add -D @tauri-apps/cli` (project-local) so `bun tauri ...` works reproducibly.
- 1.5 Verify system dependencies for Tauri v2 on Windows (MSVC build tools / WebView2 runtime). Note them in the prerequisites section.
- **Done:** all tool versions recorded; `bun tauri --version` responds.

## 2. Repo + Tauri scaffold
- 2.1 Scaffold the app into the current repo root using Tauri v2: `bunx create-tauri-app@latest` → choose React + TypeScript + Vite, package manager bun, frontend dir `src`, rust dir `src-tauri`. (Run inside the existing repo so `README.md` and `specs/` are preserved; merge/skip overwrites deliberately.)
- 2.2 Confirm structure: `src/` (frontend), `src-tauri/` (rust), `package.json`, `vite.config.ts`, `tsconfig.json`.
- 2.3 Set the app identifier and product name to BaatCheet in `src-tauri/tauri.conf.json` (`productName: "BaatCheet"`, a stable bundle identifier).
- 2.4 First run: `bun tauri dev` → window opens with the default Tauri+React splash. Kill it.
- **Done:** `bun tauri dev` launches the default Tauri window from this repo.

## 3. Tailwind CSS
- 3.1 Install: `bun add -D tailwindcss @tailwindcss/vite` (Tailwind v4 Vite plugin).
- 3.2 Add the Tailwind Vite plugin to `vite.config.ts`.
- 3.3 Load Tailwind in `src/index.css` (`@import "tailwindcss";`).
- 3.4 Define a minimal dark base theme token (background + foreground) in CSS; render a hello-world using it to confirm the pipeline.
- **Done:** a styled dark element renders in the Tauri window via Tailwind classes.

## 4. Convex wiring (Convex Cloud) + reactive smoke doc
- 4.1 Install: `bun add convex`.
- 4.2 `bunx convex dev` → create/link the Convex Cloud project; record the dev + deploy URLs (e.g. in `.env.local` / `src/main.tsx`).
- 4.3 Define a minimal schema in `convex/schema.ts`: a `counter` table with a single doc (`{ value: number }`).
- 4.4 Add a query in `convex/counter.ts`: `get` → returns the counter doc (creates a default `{ value: 0 }` if missing).
- 4.5 Seed the counter doc (one-time) so the query has something to return.
- 4.6 Wire `ConvexProvider` from `convex/react` in `src/main.tsx`.
- 4.7 In `src/App.tsx`, call `useQuery(api.counter.get)` and render `value` large in the center of the window.
- 4.8 Smoke: with `bun tauri dev` running, open the Convex dashboard and edit the counter doc's `value` → the Tauri window updates live without a refresh.
- **Done:** live reactive Convex value visible in the Tauri window; dashboard mutations reflect in-app in real time.

## 5. Lint + format
- 5.1 Install: `bun add -D eslint @eslint/js typescript-eslint eslint-plugin-react-hooks prettier eslint-config-prettier`.
- 5.2 Add `eslint.config.js` (flat config) with TS + react-hooks rules; `eslint-config-prettier` last to disable formatting conflicts.
- 5.3 Add `.prettierrc` (single quotes, no semi — match repo style once confirmed; otherwise default), `.prettierignore`.
- 5.4 Add npm scripts: `lint`, `lint:fix`, `format`, `typecheck` (`tsc --noEmit`).
- 5.5 Run `bun run lint` and `bun run format`; fix any baseline issues.
- **Done:** `bun run lint` and `bun run typecheck` exit clean.

## 6. Discord OAuth app + deep-link scheme (register only)
- 6.1 User creates the Discord OAuth application on the Discord Developer Portal; redirect URI = `baatcheet://callback`. (User-performed prerequisite per `requirements.md`.)
- 6.2 Record the Discord **Client ID** in `src-tauri/.env` (or tauri.conf) — not the secret (PKCE public client; no secret).
- 6.3 Add the Tauri v2 deep-link plugin: `bun add @tauri-apps/plugin-deep-link`; register the `baatcheet` scheme in `tauri.conf.json` and `src-tauri/Cargo.toml`/`lib.rs` per plugin docs.
- 6.4 Verify the scheme is claimed: launching `baatcheet://callback` from the OS opens the app (no handling logic yet — that's Phase 1).
- **Done:** `baatcheet://callback` opens the BaatCheet window; Client ID stored in env; no auth logic yet.

## 7. Build + merge readiness
- 7.1 `bun tauri build` → produces a release binary (smoke; don't ship).
- 7.2 Confirm all automated gates green: `bun run lint`, `bun run typecheck`, `bun tauri build`.
- 7.3 Run the manual smoke from task group 4 (reactive doc) one more time on a clean run.
- 7.4 Update repo `README.md` prerequisites + dev/run commands.
- **Done:** all validation in `validation.md` passes; phase ready to merge.
