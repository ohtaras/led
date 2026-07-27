"""Local REST API + static file server for the CoolLEDX desktop control panel.

Runs entirely on localhost; the frontend (adapted from the original web app)
talks to it with plain fetch() calls instead of Web Bluetooth, since the
actual Bluetooth connection now lives server-side in manager.SignManager.
"""

from __future__ import annotations

import logging
import os

import aiohttp
from aiohttp import web

from . import settings_store
from ._paths import resource_path
from .manager import SignManager
from .opap import OPAP_GAME_IDS, fetch_jackpot
from .render import render_preview_png_data_uri

log = logging.getLogger("led_bridge.server")

_STATIC_DIR = resource_path("static")

# Fixed to match the signs actually in use (matches DEVICE_WIDTH/HEIGHT
# from the original web app's js/app.js).
DEVICE_WIDTH = 64
DEVICE_HEIGHT = 16


def create_app(manager: SignManager) -> web.Application:
    app = web.Application()
    app["manager"] = manager

    async def on_startup(app: web.Application) -> None:
        app["http_session"] = aiohttp.ClientSession()

    async def on_cleanup(app: web.Application) -> None:
        await app["http_session"].close()

    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)

    async def get_signs(request: web.Request) -> web.Response:
        return web.json_response(manager.list_signs())

    async def rename_sign(request: web.Request) -> web.Response:
        body = await request.json()
        address = body.get("id")
        label = body.get("label", "")
        if not address:
            return web.json_response({"error": "Missing 'id'."}, status=400)
        manager.set_label(address, label)
        return web.json_response(manager.list_signs())

    async def select_sign(request: web.Request) -> web.Response:
        body = await request.json()
        address = body.get("id")
        selected = bool(body.get("selected", True))
        if not address:
            return web.json_response({"error": "Missing 'id'."}, status=400)
        manager.set_selected(address, selected)
        return web.json_response(manager.list_signs())

    async def disconnect_sign(request: web.Request) -> web.Response:
        body = await request.json()
        address = body.get("id")
        if not address:
            return web.json_response({"error": "Missing 'id'."}, status=400)
        await manager.disconnect(address)
        return web.json_response(manager.list_signs())

    async def send(request: web.Request) -> web.Response:
        body = await request.json()
        text = body.get("text", "")
        color = body.get("color", "#ff0000")
        background_color = body.get("backgroundColor", "#000000")
        font_px = int(body.get("fontPx", 13))
        result = await manager.send_text_to_selected(text, color, background_color, font_px, DEVICE_HEIGHT)
        return web.json_response(result)

    async def preview(request: web.Request) -> web.Response:
        body = await request.json()
        text = body.get("text", "")
        color = body.get("color", "#ff0000")
        background_color = body.get("backgroundColor", "#000000")
        font_px = int(body.get("fontPx", 13))
        try:
            data_uri = render_preview_png_data_uri(
                text, color, background_color, font_px, DEVICE_WIDTH, DEVICE_HEIGHT
            )
        except Exception as exc:
            return web.json_response({"error": str(exc)}, status=400)
        return web.json_response({"image": data_uri})

    async def opap(request: web.Request) -> web.Response:
        game = request.query.get("game")
        game_id = OPAP_GAME_IDS.get(game)
        if game_id is None:
            return web.json_response({"error": f"Unknown game '{game}'."}, status=400)
        try:
            amount = await fetch_jackpot(app["http_session"], game_id)
        except Exception as exc:
            return web.json_response({"error": str(exc)}, status=502)
        return web.json_response({"game": game, "amount": amount})

    async def get_settings(request: web.Request) -> web.Response:
        return web.json_response(settings_store.load_settings())

    async def update_settings(request: web.Request) -> web.Response:
        body = await request.json()
        allowed = {k: body[k] for k in ("lottoAmount", "fontPx", "backgroundColor") if k in body}
        return web.json_response(settings_store.save_settings(allowed))

    async def index(request: web.Request) -> web.Response:
        return web.FileResponse(os.path.join(_STATIC_DIR, "index.html"))

    app.router.add_get("/api/signs", get_signs)
    app.router.add_post("/api/signs/rename", rename_sign)
    app.router.add_post("/api/signs/select", select_sign)
    app.router.add_post("/api/signs/disconnect", disconnect_sign)
    app.router.add_post("/api/send", send)
    app.router.add_post("/api/preview", preview)
    app.router.add_get("/api/opap", opap)
    app.router.add_get("/api/settings", get_settings)
    app.router.add_post("/api/settings", update_settings)
    app.router.add_get("/", index)
    app.router.add_static("/", _STATIC_DIR, show_index=False)

    return app
