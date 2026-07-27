"""Entry point: starts the local web server, opens the browser, and runs
the automatic BLE scan/connect loop for CoolLED1248 / CoolLEDX signs.
"""

from __future__ import annotations

import asyncio
import logging
import webbrowser

import aiohttp
from aiohttp import web

from .manager import SignManager
from .scheduler import run_scheduled_update, scheduler_loop
from .server import create_app

HOST = "127.0.0.1"
PORT = 8934

# How long a --once run waits for signs to be discovered/connected before
# giving up and sending to whatever's connected (possibly nothing). BLE
# discovery + sequential connects to a few signs can take tens of seconds.
ONESHOT_CONNECT_TIMEOUT_S = 60
ONESHOT_SCAN_RETRY_S = 3


async def _run() -> None:
    manager = SignManager()
    app = create_app(manager)

    # The frontend polls /api/signs every couple seconds to keep the sign
    # list live; logging every one of those requests would drown out the
    # connection-status messages that actually matter.
    runner = web.AppRunner(app, access_log=None)
    await runner.setup()
    site = web.TCPSite(runner, HOST, PORT)
    await site.start()

    url = f"http://{HOST}:{PORT}/"
    logging.info("OPPC LED Sign Control running at %s", url)
    webbrowser.open(url)

    scan_task = asyncio.create_task(manager.scan_and_connect_loop())
    schedule_task = asyncio.create_task(scheduler_loop(manager, app["http_session"]))
    try:
        await asyncio.gather(scan_task, schedule_task)
    finally:
        await runner.cleanup()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    try:
        asyncio.run(_run())
    except KeyboardInterrupt:
        pass


async def _run_once() -> None:
    """Scan for known signs, send the current OPAP-driven ticker message
    once, then exit — no web server, no browser. Meant to be launched by an
    external scheduler (e.g. Windows Task Scheduler) at a fixed time on
    days the computer is reliably on, rather than relying on the app
    running continuously in the background at the exact moment (midnight)
    the numbers actually change.
    """
    manager = SignManager()
    loop = asyncio.get_event_loop()
    deadline = loop.time() + ONESHOT_CONNECT_TIMEOUT_S

    while loop.time() < deadline:
        try:
            await manager.scan_once()
        except Exception:
            logging.exception("Scan/connect pass failed")
        if manager.signs and any(s.connected for s in manager.signs.values()):
            break
        await asyncio.sleep(ONESHOT_SCAN_RETRY_S)

    connected = sum(1 for s in manager.signs.values() if s.connected)
    logging.info("Connected to %d sign(s) before sending.", connected)

    try:
        async with aiohttp.ClientSession() as http_session:
            await run_scheduled_update(manager, http_session)
    except Exception:
        logging.exception("Scheduled update failed")

    for sign in manager.signs.values():
        if sign.client:
            try:
                await sign.client.disconnect()
            except Exception:
                pass


def main_once() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    asyncio.run(_run_once())


if __name__ == "__main__":
    main()
