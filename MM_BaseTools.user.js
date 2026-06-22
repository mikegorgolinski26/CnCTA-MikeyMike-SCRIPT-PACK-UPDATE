// ==UserScript==
// @name            MM - Base Tools
// @description     One-stop per-base toolkit: collect packages across all bases, repair all units/buildings, see overall production, prioritize building upgrades, and (later) auto-optimize tile layout for tiberium/crystal/power/credit production. Rebuilt on the MM - Common Library.
// @author          Maelstrom, HuffyLuf, KRS_L, Krisan, DLwarez, NetquiK
// @contributor     MikeyMike (CnCTA-MikeyMike-SCRIPT-PACK)
// @version         1.4.1
// @match           https://*.alliances.commandandconquer.com/*/index.aspx*
// @downloadURL     https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/MM_BaseTools.user.js
// @updateURL       https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/MM_BaseTools.user.js
// ==/UserScript==

/*
================================================================================
 MM - Base Tools
================================================================================
 A slimmer, MMCommon-backed per-base toolkit. Ships four tabs in a single
 dockable window (position / size / open-state / last-tab all persist):

   Collect & Repair   - one-click collect-all-packages, repair-all-units,
                        repair-all-buildings across every base; plus a
                        periodic auto-collect / auto-repair timer. Bottom-right
                        notification buttons appear only when there's work to do.
   Production         - per-base + grand-total production (Package / Continuous /
                        Alliance Bonus / Total per h). Killed bases excluded
                        from totals.
   Upgrade Priority   - one unified, sortable table across all bases and resource
                        types; per-base/resource/availability filters (all
                        persisted); one-click upgrade and transfer-then-upgrade.
                        Bonus: hold Ctrl in-base to overlay each resource tile
                        with its next-level gain/cost ratio (green=best, red=
                        worst). Toggle via "On-grid overlay (Ctrl-hold)" on
                        this tab. Salvaged from xTr1m's Base Overlay (retired).
   Layout Optimizer   - one-click optimize for tiberium / crystal / power /
                        credits via building rearrangement. PHASE A:
                        recommend-only overlay (icons, on-grid move markers,
                        sell-up-to-N). PHASE B: one-click "Apply to base" -
                        auto-applies the proposed moves/demolitions via the
                        sniffed CityBuilding primitives (move IXYXAF / demolish
                        BFHPNB), with a confirm-with-preview dialog (total moves,
                        permanent demolitions, package progress reset) and
                        effect-verified, dependency-safe step ordering.

 Credit: the original tool this descends from was authored by Maelstrom,
 HuffyLuf, KRS_L, Krisan, DLwarez and NetquiK (see @author). This is a ground-up
 MikeyMike rebuild on MMCommon - the logic was reimplemented as plain functions,
 not the original qx class structure.

 Settings (all via MMCommon.settings, per player+world): BaseTools.* (auto-collect
 / auto-repair toggles + timer, plus the Upgrade Priority filter selections).

 Debug: window.MMBASETOOLS_DEBUG = true  (or window.MM_DEBUG = true) for verbose
        [MM Base Tools] logs.
================================================================================
*/

(function () {
    var BaseTools_main = function () {
        var LOG = (window.MMCommon && window.MMCommon.makeLogger)
            ? window.MMCommon.makeLogger("Base Tools")
            : { log: function () {}, warn: function () { try { console.warn.apply(console, arguments); } catch (e) {} }, err: function () { try { console.error.apply(console, arguments); } catch (e) {} } };

        // Per-script verbose toggle: persisted in localStorage so it survives reload.
        // Enable: localStorage.MMBASETOOLS_DEBUG = '1'   (or window.MMBASETOOLS_DEBUG = true)
        if (typeof window.MMBASETOOLS_DEBUG === "undefined") {
            try { window.MMBASETOOLS_DEBUG = (window.localStorage.getItem("MMBASETOOLS_DEBUG") === "1"); } catch (e) { window.MMBASETOOLS_DEBUG = false; }
        }
        var wlog = function () { if (!(window.MMBASETOOLS_DEBUG || window.MM_DEBUG)) return; LOG.log.apply(LOG, arguments); };
        var wwarn = function () { LOG.warn.apply(LOG, arguments); };
        var werr = function () { LOG.err.apply(LOG, arguments); };

        // ----- helpers ----------------------------------------------------------------
        // Iterate every OWN city. Returns the city objects (skip non-owned / spectator).
        function eachOwnCity(cb) {
            try {
                var cities = ClientLib.Data.MainData.GetInstance().get_Cities();
                var arr = cities.get_AllCities();
                var keys;
                try { keys = Object.keys(arr.d); } catch (e) { keys = []; }
                for (var i = 0; i < keys.length; i++) {
                    var c = arr.d[keys[i]];
                    try { if (c && c.IsOwnBase && c.IsOwnBase()) cb(c); } catch (e) { werr("eachOwnCity cb failed:", e); }
                }
            } catch (e) { werr("eachOwnCity iteration failed:", e); }
        }

        // Aggregate counts: how many bases have collectable packages / repairable units / repairable buildings.
        // The repair-availability check needs a Vis.Mode (City for buildings, ArmySetup for units), exactly
        // like the original tool's checkRepairAll() did - this is the authoritative game-side check.
        function counts() {
            var out = { collect: 0, repUnits: 0, repBld: 0 };
            try {
                var ModeCity = ClientLib.Vis.Mode.City;
                var ModeArmy = ClientLib.Vis.Mode.ArmySetup;
                eachOwnCity(function (c) {
                    // Killed/ghost bases still report residual collectable packages and repairable
                    // entities, but you can't actually collect or repair them - so skip them entirely.
                    // Otherwise the collect/repair notification buttons would never clear.
                    try { if (c.get_IsGhostMode && c.get_IsGhostMode()) return; } catch (e) {}
                    try {
                        var d = c.get_CityBuildingsData && c.get_CityBuildingsData();
                        if (d && d.get_HasCollectableBuildings && d.get_HasCollectableBuildings()) out.collect++;
                    } catch (e) {}
                    try {
                        var rd = c.get_CityRepairData && c.get_CityRepairData();
                        if (!rd) return;
                        if (rd.CanRepairAll && rd.CanRepairAll(ModeCity)) out.repBld++;
                        if (rd.CanRepairAll && rd.CanRepairAll(ModeArmy)) out.repUnits++;
                    } catch (e) {}
                });
            } catch (e) { werr("counts failed:", e); }
            return out;
        }

        function collectAll() {
            var n = 0;
            eachOwnCity(function (c) {
                try {
                    if (c.get_IsGhostMode && c.get_IsGhostMode()) return; // killed base: nothing collectable
                    var d = c.get_CityBuildingsData && c.get_CityBuildingsData();
                    if (d && d.get_HasCollectableBuildings && d.get_HasCollectableBuildings()) {
                        c.CollectAllResources();
                        n++;
                    }
                } catch (e) { werr("collect on city failed:", e); }
            });
            wlog("collectAll: triggered on", n, "cities");
            return n;
        }

        function repairAll(mode) {
            var n = 0;
            eachOwnCity(function (c) {
                try {
                    if (c.get_IsGhostMode && c.get_IsGhostMode()) return;
                    var rd = c.get_CityRepairData && c.get_CityRepairData();
                    if (rd && rd.CanRepairAll && rd.CanRepairAll(mode)) {
                        rd.RepairAll(mode);
                        n++;
                    }
                } catch (e) { werr("repair on city failed:", e); }
            });
            wlog("repairAll(" + (mode === ClientLib.Vis.Mode.ArmySetup ? "units" : "buildings") + "): triggered on", n, "cities");
            return n;
        }

        // Default repair priority order (highest first). Salvaged verbatim from TA_Auto_Repair
        // (petui, NetquiK), retired into this script 2026-06-21. Defenses+yard first so a base
        // under attack heals what matters; harvesters/refinery last because they're cheap and
        // recover on their own anyway.
        function defaultRepairOrder() {
            var T = ClientLib.Base.ETechName;
            return [
                T.Defense_Facility, T.Construction_Yard, T.Defense_HQ, T.Support_Air,
                T.Command_Center, T.Barracks, T.Factory, T.Airport,
                T.Silo, T.Accumulator, T.PowerPlant,
                T.Harvester, T.Harvester_Crystal, T.Refinery
            ];
        }

        // Expand Support_Air -> Ion + Art in place (the game stores them as separate ETechNames
        // but users treat them as one slot, like Auto_Repair did).
        function expandRepairOrder(order) {
            var out = order.slice();
            for (var i = 0; i < out.length; i++) {
                if (out[i] === ClientLib.Base.ETechName.Support_Air) {
                    out.splice(i + 1, 0, ClientLib.Base.ETechName.Support_Ion, ClientLib.Base.ETechName.Support_Art);
                    i += 2;
                }
            }
            return out;
        }

        // Per-building "return on full repair" = sum of full-repair costs across resources
        // divided by sum of production-per-hour DELTA we'd gain by going from current HP back to 100%.
        // Lower ratio = repair first (we recoup the cost faster). Buildings with no positive production
        // delta return Infinity so they sort to the end. Math is faithful to Auto_Repair.
        function buildingRepairROI(city, b) {
            try {
                var info = city.GetBuildingDetailViewInfo(b);
                if (!info || !info.OwnProdModifiers) return Infinity;
                var EMT = ClientLib.Base.EModifierType,
                    RES_TYPES = [EMT.TiberiumProduction, EMT.CrystalProduction, EMT.PowerProduction, EMT.CreditsProduction],
                    hp = b.get_HitpointsPercent ? b.get_HitpointsPercent() : 1;
                if (!hp || hp <= 0) return Infinity;
                var deltaSum = 0, mods = info.OwnProdModifiers.d;
                for (var i = 0; i < RES_TYPES.length; i++) {
                    var e = mods[RES_TYPES[i]];
                    if (e) deltaSum += (e.TotalValue / hp) - e.TotalValue;
                }
                if (deltaSum <= 0) return Infinity;
                var costs = ClientLib.API.Util && ClientLib.API.Util.GetUnitRepairCostsForCity
                    ? ClientLib.API.Util.GetUnitRepairCostsForCity(city, b.get_CurrentLevel(), b.get_MdbUnitId(), 1)
                    : null;
                if (!costs) return Infinity;
                var filt = ClientLib.Base.Util.FilterResourceCosts(costs), costSum = 0;
                for (var j = 0; j < filt.length; j++) costSum += filt[j].Count;
                return costSum / deltaSum;
            } catch (e) { return Infinity; }
        }

        // Prioritized repair across every base. For each LIVE, unlocked, damaged base: walk the
        // user's tech-name order; for each tier, ROI-sort the damaged buildings and fire CanRepair/
        // Repair one by one; stop at the first that can't be afforded (don't keep trying lower
        // tiers if we ran out for a higher-priority one). If the whole priority walk completed
        // without skipping, RepairAll(City) the rest as a mop-up for anything not in the list.
        // Falls back to plain repairAll(City) if CityEntity.CanRepair isn't wired by the wrapper
        // (e.g. wrapper's regex didn't match on a future patch) or if the priority list is empty.
        function repairAllPrioritized(order) {
            try {
                var probe = ClientLib.Data.CityEntity && ClientLib.Data.CityEntity.prototype;
                if (!probe || typeof probe.CanRepair !== "function" || typeof probe.Repair !== "function") {
                    wwarn("CityEntity.CanRepair/Repair missing from wrapper - falling back to plain RepairAll");
                    return repairAll(ClientLib.Vis.Mode.City);
                }
                if (!order || !order.length) return repairAll(ClientLib.Vis.Mode.City);
                var expanded = expandRepairOrder(order),
                    VisMain = ClientLib.Vis.VisMain.GetInstance(),
                    prevMode = VisMain.get_Mode();
                try { VisMain.set_Mode(ClientLib.Vis.Mode.City); } catch (e) {}
                var touched = 0;
                eachOwnCity(function (c) {
                    try {
                        if (c.get_IsGhostMode && c.get_IsGhostMode()) return;
                        if (c.get_IsDamaged && !c.get_IsDamaged()) return;
                        if (c.get_IsLocked && c.get_IsLocked()) return;
                        var bldData = c.get_CityBuildingsData && c.get_CityBuildingsData();
                        if (!bldData || !bldData.GetAllBuildingsByTechName) return;
                        var blocked = false;
                        for (var i = 0; i < expanded.length; i++) {
                            var bucket = bldData.GetAllBuildingsByTechName(expanded[i]);
                            if (!bucket || !bucket.l) continue;
                            var damaged = [];
                            for (var j = 0; j < bucket.l.length; j++) {
                                var bj = bucket.l[j];
                                if (bj && bj.get_IsDamaged && bj.get_IsDamaged()) damaged.push(bj);
                            }
                            if (!damaged.length) continue;
                            damaged.sort(function (x, y) {
                                var rx = buildingRepairROI(c, x), ry = buildingRepairROI(c, y);
                                return (rx === ry) ? 0 : (rx < ry ? -1 : 1);
                            });
                            for (var k = 0; k < damaged.length; k++) {
                                var b = damaged[k];
                                if (b.CanRepair && b.CanRepair()) b.Repair();
                                if (b.get_IsDamaged && b.get_IsDamaged()) { blocked = true; break; }
                            }
                            if (blocked) break;
                        }
                        if (!blocked) {
                            var rd = c.get_CityRepairData && c.get_CityRepairData();
                            if (rd && rd.CanRepairAll && rd.CanRepairAll(ClientLib.Vis.Mode.City)) {
                                rd.RepairAll(ClientLib.Vis.Mode.City);
                            }
                        }
                        touched++;
                    } catch (e) { werr("prioritized repair on city failed:", e); }
                });
                try { VisMain.set_Mode(prevMode); } catch (e) {}
                wlog("repairAllPrioritized: touched", touched, "cities");
                return touched;
            } catch (e) {
                werr("repairAllPrioritized failed; falling back to RepairAll(City):", e);
                return repairAll(ClientLib.Vis.Mode.City);
            }
        }

        // ===== On-grid Upgrade Overlay (Ctrl-hold) ======================================
        // Salvaged from xTr1m's Base Overlay (DR 4:3), retired 2026-06-21. Hold Ctrl while
        // viewing your own base -> translucent colored boxes appear on each resource-producing
        // building (Harvester, Silo, PowerPlant, Accumulator, Refinery) showing the gain/cost
        // ratio if you upgrade that tile to the next level. Best=green, worst=red, label is
        // the ratio. Release Ctrl (or alt-tab away) -> overlay disappears. The package-vs-
        // production math matches MM - Base Tools' own Upgrade Priority engine: PackageSize
        // entries factor in BOTH package-size growth AND package-delay change; flat Production
        // entries are NewLvlDelta direct. Per-tile gains across the 4 (resource, building-set)
        // groups are summed so a PowerPlant correctly shows the combined Power+Credits value.
        function computeUpgradeOverlayTiles(ownCity) {
            try {
                var ETN = ClientLib.Base.ETechName, EMT = ClientLib.Base.EModifierType;
                var GROUPS = [
                    { types: [ETN.Harvester, ETN.Silo],         ps: EMT.TiberiumPackageSize, pr: EMT.TiberiumProduction },
                    { types: [ETN.Harvester, ETN.Silo],         ps: EMT.CrystalPackageSize,  pr: EMT.CrystalProduction },
                    { types: [ETN.PowerPlant, ETN.Accumulator], ps: EMT.PowerPackageSize,    pr: EMT.PowerProduction },
                    { types: [ETN.Refinery, ETN.PowerPlant],    ps: EMT.CreditsPackageSize,  pr: EMT.CreditsProduction }
                ];
                var sph = ClientLib.Data.MainData.GetInstance().get_Time().get_StepsPerHour();
                var bldData = ownCity.get_Buildings && ownCity.get_Buildings();
                if (!bldData) return [];
                var d = bldData.d || {};
                var tiles = {};
                for (var k in d) {
                    var b = d[k]; if (!b) continue;
                    var techName;
                    try { techName = b.get_TechName(); } catch (e) { continue; }
                    var totalGain = 0, matched = false;
                    for (var gi = 0; gi < GROUPS.length; gi++) {
                        var g = GROUPS[gi];
                        var inGroup = false;
                        for (var ti = 0; ti < g.types.length; ti++) { if (g.types[ti] === techName) { inGroup = true; break; } }
                        if (!inGroup) continue;
                        matched = true;
                        var info; try { info = ownCity.GetBuildingDetailViewInfo(b); } catch (e) { continue; }
                        if (!info || !info.OwnProdModifiers) continue;
                        var mods = info.OwnProdModifiers.d;
                        for (var mt in mods) {
                            var mtInt = parseInt(mt, 10);
                            if (mtInt === g.ps) {
                                try {
                                    var main = mods[b.get_MainModifierTypeId()];
                                    if (!main) continue;
                                    var curDelay = main.TotalValue / sph;
                                    var nextDelay = (main.TotalValue + main.NewLvlDelta) / sph;
                                    if (!curDelay || !nextDelay) continue;
                                    var prod = mods[mt];
                                    var curRate = prod.TotalValue / curDelay;
                                    var nextRate = (prod.TotalValue + prod.NewLvlDelta) / nextDelay;
                                    totalGain += nextRate - curRate;
                                } catch (e) {}
                            } else if (mtInt === g.pr) {
                                try { totalGain += mods[mt].NewLvlDelta; } catch (e) {}
                            }
                        }
                    }
                    if (!matched) continue;
                    var cost = 0;
                    try {
                        var reqs = ClientLib.Base.Util.GetTechLevelResourceRequirements_Obj(b.get_CurrentLevel() + 1, b.get_TechGameData_Obj());
                        for (var ct in reqs) {
                            var entry = reqs[ct];
                            if (typeof entry === "function") continue;
                            if (!entry || entry.Type == 0) continue;
                            var cnt = parseInt(entry.Count);
                            if (!(cnt > 0)) continue;
                            cost += cnt;
                        }
                    } catch (e) {}
                    if (cost <= 0) continue;
                    var px, py;
                    try { px = b.get_CoordX(); py = b.get_CoordY(); } catch (e) { continue; }
                    var key = py * 100 + px;
                    if (!tiles[key]) tiles[key] = { posX: px, posY: py, gain: 0, cost: cost };
                    tiles[key].gain += totalGain;
                }
                var out = [];
                for (var kk in tiles) {
                    var t = tiles[kk];
                    if (t.gain <= 0) continue;
                    t.ratio = t.gain / t.cost;
                    out.push(t);
                }
                return out;
            } catch (e) { werr("computeUpgradeOverlayTiles failed:", e); return []; }
        }

        // Lifecycle controller for the Ctrl-hold overlay. Returns { destroy } - call destroy
        // on script disable (MMCommon.lifecycle) to detach the keydown listeners.
        function installUpgradeOverlay() {
            var MM = window.MMCommon;
            var overlay = null;
            var isOpen = false;

            function openOverlay() {
                if (isOpen) return;
                try {
                    var app = qx.core.Init.getApplication();
                    var mainOverlay = app.getMainOverlay();
                    var bounds = mainOverlay && mainOverlay.getBounds && mainOverlay.getBounds();
                    if (!bounds) return;
                    var ownCity = ClientLib.Data.MainData.GetInstance().get_Cities().get_CurrentOwnCity();
                    if (!ownCity) return;
                    var visCity = ClientLib.Vis.VisMain.GetInstance().get_City();
                    if (!visCity) return;

                    var tiles = computeUpgradeOverlayTiles(ownCity);
                    if (!tiles.length) return;

                    var zoom = visCity.get_ZoomFactor();
                    var tw = visCity.get_GridWidth() * zoom;
                    var th = visCity.get_GridHeight() * zoom;
                    var ox = visCity.get_MinXPosition() * zoom;
                    var oy = visCity.get_MinYPosition() * zoom;

                    var minR = Infinity, maxR = -Infinity;
                    for (var i = 0; i < tiles.length; i++) {
                        if (tiles[i].ratio < minR) minR = tiles[i].ratio;
                        if (tiles[i].ratio > maxR) maxR = tiles[i].ratio;
                    }
                    var delta = maxR - minR;

                    overlay = new qx.ui.container.Composite(new qx.ui.layout.Canvas()).set({
                        width: mainOverlay.getWidth(),
                        height: mainOverlay.getHeight(),
                        allowGrowX: true, allowGrowY: true
                    });
                    overlay.setThemedBackgroundColor("#00000080");

                    for (var t = 0; t < tiles.length; t++) {
                        var tile = tiles[t];
                        // 0..15 step on a red->green ramp. With only one tile, default to full green.
                        var rel = (delta > 0) ? ((tile.ratio - minR) / delta) : 1;
                        var step = Math.round(rel * 15);
                        var red = (15 - step).toString(16);
                        var grn = step.toString(16);
                        var box = new qx.ui.container.Composite(new qx.ui.layout.HBox()).set({
                            decorator: new qx.ui.decoration.Decorator(1, "solid", "#000000").set({ backgroundColor: "#" + red + grn + "0" }),
                            opacity: 0.55,
                            width: Math.max(1, tw - 2),
                            height: Math.max(1, th - 2)
                        });
                        box.setAlignX && box.setAlignX("center");
                        box.setAlignY && box.setAlignY("middle");
                        box.add(new qx.ui.basic.Label(tile.ratio.toFixed(6)).set({
                            allowGrowX: false, allowGrowY: false,
                            textColor: "black", font: "font_size_16_bold"
                        }));
                        overlay.add(box, {
                            left: (tile.posX * tw) - ox + Math.round(5 * zoom),
                            top:  (tile.posY * th) - oy + Math.round(10 * zoom)
                        });
                    }

                    app.getDesktop().add(overlay, { left: bounds.left, top: bounds.top });
                    isOpen = true;
                    wlog("upgrade overlay open: " + tiles.length + " tiles, ratio range " + minR.toFixed(4) + ".." + maxR.toFixed(4));
                } catch (e) { werr("openOverlay failed:", e); try { closeOverlay(); } catch (e2) {} }
            }

            function closeOverlay() {
                if (!isOpen) return;
                try { qx.core.Init.getApplication().getDesktop().remove(overlay); } catch (e) {}
                overlay = null;
                isOpen = false;
            }

            function inOwnBaseView() {
                try {
                    if (ClientLib.Vis.VisMain.GetInstance().get_Mode() !== ClientLib.Vis.Mode.City) return false;
                    var ownCity = ClientLib.Data.MainData.GetInstance().get_Cities().get_CurrentOwnCity();
                    var curCity = ClientLib.Data.MainData.GetInstance().get_Cities().get_CurrentCity();
                    return !!(ownCity && curCity && ownCity.get_Id() === curCity.get_Id());
                } catch (e) { return false; }
            }

            function onKeyDown(e) {
                if (!MM.settings.get("BaseTools.UpgradeOverlay", true)) return;
                if (!e.ctrlKey) return;
                if (isOpen) return;
                if (!inOwnBaseView()) return;
                openOverlay();
            }
            function onKeyUp(e) {
                if (!isOpen) return;
                if (!e.ctrlKey) closeOverlay();
            }
            function onBlur() { if (isOpen) closeOverlay(); }

            document.addEventListener("keydown", onKeyDown, true);
            document.addEventListener("keyup", onKeyUp, true);
            window.addEventListener("blur", onBlur, true);

            return {
                destroy: function () {
                    try { document.removeEventListener("keydown", onKeyDown, true); } catch (e) {}
                    try { document.removeEventListener("keyup", onKeyUp, true); } catch (e) {}
                    try { window.removeEventListener("blur", onBlur, true); } catch (e) {}
                    closeOverlay();
                }
            };
        }

        // ===== Upgrade Priority engine (faithful port of HuffyTools.UpgradePriority) ====
        // The original lived as a per-resource-tab table. Here it's one flat
        // candidate list across all bases AND all resource types, so the UI can show a single
        // sortable table (the "Option B" design). The math is preserved verbatim from the
        // original getPrioList(); the only behavior FIX is the cross-base transfer-affordability
        // check, which was effectively dead in the original (its TotalTiberium always read 0).

        // Total of a resource across every LIVE own base (used for "affordable if you transfer" check).
        // Destroyed/ghosted bases are excluded - their residual resources can't actually be sent.
        function totalResourceAcrossBases(ert) {
            var sum = 0;
            eachOwnCity(function (c) { try { if (c.get_IsGhostMode && c.get_IsGhostMode()) return; sum += c.GetResourceCount(ert); } catch (e) {} });
            return sum;
        }

        // Per-city production total (delta + package bonus + POI) keyed by EResourceType.
        function cityProdByRes(city) {
            var ERT = ClientLib.Base.EResourceType;
            var R = ClientLib.Base.Resource;
            var alliance = ClientLib.Data.MainData.GetInstance().get_Alliance();
            function tot(ert) {
                try {
                    return city.GetResourceGrowPerHour(ert, false, false)
                         + city.GetResourceBonusGrowPerHour(ert)
                         + (alliance ? alliance.GetPOIBonusFromResourceType(ert) : 0);
                } catch (e) { return 0; }
            }
            var credProd = city.get_CityCreditsProduction ? city.get_CityCreditsProduction() : null;
            var gold = 0;
            try { if (credProd) gold = R.GetResourceGrowPerHour(credProd, false) + R.GetResourceBonusGrowPerHour(credProd, false); } catch (e) {}
            var m = {};
            m[ERT.Tiberium] = tot(ERT.Tiberium);
            m[ERT.Crystal] = tot(ERT.Crystal);
            m[ERT.Power] = tot(ERT.Power);
            m[ERT.Gold] = gold;
            return m;
        }

        function techDisplayName(iTechType) {
            var ETN = ClientLib.Base.ETechName;
            switch (parseInt(iTechType, 10)) {
                case ETN.PowerPlant: return "Powerplant";
                case ETN.Refinery: return "Refinery";
                case ETN.Harvester_Crystal: return "Harvester";
                case ETN.Harvester: return "Harvester";
                case ETN.Silo: return "Silo";
                case ETN.Accumulator: return "Accumulator";
            }
            return "?";
        }

        // The four resource "buckets" the original queried, each with its building tech types and
        // the package-size / production modifier types that drive the gain calc. A single building
        // is evaluated in every bucket whose tech list includes it; the bucket only keeps it if the
        // upgrade actually produces gain for that resource (so a tiberium harvester lands in Tib,
        // a crystal harvester in Cry, etc).
        function upgradeBuckets() {
            var ERT = ClientLib.Base.EResourceType;
            var EMod = ClientLib.Base.EModifierType;
            var ETN = ClientLib.Base.ETechName;
            return [
                { res: "Tib", label: "Tiberium", ert: ERT.Tiberium, techs: [ETN.Harvester, ETN.Silo], modPkg: EMod.TiberiumPackageSize, modProd: EMod.TiberiumProduction },
                { res: "Cry", label: "Crystal",  ert: ERT.Crystal,  techs: [ETN.Harvester, ETN.Silo], modPkg: EMod.CrystalPackageSize,  modProd: EMod.CrystalProduction },
                { res: "Pow", label: "Power",    ert: ERT.Power,    techs: [ETN.PowerPlant, ETN.Accumulator], modPkg: EMod.PowerPackageSize, modProd: EMod.PowerProduction },
                { res: "Dol", label: "Credits",  ert: ERT.Gold,     techs: [ETN.Refinery, ETN.PowerPlant], modPkg: EMod.CreditsPackageSize, modProd: EMod.CreditsProduction }
            ];
        }

        // Evaluate one building in one bucket. Returns a candidate object or null.
        function evalBuilding(city, building, bucket, prodByRes, totalTib, maxLevelWorld) {
            try {
                if ((building.get_CurrentLevel() + 1) > maxLevelWorld) return null;
                var techName = building.get_TechName();
                var inBucket = false;
                for (var t = 0; t < bucket.techs.length; t++) { if (bucket.techs[t] == techName) { inBucket = true; break; } }
                if (!inBucket) return null;

                var detail = city.GetBuildingDetailViewInfo(building);
                if (!detail) return null;

                // ---- gain per hour from the upgrade (verbatim math from getPrioList) ----
                var gain = 0;
                var mods = detail.OwnProdModifiers.d;
                var mainMod = mods[building.get_MainModifierTypeId()];
                for (var mt in mods) {
                    var mti = parseInt(mt, 10);
                    if (mti === bucket.modPkg) {
                        if (!mainMod || !mainMod.TotalValue) continue;
                        var prevProdH = (3600 / mainMod.TotalValue) * mods[mt].TotalValue;
                        var newProdH = (3600 / (mainMod.TotalValue + mainMod.NewLvlDelta)) * (mods[mt].NewLvlDelta + mods[mt].TotalValue);
                        gain += newProdH - prevProdH;
                    } else if (mti === bucket.modProd) {
                        gain += mods[mt].NewLvlDelta;
                    }
                }
                if (!(gain > 0)) return null;

                // ---- costs, payoff "ticks", affordability, ETA (verbatim math) ----
                var ERT = ClientLib.Base.EResourceType;
                var techLevelData = ClientLib.Base.Util.GetTechLevelResourceRequirements_Obj(building.get_CurrentLevel() + 1, building.get_TechGameData_Obj());
                var costs = {}, ticks = 0, eta = 0;
                var hasTib = true, hasPow = true, affordByTransfer = true;
                for (var ct in techLevelData) {
                    var entry = techLevelData[ct];
                    if (typeof entry === "function") continue;
                    if (entry.Type == "0" || entry.Type === 0) continue;
                    costs[entry.Type] = entry.Count;
                    if (parseInt(entry.Count) <= 0) continue;
                    var ratio = entry.Count / gain;
                    var have = city.GetResourceCount(entry.Type);
                    if (have < entry.Count) {
                        if (entry.Type === ERT.Tiberium) { hasTib = false; if (totalTib < entry.Count) affordByTransfer = false; }
                        else if (entry.Type === ERT.Power) { hasPow = false; }
                    }
                    var prod = prodByRes[entry.Type] || 0;
                    if (prod > 0) {
                        var payoff = 3600 * ratio / prod;
                        if (ticks < payoff) ticks = payoff;
                        if (entry.Count > have) {
                            var till = 3600 * (entry.Count - have) / prod;
                            if (till > eta) eta = till;
                        }
                    }
                }

                var affordable = hasTib && hasPow;
                var affordableByTransfer = hasPow && affordByTransfer;
                var state = affordable ? 1 : (affordableByTransfer ? 2 : 3);

                return {
                    id: building.get_Id(),
                    buildingArg: { cityid: city.get_Id(), posX: building.get_CoordX(), posY: building.get_CoordY(), isPaid: true },
                    cityName: city.get_Name(),
                    cityId: city.get_Id(),
                    res: bucket.res,
                    resLabel: bucket.label,
                    typeName: techDisplayName(techName),
                    posX: building.get_CoordX(),
                    posY: building.get_CoordY(),
                    targetLevel: building.get_CurrentLevel() + 1,
                    gainPerHour: gain,
                    ticks: ticks,
                    costTib: costs[ERT.Tiberium] || 0,
                    costPow: costs[ERT.Power] || 0,
                    tibPerGain: (costs[ERT.Tiberium] || 0) / gain,
                    powPerGain: (costs[ERT.Power] || 0) / gain,
                    etaSeconds: eta,
                    affordable: affordable,
                    affordableByTransfer: affordableByTransfer,
                    state: state
                };
            } catch (e) { werr("evalBuilding failed:", e); return null; }
        }

        // Build the full candidate list across every base and bucket.
        function computeUpgradeCandidates(opts) {
            opts = opts || {};
            var out = [];
            try {
                var ERT = ClientLib.Base.EResourceType;
                var maxLevelWorld = ClientLib.Data.MainData.GetInstance().get_Server().get_PlayerUpgradeCap();
                var totalTib = totalResourceAcrossBases(ERT.Tiberium);
                var buckets = upgradeBuckets();
                var credits = playerCredits();
                eachOwnCity(function (city) {
                    // Skip destroyed/ghosted bases - you can't upgrade anything on them.
                    if (city.get_IsGhostMode && city.get_IsGhostMode()) return;
                    var prodByRes = cityProdByRes(city);
                    var buildings = [];
                    try { var bd = city.get_Buildings().d; for (var o in bd) buildings.push(bd[o]); } catch (e) { werr("get_Buildings failed:", e); }
                    for (var b = 0; b < buildings.length; b++) {
                        for (var k = 0; k < buckets.length; k++) {
                            var cand = evalBuilding(city, buildings[b], buckets[k], prodByRes, totalTib, maxLevelWorld);
                            if (!cand) continue;
                            // For "affordable by transfer" candidates, work out the actual transfer plan +
                            // credit fee now, and only keep it QUALIFIED if the player can pay that fee.
                            if (cand.state === 2) {
                                var pl = planTransfer(cand);
                                cand.transferCost = pl.feasible ? pl.totalCost : null;
                                cand.transferQualified = pl.feasible && credits >= pl.totalCost;
                            } else {
                                cand.transferCost = null;
                                cand.transferQualified = false;
                            }
                            if (opts.showAll || cand.affordable) out.push(cand);
                        }
                    }
                });
            } catch (e) { werr("computeUpgradeCandidates failed:", e); }
            return out;
        }

        function getCityById(id) {
            try { return ClientLib.Data.MainData.GetInstance().get_Cities().GetCity(id); } catch (e) { return null; }
        }

        // Live current level of a candidate's building (by id), or null if not found.
        function currentBuildingLevel(cand) {
            try {
                var city = getCityById(cand.cityId);
                if (!city) return null;
                var bd = city.get_Buildings().d;
                for (var o in bd) { if (bd[o] && bd[o].get_Id && bd[o].get_Id() === cand.id) return bd[o].get_CurrentLevel(); }
            } catch (e) {}
            return null;
        }

        // Send the UpgradeBuilding command, then confirm success by EFFECT - i.e. watch the building's
        // level actually reach the target. The command's result code is NOT a reliable success signal
        // (the original tool ignored it entirely), so verifying by effect is what lets us show
        // an honest "✓ Upgraded" vs "✗ failed".
        function sendUpgrade(cand, onDone) {
            try {
                ClientLib.Net.CommunicationManager.GetInstance().SendCommand(
                    "UpgradeBuilding", cand.buildingArg,
                    webfrontend.phe.cnc.Util.createEventDelegate(ClientLib.Net.CommandResult, {}, function () {}),
                    null, true);
            } catch (e) { werr("sendUpgrade failed:", e); if (onDone) onDone(false); return; }
            var tries = 0;
            (function check() {
                tries++;
                var lvl = currentBuildingLevel(cand);
                if (lvl != null && lvl >= cand.targetLevel) { if (onDone) onDone(true); return; }
                if (tries >= 8) { wwarn("upgrade not confirmed (building stayed at level " + lvl + ", wanted " + cand.targetLevel + ")"); if (onDone) onDone(false); return; }
                window.setTimeout(check, 500);
            })();
        }

        function playerCredits() {
            try { return ClientLib.Data.MainData.GetInstance().get_Player().GetCreditsCount(); } catch (e) { return 0; }
        }

        // Work out HOW to cover a candidate's Tiberium shortfall by transfer, and what it costs in
        // credits. Only Tiberium is tradeable here: state-2 ("affordable by transfer") already
        // guarantees Power is sufficient locally, and Power/Credits can't be transferred anyway.
        // Sources are chosen CHEAPEST-credit-cost first (cost is distance-based, so the nearest bases
        // are picked before far ones), pulling only as much as needed. Returns:
        //   { feasible, plan:[{source, amount, cost}], totalCost, need }
        // feasible=false means the shortfall can't be covered by tiberium across the (tradeable) bases.
        function planTransfer(cand) {
            try {
                var ERT = ClientLib.Base.EResourceType;
                var ETradeNone = ClientLib.Data.ETradeError.None;
                var target = getCityById(cand.cityId);
                if (!target) return { feasible: false };
                if (target.CanTrade && target.CanTrade() !== ETradeNone) return { feasible: false };
                var need = Math.ceil(cand.costTib - target.GetResourceCount(ERT.Tiberium));
                if (need <= 0) return { feasible: true, plan: [], totalCost: 0, need: 0 };
                var tx = target.get_PosX(), ty = target.get_PosY();

                var sources = [];
                eachOwnCity(function (c) {
                    if (c.get_Id() === cand.cityId) return;
                    if (c.get_IsGhostMode && c.get_IsGhostMode()) return; // killed base: can't send its resources
                    if (c.CanTrade && c.CanTrade() !== ETradeNone) return;
                    var have = Math.floor(c.GetResourceCount(ERT.Tiberium));
                    if (have <= 0) return;
                    var perUnit = Infinity;
                    try { var cf = c.CalculateTradeCostToCoord(tx, ty, have); if (have > 0) perUnit = cf / have; } catch (e) {}
                    sources.push({ city: c, have: have, perUnit: perUnit });
                });
                sources.sort(function (a, b) { return a.perUnit - b.perUnit; }); // cheapest per-unit first

                var plan = [], remaining = need, totalCost = 0;
                for (var i = 0; i < sources.length && remaining > 0; i++) {
                    var amt = Math.min(sources[i].have, remaining);
                    if (amt <= 0) continue;
                    var cost = 0;
                    try { cost = sources[i].city.CalculateTradeCostToCoord(tx, ty, amt); } catch (e) {}
                    plan.push({ source: sources[i].city, amount: amt, cost: cost });
                    totalCost += cost;
                    remaining -= amt;
                }
                if (remaining > 0) return { feasible: false };
                return { feasible: true, plan: plan, totalCost: totalCost, need: need };
            } catch (e) { werr("planTransfer failed:", e); return { feasible: false }; }
        }

        // Execute the (re-planned, live) transfers, then upgrade. Re-plans at click time so the amounts
        // reflect current resources rather than the snapshot shown in the table.
        function autoTransferAndUpgrade(cand, onDone) {
            try {
                var pl = planTransfer(cand);
                if (!pl.feasible) { wwarn("autoTransfer: no feasible plan at execution time"); if (onDone) onDone(false); return; }
                if (playerCredits() < pl.totalCost) { wwarn("autoTransfer: not enough credits for the transfer fee"); if (onDone) onDone(false); return; }
                if (!pl.plan.length) { sendUpgrade(cand, onDone); return; }
                var ERT = ClientLib.Base.EResourceType;
                wlog("autoTransfer:", pl.need, "tiberium to", cand.cityName, "in", pl.plan.length, "transfer(s), fee", pl.totalCost);
                var idx = 0;
                function nextTransfer() {
                    if (idx >= pl.plan.length) { waitThenUpgrade(); return; }
                    var p = pl.plan[idx++];
                    try {
                        ClientLib.Net.CommunicationManager.GetInstance().SendCommand("SelfTrade", {
                            targetCityId: cand.cityId,
                            sourceCityId: p.source.get_Id(),
                            resourceType: ERT.Tiberium,
                            amount: p.amount
                        // Don't trust the result code here either - just pace the transfers and then
                        // confirm by EFFECT that the tiberium arrived before upgrading.
                        }, webfrontend.phe.cnc.Util.createEventDelegate(ClientLib.Net.CommandResult, {}, function () {
                            window.setTimeout(nextTransfer, 200);
                        }), null, true);
                    } catch (e) { werr("SelfTrade failed:", e); if (onDone) onDone(false); }
                }
                // Transfers are async; wait until the target actually has enough tiberium, THEN upgrade.
                function waitThenUpgrade() {
                    var tries = 0;
                    (function poll() {
                        tries++;
                        var t = getCityById(cand.cityId);
                        var have = t ? t.GetResourceCount(ERT.Tiberium) : 0;
                        if (have >= cand.costTib) { sendUpgrade(cand, onDone); return; }
                        if (tries >= 12) { wwarn("autoTransfer: tiberium didn't arrive in time (have " + Math.floor(have) + " / need " + cand.costTib + ")"); if (onDone) onDone(false); return; }
                        window.setTimeout(poll, 500);
                    })();
                }
                nextTransfer();
            } catch (e) { werr("autoTransferAndUpgrade failed:", e); if (onDone) onDone(false); }
        }

        function fmtTime(sec) {
            try { return ClientLib.Vis.VisMain.FormatTimespan(sec); } catch (e) { return window.MMCommon.time.dhms(sec); }
        }

        // ===== Layout Optimizer engine (Phase A: recommend-only) =====================
        // Live-verified production model (see the base-layout-bonus-model memory):
        //   production_R(building) = Σ over its link types of  perConn × min(adjCount, maxConn)
        //   There is NO separate flat base term (proven: per-modifier sum-of-link-Values == TotalValue).
        //   Adjacency is the 8-neighborhood (diagonals count). Field tiles count even when occupied.
        // The per-connection magnitudes are CALIBRATED LIVE from the game's own
        // GetBuildingDetailViewInfo link Values, so the optimizer stays correct across game updates
        // instead of relying on hard-coded (era-stale) tables.
        var OPT = (function () {
            var GRID_W = 9, GRID_H = 8;

            // Production modifier ids (from OwnProdModifiers): the four resources we optimize.
            var MOD = { Tib: 1, Cry: 4, Pow: 6, Dol: 30 };

            // What each link type's "neighbor" is. kind 'b' = adjacent building of a tech (optionally a
            // specific harvester resource); kind 't' = adjacent terrain field tile of a type.
            // Verified link ids: 34/35 silo→harv, 39/40 harv→silo, 29 accum→pp, 38 crystalField→pp,
            // 41 pp→accum, 36 pp→refinery, 37 tibField→refinery, 42 refinery→pp.
            var LINK = {
                34: { kind: "b", tech: "Silo" },
                35: { kind: "b", tech: "Silo" },
                39: { kind: "b", tech: "Harvester", res: "Tib" },
                40: { kind: "b", tech: "Harvester", res: "Cry" },
                29: { kind: "b", tech: "Accumulator" },
                41: { kind: "b", tech: "PowerPlant" },
                36: { kind: "b", tech: "PowerPlant" },
                42: { kind: "b", tech: "Refinery" },
                38: { kind: "t", terr: "CRYSTAL" },
                37: { kind: "t", terr: "TIBERIUM" }
            };

            // Which buildings each resource button is allowed to move. Everything else is a fixed
            // obstacle - this keeps each single-resource optimize from wrecking the other resources and
            // shrinks the search space. (Silos are shared by Tib/Cry; PowerPlants by Pow/Dol - inherent
            // contention, accepted for single-objective optimize.)
            var RES_CFG = {
                Tib: { mod: MOD.Tib, label: "Tiberium", movable: function (b) { return (b.techName === "Harvester" && b.harvRes === "Tib") || b.techName === "Silo"; } },
                Cry: { mod: MOD.Cry, label: "Crystal",  movable: function (b) { return (b.techName === "Harvester" && b.harvRes === "Cry") || b.techName === "Silo"; } },
                Pow: { mod: MOD.Pow, label: "Power",    movable: function (b) { return b.techName === "PowerPlant" || b.techName === "Accumulator"; } },
                Dol: { mod: MOD.Dol, label: "Credits",  movable: function (b) { return b.techName === "Refinery" || b.techName === "PowerPlant"; } }
            };

            // ETechName -> name string (reverse map), computed once and cached.
            var _techRev = null;
            function techRev() {
                if (_techRev) return _techRev;
                _techRev = {};
                try { var T = ClientLib.Base.ETechName; for (var n in T) { if (typeof T[n] === "number") _techRev[T[n]] = n; } } catch (e) { werr("OPT.techRev failed:", e); }
                return _techRev;
            }

            // Terrain enum name map + buildable/field helpers.
            var _terrRev = null;
            function terrRev() {
                if (_terrRev) return _terrRev;
                _terrRev = {};
                try { var T = ClientLib.Data.ECityTerrainType; for (var n in T) { if (typeof T[n] === "number") _terrRev[T[n]] = n; } } catch (e) { werr("OPT.terrRev failed:", e); }
                return _terrRev;
            }

            // Locate the (obfuscated) terrain getter on a city: the 2-arg method that returns values in
            // the ECityTerrainType range across the grid. Cached per city id. Returns fn(x,y)->name or null.
            var _terrFnCache = {};
            function terrainFn(city) {
                var cid; try { cid = city.get_Id(); } catch (e) { cid = 0; }
                if (_terrFnCache[cid]) return _terrFnCache[cid];
                var rev = terrRev();
                var maxT = 0; for (var k in rev) { var v = +k; if (v > maxT) maxT = v; }
                var found = null;
                // Fast path: the known name from the live sniff.
                try { if (typeof city.TOIMPX === "function" && city.TOIMPX.length === 2) found = city.TOIMPX; } catch (e) {}
                if (!found) {
                    // Fallback: scan for any 2-arg fn returning valid terrain enums (game may have renamed it).
                    for (var p in city) {
                        var f; try { f = city[p]; } catch (e) { continue; }
                        if (typeof f !== "function" || f.length !== 2) continue;
                        var ok = true;
                        try { for (var y = 0; y < 3 && ok; y++) for (var x = 0; x < 3; x++) { var r = f.call(city, x, y); if (typeof r !== "number" || r < 0 || r > maxT || r !== Math.floor(r)) { ok = false; break; } } }
                        catch (e) { ok = false; }
                        if (ok) { found = f; break; }
                    }
                }
                if (!found) { wwarn("OPT: terrain getter not found (game may have updated)"); return null; }
                var wrap = function (x, y) { try { return rev[found.call(city, x, y)] || "NONE"; } catch (e) { return "NONE"; } };
                _terrFnCache[cid] = wrap;
                return wrap;
            }

            function N(v) { var n = Number(v); return isFinite(n) ? n : 0; }
            function inGrid(x, y) { return x >= 0 && x < GRID_W && y >= 0 && y < GRID_H; }

            // Read a full optimization snapshot for a city + chosen resource. Returns null on failure.
            //   { ok, terrain[y][x], buildings:{id->b}, order:[ids], producers:[ids w/ this mod],
            //     movable:[ids], modId, resKey, calibWarn }
            // Each building b: { id, techName, harvRes, x, y, level, links:{modId->[{lt,perConn,max}]} }.
            function snapshot(city, resKey) {
                try {
                    var cfg = RES_CFG[resKey]; if (!cfg) { werr("OPT.snapshot: bad resKey", resKey); return null; }
                    var modId = cfg.mod;
                    var tf = terrainFn(city); if (!tf) return null;
                    var terrain = [];
                    for (var y = 0; y < GRID_H; y++) { var row = []; for (var x = 0; x < GRID_W; x++) row.push(tf(x, y)); terrain.push(row); }

                    var rev = techRev();
                    var bd; try { bd = city.get_Buildings().d; } catch (e) { werr("OPT: get_Buildings failed", e); return null; }
                    var buildings = {}, order = [];
                    var iconByLink = {}; // linkTypeId -> full CDN icon URL (harvested live; auto-handles faction/era)
                    // First pass: read every building + its production-modifier links.
                    for (var o in bd) {
                        var raw = bd[o]; if (!raw || !raw.get_Id) continue;
                        var b = { id: raw.get_Id(), techName: rev[raw.get_TechName()] || String(raw.get_TechName()),
                                  x: raw.get_CoordX(), y: raw.get_CoordY(), level: raw.get_CurrentLevel ? raw.get_CurrentLevel() : 0,
                                  harvRes: null, links: {} };
                        var dv; try { dv = city.GetBuildingDetailViewInfo(raw); } catch (e) { dv = null; }
                        if (dv && dv.OwnProdModifiers && dv.OwnProdModifiers.d) {
                            var mods = dv.OwnProdModifiers.d;
                            for (var mt in mods) {
                                var m = mods[mt]; if (typeof m !== "object") continue;
                                var mid = N(m.ModifierTypeId);
                                if (mid !== MOD.Tib && mid !== MOD.Cry && mid !== MOD.Pow && mid !== MOD.Dol) continue;
                                // Harvester resource = whichever raw-resource modifier it carries.
                                if (b.techName === "Harvester") { if (mid === MOD.Tib) b.harvRes = "Tib"; else if (mid === MOD.Cry) b.harvRes = "Cry"; }
                                var arr = [];
                                if (m.ConnectedLinkTypes && m.ConnectedLinkTypes.d) {
                                    var C = m.ConnectedLinkTypes.d;
                                    for (var lt in C) {
                                        var l = C[lt]; if (typeof l !== "object") continue;
                                        var ltid = N(l.LQJDCI), conns = N(l.NrOfLinkConnections), val = N(l.Value), max = N(l.MaxConnections);
                                        if (l.IconPath && iconByLink[ltid] == null) iconByLink[ltid] = l.IconPath; // building/field icon URL
                                        // perConn is only trustworthy when the link is ACTUALLY active. The
                                        // game sometimes reports NrOfLinkConnections > 0 with Value=0 and
                                        // IsConnected=false (e.g. a silo's link to crystal harvesters when
                                        // no harvester is actually adjacent yet) - treat those as null so
                                        // the calibration block fills them in from a connected sibling.
                                        var activeConn = (conns > 0 && val > 0);
                                        arr.push({ lt: ltid, max: max, conns: conns, value: val, perConn: activeConn ? (val / conns) : null });
                                    }
                                }
                                b.links[mid] = arr;
                            }
                        }
                        buildings[b.id] = b; order.push(b.id);
                    }

                    // Second pass: calibrate per-connection magnitude for links that currently have 0
                    // connections (Value 0). Three fallbacks, in order:
                    //   (1) same (tech, level, linkType) sibling that has connections - exact match.
                    //   (2) same (tech, linkType) ANY level - closest level wins. Scaled by an inferred
                    //       level-growth factor when we have 2+ data points (perConn grows ~r^level for
                    //       silos, harvesters, etc.); unscaled fallback when we only have one point.
                    //   (3) give up: perConn = 0. (Building's link contribution silently zero.)
                    //
                    // Why this matters: if a base has e.g. ONE lvl-21 silo and it's currently NOT adjacent
                    // to any crystal harvesters, MOD.Cry link perConn=null at snapshot time. The original
                    // calibration only matched same-LEVEL siblings; with none, perConn defaulted to 0 and
                    // the silo became invisible to the optimizer for swaps - it couldn't see that moving
                    // the silo near crystal harvesters would help. Cross-level calibration fixes this.
                    var sib = {};       // tech|level|lt -> perConn (per-level same-tech siblings, exact match)
                    var sibAny = {};    // tech|lt -> [{level, perConn}, ...] (cross-level siblings sorted later)
                    for (var i = 0; i < order.length; i++) { var bb = buildings[order[i]];
                        for (var mk in bb.links) { var ls = bb.links[mk];
                            for (var j = 0; j < ls.length; j++) {
                                if (ls[j].perConn != null) {
                                    var key = bb.techName + "|" + bb.level + "|" + ls[j].lt;
                                    if (sib[key] == null) sib[key] = ls[j].perConn;
                                    var akey = bb.techName + "|" + ls[j].lt;
                                    (sibAny[akey] = sibAny[akey] || []).push({ level: bb.level, perConn: ls[j].perConn });
                                }
                            }
                        }
                    }
                    // Per-(tech, linkType) growth factor: if we have 2+ samples at different levels,
                    // infer r so perConn(level) ~ perConn(L0) * r^(level - L0). For 1 sample, r=1 (use as-is).
                    function inferGrowth(samples) {
                        if (!samples || samples.length < 2) return 1;
                        var a = samples[0], b = samples[samples.length - 1];
                        for (var k = 1; k < samples.length; k++) {
                            if (samples[k].level > b.level) b = samples[k];
                            if (samples[k].level < a.level) a = samples[k];
                        }
                        if (a.level === b.level || a.perConn <= 0 || b.perConn <= 0) return 1;
                        var r = Math.pow(b.perConn / a.perConn, 1 / (b.level - a.level));
                        // sanity-bound (silos / harvesters grow ~25%/level; reject obvious garbage)
                        if (!isFinite(r) || r < 0.5 || r > 2.5) return 1;
                        return r;
                    }
                    function calibrateAcrossLevels(tech, level, lt) {
                        var akey = tech + "|" + lt;
                        var samples = sibAny[akey];
                        if (!samples || !samples.length) return null;
                        // Find closest level sample.
                        var best = samples[0];
                        for (var k = 1; k < samples.length; k++) {
                            if (Math.abs(samples[k].level - level) < Math.abs(best.level - level)) best = samples[k];
                        }
                        var r = inferGrowth(samples);
                        return best.perConn * Math.pow(r, level - best.level);
                    }
                    var calibWarn = 0, calibCross = 0;
                    for (var i2 = 0; i2 < order.length; i2++) { var b2 = buildings[order[i2]];
                        for (var mk2 in b2.links) { var ls2 = b2.links[mk2];
                            for (var j2 = 0; j2 < ls2.length; j2++) {
                                if (ls2[j2].perConn == null) {
                                    var key2 = b2.techName + "|" + b2.level + "|" + ls2[j2].lt;
                                    if (sib[key2] != null) { ls2[j2].perConn = sib[key2]; continue; }
                                    var cross = calibrateAcrossLevels(b2.techName, b2.level, ls2[j2].lt);
                                    if (cross != null && cross > 0) { ls2[j2].perConn = cross; calibCross++; continue; }
                                    ls2[j2].perConn = 0; calibWarn++;
                                }
                            }
                        }
                    }
                    if (calibCross) wlog("OPT: calibrated " + calibCross + " link(s) via cross-level fallback (no same-level sibling existed)");
                    if (calibWarn) wwarn("OPT: " + calibWarn + " link(s) could not be calibrated (no connected sibling at any level) - excluded from scoring");

                    // Classify producers (have this mod) and movable buildings (this resource's set).
                    var producers = [], movable = [];
                    for (var i3 = 0; i3 < order.length; i3++) { var b3 = buildings[order[i3]];
                        if (b3.links[modId]) producers.push(b3.id);
                        if (cfg.movable(b3)) movable.push(b3.id);
                    }
                    // Map harvested link icons to a tech -> URL table the UI can draw on tiles.
                    var icons = { Silo: iconByLink[34] || iconByLink[35] || null, Accumulator: iconByLink[29] || null,
                                  PowerPlant: iconByLink[36] || iconByLink[41] || null, Refinery: iconByLink[42] || null,
                                  HarvTib: iconByLink[39] || null, HarvCry: iconByLink[40] || null };
                    return { ok: true, terrain: terrain, buildings: buildings, order: order, producers: producers, movable: movable, modId: modId, resKey: resKey, calibWarn: calibWarn, icons: icons };
                } catch (e) { werr("OPT.snapshot failed:", e); return null; }
            }

            // ----- scoring (pure; operates on a positions map, no game calls) ----------
            // pos: { id -> {x,y} }. `removed` (optional {id:true}) = demolished buildings: excluded from
            // the occupancy grid (their tiles free up) and never scored. Build an occupancy grid, then sum
            // each producer's resource output = Σ links perConn × min(adjCount, max).
            function buildOcc(snap, pos, removed) {
                var g = []; for (var y = 0; y < GRID_H; y++) { g.push([]); for (var x = 0; x < GRID_W; x++) g[y].push(null); }
                for (var i = 0; i < snap.order.length; i++) { var id = snap.order[i]; if (removed && removed[id]) continue; var p = pos[id]; if (p && inGrid(p.x, p.y)) g[p.y][p.x] = snap.buildings[id]; }
                return g;
            }
            function countLink(snap, g, x, y, def) {
                var c = 0;
                for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
                    if (!dx && !dy) continue; var nx = x + dx, ny = y + dy; if (!inGrid(nx, ny)) continue;
                    if (def.kind === "t") { if (snap.terrain[ny][nx] === def.terr) c++; }
                    else { var nb = g[ny][nx]; if (nb && nb.techName === def.tech && (!def.res || nb.harvRes === def.res)) c++; }
                }
                return c;
            }
            // Score a layout for resource modId over the producer id list `prod` (caller supplies the list
            // so sell-scenarios can drop demolished producers).
            function score(snap, pos, prod, removed) {
                var g = buildOcc(snap, pos, removed), total = 0, modId = snap.modId;
                prod = prod || snap.producers;
                for (var i = 0; i < prod.length; i++) {
                    var b = snap.buildings[prod[i]]; if (removed && removed[b.id]) continue; var p = pos[b.id]; if (!p) continue;
                    var ls = b.links[modId]; if (!ls) continue;
                    for (var j = 0; j < ls.length; j++) {
                        var L = ls[j], def = LINK[L.lt]; if (!def || !L.perConn) continue;
                        total += L.perConn * Math.min(countLink(snap, g, p.x, p.y, def), L.max);
                    }
                }
                return total;
            }

            // ---- ALLOW REDUCTIONS support: per-resource scoring + multi-resource compound score ----
            // The default search above only ever measures the TARGET resource and only moves buildings in
            // that resource's set, so a layout that helps Crystal at the cost of Tiberium can never even be
            // tried (and inversely a swap that would help Crystal but requires moving a Refinery out of the
            // way is invisible to the Crystal optimizer). When "allow reductions" is on the search widens
            // the movable set to ALL resource buildings and switches to a compound score that lets us trade
            // small losses in non-target resources for a larger target gain.

            // Producer ids that have a link in modId. Cached lookup of snap.buildings.
            function producersForMod(snap, modId) {
                var out = [];
                for (var i = 0; i < snap.order.length; i++) {
                    var b = snap.buildings[snap.order[i]];
                    if (b.links[modId]) out.push(b.id);
                }
                return out;
            }
            // Score ONE resource (modId) over its producer list. Same formula as score(), but indexed by
            // an explicit modId / producer list rather than snap.modId / snap.producers.
            function scoreForMod(snap, pos, modId, prodList, removed) {
                var g = buildOcc(snap, pos, removed), total = 0;
                var prod = prodList || producersForMod(snap, modId);
                for (var i = 0; i < prod.length; i++) {
                    var b = snap.buildings[prod[i]]; if (removed && removed[b.id]) continue;
                    var p = pos[b.id]; if (!p) continue;
                    var ls = b.links[modId]; if (!ls) continue;
                    for (var j = 0; j < ls.length; j++) {
                        var L = ls[j], def = LINK[L.lt]; if (!def || !L.perConn) continue;
                        total += L.perConn * Math.min(countLink(snap, g, p.x, p.y, def), L.max);
                    }
                }
                return total;
            }
            // Full {Tib, Cry, Pow, Dol} production for a layout, used for baselines + the final
            // "net change across all 4 resources" report shown in the UI.
            function scoreAll(snap, pos, removed, prodLists) {
                prodLists = prodLists || {};
                return {
                    Tib: scoreForMod(snap, pos, MOD.Tib, prodLists.Tib, removed),
                    Cry: scoreForMod(snap, pos, MOD.Cry, prodLists.Cry, removed),
                    Pow: scoreForMod(snap, pos, MOD.Pow, prodLists.Pow, removed),
                    Dol: scoreForMod(snap, pos, MOD.Dol, prodLists.Dol, removed)
                };
            }
            function buildProdLists(snap) {
                return {
                    Tib: producersForMod(snap, MOD.Tib),
                    Cry: producersForMod(snap, MOD.Cry),
                    Pow: producersForMod(snap, MOD.Pow),
                    Dol: producersForMod(snap, MOD.Dol)
                };
            }
            // The compound score function used when "allow reductions" is on:
            //   targetGain - alpha * sum(max(0, baseline_other - thisOther))
            // alpha defaults to 0.5 (target counts twice as much as non-target losses at the margin), so the
            // optimizer is willing to take a -200 Tib loss for a +101 Crystal gain but NOT a +99 gain.
            function makeMultiScoreFn(snap, targetResKey, baselines, alpha, prodLists) {
                var targetMod = RES_CFG[targetResKey].mod;
                return function (pos, removed) {
                    var target = scoreForMod(snap, pos, targetMod, prodLists[targetResKey], removed);
                    var penalty = 0;
                    for (var k in MOD) {
                        if (MOD[k] === targetMod) continue;
                        var s = scoreForMod(snap, pos, MOD[k], prodLists[k], removed);
                        var loss = baselines[k] - s;
                        if (loss > 0) penalty += loss;
                    }
                    return target - alpha * penalty;
                };
            }
            // Strict mode score: maximise target, but REJECT any layout that drops a non-target resource
            // below its baseline (more than a small tolerance). This honours the user's spec for the
            // default ("OFF" reductions) mode: "only pick layouts that improve whatever you are trying to
            // improve without hurting anything else". A constraint violation returns -Infinity so the
            // hill-climb never picks it (climbStep compares scores; -Inf is always rejected).
            function makeStrictScoreFn(snap, targetResKey, baselines, prodLists) {
                var targetMod = RES_CFG[targetResKey].mod;
                var TOL = 0.5; // ignore sub-1 production rounding noise
                return function (pos, removed) {
                    for (var k in MOD) {
                        if (MOD[k] === targetMod) continue;
                        var s = scoreForMod(snap, pos, MOD[k], prodLists[k], removed);
                        if (s < baselines[k] - TOL) return -Infinity;
                    }
                    return scoreForMod(snap, pos, targetMod, prodLists[targetResKey], removed);
                };
            }
            // Union of all 4 RES_CFG.movable sets - every building eligible for relocation in ANY resource
            // optimizer. Used as the movable list when allowReductions is on.
            function widenMovable(snap) {
                var out = [], seen = {};
                for (var k in RES_CFG) {
                    var pred = RES_CFG[k].movable;
                    for (var i = 0; i < snap.order.length; i++) {
                        var id = snap.order[i];
                        if (seen[id]) continue;
                        if (pred(snap.buildings[id])) { seen[id] = 1; out.push(id); }
                    }
                }
                return out;
            }

            // ----- legality (geometric; the game's IsBuildingFreeToBePlaced validates final moves) -----
            function buildable(terr) { return terr === "NONE" || terr === "CRYSTAL" || terr === "TIBERIUM"; }
            // Can building b occupy (x,y) given occupancy grid g (ignoring b's own current cell)?
            // Terrain rules (verified in-game): Tiberium/Crystal FIELD tiles are HARVESTER-ONLY - a
            // tiberium harvester may sit only on a tiberium tile, a crystal harvester only on a crystal
            // tile, and NO non-harvester building may occupy a field tile. Everything else goes on NONE.
            function terrainOK(snap, b, x, y) {
                var terr = snap.terrain[y][x];
                if (b.techName === "Harvester") {
                    if (b.harvRes === "Cry") return terr === "CRYSTAL";
                    return terr === "TIBERIUM"; // default/Tib harvester
                }
                return terr === "NONE"; // non-harvesters: clear ground only (never on a field tile)
            }
            function legalFor(snap, g, b, x, y) {
                if (!inGrid(x, y)) return false;
                if (!terrainOK(snap, b, x, y)) return false;
                var occ = g[y][x];
                if (occ && occ.id !== b.id) return false; // tile taken by someone else
                return true;
            }
            function legalForSwap(snap, b, x, y) {
                if (!inGrid(x, y)) return false;
                return terrainOK(snap, b, x, y);
            }

            // ----- search: iterated local search (steepest-ascent hill climb + kicks) -----
            // Mirrors the battle-sim optimizer pattern. Pure planning - never moves anything in-game.
            // `mov` = movable id list, `prod` = producer id list, `removed` = demolished set (all caller-supplied
            // so sell-scenarios reuse the same engine).
            function clonePos(pos) { var o = {}; for (var k in pos) o[k] = { x: pos[k].x, y: pos[k].y }; return o; }
            function emptyTiles(snap, g) { var out = []; for (var y = 0; y < GRID_H; y++) for (var x = 0; x < GRID_W; x++) { if (!g[y][x] && buildable(snap.terrain[y][x])) out.push({ x: x, y: y }); } return out; }

            function climbStep(snap, pos, prod, mov, removed, maxN, scoreFn) {
                // Default scoring = target-only (snap.modId). Allow-reductions mode passes a scoreFn that
                // computes target - penalty across all 4 resources.
                var sFn = scoreFn || function (p, rem) { return score(snap, p, prod, rem); };
                var g = buildOcc(snap, pos, removed), base = sFn(pos, removed);
                var bestGain = 1e-6, bestApply = null;
                var empties = emptyTiles(snap, g);
                for (var i = 0; i < mov.length; i++) {
                    var id = mov[i], b = snap.buildings[id]; var tried = 0;
                    for (var e = 0; e < empties.length; e++) {
                        var t = empties[e];
                        if (!legalFor(snap, g, b, t.x, t.y)) continue;
                        if (++tried > maxN) break;
                        var old = pos[id]; pos[id] = { x: t.x, y: t.y };
                        var s = sFn(pos, removed); pos[id] = old;
                        if (s - base > bestGain) { bestGain = s - base; bestApply = { a: id, ax: t.x, ay: t.y }; }
                    }
                }
                for (var a = 0; a < mov.length; a++) for (var c = a + 1; c < mov.length; c++) {
                    var ida = mov[a], idb = mov[c];
                    var pa = pos[ida], pb = pos[idb];
                    if (!legalForSwap(snap, snap.buildings[ida], pb.x, pb.y) || !legalForSwap(snap, snap.buildings[idb], pa.x, pa.y)) continue;
                    pos[ida] = { x: pb.x, y: pb.y }; pos[idb] = { x: pa.x, y: pa.y };
                    var s2 = sFn(pos, removed); pos[ida] = pa; pos[idb] = pb;
                    if (s2 - base > bestGain) { bestGain = s2 - base; bestApply = { swap: true, a: ida, b: idb }; }
                }
                if (!bestApply) return false;
                if (bestApply.swap) { var t1 = pos[bestApply.a], t2 = pos[bestApply.b]; pos[bestApply.a] = { x: t2.x, y: t2.y }; pos[bestApply.b] = { x: t1.x, y: t1.y }; }
                else { pos[bestApply.a] = { x: bestApply.ax, y: bestApply.ay }; }
                return true;
            }
            function kick(snap, pos, mov, removed, rnd) {
                var g = buildOcc(snap, pos, removed), empties = emptyTiles(snap, g);
                if (!empties.length || !mov.length) return;
                var id = mov[Math.floor(rnd() * mov.length)], b = snap.buildings[id];
                for (var tryn = 0; tryn < 12; tryn++) { var t = empties[Math.floor(rnd() * empties.length)]; if (legalFor(snap, g, b, t.x, t.y)) { pos[id] = { x: t.x, y: t.y }; return; } }
            }

            // Lists of producers / movable buildings for the target resource, minus any demolished.
            function filterIds(list, removed) { if (!removed) return list.slice(); var o = []; for (var i = 0; i < list.length; i++) if (!removed[list[i]]) o.push(list[i]); return o; }
            function startPosFor(snap, removed) { var p = {}; for (var i = 0; i < snap.order.length; i++) { var id = snap.order[i]; if (removed && removed[id]) continue; var b = snap.buildings[id]; p[id] = { x: b.x, y: b.y }; } return p; }
            function mkRnd(snap, salt) { var seed = (2166136261 ^ ((snap.order.length + (salt || 0)) * 16777619 >>> 0)) >>> 0; return function () { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) % 100000) / 100000; }; }

            // Core search for a given demolished-set. Returns { startPos, startScore, bestPos, bestScore }.
            // Multi-start: `restarts` independent attempts (each a hill-climb + kick chain from the current
            // layout, with its own RNG stream) and keep the global best - this makes the result robust to
            // seed luck instead of getting stuck in whichever local optimum one chain happens to hit.
            function runSearch(snap, removed, opts, salt) {
                var rounds = opts.rounds || 30, kicks = opts.kicks || 3, maxN = opts.maxNeighbors || 16, restarts = opts.restarts || 1;
                var prod = filterIds(snap.producers, removed);
                // Allow-reductions mode supplies opts.movableList (the widened union of all-resource
                // movables) and opts.scoreFn (compound target-vs-penalty). Defaults match the original
                // single-resource search.
                var mov = filterIds(opts.movableList || snap.movable, removed);
                var startPos = startPosFor(snap, removed);
                var scoreFn = opts.scoreFn || function (pos, rem) { return score(snap, pos, prod, rem); };
                var startScore = scoreFn(startPos, removed);
                var best = clonePos(startPos), bestScore = startScore;
                for (var r = 0; r < restarts; r++) {
                    var rnd = mkRnd(snap, (salt || 0) * 131 + r * 977 + 1);
                    var work = clonePos(startPos);
                    for (var k = 0; k <= kicks; k++) {
                        var guard = 0;
                        while (climbStep(snap, work, prod, mov, removed, maxN, scoreFn) && guard++ < rounds) {}
                        var ws = scoreFn(work, removed);
                        if (ws > bestScore) { bestScore = ws; best = clonePos(work); }
                        work = clonePos(best);
                        if (k < kicks) kick(snap, work, mov, removed, rnd);
                    }
                }
                return { startPos: startPos, startScore: startScore, bestPos: best, bestScore: bestScore };
            }

            // Build the move list (buildings that actually moved) given start + best positions over `mov`.
            // movableList override is used by allowReductions mode where the search ranged over a wider
            // building set than snap.movable.
            function diffMoves(snap, startPos, bestPos, removed, movableList) {
                var moves = [], mov = filterIds(movableList || snap.movable, removed);
                for (var m = 0; m < mov.length; m++) {
                    var id = mov[m], a = startPos[id], bp = bestPos[id]; if (!a || !bp) continue;
                    if (a.x !== bp.x || a.y !== bp.y) { var bb = snap.buildings[id]; moves.push({ id: id, techName: bb.techName, harvRes: bb.harvRes, level: bb.level, fromX: a.x, fromY: a.y, toX: bp.x, toY: bp.y }); }
                }
                return moves;
            }

            // Run the optimizer for a city + resource (no selling). Returns the standard result object.
            // opts.allowReductions = true:
            //   - movable set widens to ALL resource buildings (union of every RES_CFG.movable)
            //   - scoring switches to "target - alpha * sum_other_losses" so the optimizer can trade
            //     small non-target losses for a larger target gain (alpha default 0.5)
            //   - result includes startProd / bestProd: full {Tib, Cry, Pow, Dol} production at start
            //     and projected, so the UI can show the user exactly what they're trading
            function optimize(city, resKey, opts) {
                opts = opts || {};
                var snap = snapshot(city, resKey);
                if (!snap || !snap.ok) return { ok: false, reason: "could not read base layout" };

                var allowReductions = !!opts.allowReductions;
                var alpha = (typeof opts.alpha === "number") ? opts.alpha : 0.5;
                var prodLists = buildProdLists(snap);
                var startPos0 = startPosFor(snap, null);
                var baselines = scoreAll(snap, startPos0, null, prodLists);

                // Both modes widen the movable set to ALL resource buildings now - strict mode just
                // uses the no-harm constraint to reject layouts that hurt non-target resources, so
                // widening lets swaps with refineries / power plants be tried (the constraint filters
                // out harmful ones). This is what makes the silo<->refinery-in-the-way scenario visible
                // to strict mode in the first place.
                var searchOpts = { rounds: opts.rounds, kicks: opts.kicks, maxNeighbors: opts.maxNeighbors, restarts: 5 };
                searchOpts.movableList = widenMovable(snap);
                if (allowReductions) {
                    searchOpts.scoreFn = makeMultiScoreFn(snap, resKey, baselines, alpha, prodLists);
                } else {
                    searchOpts.scoreFn = makeStrictScoreFn(snap, resKey, baselines, prodLists);
                    if (!searchOpts.movableList.length) return { ok: false, reason: "no movable buildings on this base" };
                }

                var r = runSearch(snap, null, searchOpts, 0);
                var moves = diffMoves(snap, r.startPos, r.bestPos, null, searchOpts.movableList);

                // Final per-resource production at start + best (always computed - the UI uses it to
                // show the full net-change table, even in strict mode).
                var startProd = baselines;
                var bestProd = scoreAll(snap, r.bestPos, null, prodLists);
                var current = startProd[resKey], projected = bestProd[resKey];
                var gainPct = current > 0 ? ((projected - current) / current * 100) : 0;

                return { ok: true, resKey: resKey, current: current, projected: projected, gainPct: gainPct,
                         moves: moves, sells: [], snapshot: snap, bestPos: r.bestPos, startPos: r.startPos,
                         startProd: startProd, bestProd: bestProd, allowReductions: allowReductions, alpha: alpha };
            }

            // Resource buildings that may be demolished to free space (uniques/defense are never sold).
            var SELLABLE = { Harvester: 1, Silo: 1, PowerPlant: 1, Accumulator: 1, Refinery: 1 };

            // Optimize AND recommend up to sellN buildings to demolish for the biggest target gain.
            // Greedy: each round, try demolishing each remaining sellable building, re-optimize the target
            // producers into the freed space, and keep the single demolition that yields the highest target
            // production - but only if it actually beats the running best (so it won't recommend pointless
            // sells). Returns the standard result + sells:[{id,techName,harvRes,level,x,y}].
            function optimizeWithSell(city, resKey, opts, sellN) {
                opts = opts || {};
                var snap = snapshot(city, resKey);
                if (!snap || !snap.ok) return { ok: false, reason: "could not read base layout" };

                var allowReductions = !!opts.allowReductions;
                var alpha = (typeof opts.alpha === "number") ? opts.alpha : 0.5;
                var prodLists = buildProdLists(snap);
                var baselines = scoreAll(snap, startPosFor(snap, null), null, prodLists);

                function mkSearchOpts(extra) {
                    var o = { rounds: extra.rounds || opts.rounds, kicks: extra.kicks != null ? extra.kicks : opts.kicks,
                              maxNeighbors: opts.maxNeighbors, restarts: extra.restarts };
                    // Both modes widen the movable set; strict mode uses the no-harm constraint to filter.
                    o.movableList = widenMovable(snap);
                    if (allowReductions) {
                        o.scoreFn = makeMultiScoreFn(snap, resKey, baselines, alpha, prodLists);
                    } else {
                        o.scoreFn = makeStrictScoreFn(snap, resKey, baselines, prodLists);
                        if (!o.movableList.length) return null;
                    }
                    return o;
                }
                var fullOpts = mkSearchOpts({ restarts: 4 });
                if (!fullOpts) return { ok: false, reason: "no movable buildings for this resource" };

                var baseR = runSearch(snap, null, fullOpts, 0);
                var current = baselines[resKey];                      // true current target production
                var bestRemoved = {}, bestR = baseR, bestScore = baseR.bestScore;
                var sells = [];
                var lightOpts = mkSearchOpts({ rounds: Math.min(opts.rounds || 30, 20), kicks: 1, restarts: 1 });
                for (var k = 0; k < (sellN || 0); k++) {
                    var roundBest = null, roundBestId = -1, salt = 1;
                    for (var i = 0; i < snap.order.length; i++) {
                        var id = snap.order[i], b = snap.buildings[id];
                        if (bestRemoved[id] || !SELLABLE[b.techName]) continue;
                        bestRemoved[id] = true;
                        var r = runSearch(snap, bestRemoved, lightOpts, salt++);
                        delete bestRemoved[id];
                        if (!roundBest || r.bestScore > roundBest.bestScore) { roundBest = r; roundBestId = id; }
                    }
                    if (roundBestId < 0 || roundBest.bestScore <= bestScore + 1e-6) break;
                    bestRemoved[roundBestId] = true;
                    var sb = snap.buildings[roundBestId];
                    sells.push({ id: roundBestId, techName: sb.techName, harvRes: sb.harvRes, level: sb.level, x: sb.x, y: sb.y });
                    bestScore = roundBest.bestScore;
                }
                var polishOpts = mkSearchOpts({ restarts: 5 });
                bestR = runSearch(snap, bestRemoved, polishOpts, 99);
                var moves = diffMoves(snap, bestR.startPos, bestR.bestPos, bestRemoved, polishOpts.movableList);
                var startProd = baselines;
                var bestProd = scoreAll(snap, bestR.bestPos, bestRemoved, prodLists);
                var projected = bestProd[resKey];
                var gainPct = current > 0 ? ((projected - current) / current * 100) : 0;
                return { ok: true, resKey: resKey, current: current, projected: projected, gainPct: gainPct,
                         moves: moves, sells: sells, removed: bestRemoved, snapshot: snap,
                         bestPos: bestR.bestPos, startPos: bestR.startPos,
                         startProd: startProd, bestProd: bestProd, allowReductions: allowReductions, alpha: alpha };
            }

            // ===================== PHASE B: auto-apply ============================
            // Turn an optimize result into a dependency-safe ordered step list and fire it
            // against the live base. The move primitive is the (obfuscated) CityBuilding mover
            // `IXYXAF(x,y)` and demolish is `BFHPNB()` (both sniffed live - see the
            // base-edit-move-primitive notes). N() coerces .NET-wrapped numbers.

            // Read every building's LIVE position + object handle right now (authoritative -
            // the optimize snapshot may be a few seconds stale). byId[id]={id,obj,x,y}; occ["x,y"]=id.
            function readLive(city) {
                var bd; try { bd = city.get_Buildings().d; } catch (e) { return null; }
                var byId = {}, occ = {};
                for (var k in bd) {
                    var raw = bd[k]; if (!raw || !raw.get_Id) continue;
                    var id = raw.get_Id(), x = N(raw.get_CoordX()), y = N(raw.get_CoordY());
                    byId[id] = { id: id, obj: raw, x: x, y: y };
                    occ[x + "," + y] = id;
                }
                return { byId: byId, occ: occ };
            }

            // % of the in-progress package a producer loses when moved (null = makes no packages,
            // e.g. silo/accumulator - moving them costs no package progress).
            function pkgProgressPct(obj) {
                try {
                    if (obj.get_ProducesPackages && !N(obj.get_ProducesPackages())) return null;
                    var max = N(obj.get_CollectMaxPackageSize()); if (!(max > 0)) return null;
                    var cur = N(obj.GetCurrentPackageResourceCollected());
                    return Math.max(0, Math.min(100, Math.round(cur / max * 100)));
                } catch (e) { return null; }
            }

            // PURE planner. Returns { ok, steps, nMoves, nSells, nStaged, lossList, reason }.
            // steps: {type:'demolish'|'move', id, obj, techName, harvRes, level, fromX, fromY, toX, toY, staged?}.
            // Strategy: (1) demolish all sells first (frees their tiles); (2) repeatedly apply any move
            // whose target tile is CURRENTLY empty + terrain-legal; (3) break a move cycle by parking one
            // building on a spare legal tile (staged) so its target frees up. Every IXYXAF we ultimately
            // emit is a move-into-an-empty-tile (never relies on the game's swap-on-occupied behaviour).
            // Also re-validates the plan isn't stale (base unchanged since optimize).
            function buildApplyPlan(city, res) {
                if (!res || !res.ok) return { ok: false, reason: "no optimization result to apply" };
                var snap = res.snapshot;
                var live = readLive(city); if (!live) return { ok: false, reason: "could not read the base" };

                // Staleness guard: every building the plan touches must still exist at its snapshot tile.
                var refIds = {};
                (res.moves || []).forEach(function (m) { refIds[m.id] = 1; });
                (res.sells || []).forEach(function (s) { refIds[s.id] = 1; });
                for (var rid in refIds) {
                    var Lr = live.byId[rid], Br = snap.buildings[rid];
                    if (!Lr || !Br) return { ok: false, reason: "the base changed since you optimized (a building is gone) - re-run the optimizer" };
                    if (Lr.x !== N(Br.x) || Lr.y !== N(Br.y)) return { ok: false, reason: "the base changed since you optimized (a building moved) - re-run the optimizer" };
                }

                var occ = {}; for (var key in live.occ) occ[key] = live.occ[key];           // "x,y" -> id (working)
                var cur = {}; for (var id0 in live.byId) cur[id0] = { x: live.byId[id0].x, y: live.byId[id0].y };

                var steps = [], sold = {};
                (res.sells || []).forEach(function (s) {
                    var L = live.byId[s.id]; if (!L) return; sold[s.id] = 1;
                    steps.push({ type: "demolish", id: s.id, obj: L.obj, techName: s.techName, harvRes: s.harvRes, level: s.level, fromX: cur[s.id].x, fromY: cur[s.id].y });
                    delete occ[cur[s.id].x + "," + cur[s.id].y];
                });

                var targetOf = {}, pending = [];
                (res.moves || []).forEach(function (m) { if (sold[m.id]) return; targetOf[m.id] = { x: m.toX, y: m.toY }; pending.push(m.id); });

                function tileFree(x, y) { return occ[x + "," + y] == null; }
                function legalAt(id, x, y) { var b = snap.buildings[id]; return !!b && inGrid(x, y) && terrainOK(snap, b, x, y); }
                function emit(id, x, y, staged) {
                    var b = snap.buildings[id], L = live.byId[id];
                    delete occ[cur[id].x + "," + cur[id].y];
                    var st = { type: "move", id: id, obj: L.obj, techName: b.techName, harvRes: b.harvRes, level: b.level, fromX: cur[id].x, fromY: cur[id].y, toX: x, toY: y };
                    if (staged) st.staged = true;
                    steps.push(st); cur[id] = { x: x, y: y }; occ[x + "," + y] = id;
                }

                var guard = 0, maxGuard = pending.length * pending.length + pending.length + 10;
                while (pending.length && guard++ < maxGuard) {
                    var progressed = false;
                    for (var i = 0; i < pending.length; i++) {
                        var id = pending[i], t = targetOf[id];
                        if (cur[id].x === t.x && cur[id].y === t.y) { pending.splice(i, 1); i--; continue; }
                        var occId = occ[t.x + "," + t.y];
                        if (occId != null && targetOf[occId] == null && !sold[occId]) return { ok: false, reason: "a move target is blocked by a fixed building - re-run the optimizer" };
                        if (tileFree(t.x, t.y) && legalAt(id, t.x, t.y)) { emit(id, t.x, t.y, false); pending.splice(i, 1); i--; progressed = true; }
                    }
                    if (!pending.length || progressed) continue;
                    // Cycle: park one pending building on a spare legal+free tile that no pending move needs.
                    var staged = false;
                    for (var p = 0; p < pending.length && !staged; p++) {
                        var sid = pending[p], sb = snap.buildings[sid];
                        for (var y = 0; y < GRID_H && !staged; y++) for (var x = 0; x < GRID_W && !staged; x++) {
                            if (!tileFree(x, y) || !terrainOK(snap, sb, x, y)) continue;
                            var needed = false; for (var q = 0; q < pending.length; q++) { var tt = targetOf[pending[q]]; if (tt.x === x && tt.y === y) { needed = true; break; } }
                            if (needed) continue;
                            emit(sid, x, y, true); staged = true;   // its real target move stays pending
                        }
                    }
                    if (!staged) return { ok: false, reason: "couldn't sequence the moves automatically (no free staging tile) - apply by hand in move mode" };
                }
                if (pending.length) return { ok: false, reason: "couldn't sequence all moves automatically - apply by hand in move mode" };

                // Package-progress loss (count each moved building once, even if staged = 2 steps).
                var lossList = [], seen = {};
                steps.forEach(function (st) {
                    if (st.type !== "move" || seen[st.id]) return; seen[st.id] = 1;
                    var L = live.byId[st.id], pct = L ? pkgProgressPct(L.obj) : null;
                    if (pct != null && pct > 0) lossList.push({ id: st.id, techName: st.techName, harvRes: st.harvRes, level: st.level, pct: pct });
                });
                lossList.sort(function (a, b) { return b.pct - a.pct; });
                return { ok: true, steps: steps, nMoves: Object.keys(seen).length, nSells: (res.sells || []).length,
                         nStaged: steps.filter(function (s) { return s.staged; }).length, lossList: lossList };
            }

            // Fire an ordered plan against the live base, SEQUENTIALLY, verifying each step BY EFFECT
            // (the building's coords actually change / it actually disappears) rather than by return code
            // (which is unreliable - same lesson as the upgrade tab). Non-blocking (timer-driven).
            // hooks: { onStep(index, step, ok, msg), onDone({applied, failed, failedSteps}) }.
            function executeApplyPlan(city, plan, hooks) {
                hooks = hooks || {};
                var steps = plan.steps, i = 0, done = [], failed = [];
                function findObj(id) { try { var bd = city.get_Buildings().d; for (var k in bd) { var b = bd[k]; if (b && b.get_Id && b.get_Id() === id) return b; } } catch (e) {} return null; }
                function fail(st, msg) { failed.push({ step: st, msg: msg }); if (hooks.onStep) try { hooks.onStep(i, st, false, msg); } catch (e) {} i++; window.setTimeout(next, 90); }
                function ok(st) { done.push(st); if (hooks.onStep) try { hooks.onStep(i, st, true, "ok"); } catch (e) {} i++; window.setTimeout(next, 140); }
                function verify(test, st) { var tries = 0; (function poll() { try { if (test()) return ok(st); } catch (e) {} if (++tries > 25) return fail(st, "no visible effect (timeout)"); window.setTimeout(poll, 120); })(); }
                function next() {
                    if (i >= steps.length) { if (hooks.onDone) try { hooks.onDone({ applied: done.length, failed: failed.length, failedSteps: failed }); } catch (e) {} return; }
                    var st = steps[i], obj = findObj(st.id);
                    if (!obj) return fail(st, "building not found");
                    try {
                        if (st.type === "demolish") {
                            if (obj.CanDemolish && !obj.CanDemolish()) return fail(st, "game refused demolish");
                            obj.BFHPNB();
                            verify(function () { return findObj(st.id) == null; }, st);
                        } else {
                            obj.IXYXAF(st.toX, st.toY);
                            verify(function () { var o = findObj(st.id); return !!o && N(o.get_CoordX()) === st.toX && N(o.get_CoordY()) === st.toY; }, st);
                        }
                    } catch (e) { return fail(st, String(e)); }
                }
                next();
            }

            return { snapshot: snapshot, score: score, optimize: optimize, optimizeWithSell: optimizeWithSell,
                     buildApplyPlan: buildApplyPlan, executeApplyPlan: executeApplyPlan, pkgProgressPct: pkgProgressPct,
                     RES_CFG: RES_CFG, GRID_W: GRID_W, GRID_H: GRID_H };
        })();

        // Debug handle: when MM debug is on, expose the optimizer engine so the layout/apply logic can be
        // exercised from the console (e.g. dry-run buildApplyPlan to inspect step ordering before applying).
        try { if (window.MMBASETOOLS_DEBUG || window.MM_DEBUG) window.MM_BASETOOLS_OPT = OPT; } catch (e) {}

        // ----- main build ------------------------------------------------------------
        function build() {
            var MM = window.MMCommon;

            // ---- settings (with defaults) ----
            var AUTO_COLLECT = MM.settings.get("BaseTools.autoCollectPackages", true);
            var AUTO_REP_UNITS = MM.settings.get("BaseTools.autoRepairUnits", false);
            var AUTO_REP_BLDG = MM.settings.get("BaseTools.autoRepairBuildings", true);
            var AUTO_TIMER_MIN = MM.settings.get("BaseTools.AutoCollectTimerMin", 5);
            var REP_PRIORITY = MM.settings.get("BaseTools.RepairPriority", true);
            var REP_ORDER = MM.settings.get("BaseTools.RepairOrder", null);
            if (!REP_ORDER || !REP_ORDER.length) REP_ORDER = defaultRepairOrder();

            // ---- main tabbed window ----
            var tabView = new qx.ui.tabview.TabView();
            var win = MM.ui.Window({
                caption: "Base Tools",
                key: "BaseTools.Window",
                pos: [260, 140],
                width: 440,
                height: 460,
                persistSize: true,   // remember width AND height across reloads
                restoreOpen: true,   // remember whether it was open across reloads
                layout: new qx.ui.layout.Grow()
            });
            if (!win) { werr("could not create window"); return; }
            win.add(tabView);

            // ---- Tab 1: Collect & Repair ----
            var tabCR = new qx.ui.tabview.Page("Collect & Repair");
            tabCR.setLayout(new qx.ui.layout.VBox(8));
            tabCR.setPadding(8);
            tabView.add(tabCR);

            var statusLbl = new qx.ui.basic.Label("(refreshing...)").set({ rich: true, textColor: "#cccccc" });
            tabCR.add(statusLbl);

            var rowActions = new qx.ui.container.Composite(new qx.ui.layout.HBox(6));
            var btnCollectInWin = new qx.ui.form.Button("Collect All Packages").set({ enabled: false, toolTipText: "Collect packages from every base that has them ready" });
            var btnRepBldInWin = new qx.ui.form.Button("Repair All Buildings").set({ enabled: false, toolTipText: "Repair buildings (where allowed) across every base" });
            var btnRepUnitsInWin = new qx.ui.form.Button("Repair All Units").set({ enabled: false, toolTipText: "Repair units across every base" });
            btnCollectInWin.addListener("execute", function () { collectAll(); window.setTimeout(refresh, 500); });
            btnRepBldInWin.addListener("execute", function () { repairAll(ClientLib.Vis.Mode.City); window.setTimeout(refresh, 500); });
            btnRepUnitsInWin.addListener("execute", function () { repairAll(ClientLib.Vis.Mode.ArmySetup); window.setTimeout(refresh, 500); });
            rowActions.add(btnCollectInWin);
            rowActions.add(btnRepBldInWin);
            rowActions.add(btnRepUnitsInWin);
            tabCR.add(rowActions);

            // Auto-collect / auto-repair section
            tabCR.add(new qx.ui.core.Spacer(null, 6));
            tabCR.add(new qx.ui.basic.Label("<b>Auto-collect / auto-repair</b>").set({ rich: true, textColor: "#ffffff" }));
            tabCR.add(new qx.ui.basic.Label("Run periodically across every base. Off by default for units to avoid surprise resource spend.").set({ rich: true, textColor: "#aaaaaa" }));

            var cbCollect = new qx.ui.form.CheckBox("Auto-collect packages").set({ value: AUTO_COLLECT });
            var cbRepBldg = new qx.ui.form.CheckBox("Auto-repair buildings").set({ value: AUTO_REP_BLDG });
            var cbRepUnits = new qx.ui.form.CheckBox("Auto-repair units").set({ value: AUTO_REP_UNITS });
            cbCollect.addListener("changeValue", function (e) { AUTO_COLLECT = !!e.getData(); MM.settings.set("BaseTools.autoCollectPackages", AUTO_COLLECT); wlog("autoCollect =", AUTO_COLLECT); });
            cbRepBldg.addListener("changeValue", function (e) { AUTO_REP_BLDG = !!e.getData(); MM.settings.set("BaseTools.autoRepairBuildings", AUTO_REP_BLDG); wlog("autoRepBldg =", AUTO_REP_BLDG); });
            cbRepUnits.addListener("changeValue", function (e) { AUTO_REP_UNITS = !!e.getData(); MM.settings.set("BaseTools.autoRepairUnits", AUTO_REP_UNITS); wlog("autoRepUnits =", AUTO_REP_UNITS); });
            tabCR.add(cbCollect);
            tabCR.add(cbRepBldg);
            tabCR.add(cbRepUnits);

            var timerRow = new qx.ui.container.Composite(new qx.ui.layout.HBox(6));
            timerRow.add(new qx.ui.basic.Label("Interval (minutes):").set({ alignY: "middle" }));
            var spinTimer = new qx.ui.form.Spinner(1, AUTO_TIMER_MIN, 360);
            spinTimer.addListener("changeValue", function (e) {
                var v = Math.max(1, Math.min(360, Number(e.getData()) || 5));
                AUTO_TIMER_MIN = v;
                MM.settings.set("BaseTools.AutoCollectTimerMin", v);
                restartAutoTimer();
                wlog("autoTimerMin =", v);
            });
            timerRow.add(spinTimer);
            tabCR.add(timerRow);

            // Auto-repair priority list (salvaged from TA_Auto_Repair, retired 2026-06-21).
            // Off-by-default-but-on: REP_PRIORITY defaults to true so the smarter behavior is on
            // out of the box. Unchecking it falls back to the game's RepairAll order. The list
            // uses Up/Down/Reset (simpler than the original's drag-drop, same end result).
            tabCR.add(new qx.ui.core.Spacer(null, 6));
            var prioHeader = new qx.ui.container.Composite(new qx.ui.layout.HBox(6));
            var cbPrio = new qx.ui.form.CheckBox("Auto-repair by priority + ROI").set({ value: REP_PRIORITY, toolTipText: "When on, the auto-repair tick walks the priority list below and ROI-sorts damaged buildings within each tier. Off = call the game's RepairAll in its default order." });
            prioHeader.add(cbPrio, { flex: 1 });
            tabCR.add(prioHeader);

            var prioGroup = new qx.ui.container.Composite(new qx.ui.layout.VBox(4));
            prioGroup.add(new qx.ui.basic.Label("Highest first &middot; select then Up/Down to reorder").set({ rich: true, textColor: "#aaaaaa" }));
            var prioList = new qx.ui.form.List().set({ height: 160, selectionMode: "single" });
            prioGroup.add(prioList);

            function techDisplayName(techName) {
                try {
                    var Res = ClientLib.Res.ResMain.GetInstance(),
                        Tech = ClientLib.Base.Tech,
                        ETN = ClientLib.Base.ETechName,
                        faction = ClientLib.Data.MainData.GetInstance().get_Player().get_Faction(),
                        dn = Res.GetTech_Obj(Tech.GetTechIdFromTechNameAndFaction(techName, faction)).dn;
                    if (techName === ETN.Harvester) dn += " (" + Res.GetResource(ClientLib.Base.EResourceType.Tiberium).dn + ")";
                    else if (techName === ETN.Harvester_Crystal) dn += " (" + Res.GetResource(ClientLib.Base.EResourceType.Crystal).dn + ")";
                    else if (techName === ETN.Support_Air) {
                        dn = [dn,
                              Res.GetTech_Obj(Tech.GetTechIdFromTechNameAndFaction(ETN.Support_Ion, faction)).dn,
                              Res.GetTech_Obj(Tech.GetTechIdFromTechNameAndFaction(ETN.Support_Art, faction)).dn].join("/");
                    }
                    return dn;
                } catch (e) { return String(techName); }
            }
            function repaintPrioList(order) {
                prioList.removeAll();
                for (var i = 0; i < order.length; i++) {
                    var item = new qx.ui.form.ListItem(techDisplayName(order[i]));
                    item.setUserData("techName", order[i]);
                    prioList.add(item);
                }
            }
            function savePrioOrder() {
                var items = prioList.getChildren(), arr = [];
                for (var i = 0; i < items.length; i++) arr.push(items[i].getUserData("techName"));
                REP_ORDER = arr;
                MM.settings.set("BaseTools.RepairOrder", arr);
                wlog("RepairOrder =", arr);
            }
            repaintPrioList(REP_ORDER);

            var btnRow = new qx.ui.container.Composite(new qx.ui.layout.HBox(4));
            var btnUp = new qx.ui.form.Button("Up").set({ width: 60 });
            var btnDown = new qx.ui.form.Button("Down").set({ width: 60 });
            var btnReset = new qx.ui.form.Button("Reset to default").set({ width: 130 });
            btnUp.addListener("execute", function () {
                var sel = prioList.getSelection()[0];
                if (!sel) return;
                var children = prioList.getChildren(), idx = children.indexOf(sel);
                if (idx <= 0) return;
                prioList.addBefore(sel, children[idx - 1]);
                prioList.addToSelection(sel);
                savePrioOrder();
            });
            btnDown.addListener("execute", function () {
                var sel = prioList.getSelection()[0];
                if (!sel) return;
                var children = prioList.getChildren(), idx = children.indexOf(sel);
                if (idx < 0 || idx >= children.length - 1) return;
                prioList.addAfter(sel, children[idx + 1]);
                prioList.addToSelection(sel);
                savePrioOrder();
            });
            btnReset.addListener("execute", function () {
                REP_ORDER = defaultRepairOrder();
                MM.settings.set("BaseTools.RepairOrder", REP_ORDER);
                repaintPrioList(REP_ORDER);
                wlog("RepairOrder reset to default");
            });
            btnRow.add(btnUp);
            btnRow.add(btnDown);
            btnRow.add(new qx.ui.core.Spacer(), { flex: 1 });
            btnRow.add(btnReset);
            prioGroup.add(btnRow);
            tabCR.add(prioGroup);
            prioGroup.setVisibility(REP_PRIORITY ? "visible" : "excluded");

            cbPrio.addListener("changeValue", function (e) {
                REP_PRIORITY = !!e.getData();
                MM.settings.set("BaseTools.RepairPriority", REP_PRIORITY);
                prioGroup.setVisibility(REP_PRIORITY ? "visible" : "excluded");
                wlog("RepairPriority =", REP_PRIORITY);
            });

            // ---- Tabs 2-4 ----
            function placeholderTab(title, body) {
                var p = new qx.ui.tabview.Page(title);
                p.setLayout(new qx.ui.layout.VBox(6));
                p.setPadding(12);
                p.add(new qx.ui.basic.Label(body).set({ rich: true, textColor: "#cccccc" }));
                return p;
            }

            // ---- Tab 2: Production --------------------------------------------------
            // Per-base + grand-total production for Tiberium / Crystal / Power / Credits.
            // For each resource shows Continuous (base production), Bonus (extra from packages),
            // POI (alliance POI bonus), and Total / h. Credits has no POI bonus, so its third row
            // is Total / BaseLevel (production per base level - a quick "is this base pulling its
            // weight" metric the original had). Ported from the original tool's production view.
            function buildProductionTab() {
                var page = new qx.ui.tabview.Page("Production");
                page.setLayout(new qx.ui.layout.VBox(6));
                page.setPadding(8);

                var headerRow = new qx.ui.container.Composite(new qx.ui.layout.HBox(8));
                var btnRefresh = new qx.ui.form.Button("Refresh").set({ toolTipText: "Recompute the table from the current game state" });
                var tsLbl = new qx.ui.basic.Label("").set({ textColor: "#888888", alignY: "middle" });
                headerRow.add(btnRefresh);
                headerRow.add(tsLbl, { flex: 1 });
                page.add(headerRow);

                // Scroll wraps the grid so > ~10 bases don't blow out the window width.
                var scroll = new qx.ui.container.Scroll();
                var grid = new qx.ui.container.Composite(new qx.ui.layout.Grid(8, 2));
                scroll.add(grid);
                page.add(scroll, { flex: 1 });

                // Sections, in display order top->bottom. Each shows (in order): Package Production
                // (the bonus from collected packages), Continuous Production (the steady base rate),
                // then a third row that's "Alliance Bonus" (POI) for resources, or "Total / BaseLevel"
                // for Credits (which has no alliance bonus), then "Total / h".
                var SECTIONS = [
                    { k: "Tib", title: "Tiberium",   third: "Alliance Bonus" },
                    { k: "Cry", title: "Crystal",    third: "Alliance Bonus" },
                    { k: "Pow", title: "Power",      third: "Alliance Bonus" },
                    { k: "Dol", title: "Credits ($)", third: "Total / BaseLevel" }
                ];
                var RED = "#ff8a8a"; // readable red for stopped/held/excluded values

                function snapshot() {
                    try {
                        var alliance = ClientLib.Data.MainData.GetInstance().get_Alliance();
                        var ERT = ClientLib.Base.EResourceType;
                        var R = ClientLib.Base.Resource;
                        var cities = [];
                        eachOwnCity(function (c) {
                            var name = c.get_Name ? c.get_Name() : "?";
                            var id = c.get_Id ? c.get_Id() : 0;
                            var stopped = !!(c.get_IsGhostMode && c.get_IsGhostMode());
                            var pkgStopped = stopped || !!(c.get_hasCooldown && c.get_hasCooldown());
                            var baseLevel = (c.get_LvlBase ? (Math.floor(c.get_LvlBase() * 100) / 100) : 0);
                            var credProd = c.get_CityCreditsProduction ? c.get_CityCreditsProduction() : null;
                            var perRes = {
                                Tib: { delta: c.GetResourceGrowPerHour(ERT.Tiberium, false, false), bonus: c.GetResourceBonusGrowPerHour(ERT.Tiberium), poi: alliance ? alliance.GetPOIBonusFromResourceType(ERT.Tiberium) : 0 },
                                Cry: { delta: c.GetResourceGrowPerHour(ERT.Crystal, false, false),  bonus: c.GetResourceBonusGrowPerHour(ERT.Crystal),  poi: alliance ? alliance.GetPOIBonusFromResourceType(ERT.Crystal) : 0 },
                                Pow: { delta: c.GetResourceGrowPerHour(ERT.Power, false, false),    bonus: c.GetResourceBonusGrowPerHour(ERT.Power),    poi: alliance ? alliance.GetPOIBonusFromResourceType(ERT.Power) : 0 },
                                Dol: { delta: credProd ? R.GetResourceGrowPerHour(credProd, false) : 0, bonus: credProd ? R.GetResourceBonusGrowPerHour(credProd, false) : 0, poi: 0 }
                            };
                            cities.push({ name: name, id: id, stopped: stopped, pkgStopped: pkgStopped, baseLevel: baseLevel, perRes: perRes });
                        });
                        // Sort cities by name for stable column order.
                        cities.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
                        // Per-resource grand totals. Killed (ghost) bases are excluded ENTIRELY - they
                        // aren't producing. For a base whose packages are on hold (cooldown after a
                        // rebuild), the package bonus is excluded too (it isn't being produced yet).
                        var totals = {};
                        for (var i = 0; i < SECTIONS.length; i++) {
                            var k = SECTIONS[i].k, t = { delta: 0, bonus: 0, poi: 0 };
                            for (var j = 0; j < cities.length; j++) {
                                var cj = cities[j];
                                if (cj.stopped) continue;                 // killed base: not producing at all
                                t.delta += cj.perRes[k].delta;
                                t.poi += cj.perRes[k].poi;
                                if (!cj.pkgStopped) t.bonus += cj.perRes[k].bonus; // held packages excluded
                            }
                            t.total = t.delta + t.bonus + t.poi;
                            totals[k] = t;
                        }
                        return { cities: cities, totals: totals };
                    } catch (e) { werr("Production snapshot failed:", e); return { cities: [], totals: {} }; }
                }

                function addLbl(row, col, text, opts) {
                    opts = opts || {};
                    var lbl = new qx.ui.basic.Label(text == null ? "" : String(text));
                    if (opts.color) lbl.setTextColor(opts.color);
                    if (opts.bold) { try { lbl.setFont(qx.bom.Font.fromString("bold 11px sans-serif")); } catch (e) {} }
                    if (opts.align) lbl.setTextAlign(opts.align);
                    if (opts.width) lbl.setWidth(opts.width);
                    grid.add(lbl, { row: row, column: col });
                    return lbl;
                }

                function accessBtn(cityId) {
                    var b = new qx.ui.form.Button("→").set({ width: 24, height: 20, toolTipText: "Open this base" });
                    b.addListener("execute", function () {
                        try { webfrontend.gui.UtilView.openCityInMainWindow(cityId); } catch (e) { werr("openCity failed:", e); }
                    });
                    return b;
                }

                function fmt(n) {
                    if (typeof n !== "number" || !isFinite(n)) return "-";
                    return MM.num.compact(Math.round(n), 1);
                }

                function render(snap) {
                    // Tear down old labels/buttons before rebuilding so we don't leak widgets.
                    try {
                        var kids = grid.removeAll();
                        for (var ki = 0; ki < kids.length; ki++) { try { kids[ki].destroy(); } catch (e) {} }
                    } catch (e) {}

                    // Left labels column (col 0): section title + 4 row labels per section.
                    var row = 0;
                    addLbl(row++, 0, "");
                    for (var s = 0; s < SECTIONS.length; s++) {
                        addLbl(row++, 0, SECTIONS[s].title, { bold: true, color: "#ffffff" });
                        addLbl(row++, 0, "Package Production",    { color: "#aaaaaa" });
                        addLbl(row++, 0, "Continuous Production", { color: "#aaaaaa" });
                        addLbl(row++, 0, SECTIONS[s].third,       { color: "#aaaaaa" });
                        addLbl(row++, 0, "Total / h",             { color: "#cccccc", bold: true });
                    }
                    addLbl(row, 0, ""); // access-button row

                    // One column per base, then the grand-totals column.
                    var col = 1;
                    for (var ci = 0; ci < snap.cities.length; ci++) {
                        var c = snap.cities[ci];
                        var r = 0;
                        addLbl(r++, col, c.name, { bold: true, align: "right", color: c.stopped ? RED : "#ffffff" });
                        for (var sIdx = 0; sIdx < SECTIONS.length; sIdx++) {
                            var sec = SECTIONS[sIdx];
                            var p = c.perRes[sec.k];
                            r++; // skip section-header row (only the left col has text there)
                            // Row 1: Package Production (= bonus). Red+excluded if base killed OR packages held.
                            var pkgRed = c.stopped || c.pkgStopped || p.bonus === 0;
                            addLbl(r++, col, fmt(p.bonus), { align: "right", color: pkgRed ? RED : "#ffffff", bold: pkgRed });
                            // Row 2: Continuous Production (= delta). Red if base killed.
                            var contRed = c.stopped || p.delta === 0;
                            addLbl(r++, col, fmt(p.delta), { align: "right", color: contRed ? RED : "#ffffff", bold: contRed });
                            // Row 3: Alliance Bonus (POI) - or Total/BaseLevel for Credits.
                            if (sec.k === "Dol") {
                                var perLvl = c.baseLevel > 0 ? (p.delta + p.bonus + p.poi) / c.baseLevel : 0;
                                addLbl(r++, col, fmt(perLvl), { align: "right", color: c.stopped ? RED : "#ffffff", bold: c.stopped });
                            } else {
                                var poiRed = c.stopped || p.poi === 0;
                                addLbl(r++, col, fmt(p.poi), { align: "right", color: poiRed ? RED : "#ffffff", bold: poiRed });
                            }
                            // Row 4: Total / h. Killed base shows its raw potential in red (excluded from
                            // grand totals); a packages-held base excludes the held package bonus.
                            var baseTotal = c.stopped ? (p.delta + p.bonus + p.poi)
                                                      : (p.delta + p.poi + (c.pkgStopped ? 0 : p.bonus));
                            addLbl(r++, col, fmt(baseTotal), { align: "right", bold: true, color: c.stopped ? RED : "#ffe14d" });
                        }
                        grid.add(accessBtn(c.id), { row: r, column: col });
                        col++;
                    }

                    // Grand-totals column.
                    var tr = 0;
                    addLbl(tr++, col, "Total / h", { bold: true, align: "right", color: "#ffe14d" });
                    for (var ti = 0; ti < SECTIONS.length; ti++) {
                        var tk = SECTIONS[ti].k;
                        var T = snap.totals[tk] || { delta: 0, bonus: 0, poi: 0, total: 0 };
                        tr++; // section-header row
                        addLbl(tr++, col, fmt(T.bonus), { align: "right", bold: true }); // Package Production
                        addLbl(tr++, col, fmt(T.delta), { align: "right", bold: true }); // Continuous Production
                        if (tk === "Dol") { tr++; } // Total/BaseLevel is per-base only, blank in grand totals
                        else { addLbl(tr++, col, fmt(T.poi), { align: "right", bold: true }); } // Alliance Bonus
                        addLbl(tr++, col, fmt(T.total), { align: "right", bold: true, color: "#ffe14d" });
                    }
                }

                function refreshTab() {
                    try {
                        render(snapshot());
                        tsLbl.setValue("Last update: " + new Date().toLocaleTimeString());
                    } catch (e) { werr("Production refreshTab failed:", e); }
                }

                btnRefresh.addListener("execute", refreshTab);
                page.addListener("appear", refreshTab);  // refresh whenever the Production tab is shown
                return page;
            }
            var pageProd = buildProductionTab();
            tabView.add(pageProd);

            // ---- Tab 3: Upgrade Priority (Option B - one unified, sortable table) ----
            // Single table across ALL bases and ALL resource types. Filter by resource and by
            // affordability; sort by any column; one-click per-row upgrade plus a batch
            // "Upgrade Top N" that walks the currently-visible, sorted list.
            function buildUpgradeTab() {
                var page = new qx.ui.tabview.Page("Upgrade Priority");
                page.setLayout(new qx.ui.layout.VBox(6));
                page.setPadding(8);

                // ---- controls row (Flow so it WRAPS when the window is made narrow - an HBox here would
                // pin the whole window's min-width to the sum of every control, ~1086px) ----
                var ctrls = new qx.ui.container.Composite(new qx.ui.layout.Flow(6, 4));

                // Base filter (persisted): "All" or a specific base id. The option list is (re)built in
                // refreshTab, NOT here - at window-build time the city data may not be loaded yet, which
                // is why it would otherwise show only "All Bases". Rebuilding on each refresh also means
                // destroyed (ghosted) bases correctly drop off the list.
                ctrls.add(new qx.ui.basic.Label("Base:").set({ alignY: "middle" }));
                var baseSelect = new qx.ui.form.SelectBox().set({ width: 150, alignY: "middle" });
                var allItem0 = new qx.ui.form.ListItem("All Bases"); allItem0.setModel("All"); baseSelect.add(allItem0);
                var suppressBaseEvent = false; // guard so rebuilding options doesn't recurse into refreshTab
                var baseListBuilt = false;
                function rebuildBaseOptions() {
                    // Preserve the current choice (or, on the very first build, the persisted one).
                    var prev = baseListBuilt ? currentBaseFilter() : MM.settings.get("BaseTools.UpgradeBaseFilter", "All");
                    baseListBuilt = true;
                    suppressBaseEvent = true;
                    try {
                        try { baseSelect.removeAll(); } catch (e) {}
                        var allItem = new qx.ui.form.ListItem("All Bases"); allItem.setModel("All"); baseSelect.add(allItem);
                        var list = [];
                        eachOwnCity(function (c) {
                            try {
                                if (c.get_IsGhostMode && c.get_IsGhostMode()) return; // skip destroyed bases
                                list.push({ id: String(c.get_Id()), name: c.get_Name() });
                            } catch (e) {}
                        });
                        list.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
                        var sel = allItem;
                        for (var i = 0; i < list.length; i++) {
                            var it = new qx.ui.form.ListItem(list[i].name); it.setModel(list[i].id); baseSelect.add(it);
                            if (list[i].id === prev) sel = it;
                        }
                        baseSelect.setSelection([sel]);
                    } catch (e) { werr("rebuildBaseOptions failed:", e); }
                    suppressBaseEvent = false;
                }
                ctrls.add(baseSelect);

                ctrls.add(new qx.ui.basic.Label("Resource:").set({ alignY: "middle" }));
                var resSelect = new qx.ui.form.SelectBox().set({ width: 110 });
                var savedRes = MM.settings.get("BaseTools.UpgradeResourceFilter", "All");
                [["All", "All"], ["Tiberium", "Tib"], ["Crystal", "Cry"], ["Power", "Pow"], ["Credits", "Dol"]].forEach(function (o) {
                    var it = new qx.ui.form.ListItem(o[0]); it.setModel(o[1]); resSelect.add(it);
                    if (o[1] === savedRes) resSelect.setSelection([it]);
                });
                ctrls.add(resSelect);

                // Availability filter (persisted): "now" = only what you can upgrade right now;
                // "transfer" = that plus rows you can afford by auto-transferring Tiberium in (and can
                // pay the transfer fee); "all" = every candidate including not-yet-affordable ones.
                ctrls.add(new qx.ui.basic.Label("Show:").set({ alignY: "middle" }));
                var showMode = MM.settings.get("BaseTools.UpgradeShowMode", "transfer");
                var showSelect = new qx.ui.form.SelectBox().set({ width: 190, alignY: "middle" });
                [["Affordable now", "now"], ["Affordable now + transfer", "transfer"], ["All candidates", "all"]].forEach(function (o) {
                    var it = new qx.ui.form.ListItem(o[0]); it.setModel(o[1]); showSelect.add(it);
                    if (o[1] === showMode) showSelect.setSelection([it]);
                });
                ctrls.add(showSelect);

                // Keep-vs-dismiss behavior for upgraded rows (persisted). ON (default) = the upgraded
                // row stays, marked "✓ Upgraded", until you click Refresh (so you can see what took).
                // OFF = the row disappears the moment its upgrade succeeds (like the original tool).
                var keepUpgraded = MM.settings.get("BaseTools.UpgradeKeepRows", true);
                var cbKeep = new qx.ui.form.CheckBox("Keep upgraded rows (clear on Refresh)").set({
                    value: keepUpgraded, alignY: "middle",
                    toolTipText: "On: upgraded rows stay marked '✓ Upgraded' until you Refresh.\nOff: each row vanishes the instant its upgrade succeeds (the classic behavior)."
                });
                ctrls.add(cbKeep);

                var btnRefresh = new qx.ui.form.Button("Refresh").set({ toolTipText: "Recompute the list (clears the '✓ Upgraded' marks and rescans every base)" });
                ctrls.add(btnRefresh);

                ctrls.add(new qx.ui.basic.Label("Upgrade top").set({ alignY: "middle" }));
                var spinTopN = new qx.ui.form.Spinner(1, MM.settings.get("BaseTools.UpgradeTopN", 5), 99).set({ width: 60 });
                ctrls.add(spinTopN);
                // "Transfer as needed" - when a row in the batch would otherwise fail because the
                // local base is short on Tiberium, fall back to transfer-and-upgrade (cheapest sources
                // first) if the player can afford the fee. Default OFF so transfers never happen
                // unless the user explicitly opts in (transfers cost credits).
                var cbTopXfer = new qx.ui.form.CheckBox("Transfer as needed").set({
                    value: MM.settings.get("BaseTools.UpgradeTopXfer", false),
                    alignY: "middle",
                    toolTipText: "When a row in the batch would otherwise fail because the local base is short on Tiberium, transfer from your other bases (cheapest first) before upgrading. Skipped if no transfer plan covers the gap or you can't afford the transfer fee. Off by default - transfers cost credits."
                });
                cbTopXfer.addListener("changeValue", function (e) { MM.settings.set("BaseTools.UpgradeTopXfer", !!e.getData()); });
                ctrls.add(cbTopXfer);

                // On-grid overlay (Ctrl-hold). Default ON. Salvaged from xTr1m's Base Overlay
                // (DR 4:3), retired 2026-06-21. Just toggles the BaseTools.UpgradeOverlay
                // setting - the listeners are always installed but no-op when this is off.
                var cbOverlay = new qx.ui.form.CheckBox("On-grid overlay (Ctrl-hold)").set({
                    value: MM.settings.get("BaseTools.UpgradeOverlay", true),
                    alignY: "middle",
                    toolTipText: "When on, hold Ctrl while viewing your own base to see a translucent gain/cost overlay on each resource-producing tile (Harvester, Silo, PowerPlant, Accumulator, Refinery). Best = green, worst = red, label is the ratio. Release Ctrl to hide. Salvaged from xTr1m's Base Overlay (retired)."
                });
                cbOverlay.addListener("changeValue", function (e) { MM.settings.set("BaseTools.UpgradeOverlay", !!e.getData()); });
                ctrls.add(cbOverlay);
                var btnUpgradeTop = new qx.ui.form.Button("Go").set({ toolTipText: "Upgrade the top N rows in the list below (in the current sort order). Re-validates each row before firing it so resource drains from earlier rows are accounted for; if 'Transfer as needed' is on, will transfer Tiberium in from other bases when the local base is short." });
                ctrls.add(btnUpgradeTop);
                page.add(ctrls);

                var infoLbl = new qx.ui.basic.Label("").set({ rich: true, wrap: true, allowGrowX: true, textColor: "#aaaaaa" });
                page.add(infoLbl);

                // ---- the table (hand-rolled sortable grid in a Scroll) ----
                var scroll = new qx.ui.container.Scroll();
                var grid = new qx.ui.container.Composite(new qx.ui.layout.Grid(10, 3));
                scroll.add(grid);
                page.add(scroll, { flex: 1 });

                // Column definitions: key into the candidate object, header text, how to render, sort accessor.
                var COLS = [
                    { key: "res",        title: "Res",      tip: "Which RESOURCE this upgrade boosts (Tib / Cry / Pow / $=Credits). The building type itself is in the Building column.", get: function (c) { return resTag(c.res); }, sort: function (c) { return c.res; }, align: "left" },
                    { key: "cityName",   title: "Base",     get: function (c) { return c.cityName; },   sort: function (c) { return String(c.cityName).toLowerCase(); }, align: "left" },
                    { key: "typeName",   title: "Building", get: function (c) { return c.typeName + " (" + c.posX + ":" + c.posY + ")"; }, sort: function (c) { return c.typeName; }, align: "left" },
                    { key: "targetLevel",title: "→Lvl", get: function (c) { return String(c.targetLevel); }, sort: function (c) { return c.targetLevel; }, align: "right" },
                    { key: "gainPerHour",title: "Gain/h",   get: function (c) { return fmtNum(c.gainPerHour); }, sort: function (c) { return c.gainPerHour; }, align: "right" },
                    { key: "costTib",    title: "Tib cost", get: function (c) { return c.costTib ? fmtNum(c.costTib) : "-"; }, sort: function (c) { return c.costTib; }, align: "right" },
                    { key: "costPow",    title: "Pow cost", get: function (c) { return c.costPow ? fmtNum(c.costPow) : "-"; }, sort: function (c) { return c.costPow; }, align: "right" },
                    { key: "tibPerGain", title: "Tib/gain", get: function (c) { return c.costTib ? fmtNum(c.tibPerGain) : "-"; }, sort: function (c) { return c.tibPerGain; }, align: "right" },
                    { key: "powPerGain", title: "Pow/gain", get: function (c) { return c.costPow ? fmtNum(c.powPerGain) : "-"; }, sort: function (c) { return c.powPerGain; }, align: "right" },
                    { key: "etaSeconds", title: "ETA",      get: function (c) { return c.etaSeconds > 0 ? fmtTime(c.etaSeconds) : "now"; }, sort: function (c) { return c.etaSeconds; }, align: "right" },
                    // Credit fee to transfer in the missing Tiberium (only on qualified transfer rows).
                    // Sort puts the cheapest transfers first; non-transfer rows sink to the bottom.
                    { key: "transferCost", title: "Xfer $", get: function (c) { return (c.state === 2 && c.transferQualified) ? fmtNum(c.transferCost) : "-"; }, sort: function (c) { return (c.state === 2 && c.transferQualified) ? c.transferCost : Infinity; }, align: "right" }
                ];
                var ACTION_COL = COLS.length; // the upgrade button column index

                var data = [];           // current candidate list
                var sortCol = -1;        // -1 => default sort by ticks (payoff time) ascending
                var sortDir = 1;         // 1 asc, -1 desc
                var doneState = {};       // building id -> 'done' | 'failed' (survives re-sort; cleared on full Refresh)
                var filtersRestored = false, suppressFilterEvents = false; // for player-id-gated filter restore

                // Select the option whose model matches `model` in a SelectBox.
                function selectByModel(sb, model) {
                    try {
                        var items = sb.getSelectables ? sb.getSelectables() : sb.getChildren();
                        for (var i = 0; i < items.length; i++) {
                            if (items[i].getModel && items[i].getModel() === model) { sb.setSelection([items[i]]); return; }
                        }
                    } catch (e) {}
                }

                // Restore the filter controls from settings ONCE, but only after the player id is loaded
                // (before that the settings store resolves to the default bucket and we'd read defaults -
                // exactly why "Show" wasn't sticking). Called from refreshTab, which runs on tab appear.
                function restoreFiltersOnce() {
                    if (filtersRestored) return;
                    var pid = 0; try { pid = ClientLib.Data.MainData.GetInstance().get_Player().get_Id(); } catch (e) {}
                    if (!pid) return; // wait for player id
                    filtersRestored = true;
                    suppressFilterEvents = true;
                    try {
                        selectByModel(showSelect, MM.settings.get("BaseTools.UpgradeShowMode", "transfer"));
                        selectByModel(resSelect, MM.settings.get("BaseTools.UpgradeResourceFilter", "All"));
                        keepUpgraded = MM.settings.get("BaseTools.UpgradeKeepRows", true);
                        cbKeep.setValue(keepUpgraded);
                        spinTopN.setValue(MM.settings.get("BaseTools.UpgradeTopN", 5));
                        wlog("restored filters: show=" + currentMode() + " res=" + (resSelect.getSelection()[0] && resSelect.getSelection()[0].getModel()) + " keep=" + keepUpgraded);
                    } catch (e) { werr("restoreFiltersOnce failed:", e); }
                    suppressFilterEvents = false;
                }

                // Readable palette: all data cells are near-white so nothing is hard to read (the old
                // amber-everything was the readability problem). State is conveyed by the Action column.
                var COLOR_DATA = "#e6e6e6";
                var COLOR_OK = "#7ee07e";    // upgraded (green)
                var COLOR_WAIT = "#ffb74d";  // not affordable yet - amber, bold (red was hard to read)
                var COLOR_FAIL = "#ff8a8a";  // failed action (readable red)
                function boldLabel(lbl) { try { lbl.setFont(qx.bom.Font.fromString("bold 11px sans-serif")); } catch (e) {} return lbl; }
                // Uniform, rounded status badge so the Action column reads cleanly (fixed width + centered
                // text means every badge is the same size instead of shrink-wrapping to its text).
                function makeBadge(text, fg, bg, tip) {
                    var lbl = new qx.ui.basic.Label(text).set({
                        textColor: fg, width: 120, textAlign: "center", paddingTop: 3, paddingBottom: 3
                    });
                    try { lbl.setDecorator(new qx.ui.decoration.Decorator().set({ radius: 4, backgroundColor: bg })); }
                    catch (e) { try { lbl.setBackgroundColor(bg); } catch (e2) {} }
                    if (tip) lbl.setToolTipText(tip);
                    return boldLabel(lbl);
                }

                function fmtNum(n) {
                    if (typeof n !== "number" || !isFinite(n)) return "-";
                    return MM.num.compact(Math.round(n), 1);
                }
                // Light, readable resource tints for the short Res tag only.
                function resColor(res) {
                    return { Tib: "#8fe08f", Cry: "#8fc4ff", Pow: "#ece28a", Dol: "#e6c08f" }[res] || COLOR_DATA;
                }
                // Display tag for the Res column (internal key stays "Dol"; "$" reads clearer than "Dol").
                function resTag(res) {
                    return { Tib: "Tib", Cry: "Cry", Pow: "Pow", Dol: "$" }[res] || res;
                }

                function sortedData() {
                    var arr = data.slice();
                    if (sortCol < 0) {
                        arr.sort(function (a, b) { return a.ticks - b.ticks; }); // default: fastest payoff first
                    } else {
                        var acc = COLS[sortCol].sort;
                        arr.sort(function (a, b) {
                            var va = acc(a), vb = acc(b);
                            if (va < vb) return -1 * sortDir;
                            if (va > vb) return 1 * sortDir;
                            return 0;
                        });
                    }
                    return arr;
                }

                function headerLabel(col, idx) {
                    var arrow = "";
                    if (sortCol === idx) arrow = sortDir > 0 ? " ▲" : " ▼";
                    var h = new qx.ui.basic.Label("<b>" + col.title + arrow + "</b>").set({
                        rich: true, textColor: "#ffffff", cursor: "pointer",
                        toolTipText: (col.tip ? col.tip + "\n\n" : "") + "Click to sort by " + col.title
                    });
                    h.addListener("click", function () {
                        if (sortCol === idx) { sortDir = -sortDir; } else { sortCol = idx; sortDir = 1; }
                        renderRows();
                    });
                    if (col.align) h.setTextAlign(col.align);
                    return h;
                }

                function renderRows() {
                    try {
                        var kids = grid.removeAll();
                        for (var ki = 0; ki < kids.length; ki++) { try { kids[ki].destroy(); } catch (e) {} }
                    } catch (e) {}

                    // header
                    for (var c = 0; c < COLS.length; c++) grid.add(headerLabel(COLS[c], c), { row: 0, column: c });
                    grid.add(new qx.ui.basic.Label("<b>Action</b>").set({ rich: true, textColor: "#ffffff" }), { row: 0, column: ACTION_COL });

                    var rows = sortedData();
                    if (!rows.length) {
                        grid.add(new qx.ui.basic.Label("(nothing to show - try the 'Show' filter, e.g. 'All candidates')").set({ textColor: "#888888" }), { row: 1, column: 0, colSpan: ACTION_COL + 1 });
                        return;
                    }
                    for (var r = 0; r < rows.length; r++) {
                        var cand = rows[r], rowIdx = r + 1;
                        for (var cc = 0; cc < COLS.length; cc++) {
                            var col = COLS[cc];
                            var lbl = new qx.ui.basic.Label(col.get(cand));
                            if (col.align) lbl.setTextAlign(col.align);
                            lbl.setTextColor(cc === 0 ? resColor(cand.res) : COLOR_DATA);
                            grid.add(lbl, { row: rowIdx, column: cc });
                        }
                        grid.add(makeUpgradeCell(cand), { row: rowIdx, column: ACTION_COL });
                    }
                }

                // Mark a candidate done/failed so the indicator survives a re-sort, then update its live cell.
                function markDone(cand, ok) {
                    doneState[cand.id] = ok ? "done" : "failed";
                    if (cand._btn) {
                        try {
                            cand._btn.setEnabled(false);
                            cand._btn.setLabel(ok ? "✓ Upgraded" : "✗ failed");
                        } catch (e) {}
                    }
                }

                // Dynamic-dismiss mode: drop a successfully-upgraded row out of the list and re-render
                // (just this removal - no full recompute, so nothing else reshuffles).
                function dismissRow(cand) {
                    var idx = data.indexOf(cand);
                    if (idx >= 0) data.splice(idx, 1);
                    delete doneState[cand.id];
                    renderRows();
                }

                function doUpgrade(cand, viaTransfer) {
                    if (cand._btn) { try { cand._btn.setEnabled(false); cand._btn.setLabel("..."); } catch (e) {} }
                    var fn = viaTransfer ? autoTransferAndUpgrade : sendUpgrade;
                    fn(cand, function (ok) {
                        markDone(cand, ok);
                        // Keep mode: leave the "✓ Upgraded" row in place until Refresh.
                        // Dismiss mode: on success, slide the row out immediately (old-tool behavior);
                        // on failure leave it visible (marked "✗ failed") so you know it didn't take.
                        if (!keepUpgraded && ok) dismissRow(cand);
                    });
                }

                function makeUpgradeCell(cand) {
                    // Already acted on this render-cycle? Show the sticky status as a readable badge.
                    if (doneState[cand.id]) {
                        var ok = doneState[cand.id] === "done";
                        return makeBadge(ok ? "✓ Upgraded" : "✗ failed", ok ? "#bff5bf" : "#ffc9c9", ok ? "#1e4d1e" : "#5a1e1e");
                    }
                    if (cand.state === 1) {
                        var btn = new qx.ui.form.Button("⬆ Upgrade").set({ appearance: "button-text-small", toolTipText: "Upgrade this building now" });
                        cand._btn = btn;
                        btn.addListener("execute", function () { doUpgrade(cand, false); });
                        return btn;
                    }
                    // state 2: offer Transfer & Upgrade ONLY when pre-qualified (transfers can cover the
                    // shortfall AND the player can afford the credit fee). The fee is shown on the button
                    // and in the sortable "Xfer $" column.
                    if (cand.state === 2 && cand.transferQualified) {
                        var costStr = (cand.transferCost != null) ? " (" + fmtNum(cand.transferCost) + ")" : "";
                        var tbtn = new qx.ui.form.Button("⇄ Transfer & Upgrade" + costStr).set({
                            appearance: "button-text-small",
                            toolTipText: "Pull the missing Tiberium from your other bases (cheapest first), then upgrade.\nTransfer fee: " + fmtNum(cand.transferCost || 0) + " credits."
                        });
                        cand._btn = tbtn;
                        tbtn.addListener("execute", function () { doUpgrade(cand, true); });
                        return tbtn;
                    }
                    // state 3, or a transfer that doesn't qualify (can't cover it, or can't afford the fee).
                    // Show the countdown to when it'll be affordable (from this base's own production).
                    // Rendered as a dark badge with bright text so it stays readable on any row background
                    // (the window's row colour shifts between light/dark depending on focus, which is what
                    // made plain coloured text hard to read).
                    var waitTip = (cand.state === 2)
                        ? "Could be covered by transfer, but you can't afford the transfer fee right now"
                        : "Affordable in about " + (cand.etaSeconds > 0 ? fmtTime(cand.etaSeconds) : "?") + " from this base's production";
                    var waitTxt = (cand.etaSeconds > 0) ? ("⏳ " + fmtTime(cand.etaSeconds)) : "wait";
                    return makeBadge(waitTxt, "#ffe08a", "#4a3814", waitTip);
                }

                // ---- batch upgrade: walk the visible, sorted rows; re-validate each before firing ----
                // Same "no reshuffle" rule for the table layout, but the QUEUE is RE-VALIDATED against
                // live resources before each row fires. Reason: a successful upgrade drains the local
                // base, so the next row in the snapshot may have become unaffordable - the old version
                // captured states at start and fired blind, which is how rows that were "Upgrade"-state
                // at snapshot time failed silently when their tiberium had already been spent by an
                // earlier row.
                //
                // Per-row decision (liveEval): check local Power (can't transfer it); check local
                // Tiberium; if short and "Transfer as needed" is ON, see if planTransfer() covers it
                // within the player's credit budget; otherwise skip the row with a reason.
                //
                // Final summary names exactly what happened: "Done. Processed N of M, X via transfer,
                // Y failed, Z skipped (<last skip reason>)." This is the feedback that was missing.

                var batchRunning = false;

                // Re-evaluate a candidate against live state. Returns one of:
                //   { action: 'upgrade' }              -> local base has enough; just upgrade
                //   { action: 'transfer-upgrade' }     -> local base short on Tib but a transfer plan
                //                                         exists and the credit fee is affordable
                //   { action: 'skip', reason: '...' }  -> can't proceed (caller surfaces the reason)
                function liveEvalCandidate(cand, xferOn) {
                    try {
                        var city = getCityById(cand.cityId);
                        if (!city) return { action: 'skip', reason: 'base unavailable' };
                        var ERT = ClientLib.Base.EResourceType;
                        if (city.get_IsLocked && city.get_IsLocked()) return { action: 'skip', reason: 'base is locked' };
                        if (cand.costPow && city.GetResourceCount(ERT.Power) < cand.costPow) {
                            return { action: 'skip', reason: 'not enough power' };
                        }
                        var tibHave = cand.costTib ? city.GetResourceCount(ERT.Tiberium) : Infinity;
                        if (!cand.costTib || tibHave >= cand.costTib) return { action: 'upgrade' };
                        // Local Tib short. Try transfer only if the user enabled it.
                        if (!xferOn) return { action: 'skip', reason: 'not enough tiberium (enable "Transfer as needed" to pull from other bases)' };
                        var pl = planTransfer(cand);
                        if (!pl || !pl.feasible) return { action: 'skip', reason: 'no transfer plan can cover the gap' };
                        if (playerCredits() < pl.totalCost) return { action: 'skip', reason: "can't afford transfer fee (" + MM.num.compact(Math.round(pl.totalCost), 1) + " credits)" };
                        return { action: 'transfer-upgrade', plan: pl };
                    } catch (e) { werr("liveEvalCandidate:", e); return { action: 'skip', reason: 'eval error - see console' }; }
                }

                function upgradeTopN(n) {
                    if (batchRunning) return;
                    // Snapshot the queue from the current sort order. We DON'T pre-filter by state
                    // anymore - liveEvalCandidate revisits each row's state at execute time so resource
                    // drains from earlier rows propagate.
                    var queue = sortedData().filter(function (c) { return !doneState[c.id]; }).slice(0, n);
                    if (!queue.length) { infoLbl.setValue("Nothing to upgrade."); return; }
                    var xferOn = cbTopXfer.getValue();
                    batchRunning = true;
                    var i = 0, processed = 0, transferred = 0, failed = 0, skipped = 0;
                    var lastSkipReason = "";

                    function finish() {
                        batchRunning = false;
                        if (!keepUpgraded) {
                            data = data.filter(function (c) { return doneState[c.id] !== "done"; });
                            queue.forEach(function (c) { if (doneState[c.id] === "done") delete doneState[c.id]; });
                            renderRows();
                        }
                        var parts = ["Processed " + processed + " of " + queue.length];
                        if (transferred) parts.push(transferred + " via transfer");
                        if (failed)      parts.push(failed + " failed");
                        if (skipped)     parts.push(skipped + " skipped" + (lastSkipReason ? " (last: " + lastSkipReason + ")" : ""));
                        infoLbl.setValue("Done. " + parts.join(", ") + "." + (keepUpgraded ? " Click Refresh to recompute the list." : ""));
                    }
                    function step() {
                        if (i >= queue.length) { finish(); return; }
                        var cand = queue[i++];
                        if (doneState[cand.id]) { window.setTimeout(step, 0); return; }   // already acted on (single-row click during batch)
                        if (cand._btn) { try { cand._btn.setEnabled(false); cand._btn.setLabel("..."); } catch (e) {} }
                        var ev = liveEvalCandidate(cand, xferOn);
                        if (ev.action === 'skip') {
                            skipped++; lastSkipReason = ev.reason || lastSkipReason;
                            markDone(cand, false);
                            // Override the "✗ failed" label with the skip reason so the row is honest.
                            if (cand._btn) { try { cand._btn.setLabel("⏭ " + ev.reason); cand._btn.setToolTipText(ev.reason); } catch (e) {} }
                            infoLbl.setValue("Skipped " + i + "/" + queue.length + " (" + ev.reason + "): " + cand.typeName + " in " + cand.cityName);
                            window.setTimeout(step, 50);
                            return;
                        }
                        var viaTransfer = ev.action === 'transfer-upgrade';
                        var fn = viaTransfer ? autoTransferAndUpgrade : sendUpgrade;
                        infoLbl.setValue((viaTransfer ? "Transfer + upgrade " : "Upgrading ") + i + "/" + queue.length + ": " + cand.typeName + " in " + cand.cityName + "...");
                        fn(cand, function (ok) {
                            markDone(cand, ok);
                            if (ok) { processed++; if (viaTransfer) transferred++; }
                            else { failed++; }
                            // Slightly longer settle after a transfer (the game needs a tick to credit the
                            // tiberium before the next row's liveEval reads the new totals).
                            window.setTimeout(step, viaTransfer ? 400 : 200);
                        });
                    }
                    step();
                }

                function currentMode() {
                    var sel = showSelect.getSelection()[0];
                    return sel ? sel.getModel() : "transfer";
                }
                function currentFilterOpts() {
                    // "now" can skip computing the unaffordable ones; the other modes need them computed
                    // (so transfer plans get built and not-yet-affordable rows can be shown).
                    return { showAll: currentMode() !== "now" };
                }
                function applyAvailabilityFilter(list) {
                    var mode = currentMode();
                    if (mode === "now") return list.filter(function (c) { return c.state === 1; });
                    if (mode === "transfer") return list.filter(function (c) { return c.state === 1 || (c.state === 2 && c.transferQualified); });
                    return list; // "all"
                }
                function applyResourceFilter(all) {
                    var sel = resSelect.getSelection()[0];
                    var res = sel ? sel.getModel() : "All";
                    if (res === "All") return all;
                    return all.filter(function (c) { return c.res === res; });
                }
                function currentBaseFilter() {
                    var sel = baseSelect.getSelection()[0];
                    return sel ? sel.getModel() : "All";
                }
                function applyBaseFilter(all) {
                    var bf = currentBaseFilter();
                    if (bf === "All") return all;
                    return all.filter(function (c) { return String(c.cityId) === bf; });
                }

                function refreshTab() {
                    try {
                        restoreFiltersOnce();  // player-id-gated: restore saved Show/Resource/Keep/TopN once
                        rebuildBaseOptions(); // (re)populate the Base dropdown now that city data is available
                        doneState = {}; // full recompute: forget previous "✓ Upgraded" marks (levels/costs changed)
                        var all = computeUpgradeCandidates(currentFilterOpts());
                        data = applyResourceFilter(applyBaseFilter(applyAvailabilityFilter(all)));
                        renderRows();
                        var aff = 0, xfer = 0;
                        for (var i = 0; i < data.length; i++) { if (data[i].state === 1) aff++; else if (data[i].state === 2 && data[i].transferQualified) xfer++; }
                        infoLbl.setValue(data.length + " candidate(s), " + aff + " upgradeable now" + (xfer ? ", " + xfer + " via transfer" : "") + ". Click a column header to sort (try 'Xfer $' for cheapest transfers).");
                    } catch (e) { werr("upgrade refreshTab failed:", e); }
                }

                btnRefresh.addListener("execute", refreshTab);
                baseSelect.addListener("changeSelection", function () {
                    if (suppressBaseEvent) return; // ignore selection changes caused by rebuilding the list
                    MM.settings.set("BaseTools.UpgradeBaseFilter", currentBaseFilter());
                    refreshTab();
                });
                showSelect.addListener("changeSelection", function () {
                    if (suppressFilterEvents) return;
                    MM.settings.set("BaseTools.UpgradeShowMode", currentMode());
                    refreshTab();
                });
                cbKeep.addListener("changeValue", function (e) {
                    keepUpgraded = !!e.getData();
                    MM.settings.set("BaseTools.UpgradeKeepRows", keepUpgraded);
                    wlog("UpgradeKeepRows =", keepUpgraded);
                });
                resSelect.addListener("changeSelection", function () {
                    if (suppressFilterEvents) return;
                    var sel = resSelect.getSelection()[0];
                    MM.settings.set("BaseTools.UpgradeResourceFilter", sel ? sel.getModel() : "All");
                    refreshTab();
                });
                spinTopN.addListener("changeValue", function (e) { MM.settings.set("BaseTools.UpgradeTopN", Number(e.getData()) || 5); });
                btnUpgradeTop.addListener("execute", function () { upgradeTopN(spinTopN.getValue()); });
                page.addListener("appear", refreshTab);
                return page;
            }

            var pageUpg = buildUpgradeTab();
            tabView.add(pageUpg);

            // ---- Tab 4: Layout Optimizer (Phase A - recommend-only) ----------------
            // Four buttons (Tiberium / Crystal / Power / Credits); each runs the OPT engine on the
            // chosen base and shows the recommended building moves as (a) a summary, (b) a move list,
            // and (c) an in-tab mini-map of the base with the proposed layout highlighted. Nothing is
            // applied to the game - this is advice only (Phase B auto-apply is a later batch).
            function buildOptimizerTab() {
                var page = new qx.ui.tabview.Page("Layout Optimizer");
                page.setLayout(new qx.ui.layout.VBox(6));
                page.setPadding(8);
                var TILE = 38; // grid tile size in px
                var lastRes = null;   // the most recent optimize result (the apply plan source); null = showing current layout only

                function currentOwnCity() { try { return ClientLib.Data.MainData.GetInstance().get_Cities().get_CurrentOwnCity(); } catch (e) { return null; } }

                // ---- controls row 1: base + resource buttons (Flow so it wraps when the window is narrow) ----
                var ctrls = new qx.ui.container.Composite(new qx.ui.layout.Flow(6, 6));
                var baseGroup = new qx.ui.container.Composite(new qx.ui.layout.HBox(4));
                baseGroup.add(new qx.ui.basic.Label("Base:").set({ alignY: "middle" }));
                var baseSelect = new qx.ui.form.SelectBox().set({ width: 150, alignY: "middle" });
                var suppressBase = false, baseBuilt = false;
                function selectedBaseId() { var s = baseSelect.getSelection()[0]; return s ? s.getModel() : "current"; }
                function selectedCity() { var bid = selectedBaseId(); return (bid === "current") ? currentOwnCity() : getCityById(bid); }
                function rebuildBases() {
                    var prev = baseBuilt ? selectedBaseId() : "current";
                    baseBuilt = true; suppressBase = true;
                    try {
                        try { baseSelect.removeAll(); } catch (e) {}
                        var itC = new qx.ui.form.ListItem("Current base"); itC.setModel("current"); baseSelect.add(itC);
                        var list = [];
                        eachOwnCity(function (c) { try { if (c.get_IsGhostMode && c.get_IsGhostMode()) return; list.push({ id: String(c.get_Id()), name: c.get_Name() }); } catch (e) {} });
                        list.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
                        var sel = itC;
                        for (var i = 0; i < list.length; i++) { var it = new qx.ui.form.ListItem(list[i].name); it.setModel(list[i].id); baseSelect.add(it); if (list[i].id === prev) sel = it; }
                        baseSelect.setSelection([sel]);
                    } catch (e) { werr("OPT rebuildBases failed:", e); }
                    suppressBase = false;
                }
                baseSelect.addListener("changeSelection", function () { if (suppressBase) return; renderCurrent(); });
                baseGroup.add(baseSelect);
                ctrls.add(baseGroup);

                var RESBTN = [
                    { key: "Tib", label: "Tiberium", color: "#8fe08f" },
                    { key: "Cry", label: "Crystal",  color: "#8fc4ff" },
                    { key: "Pow", label: "Power",    color: "#ece28a" },
                    { key: "Dol", label: "Credits",  color: "#e6c08f" }
                ];
                RESBTN.forEach(function (r) {
                    var b = new qx.ui.form.Button(r.label).set({ toolTipText: "Optimize this base's layout to maximize " + r.label + " production" });
                    try { b.setTextColor(r.color); } catch (e) {}
                    b.addListener("execute", function () { runOptimize(r.key); });
                    ctrls.add(b);
                });
                page.add(ctrls);

                // ---- controls row 2: search settings + sell (Flow; each label+spinner stays grouped) ----
                var setRow = new qx.ui.container.Composite(new qx.ui.layout.Flow(8, 6));
                function spinner(label, key, def, min, max, tip) {
                    var grp = new qx.ui.container.Composite(new qx.ui.layout.HBox(4));
                    grp.add(new qx.ui.basic.Label(label).set({ alignY: "middle", toolTipText: tip }));
                    var sp = new qx.ui.form.Spinner(min, MM.settings.get(key, def), max).set({ width: 58, alignY: "middle", toolTipText: tip });
                    sp.addListener("changeValue", function (e) { MM.settings.set(key, Number(e.getData()) || def); });
                    grp.add(sp); setRow.add(grp); return sp;
                }
                var spRounds = spinner("Rounds:", "BaseTools.OptRounds", 30, 5, 200, "Improvement passes per attempt. Higher = more thorough but slower.");
                var spNeigh = spinner("Neighbors:", "BaseTools.OptNeighbors", 16, 4, 72, "How many candidate destination tiles to test per building each pass. Higher = more thorough but slower.");
                var spKicks = spinner("Kicks:", "BaseTools.OptKicks", 3, 0, 20, "Random shake-ups to escape a 'good but not best' layout and explore a different arrangement. More = explores more but slower.");
                var spSell = spinner("Sell up to:", "BaseTools.OptSellN", 0, 0, 6, "Also recommend up to N least-impactful resource buildings to DEMOLISH (free up tiles) for a bigger gain. 0 = don't sell anything. It only suggests a sale if it actually increases the chosen resource.");
                // "Allow reductions" - widen the search to consider moves that improve the target resource
                // AT THE COST of other resources. Score = target_gain - 0.5*sum(other losses), so the
                // optimizer is willing to take a -200 Tib loss for a +101 Crystal gain but NOT a +99 gain.
                // OFF by default so the optimizer stays strict (only no-loss-in-others moves) unless the
                // user explicitly opts in. The net-change table in the results shows what's been traded.
                var cbAllowRed = new qx.ui.form.CheckBox("Allow reductions").set({
                    value: !!MM.settings.get("BaseTools.OptAllowReductions", false),
                    alignY: "middle",
                    toolTipText: "OFF (default): only suggest moves that improve the chosen resource without hurting the others. Strict but limited - a swap that's blocked by, say, a Refinery in the way is never considered.\n\nON: widen the search to ALL resource buildings and let the optimizer trade small losses in other resources for a larger target gain (score = target_gain - 0.5 * sum_of_other_losses). The results panel shows the net change for all 4 resources so you can see exactly what's being traded."
                });
                cbAllowRed.addListener("changeValue", function (e) { MM.settings.set("BaseTools.OptAllowReductions", !!e.getData()); });
                setRow.add(cbAllowRed);
                page.add(setRow);

                // ---- Apply row: one-click auto-apply of the proposed layout (Phase B) ----
                var applyRow = new qx.ui.container.Composite(new qx.ui.layout.HBox(8));
                var applyBtn = new qx.ui.form.Button("Apply to base").set({ enabled: false, toolTipText: "Move (and, if proposed, demolish) buildings in-game to match the proposed layout. Shows a confirmation with exactly what will change first." });
                try { applyBtn.setTextColor("#7ee07e"); } catch (e) {}
                applyBtn.addListener("execute", function () { onApply(); });
                applyRow.add(applyBtn, { flex: 0 });
                applyRow.add(new qx.ui.basic.Label("Run an optimize first, then apply the proposed moves to your base.").set({ rich: true, alignY: "middle", textColor: "#999999" }), { flex: 1 });
                page.add(applyRow);
                function setApplyEnabled(on) { try { applyBtn.setEnabled(!!on); } catch (e) {} }

                var summary = new qx.ui.basic.Label("").set({ rich: true, wrap: true, allowGrowX: true, textColor: "#cccccc" });
                page.add(summary);

                // ---- body: single vertical column (map on top, legend + results below) inside one scroll,
                // so the whole panel wraps and the window can be made narrow. ----
                var scrollAll = new qx.ui.container.Scroll();
                var contentCol = new qx.ui.container.Composite(new qx.ui.layout.VBox(8));
                scrollAll.add(contentCol);
                page.add(scrollAll, { flex: 1 });

                var mapBox = new qx.ui.container.Composite(new qx.ui.layout.VBox(4));
                var mapTitle = new qx.ui.basic.Label("<b>Base layout</b>").set({ rich: true, textColor: "#ffffff" });
                mapBox.add(mapTitle);
                var grid = new qx.ui.container.Composite(new qx.ui.layout.Grid(2, 2));
                mapBox.add(grid);
                contentCol.add(mapBox);

                var rightBox = new qx.ui.container.Composite(new qx.ui.layout.VBox(6));
                contentCol.add(rightBox);

                // ---- icon + label helpers ----
                var ABBR = { Harvester: "H", Silo: "S", PowerPlant: "P", Accumulator: "A", Refinery: "R", Construction_Yard: "CY", Defense_HQ: "DHQ", Defense_Facility: "DEF", Support_Art: "SUP" };
                function abbrOf(b) { if (b.techName === "Harvester") return b.harvRes === "Cry" ? "Hc" : "Ht"; var a = ABBR[b.techName]; return a == null ? b.techName.slice(0, 3) : a; }
                function nameOf(b) { return (b.techName === "Harvester" ? (b.harvRes === "Cry" ? "Crystal Harvester" : "Tiberium Harvester") : b.techName.replace(/_/g, " ")); }
                function typeColor(b) { if (b.techName === "Harvester") return b.harvRes === "Cry" ? "#8fc4ff" : "#8fe08f"; return { Silo: "#dddddd", PowerPlant: "#ece28a", Accumulator: "#d8b0ff", Refinery: "#e6c08f" }[b.techName] || "#bbbbbb"; }
                function terrBg(t) { return t === "TIBERIUM" ? "#173117" : (t === "CRYSTAL" ? "#152340" : (t === "NONE" ? "#2a2a2a" : "#101010")); }
                function iconUrlOf(snap, b) { var I = snap.icons || {}; if (b.techName === "Harvester") return b.harvRes === "Cry" ? I.HarvCry : I.HarvTib; return I[b.techName] || null; }

                // A single grid cell built with a Canvas layout so we can stack: terrain bg, building icon
                // (or letter), level (bottom-right), and a move/sell badge (top-left).
                function makeCell(opts) {
                    var comp = new qx.ui.container.Composite(new qx.ui.layout.Canvas()).set({ width: TILE, height: TILE });
                    var bg = opts.bg || "#1a1a1a", border = opts.border || "#000000", bw = opts.borderWidth || 1;
                    try { comp.setDecorator(new qx.ui.decoration.Decorator().set({ width: bw, color: border, style: "solid", backgroundColor: bg })); } catch (e) {}
                    if (opts.tip) comp.setToolTipText(opts.tip);
                    if (opts.iconUrl) {
                        // The game's detail-view icons are wide (~2:1): building on the LEFT, a grey detail
                        // panel on the right. Crop to the left square (overflow-hidden wrapper + full-height
                        // img) so only the clean building icon shows - bigger and centred in the tile.
                        var W = TILE - 6, off = Math.round((TILE - W) / 2);
                        var html = "<div style='width:" + W + "px;height:" + W + "px;overflow:hidden;border-radius:3px;" + (opts.dim ? "opacity:0.4;" : "") + "'>" +
                                   "<img src='" + opts.iconUrl + "' style='height:" + W + "px;display:block;' /></div>";
                        var ic = new qx.ui.basic.Label(html).set({ rich: true });
                        comp.add(ic, { left: off, top: off });
                    } else if (opts.text != null) {
                        var t = new qx.ui.basic.Label(String(opts.text)).set({ rich: true, textColor: opts.fg || "#cccccc", textAlign: "center", width: TILE - 2 });
                        comp.add(t, { left: 1, top: Math.round(TILE / 2) - 8 });
                    }
                    if (opts.level != null) {
                        var lv = new qx.ui.basic.Label(String(opts.level)).set({ rich: true, textColor: "#ffffff", font: qx.bom.Font.fromString("bold 9px sans-serif") });
                        try { lv.setDecorator(new qx.ui.decoration.Decorator().set({ backgroundColor: "rgba(0,0,0,0.6)" })); } catch (e) {}
                        comp.add(lv, { right: 0, bottom: 0 });
                    }
                    if (opts.badge != null) {
                        var bd = new qx.ui.basic.Label(String(opts.badge)).set({ rich: true, textColor: opts.badgeFg || "#ffffff", textAlign: "center", width: 14, font: qx.bom.Font.fromString("bold 9px sans-serif") });
                        try { bd.setDecorator(new qx.ui.decoration.Decorator().set({ radius: 7, backgroundColor: opts.badgeBg || "#1e6e1e" })); } catch (e) {}
                        comp.add(bd, { left: 0, top: 0 });
                    }
                    return comp;
                }

                // Render any layout: pos = {id->{x,y}} of buildings to draw; moves/sells overlay markers.
                function renderLayout(snap, pos, moves, sells) {
                    try { var kids = grid.removeAll(); for (var ki = 0; ki < kids.length; ki++) { try { kids[ki].destroy(); } catch (e) {} } } catch (e) {}
                    if (!snap) return;
                    moves = moves || []; sells = sells || [];
                    var occ = []; for (var y = 0; y < OPT.GRID_H; y++) { occ.push([]); for (var x = 0; x < OPT.GRID_W; x++) occ[y].push(null); }
                    for (var id in pos) { var p = pos[id]; if (p && snap.buildings[id]) occ[p.y][p.x] = snap.buildings[id]; }
                    var moved = {}, moveNum = {};
                    for (var mi = 0; mi < moves.length; mi++) { moved[moves[mi].id] = mi + 1; }
                    var vacated = {};
                    for (var mj = 0; mj < moves.length; mj++) { var mv = moves[mj]; if (!occ[mv.fromY][mv.fromX]) vacated[mv.fromX + "," + mv.fromY] = mj + 1; }
                    var soldAt = {};
                    for (var si = 0; si < sells.length; si++) { soldAt[sells[si].x + "," + sells[si].y] = sells[si]; }

                    for (var ry = 0; ry < OPT.GRID_H; ry++) for (var rx = 0; rx < OPT.GRID_W; rx++) {
                        var b = occ[ry][rx], terr = snap.terrain[ry][rx], key = rx + "," + ry, cell;
                        if (b) {
                            var n = moved[b.id];
                            cell = makeCell({ iconUrl: iconUrlOf(snap, b), text: iconUrlOf(snap, b) ? null : abbrOf(b), fg: typeColor(b),
                                level: b.level, bg: n ? "#1e6e1e" : terrBg(terr), border: n ? "#7ee07e" : "#000000", borderWidth: n ? 2 : 1,
                                badge: n || null, badgeBg: "#1e6e1e", badgeFg: "#eaffea",
                                tip: nameOf(b) + " L" + b.level + " @ " + rx + ":" + ry + (n ? " (moves here - #" + n + ")" : "") });
                        } else if (soldAt[key]) {
                            var sb = soldAt[key];
                            cell = makeCell({ iconUrl: iconUrlOf(snap, sb), text: iconUrlOf(snap, sb) ? null : abbrOf(sb), dim: true, bg: "#4a1414", border: "#ff8a8a", borderWidth: 2,
                                badge: "✕", badgeBg: "#8a1f1f", badgeFg: "#ffd6d6", tip: "SELL " + nameOf(sb) + " L" + sb.level + " @ " + rx + ":" + ry });
                        } else if (vacated[key]) {
                            cell = makeCell({ text: "&rarr;", fg: "#ff8a8a", bg: "#3a1414", border: "#7a2a2a", badge: vacated[key], badgeBg: "#7a2a2a", badgeFg: "#ffd6d6", tip: "tile vacated by move #" + vacated[key] });
                        } else {
                            cell = makeCell({ text: terr === "TIBERIUM" ? "t" : (terr === "CRYSTAL" ? "c" : ""), fg: "#5a5a5a", bg: terrBg(terr), tip: terr.toLowerCase() + " " + rx + ":" + ry });
                        }
                        grid.add(cell, { row: ry, column: rx });
                    }
                }

                // 8-way direction arrow for a move delta.
                function dirArrow(dx, dy) { var ax = dx < 0 ? -1 : (dx > 0 ? 1 : 0), ay = dy < 0 ? -1 : (dy > 0 ? 1 : 0); return ({ "0,-1": "↑", "0,1": "↓", "-1,0": "←", "1,0": "→", "-1,-1": "↖", "1,-1": "↗", "-1,1": "↙", "1,1": "↘", "0,0": "·" })[ax + "," + ay] || "·"; }

                // Legend + plain-English help (built once, static).
                function buildLegend() {
                    // Dark panel so the help text doesn't blend into the light-grey window background.
                    var panel = new qx.ui.container.Composite(new qx.ui.layout.VBox(4)).set({ padding: 8 });
                    try { panel.setDecorator(new qx.ui.decoration.Decorator().set({ radius: 5, backgroundColor: "#1b1b1b", width: 1, color: "#3a3a3a", style: "solid" })); }
                    catch (e) { try { panel.setBackgroundColor("#1b1b1b"); } catch (e2) {} }
                    panel.add(new qx.ui.basic.Label("<b>Legend</b>").set({ rich: true, textColor: "#ffffff" }));
                    panel.add(new qx.ui.basic.Label(
                        "Tiles show each building's icon + its <b>level</b> (corner).<br>" +
                        "<span style='color:#7ee07e'>&#9632;</span> green tile / #badge = building <b>moves here</b> (matching <span style='color:#ff8a8a'>&rarr;#</span> red tile = where it left).<br>" +
                        "<span style='color:#ff8a8a'>&#10006;</span> red tile = recommended <b>sell</b> (demolish).<br>" +
                        "Field tiles tinted: <span style='color:#7ed07e'>tiberium</span> / <span style='color:#8fc0ff'>crystal</span>.").set({ rich: true, wrap: true, allowGrowX: true, textColor: "#e6e6e6" }));
                    panel.add(new qx.ui.basic.Label(
                        "<b>Controls</b><br>" +
                        "<b>Rounds</b> &ndash; improvement passes per attempt (higher = more thorough, slower).<br>" +
                        "<b>Neighbors</b> &ndash; candidate destination tiles tested per building each pass.<br>" +
                        "<b>Kicks</b> &ndash; random shake-ups to escape a 'good-but-not-best' layout.<br>" +
                        "<b>Sell up to N</b> &ndash; also suggest demolishing up to N low-impact buildings to free tiles for a bigger gain (only if it helps).").set({ rich: true, wrap: true, allowGrowX: true, textColor: "#cfcfcf" }));
                    rightBox.add(panel);
                    rightBox.add(new qx.ui.core.Spacer(null, 6));
                }

                var resultBox = null; // sub-container for per-run move/sell list (so legend stays put)
                function ensureResultBox() {
                    if (resultBox) { try { var kids = resultBox.removeAll(); for (var ki = 0; ki < kids.length; ki++) { try { kids[ki].destroy(); } catch (e) {} } } catch (e) {} return resultBox; }
                    resultBox = new qx.ui.container.Composite(new qx.ui.layout.VBox(2)).set({ padding: 8 });
                    try { resultBox.setDecorator(new qx.ui.decoration.Decorator().set({ radius: 5, backgroundColor: "#1b1b1b", width: 1, color: "#3a3a3a", style: "solid" })); }
                    catch (e) { try { resultBox.setBackgroundColor("#1b1b1b"); } catch (e2) {} }
                    rightBox.add(resultBox);
                    return resultBox;
                }

                function renderResultList(res) {
                    var box = ensureResultBox();
                    if (!res || !res.ok) { box.add(new qx.ui.basic.Label(res && res.reason ? ("Could not optimize: " + res.reason) : "").set({ textColor: "#ff8a8a" })); return; }

                    // Net-change table across all 4 resources (always shown when we have startProd/bestProd,
                    // which optimize/optimizeWithSell now always produce - independent of allowReductions).
                    // In ALLOW REDUCTIONS mode this is the headline: it tells you what you're trading.
                    if (res.startProd && res.bestProd) {
                        var anyChange = false;
                        var rows = [];
                        var RES_ORDER = [["Tib", "Tiberium"], ["Cry", "Crystal"], ["Pow", "Power"], ["Dol", "Credits"]];
                        for (var rr = 0; rr < RES_ORDER.length; rr++) {
                            var rk = RES_ORDER[rr][0], lab = RES_ORDER[rr][1];
                            var sBefore = +res.startProd[rk] || 0, sAfter = +res.bestProd[rk] || 0;
                            var d = sAfter - sBefore;
                            var pct = sBefore > 0 ? (d / sBefore * 100) : 0;
                            if (Math.abs(d) > 0.5) anyChange = true;
                            rows.push({ key: rk, label: lab, before: sBefore, after: sAfter, delta: d, pct: pct, isTarget: rk === res.resKey });
                        }
                        if (anyChange || res.allowReductions) {
                            box.add(new qx.ui.basic.Label("<b>Net production change (continuous /h)</b>").set({ rich: true, textColor: "#ffffff" }));
                            var tbl = new qx.ui.container.Composite(new qx.ui.layout.Grid(8, 2));
                            tbl.add(new qx.ui.basic.Label("<b>Resource</b>").set({ rich: true, textColor: "#cfcfcf" }), { row: 0, column: 0 });
                            tbl.add(new qx.ui.basic.Label("<b>Before</b>").set({ rich: true, textColor: "#cfcfcf", textAlign: "right" }), { row: 0, column: 1 });
                            tbl.add(new qx.ui.basic.Label("<b>After</b>").set({ rich: true, textColor: "#cfcfcf", textAlign: "right" }), { row: 0, column: 2 });
                            tbl.add(new qx.ui.basic.Label("<b>Delta</b>").set({ rich: true, textColor: "#cfcfcf", textAlign: "right" }), { row: 0, column: 3 });
                            tbl.add(new qx.ui.basic.Label("<b>%</b>").set({ rich: true, textColor: "#cfcfcf", textAlign: "right" }), { row: 0, column: 4 });
                            for (var ri = 0; ri < rows.length; ri++) {
                                var row = rows[ri];
                                var clr = row.delta > 0.5 ? "#7ee07e" : (row.delta < -0.5 ? "#ff8a8a" : "#cccccc");
                                var rowName = row.label + (row.isTarget ? "  <span style='color:#ffe14d'>(target)</span>" : "");
                                var sign = row.delta > 0 ? "+" : "";
                                tbl.add(new qx.ui.basic.Label(rowName).set({ rich: true, textColor: row.isTarget ? "#ffe14d" : "#e6e6e6" }), { row: ri + 1, column: 0 });
                                tbl.add(new qx.ui.basic.Label(MM.num.compact(Math.round(row.before), 1)).set({ textColor: "#e6e6e6", textAlign: "right" }), { row: ri + 1, column: 1 });
                                tbl.add(new qx.ui.basic.Label(MM.num.compact(Math.round(row.after), 1)).set({ textColor: "#e6e6e6", textAlign: "right" }), { row: ri + 1, column: 2 });
                                tbl.add(new qx.ui.basic.Label(sign + MM.num.compact(Math.round(row.delta), 1)).set({ textColor: clr, textAlign: "right" }), { row: ri + 1, column: 3 });
                                tbl.add(new qx.ui.basic.Label(sign + row.pct.toFixed(1) + "%").set({ textColor: clr, textAlign: "right" }), { row: ri + 1, column: 4 });
                            }
                            box.add(tbl);
                            box.add(new qx.ui.core.Spacer(null, 6));
                        }
                    }

                    if (res.sells && res.sells.length) {
                        box.add(new qx.ui.basic.Label("<b style='color:#ff8a8a'>Sell (" + res.sells.length + ")</b>").set({ rich: true }));
                        for (var s = 0; s < res.sells.length; s++) { var sl = res.sells[s]; box.add(new qx.ui.basic.Label("✕ <b>" + nameOf(sl) + "</b> L" + sl.level + " (at " + sl.x + ":" + sl.y + ")").set({ rich: true, textColor: "#ffc9c9" })); }
                        box.add(new qx.ui.core.Spacer(null, 4));
                    }
                    box.add(new qx.ui.basic.Label("<b>Moves (" + res.moves.length + ")</b>").set({ rich: true, textColor: "#ffffff" }));
                    if (!res.moves.length) {
                        var noteMsg = res.allowReductions
                            ? "No moves improve " + OPT.RES_CFG[res.resKey].label + " on this base, even when trading other resources."
                            : "No moves improve " + OPT.RES_CFG[res.resKey].label + " on this base. Try <b>Allow reductions</b> to consider moves that trade other resources for a bigger target gain.";
                        box.add(new qx.ui.basic.Label(noteMsg).set({ rich: true, wrap: true, allowGrowX: true, textColor: "#7ee07e" }));
                    }
                    for (var i = 0; i < res.moves.length; i++) {
                        var m = res.moves[i], dist = Math.max(Math.abs(m.toX - m.fromX), Math.abs(m.toY - m.fromY));
                        box.add(new qx.ui.basic.Label("<b>" + (i + 1) + "</b>. " + nameOf(m) + " L" + m.level + "  <b>" + dirArrow(m.toX - m.fromX, m.toY - m.fromY) + "</b> " + dist + (dist === 1 ? " tile" : " tiles")).set({ rich: true, textColor: "#e6e6e6", toolTipText: m.fromX + ":" + m.fromY + " -> " + m.toX + ":" + m.toY }));
                    }
                    box.add(new qx.ui.core.Spacer(null, 6));
                    var changed = res.moves.length || (res.sells && res.sells.length);
                    box.add(new qx.ui.basic.Label(changed
                        ? "Numbers match the grid. Click <b>Apply to base</b> above to make these changes in-game (you'll get a confirmation first), or do them by hand in move mode."
                        : "Numbers match the grid.").set({ rich: true, wrap: true, allowGrowX: true, textColor: "#aaaaaa" }));
                }

                // ---- Phase B: confirm-with-preview + execute ----------------------------
                var applying = false;
                function onApply() {
                    wlog("onApply: entry", { applying: applying, hasRes: !!lastRes, resOk: lastRes && lastRes.ok });
                    if (applying || !lastRes || !lastRes.ok) return;
                    var city = selectedCity();
                    if (!city) { summary.setValue("<span style='color:#ff8a8a'>Could not find that base. Open it in-game and use 'Current base'.</span>"); return; }
                    var plan = OPT.buildApplyPlan(city, lastRes);
                    wlog("onApply: plan", { ok: plan.ok, reason: plan.reason, steps: plan.steps && plan.steps.length });
                    if (!plan.ok) { summary.setValue("<span style='color:#ff8a8a'>Can't apply: " + (plan.reason || "unknown") + "</span>"); setApplyEnabled(false); return; }
                    if (!plan.steps.length) { summary.setValue("Nothing to apply - the base already matches the proposal."); setApplyEnabled(false); return; }
                    showApplyConfirm(city, plan);
                }

                // Our own modal confirm (we deliberately bypass the game's MoveBuildingConfirmationWidget so we
                // can show the WHOLE batch + its true cost up front: moves, permanent demolitions, and the
                // package-progress each moved building resets).
                function showApplyConfirm(city, plan) {
                    wlog("showApplyConfirm: building dialog", { steps: plan.steps.length, moves: plan.nMoves, sells: plan.nSells });
                    var win = new qx.ui.window.Window("Apply layout changes?").set({
                        modal: true, showMinimize: false, showMaximize: false, allowMaximize: false,
                        resizable: false, contentPadding: 12, width: 420 });
                    win.setLayout(new qx.ui.layout.VBox(8));

                    var html = "";
                    html += "<b>" + plan.nMoves + "</b> building" + (plan.nMoves === 1 ? "" : "s") + " will be <b>moved</b>";
                    if (plan.nStaged) html += " (" + plan.nStaged + " via a temporary staging hop to untangle a swap)";
                    html += ".";
                    win.add(new qx.ui.basic.Label(html).set({ rich: true, wrap: true, allowGrowX: true, textColor: "#e6e6e6" }));

                    if (plan.nSells) {
                        win.add(new qx.ui.basic.Label("<b style='color:#ff8a8a'>&#9888; " + plan.nSells + " building" + (plan.nSells === 1 ? "" : "s") + " will be PERMANENTLY DEMOLISHED:</b>").set({ rich: true, wrap: true, allowGrowX: true }));
                        var sells = plan.steps.filter(function (s) { return s.type === "demolish"; });
                        for (var s = 0; s < sells.length; s++) { var sl = sells[s]; win.add(new qx.ui.basic.Label("&nbsp;&nbsp;&#10006; " + nameOf(sl) + " L" + sl.level + " (at " + sl.fromX + ":" + sl.fromY + ")").set({ rich: true, textColor: "#ffc9c9" })); }
                    }

                    if (plan.lossList && plan.lossList.length) {
                        win.add(new qx.ui.basic.Label("<b style='color:#ffd24d'>Package progress reset</b> (moving restarts a building's progress toward its next collectable package):").set({ rich: true, wrap: true, allowGrowX: true }));
                        var maxShow = 8;
                        for (var l = 0; l < plan.lossList.length && l < maxShow; l++) { var li = plan.lossList[l]; win.add(new qx.ui.basic.Label("&nbsp;&nbsp;&bull; " + nameOf(li) + " L" + li.level + " &ndash; ~" + li.pct + "% lost").set({ rich: true, textColor: "#e9d9a6" })); }
                        if (plan.lossList.length > maxShow) win.add(new qx.ui.basic.Label("&nbsp;&nbsp;&hellip; and " + (plan.lossList.length - maxShow) + " more").set({ rich: true, textColor: "#bbbbbb" }));
                    } else if (plan.nMoves) {
                        win.add(new qx.ui.basic.Label("No in-progress package progress will be lost.").set({ rich: true, textColor: "#9fdf9f" }));
                    }

                    win.add(new qx.ui.core.Spacer(null, 4));
                    var btnRow = new qx.ui.container.Composite(new qx.ui.layout.HBox(8, "right"));
                    var cancel = new qx.ui.form.Button("Cancel");
                    var go = new qx.ui.form.Button(plan.nSells ? ("Demolish " + plan.nSells + " + apply") : ("Apply " + plan.nMoves + " move" + (plan.nMoves === 1 ? "" : "s")));
                    try { go.setTextColor(plan.nSells ? "#ff8a8a" : "#7ee07e"); } catch (e) {}
                    cancel.addListener("execute", function () { try { win.close(); win.destroy(); } catch (e) {} });
                    go.addListener("execute", function () { try { win.close(); win.destroy(); } catch (e) {} runApply(city, plan); });
                    btnRow.add(cancel); btnRow.add(go);
                    win.add(btnRow);

                    try { qx.core.Init.getApplication().getRoot().add(win); } catch (e) { werr("OPT: could not mount confirm window", e); }
                    try { win.center(); } catch (e) {}
                    win.open();
                    wlog("showApplyConfirm: opened", { visible: win.isVisible && win.isVisible() });
                }

                function runApply(city, plan) {
                    if (applying) return;
                    applying = true; setApplyEnabled(false); busy = true;
                    var total = plan.steps.length, doneN = 0;
                    summary.setValue("Applying " + plan.nMoves + " move(s)" + (plan.nSells ? " + " + plan.nSells + " demolition(s)" : "") + "&hellip;");
                    OPT.executeApplyPlan(city, plan, {
                        onStep: function (idx, step, ok2) {
                            doneN++;
                            var verb = step.type === "demolish" ? "Demolished" : (step.staged ? "Staged" : "Moved");
                            summary.setValue("Applying&hellip; " + doneN + "/" + total + " - " + (ok2 ? "" : "<span style='color:#ff8a8a'>FAILED </span>") + verb + " " + nameOf(step) + (step.type === "move" ? " &rarr; " + step.toX + ":" + step.toY : ""));
                        },
                        onDone: function (sum) {
                            applying = false; busy = false; lastRes = null;
                            var col = sum.failed ? "#ffb74d" : "#7ee07e";
                            summary.setValue("<b style='color:" + col + "'>Applied " + sum.applied + "/" + total + " change(s)" + (sum.failed ? " - " + sum.failed + " failed (see console)" : " - done") + ".</b> Re-reading base&hellip;");
                            if (sum.failed) { for (var f = 0; f < sum.failedSteps.length; f++) { var fs = sum.failedSteps[f]; werr("OPT apply step failed:", fs.step.type, nameOf(fs.step), "->", fs.step.toX + ":" + fs.step.toY, "-", fs.msg); } }
                            window.setTimeout(function () { renderCurrent(); mapTitle.setValue("<b>Current layout</b> (after apply) - " + (city.get_Name ? city.get_Name() : "")); }, 600);
                        }
                    });
                }

                // Draw the base as-is (no moves) so the grid is populated the moment you open the tab / switch base.
                function renderCurrent() {
                    lastRes = null; setApplyEnabled(false);
                    try {
                        var city = selectedCity();
                        if (!city) { mapTitle.setValue("<b>Base layout</b>"); return; }
                        var snap = OPT.snapshot(city, "Tib");
                        if (!snap || !snap.ok) { return; }
                        var pos = {}; for (var i = 0; i < snap.order.length; i++) { var b = snap.buildings[snap.order[i]]; pos[b.id] = { x: b.x, y: b.y }; }
                        mapTitle.setValue("<b>Current layout</b> - " + (city.get_Name ? city.get_Name() : ""));
                        renderLayout(snap, pos, [], []);
                    } catch (e) { werr("OPT renderCurrent failed:", e); }
                }

                var busy = false;
                function runOptimize(resKey) {
                    if (busy) return;
                    var city = selectedCity();
                    if (!city) { summary.setValue("<span style='color:#ff8a8a'>Could not find that base. Open it in-game and use 'Current base'.</span>"); return; }
                    busy = true;
                    var sellN = spSell.getValue();
                    var allowReductions = !!cbAllowRed.getValue();
                    summary.setValue("Optimizing " + OPT.RES_CFG[resKey].label
                        + (sellN ? " (considering up to " + sellN + " sell" + (sellN > 1 ? "s" : "") + ")" : "")
                        + (allowReductions ? " (allowing reductions in other resources)" : "")
                        + "...");
                    MM.settings.set("BaseTools.OptResource", resKey);
                    window.setTimeout(function () {
                        var res, opts = {
                            rounds: spRounds.getValue(), maxNeighbors: spNeigh.getValue(), kicks: spKicks.getValue(),
                            allowReductions: allowReductions
                        };
                        try { res = sellN > 0 ? OPT.optimizeWithSell(city, resKey, opts, sellN) : OPT.optimize(city, resKey, opts); }
                        catch (e) { werr("OPT optimize threw:", e); res = { ok: false, reason: "internal error (see console)" }; }
                        try {
                            if (res && res.ok) {
                                var cn = MM.num.compact(Math.round(res.current), 1), pn = MM.num.compact(Math.round(res.projected), 1);
                                var sign = res.gainPct >= 0 ? "+" : "";
                                var changed = res.moves.length || (res.sells && res.sells.length);
                                var col = changed ? "#ffe14d" : "#7ee07e";
                                var modeNote = res.allowReductions ? " <span style='color:#ffb74d'>[allow reductions: ON]</span>" : "";
                                summary.setValue("<b style='color:" + col + "'>" + OPT.RES_CFG[resKey].label + "</b> (continuous /h): <b>" + cn + "</b> &rarr; <b>" + pn + "</b> (<b>" + sign + res.gainPct.toFixed(1) + "%</b>) via <b>" + res.moves.length + "</b> move(s)" + (res.sells && res.sells.length ? " + <b>" + res.sells.length + "</b> sell(s)" : "") + ". Figures are continuous production (packages aren't layout-dependent)." + modeNote + (res.snapshot && res.snapshot.calibWarn ? " <span style='color:#ffb74d'>(" + res.snapshot.calibWarn + " link(s) uncalibrated)</span>" : ""));
                                mapTitle.setValue("<b>Proposed layout</b>");
                                renderLayout(res.snapshot, res.bestPos, res.moves, res.sells);
                                lastRes = res; setApplyEnabled(!!changed);   // enable Apply only when there's something to apply
                            } else {
                                summary.setValue("<span style='color:#ff8a8a'>Could not optimize: " + ((res && res.reason) || "unknown") + "</span>");
                                lastRes = null; setApplyEnabled(false);
                            }
                            renderResultList(res);
                        } catch (e2) { werr("OPT render failed:", e2); }
                        busy = false;
                    }, 30);
                }

                buildLegend();
                var firstAppear = true;
                page.addListener("appear", function () { rebuildBases(); if (firstAppear) { firstAppear = false; renderCurrent(); } });
                return page;
            }

            var pageOpt = buildOptimizerTab();
            tabView.add(pageOpt);

            // ---- persist + restore the last-viewed tab (per player+world) ----
            // Restore on the FIRST window "appear", NOT at build: at build the player id may not be
            // loaded, so the settings store resolves to the default bucket and we'd read tab 0. By the
            // time the window appears the player id is ready (same lesson as the open-state restore).
            var TAB_PAGES = [tabCR, pageProd, pageUpg, pageOpt];
            var tabRestored = false, suppressTabSave = false;
            tabView.addListener("changeSelection", function () {
                if (suppressTabSave) return;
                try {
                    var sel = tabView.getSelection()[0];
                    var idx = TAB_PAGES.indexOf(sel);
                    if (idx >= 0) MM.settings.set("BaseTools.SelectedTab", idx);
                } catch (e) {}
            });
            win.addListener("appear", function () {
                if (tabRestored) return;
                tabRestored = true;
                try {
                    var savedTab = MM.settings.get("BaseTools.SelectedTab", 0);
                    if (savedTab >= 0 && savedTab < TAB_PAGES.length && TAB_PAGES[savedTab]) {
                        suppressTabSave = true;
                        tabView.setSelection([TAB_PAGES[savedTab]]);
                        suppressTabSave = false;
                        wlog("restored tab", savedTab);
                    }
                } catch (e) { werr("restore tab failed:", e); }
            });

            // ---- HUD-tray buttons ----
            // Main toggle: always present, opens/closes the window.
            MM.buttons.register({
                id: "base-tools",
                label: "Base Tools",
                tooltip: "Toggle the Base Tools window",
                onExecute: function () { if (win.isVisible()) { win.close(); } else { win.open(); refresh(); } }
            });

            // Notification action buttons: pop into the game's desktop, bottom-right, only when there is
            // work to do (mirrors the original tool's UX exactly - same 50x40 icon-only style with
            // "button-standard-nod" appearance, same faction icons, same right-anchored stacking).
            // These live OUTSIDE the shared HUD tray on purpose: the tray collects window-toggle buttons
            // (always-present, low-attention), while these are attention-grabbing action buttons.
            // Resolve a game icon path. Note: ClientLib.File.FileManager.GetFileSrcByName() was the old
            // way (and is what the original tool still ships with) but that method no longer exists in the
            // current ClientLib. The working approach (per TA_Info_Sticker, which still loads icons fine)
            // is to pass the raw "ui/..." path string directly to qx - qx's own ResourceManager resolves
            // it against the game's asset base. Faction-specific path first, fall back to ui/icons/ if the
            // faction text getter is gone.
            function gameIconPath(name) {
                try {
                    var fac = (ClientLib.Base.Util && ClientLib.Base.Util.GetFactionGuiPatchText && ClientLib.Base.Util.GetFactionGuiPatchText()) || null;
                    if (fac) return "ui/" + fac + "/icons/" + name;
                } catch (e) {}
                return "ui/icons/" + name;
            }
            function makeNotificationBtn(iconPath, tooltip, onClick) {
                var b = new qx.ui.form.Button(null, iconPath).set({
                    toolTipText: tooltip,
                    width: 50, height: 40, maxWidth: 50, maxHeight: 40,
                    appearance: "button-standard-nod",
                    center: true
                });
                b.addListener("execute", onClick);
                return b;
            }
            var btnCollect = makeNotificationBtn(
                gameIconPath("icon_collect_packages.png"),
                "Collect packages on bases that have them ready",
                function () { collectAll(); window.setTimeout(refresh, 500); }
            );
            var btnRepBld = makeNotificationBtn(
                gameIconPath("icn_build_slots.png"),
                "Repair buildings on bases where repair is available",
                function () { repairAll(ClientLib.Vis.Mode.City); window.setTimeout(refresh, 500); }
            );
            var btnRepUnits = makeNotificationBtn(
                gameIconPath("icon_army_points.png"),
                "Repair units on bases where repair is available",
                function () { repairAll(ClientLib.Vis.Mode.ArmySetup); window.setTimeout(refresh, 500); }
            );
            // Fixed slots in the bottom-right corner so the user's eye learns where each button lives.
            // Hidden buttons leave their slot empty (no shifting) - same as the original tool's behavior.
            try {
                var desktop = qx.core.Init.getApplication().getDesktop();
                desktop.add(btnCollect,  { right: 5,   bottom: 140 });
                desktop.add(btnRepBld,   { right: 57,  bottom: 140 });
                desktop.add(btnRepUnits, { right: 109, bottom: 140 });
                btnCollect.setVisibility("excluded");
                btnRepBld.setVisibility("excluded");
                btnRepUnits.setVisibility("excluded");
            } catch (e) { werr("notification buttons placement failed:", e); }

            // ---- refresh: rebuild status label + flip HUD button visibility ----
            function setVis(btn, on) {
                if (!btn) return;
                try { btn.setVisibility(on ? "visible" : "excluded"); } catch (e) {}
            }
            function refresh() {
                try {
                    var c = counts();
                    var msg = "Bases with collectable packages: <b>" + c.collect + "</b>" +
                              "  &middot;  buildings to repair: <b>" + c.repBld + "</b>" +
                              "  &middot;  units to repair: <b>" + c.repUnits + "</b>";
                    statusLbl.setValue(msg);
                    btnCollectInWin.setEnabled(c.collect > 0);
                    btnRepBldInWin.setEnabled(c.repBld > 0);
                    btnRepUnitsInWin.setEnabled(c.repUnits > 0);
                    setVis(btnCollect, c.collect > 0);
                    setVis(btnRepBld, c.repBld > 0);
                    setVis(btnRepUnits, c.repUnits > 0);
                } catch (e) { werr("refresh failed:", e); }
            }

            // Refresh on window appear (and any time the user opens it).
            win.addListener("appear", refresh);

            // Lightweight foreground refresh: every 8s rescan availability so HUD buttons appear/disappear
            // promptly even when the window is closed. (Auto-actions use their own slower timer below.)
            try {
                qx.util.TimerManager.getInstance().start(refresh, 8000, this, null, 1500);
            } catch (e) { wwarn("foreground refresh timer failed:", e); }

            // ---- auto-collect / auto-repair timer ----
            var autoTimerId = null;
            function runAuto() {
                try {
                    if (AUTO_COLLECT) collectAll();
                    if (AUTO_REP_BLDG) {
                        if (REP_PRIORITY) repairAllPrioritized(REP_ORDER);
                        else              repairAll(ClientLib.Vis.Mode.City);
                    }
                    if (AUTO_REP_UNITS) repairAll(ClientLib.Vis.Mode.ArmySetup);
                    refresh();
                } catch (e) { werr("auto cycle failed:", e); }
            }
            function restartAutoTimer() {
                try { if (autoTimerId != null) { window.clearInterval(autoTimerId); autoTimerId = null; } } catch (e) {}
                var ms = Math.max(1, AUTO_TIMER_MIN) * 60 * 1000;
                autoTimerId = window.setInterval(runAuto, ms);
                wlog("auto timer set for every", AUTO_TIMER_MIN, "min");
            }
            restartAutoTimer();
            // Initial run: no wait - the first auto cycle happens AUTO_TIMER_MIN minutes after load.
            // Initial REFRESH happens right away so the HUD buttons show up immediately if needed.
            refresh();

            // Install the Ctrl-hold on-grid Upgrade Overlay listeners. Always installed; gated
            // at-runtime on the BaseTools.UpgradeOverlay setting (Upgrade Priority tab checkbox).
            try { installUpgradeOverlay(); } catch (e) { werr("installUpgradeOverlay failed:", e); }

            LOG.log("ready (" + AUTO_TIMER_MIN + " min auto cycle, autoCollect=" + AUTO_COLLECT + ", autoRepBldg=" + AUTO_REP_BLDG + ", autoRepUnits=" + AUTO_REP_UNITS + ", repPriority=" + REP_PRIORITY + ", upgOverlay=" + MM.settings.get("BaseTools.UpgradeOverlay", true) + ")");
        }

        // Wait until the game UI and MMCommon are both ready, then build once.
        var tries = 0;
        function waitReady() {
            try {
                var app = (typeof qx != "undefined" && qx.core && qx.core.Init) ? qx.core.Init.getApplication() : null;
                var navReady = app && app.getUIItem && app.getUIItem(ClientLib.Data.Missions.PATH.BAR_NAVIGATION) && app.getUIItem(ClientLib.Data.Missions.PATH.BAR_NAVIGATION).isVisible();
                if (navReady && window.MMCommon && window.MMCommon.ui && window.MMCommon.buttons) {
                    build();
                } else {
                    tries++;
                    if (tries === 30) wwarn("still waiting for game UI / MMCommon...");
                    window.setTimeout(waitReady, 1000);
                }
            } catch (e) {
                werr("waitReady error:", e);
                window.setTimeout(waitReady, 1000);
            }
        }
        window.setTimeout(waitReady, 1000);
    };

    try {
        var script = document.createElement("script");
        script.textContent = "(" + BaseTools_main.toString() + ")();";
        script.type = "text/javascript";
        if (/commandandconquer\.com/i.test(document.domain)) {
            (document.head || document.documentElement).appendChild(script);
        }
    } catch (e) {
        console.error("[MM Base Tools] init error: ", e);
    }
})();
