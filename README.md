# profile_mirror

Telegram-бот и Mini App для анализа LinkedIn-профиля «глазами других» — рекрутера и коллеги.

## Структура

- **`app/`** — Mini App (HTML/CSS/JS), деплоится на GitHub Pages
- **`bot/`** — Python-бот + HTTP API, деплоится на VM
- **`.github/workflows/`** — автоматический деплой бота на VM при push в main

## Деплой

### Mini App → GitHub Pages

1. Settings → Pages
2. Source: Deploy from a branch
3. Branch: `main`, Folder: `/app`
4. URL: `https://try-be-netizen.github.io/profile_mirror/`

### Бот → VM

См. подробности в `bot/README.md`.

### Cloudflare Tunnel → HTTPS-доступ к боту

См. подробности в `bot/README.md`.

## Архитектура

```
Пользователь
    ↓ /start в Telegram
@profile_mirror_bot ── кнопка «Открыть зеркало» ──→ Mini App (GitHub Pages, HTTPS)
                                                        ↓ копипаст профиля
                                                        ↓ POST /analyze
                                              Cloudflare Tunnel (HTTPS)
                                                        ↓
                                              VM (HTTP :8080)
                                                        ↓
                                              YandexGPT (рекрутер + коллега)
                                                        ↓
                                              JSON ответ → Mini App рендерит результат
```
