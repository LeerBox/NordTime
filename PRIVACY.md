# NordTime Privacy Policy

_Last updated: October 25, 2026_

NordTime is a browser extension that sets the browser's time zone to match the location of your current
public IP address. This policy explains what data the extension handles and why.

## Summary

- NordTime has **no servers, no accounts, no analytics and no advertising**.
- The developer **does not receive any of your data**.
- All settings and results are stored **only on your device**.

## Data the extension handles

| Data | Why | Where it goes |
| --- | --- | --- |
| Your public IP address | To find out which country and time zone your connection (or VPN) appears to be in | Sent to the IP lookup services listed below, and stored locally on your device |
| Approximate location of that IP (country, region, city, time zone, network/ISP name) | To choose the matching time zone and show it in the popup | Received from the lookup services and stored locally on your device |
| Your settings (on/off, automatic or manual mode, chosen time zone, check interval, notifications) | To remember your preferences | Stored locally on your device |

Everything is kept in the browser's extension storage (`chrome.storage.local`). It is never sent to the
developer and is removed when you uninstall the extension.

## Third-party services

To find your public IP address and its time zone, NordTime sends requests to these public services. They
are tried in order, and the next one is used only if the previous one fails:

- IP address: [ipify](https://www.ipify.org), [Cloudflare](https://www.cloudflare.com/privacypolicy/),
  [icanhazip](https://icanhazip.com)
- Location of an IP: [ipwho.is](https://ipwho.is), [GeoJS](https://www.geojs.io),
  [ipapi.co](https://ipapi.co/privacy/), [freeipapi.com](https://freeipapi.com)

These requests contain your IP address, which is part of any internet request. They are sent without
cookies and without a referrer. They contain no browsing history and no other personal information. Each
service handles requests under its own privacy policy.

## Web pages

NordTime runs a script on the web pages you visit so that their JavaScript sees the selected time zone.
That script changes how time zone functions behave. It does **not** read, collect or send page content,
form data, browsing history or any other information from the pages.

## Data sharing and sale

NordTime does not sell, rent or share your data, and does not use it for advertising, creditworthiness or
any purpose other than its single purpose described above.

## Contact

Questions or concerns: open an issue at <https://github.com/LeerBox/NordTime/issues>.
