# Установка и обновление M-UI Fusion по SSH

Проект: [Xenofan-git/M-UI-Fusion](https://github.com/Xenofan-git/M-UI-Fusion) — форк оригинальной [RomanovCaesar/m-ui](https://github.com/RomanovCaesar/m-ui) со штатной поддержкой Sniffer (HTTP, TLS и QUIC). **Команды этой страницы устанавливают именно наш форк, а не оригинальную m-ui.**

Поддерживаются Linux-серверы с `systemd` или OpenRC, включая Debian/Ubuntu и другие поддерживаемые дистрибутивы. **M-UI Fusion не привязан к конкретному устройству:** установщик автоматически определяет архитектуру процессора (AMD64, ARM64 и другие поддерживаемые). Все команды `sudo` выполняются **на Linux-сервере после SSH-подключения**, а `ssh` — на вашем компьютере или телефоне с SSH-клиентом.

## 1. Подключение по SSH

Подключитесь к серверу в своей локальной сети или по его доступному адресу. Замените `USER` и `SERVER_IP` своими значениями:

```bash
ssh USER@SERVER_IP
```

При использовании Tailscale можно подключиться по Tailscale IP или DNS-имени сервера:

```bash
ssh USER@TAILSCALE_IP
```

Если сервер доступен только через VPN или SSH jump host, сперва подключитесь к своему VPN либо используйте настроенный `ProxyJump`; публично открывать SSH и веб-панель ради установки не нужно. Указанный пользователь должен иметь право выполнять команды через `sudo` (или используйте административную учётную запись).

Проверить архитектуру и текущую установку:

```bash
uname -m                       # например: x86_64 (AMD64), aarch64 (ARM64)
sudo systemctl status m-ui --no-pager   # если панель уже установлена
sudo /usr/local/m-ui/m-ui version       # если бинарник уже установлен
```

## 2. Новая установка на чистую систему

Рекомендуется запускать скачанный установщик как **файл**, предварительно просмотрев его; не перенаправляйте непроверенный скрипт прямо в оболочку:

```bash
curl -fL --retry 3 \
  https://raw.githubusercontent.com/Xenofan-git/M-UI-Fusion/main/install.sh \
  -o /tmp/m-ui-fusion-install.sh
bash -n /tmp/m-ui-fusion-install.sh
less /tmp/m-ui-fusion-install.sh  # просмотр по желанию; выход клавишей q
sudo bash /tmp/m-ui-fusion-install.sh --version v0.3.3-fusion.8 --no-ssl
```

Установщик определяет архитектуру Linux-сервера, скачивает подходящий релиз и проверяет `SHA256SUMS`, затем устанавливает ядро Mihomo, службу `m-ui` (systemd/OpenRC) и генерирует **уникальные** имя пользователя, пароль, адрес и путь панели. Сохраните их в безопасном месте. По умолчанию панель слушает все интерфейсы: **не открывайте её порт в интернет без TLS, авторизации и ограничений доступа**. При необходимости можно ограничить привязку интерфейсом сервера через `--listen-ip SERVER_LOCAL_IP` (замените `SERVER_LOCAL_IP` фактическим локальным IP сервера).

По окончании выполнения покажется URL панели и учётные данные. Sniffer можно включить в **Mihomo Settings → Basics → Sniffer**; для новых установок он по умолчанию выключен.

## 3. Обновление существующей панели с сохранением конфигурации

Если M-UI Fusion уже установлена на вашем сервере, используйте обновление с сохранением конфигурации. Не выполняйте повторную установку без необходимости.

Рекомендуется перед обновлением отдельно сохранить бинарник и настройки:

```bash
sudo bash -c '
set -e
backup="/root/m-ui-fusion-backup-$(date +%Y%m%d-%H%M%S)"
install -d -m 700 "$backup"
cp -p /usr/local/m-ui/m-ui /usr/local/m-ui/data/state.json /usr/local/m-ui/data/config.yaml "$backup/"
chmod 600 "$backup"/state.json "$backup"/config.yaml
printf "Резервная копия: %s\n" "$backup"
'
```

Скачайте свежий скрипт и обновите панель на указанный выпуск (замените тег на **фактически опубликованный** более новый):

```bash
curl -fL --retry 3 \
  https://raw.githubusercontent.com/Xenofan-git/M-UI-Fusion/main/install.sh \
  -o /tmp/m-ui-fusion-install.sh
bash -n /tmp/m-ui-fusion-install.sh
sudo bash /tmp/m-ui-fusion-install.sh --update --version v0.3.3-fusion.8
```

Установщик сохраняет существующие `state.json`, `config.yaml`, входящие подключения, правила, подписки и балансировщики, делает собственный снимок данных и оставляет установленное ядро Mihomo, если не указан `--update-mihomo`. В дальнейшем после установки нашего менеджера можно использовать `sudo m-ui update --version ТЕГ`; менеджер этого форка получает установщик из `Xenofan-git/M-UI-Fusion`.

## 4. Проверка после установки и обновления

```bash
sudo systemctl is-active m-ui
sudo systemctl is-enabled m-ui
sudo /usr/local/m-ui/m-ui version
sudo grep -A 20 '^sniffer:' /usr/local/m-ui/data/config.yaml
sudo journalctl -u m-ui -n 30 --no-pager
```

Если вы уже создали смешанный HTTP/SOCKS5 или HTTP-входящий порт в настройках Mihomo, можно проверить прокси **на самом сервере**, заменив `PROXY_PORT` номером созданного входящего порта:

```bash
curl --noproxy '' -x http://127.0.0.1:PROXY_PORT \
  --max-time 15 -o /dev/null -w 'HTTP %{http_code}\n' \
  https://www.google.com/generate_204
```

Для тестового URL ожидается HTTP `204`, если интернет и выбранный выход работают. Входящий прокси не создаётся автоматически одной лишь установкой панели. Наличие блока `sniffer` в YAML означает, что он включён в панели; если выключен, блок может отсутствовать.

## 5. Откат при неудачном обновлении

Откат необходимо делать из копии, созданной **перед обновлением** (свой путь из пункта 3), а не из предположительного каталога:

```bash
sudo systemctl stop m-ui
sudo cp -p /root/m-ui-fusion-backup-YYYYMMDD-HHMMSS/m-ui /usr/local/m-ui/m-ui
sudo cp -p /root/m-ui-fusion-backup-YYYYMMDD-HHMMSS/state.json /usr/local/m-ui/data/state.json
sudo cp -p /root/m-ui-fusion-backup-YYYYMMDD-HHMMSS/config.yaml /usr/local/m-ui/data/config.yaml
sudo systemctl start m-ui
sudo systemctl status m-ui --no-pager
```

**Замените** `YYYYMMDD-HHMMSS` на метку вашей реальной резервной копии. Данные содержат секреты подписок и доступа; никогда не добавляйте `state.json` и `config.yaml` из рабочей системы в публичный репозиторий или сообщения.

## 6. Релизы и автоматические сборки

- [Releases](https://github.com/Xenofan-git/M-UI-Fusion/releases) — готовые архивы для ARM64 и других архитектур; файлы `SHA256SUMS` для проверки целостности.
- [GitHub Actions](https://github.com/Xenofan-git/M-UI-Fusion/actions) — тесты и сборка каждого изменения.
- [Исходный проект](https://github.com/RomanovCaesar/m-ui) — обновления оригинала можно выборочно объединять после проверки совместимости; это **не** должно автоматически менять настройки рабочего сервера.

Для ручной проверки архива вместо установщика поместите архив и `SHA256SUMS` в один каталог и выполните `sha256sum -c SHA256SUMS --ignore-missing` (если каталог содержит только нужный архив).
