# -*- mode: python ; coding: utf-8 -*-
# Build with: pyinstaller led_bridge.spec (run from the desktop/ directory)

a = Analysis(
    ['run_app.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('led_bridge/static', 'led_bridge/static'),
        ('led_bridge/fonts', 'led_bridge/fonts'),
    ],
    hiddenimports=[
        'bleak.backends.winrt',
        'bleak.backends.winrt.client',
        'bleak.backends.winrt.scanner',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='OPPCLedSignControl',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
