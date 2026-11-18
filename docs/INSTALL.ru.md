# Установка и обновление M-UI-sniffer по SSH

Проект: [Xenofan-git/M-UI-sniffer](https://github.com/Xenofan-git/M-UI-sniffer) — форк оригинальной [RomanovCaesar/m-ui](https://github.com/RomanovCaesar/m-ui) со штатной поддержкой Sniffer (HTTP, TLS и QUIC). **Команды этой страницы устанавливают именно наш форк, а не оригинальную m-ui.**

Поддерживаются Linux-серверы с `systemd` или OpenRC. Пример ниже — **NanoPi R3S LTS, Debian 13 ARM64**. Все команды `sudo` выполняются **на Linux-сервере после SSH-подключения**; `ssh` выполняется на вашем компьютере или телефоне с SSH-клиентом.

## 1. Подключение по SSH

С устройства в локальной сети Keenetic:

```bash
ssh pi@192.168.4.26
```

Либо через Tailscale, когда сервер доступен в tailnet (адрес нашей NanoPi, проверяйте актуальный адрес в Tailscale):

```bash
ssh pi@100.70.73.57
```

Для другого Linux-сервера замените адрес и пользователя:

```bash
ssh USER@SERVER_IP
```

Если сервер доступен только через VPN или SSH jump host, сперва подключитесь к своему VPN либо используйте настроенный `ProxyJump`; публично открывать SSH и веб-панель ради установки не нужно. Пользователь `pi` должен иметь право `sudo`.

Проверить архитектуру и текущую установку:

```bash
uname -m                       # aarch64 для ARM64
sudo systemctl status m-ui --no-pager   # если панель уже установлена
sudo /usr/local/m-ui/m-ui version       # если бинарник уже установлен
```

## 2. Новая установка на чистую систему

Рекомендуется запускать скачанный установщик как **файл**, предварительно просмотрев его; не перенаправляйте непроверенный скрипт прямо в оболочку:

```bash
curl -fL --retry 3 \
  https://raw.githubusercontent.com/Xenofan-git/M-UI-sniffer/main/install.sh \
  -o /tmp/m-ui-sniffer-install.sh
bash -n /tmp/m-ui-sniffer-install.sh
less /tmp/m-ui-sniffer-install.sh  # просмотр по желанию; выход клавишей q
sudo bash /tmp/m-ui-sniffer-install.sh --version v0.3.3-sniffer.1 --no-ssl
```

Установщик сам определяет ARM64, скачивает релиз и проверяет `SHA256SUMS`, затем устанавливает ядро Mihomo, systemd-службу `m-ui` и генерирует **уникальные** имя пользователя, пароль, адрес и путь панели. Сохраните их в безопасном месте. По умолчанию панель слушает все интерфейсы: **не открывайте её порт в интернет без TLS, авторизации и ограничений доступа**. Для чистой установки только на NanoPi можно явно ограничить привязку локальной сетью, добавив `--listen-ip 192.168.4.26`.

По окончании выполнения покажется URL панели и учётные данные. Sniffer можно включить в **Mihomo Settings → Basics → Sniffer**; для новых установок он по умолчанию выключен.

## 3. Обновление существующей панели с сохранением конфигурации

На работающей NanoPi **уже установлена версия v0.3.3-sniffer.1**. Её переустанавливать сейчас не требуется. Эти команды нужны при будущих обновлениях.

Рекомендуется перед обновлением отдельно сохранить бинарник и настройки:

```bash
sudo bash -c '
set -e
backup="/root/m-ui-sniffer-backup-$(date +%Y%m%d-%H%M%S)"
install -d -m 700 "$backup"
cp -p /usr/local/m-ui/m-ui /usr/local/m-ui/data/state.json /usr/local/m-ui/data/config.yaml "$backup/"
chmod 600 "$backup"/state.json "$backup"/config.yaml
printf "Резервная копия: %s\n" "$backup"
'
```

Скачайте свежий скрипт и обновите панель на указанный выпуск (замените тег на **фактически опубликованный** более новый):

```bash
curl -fL --retry 3 \
  https://raw.githubusercontent.com/Xenofan-git/M-UI-sniffer/main/install.sh \
  -o /tmp/m-ui-sniffer-install.sh
bash -n /tmp/m-ui-sniffer-install.sh
sudo bash /tmp/m-ui-sniffer-install.sh --update --version v0.3.3-sniffer.1
```

Установщик сохраняет существующие `state.json`, `config.yaml`, входящие подключения, правила, подписки и балансировщики, делает собственный снимок данных и оставляет установленное ядро Mihomo, если не указан `--update-mihomo`. В дальнейшем после установки нашего менеджера можно использовать `sudo m-ui update --version ТЕГ`; менеджер этого форка получает установщик из `Xenofan-git/M-UI-sniffer`.

## 4. Проверка после установки и обновления

```bash
sudo systemctl is-active m-ui
sudo systemctl is-enabled m-ui
sudo /usr/local/m-ui/m-ui version
sudo grep -A 20 '^sniffer:' /usr/local/m-ui/data/config.yaml
sudo journalctl -u m-ui -n 30 --no-pager
```

Для нашей NanoPi, где уже настроен смешанный HTTP/SOCKS5-входящий порт **2090**, дополнительная проверка прокси:

```bash
curl --noproxy '' -x http://192.168.4.26:2090 \
  --max-time 15 -o /dev/null -w 'HTTP %{http_code}\n' \
  https://www.google.com/generate_204
```

Ожидается HTTP `204`. На новом сервере без настроенного входящего 2090 этот тест неприменим. Наличие блока `sniffer` в YAML означает, что он включён в панели; если выключен, блок может отсутствовать.

## 5. Откат при неудачном обновлении

Откат необходимо делать из копии, созданной **перед обновлением** (свой путь из пункта 3), а не из предположительного каталога:

```bash
sudo systemctl stop m-ui
sudo cp -p /root/m-ui-sniffer-backup-YYYYMMDD-HHMMSS/m-ui /usr/local/m-ui/m-ui
sudo cp -p /root/m-ui-sniffer-backup-YYYYMMDD-HHMMSS/state.json /usr/local/m-ui/data/state.json
sudo cp -p /root/m-ui-sniffer-backup-YYYYMMDD-HHMMSS/config.yaml /usr/local/m-ui/data/config.yaml
sudo systemctl start m-ui
sudo systemctl status m-ui --no-pager
```

**Замените** `YYYYMMDD-HHMMSS` на метку вашей реальной резервной копии. Данные содержат секреты подписок и доступа; никогда не добавляйте `state.json` и `config.yaml` из рабочей системы в публичный репозиторий или сообщения.

## 6. Релизы и автоматические сборки

- [Releases](https://github.com/Xenofan-git/M-UI-sniffer/releases) — готовые архивы для ARM64 и других архитектур; файлы `SHA256SUMS` для проверки целостности.
- [GitHub Actions](https://github.com/Xenofan-git/M-UI-sniffer/actions) — тесты и сборка каждого изменения.
- [Исходный проект](https://github.com/RomanovCaesar/m-ui) — обновления оригинала можно выборочно объединять после проверки совместимости; это **не** должно автоматически менять NanoPi.

Для ручной проверки архива вместо установщика поместите архив и `SHA256SUMS` в один каталог и выполните `sha256sum -c SHA256SUMS --ignore-missing` (если каталог содержит только нужный архив).
