// ==UserScript==
// @name            MM - Member Status
// @description     Dockable, color-coded "Member Status" overview of online/away alliance members (with highest offense/defense levels when your access exposes them). MikeyMike rework of InFlames2k's "AllianceMemberOnline", rebuilt on the MM - Common Library.
// @author          InFlames2k (Patrick Schubert)
// @contributor     MikeyMike (CnCTA-MikeyMike-SCRIPT-PACK)
// @version         1.2.8
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
 (drag by body, dark opaque #23282b like Loot Summary, position persists, clamp). A PIN
 button in its header locks it into a solid menu-styled panel anchored on the DESKTOP
 just LEFT of the game's base bar ({right:128}) - the same solid button-missionbar panel
 the in-bar MM Tools / MCV sections use (MMCommon.menubar.styledPanel), placed beside the
 bar rather than inside it, and framed top+bottom with the game's messaging caps for the docked
 "system menu" look (the Info Sticker frame). Click the pin again to pop back to the movable panel.
 1.2.7 (docked panel made to match the Info Sticker it's based on):
   - Palette flips with the mode: DOCKED uses the Info Sticker scheme (dark-slate #595969 title +
     column headers, near-black #282828 Off/Def numbers) so it's readable on the light menu texture
     instead of the washed-out white/yellow that only suited the dark floating panel; FLOATING keeps
     the light-on-dark scheme. Coloured player names stay green/amber in both states.
   - Pin button restyled to the Info Sticker pin: a small forum-light SoundButton with a 15x15 icon
     (was an oversized bare icon).
   - Docked frame now matches the game's OWN menu: rounded messaging end caps top and bottom, with the
     names section sitting on the game's "pane-navigation-bar" GRAY backing (inset 5px so the gray shows
     as a strip down the left, exactly like the MM Tools menu). The gray backs only the data section so
     its square corners never poke out behind the rounded caps; the caps elongate out to the gray edge.
   - Docked body slimmed (tight 5px column gap).
   - Floating panel no longer transparent on first load (content carries its dark bg by default).
   - Pinned panel now AUTO-DOCKS on reload: the pinned flag moved to a global localStorage key read
     synchronously at startup (the per-player setting loads too late - the pid-timing trap), with a
     one-time migration of users who pinned before this build.

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
        // i18n fallback: hoisted so MMt() is always defined even if the Common Library's global
        // loads after this script (extension injection order isn't guaranteed). Identity in English.
        function MMt(s){try{return (window.MMCommon&&window.MMCommon.i18n)?window.MMCommon.i18n.t(s):s;}catch(e){return s;}}
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
            // tight column gap (5px) keeps the docked panel narrow - the member rows are what set the
            // panel's width, so a smaller gap is what actually makes the docked body slimmer.
            var listBox = new qx.ui.container.Composite(new qx.ui.layout.Grid(5, 3));

            // PINNED = docked into the game's base menu bar (the "locked dock" look); UNPINNED = a frameless,
            // movable floating panel like MM - Next MCV (same drag + on-screen clamp). The pin button toggles.
            // Pinned/docked state lives in a GLOBAL localStorage key (NOT the pid-keyed MM.settings):
            // build() runs right after nav-ready, BEFORE the per-player settings bucket loads, so a pid-keyed
            // read would always return the "float" default and the panel would never auto-dock on reload (the
            // same pid-timing trap the buttons-dock mode hit -> MM.HUDTray.dock). The per-player setting is kept
            // in sync for continuity + one-time migration of users who pinned before this fix.
            var DOCK_KEY = "MM.MemberStatus.dock";
            function menuOn() { try { return window.localStorage.getItem(DOCK_KEY) === "1"; } catch (e) { return false; } }
            function pinIcon(on) { return on ? "FactionUI/icons/icn_thread_pin_active.png" : "FactionUI/icons/icn_thread_pin_inactive.png"; }

            // pin button - styled like the legacy Info Sticker pin: a small forum-light SoundButton with a
            // 15x15 icon (NOT a bare oversized icon), so it matches the docked menu it sits beside.
            var pinBtn;
            try { pinBtn = new webfrontend.ui.SoundButton(); } catch (e) { pinBtn = new qx.ui.form.Button(); }
            pinBtn.set({
                decorator: "button-forum-light", icon: pinIcon(menuOn()), show: "icon", iconPosition: "top",
                cursor: "pointer", width: 22, height: 19, maxWidth: 22, maxHeight: 19, padding: 0, alignY: "middle",
                toolTipText: MMt("Pin into the game menu / unpin to a movable panel")
            });
            try { var _pic = pinBtn.getChildControl("icon"); _pic.setWidth(15); _pic.setHeight(15); _pic.setScale(true); } catch (e) {}
            pinBtn.addListener("execute", function () { try { setMenuMode(!menuOn()); } catch (e) {} });
            // the frameless float panel drags by its body (mousedown anywhere starts a drag) - stop the pin's
            // mousedown from bubbling so clicking it pins/unpins instead of starting a drag.
            pinBtn.addListener("mousedown", function (e) { try { e.stopPropagation(); } catch (x) {} });
            function updatePin() { try { pinBtn.setIcon(pinIcon(menuOn())); } catch (e) {} }

            // header (title + pin) - kept WITH the content so it shows in both the floating and docked states
            var titleLbl = new qx.ui.basic.Label(MMt("Members")).set({ font: "bold", rich: true, alignY: "middle", textAlign: "center", allowGrowX: true });
            var headerRow = new qx.ui.container.Composite(new qx.ui.layout.HBox(0).set({ alignY: "middle" }));
            headerRow.add(new qx.ui.core.Spacer(22, 1)); // balances the pin width so the title sits centered
            headerRow.add(titleLbl, { flex: 1 });
            headerRow.add(pinBtn);

            // content = header + roster; this whole block re-parents between the float panel and the dock panel.
            // It carries its OWN solid dark background so it's opaque in BOTH states (like MM - Loot Summary /
            // Next MCV, whose body Composite sets backgroundColor) - a frameless window/desktop panel does not
            // paint a background itself, so the content must.
            // bg + padding are set per mode in placeContent(): a solid dark fill when floating (Loot Summary
            // look), transparent when docked so the menu texture shows through.
            var content = new qx.ui.container.Composite(new qx.ui.layout.VBox(4));
            content.add(headerRow);
            content.add(listBox);
            // default to the floating (dark, opaque) look so the panel is never transparent on first load
            // - placeContent() overrides this per mode (transparent when docked, dark when floating).
            try { content.setBackgroundColor("#23282b"); content.setPadding(8); } catch (e) {}

            // --- the floating ("unpinned") panel: frameless + movable + on-screen clamp, like MM - Next MCV ---
            var win = MM.ui.Window({
                caption: MMt("Member Status"),
                key: "AllianceOverview.Window",
                pos: [240, 120],
                restoreOpen: true,
                frameless: true,
                dock: true,
                layout: new qx.ui.layout.VBox()
            });
            if (!win) { LOG.err("could not create window"); return; }
            win.add(content);
            // If we're PINNED, suppress the float window's restoreOpen NOW (before its async poll reads the
            // flag) so it never reopens the float and fights the docked side panel.
            try { if (menuOn()) MM.settings.set("AllianceOverview.Window.open", false); } catch (e) {}

            // --- the docked ("pinned") panel: a menu-styled panel anchored NEXT TO the base bar (the Info
            // Sticker look - a separate panel BESIDE the bar, NOT inserted into it). Added to the game DESKTOP
            // anchored to the RIGHT edge ({right:128}), so it sits just LEFT of the base nav bar. It's built to
            // match the game's OWN docked menu (see buildSidePanel below): rounded messaging end caps top and
            // bottom + the "pane-navigation-bar" gray backing behind the names section. No bar-rect math - the
            // {right:128} anchor places it beside the bar by itself.
            // sp.panel = the widget added to the desktop that we show/hide; sp.body = the inner container
            // the content re-parents into.
            var sp = { panel: null, body: null, built: false };
            function buildSidePanel() {
                if (sp.built) return sp.panel;
                try {
                    var app = qx.core.Init.getApplication();
                    if (!app || !app.getDesktop || !MM.menubar || !MM.menubar.styledPanel) return null;
                    // The docked panel mirrors the game's OWN docked menu (the MM Tools section): rounded blue
                    // messaging end caps top and bottom, with the member rows ("data section") in between sitting
                    // on the game's "pane-navigation-bar" GRAY backing. Structure (top to bottom):
                    //   holder (transparent) -> [ topCap , dataSection(gray) -> body , botCap ]
                    // Key points learned the hard way with Mike:
                    //  - The gray backing goes on the DATA SECTION ONLY, never the outer holder - the gray has
                    //    square corners, so if it spanned the whole panel its corners would poke out behind the
                    //    ROUNDED caps. Scoped to the data section, the gray is exactly as tall as the names.
                    //  - The body is inset 5px on the left (marginLeft) so the gray shows as a strip down the
                    //    left edge - the same 5px inset the game menu uses (pane width 128 vs button panel 123).
                    //  - The caps GROW to the panel width (allowGrowX); the -5 left margin extends their rounded
                    //    frame (whose art is inset within the image) out to that same gray edge.
                    // All of this is content-driven, so it scales to any roster regardless of name length.
                    var holder = new qx.ui.container.Composite(new qx.ui.layout.VBox()).set({ maxWidth: 240, alignX: "right" });
                    var topCap = new qx.ui.basic.Image("ui/common/bgr_messaging_t.png").set({ allowGrowX: true, height: 11, scale: true, zIndex: 12, marginLeft: -5 });
                    var botCap = new qx.ui.basic.Image("ui/common/bgr_messaging_b.png").set({ allowGrowX: true, height: 11, scale: true, zIndex: 12, marginLeft: -5 });
                    // the game's caps are drawn for the right edge; flip them horizontally (as Info Sticker does).
                    topCap.addListener("appear", function () { try { topCap.getContentElement().getDomElement().style.transform = "scale(-1,1)"; } catch (e) {} });
                    botCap.addListener("appear", function () { try { botCap.getContentElement().getDomElement().style.transform = "scale(-1,1)"; } catch (e) {} });
                    // body = the SAME solid button-missionbar panel the in-bar MM Tools / MCV sections use.
                    var body = MM.menubar.styledPanel({ width: 124, spacing: 2, padding: [4, 6, 4, 6] });
                    body.setMarginLeft(5); // inset over the gray backing -> gray strip on the left of the names
                    // gray backing wraps ONLY the data section, so it's exactly as tall as the names.
                    var dataSection = new qx.ui.container.Composite(new qx.ui.layout.VBox()).set({ allowGrowX: true, decorator: "pane-navigation-bar" });
                    dataSection.add(body);
                    holder.add(topCap);
                    holder.add(dataSection);
                    holder.add(botCap);
                    sp.panel = holder;
                    sp.body = body;
                    app.getDesktop().add(holder, { right: 128, top: 130 });
                    sp.built = true;
                } catch (e) { LOG.err("buildSidePanel:", e); sp.panel = null; }
                return sp.panel;
            }
            // move the content into whichever container is active (the side panel or the float panel)
            function placeContent() {
                try {
                    var docked = menuOn();
                    var host = win;
                    if (docked) { buildSidePanel(); host = sp.body || win; }
                    // dark solid fill when floating (Loot Summary look); transparent when docked so the
                    // game menu texture shows through.
                    try { content.setBackgroundColor(docked ? null : "#23282b"); content.setPadding(docked ? 0 : 8); } catch (e) {}
                    var cur = content.getLayoutParent && content.getLayoutParent();
                    if (cur !== host) { if (cur && cur.remove) cur.remove(content); host.add(content); }
                } catch (e) { LOG.err("placeContent:", e); }
            }
            function isShown() {
                try { return menuOn() ? !!(sp.panel && sp.panel.isVisible && sp.panel.isVisible()) : win.isVisible(); } catch (e) { return false; }
            }
            function setMenuMode(on) {
                try {
                    try { window.localStorage.setItem(DOCK_KEY, on === true ? "1" : "0"); } catch (e) {}
                    MM.settings.set("AllianceOverview.MenuBar", on === true);
                    updatePin();
                    if (on) { buildSidePanel(); placeContent(); if (sp.panel) sp.panel.show(); try { win.close(); } catch (e) {} }
                    else { if (sp.panel) sp.panel.exclude(); placeContent(); try { win.open(); } catch (e) {} }
                    refresh();
                } catch (e) { LOG.err("setMenuMode:", e); }
            }
            // The two states sit on opposite backgrounds, so the text palette must flip with them:
            //  - DOCKED = the light button-missionbar texture (the Info Sticker look) -> use the EXACT
            //    Info Sticker palette: dark-slate title/headers (#595969, the same colour the MM Tools
            //    dock label uses) + near-black off/def numbers (#282828). Light text washes out here.
            //  - FLOATING = the dark #23282b panel (Loot Summary look) -> light title/headers + the
            //    bright-yellow level colour, which read well on dark.
            // Player names keep their online-green / away-amber in BOTH states (both are dark enough to
            // read on the light texture - Mike confirmed the coloured names look good docked).
            function colors() {
                if (menuOn()) {
                    return { title: "#595969", header: "#595969", online: COL_ONLINE, away: COL_AWAY, level: "#282828", none: "#595969" };
                }
                return { title: "#cfe6ff", header: "#ffffff", online: COL_ONLINE, away: COL_AWAY, level: COL_LEVEL, none: "#cfe0ea" };
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
                    listBox.add(new qx.ui.basic.Label(MMt("(no members online)")).set({ textColor: C.none }), { row: 0, column: 0 });
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
                    listBox.add(header(MMt("Member")), { row: 0, column: 0 });
                    listBox.add(header(MMt("Off"), MMt("Best (highest) offense/army unit level")), { row: 0, column: 1 });
                    listBox.add(header(MMt("Def"), MMt("Best (highest) defense level")), { row: 0, column: 2 });
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

            // refresh when the float window appears - but if we're PINNED (docked), the float window must
            // never stay open (its restoreOpen would otherwise reopen it on reload and fight the side panel),
            // so close it immediately and let the side panel be the display.
            win.addListener("appear", function () {
                try { if (menuOn()) { win.close(); return; } } catch (e) {}
                refresh();
            });

            // refresh timer (only does work while the window is open)
            try {
                qx.util.TimerManager.getInstance().start(refresh, REFRESH_MS, this, null, 1000);
            } catch (e) { LOG.warn("timer start failed:", e); }

            // --- the toggle button (CommonButtonHandler) ---
            MM.buttons.register({
                id: "member-status",
                label: MMt("Member Status"),
                tooltip: MMt("Toggle the Member Status display"),
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
            // Populate the correct container for the CURRENT mode synchronously NOW (the desktop is ready by
            // the time build() runs). This (a) gives the floating panel its dark background on first load so it
            // isn't transparent until the first pin/unpin, and (b) docks + shows the panel immediately when
            // pinned instead of waiting on a deferred poll - fixing the "doesn't auto-appear on reload" bug.
            // A short retry stays as a safety net only if the desktop/menu bar wasn't reachable on this pass.
            placeContent();
            if (menuOn()) {
                if (sp.panel) sp.panel.show();
                refresh();
                if (!sp.built) {
                    var mTries = 0;
                    (function tryMenu() {
                        try {
                            if (!menuOn()) return;
                            if (buildSidePanel()) { placeContent(); if (sp.panel) sp.panel.show(); refresh(); return; }
                        } catch (e) {}
                        if (++mTries < 60) window.setTimeout(tryMenu, 500);
                    })();
                }
            }

            // MIGRATION (one-time): users who pinned BEFORE this build have their state only in the per-player
            // AllianceOverview.MenuBar setting, which isn't loaded yet at build() time. Once the player id is
            // ready (settings bucket present), if the global key was never written, seed it from the per-player
            // setting and dock if it was pinned - so the pin survives the upgrade without a manual re-pin.
            (function migrate(tries) {
                try { if (window.localStorage.getItem(DOCK_KEY) !== null) return; } catch (e) { return; }
                var pid = 0;
                try { pid = ClientLib.Data.MainData.GetInstance().get_Player().get_Id(); } catch (e) {}
                if (!pid) { if (tries < 40) window.setTimeout(function () { migrate(tries + 1); }, 500); return; }
                try {
                    if (MM.settings.get("AllianceOverview.MenuBar", false) === true) { setMenuMode(true); }
                    else { window.localStorage.setItem(DOCK_KEY, "0"); }
                } catch (e) {}
            })(0);

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
