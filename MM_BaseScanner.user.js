// ==UserScript==
// @name            MM - Base Scanner
// @description     Scan every attackable base/camp/outpost within range of one of your bases and rank them for farming and capture: loot (Tib/Cry/Credits/Research), command-point cost, loot-per-CP efficiency, resource-field counts, perfect-layout flags, Construction-Yard / Defense-Facility row, and building/defense condition. Rebuilt on the MM - Common Library (no MaelstromTools dependency).
// @author          BlinDManX, chertosha, Netquik, kad (original Maelstrom ADDON Basescanner AIO)
// @contributor     MikeyMike (CnCTA-MikeyMike-SCRIPT-PACK)
// @version         1.0.4
// @match           https://*.alliances.commandandconquer.com/*/index.aspx*
// @downloadURL     https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/MM_BaseScanner.user.js
// @updateURL       https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/MM_BaseScanner.user.js
// ==/UserScript==

/*
================================================================================
 MM - Base Scanner
================================================================================
 The mirror of MM - Base Tools: where Base Tools manages YOUR bases, this scans
 EVERYONE ELSE's. Pick one of your bases as the origin, set a CP-cost ceiling and
 a minimum level, choose which target types to include (players / NPC bases /
 outposts / camps), and hit Scan. It walks every map tile within your server's
 max attack distance of that base and builds a sortable table of targets.

 Columns:
   City / Loc / Lvl      - name, coordinates, base level
   Tib / Cry / $ / RP    - lootable resources (repair-cost value x current HP%)
   Sum                   - Tib + Cry + Credits loot
   CP                    - command-point cost to attack from the origin base
   Sum/CP                - loot efficiency per command point (default sort)
   Bld% / Def%           - building / defense condition
   TibF / CryF           - tiberium / crystal field counts (capture value)
   Pow8                  - count of tiles fully surrounded by 8 free tiles (power)
   Tib|Cry|Mix 7..4      - perfect-harvester-spot layout flags (7/6/5/4 neighbors)
   CY / DF               - row (1-8 from front) of the Construction Yard / Defense
                           Facility (front-row = easier to hit)
   Found                 - whether you could found a base on that tile
   Rule Out              - per-row checkbox to grey out / dismiss a target

 Two-phase scan (faithful to the original engine): phase 1 enumerates positions +
 CP cost synchronously (MMCommon.scan.inRange); phase 2 loads each base's detail
 ASYNCHRONOUSLY (GetCity returns version:-1 until the server round-trip lands), so
 the table fills in progressively, then re-sorts. Allied / ghost / no-data bases
 drop out during the fill. Loot via MMCommon.loot.ofCity.

 NOT YET PORTED: the original "Growth Rate" column (the CNCOPTplus growth-optimizer
 estimate). That is ~300 lines of era-stale optimizer math that overlaps the
 live-calibrated Layout Optimizer already in MM - Base Tools; it will be wired to
 that model rather than copied. Everything else from the AIO scanner is here.

 Credit: descends from the "Maelstrom ADDON Basescanner AIO" by BlinDManX,
 chertosha, Netquik and kad. This is a ground-up MikeyMike rebuild on MMCommon -
 reimplemented as plain functions, and cut free of the MaelstromTools framework
 the original required.

 Settings (MMCommon.settings, per player+world): BaseScanner.* (origin base, CP
 limit, min level, type toggles, column widths, window geometry, open state).

 Debug: window.MMBASESCANNER_DEBUG = true  (or window.MM_DEBUG = true) for verbose
        [MM Base Scanner] logs.
================================================================================
*/

(function () {
    var BaseScanner_main = function () {
        // i18n fallback: hoisted so MMt() is always defined even if the Common Library's global
        // loads after this script (extension injection order isn't guaranteed). Identity in English.
        function MMt(s){try{return (window.MMCommon&&window.MMCommon.i18n)?window.MMCommon.i18n.t(s):s;}catch(e){return s;}}
        var LOG = (window.MMCommon && window.MMCommon.makeLogger)
            ? window.MMCommon.makeLogger("Base Scanner")
            : { log: function () {}, warn: function () { try { console.warn.apply(console, arguments); } catch (e) {} }, err: function () { try { console.error.apply(console, arguments); } catch (e) {} } };

        if (typeof window.MMBASESCANNER_DEBUG === "undefined") {
            try { window.MMBASESCANNER_DEBUG = (window.localStorage.getItem("MMBASESCANNER_DEBUG") === "1"); } catch (e) { window.MMBASESCANNER_DEBUG = false; }
        }
        var wlog = function () { if (!(window.MMBASESCANNER_DEBUG || window.MM_DEBUG)) return; LOG.log.apply(LOG, arguments); };
        var wwarn = function () { LOG.warn.apply(LOG, arguments); };
        var werr = function () { LOG.err.apply(LOG, arguments); };

        var MM = window.MMCommon;
        var SET = "BaseScanner.";

        // ---- column model -------------------------------------------------------------
        // index: header, type ('num' compact-formatted, 'int' plain, 'pct', 'bool', 'str')
        var COLS = [
            { h: MMt("ID"),       t: "int",  hide: true },  // 0
            { h: MMt("City"),     t: "str"  },               // 1
            { h: MMt("Loc"),      t: "str"  },               // 2
            { h: MMt("Lvl"),      t: "int"  },               // 3
            { h: MMt("Tib"),      t: "num"  },               // 4
            { h: MMt("Cry"),      t: "num"  },               // 5
            { h: "$",        t: "num"  },               // 6
            { h: MMt("RP"),       t: "num"  },               // 7
            { h: MMt("Sum"),      t: "num"  },               // 8
            { h: MMt("CP"),       t: "int"  },               // 9
            { h: MMt("Sum/CP"),   t: "num"  },               // 10
            { h: MMt("Bld%"),     t: "pct"  },               // 11
            { h: MMt("Def%"),     t: "pct"  },               // 12
            { h: MMt("TibF"),     t: "int"  },               // 13
            { h: MMt("CryF"),     t: "int"  },               // 14
            { h: MMt("Pow8"),     t: "int"  },               // 15
            { h: MMt("Tib 7|6|5|4"), t: "str" },             // 16
            { h: MMt("Cry 7|6|5|4"), t: "str" },             // 17
            { h: MMt("Mix 7|6|5|4"), t: "str" },             // 18
            { h: MMt("CY"),       t: "int"  },               // 19
            { h: MMt("DF"),       t: "int"  },               // 20
            { h: MMt("Found"),    t: "bool" },               // 21
            { h: MMt("Type"),     t: "str"  },               // 22
            { h: MMt("Rule Out"), t: "bool" }                // 23
        ];
        var C = { ID: 0, CITY: 1, LOC: 2, LVL: 3, TIB: 4, CRY: 5, GOLD: 6, RP: 7, SUM: 8, CP: 9, SUMCP: 10,
                  BLD: 11, DEF: 12, TIBF: 13, CRYF: 14, POW8: 15, TIBL: 16, CRYL: 17, MIXL: 18,
                  CY: 19, DF: 20, FOUND: 21, TYPE: 22, RULE: 23 };
        var COL_COUNT = COLS.length;
        var DEFAULT_SORT = C.SUMCP; // best loot-per-CP first

        // Construction-Yard and Defense-Facility MdbUnitIds across GDI / NOD / Forgotten.
        var CY_IDS = { 112: 1, 151: 1, 177: 1 };
        var DF_IDS = { 158: 1, 131: 1, 195: 1 };

        // ---- helpers ------------------------------------------------------------------
        function md() { return ClientLib.Data.MainData.GetInstance(); }
        function cities() { return md().get_Cities(); }

        function ownCities() {
            var out = [];
            try {
                var arr = cities().get_AllCities();
                var d = arr && arr.d;
                for (var k in d) {
                    var c = d[k];
                    try { if (c && c.IsOwnBase && c.IsOwnBase()) out.push(c); } catch (e) {}
                }
            } catch (e) { werr("ownCities failed:", e); }
            return out;
        }

        function typeLabel(type, campType) {
            if (type === 1) return MMt("Player");
            if (type === 2) return MMt("Base");
            if (type === 3) {
                if (campType === 3) return MMt("Outpost");
                if (campType === 7) return MMt("Infected");
                return MMt("Camp");
            }
            return "?";
        }

        // Is this scanned city a valid target (NOT our own alliance / not an ally via diplomacy)?
        // Faithful port of the AIO FG alliance re-check (this is the authoritative pass).
        function isAllied(ncity, originCity) {
            try {
                var ownAlliance = originCity.get_AllianceId();
                var theirAlliance = ncity.get_OwnerAllianceId();
                if (!theirAlliance || !ownAlliance) return false;          // no alliance involved -> fair game
                if (theirAlliance === ownAlliance) return true;            // same alliance -> ally
                var rel = md().get_Alliance().get_Relationships();
                if (rel) {
                    for (var k in rel) {
                        var r = rel[k];
                        if (r && r.OtherAllianceId === theirAlliance && (r.Relationship === 1 || r.Relationship === 2)) return true; // NAP / ally
                    }
                }
            } catch (e) { wwarn("isAllied check failed:", e); }
            return false;
        }

        // Resource-field layout analysis - faithful port of the AIO field-counting block.
        // Walks the 9x8 base grid via GetResourceType (0=empty, 1 & 2 = the two resource types)
        // and for each empty interior tile counts how many resource / free neighbours it has,
        // classifying it as a 7/6/5/4-neighbour perfect harvester spot (tib / cry / mixed) and a
        // power tile (8 free neighbours). Returns counts + the per-resource field totals.
        function analyzeFields(ncity) {
            var totC = 0, totT = 0;
            var tib4 = 0, tib5 = 0, tib6 = 0, tib7 = 0;
            var cry4 = 0, cry5 = 0, cry6 = 0, cry7 = 0;
            var mix4 = 0, mix5 = 0, mix6 = 0, mix7 = 0, mix8 = 0;
            var pow8 = 0, powL = {};
            function rt(x, y) { try { return ncity.GetResourceType(x, y); } catch (e) { return -1; } }
            function free(x, y) { return !((x + "," + y) in powL); }
            var NB = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
            for (var y = 0; y < 8; y++) {
                for (var x = 0; x < 9; x++) {
                    switch (rt(x, y)) {
                        case 0:
                            var cntT = 0, cntC = 0, cntM = 0, cntP = 0;
                            if (y > 0 && y < 7 && x > 0 && x < 8) {
                                for (var n = 0; n < 8; n++) {
                                    var nx = x + NB[n][0], ny = y + NB[n][1];
                                    var t = rt(nx, ny);
                                    if (t === 2) { cntC++; cntM++; }
                                    else if (t === 1) { cntT++; cntM++; }
                                    else if (t === 0 && free(nx, ny)) cntP++;
                                }
                            }
                            if (cntC === 4) { tib4++; mix4--; }
                            if (cntC === 5) { tib5++; mix5--; }
                            if (cntC === 6) { tib6++; mix6--; }
                            if (cntC === 7) { tib7++; mix7--; }
                            if (cntT === 4) { cry4++; mix4--; }
                            if (cntT === 5) { cry5++; mix5--; }
                            if (cntT === 6) { cry6++; mix6--; }
                            if (cntT === 7) { cry7++; mix7--; }
                            if (cntM === 4) mix4++;
                            if (cntM === 5) mix5++;
                            if (cntM === 6) mix6++;
                            if (cntM === 7) mix7++;
                            if (cntM === 8) mix8++;
                            if (cntP === 8) { pow8++; powL[x + "," + y] = 1; }
                            break;
                        case 1: totC++; break;
                        case 2: totT++; break;
                    }
                }
            }
            return {
                totC: totC, totT: totT, pow8: pow8,
                tibStr: tib7 + " | " + tib6 + " | " + tib5 + " | " + tib4,
                cryStr: cry7 + " | " + cry6 + " | " + cry5 + " | " + cry4,
                mixStr: mix7 + " | " + mix6 + " | " + mix5 + " | " + mix4
            };
        }

        // Find Construction-Yard / Defense-Facility rows (8 - CoordY = row from front).
        function findKeyBuildings(ncity) {
            var out = { cy: null, df: null };
            try {
                var b = ncity.get_Buildings();
                var d = b && b.d;
                for (var k in d) {
                    var u = d[k];
                    if (!u || typeof u.get_MdbUnitId !== "function") continue;
                    var mid = u.get_MdbUnitId();
                    if (CY_IDS[mid]) out.cy = 8 - u.get_CoordY();
                    else if (DF_IDS[mid]) out.df = 8 - u.get_CoordY();
                }
            } catch (e) { wwarn("findKeyBuildings failed:", e); }
            return out;
        }

        // ---- table renderers (defined once) -------------------------------------------
        function defineRenderers() {
            try {
                if (!qx.Class.isDefined("MMScanNumR")) {
                    qx.Class.define("MMScanNumR", {
                        extend: qx.ui.table.cellrenderer.Default,
                        members: {
                            _getContentHtml: function (cellInfo) {
                                var v = cellInfo.value;
                                if (v == null || v === "" || isNaN(v)) return "";
                                try { return MM.num.compact(v); } catch (e) { return String(Math.round(v)); }
                            },
                            _getCellClass: function () { return "qooxdoo-table-cell qooxdoo-table-cell-right"; }
                        }
                    });
                }
                if (!qx.Class.isDefined("MMScanPctR")) {
                    qx.Class.define("MMScanPctR", {
                        extend: qx.ui.table.cellrenderer.Default,
                        members: {
                            _getContentHtml: function (cellInfo) {
                                var v = cellInfo.value;
                                if (v == null || v === "" || isNaN(v)) return "";
                                return Math.round(v) + "%";
                            },
                            _getCellClass: function () { return "qooxdoo-table-cell qooxdoo-table-cell-right"; }
                        }
                    });
                }
                // Link-style renderer for the clickable Loc column.
                if (!qx.Class.isDefined("MMScanLinkR")) {
                    qx.Class.define("MMScanLinkR", {
                        extend: qx.ui.table.cellrenderer.Default,
                        members: {
                            _getContentHtml: function (cellInfo) {
                                var v = cellInfo.value;
                                if (v == null || v === "") return "";
                                var s = qx.bom.String.escape(String(v));
                                return "<span style='color:#7fc1ff;text-decoration:underline;cursor:pointer'>" + s + "</span>";
                            }
                        }
                    });
                }
                // Resource-spot shading for the Tib / Cry columns. Each cell holds "n7 | n6 | n5 | n4"
                // perfect-harvester-spot counts; shade by the BEST tier present (more resource
                // neighbours = better spot, so higher tiers win): any 7 -> light bright green,
                // else any 6 -> light blue, else any 5 -> light amber, else any 4 -> light yellow.
                // No nonzero count -> no shading (unchanged cell).
                if (!qx.Class.isDefined("MMScanSpotR")) {
                    qx.Class.define("MMScanSpotR", {
                        extend: qx.ui.table.cellrenderer.Default,
                        members: {
                            _spotColor: function (v) {
                                if (v == null || v === "") return null;
                                var p = String(v).split("|");
                                if (p.length < 4) return null;
                                if ((parseInt(p[0], 10) || 0) > 0) return "#9af09a"; // 7 - light bright green
                                if ((parseInt(p[1], 10) || 0) > 0) return "#acd8ff"; // 6 - light blue
                                if ((parseInt(p[2], 10) || 0) > 0) return "#ffd591"; // 5 - light amber
                                if ((parseInt(p[3], 10) || 0) > 0) return "#fff6a6"; // 4 - light yellow
                                return null;
                            },
                            _getCellStyle: function (cellInfo) {
                                var s = this.base(arguments, cellInfo) || "";
                                var c = this._spotColor(cellInfo.value);
                                if (c) s += "background-color:" + c + ";color:#111;";
                                return s;
                            }
                        }
                    });
                }
                // Row renderer: grey out ruled-out rows.
                if (!qx.Class.isDefined("MMScanRowR")) {
                    qx.Class.define("MMScanRowR", {
                        extend: qx.ui.table.rowrenderer.Default,
                        members: {
                            updateDataRowElement: function (rowInfo, rowElem) {
                                this.base(arguments, rowInfo, rowElem);
                                try {
                                    if (!(rowInfo.focusedRow && this.getHighlightFocusRow()) && !rowInfo.selected) {
                                        if (rowInfo.rowData[C.RULE] === true) rowElem.style.backgroundColor = "#555";
                                    }
                                } catch (e) {}
                            }
                        }
                    });
                }
            } catch (e) { werr("defineRenderers failed:", e); }
        }

        // ---- build UI -----------------------------------------------------------------
        function build() {
            wlog("building UI");
            defineRenderers();

            var data = [];          // array of row-arrays (length COL_COUNT)
            var scanning = false;
            var fillToken = 0;      // bumped to cancel an in-flight async fill
            var scanOriginOwnId = null; // own-base id to restore as "current" when a scan ends/stops

            // ---- table ----
            var tableModel = new qx.ui.table.model.Simple();
            var headers = [];
            for (var i = 0; i < COLS.length; i++) headers.push(COLS[i].h);
            tableModel.setColumns(headers);

            var table = new qx.ui.table.Table(tableModel)
                .set({ statusBarVisible: false, showCellFocusIndicator: false, columnVisibilityButtonVisible: true });
            try { table.setDataRowRenderer(new MMScanRowR(table)); } catch (e) {}

            // sensible first-run widths by column type
            var DEFW = { str: 120, num: 64, pct: 50, int: 44, bool: 50 };
            var tcm = table.getTableColumnModel();
            for (var ci = 0; ci < COLS.length; ci++) {
                try {
                    var def = COLS[ci];
                    if (ci === C.LOC) tcm.setDataCellRenderer(ci, new MMScanLinkR());
                    else if (ci === C.TIBL || ci === C.CRYL) tcm.setDataCellRenderer(ci, new MMScanSpotR());
                    else if (def.t === "num") tcm.setDataCellRenderer(ci, new MMScanNumR());
                    else if (def.t === "pct") tcm.setDataCellRenderer(ci, new MMScanPctR());
                    else if (def.t === "bool") tcm.setDataCellRenderer(ci, new qx.ui.table.cellrenderer.Boolean());
                    // persisted column width, else a type-based default
                    var w = MM.settings.get(SET + "colW." + ci, null);
                    tcm.setColumnWidth(ci, w || (def.h.length > 6 ? 78 : (DEFW[def.t] || 60)));
                    if (def.hide) tcm.setColumnVisible(ci, false);
                } catch (e) { wwarn("column setup", ci, e); }
            }
            // persist column-width changes
            try {
                tcm.addListener("widthChanged", function (e) {
                    try { var dd = e.getData(); MM.settings.set(SET + "colW." + dd.col, dd.newWidth); } catch (x) {}
                });
            } catch (e) {}

            // Jump to a row's base on the region map (switch to area view + center on its coords).
            function gotoRow(row) {
                try {
                    var loc = tableModel.getValue(C.LOC, row);
                    if (!loc) return;
                    var p = loc.split(":");
                    if (MM.coords && MM.coords.goTo) MM.coords.goTo(parseInt(p[0], 10), parseInt(p[1], 10));
                } catch (x) { wwarn("gotoRow failed:", x); }
            }
            // Click the Loc cell -> jump there; click the Rule-Out cell -> toggle it.
            // (Double-click any cell also jumps, as a convenience.)
            try {
                table.addListener("cellTap", function (ev) {
                    try {
                        var col = ev.getColumn(), row = ev.getRow();
                        if (col === C.RULE) {
                            var cur = tableModel.getValue(C.RULE, row);
                            tableModel.setValue(C.RULE, row, !cur);
                            table.getSelectionModel().resetSelection();
                            // keep the data row in sync (rerender/bubbles read from `data`) + drop/add its bubble
                            try {
                                var id = tableModel.getValue(C.ID, row);
                                for (var di = 0; di < data.length; di++) { if (data[di][C.ID] === id) { data[di][C.RULE] = !cur; break; } }
                            } catch (x2) {}
                            try { if (bubblesOn()) refreshBubbles(); } catch (x3) {}
                        } else if (col === C.LOC) {
                            gotoRow(row);
                        }
                    } catch (x) {}
                });
                table.addListener("cellDbltap", function (ev) { try { gotoRow(ev.getRow()); } catch (x) {} });
            } catch (e) { wwarn("table listeners failed:", e); }

            // ---- controls (Flow layout so the row never pins the window min-width) ----
            // The window content pane is transparent (the game map shows through), so the controls
            // row needs its own solid dark background and light text to be readable.
            var TXT = "#e8e8e8";
            var controls = new qx.ui.container.Composite(new qx.ui.layout.Flow(6, 4))
                .set({ padding: 5, backgroundColor: "#23282b" });

            function lbl(t) { return new qx.ui.basic.Label(t).set({ alignY: "middle", textColor: TXT, font: new qx.bom.Font(12, ["sans-serif"]).set({ bold: true }) }); }

            // origin base selector
            var baseSelect = new qx.ui.form.SelectBox().set({ width: 150, maxHeight: 26 });
            function rebuildBaseSelect() {
                try {
                    baseSelect.removeAll();
                    var savedId = MM.settings.get(SET + "originId", null);
                    var list = ownCities();
                    for (var i = 0; i < list.length; i++) {
                        var c = list[i];
                        var it = new qx.ui.form.ListItem(c.get_Name() + " (" + c.get_PosX() + ":" + c.get_PosY() + ")", null, c.get_Id());
                        baseSelect.add(it);
                        if (savedId != null && c.get_Id() === savedId) baseSelect.setSelection([it]);
                    }
                } catch (e) { wwarn("rebuildBaseSelect failed:", e); }
            }
            baseSelect.addListener("changeSelection", function () {
                try { var sel = baseSelect.getSelection()[0]; if (sel) MM.settings.set(SET + "originId", sel.getModel()); } catch (e) {}
            });

            // CP limit
            var cpSpin = new qx.ui.form.Spinner(1, MM.settings.get(SET + "cpLimit", 25), 999).set({ width: 64, maxHeight: 26 });
            cpSpin.addListener("changeValue", function () { try { MM.settings.set(SET + "cpLimit", cpSpin.getValue()); } catch (e) {} });

            // min level
            var lvlSpin = new qx.ui.form.Spinner(0, MM.settings.get(SET + "minLevel", 0), 100).set({ width: 56, maxHeight: 26 });
            lvlSpin.addListener("changeValue", function () { try { MM.settings.set(SET + "minLevel", lvlSpin.getValue()); } catch (e) {} });

            // type toggles
            function makeChk(label, key, def) {
                var cb = new qx.ui.form.CheckBox(label).set({ alignY: "middle", textColor: TXT });
                cb.setValue(MM.settings.get(SET + key, def));
                cb.addListener("changeValue", function () { try { MM.settings.set(SET + key, cb.getValue()); } catch (e) {} });
                return cb;
            }
            var chkPlayers = makeChk(MMt("Players"), "tPlayers", false);
            var chkBases = makeChk(MMt("Bases"), "tBases", true);
            var chkOutposts = makeChk(MMt("Outposts"), "tOutposts", true);
            var chkCamps = makeChk(MMt("Camps"), "tCamps", true);

            // Run in background: keep the async fill running after the window is closed (see step()).
            var chkBg = makeChk(MMt("Run in background"), "background", false);
            chkBg.set({ toolTipText: MMt("Keep filling the table after you close this window. Progress shows on the Base Scanner button. The fill pauses while you're inside one of your bases.") });
            // Show layout bubbles: draw the per-base Tib/Cry perfect-spot tag on the region map (Part B).
            var chkBubbles = makeChk(MMt("Layout bubbles"), "mapBubbles", false);
            chkBubbles.set({ toolTipText: MMt("Show a Tib/Cry harvester-spot bubble next to each scanned base on the region map, shaded by its best perfect spot.") });
            // makeChk already persists the setting; this extra listener draws/clears the overlay immediately.
            chkBubbles.addListener("changeValue", function (e) {
                try { if (e.getData() === true) refreshBubbles(); else if (bubbleLayer) bubbleLayer.clear(); } catch (x) {}
            });

            var scanBtn = new qx.ui.form.Button(MMt("Scan")).set({ maxHeight: 26 });
            var stopBtn = new qx.ui.form.Button(MMt("Stop")).set({ maxHeight: 26, enabled: false });
            var progress = new qx.ui.basic.Label("").set({ alignY: "middle", rich: true, textColor: TXT });

            controls.add(lbl(MMt("From:"))); controls.add(baseSelect);
            controls.add(lbl(MMt("CP≤"))); controls.add(cpSpin);
            controls.add(lbl(MMt("Lvl≥"))); controls.add(lvlSpin);
            controls.add(chkPlayers); controls.add(chkBases); controls.add(chkOutposts); controls.add(chkCamps);
            controls.add(chkBg); controls.add(chkBubbles);
            controls.add(scanBtn); controls.add(stopBtn); controls.add(progress);

            // ---- window ----
            var win = MM.ui.Window({
                caption: MMt("MM - Base Scanner"),
                key: "BaseScanner.Window",
                layout: new qx.ui.layout.VBox(4),
                width: 900, height: 420,
                persistSize: true,
                restoreOpen: true,
                resizable: true,
                dock: true
            });
            if (!win) { werr("window creation failed"); return; }
            win.add(controls);
            win.add(table, { flex: 1 });
            win.addListener("appear", function () {
                rebuildBaseSelect();
                // reopening clears the button's "…N%" progress and re-shows whatever the background fill has
                setHudProgress(null);
                try { rerender(); } catch (e) {}
            });

            // HUD toggle button (keep the handle so a background scan can show progress on it)
            var BTN_LABEL = MMt("Base Scanner");
            var hudBtn = MM.buttons.register({
                id: "mm-base-scanner",
                label: BTN_LABEL,
                tooltip: MMt("Scan attackable bases near one of your bases"),
                onExecute: function () {
                    try { if (win.isVisible()) win.close(); else win.open(); } catch (e) { werr("toggle failed:", e); }
                }
            });
            // Show fill progress on the toolbar button while a background scan runs with the window closed.
            // We change only the button's displayed LABEL, not its registered slot label, so the bar's sort
            // order and the CnC-menu enable/disable (both keyed on the original label) stay correct.
            function setHudProgress(pct) {
                try {
                    if (!hudBtn || typeof hudBtn.setLabel !== "function") return;
                    hudBtn.setLabel(pct == null ? BTN_LABEL : (BTN_LABEL + " …" + pct + "%"));
                } catch (e) {}
            }

            // ---- progress + render ----
            function setProgress(done, total, label) {
                try {
                    if (label) progress.setValue(label);
                    else if (total) progress.setValue(done + " / " + total + (done < total ? MMt(" loading…") : MMt(" done")));
                    else progress.setValue("");
                } catch (e) {}
            }
            function rerender() {
                try {
                    var sortCol = tableModel.getSortColumnIndex();
                    var asc = tableModel.isSortAscending();
                    tableModel.setData(data);
                    if (sortCol === -1) tableModel.sortByColumn(DEFAULT_SORT, false);
                    else tableModel.sortByColumn(sortCol, asc);
                } catch (e) { werr("rerender failed:", e); }
            }

            // ---- run-in-background + on-map layout bubbles ----
            function backgroundOn() { try { return MM.settings.get(SET + "background", false) === true; } catch (e) { return false; } }
            function bubblesOn()    { try { return MM.settings.get(SET + "mapBubbles", false) === true; } catch (e) { return false; } }

            // Lazily-created shared overlay (MMCommon.map.bubbleLayer). Bubbles sit to the RIGHT of each
            // base (the left/top is reserved for MM - Player Base Info's off/def bubbles) with a leader line.
            var bubbleLayer = null;
            function ensureBubbleLayer() {
                if (bubbleLayer) return bubbleLayer;
                try {
                    if (!MM.map || typeof MM.map.bubbleLayer !== "function") { wwarn("map.bubbleLayer unavailable"); return null; }
                    bubbleLayer = MM.map.bubbleLayer({ id: "mm_bscan_bubbles", offset: { x: 56, y: 0 }, leader: true, anchor: "left" });
                } catch (e) { werr("bubbleLayer create failed:", e); bubbleLayer = null; }
                return bubbleLayer;
            }
            // Best perfect-harvester-spot tier in a "n7 | n6 | n5 | n4" cell -> { tier, color }. Same
            // palette as the table's MMScanSpotR (higher tier = better spot, wins).
            function bestTier(str) {
                if (str == null || str === "") return { tier: 0, color: null };
                var p = String(str).split("|");
                if (p.length < 4) return { tier: 0, color: null };
                if ((parseInt(p[0], 10) || 0) > 0) return { tier: 7, color: "#9af09a" }; // green
                if ((parseInt(p[1], 10) || 0) > 0) return { tier: 6, color: "#acd8ff" }; // blue
                if ((parseInt(p[2], 10) || 0) > 0) return { tier: 5, color: "#ffd591" }; // amber
                if ((parseInt(p[3], 10) || 0) > 0) return { tier: 4, color: "#fff6a6" }; // yellow
                return { tier: 0, color: null };
            }
            function spotSeg(label, t) {
                var bg = t.color || "rgba(255,255,255,0.10)";
                var fg = t.color ? "#111" : "#cdd8df";
                var txt = label + (t.tier ? t.tier : "–");
                return "<span style='display:inline-block;padding:0 5px;margin:0 1px;border-radius:5px;background:" + bg + ";color:" + fg + "'>" + txt + "</span>";
            }
            // Two-part Tib + Cry tag, each segment shaded by its own best tier; bubble border = the better tier.
            function bubbleContent(row) {
                var tb = bestTier(row[C.TIBL]), cb = bestTier(row[C.CRYL]);
                var acc = (tb.tier >= cb.tier ? tb.color : cb.color) || "#8fa0ab";
                return {
                    html: spotSeg(MMt("T"), tb) + spotSeg(MMt("C"), cb),
                    accent: acc,
                    title: (row[C.CITY] || "") + " " + (row[C.LOC] || "")
                };
            }
            // (Re)sync the map bubbles to the currently-filled, not-ruled-out rows.
            function refreshBubbles() {
                if (!bubblesOn()) { if (bubbleLayer) bubbleLayer.clear(); return; }
                var layer = ensureBubbleLayer(); if (!layer) return;
                var live = {};
                for (var i = 0; i < data.length; i++) {
                    var row = data[i], cand = row.__cand;
                    if (!cand) continue;
                    if (row[C.RULE] === true) continue;                          // ruled out -> no bubble
                    if (row[C.TIBL] === "" && row[C.CRYL] === "") continue;       // not analysed yet
                    var key = "b" + row[C.ID];
                    live[key] = true;
                    layer.set(key, { x: cand.x, y: cand.y }, bubbleContent(row));
                }
                var keys = layer.keys();
                for (var k = 0; k < keys.length; k++) { if (!live[keys[k]]) layer.remove(keys[k]); }
            }

            // ---- the scan ----
            function doScan() {
                if (scanning) { wlog("scan already running"); return; }
                var sel = baseSelect.getSelection()[0];
                if (!sel) { setProgress(0, 0, "<span style='color:#ff8a8a'>" + MMt("Pick an origin base") + "</span>"); return; }
                var origin = cities().GetCity(sel.getModel());
                if (!origin) { setProgress(0, 0, "<span style='color:#ff8a8a'>" + MMt("Origin base not loaded") + "</span>"); return; }

                var types = [];
                if (chkPlayers.getValue()) types.push(1);
                if (chkBases.getValue()) types.push(2);
                if (chkOutposts.getValue() || chkCamps.getValue()) types.push(3);
                if (!types.length) { setProgress(0, 0, "<span style='color:#ff8a8a'>" + MMt("Select at least one type") + "</span>"); return; }

                scanning = true;
                scanBtn.setEnabled(false);
                scanBtn.setLabel(MMt("Scanning…"));
                stopBtn.setEnabled(true);
                setHudProgress(null);
                if (bubbleLayer) { try { bubbleLayer.clear(); } catch (e) {} } // drop the previous scan's bubbles
                var token = ++fillToken;

                // Leave any open base and switch to the region/area map before the fill. The detail phase
                // sets CurrentCityId for each scanned base, which in base view yanks the camera into every
                // base in turn (distracting). exitToRegion() closes the base GUI overlay (the in-base screen
                // is an overlay, not just a VisMain mode - set_Mode alone wouldn't close it) and switches to
                // the map. We intentionally do NOT restore base view afterwards - staying on the map is the
                // preferred end state; open a base manually when you want one.
                try { MM.coords.exitToRegion(); } catch (e) { wwarn("exitToRegion failed:", e); }
                try { scanOriginOwnId = cities().get_CurrentOwnCity().get_Id(); } catch (e) {}

                setProgress(0, 0, MMt("Enumerating…"));
                var candidates = [];
                try {
                    candidates = MM.scan.inRange({
                        origin: origin,
                        cpLimit: cpSpin.getValue(),
                        minLevel: lvlSpin.getValue(),
                        types: types,
                        excludeOwn: true
                    });
                } catch (e) { werr("scan.inRange failed:", e); }

                // camp/outpost sub-filter (type-3 split by campType, matching the checkboxes).
                // campType 3 = Outpost; 1/2/7 = Camp/Infected; campType 0 is excluded entirely
                // (it has no loadable city detail - this matches the original AIO scanner, which
                // never listed campType 0 either, so we don't waste load attempts on it).
                candidates = candidates.filter(function (cand) {
                    if (cand.type !== 3) return true;
                    if (cand.campType === 3) return chkOutposts.getValue();
                    if (cand.campType === 1 || cand.campType === 2 || cand.campType === 7) return chkCamps.getValue();
                    return false;
                });

                wlog("enumerated", candidates.length, "candidates");

                // seed rows (loadState blank until filled)
                data = candidates.map(function (cand) {
                    var row = new Array(COL_COUNT);
                    for (var z = 0; z < COL_COUNT; z++) row[z] = "";
                    row[C.ID] = cand.id;
                    row[C.CITY] = "…";
                    row[C.LOC] = cand.x + ":" + cand.y;
                    row[C.LVL] = parseInt(cand.baseLevel, 10);
                    row[C.CP] = cand.cp;
                    row[C.TYPE] = typeLabel(cand.type, cand.campType);
                    row[C.RULE] = false;
                    row.__cand = cand;
                    return row;
                });
                rerender();

                if (!candidates.length) { finish(token); return; }

                // phase 2: async detail fill, one base at a time
                var idx = 0, filled = 0;
                function step() {
                    if (token !== fillToken) return;           // superseded / stopped (token bumped)
                    // Closing the window ends the scan ONLY when "Run in background" is off. With it on, the
                    // fill keeps running hidden and results survive (data/fillToken live in this closure).
                    if (!backgroundOn() && !win.isVisible()) { finish(token); return; }
                    if (idx >= data.length) { finish(token); return; }
                    // Pause the fill while the user is INSIDE a base view: each base's set_CurrentCityId(id)
                    // below yanks the shared current-city pointer, which would fight the base they have open.
                    // Wait politely and resume the moment they're back on the region map. (exitToRegion at scan
                    // start means we normally begin in region view; this only triggers if they open a base
                    // mid-scan - the documented background-mode caveat.)
                    try {
                        if (MM.map && MM.map.ready && MM.map.ready() && !MM.map.inRegionView()) {
                            window.setTimeout(step, 600);
                            return;
                        }
                    } catch (e) {}
                    var row = data[idx];
                    try { cities().set_CurrentCityId(row[C.ID]); } catch (e) {}
                    poll(row, 0);
                }
                function poll(row, attempt) {
                    if (token !== fillToken) return;
                    var ncity = null;
                    try { ncity = cities().GetCity(row[C.ID]); } catch (e) {}
                    if (ncity && ncity.get_Version() > 0) {
                        applyDetail(row, ncity, origin);
                        filled++;
                        idx++;
                        setProgress(filled, data.length);
                        rerender();
                        try { if (bubblesOn()) refreshBubbles(); } catch (e) {}
                        // surface progress on the toolbar button only while running hidden in the background
                        if (backgroundOn() && !win.isVisible()) setHudProgress(Math.round(filled / Math.max(1, data.length) * 100));
                        else setHudProgress(null);
                        window.setTimeout(step, 50);
                    } else if (attempt < 24) {
                        // detail can take ~4s to arrive for camps/outposts (observed ~20 round-trip
                        // polls live), so be patient before giving up on a base.
                        window.setTimeout(function () { poll(row, attempt + 1); }, 150 + attempt * 20);
                    } else {
                        // no data ever arrived - drop this row
                        wlog("dropping (no data):", row[C.LOC]);
                        dropRow(row);
                        idx = Math.max(0, idx); // idx now points at the next row (this one removed)
                        setProgress(filled, data.length);
                        rerender();
                        window.setTimeout(step, 30);
                    }
                }
                function dropRow(row) {
                    var i = data.indexOf(row);
                    if (i >= 0) data.splice(i, 1);
                }
                function applyDetail(row, ncity, originCity) {
                    try {
                        if ((typeof ncity.get_IsGhostMode === "function" && ncity.get_IsGhostMode()) || isAllied(ncity, originCity)) {
                            dropRow(row);
                            idx--; // compensate: this row removed, next shifts into its place
                            return;
                        }
                        row[C.CITY] = ncity.get_Name() || row[C.CITY];
                        var loot = MM.loot.ofCity(ncity);
                        var ER = ClientLib.Base.EResourceType;
                        var tib = loot[ER.Tiberium] || 0;
                        var cry = loot[ER.Crystal] || 0;
                        var gold = loot[ER.Gold] || 0;
                        var rp = loot[ER.ResearchPoints] || 0;
                        row[C.TIB] = tib; row[C.CRY] = cry; row[C.GOLD] = gold; row[C.RP] = rp;
                        var sum = tib + cry + gold;
                        row[C.SUM] = sum;
                        row[C.SUMCP] = (row[C.CP]) ? (sum / row[C.CP]) : 0;
                        try { row[C.BLD] = ncity.GetBuildingsConditionInPercent(); } catch (e) {}
                        try { row[C.DEF] = ncity.GetDefenseConditionInPercent(); } catch (e) {}
                        var f = analyzeFields(ncity);
                        row[C.TIBF] = f.totT; row[C.CRYF] = f.totC; row[C.POW8] = f.pow8;
                        row[C.TIBL] = f.tibStr; row[C.CRYL] = f.cryStr; row[C.MIXL] = f.mixStr;
                        var kb = findKeyBuildings(ncity);
                        row[C.CY] = (kb.cy == null) ? "" : kb.cy;
                        row[C.DF] = (kb.df == null) ? "" : kb.df;
                        try {
                            var pb = cities().get_CurrentOwnCity();
                            var foundbase = md().get_World().CheckFoundBase(row.__cand.x, row.__cand.y, pb.get_PlayerId(), pb.get_AllianceId());
                            row[C.FOUND] = (foundbase === 0);
                        } catch (e) {}
                    } catch (e) { werr("applyDetail failed:", e); }
                }
                step();
            }

            function finish(token) {
                if (token !== fillToken) return;
                scanning = false;
                try { scanBtn.setEnabled(true); scanBtn.setLabel(MMt("Scan")); } catch (e) {}
                try { stopBtn.setEnabled(false); } catch (e) {}
                // Restore the user's own base as "current" (stays in Region view - doesn't switch back).
                try { if (scanOriginOwnId != null) cities().set_CurrentCityId(scanOriginOwnId); } catch (e) {}
                setProgress(data.length, data.length, data.length + " " + (data.length === 1 ? MMt("target") : MMt("targets")));
                rerender();
                setHudProgress(null);
                try { if (bubblesOn()) refreshBubbles(); } catch (e) {}
                wlog("scan finished:", data.length, "targets");
            }

            // Abort an in-flight scan: bump the token (every async step bails on a token mismatch),
            // keep whatever filled so far, and reset the UI. View stays on the map.
            function stopScan() {
                if (!scanning) return;
                fillToken++;
                scanning = false;
                try { scanBtn.setEnabled(true); scanBtn.setLabel(MMt("Scan")); } catch (e) {}
                try { stopBtn.setEnabled(false); } catch (e) {}
                try { if (scanOriginOwnId != null) cities().set_CurrentCityId(scanOriginOwnId); } catch (e) {}
                setProgress(data.length, data.length, MMt("Stopped - ") + data.length + MMt(" loaded"));
                rerender();
                setHudProgress(null);
                try { if (bubblesOn()) refreshBubbles(); } catch (e) {}
                wlog("scan stopped by user");
            }

            scanBtn.addListener("execute", doScan);
            stopBtn.addListener("execute", stopScan);

            // first-time default sort header
            try { tableModel.sortByColumn(DEFAULT_SORT, false); } catch (e) {}

            LOG.log("ready");
        }

        // Wait until the game UI and MMCommon are both ready, then build once.
        var tries = 0;
        function waitReady() {
            try {
                var app = (typeof qx != "undefined" && qx.core && qx.core.Init) ? qx.core.Init.getApplication() : null;
                var navReady = app && app.getUIItem && app.getUIItem(ClientLib.Data.Missions.PATH.BAR_NAVIGATION) && app.getUIItem(ClientLib.Data.Missions.PATH.BAR_NAVIGATION).isVisible();
                if (navReady && window.MMCommon && window.MMCommon.ui && window.MMCommon.buttons && window.MMCommon.scan && window.MMCommon.loot) {
                    // Refresh the MM alias: the top-level `var MM = window.MMCommon` runs at script load,
                    // which can be BEFORE the Common Library defines window.MMCommon (injection order isn't
                    // guaranteed). waitReady waited for it to exist, so bind it now - else build()/scan use a
                    // stale undefined MM and every MM.* throws (the old "column setup ... settings" spam loop).
                    MM = window.MMCommon;
                    build();
                } else {
                    tries++;
                    if (tries === 30) wwarn("still waiting for game UI / MMCommon...");
                    window.setTimeout(waitReady, 1000);
                }
            } catch (e) {
                werr("waitReady error:", e);
                window.setTimeout(waitReady, 1000);
            }
        }
        window.setTimeout(waitReady, 1000);
    };

    try {
        var script = document.createElement("script");
        script.textContent = "(" + BaseScanner_main.toString() + ")();";
        script.type = "text/javascript";
        if (/commandandconquer\.com/i.test(document.domain)) {
            (document.head || document.documentElement).appendChild(script);
        }
    } catch (e) {
        console.error("[MM Base Scanner] init error: ", e);
    }
})();
