# led

> **Looking for automatic Bluetooth connection?** See [`desktop/`](desktop/)
> for a local desktop app that auto-connects to known signs in the
> background — no browser Bluetooth permission dialogs. The browser-based
> version below requires manually re-adding each sign on some
> Chrome/Edge installs, since `navigator.bluetooth.getDevices()` (needed for
> persistent auto-reconnect) doesn't work everywhere.

A browser-based control panel for **CoolLEDX** flexible LED matrix signs — the
kind paired with the "CoolLED1248" phone app (devices show up as
`CoolLEDX-XXXX` when scanning). It talks directly to the sign over
Bluetooth Low Energy using the [Web Bluetooth API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API),
so no app install or phone is needed — just a laptop with Chrome or Edge.

Static site, no build step, no dependencies.

## Requirements

- **Chrome or Edge on desktop** (or Android Chrome). Web Bluetooth is not
  supported in Safari or Firefox.
- Served over **HTTPS or `http://localhost`** — Web Bluetooth refuses to run
  on a plain `http://` origin or a `file://` page.
- Bluetooth enabled on your computer, and the sign powered on nearby.

## Running it

Any static file server works. For example:

```bash
python3 -m http.server 8080
# then open http://localhost:8080 in Chrome/Edge
```

Or deploy the folder as-is to GitHub Pages / Netlify / Vercel — it's fully
static.

## Using it

1. Click **Connect to sign** and pick your device from the browser's
   Bluetooth chooser.
2. Set **Width/Height** to match your sign (check the label on the
   controller, or the "Pixel: WxH" shown in the CoolLED1248 app's device
   list — height first, e.g. `16x64` means 16 rows tall, 64 columns wide).
3. Type your message, pick a color and display mode, and hit **Send to
   sign**.
4. Brightness/speed sliders and the power/flip buttons apply immediately.

The preview panel renders exactly what will be sent to the sign — the same
1-bit-per-channel (8 color) format the hardware displays, so what you see is
what you get.

## Protocol

The BLE wire protocol (`js/protocol.js`) is a from-scratch JavaScript
reimplementation of the CoolLEDX protocol, built from the public
reverse-engineering work by CrimsonClyde ("LED FaceShields") and the
[UpDryTwist/coolledx-driver](https://github.com/UpDryTwist/coolledx-driver)
Python port. Frames are `0x01 [escaped length + payload] 0x03`; text/image
data is chunked into ≤128-byte pieces with an XOR checksum per chunk. See
that file for the full command table (text, brightness, speed, mode,
power, invert).

## Limitations

- Only text messages are supported (no image/animation upload yet — the
  protocol supports it, see `buildImagePackets` in `js/protocol.js`, but
  there's no file-upload UI for it).
- Multi-color text (the app's `<#rrggbb>text<...>` markers) isn't wired
  into the UI yet — one solid color per message for now.
- Only tested against the protocol logic itself; verify behavior against
  your specific sign, since firmware quirks can vary between hardware
  revisions.
