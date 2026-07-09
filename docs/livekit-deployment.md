# LiveKit Server Deployment Guide for BaatCheet

Deploy a self-hosted LiveKit SFU on your Ubuntu VM (no Coolify) for Phase 6 group voice.

**What you'll have after this guide:**
- LiveKit server running as a systemd Docker service behind Let's Encrypt TLS
- WebSocket URL (`wss://livekit.yourdomain.com`) — goes in `VITE_LIVEKIT_URL`
- API key + API secret — go in Convex env via `bunx convex env add`
- coturn TURN fallback wired up (reuses the Phase 4 coturn)
- Auto-starting on boot, auto-updating TLS

**Time:** ~45 minutes

**Reference:** [LiveKit VM deployment docs](https://docs.livekit.io/transport/self-hosting/vm/)

---

## Prerequisites

- Ubuntu 20.04+ VM with root/sudo access
- A domain name you own (e.g., `yourdomain.com`)
- Ability to add DNS A records (at your DNS provider: Cloudflare, Namecheap, etc.)
- Docker + Docker Compose already installed on the VM
- Public IP address with ports open (covered below)
- coturn already deployed per `docs/coturn-deployment.md` (Phase 4)

**Verify Docker is installed:**
```bash
docker --version && docker compose version
```

If not installed:
```bash
sudo apt update && sudo apt install -y docker.io docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
# Log out and back in, or run: newgrp docker
```

---

## Step 1: DNS setup

Create two DNS A records pointing to your VM's public IP:

| Record | Type | Value |
|---|---|---|
| `livekit.yourdomain.com` | A | `<YOUR_VM_IP>` |
| `livekit-turn.yourdomain.com` | A | `<YOUR_VM_IP>` |

Replace `yourdomain.com` with your actual domain. These are required for Let's Encrypt TLS issuance.

Verify propagation:
```bash
host livekit.yourdomain.com
host livekit-turn.yourdomain.com
```

Both should show your VM's IP before proceeding.

---

## Step 2: Open firewall ports

LiveKit needs these ports accessible from the internet:

| Port | Protocol | Purpose |
|---|---|---|
| 80 | TCP | Let's Encrypt HTTP-01 challenge |
| 443 | TCP | Primary HTTPS + TURN/TLS (WebSocket signaling) |
| 7881 | TCP | WebRTC over TCP fallback |
| 3478 | UDP | TURN/UDP |
| 50000-60000 | UDP | WebRTC media streams |

### UFW (OS-level firewall)
```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 7881/tcp
sudo ufw allow 3478/udp
sudo ufw allow 50000:60000/udp
sudo ufw reload
sudo ufw status
```

### Oracle Cloud / cloud provider firewall
If your VM is behind a cloud firewall (Oracle VCN, AWS SG, etc.), open the same ports there too. For Oracle Cloud: Networking → Virtual Cloud Networks → Security Lists → add Ingress Rules for each port above with CIDR `0.0.0.0/0`.

---

## Step 3: Generate LiveKit config with the official generator

LiveKit provides a Docker image (`livekit/generate`) that walks you through setup and writes `docker-compose.yaml`, `livekit.yaml`, `caddy.yaml`, `redis.conf`, and `init_script.sh`.

Run it on your VM:
```bash
cd ~
mkdir livekit-deploy && cd livekit-deploy
sudo docker run --rm -it -v$PWD:/output livekit/generate
```

You'll be prompted for several choices. Answer as follows:

| Prompt | Answer |
|---|---|
| **Select features** | `no` (we don't need Ingress/Egress) |
| **LiveKit domain** | `livekit.yourdomain.com` |
| **TURN domain** | `livekit-turn.yourdomain.com` |
| **WHIP domain** | (leave empty) |
| **SSL method** | `letsencrypt` |
| **LiveKit version** | `latest` |
| **Bundled Redis?** | `yes` (or `no` if you have your own Redis) |
| **Create startup script?** | `yes` |

When the generator finishes, it prints the API key and API secret to the terminal:

```
API Key: APIabc123def456ghi789
API Secret: jkl012mno345pqr678stu901vwx234yz5
```

**Save these immediately.** You'll need them in Step 6. They also appear in the generated `livekit.yaml`.

The generator creates a directory named `livekit.yourdomain.com/` containing everything needed.

---

## Step 4: Adjust the startup script

Since Docker + Docker Compose are already installed on your VM, edit `init_script.sh` to skip re-installing them:

```bash
cd ~/livekit-deploy/livekit.yourdomain.com
nano init_script.sh
```

Find the section that installs Docker and comment it out:

```bash
# Docker & Docker Compose will need to be installed on the machine
#curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
#sh /tmp/get-docker.sh
#curl -L "https://github.com/docker/compose/releases/download/v2.20.2/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
#chmod 755 /usr/local/bin/docker-compose
```

Next, find the `ExecStartPre`, `ExecStart`, and `ExecStop` lines in the systemd service section. If they use `docker-compose` (hyphen), change them to `docker compose` (space):

```bash
ExecStartPre=/usr/bin/docker compose -f docker-compose.yaml down
ExecStart=/usr/bin/docker compose -f docker-compose.yaml up
ExecStop=/usr/bin/docker compose -f docker-compose.yaml down
```

Save and exit.

---

## Step 5: Run the startup script

```bash
chmod +x init_script.sh
sudo ./init_script.sh
```

This copies configs to `/opt/livekit/`, installs the `livekit-docker` systemd service, and starts the stack (Caddy reverse proxy with Let's Encrypt TLS + LiveKit server + Redis).

Check the service:
```bash
systemctl status livekit-docker
```

You should see `active (running)`. If it's still starting, wait 30s and check again. LiveKit needs to obtain TLS certificates from Let's Encrypt, which may take a moment.

**Check TLS cert acquisition:**
```bash
docker compose -f /opt/livekit/docker-compose.yaml logs caddy 2>&1 | grep -i "certificate obtained"
```

If you see `certificate obtained successfully`, TLS is working. If instead you see "tls failed to obtain certificate," your DNS isn't propagated yet — wait and restart the stack:
```bash
systemctl restart livekit-docker
```

**Verify LiveKit responds:**
```bash
curl https://livekit.yourdomain.com
```

Expected output:
```
OK
```

---

## Step 6: Record credentials

Your API key and secret are in `/opt/livekit/livekit.yaml`. View them in one command:

```bash
grep -A1 '^keys:' /opt/livekit/livekit.yaml | head -3
```

Example output:
```yaml
keys:
  APIabc123def456ghi789: jkl012mno345pqr678stu901vwx234yz5
```

The key is the left side, the secret is the right side.

**Write them down.** You'll need to:
1. Set them in Convex env (Step 7)
2. Possibly reference them for troubleshooting

---

## Step 7: Configure your BaatCheet project

### 7a — Set Convex environment variables

The API key and secret must be set in your Convex deployment environment (NOT `.env.local`). From your **local development machine** (not the VM):

```bash
cd /path/to/baatcheet
bunx convex env add LIVEKIT_API_KEY APIabc123def456ghi789
bunx convex env add LIVEKIT_API_SECRET jkl012mno345pqr678stu901vwx234yz5
```

Replace the values with your actual key and secret.

### 7b — Set frontend `.env.local`

In your project's `.env.local`, set the LiveKit WebSocket URL:

```bash
VITE_LIVEKIT_URL=wss://livekit.yourdomain.com
```

This tells the React frontend where to connect.

### 7c — Regenerate Convex codegen

```bash
bunx convex codegen
```

This ensures `_generated/` picks up the `mintToken` action signature from `convex/livekit.ts` (already done if you followed Phase 6 implementation, but re-run to confirm).

---

## Step 8: Wire coturn as LiveKit's TURN fallback (Decision D10)

This is optional for non-strict-NAT users but required for the worst-case connectivity scenario. If you haven't deployed coturn yet, follow `docs/coturn-deployment.md` first.

Edit LiveKit's config to point at your existing coturn:

```bash
sudo nano /opt/livekit/livekit.yaml
```

Find the `turn:` block. Update it to reference your coturn:

```yaml
turn:
  enabled: true
  domain: livekit-turn.yourdomain.com
  tls_port: 443
  udp_port: 3478
  # Use coturn as the external TURN relay
  external_turn:
    enabled: true
    udp_port: 3478
    tls_port: 5349
```

**Alternative:** If your LiveKit version doesn't have `external_turn`, you can omit it — LiveKit's bundled TURN will work for most cases. The coturn is used by the HTML5 WebRTC path (1:1 calls); LiveKit's own ICE agent may get through without explicit coturn wiring. Decision D10 says "server config concern, not client code" — the client just connects to `VITE_LIVEKIT_URL`.

Restart LiveKit to apply changes:
```bash
systemctl restart livekit-docker
```

---

## Step 9: Verify everything end-to-end

### 9a — LiveKit server health
```bash
curl https://livekit.yourdomain.com
# → OK

curl -k https://livekit.yourdomain.com/rtc
# → should not hang (returns data or 404 — means the TCP path responds)
```

### 9b — Check running containers
```bash
docker ps
```

You should see at least three containers:
- `livekit-caddy-1` (reverse proxy + TLS)
- `livekit-livekit-1` (the LiveKit SFU)
- `livekit-redis-1` (key-value store)

### 9c — Check logs
```bash
docker compose -f /opt/livekit/docker-compose.yaml logs --tail=50
```

### 9d — Test with LiveKit CLI (optional)
If you want to test token generation manually before involving the app:

```bash
# Install LiveKit CLI (one time)
curl -sSL https://get.livekit.io/cli | bash

# Create a test token
export LIVEKIT_API_KEY=APIabc123def456ghi789
export LIVEKIT_API_SECRET=jkl012mno345pqr678stu901vwx234yz5
export LIVEKIT_URL=wss://livekit.yourdomain.com

lk token create --room lobby --identity test-user --valid-for 5m
```

This prints a JWT. You don't need this for normal operation — `convex/livekit.ts` mints tokens on demand. It's just a smoke test that credentials work.

### 9e — BaatCheet app quick check
1. Ensure `VITE_LIVEKIT_URL` is set in `.env.local`
2. Ensure `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` are set via `bunx convex env add`
3. Start the app: `bun tauri dev`
4. Log in with two Discord accounts (two different OS users or two VMs)
5. Both click into the lobby → the "Join Voice" button appears in the lobby header
6. User A clicks "Join Voice" → user B sees A appear in the roster
7. Two-way audio works

---

## Service management

LiveKit runs as a systemd service named `livekit-docker`:

```bash
sudo systemctl status livekit-docker   # Check status
sudo systemctl start livekit-docker    # Start
sudo systemctl stop livekit-docker     # Stop
sudo systemctl restart livekit-docker  # Restart
sudo systemctl enable livekit-docker   # Enable on boot (done by init_script)
sudo systemctl disable livekit-docker  # Disable on boot
```

**Viewing logs:**
```bash
# All services together
docker compose -f /opt/livekit/docker-compose.yaml logs --tail=100

# Specific service
docker compose -f /opt/livekit/docker-compose.yaml logs livekit --tail=100
docker compose -f /opt/livekit/docker-compose.yaml logs caddy --tail=100

# Follow live
docker compose -f /opt/livekit/docker-compose.yaml logs -f
```

---

## Upgrading LiveKit

```bash
cd /opt/livekit
sudo docker compose pull livekit
sudo systemctl restart livekit-docker
```

---

## Room lifecycle notes

- Rooms auto-create when the first participant connects to them (via `room.connect` with a token granting access to that room name).
- Rooms auto-delete when the last participant leaves (after `empty_timeout`, default 300s).
- The BaatCheet app uses room name `"lobby"` for the group voice channel.

No manual room management is needed.

---

## Troubleshooting

### "certificate obtained" not appearing in caddy logs

```bash
host livekit.yourdomain.com
```

If DNS isn't pointed at this VM's IP, Caddy can't complete the ACME challenge. Fix the DNS record, then:

```bash
sudo systemctl restart livekit-docker
```

### LiveKit returns "OK" via HTTP but WebSocket fails

Make sure your client is using `wss://` (not `ws://`) and port 443 is open. Also check that `http2` is enabled in your cloud firewall.

### Client gets 503 or timeout on connect

- Check that ports 7881 and 50000-60000/UDP are open in BOTH UFW and cloud firewall
- Check `systemctl status livekit-docker` — the container might be down
- Check logs: `docker compose -f /opt/livekit/docker-compose.yaml logs --tail=50`

### "LIVEKIT_API_KEY or LIVEKIT_API_SECRET not set" in the app

You set them in `bunx convex env add` but haven't restarted the Convex dev server or pushed the deployment. Run:

```bash
bunx convex dev
```

Or, for a Convex deployment in dev mode, the env vars take effect after ~30s. No need to restart the app — just wait and the action will pick them up.

### Convex action errors with "unauthorized" or "access denied"

The `mintToken` action is public (Decision D13 — v1 limitation). Check that `convex/livekit.ts` does NOT have an `{ args: ..., handler: internalAction(...) }` wrapper — it should use `action({ args: ..., handler: async (ctx, args) => { ... } })`. If it's an `internalAction`, tokens won't mint from the client. Re-read `convex/livekit.ts` to confirm.

### Two-way audio doesn't work on strict NAT

- Verify LiveKit's TURN is working: check logs for "turn" entries
- If you wired coturn as external TURN, verify coturn is running: `systemctl status coturn`
- Check coturn logs: `sudo tail -f /var/log/turnserver.log`
- Test with `turnutils_uclient` from `docs/coturn-deployment.md` Step 6

### Can't access the VM's ports

If running Oracle Cloud, Vultr, or similar, check TWO places:
1. Cloud provider's firewall / security list (e.g., Oracle VCN Security List)
2. OS-level firewall (UFW)

Both must allow the port.

---

## Quick reference

| Item | Location / value |
|---|---|
| Config directory | `/opt/livekit/` |
| LiveKit config | `/opt/livekit/livekit.yaml` |
| Docker Compose | `/opt/livekit/docker-compose.yaml` |
| Systemd service | `livekit-docker` |
| Logs | `docker compose -f /opt/livekit/docker-compose.yaml logs` |
| WebSocket URL | `wss://livekit.yourdomain.com` (→ `VITE_LIVEKIT_URL`) |
| API key | In `livekit.yaml` under `keys:` (left side) |
| API secret | In `livekit.yaml` under `keys:` (right side) |
| Convex env set | `bunx convex env add LIVEKIT_API_KEY ...` |
| Convex env set | `bunx convex env add LIVEKIT_API_SECRET ...` |
| TURN server | Same coturn from Phase 4 (`docs/coturn-deployment.md`) |
| Rooms | Auto-create, auto-delete. Room name: `"lobby"` |

---

## Next steps

1. Complete the restart of the Convex dev server after setting env vars
2. Verify app connects: `bun tauri dev` → lobby → "Join Voice"
3. Run manual smokes from `specs/2026-07-09-hangout-lobby-voice-livekit/validation.md`:
   - 3+ members join/leave freely, audio stable (the DoD)
   - Mute / deafen round-trip in group
   - Leave + rejoin one-click
   - Side-by-side layout + roster + speaking indicators
   - Mutual exclusivity with 1:1 call
   - coturn TURN fallback across NAT (if you have a strict-NAT client)
   - Teardown on logout + window close
   - No regression in Phase 2/3/4/5

---

**Done!** Your LiveKit server is ready for BaatCheet group voice.
