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
log in. Useful if you want the interactive control panel available without
having to double-click the exe every time.

## Automatic OPAP updates

The Τζόκερ/EuroJackpot jackpot amounts change overnight, just after
midnight, on **Tuesday, Thursday, Friday, and Sunday**. If your computer is
reliably on and running the app at that exact moment, that update happens
on its own with no button press. If it isn't (e.g. the computer is off
overnight), use **Windows Task Scheduler** instead to run a quick
scan → fetch → send → exit pass at a time your computer *is* on, e.g.
9:00 AM on those same days:

1. Open **Task Scheduler** (search for it in the Start menu) → **Create Task…** (not "Create Basic Task", so all options below are available).
2. **General** tab: name it e.g. `OPPC LED Update`.
3. **Triggers** tab → **New…** → Begin the task: `On a schedule` → `Weekly` → tick **Tuesday, Thursday, Friday, Sunday** → set the start time to `9:00:00 AM`.
4. **Actions** tab → **New…** → Action: `Start a program` → **Program/script**: browse to your `OPPCLedSignControl.exe` → **Add arguments**: `--once`.
5. **Settings** tab → tick **"Run task as soon as possible after a scheduled start is missed"** (catches up if the computer happened to be off/asleep right at 9:00).
6. Click OK (enter your Windows password if prompted, only needed if you chose "Run whether user is logged on or not" on the General tab).

With `--once`, the app doesn't open a browser or stay running — it scans
for known signs, waits up to a minute for them to connect, fetches OPAP,
sends the ticker message, then exits by itself. The Λόττο amount (fixed)
and font size/background color it uses are whatever was last set in the
control panel UI — saved to `~/.coolledx/settings.json` so they're
available even with no browser open.

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
- `led_bridge/main.py` / `run_app.py` — entry point (`--once` for a
  single scan/fetch/send/exit pass, for Task Scheduler).
- `led_bridge.spec` — PyInstaller build spec.

## Limitations

- Nicknames are stored in `~/.coolledx/labels.json` on the machine running
  the app (not synced anywhere).
- The preview is rendered with Pillow rather than a browser's text
  renderer, so exact letter shapes/kerning can differ slightly from the
  sign — it's still byte-accurate to what actually gets sent, since the
  preview image is decoded from the same pixel data.
- `--once` needs the computer awake (not asleep/hibernating) at the
  scheduled time — Task Scheduler can wake some machines for a task (an
  extra checkbox on the trigger's "Conditions" tab), but this isn't
  universal across all hardware.
