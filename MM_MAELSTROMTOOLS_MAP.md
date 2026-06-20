# MaelstromTools Dev (Mod v1.7 MCV) v0.1.5.5 — Function Inventory

Map produced 2026-06-20 to drive the carve-up into `MM - Base Tools`. Source file is 3402 lines.

## A. Top-level structure

- One IIFE (57–3403) → `MaelstromTools_main()` → `createMaelstromTools()` defines all qx classes → `MaelstromTools_checkIfLoaded()` polls qx availability, then `MaelstromTools.Base.getInstance().initialize()` at line 3385.
- 13 main classes in `MaelstromTools.*`: Language, Base, Preferences, DefaultObject (abstract), Production, RepairTime, ResourceOverview, BaseStatus, Statics, Util, Wrapper, LocalStorage, Cache.
- `HuffyTools.UpgradePriority*` lives alongside (singleton) for the Upgrade Priority feature, plus `HuffyTools.ImageRender` / `ReplaceRender` / `CityCheckBox` table renderers.
- External deps: `ClientLib.*`, `qx.*`, `webfrontend.*`, `PerforceChangelist` (used for game-patch compat branches).

## B. localStorage keys (prefix `CCTA_MaelstromTools_`)

| Key | Default | Purpose |
|---|---|---|
| useDedicatedMainMenu | 1 | Separate Main Menu window vs inline |
| autoCollectPackages | 1 | Auto-collect timer enabled |
| autoRepairUnits | 0 | Auto-repair units on timer |
| autoRepairBuildings | 1 | Auto-repair buildings on timer |
| autoHideMissionTracker | 0 | TRASH (hide mission tracker) |
| AutoCollectTimer | 5 | Interval in minutes |
| showLoot | 1 | TRASH (loot display) |
| showCostsForNextMCV | 0 | TRASH (MCV timer popup) |
| ChatHistoryLength | 512 | TRASH (chat) |
| ChatClose | 0 | TRASH (close chat at login) |
| mcvPopup, mcvPopupExtended | — | TRASH |
| UGL_TOPBUILDINGS_* | true | Upgrade Priority: only top buildings per resource |
| UGL_AFFORDABLE_* | true | Upgrade Priority: only affordable |
| UGL_CITYFILTER_*_* | true | Upgrade Priority: per-city filter |

All settings need to move to `MMCommon.settings` (per-player+world store) on port.

## C. UI inventory (current MaelstromTools windows)

| Window | Class hint | What it shows |
|---|---|---|
| Main Menu popup | qx.ui.popup.Popup (Canvas) | Hosts the buttons (Overall Prod, Army Overview, Base Resources, Base Status, Upgrade Priority, Options) |
| Production | OverlayWindow | Per-city + total production grid (Tib/Cryst/Pow/$ in continuous/bonus/POI/total columns) |
| RepairTime (Army Overview) | OverlayWindow | Two-section grid: Base/Defense/Army overview + Repaircharges |
| ResourceOverview (Base Resources) | OverlayWindow | Per-city Tib/Cryst/Pow current/max/full-time + totals |
| BaseStatusOverview | OverlayWindow | Cooldown, protection, support weapon name/level/target, Recall button per city |
| Preferences | OverlayWindow | 8 checkboxes + 2 spinners (some for TRASH features) |
| UpgradePriority | OverlayWindow w/ TabView | 4 tabs (Tib/Cryst/Pow/$), 13-col qx.ui.table.Table, options panel + UpgradeAll button per tab |
| MCV Popup | qx.ui.window.Window | TRASH (next-MCV timer) |
| Inline desktop buttons | qx Button | Collect All Packages, Repair All Units, Repair All Buildings (toggle-visible based on availability) |

## D. Function inventory (KEEP / SALVAGE / TRASH)

### KEEP — Collect Packages
- `checkForPackages()` 666–681 — toggle the button visibility based on any city having a collectable
- `collectAllPackages()` 683–695 — iterate cities, `ncity.CollectAllResources()`

### KEEP — Repair (units + buildings)
- `checkRepairAll()` 697–712 — generic; selects mode via `ClientLib.Vis.Mode.ArmySetup` or `.City`
- `checkRepairAllUnits()` / `checkRepairAllBuildings()` 714–718 — thin wrappers
- `repairAll()` 720–732 — `ncity.get_CityRepairData().RepairAll(visMode)`
- `repairAllUnits()` / `repairAllBuildings()` 737–749 — thin wrappers

### KEEP — Overall Production
- `Production.updateCache()` 1334–1368 — per-city per-resource (Delta, ExtraBonusDelta, POI)
- `Production.createProductionLabels2()` 1370–1420 — render one resource column
- `Production.setWidgetLabels()` 1422–1449 — grid build

### KEEP — Upgrade Priority (whole `HuffyTools.UpgradePriority*` + GUI)
- `UpgradePriorityGUI.init/createOptions/createTable/createTabPage/TabChanged/upgradeAll/upgradeAllCompleted/upgradeBuilding/UpgradeCompleted/CBChanged/formatTiberiumAndPower/updateCache/setWidgetLabels` 2635–3029
- `UpgradePriority.comparePrio/getPrioList/TechTypeName/collectData` 3039–3307
- Algorithm core: `getPrioList()` builds the prioritized list of upgradeable buildings per resource type, filters by affordability + cross-base transferability, sorts by Ticks (time-to-upgrade).

### SALVAGE → MMCommon (drop UI, lift data fns)
- **Army Overview** → `MMCommon.army`: `RepairTime.updateCache()` 1458–1540 (per-city repair times, charges, unit health%, attack counts) + the unit-group enums it relies on.
- **Base Resources** → `MMCommon.base.resources`: `ResourceOverview.updateCache()` 1654–1674 (current/max/full-time for Tib/Cryst/Pow per city).
- **Base Status** → `MMCommon.base.status`: `BaseStatus.updateCache()` 1817–1900 (cooldown, protection, alert, support-weapon details) + the 32-bit coord unpack `(coordId & 0xffff, (coordId>>16) & 0xffff)`.
- Core utility: `MaelstromTools.Wrapper` + `MaelstromTools.Util` (FormatNumbersCompact, FormatTimespan, GetStepTime, GetDateTimeString, getAccessBaseButton, getFocusBaseButton, recallSupport/recallAllSupport).

### TRASH
- Loot display: `updateLoot()`, `createResourceLabels()`, all 3 `RegionNPC*StatusInfo.onCitiesChange` injections at 3349–3375.
- MCV timer popup: `calculateCostsForNextMCV()`, `toggleview()`, the `mcvPopup` window.
- Chat: `ChatClose()`, ChatHistoryLength spinner.
- Mission tracker auto-hide.
- `runSecondlyTimer()` (only feeds MCV).
- `RegionCityMenu.showMenu` injection at 3316–3348 (support-weapon calibrate button) — unless we want it as part of BaseStatus salvage; tabled.
- All commented-out / dead code blocks (multiple `collectBuildings()`, `GetPointsByLevelWithThresholds()`, etc.).

## E. Cross-feature dependencies — IMPORTANT for refactor order

- **Upgrade Priority depends on Production + ResourceOverview caches.** `getPrioList()` calls `ResourceOverview.updateCache()` + `Production.updateCache(cityName)` first. Carve order: port Production first, port the ResourceOverview-as-MMCommon data layer next, *then* Upgrade Priority.
- **All three KEEP buckets depend on `MT_Cache.updateCityCache()`** (the city iterator). The new Base Tools needs a single coordinated cache layer (ideally in MMCommon, since the salvage modules need it too).
- **Repair has a `CCTAWrapperIsInstalled()` guard** (line 613) — we'll route through wrapper detection in MMCommon.

## F. Net-event handlers

Only one: `Cities.CurrentOwnChange` (line 322–324) — used to clear loot-feature selection state. Goes away with TRASH.

All other event handling is qx button click/execute (no PHE net events).

## G. Quirks / patch-fragile patterns

- **`PerforceChangelist` version checks scattered:** 376877 (building/unit object shape), 382917 (CommunicationManager API), 387751 (formatNumbersCompact location), 392583 (defense units API), 436669 (cellClick → cellTap). All ancient. Decision needed: rip them out (assume modern game) or keep as compat?
- **Hard-coded 1000ms delay** in `UpgradeCompleted()` (line 2916) — workaround for async resource deduction after upgrade. Comment says "dodgy solution"; better would be to listen for resource-change events.
- **100ms delay** between batch upgrades in `upgradeAllCompleted()` — likely flood-prevention; no comment.
- **`getPrioList()` line 3108–3116:** "Gain per Hour fix for buildings that have packages <12 level" (NetquiK). Complex modifier math; fragile to API.
- **`get_PlayerUpgradeCap()` check** in getPrioList (line 3068) caps suggestions at server-wide level cap. Keep.
- **Coordinate decode** `(coordId & 0xffff)` / `(coordId >> 16) & 0xffff` — assumes 32-bit packed coord. Used in BaseStatus support-weapon target lookup.
- **Race in batch upgrade** — failed upgrades silently skipped, no error handling.
- **`Cache.collectBuildings()`** (2304–2319) commented out — replaced by direct `city.get_Buildings().d` access (which the wrapper now publishes cleanly).

## Net carve-up

| Bucket | Lines (approx) | Action |
|---|---|---|
| KEEP — Collect | ~30 | Port |
| KEEP — Repair | ~60 | Port |
| KEEP — Production | ~130 | Port |
| KEEP — Upgrade Priority | ~680 | Port (algorithm intact, UI reimagined) |
| SALVAGE — Army Overview data | ~90 | Lift `updateCache` only → MMCommon.army |
| SALVAGE — Base Resources data | ~25 | Lift `updateCache` only → MMCommon.base.resources |
| SALVAGE — Base Status data | ~85 | Lift `updateCache` only → MMCommon.base.status |
| Common (Util/Wrapper/Language/Cache) | ~600 | Most goes to MMCommon (FormatNumbersCompact, FormatTimespan, GetStepTime, GetDateTimeString, etc.). Cache layer becomes shared. |
| TRASH | ~1700 | Drop (loot, MCV, chat, mission tracker, region-menu injections, dead code, language tables for trash features) |

Net: from 3402 lines down to roughly 1500–1800 lines in the new Base Tools script (with shared utility code moved out into MMCommon).
