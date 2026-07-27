"""Text-to-pixel-bits rendering for the CoolLED1248 / CoolLEDX signs.

Ported from js/render.js. The sign only supports 8 colors per pixel (R/G/B
each on or off), packed 8 rows per byte, column-major, MSB = topmost row.

Browser <canvas> text rendering can't be reproduced pixel-for-pixel outside
a browser, so this uses Pillow with a bundled DejaVu Sans font (supports
Greek + the euro sign) as a close, dependency-free approximation.
"""

from __future__ import annotations

import base64
import io
import math
from functools import lru_cache

from PIL import Image, ImageDraw, ImageFont

from ._paths import resource_path

_FONT_PATH = resource_path("fonts", "DejaVuSans.ttf")

COLOR_START = "<"
COLOR_END = ">"


def hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    clean = hex_color.lstrip("#")
    n = int(clean, 16)
    return ((n >> 16) & 0xFF, (n >> 8) & 0xFF, n & 0xFF)


def parse_color_segments(text: str) -> list[dict]:
    """Split text on <#rrggbb> markers; a marker's color applies to
    everything after it until the next marker (or the end of the string).
    """
    parts = []
    for segment in text.split(COLOR_END):
        pieces = segment.split(COLOR_START)
        if len(pieces) == 1:
            parts.append({"color": None, "text": pieces[0]})
        else:
            parts.append({"color": pieces[-1], "text": "".join(pieces[:-1])})
    return parts


@lru_cache(maxsize=32)
def _font(font_px: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(_FONT_PATH, font_px)


def text_to_pixel_bits(
    text: str,
    color: str,
    background_color: str,
    font_px: int,
    output_height: int,
) -> tuple[bytes, int, int]:
    """Render `text` and pack it into RGB bitfields sized to `output_height`
    rows (must be a multiple of 8). Returns (pixel_bits, width, height).
    """
    if output_height % 8 != 0:
        raise ValueError("Sign height must be a multiple of 8")

    safe_text = text if len(text) > 0 else " "
    segments = parse_color_segments(safe_text)

    font = _font(font_px)
    total_width = 0.0
    for seg in segments:
        if seg["text"]:
            total_width += font.getlength(seg["text"])
    text_width = max(1, math.ceil(total_width))

    padding = 1
    canvas_width = text_width + padding * 2
    canvas_height = max(output_height, math.ceil(font_px * 1.6))

    image = Image.new("RGB", (canvas_width, canvas_height), hex_to_rgb(background_color))
    draw = ImageDraw.Draw(image)

    current_color = color
    x_offset = float(padding)
    y = (canvas_height - font_px) // 2
    for seg in segments:
        if seg["text"]:
            draw.text((x_offset, y), seg["text"], font=font, fill=hex_to_rgb(current_color), anchor="la")
            x_offset += font.getlength(seg["text"])
        if seg["color"]:
            current_color = seg["color"]

    pixels = image.load()
    bg_r, bg_g, bg_b = hex_to_rgb(background_color)
    top_offset = (output_height - canvas_height) // 2

    barr_r = bytearray()
    barr_g = bytearray()
    barr_b = bytearray()

    for x in range(canvas_width):
        tmp_r = tmp_g = tmp_b = 0
        for y in range(output_height):
            src_y = y - top_offset
            if src_y < 0 or src_y >= canvas_height:
                r, g, b = bg_r, bg_g, bg_b
            else:
                r, g, b = pixels[x, src_y]

            tmp_r = ((tmp_r << 1) | (1 if r >= 128 else 0)) & 0xFF
            tmp_g = ((tmp_g << 1) | (1 if g >= 128 else 0)) & 0xFF
            tmp_b = ((tmp_b << 1) | (1 if b >= 128 else 0)) & 0xFF

            if y % 8 == 7:
                barr_r.append(tmp_r)
                barr_g.append(tmp_g)
                barr_b.append(tmp_b)
                tmp_r = tmp_g = tmp_b = 0

    pixel_bits = bytes(barr_r) + bytes(barr_g) + bytes(barr_b)
    return pixel_bits, canvas_width, output_height


def render_preview_png_data_uri(
    text: str,
    color: str,
    background_color: str,
    font_px: int,
    device_width: int,
    device_height: int,
    max_pixels: int = 600,
) -> str:
    """Render exactly what would be sent to the sign, upscaled for
    visibility, as a data: URI so the frontend can show a byte-accurate
    preview without duplicating any rendering/parsing logic in JS.
    """
    pixel_bits, width, height = text_to_pixel_bits(text, color, background_color, font_px, device_height)
    plane_size = (width * height) // 8
    r_plane = pixel_bits[0:plane_size]
    g_plane = pixel_bits[plane_size : plane_size * 2]
    b_plane = pixel_bits[plane_size * 2 : plane_size * 3]

    image = Image.new("RGB", (width, height), (0, 0, 0))
    pixels = image.load()
    rows_per_byte = height // 8
    for x in range(width):
        for y in range(height):
            byte_idx = x * rows_per_byte + (y // 8)
            bit_idx = 7 - (y % 8)
            r = (r_plane[byte_idx] >> bit_idx) & 1
            g = (g_plane[byte_idx] >> bit_idx) & 1
            b = (b_plane[byte_idx] >> bit_idx) & 1
            pixels[x, y] = (r * 255, g * 255, b * 255)

    scale = max(1, max_pixels // max(width, device_width or width))
    image = image.resize((width * scale, height * scale), Image.NEAREST)

    buf = io.BytesIO()
    image.save(buf, format="PNG")
    encoded = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"
