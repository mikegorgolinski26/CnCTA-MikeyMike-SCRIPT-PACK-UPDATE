# MM Pack — Consolidation Plan & Remaining-Script Dispositions

_Authoritative go-forward doc, generated 2026-06-21 (overnight re-review of the 42 remaining `TA_*`
scripts, fan-out of 7 read-only agents). Supersedes the per-script verdicts in `MM_SCRIPT_AUDIT.md`
(kept for history). Ultimate goal: a clean, published **CnC MM Pack** Chrome extension._

---

## 0. Snapshot

- Pack folder = **52 userscripts**: **10 MM-built** (Wrapper, Common Library, Base Tools, Base Scanner,
  Next MCV, Base Info, Attack Range, Member Status, Player Base Info, Battle Simulator) + **42 legacy
  `TA_*`** still to process.
- Every legacy script was re-read in full this pass. Dispositions below are **accurate as of the current
  files** (the old audit listed 67 and some already-retired/renamed entries).

### Disposition tally (42 legacy)
| Bucket | Count | Meaning |
|---|---|---|
| 🔐 SECURITY-QUARANTINE | 3 | Exclude from the published build; do NOT lift code. |
| 🗑️ RETIRE | 2 | Pure duplicate, nothing unique — delete. |
| ♻️ SALVAGE-THEN-RETIRE | 21 | Lift the named bit(s) into MMCommon/an MM script, then delete. |
| ⭐ MM-IFY | 11 | Rebrand + rebuild on MMCommon as a keeper feature. |
| ❓ KEEP-PENDING-REVIEW | 5 | Needs Mike's yes/no before MM-IFY vs retire. |

---

## 1. The three biggest cross-cutting wins (do these first — they unlock multiple retires)

1. **Bulk public-data fetch path** — `CommunicationManager.SendSimpleCommand("GetPublicAllianceInfo"/"GetPublicPlayerInfo"/"GetPublicPlayerInfoByName"/"RankingGetData", …)` + `phe.cnc.Util.createEventDelegate`.
   Found in **TA_CD_PvP_Quick_Map**, **TA_PvP_PvE_Ranking…**, **TA_POIs_Analyser**, **TA_Real_POI_Bonus**.
   Returns whole alliances'/players' base lists in one round-trip. **LIVE-SNIFFED 2026-06-21 — the payload is
   enumeration only:** base entry = `{i, n, p, x, y}` (id/name/**points**/coords), member entry =
   `{c, f, i, n, p, r}` (cityCount/faction/id/name/points/rank). **It does NOT carry per-base offense/defense**
   — so it does NOT replace or speed up the Player Base Info off/def survey (that crash is already handled by
   the 1.2.3 pause-out-of-region fix). Still useful as `MMCommon.base.fetchPublicPlayerBases /
   fetchPlayerByName / fetchAllianceInfo` for **instant full base enumeration incl. off-screen bases** + as the
   data path for the **PvP/PvE Ranking** and **alliance-overview/POI** MM-IFY keepers. **Build it when those
   tools come up — NOT a survey fix.** Full field decode in [[offdef-batch-fetch-idea]].
2. **Implement `MMCommon.cnctaopt.encode`** (currently a STUB) from **TA_CnCTAOpt_Link_Button** (the LIVE
   cnctaopt.com `ver=3~…~` encoder). Unlocks retiring the link-button cluster and gives every MM script a
   "share this base" capability.
3. **Unify range scanning on `MMCommon.scan.inRange`.** ~6 scripts re-roll the same
   `world.GetObjectFromPosition` ring-walk + the same `/return this\.[A-Z]{6}\.([A-Z]{6})/` de-obf (already
   in the Wrapper). Converging them retires the entire scanner/counter cluster.

**Publish-gate note (NOT ongoing work — handled by construction):** almost every legacy script carries a
third-party `@updateURL`/`@downloadURL` (netquik, SebHeuze, userscripts.org). Two things make this a
non-issue: (1) those headers are **userscript-manager directives that the Chrome extension never reads** —
`content.js` loads the bundled files, so they're inert metadata, not a live channel; (2) every keeper is
**re-authored as an MM script** with our own header (pointing at Mike's repo, like the existing 10 MM
scripts), so the third-party lines vanish automatically. The only genuine **runtime** remote channels
(`@require` a remote CDN, self-update fetch, data POSTs) live solely in the **3 quarantine scripts**
(leoStats, BaseShare), which are dropped entirely. → This reduces to a single **publish-gate verification**:
confirm no legacy file was bundled verbatim, and a build-wide grep for `fetch(`/`XHR`/`$.post`/remote
`@require` returns nothing outside our own domain. See §8 Phase 6.

---

## 2. SECURITY-QUARANTINE — exclude from the published build

> **DONE 2026-06-21 — the two data-exfiltration scripts are REMOVED** (at Mike's request, after confirming
> what leoStats sends). Both were already `enabled:false` (leoStats also `inactive:true` and **not even
> deployed** to the extension build), so nothing was ever being sent at runtime; now deleted outright so they
> can't be toggled on. Files removed from both repos + registry rows gone. The orphaned `jquery-3.7.1.min`
> lib (leoStats was its only consumer) is now unreferenced — optional file-level cleanup later.

| Script | Why | Status |
|---|---|---|
| ~~**TA_leoStats**~~ | Self-described **encrypted** payload, `@updateURL` auto-updates from `cnc.indyserver.info`, remote `@require` jQuery, and **POSTs full account/base/alliance + report data** to indyserver.info (+ legacy 000webhostapp.com) on load + hourly. Responses are upload-dedup bookkeeping + a self-whisper link to the external site — **no in-game value comes back**. | ✅ REMOVED 2026-06-21 |
| ~~**TA_BaseShare**~~ | **POSTs your reachable-base dataset + player/alliance identity** to `project-exception.net` on every scan; cross-script-coupled (`typeof leoStats`/`typeof BaseInfo`). | ✅ REMOVED 2026-06-21 |
| **TA_Hotkeys** | Shipped a **plaintext email/password table for up to 9 accounts** + auto-submit login. (Local credential-storage risk, NOT exfiltration.) | ✅ CREDENTIAL CODE STRIPPED 2026-06-21 (→2.2.5): removed the `Logins` table, `Login()`, and the Alt+1-9/Alt+0 login/logout handlers + fixed the dead-`link` bug. Kept Alt+Y (signature) + Alt+I (per-base dump) for later salvage → MM - Base Info via `base.ownCities`+`coords.insertIntoChat`. Still `enabled:false`; the file retires once Alt+I/Alt+Y are salvaged. |

---

## 3. RETIRE outright (2) — pure duplicates  ✅ DONE 2026-06-21

| Script | Superseded by |
|---|---|
| ~~**TA_Count_Forgotten_Bases_Range**~~ | ✅ RETIRED — exact subset of Shockr's BaseCounter **and** of `scan.inRange`+`coords.insertIntoChat`. |
| ~~**TA_New_Custom_Flunik_Tools**~~ | ✅ RETIRED — orphan source (no registry row); strict subset of TA_Autopilot's upgrade engine **and** of MM - Base Tools. (`getMissingTechIndexesFromTechLevelRequirement` nugget still to capture in MMCommon from the keeper, §6.) |

---

## 4. MM-IFY keepers (11) — rebrand + rebuild on MMCommon (playbook pass each)

Priority order (high → low), with the new MM name and the one-line reason:

1. **TA_Tunnel_Info → MM - Tunnel Info** ✅ DONE + VERIFIED 2026-06-21 (1.0.0, id 10205) — rebuilt on
   MMCommon (map/coords/net/ui/buttons), green=activate / red=blocked + the move-panel offense/required
   readout, `[tir]` range (default 6) + override, HUD button. **Original TA_Tunnel_Info RETIRED.**
2. **TA_CD_PvP_Alert_Status → MM - Attack Alert** — incoming-attack title/favicon/siren alarm; no MM
   equivalent. Most robust legacy script. Event-drive via `net.attach` instead of the 5s poll; `enable_sound`→`settings`.
3. **TA_Real_POI_Bonus → MM - Real POI Bonus** — rank-corrected POI gain/loss; also yields the
   `RankingGetData` bulk path. Convert its `getObject` hack → `deobf.objectMemberOfSetter`.
4. **TA_POIs_Analyser → MM - POI Analyser** — POI score/tier/rank tables + acquisition simulator. Move the
   POI math into `MMCommon.poi.*`.
5. **TA_POI_ExporterTools → MM - POI Exporter** — POI→CSV + sector survey; modern/clean code. Lift CSV +
   sector helpers to MMCommon (§6).
6. ~~**TA_Report_Stats → MM - Report Stats**~~ — **RETIRED 2026-06-21 (Mike: deferred out of the initial
   release).** Was: combat-report CP/RT/loot analyzer (a checkbox column on the in-game combat-reports table;
   tick N reports → combined Command-Point cost + Repair-Time + net Loot). Chose to DOCUMENT the salvageable
   model here rather than stub inert code into MMCommon, to keep the release lean. **Salvage spec for a future
   MM - Report Stats (post-release):**
   - **Combined cost/loot model** (from `onAllReportsLoaded`): per selected `ClientLib.Data.Reports.CombatReport`
     — RT = Σ `GetAttackerMaxRepairTime()`; CP from server constants × base-to-base distance per report type
     (`EReportType.Combat` → `PvPCombatCostMinimum + PvPCombatCostPerField*dist`; `NPCRaid` →
     `CombatCostMinimum + CombatCostPerField{Inside,Outside}*dist`; `NPCPlayerCombat`/Forgotten = free);
     Loot per resource = `GetAttackerTotalResourceReceived(rt) − GetAttackerRepairCosts(rt)` (defender variants
     when `EPlayerReportType` ≠ CombatOffense). Server getters: `get_CombatCostMinimum/_PvPCombatCostMinimum/
     _CombatCostPerField/_CombatCostPerFieldOutsideTerritory/_PvPCombatCostPerField`. Load reports via
     `reports.RequestReportData(id)` + the `ReportDelivered` net event.
   - **Generic "add a column to a game qooxdoo table" patch** (the fragile part): the game's
     `qx.ui.table.model.Abstract` / `qx.ui.table.columnmodel.Basic` have no public `addColumn`, so the original
     reconstructs one by `.toString()`-regexing their minified member names. If ever rebuilt, this belongs in the
     **Framework Wrapper** (de-obf registry) as a guarded `table.addColumn` helper, not a per-script regex.
   - Would also have absorbed **Report_Summary**'s "scan all reports" mode (`reports.scanAll(type)`).
7. **TA_Warchief_Upgrade_Base_Defense_Army → MM - Upgrade Helper** (or a Base Tools tab) — clean **manual**
   upgrade-to-level-N UI using official `ClientLib.API.*` (no de-obf). Adds per-selection + Defense/Army
   upgrade UX Base Tools lacks.
7b. **(decide)** could instead become a **new tab in MM - Base Tools** rather than its own script — Mike's call.
8. **TA_Warchief_Sector_HUD → MM - Sector HUD** — thinnest case; ~20 lines of glue over
   `map.viewCenter/track` + `coords.sector/insertIntoChat/goTo`. Or fold into an existing MM HUD.
9. **TA_Zoom → MM - Zoom** — extend map zoom range; tiny QoL. Route constants through `settings`.
10. **TA_ADDON_City_Online_Status_Colorer_SC → MM - Online Status Colorer** — on-map member-online
    coloring (a delivery mode Member Status doesn't have). Highest fragility (patches a render hot-path);
    move the `UpdateColor`/`SetCanvasValue` de-obf into the **Wrapper**.
11. **TA_Repair_Time_Of_Death → (fold into MM - Player Base Info / region-tooltip family)** — tiny unique
    ghost-base "offense repair at death" intel. Add `repair.offenseAtDeath(city)` to MMCommon.

---

## 5. SALVAGE-THEN-RETIRE (21) — lift the named bit, then delete

**Scanners / loot**
- **TA_Shockr_…_Basescanner** → salvage `getLayout()` accumulator/neighbour field-profile (tib/cry/mix/pow
  4–8) → `MMCommon.layout.accumulatorProfile` (feeds the Layout Optimizer). Self-mail delivery optional.
- **TA_PluginsLib_mhLoot** (newer of the two MHTools) → salvage `getLoots2()` =
  `ClientLib.API.Battleground.GetInstance().GetLootFromCurrentCity()` → upgrade `loot.ofCity` to prefer it.
  Replace its hand-rolled window+`PluginsLib.Menu` dep with `ui.Window`+`menu`.
- **TA_MHTools_Available_Loot_Summary_Info** (older dup) → salvage `getImportants()` CY/DF/Support
  grid-position locator → one MM intel helper. Otherwise covered.

**Upgrade / repair automation** (all duplicate MM - Base Tools' auto-collect/repair + upgrade-priority)
- **TA_Auto_Repair** → salvage (1) drag-drop **repair-order** config, (2) **ROI-on-repair-cost** sort
  (`getBuildingReturnOnFullRepair`), (3) **lockdown-aware** rescheduling → into Base Tools' repair routine.
- **TA_Upgrade_Top_ModButtonPos** → salvage Tib-vs-Cry harvester/silo classification via `OwnProdModifiers`
  → `base.classifyResourceBuilding`. "Upgrade highest-of-type" as a selectable Base Tools mode.
- **TA_Autopilot** → diff its health-per-cost unit ranking vs the existing prioritizer; lift only if better.
- **TA_Flunik_Tools_reloaded** → salvage per-resource **POI scoring tables** → MM - Base Scanner / POI Analyser.

**Info overlays**
- ~~**TA_Info_Sticker**~~ → **RETIRED 2026-06-21.** Its keeper feature (the MCV docked into the game's base
  bar with the menu look-and-feel) was rebuilt as the `MMCommon.menubar` module + the MM - Next MCV "Dock in
  game menu bar" option + the MM buttons "menubar" dock mode (build 1.0.49–1.0.51) — Mike confirmed it looks
  good. Its other stickers (resources / 6h-vs-continuous production / repair times) were intentionally dropped
  (Next MCV + Base Tools + Base Scanner already cover them). NOT salvaged into MMCommon (per Mike's "don't ship
  unused code" rule): the smooth `interpolateColor`/`formatNumberColor` ratio→colour gradient helper is in the
  retired file's git history if a future smooth gradient is wanted — we currently use the 3-step
  `barColor` (red/yellow/green) in Next MCV / Loot Summary.
- **TA_Wavy** → salvage (1) move-base-tool **per-cell cache** overlay → MM - Attack Range; (2) auto-mark
  forgotten-defense reports read (opt-in toggle); (3) wave-count model → MMCommon. De-obf already in Wrapper.
- **TA_CityMoveInfoExtend** → salvage only the **cooldown-expiry wall-clock** annotation → MM - Attack
  Range / move-info. Its range scan is the inferior dup of Wavy/scan.inRange.

**Maps**
- **TA_Map** → salvage whole-region scan→canvas **paint loop** → new "MM - Region Minimap" on `map.grid/
  worldToScreen`; POI min/max-level filter UI; two-point "border line" overlay concept.
- **TA_CD_PvP_Quick_Map** → **salvage the bulk-fetch path (§1.1)** → `base.fetch*`. Radar view itself
  optional. The alliance-picker/color-assign options could feed Player Base Info / Member Status.

**POI / reports / combat**
- **TA_The_Green_Cross_Tools** → POI window is a dup of POIs_Analyser; scanner is dead + covered by MM -
  Base Scanner. Salvage only the commented per-field loot model as a `loot.ofCity` cross-check.
- **TA_Report_Summary** → salvage the **bulk report-scan pipeline** (`GetReportCount`→
  `RequestReportHeaderDataAll`→per-report `RequestReportData`, grouped by base/date via `MergeResourceCosts`)
  → `reports.scanAll(type)`, consumed by MM - Report Stats.
- **TA_Formation_Saver** → fold the per-base/per-own-city **formation save/load** schema + load-via-
  `MoveBattleUnit` round-trip into **MM - Battle Simulator** (store via `settings`, not raw localStorage).

**Player info / links**
- **TA_PvP_PvE_Ranking…** (superset of the pair) → salvage (1) per-member `GetPublicPlayerInfoByName`
  **fan-out** → Member Status batched fetch (pairs with §1.1); (2) support-building Ion→Art→Air detection →
  `base.status`; (3) 2-tile POI-on-base predicate → `scan`/poi helper. Both info surfaces covered by Base
  Info + Member Status.
- **TA_PvP_PvE_Player_Info_Mod** (subset) → salvage only the 2-tile POI-on-base predicate; else superseded.
- **TA_View_Player_Base** → target site **cncopt.com is dead**; encoder superseded by the cnctaopt one (do
  NOT mix keymaps). Salvage only the alliance-`get_POI*Bonus()` getters → base/layout bonus model.
- ~~**TA_CnCTAOpt_Link_Button**~~ → ✅ DONE + VERIFIED 2026-06-21: encoder lifted into `MMCommon.cnctaopt`
  (1.0.8), reissued as **MM - CnCTAOpt Link** (id 10204), original RETIRED. (View_Player_Base also retired.)

**Economy**
- **TA_New_Resource_Trade_Window** → salvage `SelfTrade` send primitive + per-base cost math
  (`CalculateTradeCostToCoord`/`CanTrade`) → `MMCommon.trade.selfTrade`. Class-replacement UI is too fragile
  to keep; Base Tools owns transfer.
- **TA_Transfer_All_resources** → salvage the **serial send-queue with single-retry-per-item** → `trade`
  module (so Base Tools batches transfers robustly). Subset of the Trade Window otherwise.

---

## 6. KEEP-PENDING-REVIEW (5) — need Mike's call

| Script | The decision |
|---|---|
| **TA_TheMovement** | Unique client-side **territory/base-move simulator** (plan moves/ruins/level-ups, undo). High value, but the **densest de-obf in the pack** (breaks most patches). MM-IFY *and* mine its de-obf recipes + base-0x5b hash for `deobf` and the base-edit move primitive — or shelve? |
| **TA_xTrim_Base_Overlay_DR_4_3** | CTRL-hold in-base **upgrade gain/cost heat-map**. Unique UX, but answers the same question as Base Tools' upgrade-priority. MM-IFY as a Base Tools overlay, or retire? |
| **TA_MovableMenuOverlay** | Makes **native** Mail/Forum overlays draggable. Niche; **highest blast radius** (globally overrides core app methods). Want native-overlay dragging at all? If no → retire. |
| **TA_Supplies_Mod** | Shop "disable funds display" convenience + auto-Supplies-tab. No MM overlap. Light MM-IFY or drop? |
| **TA_Multissesion_MOD** | Portal-side "New Session" cookie-clear (multi-account). Runs on the portal, not in-game. Needs jQuery `.live()→.on()` + selector re-validation. Keep? |

---

## 7. MMCommon roadmap — functions to add (with sources)

**Implement the existing stub**
- `cnctaopt.encode(cityId, {ownCityFallback:true}) → url` — from **TA_CnCTAOpt_Link_Button**: the three
  `base_/defense_/offense_unit_map` hotkey dicts (LIVE cnctaopt set — NOT the cncopt set), 20×9 grid walk
  with defense `+8`/offense `+16` offsets, `GetResourceType` terrain encoding, faction letters G/N/F/E
  (offense faction falls back to own city for Forgotten), `ver=3~…~E=~X=~Y=~WID=~WN=~ML=` suffix. Replace
  its `getUnitArrays` duck-typing with the Wrapper's `get_OffenseUnits/get_DefenseUnits`.

**New modules**
- `base.fetchAllianceInfo / fetchPublicPlayerBases / fetchPlayerByName / rankingAlliances` — bulk
  `SendSimpleCommand` path (§1.1). **Build first** — fixes the off/def survey at the root.
- `trade.selfTrade(src,dst,resType,amount)` + serial retry-queue — from Trade Window + Transfer All.
- `export.csv(rows[][]) / download(blob, filename)` — from POI ExporterTools (reusable by Base Scanner,
  Reports, POI export).
- `reports.scanAll(type)` + combined cost/loot model — from Report_Summary + Report_Stats.
- `poi.*` — score/tier/rank/bonus projection + `RankingGetData` fetch — from POIs_Analyser + Real_POI_Bonus.
- `upgrade.canUpgradeBuilding/canUpgradeUnit` + `getMissingTechIndexes…` — canonicalize ONE copy (appears
  in 3 Flunik scripts).
- `layout.accumulatorProfile(city)` — tib/cry/mix/pow 4–8 field profile — from Shockr `getLayout` (optimizer).

**Extend existing modules**
- `base.classifyResourceBuilding(building)` (Tib/Cry via `OwnProdModifiers`); `base.status` += support-
  building Ion→Art→Air detection; `base.getResTime(...)` resource-time-to-afford (from Warchief Upgrade).
- `repair.offenseAtDeath(city)` (Repair_Time_Of_Death); reconcile ROI-on-repair + production-delta-per-cost
  (Auto_Repair) with the calibrated optimizer model — don't add a 2nd copy.
- `loot.ofCity` → prefer `GetLootFromCurrentCity()` (mhLoot).
- `map`: consolidate the world→screen **marker projection** + pan/zoom reposition/resize so Tunnel Info,
  Attack Range, Player Base Info share ONE (currently 3 copies); add region scan→canvas paint helper (TA_Map).
- `coords.sector` — reconcile with ExporterTools' `getSectorNo/getSectorText`.
- `num`/`ui`: ratio→color helper (Info_Sticker); generic qx table-augment helpers `addColumn`/
  `getLastFocusedRow` (Report_Stats).
- `deobf`: POI `$ctor` field parse (ExporterTools); map-label `UpdateColor`/`SetCanvasValue` recipe
  (Colorer) → Wrapper; territory/move recipes + base-0x5b hash (TheMovement) → informs the move primitive.

---

## 8. Phased execution plan

- **Phase 1 — Cleanup (fast, low-risk).** Retire the 2 pure dups (§3). Quarantine the 3 security scripts
  (§2) = remove from the build (this is what removes the only real runtime remote channels). Shrinks surface
  before the real work. (Third-party `@updateURL` lines need no separate strip pass — they're inert in the
  extension and each rebuild replaces the header anyway; see §1 note.)
- **Phase 2 — High-leverage MMCommon.** Build §1's three wins: `base.fetch*` bulk path, `cnctaopt.encode`,
  unify `scan.inRange`. Add `trade` + `export` (small, enabling). Each is additive (nothing calls it yet →
  can't break the loaded pack; just `node --check`).
- **Phase 3 — MM-IFY keepers (§4)** in priority order, one playbook pass each, live-verified by Mike.
- **Phase 4 — Salvage-then-retire (§5):** as each MMCommon module / MM keeper lands, lift the named bit from
  its donors and delete them. Batch the deletes.
- **Phase 5 — Decide the 5 pending (§6)** with Mike.
### Outbound-network audit result (2026-06-21)
Full sweep of all 50 userscripts + the extension's own files for outbound calls (`$.post`/`fetch`/`XHR`/
`sendBeacon`/`GM_xmlhttpRequest`/`@require`/`externally_connectable`):
- **Removed:** leoStats + BaseShare (POSTed your data off-site) — gone. **And the extension's own
  `cncta.tweakness.net` usage-stat collector** (manifest `externally_connectable`+optional perm, background
  `check`/`onMessageExternal`/`CNCTA_stat`, options.js `sendstat`/`check_stat` fetches, options.html privacy
  link) — the real analog to leoStats inside OUR build; was opt-in/off-by-default (inert) but fully excised
  (build 1.0.21).
- **Remaining runtime external touches = the cnctaopt/cncopt link buttons only** — `window.open()` to the
  base-planner site, **user-initiated** (click a menu button), base layout in the URL. cnctaopt.com is the
  live community planner (→ becomes `MMCommon.cnctaopt.encode`); cncopt.com is dead (View_Player_Base → retire).
  Not silent exfiltration.
- **Cosmetic publish-polish (NOT data exfiltration):** options.html + updated.html auto-load a Creative
  Commons license badge image from `i.creativecommons.org` (leaks IP/timing when those pages open) — localize
  the badge or drop it (also a licensing decision — the pages still carry the upstream CC BY-NC-SA badge).
  Plus many inert author/homepage/@icon URLs in legacy-script metadata/comments (vanish as those scripts retire).
- **`GM_xmlhttpRequest` grants** in 3 scripts (CnCTAOpt_Link, Map, View_Player_Base) are declared but **never
  called** — no actual cross-origin requests.
- `CNCTA_enabledscriptstat` is still written to **local** storage (never sent) — harmless dead bookkeeping,
  optional later cleanup.

- **Phase 6 — Publish gate:** security verification — build-wide grep for `fetch(`/`XHR`/`$.post`/remote
  `@require` returns nothing outside our own domain, and confirm no legacy file was bundled verbatim (every
  shipped script is an MM rebuild with our header); branding/version/CHANGELOG hygiene; icons/store listing;
  manifest review.

**End state estimate:** ~10 current MM scripts + ~11 new MM-ified keepers ≈ **~21 MM scripts**, all on the
Wrapper + Common Library, zero third-party update/exfiltration, ready to publish.

---

## 9. Per-script index (quick lookup)

RETIRE: Count_Forgotten_Bases_Range, New_Custom_Flunik_Tools.
QUARANTINE: leoStats, BaseShare, Hotkeys.
MM-IFY: Tunnel_Info, CD_PvP_Alert_Status, Real_POI_Bonus, POIs_Analyser, POI_ExporterTools,
Warchief_Upgrade_Base_Defense_Army, Warchief_Sector_HUD, Zoom, ADDON_City_Online_Status_Colorer_SC,
Repair_Time_Of_Death.
RETIRED (deferred out of initial release; salvage spec captured in §4 entry 6): Report_Stats.
RETIRED (keeper feature rebuilt as MMCommon.menubar + Next MCV menu dock, §4 entry on Info_Sticker): Info_Sticker.
SALVAGE-THEN-RETIRE: Shockr_…_Basescanner, PluginsLib_mhLoot, MHTools_Available_Loot_Summary_Info,
Auto_Repair, Upgrade_Top_ModButtonPos, Autopilot, Flunik_Tools_reloaded, Wavy,
CityMoveInfoExtend, Map, CD_PvP_Quick_Map, The_Green_Cross_Tools, Report_Summary, Formation_Saver,
PvP_PvE_Ranking_…, PvP_PvE_Player_Info_Mod, View_Player_Base, CnCTAOpt_Link_Button,
New_Resource_Trade_Window, Transfer_All_resources.
KEEP-PENDING-REVIEW: TheMovement, xTrim_Base_Overlay_DR_4_3, MovableMenuOverlay, Supplies_Mod,
Multissesion_MOD.
