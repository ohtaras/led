"""Builds the default jackpot ticker message text (with color markers),
mirroring static/js/app.js's buildMessageFromAmounts() so the automated
scheduler can build the exact same message without a browser involved.
"""

from __future__ import annotations


def format_euro(value: float) -> str:
    """Greek-style grouping: dot as thousands separator, no decimals."""
    return f"{round(value):,}".replace(",", ".")


def build_jackpot_message(tzoker: float, lotto: float, eurojackpot: float) -> str:
    # Each part of the ticker gets its own color, matching the multi-color
    # look of the reference app's messages instead of one flat color.
    segments = [
        ("JACKPOT TZOKER ", "#ffffff"),
        (f"{format_euro(tzoker)}€ ", "#00ff00"),
        ("– ΛΟΤΤΟ ", "#ffffff"),
        (f"{format_euro(lotto)}€ ", "#00ff00"),
        ("ΚΑΘΕ ΜΗΝΑ !!! – EUROJACKPOT ", "#ffffff"),
        (f"{format_euro(eurojackpot)}€", "#00ff00"),
    ]

    parts = []
    last_color = None
    for text, color in segments:
        if color != last_color:
            parts.append(f"<{color}>")
            last_color = color
        parts.append(text)
    return "".join(parts)
