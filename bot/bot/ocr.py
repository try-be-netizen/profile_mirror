"""Yandex Vision OCR — распознавание текста на изображениях.

Используется для анализа скриншотов LinkedIn-профиля,
когда пользователь не может скопировать текст (мобильное приложение).
"""
import base64
import logging
import os
from typing import List

import requests

logger = logging.getLogger(__name__)

YC_VISION_URL = "https://vision.api.cloud.yandex.net/vision/v1/batchAnalyze"
YC_FOLDER_ID = os.environ["YC_FOLDER_ID"]
YC_API_KEY = os.environ["YC_API_KEY"]


def _extract_text_from_response(response_json: dict) -> str:
    """Достаёт распознанный текст из ответа Yandex Vision.

    Структура ответа:
    results[0].results[0].textDetection.pages[0].blocks[*].lines[*].words[*].text
    """
    try:
        results = response_json.get("results", [])
        if not results:
            return ""
        inner_results = results[0].get("results", [])
        if not inner_results:
            return ""
        text_detection = inner_results[0].get("textDetection", {})
        pages = text_detection.get("pages", [])
        if not pages:
            return ""

        lines_text: List[str] = []
        for page in pages:
            for block in page.get("blocks", []):
                for line in block.get("lines", []):
                    words = line.get("words", [])
                    line_text = " ".join(w.get("text", "") for w in words)
                    if line_text.strip():
                        lines_text.append(line_text)
        return "\n".join(lines_text)
    except Exception:
        logger.exception("OCR: ошибка разбора ответа Vision")
        return ""


def ocr_single_image(image_bytes: bytes) -> str:
    """Распознаёт текст на одной картинке.

    Возвращает распознанный текст одной строкой с переносами по строкам исходника.
    Если ошибка — возвращает пустую строку, не бросает исключение.
    """
    image_b64 = base64.b64encode(image_bytes).decode("ascii")
    payload = {
        "folderId": YC_FOLDER_ID,
        "analyze_specs": [
            {
                "content": image_b64,
                "features": [
                    {
                        "type": "TEXT_DETECTION",
                        "text_detection_config": {
                            "language_codes": ["ru", "en"],
                            "model": "page",
                        },
                    }
                ],
            }
        ],
    }
    headers = {
        "Authorization": f"Api-Key {YC_API_KEY}",
        "Content-Type": "application/json",
    }
    try:
        response = requests.post(
            YC_VISION_URL, headers=headers, json=payload, timeout=30
        )
        response.raise_for_status()
        return _extract_text_from_response(response.json())
    except requests.HTTPError as e:
        body = e.response.text if e.response else "no body"
        logger.error("OCR HTTPError: %s — %s", e, body[:500])
        return ""
    except Exception:
        logger.exception("OCR: непредвиденная ошибка")
        return ""


def ocr_multiple_images(images_bytes: List[bytes]) -> str:
    """Распознаёт текст на нескольких картинках, склеивает в один текст.

    Между распознанными частями вставляет разделитель.
    Пустые результаты пропускает.
    """
    texts: List[str] = []
    for i, img_bytes in enumerate(images_bytes, start=1):
        text = ocr_single_image(img_bytes)
        if text:
            texts.append(f"--- Скриншот {i} ---\n{text}")
            logger.info("OCR: скрин %d распознан, %d символов", i, len(text))
        else:
            logger.warning("OCR: скрин %d не распознан или пустой", i)
    return "\n\n".join(texts)
