"""Entry point: starts the local web server, opens the browser, and runs
the automatic BLE scan/connect loop for CoolLED1248 / CoolLEDX signs.
"""

from __future__ import annotations

import asyncio
import logging
import webbrowser

from aiohttp import web

from .manager import SignManager
from .server import create_app

HOST = "127.0.0.1"
PORT = 8934


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
    try:
        await scan_task
    finally:
        await runner.cleanup()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    try:
        asyncio.run(_run())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
