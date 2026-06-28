// ==UserScript==
// @name            MM - Loot Summary
// @description     Click any base / camp on the region map and a panel shows its lootable resources, offense/defense/base levels, condition, and where its Defense Facility & Construction Yard sit. Rebuilt on the MM - Common Library (merges the old MHTools "Available Loot Summary + Info" and "PluginsLib mhLoot").
// @author          MH, netquik (original MHTools / PluginsLib mhLoot)
// @contributor     MikeyMike (CnCTA-MikeyMike-SCRIPT-PACK)
// @version         1.1.3
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
     - Condition: buildings / defense / offense health as colour-coded 0-100 bars
       (red low / yellow mid / green high - the same bar style as MM - Next MCV).
     - Key buildings: which row the Defense Facility and Construction Yard are on
       (rows from the front), with the support weapon if present.
   The colour of the title shows the relationship (own / alliance / neutral /
   enemy). Clicking empty map or leaving region view shows a "select a base" hint.

 UX: a frameless, draggable floating panel (no title bar - drag it by its body;
 the base name is the title) opened by the "Loot Info" HUD-tray button (toggle).

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
        // i18n fallback: hoisted so MMt() is always defined even if the Common Library's global
        // loads after this script (extension injection order isn't guaranteed). Identity in English.
        function MMt(s){try{return (window.MMCommon&&window.MMCommon.i18n)?window.MMCommon.i18n.t(s):s;}catch(e){return s;}}
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

            var titleLbl = new qx.ui.basic.Label(MMt("Loot Summary")).set({
                rich: true, textAlign: "center", allowGrowX: true, textColor: "#cfe6ff",
                font: new qx.bom.Font(13, ["sans-serif"]).set({ bold: true })
            });
            body.add(titleLbl);

            // hint shown when nothing is selected
            var hintLbl = new qx.ui.basic.Label(MMt("Click a base or camp on the map.")).set({
                rich: true, textAlign: "center", allowGrowX: true, textColor: "#9fb4c0",
                font: new qx.bom.Font(11, ["sans-serif"])
            });
            body.add(hintLbl);

            // the data block (rich-label rows + three condition bars), hidden until something is selected
            function row(color) {
                return new qx.ui.basic.Label("").set({
                    rich: true, textAlign: "center", allowGrowX: true, textColor: color || "#e8e8e8",
                    font: new qx.bom.Font(12, ["sans-serif"])
                });
            }
            // a 0-100 progress bar (rich label rendering a self-contained HTML bar), as in MM - Next MCV
            function progressBar() { return new qx.ui.basic.Label("").set({ rich: true, allowGrowX: true, height: 18 }); }
            var lootLbl = row("#e8e8e8");
            var lvlLbl = row("#cfe0ea");
            var bldBar = progressBar();   // buildings condition %
            var defBar = progressBar();   // defense condition %
            var offBar = progressBar();   // offense condition %
            var bldLbl = row("#b9c2c7");  // key buildings (DF / CY / Support rows)
            var dataBox = new qx.ui.container.Composite(new qx.ui.layout.VBox(4));
            dataBox.add(lootLbl);
            dataBox.add(lvlLbl);
            dataBox.add(bldBar);
            dataBox.add(defBar);
            dataBox.add(offBar);
            dataBox.add(bldLbl);
            dataBox.exclude(); // hidden until a base is selected
            body.add(dataBox);

            var win = MM.ui.Window({
                caption: MMt("Loot Summary"),
                key: "LootSummary.Window",
                layout: new qx.ui.layout.VBox(),
                pos: [260, 160],
                resizable: false,
                restoreOpen: true,
                dock: true,
                frameless: true   // clean floating panel, dragged by its body; toggled by the HUD button
            });
            if (!win) { werr("window creation failed"); return; }
            win.add(body);

            MM.buttons.register({
                id: "mm-loot-summary",
                label: MMt("Loot Info"),
                tooltip: MMt("Loot + levels of the base you click on the map"),
                onExecute: function () {
                    try { if (win.isVisible()) win.close(); else { win.open(); render(MM.map.selectedObject()); } }
                    catch (e) { werr("toggle failed:", e); }
                }
            });

            function showHint(msg) {
                try { hintLbl.setValue(msg || MMt("Click a base or camp on the map.")); hintLbl.show(); dataBox.exclude(); titleLbl.setValue(MMt("Loot Summary")); titleLbl.setTextColor("#cfe6ff"); } catch (e) {}
            }
            function compact(n) { try { return MM.num.compact(n || 0); } catch (e) { return String(Math.round(n || 0)); } }

            // colour-by-magnitude bar, identical to MM - Next MCV: red low / yellow mid / green high.
            function barColor(p) { return (p < 15) ? "#cc3b2e" : (p < 85) ? "#c7a91e" : "#3a9d3a"; }
            function barHtml(value, label) {
                var p = Math.max(0, Math.min(100, (value == null ? 0 : value)));
                return '<div style="position:relative;height:18px;background:#11151a;border:1px solid #3a4750;border-radius:4px;overflow:hidden;">'
                    + '<div style="position:absolute;left:0;top:0;bottom:0;width:' + p.toFixed(1) + '%;background:' + barColor(p) + ';"></div>'
                    + '<div style="position:absolute;left:0;right:0;top:0;height:18px;line-height:18px;text-align:center;font:bold 11px sans-serif;color:#fff;text-shadow:0 0 3px #000,0 0 2px #000;">' + label + '</div>'
                    + '</div>';
            }
            function condBar(bar, name, h) { bar.setValue(barHtml(h, name + "  " + (h == null ? "?" : Math.round(h) + "%"))); }

            // Fill the data block from a loaded city object.
            function renderCity(vo, ncity, rel) {
                try {
                    var name = "";
                    try { name = (vo.get_PlayerName && vo.get_PlayerName()) || (ncity.get_Name && ncity.get_Name()) || ""; } catch (e) {}
                    titleLbl.setValue(name ? name : MMt("Target"));
                    titleLbl.setTextColor(REL_COLOR[rel] || "#ffffff");

                    var loot = MM.loot.ofCity(ncity);
                    lootLbl.setValue(
                        "<span style='color:#ffe14d'>" + MMt("RP") + " " + compact(loot[ER.ResearchPoints]) + "</span>  "
                        + "<span style='color:#7CFC00'>" + MMt("T") + " " + compact(loot[ER.Tiberium]) + "</span>  "
                        + "<span style='color:#67c8ff'>" + MMt("C") + " " + compact(loot[ER.Crystal]) + "</span>  "
                        + "<span style='color:#ff8f00'>$ " + compact(loot[ER.Gold]) + "</span>"
                    );

                    var army = MM.base.army(ncity);
                    lvlLbl.setValue(MMt("Base") + " <b>" + army.base.Level + "</b>   " + MMt("Def") + " <b>" + army.defense.Level + "</b>   " + MMt("Off") + " <b>" + army.offense.Level + "</b>");
                    condBar(bldBar, MMt("Buildings"), army.base.HealthInPercent);
                    condBar(defBar, MMt("Defense"), army.defense.HealthInPercent);
                    condBar(offBar, MMt("Offense"), army.offense.HealthInPercent);

                    var kb = MM.base.keyBuildings(ncity);
                    var parts = [];
                    if (kb.df) parts.push(MMt("DF row") + " " + kb.df.row);
                    if (kb.cy) parts.push(MMt("CY row") + " " + kb.cy.row);
                    if (kb.support) parts.push(MMt("Support row") + " " + kb.support.row);
                    bldLbl.setValue(parts.length ? parts.join("  ·  ") : "");
                    bldLbl.setVisibility(parts.length ? "visible" : "excluded");

                    hintLbl.exclude();
                    dataBox.show();
                } catch (e) { werr("renderCity failed:", e); showHint(MMt("Couldn't read that target.")); }
            }

            // True once the base's buildings have actually loaded. Loot AND condition both derive from
            // get_Buildings(), which is empty for a beat after you first select a base (the game loads it
            // asynchronously). get_Version()>0 alone is NOT enough - it can read true while buildings are
            // still empty, which is what made the FIRST click show RP/T/C/$ = 0 and 0% condition until you
            // reselected. Gating on buildings-present fixes that.
            function cityReady(ncity) {
                try {
                    if (!ncity || ncity.get_Version() <= 0) return false;
                    var b = ncity.get_Buildings();
                    if (b) { if (b.c > 0) return true; if (b.d) { for (var k in b.d) return true; } }
                } catch (e) {}
                return false;
            }
            var loadTimer = null;
            function cancelLoad() { if (loadTimer) { try { clearTimeout(loadTimer); } catch (e) {} loadTimer = null; } }

            // Render whatever region object is selected (or a hint if none / not in region view). A freshly
            // clicked base loads its buildings a beat later, so we POLL until cityReady() before drawing -
            // showing "Loading..." meanwhile - and the panel fills in by itself instead of needing a reselect.
            function render(vo) {
                cancelLoad();
                try {
                    if (!win.isVisible()) return;
                    if (!vo || !MM.map.inRegionView()) { showHint(); return; }
                    var EO = ClientLib.Vis.VisObject.EObjectType;
                    var t = (typeof vo.get_VisObjectType === "function") ? vo.get_VisObjectType() : null;
                    var lootable = (t === EO.RegionCityType || t === EO.RegionNPCBase || t === EO.RegionNPCCamp);
                    if (!lootable) { // POIs / ruins / hubs have no lootable base data here
                        var nm = ""; try { nm = (vo.get_PlayerName && vo.get_PlayerName()) || ""; } catch (e) {}
                        showHint(MMt("No loot data for this object") + (nm ? " (" + nm + ")" : "") + ".");
                        return;
                    }
                    var id = vo.get_Id();
                    var rel = MM.base.relationshipFromVis(vo);
                    var cities = ClientLib.Data.MainData.GetInstance().get_Cities();
                    var triggered = false, tries = 0;
                    (function attempt() {
                        loadTimer = null;
                        if (!win.isVisible()) return;
                        if (!MM.map.inRegionView()) { showHint(); return; }
                        var still = MM.map.selectedObject();
                        if (!still || (typeof still.get_Id === "function" && still.get_Id() !== id)) return; // selection moved on
                        var ncity = null; try { ncity = cities.GetCity(id); } catch (e) {}
                        if (cityReady(ncity)) { renderCity(vo, ncity, rel); return; }
                        // not fully loaded yet: nudge the load once (the game also loads on select - and
                        // fetchDetail's set_CurrentCityId targets THIS selected base, so no cross-base eviction),
                        // keep the "Loading..." hint, and poll.
                        if (!triggered) { triggered = true; try { MM.base.fetchDetail(id, function () {}, { intervalMs: 150, tries: 1 }); } catch (e) {} }
                        showHint(MMt("Loading..."));
                        if (++tries <= 20) { loadTimer = setTimeout(attempt, 200); return; }    // ~4s ceiling
                        if (ncity && ncity.get_Version() > 0) renderCity(vo, ncity, rel);        // give up: show what we have
                        else showHint(MMt("Couldn't load that target."));
                    })();
                } catch (e) { werr("render failed:", e); }
            }

            // update on selection (only while the panel is open), and on open
            MM.map.onSelection(function (vo) { if (win.isVisible()) render(vo); });
            win.addListener("appear", function () { render(MM.map.selectedObject()); });
            // safety: clear to the hint when leaving region view (ClientLib.Vis.ModeChange doesn't exist on
            // this client, so onSelection can't catch it - the safe camera poll does). Cheap: only acts on
            // the region<->base flip, and only while the panel is open.
            try { MM.map.watch({ onChange: function (st) { if (win.isVisible() && !st.region) { cancelLoad(); showHint(); } } }); } catch (e) {}

            wlog("ready");
        }

        var tries = 0;
        function waitReady() {
            try {
                var app = (typeof qx != "undefined" && qx.core && qx.core.Init) ? qx.core.Init.getApplication() : null;
                var navReady = app && app.getUIItem && app.getUIItem(ClientLib.Data.Missions.PATH.BAR_NAVIGATION) && app.getUIItem(ClientLib.Data.Missions.PATH.BAR_NAVIGATION).isVisible();
                if (navReady && window.MMCommon && window.MMCommon.ui && window.MMCommon.buttons && window.MMCommon.map && window.MMCommon.loot && window.MMCommon.base) {
                    MM = window.MMCommon;
                    // Build ONCE. A throw inside build() must NOT fall through to the outer catch's retry -
                    // that re-ran build() every 1s forever and flooded the console with the same error.
                    try { build(); } catch (e2) { werr("build failed (not retrying):", e2); }
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
