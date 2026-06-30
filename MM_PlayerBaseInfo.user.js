// ==UserScript==
// @name         MM - Off/Def Bubbles
// @namespace    https://cncapp*.alliances.commandandconquer.com/*/index.aspx*
// @include      https://cncapp*.alliances.commandandconquer.com/*/index.aspx*
// @description  Draws a live on-map overlay of small bubbles showing Offense / Defense level (stacked) over every visible player base in region view (own / alliance / enemy). Off/def for other players' bases is surveyed in the background; a base's bubble only appears once its values are known. Bubbles track the map as you pan and zoom. A HUD options panel toggles which base types show.
// @version      1.2.10
// @author       XDaast
// @contributor  NetquiK (https://github.com/netquik)
// @contributor  MikeyMike
// @updateURL    https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/MM_PlayerBaseInfo.user.js
// @downloadURL  https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/MM_PlayerBaseInfo.user.js
// ==/UserScript==

/*
 * MM - Off/Def Bubbles
 * ---------------------
 * WHAT IT DOES
 *   In the region (overworld) view it overlays a small bubble over every visible PLAYER
 *   base showing its Offense and Defense level (stacked, O over D), colour-cued by
 *   relationship: cyan = your own, green = alliance, orange = enemy. The bubbles are
 *   anchored to the map via the game's own world->screen projection, so they stay glued
 *   to their bases as you pan and zoom.
 *
 *   Offense/Defense for other players' bases isn't known until each base's detail is
 *   surveyed from the server, so the overlay loads them in the background and a base's
 *   bubble only appears once its values are in (no "loading" clutter). Results are cached
 *   so panning back doesn't re-fetch. A HUD-tray "Off/Def Bubbles" button opens an
 *   options panel to pick which relationships show, with a master on/off.
 *
 * WHY IT'S NEEDED
 *   Offense/defense level is the fastest read on whether a base is a soft farm or a hard
 *   target. Seeing it on every base at once - without clicking each one - makes scanning
 *   the map for targets instant.
 *
 * HISTORY
 *   Started as XDaast's "CENTER DRIVEN Base Info" (inline off/def on the selected-base
 *   status panel; "Marker Fix" by NetquiK). Rebuilt for the MikeyMike pack into a live
 *   multi-base map overlay. The single-selection panel couldn't do this: you pan by
 *   dragging empty map, which deselects the base and closes its panel.
 *
 *   1.2.6: corrected the survey side-effect fix. Direct measurement (2026-06-21, live)
 *   proved set_CurrentCityId does NOT move the region camera - the earlier "camera nudge
 *   feedback loop" theory was wrong. The real harmful side-effect is current-city
 *   EVICTION: the survey's set_CurrentCityId frees the previously-current base's data, and
 *   if the game's RegionCityInfo/StatusInfo panel is open on a base (it binds the city via
 *   setObject), evicting that base crashes the game's closeCityInfo (remove_Change on the
 *   now-null city). Fix: pause the survey whenever a base info/status panel is actually
 *   on-screen, so we never evict a panel's bound base.
 *
 * DEPENDENCIES (pack rule: wrapper + Common Library only)
 *   All the heavy lifting lives in MM - Common Library:
 *     MMCommon.map.*  - world<->screen projection, visibleBases(), watch() (safe camera poll)
 *     MMCommon.base.* - ownIdMap(), relationship(id,ncity), fetchDetail(id,cb) (async survey)
 *   This script only owns the bubble DOM + options panel. No dependency on any other userscript.
 *
 * Settings (MMCommon.settings, per player+world): PlayerBaseInfo.* (master + per-type + window geom).
 * Debug: window.PLAYERBASEINFO_DEBUG = true (or window.MM_DEBUG = true).
 */

(function () {
	var PBI_main = function () {
		// ---- logger ----------------------------------------------------------------
		// i18n fallback: hoisted so MMt() is always defined even if the Common Library's global
		// loads after this script (extension injection order isn't guaranteed). Identity in English.
		function MMt(s){try{return (window.MMCommon&&window.MMCommon.i18n)?window.MMCommon.i18n.t(s):s;}catch(e){return s;}}
		var LOG = (window.MMCommon && window.MMCommon.makeLogger)
			? window.MMCommon.makeLogger("Off/Def Bubbles")
			: {
				log: function () {},
				warn: function () { try { console.warn.apply(console, ["[MM Off/Def Bubbles]"].concat([].slice.call(arguments))); } catch (e) {} },
				err: function () { try { console.error.apply(console, ["[MM Off/Def Bubbles]"].concat([].slice.call(arguments))); } catch (e) {} }
			};
		if (typeof window.PLAYERBASEINFO_DEBUG === "undefined") {
			try { window.PLAYERBASEINFO_DEBUG = (window.localStorage.getItem("PLAYERBASEINFO_DEBUG") === "1"); } catch (e) { window.PLAYERBASEINFO_DEBUG = false; }
		}
		var wlog = function () { if (!(window.PLAYERBASEINFO_DEBUG || window.MM_DEBUG)) return; LOG.log.apply(LOG, arguments); };
		var wwarn = function () { LOG.warn.apply(LOG, arguments); };
		var werr = function () { LOG.err.apply(LOG, arguments); };

		var MM = window.MMCommon || null;

		// ---- settings --------------------------------------------------------------
		function getS(k, d) { try { return (MM && MM.settings) ? MM.settings.get(k, d) : d; } catch (e) { return d; } }
		function setS(k, v) { try { if (MM && MM.settings) MM.settings.set(k, v); } catch (e) {} }
		function masterOn() { return getS("PlayerBaseInfo.bubble", true) === true; }
		function typeOn(type) { return masterOn() && getS("PlayerBaseInfo." + type, true) === true; }

		// ---- detail cache + background survey (delegates the poll to MMCommon.base) -
		var cache = {};   // id -> { type, ghost, name, off, def }   (final, reused across pans)
		var pending = {};
		var queue = [];
		var active = 0;
		// MUST be 1: fetchDetail triggers the load via the single shared current-city pointer
		// (set_CurrentCityId), so surveys have to run one at a time or they thrash each other.
		var MAX_ACTIVE = 1;
		var surveyRestoreId = null; // current-city id to restore when the survey queue drains (usually -1)
		var lastOwnMap = null;      // most recent ownIdMap, so a deferred survey can be resumed
		var surveyDeferred = false; // true while the survey is paused because a base info panel is open
		var scriptEnabled = true;   // CnC Pack / options-page enable bit (CNCTA_ENABLED). false = live-disabled: no survey, no overlay, no refresh needed

		function ownToCache(id, ownMap) {
			var c = ownMap[id];
			try {
				cache[id] = { type: "own", ghost: false, name: c.get_Name(), off: c.get_LvlOffense().toFixed(2), def: c.get_LvlDefense().toFixed(2) };
			} catch (e) { cache[id] = { type: "own", err: true, off: "?", def: "?" }; }
		}
		function requestDetail(id, ownMap) {
			if (cache[id] || pending[id]) return;
			pending[id] = true; queue.push(id); pump(ownMap);
		}
		function pump(ownMap) {
			lastOwnMap = ownMap;
			// Live-disabled from the CnC Pack menu / options page: drop the queue, release any base we're
			// holding as "current", and stop. No survey churn until re-enabled (no game refresh required).
			if (!scriptEnabled) {
				queue.length = 0;
				for (var dk in pending) delete pending[dk];
				if (surveyRestoreId !== null) { try { MM.base.setCurrentCityId(surveyRestoreId); } catch (e) {} surveyRestoreId = null; }
				surveyDeferred = false;
				return;
			}
			// CRITICAL: never touch the shared current-city pointer while the user is in a base/city
			// view. fetchDetail hijacks set_CurrentCityId to trigger loads; if the survey fires that
			// while the game is rendering an open base, it yanks the city out from under the renderer
			// (emblem-only "loading" view + a nextFrame render crash). The moment we're out of region
			// view, drop the queue and let the GAME own current-city (it set it when the base opened).
			// We re-enumerate and re-survey uncached bases when refreshOverlay runs back in region view.
			if (!MM.map.inRegionView()) {
				queue.length = 0;
				for (var pk in pending) delete pending[pk];
				surveyRestoreId = null;
				surveyDeferred = false;
				return;
			}
			// Don't churn the shared current-city pointer while a base info/status panel is actually
			// on-screen. set_CurrentCityId frees the previously-current base's data, and the game's
			// RegionCityInfo/StatusInfo panel binds its base via setObject - evicting that base makes
			// the game's closeCityInfo throw (remove_Change on the now-null city). So we DEFER the
			// survey (keep the queue, don't fire any more loads) until the panel closes; the 150ms
			// popup poll + the 8s backstop resume it. (Measured live 2026-06-21: set_CurrentCityId does
			// NOT move the region camera, so there is nothing to "restore" there - eviction is the only
			// harmful side-effect, and this is what tames it.)
			if (surveyBlocked()) { surveyDeferred = true; return; }
			surveyDeferred = false;
			// remember where "current city" was before we start hijacking it to trigger loads
			if (active === 0 && queue.length && surveyRestoreId === null) {
				surveyRestoreId = MM.base.currentCityId();
			}
			while (active < MAX_ACTIVE && queue.length) {
				var id = queue.shift();
				active++;
				(function (cid) {
					// tighter poll than the default - the ~1.3s server round-trip dominates, but this
					// trims detection lag. Loads MUST stay sequential (single current-city pointer).
					MM.base.fetchDetail(cid, function (ncity) {
						try { onDetail(cid, ncity, ownMap); } catch (e) { werr("onDetail:", e); }
						active--; delete pending[cid]; pump(ownMap);
					}, { intervalMs: 120, tries: 40 });
				})(id);
			}
			// survey drained - stop holding someone else's base as "current"
			if (active === 0 && queue.length === 0 && surveyRestoreId !== null) {
				MM.base.setCurrentCityId(surveyRestoreId);
				surveyRestoreId = null;
			}
		}
		// Relationship from the LIVE vis object (get_AllianceId/IsOwnBase) when the base is on-screen -
		// that's the field the game colours base outlines from, and it classifies alliance members
		// correctly. The detail-city classifier (get_OwnerAllianceId) mis-bucketed alliance-mates as
		// neutral (white bubbles); this fixes that. Falls back to the detail classifier off-screen.
		function relFor(id, ncity, ownMap) {
			try {
				var v = visible[id];
				if (v && MM.map && MM.map.visObjectAt) {
					var vo = MM.map.visObjectAt(v.x, v.y);
					if (vo && MM.base.relationshipFromVis) return MM.base.relationshipFromVis(vo);
				}
			} catch (e) {}
			return MM.base.relationship(id, ncity, ownMap);
		}
		function onDetail(id, ncity, ownMap) {
			if (!ncity) return; // timed out - leave uncached so the backstop retries when it loads
			var ghost = (typeof ncity.get_IsGhostMode === "function" && ncity.get_IsGhostMode());
			if (ghost) { cache[id] = { type: "enemy", ghost: true }; removeBubble(id); return; }
			cache[id] = {
				type: relFor(id, ncity, ownMap), ghost: false,
				name: ncity.get_Name ? ncity.get_Name() : "",
				off: ncity.get_LvlOffense().toFixed(2), def: ncity.get_LvlDefense().toFixed(2)
			};
			showOrUpdate(id); // pops the bubble in now that its values are known
		}

		// ---- overlay DOM -----------------------------------------------------------
		var layer = null;
		var bubbles = {}; // id -> { el }   (only created once a base has surveyed values)
		var visible = {}; // id -> { x, y } for every player base currently in view
		// high-contrast relationship themes (border accent)
		var ACCENT = { own: "#19e3ff", alliance: "#36f05a", neutral: "#ffffff", enemy: "#ff3030", pending: "#8fa0ab" };

		function ensureLayer() {
			var old = document.getElementById("mm_pbi_layer");
			if (old) old.remove();
			layer = document.createElement("div");
			layer.id = "mm_pbi_layer";
			// Slot the overlay just above the map but UNDER all the game's UI chrome. The map canvas is
			// the FIRST child of the game root; every HUD/menu panel is a LATER sibling, and they're all
			// at z-index:10 - stacked purely by DOM order. So we insert our layer right after the canvas
			// container WITH z-index:10 (matching the siblings): DOM order then paints it above the map and
			// below every peripheral panel/menu. (z:auto fails - it loses to the canvas container's z:10.)
			// Falls back to a top-level fixed layer if the game root isn't reachable.
			var placed = false;
			try {
				var app = qx.core.Init.getApplication();
				var ba = app && app.getBackgroundArea && app.getBackgroundArea();
				var baEl = ba && ba.getContentElement && ba.getContentElement().getDomElement();
				if (baEl && baEl.parentNode) {
					layer.style.cssText = "position:absolute;left:0;top:0;right:0;bottom:0;z-index:10;pointer-events:none;overflow:hidden";
					baEl.parentNode.insertBefore(layer, baEl.nextSibling); // right after the map canvas
					placed = true;
				}
			} catch (e) {}
			if (!placed) {
				layer.style.cssText = "position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483000;pointer-events:none;overflow:hidden";
				(document.body || document.documentElement).appendChild(layer);
			}
		}
		function makeBubble() {
			var el = document.createElement("div");
			el.style.cssText = [
				"position:absolute", "transform:translate(-50%,-100%)", "white-space:nowrap",
				"padding:2px 8px 3px", "border:2px solid " + ACCENT.pending, "border-radius:8px",
				"background:rgba(15,20,25,0.9)", "box-shadow:0 2px 7px rgba(0,0,0,0.5)",
				"font:bold 12px sans-serif", "color:#fff", "pointer-events:none"
			].join(";");
			layer.appendChild(el);
			return el;
		}
		// O over D, stacked. (Base level intentionally omitted - shown on the base's own info.)
		function bubbleHtml(d) {
			function line(lbl, val) {
				return '<div style="display:flex;justify-content:space-between;gap:10px;line-height:1.25">'
					+ '<span style="color:#9fb4c0">' + lbl + '</span><span style="color:#fff">' + val + '</span></div>';
			}
			return { acc: ACCENT[d.type] || ACCENT.pending, html: line(MMt("O"), d.off) + line(MMt("D"), d.def) };
		}
		// Create-or-update a base's bubble, but ONLY if it has surveyed values and its type is enabled;
		// otherwise ensure no bubble is shown (this is what prevents "loading" clutter).
		function showOrUpdate(id) {
			var v = visible[id], d = cache[id];
			if (!v || !d || d.ghost || !typeOn(d.type)) { removeBubble(id); return; }
			if (!bubbles[id]) bubbles[id] = { el: makeBubble() };
			var r = bubbleHtml(d);
			var el = bubbles[id].el;
			el.style.borderColor = r.acc;
			el.innerHTML = r.html;
			el.title = (d.name || "") + (d.type ? " (" + d.type + ")" : "");
			el.style.display = "block";
			positionBubble(id);
		}
		function removeBubble(id) {
			var b = bubbles[id];
			if (b && b.el && b.el.parentNode) b.el.parentNode.removeChild(b.el);
			delete bubbles[id];
		}
		function positionBubble(id) {
			var v = visible[id], b = bubbles[id];
			if (!v || !b) return;
			var p = MM.map.worldToScreen(v.x, v.y);
			b.el.style.left = Math.round(p.x) + "px";
			b.el.style.top = (Math.round(p.y) - 6) + "px";
		}
		// The game's region base-detail panels bind their base via setObject. Their class NAMES vary by
		// relationship AND game version - live-sniffed 2026-06-21 the singletons are RegionCityInfo,
		// RegionCityStatusInfo{Own,Alliance,Enemy}, RegionGhostStatusInfo, RegionRuinStatusInfo,
		// RegionNPCBaseStatusInfo, RegionNPCCampStatusInfo, RegionPointOfInterestStatusInfo,
		// RegionNewPlayerSpotStatusInfo, RegionHub*StatusInfo, RegionCityMoveInfo, RegionCityFoundInfo,
		// RegionCitySupportInfo, plus the RegionCityMenu right-click menu. (An earlier hard-coded list had
		// stale names like "RegionNPCBaseInfo" that don't exist, so it silently matched nothing.) So we
		// DISCOVER the panel singletons by name pattern - any webfrontend.gui.region.* whose name marks it
		// a base-detail panel and that exposes getInstance. Computed once and cached.
		var _infoNames = null;
		function infoPanelNames() {
			if (_infoNames) return _infoNames;
			var out = [];
			try {
				var R = webfrontend.gui.region, keys = Object.keys(R);
				for (var i = 0; i < keys.length; i++) {
					var k = keys[i];
					if (!/StatusInfo/.test(k) && k !== "RegionCityInfo" && k !== "RegionCityMoveInfo"
						&& k !== "RegionCityFoundInfo" && k !== "RegionCitySupportInfo") continue;
					try { if (R[k] && typeof R[k].getInstance === "function") out.push(k); } catch (e) {}
				}
			} catch (e) {}
			_infoNames = out;
			return out;
		}
		// Real on-screen rect of a region panel singleton, or null. isVisible() is a cheap pre-filter
		// (skips the layout-forcing rect read when false) but it OVER-reports - several panels report
		// isVisible()===true while off-screen with no DOM element - so confirm with a real DOM rect.
		function infoRect(name) {
			try {
				var W = webfrontend.gui.region[name];
				if (!W || typeof W.getInstance !== "function") return null;
				var inst = W.getInstance();
				if (!inst || typeof inst.isVisible !== "function" || !inst.isVisible()) return null;
				var el = inst.getContentElement && inst.getContentElement().getDomElement();
				if (!el) return null;
				var r = el.getBoundingClientRect();
				return (r.width > 0 && r.height > 0) ? r : null;
			} catch (e) { return null; }
		}
		// A base's info popup / right-click menu shares the bubbles' z-index (everything in this view,
		// incl. the map canvas, is z-index:10), so a bubble overlapping a panel paints ON TOP of it and we
		// can't fix it by stacking (lowering the layer drops it behind the terrain). Instead we hide just
		// the bubbles whose box overlaps an open region popup/menu, so the panel reads cleanly while every
		// other bubble stays put. (Includes the right-click menu, which also overlaps bubbles.)
		function popupRects() {
			var rects = [], names = infoPanelNames();
			for (var i = 0; i < names.length; i++) { var r = infoRect(names[i]); if (r) rects.push(r); }
			var menu = infoRect("RegionCityMenu"); if (menu) rects.push(menu);
			return rects;
		}
		function rectsIntersect(a, b) { return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom); }
		// Is a base info/status panel actually on screen? If so, surveying (set_CurrentCityId) could evict
		// its bound base and crash the game's closeCityInfo, so the survey pauses. (The plain RegionCityMenu
		// right-click menu is intentionally NOT counted - it has no bound base to evict.)
		function surveyBlocked() {
			var names = infoPanelNames();
			for (var i = 0; i < names.length; i++) { if (infoRect(names[i])) return true; }
			return false;
		}
		function updatePopupVisibility() {
			if (!layer || layer.style.display === "none") return;
			// No bubbles -> skip the popup-panel getBoundingClientRect work entirely (the poll still wakes
			// but does zero layout reads). Common while panning before any base is surveyed.
			var any = false; for (var _id in bubbles) { any = true; break; }
			if (!any) return;
			var rects = popupRects();
			if (!rects.length) {
				// nothing open to hide behind: show every bubble without measuring any of them.
				for (var vid in bubbles) { var bv = bubbles[vid]; if (bv && bv.el) bv.el.style.visibility = "visible"; }
				return;
			}
			// BATCH reads then writes: measure every bubble first, then set visibility, so the loop doesn't
			// interleave getBoundingClientRect reads with style writes.
			var pend = [];
			for (var id in bubbles) {
				var b = bubbles[id];
				if (!b || !b.el) continue;
				var hit = false, br = b.el.getBoundingClientRect();
				for (var i = 0; i < rects.length; i++) { if (rectsIntersect(br, rects[i])) { hit = true; break; } }
				pend.push(b.el); pend.push(hit);
			}
			for (var j = 0; j < pend.length; j += 2) { pend[j].style.visibility = pend[j + 1] ? "hidden" : "visible"; }
		}
		function reprojectAll() {
			if (!MM.map.inRegionView()) { if (layer) layer.style.display = "none"; return; }
			if (layer) layer.style.display = "block";
			for (var id in bubbles) positionBubble(id);
			updatePopupVisibility();
		}

		// ---- enumerate visible player bases (via MMCommon.map) ---------------------
		function refreshOverlay() {
			if (!scriptEnabled || !masterOn()) { clearAll(); return; }
			if (!MM.map.inRegionView()) { if (layer) layer.style.display = "none"; return; }
			// self-heal: if qx ever rebuilt the container and dropped our layer, re-create + rebuild
			if (!layer || !layer.isConnected) { ensureLayer(); bubbles = {}; }
			try {
				var ownMap = MM.base.ownIdMap();
				var list = MM.map.visibleBases({ types: [1] }); // player bases only
				// survey screen-centre bases first, so what you're looking at fills in first
				try {
					var cv = document.querySelector("canvas");
					var cr = cv ? cv.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
					var ctr = MM.map.screenToWorld(cr.width / 2, cr.height / 2);
					list.sort(function (a, b) {
						var da = (a.x - ctr.x) * (a.x - ctr.x) + (a.y - ctr.y) * (a.y - ctr.y);
						var db = (b.x - ctr.x) * (b.x - ctr.x) + (b.y - ctr.y) * (b.y - ctr.y);
						return da - db;
					});
				} catch (e) {}
				var nv = {};
				for (var i = 0; i < list.length; i++) {
					var bse = list[i], id = bse.id;
					nv[id] = { x: bse.x, y: bse.y };
					if (ownMap[id] && !cache[id]) ownToCache(id, ownMap);
					else if (!cache[id]) requestDetail(id, ownMap); // survey in the background; no bubble yet
				}
				visible = nv;
				for (var bid in bubbles) { if (!nv[bid]) removeBubble(bid); } // base left view
				for (var vid in visible) { if (cache[vid]) showOrUpdate(vid); } // show only the surveyed ones
				if (layer) layer.style.display = "block";
				wlog("overlay:", list.length, "visible player bases");
			} catch (e) { werr("refreshOverlay failed:", e); }
		}
		function clearAll() {
			for (var id in bubbles) removeBubble(id);
			if (layer) layer.style.display = "none";
		}
		var enumTimer = null;
		function scheduleEnumerate() {
			if (enumTimer) return;
			enumTimer = window.setTimeout(function () { enumTimer = null; refreshOverlay(); }, 140);
		}

		// Popup-overlap poll: hide bubbles sitting under an open base-info panel + resume a survey that was
		// deferred while a panel was open. A popup opening doesn't move the camera, so this can't be
		// event-driven. 250ms (was 150ms) still hides a bubble within a quarter-second of a panel opening -
		// imperceptible - while doing 40% fewer wakeups. Stored so it's torn down on disable (not left
		// ticking) and re-armed on enable.
		var popupTimerId = null;
		function popupTick() {
			try { updatePopupVisibility(); } catch (e) {}
			try { if (surveyDeferred && lastOwnMap && !surveyBlocked()) pump(lastOwnMap); } catch (e) {}
		}
		function startPopupTimer() { if (popupTimerId == null) popupTimerId = window.setInterval(popupTick, 250); }
		function stopPopupTimer() { if (popupTimerId != null) { try { window.clearInterval(popupTimerId); } catch (e) {} popupTimerId = null; } }

		// ---- options panel ---------------------------------------------------------
		function buildOptions() {
			var body = new qx.ui.container.Composite(new qx.ui.layout.VBox(6)).set({ padding: 10, backgroundColor: "#23282b" });
			body.add(new qx.ui.basic.Label(MMt("Show the off/def map bubble for:")).set({
				rich: true, textColor: "#9fb4c0", font: new qx.bom.Font(12, ["sans-serif"]).set({ bold: true })
			}));
			function cb(label, key, def) {
				var c = new qx.ui.form.CheckBox(MMt(label)).set({ value: getS(key, def) === true, textColor: "#e8e8e8" });
				c.addListener("changeValue", function (e) {
					setS(key, e.getData() === true);
					try {
						if (masterOn()) { for (var id in visible) showOrUpdate(id); refreshOverlay(); }
						else clearAll();
					} catch (er) {}
				});
				return c;
			}
			body.add(cb("Own bases", "PlayerBaseInfo.own", true));
			body.add(cb("Alliance bases", "PlayerBaseInfo.alliance", true));
			body.add(cb("Neutral bases (peace/NAP)", "PlayerBaseInfo.neutral", true));
			body.add(cb("Enemy bases", "PlayerBaseInfo.enemy", true));
			body.add(new qx.ui.core.Widget().set({ height: 1, backgroundColor: "#3a4248", marginTop: 4, marginBottom: 2, allowGrowX: true }));
			body.add(cb("Master: show the overlay at all", "PlayerBaseInfo.bubble", true));

			var win = MM.ui.Window({
				caption: MMt("Off/Def Bubbles"), key: "PlayerBaseInfo.Window",
				layout: new qx.ui.layout.VBox(), pos: [260, 140], resizable: false, restoreOpen: true, dock: true
			});
			if (!win) { werr("options window creation failed"); return; }
			win.add(body);
			MM.buttons.register({
				id: "mm-player-base-info", label: MMt("Off/Def Bubbles"),
				tooltip: MMt("On-map off/def bubbles (enemy / alliance / own)"),
				onExecute: function () { try { if (win.isVisible()) win.close(); else win.open(); } catch (e) { werr("toggle failed:", e); } }
			});
			wlog("options panel ready.");
		}

		// ---- bring-up (needs game UI + MMCommon map/base/ui/buttons) ----------------
		window.MM_PBI_INSTALLED = false;
		var tries = 0;
		function poll() {
			try {
				var app = (typeof qx !== "undefined" && qx.core && qx.core.Init) ? qx.core.Init.getApplication() : null;
				var uiReady = app && app.getMenuBar && app.getMenuBar();
				MM = window.MMCommon || MM;
				var ready = uiReady && MM && MM.map && MM.base && MM.ui && MM.buttons && MM.map.ready();
				if (ready) {
					ensureLayer();
					// SAFE tracking: poll the camera (never hook the game's render-path net events).
					MM.map.watch({
						onChange: function (st) {
							try {
								// Reproject only - do NOT re-enumerate here. Re-enumerating would kick the
								// off/def survey, which churns the shared current-city pointer (each
								// set_CurrentCityId evicts the prior base's data). Doing that on every camera
								// tick was wasteful churn (the old "overlay: N visible" console spam) and
								// raised the eviction-crash odds. New bases scrolling into view are picked up
								// by the 8s backstop below instead. (Note: the camera moves here come from the
								// USER panning/zooming - measured 2026-06-21, set_CurrentCityId itself does not
								// move the camera, so this is not a self-driven feedback loop.)
								if (st.region) reprojectAll();
								else clearAll();
							} catch (e) { werr("watch onChange:", e); }
						}
					});
					refreshOverlay();
					// backstop: re-survey (bases finish loading, off/def changes) every 8s in region view
					try { qx.util.TimerManager.getInstance().start(function () { if (masterOn() && MM.map.inRegionView()) refreshOverlay(); }, 8000, this, null, 8000); }
					catch (e) { window.setInterval(function () { if (masterOn() && MM.map.inRegionView()) refreshOverlay(); }, 8000); }
					// hide bubbles sitting under an open base-info popup / right-click menu - poll, since a
					// popup opening doesn't move the camera and so wouldn't trigger reprojectAll above.
					// Same poll resumes a survey that was deferred while a base info panel was open (the
					// pump() eviction guard) the moment that panel closes.
					startPopupTimer();
					// React to being toggled in the CnC Pack menu / options page WITHOUT a refresh: on
					// disable, tear down the survey + overlay; on re-enable (same session), resume.
					try {
						if (MM.lifecycle && MM.lifecycle.watch) {
							MM.lifecycle.watch(10076, {
								onDisable: function () {
									wlog("disabled via CnC Pack menu - stopping survey + clearing overlay");
									scriptEnabled = false;
									stopPopupTimer();
									queue.length = 0;
									for (var dk in pending) delete pending[dk];
									if (surveyRestoreId !== null) { try { MM.base.setCurrentCityId(surveyRestoreId); } catch (e) {} surveyRestoreId = null; }
									surveyDeferred = false;
									clearAll();
								},
								onEnable: function () {
									wlog("re-enabled via CnC Pack menu - resuming overlay");
									scriptEnabled = true;
									startPopupTimer();
									refreshOverlay();
								}
							});
						}
					} catch (e) { werr("lifecycle watch:", e); }
					buildOptions();
					window.MM_PBI_INSTALLED = true;
					wlog("overlay engine installed.");
					return;
				}
			} catch (e) { werr("poll error:", e); }
			tries++;
			if (tries === 40) wwarn("still waiting for game UI / MM - Common Library map module...");
			if (tries < 120) window.setTimeout(poll, 1000);
			else wwarn("gave up waiting for the region projection API / Common Library.");
		}
		window.setTimeout(poll, 1000);
	};

	// inject into PAGE context
	try {
		var el = document.createElement("script");
		el.type = "text/javascript";
		el.textContent = "(" + PBI_main.toString() + ")();";
		if (/commandandconquer\.com/i.test(document.domain)) {
			(document.head || document.documentElement).appendChild(el);
		}
	} catch (e) {
		try { console.error("[MM Off/Def Bubbles] init error:", e); } catch (_) {}
	}
})();
