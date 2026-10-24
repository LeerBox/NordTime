// NordTime popup controller.

const $ = (id) => document.getElementById(id);
const SYSTEM_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

let state = null;
let clockTimer = null;

async function send(type, extra = {}) {
  const res = await chrome.runtime.sendMessage({ type, ...extra });
  if (!res?.ok) throw new Error(res?.error || 'No response from background');
  return res.result;
}

function showError(message) {
  const el = $('error');
  el.hidden = !message;
  el.textContent = message || '';
}

function relativeTime(ts) {
  if (!ts) return '—';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : new Date(ts).toLocaleString();
}

function utcOffsetLabel(tz) {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName');
    return part.value === 'GMT' ? 'UTC±00:00' : part.value.replace('GMT', 'UTC');
  } catch {
    return 'UTC';
  }
}

function displayZone() {
  return state?.active?.enabled ? state.active.tz : SYSTEM_TZ;
}

function tick() {
  const tz = displayZone();
  const now = new Date();
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(now);
  const get = (type) => time.find((p) => p.type === type)?.value ?? '--';
  $('clock').firstChild.nodeValue = `${get('hour')}:${get('minute')}`;
  $('clockSec').textContent = `:${get('second')}`;
  $('clockDate').textContent = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(now);
  $('offset').textContent = utcOffsetLabel(tz);
  if (state) $('lastCheck').textContent = relativeTime(state.geo?.checkedAt);
}

function renderStatus() {
  const { settings, status, active } = state;
  const pill = $('status');
  let cls = '', text = 'Active';
  if (!settings.enabled) { cls = 'off'; text = 'Disabled'; }
  else if (status?.state === 'checking') { cls = 'checking'; text = 'Checking IP…'; }
  else if (settings.mode === 'manual') { cls = active?.enabled ? 'manual' : 'error'; text = active?.enabled ? 'Manual zone' : 'Select a zone'; }
  else if (status?.state === 'error' && !active?.enabled) { cls = 'error'; text = 'Lookup failed'; }
  else if (status?.state === 'error') { cls = 'checking'; text = 'Using last known'; }
  else if (active?.enabled) { text = 'Synced with IP'; }
  pill.className = `pill ${cls}`;
  $('statusText').textContent = text;
}

function render() {
  if (!state) return;
  const { settings, geo, status, active } = state;

  document.body.classList.toggle('disabled', !settings.enabled);
  $('enabled').checked = settings.enabled;
  renderStatus();

  $('zone').textContent = active?.enabled ? active.tz : `${SYSTEM_TZ} (system)`;
  $('cc').textContent = geo?.countryCode || '--';
  $('location').textContent = geo ? [geo.city, geo.country].filter(Boolean).join(', ') || '—' : '—';
  $('ip').textContent = geo?.ip || '—';
  $('isp').textContent = geo?.isp || '—';
  $('isp').title = geo ? `${geo.isp || ''}\nvia ${geo.provider}` : '';
  $('systemZone').textContent = SYSTEM_TZ;

  const manual = settings.mode === 'manual';
  $('modeAuto').setAttribute('aria-selected', String(!manual));
  $('modeManual').setAttribute('aria-selected', String(manual));
  $('manualBox').hidden = !manual;
  if (manual && document.activeElement !== $('manualTz')) $('manualTz').value = settings.manualTz || '';
  $('modeHint').textContent = manual
    ? 'A fixed time zone is applied to every website, regardless of your IP address.'
    : 'The time zone is detected from your current IP address and updates automatically when your VPN changes location.';

  $('interval').value = String(settings.intervalMin);
  $('notify').checked = settings.notify;
  $('version').textContent = `v${state.version}`;

  showError(status?.state === 'error' && settings.mode === 'auto' ? `IP lookup failed: ${status.message}` : '');
  tick();
}

async function update(patch) {
  try {
    showError('');
    state = await send('settings', { patch });
    render();
  } catch (err) {
    showError(err.message);
  }
}

async function refresh() {
  const btn = $('refresh');
  btn.disabled = true;
  btn.classList.add('spinning');
  try {
    state = await send('refresh');
    render();
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.classList.remove('spinning');
  }
}

function populateZones() {
  const zones = Intl.supportedValuesOf?.('timeZone') ?? [];
  const list = $('zones');
  const frag = document.createDocumentFragment();
  for (const tz of zones) {
    const opt = document.createElement('option');
    opt.value = tz;
    opt.label = utcOffsetLabel(tz);
    frag.append(opt);
  }
  list.append(frag);
}

function bind() {
  $('enabled').addEventListener('change', (e) => update({ enabled: e.target.checked }));
  $('modeAuto').addEventListener('click', () => update({ mode: 'auto' }));
  $('modeManual').addEventListener('click', () => {
    const patch = { mode: 'manual' };
    if (!state.settings.manualTz) patch.manualTz = state.active?.tz || SYSTEM_TZ;
    update(patch);
  });
  const applyManual = () => update({ manualTz: $('manualTz').value.trim() });
  $('applyManual').addEventListener('click', applyManual);
  $('manualTz').addEventListener('keydown', (e) => { if (e.key === 'Enter') applyManual(); });
  $('interval').addEventListener('change', (e) => update({ intervalMin: Number(e.target.value) }));
  $('notify').addEventListener('change', (e) => update({ notify: e.target.checked }));
  $('refresh').addEventListener('click', refresh);
  $('reloadTab').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) chrome.tabs.reload(tab.id);
    window.close();
  });
  $('copyIp').addEventListener('click', async () => {
    if (!state?.geo?.ip) return;
    await navigator.clipboard.writeText(state.geo.ip);
    $('copyIp').style.color = 'var(--green)';
    setTimeout(() => { $('copyIp').style.color = ''; }, 900);
  });

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;
    if (changes.status || changes.geo || changes.active || changes.settings) {
      state = await send('state');
      render();
    }
  });
}

async function init() {
  bind();
  populateZones();
  try {
    state = await send('state');
    render();
    if (!state.geo && state.settings.mode === 'auto') refresh();
  } catch (err) {
    showError(err.message);
  }
  clockTimer = setInterval(tick, 1000);
}

init();
