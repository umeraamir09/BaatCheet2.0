# Coturn Deployment Guide for BaatCheet

This guide deploys coturn (STUN/TURN server) on your Ubuntu VM for Phase 4 (1:1 voice) and Phase 6 (group voice via LiveKit).

**What you'll have after this guide:**
- coturn running on port 3478 (UDP/TCP) for STUN/TURN
- Optional TLS on port 5349 (recommended for production)
- Static credentials for v1 (Decision D5)
- Firewall rules configured
- `VITE_ICE_SERVERS` JSON ready for `.env.local`

**Time:** ~30 minutes

---

## Prerequisites

- Ubuntu 20.04+ VM with root/sudo access
- Public IP address (Oracle Cloud VMs have one by default)
- Domain name (recommended for TLS, but optional — you can use the IP directly)
- Ports 3478 (UDP/TCP) and 5349 (TCP, optional TLS) open in your cloud provider's firewall

**Oracle Cloud specific:** You need to open ports in BOTH the OS firewall (UFW) AND the Oracle Cloud security list / VCN. This guide covers both.

---

## Step 1: Install coturn

```bash
sudo apt update
sudo apt install -y coturn
```

Verify installation:
```bash
turnserver -v
```

---

## Step 2: Generate credentials

Generate a static username and password for your TURN server. These will be shared among your ≤10 friends (v1 stance — Decision D5).

```bash
# Generate a random password (32 chars)
TURN_PASSWORD=$(openssl rand -base64 24)
echo "Generated TURN password: $TURN_PASSWORD"
echo "Save this somewhere safe — you'll need it for VITE_ICE_SERVERS"
```

**Username:** `baatcheet` (or whatever you prefer)  
**Password:** the `$TURN_PASSWORD` from above

You'll use these in the config and in `VITE_ICE_SERVERS`.

---

## Step 3: Configure coturn

Edit `/etc/turnserver.conf`:

```bash
sudo nano /etc/turnserver.conf
```

Replace the entire contents with:

```ini
# BaatCheet coturn config
# Phase 4/6 — STUN/TURN for 1:1 voice + LiveKit fallback

# Listener IP — replace with your VM's public IP
listening-ip=0.0.0.0
listening-port=3478

# TLS listener (optional but recommended)
tls-listening-port=5349

# Relay IP — replace with your VM's public IP
# If your VM has a private IP, use that here
external-ip=<YOUR_PUBLIC_IP>

# Static credentials (v1 — Decision D5)
# Replace with your generated username:password
user=baatcheet:<YOUR_GENERATED_PASSWORD>

# Long-term credential mechanism
lt-cred-mech

# Realm — use your domain if you have one, otherwise use your IP
realm=<YOUR_DOMAIN_OR_IP>

# Server name
server-name=turn.<YOUR_DOMAIN_OR_IP>

# Fingerprint for message integrity
fingerprint

# Logging
log-file=/var/log/turnserver.log
verbose

# No CLI
no-cli

# No multicast peers
no-multicast-peers

# Min/Max ports for relay (optional — restricts relay port range)
min-port=49152
max-port=65535

# Prometheus metrics (optional)
# prometheus

# Deny relay to private IPs (security)
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
```

**Replace:**
- `<YOUR_PUBLIC_IP>` — your VM's public IP (e.g., `123.45.67.89`)
- `<YOUR_GENERATED_PASSWORD>` — the password from Step 2
- `<YOUR_DOMAIN_OR_IP>` — your domain (e.g., `example.com`) or IP if no domain

Save and exit (`Ctrl+O`, `Enter`, `Ctrl+X`).

---

## Step 4: Enable and start coturn

Edit `/etc/default/coturn` to enable the service:

```bash
sudo nano /etc/default/coturn
```

Uncomment or add:
```bash
TURNSERVER_ENABLED=1
```

Save and exit.

Start the service:
```bash
sudo systemctl enable coturn
sudo systemctl start coturn
```

Check status:
```bash
sudo systemctl status coturn
```

You should see `active (running)`.

Check logs:
```bash
sudo tail -f /var/log/turnserver.log
```

---

## Step 5: Configure firewall (OS-level)

### UFW (Ubuntu firewall)

```bash
# Allow STUN/TURN on 3478 UDP/TCP
sudo ufw allow 3478/udp
sudo ufw allow 3478/tcp

# Allow TLS on 5349 TCP (if you configured TLS)
sudo ufw allow 5349/tcp

# Allow relay port range (optional — matches min-port/max-port in config)
sudo ufw allow 49152:65535/udp

# Reload UFW
sudo ufw reload
```

Verify:
```bash
sudo ufw status
```

### Oracle Cloud Security List (if on Oracle Cloud)

Oracle Cloud has a SECOND firewall layer — the VCN security list. You must open ports there too.

1. Go to Oracle Cloud Console → Networking → Virtual Cloud Networks
2. Click your VCN → Security Lists → Default Security List
3. Add Ingress Rules:
   - **Source CIDR:** `0.0.0.0/0`
   - **IP Protocol:** UDP
   - **Destination Port Range:** `3478`
   - **Description:** `STUN/TURN UDP`

4. Add another Ingress Rule:
   - **Source CIDR:** `0.0.0.0/0`
   - **IP Protocol:** TCP
   - **Destination Port Range:** `3478`
   - **Description:** `STUN/TURN TCP`

5. Add another (if TLS):
   - **Source CIDR:** `0.0.0.0/0`
   - **IP Protocol:** TCP
   - **Destination Port Range:** `5349`
   - **Description:** `STUN/TURN TLS`

6. Add relay ports (optional):
   - **Source CIDR:** `0.0.0.0/0`
   - **IP Protocol:** UDP
   - **Destination Port Range:** `49152-65535`
   - **Description:** `TURN relay ports`

Save each rule.

---

## Step 6: Test coturn

### Test 1: Check if coturn is listening

```bash
sudo netstat -tulnp | grep turnserver
```

You should see:
```
tcp   0   0 0.0.0.0:3478   0.0.0.0:*   LISTEN   <pid>/turnserver
udp   0   0 0.0.0.0:3478   0.0.0.0:*            <pid>/turnserver
```

### Test 2: Test STUN (no auth required)

From your local machine (not the VM), test STUN:

```bash
# Install stun-client (if not installed)
sudo apt install -y stun-client

# Test STUN
stunclient <YOUR_VM_IP> 3478
```

You should see:
```
Success
Mapped address: <YOUR_PUBLIC_IP>
```

### Test 3: Test TURN (requires auth)

Use `turnutils_uclient` (comes with coturn):

```bash
# On the VM
turnutils_uclient -u baatcheet -w <YOUR_PASSWORD> <YOUR_VM_IP>
```

You should see:
```
0: IPv4. UDP reflexive addr: <YOUR_PUBLIC_IP>:<port>
```

### Test 4: Test from a browser (WebRTC)

Open https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/ in your browser.

**STUN test:**
- **STUN or TURN URI:** `stun:<YOUR_VM_IP>:3478`
- Click "Add Server" → "Gather candidates"
- You should see `srflx` candidates (server reflexive = STUN worked)

**TURN test:**
- **STUN or TURN URI:** `turn:<YOUR_VM_IP>:3478`
- **TURN username:** `baatcheet`
- **TURN password:** `<YOUR_PASSWORD>`
- Click "Add Server" → "Gather candidates"
- You should see `relay` candidates (TURN worked)

If you see `relay` candidates, coturn is working correctly.

---

## Step 7: Configure BaatCheet

Now that coturn is running, configure your BaatCheet app to use it.

### Update `.env.local`

In your BaatCheet project root, edit `.env.local`:

```bash
# Replace with your actual values
VITE_ICE_SERVERS=[{"urls":"stun:<YOUR_VM_IP>:3478"},{"urls":"turn:<YOUR_VM_IP>:3478","username":"baatcheet","credential":"<YOUR_PASSWORD>"}]
```

**Example (replace with your values):**
```bash
VITE_ICE_SERVERS=[{"urls":"stun:123.45.67.89:3478"},{"urls":"turn:123.45.67.89:3478","username":"baatcheet","credential":"abc123xyz456"}]
```

**With TLS (if you configured it):**
```bash
VITE_ICE_SERVERS=[{"urls":"stun:<YOUR_VM_IP>:3478"},{"urls":"turn:<YOUR_VM_IP>:3478","username":"baatcheet","credential":"<YOUR_PASSWORD>"},{"urls":"turns:<YOUR_VM_IP>:5349","username":"baatcheet","credential":"<YOUR_PASSWORD>"}]
```

### Rebuild the app

```bash
bun tauri build
```

The new build will include the coturn TURN server in the ICE servers config.

---

## Step 8: Verify in the app

1. Run `bun tauri dev` with two Discord accounts on different networks (one on home wifi, one on mobile hotspot with strict NAT).
2. A calls B → B accepts → two-way audio works.
3. Check the browser DevTools (F12) → Console → look for WebRTC logs.
4. In the Network tab, you should see ICE candidates being exchanged via Convex.
5. If the call connects despite strict NAT, TURN is working.

**To verify TURN is being used:**
- Open DevTools → Console → run:
  ```javascript
  // Get the RTCPeerConnection (you'd need to expose it from useCall)
  // For now, check the turnserver logs:
  ```
- On the VM, check `/var/log/turnserver.log`:
  ```bash
  sudo tail -f /var/log/turnserver.log
  ```
- You should see session allocations when a call is active.

---

## Optional: TLS with Let's Encrypt

If you have a domain, you can add TLS to coturn for encrypted TURN (turns://).

### Install Certbot

```bash
sudo apt install -y certbot
```

### Get a certificate

```bash
sudo certbot certonly --standalone -d turn.<YOUR_DOMAIN>
```

This creates:
- `/etc/letsencrypt/live/turn.<YOUR_DOMAIN>/fullchain.pem`
- `/etc/letsencrypt/live/turn.<YOUR_DOMAIN>/privkey.pem`

### Update coturn config

Edit `/etc/turnserver.conf`:

```ini
# TLS
cert=/etc/letsencrypt/live/turn.<YOUR_DOMAIN>/fullchain.pem
pkey=/etc/letsencrypt/live/turn.<YOUR_DOMAIN>/privkey.pem

# Cipher list
cipher-list="ECDHE-RSA-AES256-GCM-SHA384"
```

Restart coturn:
```bash
sudo systemctl restart coturn
```

### Auto-renew certificates

Certbot auto-renews, but you need to restart coturn after renewal:

```bash
sudo nano /etc/letsencrypt/renewal-hooks/deploy/coturn.sh
```

Add:
```bash
#!/bin/bash
sudo systemctl restart coturn
```

Make executable:
```bash
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/coturn.sh
```

---

## Troubleshooting

### coturn won't start

Check logs:
```bash
sudo journalctl -u coturn -n 50
```

Common issues:
- **Port already in use:** `sudo netstat -tulnp | grep 3478` — kill the other process or change the port
- **Permission denied:** ensure `/var/log/turnserver.log` is writable by the `turnserver` user
- **Invalid config:** check `/etc/turnserver.conf` for typos

### STUN works but TURN doesn't

- **Check credentials:** ensure `user=baatcheet:<password>` in the config matches what you put in `VITE_ICE_SERVERS`
- **Check firewall:** ensure ports 3478 UDP/TCP are open in BOTH UFW and Oracle Cloud security list
- **Check relay ports:** if you set `min-port`/`max-port`, ensure those are open too

### Call connects but audio is one-way

- **Check mic permissions:** Windows may block mic access. Go to Settings → Privacy → Microphone → allow BaatCheet
- **Check audio device:** ensure the correct mic/speakers are selected (Phase 4 uses default device)
- **Check mute/deafen state:** ensure you didn't accidentally mute or deafen

### TURN not being used (call fails on strict NAT)

- **Verify TURN candidates:** in the browser DevTools, check `pc.getStats()` for `relay` type candidates
- **Check coturn logs:** `sudo tail -f /var/log/turnserver.log` — you should see session allocations
- **Test with `turnutils_uclient`:** see Test 3 above

---

## Security notes (v1)

**Static credentials (Decision D5):** The username/password are embedded in the client binary. Anyone with the app can use your TURN server. For ≤10 trusted friends, this is acceptable. For public distribution, you'd need time-limited HMAC-issued credentials (deferred).

**Restricting access (optional):** If you want to restrict TURN to specific IPs, you can add `allowed-peer-ip` in the config, but this defeats the purpose of TURN (helping clients behind NAT).

**Monitoring:** Check `/var/log/turnserver.log` for unusual activity. If you see excessive allocations, someone may be abusing your TURN server.

---

## Next steps

Once coturn is working:
1. Test Phase 4 voice calls with a friend on a different network
2. Verify smoke 5 in `specs/2026-07-07-voice-1-1/validation.md` (coturn TURN fallback across NAT)
3. Phase 6 (LiveKit) will reuse this same coturn instance

---

## Quick reference

**Config file:** `/etc/turnserver.conf`  
**Logs:** `/var/log/turnserver.log`  
**Service:** `sudo systemctl status|start|stop|restart coturn`  
**Ports:** 3478 (UDP/TCP), 5349 (TLS, optional)  
**Credentials:** `user=baatcheet:<password>` in config, `VITE_ICE_SERVERS` in `.env.local`

---

**Done!** Your coturn server is ready for Phase 4 voice calls.
