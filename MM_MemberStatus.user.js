// ==UserScript==
// @name            MM - Member Status
// @description     Dockable, color-coded "Member Status" overview of online/away alliance members (with highest offense/defense levels when your access exposes them). MikeyMike rework of InFlames2k's "AllianceMemberOnline", rebuilt on the MM - Common Library.
// @author          InFlames2k (Patrick Schubert)
// @contributor     MikeyMike (CnCTA-MikeyMike-SCRIPT-PACK)
// @version         1.2.2
// @match           https://*.alliances.commandandconquer.com/*/index.aspx*
// @downloadURL     https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/MM_MemberStatus.user.js
// @updateURL       https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/MM_MemberStatus.user.js
// ==/UserScript==

/*
================================================================================
 MM - Member Status   (formerly "AllianceMemberOnline" by InFlames2k)
================================================================================
 Adds a "Member Status" button (bottom-right, via MMCommon.buttons) that
 toggles a movable, position-remembered window listing alliance members who are
 Online or Away, refreshed every few seconds and COLOR-CODED by state
 (green = Online, amber = Away). The old ">>" Away marker is gone.

 This is the first script migrated onto the MM - Common Library: it uses
 MMCommon.buttons.register (CommonButtonHandler) and MMCommon.ui.Window
 (dockable/persistent window) instead of hand-rolled UI.

 DISPLAY (1.2.x): an UNPINNED, frameless, movable floating panel like MM - Next MCV
 (drag by body, position persists, on-screen clamp). A PIN button in its header locks
 it into a menu-styled panel anchored NEXT TO the game's base bar (a separate panel
 BESIDE the bar - the Info Sticker look - not inserted into it; it re-anchors to the
 bar's left edge). Click the pin again to pop back out to the movable panel. The roster
 colours adapt to the light docked / dark floating backgrounds.

 Shows "Off" (BestOffenseLvl = highest army level) and "Def" (BestDefenseLvl =
 highest defense level) columns, but only when your alliance access exposes that
 data - the game returns 0 for every member otherwise, so the columns auto-hide.

 Settings (MMCommon.settings): AllianceOverview.Color.Online (#1a8a1a),
 AllianceOverview.Color.Away (#c25e00), AllianceOverview.RefreshMs (5000),
 AllianceOverview.ShowLevels (true).
 Debug: window.MM_DEBUG = true  (or localStorage.MM_DEBUG = '1') for [MM Alliance Overview] logs.
================================================================================
*/

(function () {
    var AllianceOverview_main = function () {
        var LOG = (window.MMCommon && window.MMCommon.makeLogger) ? window.MMCommon.makeLogger("Member Status") : {
            log: function () {}, warn: function () { try { console.warn.apply(console, arguments); } catch (e) {} }, err: function () { try { console.error.apply(console, arguments); } catch (e) {} }
        };

        function build() {
            var MM = window.MMCommon;
            var EState = ClientLib.Data.EMemberOnlineState;
            var COL_ONLINE = MM.settings.get("AllianceOverview.Color.Online", "#1a8a1a");
            var COL_AWAY = MM.settings.get("AllianceOverview.Color.Away", "#c25e00");
            var REFRESH_MS = MM.settings.get("AllianceOverview.RefreshMs", 5000);
            var SHOW_LEVELS = MM.settings.get("AllianceOverview.ShowLevels", true); // Off/Def columns (auto-hidden when no access)
            var COL_LEVEL = MM.settings.get("AllianceOverview.Color.Level", "#ffe14d"); // bright yellow, easy to read on the dark window

            // --- the member list (a Grid of colored labels, rebuilt each refresh) ---
            var listBox = new qx.ui.container.Composite(new qx.ui.layout.Grid(12, 3));

            // PINNED = docked into the game's base menu bar (the "locked dock" look); UNPINNED = a frameless,
            // movable floating panel like MM - Next MCV (same drag + on-screen clamp). The pin button toggles.
            function menuOn() { try { return MM.settings.get("AllianceOverview.MenuBar", false) === true; } catch (e) { return false; } }
            function pinIcon(on) { return on ? "FactionUI/icons/icn_thread_pin_active.png" : "FactionUI/icons/icn_thread_pin_inactive.png"; }

            // pin button - icon reflects the pinned state; clicking it docks <-> floats
            var pinBtn = new qx.ui.form.Button(null, pinIcon(menuOn())).set({
                show: "icon", width: 20, height: 20, maxWidth: 22, maxHeight: 22, padding: 1, decorator: null,
                cursor: "pointer", toolTipText: "Pin into the game menu / unpin to a movable panel"
            });
            pinBtn.addListener("execute", function () { try { setMenuMode(!menuOn()); } catch (e) {} });
            // the frameless float panel drags by its body (mousedown anywhere starts a drag) - stop the pin's
            // mousedown from bubbling so clicking it pins/unpins instead of starting a drag.
            pinBtn.addListener("mousedown", function (e) { try { e.stopPropagation(); } catch (x) {} });
            function updatePin() { try { pinBtn.setIcon(pinIcon(menuOn())); } catch (e) {} }

            // header (title + pin) - kept WITH the content so it shows in both the floating and docked states
            var titleLbl = new qx.ui.basic.Label("Members").set({ font: "bold", rich: true, alignY: "middle" });
            var headerRow = new qx.ui.container.Composite(new qx.ui.layout.HBox(4).set({ alignY: "middle" }));
            headerRow.add(titleLbl);
            headerRow.add(new qx.ui.core.Spacer(), { flex: 1 });
            headerRow.add(pinBtn);

            // content = header + roster; this whole block re-parents between the float panel and the dock panel
            var content = new qx.ui.container.Composite(new qx.ui.layout.VBox(3));
            content.add(headerRow);
            content.add(listBox);

            // --- the floating ("unpinned") panel: frameless + movable + on-screen clamp, like MM - Next MCV ---
            var win = MM.ui.Window({
                caption: "Member Status",
                key: "AllianceOverview.Window",
                pos: [240, 120],
                restoreOpen: true,
                frameless: true,
                dock: true,
                layout: new qx.ui.layout.VBox()
            });
            if (!win) { LOG.err("could not create window"); return; }
            win.add(content);

            // --- the docked ("pinned") panel: a menu-styled panel anchored NEXT TO the base bar (the Info
            // Sticker look - a separate panel BESIDE the bar, NOT inserted into it). It sits to the LEFT of
            // the bar and re-anchors via a light poll. Added to the game desktop, like the HUD tray.
            // Built the same way the legacy Info Sticker built its left panel: a panel added to the game
            // DESKTOP anchored to the RIGHT edge, 124px in (= just LEFT of the base nav bar, the rightmost
            // ~124px strip), using the game's region-select panel texture + dark-red side borders for the
            // "system menu" look. No bar-rect math - the {right:124} anchor places it beside the bar by itself.
            var sp = { panel: null, built: false };
            function buildSidePanel() {
                if (sp.built) return sp.panel;
                try {
                    var app = qx.core.Init.getApplication();
                    if (!app || !app.getDesktop) return null;
                    sp.panel = new qx.ui.container.Composite(new qx.ui.layout.VBox(2)).set({
                        width: 160, paddingLeft: 8, paddingRight: 6, paddingTop: 5, paddingBottom: 6,
                        decorator: new qx.ui.decoration.Decorator().set({
                            backgroundImage: "webfrontend/ui/common/bgr_region_world_select_scaler.png",
                            backgroundRepeat: "scale", widthLeft: 1, widthRight: 1, colorLeft: "#7F0707", colorRight: "#7F0707"
                        })
                    });
                    app.getDesktop().add(sp.panel, { right: 124, top: 130 });
                    sp.built = true;
                } catch (e) { LOG.err("buildSidePanel:", e); sp.panel = null; }
                return sp.panel;
            }
            // move the content into whichever container is active (the side panel or the float panel)
            function placeContent() {
                try {
                    var host = menuOn() ? buildSidePanel() : win;
                    if (!host) host = win;
                    var cur = content.getLayoutParent && content.getLayoutParent();
                    if (cur !== host) { if (cur && cur.remove) cur.remove(content); host.add(content); }
                } catch (e) { LOG.err("placeContent:", e); }
            }
            function isShown() {
                try { return menuOn() ? !!(sp.panel && sp.panel.isVisible && sp.panel.isVisible()) : win.isVisible(); } catch (e) { return false; }
            }
            function setMenuMode(on) {
                try {
                    MM.settings.set("AllianceOverview.MenuBar", on === true);
                    updatePin();
                    if (on) { buildSidePanel(); placeContent(); if (sp.panel) sp.panel.show(); try { win.close(); } catch (e) {} }
                    else { if (sp.panel) sp.panel.exclude(); placeContent(); try { win.open(); } catch (e) {} }
                    refresh();
                } catch (e) { LOG.err("setMenuMode:", e); }
            }
            // colour set per mode: light/dark-readable. Floating = dark MM panel; docked = light mission-bar texture.
            function colors() {
                if (menuOn()) return { title: "#2a3a4a", header: "#2a3a4a", online: "#15691a", away: "#9a4500", level: "#16527a", none: "#556070" };
                return { title: "#cfe6ff", header: "#ffffff", online: COL_ONLINE, away: COL_AWAY, level: COL_LEVEL, none: "#888888" };
            }

            function clearList() {
                try {
                    var kids = listBox.removeAll();
                    for (var i = 0; i < kids.length; i++) { try { kids[i].destroy(); } catch (e) {} }
                } catch (e) {}
            }

            function header(text, tip) {
                var h = new qx.ui.basic.Label("<b>" + text + "</b>").set({ rich: true, textColor: colors().header });
                if (tip) h.setToolTipText(tip);
                return h;
            }

            function fmtLvl(v) {
                var n = Number(v);
                return (isFinite(n) && n > 0) ? n.toFixed(2) : "-";
            }

            function render(rows) {
                var C = colors();
                try { titleLbl.setTextColor(C.title); } catch (e) {}
                clearList();
                if (!rows.length) {
                    listBox.add(new qx.ui.basic.Label("(no members online)").set({ textColor: C.none }), { row: 0, column: 0 });
                    return;
                }
                // Show the Off/Def level columns only if enabled AND the data is populated (i.e. your
                // alliance access exposes it - otherwise the game returns 0 for every member).
                var i, hasLevels = false;
                if (SHOW_LEVELS) {
                    for (i = 0; i < rows.length; i++) {
                        if ((rows[i].BestOffenseLvl || 0) > 0 || (rows[i].BestDefenseLvl || 0) > 0) { hasLevels = true; break; }
                    }
                }
                var r = 0;
                if (hasLevels) {
                    listBox.add(header("Member"), { row: 0, column: 0 });
                    listBox.add(header("Off", "Best (highest) offense/army unit level"), { row: 0, column: 1 });
                    listBox.add(header("Def", "Best (highest) defense level"), { row: 0, column: 2 });
                    r = 1;
                }
                for (i = 0; i < rows.length; i++) {
                    var m = rows[i];
                    var online = (m.OnlineState === EState.Online);
                    listBox.add(new qx.ui.basic.Label(m.Name).set({
                        textColor: online ? C.online : C.away,
                        toolTipText: m.RoleName || "",
                        rich: false
                    }), { row: r, column: 0 });
                    if (hasLevels) {
                        listBox.add(new qx.ui.basic.Label(fmtLvl(m.BestOffenseLvl)).set({ textColor: C.level, textAlign: "right" }), { row: r, column: 1 });
                        listBox.add(new qx.ui.basic.Label(fmtLvl(m.BestDefenseLvl)).set({ textColor: C.level, textAlign: "right" }), { row: r, column: 2 });
                    }
                    r++;
                }
            }

            function refresh() {
                try {
                    if (!isShown()) return; // only work while the active display (window or docked panel) is shown
                    var alliance = ClientLib.Data.MainData.GetInstance().get_Alliance();
                    if (!alliance) return;
                    alliance.RefreshMemberData();
                    var members = alliance.get_MemberDataAsArray(),
                        n = alliance.get_NumMembers(),
                        rows = [], i, m;
                    for (i = 0; i < n; i++) {
                        m = members[i];
                        if (m.OnlineState === EState.Online || m.OnlineState === EState.Away) rows.push(m);
                    }
                    // Online first, then by name
                    rows.sort(function (a, b) {
                        if (a.OnlineState !== b.OnlineState) return (a.OnlineState === EState.Online) ? -1 : 1;
                        return String(a.Name).localeCompare(String(b.Name));
                    });
                    render(rows);
                } catch (e) { LOG.err("refresh failed:", e); }
            }

            // refresh immediately whenever the window appears (covers auto-reopen after a refresh)
            win.addListener("appear", refresh);

            // refresh timer (only does work while the window is open)
            try {
                qx.util.TimerManager.getInstance().start(refresh, REFRESH_MS, this, null, 1000);
            } catch (e) { LOG.warn("timer start failed:", e); }

            // --- the toggle button (CommonButtonHandler) ---
            MM.buttons.register({
                id: "member-status",
                label: "Member Status",
                tooltip: "Toggle the Member Status display",
                onExecute: function () {
                    try {
                        if (menuOn()) {
                            if (sp.panel && sp.panel.isVisible && sp.panel.isVisible()) sp.panel.exclude();
                            else { buildSidePanel(); placeContent(); if (sp.panel) sp.panel.show(); refresh(); }
                        } else {
                            if (win.isVisible()) win.close(); else { win.open(); refresh(); }
                        }
                    } catch (e) { LOG.err("toggle failed:", e); }
                }
            });

            // if the panel was PINNED (docked) previously, build + show it now (instead of the float panel).
            // The base bar can lag a few seconds behind nav-ready, so poll until it's reachable (fast appear).
            updatePin();
            if (menuOn()) {
                var mTries = 0;
                (function tryMenu() {
                    try {
                        if (!menuOn()) return;
                        if (buildSidePanel()) { placeContent(); if (sp.panel) sp.panel.show(); refresh(); return; }
                    } catch (e) {}
                    if (++mTries < 60) window.setTimeout(tryMenu, 500);
                })();
            }

            LOG.log("ready");
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
                    if (tries === 30) LOG.warn("still waiting for game UI / MMCommon...");
                    window.setTimeout(waitReady, 1000);
                }
            } catch (e) {
                LOG.err("waitReady error:", e);
                window.setTimeout(waitReady, 1000);
            }
        }
        window.setTimeout(waitReady, 1000);
    };

    try {
        var script = document.createElement("script");
        script.textContent = "(" + AllianceOverview_main.toString() + ")();";
        script.type = "text/javascript";
        if (/commandandconquer\.com/i.test(document.domain)) {
            (document.head || document.documentElement).appendChild(script);
        }
    } catch (e) {
        console.error("[MM Member Status] init error: ", e);
    }
})();
