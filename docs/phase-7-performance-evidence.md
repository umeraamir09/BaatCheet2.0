# Phase 7 Performance Evidence

This file records the manual Windows evidence for the Phase 7 DoD:

- idle footprint measured and recorded;
- no audio stutter under gaming load;
- local/static updater test patch succeeds.

Do not mark Phase 7 complete in `specs/roadmap.md`, `README.md`, or `AGENTS.md` until the rows below are filled from a real Windows run.

## Build Under Test

| Field | Value |
|---|---|
| Date/time | TODO |
| Commit / branch | `phase-7/theme-performance-updater` |
| App version | `0.1.0` |
| Build command | `bun tauri build` |
| Release artifact path | TODO |
| Machine CPU / RAM / GPU | TODO |
| Windows version | TODO |
| Game/load used | TODO |

## Measurement Protocol

1. Build or install the release app.
2. Open Windows Task Manager or Resource Monitor.
3. Launch BaatCheet and sign in.
4. Wait 60 seconds for each scenario to stabilize before recording CPU/RAM.
5. For voice scenarios, keep the session active for at least 3 minutes and record any stutter, dropout, echo, or latency symptoms.
6. For game-load scenarios, run the user-selected game/load in the same way for both 1:1 and group voice rows.

## Evidence Table

| Scenario | Participants | Game/load | Duration | CPU % | RAM MB | Audio observation | Pass/fail | Notes |
|---|---:|---|---:|---:|---:|---|---|---|
| Idle lobby | 1 | None | 60s | TODO | TODO | N/A | TODO | TODO |
| Idle DM | 1 | None | 60s | TODO | TODO | N/A | TODO | TODO |
| 1:1 voice | 2 | None | 3m | TODO | TODO | TODO | TODO | TODO |
| Group voice | 2-3 | None | 3m | TODO | TODO | TODO | TODO | TODO |
| 1:1 voice under game load | 2 | TODO | 3m | TODO | TODO | TODO | TODO | TODO |
| Group voice under game load | 2-3 | TODO | 3m | TODO | TODO | TODO | TODO | TODO |

## Updater Test Patch

Tauri updater artifacts are signed. The public key is committed in `src-tauri/tauri.conf.json`; the private key must stay outside the repo and be supplied via `TAURI_SIGNING_PRIVATE_KEY` or `TAURI_SIGNING_PRIVATE_KEY_PATH`.

### Generate a Local Test Key

```powershell
bun tauri signer generate --write-keys "$env:USERPROFILE\.baatcheet\updater.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PATH="$env:USERPROFILE\.baatcheet\updater.key"
```

Copy the generated public key into `src-tauri/tauri.conf.json` for the local test branch. Do not commit the private key.

### Static Manifest Shape

Serve JSON from the endpoint configured in `plugins.updater.endpoints`:

```json
{
  "version": "0.1.1",
  "notes": "Phase 7 local updater smoke.",
  "pub_date": "2026-07-09T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "SIGNATURE_FROM_GENERATED_ARTIFACT",
      "url": "http://127.0.0.1:8787/BaatCheet_0.1.1_x64_en-US.msi.zip"
    }
  }
}
```

### Smoke Result

| Field | Value |
|---|---|
| Older installed version | TODO |
| New test version | TODO |
| Manifest URL | `http://127.0.0.1:8787/baatcheet-updater/{{target}}/{{arch}}/{{current_version}}` |
| Update detected | TODO |
| Download/install completed | TODO |
| Relaunch completed | TODO |
| Notes | TODO |
