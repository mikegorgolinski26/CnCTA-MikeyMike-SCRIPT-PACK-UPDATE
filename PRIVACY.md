# Privacy Policy — CnC MikeyMike Tools for TA

_Last updated: 2026-06-21_

**CnC MikeyMike Tools for TA** ("the extension") is a browser-side enhancement
toolkit for the web game *Tiberium Alliances*. This policy explains exactly what
the extension does and does not do with data.

## Short version

The extension does **not** collect, transmit, sell, or share any personal data.
Everything it stores stays **locally in your own browser**. There are no
analytics, no tracking, and no calls to the developer or any third-party server.

## What is stored, and where

The extension saves only your own preferences, locally:

- **Which tools are enabled/disabled** — stored via `chrome.storage.local`
  (key `CNCTA_ENABLED`) and mirrored to the page so your choices persist.
- **Per-tool settings** — e.g. floating-window positions and sizes, colour
  choices, and feature toggles — stored in your browser's `localStorage` under
  keys scoped to your in-game player + world (e.g. `MM.SETTINGS.<id>.<world>`).
- **Last-seen version** — so the "what's new" page is shown once after an update.

This data never leaves your browser and is not accessible to the developer.

## Game data

The tools read live in-game data (your bases, resources, alliance roster, the
region map, etc.) **in your browser only**, to draw overlays, panels and
summaries. This information is processed locally and is **never transmitted
anywhere** by the extension.

## Permissions and why they are needed

- **`storage`** — to save the preferences described above.
- **Host access to `*.alliances.commandandconquer.com`** — the extension runs
  only on the Tiberium Alliances game pages, to inject its tools there. It has
  no access to any other website.

## Third-party links

The options page may show an optional "Buy Me a Coffee" donation link. If you
choose to use it, you leave the extension and interact with that third party
under their own terms and privacy policy. The extension itself processes no
payments and shares no data.

## Changes

If this policy changes, the updated version will be published with the extension
and the "Last updated" date above will change.

## Contact

Questions: **MikeGorgolinski@outlook.com**

---

_CnC MikeyMike Tools for TA is an unofficial, fan-made tool. It is not affiliated
with, endorsed by, or sponsored by Electronic Arts Inc. "Command & Conquer" and
"Tiberium Alliances" are trademarks of their respective owners._
