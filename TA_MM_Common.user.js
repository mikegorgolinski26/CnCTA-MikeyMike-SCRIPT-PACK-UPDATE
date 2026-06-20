// ==UserScript==
// @name            MM - Common Library
// @description     Shared foundation library for the CnCTA MikeyMike pack. Runs in the game's page context and exposes window.MMCommon: one place for logging, net-events, settings, number/time formatting, coordinate helpers, and (being filled in during migration) the cnctaopt link encoder, base-scan, repair/loot calc, and a dockable-window + CommonButtonHandler UI. Load right after MM - Framework Wrapper.
// @author          MikeyMike (CnCTA-MikeyMike-SCRIPT-PACK)
// @version         1.0.2
// @match           https://*.alliances.commandandconquer.com/*/index.aspx*
// @downloadURL     https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/TA_MM_Common.user.js
// @updateURL       https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/TA_MM_Common.user.js
// ==/UserScript==

/*
================================================================================
 MM - Common Library  (window.MMCommon)  -  what it is & why it exists
================================================================================
 The pack's scripts each re-implement the same handful of mechanisms (logging,
 net-event binding, localStorage settings, number/time formatting, coordinate
 parsing, base scanning, cnctaopt link encoding, repair/loot math, movable
 windows). This library centralizes them so scripts can share ONE correct,
 maintained copy instead of many drifting ones. See MM_SCRIPT_AUDIT.md section 4.

 HOW IT LOADS
 Like the Framework Wrapper, it injects itself as a <script> into the page <head>
 so it runs in the GAME's JavaScript context (where qx / ClientLib / webfrontend
 live) and publishes a single global, window.MMCommon, plus window.MMCommon_IsInstalled.
 It must load before the scripts that use it (place it right after the wrapper).

 STATUS OF EACH MODULE
   Implemented & ready:  log, net, settings, num, time, coords
   Scaffold (TODO, ported as each consumer script is migrated): cnctaopt, scan,
   repair, loot, ui (dockable window), buttons (CommonButtonHandler)

 DEBUG: set  window.MM_DEBUG = true  in the game console for verbose [MM ...] logs.
================================================================================
*/

(function () {
    var MMCommon_main = function () {
        // ---------------------------------------------------------------------
        // Console-noise guard: filter qx's unload-listener registration.
        // ---------------------------------------------------------------------
        // Chromium's Permissions Policy disallows 'unload' listeners on this
        // page, but qooxdoo still tries to add them during startup and the
        // browser logs a "Permissions policy violation: unload is not allowed"
        // message every time. The registration is blocked anyway - the
        // listener never would have fired - so we just no-op the call to keep
        // the console clean. Only the exact 'unload' event is filtered;
        // 'beforeunload' (used by the game and by our ui.Window for refresh
        // detection) is untouched. Idempotent. Must run BEFORE qx attaches
        // its observers; placed first in MMCommon_main and outside the
        // if-already-installed guard so it applies even if MMCommon is somehow
        // injected twice.
        try {
            if (!window.__MM_unloadGuardInstalled && typeof EventTarget !== 'undefined') {
                var origAdd = EventTarget.prototype.addEventListener;
                EventTarget.prototype.addEventListener = function (type, listener, options) {
                    if (type === 'unload') return; // browser blocks this anyway; suppress the violation log
                    return origAdd.apply(this, arguments);
                };
                window.__MM_unloadGuardInstalled = true;
            }
        } catch (e) { /* cosmetic - never break MMCommon over this */ }

        if (window.MMCommon) return; // already installed

        // Verbose logging is off by default; persist the toggle so it survives a reload. Enable with:
        //   localStorage.MM_DEBUG = '1'   (then reload)   /   localStorage.removeItem('MM_DEBUG')
        if (typeof window.MM_DEBUG === "undefined") {
            try { window.MM_DEBUG = (window.localStorage.getItem("MM_DEBUG") === "1"); } catch (e) { window.MM_DEBUG = false; }
        }

        var NS = {
            version: "1.0.2"
        };

        // -------------------------------------------------------------------
        // log - prefixed, gated verbose logging (shared convention)
        // -------------------------------------------------------------------
        NS.makeLogger = function (name) {
            var prefix = "[MM " + (name || "Common") + "]";
            return {
                log: function () {
                    if (!window.MM_DEBUG) return;
                    try { console.log.apply(console, [prefix].concat([].slice.call(arguments))); } catch (e) {}
                },
                warn: function () {
                    try { console.warn.apply(console, [prefix].concat([].slice.call(arguments))); } catch (e) {}
                },
                err: function () {
                    try { console.error.apply(console, [prefix].concat([].slice.call(arguments))); } catch (e) {}
                }
            };
        };
        var log = NS.log = NS.makeLogger("Common");

        // -------------------------------------------------------------------
        // net - attach/detach net events with the phe.cnc.Util / gui.Util fallback
        // -------------------------------------------------------------------
        function netUtil() {
            try { if (webfrontend.phe.cnc.Util && webfrontend.phe.cnc.Util.attachNetEvent) return webfrontend.phe.cnc.Util; } catch (e) {}
            try { if (webfrontend.gui.Util && webfrontend.gui.Util.attachNetEvent) return webfrontend.gui.Util; } catch (e) {}
            return null;
        }
        NS.net = {
            util: netUtil,
            attach: function (obj, eventName, eventType, ctx, cb) {
                var u = netUtil();
                if (u) return u.attachNetEvent(obj, eventName, eventType, ctx, cb);
                log.warn("net.attach: no net-event util available");
                return null;
            },
            detach: function (obj, eventName, eventType, ctx, cb) {
                var u = netUtil();
                if (u) return u.detachNetEvent(obj, eventName, eventType, ctx, cb);
                return null;
            }
        };

        // -------------------------------------------------------------------
        // settings - per player+world localStorage store (MM.SETTINGS.<pid>.<wid>)
        // -------------------------------------------------------------------
        NS.settings = (function () {
            var cache = {}, key = null;
            function storeKey() {
                try {
                    var md = ClientLib.Data.MainData.GetInstance();
                    return "MM.SETTINGS." + md.get_Player().get_Id() + "." + md.get_Server().get_WorldId();
                } catch (e) {
                    return "MM.SETTINGS.default";
                }
            }
            function load() {
                key = storeKey();
                try {
                    var raw = window.localStorage.getItem(key);
                    cache = raw ? JSON.parse(raw) : {};
                } catch (e) { cache = {}; }
                return cache;
            }
            function save() {
                try { window.localStorage.setItem(key, JSON.stringify(cache)); } catch (e) {}
            }
            return {
                get: function (prop, def) {
                    load();
                    if (cache[prop] === undefined && def !== undefined) { cache[prop] = def; save(); }
                    return cache[prop];
                },
                set: function (prop, val) { load(); cache[prop] = val; save(); return val; },
                del: function (prop) { load(); delete cache[prop]; save(); return true; }
            };
        })();

        // -------------------------------------------------------------------
        // num - compact number formatting (k / M / G / T)
        // -------------------------------------------------------------------
        NS.num = {
            compact: function (n, dec) {
                if (typeof n !== "number" || !isFinite(n)) return String(n);
                dec = (dec == null) ? 1 : dec;
                var a = Math.abs(n), s = n < 0 ? "-" : "";
                if (a >= 1e12) return s + (a / 1e12).toFixed(dec) + "T";
                if (a >= 1e9) return s + (a / 1e9).toFixed(dec) + "G";
                if (a >= 1e6) return s + (a / 1e6).toFixed(dec) + "M";
                if (a >= 1e3) return s + (a / 1e3).toFixed(dec) + "k";
                return s + a.toFixed(0);
            }
        };

        // -------------------------------------------------------------------
        // time - second -> H:MM:SS / D H:MM:SS
        // -------------------------------------------------------------------
        function pad2(n) { return (n < 10 ? "0" : "") + n; }
        NS.time = {
            hms: function (sec) {
                sec = Math.max(0, Math.floor(sec || 0));
                var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
                return h + ":" + pad2(m) + ":" + pad2(s);
            },
            dhms: function (sec) {
                sec = Math.max(0, Math.floor(sec || 0));
                var d = Math.floor(sec / 86400); sec -= d * 86400;
                var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
                return (d > 0 ? d + "d " : "") + h + ":" + pad2(m) + ":" + pad2(s);
            }
        };

        // -------------------------------------------------------------------
        // coords - parse / format [coords]X:Y[/coords], chat insert, map center, sector
        // -------------------------------------------------------------------
        NS.coords = {
            // Accepts "[coords]X:Y[/coords]" or "X:Y" / "X;Y" / "X,Y" / "X Y" / "X.Y". Returns {x,y} or null.
            parse: function (str) {
                if (str == null) return null;
                var s = String(str);
                var m = s.match(/\[coords\]\s*(\d+)\s*[:;,. ]\s*(\d+)\s*\[\/coords\]/i);
                if (m) return { x: +m[1], y: +m[2] };
                m = s.match(/(-?\d+)\s*[:;,. ]\s*(-?\d+)/);
                if (m) return { x: +m[1], y: +m[2] };
                return null;
            },
            format: function (x, y) { return "[coords]" + x + ":" + y + "[/coords]"; },
            // Insert text at the cursor of the game chat input. Returns true on success.
            insertIntoChat: function (text) {
                try {
                    var dom = qx.core.Init.getApplication().getChat().getChatWidget().getEditable()
                        .getContentElement().getDomElement();
                    if (!dom) return false;
                    var a = dom.selectionStart, b = dom.selectionEnd, v = dom.value;
                    dom.value = v.substring(0, a) + text + v.substring(b);
                    dom.selectionStart = dom.selectionEnd = a + text.length;
                    dom.focus();
                    return true;
                } catch (e) { return false; }
            },
            // Pan the region map to a grid coordinate.
            center: function (x, y) {
                try { ClientLib.Vis.VisMain.GetInstance().get_Region().CenterGridPosition(x, y); return true; }
                catch (e) { return false; }
            },
            // 8-way sector label of (x,y) relative to a center (cx,cy). Y grows downward.
            sector: function (x, y, cx, cy) {
                var dx = x - cx, dy = y - cy;
                if (dx === 0 && dy === 0) return "C";
                var ang = Math.atan2(-dy, dx) * 180 / Math.PI;
                if (ang < 0) ang += 360;
                return ["E", "NE", "N", "NW", "W", "SW", "S", "SE"][Math.round(ang / 45) % 8];
            }
        };

        // -------------------------------------------------------------------
        // deobf - generic helpers for de-obfuscating widget getters at runtime.
        // The Framework Wrapper already publishes the common ones (battle sim,
        // unit getters, WorldObject get_BaseLevel/getID/get_CampType). These
        // helpers cover the remaining per-widget cases (e.g. a StatusInfo widget's
        // getObject), so scripts don't each hand-roll the same regex.
        // -------------------------------------------------------------------
        NS.deobf = {
            // From a getter whose source is `return this.<6>.<6>` -> the inner field name (or null).
            fieldFromGetter: function (fn) {
                try {
                    var m = fn.toString().match(/return this\.[A-Z]{6}\.([A-Z]{6})/);
                    return m ? m[1] : null;
                } catch (e) { return null; }
            },
            // From a `setObject` of the form `function(a){this.MEMBER=a; ...}` -> "MEMBER" (or null).
            objectMemberOfSetter: function (setObjectFn) {
                try {
                    var m = setObjectFn.toString().match(/^function\s?\(([A-Za-z_$][\w$]*)\)\{this\.([A-Za-z_$][\w$]*)=\1;/);
                    return m ? m[2] : null;
                } catch (e) { return null; }
            },
            // Ensure proto.getObject exists by deriving the member from proto.setObject.
            // Returns true if getObject is available afterwards.
            ensureGetObject: function (proto) {
                try {
                    if (typeof proto.getObject === "function") return true;
                    if (typeof proto.setObject !== "function") return false;
                    var member = NS.deobf.objectMemberOfSetter(proto.setObject);
                    if (!member) return false;
                    proto.getObject = function () { return this[member]; };
                    return true;
                } catch (e) { return false; }
            }
        };

        // -------------------------------------------------------------------
        // Scaffolded modules - interfaces defined now, ported during migration.
        // They warn (once) instead of silently failing so consumers are obvious.
        // -------------------------------------------------------------------
        function todo(modName) {
            var warned = false;
            return function () {
                if (!warned) { warned = true; NS.log.warn(modName + " is not implemented yet (ported during script migration)."); }
                return null;
            };
        }

        // cnctaopt: encode a city/base into a cnctaopt.com share link.
        // Canonical source to port from: TA_CnCTAOpt_Link_Button.user.js (keymaps + 20x9 grid encoder).
        NS.cnctaopt = { encode: todo("cnctaopt.encode") };

        // scan: iterate world objects within attack range of a city.
        // Canonical source to port from: TA_Maelstrom_ADDON_Basescanner_AIO.user.js (FJ/FG loop).
        // intended signature: inRange(ownCity, {maxDistance, types}) -> [worldObjects]
        NS.scan = { inRange: todo("scan.inRange") };

        // repair: repair-time / repair-cost helpers (port from battle sim + TA_Auto_Repair).
        NS.repair = {
            unitGroupTime: todo("repair.unitGroupTime"),
            entityFullCost: todo("repair.entityFullCost")
        };

        // loot: loot / lootable-resource summary for a base (port from mhLoot / MHTools getLoots).
        NS.loot = { ofCity: todo("loot.ofCity") };

        // ui: consistent, movable, position-persistent MMCommon window factory.
        NS.ui = {
            num: NS.num, // convenience alias
            // Create a window with standard chrome whose position (and optional size) persist via
            // MMCommon.settings. opts: { caption, icon, key, layout, width, height, pos:[x,y], resizable,
            //   contentPadding, restoreOpen, persistSize, dock }
            //   persistSize: true  -> remember BOTH width and height across reloads (use width/height as
            //                         the first-run defaults). Without it, only width persists (legacy),
            //                         and only when opts.width is set.
            //   dock: true (or a px threshold, default 24) enables edge-docking - when a drag settles
            //   within the threshold of a viewport edge the window snaps flush to it, the edge persists,
            //   and a docked window re-hugs that edge on viewport/content resize and after a refresh.
            // Returns a qx.ui.window.Window (call .open()/.close()) or null on failure. Call at game-ready.
            Window: function (opts) {
                opts = opts || {};
                try {
                    var key = opts.key || ("GUI.Window." + String(opts.caption || "MM").replace(/\s+/g, "_"));
                    var defPos = opts.pos || [220, 120];
                    var win = new qx.ui.window.Window(opts.caption || "MM", opts.icon || null);
                    win.set({
                        layout: opts.layout || new qx.ui.layout.VBox(),
                        allowMaximize: false, showMaximize: false,
                        allowMinimize: false, showMinimize: false,
                        resizable: (opts.resizable !== false),
                        contentPadding: (opts.contentPadding != null ? opts.contentPadding : 4)
                    });

                    var lastSaved = null, pollId = null;

                    // Save current bounds (only when actually changed). Polled while visible so this works
                    // even if this qooxdoo build doesn't fire a "move"/"resize" event on drag. When
                    // persistSize is on we save width+height here too (the dedicated "resize" listener
                    // isn't reliable across qooxdoo builds, but this poll is - same mechanism that makes
                    // position persistence work).
                    function savePos() {
                        try {
                            var b = win.getBounds();
                            if (!b || b.left == null) return;
                            var v = b.left + "," + b.top + (opts.persistSize ? ("," + b.width + "x" + b.height) : "");
                            if (v === lastSaved) return;
                            lastSaved = v;
                            NS.settings.set(key + ".pos", [b.left, b.top]);
                            if (opts.persistSize) {
                                if (b.width) NS.settings.set(key + ".w", b.width);
                                if (b.height) NS.settings.set(key + ".h", b.height);
                            }
                            NS.log.log("window", key, "saved", v);
                        } catch (e) {}
                    }
                    // Apply saved position/size. CRITICAL: this must NOT run before the player id is loaded.
                    // Until then the settings store resolves to the "default" bucket (not
                    // MM.SETTINGS.<pid>.<wid>), so we'd read defaults and clobber the real saved geometry -
                    // this is the same trap that broke open-state restore. Returns false when the player id
                    // isn't ready yet, so restoreGeometry() can retry.
                    function applyPos() {
                        try {
                            var pid = 0;
                            try { pid = ClientLib.Data.MainData.GetInstance().get_Player().get_Id(); } catch (e) {}
                            if (!pid) return false;
                            var p = NS.settings.get(key + ".pos", defPos);
                            if (p && p.length === 2) { win.moveTo(p[0], p[1]); lastSaved = p[0] + "," + p[1]; }
                            if (opts.persistSize) {
                                var sw = NS.settings.get(key + ".w", opts.width || null);
                                var sh = NS.settings.get(key + ".h", opts.height || null);
                                if (sw) win.setWidth(sw);
                                if (sh) win.setHeight(sh);
                                // Re-apply once after layout settles - a single early set can be overridden
                                // by the window's content size hint before it's fully realized.
                                window.setTimeout(function () { try { if (sw) win.setWidth(sw); if (sh) win.setHeight(sh); } catch (e) {} }, 300);
                                NS.log.log("window", key, "restored pos", p, "size", sw + "x" + sh, "(pid", pid + ")");
                            } else {
                                if (opts.width) { var w = NS.settings.get(key + ".w", opts.width); if (w) win.setWidth(w); }
                                NS.log.log("window", key, "restored pos", p, "(pid", pid + ")");
                            }
                            return true;
                        } catch (e) { return false; }
                    }
                    // Apply saved geometry as soon as the player id is ready, retrying briefly if it isn't.
                    function restoreGeometry() {
                        if (applyPos()) return;
                        var t = 0, id = window.setInterval(function () {
                            if (applyPos() || ++t > 40) window.clearInterval(id);
                        }, 150);
                    }

                    // --- edge-docking (opt-in via opts.dock, but OFF unless the user enables it) ----------
                    // The feature is WIRED when opts.dock is set, but actual snapping is gated on a
                    // persisted per-window toggle (<key>.dockEnabled, default false) so it ships OFF and
                    // can't surprise anyone on a different resolution. Toggle at runtime with
                    //   MMCommon.ui.setDock("<window key>", true|false)   (key here = "AllianceOverview.Window").
                    //
                    // Snap MODEL: the window slots into the MARGINS around the game's play area - i.e. the
                    // strips between the play-area letterbox and the browser walls, which is where the
                    // game's own side/corner panels live (next to ICE Crackdown / Destroyer list / etc).
                    // So "dock right" puts the window flush against the LEFT edge of the right-side panel
                    // (window.left = playArea.right), not behind it. Snap target rectangle = the play area
                    // in screen coords (getContentLocation, NOT getBounds which is a scaled coord space).
                    // Falls back to root rect if the play area isn't available - in that case it snaps to
                    // the browser walls instead. Detection: each side measures the distance from the
                    // window's INNER-FACING edge to the play-area's corresponding edge.
                    var DOCK_WIRED = !!opts.dock;
                    var DOCK_T = (typeof opts.dock === "number") ? opts.dock : 40; // snap threshold (px) - generous so the margin strip is easy to hit
                    var snapTimer = null;
                    function dockEnabled() {
                        try { return NS.settings.get(key + ".dockEnabled", false) === true; } catch (e) { return false; }
                    }
                    function dockRect() {
                        try {
                            var pa = qx.core.Init.getApplication().getPlayArea();
                            var loc = pa && pa.getContentLocation && pa.getContentLocation();
                            if (loc && (loc.right - loc.left) > 100 && (loc.bottom - loc.top) > 100) {
                                return { left: loc.left, top: loc.top, right: loc.right, bottom: loc.bottom };
                            }
                        } catch (e) {}
                        try {
                            var r = qx.core.Init.getApplication().getRoot().getBounds();
                            if (r && r.width) return { left: 0, top: 0, right: r.width, bottom: r.height };
                        } catch (e) {}
                        return { left: 0, top: 0, right: window.innerWidth || 1280, bottom: window.innerHeight || 720 };
                    }
                    // Re-pin a docked window into its saved margin (used after positioning, on viewport
                    // resize, and when the window's own content resizes it).
                    function reanchorDock() {
                        try {
                            if (!dockEnabled()) return;
                            var dock = NS.settings.get(key + ".dock", null);
                            if (!dock) return;
                            var b = win.getBounds(); if (!b || b.left == null) return;
                            var R = dockRect(), left = b.left, top = b.top;
                            if (dock === "left") left = Math.max(0, R.left - b.width);   // sit in left margin, right edge flush
                            else if (dock === "right") left = R.right;                   // sit in right margin, left edge flush
                            else if (dock === "top") top = Math.max(0, R.top - b.height); // sit in top margin, bottom edge flush
                            else if (dock === "bottom") top = R.bottom;                  // sit in bottom margin, top edge flush
                            if (left !== b.left || top !== b.top) win.moveTo(left, top);
                        } catch (e) {}
                    }
                    // After a drag settles, snap into the closest margin if the window's inner-facing edge
                    // is within DOCK_T of the play-area boundary. Debounced off "move" so it never fights
                    // an in-progress drag.
                    function maybeDock() {
                        try {
                            if (!dockEnabled()) return;
                            var b = win.getBounds(); if (!b || b.left == null) return;
                            var R = dockRect();
                            // Each distance: how far the window's INNER-facing edge is from the play-area
                            // edge on that side (positive = window is outside the play area on that side,
                            // sitting in the margin where it belongs; negative = window overlaps the play
                            // area on that side).
                            var distL = R.left - (b.left + b.width); // left margin: window's right edge vs playArea.left
                            var distR = b.left - R.right;            // right margin: window's left edge vs playArea.right
                            var distT = R.top - (b.top + b.height);  // top margin: window's bottom edge vs playArea.top
                            var distB = b.top - R.bottom;            // bottom margin: window's top edge vs playArea.bottom
                            // Only consider candidates where the window's inner edge is within DOCK_T of
                            // the play-area boundary (can be slightly negative = window juuust overlapping).
                            function score(d) { return (Math.abs(d) <= DOCK_T) ? Math.abs(d) : Infinity; }
                            var sL = score(distL), sR = score(distR), sT = score(distT), sB = score(distB);
                            var min = Math.min(sL, sR, sT, sB), dock = null, left = b.left, top = b.top;
                            if (min < Infinity) {
                                if (min === sL)      { dock = "left";   left = Math.max(0, R.left - b.width); }
                                else if (min === sR) { dock = "right";  left = R.right; }
                                else if (min === sT) { dock = "top";    top  = Math.max(0, R.top - b.height); }
                                else                  { dock = "bottom"; top  = R.bottom; }
                                win.moveTo(Math.max(0, left), Math.max(0, top));
                            }
                            NS.settings.set(key + ".dock", dock);
                            NS.log.log("window", key, "dock =", dock, "playArea", [R.left, R.top, R.right, R.bottom], "dists L/R/T/B", [distL, distR, distT, distB]);
                            savePos();
                        } catch (e) {}
                    }
                    function scheduleSnap() {
                        if (!DOCK_WIRED || !dockEnabled()) return;
                        try { if (snapTimer) window.clearTimeout(snapTimer); } catch (e) {}
                        try { snapTimer = window.setTimeout(maybeDock, 220); } catch (e) {}
                    }
                    if (DOCK_WIRED) {
                        try {
                            // keep a docked window glued to its edge when the game viewport changes size
                            qx.core.Init.getApplication().getRoot().addListener("resize", function () {
                                if (win.isVisible()) reanchorDock();
                            });
                        } catch (e) {}
                        // and when the window's own content grows/shrinks (e.g. a shrink-wrapped list)
                        win.addListener("resize", function () { if (win.isVisible()) reanchorDock(); });
                    }

                    restoreGeometry();
                    win.addListener("appear", function () {
                        restoreGeometry();
                        if (DOCK_WIRED) reanchorDock();
                        try { NS.settings.set(key + ".open", true); } catch (e) {}
                        try { if (pollId == null) pollId = window.setInterval(savePos, 1500); } catch (e) {}
                    });
                    win.addListener("disappear", function () {
                        // NOTE: do NOT clear the ".open" flag here. "disappear" also fires when qooxdoo
                        // tears the widget down on a browser refresh/unload - clearing it there is exactly
                        // what stopped the window re-opening after a refresh. Only an explicit user close
                        // (the "close" event below) should mark it closed.
                        savePos();
                        try { if (pollId != null) { window.clearInterval(pollId); pollId = null; } } catch (e) {}
                    });
                    // Explicit close (X button or win.close()) is the right place to persist "user wants
                    // this closed" - but qooxdoo can also fire lifecycle events while the page is being
                    // torn down on a refresh. Guard with an unload flag so a teardown never clobbers ".open".
                    var unloading = false;
                    try { window.addEventListener("beforeunload", function () { unloading = true; }); } catch (e) {}
                    win.addListener("close", function () {
                        if (unloading) return; // a page refresh/teardown is not a user close
                        try { NS.settings.set(key + ".open", false); } catch (e) {}
                    });
                    win.addListener("move", function () { savePos(); scheduleSnap(); }); // save + (if enabled) edge-snap after the drag settles
                    if (opts.persistSize) {
                        // Persist both dimensions on resize (getBounds is the real on-screen size; getWidth
                        // can read null when the size came from a layout rather than an explicit set).
                        win.addListener("resize", function () {
                            try {
                                var b = win.getBounds();
                                if (b) {
                                    if (b.width) NS.settings.set(key + ".w", b.width);
                                    if (b.height) NS.settings.set(key + ".h", b.height);
                                }
                            } catch (e) {}
                        });
                    } else if (opts.width) {
                        win.addListener("resize", function () { try { NS.settings.set(key + ".w", win.getWidth()); } catch (e) {} });
                    }

                    // Auto-reopen if it was open last session (so a refresh keeps it showing). CRITICAL:
                    // do NOT read the flag at construction - build() only waits for the nav bar, and at
                    // that point the player id isn't loaded yet, so the settings store resolves to the
                    // "MM.SETTINGS.default" bucket instead of "MM.SETTINGS.<pid>.<wid>" and we'd read a
                    // stale/default value (this is exactly what made restore fail). So poll until the
                    // player id is ready, THEN read the flag from the correct per-player store, then keep
                    // retrying open() until the window is actually visible (a single early open() can
                    // silently no-op while the game UI is still settling).
                    if (opts.restoreOpen) {
                        var tries = 0, decided = false, reopenId = window.setInterval(function () {
                            try {
                                var pid = 0;
                                try { pid = ClientLib.Data.MainData.GetInstance().get_Player().get_Id(); } catch (e) {}
                                if (!pid) { if (++tries > 40) window.clearInterval(reopenId); return; } // wait for player id

                                if (!decided) {
                                    decided = true;
                                    var wantOpen = NS.settings.get(key + ".open", false);
                                    NS.log.log("window", key, "restoreOpen flag =", wantOpen, "(pid", pid + ")");
                                    if (wantOpen !== true) { window.clearInterval(reopenId); return; }
                                    tries = 0; // reset the budget for the open() retries
                                }

                                if (win.isVisible()) {
                                    window.clearInterval(reopenId);
                                    NS.log.log("window", key, "restored open after", tries, "tries");
                                    return;
                                }
                                tries++;
                                win.open();
                                if (tries >= 12) { // ~3.6s of open() retries, then give up
                                    window.clearInterval(reopenId);
                                    NS.log.warn("window", key, "restore gave up after", tries, "tries");
                                }
                            } catch (e) { NS.log.err("restore open failed:", e); }
                        }, 300);
                    }
                    return win;
                } catch (e) {
                    NS.log.err("ui.Window failed:", e);
                    return null;
                }
            }
        };
        // ui.setDock / ui.getDock - runtime toggle for a window's edge-docking. The window must have been
        // created with opts.dock (so the listeners are wired); this just flips the persisted per-window
        // gate. Pass the same `key` you passed to ui.Window(). Default state for every window is OFF, so
        // scripts ship a safe, no-surprises experience and users opt in per window. Examples:
        //   MMCommon.ui.setDock("AllianceOverview.Window", true)
        //   MMCommon.ui.getDock("AllianceOverview.Window")  // -> true/false
        NS.ui.setDock = function (key, on) {
            try {
                NS.settings.set(key + ".dockEnabled", on === true);
                if (on !== true) NS.settings.set(key + ".dock", null); // clear any saved edge so a refresh doesn't pin it
                NS.log.log("window", key, "dockEnabled =", on === true);
                return on === true;
            } catch (e) { NS.log.err("setDock failed:", e); return false; }
        };
        NS.ui.getDock = function (key) {
            try { return NS.settings.get(key + ".dockEnabled", false) === true; } catch (e) { return false; }
        };

        // buttons: CommonButtonHandler - a single draggable HUD "tray" that every script's button
        // registers into. Plug-n-play: no matter which scripts are enabled or in what order, their
        // buttons stack side-by-side in one bar instead of fighting for fixed corners.
        //
        // WHY (Mike's feedback on the old version): a per-script fixed bottom-right offset (right: 120 + idx*130)
        // a) overlaps the game's own corner widgets on some resolutions, and b) gets unusable when several
        // scripts each compute their own offset (the offsets are blind to each other across script loads).
        // A single shared tray fixes both: it occupies one rectangle the user can park anywhere.
        //
        // UX: a small "::" handle on the left of the tray is the drag affordance. Buttons stay clickable.
        // Position persists per player+world via MMCommon.settings (key "HUDTray.pos" = {left, top}).
        // Initial default = bottom-right with margins that clear the game's own bottom-right UI block.
        //
        // opts: { id, label, icon, tooltip, onExecute }. Returns the qx button or null. Call at game-ready.
        NS.buttons = (function () {
            var tray = null, handle = null, slots = [];
            var DEFAULTS = { bottom: 40, right: 220 }; // initial parking spot, clear of game UI
            var KEY = "HUDTray";

            // Apply absolute {left,top} layout properties to the tray, replacing whatever placement
            // (default bottom/right anchors or a prior left/top) is currently in effect. Canvas layouts
            // ignore unset hints, so we explicitly null the others when switching to absolute mode.
            function placeAbsolute(left, top) {
                try {
                    tray.setLayoutProperties({ left: left, top: top, right: null, bottom: null });
                } catch (e) {}
            }

            function ensureTray() {
                if (tray) return tray;
                try {
                    var app = qx.core.Init.getApplication();
                    tray = new qx.ui.container.Composite(new qx.ui.layout.HBox(4)).set({
                        padding: 3,
                        zIndex: 10000
                    });
                    // The drag handle sits left of the buttons. Listening on the handle (not the tray)
                    // keeps the buttons themselves freely clickable - dragging anywhere else does nothing.
                    handle = new qx.ui.basic.Label("::").set({
                        cursor: "move",
                        paddingLeft: 4, paddingRight: 6, paddingTop: 2, paddingBottom: 2,
                        textColor: "#cccccc",
                        font: new qx.bom.Font(14, ["monospace"]).set({ bold: true }),
                        toolTipText: "Drag to reposition the MM button bar"
                    });
                    tray.add(handle);
                    app.getDesktop().add(tray, DEFAULTS);

                    // --- drag handling -------------------------------------------------------------
                    // The qooxdoo "mousemove" only fires on a widget when the cursor is inside its
                    // bounds. While dragging, the cursor often leaves the tray, so we capture(true)
                    // on mousedown to route all pointer events to the tray until mouseup. This is
                    // the standard qooxdoo idiom for in-app drag; no global document handlers needed.
                    var dragging = false, dx = 0, dy = 0;
                    handle.addListener("mousedown", function (e) {
                        try {
                            var loc = tray.getContentLocation();
                            dx = e.getDocumentLeft() - loc.left;
                            dy = e.getDocumentTop() - loc.top;
                            dragging = true;
                            tray.capture(true);
                            e.stop();
                        } catch (e2) { NS.log.err("tray drag start failed:", e2); }
                    });
                    tray.addListener("mousemove", function (e) {
                        if (!dragging) return;
                        try {
                            var nx = Math.max(0, e.getDocumentLeft() - dx);
                            var ny = Math.max(0, e.getDocumentTop() - dy);
                            placeAbsolute(nx, ny);
                        } catch (e2) {}
                    });
                    function endDrag(e) {
                        if (!dragging) return;
                        dragging = false;
                        try {
                            tray.releaseCapture();
                            var loc = tray.getContentLocation();
                            NS.settings.set(KEY + ".pos", { left: loc.left, top: loc.top });
                            NS.log.log("HUDTray saved pos", loc);
                        } catch (e2) {}
                    }
                    tray.addListener("mouseup", endDrag);
                    tray.addListener("losecapture", endDrag); // safety: if capture is lost mid-drag

                    // --- restore saved position (player-id gated, same pattern as ui.Window restore) -
                    // Same trap as the window bug we already fixed: building right after nav-ready
                    // means settings.storeKey() resolves to the "default" bucket because the player
                    // id hasn't loaded. Wait for it, then apply the saved pos.
                    var tries = 0, restoreId = window.setInterval(function () {
                        try {
                            var pid = 0;
                            try { pid = ClientLib.Data.MainData.GetInstance().get_Player().get_Id(); } catch (_) {}
                            if (!pid) { if (++tries > 40) window.clearInterval(restoreId); return; }
                            window.clearInterval(restoreId);
                            var saved = NS.settings.get(KEY + ".pos", null);
                            if (saved && saved.left != null) {
                                placeAbsolute(saved.left, saved.top);
                                NS.log.log("HUDTray restored pos", saved);
                            }
                        } catch (_) {}
                    }, 300);

                    return tray;
                } catch (e) {
                    NS.log.err("HUDTray creation failed:", e);
                    return null;
                }
            }

            return {
                register: function (opts) {
                    opts = opts || {};
                    try {
                        var t = ensureTray();
                        if (!t) return null;
                        // de-dupe: if a script registers twice (e.g. on reload), return the existing button
                        if (opts.id) {
                            for (var i = 0; i < slots.length; i++) {
                                if (slots[i].id === opts.id) return slots[i].btn;
                            }
                        }
                        var btn = new qx.ui.form.Button(opts.label || "", opts.icon || null).set({
                            toolTipText: opts.tooltip || opts.label || "",
                            alignY: "middle",
                            appearance: "button-text-small"
                        });
                        if (opts.onExecute) btn.addListener("execute", opts.onExecute);
                        t.add(btn);
                        slots.push({ id: opts.id, btn: btn });
                        return btn;
                    } catch (e) {
                        NS.log.err("buttons.register failed:", e);
                        return null;
                    }
                }
            };
        })();

        window.MMCommon = NS;
        window.MMCommon_IsInstalled = true;
        log.log("MMCommon " + NS.version + " ready");
    };

    try {
        var el = document.createElement("script");
        el.textContent = "(" + MMCommon_main.toString() + ")();";
        el.type = "text/javascript";
        if (/commandandconquer\.com/i.test(document.domain)) {
            (document.head || document.documentElement).appendChild(el);
        }
    } catch (e) {
        console.error("[MM Common] init error: ", e);
    }
})();
