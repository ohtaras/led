# OPPC LED Sign Control — desktop app

A local Windows/Mac/Linux app that controls **CoolLEDX** flexible LED matrix
signs, with fully automatic Bluetooth connection — no clicking "Add sign"
every time, no browser Bluetooth permission dialogs.

This exists because [Web Bluetooth's persistent-permission API](https://developer.mozilla.org/en-US/docs/Web/API/Bluetooth/getDevices)
(`navigator.bluetooth.getDevices()`), which the browser-based version in the
repo root relies on for auto-reconnect, turned out not to work at all in
some Chrome/Edge installs. This app sidesteps that entirely by talking to
the OS Bluetooth stack directly (via [bleak](https://github.com/hbldh/bleak)),
so it can scan for and connect to known signs completely automatically.

## How it works

A small local Python web server (`aiohttp`) owns the actual Bluetooth
connections and serves the same-look control panel UI at
`http://localhost:8934`. The browser tab is just the UI — all Bluetooth
happens server-side, so the page needs no special permissions and reconnects
signs automatically in the background as soon as they're powered on and in
range.

## Running it (prebuilt executable — recommended)

1. Go to the repo's **Actions** tab → **Build desktop app (Windows)** → the
   latest successful run → download the `OPPCLedSignControl-windows`
   artifact, and unzip it.
2. Run `OPPCLedSignControl.exe`. A console window opens (for logs) and your
   browser opens automatically to the control panel.
3. Leave both windows open while you use it. Closing the console window
   stops the app (and disconnects the signs).

## Running it from source

Requires Python 3.11+.

```bash
cd desktop
pip install -r requirements.txt
python run_app.py
```

## Building the .exe yourself

```bash
cd desktop
pip install -r requirements.txt
pyinstaller led_bridge.spec
# -> dist/OPPCLedSignControl.exe
```

The same steps run automatically on every push via
`.github/workflows/build-desktop.yml` (Windows runner), so you normally
don't need to build it locally — just grab the Actions artifact.

## Running automatically on Windows startup (optional)

1. Press `Win+R`, type `shell:startup`, hit Enter.
2. Copy a shortcut to `OPPCLedSignControl.exe` into that folder.

The app will then start (and begin auto-connecting to signs) whenever you
log in. Combined with the automatic OPAP updates below, the whole thing
runs unattended as long as the computer is on and logged in.

## Automatic OPAP updates

The app fetches the live Τζόκερ/EuroJackpot jackpot amounts, rebuilds the
ticker message, and sends it to every connected sign **on its own**, just
after midnight on each day those amounts actually change: **Tuesday,
Thursday, Friday, and Sunday**. No button press needed. The Λόττο amount
(fixed) and font size/background color used for these automatic runs are
whatever was last set in the control panel UI — they're saved to
`~/.coolledx/settings.json` so they're available even with no browser
open.

## Project layout

- `led_bridge/protocol.py` — BLE wire protocol (framing/escaping/chunking),
  ported from `js/protocol.js` in the root browser app.
- `led_bridge/render.py` — multi-color text → 1-bit-per-channel RGB pixel
  bitfields, ported from `js/render.js`, using Pillow + a bundled DejaVu
  Sans font (supports Greek + €).
- `led_bridge/manager.py` — background BLE scan/connect loop (bleak),
  sign bookkeeping (nicknames, selection), serialized sends.
- `led_bridge/opap.py` / `led_bridge/messages.py` — OPAP fetch + ticker
  message building, shared by the manual "Fetch from OPAP" button and the
  automatic scheduler.
- `led_bridge/scheduler.py` — background loop that triggers the automatic
  Tue/Thu/Fri/Sun midnight update.
- `led_bridge/settings_store.py` — persisted Λόττο amount/font/background
  color (`~/.coolledx/settings.json`).
- `led_bridge/server.py` — local REST API (`/api/signs`, `/api/send`,
  `/api/preview`, `/api/opap`, `/api/settings`, ...) + static file serving.
- `led_bridge/static/` — the control panel UI (adapted from the root
  browser app; talks to the REST API with `fetch()` instead of Web
  Bluetooth).
- `led_bridge/main.py` / `run_app.py` — entry point.
- `led_bridge.spec` — PyInstaller build spec.

## Limitations

- Nicknames are stored in `~/.coolledx/labels.json` on the machine running
  the app (not synced anywhere).
- The preview is rendered with Pillow rather than a browser's text
  renderer, so exact letter shapes/kerning can differ slightly from the
  sign — it's still byte-accurate to what actually gets sent, since the
  preview image is decoded from the same pixel data.
- The automatic midnight update only runs while the app is actually
  running (and the computer is on/awake) at that moment — use the Windows
  startup shortcut above if you want it truly unattended.
