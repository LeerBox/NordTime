// End-to-end test: loads the unpacked extension into Chromium and verifies
// IP detection plus the time zone shim on a real page.
//
//   npm test            (headless)
//   HEADED=1 npm test   (visible browser)
import { chromium } from 'playwright';
import http from 'node:http';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Lets context.route() intercept the extension service worker's requests.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS ??= '1';

const root = fileURLToPath(new URL('..', import.meta.url));
const SYSTEM_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
let failures = 0;

function check(name, actual, expected) {
  const ok = Object.is(actual, expected) || JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ✔' : '  ✘'} ${name}${ok ? '' : `\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`}`);
}

const waitFor = async (fn, timeout = 30000) => {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 250));
  }
};

// --- Test page -----------------------------------------------------------------
const PAGE = `<!doctype html><html><head><script>
  window.__early = { tz: Intl.DateTimeFormat().resolvedOptions().timeZone, offset: new Date(2024, 0, 15).getTimezoneOffset() };
</script></head><body>NordTime test page</body></html>`;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(PAGE);
}).listen(0);
const origin = `http://127.0.0.1:${server.address().port}`;

// --- Browser with extension ------------------------------------------------------
const profile = await mkdtemp(join(tmpdir(), 'nordtime-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: process.env.CHANNEL || 'chromium', // e.g. CHANNEL=msedge
  headless: !process.env.HEADED,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
});

try {
  let [sw] = context.serviceWorkers();
  sw ??= await context.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  const storage = () => sw.evaluate(() => chrome.storage.local.get(null));

  console.log('\n▶ Automatic IP detection');
  const auto = await waitFor(async () => {
    const s = await storage();
    return s.status && s.status.state !== 'checking' && s.active ? s : null;
  });
  console.log(`    IP ${auto.geo?.ip} → ${auto.geo?.city}, ${auto.geo?.country} (${auto.geo?.countryCode}) via ${auto.geo?.provider}`);
  console.log(`    detected zone: ${auto.active.tz}   system zone: ${SYSTEM_TZ}`);
  check('lookup succeeded', auto.status.state, 'ok');
  check('active zone published', auto.active.enabled && typeof auto.active.tz === 'string', true);

  const page = await context.newPage();
  await page.goto(origin);
  await page.waitForFunction((tz) => Intl.DateTimeFormat().resolvedOptions().timeZone === tz, auto.active.tz, { timeout: 5000 }).catch(() => {});
  check('page reports IP-based zone', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), auto.active.tz);

  // --- Popup ----------------------------------------------------------------------
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 360, height: 640 });
  await popup.goto(`chrome-extension://${extId}/src/popup/popup.html`);
  await popup.waitForSelector('#ip:not(:empty)');
  await mkdir(join(root, 'docs'), { recursive: true });
  await popup.screenshot({ path: join(root, 'docs', 'popup.png'), fullPage: true });
  const setSettings = (patch) => popup.evaluate((p) => chrome.runtime.sendMessage({ type: 'settings', patch: p }), patch);

  // --- Shim correctness for fixed zones ---------------------------------------------
  const CASES = [
    {
      tz: 'Asia/Tokyo', name: 'Japan Standard Time',
      winterOffset: -540, summerOffset: -540,
      wall: ['2024-01-15T10:30:00', '2024-01-15T01:30:00.000Z'],
      hoursAt: ['2024-01-15T12:00:00Z', 21],
    },
    {
      tz: 'America/New_York', name: 'Eastern Standard Time',
      winterOffset: 300, summerOffset: 240,
      wall: ['2024-07-04T09:15:00', '2024-07-04T13:15:00.000Z'],
      hoursAt: ['2024-01-15T12:00:00Z', 7],
    },
  ];

  for (const c of CASES) {
    console.log(`\n▶ Manual zone ${c.tz}`);
    await setSettings({ mode: 'manual', manualTz: c.tz });
    await page.reload();
    await page.waitForFunction((tz) => Intl.DateTimeFormat().resolvedOptions().timeZone === tz, c.tz, { timeout: 5000 }).catch(() => {});
    const r = await page.evaluate((c) => {
      const [y, m, d, hh, mm] = c.wall[0].match(/\d+/g).map(Number);
      const local = new Date(y, m - 1, d, hh, mm);
      const set = new Date(c.hoursAt[0]); set.setHours(0, 0, 0, 0);
      const iframe = document.createElement('iframe');
      document.body.append(iframe);
      class MyDate extends Date {}
      const fnStr = (f) => Function.prototype.toString.call(f);
      return {
        early: window.__early,
        resolved: Intl.DateTimeFormat().resolvedOptions().timeZone,
        resolvedNew: new Intl.DateTimeFormat('en-US').resolvedOptions().timeZone,
        explicit: new Intl.DateTimeFormat('en-US', { timeZone: 'UTC' }).resolvedOptions().timeZone,
        winter: new Date('2024-01-15T12:00:00Z').getTimezoneOffset(),
        summer: new Date('2024-07-15T12:00:00Z').getTimezoneOffset(),
        hours: new Date(c.hoursAt[0]).getHours(),
        ctor: local.toISOString(),
        parse: new Date(Date.parse(c.wall[0])).toISOString(),
        parseIsoDate: Date.parse('2024-01-15'),
        parseZ: Date.parse('2024-01-15T10:30:00Z'),
        setHoursWall: [set.getHours(), set.getMinutes(), set.getDate()],
        toStringHasZone: new Date('2024-01-15T12:00:00Z').toString().includes(`(${c.name})`),
        localeString: new Date('2024-01-15T12:00:00Z').toLocaleString('en-US', { timeZone: 'UTC' }),
        iframeZone: iframe.contentWindow.Intl.DateTimeFormat().resolvedOptions().timeZone,
        iframeOffset: new iframe.contentWindow.Date('2024-01-15T12:00:00Z').getTimezoneOffset(),
        subclass: new MyDate(2024, 0, 1) instanceof Date && new MyDate(2024, 0, 1).getFullYear() === 2024,
        nativeLooking: [Date, Date.prototype.getHours, Date.prototype.setHours, Intl.DateTimeFormat, Function.prototype.toString]
          .every((f) => /\{\s*\[native code\]\s*\}$/.test(fnStr(f))),
        lengths: [Date.prototype.setHours.length, Date.prototype.getHours.length, Date.length, Date.prototype.toLocaleString.length],
        names: [Date.name, Date.prototype.getTimezoneOffset.name],
        protoCtor: Date.prototype.constructor === Date,
      };
    }, c);
    check('Intl resolvedOptions().timeZone', r.resolved, c.tz);
    check('new Intl.DateTimeFormat() zone', r.resolvedNew, c.tz);
    check('explicit timeZone option is respected', r.explicit, 'UTC');
    check('getTimezoneOffset() in winter', r.winter, c.winterOffset);
    check('getTimezoneOffset() in summer', r.summer, c.summerOffset);
    check('getHours()', r.hours, c.hoursAt[1]);
    check('new Date(y, m, d, h, m) is local to zone', r.ctor, c.wall[1]);
    check('Date.parse(local string)', r.parse, c.wall[1]);
    check('Date.parse(ISO date-only) stays UTC', r.parseIsoDate, Date.UTC(2024, 0, 15));
    check('Date.parse(Z string) unchanged', r.parseZ, Date.UTC(2024, 0, 15, 10, 30));
    check('setHours(0,0,0,0) wall clock', r.setHoursWall.slice(0, 2), [0, 0]);
    check('toString() zone name', r.toStringHasZone, true);
    check('toLocaleString with explicit UTC', r.localeString, '1/15/2024, 12:00:00 PM');
    check('same-origin iframe zone', r.iframeZone, c.tz);
    check('same-origin iframe offset', r.iframeOffset, c.winterOffset);
    check('Date subclassing works', r.subclass, true);
    check('patched functions look native', r.nativeLooking, true);
    check('function lengths preserved', r.lengths, [4, 0, 7, 0]);
    check('function names preserved', r.names, ['Date', 'getTimezoneOffset']);
    check('Date.prototype.constructor === Date', r.protoCtor, true);
    check('zone applied before first inline <script>', r.early.tz, c.tz);
  }

  console.log('\n▶ Live switch without reload');
  await setSettings({ manualTz: 'Europe/Berlin' });
  await page.waitForTimeout(400);
  check('open page follows new zone', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), 'Europe/Berlin');

  console.log('\n▶ Disabled');
  await setSettings({ enabled: false });
  await page.reload();
  await page.waitForTimeout(300);
  check('page sees real system zone', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), SYSTEM_TZ);

  console.log('\n▶ Simulated VPN switch (mocked IP → Tokyo exit node)');
  await setSettings({ enabled: true, mode: 'auto' });
  const VPN_IP = '203.0.113.10';
  await context.route('https://api.ipify.org/**', (r) => r.fulfill({ json: { ip: VPN_IP } }));
  await context.route(`https://ipwho.is/${VPN_IP}`, (r) => r.fulfill({
    json: { success: true, ip: VPN_IP, country: 'Japan', country_code: 'JP', city: 'Tokyo', region: 'Tokyo', timezone: { id: 'Asia/Tokyo' }, connection: { isp: 'Example VPN' } },
  }));
  await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'refresh' }));
  const vpn = await storage();
  check('new IP detected', vpn.geo?.ip, VPN_IP);
  check('zone follows VPN location', vpn.active?.tz, 'Asia/Tokyo');
  await page.waitForTimeout(400);
  check('open tab switched live', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), 'Asia/Tokyo');
  await page.reload();
  check('zone applied before first inline <script>', await page.evaluate(() => window.__early.tz), 'Asia/Tokyo');
  check('early getTimezoneOffset()', await page.evaluate(() => window.__early.offset), -540);

  await popup.reload();
  await popup.waitForSelector('#ip:not(:empty)');
  await popup.waitForTimeout(300);
  await popup.screenshot({ path: join(root, 'docs', 'popup.png'), fullPage: true });
} finally {
  await context.close();
  server.close();
  await rm(profile, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
