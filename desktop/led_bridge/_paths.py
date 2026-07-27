"""Resource path resolution that works both when running from source and
when frozen into a single executable by PyInstaller (whose --add-data
files get extracted under sys._MEIPASS, preserving the led_bridge/... tree).
"""

from __future__ import annotations

import os
import sys


def resource_path(*parts: str) -> str:
    if hasattr(sys, "_MEIPASS"):
        base = sys._MEIPASS
    else:
        base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, "led_bridge", *parts)
