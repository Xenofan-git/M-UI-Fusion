# M-UI Fusion 1.0.0 — complete SSH installation and upgrade guide

Project: [Xenofan-git/M-UI-Fusion](https://github.com/Xenofan-git/M-UI-Fusion), a modified fork of [RomanovCaesar/m-ui](https://github.com/RomanovCaesar/m-ui). These commands install the **Fusion fork**, not the original m-ui. [Русская инструкция](INSTALL.ru.md) · [Release notes](RELEASE-NOTES.md).

## 1. Requirements

- A Linux VPS, desktop, mini-PC, ARM board or other Linux device with **systemd or OpenRC** and a working SSH server; this guide does not require a particular hardware model.
- Supported installer architectures: amd64 (x86_64), arm64 (aarch64), 386, armv5, armv6, armv7 and s390x. The release also offers a separate Windows amd64 ZIP; Docker release images are Linux amd64.
- An authorized user who can run sudo or a root shell. If your user cannot use sudo, obtain authorized administrative access before installing.
- GitHub access for downloading the installer, official release and (when needed) Mihomo; supported package manager for missing dependencies.

Run the SSH examples **on your own laptop/PC/phone SSH client**. Run all installation and system commands **after you connect to the target Linux device**.

## 2. Connect via SSH

Replace placeholders with the actual login, host/IP and port of *your* device:

~~~bash
ssh USER@SERVER_IP
ssh -p SSH_PORT USER@SERVER_IP                # custom SSH port, if used
ssh -i ~/.ssh/YOUR_PRIVATE_KEY USER@SERVER_IP # key-based login, if configured
ssh -J JUMP_USER@JUMP_HOST USER@PRIVATE_LINUX_IP  # through an authorized jump host
~~~

The jump-host example assumes the jump host can reach your private Linux device and your SSH permissions allow it. Do not copy another system's SSH keys, and do not enable public SSH access solely for this installation.

On the target:

~~~bash
uname -s
uname -m
cat /etc/os-release
command -v systemctl || command -v rc-service
sudo -v
~~~

For OpenRC-based devices, use rc-service/rc-update instead of systemctl commands later in this guide.

## 3. Download and examine the installer

~~~bash
curl -fL --retry 3 \
  https://raw.githubusercontent.com/Xenofan-git/M-UI-Fusion/main/install.sh \
  -o /tmp/m-ui-fusion-install.sh
bash -n /tmp/m-ui-fusion-install.sh
less /tmp/m-ui-fusion-install.sh
~~~

Exit the viewer with q. For help:

~~~bash
bash /tmp/m-ui-fusion-install.sh --help
~~~

The installer recognizes the device architecture, fetches a corresponding M-UI Fusion release archive, checks its SHA-256 against the official release SHA256SUMS, installs the Mihomo core if absent, configures the panel and sets up the systemd/OpenRC service.

## 4. Fresh installation — private SSH access (recommended)

This example keeps the administration interface on device loopback; it will not become publicly accessible just because it was installed:

~~~bash
sudo bash /tmp/m-ui-fusion-install.sh \
  --version v1.0.1 --listen-ip 127.0.0.1 --port 34567 --no-ssl
~~~

Select another unused port if 34567 is taken. The installer also supports a random port (omit --port). It generates a unique panel path, username and password and prints them **at the end**. Save the full URL/path and credentials to a secure place. The program files are installed under /usr/local/m-ui and the state under /usr/local/m-ui/data.

From a **second terminal on your personal computer**, not from the device itself:

~~~bash
ssh -N -L 127.0.0.1:34567:127.0.0.1:34567 USER@SERVER_IP
~~~

If your SSH server uses a different port, add -p SSH_PORT to this command as well. Leave the tunnel running and navigate to **http://127.0.0.1:34567/YOUR_PANEL_PATH** in your local browser (use the exact panel path printed by the installer).

**Alternative: trusted LAN.** To allow LAN clients to open the panel directly, replace --listen-ip 127.0.0.1 with --listen-ip SERVER_LAN_IP (the actual local interface address). Restrict that port with firewall and network rules. Do not expose an HTTP-only admin panel publicly.

## 5. HTTPS and optional installation parameters

For externally accessible administration, use HTTPS and firewall/access controls before opening the panel port:

~~~bash
sudo m-ui ssl
~~~

The menu supports certificate setup, including a domain via Let's Encrypt or an existing certificate/key pair. For Let's Encrypt HTTP validation, domain DNS and external port-80 reachability must be configured; when these are unavailable, prefer a private tunnel or another supported certificate method.

Other installer options (use only as needed):

~~~bash
# Choose your own panel port and local IP during first install:
sudo bash /tmp/m-ui-fusion-install.sh --version v1.0.1 \
  --port 34567 --listen-ip SERVER_LAN_IP --no-ssl

# Install and request a domain certificate, where DNS/ACME are prepared:
sudo bash /tmp/m-ui-fusion-install.sh --version v1.0.1 \
  --ssl-domain panel.example.com
~~~

Do not put passwords directly in public shell history or shared installation logs. By default the script generates credentials.

## 6. Verify the installation

On a systemd device:

~~~bash
sudo /usr/local/m-ui/m-ui version
sudo m-ui status
sudo systemctl is-active m-ui
sudo systemctl is-enabled m-ui
sudo journalctl -u m-ui -n 40 --no-pager
~~~

On OpenRC:

~~~bash
sudo /usr/local/m-ui/m-ui version
sudo rc-service m-ui status
sudo rc-update show
~~~

Expected panel version: **v1.0.1**. The service should be running. The installed proxy inbounds are configured separately in Mihomo Settings; simply installing the panel does **not** create an open proxy port. Check the relevant firewall configuration before connecting client devices.

## 7. Updating an existing m-ui or M-UI Fusion installation

First plan a short downtime and make a **separate backup**. For a standard systemd installation, stop the service before copying state to avoid inconsistent snapshots:

~~~bash
sudo systemctl stop m-ui
sudo bash -c '
  set -e
  dir="/root/m-ui-backup-$(date +%Y%m%d-%H%M%S)"
  install -d -m 700 "$dir"
  cp -p /usr/local/m-ui/m-ui \
    /usr/local/m-ui/data/state.json \
    /usr/local/m-ui/data/config.yaml "$dir/"
  (cd "$dir" && sha256sum m-ui state.json config.yaml > SHA256SUMS)
  echo "Backup: $dir"
'
sudo systemctl start m-ui
~~~

For OpenRC substitute sudo rc-service m-ui stop/start. Store the printed backup directory path, and check that it contains the files before upgrading. These configuration files may contain credentials and subscription tokens; do not upload them to GitHub, share screenshots of them, or place them in public logs.

With the installer already downloaded (or download a fresh copy using step 3):

~~~bash
sudo bash /tmp/m-ui-fusion-install.sh --update --version v1.0.1
sudo /usr/local/m-ui/m-ui version
sudo m-ui status
~~~

The updater keeps the existing panel state and, by default, the installed Mihomo binary. It creates an additional timestamped snapshot under /usr/local/m-ui/data/backups/ **when possible**, retaining the latest three by default. It may continue with a warning if automatic snapshot creation fails, which is why the separate verified backup matters. To update Mihomo too, explicitly opt in with --update-mihomo.

Verify the panel login, proxy inbounds, configured outbounds, subscription sync, balancers and routing rules after upgrading.

## 8. Roll back if a new version has problems

Use the **real** backup directory printed in step 7, not a sample date. Restoring state and config reverts subsequent panel changes. Example for systemd, after replacing BACKUP_PATH with your actual directory:

~~~bash
sudo systemctl stop m-ui
sudo cp -p BACKUP_PATH/m-ui /usr/local/m-ui/m-ui
sudo cp -p BACKUP_PATH/state.json /usr/local/m-ui/data/state.json
sudo cp -p BACKUP_PATH/config.yaml /usr/local/m-ui/data/config.yaml
sudo systemctl start m-ui
sudo /usr/local/m-ui/m-ui version
sudo systemctl status m-ui --no-pager
~~~

For OpenRC use rc-service stop/start instead. Never restore a backup from a different host without checking compatibility and its secrets.

## 9. Troubleshooting and additional resources

- If SSH fails, verify address, port, credentials, key permissions and network routing. A failure of a particular SSH tunnel does not imply the Linux device is offline.
- If installation fails, check the SSH session output, GitHub availability and the active init system. Use **sudo m-ui logs** or **sudo journalctl -u m-ui -n 80 --no-pager**.
- If the panel does not open, verify the installed **listen IP**, actual port, generated URL path, browser URL, SSH port forwarding and firewall. Do not guess a port or publicly open the firewall as a first diagnostic step.
- For offline or protected-network deployment, review the installer help for local-binary options; do not bypass checksum verification of a downloaded release.
- [Official v1.0.1 release](https://github.com/Xenofan-git/M-UI-Fusion/releases/tag/v1.0.1) · [Russian guide](INSTALL.ru.md) · [Native Sniffer](sniffer.md) · [Balancer guide](BALANCERS.ru.md) · [Routing categories](ROUTING-LISTS.ru.md) · [Original m-ui](https://github.com/RomanovCaesar/m-ui).
