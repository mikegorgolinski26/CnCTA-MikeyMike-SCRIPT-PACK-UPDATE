// ==UserScript==
// @name         MM - Attack Range
// @namespace    https://cncapp*.alliances.commandandconquer.com/*/index.aspx*
// @include      https://cncapp*.alliances.commandandconquer.com/*/index.aspx*
// @description  While you are using the game's "move base" tool, highlights every base that would fall within your attack/tunnel influence range of the spot under the cursor - other players' bases in orange, Forgotten (NPC) bases in green. Markers follow the map as you pan and zoom and clear when you finish moving. A HUD options panel toggles each layer and lets you override the range.
// @version      1.0.2
// @author       Napali, XDaast
// @contributor  NetquiK (https://github.com/netquik)
// @contributor  MikeyMike
// @updateURL    https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/MM_AttackRange.user.js
// @downloadURL  https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/MM_AttackRange.user.js
// ==/UserScript==

/*
 * MM - Attack Range
 * -----------------
 * WHAT IT DOES
 *   When you pick up a base with the game's "move base" tool and drag it around the
 *   region map, this paints a translucent highlight over every base that would be within
 *   your attack / tunnel-influence range of the candidate spot under the cursor:
 *     - your alliance's bases  -> blue
 *     - other players' bases   -> orange
 *     - Forgotten (NPC) bases  -> green
 *   Your own bases are skipped. Relationship is read live from the rendered (vis) map object's
 *   get_AllianceId()/IsOwnBase() - the same data the game colours base outlines from - so no
 *   per-base server survey is needed. The markers are glued to the map via the game's own
 *   world->screen projection, so they stay put as you pan and zoom, and they clear the
 *   moment you drop the base or cancel the move.
 *
 * RANGE
 *   By default the range is read from your alliance ANNOUNCEMENT - a "[tir]N[/tir]" tag
 *   (tunnel influence range), defaulting to 10 if no tag is present. The options panel can
 *   override it with a fixed number.
 *
 * WHY IT'S NEEDED
 *   Relocating a base is a commitment. Seeing which targets a candidate position brings
 *   into range - before you commit - turns "move and hope" into a deliberate choice.
 *
 * HISTORY
 *   Rebuilt for the MikeyMike pack from "Tiberium Alliances Attack Range" (Napali / XDaast,
 *   move-tool fix by NetquiK). The original also carried a half-built "required offense
 *   level" info panel that never rendered (its label widgets were never created); that dead
 *   code is dropped here. The projection / distance / own-base checks now use the shared
 *   Common Library helpers instead of hand-rolled copies.
 *
 * DEPENDENCIES (pack rule: wrapper + Common Library only)
 *   MMCommon.map.*    - world->screen projection, visObjectAt(), watch() (safe camera poll), inRegionView()
 *   MMCommon.coords.* - distance() (the game's own tile-distance)
 *   MMCommon.base.*   - relationshipFromVis() (live own/alliance/other classification)
 *   MMCommon.net.*    - attach/detach (the move-tool events)
 *   MMCommon.ui / buttons / settings - options window + HUD button + persistence
 *   No dependency on any other userscript.
 *
 * Settings (MMCommon.settings, per player+world): AttackRange.* (master + per-layer + range + window geom).
 * Debug: window.ATTACKRANGE_DEBUG = true (or window.MM_DEBUG = true).
 */

(function () {
	var AR_main = function () {
		// ---- logger ----------------------------------------------------------------
		var LOG = (window.MMCommon && window.MMCommon.makeLogger)
			? window.MMCommon.makeLogger("Attack Range")
			: {
				log: function () {},
				warn: function () { try { console.warn.apply(console, ["[MM Attack Range]"].concat([].slice.call(arguments))); } catch (e) {} },
				err: function () { try { console.error.apply(console, ["[MM Attack Range]"].concat([].slice.call(arguments))); } catch (e) {} }
			};
		if (typeof window.ATTACKRANGE_DEBUG === "undefined") {
			try { window.ATTACKRANGE_DEBUG = (window.localStorage.getItem("ATTACKRANGE_DEBUG") === "1"); } catch (e) { window.ATTACKRANGE_DEBUG = false; }
		}
		var wlog = function () { if (!(window.ATTACKRANGE_DEBUG || window.MM_DEBUG)) return; LOG.log.apply(LOG, arguments); };
		var wwarn = function () { LOG.warn.apply(LOG, arguments); };
		var werr = function () { LOG.err.apply(LOG, arguments); };

		var MM = window.MMCommon || null;

		// ---- settings --------------------------------------------------------------
		function getS(k, d) { try { return (MM && MM.settings) ? MM.settings.get(k, d) : d; } catch (e) { return d; } }
		function setS(k, v) { try { if (MM && MM.settings) MM.settings.set(k, v); } catch (e) {} }
		function masterOn() { return getS("AttackRange.enabled", true) === true; }
		function showAlliance() { return getS("AttackRange.showAlliance", true) === true; }
		function showPlayers() { return getS("AttackRange.showPlayers", true) === true; }
		function showForgotten() { return getS("AttackRange.showForgotten", true) === true; }
		// Range: a positive override wins; otherwise the alliance announcement [tir]N[/tir], else 10.
		function currentRange() {
			var override = getS("AttackRange.rangeOverride", 0);
			if (typeof override === "number" && override > 0) return override;
			try {
				var ann = ClientLib.Data.MainData.GetInstance().get_Alliance().get_Announcement();
				var m = ann && String(ann).match(/\[tir\]\s*(\d+)\s*\[\/tir\]/i);
				if (m) return parseInt(m[1], 10);
			} catch (e) {}
			return 10;
		}

		// high-contrast layer colours (translucent fill): alliance=blue, other players=orange, NPC=green
		var COLOR = { alliance: "#1e90ff", player: "#ff3600", forgotten: "#06ff00" };

		// ---- overlay DOM -----------------------------------------------------------
		var layer = null;
		var markers = [];        // [{ id, x, y, color, el }]
		var toolActive = false;
		var lastCandidate = null; // { x, y } of the last cursor cell, for re-draw on option change
		var stopWatch = null;     // MM.map.watch() detach fn while the tool is active

		function ensureLayer() {
			var old = document.getElementById("mm_attackrange_layer");
			if (old) old.remove();
			layer = document.createElement("div");
			layer.id = "mm_attackrange_layer";
			// Same under-the-UI placement trick as MM - Player Base Info: the map canvas is the FIRST
			// child of the game root and every HUD/menu panel is a later sibling at z-index:10, stacked
			// by DOM order. Inserting our layer right after the canvas WITH z-index:10 paints it above the
			// map but below every peripheral panel. (z:auto loses to the canvas container's z:10.)
			var placed = false;
			try {
				var app = qx.core.Init.getApplication();
				var ba = app && app.getBackgroundArea && app.getBackgroundArea();
				var baEl = ba && ba.getContentElement && ba.getContentElement().getDomElement();
				if (baEl && baEl.parentNode) {
					layer.style.cssText = "position:absolute;left:0;top:0;right:0;bottom:0;z-index:10;pointer-events:none;overflow:hidden";
					baEl.parentNode.insertBefore(layer, baEl.nextSibling);
					placed = true;
				}
			} catch (e) {}
			if (!placed) {
				layer.style.cssText = "position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483000;pointer-events:none;overflow:hidden";
				(document.body || document.documentElement).appendChild(layer);
			}
		}

		function clearMarkers() {
			for (var i = 0; i < markers.length; i++) {
				var el = markers[i].el;
				if (el && el.parentNode) el.parentNode.removeChild(el);
			}
			markers = [];
		}

		// hex -> rgba so the fill can be subtle while the border keeps the tile readable.
		function hexToRgba(hex, a) {
			try {
				var h = String(hex).replace("#", "");
				if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
				var n = parseInt(h, 16);
				return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
			} catch (e) { return hex; }
		}
		function makeMarkerEl(color) {
			var el = document.createElement("div");
			el.style.cssText = [
				"position:absolute",
				"background:" + hexToRgba(color, 0.22),
				"border:1px solid " + hexToRgba(color, 0.5),
				"border-radius:3px", "pointer-events:none", "box-sizing:border-box"
			].join(";");
			layer.appendChild(el);
			return el;
		}

		// Position + size one marker over its tile, sized from the live projection so it scales with zoom.
		// Anchor on the tile CENTRE (x+0.5, y+0.5) - that's where the base art sits; worldToScreen(x,y)
		// alone lands on the tile corner (up-left of the base, the same offset the off/def bubbles have).
		function positionMarker(m) {
			try {
				var p0 = MM.map.worldToScreen(m.x, m.y);
				var px = MM.map.worldToScreen(m.x + 1, m.y);
				var py = MM.map.worldToScreen(m.x, m.y + 1);
				var c = MM.map.worldToScreen(m.x + 0.5, m.y + 0.5);
				var w = Math.max(6, Math.abs(px.x - p0.x));
				var h = Math.max(6, Math.abs(py.y - p0.y));
				m.el.style.width = Math.round(w) + "px";
				m.el.style.height = Math.round(h) + "px";
				m.el.style.left = Math.round(c.x - w / 2) + "px";
				m.el.style.top = Math.round(c.y - h / 2) + "px";
			} catch (e) {}
		}

		function reprojectAll() {
			if (!toolActive) return;
			if (!MM.map.inRegionView()) { if (layer) layer.style.display = "none"; return; }
			if (layer) layer.style.display = "block";
			for (var i = 0; i < markers.length; i++) positionMarker(markers[i]);
		}

		// Scan the box around the candidate (startX,startY) and (re)build the markers.
		function drawAt(startX, startY) {
			lastCandidate = { x: startX, y: startY };
			clearMarkers();
			if (!masterOn()) return;
			if (!layer || !layer.isConnected) { ensureLayer(); }
			if (!MM.map.inRegionView()) { if (layer) layer.style.display = "none"; return; }
			if (layer) layer.style.display = "block";
			try {
				var range = currentRange();
				var scan = Math.ceil(range) + 1;
				var myAll = 0; try { myAll = ClientLib.Data.MainData.GetInstance().get_Alliance().get_Id(); } catch (e) {}
				var CT = ClientLib.Vis.VisObject.EObjectType.RegionCityType;
				var NB = ClientLib.Vis.VisObject.EObjectType.RegionNPCBase;
				var seen = {};
				for (var gx = startX - scan; gx <= startX + scan; gx++) {
					for (var gy = startY - scan; gy <= startY + scan; gy++) {
						// the VIS object carries live relationship (get_AllianceId/IsOwnBase); the data
						// world object does not (it's a stub), so we classify off the vis object here.
						var vo = MM.map.visObjectAt(gx, gy);
						if (!vo) continue;
						var t; try { t = vo.get_VisObjectType(); } catch (e) { continue; }
						var color = null;
						if (t === CT) {
							var rel = MM.base.relationshipFromVis(vo, myAll);
							if (rel === "own") continue;                                  // never highlight your own
							if (rel === "alliance") { if (!showAlliance()) continue; color = COLOR.alliance; }
							else { if (!showPlayers()) continue; color = COLOR.player; }  // neutral or enemy = orange
						} else if (t === NB) {
							if (!showForgotten()) continue; color = COLOR.forgotten;
						} else continue;
						var id; try { id = vo.get_Id(); } catch (e) { id = null; }
						var key = (id != null) ? ("v" + id) : (gx + ":" + gy);
						if (seen[key]) continue;
						var rx = (typeof vo.get_RawX === "function") ? vo.get_RawX() : gx;
						var ry = (typeof vo.get_RawY === "function") ? vo.get_RawY() : gy;
						if (MM.coords.distance(startX, startY, rx, ry) > range) continue;
						seen[key] = true;
						var m = { x: rx, y: ry, color: color, el: makeMarkerEl(color) };
						positionMarker(m);
						markers.push(m);
					}
				}
				wlog("range", range, "-> highlighted", markers.length, "bases around", startX + "," + startY);
			} catch (e) { werr("drawAt failed:", e); }
		}

		function redrawLast() {
			if (toolActive && lastCandidate) drawAt(lastCandidate.x, lastCandidate.y);
		}

		// ---- move-base tool lifecycle ----------------------------------------------
		var netCtx = { __mmAttackRange: true };
		var moveTool = null;

		function onToolActivate() {
			try {
				toolActive = true;
				if (!layer || !layer.isConnected) ensureLayer();
				// reproject markers while the tool is up (pan/zoom) via the SAFE camera poll
				if (!stopWatch) {
					stopWatch = MM.map.watch({
						onChange: function (st) {
							try { if (st && st.region) reprojectAll(); else { if (layer) layer.style.display = "none"; } }
							catch (e) { werr("watch onChange:", e); }
						}
					});
				}
				wlog("move tool active.");
			} catch (e) { werr("onToolActivate:", e); }
		}
		function onToolDeactivate() {
			try {
				toolActive = false;
				lastCandidate = null;
				clearMarkers();
				if (layer) layer.style.display = "none";
				if (stopWatch) { try { stopWatch(); } catch (e) {} stopWatch = null; }
				wlog("move tool deactivated.");
			} catch (e) { werr("onToolDeactivate:", e); }
		}
		function onToolCellChange(startX, startY) {
			try {
				if (!toolActive) return; // only react while the move-base tool is genuinely active
				if (startX == null || startY == null) return;
				drawAt(startX | 0, startY | 0);
			} catch (e) { werr("onToolCellChange:", e); }
		}

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
			body.add(new qx.ui.basic.Label("Highlight in move-base view:").set({
				rich: true, textColor: "#9fb4c0", font: new qx.bom.Font(12, ["sans-serif"]).set({ bold: true })
			}));
			function cb(label, key, def) {
				var c = new qx.ui.form.CheckBox(label).set({ value: getS(key, def) === true, textColor: "#e8e8e8" });
				c.addListener("changeValue", function (e) { setS(key, e.getData() === true); redrawLast(); });
				return c;
			}
			body.add(cb("Alliance bases (blue)", "AttackRange.showAlliance", true));
			body.add(cb("Other players' bases (orange)", "AttackRange.showPlayers", true));
			body.add(cb("Forgotten / NPC bases (green)", "AttackRange.showForgotten", true));

			// range override row
			var rangeRow = new qx.ui.container.Composite(new qx.ui.layout.HBox(6)).set({ marginTop: 4 });
			rangeRow.add(new qx.ui.basic.Label("Range override:").set({ textColor: "#e8e8e8", alignY: "middle" }));
			var spin = new qx.ui.form.Spinner(0, getS("AttackRange.rangeOverride", 0), 50).set({ width: 60 });
			spin.addListener("changeValue", function (e) { setS("AttackRange.rangeOverride", e.getData() | 0); redrawLast(); });
			rangeRow.add(spin);
			rangeRow.add(new qx.ui.basic.Label("(0 = auto from alliance [tir], else 10)").set({ textColor: "#9fb4c0", alignY: "middle", rich: true }));
			body.add(rangeRow);

			body.add(new qx.ui.core.Widget().set({ height: 1, backgroundColor: "#3a4248", marginTop: 4, marginBottom: 2, allowGrowX: true }));
			var master = new qx.ui.form.CheckBox("Master: enable the range overlay").set({ value: masterOn(), textColor: "#e8e8e8" });
			master.addListener("changeValue", function (e) {
				setS("AttackRange.enabled", e.getData() === true);
				if (e.getData() === true) redrawLast(); else clearMarkers();
			});
			body.add(master);

			var win = MM.ui.Window({
				caption: "Attack Range", key: "AttackRange.Window",
				layout: new qx.ui.layout.VBox(), pos: [280, 150], resizable: false, restoreOpen: true, dock: true
			});
			if (!win) { werr("options window creation failed"); return; }
			win.add(body);
			MM.buttons.register({
				id: "mm-attack-range", label: "Attack Range",
				tooltip: "Highlight bases in range while moving a base",
				onExecute: function () { try { if (win.isVisible()) win.close(); else win.open(); } catch (e) { werr("toggle failed:", e); } }
			});
			wlog("options panel ready.");
		}

		// ---- bring-up (needs game UI + MMCommon map/coords/base/net/ui/buttons) -----
		window.MM_ATTACKRANGE_INSTALLED = false;
		var tries = 0;
		function poll() {
			try {
				var app = (typeof qx !== "undefined" && qx.core && qx.core.Init) ? qx.core.Init.getApplication() : null;
				var uiReady = app && app.getMenuBar && app.getMenuBar();
				MM = window.MMCommon || MM;
				var ready = uiReady && MM && MM.map && MM.coords && MM.base && MM.net && MM.ui && MM.buttons && MM.map.ready();
				if (ready) {
					ensureLayer();
					if (layer) layer.style.display = "none"; // hidden until a move starts
					if (!attachTool()) { wwarn("move-base tool not available yet; retrying..."); tries++; if (tries < 120) window.setTimeout(poll, 1000); return; }
					buildOptions();
					window.MM_ATTACKRANGE_INSTALLED = true;
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
		el.textContent = "(" + AR_main.toString() + ")();";
		if (/commandandconquer\.com/i.test(document.domain)) {
			(document.head || document.documentElement).appendChild(el);
		}
	} catch (e) {
		try { console.error("[MM Attack Range] init error:", e); } catch (_) {}
	}
})();
