/*!
 * NordTime — page-world time zone shim.
 *
 * Runs in the page's MAIN world at document_start and makes every
 * time-zone-aware JavaScript API (Date, Intl.DateTimeFormat, Temporal.Now)
 * report the zone chosen by the extension. The zone is delivered by the
 * isolated-world relay (relay.js) through a private DOM event — synchronously
 * at document_start, and live afterwards. While no zone is set every hook
 * simply forwards to the native implementation.
 */
(() => {
  'use strict';

  const EVT_CONFIG = 'nt-3f9a1c:cfg';
  const EVT_PROBE = 'nt-3f9a1c:probe';
  const EVT_HELLO = 'nt-3f9a1c:hello';
  const SECRET = 'k7Qm2xNordTime';

  // ---------------------------------------------------------------------------
  // Pristine references, captured before any page script can tamper with them.
  // ---------------------------------------------------------------------------
  const { apply, construct } = Reflect;
  const { defineProperty, getOwnPropertyDescriptor, create: objectCreate } = Object;
  const ObjectCtor = Object;
  const StringCtor = String;
  const NativeDate = Date;
  const NativeDTF = Intl.DateTimeFormat;
  const jsonParse = JSON.parse;
  const floor = Math.floor;
  const round = Math.round;
  const abs = Math.abs;
  const dateUTC = Date.UTC;
  const dateNow = Date.now;
  const dateParse = Date.parse;
  const DP = Date.prototype;
  const nGetTime = DP.getTime;
  const nGetTimezoneOffset = DP.getTimezoneOffset;
  const nGetUTC = {
    year: DP.getUTCFullYear, month: DP.getUTCMonth, date: DP.getUTCDate, day: DP.getUTCDay,
    hours: DP.getUTCHours, minutes: DP.getUTCMinutes, seconds: DP.getUTCSeconds,
  };
  const nSetUTCFullYear = DP.setUTCFullYear;
  const nSetUTCHours = DP.setUTCHours;
  const formatToParts = NativeDTF.prototype.formatToParts;
  const mapGet = Map.prototype.get;
  const mapSet = Map.prototype.set;
  const mapClear = Map.prototype.clear;
  const mapSize = getOwnPropertyDescriptor(Map.prototype, 'size').get;
  const wmGet = WeakMap.prototype.get;
  const wmSet = WeakMap.prototype.set;
  const wsHas = WeakSet.prototype.has;
  const wsAdd = WeakSet.prototype.add;
  const reExec = RegExp.prototype.exec;
  const strPadStart = String.prototype.padStart;
  const stopImmediate = Event.prototype.stopImmediatePropagation;
  const addListener = EventTarget.prototype.addEventListener;
  const dispatch = EventTarget.prototype.dispatchEvent;
  const NativeCustomEvent = CustomEvent;

  // Bail out if this realm was already patched by a NordTime instance running
  // in a parent frame (see the iframe hooks below).
  {
    const probe = { k: SECRET, found: false };
    try { apply(dispatch, window, [new NativeCustomEvent(EVT_PROBE, { detail: probe })]); } catch { /* ignore */ }
    if (probe.found) return;
  }

  // ---------------------------------------------------------------------------
  // Zone state and time math
  // ---------------------------------------------------------------------------
  const MAX_TIME = 8.64e15;
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // Strings that carry an explicit offset (or are ISO date-only forms, which
  // the spec parses as UTC) must not be re-interpreted as local time.
  const ABSOLUTE_DATE = /\d{1,2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?\s*(?:z|[+-]\d{2}(?::?\d{2})?)(?![\w:])|\b(?:gmt|utc|ut|[ecmp][sd]t)\b|^\s*[+-]?\d{4,6}(?:-\d{2}(?:-\d{2})?)?\s*$/i;

  let TZ = null;           // active IANA zone, or null = pass-through
  let partsFmt = null;     // formatter used to compute offsets
  let nameFmt = null;      // formatter used for "(Central European Time)" names
  const offsetCache = new Map();
  const nameCache = new Map();

  function setZone(tz) {
    let zone = null;
    if (typeof tz === 'string' && tz) {
      try {
        partsFmt = new NativeDTF('en-US', {
          timeZone: tz, hourCycle: 'h23', era: 'short',
          year: 'numeric', month: 'numeric', day: 'numeric',
          hour: 'numeric', minute: 'numeric', second: 'numeric',
        });
        nameFmt = new NativeDTF(undefined, { timeZone: tz, timeZoneName: 'long' });
        zone = tz;
      } catch { zone = null; }
    }
    TZ = zone;
    apply(mapClear, offsetCache, []);
    apply(mapClear, nameCache, []);
  }

  const clampTime = (t) => (t > MAX_TIME ? MAX_TIME : t < -MAX_TIME ? -MAX_TIME : t);
  const timeClip = (t) => (t !== t || abs(t) > MAX_TIME ? NaN : t + 0);
  const tv = (d) => apply(nGetTime, d, []);
  const utcPart = (t, key) => apply(nGetUTC[key], new NativeDate(t), []);
  const pad = (n, len) => apply(strPadStart, StringCtor(n), [len, '0']);

  /** Offset of the active zone at instant `t`, in minutes east of UTC. */
  function offsetAt(t) {
    t = clampTime(t);
    const key = floor(t / 60000);
    const hit = apply(mapGet, offsetCache, [key]);
    if (hit !== undefined) return hit;

    const parts = apply(formatToParts, partsFmt, [t]);
    let y = 1970, mo = 1, d = 1, h = 0, mi = 0, s = 0, bc = false;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      switch (p.type) {
        case 'year': y = +p.value; break;
        case 'month': mo = +p.value; break;
        case 'day': d = +p.value; break;
        case 'hour': h = +p.value; break;
        case 'minute': mi = +p.value; break;
        case 'second': s = +p.value; break;
        case 'era': bc = p.value === 'BC' || p.value === 'B'; break;
      }
    }
    if (bc) y = 1 - y;
    const w = new NativeDate(0);
    apply(nSetUTCFullYear, w, [y, mo - 1, d]);
    apply(nSetUTCHours, w, [h === 24 ? 0 : h, mi, s, 0]);
    const value = round((tv(w) - floor(t / 1000) * 1000) / 60000);

    if (apply(mapSize, offsetCache, []) > 4096) apply(mapClear, offsetCache, []);
    apply(mapSet, offsetCache, [key, value]);
    return value;
  }

  /** UTC instant -> wall-clock time in the active zone (expressed as a UTC ms value). */
  const toWall = (t) => t + offsetAt(t) * 60000;

  /** Wall-clock time in the active zone -> UTC instant. */
  function fromWall(L) {
    if (L !== L || abs(L) > MAX_TIME + 864e5) return NaN;
    const o1 = offsetAt(L);
    let t = L - o1 * 60000;
    const o2 = offsetAt(t);
    if (o2 !== o1) t = L - o2 * 60000;
    return timeClip(t);
  }

  function zoneName(t) {
    const off = offsetAt(t);
    const hit = apply(mapGet, nameCache, [off]);
    if (hit !== undefined) return hit;
    let name = TZ;
    try {
      const parts = apply(formatToParts, nameFmt, [clampTime(t)]);
      for (let i = 0; i < parts.length; i++) if (parts[i].type === 'timeZoneName') name = parts[i].value;
    } catch { /* keep the IANA id */ }
    apply(mapSet, nameCache, [off, name]);
    return name;
  }

  function dateString(t) {
    const w = toWall(t);
    const y = utcPart(w, 'year');
    const year = y < 0 ? '-' + pad(-y, 6) : pad(y, 4);
    return `${DAYS[utcPart(w, 'day')]} ${MONTHS[utcPart(w, 'month')]} ${pad(utcPart(w, 'date'), 2)} ${year}`;
  }

  function timeString(t) {
    const w = toWall(t);
    const off = offsetAt(t);
    const a = abs(off);
    const sign = off < 0 ? '-' : '+';
    return `${pad(utcPart(w, 'hours'), 2)}:${pad(utcPart(w, 'minutes'), 2)}:${pad(utcPart(w, 'seconds'), 2)} ` +
      `GMT${sign}${pad(floor(a / 60), 2)}${pad(a % 60, 2)} (${zoneName(t)})`;
  }

  const fullString = (t) => (t !== t ? 'Invalid Date' : `${dateString(t)} ${timeString(t)}`);

  /** Re-interprets a string the engine parsed as *system* local time in the active zone. */
  function parseInZone(s) {
    const t = apply(dateParse, NativeDate, [s]);
    if (t !== t || apply(reExec, ABSOLUTE_DATE, [s]) !== null) return t;
    const systemOffset = apply(nGetTimezoneOffset, new NativeDate(t), []);
    return fromWall(t - systemOffset * 60000);
  }

  /** Returns Intl options that default `timeZone` to the active zone. */
  function withZone(options) {
    if (options === undefined) return { timeZone: TZ };
    if (options === null) return options; // let the engine throw its own TypeError
    const obj = ObjectCtor(options);
    if (obj.timeZone !== undefined) return options;
    const out = objectCreate(obj);
    defineProperty(out, 'timeZone', { value: TZ, enumerable: true, configurable: true, writable: true });
    return out;
  }

  // ---------------------------------------------------------------------------
  // Native-looking replacements
  // ---------------------------------------------------------------------------
  const masked = new WeakMap(); // replacement -> original (for Function#toString)

  function mask(fake, original) {
    defineProperty(fake, 'length', { value: original.length, configurable: true });
    defineProperty(fake, 'name', { value: original.name, configurable: true });
    apply(wmSet, masked, [fake, original]);
    return fake;
  }

  function replaceMethod(obj, key, fake) {
    const desc = getOwnPropertyDescriptor(obj, key);
    if (!desc || typeof desc.value !== 'function') return;
    mask(fake, desc.value);
    desc.value = fake;
    defineProperty(obj, key, desc);
  }

  function replaceValue(obj, key, value) {
    const desc = getOwnPropertyDescriptor(obj, key);
    if (!desc) return;
    desc.value = value;
    defineProperty(obj, key, desc);
  }

  const installed = new WeakSet();

  function install(win) {
    const W = win.Object; // throws for cross-origin windows
    if (apply(wsHas, installed, [W])) return;
    apply(wsAdd, installed, [W]);

    apply(addListener, win, [EVT_PROBE, (e) => {
      const d = e.detail;
      if (d && d.k === SECRET) { d.found = true; apply(stopImmediate, e, []); }
    }, true]);

    const D = win.Date;
    const P = D.prototype;
    const Intl_ = win.Intl;
    const DTF = Intl_.DateTimeFormat;

    // --- Date.prototype getters -------------------------------------------
    const GETTERS = [
      ['getFullYear', 'year'], ['getMonth', 'month'], ['getDate', 'date'], ['getDay', 'day'],
      ['getHours', 'hours'], ['getMinutes', 'minutes'], ['getSeconds', 'seconds'],
    ];
    for (let i = 0; i < GETTERS.length; i++) {
      const name = GETTERS[i][0], part = GETTERS[i][1], orig = P[name];
      replaceMethod(P, name, {
        [name]() {
          if (TZ === null) return apply(orig, this, arguments);
          const t = tv(this);
          return t !== t ? NaN : utcPart(toWall(t), part);
        },
      }[name]);
    }

    const origGetYear = P.getYear;
    if (origGetYear) {
      replaceMethod(P, 'getYear', {
        getYear() {
          if (TZ === null) return apply(origGetYear, this, arguments);
          const t = tv(this);
          return t !== t ? NaN : utcPart(toWall(t), 'year') - 1900;
        },
      }.getYear);
    }

    const origOffset = P.getTimezoneOffset;
    replaceMethod(P, 'getTimezoneOffset', {
      getTimezoneOffset() {
        if (TZ === null) return apply(origOffset, this, arguments);
        const t = tv(this);
        return t !== t ? NaN : 0 - offsetAt(t);
      },
    }.getTimezoneOffset);

    // --- Date.prototype setters -------------------------------------------
    const SETTERS = ['Milliseconds', 'Seconds', 'Minutes', 'Hours', 'Date', 'Month', 'FullYear'];
    for (let i = 0; i < SETTERS.length; i++) {
      const unit = SETTERS[i], name = 'set' + unit, orig = P[name], utcSetter = P['setUTC' + unit];
      const setTime = P.setTime;
      replaceMethod(P, name, {
        [name]() {
          if (TZ === null) return apply(orig, this, arguments);
          const t = tv(this);
          let wall;
          if (t === t) wall = new NativeDate(toWall(t));
          else if (unit === 'FullYear') wall = new NativeDate(0);
          else {
            apply(utcSetter, new NativeDate(NaN), arguments); // coerce arguments like the engine does
            return apply(setTime, this, [NaN]);
          }
          apply(utcSetter, wall, arguments);
          return apply(setTime, this, [fromWall(tv(wall))]);
        },
      }[name]);
    }

    const origSetYear = P.setYear;
    if (origSetYear) {
      const setTime = P.setTime;
      replaceMethod(P, 'setYear', {
        setYear(year) {
          if (TZ === null) return apply(origSetYear, this, arguments);
          let y = +year;
          if (y !== y) return apply(setTime, this, [NaN]);
          y = y < 0 ? -floor(-y) : floor(y);
          if (y >= 0 && y <= 99) y += 1900;
          const t = tv(this);
          const wall = new NativeDate(t === t ? toWall(t) : 0);
          apply(nSetUTCFullYear, wall, [y]);
          return apply(setTime, this, [fromWall(tv(wall))]);
        },
      }.setYear);
    }

    // --- Date.prototype string conversions --------------------------------
    const origToString = P.toString, origToDateString = P.toDateString, origToTimeString = P.toTimeString;
    replaceMethod(P, 'toString', {
      toString() {
        if (TZ === null) return apply(origToString, this, arguments);
        return fullString(tv(this));
      },
    }.toString);
    replaceMethod(P, 'toDateString', {
      toDateString() {
        if (TZ === null) return apply(origToDateString, this, arguments);
        const t = tv(this);
        return t !== t ? 'Invalid Date' : dateString(t);
      },
    }.toDateString);
    replaceMethod(P, 'toTimeString', {
      toTimeString() {
        if (TZ === null) return apply(origToTimeString, this, arguments);
        const t = tv(this);
        return t !== t ? 'Invalid Date' : timeString(t);
      },
    }.toTimeString);

    const LOCALE_METHODS = ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'];
    for (let i = 0; i < LOCALE_METHODS.length; i++) {
      const name = LOCALE_METHODS[i], orig = P[name];
      replaceMethod(P, name, {
        [name](locales, options) {
          if (TZ === null) return apply(orig, this, arguments);
          return apply(orig, this, [locales, withZone(options)]);
        },
      }[name]);
    }

    // --- Date constructor and Date.parse ----------------------------------
    const FakeDate = new Proxy(D, {
      construct(target, args, newTarget) {
        if (TZ !== null) {
          if (args.length >= 2) {
            args = [fromWall(apply(dateUTC, undefined, args))];
          } else if (args.length === 1 && typeof args[0] === 'string') {
            args = [parseInZone(args[0])];
          }
        }
        return construct(target, args, newTarget);
      },
      apply(target, thisArg, args) {
        if (TZ === null) return apply(target, thisArg, args);
        return fullString(dateNow());
      },
    });
    apply(wmSet, masked, [FakeDate, D]);

    const origParse = D.parse;
    replaceMethod(D, 'parse', {
      parse(string) {
        if (TZ === null) return apply(origParse, this, arguments);
        return parseInZone(StringCtor(string));
      },
    }.parse);

    replaceValue(P, 'constructor', FakeDate);
    replaceValue(win, 'Date', FakeDate);

    // --- Intl.DateTimeFormat ---------------------------------------------
    const FakeDTF = new Proxy(DTF, {
      construct(target, args, newTarget) {
        if (TZ !== null) args = [args[0], withZone(args[1])];
        return construct(target, args, newTarget);
      },
      apply(target, thisArg, args) {
        if (TZ !== null) args = [args[0], withZone(args[1])];
        return apply(target, thisArg, args);
      },
    });
    apply(wmSet, masked, [FakeDTF, DTF]);
    replaceValue(DTF.prototype, 'constructor', FakeDTF);
    replaceValue(Intl_, 'DateTimeFormat', FakeDTF);

    // --- Temporal.Now (where available) -----------------------------------
    const Now = win.Temporal && win.Temporal.Now;
    if (Now) {
      const origId = Now.timeZoneId;
      if (typeof origId === 'function') {
        replaceMethod(Now, 'timeZoneId', {
          timeZoneId() { return TZ === null ? apply(origId, this, arguments) : TZ; },
        }.timeZoneId);
      }
      const ZONED = ['zonedDateTimeISO', 'plainDateTimeISO', 'plainDateISO', 'plainTimeISO'];
      for (let i = 0; i < ZONED.length; i++) {
        const name = ZONED[i], orig = Now[name];
        if (typeof orig !== 'function') continue;
        replaceMethod(Now, name, {
          [name](zone) {
            if (TZ === null || zone !== undefined) return apply(orig, this, arguments);
            return apply(orig, this, [TZ]);
          },
        }[name]);
      }
    }

    // --- Function.prototype.toString: keep replacements looking native -----
    const FP = win.Function.prototype;
    const origFnToString = FP.toString;
    replaceMethod(FP, 'toString', {
      toString() {
        const original = apply(wmGet, masked, [this]);
        return apply(origFnToString, original === undefined ? this : original, arguments);
      },
    }.toString);

    // --- Same-origin iframes: patch before the page can grab their globals --
    const hookFrameGetter = (ctor, key, toWindow) => {
      const proto = ctor && ctor.prototype;
      const desc = proto && getOwnPropertyDescriptor(proto, key);
      if (!desc || !desc.get) return;
      const origGet = desc.get;
      const fake = getOwnPropertyDescriptor({
        get [key]() {
          const result = apply(origGet, this, []);
          if (result) {
            try { const w = toWindow(result); if (w) install(w); } catch { /* cross-origin */ }
          }
          return result;
        },
      }, key).get;
      desc.get = mask(fake, origGet);
      defineProperty(proto, key, desc);
    };
    hookFrameGetter(win.HTMLIFrameElement, 'contentWindow', (w) => w);
    hookFrameGetter(win.HTMLIFrameElement, 'contentDocument', (d) => d.defaultView);
    hookFrameGetter(win.HTMLFrameElement, 'contentWindow', (w) => w);
    hookFrameGetter(win.HTMLFrameElement, 'contentDocument', (d) => d.defaultView);
  }

  // ---------------------------------------------------------------------------
  // Configuration channel (from relay.js, isolated world)
  // ---------------------------------------------------------------------------
  apply(addListener, window, [EVT_CONFIG, (e) => {
    apply(stopImmediate, e, []);
    let cfg = null;
    try { cfg = jsonParse(e.detail); } catch { return; }
    setZone(cfg && cfg.enabled ? cfg.tz : null);
  }, true]);

  install(window);

  // If the relay is already running it answers synchronously with the zone.
  try { apply(dispatch, window, [new NativeCustomEvent(EVT_HELLO)]); } catch { /* ignore */ }
})();
