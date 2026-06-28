// ==UserScript==
// @name            MM - Upgrade
// @description     Upgrade helper for CnCTA: a movable panel that totals the resources + grow-time to take the selected building/unit OR every building/unit in the current base up to a target level, plus repair-time and one-click upgrade buttons for Construction Yard / Barracks / Factory / Airport. The panel is opened by the in-game Upgrade button (next to Trade) and can be pinned as a docked side-panel on the LEFT of the base view (matching the MM - Member Status style) or floated anywhere as a frameless drag-by-body window. MikeyMike rework of WarChiefs / NetquiK's "Upgrade Base/Defense/Army", rebuilt on the MM - Common Library.
// @author          Eistee (WarChiefs)
// @contributor     NetquiK (https://github.com/netquik)
// @translator      ES: Nefrontheone
// @contributor     MikeyMike (CnCTA-MikeyMike-SCRIPT-PACK)
// @version         1.1.6
// @match           https://*.alliances.commandandconquer.com/*/index.aspx*
// @downloadURL     https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/MM_Upgrade.user.js
// @updateURL       https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/MM_Upgrade.user.js
// @icon            http://eistee82.github.io/ta_simv2/icon.png
// ==/UserScript==

/*
================================================================================
 MM - Upgrade   (formerly "WarChiefs - Tiberium Alliances Upgrade Base/Defense/Army")
================================================================================
 Upgrade helper: shows the resource cost + grow-time for upgrading the selected
 building/unit (or every building/unit in the current base) to a target level,
 plus a repair-time row and one-click upgrade buttons for Construction Yard /
 Barracks / Factory / Airport. The view auto-switches between Base / Defense /
 Offense to match the current play-area mode and auto-hides when you leave a base.

 MM rework (1.0.0):
  - The trigger button is preserved: the game-styled "Upgrade" button next to the
    Trade widget in the base HUD opens/closes the panel.
  - The panel itself follows the MM - Member Status pattern: PINNED = a menu-styled
    side panel docked to the LEFT of the base view (the Info Sticker frame: rounded
    blue messaging caps + the pane-navigation-bar gray strip, mirrored to the left
    edge so the gray strip shows on the right side of the body, facing in). UNPINNED
    = a frameless, drag-by-body, dark-opaque floating panel like MM - Loot Summary /
    MM - Next MCV. The pin button on the panel header toggles between the two.
  - Pinned/docked state lives in a GLOBAL localStorage key ("MM.Upgrade.dock") read
    synchronously at startup so the docked panel auto-restores on reload (avoiding
    the per-player pid-timing trap that bit Member Status).
  - No HUD tray button: the trigger button + the CnC Pack menu toggle are the entry
    points. (Button consolidation is coming - we're keeping the count down.)
  - Live enable/disable via the CnC Pack menu (MMCommon.lifecycle.watch): disabling
    removes the trigger button + tears down the panel without a reload.
  - [MM Upgrade] gated logging; every block try/catch'd so one failure can't break
    the game's HUD.
  - The upgrade math is the original NetquiK NOEVIL recoding + the no-grow-Infinity
    fix + the MaxLevelCap fix, ported verbatim.

 Settings (MMCommon.settings):
   Upgrade.Window.*       - floating panel pos / open-state (managed by MM.ui.Window).
 Debug:
   window.MM_DEBUG = true   (or localStorage.MM_DEBUG = '1') for [MM Upgrade] logs.
================================================================================
*/

(function () {
    var Upgrade_main = function () {
        // --- [MM Upgrade] debug framework (pack-wide convention; wlog gated, wwarn/werr always on) ---
        // i18n fallback: hoisted so MMt() is always defined even if the Common Library's global
        // loads after this script (extension injection order isn't guaranteed). Identity in English.
        function MMt(s){try{return (window.MMCommon&&window.MMCommon.i18n)?window.MMCommon.i18n.t(s):s;}catch(e){return s;}}
        var LOG = (window.MMCommon && window.MMCommon.makeLogger)
            ? window.MMCommon.makeLogger("Upgrade")
            : { log: function () {}, warn: function () { try { console.warn.apply(console, arguments); } catch (e) {} }, err: function () { try { console.error.apply(console, arguments); } catch (e) {} } };
        function wlog()  { try { LOG.log.apply(LOG, arguments); } catch (e) {} }
        function wwarn() { try { LOG.warn.apply(LOG, arguments); } catch (e) {} }
        function werr()  { try { LOG.err.apply(LOG, arguments); } catch (e) {} }

        // Status sink for the section-level transfer/upgrade flow. build() rebinds this to its
        // panel-footer status label once the panel is laid out; until then it's a no-op. We use a
        // main-scope binding because the qx class member functions (in defineSectionClasses) can't
        // see build()'s locals via closure - main's scope is the shared chain.
        var statusSink = function (html) {};
        function setUpgradeStatus(html) { try { statusSink(html); } catch (e) {} }

        // Match-script-id for MMCommon.lifecycle.watch (kept stable from the original WarChiefs entry).
        var SCRIPT_ID = 10017;

        // Global pin-state key (NOT pid-keyed - see Member Status, same pid-timing trap).
        var DOCK_KEY = "MM.Upgrade.dock";
        function menuOn() { try { return window.localStorage.getItem(DOCK_KEY) === "1"; } catch (e) { return false; } }
        function setMenuFlag(on) { try { window.localStorage.setItem(DOCK_KEY, on ? "1" : "0"); } catch (e) {} }
        function pinIcon(on) { return on ? "FactionUI/icons/icn_thread_pin_active.png" : "FactionUI/icons/icn_thread_pin_inactive.png"; }

        // -------------------------------------------------------------------
        // "Transfer as needed" - when the current base is short on Tiberium/Crystal for an upgrade,
        // pull the shortfall in from other bases (cheapest-credit-cost source first) BEFORE firing
        // the upgrade. Power isn't transferable, so a power shortage just falls through and the game
        // upgrades what fits. Defaults to OFF (transfers cost credits - opt-in only). Lives in a
        // global localStorage key so section classes can read it via closure (set in build() too,
        // since the panel's checkbox writes through this same helper).
        var TRANSFER_KEY = "MM.Upgrade.transferAsNeeded";
        function transferOn() { try { return window.localStorage.getItem(TRANSFER_KEY) === "1"; } catch (e) { return false; } }
        function setTransferFlag(on) { try { window.localStorage.setItem(TRANSFER_KEY, on ? "1" : "0"); } catch (e) {} }

        // Sum a costs array (the shape returned by getUpgradeCostsToLevel: array-like of {Type,Count})
        // into a {tib, cry, pow} object. Unknown resource types are ignored.
        function sumCostsByResource(costsArr) {
            var out = { tib: 0, cry: 0, pow: 0 };
            try {
                if (!costsArr) return out;
                var ERT = ClientLib.Base.EResourceType;
                for (var i = 0; i < costsArr.length; i++) {
                    var e = costsArr[i];
                    if (!e || typeof e !== "object") continue;
                    var t = parseInt(e.Type, 10), c = +e.Count || 0;
                    if (t === ERT.Tiberium) out.tib += c;
                    else if (t === ERT.Crystal) out.cry += c;
                    else if (t === ERT.Power)   out.pow += c;
                }
            } catch (e) { werr("sumCostsByResource:", e); }
            return out;
        }

        // What's the local shortfall of {tib, cry, pow} given a current city + total cost obj?
        function localShortfall(city, costs) {
            var ERT = ClientLib.Base.EResourceType;
            return {
                tib: Math.max(0, (costs.tib || 0) - city.GetResourceCount(ERT.Tiberium)),
                cry: Math.max(0, (costs.cry || 0) - city.GetResourceCount(ERT.Crystal)),
                pow: Math.max(0, (costs.pow || 0) - city.GetResourceCount(ERT.Power))
            };
        }

        // Plan a BEST-EFFORT transfer of up to `amount` of one EResourceType to targetCity. Cheapest
        // per-unit-credit source first; pulls only as much as needed from each source, and never more
        // than `creditBudget` worth of trade fees (pass null/Infinity for no cap). Unlike a strict
        // planner this NEVER fails for "not enough" - it moves as much as is available AND affordable
        // so the caller can then upgrade "as many as fit" instead of all-or-nothing. (Mike's request:
        // "All army units" should survey total crystal across bases and grab the max it can.)
        // Returns { plan:[{source,amount,cost}], totalCost, moved, need, full, reason }:
        //   moved  = units actually planned for transfer (0 if nothing available/affordable)
        //   full   = true if the whole `amount` is covered
        //   reason = set only for a hard block (target can't trade / error); "" otherwise.
        function planBestEffortTransfer(targetCity, ert, amount, creditBudget) {
            var out = { plan: [], totalCost: 0, moved: 0, need: Math.max(0, Math.ceil(amount || 0)), full: false, reason: "" };
            try {
                var ETradeNone = ClientLib.Data.ETradeError.None;
                if (targetCity.CanTrade && targetCity.CanTrade() !== ETradeNone) { out.reason = MMt("target base cannot trade right now"); return out; }
                if (out.need <= 0) { out.full = true; return out; }
                var tx = targetCity.get_PosX(), ty = targetCity.get_PosY();
                var sources = [];
                var arr = ClientLib.Data.MainData.GetInstance().get_Cities().get_AllCities();
                var d = arr && arr.d;
                for (var k in d) {
                    var c = d[k];
                    try {
                        if (!c || !c.IsOwnBase || !c.IsOwnBase()) continue;
                        if (c.get_Id() === targetCity.get_Id()) continue;
                        if (c.get_IsGhostMode && c.get_IsGhostMode()) continue;
                        if (c.CanTrade && c.CanTrade() !== ETradeNone) continue;
                        var have = Math.floor(c.GetResourceCount(ert));
                        if (have <= 0) continue;
                        var perUnit = Infinity;
                        try { var cf = c.CalculateTradeCostToCoord(tx, ty, have); if (have > 0) perUnit = cf / have; } catch (e) {}
                        sources.push({ city: c, have: have, perUnit: perUnit });
                    } catch (e) {}
                }
                sources.sort(function (a, b) { return a.perUnit - b.perUnit; });
                var remaining = out.need, budget = (creditBudget == null || !isFinite(creditBudget)) ? Infinity : creditBudget;
                for (var i = 0; i < sources.length && remaining > 0 && budget > 0; i++) {
                    var s = sources[i];
                    var amt = Math.min(s.have, remaining);
                    if (amt <= 0) continue;
                    var cost = 0;
                    try { cost = s.city.CalculateTradeCostToCoord(tx, ty, amt); } catch (e) {}
                    if (cost > budget) {
                        // Credit budget can't cover the full pull from this source - take only what the
                        // remaining budget affords (per-unit estimate), then verify the exact fee.
                        var perU = (s.perUnit && isFinite(s.perUnit) && s.perUnit > 0) ? s.perUnit : (amt > 0 ? cost / amt : Infinity);
                        var affordAmt = Math.floor(budget / perU);
                        if (affordAmt <= 0) break;
                        amt = Math.min(amt, affordAmt);
                        try { cost = s.city.CalculateTradeCostToCoord(tx, ty, amt); } catch (e) {}
                        if (cost > budget || amt <= 0) break;
                    }
                    out.plan.push({ source: s.city, amount: amt, cost: cost });
                    out.totalCost += cost;
                    out.moved += amt;
                    remaining -= amt;
                    budget -= cost;
                }
                out.full = (remaining <= 0);
                return out;
            } catch (e) { werr("planBestEffortTransfer:", e); out.reason = MMt("error - see console"); return out; }
        }

        // Execute one resource's transfer plan (sequential SelfTrade commands), then poll the target's
        // resource count to confirm arrival before invoking onAllDone(ok). The poll is needed because
        // SelfTrade's result code isn't a reliable success signal (same lesson as MM - Base Tools).
        function runTransferPlan(targetCity, ert, plan, onAllDone) {
            try {
                if (!plan || !plan.plan || !plan.plan.length) { onAllDone(true); return; }
                var startHad = 0;
                try { startHad = targetCity.GetResourceCount(ert); } catch (e) {}
                var idx = 0;
                function nextTransfer() {
                    if (idx >= plan.plan.length) {
                        // All commands sent - now wait for tiberium/crystal to arrive at target.
                        var tries = 0;
                        (function poll() {
                            tries++;
                            var have = 0;
                            try { have = targetCity.GetResourceCount(ert); } catch (e) {}
                            if (have >= startHad + plan.need) { onAllDone(true); return; }
                            if (tries >= 12) { wwarn("runTransferPlan: resource didn't arrive in time (have " + Math.floor(have) + " / need +" + plan.need + ")"); onAllDone(false); return; }
                            window.setTimeout(poll, 500);
                        })();
                        return;
                    }
                    var p = plan.plan[idx++];
                    try {
                        ClientLib.Net.CommunicationManager.GetInstance().SendCommand("SelfTrade", {
                            targetCityId: targetCity.get_Id(),
                            sourceCityId: p.source.get_Id(),
                            resourceType: ert,
                            amount: p.amount
                        }, webfrontend.phe.cnc.Util.createEventDelegate(ClientLib.Net.CommandResult, {}, function () {
                            window.setTimeout(nextTransfer, 200);
                        }), null, true);
                    } catch (e) { werr("SelfTrade failed:", e); onAllDone(false); }
                }
                nextTransfer();
            } catch (e) { werr("runTransferPlan:", e); onAllDone(false); }
        }

        // Top-level helper used by the section onUpgrade handlers. If transfer-as-needed is OFF, just
        // calls fireUpgrade() and we're done (matches the original behaviour). If ON, it surveys the
        // Tib/Cry shortfall for the WHOLE batch, pulls in as much as is available across every base
        // (within the credit budget for trade fees), then fires the upgrade so the game upgrades as
        // many units/buildings as now fit. Crucially it does NOT give up when the bases can't cover
        // the entire batch - it grabs the maximum and lets the engine upgrade what fits (Mike's
        // request: clicking "All army units" with crystal short should still upgrade every unit it
        // can, not nothing). Power isn't transferable, so a power shortage just falls through.
        // `setStatus(html)` surfaces progress to the panel-footer label; pass a no-op if you don't care.
        function upgradeWithMaybeTransfer(totalCosts, setStatus, fireUpgrade, note) {
            try {
                note = note || "";
                if (!transferOn()) { fireUpgrade(); return; }
                var city;
                try { city = ClientLib.Data.MainData.GetInstance().get_Cities().get_CurrentOwnCity(); } catch (e) {}
                if (!city) { fireUpgrade(); return; }
                var short = localShortfall(city, totalCosts);
                if (short.tib <= 0 && short.cry <= 0) { fireUpgrade(); return; }
                var ERT = ClientLib.Base.EResourceType;
                var credits = 0;
                try { credits = ClientLib.Data.MainData.GetInstance().get_Player().GetCreditsCount(); } catch (e) {}

                // Plan best-effort transfers for each short resource, sharing one credit budget so the
                // fees never exceed what we can pay. (In practice only one of Tib/Cry is short per
                // mode: army/defense = Crystal, buildings = Tiberium.)
                var specs = [];
                if (short.tib > 0) specs.push({ ert: ERT.Tiberium, need: short.tib, label: MMt("Tiberium") });
                if (short.cry > 0) specs.push({ ert: ERT.Crystal,  need: short.cry, label: MMt("Crystal") });
                var budget = credits, plans = [], anyPartial = false, hardReason = "";
                for (var s = 0; s < specs.length; s++) {
                    var sp = specs[s];
                    var be = planBestEffortTransfer(city, sp.ert, sp.need, budget);
                    if (be.reason && be.plan.length === 0) { hardReason = sp.label + ": " + be.reason; }
                    if (be.plan.length > 0) {
                        plans.push({ ert: sp.ert, plan: { plan: be.plan, need: be.moved }, label: sp.label });
                        budget -= be.totalCost;
                    }
                    if (!be.full) anyPartial = true;
                }

                if (plans.length === 0) {
                    // Nothing could be transferred (no spare resources across bases, can't trade, or no
                    // credits for the fee). Fire anyway so the game upgrades whatever local resources
                    // already cover - honest about why nothing moved.
                    setStatus("<span style='color:#ff9d3c;font-weight:bold'>" + (hardReason || MMt("No transferable resources within your credit budget")) + MMt(" - upgrading what fits.") + "</span>");
                    fireUpgrade();
                    return;
                }

                var totalFee = credits - budget;
                setStatus(MMt("Transferring max available (") + plans.length + MMt(" resource type") + (plans.length > 1 ? "s" : "") + MMt(", fee ~") + Math.round(totalFee) + MMt(" credits)...") + note);
                var pi = 0;
                function nextPlan() {
                    if (pi >= plans.length) {
                        // All planned transfers attempted - now upgrade everything that fits. One
                        // UpgradeAll*ToLevel pass spends the topped-up pool greedily (we already pulled
                        // ALL available resources, so a second pass couldn't add anything).
                        setStatus(anyPartial
                            ? "<span style='color:#6ee07a;font-weight:bold'>" + MMt("Transferred all available - upgrading as many as fit.") + "</span>" + note
                            : "<span style='color:#6ee07a;font-weight:bold'>" + MMt("Transfers complete - upgrading.") + "</span>" + note);
                        window.setTimeout(function () { fireUpgrade(); window.setTimeout(function () { setStatus(""); }, 3000); }, 400);
                        return;
                    }
                    var pp = plans[pi++];
                    runTransferPlan(city, pp.ert, pp.plan, function (ok) {
                        // Even if a plan doesn't fully land in time, keep going and upgrade what arrived.
                        if (!ok) setStatus("<span style='color:#ff9d3c;font-weight:bold'>" + pp.label + MMt(" didn't fully arrive - upgrading what fits.") + "</span>");
                        nextPlan();
                    });
                }
                nextPlan();
            } catch (e) { werr("upgradeWithMaybeTransfer:", e); fireUpgrade(); }
        }

        // -------------------------------------------------------------------
        // The three qx classes that hold the actual upgrade logic
        //   - MM.Upgrade.Current    selected building/unit -> level X cost + grow-time
        //   - MM.Upgrade.All        all buildings/units    -> level X cost + grow-time
        //   - MM.Upgrade.Repair     repair-time rows + one-click CY/Barracks/Factory/Airport upgrades
        // The math is the NetquiK NOEVIL recoding (no-grow-Infinity + MaxLevelCap fixes), ported
        // verbatim from the original. Each class lives in its own try/catch so a class-define failure
        // in one can't take the others down.
        // -------------------------------------------------------------------
        function defineSectionClasses() {
            try {
                qx.Class.define("MM.Upgrade.All", {
                    extend: qx.ui.container.Composite,
                    construct: function () {
                        try {
                            qx.ui.container.Composite.call(this);
                            this.set({
                                layout: new qx.ui.layout.VBox(5),
                                padding: 5,
                                decorator: "pane-light-opaque"
                            });
                            this.add(this.title = new qx.ui.basic.Label("").set({ alignX: "center", font: "font_size_14_bold" }));

                            var level = new qx.ui.container.Composite(new qx.ui.layout.HBox(5));
                            level.add(new qx.ui.basic.Label(this.tr("tnf:level:")).set({ alignY: "middle" }));
                            level.add(this.txtLevel = new qx.ui.form.Spinner(1).set({
                                maximum: ClientLib.Data.MainData.GetInstance().get_Server().get_PlayerUpgradeCap(),
                                minimum: 1
                            }));
                            this.txtLevel.addListener("changeValue", this.onInput, this);
                            level.add(this.btnLevel = new qx.ui.form.Button(this.tr("tnf:toggle upgrade mode"), "FactionUI/icons/icon_building_detail_upgrade.png"));
                            this.btnLevel.addListener("execute", this.onUpgrade, this);
                            this.add(level);

                            var requires = new qx.ui.container.Composite(new qx.ui.layout.HBox(5));
                            requires.add(new qx.ui.basic.Label(this.tr("tnf:requires:")));
                            var resource = new qx.ui.container.Composite(new qx.ui.layout.VBox(5));
                            this._addResAtom(resource, "resTiberium", "webfrontend/ui/common/icn_res_tiberium.png");
                            this._addResAtom(resource, "resChrystal", "webfrontend/ui/common/icn_res_chrystal.png");
                            this._addResAtom(resource, "resPower",    "webfrontend/ui/common/icn_res_power.png");
                            requires.add(resource);
                            this.add(requires);

                            this.addListener("appear", this.onAppear, this);
                            this.addListener("disappear", this.onDisappear, this);
                        } catch (e) { werr("MM.Upgrade.All constructor:", e); }
                    },
                    members: {
                        title: null, txtLevel: null, btnLevel: null,
                        resTiberium: null, resChrystal: null, resPower: null,
                        _addResAtom: function (parent, key, icon) {
                            var a = new qx.ui.basic.Atom("-", icon);
                            a.setToolTipIcon(icon);
                            a.getChildControl("icon").set({ width: 18, height: 18, scale: true, alignY: "middle" });
                            parent.add(a);
                            this[key] = a;
                        },
                        onAppear: function () {
                            try {
                                phe.cnc.Util.attachNetEvent(ClientLib.Vis.VisMain.GetInstance(), "ViewModeChange", ClientLib.Vis.ViewModeChange, this, this.onViewModeChanged);
                                phe.cnc.Util.attachNetEvent(ClientLib.Data.MainData.GetInstance().get_Cities(), "CurrentOwnChange", ClientLib.Data.CurrentOwnCityChange, this, this.onCurrentCityChange);
                                phe.cnc.Util.attachNetEvent(ClientLib.Data.MainData.GetInstance().get_Cities(), "CurrentChange", ClientLib.Data.CurrentCityChange, this, this.onCurrentCityChange);
                                phe.cnc.base.Timer.getInstance().addListener("uiTick", this.onTick, this);
                                this.onViewModeChanged(null, ClientLib.Vis.VisMain.GetInstance().get_Mode());
                            } catch (e) { werr("All.onAppear:", e); }
                        },
                        onDisappear: function () {
                            try {
                                phe.cnc.Util.detachNetEvent(ClientLib.Vis.VisMain.GetInstance(), "ViewModeChange", ClientLib.Vis.ViewModeChange, this, this.onViewModeChanged);
                                phe.cnc.Util.detachNetEvent(ClientLib.Data.MainData.GetInstance().get_Cities(), "CurrentOwnChange", ClientLib.Data.CurrentOwnCityChange, this, this.onCurrentCityChange);
                                phe.cnc.Util.detachNetEvent(ClientLib.Data.MainData.GetInstance().get_Cities(), "CurrentChange", ClientLib.Data.CurrentCityChange, this, this.onCurrentCityChange);
                                phe.cnc.base.Timer.getInstance().removeListener("uiTick", this.onTick, this);
                            } catch (e) { werr("All.onDisappear:", e); }
                        },
                        onViewModeChanged: function (oldViewMode, newViewMode) {
                            if (oldViewMode === newViewMode) return;
                            switch (newViewMode) {
                                case ClientLib.Vis.Mode.City:         this.title.setValue(MMt(this.tr("All buildings")));     this.reset(); break;
                                case ClientLib.Vis.Mode.DefenseSetup: this.title.setValue(MMt(this.tr("All defense units"))); this.reset(); break;
                                case ClientLib.Vis.Mode.ArmySetup:    this.title.setValue(MMt(this.tr("All army units")));    this.reset(); break;
                            }
                        },
                        onCurrentCityChange: function (oldCurrentCity, newCurrentCity) {
                            if (oldCurrentCity !== newCurrentCity) this.reset();
                        },
                        getResTime: function (need, type) {
                            var CurrentOwnCity = ClientLib.Data.MainData.GetInstance().get_Cities().get_CurrentOwnCity();
                            var Alliance = ClientLib.Data.MainData.GetInstance().get_Alliance();
                            need -= CurrentOwnCity.GetResourceCount(type);
                            need = Math.max(0, need);
                            var Con = CurrentOwnCity.GetResourceGrowPerHour(type);
                            var Bonus = CurrentOwnCity.get_hasCooldown() ? 0 : CurrentOwnCity.GetResourceBonusGrowPerHour(type);
                            var POI = CurrentOwnCity.get_IsGhostMode() ? 0 : Alliance.GetPOIBonusFromResourceType(type);
                            // NetquiK fix: divide-by-zero / Infinity grow time is a non-finite value
                            // (NaN/Infinity); caller distinguishes "no growth" from "growth in progress".
                            return (need <= 0 ? 0 : need / (Con + Bonus + POI) * 3600);
                        },
                        getUpgradeCostsToLevel: function (newLevel) {
                            // ClientLib.API.City/Defense/Army.* dereferences get_CurrentOwnCity()
                            // internally - if there's no current own city (e.g. the panel becomes visible
                            // a tick before the city data is populated), the obfuscated accessor crashes
                            // on null. Bail out cleanly in that window.
                            try {
                                if (!ClientLib.Data.MainData.GetInstance().get_Cities().get_CurrentOwnCity()) return null;
                            } catch (e) { return null; }
                            if (newLevel > 0) {
                                try {
                                    switch (ClientLib.Vis.VisMain.GetInstance().get_Mode()) {
                                        case ClientLib.Vis.Mode.City:         return ClientLib.API.City.GetInstance().GetUpgradeCostsForAllBuildingsToLevel(newLevel);
                                        case ClientLib.Vis.Mode.DefenseSetup: return ClientLib.API.Defense.GetInstance().GetUpgradeCostsForAllUnitsToLevel(newLevel);
                                        case ClientLib.Vis.Mode.ArmySetup:    return ClientLib.API.Army.GetInstance().GetUpgradeCostsForAllUnitsToLevel(newLevel);
                                    }
                                } catch (e) { return null; }
                            }
                            return null;
                        },
                        getLowLevel: function () {
                            for (var newLevel = 1, Tib = 0, Cry = 0, Pow = 0; Tib === 0 && Cry === 0 && Pow === 0 && newLevel < 1000; newLevel++) {
                                var costs = this.getUpgradeCostsToLevel(newLevel);
                                if (costs !== null) {
                                    for (var i = 0; i < costs.length; i++) {
                                        var uCosts = costs[i];
                                        switch (parseInt(uCosts.Type, 10)) {
                                            case ClientLib.Base.EResourceType.Tiberium: Tib += uCosts.Count; break;
                                            case ClientLib.Base.EResourceType.Crystal:  Cry += uCosts.Count; break;
                                            case ClientLib.Base.EResourceType.Power:    Pow += uCosts.Count; break;
                                        }
                                    }
                                }
                            }
                            return (newLevel === 1000 ? 0 : (newLevel - 1));
                        },
                        reset: function () {
                            var LowLevel = this.getLowLevel();
                            if (LowLevel > 0) {
                                this.txtLevel.setMinimum(LowLevel);
                                this.txtLevel.setMaximum(ClientLib.Data.MainData.GetInstance().get_Server().get_PlayerUpgradeCap());
                                this.txtLevel.setValue(LowLevel);
                                this.txtLevel.setEnabled(true);
                                this.btnLevel.setEnabled(true);
                            } else {
                                this.txtLevel.setMinimum(0);
                                this.txtLevel.setMaximum(0);
                                this.txtLevel.resetValue();
                                this.txtLevel.setEnabled(false);
                                this.btnLevel.setEnabled(false);
                            }
                            this.onInput();
                        },
                        onTick: function () { this.onInput(); },
                        onInput: function () {
                            try {
                                var newLevel = parseInt(this.txtLevel.getValue(), 10);
                                var costs = this.getUpgradeCostsToLevel(newLevel);
                                if (newLevel > 0 && costs !== null) {
                                    var Tib = 0, Cry = 0, Pow = 0, TibTime = 0, CryTime = 0, PowTime = 0;
                                    for (var i = 0; i < costs.length; i++) {
                                        var uCosts = costs[i];
                                        switch (parseInt(uCosts.Type, 10)) {
                                            case ClientLib.Base.EResourceType.Tiberium: Tib += uCosts.Count; TibTime += this.getResTime(uCosts.Count, ClientLib.Base.EResourceType.Tiberium); break;
                                            case ClientLib.Base.EResourceType.Crystal:  Cry += uCosts.Count; CryTime += this.getResTime(uCosts.Count, ClientLib.Base.EResourceType.Crystal);  break;
                                            case ClientLib.Base.EResourceType.Power:    Pow += uCosts.Count; PowTime += this.getResTime(uCosts.Count, ClientLib.Base.EResourceType.Power);    break;
                                        }
                                    }
                                    paintRes(this.resTiberium, Tib, TibTime);
                                    paintRes(this.resChrystal, Cry, CryTime);
                                    paintRes(this.resPower,    Pow, PowTime);
                                } else {
                                    clearRes(this.resTiberium); clearRes(this.resChrystal); clearRes(this.resPower);
                                }
                            } catch (e) { werr("All.onInput:", e); }
                        },
                        onUpgrade: function () {
                            try {
                                var newLevel = parseInt(this.txtLevel.getValue(), 10);
                                if (newLevel <= 0) return;
                                var self = this;
                                var mode = ClientLib.Vis.VisMain.GetInstance().get_Mode();
                                var totalCosts = sumCostsByResource(this.getUpgradeCostsToLevel(newLevel));
                                var note = "";
                                // "Transfer as needed" POWER CAP (Mike): power can't be transferred between
                                // bases, so stored power is the hard ceiling on how many of these units/buildings
                                // actually upgrade. The game upgrades a SUBSET when power runs short, but its API
                                // exposes no way to drive individual units (only "upgrade ALL to level N"), so we
                                // can't pick which - we just avoid hauling resources the base can't spend. If
                                // stored power covers only a fraction f of the batch's TOTAL power cost, bring
                                // only that fraction of the tiberium/crystal (floored, so we never over-transfer)
                                // and let the game upgrade as many as fit. This scales WHATEVER the batch needs,
                                // so it works for army (crystal), defense (tiberium and/or crystal) and buildings
                                // (tiberium) alike. NOTE: this is proportional, not a per-unit simulation - the
                                // exact crystal the game spends depends on which units it upgrades, but bringing
                                // the power-fraction is close and never the old "haul it all then send it back".
                                if (transferOn() && totalCosts && (totalCosts.pow || 0) > 0) {
                                    var city = ClientLib.Data.MainData.GetInstance().get_Cities().get_CurrentOwnCity();
                                    var powAvail = city ? Math.floor(city.GetResourceCount(ClientLib.Base.EResourceType.Power)) : 0;
                                    if (powAvail < (totalCosts.pow || 0)) {
                                        var f = Math.max(0, powAvail / totalCosts.pow);
                                        totalCosts = {
                                            tib: Math.floor((totalCosts.tib || 0) * f),
                                            cry: Math.floor((totalCosts.cry || 0) * f),
                                            pow: totalCosts.pow
                                        };
                                        note = MMt(" (stored power covers ~") + Math.round(f * 100) + MMt("% of the batch - bringing only that much; run again as power regrows)");
                                    }
                                }
                                function fire() {
                                    try {
                                        switch (mode) {
                                            case ClientLib.Vis.Mode.City:         ClientLib.API.City.GetInstance().UpgradeAllBuildingsToLevel(newLevel); break;
                                            case ClientLib.Vis.Mode.DefenseSetup: ClientLib.API.Defense.GetInstance().UpgradeAllUnitsToLevel(newLevel); break;
                                            case ClientLib.Vis.Mode.ArmySetup:    ClientLib.API.Army.GetInstance().UpgradeAllUnitsToLevel(newLevel); break;
                                        }
                                        self.reset();
                                    } catch (e) { werr("All.onUpgrade fire:", e); }
                                }
                                upgradeWithMaybeTransfer(totalCosts, setUpgradeStatus, fire, note);
                            } catch (e) { werr("All.onUpgrade:", e); }
                        }
                    }
                });
            } catch (e) { werr("define MM.Upgrade.All failed:", e); }

            try {
                qx.Class.define("MM.Upgrade.Current", {
                    extend: qx.ui.container.Composite,
                    construct: function () {
                        try {
                            qx.ui.container.Composite.call(this);
                            this.set({
                                layout: new qx.ui.layout.VBox(5),
                                padding: 5,
                                decorator: "pane-light-opaque"
                            });
                            this.add(this.title = new qx.ui.basic.Label("").set({ alignX: "center", font: "font_size_14_bold" }));
                            this.add(this.txtSelected = new qx.ui.basic.Label("").set({ alignX: "center" }));

                            var level = new qx.ui.container.Composite(new qx.ui.layout.HBox(5));
                            level.add(new qx.ui.basic.Label(this.tr("tnf:level:")).set({ alignY: "middle" }));
                            level.add(this.txtLevel = new qx.ui.form.Spinner(1).set({
                                maximum: ClientLib.Data.MainData.GetInstance().get_Server().get_PlayerUpgradeCap(),
                                minimum: 1
                            }));
                            this.txtLevel.addListener("changeValue", this.onInput, this);
                            level.add(this.btnLevel = new qx.ui.form.Button(this.tr("tnf:toggle upgrade mode"), "FactionUI/icons/icon_building_detail_upgrade.png"));
                            this.btnLevel.addListener("execute", this.onUpgrade, this);
                            this.add(level);

                            var requires = new qx.ui.container.Composite(new qx.ui.layout.HBox(5));
                            requires.add(new qx.ui.basic.Label(this.tr("tnf:requires:")));
                            var resource = new qx.ui.container.Composite(new qx.ui.layout.VBox(5));
                            this._addResAtom(resource, "resTiberium", "webfrontend/ui/common/icn_res_tiberium.png");
                            this._addResAtom(resource, "resChrystal", "webfrontend/ui/common/icn_res_chrystal.png");
                            this._addResAtom(resource, "resPower",    "webfrontend/ui/common/icn_res_power.png");
                            requires.add(resource);
                            this.add(requires);

                            this.addListener("appear", this.onAppear, this);
                            this.addListener("disappear", this.onDisappear, this);
                        } catch (e) { werr("MM.Upgrade.Current constructor:", e); }
                    },
                    members: {
                        title: null, txtSelected: null, txtLevel: null, btnLevel: null,
                        resTiberium: null, resChrystal: null, resPower: null,
                        Selection: null,
                        _addResAtom: function (parent, key, icon) {
                            var a = new qx.ui.basic.Atom("-", icon);
                            a.setToolTipIcon(icon);
                            a.getChildControl("icon").set({ width: 18, height: 18, scale: true, alignY: "middle" });
                            parent.add(a);
                            this[key] = a;
                        },
                        onAppear: function () {
                            try {
                                phe.cnc.Util.attachNetEvent(ClientLib.Vis.VisMain.GetInstance(), "ViewModeChange", ClientLib.Vis.ViewModeChange, this, this.onViewModeChanged);
                                phe.cnc.Util.attachNetEvent(ClientLib.Vis.VisMain.GetInstance(), "SelectionChange", ClientLib.Vis.SelectionChange, this, this.onSelectionChange);
                                phe.cnc.Util.attachNetEvent(ClientLib.Data.MainData.GetInstance().get_Cities(), "CurrentOwnChange", ClientLib.Data.CurrentOwnCityChange, this, this.onCurrentCityChange);
                                phe.cnc.Util.attachNetEvent(ClientLib.Data.MainData.GetInstance().get_Cities(), "CurrentChange", ClientLib.Data.CurrentCityChange, this, this.onCurrentCityChange);
                                phe.cnc.base.Timer.getInstance().addListener("uiTick", this.onTick, this);
                                this.onViewModeChanged(null, ClientLib.Vis.VisMain.GetInstance().get_Mode());
                            } catch (e) { werr("Current.onAppear:", e); }
                        },
                        onDisappear: function () {
                            try {
                                phe.cnc.Util.detachNetEvent(ClientLib.Vis.VisMain.GetInstance(), "ViewModeChange", ClientLib.Vis.ViewModeChange, this, this.onViewModeChanged);
                                phe.cnc.Util.detachNetEvent(ClientLib.Vis.VisMain.GetInstance(), "SelectionChange", ClientLib.Vis.SelectionChange, this, this.onSelectionChange);
                                phe.cnc.Util.detachNetEvent(ClientLib.Data.MainData.GetInstance().get_Cities(), "CurrentOwnChange", ClientLib.Data.CurrentOwnCityChange, this, this.onCurrentCityChange);
                                phe.cnc.Util.detachNetEvent(ClientLib.Data.MainData.GetInstance().get_Cities(), "CurrentChange", ClientLib.Data.CurrentCityChange, this, this.onCurrentCityChange);
                                phe.cnc.base.Timer.getInstance().removeListener("uiTick", this.onTick, this);
                            } catch (e) { werr("Current.onDisappear:", e); }
                        },
                        onViewModeChanged: function (oldViewMode, newViewMode) {
                            if (oldViewMode === newViewMode) return;
                            switch (newViewMode) {
                                case ClientLib.Vis.Mode.City:         this.title.setValue(MMt(this.tr("Selected building")));     this.reset(); break;
                                case ClientLib.Vis.Mode.DefenseSetup: this.title.setValue(MMt(this.tr("Selected defense unit"))); this.reset(); break;
                                case ClientLib.Vis.Mode.ArmySetup:    this.title.setValue(MMt(this.tr("Selected army unit")));    this.reset(); break;
                            }
                        },
                        onSelectionChange: function (oldSelection, newSelection) {
                            if (newSelection === null) return;
                            var name, level;
                            this.txtLevel.setMaximum(ClientLib.Data.MainData.GetInstance().get_Server().get_PlayerUpgradeCap());
                            switch (newSelection.get_VisObjectType()) {
                                case ClientLib.Vis.VisObject.EObjectType.CityBuildingType:
                                    this.Selection = newSelection;
                                    name = newSelection.get_BuildingName();
                                    level = newSelection.get_BuildingLevel();
                                    this.txtSelected.setValue(name + " (" + level + ")");
                                    this.txtLevel.setMinimum(level + 1);
                                    this.txtLevel.setValue(level + 1);
                                    this.txtLevel.setEnabled(true);
                                    this.btnLevel.setEnabled(true);
                                    this.onInput();
                                    break;
                                case ClientLib.Vis.VisObject.EObjectType.DefenseUnitType:
                                case ClientLib.Vis.VisObject.EObjectType.ArmyUnitType:
                                    this.Selection = newSelection;
                                    name = newSelection.get_UnitName();
                                    level = newSelection.get_UnitLevel();
                                    this.txtSelected.setValue(name + " (" + level + ")");
                                    this.txtLevel.setMinimum(level + 1);
                                    this.txtLevel.setValue(level + 1);
                                    this.txtLevel.setEnabled(true);
                                    this.btnLevel.setEnabled(true);
                                    this.onInput();
                                    break;
                            }
                        },
                        onCurrentCityChange: function (oldCurrentCity, newCurrentCity) {
                            if (oldCurrentCity !== newCurrentCity) this.reset();
                        },
                        getResTime: function (need, type) {
                            var CurrentOwnCity = ClientLib.Data.MainData.GetInstance().get_Cities().get_CurrentOwnCity();
                            var Alliance = ClientLib.Data.MainData.GetInstance().get_Alliance();
                            need -= CurrentOwnCity.GetResourceCount(type);
                            need = Math.max(0, need);
                            var Con = CurrentOwnCity.GetResourceGrowPerHour(type);
                            var Bonus = CurrentOwnCity.get_hasCooldown() ? 0 : CurrentOwnCity.GetResourceBonusGrowPerHour(type);
                            var POI = CurrentOwnCity.get_IsGhostMode() ? 0 : Alliance.GetPOIBonusFromResourceType(type);
                            return (need <= 0 ? 0 : need / (Con + Bonus + POI) * 3600);
                        },
                        getUpgradeCostsToLevel: function (unit, newLevel) {
                            var costs = null;
                            if (unit !== null && newLevel > 0) {
                                switch (unit.get_VisObjectType()) {
                                    case ClientLib.Vis.VisObject.EObjectType.CityBuildingType:
                                        if (newLevel > unit.get_BuildingLevel()) costs = ClientLib.API.City.GetInstance().GetUpgradeCostsForBuildingToLevel(unit.get_BuildingDetails(), newLevel);
                                        break;
                                    case ClientLib.Vis.VisObject.EObjectType.DefenseUnitType:
                                        if (newLevel > unit.get_UnitLevel()) costs = ClientLib.API.Defense.GetInstance().GetUpgradeCostsForUnitToLevel(unit.get_UnitDetails(), newLevel);
                                        break;
                                    case ClientLib.Vis.VisObject.EObjectType.ArmyUnitType:
                                        if (newLevel > unit.get_UnitLevel()) costs = ClientLib.API.Army.GetInstance().GetUpgradeCostsForUnitToLevel(unit.get_UnitDetails(), newLevel);
                                        break;
                                }
                            }
                            return costs;
                        },
                        reset: function () {
                            this.Selection = null;
                            this.txtSelected.setValue("-");
                            this.txtLevel.setMinimum(0);
                            this.txtLevel.setMaximum(0);
                            this.txtLevel.resetValue();
                            this.txtLevel.setEnabled(false);
                            this.btnLevel.setEnabled(false);
                            this.onInput();
                        },
                        onTick: function () { this.onInput(); },
                        onInput: function () {
                            try {
                                var costs = this.getUpgradeCostsToLevel(this.Selection, parseInt(this.txtLevel.getValue(), 10));
                                if (costs !== null) {
                                    var Tib = 0, Cry = 0, Pow = 0, TibTime = 0, CryTime = 0, PowTime = 0;
                                    for (var i = 0; i < costs.length; i++) {
                                        var uCosts = costs[i];
                                        switch (parseInt(uCosts.Type, 10)) {
                                            case ClientLib.Base.EResourceType.Tiberium: Tib += uCosts.Count; TibTime += this.getResTime(uCosts.Count, ClientLib.Base.EResourceType.Tiberium); break;
                                            case ClientLib.Base.EResourceType.Crystal:  Cry += uCosts.Count; CryTime += this.getResTime(uCosts.Count, ClientLib.Base.EResourceType.Crystal);  break;
                                            case ClientLib.Base.EResourceType.Power:    Pow += uCosts.Count; PowTime += this.getResTime(uCosts.Count, ClientLib.Base.EResourceType.Power);    break;
                                        }
                                    }
                                    paintRes(this.resTiberium, Tib, TibTime);
                                    paintRes(this.resChrystal, Cry, CryTime);
                                    paintRes(this.resPower,    Pow, PowTime);
                                    // Enable the upgrade button when you can already afford it (original
                                    // behaviour) OR when "Transfer as needed" is on and the only thing
                                    // short is Tiberium/Crystal (transferable - PowTime===0 is still
                                    // required, since power can't be transferred).
                                    var locallyAffordable = (TibTime === 0 && CryTime === 0 && PowTime === 0);
                                    var coverableByTransfer = transferOn() && PowTime === 0;
                                    this.btnLevel.setEnabled(locallyAffordable || coverableByTransfer);
                                } else {
                                    clearRes(this.resTiberium); clearRes(this.resChrystal); clearRes(this.resPower);
                                }
                            } catch (e) { werr("Current.onInput:", e); }
                        },
                        onUpgrade: function () {
                            try {
                                var newLevel = parseInt(this.txtLevel.getValue(), 10);
                                if (newLevel <= 0 || this.Selection === null) return;
                                var sel = this.Selection;
                                var self = this;
                                var totalCosts = sumCostsByResource(this.getUpgradeCostsToLevel(sel, newLevel));
                                function fire() {
                                    try {
                                        switch (sel.get_VisObjectType()) {
                                            case ClientLib.Vis.VisObject.EObjectType.CityBuildingType:
                                                if (newLevel > sel.get_BuildingLevel()) { ClientLib.API.City.GetInstance().UpgradeBuildingToLevel(sel.get_BuildingDetails(), newLevel); self.onSelectionChange(null, sel); }
                                                break;
                                            case ClientLib.Vis.VisObject.EObjectType.DefenseUnitType:
                                                if (newLevel > sel.get_UnitLevel()) { ClientLib.API.Defense.GetInstance().UpgradeUnitToLevel(sel.get_UnitDetails(), newLevel); self.onSelectionChange(null, sel); }
                                                break;
                                            case ClientLib.Vis.VisObject.EObjectType.ArmyUnitType:
                                                if (newLevel > sel.get_UnitLevel()) { ClientLib.API.Army.GetInstance().UpgradeUnitToLevel(sel.get_UnitDetails(), newLevel); self.onSelectionChange(null, sel); }
                                                break;
                                        }
                                    } catch (e) { werr("Current.onUpgrade fire:", e); }
                                }
                                upgradeWithMaybeTransfer(totalCosts, setUpgradeStatus, fire);
                            } catch (e) { werr("Current.onUpgrade:", e); }
                        }
                    }
                });
            } catch (e) { werr("define MM.Upgrade.Current failed:", e); }

            try {
                qx.Class.define("MM.Upgrade.Repair", {
                    extend: qx.ui.container.Composite,
                    construct: function () {
                        try {
                            qx.ui.container.Composite.call(this);
                            this.set({
                                layout: new qx.ui.layout.VBox(5),
                                padding: 5,
                                decorator: "pane-light-opaque"
                            });
                            this.add(this.title = new qx.ui.basic.Label(this.tr("tnf:repair points")).set({ alignX: "center", font: "font_size_14_bold" }));
                            this.add(this.grid = new qx.ui.container.Composite(new qx.ui.layout.Grid()));

                            this._addRow(0, "basRT",  "icon_arsnl_base_buildings.png", "tnf:base",            "btnBuildings", ClientLib.Base.ETechName.Construction_Yard);
                            this._addRow(1, "infRT",  "icon_arsnl_off_squad.png",      "tnf:infantry repair title", "btnInfantry",  ClientLib.Base.ETechName.Barracks);
                            this._addRow(2, "vehRT",  "icon_arsnl_off_vehicle.png",    "tnf:vehicle repair title",  "btnVehicle",   ClientLib.Base.ETechName.Factory);
                            this._addRow(3, "airRT",  "icon_arsnl_off_plane.png",      "tnf:aircraft repair title", "btnAircraft",  ClientLib.Base.ETechName.Airport);

                            var g = this.grid.getLayout();
                            g.setRowFlex(0, 0); g.setRowFlex(1, 0); g.setRowFlex(2, 0); g.setRowFlex(3, 0);
                            g.setColumnFlex(1, 200); g.setColumnFlex(3, 200); g.setColumnFlex(5, 200);

                            this.addListener("appear", this.onAppear, this);
                            this.addListener("disappear", this.onDisappear, this);
                        } catch (e) { werr("MM.Upgrade.Repair constructor:", e); }
                    },
                    members: {
                        title: null, grid: null,
                        btnBuildings: null, btnInfantry: null, btnVehicle: null, btnAircraft: null,
                        _addRow: function (row, atomKey, icon, tip, btnKey, tech) {
                            var self = this;
                            var atom = new qx.ui.basic.Atom("", "FactionUI/icons/" + icon).set({ toolTipText: this.tr(tip) });
                            atom.getChildControl("icon").set({ width: 18, height: 18, scale: true, alignY: "middle" });
                            this.grid.add(atom, { row: row, column: 0 });
                            this[atomKey] = atom;
                            this.grid.add(new qx.ui.basic.Label("").set({ alignX: "right", alignY: "middle" }), { row: row, column: 2 });
                            this.grid.add(new qx.ui.basic.Label("").set({ alignX: "right", alignY: "middle" }), { row: row, column: 4 });
                            var btn = new qx.ui.form.Button(null, "FactionUI/icons/icon_building_detail_upgrade.png").set({
                                toolTipText: this.tr("tnf:toggle upgrade mode"),
                                width: 25, maxHeight: 17, alignY: "middle",
                                show: "icon", iconPosition: "top", appearance: "button-addpoints"
                            });
                            btn.getChildControl("icon").set({ width: 14, height: 14, scale: true });
                            btn.addListener("execute", function () { self.upgradeBuilding(tech); });
                            this.grid.add(btn, { row: row, column: 6 });
                            this[btnKey] = btn;
                        },
                        onAppear: function () {
                            try {
                                phe.cnc.Util.attachNetEvent(ClientLib.Data.MainData.GetInstance().get_Cities(), "CurrentOwnChange", ClientLib.Data.CurrentOwnCityChange, this, this.onCurrentCityChange);
                                phe.cnc.Util.attachNetEvent(ClientLib.Data.MainData.GetInstance().get_Cities(), "CurrentChange", ClientLib.Data.CurrentCityChange, this, this.onCurrentCityChange);
                                phe.cnc.base.Timer.getInstance().addListener("uiTick", this.onTick, this);
                                this.getInfo();
                            } catch (e) { werr("Repair.onAppear:", e); }
                        },
                        onDisappear: function () {
                            try {
                                phe.cnc.Util.detachNetEvent(ClientLib.Data.MainData.GetInstance().get_Cities(), "CurrentOwnChange", ClientLib.Data.CurrentOwnCityChange, this, this.onCurrentCityChange);
                                phe.cnc.Util.detachNetEvent(ClientLib.Data.MainData.GetInstance().get_Cities(), "CurrentChange", ClientLib.Data.CurrentCityChange, this, this.onCurrentCityChange);
                                phe.cnc.base.Timer.getInstance().removeListener("uiTick", this.onTick, this);
                            } catch (e) { werr("Repair.onDisappear:", e); }
                        },
                        onTick: function () { this.getInfo(); },
                        onCurrentCityChange: function (oldCurrentCity, newCurrentCity) {
                            if (oldCurrentCity !== newCurrentCity) this.getInfo();
                        },
                        canUpgradeBuilding: function (ETechName) {
                            var city = ClientLib.Data.MainData.GetInstance().get_Cities().get_CurrentOwnCity();
                            var building = city.get_CityBuildingsData().GetUniqueBuildingByTechName(ETechName);
                            if (!building) return false;
                            var ResourceRequirements_Obj = ClientLib.Base.Util.GetUnitLevelResourceRequirements_Obj(building.get_CurrentLevel() + 1, building.get_UnitGameData_Obj());
                            return (building.get_CurrentDamage() === 0 && !city.get_IsLocked() && city.HasEnoughResources(ResourceRequirements_Obj));
                        },
                        upgradeBuilding: function (ETechName) {
                            try {
                                var city = ClientLib.Data.MainData.GetInstance().get_Cities().get_CurrentOwnCity();
                                var building = city.get_CityBuildingsData().GetUniqueBuildingByTechName(ETechName);
                                if (!building) return;
                                ClientLib.Net.CommunicationManager.GetInstance().SendCommand("UpgradeBuilding", {
                                    cityid: city.get_Id(),
                                    posX: building.get_CoordX(),
                                    posY: building.get_CoordY()
                                }, null, null, true);
                            } catch (e) { werr("Repair.upgradeBuilding:", e); }
                        },
                        getInfo: function () {
                            try {
                                var lvl, win, city = ClientLib.Data.MainData.GetInstance().get_Cities().get_CurrentOwnCity();
                                if (!city) return; // no current own city yet (e.g. panel visible a tick before data loads)
                                var g = this.grid.getLayout();
                                var bd = city.get_CityBuildingsData();
                                var ud = city.get_CityUnitsData();

                                lvl = bd.GetUniqueBuildingByTechName(ClientLib.Base.ETechName.Construction_Yard).get_CurrentLevel();
                                win = (bd.GetFullRepairTime(true) - bd.GetFullRepairTime(false)) * -1;
                                g.getCellWidget(0, 0).setLabel("(" + lvl + ")");
                                g.getCellWidget(0, 2).setValue(phe.cnc.Util.getTimespanString(bd.GetFullRepairTime()));
                                g.getCellWidget(0, 4).setValue("-" + phe.cnc.Util.getTimespanString(win));

                                this._repairRow(g, 1, ud, ClientLib.Data.EUnitGroup.Infantry, bd.GetUniqueBuildingByTechName(ClientLib.Base.ETechName.Barracks));
                                this._repairRow(g, 2, ud, ClientLib.Data.EUnitGroup.Vehicle,  bd.GetUniqueBuildingByTechName(ClientLib.Base.ETechName.Factory));
                                this._repairRow(g, 3, ud, ClientLib.Data.EUnitGroup.Aircraft, bd.GetUniqueBuildingByTechName(ClientLib.Base.ETechName.Airport));

                                this.btnBuildings.setEnabled(this.canUpgradeBuilding(ClientLib.Base.ETechName.Construction_Yard));
                                this.btnInfantry .setEnabled(this.canUpgradeBuilding(ClientLib.Base.ETechName.Barracks));
                                this.btnVehicle  .setEnabled(this.canUpgradeBuilding(ClientLib.Base.ETechName.Factory));
                                this.btnAircraft .setEnabled(this.canUpgradeBuilding(ClientLib.Base.ETechName.Airport));
                            } catch (e) { werr("Repair.getInfo:", e); }
                        },
                        _repairRow: function (g, row, ud, unitGroup, building) {
                            try {
                                var t = ud.GetRepairTimeFromEUnitGroup(unitGroup, false);
                                if (t > 0) {
                                    var lvl = building.get_CurrentLevel();
                                    var win = (ud.GetRepairTimeFromEUnitGroup(unitGroup, true) - t) * -1;
                                    g.getCellWidget(row, 0).setLabel("(" + lvl + ")");
                                    g.getCellWidget(row, 2).setValue(phe.cnc.Util.getTimespanString(t));
                                    g.getCellWidget(row, 4).setValue("-" + phe.cnc.Util.getTimespanString(win));
                                    g.setRowHeight(row, 18);
                                } else {
                                    g.setRowHeight(row, 0);
                                }
                            } catch (e) { werr("Repair._repairRow:", e); }
                        }
                    }
                });
            } catch (e) { werr("define MM.Upgrade.Repair failed:", e); }
        }

        // Resource label/atom painters shared between Current + All. NOEVIL note: phe.cnc.Util's
        // getTimespanString returns "" for zero; we render either "@ Nh Mm" or " NO GROW!" for
        // non-finite grow times so the user can tell apart "have it already" vs "can't grow this".
        function paintRes(atom, amount, time) {
            try {
                var tail = (isFinite(time) && time > 0) ? MMt(" @ ") + phe.cnc.Util.getTimespanString(time)
                          : (isFinite(time) ? "" : MMt(" NO GROW!"));
                atom.setLabel(phe.cnc.gui.util.Numbers.formatNumbersCompact(amount) + tail);
                atom.setToolTipText(phe.cnc.gui.util.Numbers.formatNumbers(amount));
                if (amount === 0) atom.exclude(); else atom.show();
            } catch (e) { werr("paintRes:", e); }
        }
        function clearRes(atom) {
            try { atom.setLabel("-"); atom.resetToolTipText(); atom.show(); } catch (e) { werr("clearRes:", e); }
        }

        // -------------------------------------------------------------------
        // Translations (German / Hungarian / Russian / Spanish - carried over from the original).
        // Keys: "Selected building", "All buildings", "Selected defense unit", "All defense units",
        // "Selected army unit", "All army units". qx.locale.Manager.tr() picks them up; game-native
        // "tnf:*" keys are still resolved by the game itself.
        // -------------------------------------------------------------------
        function installTranslations() {
            try {
                var L = qx.locale.Manager.getInstance();
                L.addTranslation("de", {
                    "Selected building": "Markiertes Gebäude", "All buildings": "Alle Gebäude",
                    "Selected defense unit": "Markierte Abwehrstellung", "All defense units": "Alle Abwehrstellungen",
                    "Selected army unit": "Markierte Armee-Einheit", "All army units": "Alle Armee-Einheiten"
                });
                L.addTranslation("hu", {
                    "Selected building": "Kiválasztott létesítmény", "All buildings": "Összes létesítmény",
                    "Selected defense unit": "Kiválasztott védelmi egység", "All defense units": "Minden védelmi egység",
                    "Selected army unit": "Kiválasztott katonai egység", "All army units": "Minden katonai egység"
                });
                L.addTranslation("es", {
                    "Selected building": "Edificio seleccionado", "All buildings": "Todos los edificios",
                    "Selected defense unit": "Unidad defensiva seleccionada", "All defense units": "Todas las unidades defensivas",
                    "Selected army unit": "Unidad de ataque seleccionada", "All army units": "Todas las unidades de ataque"
                });
            } catch (e) { wwarn("installTranslations:", e); }
        }

        // -------------------------------------------------------------------
        // build(): assemble the trigger button + the panel (float + dock), wire pin / lifecycle / mode.
        // Mirrors MM - Member Status's pin/dock pattern, with two key differences:
        //   1) Anchored on the LEFT side of the desktop ({ left: 0, top: 130 }) instead of the right;
        //   2) The Info Sticker frame is mirrored: caps are NOT flipped (they face left naturally),
        //      and the body's gray strip is on the RIGHT edge of the docked panel (marginRight: 5)
        //      so it faces into the base view.
        // -------------------------------------------------------------------
        function build() {
            // Local alias for MMCommon. Don't use the bare name "MM" - the qx classes we define above
            // live under the GLOBAL `MM.*` namespace (window.MM.Upgrade.{Current,All,Repair}), and a
            // local `var MM = MMCommon` would shadow that, making `new MM.Upgrade.Current()` resolve to
            // MMCommon.Upgrade (undefined) instead of the qx class. So we alias MMCommon as MMC and
            // leave the global MM namespace for the qx classes.
            var MMC = window.MMCommon;
            if (!MMC || !MMC.ui || !MMC.menubar) { werr("MMCommon not ready"); return; }

            defineSectionClasses();

            // ---- the three sections (qx classes defined above) ----
            var secCurrent, secAll, secRepair;
            try { secCurrent = new MM.Upgrade.Current(); } catch (e) { werr("instantiate Current:", e); }
            try { secAll     = new MM.Upgrade.All();     } catch (e) { werr("instantiate All:", e); }
            try { secRepair  = new MM.Upgrade.Repair();  } catch (e) { werr("instantiate Repair:", e); }

            // ---- pin button (matches MM - Member Status: small forum-light SoundButton with a 15x15 icon) ----
            var pinBtn;
            try { pinBtn = new webfrontend.ui.SoundButton(); } catch (e) { pinBtn = new qx.ui.form.Button(); }
            pinBtn.set({
                decorator: "button-forum-light", icon: pinIcon(menuOn()), show: "icon", iconPosition: "top",
                cursor: "pointer", width: 22, height: 19, maxWidth: 22, maxHeight: 19, padding: 0, alignY: "middle",
                toolTipText: MMt("Pin into the game menu / unpin to a movable panel")
            });
            try { var _pic = pinBtn.getChildControl("icon"); _pic.setWidth(15); _pic.setHeight(15); _pic.setScale(true); } catch (e) {}
            pinBtn.addListener("execute", function () { try { setMenuMode(!menuOn()); } catch (e) { werr("pin execute:", e); } });
            // Frameless float window drags by its body - stop the pin's mousedown from starting a drag.
            pinBtn.addListener("mousedown", function (e) { try { e.stopPropagation(); } catch (x) {} });
            function updatePin() { try { pinBtn.setIcon(pinIcon(menuOn())); } catch (e) {} }

            // ---- header (title + pin) - lives WITH the content so it shows in float + dock states ----
            var titleLbl = new qx.ui.basic.Label(MMt("Upgrade")).set({ font: "bold", rich: true, alignY: "middle", textAlign: "center", allowGrowX: true });
            var headerRow = new qx.ui.container.Composite(new qx.ui.layout.HBox(0).set({ alignY: "middle" }));
            headerRow.add(new qx.ui.core.Spacer(22, 1));   // balances the pin width so title stays centred
            headerRow.add(titleLbl, { flex: 1 });
            headerRow.add(pinBtn);

            // ---- content composite = header + 3 sections + transfer footer. Re-parented between
            // float window + dock panel. Background painted per mode in placeContent(): dark solid
            // (Loot Summary look) when floating, transparent when docked so the menu texture / gray
            // strip show through.
            var content = new qx.ui.container.Composite(new qx.ui.layout.VBox(4));
            content.add(headerRow);
            if (secCurrent) content.add(secCurrent);
            if (secAll)     content.add(secAll);
            if (secRepair)  content.add(secRepair);

            // Transfer-as-needed footer (shared across all 3 sections). The checkbox writes through
            // setTransferFlag, which the section onUpgrade handlers read via transferOn() each time.
            // Below it, transferStatus is a small live status label (used during transfer flows to
            // surface "transferring...", "transfers complete", "can't afford fee" etc).
            var transferRow = new qx.ui.container.Composite(new qx.ui.layout.HBox(6).set({ alignY: "middle" }));
            transferRow.set({ padding: [2, 4, 0, 4] });
            var cbTransferUpgrade = new qx.ui.form.CheckBox(MMt("Transfer as needed")).set({
                value: transferOn(),
                alignY: "middle",
                toolTipText: MMt("When the current base lacks Tiberium or Crystal for an upgrade, transfer the shortfall in from your other bases (cheapest first) before firing the upgrade. Power isn't transferable - those shortages still fall through. Off by default (transfers cost credits).")
            });
            cbTransferUpgrade.addListener("changeValue", function (e) {
                try {
                    setTransferFlag(!!e.getData());
                    // Re-evaluate the Current section's button-enable now that the toggle changed.
                    if (secCurrent && secCurrent.onInput) try { secCurrent.onInput(); } catch (x) {}
                } catch (x) { werr("cbTransferUpgrade change:", x); }
            });
            transferRow.add(cbTransferUpgrade);
            var transferStatus = new qx.ui.basic.Label("").set({ rich: true, textColor: "#cfe6ff", alignY: "middle" });
            transferRow.add(new qx.ui.core.Spacer(8, 1));
            transferRow.add(transferStatus, { flex: 1 });
            content.add(transferRow);
            // Wire the main-scope statusSink to this label so the section onUpgrade handlers can
            // surface transfer progress via setUpgradeStatus(html).
            statusSink = function (html) { try { transferStatus.setValue(html || ""); } catch (e) {} };

            try { content.setBackgroundColor("#23282b"); content.setPadding(8); } catch (e) {} // default to floating look

            // ---- floating panel (frameless, drag-by-body, position persists across reloads) ----
            var win = MMC.ui.Window({
                caption: MMt("Upgrade"),
                key: "Upgrade.Window",
                pos: [120, 120],
                restoreOpen: false,           // entry point is the in-game Upgrade button, not auto-open
                frameless: true,
                dock: true,
                layout: new qx.ui.layout.VBox()
            });
            if (!win) { werr("could not create window"); return; }
            win.add(content);

            // ---- docked side panel: built lazily on first pin. Anchored so the panel's RIGHT edge
            // sits flush against the central base widget (the qx PlayArea) with a small gap. Using
            // RIGHT-side anchoring (not "left:X-panel.width") because the panel is content-driven so
            // its actual width is fluid - right-anchoring lets the panel grow leftward from the base
            // view's left edge automatically, no width math required. PlayArea's position depends on
            // viewport size (it's centered between the LeftBarsGroup and the right base bar), so we
            // recompute the anchor on resize and via a 1-second polling backup since qx's "resize"
            // events on PlayArea don't always fire reliably on browser-window resize.
            var DOCK_GAP        = 3;    // px breathing room between dock right edge and PlayArea left
            var DOCK_FALLBACK_LEFT = 130;
            var DOCK_FALLBACK_TOP  = 130;
            function dockAnchor() {
                try {
                    var app = qx.core.Init.getApplication();
                    var pa = app && app.getPlayArea && app.getPlayArea();
                    var loc = pa && pa.getContentLocation && pa.getContentLocation();
                    if (!loc || loc.left == null) return { left: DOCK_FALLBACK_LEFT, top: DOCK_FALLBACK_TOP };
                    var deskW = 0;
                    try {
                        var d = app.getDesktop && app.getDesktop();
                        var db = d && d.getBounds && d.getBounds();
                        deskW = (db && db.width) || window.innerWidth || 0;
                    } catch (e) { deskW = window.innerWidth || 0; }
                    if (!deskW) return { left: DOCK_FALLBACK_LEFT, top: DOCK_FALLBACK_TOP };
                    var rightOffset = Math.max(0, deskW - loc.left + DOCK_GAP);
                    // left:null clears any prior left-anchor so the canvas layout uses our right value
                    return { left: null, right: rightOffset, top: Math.max(0, loc.top || 0) };
                } catch (e) { return { left: DOCK_FALLBACK_LEFT, top: DOCK_FALLBACK_TOP }; }
            }
            var lastAnchor = null;
            function anchorsEqual(a, b) {
                if (!a || !b) return false;
                return a.left === b.left && a.right === b.right && a.top === b.top;
            }
            function repositionDock() {
                if (!sp.panel) return;
                try {
                    var a = dockAnchor();
                    if (anchorsEqual(a, lastAnchor)) return;
                    sp.panel.setLayoutProperties(a);
                    lastAnchor = a;
                } catch (e) { werr("repositionDock:", e); }
            }

            var sp = { panel: null, body: null, built: false };
            function buildSidePanel() {
                if (sp.built) return sp.panel;
                try {
                    var app = qx.core.Init.getApplication();
                    if (!app || !app.getDesktop || !MMC.menubar || !MMC.menubar.styledPanel) return null;
                    var holder = new qx.ui.container.Composite(new qx.ui.layout.VBox()).set({ maxWidth: 280, alignX: "right" });
                    var topCap = new qx.ui.basic.Image("ui/common/bgr_messaging_t.png").set({ allowGrowX: true, height: 11, scale: true, zIndex: 12, marginLeft: -5 });
                    var botCap = new qx.ui.basic.Image("ui/common/bgr_messaging_b.png").set({ allowGrowX: true, height: 11, scale: true, zIndex: 12, marginLeft: -5 });
                    // The game's caps are drawn with the curl on one side and a flat seam on the other;
                    // for the left-anchored panel we want the FLAT seam against the base view (the panel's
                    // right edge, which sits flush against PlayArea), and the curl on the outer left edge.
                    // The flip puts the curl-on-original-right onto the rendered left edge.
                    topCap.addListener("appear", function () { try { topCap.getContentElement().getDomElement().style.transform = "scale(-1,1)"; } catch (e) {} });
                    botCap.addListener("appear", function () { try { botCap.getContentElement().getDomElement().style.transform = "scale(-1,1)"; } catch (e) {} });
                    var body = MMC.menubar.styledPanel({ width: 230, spacing: 4, padding: [4, 6, 4, 6] });
                    body.setMarginLeft(5);   // gray strip on the LEFT of the body (matching MM - Member Status's docked look on the opposite side)
                    body.setAlignX("right");
                    var dataSection = new qx.ui.container.Composite(new qx.ui.layout.VBox()).set({ allowGrowX: true, decorator: "pane-navigation-bar" });
                    dataSection.add(body);
                    holder.add(topCap);
                    holder.add(dataSection);
                    holder.add(botCap);
                    sp.panel = holder;
                    sp.body = body;
                    // Anchor the panel's RIGHT edge flush to PlayArea.left (with DOCK_GAP px breathing).
                    // dockAnchor() reads PlayArea's current screen location and converts to a desktop
                    // right-offset; repositionDock() updates it on resize.
                    var initialAnchor = dockAnchor();
                    app.getDesktop().add(holder, initialAnchor);
                    lastAnchor = initialAnchor;
                    sp.built = true;
                    // Track PlayArea position changes via every signal we can reach. qx's "resize" event
                    // on PlayArea sometimes doesn't fire when the OUTER browser window resizes (the
                    // canvas reflows but qx doesn't always propagate), so we layer multiple sources.
                    try {
                        var pa2 = app.getPlayArea();
                        if (pa2 && pa2.addListener) {
                            pa2.addListener("resize", repositionDock);
                            pa2.addListener("appear", repositionDock);
                        }
                    } catch (e) { wwarn("attach PlayArea resize:", e); }
                    try {
                        var root = app.getRoot && app.getRoot();
                        if (root && root.addListener) root.addListener("resize", repositionDock);
                    } catch (e) {}
                    try { window.addEventListener("resize", repositionDock); } catch (e) {}
                    // Polling backup - some viewport changes (e.g. devtools toggle, browser-zoom) don't
                    // fire any of the above events reliably. A 1Hz check while the panel is visible is
                    // cheap (one getContentLocation read + one no-op anchor compare).
                    try {
                        sp._pollTimer = window.setInterval(function () {
                            try { if (sp.panel && sp.panel.isVisible && sp.panel.isVisible()) repositionDock(); } catch (e) {}
                        }, 1000);
                    } catch (e) {}
                } catch (e) { werr("buildSidePanel:", e); sp.panel = null; }
                return sp.panel;
            }

            // Move the content into whichever container is active (the side panel or the float window).
            function placeContent() {
                try {
                    var docked = menuOn();
                    var host = win;
                    if (docked) { buildSidePanel(); host = sp.body || win; }
                    try { content.setBackgroundColor(docked ? null : "#23282b"); content.setPadding(docked ? 0 : 8); } catch (e) {}
                    var cur = content.getLayoutParent && content.getLayoutParent();
                    if (cur !== host) { if (cur && cur.remove) cur.remove(content); host.add(content); }
                } catch (e) { werr("placeContent:", e); }
            }

            function isShown() {
                try { return menuOn() ? !!(sp.panel && sp.panel.isVisible && sp.panel.isVisible()) : win.isVisible(); }
                catch (e) { return false; }
            }
            function showPanel() {
                try {
                    if (menuOn()) {
                        buildSidePanel(); placeContent();
                        if (sp.panel) { sp.panel.show(); repositionDock(); }
                    } else {
                        placeContent();
                        win.open();
                    }
                } catch (e) { werr("showPanel:", e); }
            }
            function hidePanel() {
                try {
                    if (sp.panel) sp.panel.exclude();
                    try { win.close(); } catch (e) {}
                } catch (e) { werr("hidePanel:", e); }
            }
            function togglePanel() { if (isShown()) hidePanel(); else showPanel(); }

            function setMenuMode(on) {
                try {
                    setMenuFlag(on === true);
                    updatePin();
                    if (on) {
                        buildSidePanel(); placeContent();
                        if (sp.panel) { sp.panel.show(); repositionDock(); }
                        try { win.close(); } catch (e) {}
                    } else {
                        if (sp.panel) sp.panel.exclude();
                        placeContent();
                        try { win.open(); } catch (e) {}
                    }
                } catch (e) { werr("setMenuMode:", e); }
            }

            // The data the panel shows (current/all upgrade costs, repair times) is base-scoped: it
            // needs `get_CurrentOwnCity()` populated, which is only true while in City/DefenseSetup/
            // ArmySetup mode. On the region map there's no current own city - the original WarChiefs
            // script handled this by auto-closing the float window when leaving a base. We do the
            // same for both modes: never show the panel outside a base view (even when pinned), and
            // auto-show the docked panel when entering one (this is the "pinned" UX = "always visible
            // while I'm working in a base").
            function inBaseMode(mode) {
                return mode === ClientLib.Vis.Mode.City
                    || mode === ClientLib.Vis.Mode.DefenseSetup
                    || mode === ClientLib.Vis.Mode.ArmySetup;
            }

            // ---- title text auto-updates with view mode; panel auto-shows/hides on enter/leave ----
            function onViewModeChanged(oldMode, newMode) {
                if (oldMode === newMode) return;
                try {
                    var label;
                    switch (newMode) {
                        case ClientLib.Vis.Mode.City:         label = MMt("Upgrade: Base"); break;
                        case ClientLib.Vis.Mode.DefenseSetup: label = MMt("Upgrade: Defense"); break;
                        case ClientLib.Vis.Mode.ArmySetup:    label = MMt("Upgrade: Offense"); break;
                        default:
                            // Left a base view (back to region etc.). Hide whichever container is up,
                            // and skip the section onAppear churn until we're back in a base.
                            hidePanel();
                            return;
                    }
                    titleLbl.setValue(label);
                    // When pinned, the docked panel "follows" you into the base - auto-show it on enter.
                    // (Float mode stays closed until the user clicks the trigger button - matches original.)
                    if (menuOn()) {
                        try { buildSidePanel(); placeContent(); if (sp.panel) { sp.panel.show(); repositionDock(); } } catch (e) { werr("auto-show on enter:", e); }
                    }
                } catch (e) { werr("onViewModeChanged:", e); }
            }
            try {
                phe.cnc.Util.attachNetEvent(ClientLib.Vis.VisMain.GetInstance(), "ViewModeChange", ClientLib.Vis.ViewModeChange, this, onViewModeChanged);
                onViewModeChanged(null, ClientLib.Vis.VisMain.GetInstance().get_Mode());
            } catch (e) { werr("attach ViewModeChange:", e); }

            // ---- the in-game trigger button (kept: next to Trade in the base HUD) ----
            // Preserved from the original WarChiefs script - the game-styled button with the Upgrade icon
            // that opens/closes the panel. Mike asked to keep this; it's the primary entry point.
            var triggerBtn = null, triggerHost = null;
            function addTrigger() {
                if (triggerBtn) return;
                try {
                    var qxApp = qx.core.Init.getApplication();
                    triggerBtn = new qx.ui.form.Button(qxApp.tr("tnf:toggle upgrade mode"), "FactionUI/icons/icon_building_detail_upgrade.png").set({
                        toolTipText: qxApp.tr("tnf:toggle upgrade mode"),
                        alignY: "middle",
                        show: "icon",
                        width: 60,
                        allowGrowX: false,
                        allowGrowY: false,
                        appearance: "button"
                    });
                    triggerBtn.addListener("click", togglePanel, this);
                    var btnTrade = qxApp.getPlayArea().getHUD().getUIItem(ClientLib.Data.Missions.PATH.WDG_TRADE);
                    triggerHost = btnTrade.getLayoutParent();
                    triggerHost.addAfter(triggerBtn, btnTrade);
                } catch (e) { werr("addTrigger (placing next to Trade):", e); }
            }
            function removeTrigger() {
                try {
                    if (triggerBtn && triggerHost && triggerHost.indexOf(triggerBtn) >= 0) triggerHost.remove(triggerBtn);
                    if (triggerBtn && triggerBtn.destroy) triggerBtn.destroy();
                } catch (e) {}
                triggerBtn = null; triggerHost = null;
            }
            addTrigger();

            // ---- live enable/disable from the CnC Pack menu ----
            try {
                MMC.lifecycle.watch(SCRIPT_ID, {
                    onDisable: function () {
                        try { removeTrigger(); hidePanel(); if (sp.panel) { try { sp.panel.exclude(); } catch (e) {} } } catch (e) { werr("onDisable:", e); }
                    },
                    onEnable: function () {
                        try { addTrigger(); } catch (e) { werr("onEnable:", e); }
                    }
                });
            } catch (e) { werr("lifecycle.watch:", e); }

            // Side panel auto-restores on reload ONLY when pinned AND the user is already in a base
            // view at load time. On the region map we don't even build the side panel yet - that
            // happens lazily when the user enters a base (onViewModeChanged handler above). This
            // avoids both (a) the side panel being visible behind the resource UI on the region map,
            // and (b) firing the section onAppear handlers when get_CurrentOwnCity() is null and the
            // obfuscated upgrade API would crash.
            updatePin();
            var currentMode;
            try { currentMode = ClientLib.Vis.VisMain.GetInstance().get_Mode(); } catch (e) { currentMode = null; }
            if (menuOn() && inBaseMode(currentMode)) {
                placeContent();   // builds side panel + reparents content into it
                if (sp.panel) { sp.panel.show(); repositionDock(); }
                // Keep a short retry in case the desktop/menu bar lags behind nav-ready.
                if (!sp.built) {
                    var mTries = 0;
                    (function tryDock() {
                        try {
                            if (!menuOn() || !inBaseMode(ClientLib.Vis.VisMain.GetInstance().get_Mode())) return;
                            if (buildSidePanel()) { placeContent(); if (sp.panel) { sp.panel.show(); repositionDock(); } return; }
                        } catch (e) {}
                        if (++mTries < 60) window.setTimeout(tryDock, 500);
                    })();
                }
            } else if (!menuOn()) {
                // Floating mode: content stays in the float window; window stays closed until the
                // user clicks the in-game Upgrade trigger button (restoreOpen is intentionally false).
                placeContent();
                try { win.close(); } catch (e) {}
            }
            // else (pinned but in Region/World/None): leave content in `win` until the user enters
            // a base view; onViewModeChanged will then build the side panel and reparent the content.

            wlog("ready (pinned =", menuOn(), ")");
        }

        // -------------------------------------------------------------------
        // Wait until the game UI is ready + MMCommon is loaded, then build once.
        // -------------------------------------------------------------------
        var tries = 0;
        function waitReady() {
            try {
                if (typeof qx === "undefined" || !qx.core || !qx.core.Init) { window.setTimeout(waitReady, 1000); return; }
                var app = qx.core.Init.getApplication();
                if (!app || app.initDone !== true) { window.setTimeout(waitReady, 1000); return; }
                // also need MMCommon + the base-HUD getHUD() so we can place the trigger
                if (!window.MMCommon || !MMCommon.ui || !MMCommon.menubar) { window.setTimeout(waitReady, 1000); return; }
                var hud = null;
                try { hud = app.getPlayArea && app.getPlayArea().getHUD && app.getPlayArea().getHUD(); } catch (e) {}
                if (!hud) { window.setTimeout(waitReady, 1000); return; }
                wlog("loading");
                installTranslations();
                build();
                wlog("loaded");
            } catch (e) {
                werr("waitReady:", e);
                tries++;
                if (tries < 60) window.setTimeout(waitReady, 1000);
            }
        }
        window.setTimeout(waitReady, 1000);
    };

    function inject() {
        if (window.location.pathname === "/login/auth") return;
        var s = document.createElement("script");
        s.textContent = "(" + Upgrade_main.toString() + ")();";
        s.type = "text/javascript";
        document.getElementsByTagName("head")[0].appendChild(s);
    }
    inject();
})();
