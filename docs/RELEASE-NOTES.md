## M-UI Fusion — native Mihomo Sniffer fork

**Update v0.3.3-fusion.2:** the duplicate Balancers entry has been removed from the sidebar. The **Mihomo Settings → Балансировщики** tab remains fully functional with its existing groups, subscription selection, and automated membership synchronization. This update changes navigation only; runtime routing and state format are unchanged.

**First release under the M-UI Fusion name — v0.3.3-fusion.1.**
The GitHub repository is now [Xenofan-git/M-UI-Fusion](https://github.com/Xenofan-git/M-UI-Fusion).
The Linux service, CLI command, installation data directory and binary archive names remain m-ui for backward compatibility.
The new primary Docker image is ghcr.io/xenofan-git/m-ui-fusion, with the previous m-ui-sniffer image alias still published for existing users.
Sniffer, inbound VPN subscriptions, auto-refresh, Balancers and routing are all retained.

Based on [RomanovCaesar/m-ui v0.3.3](https://github.com/RomanovCaesar/m-ui/releases/tag/v0.3.3), with native configurable Sniffer for HTTP, TLS and QUIC, `force-dns-mapping`, `parse-pure-ip`, and `override-destination`.

- **New in v0.3.3-sniffer.3:** a dedicated **Balancers** sidebar entry and separate Mihomo tab. The Outbounds page lists individual nodes only; every balancer can link multiple provider subscriptions, with automatic membership reconciliation on subscription refresh. Existing group names, policies, manual members, and routing rule references stay unchanged. [Balancer guide (Russian)](https://github.com/Xenofan-git/M-UI-Fusion/blob/main/docs/BALANCERS.ru.md).
- **New in v0.3.3-sniffer.2:** a separate **Subscriptions** sidebar page to import remote VPN node lists into managed Outbounds. Supports Mihomo/Clash YAML, plain share links, and Base64-encoded lists, with manual and scheduled refresh (5–10080 minutes), optional proxy-group linking, stable node identities, and failure-safe updates.
- Scheduled imports validate candidate configurations using the installed Mihomo core and apply them through its local controller when available; a normal core restart is the fallback. The downloader blocks local/private IP destinations and limits size and redirects. See [Subscription management (Russian)](https://github.com/Xenofan-git/M-UI-Fusion/blob/main/docs/OUTBOUND-SUBSCRIPTIONS.ru.md).
- The panel saves Sniffer settings under `mihomoBasics.sniffer` in `state.json` and emits native Mihomo YAML. A post-generation watcher is **not** required.
- Existing routing rules, proxy groups, SOCKS listeners, and Mihomo core are preserved when updating using `--update`.
- Linux ARM64 and other supported platforms are available as release assets. Verify the archive against `SHA256SUMS` (required by the fork's installer).
- The fork's installer and `m-ui update` use **Xenofan-git/M-UI-Fusion**, not the upstream binary.

### Install and upgrade over SSH

See [installation instructions in Russian](https://github.com/Xenofan-git/M-UI-Fusion/blob/main/docs/INSTALL.ru.md) for SSH login, first installation, safe updates, backup, verification, and rollback. Use the version tag shown on this release; do not download the original m-ui installer for this fork.

**Security:** The panel contains admin credentials, routing settings, and subscriptions. Keep access restricted to trusted networks and back up state before upgrading. Release assets contain software only, never runtime credentials from any server.
