"""CoolLED1248 / CoolLEDX BLE wire protocol.

Ported from the browser implementation in js/protocol.js (already
byte-verified against the reference driver's framing/escaping/chunking
logic). Kept deliberately dependency-free so it can be unit tested without
a Bluetooth adapter.
"""

from __future__ import annotations

SERVICE_UUID = "0000fff0-0000-1000-8000-00805f9b34fb"
CHARACTERISTIC_UUID = "0000fff1-0000-1000-8000-00805f9b34fb"

CMD_TEXT = 0x02
CMD_MODE = 0x06

MODE_STATIC = 0x01
MODE_LEFT = 0x02
MODE_RIGHT = 0x03
MODE_UP = 0x04
MODE_DOWN = 0x05
MODE_SNOWFLAKE = 0x06
MODE_PICTURE = 0x07
MODE_LASER = 0x08

_CHUNK_SIZE = 128


def _escape_bytes(data: bytes) -> bytes:
    """Escape framing bytes (0x01/0x02/0x03) inside a payload.

    0x02 -> 0x02 0x06, 0x01 -> 0x02 0x05, 0x03 -> 0x02 0x07. 0x02 must be
    escaped first so newly-introduced 0x02 bytes aren't re-escaped.
    """
    out = bytearray()
    for b in data:
        if b == 0x02:
            out += b"\x02\x06"
        elif b == 0x01:
            out += b"\x02\x05"
        elif b == 0x03:
            out += b"\x02\x07"
        else:
            out.append(b)
    return bytes(out)


def create_command(payload: bytes) -> bytes:
    """Wrap a payload as 0x01 [escaped 2-byte-length + payload] 0x03."""
    with_length = len(payload).to_bytes(2, "big") + payload
    escaped = _escape_bytes(with_length)
    return b"\x01" + escaped + b"\x03"


def _xor_checksum(data: bytes) -> int:
    checksum = 0
    for b in data:
        checksum ^= b
    return checksum


def _split_bytes(data: bytes, chunk_size: int) -> list[bytes]:
    chunks = [data[i : i + chunk_size] for i in range(0, len(data), chunk_size)]
    return chunks or [data]


def _chop_up_data(data: bytes, command_byte: int) -> list[bytes]:
    """Split a large payload into <=128 byte chunks with header + XOR checksum."""
    raw_chunks = _split_bytes(data, _CHUNK_SIZE)
    out = []
    for idx, chunk in enumerate(raw_chunks):
        body = bytearray()
        body.append(0x00)
        body += len(data).to_bytes(2, "big")
        body += idx.to_bytes(2, "big")
        body.append(len(chunk) & 0xFF)
        body += chunk
        body.append(_xor_checksum(body))
        out.append(bytes([command_byte]) + bytes(body))
    return out


def build_mode_packets(mode: int) -> list[bytes]:
    return [create_command(bytes([CMD_MODE, mode & 0xFF]))]


def build_text_packets(text: str, pixel_bits: bytes) -> list[bytes]:
    """Build the wire packets for a text/image payload given rendered pixel bits."""
    payload = bytearray(24)  # unknown 24 zero bytes

    codepoints = list(text)
    text_len = len(codepoints)
    if text_len > 255:
        payload += text_len.to_bytes(2, "big")
        buffer_length = 79
    else:
        payload.append(text_len & 0xFF)
        buffer_length = 80

    meta = bytearray(buffer_length)
    for i in range(min(text_len, buffer_length)):
        meta[i] = 0x30
    payload += meta

    payload += len(pixel_bits).to_bytes(2, "big")
    payload += pixel_bits

    raw_chunks = _chop_up_data(bytes(payload), CMD_TEXT)
    return [create_command(c) for c in raw_chunks]
