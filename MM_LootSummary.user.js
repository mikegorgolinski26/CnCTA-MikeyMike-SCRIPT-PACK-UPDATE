// ==UserScript==
// @name            MM - Loot Summary
// @description     Click any base / camp on the region map and a panel shows its lootable resources, offense/defense/base levels, condition, and where its Defense Facility & Construction Yard sit. Rebuilt on the MM - Common Library (merges the old MHTools "Available Loot Summary + Info" and "PluginsLib mhLoot").
// @author          MH, netquik (original MHTools / PluginsLib mhLoot)
// @contributor     MikeyMike (CnCTA-MikeyMike-SCRIPT-PACK)
// @version         1.0.0
// @match           https://*.alliances.commandandconquer.com/*/index.aspx*
// @downloadURL     https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/MM_LootSummary.user.js
// @updateURL       https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/MM_LootSummary.user.js
// ==/UserScript==

/*
================================================================================
 MM - Loot Summary
================================================================================
 WHAT IT DOES
   While the panel is open, click any base or camp on the region map and it
   shows, for that target:
     - Lootable resources: Research Points / Tiberium / Crystal / Credits
       (computed from the target's repair costs, scaled by its current damage -
       i.e. what you'd actually take).
     - Levels: Base / Defense / Offense.
     - Condition: buildings / defense / offense health %.
     - Key buildings: which row the Defense Facility and Construction Yard are on
       (rows from the front), with the support weapon if present.
   The colour of the title shows the relationship (own / alliance / neutral /
   enemy). Clicking empty map or leaving region view shows a "select a base" hint.

 WHY IT'S NEEDED
   It's the fastest read on whether a base is worth attacking - loot and how hard
   it is to crack - without opening each base's full info.

 HISTORY
   Merges two near-duplicate legacy scripts (MHTools "Available Loot Summary +
   Info" and the "PluginsLib mhLoot" plugin) into one MikeyMike script with no
   private de-obfuscation or plugin framework - all the data comes from the
   MM - Common Library.

 DEPENDENCIES (pack rule: wrapper + Common Library only)
     MMCommon.map.onSelection / selectedObject - region selection events
     MMCommon.base.relationshipFromVis / army / keyBuildings / fetchDetail
     MMCommon.loot.ofCity - lootable resources
     MMCommon.ui.Window + MMCommon.buttons - the panel + HUD toggle
   No dependency on any other userscript.

 Settings (MMCommon.settings, per player+world): LootSummary.* (window geom + open
 state). Debug: window.MMLOOTSUMMARY_DEBUG = true (or window.MM_DEBUG = true).
================================================================================
*/

(function () {
    var LootSummary_main = function () {
        var LOG = (window.MMCommon && window.MMCommon.makeLogger)
            ? window.MMCommon.makeLogger("Loot Summary")
            : { log: function () {}, warn: function () { try { console.warn.apply(console, arguments); } catch (e) {} }, err: function () { try { console.error.apply(console, arguments); } catch (e) {} } };

        if (typeof window.MMLOOTSUMMARY_DEBUG === "undefined") {
            try { window.MMLOOTSUMMARY_DEBUG = (window.localStorage.getItem("MMLOOTSUMMARY_DEBUG") === "1"); } catch (e) { window.MMLOOTSUMMARY_DEBUG = false; }
        }
        var wlog = function () { if (!(window.MMLOOTSUMMARY_DEBUG || window.MM_DEBUG)) return; LOG.log.apply(LOG, arguments); };
        var wwarn = function () { LOG.warn.apply(LOG, arguments); };
        var werr = function () { LOG.err.apply(LOG, arguments); };

        var MM = window.MMCommon;

        // relationship -> title colour (matches MM - Player Base Info's accents)
        var REL_COLOR = { own: "#19e3ff", alliance: "#36f05a", neutral: "#ffffff", enemy: "#ff3030" };

        function build() {
            wlog("building UI");
            var ER = ClientLib.Base.EResourceType;

            var body = new qx.ui.container.Composite(new qx.ui.layout.VBox(5))
                .set({ padding: 8, backgroundColor: "#23282b", width: 232 });

            var titleLbl = new qx.ui.basic.Label("Loot Summary").set({
                rich: true, textAlign: "center", allowGrowX: true, textColor: "#cfe6ff",
                font: new qx.bom.Font(13, ["sans-serif"]).set({ bold: true })
            });
            body.add(titleLbl);

            // hint shown when nothing is selected
            var hintLbl = new qx.ui.basic.Label("Click a base or camp on the map.").set({
                rich: true, textAlign: "center", allowGrowX: true, textColor: "#9fb4c0",
                font: new qx.bom.Font(11, ["sans-serif"])
            });
            body.add(hintLbl);

            // the data block (a stack of rich labels), hidden until something is selected
            function row(color) {
                return new qx.ui.basic.Label("").set({
                    rich: true, textAlign: "center", allowGrowX: true, textColor: color || "#e8e8e8",
                    font: new qx.bom.Font(12, ["sans-serif"])
                });
            }
            var lootLbl = row("#e8e8e8");
            var lvlLbl = row("#cfe0ea");
            var condLbl = row("#cfe0ea");
            var bldLbl = row("#b9c2c7");
            var dataBox = new qx.ui.container.Composite(new qx.ui.layout.VBox(4));
            dataBox.add(lootLbl);
            dataBox.add(lvlLbl);
            dataBox.add(condLbl);
            dataBox.add(bldLbl);
            dataBox.exclude(); // hidden until a base is selected
            body.add(dataBox);

            var win = MM.ui.Window({
                caption: "Loot Summary",
                key: "LootSummary.Window",
                layout: new qx.ui.layout.VBox(),
                pos: [260, 160],
                resizable: false,
                restoreOpen: true,
                dock: true
            });
            if (!win) { werr("window creation failed"); return; }
            win.add(body);

            MM.buttons.register({
                id: "mm-loot-summary",
                label: "Loot Info",
                tooltip: "Loot + levels of the base you click on the map",
                onExecute: function () {
                    try { if (win.isVisible()) win.close(); else { win.open(); render(MM.map.selectedObject()); } }
                    catch (e) { werr("toggle failed:", e); }
                }
            });

            function showHint(msg) {
                try { hintLbl.setValue(msg || "Click a base or camp on the map."); hintLbl.show(); dataBox.exclude(); titleLbl.setValue("Loot Summary"); titleLbl.setTextColor("#cfe6ff"); } catch (e) {}
            }
            function compact(n) { try { return MM.num.compact(n || 0); } catch (e) { return String(Math.round(n || 0)); } }
            function pct(n) { return (n == null) ? "?" : (Math.round(n) + "%"); }

            // Fill the data block from a loaded city object.
            function renderCity(vo, ncity, rel) {
                try {
                    var name = "";
                    try { name = (vo.get_PlayerName && vo.get_PlayerName()) || (ncity.get_Name && ncity.get_Name()) || ""; } catch (e) {}
                    titleLbl.setValue(name ? name : "Target");
                    titleLbl.setTextColor(REL_COLOR[rel] || "#ffffff");

                    var loot = MM.loot.ofCity(ncity);
                    lootLbl.setValue(
                        "<span style='color:#ffe14d'>RP " + compact(loot[ER.ResearchPoints]) + "</span>  "
                        + "<span style='color:#7CFC00'>T " + compact(loot[ER.Tiberium]) + "</span>  "
                        + "<span style='color:#67c8ff'>C " + compact(loot[ER.Crystal]) + "</span>  "
                        + "<span style='color:#ff8f00'>$ " + compact(loot[ER.Gold]) + "</span>"
                    );

                    var army = MM.base.army(ncity);
                    lvlLbl.setValue("Base <b>" + army.base.Level + "</b>   Def <b>" + army.defense.Level + "</b>   Off <b>" + army.offense.Level + "</b>");
                    condLbl.setValue("Condition  Bld " + pct(army.base.HealthInPercent) + " · Def " + pct(army.defense.HealthInPercent) + " · Off " + pct(army.offense.HealthInPercent));

                    var kb = MM.base.keyBuildings(ncity);
                    var parts = [];
                    if (kb.df) parts.push("DF row " + kb.df.row);
                    if (kb.cy) parts.push("CY row " + kb.cy.row);
                    if (kb.support) parts.push("Support row " + kb.support.row);
                    bldLbl.setValue(parts.length ? parts.join("  ·  ") : "");
                    bldLbl.setVisibility(parts.length ? "visible" : "excluded");

                    hintLbl.exclude();
                    dataBox.show();
                } catch (e) { werr("renderCity failed:", e); showHint("Couldn't read that target."); }
            }

            // Render whatever region object is selected (or a hint if none / not in region view).
            function render(vo) {
                try {
                    if (!win.isVisible()) return;
                    if (!vo || !MM.map.inRegionView()) { showHint(); return; }
                    var EO = ClientLib.Vis.VisObject.EObjectType;
                    var t = (typeof vo.get_VisObjectType === "function") ? vo.get_VisObjectType() : null;
                    var lootable = (t === EO.RegionCityType || t === EO.RegionNPCBase || t === EO.RegionNPCCamp);
                    if (!lootable) { // POIs / ruins / hubs have no lootable base data here
                        var nm = ""; try { nm = (vo.get_PlayerName && vo.get_PlayerName()) || ""; } catch (e) {}
                        showHint("No loot data for this object" + (nm ? " (" + nm + ")" : "") + ".");
                        return;
                    }
                    var id = vo.get_Id();
                    var rel = MM.base.relationshipFromVis(vo);
                    var cities = ClientLib.Data.MainData.GetInstance().get_Cities();
                    var ncity = null; try { ncity = cities.GetCity(id); } catch (e) {}
                    if (ncity && ncity.get_Version() > 0) { renderCity(vo, ncity, rel); return; }
                    // not loaded yet - the game usually loads a base on select, but fall back to a one-shot
                    // detail load (user-initiated single target, not a background survey).
                    showHint("Loading...");
                    MM.base.fetchDetail(id, function (nc) {
                        try {
                            if (!win.isVisible()) return;
                            var still = MM.map.selectedObject();
                            if (!still || (typeof still.get_Id === "function" && still.get_Id() !== id)) return; // selection moved on
                            if (nc) renderCity(vo, nc, rel); else showHint("Couldn't load that target.");
                        } catch (e) { werr("fetchDetail cb:", e); }
                    }, { intervalMs: 150, tries: 30 });
                } catch (e) { werr("render failed:", e); }
            }

            // update on selection (only while the panel is open), and on open
            MM.map.onSelection(function (vo) { if (win.isVisible()) render(vo); });
            win.addListener("appear", function () { render(MM.map.selectedObject()); });
            // safety: clear to the hint when leaving region view (ClientLib.Vis.ModeChange doesn't exist on
            // this client, so onSelection can't catch it - the safe camera poll does). Cheap: only acts on
            // the region<->base flip, and only while the panel is open.
            try { MM.map.watch({ onChange: function (st) { if (win.isVisible() && !st.region) showHint(); } }); } catch (e) {}

            wlog("ready");
        }

        var tries = 0;
        function waitReady() {
            try {
                var app = (typeof qx != "undefined" && qx.core && qx.core.Init) ? qx.core.Init.getApplication() : null;
                var navReady = app && app.getUIItem && app.getUIItem(ClientLib.Data.Missions.PATH.BAR_NAVIGATION) && app.getUIItem(ClientLib.Data.Missions.PATH.BAR_NAVIGATION).isVisible();
                if (navReady && window.MMCommon && window.MMCommon.ui && window.MMCommon.buttons && window.MMCommon.map && window.MMCommon.loot && window.MMCommon.base) {
                    MM = window.MMCommon;
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
        script.textContent = "(" + LootSummary_main.toString() + ")();";
        script.type = "text/javascript";
        if (/commandandconquer\.com/i.test(document.domain)) {
            (document.head || document.documentElement).appendChild(script);
        }
    } catch (e) {
        console.error("[MM Loot Summary] init error: ", e);
    }
})();
