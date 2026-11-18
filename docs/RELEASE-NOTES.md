## M-UI-sniffer — native Mihomo Sniffer fork

Based on [RomanovCaesar/m-ui v0.3.3](https://github.com/RomanovCaesar/m-ui/releases/tag/v0.3.3), with native configurable Sniffer for HTTP, TLS and QUIC, `force-dns-mapping`, `parse-pure-ip`, and `override-destination`.

- The panel saves Sniffer settings under `mihomoBasics.sniffer` in `state.json` and emits native Mihomo YAML. A post-generation watcher is **not** required.
- Existing routing rules, proxy groups, SOCKS listeners, and Mihomo core are preserved when updating using `--update`.
- Linux ARM64 and other supported platforms are available as release assets. Verify the archive against `SHA256SUMS` (required by the fork's installer).
- The fork's installer and `m-ui update` use **Xenofan-git/M-UI-sniffer**, not the upstream binary.

### Install and upgrade over SSH

See [installation instructions in Russian](https://github.com/Xenofan-git/M-UI-sniffer/blob/main/docs/INSTALL.ru.md) for SSH login, first installation, safe updates, backup, verification, and rollback. Use the version tag shown on this release; do not download the original m-ui installer for this fork.

**Security:** The panel contains admin credentials, routing settings, and subscriptions. Keep access restricted to trusted networks and back up state before upgrading. Release assets contain software only, never runtime credentials from any server.
