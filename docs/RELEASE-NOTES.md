# M-UI Fusion 1.0.0 — First Official Release / Первый официальный выпуск

**English first · Русская версия ниже.**

An enhanced fork of [RomanovCaesar/m-ui v0.3.3](https://github.com/RomanovCaesar/m-ui/releases/tag/v0.3.3), powered by [Mihomo](https://github.com/MetaCubeX/mihomo). **v1.0.0 is the first official release**. It includes the approved emerald cat and reduced logo sizes.

## English

### Final visual refinements included in v1.0.0
- **Emerald mascot (#009B77):** replaced the turquoise cat with the user's selected final emerald version in the login screen, navigation/sidebar, Apple touch icon, and browser favicon. Removed background and vertical stripes; preserved clear eyes, mouth, shape and neon outline.
- The panel uses transparent 192×192 PNG and favicon uses 64×64 PNG. Display sizes reduced by 20% (login: 96→77 px, sidebar: 60→48 px, collapsed sidebar: 42→34 px); underlying artwork, favicon and cache URLs are unchanged. No changes to Mihomo, authentication, subscriptions, routing or network settings.


### Changes compared with the original m-ui v0.3.3

1. **Native Mihomo Sniffer.** Added HTTP/TLS/QUIC sniffing controls (DNS mapping, pure-IP parsing, destination override) in Mihomo Basics. These settings are stored in panel state and rendered into Mihomo YAML without a separate config-patching service.
2. **Outbound subscriptions and two kinds of balancers.** Added provider-node imports, manual/scheduled updates, filters and status probes. **Balancers from Subscriptions** update members automatically; **Balancers from Outbounds** contain only manually selected outbounds. The editor displays current node, search, ping and latency. New manual URL-test groups default to https://www.gstatic.com/generate_204, 180-second interval, 8000-ms timeout, 100-ms tolerance, UDP enabled; all are editable.
3. **Simpler routing editor.** Separate multiline fields for GeoSite/GeoIP categories and domains/IPs, searchable installed-category picker, and preservation of advanced rule types and existing AND/GEOIP/MATCH routing order.
4. **UI and localization.** Improved Russian translations, login and navigation, balancer separation, Light/Graphite/Ivory/Emerald/Aurora color choices on top of the original shadcn, Material 3 and Liquid Glass layouts, plus a transparent emerald cat logo and favicon.
5. **Distribution.** Fork-specific installer, SHA-256 verification of downloaded release archives, update backups, CI tests, Linux builds including ARM64, amd64 Docker image, and conventional version numbering starting at 1.0.0.

**Inherited, not newly invented:** the original m-ui dashboard, Mihomo inbound protocols/clients, YAML configuration, basic outbounds/routing, 3x-ui/Xray import, subscription profiles, Multi-control and 11-language base UI.

### Install via SSH — generic Linux host (VPS, mini PC, ARM board, etc.)

**Requirements:** a Linux device with systemd or OpenRC, an authorized sudo/root account, and access to GitHub. Supported Linux architectures include amd64, arm64, 386, armv5/6/7 and s390x. **Run SSH on your computer; run installer commands on the device after connecting.** Windows ZIP and Docker use separate installation paths.

**1. Connect over SSH** (replace placeholders, do not copy any sample address literally):

~~~bash
ssh USER@SERVER_IP
# Optional: custom SSH port
ssh -p SSH_PORT USER@SERVER_IP
# Optional: through an authorized jump host
ssh -J JUMP_USER@JUMP_HOST USER@PRIVATE_LINUX_IP
~~~

Check the device:

~~~bash
uname -s
uname -m
cat /etc/os-release
command -v systemctl || command -v rc-service
~~~

**2. Download and inspect the Fusion installer on the Linux device:**

~~~bash
curl -fL --retry 3 \
  https://raw.githubusercontent.com/Xenofan-git/M-UI-Fusion/main/install.sh \
  -o /tmp/m-ui-fusion-install.sh
bash -n /tmp/m-ui-fusion-install.sh
less /tmp/m-ui-fusion-install.sh
~~~

The script selects the matching Linux release, checks its archive using the published SHA256SUMS, and installs Mihomo when needed.

**3. Fresh installation — recommended private SSH-tunnel mode:**

~~~bash
sudo bash /tmp/m-ui-fusion-install.sh \
  --version v1.0.0 --listen-ip 127.0.0.1 --port 34567 --no-ssl
~~~

Choose another free port if 34567 is already in use. **Save the generated panel URL path, username and password.** No NanoPi-specific paths, IPs or keys are used. This mode keeps the HTTP panel bound to the device loopback rather than exposing it publicly.

**4. Access the panel from your computer.** Open a **second terminal locally**, not on the Linux device:

~~~bash
ssh -N -L 127.0.0.1:34567:127.0.0.1:34567 USER@SERVER_IP
~~~

Navigate to **http://127.0.0.1:34567/YOUR_PANEL_PATH** (substitute the exact path printed by the installer). Keep the SSH tunnel running while connected. For a trusted private LAN, install with --listen-ip SERVER_LAN_IP and enforce firewall rules instead. **Do not expose an HTTP-only admin panel to the public internet.**

**5. Verify and configure security:**

~~~bash
sudo /usr/local/m-ui/m-ui version
sudo m-ui status
sudo systemctl is-active m-ui
sudo systemctl is-enabled m-ui
sudo journalctl -u m-ui -n 40 --no-pager
# On OpenRC: sudo rc-service m-ui status
~~~

For internet-facing access, configure HTTPS, network/firewall restrictions and strong credentials before opening access. Run **sudo m-ui ssl** for the certificate menu. Domain certificate issuance requires working DNS and ACME reachability.

**6. Updating an existing installation:** first back up the panel executable, state.json and config.yaml. These data files contain secrets and must never be published. For **systemd**, take a consistent backup during a brief maintenance interruption:

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

Then upgrade (reuse the downloaded installer; never use --no-backup unless you explicitly accept the risk):

~~~bash
sudo bash /tmp/m-ui-fusion-install.sh --update --version v1.0.0
sudo /usr/local/m-ui/m-ui version
sudo m-ui status
~~~

The installer preserves existing state and the installed Mihomo binary unless --update-mihomo is specified, and attempts an additional snapshot in /usr/local/m-ui/data/backups/. Verify inbounds, outbounds, rules, subscriptions and balancers afterward. **Rollback:** stop m-ui, restore the binary and both data files from the actual backup directory, then start the service. See the detailed guide.

**Guides:** [Full English SSH installation and rollback](https://github.com/Xenofan-git/M-UI-Fusion/blob/main/docs/INSTALL.en.md) · [Инструкция на русском](https://github.com/Xenofan-git/M-UI-Fusion/blob/main/docs/INSTALL.ru.md) · [Development history before 1.0.0](https://github.com/Xenofan-git/M-UI-Fusion/blob/main/docs/DEVELOPMENT-HISTORY.md).

---

## Русский

### Последние изменения оформления, включённые в v1.0.0
- **Изумрудный котик (#009B77):** последний утверждённый вариант установлен для входа, бокового меню, значка Apple Touch и favicon. Чёрный фон и вертикальные полосы удалены, форма, глаза, рот и неоновая обводка сохранены.
- Прозрачные PNG для панели (192×192) и favicon (64×64). Размер изображения при отображении уменьшен на 20%: вход 96→77 px, боковое меню 60→48 px, свёрнутое меню 42→34 px. Сам рисунок, favicon и ссылки кэша не изменены. Mihomo, авторизация, подписки, маршрутизация и сетевые настройки не затронуты.


**M-UI Fusion 1.0.0** — первый официальный выпуск самостоятельного расширения [оригинального m-ui v0.3.3](https://github.com/RomanovCaesar/m-ui/releases/tag/v0.3.3) на базе Mihomo. Все последние изменения оформления включены непосредственно в 1.0.0. Маршрутизация не менялась.

### Что добавлено и изменено по сравнению с исходником

1. **Встроенный Sniffer Mihomo.** Добавлены параметры HTTP/TLS/QUIC, DNS Mapping, Parse Pure IP и Override Destination в основных настройках Mihomo. Параметры хранятся в состоянии панели и записываются в YAML без дополнительной фоновой службы.
2. **Подписки исходящих и два вида балансировщиков.** Добавлены импорт узлов провайдеров, ручное/плановое обновление, фильтры, проверка состояния. **«Балансировщики из Подписок»** автоматически получают узлы; **«Балансировщики из Исходящих»** собираются вручную без подписок. В редакторе появились текущий узел, поиск, пинг и задержка. Новая обычная группа URL-тест по умолчанию: https://www.gstatic.com/generate_204, интервал 180 секунд, тайм-аут 8000 мс, допуск 100 мс, UDP включён; параметры редактируются.
3. **Упрощённые правила маршрутизации.** Два отдельных списка для категорий GeoSite/GeoIP и доменов/IP, поиск по установленным категориям; сохранены расширенные типы правил и приоритет существующих AND/GEOIP/MATCH.
4. **Интерфейс и переводы.** Исправлен русский текст, улучшены вход, меню и вкладки; добавлены светлая, графитовая, «Слоновая кость», изумрудная и «Аврора» при сохранении исходных стилей shadcn, Material 3 и Liquid Glass; обновлён прозрачный изумрудный котик и favicon.
5. **Публикация и установка.** Собственный установщик форка, проверка SHA-256 архивов, резервные копии при обновлении, CI-тесты, Linux-сборки (включая ARM64), Docker AMD64 и официальная нумерация с 1.0.0.

**Унаследовано от исходного m-ui (не наши новые функции):** Dashboard, входящие и клиенты Mihomo, генерация YAML, основные исходящие и маршрутизация, импорт 3x-ui/Xray, клиентские профили подписок, Multi-control и базовый интерфейс на 11 языках.

### Установка по SSH — на любом поддерживаемом Linux-устройстве

**Требования:** Linux с systemd или OpenRC, пользователь с sudo/root, доступ к GitHub. Архитектуры Linux: amd64, arm64, 386, armv5/6/7, s390x. **SSH выполняем на своём компьютере, команды установки — после входа на устройство.** Для Windows и Docker отдельные варианты установки.

**1. Подключитесь к устройству** (замените обозначения собственными данными):

~~~bash
ssh USER@SERVER_IP
# Если порт SSH нестандартный:
ssh -p SSH_PORT USER@SERVER_IP
# Через промежуточный SSH-сервер:
ssh -J JUMP_USER@JUMP_HOST USER@PRIVATE_LINUX_IP
~~~

Проверьте систему:

~~~bash
uname -s
uname -m
cat /etc/os-release
command -v systemctl || command -v rc-service
~~~

**2. Скачайте и проверьте установщик именно M-UI Fusion на целевом Linux:**

~~~bash
curl -fL --retry 3 \
  https://raw.githubusercontent.com/Xenofan-git/M-UI-Fusion/main/install.sh \
  -o /tmp/m-ui-fusion-install.sh
bash -n /tmp/m-ui-fusion-install.sh
less /tmp/m-ui-fusion-install.sh
~~~

Скрипт выбирает архив под архитектуру устройства, проверяет SHA256SUMS и при необходимости устанавливает Mihomo.

**3. Первая установка — рекомендуемый режим через защищённый SSH-туннель:**

~~~bash
sudo bash /tmp/m-ui-fusion-install.sh \
  --version v1.0.0 --listen-ip 127.0.0.1 --port 34567 --no-ssl
~~~

Если порт 34567 занят, выберите другой свободный. **Запишите путь панели, логин и пароль, которые выведет установщик.** Привязки к NanoPi, определённым IP-адресам или ключам нет. При таком варианте HTTP-панель слушает только локальный интерфейс устройства.

**4. Откройте панель на своём компьютере.** Запустите во **втором локальном терминале**:

~~~bash
ssh -N -L 127.0.0.1:34567:127.0.0.1:34567 USER@SERVER_IP
~~~

Адрес в браузере: **http://127.0.0.1:34567/ВАШ_ПУТЬ_ПАНЕЛИ** (точный путь будет выведен установщиком). SSH-туннель должен оставаться открытым. Для доступа по доверенной локальной сети можно вместо этого выбрать --listen-ip SERVER_LAN_IP и ограничить доступ файрволом. **Не публикуйте HTTP-панель в открытом интернете.**

**5. Проверка работы и настройка защиты:**

~~~bash
sudo /usr/local/m-ui/m-ui version
sudo m-ui status
sudo systemctl is-active m-ui
sudo systemctl is-enabled m-ui
sudo journalctl -u m-ui -n 40 --no-pager
# Для OpenRC: sudo rc-service m-ui status
~~~

Если нужен внешний доступ, до открытия порта настройте HTTPS, ограничение доступа и надёжные учётные данные. Меню сертификатов: **sudo m-ui ssl**. Для выпуска сертификата домена нужны рабочие DNS-записи и доступность ACME.

**6. Обновление существующей панели:** заранее сделайте отдельную резервную копию бинарника, state.json и config.yaml; в данных содержатся секреты. Для **systemd** пример копирования при краткой остановке службы:

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

Затем обновите панель (не применяйте --no-backup без необходимости):

~~~bash
sudo bash /tmp/m-ui-fusion-install.sh --update --version v1.0.0
sudo /usr/local/m-ui/m-ui version
sudo m-ui status
~~~

Существующие данные и ядро Mihomo сохраняются, если не задан параметр --update-mihomo. Установщик также пытается сделать снимок в /usr/local/m-ui/data/backups/. После обновления проверьте входящие, исходящие, маршрутизацию, подписки и балансировщики. **Откат:** остановите m-ui, восстановите бинарник и оба файла данных из реальной резервной копии и снова запустите службу. Подробности — в полной инструкции.

**Документация:** [Полная SSH-инструкция на русском](https://github.com/Xenofan-git/M-UI-Fusion/blob/main/docs/INSTALL.ru.md) · [Full English installation guide](https://github.com/Xenofan-git/M-UI-Fusion/blob/main/docs/INSTALL.en.md) · [История разработки до 1.0.0](https://github.com/Xenofan-git/M-UI-Fusion/blob/main/docs/DEVELOPMENT-HISTORY.md).
