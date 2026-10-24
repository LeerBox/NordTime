# Chrome Web Store submission — NordTime

Copy-paste reference for the Developer Dashboard. Upload `dist/nordtime-v<version>.zip`.

## Store listing

**Name:** NordTime (from manifest)

**Summary** (from manifest, 132 characters max):
> Automatically matches your browser's time zone to the location of your current IP address (VPN-aware).

**Category:** Privacy & Security

**Language:** English

**Description:**

```
Your browser's time zone, matched to your VPN.

When you connect to a VPN, websites see an IP address in another country, but your browser still reports your real time zone through JavaScript. That mismatch is one of the easiest ways for a website to tell that you are using a VPN.

NordTime fixes it. It checks the public IP address your browser is using, finds where that IP is located, and gives every website the matching time zone. When your VPN switches server, NordTime notices and follows automatically.

FEATURES
• Fully automatic: checks your IP on startup, every minute (configurable) and right after network changes such as a VPN connecting, disconnecting or switching server.
• Applied before the page runs: the time zone is in place before the first script on the page.
• Live switching: open tabs follow a new location without a reload.
• Thorough: Date, Intl.DateTimeFormat, Temporal and same-origin iframes all report the same time zone, with correct daylight saving time.
• Manual mode: pin any of the ~420 time zones from a searchable list.
• Reliable: several IP and location services with automatic fallback.
• Clear status: the toolbar badge shows the current country code, with an optional notification when the time zone changes.

PRIVACY
• No account, no analytics, no ads, no servers of its own.
• Your settings and last location are stored only on your device.
• The only network requests are the IP and location lookups needed to choose the time zone.

Works with any VPN, whether it is a desktop app or a browser proxy extension.

Open source: https://github.com/LeerBox/NordTime

NordTime is an independent project and is not affiliated with Nord Security or NordVPN.
```

**Graphics** (`store/`):
- Store icon: `icons/icon128.png`
- Screenshots (1280×800): `store/screenshot-1.jpg`, `store/screenshot-2.jpg`
- Small promo tile (440×280): `store/promo-small.jpg`
- Marquee promo tile (1400×560): `store/promo-marquee.jpg`

**Homepage URL:** https://github.com/LeerBox/NordTime
**Support URL:** https://github.com/LeerBox/NordTime/issues

## Privacy practices

**Single purpose:**
> NordTime sets the browser's JavaScript time zone to match the location of the user's current public IP address (for example a VPN exit server), or to a time zone the user chooses manually.

**Permission justifications:**

| Permission | Justification |
| --- | --- |
| `storage` | Saves the user's settings (on/off, automatic or manual mode, chosen time zone, check interval) and the last detected IP location, so the time zone can be applied immediately on every page. |
| `alarms` | Re-checks the public IP address at the interval the user chooses (default every minute), so the time zone follows VPN server changes automatically. |
| `webRequest` | Watches only for network error events (ERR_NETWORK_CHANGED, ERR_INTERNET_DISCONNECTED, proxy/tunnel failures) that occur when a VPN connects, disconnects or switches server, to trigger an immediate IP re-check. No request is read, blocked or modified. |
| `scripting` | Registers the content scripts that apply the selected time zone at document_start, and injects them into tabs that were already open when the extension was installed. |
| `notifications` | Shows an optional notification ("Time zone set to Asia/Tokyo") when the detected time zone changes. Users can turn it off in the popup. |
| Host permission `<all_urls>` | The time zone has to be applied on every website the user visits, since any site can read it, including in iframes. Host access also allows the background worker to call the IP and geolocation lookup services. No page content is read or collected. |

**Remote code:** No, I am not using remote code. (All JavaScript is included in the package; the lookup services return JSON data only.)

**Data usage — collected data types:**
- [x] **Location** (IP address and the approximate region/city/time zone derived from it)
- Everything else: not collected.

**Certifications** (all true for NordTime):
- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** https://github.com/LeerBox/NordTime/blob/main/PRIVACY.md

## Distribution

- Visibility: Public
- Regions: All regions
- Pricing: Free

## Review notes

The `<all_urls>` + `scripting` + `webRequest` combination usually triggers an in-depth review, so the first
review may take several days.
