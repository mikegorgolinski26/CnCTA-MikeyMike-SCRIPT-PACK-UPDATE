// ==UserScript==
// @name           MM - Movable Menus
// @namespace      https://cncapp*.alliances.commandandconquer.com/*/index.aspx*
// @include        https://cncapp*.alliances.commandandconquer.com/*/index.aspx*
// @description    Makes the game's own pop-out menu overlays (Mail, Forum, Ranking, alliance/diplomacy panels - anything that flies out from the top menu bar) draggable. Drag them anywhere instead of being locked to centre, and the position is remembered across refreshes.
// @version        1.0.0
// @license        CC-BY-NC-SA 4.0
// @author         MikeyMike (rework of Netquik's "MovableMenuOverlay")
// @contributor    Netquik [SoO] (https://github.com/netquik)
// @match          https://*.alliances.commandandconquer.com/*/index.aspx*
// @downloadURL    https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/MM_MovableMenuOverlay.user.js
// @updateURL      https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/MM_MovableMenuOverlay.user.js
// ==/UserScript==

/*
 * MM - Movable Menus
 * ------------------
 * WHAT IT DOES
 *   The game's top-menu fly-out overlays (Mail, Forum, Ranking, the alliance/diplomacy panels - everything
 *   that subclasses webfrontend.gui.MenuOverlayWidget) normally auto-centre and snap back if you try to move
 *   them. This wraps each one in a draggable container so you can drop it anywhere on screen, and it stays
 *   where you put it. The drag position is remembered across page refreshes (per player + world).
 *
 * WHY IT'S NEEDED
 *   You often want to read Mail or the Forum while keeping an eye on the map / a base panel behind it. A
 *   centred, snapping overlay covers exactly what you want to watch. Drag it aside once and it stays put.
 *
 * HOW IT'S BUILT (vs Netquik's "MovableMenuOverlay")
 *   The engine is Netquik's battle-tested NOEVIL approach and is PRESERVED nearly verbatim: a movable
 *   container singleton (qx.ui.core.MMovable mixin), plus two global patches -
 *     1. the app's internal "switch menu overlay" method (the one switchMenuOverlay() defers to), so opening
 *        a MenuOverlayWidget wraps it in the draggable container and pins the child inside it; and
 *     2. MenuOverlayWidget.prototype.centerPosition, so the auto-recentre is skipped for overlays we've
 *        wrapped (it still centres normal, un-wrapped ones).
 *   The MM rework is robustness + housekeeping (this is the highest-blast-radius script in the pack - it
 *   overrides two core app methods, so it has to fail safe):
 *     - Every de-obfuscation lookup is routed through reMember()/reMatch(), which throw a CLEAR, NAMED error
 *       if the game's minified member name can no longer be located ("could not locate X - the game may have
 *       updated") instead of an opaque "[1] of null". If a lookup fails, the patches are simply NOT installed
 *       and the game's overlays keep working untouched.
 *     - The original game methods are SAVED before patching and RESTORED on disable (Netquik's version left
 *       them patched until a page reload). Toggling the script off in the CnC Pack menu now cleanly returns
 *       the overlays to stock behaviour - no reload needed.
 *     - The patched switch/centre methods run their body in try/catch and FALL BACK to the saved original on
 *       any error, so a future game change can't leave the menu overlays dead.
 *     - Drag position persists via MMCommon.settings ("MovableMenus.pos"), clamped on-screen on restore.
 *     - [MM Movable Menus] gated logging (verbose off by default; warnings/errors always on).
 *
 * DEPENDENCIES (pack rule: wrapper + Common Library only)
 *   MMCommon.makeLogger / .settings / .lifecycle (all optional - degrades gracefully if absent)
 *   ClientLib / qx / webfrontend (game page context)
 *
 * Debug: window.MOVABLEMENUS_DEBUG = true (or window.MM_DEBUG = true) for verbose logs.
 */
'use strict';
(function () {
    var main = function () {
        'use strict';

        var OPTIONS_ID = 10090; // MM - Movable Menus (CnC Pack registry id)
        var POS_KEY = "MovableMenus.pos";

        // ---- logger ----------------------------------------------------------------
        var LOG = (window.MMCommon && window.MMCommon.makeLogger)
            ? window.MMCommon.makeLogger("Movable Menus")
            : {
                log: function () {},
                warn: function () { try { console.warn.apply(console, ["[MM Movable Menus]"].concat([].slice.call(arguments))); } catch (e) {} },
                err: function () { try { console.error.apply(console, ["[MM Movable Menus]"].concat([].slice.call(arguments))); } catch (e) {} }
            };
        if (typeof window.MOVABLEMENUS_DEBUG === "undefined") {
            try { window.MOVABLEMENUS_DEBUG = (window.localStorage.getItem("MOVABLEMENUS_DEBUG") === "1"); } catch (e) { window.MOVABLEMENUS_DEBUG = false; }
        }
        var wlog = function () { if (!(window.MOVABLEMENUS_DEBUG || window.MM_DEBUG)) return; LOG.log.apply(LOG, arguments); };
        var wwarn = function () { LOG.warn.apply(LOG, arguments); };
        var werr = function () { LOG.err.apply(LOG, arguments); };

        var MM = window.MMCommon || null;

        // ---- de-obfuscation helpers ------------------------------------------------
        // The game ships minified, so the member name we patch is 6-letter gibberish that changes between
        // client versions. Each lookup regexes a known method's source to recover the current name; if a
        // pattern stops matching (game updated), reMatch throws a NAMED error so the failing lookup is
        // obvious in the console and installPatches() aborts cleanly (game overlays untouched).
        function reMatch(source, regex, label) {
            var m = null;
            try { m = String(source).match(regex); } catch (e) { m = null; }
            if (!m) throw new Error("MM - Movable Menus: could not locate '" + label + "' in the game client (it may have updated; this lookup needs re-patching).");
            return m;
        }
        function reMember(source, regex, label, group) {
            return reMatch(source, regex, label)[group == null ? 1 : group];
        }

        // ---- cached obf names + saved originals (computed/saved once) ---------------
        var oOMethod = null;     // app's internal "switch menu overlay" method name
        var oOEMatch = null;     // [1]=current-overlay field, [2]=focus-target field, [3]=reset-button field
        var oOE = null;          // = oOEMatch[1]
        var origOOMethod = null; // saved game original of qxA[oOMethod]
        var origCenterPosition = null; // saved game original of MenuOverlayWidget.prototype.centerPosition
        var installed = false;

        // ---- the draggable container -----------------------------------------------
        function defineMMOverlayClass() {
            if (qx.Class.isDefined("MMOverlay")) return;
            qx.Class.define("MMOverlay", {
                type: "singleton",
                extend: qx.ui.container.Composite,
                include: qx.ui.core.MMovable,
                construct: function (layout) {
                    this.base(arguments);
                    try {
                        this.setLayout(layout);
                    } catch (e) {
                        werr("MMOverlay setLayout failed:", e);
                    }
                },
                members: {
                    MMO: null,
                    // Build (or recycle) the draggable container. Carries the dragged position forward when
                    // switching overlays, restores the persisted position on the first open after a refresh,
                    // clamps it on-screen, and re-persists it.
                    createMM: function () {
                        var A = qx.core.Init.getApplication();
                        var C = A.getDesktop().getBounds();
                        var B = A.getMenuBar().getBounds();
                        var defX = Math.floor((C.width - webfrontend.gui.MenuOverlayWidget.OverlayWidth) / 2);
                        var defY = B.height;
                        var position = { left: defX, top: defY };
                        // First open after a refresh: restore the saved drag position.
                        if (!this.MMO) {
                            try {
                                var saved = MM && MM.settings ? MM.settings.get(POS_KEY, null) : null;
                                if (saved && typeof saved.left === "number" && typeof saved.top === "number") {
                                    position = { left: saved.left, top: saved.top };
                                }
                            } catch (e) {}
                        } else {
                            // Switching overlays: keep wherever the user dragged the previous one.
                            position = this.MMO.getLayoutProperties();
                            this.MMO.toggleMovable();
                            A.getDesktop().remove(this.MMO);
                        }
                        // Clamp on-screen (a smaller viewport since last session could push it off-edge).
                        try {
                            if (C) {
                                if (position.left > C.width - 50) position.left = C.width - 50;
                                if (position.top > C.height - 50) position.top = C.height - 50;
                                if (position.left < 0) position.left = 0;
                                if (position.top < 0) position.top = 0;
                            }
                        } catch (e) {}
                        // Persist the current position (default, restored, or carried-over drag pos).
                        try { if (MM && MM.settings) MM.settings.set(POS_KEY, { left: position.left, top: position.top }); } catch (e) {}
                        this.MMO = new MMOverlay(new qx.ui.layout.Basic());
                        A.getDesktop().add(this.MMO, position);
                        return this.MMO;
                    },
                    // Arm dragging on the overlay's title/header child. The index is the game's markup
                    // layout; guard it so a markup change just means "shown but not draggable" rather than a throw.
                    activateMM: function () {
                        try {
                            if (this.MMO && this.MMO.getChildren()[0] && this.MMO.getChildren()[0].getChildren().length > 0) {
                                var content = this.MMO.getChildren()[0];
                                var handle = content.getChildren()[13];
                                if (handle) this.MMO._activateMoveHandle(handle);
                                else wwarn("drag handle (content child[13]) not found - overlay shown but not draggable (game may have updated)");
                            }
                        } catch (e) { werr("activateMM:", e); }
                    }
                }
            });
        }

        // ---- patched core methods --------------------------------------------------
        // Re-implementation of the app's internal "switch menu overlay" method. Faithful to Netquik's 22.3
        // version, wrapped so any error falls back to the saved game original (so overlays never go dead).
        function oOModF(a) {
            var qxA = qx.core.Init.getApplication();
            try {
                if (qxA[oOE]) {
                    qxA[oOE] instanceof webfrontend.gui.OverlayWindow
                        ? qxA[oOE].close()
                        : qxA[oOE] instanceof webfrontend.gui.MenuOverlayWidget && qxA[oOE].setActive(false);
                    if (qxA[oOE].getLayoutParent() instanceof MMOverlay) {
                        var b = MMOverlay.getInstance().MMO;
                        // IMPORTANT for closing mail messages: deactivate before removing.
                        qxA[oOE]._deactivate();
                        -1 != b.indexOf(qxA[oOE]) && b.remove(qxA[oOE]);
                        b.exclude();
                    }
                    qxA[oOEMatch[2]].focus();
                }
                if (qxA[oOE] != a) {
                    qxA[oOE] = a;
                    if (qxA[oOE]) {
                        if (qxA[oOE] instanceof webfrontend.gui.OverlayWindow) {
                            qxA[oOE].open();
                        } else {
                            var MMx = MMOverlay.getInstance();
                            var m = MMx.createMM();
                            m.add(qxA[oOE], { left: 0, top: 0 });
                            MMx.activateMM();
                            m.fadeIn(250);
                            qxA[oOE].setMinHeight(625);
                            qxA[oOE].addListener("move", function () { this.setLayoutProperties({ top: 0, left: 0 }); });
                            qxA[oOE].addListener("appear", function () { this.setLayoutProperties({ top: 0, left: 0 }); });
                            if (qxA[oOE] instanceof webfrontend.gui.MenuOverlayWidget) qxA[oOE].setActive(true);
                        }
                    } else {
                        qxA[oOEMatch[3]].reset();
                    }
                }
            } catch (e) {
                werr("switch-overlay patch failed, falling back to game original:", e);
                try { if (origOOMethod) return origOOMethod.apply(qxA, arguments); } catch (e2) { werr("fallback original switch-overlay also failed:", e2); }
            }
        }

        // Re-implementation of MenuOverlayWidget.prototype.centerPosition that skips centring for overlays
        // we've wrapped in a draggable container (so they keep the dragged position), but still centres
        // normal un-wrapped ones. Runs with `this` = the widget being centred.
        function centerModF() {
            try {
                if (false === this.getLayoutParent() instanceof MMOverlay) {
                    var a = qx.core.Init.getApplication(),
                        b = a.getDesktop().getBounds(),
                        c = a.getMenuBar().getBounds();
                    a = a.getCurrentBottomOverlay();
                    b = Math.floor((b.width - webfrontend.gui.MenuOverlayWidget.OverlayWidth) / 2);
                    c = c.height;
                    a && a.isVisible() ? this.setLayoutProperties({
                        left: b,
                        top: c,
                        bottom: webfrontend.Application.legacySocHeight + webfrontend.gui.notifications.Ticker.TickerHeight
                    }) : this.setLayoutProperties({
                        left: b,
                        top: c,
                        bottom: webfrontend.gui.notifications.Ticker.TickerHeight
                    });
                }
            } catch (e) {
                werr("centerPosition patch failed, falling back to game original:", e);
                try { if (origCenterPosition) return origCenterPosition.apply(this, arguments); } catch (e2) { werr("fallback original centerPosition also failed:", e2); }
            }
        }

        // ---- install / uninstall ---------------------------------------------------
        function installPatches() {
            if (installed) return;
            var qxA = qx.core.Init.getApplication();
            var MOW = webfrontend.gui.MenuOverlayWidget.prototype;
            // Resolve the obfuscated names once (throws a NAMED error if the game has changed - in which case
            // we abort and leave the game's overlays untouched).
            if (!oOMethod) {
                oOMethod = reMember(qxA.switchMenuOverlay.toString(), /deactivate\(\)\;this\.([A-Za-z_]+)\(/, "App.switchMenuOverlay inner method");
                var source = String(qxA[oOMethod]).replace(/[\r\n]/g, "");
                oOEMatch = reMatch(source, /this\.([_a-zA-Z]+)[){&]+.+this\.([_a-zA-Z]+)\.focus.+this\.([_a-zA-Z]+)\.reset/, "switchMenuOverlay overlay/focus/reset fields");
                oOE = oOEMatch[1];
            }
            origOOMethod = qxA[oOMethod];
            origCenterPosition = MOW.centerPosition;
            qxA[oOMethod] = oOModF;
            MOW.centerPosition = centerModF;
            installed = true;
            wlog("patches installed (oOMethod=" + oOMethod + ", overlayField=" + oOE + ")");
        }

        function uninstallPatches() {
            if (!installed) return;
            var qxA = qx.core.Init.getApplication();
            try { if (origOOMethod && oOMethod) qxA[oOMethod] = origOOMethod; } catch (e) { werr("restore switchMenuOverlay:", e); }
            try { if (origCenterPosition) webfrontend.gui.MenuOverlayWidget.prototype.centerPosition = origCenterPosition; } catch (e) { werr("restore centerPosition:", e); }
            // Detach any currently-wrapped overlay so the map/UI behind it isn't left covered.
            try {
                var inst = MMOverlay.getInstance();
                if (inst && inst.MMO) {
                    if (oOE && qxA[oOE] && qxA[oOE].getLayoutParent && qxA[oOE].getLayoutParent() instanceof MMOverlay) {
                        try { qxA[oOE]._deactivate(); } catch (e) {}
                        try { inst.MMO.remove(qxA[oOE]); } catch (e) {}
                        try { qxA[oOE] = null; } catch (e) {}
                    }
                    try { inst.MMO.exclude(); } catch (e) {}
                }
            } catch (e) { werr("detach overlay on disable:", e); }
            installed = false;
            wlog("patches uninstalled (game overlays restored)");
        }

        // ---- bootstrap -------------------------------------------------------------
        function waitForGame() {
            try {
                if (typeof qx !== "undefined" && typeof qx.core !== "undefined" && typeof qx.core.Init !== "undefined"
                    && typeof webfrontend !== "undefined" && webfrontend.gui && typeof phe !== "undefined") {
                    var app = qx.core.Init.getApplication();
                    if (app && app.initDone === true) {
                        try {
                            defineMMOverlayClass();
                            installPatches();
                        } catch (e) {
                            werr("init (install) failed - overlays left at stock behaviour:", (e && e.toString) ? e.toString() : e);
                        }
                        // Live enable/disable from the CnC Pack menu (no reload). Disable restores the game's
                        // original methods + detaches any wrapped overlay; enable re-installs.
                        try {
                            if (MM && MM.lifecycle && typeof MM.lifecycle.watch === "function") {
                                MM.lifecycle.watch(OPTIONS_ID, {
                                    onEnable: function () { try { defineMMOverlayClass(); installPatches(); wlog("enabled"); } catch (e) { werr("enable:", e); } },
                                    onDisable: function () { try { uninstallPatches(); wlog("disabled"); } catch (e) { werr("disable:", e); } }
                                });
                            }
                        } catch (e) { werr("lifecycle.watch failed:", e); }
                        wlog("ready (options id " + OPTIONS_ID + ")");
                    } else {
                        window.setTimeout(waitForGame, 1000);
                    }
                } else {
                    window.setTimeout(waitForGame, 1000);
                }
            } catch (e) {
                werr("init failed:", (e && e.toString) ? e.toString() : e);
            }
        }
        window.setTimeout(waitForGame, 1000);
    };
    var script = document.createElement("script");
    script.textContent = "(" + main.toString() + ")();";
    script.type = "text/javascript";
    document.getElementsByTagName("head")[0].appendChild(script);
})();
