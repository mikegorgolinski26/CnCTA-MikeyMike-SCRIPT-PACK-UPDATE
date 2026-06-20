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
