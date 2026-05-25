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

from . import ocr, yandex_gpt

logger = logging.getLogger(__name__)

TELEGRAM_BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
OWNER_USER_ID = os.environ.get("OWNER_USER_ID")  # Telegram user_id владельца — куда слать лиды


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


async def handle_analyze_images(request: web.Request) -> web.Response:
    """POST /analyze_images — принимает скриншоты, прогоняет OCR и анализирует."""
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json"}, status=400)

    images_b64 = body.get("images", [])
    if not isinstance(images_b64, list) or not images_b64:
        return web.json_response({"error": "no_images"}, status=400)
    if len(images_b64) > 10:
        return web.json_response({"error": "too_many_images"}, status=400)

    init_data = body.get("init_data", "")
    user = _verify_init_data(init_data) if init_data else None
    user_id = user.get("id") if user else "anonymous"
    logger.info("OCR-анализ для пользователя %s, %d скринов", user_id, len(images_b64))

    images_bytes = []
    for img in images_b64:
        if "," in img:
            img = img.split(",", 1)[1]
        try:
            images_bytes.append(base64.b64decode(img))
        except Exception:
            return web.json_response({"error": "invalid_image_data"}, status=400)

    try:
        profile_text = ocr.ocr_multiple_images(images_bytes)
    except Exception:
        logger.exception("Ошибка OCR")
        return web.json_response({"error": "ocr_failed"}, status=500)

    if len(profile_text.strip()) < 50:
        return web.json_response({"error": "ocr_too_little_text"}, status=400)
    if len(profile_text) > 10000:
        profile_text = profile_text[:10000]

    logger.info("OCR извлёк %d символов", len(profile_text))

    try:
        result = yandex_gpt.analyze_profile(profile_text)
    except Exception:
        logger.exception("Ошибка анализа профиля")
        return web.json_response({"error": "analysis_failed"}, status=500)

    return web.json_response(result)


def _format_list(items) -> str:
    """Форматирует список пунктов в строки с маркерами."""
    if not items:
        return ""
    return "\n".join(f"• {item}" for item in items if item)


def _format_lead_message(user: dict, source: str, profile_text: str, analysis: dict) -> str:
    """Форматирует сообщение-лид для отправки владельцу.

    Включает полный текст профиля и полный результат анализа от рекрутера и коллеги.
    """
    parts = ["🔔 <b>Новый лид</b>\n"]

    # Контактные данные
    first = user.get("first_name", "")
    last = user.get("last_name", "")
    name = f"{first} {last}".strip() or "Без имени"
    username = user.get("username")
    user_id = user.get("id")

    parts.append(f"<b>Имя:</b> {name}")
    if username:
        parts.append(f"<b>Юзернейм:</b> @{username}")
    if user_id:
        parts.append(f"<b>User ID:</b> <code>{user_id}</code>")
    parts.append(f"<b>Кликнул с вкладки:</b> {source}")
    parts.append("")

    # Текст профиля
    if profile_text:
        parts.append("<b>📄 Профиль:</b>")
        parts.append(f"<i>{profile_text}</i>")
        parts.append("")

    # Полный анализ рекрутера
    recruiter = analysis.get("recruiter") or {}
    if recruiter:
        parts.append("━━━━━━━━━━━━━━━━━")
        parts.append("<b>👁 РЕКРУТЕР</b>")
        parts.append("")
        if recruiter.get("overview"):
            parts.append("<b>Первое впечатление:</b>")
            parts.append(recruiter["overview"])
            parts.append("")
        if recruiter.get("strengths"):
            parts.append("<b>Сильное:</b>")
            parts.append(_format_list(recruiter["strengths"]))
            parts.append("")
        if recruiter.get("weaknesses"):
            parts.append("<b>Слабое:</b>")
            parts.append(_format_list(recruiter["weaknesses"]))
            parts.append("")
        if recruiter.get("recommendations"):
            parts.append("<b>Рекомендации:</b>")
            parts.append(_format_list(recruiter["recommendations"]))
            parts.append("")

    # Полный анализ коллеги
    colleague = analysis.get("colleague") or {}
    if colleague:
        parts.append("━━━━━━━━━━━━━━━━━")
        parts.append("<b>☕ КОЛЛЕГА</b>")
        parts.append("")
        if colleague.get("overview"):
            parts.append("<b>Первое впечатление:</b>")
            parts.append(colleague["overview"])
            parts.append("")
        if colleague.get("thoughts"):
            parts.append("<b>Мысли вслух:</b>")
            parts.append(_format_list(colleague["thoughts"]))
            parts.append("")
        if colleague.get("observations"):
            parts.append("<b>Наблюдения:</b>")
            parts.append(_format_list(colleague["observations"]))
            parts.append("")

    return "\n".join(parts)


def _split_message(text: str, max_length: int = 4000) -> list[str]:
    """Разбивает длинный текст на части не больше max_length символов.

    Сохраняет переносы строк — режет только по '\\n', не посередине слова.
    """
    if len(text) <= max_length:
        return [text]

    parts = []
    current = []
    current_length = 0
    for line in text.split("\n"):
        line_with_newline = line + "\n"
        if current_length + len(line_with_newline) > max_length and current:
            parts.append("".join(current).rstrip())
            current = []
            current_length = 0
        current.append(line_with_newline)
        current_length += len(line_with_newline)
    if current:
        parts.append("".join(current).rstrip())
    return parts


async def handle_lead(request: web.Request) -> web.Response:
    """POST /lead — записывает клик по 'Хотите улучшить резюме?' и шлёт владельцу контекст."""
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json"}, status=400)

    init_data = body.get("init_data", "")
    user = _verify_init_data(init_data)
    if not user:
        return web.json_response({"error": "invalid_init_data"}, status=401)

    source = body.get("source", "unknown")
    profile_text = body.get("profile_text", "") or ""
    analysis = body.get("analysis") or {}

    user_id = user.get("id")
    logger.info("Лид от user_id=%s, source=%s", user_id, source)

    if not OWNER_USER_ID:
        logger.warning("OWNER_USER_ID не задан в .env — лид зафиксирован только в логах")
        return web.json_response({"ok": True, "delivered": False})

    bot = request.app["bot"]
    text = _format_lead_message(user, source, profile_text, analysis)
    chunks = _split_message(text)

    try:
        for i, chunk in enumerate(chunks):
            await bot.send_message(
                chat_id=int(OWNER_USER_ID),
                text=chunk,
                parse_mode="HTML",
                disable_web_page_preview=True,
            )
    except Exception:
        logger.exception("Не получилось отправить лид владельцу")
        return web.json_response({"error": "delivery_failed"}, status=500)

    return web.json_response({"ok": True, "delivered": True})


async def handle_health(request: web.Request) -> web.Response:
    return web.json_response({"ok": True, "service": "profile_mirror_bot"})


def create_app(bot) -> web.Application:
    app = web.Application(middlewares=[cors_middleware], client_max_size=20 * 1024 * 1024)
    app["bot"] = bot
    app.router.add_post("/analyze", handle_analyze)
    app.router.add_post("/analyze_images", handle_analyze_images)
    app.router.add_post("/send_card", handle_send_card)
    app.router.add_post("/lead", handle_lead)
    app.router.add_get("/health", handle_health)
    app.router.add_options("/{tail:.*}", lambda r: web.Response())
    return app
