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
   Found independently in **TA_CD_PvP_Quick_Map**, **TA_PvP_PvE_Ranking…**, **TA_POIs_Analyser**,
   **TA_Real_POI_Bonus**. This is the **off/def batch-fetch** Mike remembered ([[offdef-batch-fetch-idea]])
   — it returns whole alliances'/players' base lists `{i,n,x,y}` in one round-trip, **without** the
   `set_CurrentCityId` survey that just caused the Player Base Info render crash. → New
   `MMCommon.base.fetchAllianceInfo / fetchPublicPlayerBases / fetchPlayerByName / rankingAlliances`.
   **Highest strategic value: directly fixes the survey-speed problem at its root.**
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

## 2. SECURITY-QUARANTINE (3) — exclude from the published build

| Script | Why | Salvage |
|---|---|---|
| **TA_leoStats** | Self-described **encrypted** payload, **`@updateURL` auto-updates from `cnc.indyserver.info`** (remote-code channel), remote `@require` jQuery, and **POSTs full account/base/alliance data** to indyserver.info on load + hourly. | None — never lift from obfuscated auto-updating code. Re-implement any wanted view fresh. |
| **TA_BaseShare** | **POSTs your entire reachable-base dataset + player/alliance identity** to `project-exception.net` on every scan; also cross-script-coupled (`typeof leoStats`/`typeof BaseInfo`). | None (scan already in MMCommon). |
| **TA_Hotkeys** | Ships a **plaintext email/password table for up to 9 accounts** in source + auto-submits login. | Safe parts only: Alt+I per-base level/coords dump → MM - Base Info via `base.ownCities`+`coords.insertIntoChat`; Alt+Y signature/role-name map. **Drop the credential login entirely** (if account-switch is ever wanted, use the browser password manager, never inline source). Fix the latent undefined-`link` bug. |

> NOTE: removing leoStats/BaseShare must be coordinated — BaseShare's button-stacking reads `typeof leoStats`.
> Both already slated; just confirm no MM script references those globals (none do).

---

## 3. RETIRE outright (2) — pure duplicates

| Script | Superseded by |
|---|---|
| **TA_Count_Forgotten_Bases_Range** | Exact subset of Shockr's BaseCounter **and** of `scan.inRange`+`coords.insertIntoChat`. Nothing unique. |
| **TA_New_Custom_Flunik_Tools** | Strict subset of TA_Autopilot's upgrade engine **and** of MM - Base Tools. (`getMissingTechIndexesFromTechLevelRequirement` is the only nugget — capture once in MMCommon from the keeper, see §6.) |

---

## 4. MM-IFY keepers (11) — rebrand + rebuild on MMCommon (playbook pass each)

Priority order (high → low), with the new MM name and the one-line reason:

1. **TA_Tunnel_Info → MM - Tunnel Info** — cleanest script in the pack (NOEVIL, no hardcoded indices, no
   creds); unique tunnel-activation overlay. Route its world→screen projection through `MMCommon.map`.
2. **TA_CD_PvP_Alert_Status → MM - Attack Alert** — incoming-attack title/favicon/siren alarm; no MM
   equivalent. Most robust legacy script. Event-drive via `net.attach` instead of the 5s poll; `enable_sound`→`settings`.
3. **TA_Real_POI_Bonus → MM - Real POI Bonus** — rank-corrected POI gain/loss; also yields the
   `RankingGetData` bulk path. Convert its `getObject` hack → `deobf.objectMemberOfSetter`.
4. **TA_POIs_Analyser → MM - POI Analyser** — POI score/tier/rank tables + acquisition simulator. Move the
   POI math into `MMCommon.poi.*`.
5. **TA_POI_ExporterTools → MM - POI Exporter** — POI→CSV + sector survey; modern/clean code. Lift CSV +
   sector helpers to MMCommon (§6).
6. **TA_Report_Stats → MM - Report Stats** — combat-report CP/RT/loot analyzer; **absorb Report_Summary's
   "scan all reports" mode**. Hardening its many `.toString()` regexes is the main work.
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
- **TA_Info_Sticker** → salvage `interpolateColor`/`formatNumberColor` ratio→color helper → `num`/`ui`;
  6h-vs-continuous production-with-POI math → Base Tools production view. (MCV/repair/production all already
  in Next MCV + Base Tools + `repair`.)
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
- **TA_CnCTAOpt_Link_Button** → **the SOURCE for `MMCommon.cnctaopt.encode`** (§1.2). After the lib exists,
  reissue as a thin MM menu button that calls it, then retire the original.

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
MM-IFY: Tunnel_Info, CD_PvP_Alert_Status, Real_POI_Bonus, POIs_Analyser, POI_ExporterTools, Report_Stats,
Warchief_Upgrade_Base_Defense_Army, Warchief_Sector_HUD, Zoom, ADDON_City_Online_Status_Colorer_SC,
Repair_Time_Of_Death.
SALVAGE-THEN-RETIRE: Shockr_…_Basescanner, PluginsLib_mhLoot, MHTools_Available_Loot_Summary_Info,
Auto_Repair, Upgrade_Top_ModButtonPos, Autopilot, Flunik_Tools_reloaded, Info_Sticker, Wavy,
CityMoveInfoExtend, Map, CD_PvP_Quick_Map, The_Green_Cross_Tools, Report_Summary, Formation_Saver,
PvP_PvE_Ranking_…, PvP_PvE_Player_Info_Mod, View_Player_Base, CnCTAOpt_Link_Button,
New_Resource_Trade_Window, Transfer_All_resources.
KEEP-PENDING-REVIEW: TheMovement, xTrim_Base_Overlay_DR_4_3, MovableMenuOverlay, Supplies_Mod,
Multissesion_MOD.
