// ==UserScript==
// @name         MM - Tunnel Info
// @namespace    https://cncapp*.alliances.commandandconquer.com/*/index.aspx*
// @include      https://cncapp*.alliances.commandandconquer.com/*/index.aspx*
// @description  While you use the game's "move base" tool, marks the Points-of-Interest "tunnels" near the cursor: GREEN if your current base's offense level can activate them, RED if it's too low. It also shows your Offense Level vs the highest Required Level in the move-info panel. Range comes from your alliance announcement's [tir]N[/tir] tag (default 6) and can be overridden. Markers follow the map as you pan and zoom and clear when you finish moving.
// @version      1.0.0
// @author       MikeyMike (rework of KRS_L's "Tiberium Alliances Tunnel Info")
// @contributor  KRS_L
// @contributor  leo7044
// @contributor  NetquiK (https://github.com/netquik)
// @updateURL    https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/MM_TunnelInfo.user.js
// @downloadURL  https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/MM_TunnelInfo.user.js
// ==/UserScript==

/*
 * MM - Tunnel Info
 * ----------------
 * WHAT IT DOES
 *   When you pick up a base with the "move base" tool, this scans the POI "tunnels" within your
 *   tunnel-influence range of the spot under the cursor and paints a translucent marker on each:
 *     - GREEN  -> your current base's offense level is high enough to ACTIVATE it
 *     - RED    -> blocked: your offense is below (tunnel level - POI activation level difference)
 *   It also adds an "Offense Level / Required Level" readout to the game's move-info panel (the
 *   required level is the highest blocking tunnel's threshold). Markers stay glued to the map as
 *   you pan/zoom and clear when you drop the base or cancel.
 *
 * RANGE
 *   Read from your alliance ANNOUNCEMENT's "[tir]N[/tir]" tag (tunnel influence range), default 6.
 *   The options panel can override it with a fixed number.
 *
 * HOW IT'S BUILT (vs KRS_L's original)
 *   Rebuilt on the Common Library: the world->screen projection, pan/zoom tracking (the SAFE camera
 *   poll, not a PositionChange hook), tile-distance and the move-tool events all come from MMCommon
 *   - the same proven foundation MM - Attack Range uses - instead of the original's hand-rolled
 *   ScreenPosFromWorldPos + PositionChange/ZoomFactorChange hooks. Adds a HUD button + options panel
 *   and the standard [MM ...] debug logging.
 *
 * DEPENDENCIES (pack rule: wrapper + Common Library only)
 *   MMCommon.map.*   - worldToScreen, visObjectAt(), watch() (safe camera poll), inRegionView()
 *   MMCommon.coords.distance, MMCommon.net.attach/detach, MMCommon.ui / buttons / settings
 *
 * Settings (MMCommon.settings, per player+world): TunnelInfo.* (master + range override + panel + window geom).
 * Debug: window.TUNNELINFO_DEBUG = true (or window.MM_DEBUG = true).
 */

(function () {
	var TI_main = function () {
		// ---- logger ----------------------------------------------------------------
		var LOG = (window.MMCommon && window.MMCommon.makeLogger)
			? window.MMCommon.makeLogger("Tunnel Info")
			: {
				log: function () {},
				warn: function () { try { console.warn.apply(console, ["[MM Tunnel Info]"].concat([].slice.call(arguments))); } catch (e) {} },
				err: function () { try { console.error.apply(console, ["[MM Tunnel Info]"].concat([].slice.call(arguments))); } catch (e) {} }
			};
		if (typeof window.TUNNELINFO_DEBUG === "undefined") {
			try { window.TUNNELINFO_DEBUG = (window.localStorage.getItem("TUNNELINFO_DEBUG") === "1"); } catch (e) { window.TUNNELINFO_DEBUG = false; }
		}
		var wlog = function () { if (!(window.TUNNELINFO_DEBUG || window.MM_DEBUG)) return; LOG.log.apply(LOG, arguments); };
		var wwarn = function () { LOG.warn.apply(LOG, arguments); };
		var werr = function () { LOG.err.apply(LOG, arguments); };

		var MM = window.MMCommon || null;

		// ---- settings --------------------------------------------------------------
		function getS(k, d) { try { return (MM && MM.settings) ? MM.settings.get(k, d) : d; } catch (e) { return d; } }
		function setS(k, v) { try { if (MM && MM.settings) MM.settings.set(k, v); } catch (e) {} }
		function masterOn() { return getS("TunnelInfo.enabled", true) === true; }
		function showPanel() { return getS("TunnelInfo.showPanel", true) === true; }
		// Range: a positive override wins; otherwise the alliance announcement [tir]N[/tir], else 6.
		function currentRange() {
			var override = getS("TunnelInfo.rangeOverride", 0);
			if (typeof override === "number" && override > 0) return override;
			try {
				var ann = ClientLib.Data.MainData.GetInstance().get_Alliance().get_Announcement();
				var m = ann && String(ann).match(/\[tir\]\s*(\d+)\s*\[\/tir\]/i);
				if (m) return parseInt(m[1], 10);
			} catch (e) {}
			return 6;
		}

		// colours (match the original): can-activate green, blocked red
		var COLOR = { activate: "#06ff00", blocked: "#ff3600" };

		// per-activation state (set when the move tool goes up)
		var PALD = 0;              // POI activation level difference (server constant)
		var myOffense = 0;         // current own city offense level
		var requiredLevel = 0;     // highest blocking tunnel threshold for the current candidate

		// ---- overlay DOM (same under-the-UI placement as Attack Range / Player Base Info) ----
		var layer = null;
		var markers = [];          // [{ x, y, color, el }]
		var toolActive = false;
		var lastCandidate = null;  // { x, y } of the last cursor cell, for re-draw on option change
		var stopWatch = null;      // MM.map.watch() detach fn while the tool is active

		function ensureLayer() {
			var old = document.getElementById("mm_tunnelinfo_layer");
			if (old) old.remove();
			layer = document.createElement("div");
			layer.id = "mm_tunnelinfo_layer";
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
				"background:" + hexToRgba(color, 0.30),
				"border:1px solid " + hexToRgba(color, 0.65),
				"border-radius:3px", "pointer-events:none", "box-sizing:border-box"
			].join(";");
			layer.appendChild(el);
			return el;
		}
		// position + size one marker over its tile centre, scaled from the live projection (zoom-aware)
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

		// ---- move-info panel (offense level / required level) ----------------------
		// A small two-row readout added to the game's move-info widget when at least one tunnel is
		// blocking. Created lazily, added/removed as needed. Fully guarded - a panel failure must
		// never stop the map markers. (The original's decorative blocked-tunnel icon is dropped.)
		var panel = { grid: null, offVal: null, reqVal: null, shown: false };

		function ensurePanel() {
			if (panel.grid) return panel.grid;
			try {
				var grid = new qx.ui.container.Composite(new qx.ui.layout.Grid(5, 5));
				var offLbl = new qx.ui.basic.Label("Offense Level:").set({ textColor: "#FFF", alignY: "bottom", alignX: "right" });
				panel.offVal = new qx.ui.basic.Label("").set({ font: "bold", textColor: "#FFF", alignY: "bottom", alignX: "right" });
				var reqLbl = new qx.ui.basic.Label("Required Level:").set({ textColor: "#FF6A6A", alignY: "top", alignX: "right" });
				panel.reqVal = new qx.ui.basic.Label("").set({ font: "bold", textColor: "#FF6A6A", alignY: "top", alignX: "right" });
				grid.add(offLbl, { row: 0, column: 0 });
				grid.add(panel.offVal, { row: 0, column: 1 });
				grid.add(reqLbl, { row: 1, column: 0 });
				grid.add(panel.reqVal, { row: 1, column: 1 });
				panel.grid = grid;
			} catch (e) { werr("ensurePanel:", e); }
			return panel.grid;
		}
		function showMoveInfoPanel() {
			if (!showPanel()) { hideMoveInfoPanel(); return; }
			try {
				var g = ensurePanel();
				if (!g) return;
				if (panel.offVal) panel.offVal.setValue(myOffense.toFixed(2));
				if (panel.reqVal) panel.reqVal.setValue(String(requiredLevel));
				if (!panel.shown) {
					webfrontend.gui.region.RegionCityMoveInfo.getInstance().add(g);
					panel.shown = true;
				}
			} catch (e) { werr("showMoveInfoPanel:", e); }
		}
		function hideMoveInfoPanel() {
			try {
				if (panel.shown && panel.grid) {
					webfrontend.gui.region.RegionCityMoveInfo.getInstance().remove(panel.grid);
				}
			} catch (e) { /* the widget may already be gone */ }
			panel.shown = false;
		}

		// ---- scan + draw -----------------------------------------------------------
		function drawAt(startX, startY) {
			lastCandidate = { x: startX, y: startY };
			clearMarkers();
			hideMoveInfoPanel();
			requiredLevel = 0;
			if (!masterOn()) return;
			if (myOffense <= 0) return; // nothing to compare against
			if (!layer || !layer.isConnected) { ensureLayer(); }
			if (!MM.map.inRegionView()) { if (layer) layer.style.display = "none"; return; }
			if (layer) layer.style.display = "block";
			try {
				var range = currentRange();
				var scan = Math.ceil(range) + 1;
				var POI = ClientLib.Vis.VisObject.EObjectType.RegionPointOfInterest;
				var seen = {};
				for (var gx = startX - scan; gx <= startX + scan; gx++) {
					for (var gy = startY - scan; gy <= startY + scan; gy++) {
						var vo = MM.map.visObjectAt(gx, gy);
						if (!vo) continue;
						var t; try { t = vo.get_VisObjectType(); } catch (e) { continue; }
						if (t !== POI) continue;
						var pType; try { pType = vo.get_Type(); } catch (e) { continue; }
						if (pType !== 0) continue; // type 0 == tunnel
						var tx = (typeof vo.get_RawX === "function") ? vo.get_RawX() : gx;
						var ty = (typeof vo.get_RawY === "function") ? vo.get_RawY() : gy;
						var key = tx + ":" + ty;
						if (seen[key]) continue;
						if (MM.coords.distance(startX, startY, tx, ty) > range) continue;
						seen[key] = true;
						var level = 0; try { level = vo.get_Level(); } catch (e) {}
						var threshold = level - PALD;
						var color;
						if (myOffense < threshold) {           // blocked
							color = COLOR.blocked;
							if (requiredLevel < threshold) requiredLevel = threshold;
						} else {                                // can activate
							color = COLOR.activate;
						}
						var m = { x: tx, y: ty, color: color, el: makeMarkerEl(color) };
						positionMarker(m);
						markers.push(m);
					}
				}
				if (requiredLevel > 0) showMoveInfoPanel();
				wlog("range", range, "-> marked", markers.length, "tunnels around", startX + "," + startY, "required", requiredLevel);
			} catch (e) { werr("drawAt failed:", e); }
		}
		function redrawLast() {
			if (toolActive && lastCandidate) drawAt(lastCandidate.x, lastCandidate.y);
		}

		// ---- move-base tool lifecycle ----------------------------------------------
		var netCtx = { __mmTunnelInfo: true };
		var moveTool = null;

		function onToolActivate() {
			try {
				toolActive = true;
				if (!layer || !layer.isConnected) ensureLayer();
				try { PALD = ClientLib.Data.MainData.GetInstance().get_Server().get_POIActivationLevelDifference(); } catch (e) { PALD = 0; }
				try { myOffense = ClientLib.Data.MainData.GetInstance().get_Cities().get_CurrentOwnCity().get_LvlOffense(); } catch (e) { myOffense = 0; }
				if (!stopWatch) {
					stopWatch = MM.map.watch({
						onChange: function (st) {
							try { if (st && st.region) reprojectAll(); else { if (layer) layer.style.display = "none"; } }
							catch (e) { werr("watch onChange:", e); }
						}
					});
				}
				wlog("move tool active. offense", myOffense, "PALD", PALD);
			} catch (e) { werr("onToolActivate:", e); }
		}
		function onToolDeactivate() {
			try {
				toolActive = false;
				lastCandidate = null;
				clearMarkers();
				hideMoveInfoPanel();
				if (layer) layer.style.display = "none";
				if (stopWatch) { try { stopWatch(); } catch (e) {} stopWatch = null; }
				wlog("move tool deactivated.");
			} catch (e) { werr("onToolDeactivate:", e); }
		}
		function onToolCellChange(startX, startY) {
			try {
				if (!toolActive) return;
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
			body.add(new qx.ui.basic.Label("While moving a base, show tunnel activation:").set({
				rich: true, textColor: "#9fb4c0", font: new qx.bom.Font(12, ["sans-serif"]).set({ bold: true })
			}));
			body.add(new qx.ui.basic.Label("Green = your offense can activate it · Red = blocked (offense too low)").set({
				rich: true, textColor: "#9fb4c0"
			}));

			// range override row
			var rangeRow = new qx.ui.container.Composite(new qx.ui.layout.HBox(6)).set({ marginTop: 4 });
			rangeRow.add(new qx.ui.basic.Label("Range override:").set({ textColor: "#e8e8e8", alignY: "middle" }));
			var spin = new qx.ui.form.Spinner(0, getS("TunnelInfo.rangeOverride", 0), 50).set({ width: 60 });
			spin.addListener("changeValue", function (e) { setS("TunnelInfo.rangeOverride", e.getData() | 0); redrawLast(); });
			rangeRow.add(spin);
			rangeRow.add(new qx.ui.basic.Label("(0 = auto from alliance [tir], else 6)").set({ textColor: "#9fb4c0", alignY: "middle", rich: true }));
			body.add(rangeRow);

			var panelCb = new qx.ui.form.CheckBox("Show the Offense / Required level readout in the move panel").set({ value: showPanel(), textColor: "#e8e8e8" });
			panelCb.addListener("changeValue", function (e) { setS("TunnelInfo.showPanel", e.getData() === true); if (e.getData() === true) redrawLast(); else hideMoveInfoPanel(); });
			body.add(panelCb);

			body.add(new qx.ui.core.Widget().set({ height: 1, backgroundColor: "#3a4248", marginTop: 4, marginBottom: 2, allowGrowX: true }));
			var master = new qx.ui.form.CheckBox("Master: enable the tunnel overlay").set({ value: masterOn(), textColor: "#e8e8e8" });
			master.addListener("changeValue", function (e) {
				setS("TunnelInfo.enabled", e.getData() === true);
				if (e.getData() === true) redrawLast(); else { clearMarkers(); hideMoveInfoPanel(); }
			});
			body.add(master);

			var win = MM.ui.Window({
				caption: "Tunnel Info", key: "TunnelInfo.Window",
				layout: new qx.ui.layout.VBox(), pos: [300, 160], resizable: false, restoreOpen: true, dock: true
			});
			if (!win) { werr("options window creation failed"); return; }
			win.add(body);
			MM.buttons.register({
				id: "mm-tunnel-info", label: "Tunnel Info",
				tooltip: "Show which tunnels you can activate while moving a base",
				onExecute: function () { try { if (win.isVisible()) win.close(); else win.open(); } catch (e) { werr("toggle failed:", e); } }
			});
			wlog("options panel ready.");
		}

		// ---- bring-up --------------------------------------------------------------
		window.MM_TUNNELINFO_INSTALLED = false;
		var tries = 0;
		function poll() {
			try {
				var app = (typeof qx !== "undefined" && qx.core && qx.core.Init) ? qx.core.Init.getApplication() : null;
				var uiReady = app && app.getMenuBar && app.getMenuBar();
				MM = window.MMCommon || MM;
				var ready = uiReady && MM && MM.map && MM.coords && MM.net && MM.ui && MM.buttons && MM.map.ready();
				if (ready) {
					ensureLayer();
					if (layer) layer.style.display = "none"; // hidden until a move starts
					if (!attachTool()) { wwarn("move-base tool not available yet; retrying..."); tries++; if (tries < 120) window.setTimeout(poll, 1000); return; }
					buildOptions();
					window.MM_TUNNELINFO_INSTALLED = true;
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
		el.textContent = "(" + TI_main.toString() + ")();";
		if (/commandandconquer\.com/i.test(document.domain)) {
			(document.head || document.documentElement).appendChild(el);
		}
	} catch (e) {
		try { console.error("[MM Tunnel Info] init error:", e); } catch (_) {}
	}
})();
