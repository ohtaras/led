import { CoolLedClient } from './ble.js';
import {
  MODE,
  buildSpeedPackets,
  buildBrightnessPackets,
  buildModePackets,
  buildPowerPackets,
  buildInvertDisplayPackets,
  buildTextPackets,
} from './protocol.js';
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
  speed: $('speedSlider'),
  speedVal: $('speedVal'),
  brightness: $('brightnessSlider'),
  brightnessVal: $('brightnessVal'),
  sendBtn: $('sendBtn'),
  powerOnBtn: $('powerOnBtn'),
  powerOffBtn: $('powerOffBtn'),
  invertBtn: $('invertBtn'),
  identifyBtn: $('identifyBtn'),
  preview: $('preview'),
  log: $('log'),
};

// Each connected sign is { client, selected }. Multiple signs can be
// connected at once; "selected" controls whether an action applies to it.
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

function getLabel(client) {
  return (client.deviceId && labels[client.deviceId]) || client.deviceName || 'Sign';
}

function setLabel(client, label) {
  if (!client.deviceId) return;
  const trimmed = label.trim();
  if (trimmed) {
    labels[client.deviceId] = trimmed;
  } else {
    delete labels[client.deviceId];
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

function renderDeviceList() {
  els.deviceList.innerHTML = '';
  if (devices.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'No signs connected yet.';
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
    name.value = getLabel(dev.client);
    name.title = `Bluetooth name: ${dev.client.deviceName || 'unknown'}`;
    name.addEventListener('change', () => {
      setLabel(dev.client, name.value);
      renderDeviceList();
    });

    const status = document.createElement('span');
    status.className = 'device-status';
    status.textContent = dev.client.connected ? 'connected' : 'disconnected';

    const disconnectBtn = document.createElement('button');
    disconnectBtn.className = 'secondary small';
    disconnectBtn.textContent = 'Disconnect';
    disconnectBtn.addEventListener('click', () => dev.client.disconnect());

    row.append(checkbox, name, status, disconnectBtn);
    els.deviceList.appendChild(row);
  }

  const connectedCount = devices.filter((d) => d.client.connected).length;
  els.status.textContent = connectedCount > 0 ? `${connectedCount} sign(s) connected` : '';
  els.panel.classList.toggle('disabled', connectedCount === 0);
}

function selectedClients() {
  return devices.filter((d) => d.selected && d.client.connected).map((d) => d.client);
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

/** Run `action` on every selected, connected sign in parallel. */
async function runOnSelected(action, actionName) {
  const targets = selectedClients();
  if (targets.length === 0) {
    log('No signs selected.', 'error');
    return;
  }
  const results = await Promise.allSettled(targets.map((client) => action(client)));
  const failures = [];
  results.forEach((r, i) => {
    if (r.status === 'rejected') failures.push({ client: targets[i], reason: r.reason });
  });
  const okCount = targets.length - failures.length;
  if (failures.length === 0) {
    log(`${actionName}: done on ${okCount} sign(s).`, 'success');
  } else {
    log(`${actionName}: ${okCount} succeeded, ${failures.length} failed.`, 'error');
    failures.forEach(({ client, reason }) => log(`${getLabel(client)}: ${reason.message}`, 'error'));
  }
}

els.connectBtn.addEventListener('click', async () => {
  await withBusy(async () => {
    log('Requesting Bluetooth device...');
    const client = new CoolLedClient();
    const dev = { client, selected: true };
    client.addEventListener('connected', () => {
      log(`Connected to ${getLabel(client)}`, 'success');
      renderDeviceList();
    });
    client.addEventListener('disconnected', () => {
      log(`${getLabel(client)} disconnected`, 'error');
      renderDeviceList();
    });
    await client.connect();
    devices.push(dev);
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

els.mode.addEventListener('change', async () => {
  await withBusy(async () => {
    const mode = MODE[els.mode.value];
    await runOnSelected(
      (client) => client.sendPackets(buildModePackets(mode), { expectNotify: false }),
      `Mode set to ${els.mode.value}`,
    );
  });
});

function attachSlider(slider, label, build, name) {
  slider.addEventListener('input', () => {
    label.textContent = slider.value;
  });
  slider.addEventListener('change', async () => {
    await withBusy(async () => {
      await runOnSelected(
        (client) => client.sendPackets(build(parseInt(slider.value, 10)), { expectNotify: false }),
        `${name} set to ${slider.value}`,
      );
    });
  });
}

attachSlider(els.speed, els.speedVal, buildSpeedPackets, 'Speed');
attachSlider(els.brightness, els.brightnessVal, buildBrightnessPackets, 'Brightness');

els.powerOnBtn.addEventListener('click', async () => {
  await withBusy(async () => {
    await runOnSelected((client) => client.sendPackets(buildPowerPackets(true), { expectNotify: true }), 'Power on');
  });
});

els.powerOffBtn.addEventListener('click', async () => {
  await withBusy(async () => {
    await runOnSelected((client) => client.sendPackets(buildPowerPackets(false), { expectNotify: true }), 'Power off');
  });
});

let inverted = false;
els.invertBtn.addEventListener('click', async () => {
  await withBusy(async () => {
    inverted = !inverted;
    await runOnSelected(
      (client) => client.sendPackets(buildInvertDisplayPackets(inverted), { expectNotify: false }),
      `Display inverted: ${inverted}`,
    );
  });
});

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

els.identifyBtn.addEventListener('click', async () => {
  await withBusy(async () => {
    const height = parseInt(els.height.value, 10);
    const idOptions = {
      color: '#ffffff',
      backgroundColor: '#000000',
      fontFamily: 'sans-serif',
      fontPx: parseInt(els.fontSize.value, 10),
    };

    await runOnSelected(async (client) => {
      const name = getLabel(client);
      const namePackets = buildTextPackets(name, textToPixelBits(name, idOptions, height).pixelBits);
      const blankPackets = buildTextPackets(' ', textToPixelBits(' ', idOptions, height).pixelBits);

      await client.sendPackets(buildModePackets(MODE.STATIC), { expectNotify: false });
      for (let i = 0; i < 6; i++) {
        await client.sendPackets(i % 2 === 0 ? namePackets : blankPackets, { expectNotify: true });
        await delay(400);
      }
      await client.sendPackets(namePackets, { expectNotify: true });
    }, 'Identify');
  });
});

[els.text, els.color, els.bgColor, els.fontSize, els.width, els.height].forEach((el) => {
  el.addEventListener('input', renderPreview);
});

if (!navigator.bluetooth) {
  els.unsupported.hidden = false;
  els.connectBtn.disabled = true;
}

renderDeviceList();
renderPreview();
