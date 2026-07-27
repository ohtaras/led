"""Persisted user settings (Lotto amount, font size, background color).

These need to survive app restarts and be readable without a browser open,
since the automated midnight scheduler builds/sends the ticker message
using whatever was last configured through the UI.
"""

from __future__ import annotations

import json
import os

_SETTINGS_PATH = os.path.join(os.path.expanduser("~"), ".coolledx", "settings.json")

DEFAULT_SETTINGS = {
    "lottoAmount": 10000,
    "fontPx": 13,
    "backgroundColor": "#000000",
}


def load_settings() -> dict:
    try:
        with open(_SETTINGS_PATH, "r", encoding="utf-8") as f:
            stored = json.load(f)
    except (OSError, ValueError):
        stored = {}
    return {**DEFAULT_SETTINGS, **stored}


def save_settings(settings: dict) -> dict:
    merged = {**load_settings(), **settings}
    os.makedirs(os.path.dirname(_SETTINGS_PATH), exist_ok=True)
    with open(_SETTINGS_PATH, "w", encoding="utf-8") as f:
        json.dump(merged, f, ensure_ascii=False, indent=2)
    return merged
