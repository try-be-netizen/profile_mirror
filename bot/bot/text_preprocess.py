"""Препроцессинг текста LinkedIn-профиля.

Цель: помочь модели правильно интерпретировать структуру опыта.
В LinkedIn-тексте даты позиций часто склеиваются, и модель путает
параллельные и последовательные роли.

Здесь мы делаем минимальную нормализацию:
— Ищем паттерны дат вида «окт. 2023 г. — настоящее время» / «January 2022 — Oct 2023»
— Помечаем границы между позициями явным разделителем
— Добавляем для каждой позиции пометку: текущая или прошлая
"""
import logging
import re

logger = logging.getLogger(__name__)

# Месяцы — русские (с точкой и без), английские (полные и сокращённые).
MONTH_PATTERNS = [
    # Русские с точкой
    r"янв\.?", r"фев\.?", r"мар\.?", r"апр\.?",
    r"мая", r"июн\.?", r"июл\.?", r"авг\.?",
    r"сен\.?", r"сент\.?", r"окт\.?", r"ноя\.?", r"нояб\.?", r"дек\.?",
    # Русские полные
    r"января", r"февраля", r"марта", r"апреля",
    r"июня", r"июля", r"августа",
    r"сентября", r"октября", r"ноября", r"декабря",
    # Английские сокращённые
    r"Jan\.?", r"Feb\.?", r"Mar\.?", r"Apr\.?",
    r"May", r"Jun\.?", r"Jul\.?", r"Aug\.?",
    r"Sep\.?", r"Sept\.?", r"Oct\.?", r"Nov\.?", r"Dec\.?",
    # Английские полные
    r"January", r"February", r"March", r"April",
    r"June", r"July", r"August",
    r"September", r"October", r"November", r"December",
]
MONTH_GROUP = "(?:" + "|".join(MONTH_PATTERNS) + ")"

# «настоящее время» / «present» в разных вариациях
PRESENT_PATTERNS = [
    r"настоящее время",
    r"наст\.\s*время",
    r"по настоящее время",
    r"present",
    r"now",
    r"current",
]
PRESENT_GROUP = "(?:" + "|".join(PRESENT_PATTERNS) + ")"

# Один «месяц год» — например, «окт. 2023 г.», «October 2023», «окт 2023»
SINGLE_DATE_RE = re.compile(
    rf"\b{MONTH_GROUP}\s+\d{{4}}(?:\s*г\.?)?",
    re.IGNORECASE,
)

# Диапазон: «месяц год – месяц год» или «месяц год – настоящее время»
DATE_RANGE_RE = re.compile(
    rf"\b({MONTH_GROUP}\s+\d{{4}}(?:\s*г\.?)?)\s*[–—\-−]\s*({MONTH_GROUP}\s+\d{{4}}(?:\s*г\.?)?|{PRESENT_GROUP})",
    re.IGNORECASE,
)


def _is_present(date_part: str) -> bool:
    """Проверяет, является ли конечная дата «настоящим временем»."""
    return bool(re.search(PRESENT_GROUP, date_part, re.IGNORECASE))


def annotate_positions(text: str) -> str:
    """Находит диапазоны дат и помечает каждую позицию как [ТЕКУЩАЯ] / [ПРОШЛАЯ].

    Также вставляет разделитель `═══` между позициями, чтобы модель
    видела чёткие границы.
    """
    if not text:
        return text

    matches = list(DATE_RANGE_RE.finditer(text))
    if not matches:
        return text  # Если не нашли структуру — отдаём как есть

    parts = []
    last_end = 0
    for i, m in enumerate(matches):
        date_range = m.group(0)
        end_date = m.group(2)
        marker = "[ТЕКУЩАЯ ПОЗИЦИЯ]" if _is_present(end_date) else "[ПРОШЛАЯ ПОЗИЦИЯ]"

        # Кусок текста до начала этого диапазона
        before = text[last_end:m.start()]
        # Если это не первая позиция — добавляем разделитель перед ней
        if i > 0:
            parts.append("\n═══ Следующая позиция ═══\n")
        parts.append(before)
        parts.append(f"{marker} {date_range}")
        last_end = m.end()

    # Хвост после последнего диапазона
    parts.append(text[last_end:])

    annotated = "".join(parts)
    positions_count = len(matches)
    current_count = sum(1 for m in matches if _is_present(m.group(2)))
    logger.info(
        "Препроцессинг: найдено %d позиций, %d текущих",
        positions_count, current_count,
    )
    return annotated


def preprocess(text: str) -> str:
    """Основная функция препроцессинга. Применяет все преобразования."""
    text = annotate_positions(text)
    return text
