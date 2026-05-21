# profile_mirror — backend

Python-бот для @profile_mirror_bot. Слушает Telegram и обслуживает HTTP API для Mini App.

## Установка на VM (первый раз)

```bash
# 1. Клонировать репо
cd ~
git clone https://github.com/try-be-netizen/profile_mirror.git
cd profile_mirror/bot

# 2. Создать venv и установить зависимости
python3 -m venv venv
venv/bin/pip install -r requirements.txt

# 3. Создать .env (скопировать из .env.example и заполнить)
cp .env.example .env
nano .env

# 4. Установить systemd-сервис
sudo cp profile-mirror-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable profile-mirror-bot
sudo systemctl start profile-mirror-bot

# 5. Проверить
sudo journalctl -u profile-mirror-bot -n 30 --no-pager
```

## Cloudflare Tunnel

После того как бот запущен на порту 8080:

```bash
# Установить cloudflared один раз
wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared-linux-amd64.deb

# Запустить тоннель
cloudflared tunnel --url http://localhost:8080
```

Скопировать выданный URL `https://xxx.trycloudflare.com` — это HTTPS-эндпоинт.

Чтобы тоннель пережил перезапуски — оформить как systemd-сервис (см. ниже).

### Тоннель как systemd-сервис

```bash
sudo tee /etc/systemd/system/profile-mirror-tunnel.service > /dev/null <<EOF
[Unit]
Description=Cloudflare Tunnel for Profile Mirror
After=network.target

[Service]
Type=simple
User=brain
ExecStart=/usr/local/bin/cloudflared tunnel --url http://localhost:8080
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable profile-mirror-tunnel
sudo systemctl start profile-mirror-tunnel

# Узнать выданный URL
sudo journalctl -u profile-mirror-tunnel -n 50 --no-pager | grep trycloudflare
```

## Endpoints

- `GET /health` → `{"ok": true, "service": "profile_mirror_bot"}`
- `POST /analyze` — body `{profile_text, init_data}` → `{recruiter, colleague}`
- `POST /send_card` — body `{image_data (base64 PNG), init_data}` → `{ok: true}`

## Локальный запуск (для разработки)

```bash
venv/bin/python -m bot
```

Переменные окружения подхватываются из `.env` через systemd, либо нужно их экспортировать вручную.
