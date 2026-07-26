import { CoolLedClient, getKnownDevices } from './ble.js';
import { MODE, buildModePackets, buildTextPackets } from './protocol.js';
import { textToPixelBits, drawPreview } from './render.js';

const $ = (id) => document.getElementById(id);

const els = {
  connectBtn: $('connectBtn'),
  status: $('status'),
  panel: $('controlPanel'),
  unsupported: $('unsupported'),
  deviceList: $('deviceList'),
  width: $('deviceWidth'),
  height: $('deviceHeight'),
  text: $('textInput'),
  color: $('textColor'),
  bgColor: $('bgColor'),
  fontSize: $('fontSize'),
  mode: $('modeSelect'),
  tzokerAmount: $('tzokerAmount'),
  lottoAmount: $('lottoAmount'),
  eurojackpotAmount: $('eurojackpotAmount'),
  fetchOpapBtn: $('fetchOpapBtn'),
  buildMessageBtn: $('buildMessageBtn'),
  sendBtn: $('sendBtn'),
  preview: $('preview'),
  log: $('log'),
};

// Each known sign is { device, client, selected }. `device` is a
// BluetoothDevice (from a prior grant or a fresh chooser pick); `client` is
// null until actually connected. Multiple signs can be connected at once;
// "selected" controls whether a bulk action applies to a connected one.
const devices = [];

// Custom nicknames per physical sign, persisted across sessions and keyed by
// the Web Bluetooth device id (stable per physical device + browser origin).
const LABELS_KEY = 'coolledx-labels';

function loadLabels() {
  try {
    return JSON.parse(localStorage.getItem(LABELS_KEY)) || {};
  } catch {
    return {};
  }
}

function saveLabels(labels) {
  localStorage.setItem(LABELS_KEY, JSON.stringify(labels));
}

const labels = loadLabels();

function getLabel(device) {
  return (device && device.id && labels[device.id]) || (device && device.name) || 'Sign';
}

function setLabel(device, label) {
  if (!device || !device.id) return;
  const trimmed = label.trim();
  if (trimmed) {
    labels[device.id] = trimmed;
  } else {
    delete labels[device.id];
  }
  saveLabels(labels);
}

function log(message, kind = 'info') {
  const line = document.createElement('div');
  line.className = `log-line log-${kind}`;
  const time = new Date().toLocaleTimeString();
  line.textContent = `[${time}] ${message}`;
  els.log.prepend(line);
}

async function withBusy(fn) {
  els.panel.classList.add('busy');
  try {
    await fn();
  } catch (err) {
    log(err.message, 'error');
  } finally {
    els.panel.classList.remove('busy');
  }
}

async function connectDevice(dev, { silent = false } = {}) {
  await withBusy(async () => {
    if (!dev.client) {
      dev.client = new CoolLedClient(dev.device);
      dev.client.addEventListener('connected', () => {
        log(`Connected to ${getLabel(dev.device)}`, 'success');
        renderDeviceList();
      });
      dev.client.addEventListener('disconnected', () => {
        log(`${getLabel(dev.device)} disconnected`, 'error');
        renderDeviceList();
      });
    }
    try {
      await dev.client.connect();
      renderDeviceList();
    } catch (err) {
      renderDeviceList();
      if (!silent) throw err;
    }
  });
}

function renderDeviceList() {
  els.deviceList.innerHTML = '';
  if (devices.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    if (navigator.bluetooth && !navigator.bluetooth.getDevices) {
      empty.textContent =
        'This browser can\'t remember previously granted signs, so this list will always start ' +
        'empty. Click "+ Add sign" (top right) each time you want to (re)connect one.';
    } else {
      empty.textContent = 'No signs yet. Click "+ Add sign" (top right) to grant access to one.';
    }
    els.deviceList.appendChild(empty);
  }
  for (const dev of devices) {
    const row = document.createElement('div');
    row.className = 'device-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = dev.selected;
    checkbox.addEventListener('change', () => {
      dev.selected = checkbox.checked;
    });

    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'device-name';
    name.value = getLabel(dev.device);
    name.title = `Bluetooth name: ${dev.device.name || 'unknown'}`;
    name.addEventListener('change', () => {
      setLabel(dev.device, name.value);
      renderDeviceList();
    });

    const isConnected = !!(dev.client && dev.client.connected);

    const status = document.createElement('span');
    status.className = 'device-status';
    status.textContent = isConnected ? 'connected' : 'available';

    const actionBtn = document.createElement('button');
    actionBtn.className = 'secondary small';
    if (isConnected) {
      actionBtn.textContent = 'Disconnect';
      actionBtn.addEventListener('click', () => dev.client.disconnect());
    } else {
      actionBtn.textContent = 'Connect';
      actionBtn.addEventListener('click', () => connectDevice(dev));
    }

    row.append(checkbox, name, status, actionBtn);
    els.deviceList.appendChild(row);
  }

  const connectedCount = devices.filter((d) => d.client && d.client.connected).length;
  els.status.textContent = connectedCount > 0 ? `${connectedCount} sign(s) connected` : '';
  els.panel.classList.toggle('disabled', connectedCount === 0);
}

async function initKnownDevices() {
  const known = await getKnownDevices();
  log(`Auto-reconnect: found ${known.length} previously-granted sign(s).`);
  for (const device of known) {
    if (!devices.some((d) => d.device.id === device.id)) {
      devices.push({ device, client: null, selected: true });
    }
  }
  renderDeviceList();

  // Try to reconnect every already-granted sign automatically, one at a
  // time. This needs no click because the browser already trusts these
  // devices; ones that are off or out of range simply fail quietly and stay
  // listed as "available" for a manual retry later.
  for (const dev of devices) {
    log(`Auto-reconnect: trying ${getLabel(dev.device)}...`);
    await connectDevice(dev, { silent: true });
  }
}

function selectedClients() {
  return devices.filter((d) => d.selected && d.client && d.client.connected).map((d) => d.client);
}

function renderPreview() {
  const width = parseInt(els.width.value, 10);
  const height = parseInt(els.height.value, 10);
  try {
    drawPreview(
      els.preview,
      els.text.value,
      {
        color: els.color.value,
        backgroundColor: els.bgColor.value,
        fontFamily: 'sans-serif',
        fontPx: parseInt(els.fontSize.value, 10),
      },
      width,
      height,
    );
  } catch (err) {
    log(`Preview error: ${err.message}`, 'error');
  }
}

/**
 * Run `action` on every selected, connected sign, one at a time. Some
 * Bluetooth stacks (notably on Windows) throw "GATT operation already in
 * progress" when two peripherals are written to concurrently, even though
 * they're on separate connections, so signs are handled sequentially rather
 * than in parallel.
 */
async function runOnSelected(action, actionName) {
  const targets = selectedClients();
  if (targets.length === 0) {
    log('No signs selected.', 'error');
    return;
  }
  const failures = [];
  for (const client of targets) {
    try {
      await action(client);
    } catch (reason) {
      failures.push({ client, reason });
    }
  }
  const okCount = targets.length - failures.length;
  if (failures.length === 0) {
    log(`${actionName}: done on ${okCount} sign(s).`, 'success');
  } else {
    log(`${actionName}: ${okCount} succeeded, ${failures.length} failed.`, 'error');
    failures.forEach(({ client, reason }) => log(`${getLabel(client.device)}: ${reason.message}`, 'error'));
  }
}

els.connectBtn.addEventListener('click', async () => {
  await withBusy(async () => {
    log('Requesting Bluetooth device...');
    const client = new CoolLedClient();
    client.addEventListener('connected', () => {
      log(`Connected to ${getLabel(client.device)}`, 'success');
      renderDeviceList();
    });
    client.addEventListener('disconnected', () => {
      log(`${getLabel(client.device)} disconnected`, 'error');
      renderDeviceList();
    });
    await client.connect();

    let dev = devices.find((d) => d.device.id === client.device.id);
    if (dev) {
      dev.client = client;
    } else {
      dev = { device: client.device, client, selected: true };
      devices.push(dev);
    }
    renderDeviceList();
  });
});

els.sendBtn.addEventListener('click', async () => {
  await withBusy(async () => {
    const height = parseInt(els.height.value, 10);
    const { pixelBits } = textToPixelBits(
      els.text.value,
      {
        color: els.color.value,
        backgroundColor: els.bgColor.value,
        fontFamily: 'sans-serif',
        fontPx: parseInt(els.fontSize.value, 10),
      },
      height,
    );
    const packets = buildTextPackets(els.text.value, pixelBits);
    await runOnSelected((client) => client.sendPackets(packets, { expectNotify: true }), 'Send text');
  });
});

function formatEuro(value) {
  return Number(value || 0).toLocaleString('el-GR');
}

// OPAP's public "active draw" endpoint, keyed by their internal game id.
// prizeCategories[0] is the jackpot category; the advertised amount is
// whichever is larger of the currently accumulated pool ("jackpot") and the
// guaranteed minimum for the next draw ("minimumDistributed").
const OPAP_GAME_IDS = { tzoker: 5104, eurojackpot: 5149 };

async function fetchOpapJackpot(gameId) {
  const res = await fetch(`https://api.opap.gr/draws/v3.0/${gameId}/active`);
  if (!res.ok) {
    throw new Error(`OPAP request failed: HTTP ${res.status}`);
  }
  const data = await res.json();
  const category = data.prizeCategories.find((c) => c.categoryType === 0) || data.prizeCategories[0];
  return Math.max(category.jackpot || 0, category.minimumDistributed || 0);
}

els.fetchOpapBtn.addEventListener('click', async () => {
  await withBusy(async () => {
    try {
      const [tzoker, eurojackpot] = await Promise.all([
        fetchOpapJackpot(OPAP_GAME_IDS.tzoker),
        fetchOpapJackpot(OPAP_GAME_IDS.eurojackpot),
      ]);
      els.tzokerAmount.value = Math.round(tzoker);
      els.eurojackpotAmount.value = Math.round(eurojackpot);
      log(`Fetched from OPAP: Τζόκερ ${formatEuro(tzoker)}€, EuroJackpot ${formatEuro(eurojackpot)}€`, 'success');
    } catch (err) {
      log(`OPAP fetch failed (${err.message}) — enter amounts manually instead.`, 'error');
    }
  });
});

els.buildMessageBtn.addEventListener('click', () => {
  const tzoker = formatEuro(els.tzokerAmount.value);
  const lotto = formatEuro(els.lottoAmount.value);
  const eurojackpot = formatEuro(els.eurojackpotAmount.value);
  els.text.value =
    `JACKPOT TZOKER ${tzoker}€ – ΛΟΤΤΟ ${lotto}€ ΚΑΘΕ ΜΗΝΑ !!! – EUROJACKPOT ${eurojackpot}€`;
  renderPreview();
});

els.mode.addEventListener('change', async () => {
  await withBusy(async () => {
    const mode = MODE[els.mode.value];
    await runOnSelected(
      (client) => client.sendPackets(buildModePackets(mode), { expectNotify: false }),
      `Mode set to ${els.mode.value}`,
    );
  });
});

[els.text, els.color, els.bgColor, els.fontSize, els.width, els.height].forEach((el) => {
  el.addEventListener('input', renderPreview);
});

document.querySelectorAll('#colorPalette .swatch').forEach((swatch) => {
  swatch.addEventListener('click', () => {
    const input = els.text;
    const color = swatch.dataset.color;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    const before = input.value.slice(0, start);
    const selected = input.value.slice(start, end);
    const after = input.value.slice(end);
    const baseColor = els.color.value;

    // No selection: just start a new color run from the cursor onward.
    // A selection: wrap just that part in the color, reverting to the
    // current base color afterward if there's more text following it.
    const inserted =
      selected.length > 0
        ? after.length > 0
          ? `<${color}>${selected}<${baseColor}>`
          : `<${color}>${selected}`
        : `<${color}>`;

    input.value = before + inserted + after;
    const cursorPos = before.length + inserted.length;
    input.setSelectionRange(cursorPos, cursorPos);
    input.focus();
    els.color.value = color;
    renderPreview();
  });
});

if (!navigator.bluetooth) {
  els.unsupported.hidden = false;
  els.connectBtn.disabled = true;
}

renderDeviceList();
renderPreview();
initKnownDevices();
