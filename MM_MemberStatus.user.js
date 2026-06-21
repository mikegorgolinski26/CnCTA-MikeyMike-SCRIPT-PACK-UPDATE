// ==UserScript==
// @name            MM - Member Status
// @description     Dockable, color-coded "Member Status" overview of online/away alliance members (with highest offense/defense levels when your access exposes them). MikeyMike rework of InFlames2k's "AllianceMemberOnline", rebuilt on the MM - Common Library.
// @author          InFlames2k (Patrick Schubert)
// @contributor     MikeyMike (CnCTA-MikeyMike-SCRIPT-PACK)
// @version         1.1.0
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

 DISPLAY OPTION (1.1.0): right-click the roster -> "Dock in game menu bar" to show
 the same list as a menu-styled "Members" section inside the game's right-side base
 bar (the Info Sticker look), via MMCommon.menubar; "Use floating window" reverts.
 Default stays the floating window.

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

            // --- the window (movable + position-persistent via MMCommon.ui.Window).
            // No fixed width: the window shrink-wraps to its content so everything is visible on open.
            var win = MM.ui.Window({
                caption: "Member Status",
                key: "AllianceOverview.Window",
                pos: [240, 120],
                restoreOpen: true, // re-open automatically after a refresh if it was open
                // dock disabled for now - the snap targeting needs more work, see TA_MM_Common.ui.Window
                layout: new qx.ui.layout.VBox()
            });
            if (!win) { LOG.err("could not create window"); return; }
            win.add(listBox);

            // ---- optional: dock the roster into the game's base menu bar (the Info Sticker "menu look") ----
            // Opt-in (default = the floating window); toggled by the right-click menu on the roster. The SAME
            // listBox grid is re-parented between the window and an in-bar menu-styled panel, so the rendering
            // is identical. All guarded - if MMCommon.menubar isn't reachable, it stays a floating window.
            function menuOn() { try { return MM.settings.get("AllianceOverview.MenuBar", false) === true; } catch (e) { return false; } }
            var mb = { panel: null, dock: null, built: false };
            function makeDisplayMenu() {
                var menu = new qx.ui.menu.Menu();
                var toBar = new qx.ui.menu.Button("Dock in game menu bar");
                toBar.addListener("execute", function () { setMenuMode(true); });
                var toFloat = new qx.ui.menu.Button("Use floating window");
                toFloat.addListener("execute", function () { setMenuMode(false); });
                menu.add(toBar); menu.add(toFloat);
                return menu;
            }
            function buildMenuPanel() {
                if (mb.built) return mb.panel;
                try {
                    if (!MM.menubar || !MM.menubar.styledPanel) return null;
                    mb.panel = MM.menubar.styledPanel({ width: 160, spacing: 2, marginLeft: 5 });
                    mb.panel.add(new qx.ui.basic.Label("Members").set({ font: "bold", textColor: "#595969", textAlign: "center", alignX: "center" }));
                    try { mb.panel.setContextMenu(makeDisplayMenu()); } catch (e) {}
                    mb.dock = MM.menubar.dock(mb.panel, { pos: null, enabled: function () { return menuOn(); } });
                    mb.built = true;
                } catch (e) { LOG.err("buildMenuPanel:", e); mb.panel = null; }
                return mb.panel;
            }
            // move the roster grid into whichever container is active (the menu panel or the float window)
            function placeList() {
                try {
                    var host = menuOn() ? buildMenuPanel() : win;
                    if (!host) host = win;
                    var cur = listBox.getLayoutParent && listBox.getLayoutParent();
                    if (cur !== host) { if (cur && cur.remove) cur.remove(listBox); host.add(listBox); }
                } catch (e) { LOG.err("placeList:", e); }
            }
            function isShown() {
                try { return menuOn() ? !!(mb.panel && mb.panel.isVisible && mb.panel.isVisible()) : win.isVisible(); } catch (e) { return false; }
            }
            function setMenuMode(on) {
                try {
                    MM.settings.set("AllianceOverview.MenuBar", on === true);
                    if (on) { buildMenuPanel(); if (mb.dock) mb.dock.refresh(); placeList(); if (mb.panel) mb.panel.show(); try { win.close(); } catch (e) {} }
                    else { placeList(); if (mb.dock) mb.dock.refresh(); try { win.open(); } catch (e) {} }
                    refresh();
                } catch (e) { LOG.err("setMenuMode:", e); }
            }
            try { listBox.setContextMenu(makeDisplayMenu()); } catch (e) {}

            function clearList() {
                try {
                    var kids = listBox.removeAll();
                    for (var i = 0; i < kids.length; i++) { try { kids[i].destroy(); } catch (e) {} }
                } catch (e) {}
            }

            function header(text, tip) {
                var h = new qx.ui.basic.Label("<b>" + text + "</b>").set({ rich: true, textColor: "#ffffff" });
                if (tip) h.setToolTipText(tip);
                return h;
            }

            function fmtLvl(v) {
                var n = Number(v);
                return (isFinite(n) && n > 0) ? n.toFixed(2) : "-";
            }

            function render(rows) {
                clearList();
                if (!rows.length) {
                    listBox.add(new qx.ui.basic.Label("(no members online)").set({ textColor: "#888888" }), { row: 0, column: 0 });
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
                        textColor: online ? COL_ONLINE : COL_AWAY,
                        toolTipText: m.RoleName || "",
                        rich: false
                    }), { row: r, column: 0 });
                    if (hasLevels) {
                        listBox.add(new qx.ui.basic.Label(fmtLvl(m.BestOffenseLvl)).set({ textColor: COL_LEVEL, textAlign: "right" }), { row: r, column: 1 });
                        listBox.add(new qx.ui.basic.Label(fmtLvl(m.BestDefenseLvl)).set({ textColor: COL_LEVEL, textAlign: "right" }), { row: r, column: 2 });
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
                            if (mb.panel && mb.panel.isVisible && mb.panel.isVisible()) mb.panel.exclude();
                            else { buildMenuPanel(); placeList(); if (mb.panel) mb.panel.show(); if (mb.dock) mb.dock.refresh(); refresh(); }
                        } else {
                            if (win.isVisible()) win.close(); else { win.open(); refresh(); }
                        }
                    } catch (e) { LOG.err("toggle failed:", e); }
                }
            });

            // if the menu-bar display was chosen previously, build + show it now (instead of the float window).
            // The base bar can lag a few seconds behind nav-ready, so poll until it's reachable (fast appear).
            if (menuOn()) {
                var mTries = 0;
                (function tryMenu() {
                    try {
                        if (!menuOn()) return;
                        if (buildMenuPanel()) { placeList(); refresh(); return; }
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
