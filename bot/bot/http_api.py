"""HTTP API endpoints для Mini App."""
import base64
import hashlib
import hmac
import io
import json
import logging
import os
from urllib.parse import parse_qsl

from aiohttp import web

from . import yandex_gpt

logger = logging.getLogger(__name__)

TELEGRAM_BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]


def _verify_init_data(init_data: str) -> dict | None:
    """Проверяет подпись initData от Telegram. Возвращает данные пользователя или None."""
    try:
        parsed = dict(parse_qsl(init_data, strict_parsing=False))
        received_hash = parsed.pop("hash", None)
        if not received_hash:
            return None
        data_check = "\n".join(f"{k}={v}" for k, v in sorted(parsed.items()))
        secret = hmac.new(b"WebAppData", TELEGRAM_BOT_TOKEN.encode(), hashlib.sha256).digest()
        calculated = hmac.new(secret, data_check.encode(), hashlib.sha256).hexdigest()
        if calculated != received_hash:
            return None
        user_json = parsed.get("user", "{}")
        return json.loads(user_json)
    except Exception:
        logger.exception("Не получилось проверить initData")
        return None


async def cors_middleware(app, handler):
    async def middleware_handler(request):
        if request.method == "OPTIONS":
            response = web.Response()
        else:
            response = await handler(request)
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        return response
    return middleware_handler


async def handle_analyze(request: web.Request) -> web.Response:
    """POST /analyze — анализирует профиль, возвращает JSON с recruiter и colleague."""
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json"}, status=400)

    profile_text = body.get("profile_text", "").strip()
    if len(profile_text) < 50:
        return web.json_response({"error": "profile_too_short"}, status=400)
    if len(profile_text) > 10000:
        profile_text = profile_text[:10000]

    init_data = body.get("init_data", "")
    user = _verify_init_data(init_data) if init_data else None
    user_id = user.get("id") if user else "anonymous"
    logger.info("Анализ профиля для пользователя %s, длина текста %d", user_id, len(profile_text))

    try:
        result = yandex_gpt.analyze_profile(profile_text)
    except Exception:
        logger.exception("Ошибка анализа профиля")
        return web.json_response({"error": "analysis_failed"}, status=500)

    return web.json_response(result)


async def handle_send_card(request: web.Request) -> web.Response:
    """POST /send_card — принимает PNG (base64), отправляет в чат пользователю."""
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json"}, status=400)

    image_data = body.get("image_data", "")
    init_data = body.get("init_data", "")

    user = _verify_init_data(init_data)
    if not user:
        return web.json_response({"error": "invalid_init_data"}, status=401)
    user_id = user.get("id")
    if not user_id:
        return web.json_response({"error": "no_user_id"}, status=401)

    if "," in image_data:
        image_data = image_data.split(",", 1)[1]
    try:
        png_bytes = base64.b64decode(image_data)
    except Exception:
        return web.json_response({"error": "invalid_image"}, status=400)

    bot = request.app["bot"]
    try:
        await bot.send_photo(
            chat_id=user_id,
            photo=io.BytesIO(png_bytes),
            caption="Готово ✨\n\nПоделитесь карточкой в LinkedIn или сохраните себе.",
        )
    except Exception:
        logger.exception("Не получилось отправить карточку в чат")
        return web.json_response({"error": "send_failed"}, status=500)

    return web.json_response({"ok": True})


async def handle_health(request: web.Request) -> web.Response:
    return web.json_response({"ok": True, "service": "profile_mirror_bot"})


def create_app(bot) -> web.Application:
    app = web.Application(middlewares=[cors_middleware])
    app["bot"] = bot
    app.router.add_post("/analyze", handle_analyze)
    app.router.add_post("/send_card", handle_send_card)
    app.router.add_get("/health", handle_health)
    app.router.add_options("/{tail:.*}", lambda r: web.Response())
    return app
