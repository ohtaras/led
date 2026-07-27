"""Automatic BLE scan/connect manager for CoolLED1248 / CoolLEDX signs.

Unlike Web Bluetooth (which requires a user gesture to pick a device, and
whose "remember this device" API turned out not to work on the user's
browser at all), bleak talks to the OS Bluetooth stack directly: signs can
be discovered and connected to fully automatically, with no dialogs.

Mirrors js/ble.js's behavior (serialized writes, wait for the device's ack
notification between chunks) plus js/app.js's device-list/label/selection
bookkeeping, adapted to a single background asyncio task instead of
per-click browser events.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass, field

from bleak import BleakClient, BleakScanner

from . import protocol
from .render import text_to_pixel_bits

log = logging.getLogger("led_bridge.manager")

NAME_PREFIX = "CoolLED"
SCAN_INTERVAL_S = 8.0
SCAN_TIMEOUT_S = 4.0
NOTIFY_TIMEOUT_S = 2.0

_LABELS_PATH = os.path.join(os.path.expanduser("~"), ".coolledx", "labels.json")


def _load_labels() -> dict:
    try:
        with open(_LABELS_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _save_labels(labels: dict) -> None:
    os.makedirs(os.path.dirname(_LABELS_PATH), exist_ok=True)
    with open(_LABELS_PATH, "w", encoding="utf-8") as f:
        json.dump(labels, f, ensure_ascii=False, indent=2)


@dataclass
class Sign:
    address: str
    name: str
    client: BleakClient | None = None
    connected: bool = False
    selected: bool = True
    _notify_event: asyncio.Event | None = field(default=None, repr=False)


class SignManager:
    def __init__(self):
        self.signs: dict[str, Sign] = {}
        self.labels = _load_labels()
        self._op_lock = asyncio.Lock()

    # -- bookkeeping -----------------------------------------------------

    def get_label(self, sign: Sign) -> str:
        return self.labels.get(sign.address) or sign.name or "Sign"

    def set_label(self, address: str, label: str) -> None:
        label = label.strip()
        if label:
            self.labels[address] = label
        else:
            self.labels.pop(address, None)
        _save_labels(self.labels)

    def set_selected(self, address: str, selected: bool) -> None:
        sign = self.signs.get(address)
        if sign:
            sign.selected = selected

    def list_signs(self) -> list[dict]:
        return [
            {
                "id": sign.address,
                "name": self.get_label(sign),
                "bluetoothName": sign.name,
                "connected": sign.connected,
                "selected": sign.selected,
            }
            for sign in self.signs.values()
        ]

    # -- connection lifecycle ---------------------------------------------

    async def scan_and_connect_loop(self) -> None:
        while True:
            try:
                await self.scan_once()
            except Exception:
                log.exception("Scan/connect pass failed")
            await asyncio.sleep(SCAN_INTERVAL_S)

    async def scan_once(self) -> None:
        devices = await BleakScanner.discover(timeout=SCAN_TIMEOUT_S)
        for device in devices:
            if not device.name or not device.name.startswith(NAME_PREFIX):
                continue
            sign = self.signs.get(device.address)
            if sign is None:
                sign = Sign(address=device.address, name=device.name)
                self.signs[device.address] = sign
                log.info("Discovered new sign %s (%s)", device.address, device.name)
            if not sign.connected:
                await self._connect(sign)

    async def _connect(self, sign: Sign) -> None:
        async with self._op_lock:
            if sign.connected:
                return
            try:
                client = BleakClient(sign.address, disconnected_callback=lambda _c, s=sign: self._on_disconnect(s))
                await client.connect()
                sign._notify_event = asyncio.Event()
                await client.start_notify(protocol.CHARACTERISTIC_UUID, lambda _c, _d, s=sign: self._on_notify(s))
                sign.client = client
                sign.connected = True
                log.info("Connected to %s (%s)", sign.address, self.get_label(sign))
            except Exception as exc:
                sign.client = None
                sign.connected = False
                log.info("Connect failed for %s: %s", sign.address, exc)

    def _on_disconnect(self, sign: Sign) -> None:
        sign.connected = False
        sign.client = None
        log.info("%s disconnected", self.get_label(sign))

    def _on_notify(self, sign: Sign) -> None:
        if sign._notify_event is not None:
            sign._notify_event.set()

    async def disconnect(self, address: str) -> None:
        sign = self.signs.get(address)
        if sign and sign.client:
            await sign.client.disconnect()

    # -- sending ------------------------------------------------------------

    async def _send_packets(self, sign: Sign, packets: list[bytes], expect_notify: bool) -> None:
        if not sign.client or not sign.connected:
            raise RuntimeError("Not connected to a sign.")
        for packet in packets:
            if expect_notify and sign._notify_event is not None:
                sign._notify_event.clear()
            await sign.client.write_gatt_char(protocol.CHARACTERISTIC_UUID, packet, response=True)
            if expect_notify and sign._notify_event is not None:
                try:
                    await asyncio.wait_for(sign._notify_event.wait(), NOTIFY_TIMEOUT_S)
                except asyncio.TimeoutError:
                    pass

    async def send_text_to_selected(
        self,
        text: str,
        color: str,
        background_color: str,
        font_px: int,
        device_height: int = 16,
    ) -> dict:
        """Render `text` and push it to every selected, connected sign, one
        at a time (parallel GATT writes to separate peripherals have been
        observed to fail with "GATT operation already in progress").
        """
        targets = [s for s in self.signs.values() if s.selected and s.connected]
        if not targets:
            return {"ok": False, "error": "No signs connected/selected.", "results": []}

        pixel_bits, _width, _height = text_to_pixel_bits(text, color, background_color, font_px, device_height)
        mode_packets = protocol.build_mode_packets(protocol.MODE_LEFT)
        text_packets = protocol.build_text_packets(text, pixel_bits)

        results = []
        async with self._op_lock:
            for sign in targets:
                try:
                    await self._send_packets(sign, mode_packets, expect_notify=False)
                    await self._send_packets(sign, text_packets, expect_notify=True)
                    results.append({"id": sign.address, "name": self.get_label(sign), "ok": True})
                except Exception as exc:
                    results.append({"id": sign.address, "name": self.get_label(sign), "ok": False, "error": str(exc)})

        ok_count = sum(1 for r in results if r["ok"])
        return {"ok": ok_count > 0, "results": results}
