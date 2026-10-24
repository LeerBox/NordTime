/*!
 * NordTime — background service worker.
 *
 * Detects the public IP address the browser is currently using (i.e. the VPN
 * exit node when a VPN is active), resolves it to an IANA time zone and
 * publishes the result as `active` in chrome.storage.local, which the content
 * scripts apply to every page.
 *
 * Detection runs on install/startup, on a periodic alarm, when the network
 * changes (VPN connect/disconnect) and on demand from the popup.
 */

const ALARM = 'nordtime:check';
const REQUEST_TIMEOUT_MS = 6000;
const GEO_TTL_MS = 6 * 60 * 60 * 1000;
const NETWORK_RECHECK_DELAY_MS = 2500;

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  mode: 'auto',        // 'auto' (follow IP) | 'manual'
  manualTz: '',
  intervalMin: 1,      // periodic IP check, minutes
  notify: true,        // desktop notification when the zone changes
});

const COLORS = { ok: '#5E81AC', manual: '#B48EAD', off: '#4C566A', error: '#BF616A' };

// ---------------------------------------------------------------------------
// Networking helpers
// ---------------------------------------------------------------------------

async function request(url, as = 'json') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return as === 'json' ? await res.json() : await res.text();
  } catch (err) {
    throw new Error(err.name === 'AbortError' ? 'timed out' : err.message);
  } finally {
    clearTimeout(timer);
  }
}

/** Tries each source in order and returns the first successful result. */
async function firstSuccessful(sources, run) {
  const errors = [];
  for (const source of sources) {
    try {
      const value = await run(source);
      if (value) return { value, source: source.name };
      errors.push(`${source.name}: empty response`);
    } catch (err) {
      errors.push(`${source.name}: ${err.message}`);
    }
  }
  throw new Error(errors.join(' · '));
}

const IP_PATTERN = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f:]+:[0-9a-f:.]*)$/i;

const IP_SOURCES = [
  { name: 'ipify', get: async () => (await request('https://api.ipify.org?format=json')).ip },
  { name: 'cloudflare', get: async () => /^ip=(.+)$/m.exec(await request('https://www.cloudflare.com/cdn-cgi/trace', 'text'))?.[1] },
  { name: 'icanhazip', get: async () => (await request('https://icanhazip.com', 'text')).trim() },
];

const GEO_SOURCES = [
  {
    name: 'ipwho.is',
    url: (ip) => `https://ipwho.is/${ip}`,
    parse: (j) => j.success === false ? null : ({
      countryCode: j.country_code, country: j.country, region: j.region, city: j.city,
      timezone: j.timezone?.id, isp: j.connection?.isp || j.connection?.org,
    }),
  },
  {
    name: 'geojs.io',
    url: (ip) => `https://get.geojs.io/v1/ip/geo/${ip}.json`,
    parse: (j) => ({
      countryCode: j.country_code, country: j.country, region: j.region, city: j.city,
      timezone: j.timezone, isp: j.organization_name,
    }),
  },
  {
    name: 'ipapi.co',
    url: (ip) => `https://ipapi.co/${ip}/json/`,
    parse: (j) => j.error ? null : ({
      countryCode: j.country_code, country: j.country_name, region: j.region, city: j.city,
      timezone: j.timezone, isp: j.org,
    }),
  },
  {
    name: 'freeipapi.com',
    url: (ip) => `https://freeipapi.com/api/json/${ip}`,
    parse: (j) => ({
      countryCode: j.countryCode, country: j.countryName, region: j.regionName, city: j.cityName,
      timezone: Array.isArray(j.timeZones) ? j.timeZones[0] : undefined, isp: undefined,
    }),
  },
];

export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

async function getPublicIp() {
  const { value } = await firstSuccessful(IP_SOURCES, async (s) => {
    const ip = String((await s.get()) || '').trim();
    if (!IP_PATTERN.test(ip)) throw new Error('invalid IP');
    return ip;
  });
  return value;
}

async function lookupGeo(ip) {
  const { value, source } = await firstSuccessful(GEO_SOURCES, async (s) => {
    const geo = s.parse(await request(s.url(encodeURIComponent(ip))));
    if (!geo || !isValidTimeZone(geo.timezone)) throw new Error('no valid time zone');
    return geo;
  });
  return { ...value, ip, provider: source, countryCode: (value.countryCode || '').toUpperCase() };
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

async function loadState() {
  const data = await chrome.storage.local.get(['settings', 'geo', 'status', 'active']);
  return { ...data, settings: { ...DEFAULT_SETTINGS, ...data.settings } };
}

async function getPublicState() {
  const state = await loadState();
  return { ...state, version: chrome.runtime.getManifest().version };
}

async function setStatus(status) {
  await chrome.storage.local.set({ status: { ...status, at: Date.now() } });
}

/** Recomputes the active zone from settings + geo, publishes it and updates the badge. */
async function publish({ announce = true } = {}) {
  const { settings, geo, status, active: previous } = await loadState();
  const tz = settings.mode === 'manual' ? settings.manualTz : geo?.timezone;
  const valid = isValidTimeZone(tz);
  const active = { enabled: Boolean(settings.enabled && valid), tz: valid ? tz : null };

  const changed = !previous || previous.enabled !== active.enabled || previous.tz !== active.tz;
  if (changed) {
    await registerContentScripts(active);
    await chrome.storage.local.set({ active });
  }

  await updateBadge(settings, geo, status, active);

  if (announce && changed && active.enabled && previous?.tz !== active.tz && settings.notify) {
    const where = settings.mode === 'manual'
      ? 'Manual override'
      : [geo?.city, geo?.country].filter(Boolean).join(', ');
    chrome.notifications.create('nordtime:zone', {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: `Time zone set to ${active.tz}`,
      message: where ? `${where} · ${formatOffset(active.tz)}` : formatOffset(active.tz),
      priority: 0,
      silent: true,
    }).catch(() => {});
  }
  return active;
}

function formatOffset(tz) {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName');
    return part ? part.value.replace('GMT', 'UTC') : '';
  } catch {
    return '';
  }
}

async function updateBadge(settings, geo, status, active) {
  let text = '', color = COLORS.ok, title = 'NordTime';
  if (!settings.enabled) {
    text = 'OFF'; color = COLORS.off; title += ' — disabled';
  } else if (settings.mode === 'manual') {
    text = 'M'; color = COLORS.manual; title += ` — ${active.tz || 'no zone selected'} (manual)`;
  } else if (active.enabled) {
    text = geo?.countryCode || ''; title += ` — ${active.tz}` + (geo?.country ? ` (${geo.country})` : '');
  } else if (status?.state === 'error') {
    text = '!'; color = COLORS.error; title += ' — IP lookup failed';
  }
  await Promise.all([
    chrome.action.setBadgeText({ text }),
    chrome.action.setBadgeBackgroundColor({ color }),
    chrome.action.setBadgeTextColor?.({ color: '#ECEFF4' }),
    chrome.action.setTitle({ title }),
  ]);
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

let inFlight = null;

/** Checks the public IP and re-resolves the location when it changed. Calls are coalesced. */
function detect(options = {}) {
  inFlight ??= runDetection(options).finally(() => { inFlight = null; });
  return inFlight;
}

async function runDetection({ force = false } = {}) {
  const { geo } = await loadState();
  await setStatus({ state: 'checking' });
  try {
    const ip = await getPublicIp();
    let next = geo;
    if (force || !geo || geo.ip !== ip || Date.now() - (geo.resolvedAt || 0) > GEO_TTL_MS) {
      next = { ...(await lookupGeo(ip)), resolvedAt: Date.now() };
    }
    await chrome.storage.local.set({ geo: { ...next, checkedAt: Date.now() } });
    await setStatus({ state: 'ok' });
  } catch (err) {
    await setStatus({ state: 'error', message: err.message });
  }
  return publish();
}

let networkTimer = null;
function scheduleNetworkRecheck() {
  clearTimeout(networkTimer);
  networkTimer = setTimeout(() => detect(), NETWORK_RECHECK_DELAY_MS);
}

async function ensureAlarm(intervalMin) {
  const period = Math.max(0.5, Number(intervalMin) || DEFAULT_SETTINGS.intervalMin);
  const existing = await chrome.alarms.get(ALARM);
  if (!existing || existing.periodInMinutes !== period) {
    await chrome.alarms.create(ALARM, { periodInMinutes: period, delayInMinutes: period });
  }
}

// ---------------------------------------------------------------------------
// Content scripts
// ---------------------------------------------------------------------------

const SCRIPT_IDS = ['nordtime-main', 'nordtime-relay'];
const ZONE_BITS = 12;

/**
 * Encodes a zone as its index in Intl.supportedValuesOf('timeZone'): on.js
 * followed by one bitN.js per set bit. Prepended to relay.js, these let the
 * relay know the zone synchronously at document_start, before any page script
 * (chrome.storage is async). Distinct file names matter: Chrome drops
 * duplicate entries from a content script's file list.
 */
function zoneScripts(tz) {
  let index = Intl.supportedValuesOf('timeZone').indexOf(tz);
  if (index < 0) {
    try {
      const canonical = new Intl.DateTimeFormat('en-US', { timeZone: tz }).resolvedOptions().timeZone;
      index = Intl.supportedValuesOf('timeZone').indexOf(canonical);
    } catch { /* invalid zone */ }
  }
  if (index < 0 || index >= 2 ** ZONE_BITS) return [];
  const files = ['src/content/zone/on.js'];
  for (let bit = 0; bit < ZONE_BITS; bit++) {
    if (index & (1 << bit)) files.push(`src/content/zone/bit${bit}.js`);
  }
  return files;
}

/** (Re)registers the content scripts for the given active zone. */
async function registerContentScripts(active) {
  const zone = active?.enabled ? zoneScripts(active.tz) : [];
  const common = {
    matches: ['<all_urls>'],
    runAt: 'document_start',
    allFrames: true,
    matchOriginAsFallback: true,
    persistAcrossSessions: true,
  };
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: SCRIPT_IDS });
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: existing.map((s) => s.id) });
  await chrome.scripting.registerContentScripts([
    { id: 'nordtime-main', js: ['src/content/inject.js'], world: 'MAIN', ...common },
    { id: 'nordtime-relay', js: [...zone, 'src/content/relay.js'], world: 'ISOLATED', ...common },
  ]);
}

async function ensureContentScripts() {
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: SCRIPT_IDS });
  if (existing.length !== SCRIPT_IDS.length) {
    const { active } = await chrome.storage.local.get('active');
    await registerContentScripts(active);
  }
}

/** Injects the content scripts into tabs that were open before NordTime was installed. */
async function injectIntoOpenTabs() {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  await Promise.all(tabs.map(async (tab) => {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['src/content/relay.js'] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['src/content/inject.js'], world: 'MAIN' });
    } catch { /* restricted page */ }
  }));
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const { settings } = await chrome.storage.local.get('settings');
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  await chrome.storage.local.set({ settings: merged });
  await ensureAlarm(merged.intervalMin);
  await ensureContentScripts();
  await detect({ force: true });
  if (reason === 'install') await injectIntoOpenTabs();
});

chrome.runtime.onStartup.addListener(async () => {
  const { settings } = await loadState();
  await ensureAlarm(settings.intervalMin);
  await ensureContentScripts();
  await detect();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) detect();
});

// A VPN connecting or disconnecting surfaces as network errors on in-flight requests.
const NETWORK_ERRORS = /ERR_NETWORK_CHANGED|ERR_INTERNET_DISCONNECTED|ERR_PROXY_CONNECTION_FAILED|ERR_TUNNEL_CONNECTION_FAILED|ERR_NETWORK_IO_SUSPENDED/;
chrome.webRequest.onErrorOccurred.addListener(
  (details) => { if (NETWORK_ERRORS.test(details.error)) scheduleNetworkRecheck(); },
  { urls: ['<all_urls>'] },
);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case 'state':
        return getPublicState();
      case 'refresh':
        await detect({ force: true });
        return getPublicState();
      case 'settings': {
        const { settings } = await loadState();
        const patch = { ...message.patch };
        if ('manualTz' in patch && patch.manualTz && !isValidTimeZone(patch.manualTz)) {
          throw new Error(`Unknown time zone: ${patch.manualTz}`);
        }
        const next = { ...settings, ...patch };
        await chrome.storage.local.set({ settings: next });
        if (patch.intervalMin !== undefined) await ensureAlarm(next.intervalMin);
        await publish();
        return getPublicState();
      }
      default:
        throw new Error('Unknown message');
    }
  })().then(
    (result) => sendResponse({ ok: true, result }),
    (err) => sendResponse({ ok: false, error: err.message }),
  );
  return true;
});
