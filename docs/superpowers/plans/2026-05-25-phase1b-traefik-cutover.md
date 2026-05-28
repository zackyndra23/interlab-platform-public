# Phase 1B — Traefik Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Checkbox (`- [ ]`) steps.
>
> **⚠️ INFRA-ADAPTED, HIGHEST-BLAST-RADIUS PLAN.** PRODUCTION `vps-lafayette-01` with **active Sibyl users**. Each task: pre-check → action → verify (expected output) → rollback → commit. The cutover (1B.8) is an **atomic port-level switch** — read 1B.10 (rollback) BEFORE executing 1B.8.
>
> **⚠️ DEPENDENCIES:** Phase 0 COMPLETE (break-glass verified: OVH KVM works, root pw in Bitwarden, Tailscale SSH from laptop+phone). Phase 1A COMPLETE (Coolify installed, proxy currently held down, foundation healthy). Manual Traefik currently owns 80/443.
>
> **⚠️ COOLIFY-SPECIFIC VALUES = VERIFY AT EXECUTE.** Coolify was not installed during planning, so its proxy path (`/data/coolify/proxy/`), acme.json location, and cert-resolver name (`letsencrypt` expected) are **assumed** — each is confirmed by a verify step before use.
>
> **[SERVER]** `vps-lafayette-01` · **[LAPTOP]** (Tailscale browser/SSH) · **[MANUAL]** human.

**Goal:** Make Coolify's Traefik the single ingress on 80/443 — preserving all 8 legacy certs (no re-request) and all legacy routes (Sibyl + Interlab demo) via a file-provider bridge — and lock the host (SSH Tailscale-only + nftables + DOCKER-USER), with a tested <15-minute rollback.

**Architecture:** Lock the host first (sshd ListenAddress → Tailscale+loopback, nftables INPUT, DOCKER-USER). Transform the existing `acme.json` (rename resolver key `myresolver` → Coolify's) into Coolify's proxy cert store. Connect the Coolify proxy container to the legacy Docker networks and define a Traefik **file provider** bridge so it routes to the untouched legacy containers. Then the **atomic cutover**: stop manual Traefik → start Coolify proxy on 80/443. Verify Interlab-demo (canary) → Sibyl. Manual Traefik is **stopped, not removed** — rollback = restart it.

**Tech Stack:** Coolify Traefik · nftables + iptables-nft (DOCKER-USER) · Let's Encrypt acme.json · `jq` · Tailscale · OVH KVM (break-glass).

**Spec reference:** §1 (routes table), §5 (firewall/access), §6 (cutover/cert/rollback), §10 (1B), §11 (1B rollback + command outline), §12 (R2).

---

### Task 1B.0: Pre-flight gate [SERVER + MANUAL]

**Files:** none.

- [ ] **Step 1: Confirm dependencies**

Run: `docker ps --format '{{.Names}} {{.Status}}' | grep -E 'coolify|postgres-global|minio-global|supavisor|^traefik'`
Expected: Coolify + foundation healthy; **manual `traefik` still Up on 80/443**; `coolify-proxy` NOT bound to 80/443 (held since 1A.1).

- [ ] **Step 2: Re-confirm break-glass (MANUAL)**

Confirm from Phase 0: OVH KVM console reachable + root pw in Bitwarden + Tailscale SSH works from laptop AND phone **right now** (`ssh -p 2223 zaky@100.117.214.25 'echo ok'`).
Expected: `ok`. **If KVM or Tailscale SSH not working → STOP. Do not touch sshd/firewall (1B.1–1B.3) without break-glass.**

- [ ] **Step 3: Snapshot freshness check**

Confirm Phase 0 OVH snapshot exists (catastrophic rollback for the whole cutover). Record gate pass in DEPLOYMENT-LOG.

---

### Task 1B.1: SSH ListenAddress lockdown [SERVER] — break-glass armed

**Files:** Modify `/etc/ssh/sshd_config.d/` (new drop-in); commit copy to repo `system-config/`.

- [ ] **Step 1: Pre-check current SSH binding**

Run: `ss -tlnp | grep ':2223'`
Expected: currently `0.0.0.0:2223` + `[::]:2223` (public — what we're locking).

- [ ] **Step 2: Create ListenAddress drop-in**

Create `/etc/ssh/sshd_config.d/10-interlab-listen.conf`:
```
ListenAddress 100.117.214.25
ListenAddress 127.0.0.1
```
(Tailscale IP + loopback only. Port stays 2223 from existing config.)

- [ ] **Step 3: Validate config BEFORE reload (avoid lockout)**

Run: `sudo sshd -t && echo "config OK"`
Expected: `config OK` (no syntax error). **If error → fix; do NOT reload a broken config.**

- [ ] **Step 4: Reload sshd + verify binding**

Run: `sudo systemctl reload ssh && sleep 2 && ss -tlnp | grep ':2223'`
Expected: 2223 bound ONLY to `100.117.214.25` + `127.0.0.1` (no `0.0.0.0`).

- [ ] **Step 5: Verify access still works (NEW session, keep current open)**

From laptop, open a **second** SSH session via Tailscale: `ssh -p 2223 zaky@100.117.214.25 'echo still-in'`
Expected: `still-in`. **ROLLBACK if locked out:** OVH KVM console → `rm /etc/ssh/sshd_config.d/10-interlab-listen.conf && systemctl reload ssh`.

- [ ] **Step 6: Commit** `system-config/sshd/10-interlab-listen.conf` to repo.

---

### Task 1B.2: nftables INPUT ruleset [SERVER]

**Files:** Create `/etc/nftables.conf`; commit copy to repo `system-config/nftables.conf`.

- [ ] **Step 1: Write ruleset (inet family, IPv4+IPv6)**

Create `/etc/nftables.conf`:
```
#!/usr/sbin/nft -f
flush ruleset
table inet filter {
  chain input {
    type filter hook input priority 0; policy drop;
    iif "lo" accept
    ct state established,related accept
    iifname "tailscale0" accept
    ip saddr 100.64.0.0/10 accept          # Tailscale CGNAT range
    ip6 saddr fd7a:115c:a1e0::/48 accept    # Tailscale IPv6 ULA
    tcp dport { 80, 443 } accept            # public web (Coolify Traefik)
    tcp dport 2223 ip saddr 100.64.0.0/10 accept   # SSH only via Tailscale
    ip protocol icmp accept
    ip6 nexthdr icmpv6 accept
    limit rate 5/minute log prefix "nft-drop: " flags all counter
  }
  chain forward { type filter hook forward priority 0; policy accept; }  # Docker manages its own
  chain output  { type filter hook output  priority 0; policy accept; }
}
```

- [ ] **Step 2: Dry-run validate**

Run: `sudo nft -c -f /etc/nftables.conf && echo "ruleset OK"`
Expected: `ruleset OK` (syntax valid). **If error → fix before applying.**

- [ ] **Step 3: Apply + enable**

Run: `sudo nft -f /etc/nftables.conf && sudo systemctl enable --now nftables && sudo nft list ruleset | head -20`
Expected: ruleset loaded; INPUT policy drop with the accept rules.

- [ ] **Step 4: Verify access intact (CRITICAL)**

From laptop (Tailscale): `ssh -p 2223 zaky@100.117.214.25 'echo fw-ok'`. From a browser: `https://sibyl.bisikan.app` still loads (still on manual Traefik, 80/443 allowed).
Expected: `fw-ok` + Sibyl loads. **ROLLBACK if locked out:** OVH KVM → `sudo nft flush ruleset && sudo systemctl disable --now nftables`.

- [ ] **Step 5: Commit** `system-config/nftables.conf` to repo.

---

### Task 1B.3: DOCKER-USER ingress rules [SERVER]

**Files:** Create `/etc/iptables/rules.v4` + `rules.v6` (iptables-persistent); commit copies to repo.

- [ ] **Step 1: Pre-check — interim :8000 drop from 1A.1 present**

Run: `sudo iptables -S DOCKER-USER`
Expected: shows the interim 1A.1 `:8000` drop rule. We now formalize the full DOCKER-USER policy.

- [ ] **Step 2: Install persistence + write DOCKER-USER rules**

Run:
```bash
sudo apt-get install -y iptables-persistent
# Flush interim, set explicit policy: allow established + Tailscale; allow 80/443; drop other published-port ingress from non-Tailscale
sudo iptables -F DOCKER-USER
sudo iptables -A DOCKER-USER -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
sudo iptables -A DOCKER-USER -s 100.64.0.0/10 -j RETURN
sudo iptables -A DOCKER-USER -i tailscale0 -j RETURN
sudo iptables -A DOCKER-USER -p tcp -m multiport --dports 80,443 -j RETURN
# anything else hitting a published container port from the internet -> drop
sudo iptables -A DOCKER-USER -j DROP
# IPv6 mirror
sudo ip6tables -F DOCKER-USER
sudo ip6tables -A DOCKER-USER -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
sudo ip6tables -A DOCKER-USER -i tailscale0 -j RETURN
sudo ip6tables -A DOCKER-USER -p tcp -m multiport --dports 80,443 -j RETURN
sudo ip6tables -A DOCKER-USER -j DROP
```
Expected: rules applied (no error).

- [ ] **Step 3: Persist**

Run: `sudo netfilter-persistent save && ls -la /etc/iptables/rules.v4 /etc/iptables/rules.v6`
Expected: both rules files written.

- [ ] **Step 4: Verify — admin ports blocked publicly, 80/443 open**

From an OFF-Tailscale host (e.g., phone on cellular, Tailscale off): `curl --max-time 5 http://51.79.146.14:8000` → timeout/refused; `curl -I http://51.79.146.14:80` → reachable (redirect).
From Tailscale: `curl http://100.117.214.25:8000` → Coolify UI reachable.
Expected: :8000 blocked publicly, reachable via Tailscale; :80/:443 public.

- [ ] **Step 5: Commit** `system-config/iptables/rules.v4` + `rules.v6` to repo.

---

### Task 1B.4: Firewall verification gate [LAPTOP + SERVER]

**Files:** none (gate).

- [ ] **Step 1: Full access matrix check**

Verify + record in DEPLOYMENT-LOG: (a) SSH 2223 via Tailscale ✓, via public ✗; (b) :80/:443 public ✓; (c) Coolify :8000 via Tailscale ✓, public ✗; (d) Sibyl/Interlab routes still 200 (manual Traefik). 
Expected: all match. **This gate must pass before the cutover (1B.5+).** fail2ban re-scope (Traefik/Coolify logs) deferred to 1D.

---

### Task 1B.5: Cert preservation — transform acme.json into Coolify [SERVER]

**Files:** Read `/home/zaky/traefik/letsencrypt/acme.json`; write Coolify proxy acme.json.

- [ ] **Step 1: Discover Coolify proxy specifics + set `R_COOLIFY` (NTH-1, NTH-2)**

Run (robust across yaml/toml/cmd-args variants):
```bash
sudo ls -la /data/coolify/proxy/
# (a) resolver name — try config files, fall back to container Args
R_COOLIFY=$(sudo grep -rhoP 'certificatesResolvers\.\K[a-z0-9_-]+' /data/coolify/proxy/ 2>/dev/null | head -1)
[ -n "$R_COOLIFY" ] || R_COOLIFY=$(docker inspect coolify-proxy --format '{{range .Args}}{{println .}}{{end}}' | grep -oiP 'certificatesresolvers\.\K[a-z0-9_-]+' | head -1)
echo "R_COOLIFY=$R_COOLIFY"
# (b) acme.json path (expected /data/coolify/proxy/acme.json)
sudo grep -rhoP 'acme\.storage[=: ]+\K[^ "]+' /data/coolify/proxy/ 2>/dev/null | head -1
# (c) file-provider directory (expected /data/coolify/proxy/dynamic) — NTH-2
sudo grep -rhoP 'providers\.file\.directory[=: ]+\K[^ "]+' /data/coolify/proxy/ 2>/dev/null | head -1 \
  || docker inspect coolify-proxy --format '{{range .Args}}{{println .}}{{end}}' | grep -i 'providers.file'
```
Expected: `R_COOLIFY` non-empty (e.g. `letsencrypt`); acme.json path + file-provider dir confirmed. **RECORD `R_COOLIFY`, acme path, and dynamic dir in DEPLOYMENT-LOG — re-set `R_COOLIFY=<value>` at the top of each later step (shell state does NOT persist across steps).** If `R_COOLIFY` empty → inspect `docker inspect coolify-proxy` Args manually before proceeding.

- [ ] **Step 2: Stop Coolify proxy (so it doesn't write acme.json mid-transform)**

Run: `docker stop coolify-proxy 2>/dev/null; echo done`
Expected: proxy stopped (it's not on 80/443 anyway — manual Traefik still serving).

- [ ] **Step 3: Transform + install acme.json (rename resolver key — DYNAMIC, MF-1)**

Run (re-set `R_COOLIFY` to the value recorded in Step 1; uses `jq --arg`, NOT hardcoded):
```bash
R_COOLIFY=<value-from-Step-1>    # e.g. letsencrypt
sudo sh -c "jq --arg r \"$R_COOLIFY\" '{ (\$r): .myresolver }' /home/zaky/traefik/letsencrypt/acme.json > /data/coolify/proxy/acme.json"
sudo chmod 600 /data/coolify/proxy/acme.json
```
Expected: new acme.json top-level key = `$R_COOLIFY` (NOT hardcoded `letsencrypt`), containing the original Account + 8 Certificates. **If R_COOLIFY ≠ letsencrypt and you hardcode `letsencrypt`, Traefik silently won't load the certs → cutover fails mid-way.**

- [ ] **Step 4: Verify transformed store + KEY MATCHES resolver (MF-1)**

Run (re-set `R_COOLIFY` from Step 1):
```bash
R_COOLIFY=<value-from-Step-1>
sudo jq -r 'keys[]' /data/coolify/proxy/acme.json                                  # must equal $R_COOLIFY
sudo jq -r --arg r "$R_COOLIFY" '.[$r].Certificates[].domain.main' /data/coolify/proxy/acme.json
sudo jq --arg r "$R_COOLIFY" '.[$r].Certificates | length' /data/coolify/proxy/acme.json
```
Expected: top-level key **== `$R_COOLIFY`**; all 8 domains listed (incl. sibyl SANs); length `8`. **If key ≠ R_COOLIFY → re-run Step 3 with correct value (else certs won't load).** (Preserved certs valid until expiry; renewal via Coolify resolver when due.)

- [ ] **Step 5: Record** transform + cert count + resolver name in DEPLOYMENT-LOG. (Original `/home/zaky/traefik/letsencrypt/acme.json` **untouched** — rollback source.)

---

### Task 1B.6: File-provider bridge for legacy routes [SERVER]

**Files:** Create `/data/coolify/proxy/dynamic/legacy-bridge.yml`; commit copy to repo `coolify-resources/proxy/legacy-bridge.yml`.

- [ ] **Step 1: Discover legacy Docker networks**

Run: `for c in sibyl-frontend sibyl-api sibyl-minio interlab-app interlab-api interlab-minio; do echo -n "$c: "; docker inspect "$c" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'; done`
Expected: records the network names (e.g., `sibyl-ai-chatbot_default`, `interlabs-crm-demo_default`).

- [ ] **Step 2: Connect Coolify proxy to legacy networks**

Run (for each unique legacy network `NET` from Step 1): `docker network connect <NET> coolify-proxy`
Then verify: `docker inspect coolify-proxy --format '{{json .NetworkSettings.Networks}}' | tr ',' '\n' | grep -iE 'sibyl|interlab|coolify'`
Expected: coolify-proxy attached to legacy networks (so it can resolve `sibyl-frontend`, `interlab-app`, etc. by name). Legacy containers **untouched**.

- [ ] **Step 3: Write the dynamic file-provider config**

Create `/data/coolify/proxy/dynamic/legacy-bridge.yml` (resolver = `R_COOLIFY` from 1B.5; example `letsencrypt`):
```yaml
http:
  routers:
    legacy-sibyl-frontend:
      rule: "Host(`sibyl.bisikan.app`) || Host(`www.sibyl.bisikan.app`) || Host(`dashboard.sibyl.bisikan.app`)"
      entryPoints: [websecure]
      service: legacy-sibyl-frontend
      tls: { certResolver: letsencrypt }
    legacy-sibyl-api:
      rule: "Host(`api.sibyl.bisikan.app`)"
      entryPoints: [websecure]
      service: legacy-sibyl-api
      tls: { certResolver: letsencrypt }
    legacy-sibyl-storage:
      rule: "Host(`storage.sibyl.bisikan.app`)"
      entryPoints: [websecure]
      service: legacy-sibyl-minio-s3
      tls: { certResolver: letsencrypt }
    legacy-sibyl-s3console:
      rule: "Host(`s3-minio.sibyl.bisikan.app`)"
      entryPoints: [websecure]
      service: legacy-sibyl-minio-console
      tls: { certResolver: letsencrypt }
    legacy-interlab-app:
      rule: "Host(`app.interlab-portal.com`)"
      entryPoints: [websecure]
      service: legacy-interlab-app
      tls: { certResolver: letsencrypt }
    legacy-interlab-api:
      rule: "Host(`api.interlab-portal.com`)"
      entryPoints: [websecure]
      service: legacy-interlab-api
      tls: { certResolver: letsencrypt }
    legacy-interlab-storage:
      rule: "Host(`s3-storage.interlab-portal.com`)"
      entryPoints: [websecure]
      service: legacy-interlab-minio-s3
      tls: { certResolver: letsencrypt }
    legacy-interlab-s3console:
      rule: "Host(`s3-minio.interlab-portal.com`)"
      entryPoints: [websecure]
      service: legacy-interlab-minio-console
      tls: { certResolver: letsencrypt }
  services:
    legacy-sibyl-frontend:       { loadBalancer: { servers: [{ url: "http://sibyl-frontend:3000" }] } }
    legacy-sibyl-api:            { loadBalancer: { servers: [{ url: "http://sibyl-api:8000" }] } }
    legacy-sibyl-minio-s3:       { loadBalancer: { servers: [{ url: "http://sibyl-minio:9000" }] } }
    legacy-sibyl-minio-console:  { loadBalancer: { servers: [{ url: "http://sibyl-minio:9001" }] } }
    legacy-interlab-app:         { loadBalancer: { servers: [{ url: "http://interlab-app:3000" }] } }
    legacy-interlab-api:         { loadBalancer: { servers: [{ url: "http://interlab-api:4000" }] } }
    legacy-interlab-minio-s3:    { loadBalancer: { servers: [{ url: "http://interlab-minio:9000" }] } }
    legacy-interlab-minio-console:{ loadBalancer: { servers: [{ url: "http://interlab-minio:9001" }] } }
```
Write the file to the **file-provider directory discovered in 1B.5 Step 1** (expected `/data/coolify/proxy/dynamic/`). Adjust container ports if 1B.6 Step 1 discovery shows different exposed ports.

Then **substitute the resolver name dynamically (MF-2)** — the YAML above hardcodes `letsencrypt`; replace with the actual `R_COOLIFY`:
```bash
R_COOLIFY=<value-from-1B.5-Step-1>
sudo sed -i "s/certResolver: letsencrypt/certResolver: $R_COOLIFY/g" /data/coolify/proxy/dynamic/legacy-bridge.yml
```
⚠️ **If `R_COOLIFY` ≠ `letsencrypt`, ALL 8 router `certResolver` lines MUST be substituted before cutover, or the legacy certs won't load and the cutover silent-fails.**

- [ ] **Step 4: Validate YAML + resolver substitution count (MF-2)**

Run:
```bash
R_COOLIFY=<value-from-1B.5-Step-1>
python3 -c "import yaml; yaml.safe_load(open('/data/coolify/proxy/dynamic/legacy-bridge.yml')); print('yaml OK')"
grep -c "certResolver: $R_COOLIFY" /data/coolify/proxy/dynamic/legacy-bridge.yml   # must be 8
grep -c "certResolver: letsencrypt" /data/coolify/proxy/dynamic/legacy-bridge.yml  # must be 0 if R_COOLIFY != letsencrypt
```
Expected: `yaml OK`; `8` routers with `$R_COOLIFY`; no stale `letsencrypt` (when R_COOLIFY differs).

- [ ] **Step 5: Commit** `coolify-resources/proxy/legacy-bridge.yml` to repo.

---

### Task 1B.7: Pre-cutover validation (manual Traefik still serving) [SERVER]

**Files:** none.

- [ ] **Step 1: Confirm Coolify proxy config references the file provider + acme.json**

Run: `sudo grep -riE 'providers.file|acme.json|certificatesresolvers' /data/coolify/proxy/*.y*ml /data/coolify/proxy/docker-compose* 2>/dev/null`
Expected: file provider points at `dynamic/`; acme storage = `/data/coolify/proxy/acme.json`; resolver `R_COOLIFY` defined.

- [ ] **Step 2: Confirm manual Traefik STILL serving (no disruption yet)**

Run: `curl -sI -o /dev/null -w '%{http_code}\n' https://sibyl.bisikan.app https://app.interlab-portal.com`
Expected: `200`/`301` (we have NOT cut over yet).

- [ ] **Step 3: Final readiness checklist (record in DEPLOYMENT-LOG)**

Confirm: firewall verified (1B.4) · acme.json transformed with 8 certs (1B.5) · coolify-proxy on legacy networks (1B.6) · legacy-bridge.yml valid (1B.6) · manual Traefik container will be **stopped, NOT removed** (rollback source). 
**Proceed to 1B.8 only if all checked.**

---

### Task 1B.8: THE CUTOVER — atomic 80/443 switch [SERVER]

**Files:** none. **⚠️ This is the blackout moment. Target <30 min/domain; rollback <15 min ready (1B.10).**

- [ ] **Step 0: Pre-cutover config smoke test (NTH-3 — catch broken config BEFORE the switch)**

Start coolify-proxy WHILE manual Traefik still holds 80/443 (the proxy will fail to bind 80/443 — that specific error is EXPECTED; we only inspect for config-parse errors):
```bash
docker start coolify-proxy && sleep 6
docker logs coolify-proxy --tail 60 2>&1 | grep -iE 'error|fatal|cannot|invalid|parse' \
  | grep -viE 'address already in use|bind|EADDRINUSE'   # ignore the expected port-conflict
```
Expected: **NO** file-provider/YAML/acme/schema errors (only the ignorable port-in-use). Then stop it again so the atomic switch is clean: `docker stop coolify-proxy`.
**If config errors appear → fix legacy-bridge.yml / acme.json (1B.5–1B.6) and re-smoke. Do NOT proceed to the atomic switch with a broken config (would kill 80/443).**

- [ ] **Step 1: Stop manual Traefik (frees 80/443)**

Run: `docker stop traefik && ss -tlnp | grep -E ':80 |:443 ' || echo "80/443 now free"`
Expected: manual `traefik` stopped; 80/443 momentarily free. (Manual Traefik **not removed** — container + bind mounts intact for rollback.)

- [ ] **Step 2: Start Coolify proxy (binds 80/443 + loads bridge + certs)**

Run: `docker start coolify-proxy && sleep 5 && ss -tlnp | grep -E ':80 |:443 '`
Expected: `coolify-proxy` (Traefik) now bound to 80/443.

- [ ] **Step 3: Confirm Traefik loaded the bridge routers**

Run: `docker logs coolify-proxy --tail 40 2>&1 | grep -iE 'legacy-|error|acme' | head`
Expected: legacy routers loaded; no fatal errors; acme store read (no new cert requests for the 8 preserved domains).

---

### Task 1B.9: Post-cutover verification — Interlab canary → Sibyl [SERVER]

**Files:** none. **Atomic note:** the port switch served ALL legacy domains at once; this is a VERIFICATION ORDER (low-stakes Interlab first), with fast rollback if any critical route fails.

- [ ] **Step 1: CANARY — Interlab demo routes + cert**

Run:
```bash
for h in app.interlab-portal.com api.interlab-portal.com s3-storage.interlab-portal.com; do
  echo -n "$h: "; curl -sI -o /dev/null -w '%{http_code} cert-expiry=%{ssl_verify_result}\n' "https://$h"
done
echo | openssl s_client -connect app.interlab-portal.com:443 -servername app.interlab-portal.com 2>/dev/null | openssl x509 -noout -issuer -enddate
```
Expected: `200`/`301`; TLS verifies (issuer = Let's Encrypt, preserved cert, not a fresh self-signed). **If canary FAILS → ROLLBACK (1B.10) immediately — Sibyl users not yet affected beyond the brief switch.**

- [ ] **Step 2: Sibyl routes + cert (active users)**

Run:
```bash
for h in sibyl.bisikan.app www.sibyl.bisikan.app dashboard.sibyl.bisikan.app api.sibyl.bisikan.app storage.sibyl.bisikan.app; do
  echo -n "$h: "; curl -sI -o /dev/null -w '%{http_code}\n' "https://$h"
done
echo | openssl s_client -connect sibyl.bisikan.app:443 -servername sibyl.bisikan.app 2>/dev/null | openssl x509 -noout -enddate
```
Expected: all `200`/`301`/`401` (as appropriate); cert valid (preserved). **If Sibyl fails → ROLLBACK (1B.10).** Decision time-bound: 30 min/domain.

- [ ] **Step 3: Functional smoke (not just headers)**

Run: load `https://sibyl.bisikan.app` in browser (real page, not just curl); confirm Sibyl app functional (login page renders). Check `api.sibyl.bisikan.app` health endpoint if known.
Expected: Sibyl usable end-to-end.

- [ ] **Step 4: Record** per-domain result + cert issuer/expiry + blackout duration in DEPLOYMENT-LOG.

---

### Task 1B.10: Rollback procedure (<15 min) — REFERENCE [SERVER]

**Files:** none. **Read before 1B.8. Execute only on cutover failure.**

- [ ] **Step 1: Rollback command sequence**

```bash
docker stop coolify-proxy          # release 80/443
docker start traefik               # manual Traefik reclaims 80/443 (acme.json + labels intact)
sleep 5
curl -sI -o /dev/null -w '%{http_code}\n' https://sibyl.bisikan.app https://app.interlab-portal.com
```
Expected: legacy back to `200`/`301` on manual Traefik within minutes.

- [ ] **Step 2: Post-rollback**

Coolify proxy stays down. Disconnect coolify-proxy from legacy networks if desired (`docker network disconnect <NET> coolify-proxy`). Analyze failure offline (logs from 1B.8 Step 3). Do NOT retry cutover same-session under fatigue (spec discipline). Record in DEPLOYMENT-LOG.

> **Invariant:** manual Traefik container + `/home/zaky/traefik/letsencrypt/acme.json` are untouched until cutover is **stable 24h** — only then retire (separate task, post-1B).

---

### Task 1B.11: Bind admin consoles to Tailscale + finalize [SERVER]

**Files:** none (port-binding adjustments handled by firewall; this verifies).

- [ ] **Step 1: Confirm Coolify UI :8000 + MinIO console reachable only via Tailscale**

Run (Tailscale): `curl -sI -o /dev/null -w '%{http_code}\n' http://100.117.214.25:8000`; off-Tailscale: timeout. MinIO console (1A loopback :9101) → reach via Tailscale or `tailscale serve` if needed.
Expected: admin surfaces Tailscale-only (DOCKER-USER drop from 1B.3 enforces).

- [ ] **Step 2: fail2ban re-scope note**

Confirm sshd jail now effectively no-op (SSH Tailscale-only). Re-target to Traefik access log + Coolify auth log = deferred to Phase 1D (record as carried-over TODO).

- [ ] **Step 3: Cutover sign-off**

Record in DEPLOYMENT-LOG: cutover complete, all 8 legacy domains served by Coolify Traefik with preserved certs, host locked, rollback path validated, manual Traefik retained (retire after 24h stable).

---

## Self-Review (writing-plans)

**Spec coverage:** §10 1B → firewall+sshd (1B.1–1B.4), cert preserve (1B.5), file-bridge (1B.6), cutover (1B.8), canary→Sibyl (1B.9), rollback <15min (1B.10) ✓. §6 cert rename `myresolver`→resolver + rollback stop/start (manual not removed) ✓. §5 nftables inet + DOCKER-USER + SSH Tailscale-only + IPv6 ✓. §11 1B command-level rollback = 1B.10 ✓. §12 R2 mitigations (canary-first, <15min rollback, per-domain time-bound) ✓.

**Atomicity honesty:** documented that 80/443 switch is atomic (not partial); "canary" = verification order + fast rollback, not partial cutover. This corrects a naive reading of "canary→Sibyl."

**Placeholder scan:** `R_COOLIFY` / `<NET>` are verify-at-execute Coolify-specifics (Coolify not installed during planning) — each has a discovery step (1B.5 S1, 1B.6 S1), not hand-waves. acme transform uses real `jq`. Ports in bridge from spec §1 (re-confirm via 1B.6 S1 discovery).

**Consistency:** resolver `letsencrypt` (assumed) used consistently in 1B.5/1B.6 with verify-first; legacy service names/ports match spec §1 routes table; rollback references manual `traefik` container (stopped-not-removed) consistent with 1B.8.

**Deferred:** fail2ban re-scope + WAL rclone + Netdata/Sentry/Uptime/backup = Phase 1D; Supabase = 1C; manual-Traefik retirement = post-24h-stable (separate).

---

## Execution Handoff

**Plan saved to `docs/superpowers/plans/2026-05-25-phase1b-traefik-cutover.md`.**

> ⚠️ HIGHEST blast radius. Break-glass (OVH KVM) mandatory-armed. Per Path B, executed POST-demo with fresh energy. Subagent-driven execution: review gate between EVERY task is mandatory; never auto-proceed past the cutover (1B.8) or firewall (1B.1–1B.3).

**Next:** Phase **1C (Supabase, time-boxed)**, **1D (tools/ops + backup + fail2ban re-scope)**, **1E (verify/sign-off + handover)** — lower stakes, I can batch.
