// ==UserScript==
// @name         MM - Move Info
// @namespace    https://cncapp*.alliances.commandandconquer.com/*/index.aspx*
// @include      https://cncapp*.alliances.commandandconquer.com/*/index.aspx*
// @description  Adds two readouts to the game's "move base" info panel while you relocate a base: (1) the wall-clock time the move cooldown for the spot under the cursor will expire (or "now"), and (2) how many farmable Forgotten NPC bases sit within attack range of that spot - a total/in-range count, a per-level breakdown, and a rough attack-wave estimate - so you can pick a base location with the best farming around it. Both update as you move the cursor and clear when you drop the base.
// @version      1.0.1
// @author       MikeyMike (rework of Nogrod / NetquiK's "CityMoveInfoExtend")
// @contributor  Nogrod
// @contributor  NetquiK (https://github.com/netquik)
// @updateURL    https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/MM_MoveInfo.user.js
// @downloadURL  https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/MM_MoveInfo.user.js
// ==/UserScript==

/*
 * MM - Move Info
 * --------------
 * WHAT IT DOES
 *   While you pick up one of your bases with the "move base" tool, this adds rows to the game's
 *   move-info panel describing the spot under the cursor:
 *     - "Move ready": the wall-clock date/time the relocation cooldown for that spot expires (the
 *       game shows the cooldown as a duration; this shows when it'll actually be ready), or "now".
 *     - "NPC bases in range": how many farmable Forgotten NPC bases (camps / outposts) are within your
 *       server's max attack distance of that spot - a total, the count strictly inside range, and a
 *       rough attack-wave estimate - plus a per-level breakdown ("3x15 . 2x16 . ...").
 *   Both update as you move the cursor and clear when you drop the base or cancel.
 *
 * WHY IT'S NEEDED
 *   When deciding WHERE to relocate a base, what matters is how many (and what level) farmable bases
 *   will be in attack range of the new spot, and when you'll be free to move again. This surfaces both
 *   right on the move panel.
 *
 * HOW IT'S BUILT (vs Nogrod / NetquiK's "CityMoveInfoExtend")
 *   Rebuilt on the Common Library: the move-tool events (OnActivate / OnDeactivate / OnCellChange) and
 *   the panel readout come from MMCommon - the same foundation MM - Tunnel Info uses - instead of the
 *   original's fragile prototype hook on RegionCityMoveInfo + a regex on the game's obfuscated cooldown
 *   label. We add our OWN readout rows (we don't rewrite the game's labels), so a game update can't
 *   silently break the panel. The surrounding-base scan + wave heuristic are carried over.
 *
 * DEPENDENCIES (pack rule: wrapper + Common Library only)
 *   MMCommon.net.attach/detach - move-tool events ; MMCommon.ui / buttons / settings
 *   ClientLib.Data.MainData (server max-attack distance, world objects, current-city move cooldown)
 *
 * Settings (MMCommon.settings, per player+world): MoveInfo.* (master + per-readout toggles + window geom).
 * Debug: window.MOVEINFO_DEBUG = true (or window.MM_DEBUG = true).
 */

(function () {
	var MI_main = function () {
		// ---- logger ----------------------------------------------------------------
		// i18n fallback: hoisted so MMt() is always defined even if the Common Library's global
		// loads after this script (extension injection order isn't guaranteed). Identity in English.
		function MMt(s){try{return (window.MMCommon&&window.MMCommon.i18n)?window.MMCommon.i18n.t(s):s;}catch(e){return s;}}
		var LOG = (window.MMCommon && window.MMCommon.makeLogger)
			? window.MMCommon.makeLogger("Move Info")
			: {
				log: function () {},
				warn: function () { try { console.warn.apply(console, ["[MM Move Info]"].concat([].slice.call(arguments))); } catch (e) {} },
				err: function () { try { console.error.apply(console, ["[MM Move Info]"].concat([].slice.call(arguments))); } catch (e) {} }
			};
		if (typeof window.MOVEINFO_DEBUG === "undefined") {
			try { window.MOVEINFO_DEBUG = (window.localStorage.getItem("MOVEINFO_DEBUG") === "1"); } catch (e) { window.MOVEINFO_DEBUG = false; }
		}
		var wlog = function () { if (!(window.MOVEINFO_DEBUG || window.MM_DEBUG)) return; LOG.log.apply(LOG, arguments); };
		var wwarn = function () { LOG.warn.apply(LOG, arguments); };
		var werr = function () { LOG.err.apply(LOG, arguments); };

		var MM = window.MMCommon || null;

		// ---- settings --------------------------------------------------------------
		function getS(k, d) { try { return (MM && MM.settings) ? MM.settings.get(k, d) : d; } catch (e) { return d; } }
		function setS(k, v) { try { if (MM && MM.settings) MM.settings.set(k, v); } catch (e) {} }
		function masterOn() { return getS("MoveInfo.enabled", true) === true; }
		function showCooldown() { return getS("MoveInfo.cooldown", true) === true; }
		function showBases() { return getS("MoveInfo.bases", true) === true; }

		// ---- data ------------------------------------------------------------------
		// Wall-clock time the relocation cooldown for (x,y) expires, or "now", or null if unavailable.
		function cooldownText(x, y) {
			try {
				var oc = ClientLib.Data.MainData.GetInstance().get_Cities().get_CurrentOwnCity();
				if (!oc || typeof oc.GetCityMoveCooldownTime !== "function") return null;
				var secs = oc.GetCityMoveCooldownTime(x, y);
				if (!secs || secs <= 0) return MMt("now");
				var when = new Date(Date.now() + secs * 1000);
				try { return phe.cnc.Util.getDateTimeString(when); } catch (e) { return when.toLocaleString(); }
			} catch (e) { werr("cooldownText:", e); return null; }
		}

		// Count farmable Forgotten NPC bases within the server max-attack distance of (x,y), by level.
		// Uses the DATA world object (world.GetObjectFromPosition, GRID coords) - a stub that still carries
		// .Type / get_BaseLevel() / getCampType(), so off-screen bases are counted too. Returns
		// { count, inner, levels:{lvl:n} } where inner = count strictly inside floor(maxAttack).
		function surroundingBases(x, y) {
			var out = { count: 0, inner: 0, levels: {} };
			try {
				var md = ClientLib.Data.MainData.GetInstance();
				var maxAttack = md.get_Server().get_MaxAttackDistance();
				var ceil = Math.floor(maxAttack) + 1;
				var floorA = Math.floor(maxAttack);
				var world = md.get_World();
				var OT = ClientLib.Data.WorldSector.ObjectType;
				var Destroyed = (ClientLib.Data.Reports && ClientLib.Data.Reports.ENPCCampType) ? ClientLib.Data.Reports.ENPCCampType.Destroyed : null;
				for (var sy = y - ceil; sy <= y + ceil; sy++) {
					for (var sx = x - ceil; sx <= x + ceil; sx++) {
						var dx = x - sx, dy = y - sy;
						var dist = Math.sqrt(dx * dx + dy * dy);
						if (dist > maxAttack) continue;
						var obj = world.GetObjectFromPosition(sx, sy);
						if (!obj || obj.Type !== OT.NPCBase) continue;
						if (Destroyed != null && typeof obj.getCampType === "function" && obj.getCampType() === Destroyed) continue;
						var lvl = 0; try { lvl = obj.get_BaseLevel(); } catch (e) {}
						out.levels[lvl] = (out.levels[lvl] || 0) + 1;
						out.count++;
						if (dist < floorA) out.inner++;
					}
				}
			} catch (e) { werr("surroundingBases:", e); }
			return out;
		}
		// Attack-wave estimate from the in-range count (the original's German-origin heuristic).
		function waveText(inner) {
			if (inner <= 20) return MMt("1 wave");
			if (inner <= 25) return MMt("max 2 waves");
			if (inner <= 30) return MMt("2 waves");
			if (inner <= 35) return MMt("max 3 waves");
			if (inner <= 40) return MMt("3 waves");
			if (inner <= 44) return MMt("max 4 waves");
			if (inner <= 50) return MMt("4 waves");
			return MMt("5+ waves");
		}

		// ---- readout panel (added to the game's move-info widget) ------------------
		// Created lazily, added/removed as a whole. Fully guarded - a panel failure must never stop the
		// move tool. (Coexists with MM - Tunnel Info's own readout on the same panel; they're independent.)
		var panel = { box: null, cd: null, bases: null, lvl: null, shown: false };

		function row(color, bold) {
			var l = new qx.ui.basic.Label("").set({ rich: true, textColor: color || "#FFF" });
			if (bold) l.setFont("bold");
			return l;
		}
		function ensurePanel() {
			if (panel.box) return panel.box;
			try {
				var box = new qx.ui.container.Composite(new qx.ui.layout.VBox(2));
				panel.cd = row("#FFF");
				panel.bases = row("#FFF");
				panel.lvl = row("#cfe0ea");
				box.add(panel.cd);
				box.add(panel.bases);
				box.add(panel.lvl);
				panel.box = box;
			} catch (e) { werr("ensurePanel:", e); }
			return panel.box;
		}
		function showPanel() {
			try {
				var b = ensurePanel();
				if (!b) return;
				if (!panel.shown) {
					webfrontend.gui.region.RegionCityMoveInfo.getInstance().add(b);
					panel.shown = true;
				}
			} catch (e) { werr("showPanel:", e); }
		}
		function hidePanel() {
			try {
				if (panel.shown && panel.box) {
					webfrontend.gui.region.RegionCityMoveInfo.getInstance().remove(panel.box);
				}
			} catch (e) { /* the widget may already be gone */ }
			panel.shown = false;
		}

		function renderAt(x, y) {
			try {
				if (!masterOn()) { hidePanel(); return; }
				ensurePanel();
				var any = false;
				if (showCooldown()) {
					var cd = cooldownText(x, y);
					panel.cd.setValue(MMt("Move ready:") + " <b>" + (cd || "?") + "</b>");
					panel.cd.show(); any = true;
				} else { panel.cd.exclude(); }
				if (showBases()) {
					var s = surroundingBases(x, y);
					panel.bases.setValue(MMt("NPC bases in range:") + " <b>" + s.count + "</b> (<b>" + s.inner + "</b>)  ·  ~" + waveText(s.inner));
					var keys = Object.keys(s.levels).map(Number).sort(function (a, b) { return b - a; }); // high level first
					var parts = [];
					for (var i = 0; i < keys.length; i++) parts.push(s.levels[keys[i]] + "x" + keys[i]);
					panel.lvl.setValue(parts.length ? MMt("Levels:") + " " + parts.join(" · ") : "");
					panel.lvl.setVisibility(parts.length ? "visible" : "excluded");
					panel.bases.show(); any = true;
				} else { panel.bases.exclude(); panel.lvl.exclude(); }
				if (any) showPanel(); else hidePanel();
			} catch (e) { werr("renderAt:", e); }
		}

		// ---- move-base tool lifecycle ----------------------------------------------
		var netCtx = { __mmMoveInfo: true };
		var moveTool = null;
		var toolActive = false;
		var lastCell = null;

		function onToolActivate() { try { toolActive = true; } catch (e) { werr("onToolActivate:", e); } }
		function onToolDeactivate() {
			try { toolActive = false; lastCell = null; hidePanel(); } catch (e) { werr("onToolDeactivate:", e); }
		}
		function onToolCellChange(x, y) {
			try {
				if (!toolActive || x == null || y == null) return;
				lastCell = { x: x | 0, y: y | 0 };
				renderAt(x | 0, y | 0);
			} catch (e) { werr("onToolCellChange:", e); }
		}
		function redrawLast() { if (toolActive && lastCell) renderAt(lastCell.x, lastCell.y); }

		function attachTool() {
			var vm = ClientLib.Vis.VisMain.GetInstance();
			moveTool = vm.GetMouseTool(ClientLib.Vis.MouseTool.EMouseTool.MoveBase);
			if (!moveTool) return false;
			MM.net.attach(moveTool, "OnActivate", ClientLib.Vis.MouseTool.OnActivate, netCtx, onToolActivate);
			MM.net.attach(moveTool, "OnDeactivate", ClientLib.Vis.MouseTool.OnDeactivate, netCtx, onToolDeactivate);
			MM.net.attach(moveTool, "OnCellChange", ClientLib.Vis.MouseTool.OnCellChange, netCtx, onToolCellChange);
			return true;
		}

		// ---- options panel ---------------------------------------------------------
		function buildOptions() {
			var body = new qx.ui.container.Composite(new qx.ui.layout.VBox(6)).set({ padding: 10, backgroundColor: "#23282b" });
			body.add(new qx.ui.basic.Label(MMt("While moving a base, add to the move panel:")).set({
				rich: true, textColor: "#9fb4c0", font: new qx.bom.Font(12, ["sans-serif"]).set({ bold: true })
			}));

			function toggle(text, key, dflt) {
				var cb = new qx.ui.form.CheckBox(text).set({ value: getS(key, dflt) === true, textColor: "#e8e8e8" });
				cb.addListener("changeValue", function (e) { setS(key, e.getData() === true); redrawLast(); });
				return cb;
			}
			body.add(toggle(MMt("Move-cooldown expiry time (when the spot is free to move into)"), "MoveInfo.cooldown", true));
			body.add(toggle(MMt("Farmable NPC bases in attack range (+ levels + wave estimate)"), "MoveInfo.bases", true));

			body.add(new qx.ui.core.Widget().set({ height: 1, backgroundColor: "#3a4248", marginTop: 4, marginBottom: 2, allowGrowX: true }));
			var master = new qx.ui.form.CheckBox(MMt("Master: enable the move-panel readout")).set({ value: masterOn(), textColor: "#e8e8e8" });
			master.addListener("changeValue", function (e) {
				setS("MoveInfo.enabled", e.getData() === true);
				if (e.getData() === true) redrawLast(); else hidePanel();
			});
			body.add(master);

			var win = MM.ui.Window({
				caption: MMt("Move Info"), key: "MoveInfo.Window",
				layout: new qx.ui.layout.VBox(), pos: [320, 180], resizable: false, restoreOpen: true, dock: true
			});
			if (!win) { werr("options window creation failed"); return; }
			win.add(body);
			MM.buttons.register({
				id: "mm-move-info", label: MMt("Move Info"),
				tooltip: MMt("Cooldown expiry + farmable bases in range, shown while you move a base"),
				onExecute: function () { try { if (win.isVisible()) win.close(); else win.open(); } catch (e) { werr("toggle failed:", e); } }
			});
			wlog("options panel ready.");
		}

		// ---- bring-up --------------------------------------------------------------
		window.MM_MOVEINFO_INSTALLED = false;
		var tries = 0;
		function poll() {
			try {
				var app = (typeof qx !== "undefined" && qx.core && qx.core.Init) ? qx.core.Init.getApplication() : null;
				var uiReady = app && app.getMenuBar && app.getMenuBar();
				MM = window.MMCommon || MM;
				var ready = uiReady && MM && MM.net && MM.ui && MM.buttons && MM.settings;
				if (ready) {
					if (!attachTool()) { wwarn("move-base tool not available yet; retrying..."); tries++; if (tries < 120) window.setTimeout(poll, 1000); return; }
					buildOptions();
					window.MM_MOVEINFO_INSTALLED = true;
					wlog("installed.");
					return;
				}
			} catch (e) { werr("poll error:", e); }
			tries++;
			if (tries === 40) wwarn("still waiting for game UI / MM - Common Library...");
			if (tries < 120) window.setTimeout(poll, 1000);
			else wwarn("gave up waiting for the game / Common Library.");
		}
		window.setTimeout(poll, 1000);
	};

	// inject into PAGE context
	try {
		var el = document.createElement("script");
		el.type = "text/javascript";
		el.textContent = "(" + MI_main.toString() + ")();";
		if (/commandandconquer\.com/i.test(document.domain)) {
			(document.head || document.documentElement).appendChild(el);
		}
	} catch (e) {
		try { console.error("[MM Move Info] init error:", e); } catch (_) {}
	}
})();
