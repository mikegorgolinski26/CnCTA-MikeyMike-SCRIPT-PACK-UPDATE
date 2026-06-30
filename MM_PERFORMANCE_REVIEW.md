# MM Pack — Performance / Memory Review (2026-06-30)

**Question from Mike:** the game UI gets progressively sluggish after ~1 hour of play; a browser
refresh instantly clears it. Is this garbage collection? Where is the pack leaking, and what can be
tuned without hurting the player experience? *(Planning only — no code changed.)*

**Method:** swept all 21 live `scripts/*.user.js` for every accumulation primitive
(`setInterval`/`setTimeout`, `addEventListener`/`addListener`, `MutationObserver`, DOM
create/append, growing caches), then deep-read each subsystem. Two headline findings were
re-verified by direct read.

---

## TL;DR

1. **Yes, GC is alive and well — but GC can't help here.** Modern engines (V8) collect automatically
   and you can't force it. The slowdown isn't "GC not running"; it's that the pack keeps things
   **reachable**, so GC is *not allowed* to collect them. The fix is removing references: dispose
   widgets, clear timers, remove listeners, cap caches. A refresh "works" because it throws away the
   whole heap and starts every timer/registry from zero.

2. **The pack is unusually leak-disciplined.** 14 of the 20 feature scripts are clean. The 28-add /
   3-remove listener ratio that looked alarming is balanced by design (qooxdoo disposes a widget's
   listeners when the widget is destroyed, and render paths destroy old children before rebuilding).

3. **Two distinct mechanisms cause the symptom — they compound:**
   - **(A) One genuine cumulative leak** — `MM_MovableMenuOverlay` leaks an undisposed qooxdoo
     widget + listener **every time a menu fly-out is opened** (Mail/Forum/Ranking/…). Routine action
     → steady growth of retained DOM + qx object-registry entries over an hour. **Best match for
     "worse over time, fixed by refresh."**
   - **(B) A constant-cost main-thread tax** — the on-map bubble overlays run **multiple always-on
     5–6 Hz timers** that call `getBoundingClientRect()` (a forced synchronous reflow) over every
     bubble/panel, plus redundant game-API calls on every pan. This doesn't grow with *time*, but it
     grows with *how much you've accumulated* — more bubbles in view, more overlays open, more
     leaked widgets from (A) → each tick does more work. That's why it *feels* like it worsens.

**Fix order:** (A) first — it's the true leak and a small change. Then (B) to lower the baseline.

---

## Priority findings

### P0 — the real cumulative leak (do first)

**1. `MM_MovableMenuOverlay.user.js:218–244` — undisposed overlay container per menu open.**
`createMM()` removes the previous container from the desktop (`A.getDesktop().remove(this.MMO)`,
line 226) but never `dispose()`s it and never removes its `pointerup` listener (line 236), then
allocates a fresh `new MMOverlay(...)` (230) with a new listener every call. In qooxdoo, a widget
that isn't `dispose()`d stays pinned in `qx.core.ObjectRegistry` (plus its DOM node + the closure
capturing `self`) for the life of the page.
- *Why it matches the symptom:* opening Mail/Forum/Ranking/alliance panels is routine; each open
  leaks one widget tree. Over an hour this is real, growing retained memory + a heavier qx desktop.
- *Fix (either):* **(preferred)** build the container **once**, lazily, and just **reposition + re-add**
  it on subsequent opens so the `pointerup` listener is attached exactly once; **or** before
  discarding the old one, `this.MMO.removeListener("pointerup", <bound handler>)` then
  `this.MMO.dispose()` after `remove()`. Effort: small.

### P1 — constant-cost reflow tax (lower the baseline)

**2. `MM_CommonLibrary.user.js:4666` — `bubbleLayer` `popupTimer` fires every 200 ms with no
`count()===0` short-circuit.** Each instance also runs a 200 ms camera `watch`. Base Scanner uses
this layer and Player Base Info has its own equivalent → steady state is **several always-on 5 Hz
timers** doing `getBoundingClientRect()` over every bubble + info panel, indefinitely.
- *Fixes:* early-return the `popupTimer` body when `count()===0`; ensure every consumer calls the
  layer's `destroy()` (4696, which *does* clear the timer) from its `lifecycle.onDisable`; ideally
  collapse the per-consumer `watch`+`popup` pair into **one shared** layer/timer. Effort: small–med.

**3. `MM_PlayerBaseInfo.user.js:469` — 150 ms timer → `updatePopupVisibility()` reflow storm.** Calls
`getBoundingClientRect()` per bubble (line 339) **interleaved with `style.visibility` writes** (341)
— a read→write→read layout-thrash 6.6×/sec, running even when no popup is open, scaling with visible
bases.
- *Fixes:* skip the whole per-bubble loop when no info panel is open (check `popupRects().length`
  once at the top); **batch all reads before any writes**; slow to 300–400 ms; capture the timer
  handle and stop it in `onDisable` (currently the 8 s + 150 ms timers keep ticking after disable).
  Effort: small.

**4. `MM_CommonLibrary.user.js:4254–4275` — `worldToScreen()` calls `get_Region()` ~4× per bubble per
reproject.** `gw()` and `gh()` each call `rg()`=`get_Region()`, and `position()` calls
`worldToScreen` twice per bubble — so one `reprojectAll()` over N bubbles makes ~4N obfuscated-client
round-trips, on every pan/zoom tick.
- *Fix:* hoist `var GW=gw(), GH=gh()` (and the region handle) **once per `reprojectAll()`** and pass
  them down. Pure win, no behavior change. Effort: small.

### P2 — hygiene + minor cumulative (nice-to-have)

**5. `MM_CommonLibrary.user.js:128–158` — `settings.get/set` re-parse the entire localStorage blob
every call** (`JSON.parse`/`stringify`), hit by per-window `savePos` polls (1.5 s) and every drag
`move`. Keep the in-memory `cache` authoritative; only `load()` on first access / external change;
debounce writes. Effort: small.

**6. `MM_TranslatedChat.user.js:90` — translation `cache = {}` grows unbounded** (one entry per
distinct message text; never evicted). Small strings, gated by message *diversity*, so slow — but
uncapped. Add an LRU cap (~500). *(Note: the rest of this script is exemplary — feed capped at 250
rows with proper `dispose()`, listeners bound once, per-message timers cleared. Use it as the
reference pattern.)* Effort: small.

**7. `MM_BattleSimulator.user.js:4194 / 3997` — `appear`/`OnSimulateBattleFinished` listeners can
stack on repeated toggle/Sim clicks** on shared singletons. Low rate (manual clicks), handlers
idempotent. Guard each with a "listening" flag or `removeListener` before `addListener`. Effort: small.

**8. `MM_BaseInfo.user.js:185` — `BaseinfoFenster` rebuild does `removeAll()` without disposing the
old tab widgets** → orphans accumulate on repeated window re-open (user-paced, low). Dispose children
before rebuild, or reuse widgets. Effort: small.

**9. Optional caps (deliberate buffers, only grow with user actions, low risk):**
`MM_BattleSimulator` per-formation sim `CACHE` (2278), `MM_TheMovement` undo `History` (369),
`MM_PlayerBaseInfo` base-id `cache` (89). Add LRU/size caps if you want belt-and-suspenders.

---

## Verified CLEAN (rule these out)

- **AttackAlert, AttackRange, TunnelInfo, MoveInfo, LootSummary, Real_POI_Bonus, MemberStatus,
  NextMCV** — library-owned timers with paired stoppers, singleton install guards, `clearMarkers()`/
  `clearList()` before every redraw, overlay layers that remove the prior node before recreating.
  (MemberStatus rebuilds its grid every 5 s but `destroy()`s old widgets and self-suppresses when
  hidden — churny, not leaking.)
- **BaseTools, Upgrade** — the listener-heavy pair; add/remove balanced by qooxdoo widget disposal;
  render paths destroy old children first; the lone un-cleared `setInterval` (Upgrade:1090) is
  created once, 1 Hz, trivial visibility-gated work.
- **BattleSimulator** — repeatedly opening the Sim/Stats window does **not** leak (singleton +
  symmetric `onAppear`/`onClose` add/remove; optimizer cleans up per run). Only the P2-#7 toggle
  stacking.
- **FrameworkWrapper, CnCTAOptLink** — one-time setup, self-terminating load polls.
- **MovableMenuOverlay dragging** — uses the qooxdoo `MMovable` mixin, not manual mousedown→
  mousemove/mouseup handlers, so dragging itself is leak-free (the leak is per-*open*, P0-#1).
- Shared i18n `t()` is an O(1) object lookup; the menubar `MutationObserver` is flag-guarded,
  `{childList:true}` only (not subtree), single shared 1.5 s timer.

---

## Systemic recommendation (prevents regressions)

The pack already has the right hook: `NS.lifecycle.watch(id, {onEnable, onDisable})`
(`MM_CommonLibrary.user.js:5545`). Three conventions would close the gap permanently:

1. **Every always-on timer/listener must be stored and torn down in `onDisable`.** Several scripts
   create a persistent timer but never capture its handle (PlayerBaseInfo 150 ms + 8 s, Upgrade
   1090, LootSummary `watch`). A small **`MMCommon.disposables`** helper — `add(fn)` to register a
   teardown, `disposeAll()` called automatically on `onDisable` — makes this one-line and uniform.
2. **Never drop a qooxdoo widget without `dispose()`.** `desktop.remove()` / `removeAll()` detach but
   do **not** free — undisposed widgets pin in `qx.core.ObjectRegistry`. This single rule would have
   prevented P0-#1 and P2-#8. Worth a note in the review playbook.
3. **Add a dev "leak meter"** (debug-only command): log `qx.core.ObjectRegistry` size, active
   bubble/overlay counts, and live timer count every minute. Watch them flatline vs. climb during a
   play session — turns "feels sluggish" into a measurable regression test before each store upload.

---

## Suggested sequence for next session

1. **P0-#1** (MovableMenuOverlay dispose) — biggest symptom impact, smallest change. Ship + have Mike
   play ~1 hr and confirm the curve flattens (or use the leak meter).
2. **P1-#2/#3/#4** (bubble-timer short-circuit, PlayerBaseInfo batching, `worldToScreen` hoist) —
   lowers baseline cost, especially on dense maps.
3. **Systemic #1/#2** — fold teardown into `lifecycle`, add the playbook rule.
4. **P2** items opportunistically during normal script reviews.

Nothing here degrades the player experience — every change is either teardown of invisible
background work, throttling of redundant reflow, or eliminating duplicate game-API calls.
