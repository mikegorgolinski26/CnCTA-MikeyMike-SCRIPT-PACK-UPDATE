# MM Script Pack — Review & Enhancement Playbook

This is the standard checklist applied to **every** script when it's reviewed/overhauled for the
CnCTA MikeyMike pack. When Mike says "review/update script X," all of the below is implied — he
should not have to re-explain it each time.

## 1. Branding & header
- `@name` → `MM - <clean descriptive name>` (drop upstream/cryptic names).
- `@version` → semver, **starting at `1.0.0`** the first time we touch it (upstream version numbers
  are irrelevant; this is a fresh standalone pack).
- Repoint `@updateURL` / `@downloadURL` to the MM repo
  (`https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/<file>`).
- Add `@contributor MikeyMike`.
- Replace the upstream changelog comment block with a clear **"what it does / why it's needed"**
  doc block. **Keep original author credit** (upstream is GPL/CC — attribution required).
- Update the matching options-page row in `CnCTA-MikeyMike-Extension/background.js`
  (`name` → `MM - ...`, `version` → `  v1.0.0`).
- Filenames are **left as-is** until the go-public batch rename (see going-public checklist).

## 2. Debugging framework (consistent across the pack)
- One log prefix per script: `[MM <Short Name>]`.
- Helpers: `wlog()` (verbose/info), `wwarn()`, `werr()` — each wrapped in try/catch so logging can
  never throw.
- Verbose `wlog` is **gated behind a runtime flag** (e.g. `window.<SCRIPT>_DEBUG`), **off by
  default** (clean console). **Warnings and errors always show.**
- Toggle from the game console at runtime, no reload of code logic required.
- Replace scattered `console.log` calls with these helpers.

## 3. Robustness / crash-proofing (don't let it die like the wrapper could)
- Wrap **independent feature inits in their own try/catch** so one failure can't cascade and kill
  the rest. Log precisely *what* failed.
- Guard **patch-fragile assumptions**: regex/obfuscated-name lookups must check for `null`/no-match
  and emit a clear "game may have updated" message instead of a cryptic crash.
- Never let **cosmetic code (logging, optional globals)** abort critical setup — guard optional
  globals with `typeof X !== 'undefined'`.
- Null-guard DOM lookups (`document.head || document.documentElement`, check elements exist).
- Where a script exposes an "installed/ready" flag, set it false on partial failure so dependents
  can detect a bad init.
- **Preserve happy-path behavior**: keep core/de-obfuscation logic verbatim; only *guard around* it.

## 4. Efficiency
- Only **well-justified, low-risk** changes. Don't refactor working hot paths for style.
- Look for: redundant work in loops/timers, duplicate event listeners, missing debounce, repeated
  expensive lookups that can be cached, unbounded polling.
- If there's no real win, say so and leave it alone — don't add risk for nothing.

## 4b. Lifecycle teardown & memory hygiene (long-session slowdown)
The game is a long-running single-page app — the player never reloads for hours. Anything that
*accumulates* makes the UI progressively sluggish (the "fine for 10 min, laggy after an hour, fixed
by refresh" symptom). The leak is never "GC isn't running" — it's that we keep things **reachable**.
Rules (see `MM_PERFORMANCE_REVIEW.md` for the 2026-06-30 audit that motivated these):
- **Never drop a qooxdoo widget without `dispose()`.** `desktop.remove()` / `container.removeAll()`
  only *detach* — the widget stays pinned in `qx.core.ObjectRegistry` forever. If you replace a
  widget on each open/redraw, `dispose()` the old one (after `removeAll()` so you don't destroy
  game-owned children). This was the #1 real leak (Movable Menus, build 1.0.165).
- **Every always-on timer / listener must be stored and torn down** in the script's
  `lifecycle.onDisable`, and re-armed in `onEnable`. Don't fire-and-forget a `setInterval` whose
  handle you never keep. Prefer the helper: `var D = MMCommon.disposables(REGISTRY_ID)` →
  `D.addInterval(fn, ms)` / `D.addListener(el, type, fn)` / `D.add(teardownFn)` auto-clear on disable.
- **Don't re-bind listeners on a redraw/poll/per-row path.** Bind once at build, or on a qooxdoo
  widget that gets `dispose()`d each rebuild (qooxdoo frees its listeners then).
- **High-frequency timers must do the cheap check first.** Short-circuit before any
  `getBoundingClientRect()` / DOM walk (e.g. skip when there are zero overlay items). Resolve
  expensive game handles (`get_Region()`, grid dims) **once per pass**, not per item per axis.
- **Cap any cache that grows with play** (per message / base / coord / formation) — LRU or size cap.
- **Measure, don't guess:** `MMCommon.debug.leakMeter.start()` logs `qx.core.ObjectRegistry` size,
  DOM node count, and live MM timers/listeners over time. Counts that climb while the game sits idle
  = a leak. Run it for a session before a store upload when touching always-on code.

## 5. UX / options (where applicable)
- Prefer a **tabbed options panel** for user-tunable settings over localStorage-only config.
- Group related settings; persist via the script's existing settings store.

## 6. Verify & sync (every time)
- `node --check` the file (must pass JS parse).
- Copy the updated file into `CnCTA-MikeyMike-Extension/scripts/`.
- Reload the extension tile to test live.
- Per-batch: bump `manifest.json` version + add a `CHANGELOG.txt` block when the batch ships.

---
*Scope discipline:* match the change to the request. Small scripts get a light pass; big ones
(simulators, scanners) get the full treatment. Flag anything risky before doing it.
