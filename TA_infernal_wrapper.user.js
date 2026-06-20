// ==UserScript==
// @name            MM - Framework Wrapper
// @description     Foundation library for the CnCTA MikeyMike pack: runs inside the game's page context and re-exposes the game's minified/obfuscated internals as stable, human-readable API names that every other script depends on. Also applies a few global game/browser fixes.
// @author          NetquiK (original code from infernal_me, KRS_L, krisan) - https://github.com/netquik
// @contributor     MikeyMike (CnCTA-MikeyMike-SCRIPT-PACK)
// @version         1.1.0
// @match           https://*.alliances.commandandconquer.com/*/index.aspx*
// @downloadURL     https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/TA_infernal_wrapper.user.js
// @updateURL       https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/TA_infernal_wrapper.user.js
// ==/UserScript==

/*
================================================================================
 MM - Framework Wrapper   (formerly "infernal wrapper")  -  what it is & why it's needed
================================================================================
 This is the FOUNDATION LIBRARY of the script pack. Almost every other TA
 script in the pack calls the API it exposes, so it must be enabled and load
 first - on its own it adds no visible UI.

 THE PROBLEM IT SOLVES
 Command & Conquer: Tiberium Alliances is a Qooxdoo web app whose JavaScript
 ships minified and obfuscated: classes, methods and member fields are renamed
 to short, meaningless tokens (e.g. the offense-unit list lives on a random
 6-letter property), and those tokens change with almost every game patch.
 Scripts therefore cannot reliably call the game's internals by name.

 WHAT IT DOES
 It injects itself as a <script> into the page <head> so it runs INSIDE the
 game's own JavaScript context (not the isolated userscript sandbox). There it
 can see the live framework objects: qx, webfrontend, ClientLib and the $I
 module registry. It polls every 50ms until qx and webfrontend exist, then:

   - Reads the SOURCE TEXT of a few known game functions and uses regex to
     discover their current obfuscated names, then re-attaches stable,
     human-readable wrappers the rest of the pack can rely on across patches:
        * SharedLib.Combat.CbtSimulation.prototype.DoStep    (battle stepping)
        * ClientLib.Vis.Battleground...get_Simulation()        (battle sim object)
        * ClientLib.Data.CityUnits...get_OffenseUnits()        (army unit lists)
        * ClientLib.Data.CityUnits...get_DefenseUnits()
        * Battleground...GetNerfAndBoostModifier()             (restored if absent)
        * WorldObjectCity/NPCBase/NPCCamp.get_BaseLevel()/getID()/get_CampType()
                                                               (for map/base scanners)
   - Aliases System and SharedLib to the $I module registry.
   - Sets the global flag CCTAWrapper_IsInstalled = true so dependent scripts
     can confirm the wrapper is present.

 GLOBAL FIXES it also applies:
   - phefix():   re-globalizes webfrontend.phe to window.phe (moved by a patch).
   - operafix(): makes Chromium-based Opera report as Chrome so the game stops
                 showing its "unsupported browser" warning.
   - blankfix(): restores the missing blank.gif placeholder reset on images
                 (webkit), preventing broken image-reset behaviour.

 Because it re-derives the obfuscated names at runtime, the wrapper is what
 keeps the rest of the pack working after game updates - which is exactly why
 the other scripts require it.

 Credit: original code by infernal_me, KRS_L and krisan; maintained by NetquiK
 (https://github.com/netquik). Part of the CnCTA-MikeyMike-SCRIPT-PACK.
================================================================================
*/

(function () {
    var CCTAWrapper_main = function () {
        var iterations = 1;

        // -------------------------------------------------------------------
        // Logging / debug strategy
        // -------------------------------------------------------------------
        // All wrapper output is prefixed so it's easy to filter in the console.
        // Verbose "info" logging is OFF by default to keep the console clean;
        // warnings and errors always show. Turn the verbose stream on at any
        // time from the game console with:  window.CCTAWrapper_DEBUG = true
        var LOG_PREFIX = '[MM Framework Wrapper]';
        // Verbose logging is off by default. Persist the toggle in localStorage so it survives a page
        // reload (needed to capture STARTUP logs). Enable from the game console with:
        //   localStorage.CCTAWrapper_DEBUG = '1'   (then reload)   /   localStorage.removeItem('CCTAWrapper_DEBUG')
        if (typeof window.CCTAWrapper_DEBUG === 'undefined') {
            try { window.CCTAWrapper_DEBUG = (window.localStorage.getItem('CCTAWrapper_DEBUG') === '1'); } catch (e) { window.CCTAWrapper_DEBUG = false; }
        }

        function wlog() {
            if (!window.CCTAWrapper_DEBUG) return;
            try { console.log.apply(console, [LOG_PREFIX].concat([].slice.call(arguments))); } catch (e) {}
        }
        function wwarn() {
            try { console.warn.apply(console, [LOG_PREFIX].concat([].slice.call(arguments))); } catch (e) {}
        }
        function werr() {
            try { console.error.apply(console, [LOG_PREFIX].concat([].slice.call(arguments))); } catch (e) {}
        }

        // Legacy global logger kept for any dependent script that calls _log().
        _log = function () {
            if (typeof console != 'undefined') {
                try { console.log.apply(console, arguments); } catch (e) {}
            } else if (window.opera) {
                opera.postError(arguments);
            } else if (typeof GM_log != 'undefined') {
                GM_log(arguments);
            }
        };

        function operafix() {
            // MOD OPERA BROWSER SUPPORT + FIX
            if (qx.core.Environment.get('browser.name') == 'opera' && parseFloat(qx.core.Environment.get("browser.version")) > 15) {
                qx.core.Environment.__d['browser.name'] = "chrome";
                var nags = qx.core.Init.getApplication().getRoot().getChildren();
                for (var b in nags) {
                    if (nags[b] instanceof webfrontend.gui.BadBrowserWindow && nags[b].isVisible()) {
                        nags[b].close();
                        qx.core.Init.getApplication().checkWarningScreen();
                        break;
                    }
                }
                wlog('Opera now reported as Chrome (browser-support fix applied)');
            }
        }

        function blankfix() {
            // MOD BLANK GIF FIX
            qx.html.Image.prototype.resetSource = function () {
                if ((qx.core.Environment.get("engine.name") == "webkit")) {
                    this._setProperty("source", "webfrontend/ui/common/blank.gif");
                } else {
                    this._removeProperty("source", true);
                }
                return this;
            };
            wlog('blank.gif image reset restored');
        }

        function phefix() {
            // MOD FIX GLOBAL PHE for 22.3 PATCH
            if (typeof webfrontend.phe != 'undefined') {
                window.phe = webfrontend.phe;
                wlog('PHE globalized (window.phe)');
            } else if (typeof phe != 'undefined') {
                wlog('PHE already global');
            } else {
                wwarn('PHE not defined - dependent scripts may error');
            }
        }

        function createCCTAWrapper() {
            wlog('framework ready after ' + iterations + ' poll iteration(s)');
            // Cosmetic only - guarded so a missing/renamed global can never abort setup.
            if (typeof PerforceChangelist !== 'undefined') wlog('game changelist ' + PerforceChangelist);

            System = $I;
            SharedLib = $I;

            var ok = true;

            // --- Battle simulation hooks (derived from StartBattle source) ---
            // SharedLib.Combat.CbtSimulation.prototype.DoStep + get_Simulation
            try {
                var StartBattle_Source = ClientLib.Vis.Battleground.Battleground.prototype.StartBattle.toString();
                var subM = StartBattle_Source.match(/this\.([a-zA-Z]+)=\(new \$I\.([a-zA-Z]+)\)\..+{this\.\1\.([a-zA-Z]+)\((false|!1\))/);
                if (!subM) throw new Error('StartBattle pattern did not match (game framework may have changed)');

                $I[subM[2]].prototype.DoStep = $I[subM[2]].prototype[subM[3]];
                ClientLib.Vis.Battleground.Battleground.prototype.get_Simulation = function () {
                    return this[subM[1]];
                };
                wlog('DoStep = $I.' + subM[2] + '.prototype.' + subM[3] + ' ; get_Simulation -> this.' + subM[1]);
            } catch (e) {
                ok = false;
                werr('could not wire battle-simulation hooks (DoStep/get_Simulation):', e);
            }

            // --- Offense / Defense unit getters (derived from HasUnitMdbId source) ---
            try {
                var HasUnitMdbId_Source = ClientLib.Data.CityUnits.prototype.HasUnitMdbId.toString();
                var get_UnitsF = HasUnitMdbId_Source.match(/for ?\(.+[a-z]:this.([A-Z]{6}).+[a-z]:this.([A-Z]{6})/);
                if (!get_UnitsF) throw new Error('HasUnitMdbId pattern did not match (game framework may have changed)');

                var get_OffenseUnitsF = get_UnitsF[1];
                var get__DefenseUnitsF = get_UnitsF[2];
                ClientLib.Data.CityUnits.prototype.get_OffenseUnits = function () {
                    return this[get_OffenseUnitsF];
                };
                ClientLib.Data.CityUnits.prototype.get_DefenseUnits = function () {
                    return this[get__DefenseUnitsF];
                };
                wlog('get_OffenseUnits -> this.' + get_OffenseUnitsF + ' ; get_DefenseUnits -> this.' + get__DefenseUnitsF);
            } catch (e) {
                ok = false;
                werr('could not wire unit getters (get_OffenseUnits/get_DefenseUnits):', e);
            }

            // --- GetNerfAndBoostModifier (restore on Battleground prototype if missing) ---
            try {
                if (typeof ClientLib.Vis.Battleground.Battleground.prototype.GetNerfAndBoostModifier == 'undefined') {
                    ClientLib.Vis.Battleground.Battleground.prototype.GetNerfAndBoostModifier = ClientLib.Base.Util.GetNerfAndBoostModifier;
                }
            } catch (e) {
                werr('could not restore GetNerfAndBoostModifier:', e);
            }

            // --- Map-scanner getters: get_BaseLevel / getID / get_CampType on the
            // WorldObject prototypes (City/NPCBase/NPCCamp). The Vis/Region side exposes these
            // (returning this.<6>.<6>); the Data.WorldSector side often doesn't. Copy the
            // de-obfuscated field across so the many base-scanner scripts can stop regexing it
            // themselves. Auxiliary/optional: failures here DON'T mark the wrapper as failed,
            // because scanners still carry their own fallback during migration.
            try {
                var RE_FIELD = /return this\.[A-Z]{6}\.([A-Z]{6})/,
                    WO_KINDS = ['City', 'NPCBase', 'NPCCamp'],
                    wk;
                for (wk = 0; wk < WO_KINDS.length; wk++) {
                    (function (kind) {
                        try {
                            var data = ClientLib.Data.WorldSector['WorldObject' + kind].prototype,
                                vis = ClientLib.Vis.Region['Region' + kind].prototype,
                                mBL = (typeof data.get_BaseLevel != 'function' && vis.get_BaseLevel) ? (vis.get_BaseLevel.toString().match(RE_FIELD) || [])[1] : null,
                                mID = (typeof data.getID != 'function' && vis.get_Id) ? (vis.get_Id.toString().match(RE_FIELD) || [])[1] : null,
                                mCT = (kind === 'NPCCamp' && typeof data.get_CampType != 'function' && vis.get_CampType) ? (vis.get_CampType.toString().match(RE_FIELD) || [])[1] : null;
                            if (mBL) data.get_BaseLevel = function () { return this[mBL]; };
                            if (mID) data.getID = function () { return this[mID]; };
                            if (mCT) data.get_CampType = function () { return this[mCT]; };
                            wlog('WorldObject' + kind + ' getters: BaseLevel=' + mBL + ' ID=' + mID + (kind === 'NPCCamp' ? ' CampType=' + mCT : ''));
                        } catch (e2) {
                            wwarn('WorldObject' + kind + ' getter wiring skipped:', e2);
                        }
                    })(WO_KINDS[wk]);
                }
            } catch (e) {
                werr('could not wire WorldObject getters:', e);
            }

            if (ok) {
                wlog('wrapper loaded OK');
            } else {
                CCTAWrapper_IsInstalled = false;
                werr('one or more wrappers failed to initialise - dependent scripts may not work. Set window.CCTAWrapper_DEBUG = true and reload for full details.');
            }
        }

        function CCTAWrapper_checkIfLoaded() {
            try {
                if (typeof webfrontend != 'undefined' && typeof qx != 'undefined') {
                    // Isolate each fix so a single failure can't block the core wrapper.
                    try { phefix(); }   catch (e) { werr('phefix failed:', e); }
                    try { operafix(); } catch (e) { werr('operafix failed:', e); }
                    try { blankfix(); } catch (e) { werr('blankfix failed:', e); }
                    createCCTAWrapper();
                } else {
                    iterations++;
                    // One-time heads-up if the framework is taking unusually long (~10s).
                    if (iterations === 200) wwarn('still waiting for the game framework (qx/webfrontend) after ~10s; will keep retrying...');
                    window.setTimeout(CCTAWrapper_checkIfLoaded, 50);
                }
            } catch (e) {
                CCTAWrapper_IsInstalled = false;
                werr('checkIfLoaded error:', e);
            }
        }

        window.setTimeout(CCTAWrapper_checkIfLoaded, 50);
    };

    try {
        var CCTAWrapper = document.createElement("script");
        CCTAWrapper.textContent = "var CCTAWrapper_IsInstalled = true; (" + CCTAWrapper_main.toString() + ")();";
        CCTAWrapper.type = "text/javascript";
        if (/commandandconquer\.com/i.test(document.domain)) {
            (document.head || document.documentElement).appendChild(CCTAWrapper);
        }
    } catch (e) {
        console.error("[MM Framework Wrapper] init error: ", e);
    }
})();