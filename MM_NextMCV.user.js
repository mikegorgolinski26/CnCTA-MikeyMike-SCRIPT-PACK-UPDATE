// ==UserScript==
// @name            MM - Next MCV
// @description     A small always-on counter showing how close you are to your next MCV (the Research_BaseFound level that lets you found another base): time until you can afford the credits, and your research-point progress. Rebuilt on the MM - Common Library.
// @author          Maelstrom, HuffyLuf, KRS_L, Krisan, DLwarez, NetquiK (original MaelstromTools MCV popup)
// @contributor     MikeyMike (CnCTA-MikeyMike-SCRIPT-PACK)
// @version         1.3.2
// @match           https://*.alliances.commandandconquer.com/*/index.aspx*
// @downloadURL     https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/MM_NextMCV.user.js
// @updateURL       https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/MM_NextMCV.user.js
// ==/UserScript==

/*
================================================================================
 MM - Next MCV
================================================================================
 The "NEXT MCV" counter rescued from the retired MaelstromTools Dev script.

 To found another base you research the next level of Research_BaseFound, which
 costs Credits + Research Points. This little popup reads that next-level cost
 and shows, at a glance:

   A centered "Next MCV" title, then two aligned 0-100 progress bars:
     Credits bar - FILL = how close your credits are to the cost; the label is
                   the time-to-afford countdown <Nd.HH:MM> ("NoGrow" with no
                   credit income, "OK" once affordable).
     RP bar      - FILL = how close your research points are to the cost; the
                   label is the percent ("OK" once met).
   Both bars share a 0-100 scale so you can compare progress at a glance.

 plus a compact detail line (current / needed for each). When both read OK you
 can found your next base.

 UX: a frameless, draggable floating panel (no title bar - drag it by its body;
 position persists), opened by a "Next MCV" HUD-tray button (toggle), open-state
 remembered across refreshes. Refreshes itself every 30s. Once Research_BaseFound
 is maxed (no further base to found) it shows a "max bases" note.

 DISPLAY OPTION (1.3.0): right-click the panel to "Dock in game menu bar" - the same
 readout (MCV cost, colour-coded countdown + RP%, credit/day) shows as a compact
 section inside the game's right-side base-navigation bar (the Info Sticker look),
 via MMCommon.menubar. Right-click again -> "Use floating panel" to switch back.
 Default stays the floating panel.

 Credit: the original MCV popup + cost calc were by the MaelstromTools authors
 (see @author). This is a MikeyMike rebuild on MMCommon - plain functions, no
 MaelstromTools dependency.

 Settings (MMCommon.settings, per player+world): NextMCV.* (window geometry +
 open state). Debug: window.MMNEXTMCV_DEBUG = true (or window.MM_DEBUG = true).
================================================================================
*/

(function () {
    var NextMCV_main = function () {
        // i18n fallback: hoisted so MMt() is always defined even if the Common Library's global
        // loads after this script (extension injection order isn't guaranteed). Identity in English.
        function MMt(s){try{return (window.MMCommon&&window.MMCommon.i18n)?window.MMCommon.i18n.t(s):s;}catch(e){return s;}}
        var LOG = (window.MMCommon && window.MMCommon.makeLogger)
            ? window.MMCommon.makeLogger("Next MCV")
            : { log: function () {}, warn: function () { try { console.warn.apply(console, arguments); } catch (e) {} }, err: function () { try { console.error.apply(console, arguments); } catch (e) {} } };

        if (typeof window.MMNEXTMCV_DEBUG === "undefined") {
            try { window.MMNEXTMCV_DEBUG = (window.localStorage.getItem("MMNEXTMCV_DEBUG") === "1"); } catch (e) { window.MMNEXTMCV_DEBUG = false; }
        }
        var wlog = function () { if (!(window.MMNEXTMCV_DEBUG || window.MM_DEBUG)) return; LOG.log.apply(LOG, arguments); };
        var wwarn = function () { LOG.warn.apply(LOG, arguments); };
        var werr = function () { LOG.err.apply(LOG, arguments); };

        var MM = window.MMCommon;

        // Nd.HH:MM from a (possibly fractional) hour count - matches the original popup's format.
        function daysFromHours(hx) {
            if (!isFinite(hx) || hx < 0) hx = 0;
            var j = Math.floor(hx / 24);
            var h = Math.floor(hx - j * 24);
            var m = Math.floor(((hx - j * 24) - h) * 60);
            return j + "d." + (h < 10 ? "0" + h : h) + ":" + (m < 10 ? "0" + m : m);
        }

        // Compute the next-MCV picture. Returns null if there's no next base to found, else
        // { creditsNeeded, curCredits, creditPct, growthPerHour, doGrow, hoursLeft,
        //   rpNeeded, curRP, rpPct }.
        function computeNextMCV() {
            try {
                var md = ClientLib.Data.MainData.GetInstance();
                var player = md.get_Player();
                var faction = player.get_Faction();
                var techId = ClientLib.Base.Tech.GetTechIdFromTechNameAndFaction(ClientLib.Base.ETechName.Research_BaseFound, faction);
                var research = player.get_PlayerResearch();
                var item = research.GetResearchItemFomMdbId(techId);
                if (!item) return null;
                var nli = item.get_NextLevelInfo_Obj();
                if (!nli) return null; // no further base to found (maxed)
                var ER = ClientLib.Base.EResourceType;
                var need = [];
                for (var i in nli.rr) { if (nli.rr[i].t > 0) need[nli.rr[i].t] = nli.rr[i].c; }
                var creditsNeeded = need[ER.Gold] || 0;
                var rpNeeded = need[ER.ResearchPoints] || 0;
                var curCredits = player.GetCreditsCount();
                var curRP = player.get_ResearchPoints();
                var cred = player.get_Credits();
                var stepsPerHour = md.get_Time().get_StepsPerHour();
                var growthPerHour = (cred.Delta + cred.ExtraBonusDelta) * stepsPerHour;
                var doGrow = growthPerHour > 0;
                return {
                    creditsNeeded: creditsNeeded, curCredits: curCredits,
                    creditPct: creditsNeeded ? (curCredits * 100 / creditsNeeded) : 100,
                    growthPerHour: growthPerHour, doGrow: doGrow,
                    hoursLeft: doGrow ? ((creditsNeeded - curCredits) / growthPerHour) : Infinity,
                    rpNeeded: rpNeeded, curRP: curRP,
                    rpPct: rpNeeded ? (curRP * 100 / rpNeeded) : 100
                };
            } catch (e) { werr("computeNextMCV failed:", e); return null; }
        }

        function build() {
            wlog("building UI");
            var TXT = "#e8e8e8";

            var body = new qx.ui.container.Composite(new qx.ui.layout.VBox(4))
                .set({ padding: 6, backgroundColor: "#23282b", width: 212 });

            // centered title (the frameless panel has no caption bar, so draw our own)
            body.add(new qx.ui.basic.Label(MMt("Next MCV")).set({
                rich: true, textAlign: "center", allowGrowX: true, textColor: "#cfe6ff",
                font: new qx.bom.Font(13, ["sans-serif"]).set({ bold: true })
            }));

            // Two aligned 0-100 progress bars (rich labels rendering a self-contained HTML bar). The FILL
            // shows how close each resource is to the next-MCV cost (credits %, RP %), so you can compare
            // them at a glance; the centered text is the credit time-to-afford countdown and the RP percent.
            function progressBar() {
                return new qx.ui.basic.Label("").set({ rich: true, allowGrowX: true, height: 20 });
            }
            var creditBar = progressBar();
            var rpBar = progressBar();
            body.add(creditBar);
            body.add(rpBar);

            // bottom detail line: current / needed for each (kept - Mike likes it)
            var detailLine = new qx.ui.basic.Label("").set({
                rich: true, textAlign: "center", allowGrowX: true, textColor: "#b9c2c7",
                font: new qx.bom.Font(11, ["sans-serif"])
            });
            body.add(detailLine);

            // Fill colour by progress: red while low, yellow through the middle, green when nearly there.
            function barColor(p) { return (p < 15) ? "#cc3b2e" : (p < 85) ? "#c7a91e" : "#3a9d3a"; }
            // One progress bar's HTML: a dark track with a colour-by-progress fill to `pct`% + centered label.
            function barHtml(pct, label) {
                var p = Math.max(0, Math.min(100, pct || 0));
                return '<div style="position:relative;height:18px;background:#11151a;border:1px solid #3a4750;border-radius:4px;overflow:hidden;">'
                    + '<div style="position:absolute;left:0;top:0;bottom:0;width:' + p.toFixed(1) + '%;background:' + barColor(p) + ';"></div>'
                    + '<div style="position:absolute;left:0;right:0;top:0;height:18px;line-height:18px;text-align:center;font:bold 12px sans-serif;color:#fff;text-shadow:0 0 3px #000,0 0 2px #000;">' + label + '</div>'
                    + '</div>';
            }

            // ---- optional: dock the MCV readout into the game's base menu bar ----------
            // Same data, shown as a compact colour-coded section inside the game's right-side base bar
            // (the look Mike liked from Info Sticker). Opt-in (default = the floating panel); toggled by the
            // right-click menu on either panel. All guarded - if MMCommon.menubar isn't there, stays floating.
            function menuOn() { try { return MM.settings.get("NextMCV.MenuBar", false) === true; } catch (e) { return false; } }
            var mb = { panel: null, dock: null, info: null, time: null, rp: null, rate: null, built: false };
            function mbLabel(color) {
                return new qx.ui.basic.Label("").set({ rich: true, font: "bold", textAlign: "center", alignX: "center", textColor: color || "#282828" });
            }
            function buildMenuPanel() {
                if (mb.built) return mb.panel;
                try {
                    if (!MM.menubar || !MM.menubar.styledPanel) return null;
                    mb.panel = MM.menubar.styledPanel({ width: 124, spacing: 2, marginLeft: 5 });
                    mb.info = mbLabel("#595969");
                    mb.time = mbLabel("#282828");
                    mb.rp = mbLabel("#282828");
                    mb.rate = mbLabel("#595969");
                    mb.panel.add(mb.info); mb.panel.add(mb.time); mb.panel.add(mb.rp); mb.panel.add(mb.rate);
                    try { mb.panel.setContextMenu(makeDisplayMenu()); } catch (e) {}
                    mb.dock = MM.menubar.dock(mb.panel, { pos: null, enabled: function () { return menuOn(); } });
                    mb.built = true;
                } catch (e) { werr("buildMenuPanel:", e); mb.panel = null; }
                return mb.panel;
            }
            function renderMenuPanel(d, C) {
                if (!menuOn()) return;
                if (!mb.built && !buildMenuPanel()) return;
                if (!mb.panel) return;
                try {
                    if (!d) { mb.info.setValue(MMt("MCV")); mb.time.setValue(MMt("Max bases")); mb.rp.setValue(""); mb.rate.setValue(""); return; }
                    mb.info.setValue(MMt("MCV") + " ($ " + C(d.creditsNeeded) + ")");
                    var t = (d.creditPct >= 100) ? MMt("OK!") : (!d.doGrow ? MMt("NoGrow") : daysFromHours(d.hoursLeft));
                    mb.time.setValue("<span style='color:" + barColor(d.creditPct) + "'>" + t + "</span>");
                    var r = (d.rpPct >= 100) ? MMt("RP OK!") : MMt("RP: ") + d.rpPct.toFixed(1) + "%";
                    mb.rp.setValue("<span style='color:" + barColor(d.rpPct) + "'>" + r + "</span>");
                    mb.rate.setValue(d.doGrow ? (MMt("at ") + C(d.growthPerHour * 24) + MMt("/1d")) : MMt("no income"));
                } catch (e) { werr("renderMenuPanel:", e); }
            }
            // right-click menu (on either panel) to switch between the floating panel and the menu bar.
            function makeDisplayMenu() {
                var menu = new qx.ui.menu.Menu();
                var toBar = new qx.ui.menu.Button(MMt("Dock in game menu bar"));
                toBar.addListener("execute", function () { setMenuMode(true); });
                var toFloat = new qx.ui.menu.Button(MMt("Use floating panel"));
                toFloat.addListener("execute", function () { setMenuMode(false); });
                menu.add(toBar); menu.add(toFloat);
                return menu;
            }
            function setMenuMode(on) {
                try {
                    MM.settings.set("NextMCV.MenuBar", on === true);
                    if (on) { buildMenuPanel(); if (mb.panel) mb.panel.show(); if (mb.dock) mb.dock.refresh(); try { win.close(); } catch (e) {} }
                    else { if (mb.dock) mb.dock.refresh(); try { win.open(); } catch (e) {} }
                    refresh();
                } catch (e) { werr("setMenuMode:", e); }
            }

            var win = MM.ui.Window({
                caption: MMt("Next MCV"),
                key: "NextMCV.Window",
                layout: new qx.ui.layout.VBox(),
                pos: [220, 120],
                resizable: false,
                restoreOpen: true,
                dock: true,
                frameless: true   // clean floating panel, dragged by its body; toggled by the HUD button
            });
            if (!win) { werr("window creation failed"); return; }
            win.add(body);
            try { body.setContextMenu(makeDisplayMenu()); } catch (e) {}

            MM.buttons.register({
                id: "mm-next-mcv",
                label: MMt("Next MCV"),
                tooltip: MMt("Time/resources until your next base (MCV)"),
                onExecute: function () {
                    try {
                        if (menuOn()) {
                            // toggle the docked panel's visibility
                            if (mb.panel && mb.panel.isVisible && mb.panel.isVisible()) mb.panel.exclude();
                            else { buildMenuPanel(); if (mb.panel) mb.panel.show(); if (mb.dock) mb.dock.refresh(); refresh(); }
                        } else {
                            if (win.isVisible()) win.close(); else { win.open(); refresh(); }
                        }
                    } catch (e) { werr("toggle failed:", e); }
                }
            });

            // if the menu-bar display was chosen previously, build + show it now (instead of the float panel).
            // The game's base bar can lag a few seconds behind nav-ready, so poll until it's reachable rather
            // than waiting for the 30s refresh tick (that delay made the docked MCV take ~20s to appear on reload).
            if (menuOn()) {
                var mTries = 0;
                (function tryMenu() {
                    try {
                        if (!menuOn()) return;
                        if (buildMenuPanel()) { refresh(); return; }   // bar ready -> docked + populated
                    } catch (e) {}
                    if (++mTries < 60) window.setTimeout(tryMenu, 500);
                })();
            }

            function refresh() {
                try {
                    var d = computeNextMCV();
                    var C = MM.num.compact;
                    // floating panel (only worth updating while it's on screen)
                    if (win.isVisible()) {
                        if (!d) {
                            creditBar.setValue(barHtml(100, MMt("Max bases founded")));
                            rpBar.setValue("");
                            detailLine.setValue(MMt("no further MCV to research"));
                        } else {
                            // Credits bar: fill = how close credits are to the cost; label = time-to-afford countdown.
                            var cLabel = (d.creditPct >= 100) ? MMt("Credits  OK!") : (!d.doGrow ? MMt("Credits  NoGrow") : MMt("Credits  ") + daysFromHours(d.hoursLeft));
                            creditBar.setValue(barHtml(d.creditPct, cLabel));
                            // RP bar: fill = how close RP are to the cost; label = the percent.
                            var rLabel = (d.rpPct >= 100) ? MMt("RP  OK!") : MMt("RP  ") + d.rpPct.toFixed(1) + "%";
                            rpBar.setValue(barHtml(d.rpPct, rLabel));
                            // detail line: current / needed for each. The current-amount colour tracks the same
                            // red->yellow->green progress as the bars above (the "/ needed" stays muted grey).
                            detailLine.setValue(
                                "<span style='color:" + barColor(d.creditPct) + ";'>$ " + C(d.curCredits) + "</span><span style='color:#8a96a0;'> / " + C(d.creditsNeeded) + "</span>" +
                                "  ·  <span style='color:" + barColor(d.rpPct) + ";'>RP " + C(d.curRP) + "</span><span style='color:#8a96a0;'> / " + C(d.rpNeeded) + "</span>"
                            );
                        }
                    }
                    // menu-bar panel (only when the option is on)
                    renderMenuPanel(d, C);
                } catch (e) { werr("refresh failed:", e); }
            }

            win.addListener("appear", refresh);

            // First-run default: show the counter (the original was always-on). After that, the
            // user's open/close choice persists via restoreOpen, so we only auto-open when there's
            // no saved state yet.
            try {
                if (!menuOn() && MM.settings.get("NextMCV.Window.open", null) === null) {
                    window.setTimeout(function () { try { win.open(); refresh(); } catch (e) {} }, 600);
                }
            } catch (e) {}

            // periodic refresh (credits tick up; recompute every 30s)
            try {
                qx.util.TimerManager.getInstance().start(refresh, 30000, this, null, 30000);
            } catch (e) {
                window.setInterval(refresh, 30000);
            }

            LOG.log("ready");
        }

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
        script.textContent = "(" + NextMCV_main.toString() + ")();";
        script.type = "text/javascript";
        if (/commandandconquer\.com/i.test(document.domain)) {
            (document.head || document.documentElement).appendChild(script);
        }
    } catch (e) {
        console.error("[MM Next MCV] init error: ", e);
    }
})();
