import { CoolLedClient } from './ble.js';
import {
  MODE,
  buildSpeedPackets,
  buildBrightnessPackets,
  buildModePackets,
  buildPowerPackets,
  buildInvertDisplayPackets,
  buildInitializePackets,
  buildTextPackets,
} from './protocol.js';
import { textToPixelBits, drawPreview } from './render.js';

const $ = (id) => document.getElementById(id);

const els = {
  connectBtn: $('connectBtn'),
  status: $('status'),
  panel: $('controlPanel'),
  unsupported: $('unsupported'),
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
  preview: $('preview'),
  log: $('log'),
};

const client = new CoolLedClient();

function log(message, kind = 'info') {
  const line = document.createElement('div');
  line.className = `log-line log-${kind}`;
  const time = new Date().toLocaleTimeString();
  line.textContent = `[${time}] ${message}`;
  els.log.prepend(line);
}

function setConnectedUi(connected) {
  els.panel.classList.toggle('disabled', !connected);
  els.connectBtn.textContent = connected ? `Disconnect (${client.deviceName || 'sign'})` : 'Connect to sign';
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

els.connectBtn.addEventListener('click', async () => {
  if (client.connected) {
    client.disconnect();
    return;
  }
  await withBusy(async () => {
    log('Requesting Bluetooth device...');
    await client.connect();
    log(`Connected to ${client.deviceName}`, 'success');
  });
});

client.addEventListener('connected', () => setConnectedUi(true));
client.addEventListener('disconnected', () => {
  setConnectedUi(false);
  log('Disconnected', 'error');
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
    log(`Sending text (${packets.length} chunk${packets.length === 1 ? '' : 's'})...`);
    await client.sendPackets(packets, { expectNotify: true });
    log('Text sent.', 'success');
  });
});

els.mode.addEventListener('change', async () => {
  await withBusy(async () => {
    const mode = MODE[els.mode.value];
    await client.sendPackets(buildModePackets(mode), { expectNotify: false });
    log(`Mode set to ${els.mode.value}`);
  });
});

function attachSlider(slider, label, build, name) {
  slider.addEventListener('input', () => {
    label.textContent = slider.value;
  });
  slider.addEventListener('change', async () => {
    await withBusy(async () => {
      await client.sendPackets(build(parseInt(slider.value, 10)), { expectNotify: false });
      log(`${name} set to ${slider.value}`);
    });
  });
}

attachSlider(els.speed, els.speedVal, buildSpeedPackets, 'Speed');
attachSlider(els.brightness, els.brightnessVal, buildBrightnessPackets, 'Brightness');

els.powerOnBtn.addEventListener('click', async () => {
  await withBusy(async () => {
    await client.sendPackets(buildInitializePackets(), { expectNotify: true });
    await client.sendPackets(buildPowerPackets(true), { expectNotify: true });
    log('Power on', 'success');
  });
});

els.powerOffBtn.addEventListener('click', async () => {
  await withBusy(async () => {
    await client.sendPackets(buildPowerPackets(false), { expectNotify: true });
    log('Power off');
  });
});

let inverted = false;
els.invertBtn.addEventListener('click', async () => {
  await withBusy(async () => {
    inverted = !inverted;
    await client.sendPackets(buildInvertDisplayPackets(inverted), { expectNotify: false });
    log(`Display inverted: ${inverted}`);
  });
});

[els.text, els.color, els.bgColor, els.fontSize, els.width, els.height].forEach((el) => {
  el.addEventListener('input', renderPreview);
});

if (!navigator.bluetooth) {
  els.unsupported.hidden = false;
  els.connectBtn.disabled = true;
}

setConnectedUi(false);
renderPreview();
