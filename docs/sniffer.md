# Native Sniffer settings (m-ui fork)

This branch adds native Mihomo Sniffer to **Mihomo Settings -> Basics -> Sniffer**.

The settings are saved as `mihomoBasics.sniffer` inside m-ui's `state.json` and
emitted by `renderStateConfig` directly into generated `config.yaml`. No
post-generation config watcher or secondary service is required.

Supported options:

- Enable / disable Sniffer (disabled for legacy installations by default)
- HTTP (80 and 8080-8880), TLS (443 and 8443), QUIC (443 and 8443)
- Force DNS Mapping, Parse Pure IP, Override Destination

Default for newly enabled Sniffer: HTTP+TLS+QUIC, force DNS mapping and pure-IP
parsing enabled, override destination disabled. Ports match the official Mihomo
Sniffer example and can be extended in a future update.

Safety: disabled Sniffer does not emit any additional YAML block. Enabling
Sniffer with all protocols switched off is rejected. The existing outbound
and rule lists are not touched by these settings.

Verification:
- Run `go test ./internal/app/...`
- Run `go test ./...`
- Run `node --check web/mihomo-settings.js`
- Generate YAML and validate with the target Mihomo binary (`mihomo -t`).
- Back up state/config/binary before deploying to any target server and test using an authorized client.
