// ==UserScript==
// @name            MM - Common Library
// @description     Shared foundation library for the CnCTA MikeyMike pack. Runs in the game's page context and exposes window.MMCommon: one place for logging, net-events, settings, number/time formatting, coordinate helpers, and (being filled in during migration) the cnctaopt link encoder, base-scan, repair/loot calc, and a dockable-window + CommonButtonHandler UI. Load right after MM - Framework Wrapper.
// @author          MikeyMike (CnCTA-MikeyMike-SCRIPT-PACK)
// @version         1.0.19
// @match           https://*.alliances.commandandconquer.com/*/index.aspx*
// @downloadURL     https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/MM_CommonLibrary.user.js
// @updateURL       https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/MM_CommonLibrary.user.js
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
   Implemented & ready:  log, net, settings, num, time, coords, deobf, scan, loot,
   base, map, ui (dockable window), buttons (CommonButtonHandler, now optionally
   shown), menu (the in-game "CnC Pack" top menu), cnctaopt (base->cnctaopt.com link)
   Scaffold (TODO, ported as each consumer script is migrated): repair

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
            version: "1.0.19"
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
        // color - rgb interpolation + ratio->hex gradient. Salvaged from the
        // retired TA_Info_Sticker (interpolateColor / formatNumberColor). This is a
        // SMOOTH green->amber->red gradient; for the 3-step red/yellow/green bars use
        // the barColor pattern in Next MCV / Loot Summary instead.
        // -------------------------------------------------------------------
        NS.color = {
            // Linear interpolate two [r,g,b] arrays; s clamped to [0,1] -> [r,g,b].
            interpolate: function (c1, c2, s) {
                s = Math.max(0, Math.min(1, s));
                return [
                    Math.floor(c1[0] + s * (c2[0] - c1[0])),
                    Math.floor(c1[1] + s * (c2[1] - c1[1])),
                    Math.floor(c1[2] + s * (c2[2] - c1[2]))
                ];
            },
            // Map a fill ratio (value/max) to "#rrggbb": green up to 50%, blending to
            // amber by 75%, to red by 100%. Default palette = the old Info Sticker colours.
            ratioHex: function (ratio, palette) {
                if (!isFinite(ratio)) ratio = 0;
                ratio = Math.max(0, ratio);
                var p = palette || {};
                var green = p.green || [40, 150, 40];
                var middle = p.middle || [181, 151, 0];
                var red = p.red || [157, 43, 43];
                var c;
                if (ratio < 0.5) c = green;
                else if (ratio < 0.75) c = NS.color.interpolate(green, middle, (ratio - 0.5) / 0.25);
                else if (ratio < 1) c = NS.color.interpolate(middle, red, (ratio - 0.75) / 0.25);
                else c = red;
                try { return qx.util.ColorUtil.rgbToHexString(c); }
                catch (e) {
                    return "#" + c.map(function (n) { return (n < 16 ? "0" : "") + n.toString(16); }).join("");
                }
            },
            // Convenience matching the old formatNumberColor(value, max) signature.
            valueHex: function (value, max, palette) { return NS.color.ratioHex(max ? value / max : 0, palette); }
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
            // Pan the region map to a grid coordinate (assumes you're already in region view).
            center: function (x, y) {
                try { ClientLib.Vis.VisMain.GetInstance().get_Region().CenterGridPosition(x, y); return true; }
                catch (e) { return false; }
            },
            // Leave any open base view and return to the region/area map. IMPORTANT: the in-base screen
            // is a GUI OVERLAY, not a VisMain mode - calling VisMain.set_Mode(Region) alone flips the
            // internal mode but leaves the base overlay on screen. The game's own "close base" button
            // ultimately calls Application.showMainOverlay() (sniffed from its _onClose handler), which
            // tears down the base overlay AND sets region mode. We do the same, then re-assert the mode
            // as a belt-and-braces fallback for clients where showMainOverlay isn't present.
            exitToRegion: function () {
                var ok = false;
                try {
                    var app = qx.core.Init.getApplication();
                    if (app && typeof app.showMainOverlay === "function") { app.showMainOverlay(); ok = true; }
                } catch (e) { NS.log.warn("showMainOverlay failed:", e); }
                try { ClientLib.Vis.VisMain.GetInstance().set_Mode(ClientLib.Vis.Mode.Region); } catch (e) {}
                return ok;
            },
            // Go look at a coordinate: close any open base, switch to the region/area map AND center there.
            // The complete "jump to this base" helper (bare center() only pans, and only in region view).
            // NOTE: this does not natively SELECT/highlight the base - the Vis object the game's
            // set_SelectedObject() needs isn't reachable by any readable API (obfuscated, like the
            // base-edit move primitive); centering puts the base dead-centre, which is the reliable part.
            goTo: function (x, y) {
                try {
                    NS.coords.exitToRegion();
                    // center after the overlay/mode switch settles (a same-tick center can be lost)
                    try { ClientLib.Vis.VisMain.GetInstance().get_Region().CenterGridPosition(x, y); } catch (e) {}
                    window.setTimeout(function () { try { ClientLib.Vis.VisMain.GetInstance().get_Region().CenterGridPosition(x, y); } catch (e) {} }, 300);
                    return true;
                } catch (e) { NS.log.err("coords.goTo failed:", e); return false; }
            },
            // 8-way sector label of (x,y) relative to a center (cx,cy). Y grows downward.
            sector: function (x, y, cx, cy) {
                var dx = x - cx, dy = y - cy;
                if (dx === 0 && dy === 0) return "C";
                var ang = Math.atan2(-dy, dx) * 180 / Math.PI;
                if (ang < 0) ang += 360;
                return ["E", "NE", "N", "NW", "W", "SW", "S", "SE"][Math.round(ang / 45) % 8];
            },
            // Straight-line distance between two grid coords. Prefers the game's own
            // ClientLib.Base.Util.CalculateDistance (matches the in-game distance readout),
            // falling back to Euclidean. Always returns a finite Number. Salvaged from the
            // retired compass scripts (CD Compass / mhNavigator / Compass-ALT).
            distance: function (x1, y1, x2, y2) {
                try {
                    var U = ClientLib.Base.Util;
                    if (U && typeof U.CalculateDistance === "function") {
                        var d = U.CalculateDistance(x1, y1, x2, y2);
                        if (typeof d === "number" && !isNaN(d)) return d;
                    }
                } catch (e) {}
                var dx = x2 - x1, dy = y2 - y1;
                return Math.sqrt(dx * dx + dy * dy);
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
        // Faithful port of TA_CnCTAOpt_Link_Button.user.js (zbluebugz, v1.0.7.7) - the LIVE cnctaopt.com
        // "ver=3" encoder: the base/defense/offense hotkey maps + the 20x9 grid walk + faction logic.
        // Runs in page context, so GAMEDATA / PerforceChangelist / ClientLib are available.
        //   MMCommon.cnctaopt.url(cityId) / .encode(cityId) -> full https://www.cnctaopt.com/index.html?... URL
        //   MMCommon.cnctaopt.payload(cityId)               -> the raw "ver=3~...~ML=.." string (pre-encodeURI)
        //   MMCommon.cnctaopt.open(cityId)                  -> opens the URL in a new tab; returns it
        // All return null (and warn) on error so callers can guard. cityId is a city/base id
        // (e.g. visObject.get_Id()); the base's data must be loaded (GetCity owner != 0).
        NS.cnctaopt = (function () {
            var clog = NS.makeLogger("cnctaopt");

            // base / defense / offense - map the game's unit names to cnctaopt's single-letter hotkeys.
            var base_unit_map = {
                /* GDI Buildings */
                "GDI_Construction Yard": "y", "GDI_Power Plant": "p", "GDI_Refinery": "r", "GDI_Silo": "s",
                "GDI_Accumulator": "a", "GDI_Command Center": "e", "GDI_Barracks": "b", "GDI_Factory": "f",
                "GDI_Airport": "d", "GDI_Defense HQ": "q", "GDI_Defense Facility": "w", "GDI_Support_Air": "i",
                "GDI_Support_Ion": "x", "GDI_Support_Art": "z", "GDI_Harvester": "h",
                "GDI_Harvester_Crystal": "n", "GDI_Harvester_Tiberium": "j",
                /* Nod Buildings */
                "NOD_Construction Yard": "y", "NOD_Power Plant": "p", "NOD_Refinery": "r", "NOD_Silo": "s",
                "NOD_Accumulator": "a", "NOD_Command Post": "e", "NOD_Barracks": "b", "NOD_Factory": "f",
                "NOD_Airport": "d", "NOD_Defense HQ": "q", "NOD_Defense Facility": "w", "NOD_Support_Air": "i",
                "NOD_Support_Ion": "x", "NOD_Support_Art": "z", "NOD_Harvester": "h",
                "NOD_Harvester_Crystal": "n", "NOD_Harvester_Tiberium": "j",
                /* Forgotten Buildings */
                "FOR_Construction Yard": "y", "FOR_Refinery": "r", "FOR_Trade Center": "u", "FOR_Silo": "s",
                "FOR_Defense HQ": "q", "FOR_Defense Facility": "w", "FOR_Harvester_Crystal": "n",
                "FOR_Harvester_Tiberium": "j", "FOR_Crystal Booster": "v", "FOR_Tiberium Booster": "o",
                /* Forgotten Infected Buildings */
                "FOR_EVENT_Construction_Yard": "y", "FOR_GDI_Construction Yard": "y", "FOR_GDI_Power Plant": "p",
                "FOR_GDI_Refinery": "r", "FOR_GDI_Silo": "s", "FOR_GDI_Accumulator": "a",
                "FOR_GDI_Command Center": "e", "FOR_GDI_Barracks": "b", "FOR_GDI_Factory": "f",
                "FOR_GDI_Airport": "d", "FOR_GDI_Defense HQ": "q", "FOR_GDI_Defense Facility": "w",
                "FOR_GDI_Support_Air": "i", "FOR_GDI_Support_Ion": "x", "FOR_GDI_Support_Art": "z",
                "FOR_GDI_Harvester": "h", "FOR_GDI_Harvester_Crystal": "n", "FOR_GDI_Harvester_Tiberium": "j",
                "FOR_NOD_Construction Yard": "y", "FOR_NOD_Power Plant": "p", "FOR_NOD_Refinery": "r",
                "FOR_NOD_Silo": "s", "FOR_NOD_Accumulator": "a", "FOR_NOD_Command Post": "e",
                "FOR_NOD_Barracks": "b", "FOR_NOD_Factory": "f", "FOR_NOD_Airport": "d", "FOR_NOD_Defense HQ": "q",
                "FOR_NOD_Defense Facility": "w", "FOR_NOD_Support_Air": "i", "FOR_NOD_Support_Ion": "x",
                "FOR_NOD_Support_Art": "z", "FOR_NOD_Harvester": "h", "FOR_NOD_Harvester_Crystal": "n",
                "FOR_NOD_Harvester_Tiberium": "j",
                "": ""
            };
            var defense_unit_map = {
                /* GDI */
                "GDI_Wall": "w", "GDI_Def_Predator": "d", "GDI_Turret": "m", "GDI_Def_Pitbull": "p",
                "GDI_Barbwire": "b", "GDI_Def_Zone Trooper": "z", "GDI_Flak": "f", "GDI_Def_Missile Squad": "q",
                "GDI_Antitank Barrier": "t", "GDI_Def_Sniper": "s", "GDI_Cannon": "c", "GDI_Def_APC Guardian": "g",
                "GDI_Art Tank": "a", "GDI_Art Air": "e", "GDI_Art Inf": "r",
                /* Nod */
                "NOD_Def_Wall": "w", "NOD_Def_Scorpion Tank": "d", "NOD_Def_MG Nest": "m",
                "NOD_Def_Attack Bike": "p", "NOD_Def_Barbwire": "b", "NOD_Def_Black Hand": "z", "NOD_Def_Flak": "f",
                "NOD_Def_Militant Rocket Soldiers": "q", "NOD_Def_Antitank Barrier": "t", "NOD_Def_Confessor": "s",
                "NOD_Def_Cannon": "c", "NOD_Def_Reckoner": "g", "NOD_Def_Art Tank": "a", "NOD_Def_Art Air": "e",
                "NOD_Def_Art Inf": "r",
                /* Forgotten */
                "FOR_Wall": "w", "FOR_Mammoth": "d", "FOR_Turret_VS_Inf": "m", "FOR_Veh_VS_Air": "p",
                "FOR_Barbwire_VS_Inf": "b", "FOR_Inf_VS_Veh": "z", "FOR_Turret_VS_Air": "f", "FOR_Inf_VS_Air": "q",
                "FOR_Barrier_VS_Veh": "t", "FOR_Sniper": "s", "FOR_Turret_VS_Veh": "c", "FOR_Veh_VS_Inf": "g",
                "FOR_Turret_VS_Veh_ranged": "a", "FOR_Turret_VS_Air_ranged": "e", "FOR_Turret_VS_Inf_ranged": "r",
                "FOR_Inf_VS_Inf": "i", "FOR_Veh_VS_Veh": "o",
                /* Forgotten Fortress */
                "FOR_Fortress_DEF_Sniper": "s", "FOR_Fortress_DEF_Inf_VS_Inf": "i", "FOR_Fortress_DEF_Veh_VS_Air": "p",
                "FOR_Fortress_DEF_Turret_VS_Inf": "m", "FOR_Fortress_DEF_Turret_VS_Veh": "c",
                "FOR_Fortress_DEF_Turret_VS_Air": "f", "FOR_Fortress_DEF_Turret_VS_Veh_ranged": "a",
                "FOR_Fortress_DEF_Turret_VS_Air_ranged": "e", "FOR_Fortress_DEF_Turret_VS_Inf_ranged": "r",
                "FOR_Fortress_DEF_Mammoth": "d",
                /* Forgotten Infected GDI */
                "FOR_GDI_Wall": "w", "FOR_GDI_Def_Predator": "d", "FOR_GDI_Turret": "m", "FOR_GDI_Def_Pitbull": "p",
                "FOR_GDI_Barbwire": "b", "FOR_GDI_Def_Zone Trooper": "z", "FOR_GDI_Flak": "f",
                "FOR_GDI_Def_Missile Squad": "q", "FOR_GDI_Antitank Barrier": "t", "FOR_GDI_Def_Sniper": "s",
                "FOR_GDI_Cannon": "c", "FOR_GDI_Def_APC Guardian": "g", "FOR_GDI_Art Tank": "a",
                "FOR_GDI_Art Air": "e", "FOR_GDI_Art Inf": "r",
                /* Forgotten Infected NOD */
                "FOR_NOD_Def_Wall": "w", "FOR_NOD_Def_Scorpion Tank": "d", "FOR_NOD_Def_MG Nest": "m",
                "FOR_NOD_Def_Attack Bike": "p", "FOR_NOD_Def_Barbwire": "b", "FOR_NOD_Def_Black Hand": "z",
                "FOR_NOD_Def_Flak": "f", "FOR_NOD_Def_Militant Rocket Soldiers": "q",
                "FOR_NOD_Def_Antitank Barrier": "t", "FOR_NOD_Def_Confessor": "s", "FOR_NOD_Def_Cannon": "c",
                "FOR_NOD_Def_Reckoner": "g", "FOR_NOD_Def_Art Tank": "a", "FOR_NOD_Def_Art Air": "e",
                "FOR_NOD_Def_Art Inf": "r",
                "": ""
            };
            var offense_unit_map = {
                /* GDI */
                "GDI_Riflemen": "i", "GDI_Missile Squad": "q", "GDI_Zone Trooper": "z", "GDI_Commando": "c",
                "GDI_Sniper Team": "s", "GDI_APC Guardian": "g", "GDI_Pitbull": "p", "GDI_Predator": "d",
                "GDI_Juggernaut": "j", "GDI_Mammoth": "a", "GDI_Orca": "v", "GDI_Firehawk": "f", "GDI_Paladin": "o",
                "GDI_Kodiak": "k",
                /* Nod */
                "NOD_Militants": "i", "NOD_Militant Rocket Soldiers": "q", "NOD_Black Hand": "z", "NOD_Commando": "c",
                "NOD_Confessor": "s", "NOD_Reckoner": "g", "NOD_Attack Bike": "p", "NOD_Scorpion Tank": "d",
                "NOD_Specter Artilery": "j", "NOD_Avatar": "a", "NOD_Venom": "v", "NOD_Vertigo": "f",
                "NOD_Cobra": "o", "NOD_Salamander": "k",
                "": ""
            };

            function findTechLayout(city) {
                for (var k in city) {
                    if ((typeof (city[k]) == "object") && city[k] && (0 in city[k]) && (8 in city[k])) {
                        if ((typeof (city[k][0]) == "object") && city[k][0] && (0 in city[k][0]) && (15 in city[k][0])) {
                            if ((typeof (city[k][0][0]) == "object") && city[k][0][0] && ("BuildingIndex" in city[k][0][0])) {
                                return city[k];
                            }
                        }
                    }
                }
                return null;
            }
            function findBuildings(city) {
                var cityBuildings = city.get_CityBuildingsData();
                for (var k in cityBuildings) {
                    if (PerforceChangelist >= 376877) {
                        if ((typeof (cityBuildings[k]) === "object") && cityBuildings[k] && ("d" in cityBuildings[k]) && ("c" in cityBuildings[k]) && (cityBuildings[k].c > 0)) {
                            return cityBuildings[k].d;
                        }
                    } else {
                        if ((typeof (cityBuildings[k]) === "object") && cityBuildings[k] && "l" in cityBuildings[k]) {
                            return cityBuildings[k].l;
                        }
                    }
                }
            }
            function isDefenseUnit(unit) { return (unit.get_UnitGameData_Obj().n in defense_unit_map); }
            function isOffenseUnit(unit) { return (unit.get_UnitGameData_Obj().n in offense_unit_map); }
            function getUnitArrays(city) {
                var ret = [];
                for (var k in city) {
                    if ((typeof (city[k]) == "object") && city[k]) {
                        for (var k2 in city[k]) {
                            var lst;
                            if (PerforceChangelist >= 376877) {
                                if ((typeof (city[k][k2]) == "object") && city[k][k2] && "d" in city[k][k2]) {
                                    lst = city[k][k2].d;
                                    if ((typeof (lst) == "object") && lst) {
                                        for (var i in lst) {
                                            if (typeof (lst[i]) == "object" && lst[i] && "get_CurrentLevel" in lst[i]) { ret.push(lst); }
                                        }
                                    }
                                }
                            } else {
                                if ((typeof (city[k][k2]) == "object") && city[k][k2] && "l" in city[k][k2]) {
                                    lst = city[k][k2].l;
                                    if ((typeof (lst) == "object") && lst) {
                                        for (var j in lst) {
                                            if (typeof (lst[j]) == "object" && lst[j] && "get_CurrentLevel" in lst[j]) { ret.push(lst); }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                return ret;
            }
            function getDefenseUnits(city) {
                var arr = getUnitArrays(city);
                for (var i = 0; i < arr.length; ++i) { for (var j in arr[i]) { if (isDefenseUnit(arr[i][j])) { return arr[i]; } } }
                return [];
            }
            function getOffenseUnits(city) {
                var arr = getUnitArrays(city);
                for (var i = 0; i < arr.length; ++i) { for (var j in arr[i]) { if (isOffenseUnit(arr[i][j])) { return arr[i]; } } }
                return [];
            }

            // Build the raw "ver=3~...~ML=.." payload for a city id (pre-encodeURI). Returns null on error.
            function payload(cityId) {
                try {
                    var city = ClientLib.Data.MainData.GetInstance().get_Cities().GetCity(cityId);
                    var own_city = ClientLib.Data.MainData.GetInstance().get_Cities().get_CurrentOwnCity();
                    var server = ClientLib.Data.MainData.GetInstance().get_Server();
                    if (!city) { clog.warn("payload: no city for id", cityId); return null; }
                    var coordX = city.get_X();
                    var coordY = city.get_Y();
                    var worldName = server.get_Name().trim();
                    var worldId = server.get_WorldId();
                    var maxLevel = server.get_PlayerUpgradeCap();
                    var economy = (server.get_TechLevelUpgradeFactorBonusAmount() != 1.20) ? "new" : "old";

                    var link = "ver=3~";
                    // base / defense faction (of the base being viewed)
                    var faction = city.get_CityFaction();
                    if (faction === 1) { link += "G~"; }
                    else if (faction === 2) { link += "N~"; }
                    else if (faction > 2 && faction < 9) { link += "F~"; }
                    else { clog.warn("Unknown faction (1):", faction); link += "E~"; }
                    // offense faction - for a Forgotten target, use the player's own offense setup
                    faction = city.get_CityFaction();
                    if (faction > 2) { faction = own_city.get_CityFaction(); }
                    if (faction === 1) { link += "G~"; }
                    else if (faction === 2) { link += "N~"; }
                    else { clog.warn("Unknown faction (2):", faction); link += "E~"; }
                    // city name
                    link += city.get_Name().trim() + "~";

                    // 20x9 defense-unit grid (offset +8)
                    var defense_units = [], i, j, col;
                    for (i = 0; i < 20; ++i) { col = []; for (j = 0; j < 9; ++j) { col.push(null); } defense_units.push(col); }
                    var defense_unit_list = getDefenseUnits(city);
                    for (i in defense_unit_list) { var du = defense_unit_list[i]; defense_units[du.get_CoordX()][du.get_CoordY() + 8] = du; }
                    // 20x9 offense-unit grid (offset +16); for a Forgotten target use own city's offense
                    var offense_units = [];
                    for (i = 0; i < 20; ++i) { col = []; for (j = 0; j < 9; ++j) { col.push(null); } offense_units.push(col); }
                    var offense_unit_list = (city.get_CityFaction() == 1 || city.get_CityFaction() == 2) ? getOffenseUnits(city) : getOffenseUnits(own_city);
                    for (i in offense_unit_list) { var ou = offense_unit_list[i]; offense_units[ou.get_CoordX()][ou.get_CoordY() + 16] = ou; }

                    // walk the 20x9 grid: building / defense / offense / terrain
                    var techLayout = findTechLayout(city);
                    var buildings = findBuildings(city);
                    for (i = 0; i < 20; ++i) {
                        for (j = 0; j < 9; ++j) {
                            var spot = i > 16 ? null : techLayout[j][i];
                            var level = 0;
                            var building = null;
                            if (spot && spot.BuildingIndex >= 0) { building = buildings[spot.BuildingIndex]; level = building.get_CurrentLevel(); }
                            var defense_unit = defense_units[j][i];
                            if (defense_unit) { level = defense_unit.get_CurrentLevel(); }
                            var offense_unit = offense_units[j][i];
                            if (offense_unit) { level = offense_unit.get_CurrentLevel(); }
                            if (level > 0) { link += level; }

                            switch (i > 16 ? 0 : city.GetResourceType(j, i)) {
                                case 0:
                                    if (building) {
                                        var techId = building.get_MdbBuildingId();
                                        if (GAMEDATA.Tech[techId].n in base_unit_map) { link += base_unit_map[GAMEDATA.Tech[techId].n]; }
                                        else { clog.warn("Unhandled building:", techId); link += "."; }
                                    } else if (defense_unit) {
                                        if (defense_unit.get_UnitGameData_Obj().n in defense_unit_map) { link += defense_unit_map[defense_unit.get_UnitGameData_Obj().n]; }
                                        else { clog.warn("Unhandled defense unit:", defense_unit.get_UnitGameData_Obj().n); link += "."; }
                                    } else if (offense_unit) {
                                        if (offense_unit.get_UnitGameData_Obj().n in offense_unit_map) { link += offense_unit_map[offense_unit.get_UnitGameData_Obj().n]; }
                                        else { clog.warn("Unhandled offense unit:", offense_unit.get_UnitGameData_Obj().n); link += "."; }
                                    } else { link += "."; }
                                    break;
                                case 1: link += (spot.BuildingIndex < 0) ? "c" : "n"; break; /* crystal */
                                case 2: link += (spot.BuildingIndex < 0) ? "t" : "j"; break; /* tiberium */
                                case 4: link += "j"; break; /* woods */
                                case 5: link += "h"; break; /* scrub */
                                case 6: link += "l"; break; /* oil */
                                case 7: link += "k"; break; /* swamp */
                                default: clog.warn("Unhandled resource type:", city.GetResourceType(j, i)); link += "."; break;
                            }
                        }
                    }

                    link += "~E=" + economy;
                    link += "~X=" + coordX + "~Y=" + coordY;
                    link += "~WID=" + worldId;
                    link += "~WN=" + worldName;
                    link += "~ML=" + maxLevel;
                    return link;
                } catch (e) { clog.warn("payload error:", e); return null; }
            }
            function url(cityId) {
                var p = payload(cityId);
                return p ? ("https://www.cnctaopt.com/index.html?" + encodeURI(p)) : null;
            }
            return {
                maps: { base: base_unit_map, defense: defense_unit_map, offense: offense_unit_map },
                payload: payload,
                url: url,
                encode: url, // alias: the practical output is the full URL
                open: function (cityId) { var u = url(cityId); if (u) { window.open(u, "_blank"); } return u; }
            };
        })();

        // scan: iterate attackable world objects within range of an origin base.
        // Ported from TA_Maelstrom_ADDON_Basescanner_AIO's FJ enumeration (the sync phase).
        // This is phase 1 only: it returns lightweight candidate descriptors. Per-base DETAIL
        // (loot, fields, condition) is async - the consumer loads each city by id and waits for
        // get_Version()>0 (GetCity returns version:-1/name:null until the server round-trip lands),
        // then calls MMCommon.loot.ofCity etc. (this is the AIO FG pattern).
        NS.scan = {
            // opts: { origin (city; default current own city), maxDistance (default server max),
            //   types ([1,2,3]: 1=player, 2=NPC base, 3=camp/outpost), cpLimit (default Infinity),
            //   minLevel (default 0), playerCP (bool, default true: pass the player-CP flags to
            //   CalculateAttackCommandPointCostToCoord for type-1 targets, matching AIO),
            //   excludeOwn (default true: skip your own bases by id), excludeIds (array or id->true map),
            //   attackableOnly (default true: drop targets the origin can't actually attack - out of
            //   range or beyond its command-point capacity - via the game's own CheckAttackBase) }
            // Returns [{ id, type, x, y, baseLevel, campType, cp }] (campType null for non-camps,
            // cp null if the cost call threw). Ally exclusion is left to the detail phase, where the
            // alliance relationship is authoritative (same as AIO's FG re-check).
            inRange: function (opts) {
                opts = opts || {};
                var out = [];
                try {
                    var md = ClientLib.Data.MainData.GetInstance();
                    var world = md.get_World();
                    var cities = md.get_Cities();
                    var origin = opts.origin || cities.get_CurrentOwnCity();
                    if (!origin) return out;
                    var px = origin.get_PosX(), py = origin.get_PosY();
                    var maxD = (opts.maxDistance != null) ? opts.maxDistance : md.get_Server().get_MaxAttackDistance();
                    var types = opts.types || [1, 2, 3];
                    var cpLimit = (opts.cpLimit != null) ? opts.cpLimit : Infinity;
                    var minLevel = opts.minLevel || 0;
                    var playerCP = (opts.playerCP !== false);
                    // attackableOnly (default true): use the game's own CheckAttackBase to drop targets
                    // that can't actually be attacked from this origin - out of range (FailDistance) or
                    // costing more command points than the base can field (FailInsufficientCommandPoints).
                    // Other failure reasons (no army staged, ally, ghost, protection) are deliberately
                    // IGNORED here, so a scan works without a loaded army and leaves ally/ghost handling
                    // to the caller's detail phase. This is the real "you can only attack so far / so
                    // expensively" guardrail - the geometric maxDistance below is a fast pre-filter; this
                    // is the authoritative one.
                    var attackableOnly = (opts.attackableOnly !== false);
                    var FAIL_MASK = 0;
                    if (attackableOnly) {
                        try {
                            var EA = ClientLib.Data.EAttackBaseResult;
                            var fDist = (EA && EA.FailDistance != null) ? EA.FailDistance : 1;
                            var fCp = (EA && EA.FailInsufficientCommandPoints != null) ? EA.FailInsufficientCommandPoints : 16;
                            FAIL_MASK = fDist | fCp;
                        } catch (e) { FAIL_MASK = 1 | 16; }
                        if (typeof world.CheckAttackBase !== "function") attackableOnly = false; // not available -> skip the gate
                    }
                    var ownIds = {};
                    if (opts.excludeOwn !== false) {
                        try {
                            var ac = cities.get_AllCities && cities.get_AllCities();
                            var dd = ac && ac.d;
                            for (var k in dd) { if (dd[k] && dd[k].get_Id) ownIds[dd[k].get_Id()] = true; }
                        } catch (e) {}
                    }
                    var exIds = {};
                    if (opts.excludeIds) {
                        if (opts.excludeIds.length != null) { for (var j = 0; j < opts.excludeIds.length; j++) exIds[opts.excludeIds[j]] = true; }
                        else exIds = opts.excludeIds;
                    }
                    var step = Math.floor(maxD + 1);
                    for (var sy = py - step; sy <= py + step; sy++) {
                        for (var sx = px - step; sx <= px + step; sx++) {
                            var ddx = px - sx, ddy = py - sy;
                            if (Math.sqrt(ddx * ddx + ddy * ddy) > maxD) continue;
                            var obj = world.GetObjectFromPosition(sx, sy);
                            if (!obj || types.indexOf(obj.Type) === -1) continue;
                            if (typeof obj.getID !== "function" || typeof obj.get_BaseLevel !== "function") continue;
                            var id = obj.getID();
                            if (ownIds[id] || exIds[id]) continue;
                            if (parseInt(obj.get_BaseLevel(), 10) < minLevel) continue;
                            var cp;
                            try {
                                cp = (obj.Type === 1 && playerCP)
                                    ? origin.CalculateAttackCommandPointCostToCoord(sx, sy, true, true)
                                    : origin.CalculateAttackCommandPointCostToCoord(sx, sy);
                            } catch (e) { cp = null; }
                            if (cp != null && cp > cpLimit) continue;
                            if (attackableOnly) {
                                var car; try { car = world.CheckAttackBase(sx, sy); } catch (e) { car = 0; }
                                if (car & FAIL_MASK) continue; // out of range / not enough command points
                            }
                            out.push({
                                id: id, type: obj.Type, x: sx, y: sy, baseLevel: obj.get_BaseLevel(),
                                campType: (typeof obj.get_CampType === "function") ? obj.get_CampType() : null,
                                cp: cp
                            });
                        }
                    }
                } catch (e) { NS.log.err("scan.inRange failed:", e); }
                return out;
            }
        };

        // repair: repair-time / repair-cost helpers (port from battle sim + TA_Auto_Repair).
        NS.repair = {
            unitGroupTime: todo("repair.unitGroupTime"),
            entityFullCost: todo("repair.entityFullCost")
        };

        // loot: loot / lootable-resource summary for a base.
        // Ported from the AIO scanner's getResourcesPart: the lootable value of an entity is its
        // UnitLevelRepairRequirements (the resource cost to repair it), scaled by current hitpoints%
        // so damaged bases show reduced loot. Sums buildings + defense units.
        NS.loot = {
            // ofCity(ncity, opts) -> array indexed by ClientLib.Base.EResourceType
            //   (Tiberium=1, Crystal=2, Gold=3, ResearchPoints=6). opts: { buildings (default true),
            //   units (default true) }. Returns all-zeros on any failure (never throws).
            ofCity: function (ncity, opts) {
                opts = opts || {};
                var loot = [0, 0, 0, 0, 0, 0, 0, 0];
                try {
                    if (!ncity) return loot;
                    function add(entities) {
                        if (!entities) return;
                        for (var i in entities) {
                            var e = entities[i];
                            if (!e || typeof e.get_UnitLevelRepairRequirements !== "function") continue;
                            var req = e.get_UnitLevelRepairRequirements();
                            if (!req) continue;
                            var hp = (typeof e.get_HitpointsPercent === "function") ? e.get_HitpointsPercent() : 1;
                            for (var x = 0; x < req.length; x++) {
                                if (loot[req[x].Type] == null) loot[req[x].Type] = 0;
                                loot[req[x].Type] += req[x].Count * hp;
                            }
                        }
                    }
                    if (opts.buildings !== false) {
                        try { var b = ncity.get_Buildings(); add(b && b.d); } catch (e) {}
                    }
                    if (opts.units !== false) {
                        try {
                            var cu = ncity.get_CityUnitsData();
                            var du = cu && cu.get_DefenseUnits && cu.get_DefenseUnits();
                            add(du && du.d);
                        } catch (e) {}
                    }
                } catch (e) { NS.log.err("loot.ofCity failed:", e); }
                return loot;
            }
        };

        // base: per-city data summaries salvaged from MaelstromTools Dev (Army Overview / Base
        // Resources / Base Status). Data-only (no UI) - each takes a city object and returns a plain
        // object, so any script can build its own view. (Originals iterated all cities into a cache;
        // these are per-city + an ownCities() helper, which composes better.) PerforceChangelist
        // version branches dropped - modern client only.
        NS.base = {
            // All of the player's own bases (city objects).
            ownCities: function () {
                var out = [];
                try {
                    var arr = ClientLib.Data.MainData.GetInstance().get_Cities().get_AllCities();
                    var d = arr && arr.d;
                    for (var k in d) { var c = d[k]; try { if (c && c.IsOwnBase && c.IsOwnBase()) out.push(c); } catch (e) {} }
                } catch (e) { NS.log.err("base.ownCities failed:", e); }
                return out;
            },
            // Map of the player's own base ids -> own city object (already loaded). Cheap own-check.
            ownIdMap: function () {
                var m = {};
                try {
                    var arr = ClientLib.Data.MainData.GetInstance().get_Cities().get_AllCities();
                    var d = arr && arr.d;
                    for (var k in d) { var c = d[k]; if (c && c.get_Id) m[c.get_Id()] = c; }
                } catch (e) { NS.log.err("base.ownIdMap failed:", e); }
                return m;
            },
            // Is a base whose owner is in alliance theirAllianceId an ally of ours (same alliance, or
            // NAP/ally by diplomacy)? Faithful port of the AIO / Base-Scanner FG alliance re-check (the
            // authoritative relationship pass). myAllianceId optional (defaults to our alliance).
            isAlly: function (theirAllianceId, myAllianceId) {
                try {
                    if (myAllianceId == null) {
                        try { myAllianceId = ClientLib.Data.MainData.GetInstance().get_Alliance().get_Id(); } catch (e) { myAllianceId = 0; }
                    }
                    if (!theirAllianceId || !myAllianceId) return false;
                    if (theirAllianceId === myAllianceId) return true;
                    var rel = ClientLib.Data.MainData.GetInstance().get_Alliance().get_Relationships();
                    if (rel) {
                        for (var k in rel) {
                            var r = rel[k];
                            if (r && r.OtherAllianceId === theirAllianceId && (r.Relationship === 1 || r.Relationship === 2)) return true;
                        }
                    }
                } catch (e) {}
                return false;
            },
            // Classify a loaded city as "own" | "alliance" | "neutral" | "enemy":
            //   own      - one of your bases
            //   alliance - same alliance as you
            //   neutral  - a DIFFERENT alliance you're at peace/NAP/ally with (diplomacy)
            //   enemy    - everyone else (attackable, incl. unaffiliated players)
            // ncity = the detail city (get_OwnerAllianceId valid once loaded). ownMap optional.
            relationship: function (id, ncity, ownMap) {
                try {
                    if (!ownMap) ownMap = NS.base.ownIdMap();
                    if (ownMap[id]) return "own";
                    var their = (ncity && ncity.get_OwnerAllianceId) ? ncity.get_OwnerAllianceId() : 0;
                    var mine = 0; try { mine = ClientLib.Data.MainData.GetInstance().get_Alliance().get_Id(); } catch (e) {}
                    if (their && mine && their === mine) return "alliance";
                    if (NS.base.isAlly(their)) return "neutral"; // different alliance, but NAP/ally by diplomacy
                    return "enemy";
                } catch (e) { return "enemy"; }
            },
            // SYNCHRONOUS own/alliance/neutral/enemy from a VIS region object (see map.visObjectAt).
            // The vis object carries get_AllianceId()/IsOwnBase() live, so this needs NO detail-load
            // survey (unlike relationship(), which reads a loaded detail city's get_OwnerAllianceId -
            // that path mis-bucketed alliance members as neutral; this one keys off the same field the
            // game colours outlines from). myAllianceId optional (defaults to ours). Classifies:
            //   own = your base; alliance = your alliance id; neutral = a different alliance you have
            //   NAP/peace/ally diplomacy with; enemy = everyone else (incl. unaffiliated).
            relationshipFromVis: function (vo, myAllianceId) {
                try {
                    if (!vo) return "enemy";
                    if (typeof vo.IsOwnBase === "function" && vo.IsOwnBase()) return "own";
                    var their = (typeof vo.get_AllianceId === "function") ? (vo.get_AllianceId() || 0) : 0;
                    if (myAllianceId == null) {
                        try { myAllianceId = ClientLib.Data.MainData.GetInstance().get_Alliance().get_Id(); } catch (e) { myAllianceId = 0; }
                    }
                    if (their && myAllianceId && their === myAllianceId) return "alliance";
                    if (their && NS.base.isAlly(their, myAllianceId)) return "neutral";
                    return "enemy";
                } catch (e) { return "enemy"; }
            },
            // Async-load a base's server detail by id and call cb(ncity) once it lands (or cb(null) on
            // timeout). GetCity returns a version:-1 stub until you TRIGGER the load with
            // set_CurrentCityId(id) (one shared "current city" pointer), so by default this triggers it
            // then polls get_Version()>0. Because there is only one current-city pointer, callers MUST
            // serialize fetchDetail (one in flight at a time) - concurrent calls thrash each other - and
            // should restore the prior current-city id when their batch drains (see base.currentCityId /
            // setCurrentCityId). opts: { trigger (default true), tries (20), intervalMs (250) }.
            fetchDetail: function (id, cb, opts) {
                opts = opts || {};
                var tries = opts.tries || 20, interval = opts.intervalMs || 250, n = 0;
                if (opts.trigger !== false) {
                    try { ClientLib.Data.MainData.GetInstance().get_Cities().set_CurrentCityId(id); } catch (e) {}
                }
                function poll() {
                    var ncity = null;
                    try { ncity = ClientLib.Data.MainData.GetInstance().get_Cities().GetCity(id); } catch (e) {}
                    if (ncity && ncity.get_Version() > 0) { try { cb(ncity); } catch (e) { NS.log.err("fetchDetail cb:", e); } return; }
                    if (++n > tries) { try { cb(null); } catch (e) {} return; }
                    window.setTimeout(poll, interval);
                }
                poll();
            },
            // The game's current-city pointer (the base loaded as "current"; -1 in region view). Used to
            // save/restore around a fetchDetail survey so it doesn't leave someone else's base "current".
            currentCityId: function () { try { return ClientLib.Data.MainData.GetInstance().get_Cities().get_CurrentCityId(); } catch (e) { return -1; } },
            setCurrentCityId: function (id) { try { ClientLib.Data.MainData.GetInstance().get_Cities().set_CurrentCityId(id); } catch (e) {} },
            // Army Overview data: repair times per unit group, repair charges, possible/max attacks
            // (PossibleAttacks gets a trailing "*" when offense isn't 100% healthy), and base/offense/
            // defense level + head-count + health. From MaelstromTools.RepairTime.updateCache.
            army: function (ncity) {
                var out = { repairTime: {}, repaircharge: {}, base: {}, offense: {}, defense: {} };
                try {
                    if (!ncity) return out;
                    var EU = ClientLib.Data.EUnitGroup, ER = ClientLib.Base.EResourceType;
                    var ud = ncity.get_CityUnitsData();
                    var rt = out.repairTime, rc = out.repaircharge;
                    rt.Infantry = ud.GetRepairTimeFromEUnitGroup(EU.Infantry, false);
                    rt.Vehicle = ud.GetRepairTimeFromEUnitGroup(EU.Vehicle, false);
                    rt.Aircraft = ud.GetRepairTimeFromEUnitGroup(EU.Aircraft, false);
                    rt.Maximum = ncity.GetResourceMaxStorage(ER.RepairChargeInf);
                    rc.Infantry = ncity.GetResourceCount(ER.RepairChargeInf);
                    rc.Vehicle = ncity.GetResourceCount(ER.RepairChargeVeh);
                    rc.Aircraft = ncity.GetResourceCount(ER.RepairChargeAir);
                    rc.Smallest = Math.min(rc.Infantry, rc.Vehicle, rc.Aircraft);
                    var largest = 0, repLargest = "";
                    ["Infantry", "Vehicle", "Aircraft"].forEach(function (g) { if (rt[g] > largest) { largest = rt[g]; repLargest = g; } });
                    rt.Largest = largest;
                    var offHealth = ncity.GetOffenseConditionInPercent();
                    if (repLargest !== "") {
                        rt.LargestDiv = rt[repLargest];
                        var i = Math.ceil(rc.Smallest / rt.LargestDiv);
                        if (offHealth !== 100) { i--; i += "*"; } // unhealthy units: one fewer attack, flagged with *
                        rt.PossibleAttacks = i;
                        rt.MaxAttacks = Math.ceil(rt.Maximum / rt.LargestDiv);
                    } else { rt.LargestDiv = 0; rt.PossibleAttacks = 0; rt.MaxAttacks = 0; }
                    var b = out.base;
                    b.Level = (Math.floor(ncity.get_LvlBase() * 100) / 100).toFixed(2);
                    b.UnitLimit = ncity.GetBuildingSlotLimit();
                    b.TotalHeadCount = ncity.GetBuildingSlotCount();
                    b.FreeHeadCount = b.UnitLimit - b.TotalHeadCount;
                    b.HealthInPercent = ncity.GetBuildingsConditionInPercent();
                    var o = out.offense;
                    o.Level = (Math.floor(ncity.get_LvlOffense() * 100) / 100).toFixed(2);
                    o.UnitLimit = ud.get_UnitLimitOffense();
                    o.TotalHeadCount = ud.get_TotalOffenseHeadCount();
                    o.FreeHeadCount = ud.get_FreeOffenseHeadCount();
                    o.HealthInPercent = offHealth > 0 ? offHealth : 0;
                    var df = out.defense;
                    df.Level = (Math.floor(ncity.get_LvlDefense() * 100) / 100).toFixed(2);
                    df.UnitLimit = ud.get_UnitLimitDefense();
                    df.TotalHeadCount = ud.get_TotalDefenseHeadCount();
                    df.FreeHeadCount = ud.get_FreeDefenseHeadCount();
                    var dHealth = ncity.GetDefenseConditionInPercent();
                    df.HealthInPercent = dHealth > 0 ? dHealth : 0;
                } catch (e) { NS.log.err("base.army failed:", e); }
                return out;
            },
            // Base Resources data: count / max-storage / step+time-until-full for Tiberium, Crystal,
            // Power. From MaelstromTools.ResourceOverview.updateCache.
            resources: function (ncity) {
                var out = {};
                try {
                    if (!ncity) return out;
                    var ER = ClientLib.Base.EResourceType;
                    var t = ClientLib.Data.MainData.GetInstance().get_Time();
                    function res(type) {
                        var fullStep = ncity.GetResourceStorageFullStep(type);
                        return {
                            count: ncity.GetResourceCount(type),
                            max: ncity.GetResourceMaxStorage(type),
                            fullStep: fullStep,
                            fullTime: t.GetJSStepTime(fullStep)
                        };
                    }
                    out.tiberium = res(ER.Tiberium);
                    out.crystal = res(ER.Crystal);
                    out.power = res(ER.Power);
                } catch (e) { NS.log.err("base.resources failed:", e); }
                return out;
            },
            // Base Status data: movement cooldown / lockdown, protection, alert state, and dedicated
            // support-weapon details (name/level/range + the supported base id/name/coords, decoded from
            // the 32-bit packed coord). From MaelstromTools.BaseStatus.updateCache.
            status: function (ncity) {
                var out = { support: { has: false } };
                try {
                    if (!ncity) return out;
                    out.hasCooldown = ncity.get_hasCooldown();
                    out.cooldownEnd = Math.max(ncity.get_MoveCooldownEndStep(), ncity.get_MoveRestictionEndStep());
                    out.moveCooldownEnd = ncity.get_MoveCooldownEndStep();
                    out.moveLockdownEnd = ncity.get_MoveRestictionEndStep();
                    out.isProtected = ncity.get_isProtected();
                    out.protectionEnd = ncity.get_ProtectionEndStep();
                    out.isAlerted = ncity.get_isAlerted();
                    var sd = ncity.get_SupportData();
                    if (sd) {
                        var s = out.support; s.has = true;
                        if (ncity.get_SupportDedicatedBaseId() > 0) {
                            s.dedicatedBaseId = ncity.get_SupportDedicatedBaseId();
                            s.dedicatedBaseName = ncity.get_SupportDedicatedBaseName();
                            var coordId = ncity.get_SupportDedicatedBaseCoordId();
                            s.dedicatedBaseX = (coordId & 0xffff);            // 32-bit packed coord: low word = X
                            s.dedicatedBaseY = ((coordId >> 0x10) & 0xffff);  // high word = Y
                        }
                        try { s.range = ncity.get_SupportWeapon().r; } catch (e) {}
                        try {
                            var player = ClientLib.Data.MainData.GetInstance().get_Player();
                            var techName = ClientLib.Base.Tech.GetTechNameFromTechId(sd.get_Type(), player.get_Faction());
                            s.name = ClientLib.Base.Tech.GetProductionBuildingNameFromFaction(techName, player.get_Faction());
                        } catch (e) {}
                        s.level = sd.get_Level();
                    }
                } catch (e) { NS.log.err("base.status failed:", e); }
                return out;
            },
            // Find the Construction Yard / Defense Facility / support-weapon buildings in a base's grid,
            // keyed by MdbUnitId (faction-spanning: CY 112/151/177, DF 158/131/195, support 200-205).
            // Returns { cy, df, support }, each { row (8 - CoordY = rows from the front), col, condition
            // (% health) } or null if absent. Shared scan for MM - Loot Summary (and Base Scanner).
            keyBuildings: function (ncity) {
                var out = { cy: null, df: null, support: null };
                try {
                    var b = ncity && ncity.get_Buildings(); var d = b && b.d;
                    for (var k in d) {
                        var u = d[k];
                        if (!u || typeof u.get_MdbUnitId !== "function") continue;
                        var id = u.get_MdbUnitId();
                        var slot = { row: 8 - u.get_CoordY(), col: u.get_CoordX(), condition: 100 * u.get_HitpointsPercent() };
                        if (id >= 200 && id <= 205) out.support = slot;
                        else if (id === 112 || id === 151 || id === 177) out.cy = slot;
                        else if (id === 158 || id === 131 || id === 195) out.df = slot;
                    }
                } catch (e) { NS.log.err("base.keyBuildings failed:", e); }
                return out;
            },
            // Per-hour production for a base: tiberium / crystal / power / credits. (GetResourceGrowPerHour
            // returns a per-hour rate; credits come via the packed CityCreditsProduction record.)
            production: function (ncity) {
                var out = { tiberium: 0, crystal: 0, power: 0, credits: 0 };
                try {
                    if (!ncity) return out;
                    var ER = ClientLib.Base.EResourceType;
                    out.tiberium = ncity.GetResourceGrowPerHour(ER.Tiberium, true, true);
                    out.crystal = ncity.GetResourceGrowPerHour(ER.Crystal, true, true);
                    out.power = ncity.GetResourceGrowPerHour(ER.Power, true, true);
                    try { out.credits = ClientLib.Base.Resource.GetResourceGrowPerHour(ncity.get_CityCreditsProduction(), true); } catch (e) {}
                } catch (e) { NS.log.err("base.production failed:", e); }
                return out;
            }
        };

        // map: region-map world<->screen projection, visible-base enumeration, and pan/zoom/mode
        // tracking. Live-sniffed (gridWidth 128 / gridHeight 96 at zoom 1; ScreenPosFromWorldPos +
        // its inverse; PositionChange/ZoomFactorChange/ModeChange net events). Lets any script anchor
        // an on-map overlay to bases without re-deriving the obfuscated projection. First consumer:
        // MM - Player Base Info.
        NS.map = (function () {
            function vm() { return ClientLib.Vis.VisMain.GetInstance(); }
            function rg() { return vm().get_Region(); }
            function gw() { try { return rg().get_GridWidth() || 128; } catch (e) { return 128; } }
            function gh() { try { return rg().get_GridHeight() || 96; } catch (e) { return 96; } }
            var api = {
                // projection usable (region scene + projector present)?
                ready: function () {
                    try { return typeof vm().ScreenPosFromWorldPosX === "function" && !!rg() && typeof rg().GetObjectFromPosition === "function"; }
                    catch (e) { return false; }
                },
                // are we in the region/overworld view (vs a base)?
                inRegionView: function () {
                    try {
                        var m = vm().get_Mode();
                        var R = (ClientLib.Vis.EViewMode && ClientLib.Vis.EViewMode.Region);
                        return (R != null) ? (m === R) : (m === 2);
                    } catch (e) { return false; }
                },
                grid: function () { return { w: gw(), h: gh() }; },
                // grid coords -> screen px {x,y}
                worldToScreen: function (gx, gy) {
                    var v = vm();
                    return { x: v.ScreenPosFromWorldPosX(gx * gw()), y: v.ScreenPosFromWorldPosY(gy * gh()) };
                },
                // screen px -> fractional grid coords {x,y}
                screenToWorld: function (sx, sy) {
                    var v = vm();
                    return { x: v.WorldPosFromScreenPosX(sx) / gw(), y: v.WorldPosFromScreenPosY(sy) / gh() };
                },
                // fractional grid coord currently at the CENTRE of the view {x,y}. ("Where am I
                // looking?" - the value the retired compass scripts derived by hand from region
                // pos/zoom/grid.) Uses the game canvas size, like visibleBounds().
                viewCenter: function () {
                    var cv = document.querySelector("canvas");
                    var r = cv ? cv.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
                    return api.screenToWorld(r.width / 2, r.height / 2);
                },
                // The VIS region object at grid (gx,gy) - the RENDERED object, which (unlike the
                // lightweight data world object from get_World().GetObjectFromPosition) exposes
                // synchronous owner/alliance getters: get_AllianceId(), get_AllianceName(),
                // IsOwnBase(), get_PlayerId()/get_PlayerName(), get_RawX()/get_RawY(),
                // get_VisObjectType(). This is what the game itself colours base outlines from, so it
                // lets a script classify relationship LIVE (no detail-load survey). Returns null if
                // nothing is there / not in region view. (region.GetObjectFromPosition wants PIXEL
                // coords = grid * gridWidth/Height.)
                visObjectAt: function (gx, gy) {
                    try { return rg().GetObjectFromPosition(gx * gw(), gy * gh()); }
                    catch (e) { return null; }
                },
                // visible grid rect (padded 1 tile). Defaults to the game canvas size.
                visibleBounds: function (w, h) {
                    var v = vm();
                    if (w == null || h == null) {
                        var cv = document.querySelector("canvas");
                        var r = cv ? cv.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
                        w = r.width; h = r.height;
                    }
                    return {
                        gx0: Math.floor(v.WorldPosFromScreenPosX(0) / gw()) - 1,
                        gx1: Math.ceil(v.WorldPosFromScreenPosX(w) / gw()) + 1,
                        gy0: Math.floor(v.WorldPosFromScreenPosY(0) / gh()) - 1,
                        gy1: Math.ceil(v.WorldPosFromScreenPosY(h) / gh()) + 1
                    };
                },
                // enumerate bases currently in view. opts: { types ([1]=player; 2=NPC base; 3=camp),
                // max (120) }. Returns [{ id, x, y, type, baseLevel }].
                visibleBases: function (opts) {
                    opts = opts || {};
                    var types = opts.types || [1];
                    var max = opts.max || 120;
                    var out = [];
                    try {
                        var w = ClientLib.Data.MainData.GetInstance().get_World();
                        var b = api.visibleBounds();
                        var seen = {};
                        for (var y = b.gy0; y <= b.gy1; y++) {
                            for (var x = b.gx0; x <= b.gx1; x++) {
                                var o;
                                try { o = w.GetObjectFromPosition(x, y); } catch (e) { o = null; }
                                if (!o || types.indexOf(o.Type) === -1 || typeof o.getID !== "function") continue;
                                var id = o.getID();
                                if (seen[id]) continue;
                                seen[id] = true;
                                out.push({ id: id, x: x, y: y, type: o.Type, baseLevel: (typeof o.get_BaseLevel === "function") ? o.get_BaseLevel() : 0 });
                                if (out.length >= max) return out;
                            }
                        }
                    } catch (e) { NS.log.err("map.visibleBases failed:", e); }
                    return out;
                },
                // attach pan/zoom/mode handlers. opts: { onMove, onZoom, onMode }. Returns a detach fn.
                // CRITICAL: these events fire DURING the game's own render/layout (e.g. _onMapAreaResize
                // -> renderLayout). Running consumer code synchronously inside that dispatch - or letting
                // it throw - corrupts the game's render (black map). So every handler is (a) given a real
                // context object (the net layer mishandles a null context) and (b) wrapped to defer to a
                // fresh task via setTimeout(0) AND swallow errors, so it can never re-enter or throw into
                // the game's dispatch. The ~0ms defer is invisible for pan tracking.
                track: function (opts) {
                    opts = opts || {};
                    var r = rg(), v = vm(), bound = [];
                    var ctx = { __mmMapTrack: true };
                    function wrap(fn) {
                        return function () {
                            window.setTimeout(function () { try { fn(); } catch (e) { NS.log.err("map.track handler:", e); } }, 0);
                        };
                    }
                    function on(obj, name, evt, fn) {
                        if (!fn || !evt) return;
                        var w = wrap(fn);
                        try { NS.net.attach(obj, name, evt, ctx, w); bound.push([obj, name, evt, w]); }
                        catch (e) { NS.log.err("map.track attach " + name + ":", e); }
                    }
                    on(r, "PositionChange", ClientLib.Vis.PositionChange, opts.onMove);
                    on(r, "ZoomFactorChange", ClientLib.Vis.ZoomFactorChange, opts.onZoom);
                    on(v, "ModeChange", ClientLib.Vis.ModeChange, opts.onMode);
                    return function detach() {
                        for (var i = 0; i < bound.length; i++) {
                            try { NS.net.detach(bound[i][0], bound[i][1], bound[i][2], ctx, bound[i][3]); } catch (e) {}
                        }
                        bound = [];
                    };
                },
                // SAFE pan/zoom/mode watcher: POLLS the camera (position/zoom/mode) on an interval
                // instead of hooking the game's net events. It never touches the game's event dispatch,
                // so it cannot interfere with the game's render/layout (unlike track(), which hooks events
                // that fire mid-render - kept for lightweight DOM-only consumers, but prefer watch() for
                // anything that does real work). opts: { onChange(state), interval (default 200ms) } where
                // state = { posX, posY, zoom, mode, region:bool }. Fires onChange once immediately, then
                // whenever any of those change. Returns a stop() fn.
                watch: function (opts) {
                    opts = opts || {};
                    var interval = opts.interval || 200, cb = opts.onChange, last = null, timer = null;
                    function snap() {
                        try { var v = vm(); return { x: v.get_PositionX(), y: v.get_PositionY(), z: v.get_ZoomFactor(), m: v.get_Mode() }; }
                        catch (e) { return null; }
                    }
                    function tick() {
                        try {
                            var s = snap();
                            if (s && (!last || s.x !== last.x || s.y !== last.y || s.z !== last.z || s.m !== last.m)) {
                                last = s;
                                if (cb) { try { cb({ posX: s.x, posY: s.y, zoom: s.z, mode: s.m, region: api.inRegionView() }); } catch (e) { NS.log.err("map.watch cb:", e); } }
                            }
                        } catch (e) {}
                    }
                    timer = window.setInterval(tick, interval);
                    tick();
                    return function stop() { if (timer) { window.clearInterval(timer); timer = null; } };
                },
                // The region object the user currently has SELECTED (clicked), or null. Same vis-object
                // family as visObjectAt - exposes get_VisObjectType()/get_Id()/IsOwnBase()/get_AllianceId()/
                // get_PlayerName() etc. (first consumer: MM - Loot Summary).
                selectedObject: function () {
                    try { return vm().get_SelectedObject() || null; } catch (e) { return null; }
                },
                // Fire cb(selectedObjectOrNull) whenever the region selection changes (clicking a base/camp/
                // POI, or clicking empty map to deselect), and cb(null) when leaving region view. Deferred to
                // a fresh task + error-swallowed like track(), and given a real context object (the net layer
                // mishandles a null context). Returns a detach fn.
                onSelection: function (cb) {
                    if (!cb) return function () {};
                    var v = vm(), ctx = { __mmSel: true }, bound = [];
                    function fire() { window.setTimeout(function () { try { cb(api.inRegionView() ? api.selectedObject() : null); } catch (e) { NS.log.err("map.onSelection cb:", e); } }, 0); }
                    function on(name, evt) {
                        if (!evt) return;
                        try { NS.net.attach(v, name, evt, ctx, fire); bound.push([name, evt]); }
                        catch (e) { NS.log.err("map.onSelection attach " + name + ":", e); }
                    }
                    on("SelectionChange", ClientLib.Vis.SelectionChange);
                    on("ModeChange", ClientLib.Vis.ModeChange);
                    return function detach() {
                        for (var i = 0; i < bound.length; i++) { try { NS.net.detach(v, bound[i][0], bound[i][1], ctx, fire); } catch (e) {} }
                        bound = [];
                    };
                }
            };
            return api;
        })();

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

                    // frameless: a clean "floating panel" with no title bar / window chrome, dragged by
                    // its whole body (e.g. the Next MCV counter). It's still a real qx.ui.window.Window, so
                    // geometry persistence, on-screen clamping and docking all still apply - we just hide the
                    // captionbar + decorator and drive moves ourselves (qx normally drags via the captionbar,
                    // which we've removed). Caller should keep frameless windows simple (no buttons/inputs),
                    // since a mousedown ANYWHERE in the body starts a drag. The HUD-tray toggle opens/closes
                    // it (there's no X). Uses the same mouse-capture drag idiom as the HUD tray.
                    if (opts.frameless) {
                        try { var cb = win.getChildControl("captionbar"); if (cb) cb.exclude(); } catch (e) {}
                        try { win.setDecorator(null); } catch (e) {}
                        try { win.setContentPadding(opts.contentPadding != null ? opts.contentPadding : 0); } catch (e) {}
                        // The inner "pane" child control still carries the theme's "window" decorator, which
                        // borders the sides + bottom but NOT the top (the top normally meets the captionbar we
                        // removed) - the lop-sided "3-sided border" look. Drop it and paint our own uniform thin
                        // border + radius on the window's content element so all four edges match.
                        try { var fp = win.getChildControl("pane"); if (fp) fp.setDecorator(null); } catch (e) {}
                        function styleFrame() {
                            try {
                                var de = win.getContentElement().getDomElement();
                                if (de) { de.style.border = "1px solid rgba(150,170,190,0.55)"; de.style.borderRadius = "6px"; de.style.boxShadow = "0 2px 10px rgba(0,0,0,0.55)"; de.style.boxSizing = "border-box"; de.style.overflow = "hidden"; }
                            } catch (e) {}
                        }
                        win.addListener("appear", styleFrame);
                        styleFrame();
                        (function () {
                            var fDrag = false, fox = 0, foy = 0;
                            win.addListener("mousedown", function (e) {
                                try { var b = win.getBounds(); if (!b || b.left == null) return; fox = e.getDocumentLeft() - b.left; foy = e.getDocumentTop() - b.top; fDrag = true; win.capture(true); e.stop(); } catch (er) {}
                            });
                            win.addListener("mousemove", function (e) {
                                if (!fDrag) return;
                                try { win.moveTo(Math.max(0, e.getDocumentLeft() - fox), Math.max(0, e.getDocumentTop() - foy)); } catch (er) {}
                            });
                            function fEnd() { if (!fDrag) return; fDrag = false; try { win.releaseCapture(); } catch (er) {} savePos(); }
                            win.addListener("mouseup", fEnd);
                            win.addListener("losecapture", fEnd);
                        })();
                    }

                    var lastSaved = null, pollId = null;
                    // Position model for on-screen clamping: `desired` is where the USER parked the window;
                    // the window is DISPLAYED at clampToView(desired) for the current viewport. So when the
                    // viewport shrinks the window slides in only as far as needed, and when it grows back the
                    // window returns to `desired` (instead of staying jammed where the shrink left it).
                    // We don't use a "is this our move or the user's" flag (qooxdoo fires the move event
                    // asynchronously, so a flag set around moveTo is already cleared by the time it fires).
                    // Instead savePos COMPARES the live position to clampToView(desired): if they match it's
                    // our clamp (leave `desired` alone); if they differ the user dragged it (adopt the new
                    // spot). Position comparison is immune to event timing.
                    var desired = null;
                    function clampToView(pos) {
                        var b = win.getBounds() || {};
                        var root = qx.core.Init.getApplication().getRoot().getBounds();
                        var vw = (root && root.width) || window.innerWidth || 1280;
                        var vh = (root && root.height) || window.innerHeight || 720;
                        var maxLeft = Math.max(0, vw - (b.width || 0)), maxTop = Math.max(0, vh - (b.height || 0));
                        return { left: Math.min(Math.max(0, pos.left), maxLeft), top: Math.min(Math.max(0, pos.top), maxTop) };
                    }

                    // Save current bounds (only when actually changed). Polled while visible so this works
                    // even if this qooxdoo build doesn't fire a "move"/"resize" event on drag. When
                    // persistSize is on we save width+height here too (the dedicated "resize" listener
                    // isn't reliable across qooxdoo builds, but this poll is - same mechanism that makes
                    // position persistence work).
                    function savePos() {
                        try {
                            var b = win.getBounds();
                            if (!b || b.left == null) return;
                            if (!desired) desired = { left: b.left, top: b.top };
                            // Is the live position a USER placement, or just where our on-screen clamp put it?
                            // clampToView(desired) is where WE would have placed it. If the live position
                            // differs, the user dragged it -> adopt the new spot as `desired`. If it matches,
                            // leave `desired` alone, so a temporary clamp (viewport too small) never overwrites
                            // the parked spot and a grow-back restores it.
                            var exp = clampToView(desired);
                            if (Math.abs(b.left - exp.left) > 1 || Math.abs(b.top - exp.top) > 1) {
                                desired = { left: b.left, top: b.top };
                            }
                            var v = desired.left + "," + desired.top + (opts.persistSize ? ("," + b.width + "x" + b.height) : "");
                            if (v === lastSaved) return;
                            lastSaved = v;
                            NS.settings.set(key + ".pos", [desired.left, desired.top]);
                            if (opts.persistSize) {
                                if (b.width) NS.settings.set(key + ".w", b.width);
                                if (b.height) NS.settings.set(key + ".h", b.height);
                            }
                            NS.log.log("window", key, "saved desired", v);
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
                            if (p && p.length === 2) {
                                desired = { left: p[0], top: p[1] };   // remember the parked spot
                                win.moveTo(p[0], p[1]);
                                lastSaved = p[0] + "," + p[1];
                            }
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
                    // Keep the window on-screen as the viewport changes, WITHOUT forgetting where the user
                    // parked it. Display position = `desired` pulled in only as far as needed to fit the
                    // current viewport. So: shrink the viewport and a window parked near the right/bottom
                    // edge slides in just enough to stay fully visible; grow it back and the window returns
                    // to `desired` (its parked spot) instead of staying jammed where the shrink left it -
                    // which is what was blocking the view on restore. savePos tells our clamp moves from real
                    // user drags by comparing positions (see clampToView/savePos). Docking takes precedence.
                    function clampIntoView() {
                        try {
                            if (DOCK_WIRED && dockEnabled()) return;
                            var b = win.getBounds(); if (!b || b.left == null || !b.width) return;
                            if (!desired) desired = { left: b.left, top: b.top };
                            var d = clampToView(desired);
                            if (d.left !== b.left || d.top !== b.top) {
                                win.moveTo(d.left, d.top);
                                NS.log.log("window", key, "clamp display", [d.left, d.top], "desired", [desired.left, desired.top]);
                            }
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
                    // Keep every window usable when the game viewport changes size (e.g. the browser is
                    // restored from maximised, which shrinks the viewport): a docked window re-hugs its
                    // edge; any other window now hanging off an edge is pulled fully back on-screen.
                    try {
                        qx.core.Init.getApplication().getRoot().addListener("resize", function () {
                            if (!win.isVisible()) return;
                            if (DOCK_WIRED && dockEnabled()) reanchorDock();
                            else clampIntoView();
                        });
                    } catch (e) {}
                    if (DOCK_WIRED) {
                        // and when the window's own content grows/shrinks (e.g. a shrink-wrapped list)
                        win.addListener("resize", function () { if (win.isVisible()) reanchorDock(); });
                    }

                    restoreGeometry();
                    win.addListener("appear", function () {
                        restoreGeometry();
                        if (DOCK_WIRED) reanchorDock();
                        // pull on-screen if a saved position is now off-screen (e.g. opened at a smaller
                        // resolution than it was saved at); defer so persistSize width/height have settled.
                        else window.setTimeout(function () { if (win.isVisible()) clampIntoView(); }, 350);
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
                    // save (savePos decides user-drag vs our-clamp by comparing positions) + edge-snap.
                    win.addListener("move", function () { savePos(); scheduleSnap(); });
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

        // -------------------------------------------------------------------
        // menubar: dock a widget INTO the game's right-side base-navigation bar
        // (the vertical strip listing your bases + "reset sort order" / "found
        // base" etc.), styled to match the bar so it reads like a native item.
        // This is the capability behind "lock the MCV / the MM buttons into the
        // game menu" (the look Info Sticker had). The insertion target is the
        // proven path Info Sticker uses: getBaseNavigationBar().getChildren()[0]
        // .getChildren()[0] = the list container that exposes addAt/indexOf/
        // remove/getChildren. We do NOT hook the game's reorder method (fragile
        // regex); instead a light shared timer re-inserts our items if the game
        // rebuilds the bar after a base add/remove/reorder. All guarded - if the
        // bar isn't reachable, dock() is a safe no-op and callers fall back.
        // -------------------------------------------------------------------
        NS.menubar = (function () {
            var items = [];   // { widget, getPos(), enabled() , last }
            var timer = null;

            // The qx list-container inside the base navigation bar (or null if not reachable).
            function getBar() {
                try {
                    var app = qx.core.Init.getApplication();
                    var b = app && app.getBaseNavigationBar && app.getBaseNavigationBar();
                    if (!b || !b.getChildren) return null;
                    var c0 = b.getChildren(); if (!c0 || !c0.length || !c0[0].getChildren) return null;
                    var c1 = c0[0].getChildren(); if (!c1 || !c1.length) return null;
                    var list = c1[0];
                    return (list && typeof list.addAt === "function" && typeof list.indexOf === "function") ? list : null;
                } catch (e) { return null; }
            }
            function available() { return !!getBar(); }

            // A container styled like the game's mission-bar buttons (same texture Info Sticker used).
            function styledPanel(opt) {
                opt = opt || {};
                var c = new qx.ui.container.Composite(new qx.ui.layout.VBox(opt.spacing != null ? opt.spacing : 2)).set({
                    padding: opt.padding || [4, 5, 4, 6],
                    width: opt.width || 124,
                    alignX: "right"
                });
                try {
                    c.setDecorator(new qx.ui.decoration.Decorator().set({
                        backgroundImage: "decoration2/button-missionbar/button-missionbar.png",
                        backgroundRepeat: "scale"
                    }));
                } catch (e) {}
                if (opt.marginLeft != null) { try { c.setMarginLeft(opt.marginLeft); } catch (e) {} }
                return c;
            }

            function clampPos(bar, pos) {
                try {
                    var n = bar.getChildren().length;
                    if (pos == null || pos < 0) pos = n; // default = append (bottom of the bar)
                    return Math.max(0, Math.min(pos, n));
                } catch (e) { return 0; }
            }
            function reinsertAll() {
                var bar = getBar();
                if (!bar) return;
                for (var i = 0; i < items.length; i++) {
                    var it = items[i];
                    try {
                        if (it.widget.isDisposed && it.widget.isDisposed()) continue;
                        var on = it.enabled ? (it.enabled() === true) : true;
                        var cur = bar.indexOf(it.widget);
                        if (!on) { if (cur >= 0) bar.remove(it.widget); continue; }
                        var want = clampPos(bar, it.getPos ? it.getPos() : null);
                        if (cur < 0) bar.addAt(it.widget, want);
                        else if (cur !== want) { bar.remove(it.widget); bar.addAt(it.widget, clampPos(bar, it.getPos ? it.getPos() : null)); }
                    } catch (e) { /* never let one item break the bar */ }
                }
            }
            function ensureTimer() { if (!timer) { try { timer = window.setInterval(reinsertAll, 1500); } catch (e) {} } }

            return {
                available: available,
                styledPanel: styledPanel,
                // Screen rect {left,top,right,bottom,width,height} of the base navigation bar, or null - for
                // anchoring a panel NEXT TO the bar (vs dock() which inserts INTO it).
                barRect: function () {
                    try {
                        var app = qx.core.Init.getApplication();
                        var b = app && app.getBaseNavigationBar && app.getBaseNavigationBar();
                        if (b && b.getContentLocation) { var l = b.getContentLocation(); if (l && (l.left || l.right)) return l; }
                    } catch (e) {}
                    return null;
                },
                // dock(widget, { pos, enabled }) -> { remove(), refresh() }. pos = index (number|fn|null=append);
                // enabled = optional fn; when it returns false the widget is pulled out of the bar (kept for re-add).
                dock: function (widget, o) {
                    o = o || {};
                    var rec = {
                        widget: widget,
                        getPos: (typeof o.pos === "function") ? o.pos : function () { return (o.pos == null ? null : o.pos); },
                        enabled: (typeof o.enabled === "function") ? o.enabled : null
                    };
                    items.push(rec);
                    ensureTimer();
                    reinsertAll();
                    return {
                        remove: function () {
                            try { var bar = getBar(); if (bar && bar.indexOf(widget) >= 0) bar.remove(widget); } catch (e) {}
                            var idx = items.indexOf(rec); if (idx >= 0) items.splice(idx, 1);
                        },
                        refresh: reinsertAll
                    };
                }
            };
        })();

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
            var menuPanel = null, menuDock = null;   // when docked into the game menu bar instead of the float tray
            var pendingMenu = [], placeTries = 0, placeTimer = null;   // buttons waiting for the base bar (menubar mode)
            var DEFAULTS = { bottom: 40, right: 220 }; // initial parking spot, clear of game UI
            var KEY = "HUDTray";

            // Display mode: "float" (the draggable tray, default) or "menubar" (the buttons live inside the
            // game's base-navigation bar via NS.menubar). Read once at register time; changing it needs a reload.
            // IMPORTANT: stored in plain localStorage (a GLOBAL pref), NOT the pid-keyed NS.settings. register()
            // runs right after nav-ready, BEFORE the per-player settings bucket exists (same pid-timing trap as
            // the saved tray position below) - so a pid-keyed read would always return the "float" default on
            // reload and the buttons would never move off the tray. localStorage is available immediately.
            function dockMode() { try { return (window.localStorage.getItem("MM.HUDTray.dock") === "menubar") ? "menubar" : "float"; } catch (e) { return "float"; } }
            // Build (once) a styled panel docked in the game menu bar that the MM buttons stack into.
            // Returns null if the bar isn't reachable, so register() falls back to the float tray.
            function ensureMenuPanel() {
                if (menuPanel) return menuPanel;
                try {
                    if (!NS.menubar || !NS.menubar.available()) return null;
                    menuPanel = NS.menubar.styledPanel({ width: 124, spacing: 3, marginLeft: 5 });
                    menuPanel.add(new qx.ui.basic.Label("MM Tools").set({ font: "bold", textColor: "#595969", textAlign: "center", alignX: "center" }));
                    menuDock = NS.menubar.dock(menuPanel, { pos: null, enabled: function () { return showPref() && dockMode() === "menubar"; } });
                } catch (e) { NS.log.err("menubar panel:", e); menuPanel = null; }
                return menuPanel;
            }
            // Place queued menubar buttons once the base bar is reachable. register() runs at nav-ready, which
            // can be slightly BEFORE getBaseNavigationBar() is populated - so rather than fall straight back to
            // the float tray (which stranded the buttons there), we queue and retry for ~30s, then fall back.
            function flushMenuButtons() {
                placeTimer = null;
                if (!pendingMenu.length) return;
                var mp = ensureMenuPanel();
                if (mp) {
                    for (var i = 0; i < pendingMenu.length; i++) { try { mp.add(pendingMenu[i]); } catch (e) {} }
                    pendingMenu = [];
                    return;
                }
                if (++placeTries <= 30) { placeTimer = window.setTimeout(flushMenuButtons, 1000); return; }
                var t = ensureTray();   // bar never showed up - don't lose the buttons
                if (t) { for (var j = 0; j < pendingMenu.length; j++) { try { t.add(pendingMenu[j]); } catch (e) {} } }
                pendingMenu = [];
            }
            function scheduleFlush() { if (!placeTimer) placeTimer = window.setTimeout(flushMenuButtons, 0); }

            // Move every registered button into `container` (re-parenting from wherever it currently lives).
            function moveButtonsTo(container) {
                for (var i = 0; i < slots.length; i++) {
                    var b = slots[i].btn;
                    try {
                        var p = b.getLayoutParent && b.getLayoutParent();
                        if (p === container) continue;
                        if (p && p.remove) p.remove(b);
                        container.add(b);
                    } catch (e) {}
                }
            }
            // Apply the current dock mode LIVE (no reload): re-parent the buttons between the float tray and the
            // in-bar "MM Tools" panel, and add/remove that panel from the bar.
            function applyDockMode() {
                try {
                    if (dockMode() === "menubar") {
                        var mp = ensureMenuPanel();
                        if (mp) {
                            pendingMenu = [];               // anything queued is about to be placed directly
                            moveButtonsTo(mp);
                            if (menuDock) menuDock.refresh(); // enabled()=true now -> panel inserted into the bar
                        } else {                            // bar not ready yet - queue for placement
                            for (var i = 0; i < slots.length; i++) {
                                var b = slots[i].btn;
                                try { var p = b.getLayoutParent && b.getLayoutParent(); if (p && p.remove) p.remove(b); } catch (e) {}
                                pendingMenu.push(b);
                            }
                            scheduleFlush();
                        }
                    } else {
                        var t = ensureTray();
                        if (t) moveButtonsTo(t);
                        if (menuDock) menuDock.refresh();   // enabled()=false now -> panel pulled out of the bar
                    }
                    applyVisible(showPref());
                } catch (e) { NS.log.err("applyDockMode:", e); }
            }

            // Optional display: the HUD tray can be hidden (the CnC Pack menu provides the same
            // window-openers). The intent is persisted per player+world; default = shown so existing
            // installs are unchanged. The "Show Toolbar Buttons" item in the CnC Pack menu flips it.
            function showPref() {
                try { return NS.settings.get(KEY + ".show", true) !== false; } catch (e) { return true; }
            }
            function applyVisible(v) {
                var menubar = (dockMode() === "menubar");
                // in menubar mode the float tray is always hidden (it's empty - buttons live in the bar)
                try { if (tray) { if (v && !menubar) tray.show(); else tray.exclude(); } } catch (e) {}
                try { if (menuPanel) { if (v) menuPanel.show(); else menuPanel.exclude(); } } catch (e) {}
                try { if (menuDock) menuDock.refresh(); } catch (e) {}
            }

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
                    applyVisible(showPref()); // honor the hidden/shown intent (re-checked once the player id loads)

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
                            applyVisible(showPref()); // re-apply from the correct per-player bucket
                        } catch (_) {}
                    }, 300);

                    return tray;
                } catch (e) {
                    NS.log.err("HUDTray creation failed:", e);
                    return null;
                }
            }

            // Mirror a registered button into the CnC Pack menu's "Open Window" submenu, so a tool's
            // window can be opened from the top menu even when the tray is hidden. Safe if NS.menu
            // isn't ready yet (it polls/rebuilds from its own side).
            function feedMenu(opts) {
                try {
                    if (opts && opts.onExecute && NS.menu && NS.menu.registerWindow) {
                        NS.menu.registerWindow({ id: opts.id, label: opts.label, icon: opts.icon, run: opts.onExecute });
                    }
                } catch (e) {}
            }

            return {
                register: function (opts) {
                    opts = opts || {};
                    try {
                        // de-dupe: if a script registers twice (e.g. on reload), return the existing button
                        if (opts.id) {
                            for (var i = 0; i < slots.length; i++) {
                                if (slots[i].id === opts.id) { feedMenu(opts); return slots[i].btn; }
                            }
                        }
                        // text-only: not every tool ships an icon, so show none for a consistent bar
                        var btn = new qx.ui.form.Button(opts.label || "").set({
                            toolTipText: opts.tooltip || opts.label || "",
                            alignY: "middle",
                            appearance: "button-text-small"
                        });
                        if (opts.onExecute) btn.addListener("execute", opts.onExecute);
                        // menubar mode: queue into the in-game panel (placed once the base bar is ready, with a
                        // ~30s fallback to the float tray so buttons are never lost). float mode: the tray.
                        if (dockMode() === "menubar") {
                            pendingMenu.push(btn);
                            scheduleFlush();
                        } else {
                            var t = ensureTray();
                            if (!t) return null;
                            t.add(btn);
                        }
                        slots.push({ id: opts.id, label: opts.label, btn: btn });
                        feedMenu(opts);
                        return btn;
                    } catch (e) {
                        NS.log.err("buttons.register failed:", e);
                        return null;
                    }
                },
                // Display mode for the MM buttons: "float" (draggable tray) or "menubar" (in the game's base
                // navigation bar). Changing it takes effect on the next game reload.
                dockMode: function () { return dockMode(); },
                setDockMode: function (m) {
                    try { window.localStorage.setItem("MM.HUDTray.dock", (m === "menubar") ? "menubar" : "float"); } catch (e) {}
                    try { applyDockMode(); } catch (e) {}   // live - no reload needed
                    return dockMode();
                },
                // Optional-display control (used by the CnC Pack menu's "Show Toolbar Buttons" toggle).
                isVisible: function () { return showPref(); },
                setVisible: function (v) {
                    v = (v !== false);
                    try { NS.settings.set(KEY + ".show", v); } catch (e) {}
                    applyVisible(v);
                    return v;
                },
                // Show/hide a single registered button by its label (used by the CnC Pack menu to instantly
                // add/remove a script's button when you enable/disable that script). No-op if no match.
                setButtonEnabled: function (label, on) {
                    try {
                        for (var i = 0; i < slots.length; i++) {
                            if (slots[i].label === label && slots[i].btn) {
                                if (on === false) slots[i].btn.exclude(); else slots[i].btn.show();
                            }
                        }
                    } catch (e) {}
                }
            };
        })();

        // -------------------------------------------------------------------
        // lifecycle: let a RUNNING script react when it's enabled/disabled from
        // the CnC Pack menu (or the options page) WITHOUT a game refresh. The
        // menu writes CNCTA_ENABLED via the content.js bridge, which re-broadcasts
        // the full {kind:"state"} map; we listen to that same broadcast and fire a
        // per-script onDisable/onEnable when its bit flips. A script registers with
        // its registry id and a teardown/resume pair - e.g. Off/Def Bubbles stops
        // its survey + clears its overlay on disable instead of churning on until a
        // refresh. (Enabling a script that was OFF at PAGE LOAD still needs a
        // refresh - it was never injected - but toggling within a session is live.)
        // -------------------------------------------------------------------
        NS.lifecycle = (function () {
            var MARK = "__cncpack";
            var enabled = {};   // id -> last-known bool
            var subs = [];      // { id, onEnable, onDisable }

            function post(msg) { try { msg[MARK] = 1; window.postMessage(msg, "*"); } catch (e) {} }
            function onMsg(ev) {
                try {
                    if (ev.source !== window) return;
                    var d = ev.data;
                    if (!d || d[MARK] !== 1 || d.kind !== "state") return;
                    var em = d.enabled || {};
                    for (var i = 0; i < subs.length; i++) {
                        var s = subs[i];
                        var now = em[s.id] === true;
                        var was = enabled[s.id];
                        enabled[s.id] = now;
                        if (was === undefined) continue;          // first read = baseline, don't fire
                        if (now === was) continue;
                        try {
                            if (now) { if (s.onEnable) s.onEnable(); }
                            else { if (s.onDisable) s.onDisable(); }
                        } catch (e) { NS.log.err("lifecycle cb (id " + s.id + "):", e); }
                    }
                } catch (e) {}
            }
            try { window.addEventListener("message", onMsg); } catch (e) {}

            return {
                // watch(id, { onEnable, onDisable }) - callbacks fire on a real transition only.
                watch: function (id, opts) {
                    if (!id || !opts) return;
                    subs.push({ id: id, onEnable: opts.onEnable, onDisable: opts.onDisable });
                    post({ req: "get" });   // ensure a state broadcast arrives to baseline this id
                },
                // current known state (undefined until the first broadcast lands)
                isEnabled: function (id) { return enabled[id]; }
            };
        })();

        // -------------------------------------------------------------------
        // menu: the in-game "CnC Pack" top menu - one control center for the
        // reworked MM scripts. It RENAMES the game's native "Scripts" top-bar
        // button to "CnC Pack" and fills it with:
        //   * the MM scripts grouped exactly like the options page (SIMULATOR /
        //     GET INFO HELPER / TOOL AND TOOL-PACK / GUI ENHANCER), each a
        //     Windows-style checkbox = enabled-state. Clicking toggles enable/
        //     disable and the menu STAYS OPEN (multi-toggle) - we override the
        //     menu item's _onTap so it doesn't hideAll() like a normal item.
        //   * an "Open Window" submenu listing every tool that registered a HUD
        //     button (so windows open from the menu even when the tray is hidden).
        //   * a "Show Toolbar Buttons" toggle (the HUD tray is now optional).
        // The enabled-state is the extension's CNCTA_ENABLED map, mirrored to the
        // options page. The page can't read chrome.storage, so this talks to the
        // bridge in content.js via window.postMessage. The Framework Wrapper and
        // Common Library are intentionally NOT listed (always on, not toggleable).
        // -------------------------------------------------------------------
        NS.menu = (function () {
            var MARK = "__cncpack";
            var state = { scripts: [], enabled: {}, ready: false };
            var openers = [];          // {id,label,icon,run} window-openers (fed by buttons.register / registerWindow)
            var itemsById = {};        // script id -> its CheckBox (for in-place value refresh)
            var built = false, packBtn = null, openSubBtn = null, ensureTimer = null;

            // category key -> options-page header, in options-page order. Wrapper category excluded.
            var CATS = [
                ["simulator", "SIMULATOR"],
                ["infotool", "GET INFO HELPER"],
                ["tool", "TOOL AND TOOL-PACK"],
                ["gui", "GUI ENHANCER"]
            ];
            var LOCKED = { 10001: true, 10200: true }; // wrapper + common library: never listed/toggled

            function cleanName(name) { return String(name || "").replace(/^MM\s*-\s*/, ""); }
            function isPackScript(s) {
                if (!s || LOCKED[s.id]) return false;
                if (s.cat === "wrapper") return false;
                return /^MM\s*-/.test(s.name || "");
            }

            // --- bridge to content.js -----------------------------------------------------------
            function post(msg) { try { msg[MARK] = 1; window.postMessage(msg, "*"); } catch (e) {} }
            function requestState() { post({ req: "get" }); }
            function setEnabled(id, on) {
                if (LOCKED[id]) return;
                state.enabled[id] = on;            // optimistic; content.js echoes the authoritative state back
                post({ req: "set", id: id, enabled: on });
            }
            function onMsg(ev) {
                try {
                    if (ev.source !== window) return;
                    var d = ev.data;
                    if (!d || d[MARK] !== 1 || d.kind !== "state") return;
                    state.scripts = d.scripts || [];
                    state.enabled = d.enabled || {};
                    state.ready = true;
                    onStateUpdated();
                } catch (e) {}
            }

            // --- the menu -----------------------------------------------------------------------
            function packButton() {
                try {
                    var app = qx.core.Init.getApplication();
                    var mb = app.getMenuBar ? app.getMenuBar() : null;
                    var sb = (mb && mb.getScriptsButton) ? mb.getScriptsButton() : null;
                    if (!sb) {
                        var item = app.getUIItem(ClientLib.Data.Missions.PATH.BAR_MENU);
                        sb = (item && item.getScriptsButton) ? item.getScriptsButton() : null;
                    }
                    return sb || null;
                } catch (e) { return null; }
            }

            // A qx.ui.menu.CheckBox whose tap toggles the value but does NOT close the menu, so several
            // entries can be flipped in one visit. The close-on-tap lives in AbstractButton._onTap (it
            // calls execute() then defers Manager.hideAll()). That tap listener is bound to the PROTOTYPE
            // method at construction, so overriding _onTap on an instance is ignored by real taps - it must
            // be overridden on a subclass prototype. Here _onTap calls execute() (which toggles the value +
            // fires "execute") and intentionally skips hideAll().
            function checkBoxClass() {
                try {
                    if (!qx.Class.isDefined("mm.MenuCheckBox")) {
                        qx.Class.define("mm.MenuCheckBox", {
                            extend: qx.ui.menu.CheckBox,
                            members: {
                                _onTap: function (e) {
                                    try { if (e && e.isLeftPressed && !e.isLeftPressed()) return; } catch (_) {}
                                    this.execute(); // toggles value + fires "execute"; deliberately no Manager.hideAll()
                                }
                            }
                        });
                    }
                    return qx.Class.getByName("mm.MenuCheckBox") || qx.ui.menu.CheckBox;
                } catch (e) { NS.log.err("MenuCheckBox define:", e); return qx.ui.menu.CheckBox; }
            }

            // Build a keep-open checkbox item. onToggle(newValue) runs ONLY on a real user tap (via the
            // "execute" event), NOT on programmatic setValue - so refreshValues() can sync the displayed
            // values without re-persisting (avoids a feedback loop).
            function makeToggle(label, initial, onToggle, tooltip) {
                var Cls = checkBoxClass();
                var cb = new Cls(label);
                try { cb.setValue(initial === true); } catch (e) {}
                if (tooltip) { try { cb.setToolTipText(tooltip); } catch (e) {} }
                cb.addListener("execute", function () { try { onToggle(cb.getValue()); } catch (err) { NS.log.err("toggle:", err); } });
                return cb;
            }

            function makeCheckItem(s) {
                return makeToggle(cleanName(s.name), state.enabled[s.id] === true,
                    function (v) { setEnabled(s.id, v); },
                    "Enable/disable " + (s.name || "") + " (takes effect on next game refresh)");
            }

            function buildOpenSubmenu() {
                var m = new qx.ui.menu.Menu();
                var any = false;
                for (var i = 0; i < openers.length; i++) {
                    (function (op) {
                        if (!op || !op.run) return;
                        if (op.id && state.enabled[op.id] === false) return; // only enabled tools
                        any = true;
                        // no icons: we don't have one for every tool, so show none (consistency)
                        var b = new qx.ui.menu.Button(op.label || "Open");
                        b.addListener("execute", function () { try { op.run(); } catch (e) { NS.log.err("opener:", e); } });
                        m.add(b);
                    })(openers[i]);
                }
                if (!any) {
                    var none = new qx.ui.menu.Button("(enable a tool first)");
                    try { none.setEnabled(false); } catch (e) {}
                    m.add(none);
                }
                return m;
            }

            function build() {
                var sb = packButton();
                if (!sb || !state.ready) return false;
                try {
                    packBtn = sb;
                    sb.setLabel("CnC Pack");
                    // The native Scripts button ships hidden AND, when revealed via its .Add() method,
                    // re-tiles the bar so the previous end button (Ranking) becomes a middle tile and the
                    // Scripts button becomes the right end-cap. We populate it with setMenu() instead of
                    // .Add(), so we call the same native integrator (__Hi) to both reveal it and fix the
                    // tiling - a plain show() leaves it as a detached extra tile with a seam after Ranking.
                    // __Hi is obfuscated; if a game update renames it, fall back to show() (menu still works,
                    // just with the cosmetic seam).
                    var revealed = false;
                    try { if (typeof sb.__Hi === "function") { sb.__Hi(); revealed = true; } } catch (e) {}
                    if (!revealed) { try { sb.show(); } catch (e) {} }
                    var menu = new qx.ui.menu.Menu();
                    itemsById = {};
                    for (var c = 0; c < CATS.length; c++) {
                        var cat = CATS[c][0], title = CATS[c][1];
                        var items = state.scripts.filter(function (s) { return isPackScript(s) && (s.cat || "") === cat; });
                        if (!items.length) continue;
                        items.sort(function (a, b) { return cleanName(a.name).localeCompare(cleanName(b.name)); });
                        // each grouping is its own submenu; its scripts (checkboxes) nest inside it
                        var sub = new qx.ui.menu.Menu();
                        for (var i = 0; i < items.length; i++) {
                            var cb = makeCheckItem(items[i]);
                            itemsById[items[i].id] = cb;
                            sub.add(cb);
                        }
                        var groupBtn = new qx.ui.menu.Button(title);
                        groupBtn.setMenu(sub);
                        menu.add(groupBtn);
                    }
                    menu.addSeparator();
                    openSubBtn = new qx.ui.menu.Button("Open Window");
                    openSubBtn.setMenu(buildOpenSubmenu());
                    menu.add(openSubBtn);
                    menu.addSeparator();
                    var trayCb = makeToggle("Show Toolbar Buttons", NS.buttons.isVisible(),
                        function (v) { NS.buttons.setVisible(v); },
                        "Show or hide the MM button bar");
                    menu.add(trayCb);
                    // Dock the MM buttons inside the game's base menu bar instead of the floating tray.
                    // Changing it needs a game reload (buttons are placed at register time), so we note that.
                    try {
                        var dockCb = makeToggle("Dock buttons in game menu",
                            (NS.buttons.dockMode && NS.buttons.dockMode() === "menubar"),
                            function (v) { try { NS.buttons.setDockMode(v ? "menubar" : "float"); } catch (e) {} },
                            "Put the MM buttons inside the game's base-navigation bar (applies immediately)");
                        menu.add(dockCb);
                    } catch (e) { NS.log.err("dock toggle:", e); }
                    sb.setMenu(menu);
                    built = true;
                    NS.log.log("CnC Pack menu built");
                    return true;
                } catch (e) { NS.log.err("menu.build:", e); return false; }
            }

            // Update item values + the Open submenu in place, WITHOUT rebuilding the menu (a rebuild would
            // collapse the menu mid-use). Falls back to build() if we haven't built yet.
            // Instantly add/remove each script's HUD/menu button to match its enabled state (so toggling a
            // script in the CnC Pack menu adds/removes its button right away, not on reload). Matches a button
            // to a script by its label == the short (MM-stripped) script name.
            function syncButtonsEnabled() {
                try {
                    if (!NS.buttons || !NS.buttons.setButtonEnabled || !state.scripts) return;
                    for (var i = 0; i < state.scripts.length; i++) {
                        var s = state.scripts[i];
                        if (!isPackScript(s)) continue;
                        NS.buttons.setButtonEnabled(cleanName(s.name), state.enabled[s.id] !== false);
                    }
                } catch (e) {}
            }
            function onStateUpdated() {
                syncButtonsEnabled();
                if (!built) { if (!build()) scheduleEnsure(); return; }
                try {
                    for (var id in itemsById) { try { itemsById[id].setValue(state.enabled[id] === true); } catch (e) {} }
                    if (openSubBtn) openSubBtn.setMenu(buildOpenSubmenu());
                } catch (e) { NS.log.err("menu.refresh:", e); }
            }

            function scheduleEnsure() {
                try { if (ensureTimer) window.clearTimeout(ensureTimer); } catch (e) {}
                ensureTimer = window.setTimeout(function () { if (!built) { if (!build()) scheduleEnsure(); } }, 400);
            }

            function init() {
                try { window.addEventListener("message", onMsg); } catch (e) {}
                // wait for the game menu bar, then ask the bridge for state and build
                var tries = 0, id = window.setInterval(function () {
                    if (packButton()) { window.clearInterval(id); requestState(); }
                    else if (++tries > 160) window.clearInterval(id);
                }, 250);
                window.setTimeout(requestState, 1500); // belt-and-braces re-request
            }

            return {
                init: init,
                refresh: requestState,
                packButton: packButton,
                // A loaded script can register a window-opener directly (e.g. the battle sim, which has no
                // HUD tray button). buttons.register() also calls this automatically.
                registerWindow: function (opts) {
                    opts = opts || {};
                    if (!opts.run) return;
                    for (var i = 0; i < openers.length; i++) {
                        if (openers[i].id && openers[i].id === opts.id) { openers[i] = opts; if (built && openSubBtn) try { openSubBtn.setMenu(buildOpenSubmenu()); } catch (e) {} return; }
                    }
                    openers.push(opts);
                    if (built && openSubBtn) { try { openSubBtn.setMenu(buildOpenSubmenu()); } catch (e) {} }
                }
            };
        })();

        window.MMCommon = NS;
        window.MMCommon_IsInstalled = true;
        try { NS.menu.init(); } catch (e) { NS.log.err("menu.init:", e); }
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
