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
   Found in **TA_Real_POI_Bonus** (the live keeper that yields it). (Also was in the now-RETIRED
   TA_CD_PvP_Quick_Map + TA_PvP_PvE_Ranking… + TA_POIs_Analyser — path captured here, so retiring them lost nothing.)
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
| ~~**TA_Hotkeys**~~ | Shipped a **plaintext email/password table for up to 9 accounts** + auto-submit login. (Local credential-storage risk, NOT exfiltration.) | ✅ FULLY RETIRED 2026-06-21: (1) credential code stripped 2026-06-21 →2.2.5 (removed `Logins` table, `Login()`, Alt+1-9/Alt+0 handlers + fixed dead-`link` bug); (2) **Alt+Y (signature) + Alt+I (per-base dump) salvaged into MM - Player Bases 1.0.2** (file + bg row gone in both repos). Insert preserves the original "focused field, else chat" behaviour. |

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
3. ~~**TA_Real_POI_Bonus → MM - Real POI Bonus**~~ — **DONE 2026-06-21 (MM - Real POI Bonus 1.0.0, KEPT id
   10023; original retired).** Rank-correction math preserved verbatim; `getObject` hack now routed through
   `deobf.ensureGetObject` (inline regex kept as guarded fallback); [MM] logging, POI-bubble handler hardened,
   `lifecycle.watch` wired (disable hides the readout, no reload); no HUD button / options (passive bubble
   augment). NOTE: it's still the live reference for the `RankingGetData` bulk path (used inline, NOT yet
   lifted into `MMCommon.base.fetch*`/`poi.*` — do that when that module is built).
4. ~~**TA_POIs_Analyser → MM - POI Analyser**~~ — **RETIRED 2026-06-21** (Mike: skipping it; file + bg row
   id 10014 gone). Nothing salvaged into MMCommon as live code (per the don't-ship-unused-code rule): its POI
   score/tier/rank/bonus math was thin passthrough to `ClientLib.Base.PointOfInterestTypes` (a future
   `MMCommon.poi.*` can call that API directly), and the `RankingGetData` bulk path is already documented (§1.1)
   and live in Real POI Bonus. Its acquisition SIMULATOR (project score→tier→rank→bonus vs rival alliances) +
   the AllianceOverlay tab-inject NOEVIL recipe are in git history if ever wanted.
5. ~~**TA_POI_ExporterTools → MM - POI Exporter**~~ — **RETIRED 2026-06-21** (Mike: cut from the initial
   release; file + bg row id 10093 gone). Was: movable qx window with three buttons (Free / Alliance / ALL)
   that dump every POI in `MainData.GetPOIs()` to CSV (`POI_ID, ALLIANCE_ID, ALLIANCE_NAME, POI_Type,
   POI_Level, POI_X, POI_Y, Sector`), plus a live count per button and a compact "sectors occupied" header
   label (`⇒ N-NE-S`). Chose to DOCUMENT the salvageable bits here rather than stub inert code into MMCommon
   (no live consumer yet — same call as Report_Stats / POIs_Analyser). **Salvage spec for a future MM - POI
   Exporter / Base Scanner (post-release):**
   - **POI `$ctor` field-name parser** (the de-obf): the per-POI object stores ALLIANCE_ID, LEVEL, SUBTYPE,
     EXTRA, ALLIANCE_NAME under obfuscated 6-letter member names. Resolve at runtime by `.toString()`-regexing
     `ClientLib.Data.WorldSector.WorldObjectPointOfInterest.prototype.$ctor`:
     `/this\.([A-Z]{6})=-1[\s\S]+?this\.([A-Z]{6})=e&255,this\.([A-Z]{6})=e>>[\s\S]+?,this\.([A-Z]{6})=e>>11[\s\S]+?=4,this\.([A-Z]{6})[\s\S]+?,this\.([A-Z]{6})=o\.[A-Z]{6}/m`
     → `m[1]=ALLIANCE_ID, m[2]=LEVEL, m[3]=SUBTYPE, m[4]=EXTRA, m[6]=ALLIANCE_NAME`. Skip rows where
     `e[SUBTYPE]===0` (invalid). Coords via `ClientLib.Base.MathUtil.DecodeCoordId(e.worldId, t)` → `t.b/t.c`.
     POI_Type mapping: 1=TiberiumMine, 2=CrystalMine, 3=PowerVortex, 4=Infantry, 5=Vehicle, 6=Air, 7=Defense.
     Belongs in `MMCommon.deobf.poiCtorFields()` when the first consumer lands.
   - **World 8-sector formula** (different from existing `MMCommon.coords.sector(x,y,cx,cy)` which is a
     generic relative-to-center label; this one is the in-game world-sector ring):
     `idx = floor((atan2(W/2-x, y-H/2) * SectorCount / 2π) + SectorCount + 0.5) % SectorCount` with
     `W = Server.get_WorldWidth(), H = Server.get_WorldHeight(), SectorCount = Server.get_SectorCount()`.
     Label resolver uses `qxApp.tr("tnf:<dir> abbr")` (`south, southwest, west, northwest, north, northeast,
     east, southeast`) with hard-coded `{0:'S', 1:'SW', 2:'W', 3:'NW', 4:'N', 5:'NE', 6:'E', 7:'SE'}`
     fallback when the translation returns empty / still contains `tnf:`. Display order for "occupied sectors"
     summary is `[4,5,6,7,0,1,2,3]` (N→NE→…→NW). Belongs in `MMCommon.coords.worldSector(x,y)` /
     `worldSectorLabel(i)` when needed.
   - **CSV writer + browser download** (trivial but reusable for Base Scanner / Reports): RFC-4180-style
     `q(v) = '"' + String(v).replace(/"/g,'""') + '"'`; build with `[headers.join(","), ...rows.map(r =>
     cells.map(q).join(","))].join("\n")`; download via `Blob([csv], {type:'text/csv;charset=utf-8;'})` +
     temp `<a download>` + `URL.revokeObjectURL`. Belongs in `MMCommon.csv.{rows, download}` when needed.
   - The whole original is ~378 LOC of clean ES6 in git history if a full rebuild is wanted (incl. the
     qx window with persisted position + sector header + retry-after-1s on empty result).
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
7. ~~**TA_Warchief_Upgrade_Base_Defense_Army → MM - Upgrade Helper**~~ ✅ DONE 2026-06-21 →
   **MM - Upgrade 1.0.0** (kept id 10017, file renamed to `MM_Upgrade.user.js`). Selected-unit + All +
   repair-time sections preserved verbatim; uses official `ClientLib.API.*` (no de-obf). The trigger
   button next to Trade is kept; the panel itself follows the MM - Member Status pin/dock pattern but
   anchored on the LEFT (`{left:0, top:130}`, caps unflipped, gray strip on the right of the body).
   No HUD tray button; lifecycle.watch live-disable wired. NetquiK no-grow-Infinity + MaxLevelCap fixes
   preserved. Original retired (file + bg row gone).
7b. **(decide)** could instead become a **new tab in MM - Base Tools** rather than its own script — Mike's call.
8. **TA_Warchief_Sector_HUD → MM - Sector HUD** — thinnest case; ~20 lines of glue over
   `map.viewCenter/track` + `coords.sector/insertIntoChat/goTo`. Or fold into an existing MM HUD.
9. **TA_Zoom → MM - Zoom** — extend map zoom range; tiny QoL. Route constants through `settings`.
10. **TA_ADDON_City_Online_Status_Colorer_SC → MM - Online Status Colorer** — on-map member-online
    coloring (a delivery mode Member Status doesn't have). Highest fragility (patches a render hot-path);
    move the `UpdateColor`/`SetCanvasValue` de-obf into the **Wrapper**.
11. ~~**TA_Repair_Time_Of_Death**~~ — **RETIRED 2026-06-21** (file + bg row id 10054 gone; was a §4 MM-IFY
    candidate, cut from initial release). Was ~103 LOC by petui: appended an "offense repair time"
    label (icon + value) to the in-game `RegionGhostStatusInfo` widget — the popup that appears when
    you click a ghosted (destroyed) base on the region map. Displayed `<repairTime_at_death> /
    <max>` so you could see how much offense repair the base had banked the moment it died.
    NOEVIL: patches a `getObject` getter onto `RegionGhostStatusInfo.prototype` by regexing
    `setObject` (the same `setObject → getObject` recipe MMCommon already has —
    `MMCommon.deobf.ensureGetObject` would replace the inline regex on a future rebuild).
    **Salvage spec for a future fold into MM - Off/Def Bubbles ghost-base mode (post-release):**
    Given a `ClientLib.Data.City` for a ghost base:
    ```js
    var stepOfDeath = city.GetResourceData(ClientLib.Base.EResourceType.RepairChargeBase).Step;
    var charge     = city.get_RepairOffenseResources().get_RepairChargeOffense();
    var atDeath    = ClientLib.Base.Resource.GetResourceCountStep(charge, stepOfDeath);
    // present as: getTimespanString(time.GetTimeSpan(atDeath)) + " / " + getTimespanString(time.GetTimeSpan(charge.Max))
    ```
    The `Resource.GetResourceCountStep(resData, step)` API freezes the regen-decay calculation at the
    death step — that's the load-bearing trick the script discovered. Belongs in
    `MMCommon.repair.offenseAtDeath(city) → { atDeath, max }` (per §7) when the first consumer needs
    it. Full original is in git history at SCRIPT-PACK `59e4cd1` for a full restore.

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
- ~~**TA_Auto_Repair**~~ — **RETIRED 2026-06-21** (file + bg row id 10066 gone). **Salvaged into
  MM - Base Tools 1.4.0 + MM - Framework Wrapper 1.2.0:** the priority list (default = the script's
  own Defense_Facility → … → Refinery order, with Support_Air auto-expanding to Ion+Art at run time),
  the per-building ROI sort within each tier (`sumRepairCosts / sumProductionPerHourDelta`), and the
  per-building `CanRepair()`/`Repair()` walk that stops at the first cost-blocked building (so a base
  short on cash heals defenses first, not whatever the game's RepairAll picks). The two de-obf
  primitives (`CityEntity.prototype.CanRepair` / `.Repair`) now live in the Framework Wrapper —
  isolated try-block; failure falls back to plain `RepairAll(City)`. UI = `Auto-repair by priority +
  ROI` checkbox (default ON) on the Collect & Repair tab, with an Up/Down-reorderable list +
  Reset-to-default (simpler than the original's drag-drop, same end result). Settings keys
  `BaseTools.RepairPriority` (bool) + `BaseTools.RepairOrder` (string array). Lockdown-aware
  rescheduling was NOT salvaged — the existing 5-min auto cycle already short-circuits via
  `c.get_IsLocked()` and re-evaluates every tick, so a one-shot timer to next `LockdownEndStep` was
  marginal value for the code cost. Original is in git history at SCRIPT-PACK `0de5072` for a full
  restore.
- **TA_Upgrade_Top_ModButtonPos** → salvage Tib-vs-Cry harvester/silo classification via `OwnProdModifiers`
  → `base.classifyResourceBuilding`. "Upgrade highest-of-type" as a selectable Base Tools mode.
- **TA_Autopilot** → diff its health-per-cost unit ranking vs the existing prioritizer; lift only if better.
- **TA_Flunik_Tools_reloaded** → salvage per-resource **POI scoring tables** → MM - Base Scanner / POI Analyser.

**Info overlays**
- ~~**TA_Info_Sticker**~~ → **RETIRED 2026-06-21.** Its keeper feature (the MCV docked into the game's base
  bar with the menu look-and-feel) was rebuilt as the `MMCommon.menubar` module + the MM - Next MCV "Dock in
  game menu bar" option + the MM buttons "menubar" dock mode (build 1.0.49–1.0.51) — Mike confirmed it looks
  good. Its other stickers (resources / 6h-vs-continuous production / repair times) were intentionally dropped
  (Next MCV + Base Tools + Base Scanner already cover them). **2026-06-21 (cont.): file + bg row REMOVED**
  (it had been kept `enabled:false` as a dock-style reference until the menu look was finalised; Mike OK'd
  removing it now). The smooth `interpolateColor`/`formatNumberColor` ratio→colour gradient helper WAS
  salvaged into `MMCommon.color` (`interpolate` / `ratioHex` / `valueHex`) before deletion — a smooth
  green→amber→red gradient, complementing the 3-step `barColor` used by Next MCV / Loot Summary.
- **TA_Wavy** → **RETIRED 2026-06-21** (file + bg row gone). MM - Move Info already provides the same
  forgotten/NPC-bases-in-range + level breakdown + wave estimate while moving a base, so Wavy was redundant.
  (Historic salvage ideas if ever wanted: move-base-tool per-cell cache overlay; auto-mark forgotten-defense
  reports read; wave-count model → MMCommon. De-obf already in Wrapper.)
- **TA_CityMoveInfoExtend** → salvage only the **cooldown-expiry wall-clock** annotation → MM - Attack
  Range / move-info. Its range scan is the inferior dup of Wavy/scan.inRange.

**Maps**
- ~~**TA_Map**~~ → **RETIRED 2026-06-21** (id 10040, cut from initial release; Mike: not pursuing the rebuild).
  Was a 1765-line standalone qx singleton `TAMap` (chain: Nolana Kane 1.8 → DR01 1.6.9 → KSX → 777lexa777
  → Profuter → Eistee 13.08.25) that opened a scrollable whole-region mini-map canvas via its own
  "POI Map" → "Show POI Map" entry under the game's native Scripts button — would have **clashed with
  the CnC Pack menu** in MMCommon (both call into `bntScript.Add` / `setMenu` on the same button), so
  retiring it also removes a latent conflict if someone toggled it on. **Salvage spec (if "MM - Region
  Minimap" is ever built):**
  - **Paint loop** = walk `world.<obfSectors>.d` × 32×32 tiles via `s.ConvertToWorldX/Y(x,y)`, classify
    each cell with `world.GetObjectFromPosition(cx,cy).Type`: 1=player, 2=forgotten, 3=camp/outpost
    (`rgObj.get_CampType()===3` → outpost), 4=POI/Tunnel (`wObj[obfPOIType]===0` → tunnel). Empty tile
    → `world.GetTerritoryTypeByCoordinates(cx,cy)` → 0=Own / 1=Alliance / 2=Neutral / 3=Enemy
    background shade. Region overlay info via `vm.get_Region().GetObjectFromPosition(cx*gw, cy*gh)`.
  - **Enemy bases**: `alliance.GetAllianceRelationshipsByType(ERelationTypeEnemy, true).l` →
    `{OtherAllianceId}` set; on the region pass for each tile check `rgObj.get_VisObjectType()===4 &&
    rgObj.get_Type()===2` (a player city) and `enemiesById[rgObj.get_AllianceId()]`; draw red dot +
    `arc(cx*zf, cy*zf, zf*20, 0, 2π)` faint red attack-range circle.
  - **Own bases**: `md.get_Cities().get_AllCities().d` → each city's `get_PosX/Y`, draw 20-tile + 40-tile
    range rings.
  - **POI highlighting**: dynamic obf member resolve via `getNameByIdx` / `getMemberNameByType` on the
    first POI wObj (POIType=idx4, OwnerAllianceId=idx2, Level=idx3, AllianceName=first string field) —
    today's Wrapper already publishes `get_POIType`/`get_Level` so an MM rebuild can skip the regex
    entirely. POI min/max-level filter (`settingsPanel.minPoiLevel/maxPoiLevel`) + POI-type select
    (`WorldObjectPointOfInterest.EPOIType`) + "alliance POIs only" toggle gated on a selected alliance.
  - **Viewport frame**: `vm.get_Region().get_PosX/Y / get_GridWidth/Height` → top-left tile;
    `get_ViewWidth/Height / get_ZoomFactor / get_GridWidth/Height` → tile dims. Kept live via
    `phe.cnc.Util.attachNetEvent(Region, "PositionChange", ClientLib.Vis.PositionChange, ...)`.
  - **Click to teleport**: `mapCanvas.mousedown` → `VisMain.GetInstance().CenterGridPosition(mouseX/zf,
    mouseY/zf)` then re-scroll the mini-map to re-center the new viewport.
  - **Alliance enumeration** (for the alliance-pick dropdown): scan every sector's alliance list
    (auto-detected via the "12-prop object with exactly 1 string field" heuristic at line 1393) and
    sort by name — explicitly tagged "expensive operation" in the original. If rebuilt, prefer
    `RankingGetData` (per [[offdef-batch-fetch-idea]]) over the sector scan.
  - **Border-line overlay**: two configurable `(x1:y1)→(x2:y2)` lines with their own color, drawn
    after the main paint — handy for marking alliance borders. Coord-pick button reuses
    `VisMain.get_SelectedObject().get_RawX/Y()` (or current city fallback).
  - **Bug to NOT carry over**: `init_settingsWnd`'s `var alliance = md.get_Alliance()` is shadowed by
    `var alliance = s.GetAlliance(player.Alliance)` inside the player-tile branch — masked today only
    because relations are computed before the loop. `populateAllianceSelect` also references
    undefined `selectedItem`/`tempItem`. `findAllianceById` hard-codes stale obf `a.FGTNFZ`.
  - **MMCommon roadmap (already noted in §7)**: when the rebuild happens, the region-scan→canvas
    paint helper lands in `MMCommon.map.*` alongside the world→screen marker projection
    (consolidating the 3 copies in Tunnel Info / Attack Range / Player Base Info).
  Original lives in git history if a full restore is ever wanted.
- ~~**TA_CD_PvP_Quick_Map**~~ → **RETIRED 2026-06-21** (Mike: not pursuing it; file + bg row gone). Nothing
  salvaged into MMCommon now, but nothing lost: the bulk-fetch path it used is documented in §1.1 and still
  lives in keeper script Real POI Bonus when `base.fetch*` is built. Its radar/canvas view + alliance-picker
  were not wanted.

**POI / reports / combat**
- ~~**TA_The_Green_Cross_Tools**~~ — **RETIRED 2026-06-21** (file + bg row id 10038 gone). Was a
  "Manager" button injected into the game's options bar opening a popup with one live entry —
  `TGCTools.POIWindow`, a near-clone of the already-retired POIs_Analyser (same Total Score / Total
  Quantity / Total Bonus headers, Tier table prev/curr/next with lower/upper/bonus/diff, Rank table
  prev/curr/next with alliance/score/multiplier/diff, and a "gain N points → projected tier/rank/bonus"
  Simulation column). ~2000 of its ~2680 lines were already commented-out: `TGCTools.BaseScanner`
  (20-tile region scanner with City Type / Distance / CP Cost / Layout filters + qx table; covered by
  MM - Base Scanner) and `TGCTools.UpgradeWindow` (UpgradeAllBuildingsToLevel + "+1" 9×8 grid walk +
  "Maximize" picking gain/cost-best production building; covered by MM - Upgrade + MM - Base Tools
  Top-N priority). **Salvage spec for a future MMCommon module:**
  - **Per-building gain-per-hour-on-upgrade model** (commented `baseUpgradeMaximizeLevel`): for each
    production candidate, sum `OwnProdModifiers.d[type].NewLvlDelta` across `{Tib/Cry/Pow/Credits}{Package
    Size, Production}`; PackageSize entries normalize by `MainData.get_Time().get_StepsPerHour()` and by
    the building's main-modifier `(TotalValue + NewLvlDelta)` (i.e. delta per package × packages per
    hour); flat Production entries add straight. Production tech-name filter: `{1,2,10,11,15,16}`. Use as
    a CROSS-CHECK against the calibrated Layout Optimizer's per-resource delta and `MMCommon.loot.ofCity` —
    confirms the right way to read package-vs-flat production modifiers when first consumer needs it.
  - POI tier/rank/bonus simulator math itself is NOT re-documented here — already captured in §4 entry 4
    (POIs_Analyser retirement) since this was a duplicate.
  Full original is in git history at SCRIPT-PACK `908bf48` if either piece is ever rebuilt.
- ~~**TA_Report_Summary**~~ (Nogrod/DLwarez, 22.05.04, ~283 LOC) — **RETIRED 2026-06-21** (file + bg
  row id 10051 gone). Was a movable qx window (top:230, left:LeftBar.width+5) docked to the desktop:
  pick a `EPlayerReportType` (Forgotten Attacks / Offense / Defense), click Scan, the script bulk-
  fetches every report of that type and renders per-base × per-day Loot vs Repair-Cost summaries
  (each cell shows totals for the 8 resource types, with the timespan-typed ones — repair time —
  rendered via `getTimespanString` instead of `formatNumbersCompact`). Cut from initial release —
  same call as Report_Stats (§4 entry 6, deferred); the reports cluster as a whole is post-release.
  **Salvage spec for a future MMCommon.reports.* module + MM - Report Stats (post-release; closes
  the reports cluster with §4 entry 6 Report_Stats spec):**
  - **Bulk report-scan pipeline** (`reports.scanAll(playerReportType) → Promise<list of CombatReport>`):
    1. `reports = MainData.GetInstance().get_Reports()`. Bind once:
       `reports.add_ReportDelivered(phe.cnc.Util.createEventDelegate(ClientLib.Data.Reports.ReportDelivered, ctx, onReport))`
       where `onReport(report)` receives a fully-loaded `ClientLib.Data.Reports.CombatReport` (called
       once per report whose `RequestReportData` resolves).
    2. `CommunicationManager.GetInstance().SendSimpleCommand("GetReportCount", { playerReportType }, createEventDelegate(CommandResult, ctx, onCount), null)`
       → server returns `count`.
    3. `reports.RequestReportHeaderDataAll(playerReportType, 0, count, ClientLib.Data.Reports.ESortColumn.Time, true)`
       → game fires its own header-loaded callback (the original wires `add_ReportHeaderDataLoaded` →
       array of headers); iterate `headers[i].get_Id()` and call `reports.RequestReportData(id)` per
       header. Each completion fires `ReportDelivered`.
    4. Caller counts deliveries vs `count` to know when the scan is complete.
  - **Per-report cost/loot extraction** (per `EReportType` branch):
    - Loot row = per `EResourceType` skipping `[0]` (None): use `report.GetDefenderTotalResourceCosts(ert)`
      when `EReportType.NPCPlayerCombat` (forgotten ATTACKING you), else `report.GetAttackerTotalResourceReceived(ert)`.
    - Repair row = `EReportType.NPCPlayerCombat` → `report.GetDefenderRepairCosts(ert)` per ert; else
      flatten `report.GetAttacker{Infantry,Vehicle,Air}RepairCosts().d` into `[{Type, Count}, ...]`
      and merge.
    - Group key = `NPCPlayerCombat ? report.get_DefenderBaseId() : report.get_AttackerBaseName()`
      (asymmetric — the donor uses ID for the defender case and name for the attacker case; on the
      MM rebuild, normalize to ID via `get_AttackerBaseId()` if available).
  - **Per-base × per-date matrix with "All" totals on both axes:** for each delivered report, call
    `accum(base, date)` plus three corner-sum variants (`(base, "All")`, `("All", date)`,
    `("All", "All")`) so the totals row/column drop out for free. Cells carry
    `{ count, totalLoot: [{Type,Count}], totalRepair: [{Type,Count}] }`. Merging uses
    `ClientLib.API.Util.MergeResourceCosts(prev, newArray)` (the public combinator the donor relies on).
  - **Resource-type-aware label formatting:** `ClientLib.Base.Resource.IsResourceTypeTimeValue(type)`
    → `phe.cnc.Util.getTimespanString(MainData.get_Time().GetTimeSpan(count, true))`; else
    `phe.cnc.gui.util.Numbers.formatNumbersCompact(count)`. Belongs in `MMCommon.num.byResourceType`
    (or stays in the consumer — trivial).
  - **Date bucket:** `phe.cnc.Util.getDateTimeString(new Date(report.get_Time()))` — the donor uses
    raw datetime; on the MM rebuild prefer YYYY-MM-DD so cells aggregate per-day instead of per-tick.
  - The UI itself (resource-icon grid + base/date dropdowns) is small and rebuildable on the
    MMCommon dockable-window pattern; reuse the cost/loot table renderer Report_Stats §4 spec
    described. Full original is in git history at SCRIPT-PACK `fc5866d` for a full restore.
- ~~**TA_Formation_Saver**~~ — **RETIRED 2026-06-21** (file + bg row id 10009 gone). Was a small qx
  panel injected into the in-base move-battle PlayArea: collapse/expand header + a "Save" button +
  a list of named-saved formations per (attacker base, target base) pair, each with Load and Delete.
  Cut from initial release — no consumer in the pack yet; same don't-ship-inert-code call as
  Report_Stats / POIs_Analyser / POI_ExporterTools / The_Green_Cross_Tools.
  **Salvage spec for a future MM - Battle Simulator formation save feature (post-release):**
  - **Storage schema** (plain JSON in `localStorage.formations`):
    ```js
    formations[targetCityId][ownCityId] = [count, { n: "Save 1", l: [{x,y,e}, ...] }, ...]
    ```
    where index `0` of the per-pair array is the running save-count (used to mint `"Save N"` names);
    subsequent entries are saved formations. Each `l[i]` carries `x` (grid X), `y` (grid Y), and `e`
    (enabled flag) for the army unit at slot `i`. When migrating, store via
    `MMCommon.settings.set("BattleSim.Formations", ...)` (per player+world) instead of raw localStorage.
  - **Save path:** `ownCity = MainData.get_Cities().get_CurrentOwnCity()`;
    `targetId = MainData.get_Cities().get_CurrentCity().get_Id()`;
    `formation = ownCity.get_CityArmyFormationsManager().GetFormationByTargetBaseId(targetId)`;
    walk `formation.get_ArmyUnits().l[]` and capture `unit.get_CoordX() / get_CoordY() / get_Enabled()`.
    Guard: `armyUnits == null` → user hasn't entered the move-battle setup yet, abort.
  - **Load path:** same resolution as save, then for each saved unit slot:
    `armyUnits[i].MoveBattleUnit(unitData.x, unitData.y);`
    `armyUnits[i].set_Enabled(unitData.e)` (with `set_Enabled_Original` fallback for older clients).
    **Fragility note:** uses unit-index, not unit-id — so a saved formation breaks if the army roster
    changes (different units, reordered slots). A robust rebuild should key by unit `get_UnitId()` or
    `get_MdbUnitId()` instead, and skip slots that don't match.
  - **Delete-slot bookkeeping:** when the per-pair array shrinks to `length <= 1` (just the counter)
    delete the pair; when the per-target object has no pairs left, delete the target.
  - UI was per-target inline; a future build could surface it as a Battle Sim tab. Full original is
    in git history at SCRIPT-PACK `493c3c9` for a full restore.

**Player info / links**
- ~~**TA_PvP_PvE_Ranking…**~~ → **RETIRED 2026-06-21** (Mike: retire it; file + bg row id 10002 gone). Both
  info surfaces are covered by Base Info + Member Status. Salvage recipes NOT mined now but documented here for
  if `base.fetch*`/`base.status` get built: (1) per-member `GetPublicPlayerInfoByName` fan-out (pairs with
  §1.1); (2) support-building Ion→Art→Air detection; (3) the 2-tile (corner-excluded) POI-on-base predicate.
- ~~**TA_PvP_PvE_Player_Info_Mod**~~ (subset) → **RETIRED 2026-06-21** (Mike: dump it; file + bg row id 10083
  gone). Strict subset of the already-retired TA_PvP_PvE_Ranking…; the only salvage (2-tile POI-on-base
  predicate) was already captured from that one's retirement.
- **TA_View_Player_Base** → target site **cncopt.com is dead**; encoder superseded by the cnctaopt one (do
  NOT mix keymaps). Salvage only the alliance-`get_POI*Bonus()` getters → base/layout bonus model.
- ~~**TA_CnCTAOpt_Link_Button**~~ → ✅ DONE + VERIFIED 2026-06-21: encoder lifted into `MMCommon.cnctaopt`
  (1.0.8), reissued as **MM - CnCTAOpt Link** (id 10204), original RETIRED. (View_Player_Base also retired.)

**Economy**
- **TA_New_Resource_Trade_Window** → salvage `SelfTrade` send primitive + per-base cost math
  (`CalculateTradeCostToCoord`/`CanTrade`) → `MMCommon.trade.selfTrade`. Class-replacement UI is too fragile
  to keep; Base Tools owns transfer.
- ~~**TA_Transfer_All_resources**~~ (KRS_L, 1.6.2, ~161 LOC) — **RETIRED 2026-06-21** (file + bg row id
  10079 gone). Was a single "Transfer All" button injected into the game's TradeOverlay window: select
  a target base + a resource (Tib/Cry toggle), tick the confirm checkbox to compute total credit fee,
  click Transfer All to fan-in EVERY other base's full resource pool into the target via a serial
  SelfTrade queue with single-retry-per-item. Cut from initial release — Mike: no feature lift wanted
  right now (same don't-ship-inert-code call as Report_Stats / Formation_Saver / etc).
  **Salvage spec for a future MMCommon.trade.* module (long overdue per §7) — TWO live consumers
  already duplicate this pattern inline (MM - Base Tools `planTransfer`+`autoTransferAndUpgrade`,
  MM - Upgrade `planResourceTransfer`+`runTransferPlan`), and a THIRD will be added when
  TA_New_Resource_Trade_Window retires. Lift opportunity:**
  - `MMCommon.trade.canTrade(city)` → `(city.CanTrade && city.CanTrade() === ClientLib.Data.ETradeError.None)`.
    Used in all 3 consumers; centralizes the ETradeError enum dependency.
  - `MMCommon.trade.cost(srcCity, dstCity, amount)` → `srcCity.CalculateTradeCostToCoord(dstCity.get_PosX(), dstCity.get_PosY(), amount)`
    with try/catch returning Infinity on failure (matches what BaseTools/Upgrade already do).
  - `MMCommon.trade.selfTrade(targetCity, sourceCity, ert, amount, doneCb)` → wraps
    `ClientLib.Net.CommunicationManager.GetInstance().SendCommand("SelfTrade", {targetCityId, sourceCityId, resourceType, amount}, phe.cnc.Util.createEventDelegate(ClientLib.Net.CommandResult, ctx, doneCb), null, true)`.
    Note: in BOTH live consumers Mike learned that **SelfTrade's result code is NOT a reliable success
    signal** — they pace transfers and confirm by EFFECT (poll target's `GetResourceCount`). The
    Transfer_All version's `if (result != 0 && retry == false) → retry once` pattern is a different
    take (network-level retry); the effect-poll is better for the upgrade flow. The MMCommon helper
    should expose the raw send and let callers pick their confirmation strategy.
  - `MMCommon.trade.queue(items, opts)` (or `transferPlan(target, ert, amount)` →
    `runPlan(plan, onAllDone)`) → the cheapest-per-unit-credit source-ordering + serial-send +
    effect-poll pattern that BaseTools and Upgrade have copy-pasted. **High-value dedup target** when
    a touch-existing-consumers refactor is wanted (currently risky — Mike has live-verified both).
  - The Transfer_All UI itself (button + checkbox + cost label in the game's TradeOverlay) was not
    salvaged — Base Tools owns transfer flows; if a "fan-in everything" mode is ever wanted, add it as
    an Upgrade Priority option, not a separate trade-window button.
  - Full original is in git history at SCRIPT-PACK `f6496ac` for a full restore.

---

## 6. KEEP-PENDING-REVIEW (5) — need Mike's call

| Script | The decision |
|---|---|
| ~~**TA_TheMovement**~~ | **MM-IFIED 2026-06-21 → MM - The Movement 1.0.0 (id 10209); original retired.** Engine preserved verbatim; the ~15 NOEVIL de-obf lookups now routed through guarded `reMember()/reMatch()` (named errors naming exactly which lookup a game update broke), menu/click handlers wrapped, `MMCommon.lifecycle` wired (disable scrubs simulated changes + restores patched methods, no reload). Its de-obf recipes + base-0x5b hash are still un-mined into `MMCommon.deobf` — future refactor (see §4). |
| ~~**TA_xTrim_Base_Overlay_DR_4_3**~~ | **RETIRED 2026-06-21 — UX salvaged INTO MM - Base Tools 1.4.0 → 1.4.1.** File + bg row id 10047 gone. UX (hold Ctrl in your own base → translucent colored boxes on each resource-producing tile showing the next-level gain/cost ratio, green→red ramp, ratio printed) ported into Base Tools as a Ctrl-hold listener gated on the `BaseTools.UpgradeOverlay` setting (default ON; toggle via the "On-grid overlay (Ctrl-hold)" checkbox on the Upgrade Priority tab). Per-tile math is the same model: 4 (resource, building-set) groups (Tib/Cry → Harvester+Silo; Power → PowerPlant+Accumulator; Credits → Refinery+PowerPlant), PackageSize branch normalizes by `MainModifierType.TotalValue / StepsPerHour` so package-rate-vs-delay nets correctly, Production branch is straight `NewLvlDelta`. Gain across groups is summed per tile before computing ratio (so a PowerPlant correctly shows combined Power+Credits value). Tile-keyed `posY*100 + posX` (the original used `*10`, but base grids can run wider than 10 — the `*100` keying is safer with no downside). Cost = sum of next-level resource-requirement `Count` for non-zero, non-Type-0 entries. Restricted to own-base view (additionally checks `currentCity.get_Id() === ownCity.get_Id()` so it doesn't fire when looking at someone else's base). Full original is in git history at SCRIPT-PACK `f796faa` for a full restore. |
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
- `trade.selfTrade(src,dst,resType,amount)` + `canTrade(city)` + `cost(src,dst,amount)` + plan/queue
  helpers. **High-value dedup target — TWO live consumers (MM - Base Tools, MM - Upgrade) currently
  carry near-identical inline copies of `planResourceTransfer` / `runTransferPlan` (cheapest-per-unit
  source ordering + serial SelfTrade + effect-poll for arrival) and a THIRD copy is in
  TA_New_Resource_Trade_Window pending retirement.** Full spec captured in §5 Transfer_All_resources
  RETIRED entry. Refactor the two consumers when a touch-working-code pass is wanted.
- `export.csv(rows[][]) / download(blob, filename)` — RETIRED salvage spec in §5 (POI_ExporterTools);
  reusable by Base Scanner, Reports, POI export when first consumer lands.
- `reports.scanAll(type)` + combined cost/loot model — from Report_Summary + Report_Stats.
- `poi.*` — score/tier/rank/bonus projection + `RankingGetData` fetch — from Real_POI_Bonus (and the
  RETIRED POIs_Analyser's simulator logic in git history, if a projection UI is ever wanted).
- `upgrade.canUpgradeBuilding/canUpgradeUnit` + `getMissingTechIndexes…` — canonicalize ONE copy (appears
  in 3 Flunik scripts).
- `layout.accumulatorProfile(city)` — tib/cry/mix/pow 4–8 field profile — from Shockr `getLayout` (optimizer).

**Extend existing modules**
- `base.classifyResourceBuilding(building)` (Tib/Cry via `OwnProdModifiers`); `base.status` += support-
  building Ion→Art→Air detection; `base.getResTime(...)` resource-time-to-afford (from Warchief Upgrade).
- `repair.offenseAtDeath(city)` — RETIRED salvage spec in §4 entry 11 (Repair_Time_Of_Death);
  trivial 3-line helper, lift when first consumer (likely Off/Def Bubbles ghost-base mode) lands.
  Auto_Repair's ROI-on-repair-cost math already lives in MM - Base Tools (`buildingRepairROI`); if a
  2nd consumer ever needs it, lift to `MMCommon.repair.buildingROI` rather than duplicating.
- `loot.ofCity` → prefer `GetLootFromCurrentCity()` (mhLoot).
- `map`: consolidate the world→screen **marker projection** + pan/zoom reposition/resize so Tunnel Info,
  Attack Range, Player Base Info share ONE (currently 3 copies); add region scan→canvas paint helper (TA_Map).
- `coords.worldSector(x,y)` / `worldSectorLabel(i)` — in-game 8-ring sector (distinct from existing
  generic `coords.sector(x,y,cx,cy)` relative-to-center label). RETIRED salvage spec in §5
  (POI_ExporterTools).
- `num`/`ui`: ~~ratio→color helper (Info_Sticker)~~ **DONE → `MMCommon.color`**; generic qx table-augment helpers `addColumn`/
  `getLastFocusedRow` (Report_Stats).
- `deobf`: POI `$ctor` field parse — RETIRED salvage spec in §5 (POI_ExporterTools); map-label
  `UpdateColor`/`SetCanvasValue` recipe
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
QUARANTINE: leoStats, BaseShare. (Hotkeys salvaged + retired 2026-06-21.)
MM-IFY: Tunnel_Info ✅, CD_PvP_Alert_Status ✅, Real_POI_Bonus ✅,
Warchief_Upgrade_Base_Defense_Army ✅,
Warchief_Sector_HUD, Zoom, ADDON_City_Online_Status_Colorer_SC.
RETIRED (deferred out of initial release; salvage spec captured in §4 entry 6): Report_Stats.
RETIRED (cut from initial release; salvage spec captured in §4 entry 5): POI_ExporterTools.
RETIRED (POI window was a POIs_Analyser dup; scanner/upgrade already commented; salvage spec in §5 The_Green_Cross_Tools entry): The_Green_Cross_Tools.
RETIRED (priority + ROI + per-building CanRepair/Repair lifted INTO MM - Base Tools 1.4.0 + Framework Wrapper 1.2.0; §5 Auto_Repair entry): Auto_Repair.
RETIRED (cut from initial release; salvage spec — schema + Save/Load API — in §5 Formation_Saver entry): Formation_Saver.
RETIRED (cut from initial release; salvage spec — canTrade / cost / selfTrade / plan-and-queue, plus dedup target for 2 live consumers — in §5 Transfer_All_resources entry): Transfer_All_resources.
RETIRED (cut from initial release; salvage spec — bulk reports scanAll pipeline + per-report cost/loot extraction + per-base × per-date matrix — in §5 Report_Summary entry; closes the reports cluster with §4 entry 6 Report_Stats): Report_Summary.
RETIRED (cut from initial release; was §4 MM-IFY candidate; salvage spec — repair.offenseAtDeath(city) 3-line helper — in §4 entry 11 Repair_Time_Of_Death): Repair_Time_Of_Death.
RETIRED (UX salvaged INTO MM - Base Tools 1.4.1 as Ctrl-hold On-grid Upgrade Overlay, toggleable from Upgrade Priority tab; §6 xTrim_Base_Overlay_DR_4_3 entry): xTrim_Base_Overlay_DR_4_3.
RETIRED (keeper feature rebuilt as MMCommon.menubar + Next MCV menu dock, §4 entry on Info_Sticker): Info_Sticker.
SALVAGE-THEN-RETIRE: Shockr_…_Basescanner, PluginsLib_mhLoot, MHTools_Available_Loot_Summary_Info,
Upgrade_Top_ModButtonPos, Autopilot, Flunik_Tools_reloaded, Wavy,
CityMoveInfoExtend, Map,
View_Player_Base, CnCTAOpt_Link_Button,
New_Resource_Trade_Window.
KEEP-PENDING-REVIEW: MovableMenuOverlay, Supplies_Mod,
Multissesion_MOD. (TheMovement → MM-IFIED 2026-06-21, MM - The Movement id 10209.)
