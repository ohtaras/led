// Renders text to the sign's 1-bit-per-channel RGB bitfield format.
//
// The sign only supports 8 colors per pixel (R/G/B each on or off), packed
// 8 rows per byte, column-major, MSB = topmost row. This mirrors the
// reference driver's `get_separate_pixel_bytefields`.

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const n = parseInt(clean, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

// Text can embed per-segment colors as <#rrggbb>markers, e.g.
// "<#ff0000>HELLO<#00ff00>WORLD" renders HELLO in red and WORLD in green.
// A marker's color applies to everything after it until the next marker (or
// the end of the string) — there's no separate close tag.
const COLOR_START = '<';
const COLOR_END = '>';

function parseColorSegments(text) {
  const parts = [];
  for (const segment of text.split(COLOR_END)) {
    const pieces = segment.split(COLOR_START);
    if (pieces.length === 1) {
      parts.push({ color: null, text: pieces[0] });
    } else {
      parts.push({ color: pieces[pieces.length - 1], text: pieces.slice(0, -1).join('') });
    }
  }
  return parts;
}

/**
 * Draw `text` onto an offscreen canvas and pack it into RGB bitfields sized
 * to `outputHeight` rows (must be a multiple of 8). Returns the concatenated
 * R+G+B byte array plus the natural pixel width used.
 */
export function textToPixelBits(text, { color, backgroundColor, fontFamily, fontPx }, outputHeight) {
  if (outputHeight % 8 !== 0) {
    throw new Error('Sign height must be a multiple of 8');
  }

  const safeText = text.length > 0 ? text : ' ';
  const segments = parseColorSegments(safeText);

  const measure = document.createElement('canvas').getContext('2d');
  measure.font = `${fontPx}px ${fontFamily}`;
  let totalWidth = 0;
  for (const seg of segments) {
    if (seg.text.length > 0) totalWidth += measure.measureText(seg.text).width;
  }
  const textWidth = Math.max(1, Math.ceil(totalWidth));

  const padding = 1;
  const canvasWidth = textWidth + padding * 2;
  const canvasHeight = Math.max(outputHeight, Math.ceil(fontPx * 1.6));

  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  ctx.font = `${fontPx}px ${fontFamily}`;
  ctx.textBaseline = 'top';

  let currentColor = color;
  let xOffset = padding;
  const y = Math.floor((canvasHeight - fontPx) / 2);
  for (const seg of segments) {
    if (seg.text.length > 0) {
      ctx.fillStyle = currentColor;
      ctx.fillText(seg.text, xOffset, y);
      xOffset += ctx.measureText(seg.text).width;
    }
    if (seg.color) {
      currentColor = seg.color;
    }
  }

  const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
  const [bgR, bgG, bgB] = hexToRgb(backgroundColor);
  const topOffset = Math.floor((outputHeight - canvasHeight) / 2);

  const barrR = [];
  const barrG = [];
  const barrB = [];
  let tmpR = 0;
  let tmpG = 0;
  let tmpB = 0;

  for (let x = 0; x < canvasWidth; x++) {
    for (let y = 0; y < outputHeight; y++) {
      const srcY = y - topOffset;
      let r;
      let g;
      let b;
      if (srcY < 0 || srcY >= canvasHeight) {
        r = bgR;
        g = bgG;
        b = bgB;
      } else {
        const idx = (srcY * canvasWidth + x) * 4;
        r = imageData.data[idx];
        g = imageData.data[idx + 1];
        b = imageData.data[idx + 2];
      }

      tmpR = (tmpR << 1) | Math.round(r / 255);
      tmpG = (tmpG << 1) | Math.round(g / 255);
      tmpB = (tmpB << 1) | Math.round(b / 255);

      if (y % 8 === 7) {
        barrR.push(tmpR & 0xff);
        barrG.push(tmpG & 0xff);
        barrB.push(tmpB & 0xff);
        tmpR = 0;
        tmpG = 0;
        tmpB = 0;
      }
    }
  }

  return {
    pixelBits: new Uint8Array([...barrR, ...barrG, ...barrB]),
    width: canvasWidth,
    height: outputHeight,
  };
}

/** Draw a live preview of what the sign will show, upscaled for visibility. */
export function drawPreview(previewCanvas, text, options, deviceWidth, deviceHeight) {
  const { pixelBits, width, height } = textToPixelBits(text, options, deviceHeight);
  const planeSize = (width * height) / 8;
  const rPlane = pixelBits.slice(0, planeSize);
  const gPlane = pixelBits.slice(planeSize, planeSize * 2);
  const bPlane = pixelBits.slice(planeSize * 2, planeSize * 3);

  const scale = Math.max(1, Math.floor(600 / Math.max(width, deviceWidth || width)));
  previewCanvas.width = width * scale;
  previewCanvas.height = height * scale;
  const ctx = previewCanvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const byteIdx = x * (height / 8) + Math.floor(y / 8);
      const bitIdx = 7 - (y % 8);
      const r = (rPlane[byteIdx] >> bitIdx) & 1;
      const g = (gPlane[byteIdx] >> bitIdx) & 1;
      const b = (bPlane[byteIdx] >> bitIdx) & 1;
      if (r || g || b) {
        ctx.fillStyle = `rgb(${r * 255}, ${g * 255}, ${b * 255})`;
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
  }

  return { width, height };
}
