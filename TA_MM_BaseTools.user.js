// ==UserScript==
// @name            MM - Base Tools
// @description     One-stop per-base toolkit: collect packages across all bases, repair all units/buildings, see overall production, prioritize building upgrades, and (later) auto-optimize tile layout for tiberium/crystal/power/credit production. Successor to MaelstromTools Dev (Mod v1.7 MCV) - slimmed down, rebuilt on the MM - Common Library.
// @author          Maelstrom, HuffyLuf, KRS_L, Krisan, DLwarez, NetquiK
// @contributor     MikeyMike (CnCTA-MikeyMike-SCRIPT-PACK)
// @version         1.0.0
// @match           https://*.alliances.commandandconquer.com/*/index.aspx*
// @downloadURL     https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/TA_MM_BaseTools.user.js
// @updateURL       https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/TA_MM_BaseTools.user.js
// ==/UserScript==

/*
================================================================================
 MM - Base Tools   (successor to MaelstromTools Dev Mod v1.7 MCV)
================================================================================
 Replaces MaelstromTools with a slimmer, MMCommon-backed toolkit. Ships four
 tabs in a single dockable window:

   Collect & Repair   - one-click collect-all-packages, repair-all-units,
                        repair-all-buildings across every base; plus a
                        periodic auto-collect / auto-repair timer.
   Production         - overall production overview (per base + totals).
                        [SCAFFOLD - port from MaelstromTools.Production]
   Upgrade Priority   - prioritized upgrade list per resource type (the
                        HuffyTools algorithm). [SCAFFOLD - reimagined UI]
   Layout Optimizer   - one-click optimize for tiberium / crystal / power /
                        credits via building rearrangement. [PHASE A:
                        recommend-only overlay; PHASE B: auto-apply via
                        the sniffed CityBuilding.MoveBuilding(x,y) primitive.]

 Plus conditionally-visible HUD-tray buttons that pop up only when there is
 actually something to collect / repair (mirrors MaelstromTools' UX).

 Settings (all via MMCommon.settings, per player+world):
   BaseTools.autoCollectPackages   (default true)
   BaseTools.autoRepairUnits       (default false)
   BaseTools.autoRepairBuildings   (default true)
   BaseTools.AutoCollectTimerMin   (default 5)

 Debug: window.MMBASETOOLS_DEBUG = true  (or window.MM_DEBUG = true) for verbose
        [MM Base Tools] logs.

 NOT YET PORTED (will arrive in subsequent versions): Production tab,
 Upgrade Priority tab, Layout Optimizer tab. The original MaelstromTools script
 stays available alongside (background.js id 10006) until this script reaches
 feature parity, then it will be retired.
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
        // like MaelstromTools' checkRepairAll() did - this is the authoritative game-side check.
        function counts() {
            var out = { collect: 0, repUnits: 0, repBld: 0 };
            try {
                var ModeCity = ClientLib.Vis.Mode.City;
                var ModeArmy = ClientLib.Vis.Mode.ArmySetup;
                eachOwnCity(function (c) {
                    try {
                        var d = c.get_CityBuildingsData && c.get_CityBuildingsData();
                        if (d && d.get_HasCollectableBuildings && d.get_HasCollectableBuildings()) out.collect++;
                    } catch (e) {}
                    try {
                        var rd = c.get_CityRepairData && c.get_CityRepairData();
                        if (!rd) return;
                        if (c.get_IsGhostMode && c.get_IsGhostMode()) return;
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

        // ===== Upgrade Priority engine (faithful port of HuffyTools.UpgradePriority) ====
        // Original lived in MaelstromTools as a per-resource-tab table. Here it's one flat
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
        // (the original MaelstromTools ignored it entirely), so verifying by effect is what lets us show
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

        // ----- main build ------------------------------------------------------------
        function build() {
            var MM = window.MMCommon;

            // ---- settings (with defaults) ----
            var AUTO_COLLECT = MM.settings.get("BaseTools.autoCollectPackages", true);
            var AUTO_REP_UNITS = MM.settings.get("BaseTools.autoRepairUnits", false);
            var AUTO_REP_BLDG = MM.settings.get("BaseTools.autoRepairBuildings", true);
            var AUTO_TIMER_MIN = MM.settings.get("BaseTools.AutoCollectTimerMin", 5);

            // ---- main tabbed window ----
            var tabView = new qx.ui.tabview.TabView();
            var win = MM.ui.Window({
                caption: "Base Tools",
                key: "BaseTools.Window",
                pos: [260, 140],
                width: 520,
                height: 420,
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
            // weight" metric the original had). Ported from MaelstromTools.Production.
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

                // ---- controls row ----
                var ctrls = new qx.ui.container.Composite(new qx.ui.layout.HBox(6));

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
                    toolTipText: "On: upgraded rows stay marked '✓ Upgraded' until you Refresh.\nOff: each row vanishes the instant its upgrade succeeds (like the old MaelstromTools behavior)."
                });
                ctrls.add(cbKeep);

                var btnRefresh = new qx.ui.form.Button("Refresh").set({ toolTipText: "Recompute the list (clears the '✓ Upgraded' marks and rescans every base)" });
                ctrls.add(btnRefresh);

                ctrls.add(new qx.ui.core.Spacer(16), { flex: 1 });
                ctrls.add(new qx.ui.basic.Label("Upgrade top").set({ alignY: "middle" }));
                var spinTopN = new qx.ui.form.Spinner(1, MM.settings.get("BaseTools.UpgradeTopN", 5), 99).set({ width: 60 });
                ctrls.add(spinTopN);
                var btnUpgradeTop = new qx.ui.form.Button("Go").set({ toolTipText: "Upgrade the top N affordable rows in the list below (in the current sort order)" });
                ctrls.add(btnUpgradeTop);
                page.add(ctrls);

                var infoLbl = new qx.ui.basic.Label("").set({ rich: true, textColor: "#aaaaaa" });
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

                // ---- batch upgrade: walk the visible, sorted, affordable rows ----
                // Same "no reshuffle" rule: each row's button flips to "✓ Upgraded" in place. No table
                // refresh until the user clicks Refresh, so you can see exactly what was done.
                var batchRunning = false;
                function upgradeTopN(n) {
                    if (batchRunning) return;
                    var queue = sortedData().filter(function (c) { return c.state === 1 && !doneState[c.id]; }).slice(0, n);
                    if (!queue.length) { infoLbl.setValue("Nothing affordable to upgrade."); return; }
                    batchRunning = true;
                    var i = 0;
                    function step() {
                        if (i >= queue.length) {
                            batchRunning = false;
                            // Dismiss mode: pull all the successfully-upgraded rows out in one re-render.
                            if (!keepUpgraded) {
                                data = data.filter(function (c) { return doneState[c.id] !== "done"; });
                                queue.forEach(function (c) { if (doneState[c.id] === "done") delete doneState[c.id]; });
                                renderRows();
                            }
                            infoLbl.setValue("Done - upgraded " + queue.length + " building(s)." + (keepUpgraded ? " Click Refresh to recompute the list." : ""));
                            return;
                        }
                        var cand = queue[i++];
                        if (cand._btn) { try { cand._btn.setEnabled(false); cand._btn.setLabel("..."); } catch (e) {} }
                        infoLbl.setValue("Upgrading " + i + "/" + queue.length + ": " + cand.typeName + " in " + cand.cityName + "...");
                        sendUpgrade(cand, function (ok) { markDone(cand, ok); window.setTimeout(step, 150); });
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

            var pageOpt = placeholderTab("Layout Optimizer",
                "<b>Coming soon.</b><br><br>One-click optimize your base layout to maximize Tiberium / Crystal / Power / Credit " +
                "production. Phase A: shows recommended moves as overlay arrows. Phase B: one-click auto-apply via the game's own " +
                "MoveBuilding primitive (sniffed and ready to use).");
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
            // work to do (mirrors MaelstromTools' original UX exactly - same 50x40 icon-only style with
            // "button-standard-nod" appearance, same faction icons, same right-anchored stacking).
            // These live OUTSIDE the shared HUD tray on purpose: the tray collects window-toggle buttons
            // (always-present, low-attention), while these are attention-grabbing action buttons.
            // Resolve a game icon path. Note: ClientLib.File.FileManager.GetFileSrcByName() was the old
            // way (and is what MaelstromTools still ships with) but that method no longer exists in the
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
            // Hidden buttons leave their slot empty (no shifting) - same as MaelstromTools' behavior.
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
                    if (AUTO_REP_BLDG) repairAll(ClientLib.Vis.Mode.City);
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

            LOG.log("ready (" + AUTO_TIMER_MIN + " min auto cycle, autoCollect=" + AUTO_COLLECT + ", autoRepBldg=" + AUTO_REP_BLDG + ", autoRepUnits=" + AUTO_REP_UNITS + ")");
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
