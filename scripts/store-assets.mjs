// Renders the Chrome Web Store images into store/ (JPEG, no alpha channel):
//   screenshot-1.jpg, screenshot-2.jpg  1280x800
//   promo-small.jpg                     440x280
//   promo-marquee.jpg                   1400x560
import { chromium } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dataUrl = async (path, type) => `data:${type};base64,${(await readFile(root + path)).toString('base64')}`;
const icon = await dataUrl('icons/icon.svg', 'image/svg+xml');
const popup = await dataUrl('docs/popup.png', 'image/png');

const BASE = `
  *{box-sizing:border-box;margin:0}
  body{font-family:"Segoe UI Variable Display","Segoe UI",system-ui,sans-serif;color:#ECEFF4;overflow:hidden;
    background:radial-gradient(90% 120% at 100% 0%,rgba(136,192,208,.20),transparent 60%),
               radial-gradient(70% 90% at 0% 100%,rgba(94,129,172,.25),transparent 60%),#242933}
  .brand{display:flex;align-items:center;gap:14px}
  .brand img{display:block}
  .name{font-weight:700;letter-spacing:.3px}
  .accent{color:#88C0D0}
  .muted{color:#9AA5B8}
  code{font-family:"Cascadia Mono",Consolas,monospace}
`;

const pages = {
  'screenshot-1': {
    size: [1280, 800],
    html: `
      <style>${BASE}
        .wrap{display:grid;grid-template-columns:1fr 400px;gap:56px;align-items:center;height:800px;padding:0 90px}
        h1{font-size:52px;line-height:1.1;font-weight:700;margin:34px 0 20px;letter-spacing:-.5px}
        p.lead{font-size:21px;line-height:1.5;color:#B8C2D3;max-width:560px}
        ul{list-style:none;padding:0;margin-top:34px;display:grid;gap:16px}
        li{font-size:19px;display:flex;gap:14px;align-items:center}
        li b{width:30px;height:30px;border-radius:9px;background:#3B4252;border:1px solid #4C566A;display:grid;place-items:center;color:#A3BE8C;font-size:16px}
        .shot{justify-self:center;width:360px;border-radius:22px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.55),0 0 0 1px #434C5E}
        .shot img{display:block;width:360px}
      </style>
      <div class="wrap">
        <div>
          <div class="brand"><img src="${icon}" width="56" height="56"><span class="name" style="font-size:28px">NordTime</span></div>
          <h1>Your browser's time zone,<br><span class="accent">matched to your VPN.</span></h1>
          <p class="lead">NordTime detects the location of your current IP address and gives every website the matching time zone. It switches automatically when your VPN changes server.</p>
          <ul>
            <li><b>✓</b>Fully automatic IP detection</li>
            <li><b>✓</b>Applied before page scripts run</li>
            <li><b>✓</b>Open tabs switch live, without a reload</li>
            <li><b>✓</b>No tracking, no account, no servers of its own</li>
          </ul>
        </div>
        <div class="shot"><img src="${popup}"></div>
      </div>`,
  },
  'screenshot-2': {
    size: [1280, 800],
    html: `
      <style>${BASE}
        .wrap{padding:70px 90px}
        h1{font-size:44px;font-weight:700;letter-spacing:-.5px;margin:30px 0 12px}
        .sub{font-size:20px;color:#B8C2D3}
        .grid{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-top:46px}
        .card{border-radius:20px;padding:30px 32px;background:#2E3440;border:1px solid #434C5E}
        .card h2{font-size:22px;margin-bottom:22px;display:flex;align-items:center;gap:12px}
        .tag{font-size:14px;font-weight:700;padding:5px 12px;border-radius:999px}
        .bad .tag{background:rgba(191,97,106,.18);color:#E08C94}
        .good{border-color:#A3BE8C;box-shadow:0 0 0 1px rgba(163,190,140,.3),0 20px 60px rgba(0,0,0,.35)}
        .good .tag{background:rgba(163,190,140,.18);color:#A3BE8C}
        .row{display:flex;justify-content:space-between;align-items:center;padding:15px 0;border-top:1px solid #3B4252;font-size:18px}
        .row:first-of-type{border-top:0}
        .row span:last-child{font-weight:600}
        .x{color:#E08C94}.ok{color:#A3BE8C}
        pre{margin-top:22px;padding:16px 18px;border-radius:12px;background:#242933;border:1px solid #3B4252;font:15px/1.6 "Cascadia Mono",Consolas,monospace;color:#D8DEE9}
        .str{color:#A3BE8C}.strbad{color:#E08C94}
      </style>
      <div class="wrap">
        <div class="brand"><img src="${icon}" width="44" height="44"><span class="name" style="font-size:24px">NordTime</span></div>
        <h1>Websites see <span class="accent">one consistent location</span></h1>
        <p class="sub">A VPN changes your IP address, but the browser still reports your real time zone, which is an easy giveaway.</p>
        <div class="grid">
          <div class="card bad">
            <h2>Without NordTime <span class="tag">Mismatch</span></h2>
            <div class="row"><span class="muted">VPN IP location</span><span>Tokyo, Japan</span></div>
            <div class="row"><span class="muted">Browser time zone</span><span class="x">Europe/Berlin</span></div>
            <div class="row"><span class="muted">UTC offset</span><span class="x">UTC+01:00</span></div>
            <pre>Intl.DateTimeFormat()
  .resolvedOptions().timeZone
<span class="strbad">→ "Europe/Berlin"</span></pre>
          </div>
          <div class="card good">
            <h2>With NordTime <span class="tag">Consistent</span></h2>
            <div class="row"><span class="muted">VPN IP location</span><span>Tokyo, Japan</span></div>
            <div class="row"><span class="muted">Browser time zone</span><span class="ok">Asia/Tokyo</span></div>
            <div class="row"><span class="muted">UTC offset</span><span class="ok">UTC+09:00</span></div>
            <pre>Intl.DateTimeFormat()
  .resolvedOptions().timeZone
<span class="str">→ "Asia/Tokyo"</span></pre>
          </div>
        </div>
      </div>`,
  },
  'promo-small': {
    size: [440, 280],
    html: `
      <style>${BASE}
        .wrap{height:280px;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;gap:14px}
        .t{font-size:17px;color:#B8C2D3;line-height:1.4}
      </style>
      <div class="wrap">
        <img src="${icon}" width="96" height="96">
        <div class="name" style="font-size:34px">NordTime</div>
        <div class="t">Time zone that follows<br><span class="accent">your VPN location</span></div>
      </div>`,
  },
  'promo-marquee': {
    size: [1400, 560],
    html: `
      <style>${BASE}
        .wrap{height:560px;display:flex;align-items:center;gap:60px;padding:0 120px}
        h1{font-size:58px;line-height:1.1;letter-spacing:-.5px;margin-top:18px}
        .t{font-size:24px;color:#B8C2D3;margin-top:18px}
      </style>
      <div class="wrap">
        <img src="${icon}" width="220" height="220">
        <div>
          <div class="name accent" style="font-size:30px">NordTime</div>
          <h1>Your browser's time zone,<br>matched to your VPN.</h1>
          <p class="t">Automatic · Live switching · Private</p>
        </div>
      </div>`,
  },
};

await mkdir(`${root}store`, { recursive: true });
const browser = await chromium.launch();
for (const [name, { size: [width, height], html }] of Object.entries(pages)) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(html);
  await page.screenshot({ path: `${root}store/${name}.jpg`, type: 'jpeg', quality: 92 });
  await page.close();
  console.log(`store/${name}.jpg  ${width}x${height}`);
}
await browser.close();
