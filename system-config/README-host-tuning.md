# Host Tuning — vps-lafayette-01 (Phase 0)

Config-as-code mirror of host-level state applied in Phase 0 (spec §4). The host
itself is the source of truth; these files reproduce it on a fresh OS (RECOVERY.md).

> **Environment:** Ubuntu 25.04 "plucky" · NVMe SSD (OVH panel-confirmed) · DC = Singapore (os-sgp2) · Docker iptables-nft · NOPASSWD sudo for `zaky`.

## File-backed configs (in this dir)
| Repo file | Deploy target | Apply |
|---|---|---|
| `sysctl.d/99-interlab.conf` | `/etc/sysctl.d/99-interlab.conf` | `sudo sysctl --system` |
| `disable-thp.service` | `/etc/systemd/system/disable-thp.service` | `daemon-reload && enable --now` |
| `docker-daemon.json` | `/etc/docker/daemon.json` | `sudo systemctl reload docker` (NOT restart) |
| `journald.conf.d/99-interlab.conf` | `/etc/systemd/journald.conf.d/99-interlab.conf` | `sudo systemctl restart systemd-journald` |

## Host state NOT file-backed (apply manually on recovery)
- **Swap (Task 0.6):** `sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`; fstab line: `/swapfile none swap sw 0 0`.
- **noatime (Task 0.9):** root fstab line `LABEL=cloudimg-rootfs / ext4 discard,commit=30,errors=remount-ro,noatime 0 1`; live: `sudo mount -o remount,noatime /`.
- **NOPASSWD sudo:** `/etc/sudoers.d/zaky-nopasswd` (solo-operator trade-off; revisit Phase 1.5 for per-binary granularity).
- **Break-glass:** root password SET (Bitwarden: "vps-lafayette-01 root — break-glass"); KVM console = OVH panel.

## Deviations from plan (see DEPLOYMENT-LOG)
1. Secrets: **Pilihan B** (Coolify-native env), SOPS dropped.
2. apt mirror = `nova.clouds.archive.ubuntu.com` (not `archive.ubuntu.com`); `plucky` still served, no EOL repoint needed yet.
3. DC = Singapore os-sgp2 (spec §0 said BHS/Canada).
4. Legacy container count = 13 (8 sibyl + 5 interlab; spec §1 said 7 sibyl).
5. journald caps via `.conf.d` drop-in (not main-file edit).
6. THP unit uses `RemainAfterExit=yes` (state reads "active" when applied).
