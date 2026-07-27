"""PyInstaller entry point: `python run_app.py` or the built .exe.

Pass `--once` to run a single scan-connect-send-exit pass instead of the
normal interactive mode (web UI + browser + continuous background loops).
Meant for an external scheduler like Windows Task Scheduler, e.g. to fire
at a fixed time each morning the computer is reliably on rather than
relying on the app running continuously at the exact moment overnight
that new OPAP numbers become available.
"""

import sys

from led_bridge.main import main, main_once

if __name__ == "__main__":
    if "--once" in sys.argv:
        main_once()
    else:
        main()
