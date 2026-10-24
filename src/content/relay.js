/*!
 * NordTime — isolated-world relay.
 *
 * Forwards the active time zone to the page-world shim (inject.js) through a
 * private DOM event.
 *
 *  1. Synchronously at document_start: the background registers this script
 *     preceded by src/content/zone/on.js plus one bitN.js file per set bit of
 *     the zone's index in Intl.supportedValuesOf('timeZone'). That leaves the
 *     index in `globalThis.__ntz` (isolated world, invisible to the page), so
 *     the zone is applied before any inline page script runs.
 *  2. Asynchronously from chrome.storage, which also covers tabs where the
 *     scripts were injected after load, and live updates on VPN switches.
 */
(() => {
  'use strict';

  const EVT_CONFIG = 'nt-3f9a1c:cfg';
  const EVT_HELLO = 'nt-3f9a1c:hello';

  let current = null;
  if (typeof globalThis.__ntz === 'number') {
    const tz = Intl.supportedValuesOf('timeZone')[globalThis.__ntz];
    if (tz) current = { enabled: true, tz };
  }
  globalThis.__ntz = undefined;

  const send = () => {
    window.dispatchEvent(new CustomEvent(EVT_CONFIG, { detail: JSON.stringify(current) }));
  };
  const update = (active) => {
    const next = active || null;
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    current = next;
    send();
  };

  // inject.js says hello when it loads after us; we push when it loaded first.
  window.addEventListener(EVT_HELLO, (e) => { e.stopImmediatePropagation(); send(); }, true);
  if (current) send();

  chrome.storage.local.get('active').then(({ active }) => update(active)).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.active) update(changes.active.newValue);
  });
})();
