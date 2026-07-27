"""Automatic OPAP fetch + message build + send, on the Greek lottery draw
schedule — no button press needed. Tzoker draws Tuesday/Thursday/Sunday,
Eurojackpot draws Tuesday/Friday; the union of those days is when the
displayed jackpot amounts actually change, so results are refreshed just
after midnight on each of those days.
"""

from __future__ import annotations

import asyncio
import datetime
import logging

import aiohttp

from . import settings_store
from .manager import SignManager
from .messages import build_jackpot_message
from .opap import OPAP_GAME_IDS, fetch_jackpot

log = logging.getLogger("led_bridge.scheduler")

# datetime.weekday(): Monday=0 ... Sunday=6
DRAW_WEEKDAYS = {1, 3, 4, 6}  # Tuesday, Thursday, Friday, Sunday
RUN_HOUR = 0
RUN_MINUTE_WINDOW = 2  # run any time in [00:00, 00:02) to tolerate poll jitter
CHECK_INTERVAL_S = 30
DEVICE_HEIGHT = 16


async def run_scheduled_update(manager: SignManager, http_session: aiohttp.ClientSession) -> dict:
    tzoker = await fetch_jackpot(http_session, OPAP_GAME_IDS["tzoker"])
    eurojackpot = await fetch_jackpot(http_session, OPAP_GAME_IDS["eurojackpot"])
    settings = settings_store.load_settings()
    lotto = settings["lottoAmount"]

    text = build_jackpot_message(tzoker, lotto, eurojackpot)
    result = await manager.send_text_to_selected(
        text, "#ffffff", settings["backgroundColor"], settings["fontPx"], DEVICE_HEIGHT
    )
    log.info(
        "Scheduled update: Τζόκερ %s€, EuroJackpot %s€ -> %s",
        round(tzoker), round(eurojackpot), result,
    )
    return result


async def scheduler_loop(manager: SignManager, http_session: aiohttp.ClientSession) -> None:
    last_run_date: datetime.date | None = None
    while True:
        now = datetime.datetime.now()
        is_due = (
            now.weekday() in DRAW_WEEKDAYS
            and now.hour == RUN_HOUR
            and now.minute < RUN_MINUTE_WINDOW
            and last_run_date != now.date()
        )
        if is_due:
            last_run_date = now.date()
            try:
                await run_scheduled_update(manager, http_session)
            except Exception:
                log.exception("Scheduled OPAP update failed")
        await asyncio.sleep(CHECK_INTERVAL_S)
