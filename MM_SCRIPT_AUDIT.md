> **⚠️ SUPERSEDED for go-forward planning (2026-06-21):** the remaining 42 legacy scripts were re-read in
> full and given accurate, current dispositions in **`MM_CONSOLIDATION_PLAN.md`** — use that as the source of
> truth for what each leftover script does and whether it's RETIRE / SALVAGE-THEN-RETIRE / MM-IFY / QUARANTINE
> / PENDING. This file is kept for the original audit history + the §4 MMCommon design and §9 Member Status
> pilot notes.

# MM Script Pack — Full Library Audit & Consolidation Plan

_Generated for Mike's review. Covers all 67 userscripts in `CnCTA-MikeyMike-SCRIPT-PACK/`.
Already overhauled: **MM - Framework Wrapper** (`TA_infernal_wrapper`) and **MM - Battle Simulator 2026**
(`TA_Tiberium_Alliances_Battle_Simulator_V2`). **TACS** was already retired/deleted._

---

## 1. Executive summary

- The pack is **65 independent userscripts** plus the 2 we've done. Almost none share code — the same
  half-dozen mechanisms are re-implemented from scratch in script after script.
- **The single biggest finding:** dozens of scripts each roll their own **fragile regex
  "de-obfuscation"** of the game's minified ClientLib (the "NOEVIL" pattern). This is exactly what the
  **Framework Wrapper** exists to solve. Centralizing these lookups in the wrapper would remove the #1
  source of "breaks on every game patch" across the whole pack.
- There are **clear duplicate/variant clusters** (4 CNCTAOpt link buttons, 4 Maelstrom base scanners,
  3 compasses, 2 info stickers, 2 Flunik tools, old vs new battle sim, etc.) — strong candidates to
  merge or retire.
- A **shared "MM Common" library** (loaded right after the wrapper) is well justified. See §4.
- **Two privacy/security red flags** (plaintext passwords; two scripts that POST your scan data to
  third-party servers) should be addressed before going public. See §5.

---

## 2. Per-script inventory

Status legend: ✅ keep/review · ⚠️ quality or fragility concern · 🔁 duplicate/variant · 🗑️ retire candidate · 🔐 security/privacy

### Simulators
| Script | What it does | Status |
|---|---|---|
| TA_Tiberium_Alliances_Battle_Simulator_V2 | **DONE** — our main sim + optimizer + options panel | ✅ |
| TA_Battle_Simulator_V2_OLD | Old (18.07.12) version of the above; deprecated, mostly base64 icon blobs | 🗑️🔁 |
| TA_The_Green_Cross_Tools | POI tier/rank sim + message-list builder; ~500 lines of disabled BaseScanner/Upgrade dead code; FR/EN comments | ⚠️ |
| TA_POIs_Analyser | Alliance POI score/tier/rank tables + acquisition simulator | ✅ |

### Base scanners (heavy overlap)
| Script | What it does | Status |
|---|---|---|
| TA_Maelstrom_ADDON_Basescanner_AIO | All-in-one scanner: loot/growth/CP/defense table; superset of the others | ✅ (keep as the one) |
| TA_Maelstrom_ADDON_Basescanner_Basic | Subset of AIO; same FJ/FG engine + Addons.LocalStorage | 🔁🗑️ |
| TA_Maelstrom_ADDON_Basescanner_CNCOPTplus | AIO + growth-rate optimizer/layout recommender (4475 lines) | 🔁⚠️ |
| TA_Maelstrom_ADDON_Basescanner_Infected_Camps | AIO variant focused on infected camps (type 7) | 🔁🗑️ |
| TA_Shockr_Tools_Basescanner_Mailversion_reMod | Scans for "interesting" layouts, emails results; + base-counter chat tool | ⚠️ |
| ~~TA_BaseShare~~ | Scans NPC bases, **POSTs to project-exception.net** for alliance sharing | ❌ RETIRED 2026-06-21 (data exfiltration; was enabled:false; removed from build at Mike's request) |
| ~~TA_Count_Forgotten_Bases_Range~~ | Context-menu "paste count" of NPC bases in range, by level | ❌ RETIRED 2026-06-21 (pure dup of Shockr BaseCounter + MMCommon scan.inRange/coords) |

### Info overlays
| Script | What it does | Status |
|---|---|---|
| TA_Info_Sticker | Base resource/repair/MCV/production sticker (full) | ✅ |
| TA_Info_Sticker_SUPERCOMPACT | ~95% duplicate of above with sections commented out ("lite") | 🔁🗑️ |
| TA_BaseInfo | Big multilingual base/player info panel (≈80% translation tables) | ⚠️ |
| TA_CD_Player_Base_Info | Inline offense/defense (+repair) levels on city status panels | ✅ |
| TA_MHTools_Available_Loot_Summary_Info | Loot/troop/repair/production overlay (getBypass de-obf) | ⚠️🔁 |
| TA_PluginsLib_mhLoot | Loot/repair/distance overlay + **library** for mh* scripts (getBypass) | ⚠️ (library) |
| TA_PvP_PvE_Player_Info_Mod | Splits destroyed-base count PvP/PvE + POI tab in player info | ✅ |
| TA_Real_POI_Bonus | Real POI gain/loss corrected for rank multiplier | ✅ |
| TA_Repair_Time_Of_Death | Repair-time-at-death label on ghost cities | ✅ |
| TA_CityMoveInfoExtend | Adds in-range base count + wave estimate to move-cooldown tooltip | ✅ |
| TA_Warchief_Sector_HUD | Tiny HUD: current coord + 8-way sector; click→chat / jump | ✅ |

### Maps / compasses (overlap)
| Script | What it does | Status |
|---|---|---|
| TA_Map | Canvas world minimap: POIs, territory, alliances; zoom | ⚠️ (dead/incomplete code) |
| TA_CD_PvP_Quick_Map | Interactive canvas alliance/enemy map; per-alliance colors | ✅ |
| ~~TA_CD_Compass~~ | Canvas compass to selected/locked target (fork of mhNavigator) | ❌ RETIRED 2026-06-20 (compass ×3 dedup; distance + view-center primitives salvaged into MMCommon coords/map) |
| ~~TA_PluginsLib_mhNavigator~~ | Compass **library** (defines qx Canvas widgets); CD_Compass is ~90% this | ❌ RETIRED 2026-06-20 (sibling of CD_Compass; nothing else consumes it) |
| ~~TA_Compass_ALT~~ | Third compass: rotating-needle canvas to selected base | ❌ RETIRED 2026-06-20 (minimal ancestor of CD_Compass) |
| TA_Zoom | Extends map zoom range (NOEVIL regex on zoom getters) | ⚠️ |

### CNCTAOpt / cncopt link buttons (big overlap)
| Script | What it does | Status |
|---|---|---|
| TA_CnCTAOpt_Link_Button | Right-click→share base to **cnctaopt.com** (current site), modern syntax | ✅ (keep as the one) |
| TA_CNCOpt_Link_Button | Same idea → **cncopt.com** (old site), ~12yr old | 🔁🗑️ |
| TA_CNCOpt_Link_Button_SC | "SC" variant of the cncopt button | 🔁🗑️ |
| TA_CNCOptPLUS_Link_Button | "Plus" variant of the cncopt button | 🔁🗑️ |
| TA_View_Player_Base | Right-click→encode base to cncopt.com (own copy of keymaps) | 🔁 |

### Resource / economy
| Script | What it does | Status |
|---|---|---|
| TA_New_Resource_Trade_Window | Replaces trade overlay: multi-base bulk transfer + filters | ✅ |
| TA_Transfer_All_resources | "Transfer All" button (brittle hardcoded UI indices) | ⚠️🔁 |
| TA_Supplies_Mod | Hides spendable funds in shop to avoid misclicks | ✅ |

### Upgrade / build automation (overlap)
| Script | What it does | Status |
|---|---|---|
| TA_Autopilot | Auto-upgrade buildings/def/off + collector economy modes (German vars) | ⚠️ |
| ~~TA_New_Custom_Flunik_Tools~~ | Health-per-cost upgrade prioritizer (single-letter state vars) | ❌ RETIRED 2026-06-21 (orphan source, no registry row; strict subset of Autopilot + MM - Base Tools) |
| TA_Flunik_Tools_reloaded | Upgrade tracker + POI scanner (huge, 7× duplicated tab handlers) | ⚠️🔁 |
| TA_Upgrade_Top_ModButtonPos | Upgrade highest-level building per type on interval (logging bug) | ⚠️🔁 |
| TA_Warchief_Upgrade_Base_Defense_Army | Bulk upgrade all buildings/def/army to target level + cost/time | ✅ |
| TA_xTrim_Base_Overlay_DR_4_3 | Ctrl-hold heat-map of building upgrade cost/gain efficiency | ✅ |
| TA_MaelstromTools_Dev_Mod_MCV | Big toolkit: auto-collect/repair, MCV calc, loot, upgrade priority | ⚠️ |
| TA_Auto_Repair | Auto-repair buildings by ROI/priority on interval | ✅ |

### Combat reports
| Script | What it does | Status |
|---|---|---|
| TA_Report_Stats | Multi-report select → loot/CP/RT totals + loot/CP ratio | ✅🔁 |
| TA_Report_Summary | Combat reports grouped by base/date/type → totals (minified) | ✅🔁 |
| TA_Wavy | Forgotten attack-wave count + level breakdown on hover | ✅ |

### Combat / army / map-range
| Script | What it does | Status |
|---|---|---|
| TA_Formation_Saver | Save/load attack formations per city-pair (sim has its own too) | ✅🔁 |
| TA_Attack_Range → **MM - Attack Range** | Highlights bases in range while moving a base | ✅ MM-ified 2026-06-20 (1.0.0; on MMCommon map/coords/base; dead offense-panel dropped; options + HUD button) |
| TA_Tunnel_Info | Tunnel block/activate overlays + required offense level | ✅ |
| TA_PvP_PvE_Ranking_POI_Holding_Split_Base_Kill_Score | Alliance PvP/PvE + POI holdings tabs in player info | ✅ |

### Alliance / social / chat
| Script | What it does | Status |
|---|---|---|
| TA_AlliancesMemberOnline | Floating window of online/away alliance members (5s poll) | ✅ |
| TA_ADDON_City_Online_Status_Colorer_SC | Colors map city text by member online status (NOEVIL) | ✅ |
| TA_CD_PvP_Alert_Status | Title/favicon/sound alert when a base is attacked (big base64 blobs) | ✅ |
| ~~TA_Chat_Colorize~~ | Role-based chat name colors + alliance tags (15s startup hack) | ❌ RETIRED 2026-06-20 (chat cleanup; feature dropped, no reusable primitive) |
| ~~TA_Chat_Helper_Enhanced_Mod~~ | BBCode insert, auto-tag coords/urls, contact list (~2014) | ❌ RETIRED 2026-06-20 (chat cleanup; common coords parse/format/insert already in MMCommon, rest was feature logic) |
| ~~TA_Coords_Button_All~~ | Context-menu "paste coords" into chat | ❌ RETIRED 2026-06-20 (== MMCommon.coords.insertIntoChat + format; no extension file, stale registry entry removed) |
| ~~TA_Coord_Box_Shortcut~~ | Floating "navigate to X,Y" box (dead test fns) | ❌ RETIRED 2026-06-20 (navigate == MMCommon.coords.goTo, which is better; rest was dead debug scaffolding) |
| ~~TA_Crucial_CNC_Map_Link~~ | Scripts-menu button → cnc-map.com for this world | ❌ RETIRED 2026-06-20 (external link to third-party site; native Scripts menu now our CnC Pack) |

### Stats / external
| Script | What it does | Status |
|---|---|---|
| ~~TA_leoStats~~ | Stats + base scanner + share links; **encrypted payload**, **POSTs to cnc.indyserver.info**; "restructuring" | ❌ RETIRED 2026-06-21 (data exfiltration; was enabled:false/inactive + not even deployed to the build; removed from sources at Mike's request) |
| TA_POI_ExporterTools | Export POIs to CSV; movable window (clean, modern ES6) | ✅ |
| TA_Report_Summary | (listed above) | |

### Utility / GUI tweaks
| Script | What it does | Status |
|---|---|---|
| TA_Hotkeys | Login hotkeys (**plaintext passwords**) + chat/info inserts; `link` bug | 🔐⚠️ |
| TA_Multissesion_MOD | "New session" link (clears cookies); deprecated jQuery `.live()` | ✅ |
| TA_MovableMenuOverlay | Makes game menu overlays draggable (brittle regex patching) | ⚠️ |
| ~~TA_PTE_CheatScript~~ | PTE-server cheat loop; all cheats off by default (non-functional OOB) | ❌ RETIRED 2026-06-21 (PTE test-server cheat artifact; /cheat commands do nothing on live, gated to /320/; no value to us) |
| TA_Hotkeys / others | — | |

---

## 3. Duplicate / variant clusters → merge or retire

1. **Old battle sim** — `TA_Battle_Simulator_V2_OLD` is a stale copy of our active sim. **Retire** (delete file + its `id 10086` options entry), same as TACS.
2. **Info Sticker ×2** — SUPERCOMPACT is the full sticker with blocks commented out, and they share the same `infoSticker-*` localStorage keys (collide if both on). **Merge** into one with a "compact mode" toggle; retire the variant.
3. **CNCTAOpt/cncopt link buttons ×5** — `CnCTAOpt_Link_Button` targets the **current** cnctaopt.com; `CNCOpt_Link_Button`, `_SC`, `CNCOptPLUS` target the **dead** cncopt.com; `View_Player_Base` re-implements the encoder again. **Keep the cnctaopt one**, retire the cncopt.com trio, fold View_Player_Base's "view base" entry point onto the shared encoder.
4. **Maelstrom base scanners ×4** — Basic/AIO/CNCOPTplus/Infected all share one scan engine + storage + table; AIO is the superset. **Keep AIO** (optionally absorb the growth-optimizer from CNCOPTplus as a toggle), retire Basic + Infected.
5. **Compasses ×3** — `mhNavigator` (library) ≈ `CD_Compass` (fork) and both define `qx.html.Canvas`/`qx.ui.embed.Canvas` → **conflict if co-loaded**; `Compass_ALT` is a third. **Pick one** (decide whether mh* scripts still need mhNavigator as a lib).
6. **Flunik ×2** — `Flunik_Tools_reloaded` vs `New_Custom_Flunik_Tools` overlap on upgrade automation. **Compare and merge.**
7. **Upgrade automators ×5** — Autopilot, New_Custom_Flunik, Upgrade_Top_ModButtonPos, Warchief_Upgrade, MaelstromTools all auto-upgrade. **Rationalize** to one strong tool (Warchief_Upgrade is the cleanest).
8. **Combat reports ×2** — Report_Stats (per-report selection) vs Report_Summary (grouped totals). Overlap; could merge into one report tool with two views.
9. **Player/base info ×3** — CD_Player_Base_Info, View_Player_Base, PvP_PvE_Player_Info_Mod overlap on showing player/base data.
10. **Formation save/load** — `TA_Formation_Saver` duplicates what the battle sim already does; decide if the standalone is still needed.

---

## 4. Proposed "MM Common" shared library

Create one library userscript (e.g. `TA_MM_Common.user.js`, loaded immediately after the Framework
Wrapper, exposing `window.MMCommon`). It would eliminate the most-repeated code in the pack. Modules,
in priority order by how much duplication they kill:

1. **De-obfuscation registry (extend the Framework Wrapper).** The wrapper already re-exposes
   `get_OffenseUnits` / `get_DefenseUnits` / `get_Simulation` / `DoStep`. Extend it to also publish the
   members that ~20 scripts currently regex out themselves: `get_Buildings`, NPC/city `get_BaseLevel`,
   `getID`, `get_CampType`, the POI status member, BaseNavigationBar method, etc. **This is the highest-value
   change in the whole pack** — it removes the #1 cause of patch-day breakage everywhere.
2. **`MMCommon.scan`** — base/region iteration within attack range (grid walk + distance + type filter +
   "is buildable/destroyed" checks). Replaces bespoke copies in all 4 Maelstrom scanners, Shockr, BaseShare,
   Count_Forgotten, CityMoveInfo, Wavy, Attack_Range, MHTools, mhLoot, leoStats.
3. **`MMCommon.cnctaopt`** — the unit/building keymaps + grid encoder for cnctaopt.com links. Replaces the
   5 link-button copies + the sim's own `encodeToCNCOpt` + leoStats `make_sharelink`. (One canonical keymap
   table instead of 6 drifting ones.)
4. **`MMCommon.settings`** — per-player/per-world localStorage store (the battle sim's `TABS.SETTINGS`
   design is a good base). Replaces Addons.LocalStorage, MaelstromTools.LocalStorage, Auto_Repair's
   world-scoped store, Map's TAMapStorage, the mh* load/saveFromStorage, and many inline `JSON.parse`.
5. **`MMCommon.repair`** — repair-time/cost calc + the `hms/dhms/FormatTimespan` formatters. Replaces copies
   in the sim, Auto_Repair, MHTools, mhLoot, Flunik, Info Stickers, Report_Stats/Summary, CD_Player_Base_Info,
   Repair_Time_Of_Death.
6. **`MMCommon.loot`** — loot/resource summary (getLoots/getResourcesPart variants).
7. **`MMCommon.ui`** — a **dockable/movable window base** (one canonical window with consistent chrome,
   position persistence, dock/undock, online/away-style theming) + a **`CommonButtonHandler`** (register a
   top-bar/HUD button → toggles an MMCommon window, with consistent placement so buttons don't fight for
   screen space) + compact number format (`k/M/G/T`) + a table-builder helper. Replaces ~10 bespoke
   movable-window implementations and ~5 number formatters. _The Alliance Overview button + Online Members
   dialog (see §9) is the reference case for both the CommonButtonHandler and the dockable-window base._
8. **`MMCommon.net`** — one `attachNetEvent/detachNetEvent` wrapper (with the phe.cnc.Util → webfrontend.gui
   fallback every script copies).
9. **`MMCommon.coords`** — `[coords]X:Y[/coords]` parse/format, chat-input insertion, and `CenterGridPosition`
   navigation + 8-way sector calc. Replaces copies in Coords_Button_All, Coord_Box, Warchief_HUD,
   Count_Forgotten, Shockr, CD_Compass, mhNavigator, Chat_Helper.
10. **`MMCommon.menu`** — a single safe `RegionCityMenu.showMenu` hook that lets multiple scripts add buttons
    without clobbering each other's saved "original" (today several scripts each wrap it → order-dependent).
11. **`MMCommon.log`** — the `[MM …]` prefixed `wlog/wwarn/werr` + `window.*_DEBUG` gate from the playbook,
    so every script shares one debug convention.

**Migration approach:** build `MMCommon` first; then as each script comes up for its review pass, swap its
private copy for the shared module (incrementally, low-risk, one script at a time). The wrapper-registry
extension (#1) can be done immediately and benefits scripts even before they're individually migrated.

---

## 5. Security / privacy red flags (address before going public)

- 🔐 **TA_Hotkeys** stores **plaintext account passwords** in a `Logins[]` array and auto-submits the login
  form. Also has a real bug (undefined `link` at ~line 128). Recommend: remove the credential feature (or
  gate it behind explicit opt-in with a clear warning) before any public release.
- 🔐 **TA_leoStats** ships an **encrypted/obfuscated payload** and **POSTs scanned base + player/alliance data
  to `cc.indyserver.info`**. The header even says it's mid-"restructuring." High maintenance + privacy risk.
- 🔐 **TA_BaseShare** **POSTs scanned NPC base data to `project-exception.net`** (may be dead). 
- For all three: at minimum disclose the external calls; ideally make them opt-in or remove for the MM pack.

---

## 6. Cross-pack quality themes

- **NOEVIL regex de-obfuscation everywhere** — the dominant fragility. Centralizing in the wrapper (§4.1)
  is the fix. Until then, every game patch can silently break many scripts.
- **Hardcoded UI child indices** (e.g. `getChildren()[13][1][0]`) in Transfer_All, PvP_PvE_Player_Info, etc.
  — brittle to game UI changes.
- **Dead/commented code** in many (Green_Cross ~500 lines, Map, New_Custom_Flunik, Autopilot, Info Stickers).
- **Single-letter/obfuscated variable names & German comments** in older scripts (Autopilot, Report_Summary,
  New_Custom_Flunik) hurt maintainability.
- **No shared debug story** — each logs differently. The playbook's `[MM …]`/`*_DEBUG` convention should
  spread via `MMCommon.log`.

---

## 7. Recommended review order (when we resume one-by-one)

1. **Retire the obvious dead weight first** (fast, shrinks the surface): `Battle_Simulator_V2_OLD`, the
   Maelstrom Basic/Infected variants, the cncopt.com link-button trio, Info_Sticker SUPERCOMPACT. Confirm
   each before deleting.
2. **Build `MMCommon` + extend the Wrapper registry** (§4.1–4.3 first). Biggest leverage.
3. **Decide the keepers within each cluster** (one scanner, one link button, one compass, one report tool,
   one upgrade tool) and apply the playbook to those.
4. **Then sweep the standalone, low-overlap, good scripts** (POI_ExporterTools, Tunnel_Info, Real_POI_Bonus,
   Warchief_Sector_HUD, CD_Player_Base_Info, Wavy, etc.) — quick playbook passes.
5. **Quarantine/redesign the security items** (Hotkeys, leoStats, BaseShare).

---

## 9. Reference redesign — Alliance Overview / Online Members (`TA_AlliancesMemberOnline`)

Mike's chosen pilot for the **CommonButtonHandler + dockable-window** pattern. Current state: an "Alliance
Overview" button opens an aging container-in-a-dialog listing members with `>>` prefixes for Away.

Planned redesign (do during the script-by-script phase, once MMCommon exists):
- Convert the dialog to a **dockable MMCommon window** (built on `MMCommon.ui`), opened via
  `CommonButtonHandler`.
- **Drop the `>>` Away indicator**; instead **color-code rows**: Online vs Away (and Offline/Hidden) —
  reuse the color scheme already in `TA_Chat_Colorize` / `TA_ADDON_City_Online_Status_Colorer_SC`.
- **Optional columns** (shown only when alliance access rights allow): each member's **highest army level**
  and **highest defense level**. Gate on access; hide gracefully when not permitted.
- This becomes the template the other floating panels (Info Sticker, mhLoot, scanners, compass) migrate to.

## 10. Options-list hygiene — orphan entries (no backing file)

`background.js` lists 7 rows whose `fname` has **no script file** in the pack (dead/non-loadable rows):
`TA_Auto_Login`, `TA_BaseNavBar_Reorderer`, `TA_FarmBase`, `TA_KlickitlikeShing0`, `TA_ReplayShare`,
`TA_The_Green_Cross_Combat_Simulator`, `TA_Warchief_Combat_Simulator`. Remove these entries (UI-only cleanup,
safe). _Status: pending confirmation._

> **Progress (2026-06-20):**
> - Retired: `TA_Battle_Simulator_V2_OLD`, the 3 cncopt.com link buttons (`TA_CNCOpt_Link_Button`,
>   `_SC`, `CNCOptPLUS`), Maelstrom `Basic` + `Infected_Camps` scanners, `TA_Info_Sticker_SUPERCOMPACT`
>   (files deleted from repo + extension; options entries removed). Pack now **60 userscripts**.
> - Removed all **7 orphan options entries** (§10). `background.js` now has zero rows without a backing file.
> - Built **`TA_MM_Common.user.js`** (`window.MMCommon`, options id 10200, loads after the wrapper):
>   implemented log / net / settings / num / time / coords; scaffolded cnctaopt / scan / repair / loot /
>   ui / buttons (CommonButtonHandler) for migration. Synced + parse-checked.
> - **Framework Wrapper de-obf registry extended (v1.1.0):** now also publishes
>   `WorldObjectCity/NPCBase/NPCCamp.get_BaseLevel()/getID()/get_CampType()` (centralized from the
>   proven Maelstrom AIO / Count_Forgotten regex). Added isolated/non-fatal so it can't break the
>   wrapper. MMCommon gained a `deobf` module (`fieldFromGetter`, `objectMemberOfSetter`,
>   `ensureGetObject`) for the remaining per-widget `setObject→getObject` cases.
> - **Next:** Alliance Overview pilot (build `ui.Window` + `buttons.register` for real), then migrate
>   cluster keepers onto MMCommon + the wrapper getters (drop their private regex copies).

## 8. Quick stats

- Files audited: **67** (65 here + 2 already overhauled).
- Retire candidates identified: ~**9** (old sim, 2 scanner variants, 3 cncopt buttons, 1 sticker variant, plus review of compass/Flunik dupes).
- Distinct mechanisms duplicated across many scripts: **~11** (see §4).
- Scripts using fragile NOEVIL regex de-obfuscation: **~20+**.
- External-server data senders: **2** (leoStats, BaseShare); plaintext-credential script: **1** (Hotkeys).
