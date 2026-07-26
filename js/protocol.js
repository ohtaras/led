// CoolLED1248 / CoolLEDX BLE wire protocol.
//
// Reimplemented from the community reverse-engineering of the protocol used
// by "CoolLEDX" flexible LED matrix signs (the ones paired via the
// CoolLED1248 phone app). Reference: CrimsonClyde's LED FaceShields project
// and the UpDryTwist/coolledx-driver Python port.

export const SERVICE_UUID = '0000fff0-0000-1000-8000-00805f9b34fb';
export const CHARACTERISTIC_UUID = '0000fff1-0000-1000-8000-00805f9b34fb';

export const CMD = {
  MUSIC: 0x01,
  TEXT: 0x02,
  IMAGE: 0x03,
  ANIMATION: 0x04,
  ICON: 0x05,
  MODE: 0x06,
  SPEED: 0x07,
  BRIGHTNESS: 0x08,
  SWITCH: 0x09,
  TRANSFER: 0x0a,
  INVERT_DISPLAY: 0x0c,
  CLEAR_MAYBE: 0x0d,
  SHOW_ICON: 0x11,
  POWER_DOWN: 0x12,
  POWER_ON: 0x13,
  INVERT_OR_SOMETHING: 0x15,
  INITIALIZE: 0x23,
};

export const MODE = {
  STATIC: 0x01,
  LEFT: 0x02,
  RIGHT: 0x03,
  UP: 0x04,
  DOWN: 0x05,
  SNOWFLAKE: 0x06,
  PICTURE: 0x07,
  LASER: 0x08,
};

const CHUNK_SIZE = 128;

function u16be(n) {
  return [(n >> 8) & 0xff, n & 0xff];
}

// Framing bytes (0x01, 0x02, 0x03) that appear inside the payload must be
// escaped so the receiver can tell them apart from the start/end markers.
// 0x02 -> 0x02 0x06, 0x01 -> 0x02 0x05, 0x03 -> 0x02 0x07 (order matters:
// 0x02 must be escaped first so newly-introduced 0x02 bytes aren't re-escaped).
function escapeBytes(bytes) {
  const out = [];
  for (const b of bytes) {
    if (b === 0x02) out.push(0x02, 0x06);
    else if (b === 0x01) out.push(0x02, 0x05);
    else if (b === 0x03) out.push(0x02, 0x07);
    else out.push(b);
  }
  return out;
}

// Wrap a payload as 0x01 [escaped 2-byte-length + payload] 0x03.
function createCommand(payloadBytes) {
  const withLength = [...u16be(payloadBytes.length), ...payloadBytes];
  const escaped = escapeBytes(withLength);
  return new Uint8Array([0x01, ...escaped, 0x03]);
}

function xorChecksum(bytes) {
  let c = 0;
  for (const b of bytes) c ^= b;
  return c;
}

function splitBytes(data, chunkSize) {
  const chunks = [];
  for (let i = 0; i < data.length; i += chunkSize) {
    chunks.push(data.slice(i, i + chunkSize));
  }
  return chunks.length ? chunks : [data];
}

// Large payloads (text/image/animation pixel data) get split into <=128
// byte chunks, each with a small header (unknown 0x00, total length,
// chunk index, chunk size) and an XOR checksum, all prefixed with the
// command byte.
function chopUpData(data, commandByte) {
  const rawChunks = splitBytes(data, CHUNK_SIZE);
  return rawChunks.map((chunk, idx) => {
    const body = [0x00, ...u16be(data.length), ...u16be(idx), chunk.length & 0xff, ...chunk];
    body.push(xorChecksum(body));
    return new Uint8Array([commandByte, ...body]);
  });
}

function simplePacket(cmdByte, ...valueBytes) {
  return [createCommand(new Uint8Array([cmdByte, ...valueBytes]))];
}

export function buildSpeedPackets(speed) {
  return simplePacket(CMD.SPEED, speed & 0xff);
}

export function buildBrightnessPackets(brightness) {
  return simplePacket(CMD.BRIGHTNESS, brightness & 0xff);
}

export function buildModePackets(mode) {
  return simplePacket(CMD.MODE, mode & 0xff);
}

export function buildPowerPackets(on) {
  return simplePacket(CMD.SWITCH, on ? 0x01 : 0x00);
}

export function buildInvertDisplayPackets(inverted) {
  return simplePacket(CMD.INVERT_DISPLAY, inverted ? 0x01 : 0x00);
}

export function buildInitializePackets() {
  return simplePacket(CMD.INITIALIZE, 0x01);
}

export function buildPowerDownPackets() {
  return [createCommand(new Uint8Array([CMD.POWER_DOWN]))];
}

// Build the full multi-chunk wire packets for a rendered text/image payload
// (the "24 zero bytes + text length + char metadata + pixel length + pixel
// bits" structure the sign expects), given already rendered RGB bitfields.
export function buildTextPackets(text, pixelBits) {
  const payload = [];
  payload.push(...new Array(24).fill(0));

  const codepoints = [...text];
  const textLen = codepoints.length;
  let bufferLength = 80;
  if (textLen > 255) {
    payload.push((textLen >> 8) & 0xff, textLen & 0xff);
    bufferLength = 79;
  } else {
    payload.push(textLen & 0xff);
  }
  const meta = new Array(bufferLength).fill(0);
  for (let i = 0; i < Math.min(textLen, bufferLength); i++) meta[i] = 0x30;
  payload.push(...meta);

  payload.push(...u16be(pixelBits.length));
  payload.push(...pixelBits);

  const rawChunks = chopUpData(new Uint8Array(payload), CMD.TEXT);
  return rawChunks.map(createCommand);
}

export function buildImagePackets(pixelBits) {
  const payload = [];
  payload.push(...new Array(24).fill(0));
  payload.push(...u16be(pixelBits.length));
  payload.push(...pixelBits);

  const rawChunks = chopUpData(new Uint8Array(payload), CMD.IMAGE);
  return rawChunks.map(createCommand);
}
