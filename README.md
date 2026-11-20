[English](/README.md) | [简体中文](/README.zh_CN.md) | [繁體中文](/README.zh_TW.md) | [日本語](/README.ja.md) | [Русский](/README.ru.md) | [فارسی](/README.fa.md) | [Tiếng Việt](/README.vi.md) | [Español](/README.es.md) | [Türkçe](/README.tr.md) | [Українська](/README.uk.md) | [Português (Brasil)](/README.pt_BR.md)

<p align="center">
  <img src="./media/m-ui_logo.png" alt="M-UI Fusion (original m-ui logo)" width="420">
</p>

# M-UI Fusion

> [!IMPORTANT]
> **This is the [Xenofan-git/M-UI-Fusion](https://github.com/Xenofan-git/M-UI-Fusion) variant of [RomanovCaesar/m-ui](https://github.com/RomanovCaesar/m-ui), based on upstream v0.3.3.**
> It adds **native Mihomo Sniffer** controls under **Mihomo Settings → Basics → Sniffer**, including HTTP, TLS, QUIC, DNS mapping, pure-IP parsing, and destination-override settings.
> These settings are saved in `state.json` and written directly to generated `config.yaml`; an external watchdog/patching service is **not** required. See [Sniffer documentation](docs/sniffer.md).
>
> **Install or update this fork:** See the [SSH install and upgrade guide (Russian)](docs/INSTALL.ru.md), download a [verified release](https://github.com/Xenofan-git/M-UI-Fusion/releases), or build from source. The fork's installer now downloads **our release** and verifies SHA-256; back up the live binary and state before updating.

**Separate Balancers tab:** Outbounds shows proxy nodes only. **Balancers** is available only within **Mihomo Settings → Balancers**, with manual group creation and a subscription-based group wizard and automatic node reconciliation. [Balancer guide (Russian)](docs/BALANCERS.ru.md).

**Inbound VPN node URL subscriptions:** Inside **Mihomo Settings → Balancers**, the **Add balancer from subscription** wizard imports provider nodes into Outbounds, supports Base64/share-links and Mihomo YAML, manual sync, optional group linking and scheduled updates. [Documentation (Russian)](docs/OUTBOUND-SUBSCRIPTIONS.ru.md).

## Quick SSH installation (Linux)

Connect to your Linux server from an authorized SSH client (replace `USER` and `SERVER_IP` with your own values):

```bash
ssh USER@SERVER_IP
```

Alternatively, if your server is accessible via Tailscale (replace `TAILSCALE_IP`):

```bash
ssh USER@TAILSCALE_IP
```

Then **on the Linux server** download, syntax-check, and run the M-UI Fusion installer:

```bash
curl -fL --retry 3 https://raw.githubusercontent.com/Xenofan-git/M-UI-Fusion/main/install.sh -o /tmp/m-ui-fusion-install.sh
bash -n /tmp/m-ui-fusion-install.sh
sudo bash /tmp/m-ui-fusion-install.sh --version v0.3.3-fusion.39 --no-ssl
```

For an existing installation, first back up the binary and state, then use:

```bash
sudo bash /tmp/m-ui-fusion-install.sh --update --version v0.3.3-fusion.39
sudo systemctl is-active m-ui
sudo /usr/local/m-ui/m-ui version
```

M-UI Fusion is not tied to a specific device. The installer detects the Linux architecture (including AMD64 and ARM64) and chooses unique credentials and a panel URL. Restrict access to trusted networks; `--no-ssl` is suitable only for protected LAN/VPN access. **Full backup, rollback, and upgrade steps:** [SSH guide in Russian](docs/INSTALL.ru.md).

## Build this fork

Use Go **1.26.10** or later with its required security fixes:

```bash
git clone https://github.com/Xenofan-git/M-UI-Fusion.git
cd M-UI-Fusion
# Go selects the target CPU architecture from the current machine.
# For cross-compilation, set GOARCH=arm64, GOARCH=amd64, etc.
GOOS=linux CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X main.version=v0.3.3-fusion.39" -o m-ui-linux-fusion .
```

GitHub Actions also runs tests and builds the ARM64 binary after each change to `main`. Production upgrade should only be performed after backing up `state.json`, `config.yaml`, and the currently installed binary and testing the new binary.

---

## M-UI Fusion features and documentation (based on m-ui)

# m-ui

[![Release](https://img.shields.io/github/v/release/Xenofan-git/M-UI-Fusion.svg)](https://github.com/Xenofan-git/M-UI-Fusion/releases)
[![Build](https://img.shields.io/github/actions/workflow/status/Xenofan-git/M-UI-Fusion/release.yml.svg)](https://github.com/Xenofan-git/M-UI-Fusion/actions)
[![Go Version](https://img.shields.io/github/go-mod/go-version/Xenofan-git/M-UI-Fusion.svg)](https://github.com/Xenofan-git/M-UI-Fusion/blob/main/go.mod)
[![Downloads](https://img.shields.io/github/downloads/Xenofan-git/M-UI-Fusion/total.svg)](https://github.com/Xenofan-git/M-UI-Fusion/releases/latest)
[![License](https://img.shields.io/github/license/Xenofan-git/M-UI-Fusion.svg)](https://github.com/Xenofan-git/M-UI-Fusion/blob/main/LICENSE)

A server management panel powered by [Mihomo](https://github.com/MetaCubeX/mihomo). Its workflow follows 3x-ui, its interface comes in three themes (shadcn by default, Material Design 3 and Apple's Liquid Glass), and its configuration model is Mihomo's native YAML. The panel is available in 11 languages.

> [!IMPORTANT]
> Use this project only on servers and networks that you own or are authorized to administer. Follow local law, upstream provider terms, and the policies of the services you access.

For complete documentation, visit the [m-ui Wiki](https://github.com/RomanovCaesar/m-ui/wiki). The [original m-ui Telegram channel](https://t.me/MihomoUI) belongs to the upstream project; M-UI Fusion updates are published in this repository.

<p align="center">
  <img src="./media/screenshots/en/inbounds.png" alt="Inbounds and clients" width="900">
</p>

## Features

**Panel and Mihomo**
* Dashboard with system, traffic, connection, and Mihomo status; Mihomo starts automatically with the panel
* Native Mihomo YAML generation and validation, raw configuration preview and download
* Mihomo version switching from official MetaCubeX releases, and GeoIP / GeoSite / MetaDB updates
* Full backup and restore: settings, inbounds, Multi-control identity (opt-in), cross-panel cache, subscription templates, and Multi-control client devices
* **Migrate from 3x-ui in one click:** import `x-ui.db` (v2.9.3–v3.10.2) or an Xray `config.json`; inbounds, clients with their quotas, expiry and traffic, outbounds, balancers, and routing rules are added next to what the panel already has, and a downloadable conversion log lists anything Mihomo cannot do
* Interface in English, Simplified Chinese, Traditional Chinese, Japanese, Russian, Persian, Vietnamese, Spanish, Turkish, Ukrainian, and Brazilian Portuguese

**Inbounds and clients**
* `mixed`, `socks`, `http`, `shadowsocks`, `snell`, `vmess`, `vless`, `trojan`, `hysteria2`, `tuic`, `anytls`, `mieru`, `sudoku`, `shadowquic`, `trusttunnel`, and `hysteria2-realm` listeners
* TLS, Reality, ShadowTLS, RestTLS, TLSMirror, JLS, Trojan SS, XHTTP, mKCP, Mekya, and obfuscation settings
* Per-client credentials, traffic quotas, expiry, traffic reset schedules, auto-renewal on expiry, and online state; inbound-level limits too
* Share links, QR codes, inbound import from Mihomo listener YAML, and bulk traffic reset

**Subscriptions**
* Browser subscription page with usage, quota, expiry, nodes, and one-click import into Clash Caesar
* **Subscription templates:** every subscription is a complete client profile built from the built-in China / Russia / Iran template or your own Mihomo template
* Full profiles for Mihomo/Clash, Stash, sing-box, Surge, Surfboard, Loon, Quantumult X, and Egern; node lists for V2Box, V2RayNG, Shadowrocket, and other share-link clients
* Per-user subscription tokens and an optional dedicated subscription port

**Mihomo Settings**
* Basics: routing mode, direct IP version, IPv6, TCP concurrency, statistics, logs, and basic routing
* Outbounds (including Snell, WireGuard, and OpenVPN) and policy groups, with a form editor, native YAML, and share-link conversion
* Ordered routing rules, including `AND` rules
* Cloudflare WARP outbounds and VPNGate residential exits by country and ISP

**Multi-control**
* Peer-to-peer panel network with signed identities and no master node
* Encrypted inbound synchronization between trusted panels
* Cross-panel subscription aggregation
* Client devices: [Clash Caesar](https://github.com/RomanovCaesar/clash-caesar) imports the network file, signs in once with the panel admin account, and can then see every panel and pull any panel's or the merged subscription through whichever panel it can reach

## Screenshots

<table>
  <tr><td width="50%"><img src="./media/screenshots/en/dashboard.png" alt="Overview"><br><sub>Overview</sub></td><td width="50%"><img src="./media/screenshots/en/client-edit.png" alt="Client: quota, expiry, traffic reset and auto-renewal"><br><sub>Client: quota, expiry, traffic reset and auto-renewal</sub></td></tr>
  <tr><td width="50%"><img src="./media/screenshots/en/outbounds.png" alt="Outbounds and proxy groups"><br><sub>Outbounds and proxy groups</sub></td><td width="50%"><img src="./media/screenshots/en/routing.png" alt="Routing rules"><br><sub>Routing rules</sub></td></tr>
  <tr><td width="50%"><img src="./media/screenshots/en/xray-import.png" alt="Import from Xray / 3x-ui"><br><sub>Import from Xray / 3x-ui</sub></td><td width="50%"><img src="./media/screenshots/en/theme-shadcn-dark.png" alt="shadcn theme, dark"><br><sub>shadcn theme, dark</sub></td></tr>
  <tr><td width="50%"><img src="./media/screenshots/en/theme-md3.png" alt="Material Design 3 theme"><br><sub>Material Design 3 theme</sub></td><td width="50%"><img src="./media/screenshots/en/theme-liquid.png" alt="Liquid Glass theme"><br><sub>Liquid Glass theme</sub></td></tr>
</table>

## Linux installation

Run as `root` on a Linux system using systemd or OpenRC:

```bash
curl -fL https://raw.githubusercontent.com/Xenofan-git/M-UI-Fusion/main/install.sh -o /tmp/m-ui-fusion-install.sh
bash -n /tmp/m-ui-fusion-install.sh
sudo bash /tmp/m-ui-fusion-install.sh --version v0.3.3-fusion.39 --no-ssl
```

The installer picks an unused five-digit panel port and generates a 16-character panel path, a 14-character username, and a 16-character password. It prints the access URL and credentials once at the end. You can set a fixed port; optionally add `--listen-ip SERVER_LOCAL_IP` after replacing the placeholder with an address assigned to your server:

```bash
sudo bash /tmp/m-ui-fusion-install.sh --version v0.3.3-fusion.39 --no-ssl \
  --port 34567
```

m-ui is installed under `/usr/local/m-ui`, with its data in `/usr/local/m-ui/data`. The installer also downloads a Mihomo core for the current architecture; an existing core is kept unless you pass `--update-mihomo`.

`m-ui update` upgrades m-ui and keeps all settings. Before updating, it snapshots the data directory into `data/backups/` and keeps the newest 3 snapshots.

Releases contain `m-ui-linux-<architecture>.tar.gz` for `386`, `amd64`, `arm64`, `armv5`, `armv6`, `armv7`, and `s390x`, plus `m-ui-windows-amd64.zip`.

## Docker

The Docker image targets Linux amd64 and contains m-ui plus a pinned, checksum-verified Mihomo core. The Compose file uses host networking, so inbound ports added in the panel work without extra port mappings.

```bash
git clone https://github.com/Xenofan-git/M-UI-Fusion.git
cd M-UI-Fusion
cp .env.example .env
docker compose up -d --build
docker compose logs m-ui
```

If `MUI_PASSWORD` and `MUI_PATH` are empty, the first start generates them and prints the URL and credentials once in the log. Releases publish `ghcr.io/xenofan-git/m-ui-fusion:<tag>` and `latest`; use `docker compose pull` instead of building when the image is available to you. Data lives in the `m-ui-data` and `m-ui-core` volumes; do not run `docker compose down -v` unless you want to delete it.

## TLS certificates

The first interactive installation offers a Let's Encrypt domain certificate, a short-lived Let's Encrypt IPv4 certificate, an existing certificate pair, or skipping TLS. After installation, run:

```bash
m-ui ssl
```

The menu can issue domain and IP certificates, use the Cloudflare DNS API for domain and wildcard certificates when port 80 is unavailable, renew, revoke, list, and apply an existing certificate pair. m-ui completes certificate files that contain only the leaf certificate, because clients such as Mihomo Party and FlClash reject them.

## Management commands

```text
m-ui                  interactive menu
m-ui start | stop | restart | status | logs
m-ui settings | configure | set-port
m-ui reset-credentials | reset-path
m-ui update | update-menu | ssl
m-ui enable | disable | clear-logs | uninstall
m-ui --lang <code>    menu language, e.g. m-ui --lang zh-cn
```

The menu speaks the same 11 languages as the panel and remembers your choice. The installer stays in English.

## Documentation

* [Installation](https://github.com/RomanovCaesar/m-ui/wiki/Installation) and [Panel Configuration](https://github.com/RomanovCaesar/m-ui/wiki/Configuration)
* [Migrating from 3x-ui](https://github.com/RomanovCaesar/m-ui/wiki/Migrating-from-3x-ui)
* [Inbounds and Clients](https://github.com/RomanovCaesar/m-ui/wiki/Inbounds) and [Mihomo Settings](https://github.com/RomanovCaesar/m-ui/wiki/Mihomo-Settings)
* [Subscriptions](https://github.com/RomanovCaesar/m-ui/wiki/Subscriptions) and [Subscription Templates](https://github.com/RomanovCaesar/m-ui/wiki/Subscription-Templates)
* [Multi-control](https://github.com/RomanovCaesar/m-ui/wiki/Multi-control), [Cloudflare WARP](https://github.com/RomanovCaesar/m-ui/wiki/Cloudflare-WARP), and [VPNGate](https://github.com/RomanovCaesar/m-ui/wiki/VPNGate)
* [Maintenance](https://github.com/RomanovCaesar/m-ui/wiki/Maintenance), [API](https://github.com/RomanovCaesar/m-ui/wiki/API), and [Common Questions](https://github.com/RomanovCaesar/m-ui/wiki/Common-questions-and-problems)

## Development

Run from source on Windows; the panel opens at `http://127.0.0.1:2053` with the account `admin` / `admin`:

```powershell
.\scripts\run.ps1
```

Build Windows and Linux amd64 binaries, or all release archives:

```powershell
.\scripts\build.ps1
.\scripts\build-release.ps1
```

Validate with `go test ./...` and `go vet ./...`. The version is injected with `-X main.version=...` from `MUI_VERSION` or the current Git tag. See [Development and Releases](https://github.com/RomanovCaesar/m-ui/wiki/Development) for the source layout and release flow, and [`LIQUID-GLASS.md`](LIQUID-GLASS.md) for the interface.

## Acknowledgements

* [MetaCubeX/mihomo](https://github.com/MetaCubeX/mihomo): the proxy core and configuration model
* [MHSanaei/3x-ui](https://github.com/MHSanaei/3x-ui): interface density and workflow
* [Sub-Store](https://github.com/sub-store-org/Sub-Store): reference behavior for client subscription formats
* [liquid-glass-webgl](https://github.com/martin65536/liquid-glass-webgl): the Liquid Glass controls (Apache-2.0, see [`NOTICE`](NOTICE))
* [Lucide](https://lucide.dev) and [Material Symbols](https://github.com/google/material-design-icons) icons, [Geist](https://github.com/vercel/geist-font) and [Roboto](https://github.com/googlefonts/roboto-classic) fonts: the shadcn and Material Design 3 themes (ISC, Apache-2.0 and OFL-1.1, see [`NOTICE`](NOTICE))

## License

m-ui is licensed under the [GNU General Public License version 3](LICENSE). The Mihomo sharing-link conversion code keeps its GPL-3.0 attribution in [`internal/mihomoconvert/NOTICE.md`](internal/mihomoconvert/NOTICE.md).
