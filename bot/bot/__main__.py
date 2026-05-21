"""Profile Mirror Bot — точка входа.

Запускает Telegram-бот и HTTP-сервер для Mini App параллельно.
"""
import asyncio
import logging
import os
import signal

from aiohttp import web
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update, WebAppInfo
from telegram.constants import ParseMode
from telegram.ext import Application, CommandHandler, ContextTypes

from . import http_api

logging.basicConfig(
    format="%(asctime)s · %(name)s · %(levelname)s · %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

TELEGRAM_BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
MINI_APP_URL = os.environ["MINI_APP_URL"]
HTTP_PORT = int(os.environ.get("HTTP_PORT", "8080"))
PROXY_URL = os.environ.get("TELEGRAM_PROXY")


WELCOME_TEXT = (
    "Добро пожаловать ☕️\n"
    "Здесь ты сможешь получить ответ на вопрос, что видят в твоём LinkedIn-профиле:\n\n"
    "• Рекрутер, который оценивает экспертизу, скилы и прозрачность достижений\n"
    "• Случайный коллега, который подмечает, о чём с тобой интересно поговорить\n\n"
    "2 минуты, бесплатно, без регистрации\n\n"
    "Благодарна любому фидбеку: @about_xen\n"
    "Ксюша, продакт Алисы AI в Яндексе"
)


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    keyboard = InlineKeyboardMarkup([
        [InlineKeyboardButton(
            text="Открыть приложение",
            web_app=WebAppInfo(url=MINI_APP_URL),
        )]
    ])
    await update.message.reply_text(
        WELCOME_TEXT,
        reply_markup=keyboard,
        parse_mode=ParseMode.HTML,
    )


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text(
        "Просто нажмите /start и откройте приложение.\n\n"
        "Внутри — вставьте свой профиль с LinkedIn, и через 10 секунд я покажу, "
        "как он выглядит со стороны."
    )


async def run_http_server(bot, port: int) -> None:
    app = http_api.create_app(bot)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", port)
    await site.start()
    logger.info("HTTP API слушает на порту %d", port)
    try:
        while True:
            await asyncio.sleep(3600)
    finally:
        await runner.cleanup()


async def main_async() -> None:
    builder = Application.builder().token(TELEGRAM_BOT_TOKEN)
    if PROXY_URL:
        logger.info("Использую прокси для Telegram")
        builder = builder.get_updates_proxy(PROXY_URL).proxy(PROXY_URL)
    application = builder.build()

    application.add_handler(CommandHandler("start", start_command))
    application.add_handler(CommandHandler("help", help_command))

    await application.initialize()
    await application.start()
    await application.updater.start_polling(allowed_updates=Update.ALL_TYPES)
    logger.info("profile_mirror_bot запущен. Mini App URL: %s", MINI_APP_URL)

    http_task = asyncio.create_task(run_http_server(application.bot, HTTP_PORT))

    stop_event = asyncio.Event()
    loop = asyncio.get_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop_event.set)

    await stop_event.wait()

    logger.info("Останавливаюсь")
    http_task.cancel()
    try:
        await http_task
    except asyncio.CancelledError:
        pass
    await application.updater.stop()
    await application.stop()
    await application.shutdown()


def main() -> None:
    asyncio.run(main_async())


if __name__ == "__main__":
    main()
