// ==UserScript==
// @name            MM - CnCTAOpt Link
// @description     Adds a "CnCTAOpt" button to the region right-click menu of any base/camp/outpost. Clicking it encodes that base's full layout (buildings, defense, offense, terrain, levels) into a cnctaopt.com share link and opens it in a new tab so you can analyze or share the base. MikeyMike edition: the encoder now lives in MM - Common Library (MMCommon.cnctaopt); this script is just the button. Faithful rework of zbluebugz's "CnC:TA CnCTAOpt Link".
// @author          MikeyMike (rework of zbluebugz)
// @contributor     zbluebugz (https://github.com/zbluebugz/CnC-TA-Opt)
// @version         1.0.1
// @match           https://*.alliances.commandandconquer.com/*/index.aspx*
// @downloadURL     https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/MM_CnCTAOptLink.user.js
// @updateURL       https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/MM_CnCTAOptLink.user.js
// ==/UserScript==

/*
 * MM - CnCTAOpt Link
 * ------------------
 * WHAT IT DOES
 *   When you open the region right-click menu on a base (own / alliance / enemy) or a
 *   Forgotten base / camp / outpost, it adds a "CnCTAOpt" button. Clicking it builds a
 *   cnctaopt.com "ver=3" share link for that base and opens it in a new tab.
 *
 * HOW IT'S BUILT (vs the original zbluebugz script)
 *   The entire encoder - the building/defense/offense hotkey maps, the 20x9 grid walk,
 *   the faction logic, the URL format - was lifted into MM - Common Library as
 *   MMCommon.cnctaopt (so the sim / scanner / any future MM script can also produce a
 *   cnctaopt link from one maintained copy). This script is now just the menu button:
 *   it wraps webfrontend.gui.region.RegionCityMenu.showMenu to inject the button and
 *   calls MMCommon.cnctaopt.open(cityId).
 *
 *   The button is greyed out until the selected base's data has loaded (GetCity owner
 *   becomes non-zero), then it enables - same behaviour as the original.
 *
 * DEPENDS ON: MM - Framework Wrapper + MM - Common Library only (no other userscript).
 * DEBUG: window.MM_DEBUG = true  ->  verbose [MM CnCTAOpt] logs.
 */

(function () {
	'use strict';
	var MM_CnCTAOptLink_main = function () {
		// i18n fallback: hoisted so MMt() is always defined even if the Common Library's global
		// loads after this script (extension injection order isn't guaranteed). Identity in English.
		function MMt(s){try{return (window.MMCommon&&window.MMCommon.i18n)?window.MMCommon.i18n.t(s):s;}catch(e){return s;}}
		function build() {
			var MM = window.MMCommon;
			var clog = (MM && MM.makeLogger) ? MM.makeLogger("CnCTAOpt") : { log: function () {}, warn: function () {}, err: function () {} };
			var RCM = webfrontend.gui.region.RegionCityMenu;
			if (!RCM || !RCM.prototype) { window.setTimeout(build, 1000); return; }
			if (RCM.prototype.__mm_cnctaopt_real_showMenu) { clog.log("already installed."); return; }

			// shared across menu instances (matches the original's single selected_base + gate state)
			var selected = { base: null };
			var check_ct = 0, check_timer = null, button_enabled = 123456;

			RCM.prototype.__mm_cnctaopt_real_showMenu = RCM.prototype.showMenu;
			RCM.prototype.showMenu = function (selected_base) {
				try {
					var self = this;
					selected.base = selected_base;

					// inject the button once per menu instance (into the menu's Composite container)
					if (this.__mm_cnctaopt_init != 1) {
						this.__mm_cnctaopt_init = 1;
						this.__mm_cnctaopt_links = [];
						for (var k in this) {
							try {
								if (this[k] && this[k].basename == "Composite") {
									var btn = new qx.ui.form.Button(MMt("CnCTAOpt"));
									btn.addListener("execute", function () {
										try {
											var app = qx.core.Init.getApplication();
											app.getBackgroundArea().closeCityInfo();
											var base = selected.base;
											if (base && base.get_Id) {
												var u = MM.cnctaopt.open(base.get_Id());
												if (!u) { clog.warn("could not build a link for base", base.get_Id()); }
											}
										} catch (e) { clog.warn("execute:", e); }
									});
									this[k].add(btn);
									this.__mm_cnctaopt_links.push(btn);
								}
							} catch (e) { clog.warn("inject:", e); }
						}
					}

					// does the button apply to this selection?
					var orig_tf = false;
					switch (selected_base.get_VisObjectType()) {
						case ClientLib.Vis.VisObject.EObjectType.RegionCityType:
							switch (selected_base.get_Type()) {
								case ClientLib.Vis.Region.RegionCity.ERegionCityType.Own:
								case ClientLib.Vis.Region.RegionCity.ERegionCityType.Alliance:
								case ClientLib.Vis.Region.RegionCity.ERegionCityType.Enemy:
									orig_tf = true; break;
							}
							break;
						case ClientLib.Vis.VisObject.EObjectType.RegionNPCBase:
						case ClientLib.Vis.VisObject.EObjectType.RegionNPCCamp:
							orig_tf = true; break;
					}

					// grey the button out until the base data finishes loading (owner becomes non-zero),
					// then enable it - the link can't be built until then.
					function gate() {
						try {
							var tf = orig_tf, still_loading = false;
							if (check_timer !== null) { clearTimeout(check_timer); }
							var base = selected.base;
							if (base && base.get_Id) {
								var city = ClientLib.Data.MainData.GetInstance().get_Cities().GetCity(base.get_Id());
								if (!city || city.get_OwnerId() === 0) { still_loading = true; tf = false; }
							} else { tf = false; }
							if (tf != button_enabled) {
								button_enabled = tf;
								for (var i = 0; i < self.__mm_cnctaopt_links.length; ++i) { self.__mm_cnctaopt_links[i].setEnabled(tf); }
							}
							if (!still_loading) { check_ct = 0; }
							else if (check_ct > 0) { check_ct--; check_timer = window.setTimeout(gate, 100); }
							else { check_timer = null; }
						} catch (e) { clog.warn("gate:", e); }
					}
					check_ct = 50;
					gate();
				} catch (e) { clog.warn("showMenu:", e); }
				this.__mm_cnctaopt_real_showMenu(selected_base);
			};
			clog.log("installed (RegionCityMenu button on MMCommon.cnctaopt).");
		}

		// wait for the game UI AND MM - Common Library's cnctaopt module
		function waitForDeps(tries) {
			tries = tries || 0;
			try {
				if (typeof qx !== "undefined" && qx.core.Init.getApplication()
					&& window.MMCommon && window.MMCommon.cnctaopt && window.MMCommon.cnctaopt.encode
					&& webfrontend && webfrontend.gui && webfrontend.gui.region && webfrontend.gui.region.RegionCityMenu) {
					build();
				} else if (tries < 120) {
					window.setTimeout(function () { waitForDeps(tries + 1); }, 1000);
				}
			} catch (e) {
				if (tries < 120) { window.setTimeout(function () { waitForDeps(tries + 1); }, 1000); }
			}
		}
		waitForDeps(0);
	};

	// inject into the page context (where qx / webfrontend / window.MMCommon live)
	var el = document.createElement("script");
	el.type = "text/javascript";
	el.textContent = "(" + MM_CnCTAOptLink_main.toString() + ")();";
	if (/commandandconquer\.com/i.test(document.domain)) {
		(document.head || document.documentElement).appendChild(el);
	}
})();
