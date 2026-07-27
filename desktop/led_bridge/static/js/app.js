// Talks to the local led_bridge Python server instead of Web Bluetooth
// directly — the server owns the actual BLE connections and auto-connects
// to known signs in the background, so this file only ever does fetch().

const $ = (id) => document.getElementById(id);

const POLL_INTERVAL_MS = 2000;

const els = {
  status: $('status'),
  panel: $('controlPanel'),
  deviceList: $('deviceList'),
  text: $('textInput'),
  color: $('textColor'),
  bgColor: $('bgColor'),
  fontSize: $('fontSize'),
  tzokerAmount: $('tzokerAmount'),
  lottoAmount: $('lottoAmount'),
  eurojackpotAmount: $('eurojackpotAmount'),
  fetchOpapBtn: $('fetchOpapBtn'),
  sendBtn: $('sendBtn'),
  preview: $('preview'),
  log: $('log'),
};

async function api(path, options) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed: HTTP ${res.status}`);
  }
  return data;
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

// The Message field is a contenteditable div so the user sees actual colored
// letters instead of raw <#rrggbb> markup. This walks its DOM to derive the
// marker string the server's render.py expects, grouping consecutive text
// nodes that share a color under a single marker.
function rgbToHex(rgbString) {
  const m = rgbString.match(/\d+/g);
  if (!m) return '#ffffff';
  const [r, g, b] = m.map(Number);
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

function getMessageText() {
  let result = '';
  let lastColor = null;
  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent.length === 0) return;
      const color = rgbToHex(getComputedStyle(node.parentElement).color);
      if (color !== lastColor) {
        result += `<${color}>`;
        lastColor = color;
      }
      result += node.textContent;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.tagName === 'BR') {
        result += ' ';
        return;
      }
      node.childNodes.forEach(walk);
    }
  }
  walk(els.text);
  return result;
}

let devices = [];

async function refreshDeviceList() {
  try {
    devices = await api('/api/signs');
  } catch (err) {
    log(`Failed to reach local server: ${err.message}`, 'error');
    return;
  }
  renderDeviceList();
}

function renderDeviceList() {
  els.deviceList.innerHTML = '';
  if (devices.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'No signs found yet. Make sure they\'re powered on and in Bluetooth range.';
    els.deviceList.appendChild(empty);
  }
  for (const dev of devices) {
    const row = document.createElement('div');
    row.className = 'device-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = dev.selected;
    checkbox.addEventListener('change', async () => {
      try {
        await api('/api/signs/select', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: dev.id, selected: checkbox.checked }),
        });
      } catch (err) {
        log(err.message, 'error');
      }
    });

    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'device-name';
    name.value = dev.name;
    name.title = `Bluetooth name: ${dev.bluetoothName || 'unknown'}`;
    name.addEventListener('change', async () => {
      try {
        devices = await api('/api/signs/rename', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: dev.id, label: name.value }),
        });
        renderDeviceList();
      } catch (err) {
        log(err.message, 'error');
      }
    });

    const status = document.createElement('span');
    status.className = 'device-status';
    status.textContent = dev.connected ? 'connected' : 'searching…';

    const actionBtn = document.createElement('button');
    actionBtn.className = 'secondary small';
    actionBtn.textContent = 'Disconnect';
    actionBtn.disabled = !dev.connected;
    actionBtn.addEventListener('click', async () => {
      try {
        devices = await api('/api/signs/disconnect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: dev.id }),
        });
        renderDeviceList();
      } catch (err) {
        log(err.message, 'error');
      }
    });

    row.append(checkbox, name, status, actionBtn);
    els.deviceList.appendChild(row);
  }

  const connectedCount = devices.filter((d) => d.connected).length;
  els.status.textContent = connectedCount > 0 ? `${connectedCount} sign(s) connected` : '';
  els.panel.classList.toggle('disabled', connectedCount === 0);
}

async function renderPreview() {
  try {
    const { image } = await api('/api/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: getMessageText(),
        color: els.color.value,
        backgroundColor: els.bgColor.value,
        fontPx: parseInt(els.fontSize.value, 10),
      }),
    });
    els.preview.src = image;
  } catch (err) {
    log(`Preview error: ${err.message}`, 'error');
  }
}

let previewTimer = null;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 150);
}

els.sendBtn.addEventListener('click', async () => {
  await withBusy(async () => {
    const result = await api('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: getMessageText(),
        color: els.color.value,
        backgroundColor: els.bgColor.value,
        fontPx: parseInt(els.fontSize.value, 10),
      }),
    });
    const okCount = result.results.filter((r) => r.ok).length;
    const failed = result.results.filter((r) => !r.ok);
    if (failed.length === 0) {
      log(`Send text: done on ${okCount} sign(s).`, 'success');
    } else {
      log(`Send text: ${okCount} succeeded, ${failed.length} failed.`, 'error');
      failed.forEach((r) => log(`${r.name}: ${r.error}`, 'error'));
    }
  });
});

function formatEuro(value) {
  return Number(value || 0).toLocaleString('el-GR');
}

function buildMessageFromAmounts() {
  const tzoker = formatEuro(els.tzokerAmount.value);
  const lotto = formatEuro(els.lottoAmount.value);
  const eurojackpot = formatEuro(els.eurojackpotAmount.value);

  // Each part of the ticker gets its own color, matching the multi-color
  // look of the original app's messages instead of one flat color.
  const segments = [
    { text: 'JACKPOT TZOKER ', color: '#ffffff' },
    { text: `${tzoker}€ `, color: '#00ff00' },
    { text: '– ΛΟΤΤΟ ', color: '#ffffff' },
    { text: `${lotto}€ `, color: '#00ff00' },
    { text: 'ΚΑΘΕ ΜΗΝΑ !!! – EUROJACKPOT ', color: '#ffffff' },
    { text: `${eurojackpot}€`, color: '#00ff00' },
  ];

  els.text.innerHTML = '';
  for (const seg of segments) {
    const span = document.createElement('span');
    span.style.color = seg.color;
    span.textContent = seg.text;
    els.text.appendChild(span);
  }
  renderPreview();
}

async function loadSettings() {
  try {
    const settings = await api('/api/settings');
    els.lottoAmount.value = settings.lottoAmount;
    els.fontSize.value = settings.fontPx;
    els.bgColor.value = settings.backgroundColor;
  } catch (err) {
    log(`Failed to load saved settings: ${err.message}`, 'error');
  }
}

// Persisted server-side (not just in this browser tab) so the automatic
// midnight OPAP update can build the message with these same values even
// when no browser is open.
function persistSettings() {
  api('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lottoAmount: parseInt(els.lottoAmount.value, 10) || 0,
      fontPx: parseInt(els.fontSize.value, 10) || 13,
      backgroundColor: els.bgColor.value,
    }),
  }).catch((err) => log(`Failed to save settings: ${err.message}`, 'error'));
}

els.fetchOpapBtn.addEventListener('click', async () => {
  await withBusy(async () => {
    try {
      const [tzoker, eurojackpot] = await Promise.all([
        api('/api/opap?game=tzoker'),
        api('/api/opap?game=eurojackpot'),
      ]);
      els.tzokerAmount.value = Math.round(tzoker.amount);
      els.eurojackpotAmount.value = Math.round(eurojackpot.amount);
      log(`Fetched from OPAP: Τζόκερ ${formatEuro(tzoker.amount)}€, EuroJackpot ${formatEuro(eurojackpot.amount)}€`, 'success');
    } catch (err) {
      log(`OPAP fetch failed (${err.message}) — using current amounts instead.`, 'error');
    }
    buildMessageFromAmounts();
  });
});

[els.text, els.bgColor, els.fontSize].forEach((el) => {
  el.addEventListener('input', schedulePreview);
});

els.bgColor.addEventListener('change', persistSettings);
els.fontSize.addEventListener('change', persistSettings);
els.lottoAmount.addEventListener('change', () => {
  persistSettings();
  buildMessageFromAmounts();
});

els.text.addEventListener('keydown', (e) => {
  // The sign renders everything as one line; block Enter from creating a
  // visual line break that the marker walk would just turn into a space.
  if (e.key === 'Enter') e.preventDefault();
});

els.color.addEventListener('input', () => {
  els.text.style.color = els.color.value;
  schedulePreview();
});

document.querySelectorAll('#colorPalette .swatch').forEach((swatch) => {
  // Prevent the button from stealing focus on mousedown, which would
  // collapse whatever text selection the user just made in the message
  // field before the click handler below gets to see it.
  swatch.addEventListener('mousedown', (e) => e.preventDefault());
  swatch.addEventListener('click', () => {
    const color = swatch.dataset.color;
    els.text.focus();
    document.execCommand('styleWithCSS', false, true);
    document.execCommand('foreColor', false, color);
    els.color.value = color;
    schedulePreview();
  });
});

els.text.style.color = els.color.value;
renderDeviceList();
(async () => {
  await loadSettings();
  buildMessageFromAmounts();
  refreshDeviceList();
  setInterval(refreshDeviceList, POLL_INTERVAL_MS);
})();
