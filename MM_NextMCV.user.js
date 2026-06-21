// ==UserScript==
// @name            MM - Next MCV
// @description     A small always-on counter showing how close you are to your next MCV (the Research_BaseFound level that lets you found another base): time until you can afford the credits, and your research-point progress. Rebuilt on the MM - Common Library.
// @author          Maelstrom, HuffyLuf, KRS_L, Krisan, DLwarez, NetquiK (original MaelstromTools MCV popup)
// @contributor     MikeyMike (CnCTA-MikeyMike-SCRIPT-PACK)
// @version         1.0.0
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

   T$ <Nd.HH:MM>   - time until your credits reach the amount needed, based on
                     your current credit production (or "NoGrow" if you have no
                     credit income, "OK" once you can afford it)
   RP @ <pct>%     - your research-point progress toward the amount needed
                     ("OK" once met)

 plus a compact detail line (current / needed for each). When both read OK you
 can found your next base.

 UX: a draggable popup (position persists), opened by a "Next MCV" HUD-tray
 button (toggle), open-state remembered across refreshes. Refreshes itself every
 30s. Once Research_BaseFound is maxed (no further base to found) it shows a
 "max bases" note.

 Credit: the original MCV popup + cost calc were by the MaelstromTools authors
 (see @author). This is a MikeyMike rebuild on MMCommon - plain functions, no
 MaelstromTools dependency.

 Settings (MMCommon.settings, per player+world): NextMCV.* (window geometry +
 open state). Debug: window.MMNEXTMCV_DEBUG = true (or window.MM_DEBUG = true).
================================================================================
*/

(function () {
    var NextMCV_main = function () {
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

            var body = new qx.ui.container.Composite(new qx.ui.layout.VBox(2))
                .set({ padding: 4, backgroundColor: "#23282b" });

            function line(color) {
                return new qx.ui.basic.Label("").set({
                    rich: true, textAlign: "center", allowGrowX: true, textColor: color,
                    font: new qx.bom.Font(14, ["sans-serif"]).set({ bold: true })
                });
            }
            var creditLine = line("cyan");
            var rpLine = line("#ffe14d");
            var detailLine = new qx.ui.basic.Label("").set({
                rich: true, textAlign: "center", allowGrowX: true, textColor: "#b9c2c7",
                font: new qx.bom.Font(11, ["sans-serif"])
            });
            body.add(creditLine);
            body.add(rpLine);
            body.add(detailLine);

            var win = MM.ui.Window({
                caption: "Next MCV",
                key: "NextMCV.Window",
                layout: new qx.ui.layout.VBox(),
                pos: [220, 120],
                resizable: false,
                restoreOpen: true,
                dock: true
            });
            if (!win) { werr("window creation failed"); return; }
            win.add(body);

            MM.buttons.register({
                id: "mm-next-mcv",
                label: "Next MCV",
                tooltip: "Time/resources until your next base (MCV)",
                onExecute: function () {
                    try { if (win.isVisible()) win.close(); else { win.open(); refresh(); } } catch (e) { werr("toggle failed:", e); }
                }
            });

            function refresh() {
                try {
                    if (!win.isVisible()) return;
                    var d = computeNextMCV();
                    if (!d) {
                        creditLine.setValue("<span style='color:#92ff7f;'>Max bases founded</span>");
                        rpLine.setValue("");
                        detailLine.setValue("no further MCV to research");
                        return;
                    }
                    var C = MM.num.compact;
                    // credits line
                    if (d.creditPct >= 100) {
                        creditLine.setValue("<span style='color:#92ff7f;'>C$ : OK!</span>");
                    } else if (!d.doGrow) {
                        creditLine.setValue("<span style='color:#ff8a7f;'>T$ : NoGrow!</span>");
                    } else {
                        creditLine.setValue("<span style='color:#ff8a7f;'>T$ : " + daysFromHours(d.hoursLeft) + "</span>");
                    }
                    // rp line
                    if (d.rpPct >= 100) {
                        rpLine.setValue("<span style='color:#92ff7f;'>RP : OK!</span>");
                    } else {
                        rpLine.setValue("RP @ " + d.rpPct.toFixed(1) + "%");
                    }
                    // detail line: current / needed for each
                    detailLine.setValue(
                        "<span style='color:#ff8f00;'>$ " + C(d.curCredits) + "</span> / " + C(d.creditsNeeded) +
                        "  ·  <span style='color:#ffe14d;'>RP " + C(d.curRP) + "</span> / " + C(d.rpNeeded)
                    );
                } catch (e) { werr("refresh failed:", e); }
            }

            win.addListener("appear", refresh);

            // First-run default: show the counter (the original was always-on). After that, the
            // user's open/close choice persists via restoreOpen, so we only auto-open when there's
            // no saved state yet.
            try {
                if (MM.settings.get("NextMCV.Window.open", null) === null) {
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
