// ==UserScript==
// @name           MM - Player Bases
// @version        1.0.3
// @author         Dirk Kántor (NurIcke)
// @contributor    leo7044 (https://github.com/leo7044)
// @contributor    Gryphon / MrHIDEn (CnC: TA Hotkeys - salvaged hotkeys)
// @contributor    MikeyMike (CnCTA-MikeyMike-SCRIPT-PACK)
// @description    BaseInfo panel for CnCTA: per-player overview of all bases (levels, BH/CC/VE/VZ, support, production, credits) in a click-sortable table, plus a side-by-side summary of player stats / total production / first & second offense. Also two chat/forum hotkeys salvaged from the retired "CnC: TA Hotkeys": Alt+Y inserts your player/role/alliance signature, Alt+I inserts a full dump of all your bases. MM edition: ships in the shared HUD tray, position + open-state persist across refresh, removed the external scriptarea.net POST + map link.
// @downloadURL    https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/MM_BaseInfo.user.js
// @updateURL      https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/MM_BaseInfo.user.js
// @include        http*://prodgame*.alliances.commandandconquer.com/*/index.aspx*
// @include        http*://cncapp*.alliances.commandandconquer.com/*/index.aspx*
// @icon           data:image/png;base64,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
// @grant          none
// ==/UserScript==

(function () {
  var BaseInfoMain = function () {
    // i18n fallback: hoisted so MMt() is always defined even if the Common Library's global
    // loads after this script (extension injection order isn't guaranteed). Identity in English.
    function MMt(s){try{return (window.MMCommon&&window.MMCommon.i18n)?window.MMCommon.i18n.t(s):s;}catch(e){return s;}}
    // --- [MM Player Bases] debug framework (pack-wide MM convention). wlog is gated behind either
    // window.BASEINFO_DEBUG or the pack-wide window.MM_DEBUG; wwarn/werr always print so genuine
    // problems aren't hidden. Persist either flag via localStorage to survive reloads:
    //   localStorage.BASEINFO_DEBUG = '1'   or   localStorage.MM_DEBUG = '1'
    if (typeof window.BASEINFO_DEBUG === "undefined") {
      try { window.BASEINFO_DEBUG = (window.localStorage.getItem("BASEINFO_DEBUG") === "1"); } catch (e) { window.BASEINFO_DEBUG = false; }
    }
    function _dbg() { return window.BASEINFO_DEBUG || window.MM_DEBUG; }
    function wlog()  { if (!_dbg()) return; try { console.log.apply(console,  ["[MM Player Bases]"].concat([].slice.call(arguments))); } catch (e) {} }
    function wwarn() {                       try { console.warn.apply(console, ["[MM Player Bases]"].concat([].slice.call(arguments))); } catch (e) {} }
    function werr()  {                       try { console.error.apply(console, ["[MM Player Bases]"].concat([].slice.call(arguments))); } catch (e) {} }

    function BaseInfoCreate() {
      // BUTTON DESIGN / POSITION settings removed - BaseInfo now registers into the shared MM HUD
      // tray (MMCommon.buttons.register), which lays out and positions every script's button in one
      // user-draggable bar. See TA_MM_Common.user.js -> NS.buttons.
      try {
        qx.Class.define("BaseInfo", {
            type: "singleton",
            extend: qx.core.Object,
            construct: function () {
              window.addEventListener("click", this.onClick, false);
              window.addEventListener("keyup", this.onKey, false);
              window.addEventListener("mouseover", this.onMouseOver, false);
              BIVERSION = "1.0.3";
              BICLASS = "MM - Player Bases";
              BIUSERLANGUAGE = qx.locale.Manager.getInstance()
                .getLocale()
                .split("_")[0];
              BIIMAGE =
                "data:image/png;base64,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";
              BIIMAGESMALL =
                "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAAB3RJTUUH3QMQDho5kHvXxwAAAAlwSFlzAAALEwAACxMBAJqcGAAAAARnQU1BAACxjwv8YQUAAAQ+SURBVHjarVRbTFxVFF33MQ9eAzNQWmmFgRKgUBIYWmkxov0g0Vh/bKImxvghavnQGLQxMSZNjTF8IIlJNTHaBORDPxoSP0icKjFUISRCYnF4KCIdBMprZu4M987jvo77jAPWqEk/nNx1z51z9l1n7b3XucD//BP+a2FkZMTn9XqfCwQCnaIo+XmsbVubc3NzN6empr7o7e29fc+7TExMPK7EE2OqqrFkMkVQCFFCkqlakinxvR+CwRvd96RwenrmSkNj01uCvitLmVlI0g5EIUMrDMwWYdkeWHILWH4VNtbWPrt27dOLfX19qX8lnJycfLMl0NZn74bgio9A9pUCkoe4GGCbFGERTNjKFjLSaeD+x7C4uPhJoLX1pX0Ocf9hbGzsgcaTzZfNzUU4Z69Alp2AQsp+3wKW1oGdYsB1DkwrI8X5cC9/DHNxFDW1tS9STZ/6B2Fdff1rtpHME75+Hw6LprfjwK+bhB0iXIUt+GF5G2EpPmA5DEGuhmv0dbDdMI5UHH27p6fHzXkkfgsGg5XlR+77UArPyp4v34BwrJ7UGUA0CahKFixqgW1uQAgFIe4lAF2HFPoeKUcDHM1nDpV5vd8NDQ39llXIGDvjLihwsdAtiCpNrISB3QgRrtJaEYzOS8AzvdQWA9LGOBChTZbJNSReXgiBmZqoKPEA55L5TdO0wzaYIKlJ3kzgDtWsxAArrUHSVwNZcoLluWE4ZDhsIlLzqCQb2ZbK69NQYxGIsqP0oIa2bcOyKCWR2PJ476kZ6QWyRwLO6DcQyw/D0E2IkZ+AYnKIuUoxtHk+DS4ZNrmATP9XU9Lp1B1LN5lRUkidpIlC2rrUA9kxDuHEw9DLqqCvhSCz94CjtFauAz4hG6tXnaL4EuiZdOSAsKWldSqp7Wl6dRNsXoQCmvaQWrKgUdkB2zLhVGeAmhdgeSgFajS8QjabVHUDZSeT69nMAWFzc/Oalti7blXUIXryIuURA5wWbFrLFLdkfZ1xeJBKUWdBqTq4OgWpQ01InTiLpJq4FYvFvv2bD5ltXVW1VCLR8Tz2HI+AoiCkqVwbPyO9NAHn8jiKtodJUhHVKA6DeLcfugzd7UVCUd4lH1p3Hz0+suHh4VfbOx78QIyvwzv5EXza5386ldeVN4tL1uiyT2On7RJMfztuL/1ytaur65V9YVIOTl65lZWVhRJPkV5xvPGsUdspJfLbYTCqq1UN3WyA6noUkWPPQjn1MtLFlfhxenp4YGDgnXA4zCRJEsnPTMjtXSAIQgn95+V2d3d3nzt//omn/cdr62WXQxTtNPcWmOyGSQdoiz4zN4JfXe/v7x+leIXeVehdhevnhIWckFBGKCdwg/JzWXDhwpN1gUCb3+srLRIFUUgklOT8/Pza4ODgPCfijiNECduE3X1Cd06lh5shN+bn5lmucsg9C3eBfySpNaCDjVhuTP0BKVPnFst9kFQAAAAASUVORK5CYII=";
            },
            members: {
              // --- Chat/forum hotkeys, salvaged from the retired "CnC: TA Hotkeys" (Gryphon, based on
              // MrHIDEn). The keyup listener is wired in construct() (window.addEventListener "keyup",
              // this.onKey). Alt+Y inserts your player/role/alliance signature; Alt+I inserts a full dump
              // of all your bases. Both insert at the cursor of the currently-focused input/textarea
              // (message, forum post, or chat), falling back to the game chat widget when nothing is
              // focused. NOTE: the original script's plaintext multi-account password table + auto-login
              // (Alt+1-9 / Alt+0) were dropped for security and are NOT carried over.
              onKey: function (e) {
                try {
                  // ALT only (not AltGr/Ctrl/Shift), letter Y or I.
                  if (!e || !e.altKey || e.altGraphKey || e.ctrlKey || e.shiftKey) return;
                  var s = String.fromCharCode(e.keyCode);
                  if (s !== "Y" && s !== "I") return;

                  // Insert text at the cursor of the focused input/textarea; else into the game chat.
                  function insertText(text) {
                    try {
                      var el = document.querySelector("input:focus, textarea:focus");
                      if (el && typeof el.value === "string") {
                        var a = el.selectionStart, b = el.selectionEnd;
                        if (typeof a === "number" && typeof b === "number") {
                          el.value = el.value.substring(0, a) + text + el.value.substring(b);
                          el.selectionStart = el.selectionEnd = a + text.length;
                        } else {
                          el.value += text;
                        }
                        return true;
                      }
                    } catch (ie) { wwarn("hotkey insert (focused field) failed:", ie); }
                    try {
                      if (window.MMCommon && MMCommon.coords && MMCommon.coords.insertIntoChat) {
                        return MMCommon.coords.insertIntoChat(text);
                      }
                    } catch (ce) { wwarn("hotkey insert (chat) failed:", ce); }
                    return false;
                  }

                  if (s === "Y") {
                    // Signature: [player]Name[/player] / Role / [alliance]Alliance[/alliance].
                    var apc = ClientLib.Data.MainData.GetInstance().get_Cities();
                    var own = apc.get_CurrentOwnCity();
                    var roleName = ClientLib.Data.MainData.GetInstance().get_Alliance()
                      .get_CurrentMemberRoleInfo().Name;
                    var role = roleName === "Leader" ? "CiC"
                      : (roleName === "Second Commander" ? "SiC" : roleName);
                    var sig = "[player]" + own.get_PlayerName() + "[/player]\r\n" + role + "\r\n"
                      + "[alliance]" + own.get_AllianceName() + "[/alliance]";
                    if (insertText(sig)) wlog("inserted signature (Alt+Y)");
                  } else if (s === "I") {
                    // Full dump of all your bases.
                    var md = ClientLib.Data.MainData.GetInstance();
                    var playerName = md.get_Cities().get_CurrentOwnCity().get_PlayerName();
                    var cx = md.get_Server().get_ContinentWidth() / 2;
                    var cy = md.get_Server().get_ContinentHeight() / 2;
                    var txt = "[b]Player: " + playerName + "[/b]\r\n"
                      + "----------------------------------\r\n";
                    var cities = (window.MMCommon && MMCommon.base && MMCommon.base.ownCities)
                      ? MMCommon.base.ownCities() : [];
                    for (var i = 0; i < cities.length; i++) {
                      var c = cities[i];
                      try {
                        var sd = c.get_SupportData();
                        var sn = "--", sl = "--";
                        if (sd !== null) {
                          sl = sd.get_Level().toString();
                          sn = c.get_SupportWeapon().dn;
                        }
                        txt += "Base '" + c.get_Name() + "' info:\r\n";
                        txt += "Base       lvl: " + c.get_LvlBase().toFixed(2).toString() + "\r\n";
                        txt += "Defense lvl: " + c.get_LvlDefense().toFixed(2).toString() + "\r\n";
                        txt += "Offense  lvl: " + c.get_LvlOffense().toFixed(2).toString() + "\r\n";
                        txt += "Support  lvl: " + sl + " - " + sn + "\r\n";
                        txt += "Distance to center: "
                          + Math.round(ClientLib.Base.Util.CalculateDistance(cx, cy, c.get_PosX(), c.get_PosY()))
                          + "\r\n";
                        txt += "[coords]" + c.get_PosX() + ":" + c.get_PosY() + "[/coords]\r\n";
                      } catch (be) {
                        wwarn("base dump exception:", be);
                      }
                      txt += "----------------------------------\r\n";
                    }
                    if (insertText(txt)) wlog("inserted bases dump (Alt+I, " + cities.length + " bases)");
                  }
                } catch (ke) { wwarn("onKey hotkey handler failed:", ke); }
              },
              BaseinfoFenster: null,
              BaseinfoTab: null,
              BaseinfoGeneralPage: null,
              BaseinfoMemberPage: null,
              BaseinfoGeneralVBox: null,
              BaseinfoMemberVBox: null,
              BaseinfoVBox: null,
              app: null,
              initialize: function () {
                try {
                  wlog("Initialized");
                  // Use the shared MMCommon window factory so position AND visibility persist across
                  // browser refresh (the pack-wide default behavior for floating windows). The factory
                  // handles drag-tracking, the per-player settings key, and the player-id-gated restore.
                  this.BaseinfoFenster = window.MMCommon.ui.Window({
                    caption: BICLASS + " " + BIVERSION + " (" + MMt("Server Language") + ": " + BIUSERLANGUAGE + ")",
                    icon: BIIMAGE,
                    key: "BaseInfo.Window",
                    pos: [280, 10],
                    width: 200,
                    layout: new qx.ui.layout.HBox(),
                    contentPadding: 5,
                    resizable: false,
                    restoreOpen: true, // re-open automatically after a refresh if it was open
                  });
                  if (!this.BaseinfoFenster) {
                    wwarn("ui.Window failed; falling back to plain qx window");
                    this.BaseinfoFenster = new qx.ui.window.Window(BICLASS, BIIMAGE).set({
                      padding: 5, width: 200, resizable: false,
                      showMaximize: false, showMinimize: false,
                    });
                    this.BaseinfoFenster.setLayout(new qx.ui.layout.HBox());
                  }
                  try { this.BaseinfoFenster.setTextColor("black"); } catch (e) {}
                  try { this.BaseinfoFenster.setPaddingRight(0); } catch (e) {}

                  // (Re)populate the tabs every time the window becomes visible. This covers BOTH
                  // a manual user-click open AND the auto-reopen-on-refresh path (MMCommon.ui.Window's
                  // restoreOpen) - without this hook, the restored window came back blank because the
                  // data-build code only ran from the button click. The Member Status window uses the
                  // same "appear -> rebuild" pattern.
                  var _self = this;
                  try {
                    this.BaseinfoFenster.addListener("appear", function () {
                      try {
                        _self.BaseinfoGeneralVBox.removeAll();
                        _self.BaseinfoAllBasesVBox.removeAll();
                        _self.showBaseinfo();
                      } catch (e) { werr("appear rebuild failed:", e); }
                    });
                  } catch (e) { werr("appear listener wiring failed:", e); }

                  // Tab Reihe
                  this.BaseinfoTab = new qx.ui.tabview.TabView().set({
                    contentPaddingTop: 3,
                    contentPaddingBottom: 6,
                    contentPaddingRight: 7,
                    contentPaddingLeft: 3,
                  });
                  this.BaseinfoFenster.add(this.BaseinfoTab);

                  // Tab 1
                  this.BaseinfoGeneralPage = new qx.ui.tabview.Page(
                    MMt("General")
                  );
                  this.BaseinfoGeneralPage.setLayout(new qx.ui.layout.VBox(5));
                  this.BaseinfoTab.add(this.BaseinfoGeneralPage);
                  this.BaseinfoGeneralVBox = new qx.ui.container.Composite();
                  this.BaseinfoGeneralVBox.setLayout(new qx.ui.layout.VBox(5));
                  this.BaseinfoGeneralVBox.setThemedPadding(10);
                  this.BaseinfoGeneralVBox.setThemedBackgroundColor("#eef");
                  this.BaseinfoGeneralPage.add(this.BaseinfoGeneralVBox);

                  // (former "Base Values" tab was merged into the General tab above - its production
                  // and offensive content blocks are now appended to BaseinfoGeneralVBox instead.)

                  // Tab 2 (was Tab 3 before the Base Values merge)
                  this.BaseinfoAllBasesPage = new qx.ui.tabview.Page(
                    MMt("All Bases")
                  );
                  this.BaseinfoAllBasesPage.setLayout(new qx.ui.layout.VBox(5));
                  this.BaseinfoTab.add(this.BaseinfoAllBasesPage);
                  this.BaseinfoAllBasesVBox = new qx.ui.container.Composite();
                  this.BaseinfoAllBasesVBox.setLayout(new qx.ui.layout.VBox(5));
                  this.BaseinfoAllBasesVBox.setThemedPadding(10);
                  this.BaseinfoAllBasesVBox.setThemedBackgroundColor("#eef");
                  this.BaseinfoAllBasesPage.add(this.BaseinfoAllBasesVBox);

                  this.app = qx.core.Init.getApplication();
                  // Register into the shared MM HUD tray (MMCommon.buttons.register). The tray stacks
                  // every script's button into one draggable bar, so this no longer needs to pick a
                  // corner / a fixed offset / a "BIBUTTONPOSITION". The bar's position is shared with
                  // the rest of the pack and persisted across reloads.
                  var self = this;
                  window.MMCommon.buttons.register({
                    id: "baseinfo",
                    label: "Player Bases",
                    icon: BIIMAGESMALL,
                    tooltip: BICLASS + " " + BIVERSION,
                    onExecute: function () {
                      try {
                        // Click-open / click-close toggle (pack-wide convention for HUD-tray windows).
                        // Tab contents are rebuilt by the window's "appear" listener (see above) so
                        // both this click path AND the restoreOpen path get fresh data.
                        if (self.BaseinfoFenster.isVisible()) self.BaseinfoFenster.close();
                        else self.BaseinfoFenster.open();
                      } catch (e) { werr("toggle failed", e); }
                    }
                  });
                } catch (e) {
                  werr("Initialize error:", e);
                }
              },
              showBaseinfo: function (ev) {
                try {
                  wlog("Loading...");
                  var instance = ClientLib.Data.MainData.GetInstance();
                  var alliance = instance.get_Alliance();
                  var allianceid = alliance.get_Id();
                  var serverName = instance.get_Server().get_Name();
                  var player = instance.get_Player();
                  var faction1 = player.get_Faction();
                  var playerRank = player.get_OverallRank();
                  var playerSubstitution = player.get_IsSubstituted();
                  var accountId = player.get_AccountId();
                  var accountCreate = new Date(player.get_CreationDate());
                  var Stunde1 = accountCreate.getHours();
                  var Minute1 = accountCreate.getMinutes();
                  var Monat1 = accountCreate.getMonth() + 1;
                  var Tag1 = accountCreate.getDate();
                  var Jahr1 = accountCreate.getFullYear();
                  if (Stunde1 < 10) Stunde1 = "0" + Stunde1;
                  if (Minute1 < 10) Minute1 = "0" + Minute1;
                  if (Tag1 < 10) Tag1 = "0" + Tag1;
                  if (Monat1 < 10) Monat1 = "0" + Monat1;
                  accountCreate =
                    Tag1 +
                    "." +
                    Monat1 +
                    "." +
                    Jahr1 +
                    " - " +
                    Stunde1 +
                    ":" +
                    Minute1;
                  var aktuellesDatum = new Date();
                  var Stunde = aktuellesDatum.getHours();
                  var Minute = aktuellesDatum.getMinutes();
                  var Monat = aktuellesDatum.getMonth() + 1;
                  var Tag = aktuellesDatum.getDate();
                  var Jahr = aktuellesDatum.getFullYear();
                  if (Stunde < 10) Stunde = "0" + Stunde;
                  if (Minute < 10) Minute = "0" + Minute;
                  if (Tag < 10) Tag = "0" + Tag;
                  if (Monat < 10) Monat = "0" + Monat;
                  var Datum = Tag + "." + Monat + "." + Jahr;
                  var Uhrzeit = Stunde + ":" + Minute;
                  var player_basen = 0;
                  var support_gebaeude = 0;
                  var v = 0;
                  var offbasen = 0;
                  var base1 = "";
                  var base2 = "";
                  var VE_durchschnitt = null;
                  var VE_lvl = null;
                  var support = 0;
                  var supportlvl = null;
                  var supportname = "";
                  var def_durchschnitt = null;
                  var credit_durchschnitt = null;
                  var repairMaxTime = null;
                  var creditPerHour = 0;
                  var creditsPerHour = 0;
                  var PowerPerHour = 0;
                  var PowersPerHour = 0;
                  var PowerProduction = 0;
                  var PowersProduction = 0;
                  var TiberiumPerHour = 0;
                  var TiberiumsPerHour = 0;
                  var TiberiumProduction = 0;
                  var TiberiumsProduction = 0;
                  var CrystalPerHour = 0;
                  var CrystalsPerHour = 0;
                  var CrystalProduction = 0;
                  var CrystalsProduction = 0;
                  var credit_basen = "";
                  var first_rep_flug = 0;
                  var first_rep_fahr = 0;
                  var first_rep_fuss = 0;
                  var second_rep_flug = 0;
                  var second_rep_fahr = 0;
                  var second_rep_fuss = 0;
                  var firstBaseName = "";
                  var firstBaselvl = 0;
                  var firstOfflvl = 0;
                  var firstDeflvl = 0;
                  var firstPowerProduction = 0;
                  var firstRepairAir = null;
                  var firstRepairVehicle = null;
                  var firstRepairInfantry = null;
                  var secondBaseName = "";
                  var secondBaselvl = 0;
                  var secondOfflvl = 0;
                  var secondDeflvl = 0;
                  var secondPowerProduction = 0;
                  var secondRepairAir = null;
                  var secondRepairVehicle = null;
                  var secondRepairInfantry = null;
                  var factionArt = new Array();
                  factionArt[0] = "";
                  factionArt[1] = "GDI";
                  factionArt[2] = "NOD";
                  var newAusgabe = new Array();
                  var apc = instance.get_Cities();
                  var PlayerName = apc.get_CurrentOwnCity().get_PlayerName();
                  var PlayerID = apc.get_CurrentOwnCity().get_PlayerId();
                  var AllianzName = apc.get_CurrentOwnCity().get_AllianceName();
                  var AllianzID = apc.get_CurrentOwnCity().get_AllianceId();
                  var apcl = apc.get_AllCities().d;
                  var members = alliance.get_MemberData().d,
                    member;
                  var leaders = alliance.get_FirstLeaders();
                  keys = Object.keys(members);
                  len = keys.length;
                  var AllianzRolle = new Array();
                  var AllianzSpieler = new Array();
                  var sd;
                  var baseidforWorldmap = null;
                  var coordsforWorldmap = "";
                  var worldidforWorldmap = document.URL.split("/");
                  if (AllianzID > 0) {
                    while (len--) {
                      member = members[keys[len]];
                      AllianzRolle[member.Id] = member.RoleName;
                      AllianzSpieler[member.Id] = member.Name;
                    }
                  }
                  var aB_basename,
                    aB_baselvl,
                    aB_offlvl,
                    aB_deflvl,
                    aB_bhlvl,
                    aB_velvl,
                    aB_vzlvl,
                    aB_cclvl,
                    aB_supportweapon,
                    aB_supportlvl,
                    aB_credits,
                    aB_strom,
                    aB_tiberium,
                    aB_crystal;
                  var aB__basename,
                    aB__baselvl,
                    aB__offlvl,
                    aB__deflvl,
                    aB__bhlvl,
                    aB__velvl,
                    aB__vzlvl,
                    aB__cclvl,
                    aB__supportweapon,
                    aB__supportlvl,
                    aB__credits,
                    aB__strom,
                    aB__tiberium,
                    aB__crystal = new Array();
                  var GeneralField5 = new qx.ui.container.Composite(
                    new qx.ui.layout.VBox(1).set({
                      alignX: "center",
                    })
                  );
                  GeneralField5.add(
                    new qx.ui.basic.Label(
                      "<big><u><b>" +
                        MMt("All Bases Overview") +
                        "</b></u></big>"
                    ).set({
                      rich: true,
                    })
                  );
                  GeneralField5.add(
                    new qx.ui.basic.Label("").set({
                      rich: true,
                    })
                  );
                  var Basen = new qx.ui.container.Composite(
                    new qx.ui.layout.HBox(10).set({
                      alignX: "center",
                    })
                  );
                  var BasenName = new qx.ui.container.Composite(
                    new qx.ui.layout.VBox(1).set({
                      alignX: "right",
                    })
                  );
                  var BasenBase = new qx.ui.container.Composite(
                    new qx.ui.layout.VBox(1).set({
                      alignX: "right",
                    })
                  );
                  var BasenOffensive = new qx.ui.container.Composite(
                    new qx.ui.layout.VBox(1).set({
                      alignX: "right",
                    })
                  );
                  var BasenDefensive = new qx.ui.container.Composite(
                    new qx.ui.layout.VBox(1).set({
                      alignX: "right",
                    })
                  );
                  var BasenBH = new qx.ui.container.Composite(
                    new qx.ui.layout.VBox(1).set({
                      alignX: "right",
                    })
                  );
                  var BasenCC = new qx.ui.container.Composite(
                    new qx.ui.layout.VBox(1).set({
                      alignX: "right",
                    })
                  );
                  var BasenVE = new qx.ui.container.Composite(
                    new qx.ui.layout.VBox(1).set({
                      alignX: "right",
                    })
                  );
                  var BasenVZ = new qx.ui.container.Composite(
                    new qx.ui.layout.VBox(1).set({
                      alignX: "right",
                    })
                  );
                  var BasenSupport = new qx.ui.container.Composite(
                    new qx.ui.layout.VBox(1).set({
                      alignX: "right",
                    })
                  );
                  var BasenTiberium = new qx.ui.container.Composite(
                    new qx.ui.layout.VBox(1).set({
                      alignX: "right",
                    })
                  );
                  var BasenCrystal = new qx.ui.container.Composite(
                    new qx.ui.layout.VBox(1).set({
                      alignX: "right",
                    })
                  );
                  var BasenPower = new qx.ui.container.Composite(
                    new qx.ui.layout.VBox(1).set({
                      alignX: "right",
                    })
                  );
                  var BasenCredits = new qx.ui.container.Composite(
                    new qx.ui.layout.VBox(1).set({
                      alignX: "right",
                    })
                  );
                  BasenName.add(
                    new qx.ui.basic.Label(
                      "<b>" + MMt("Base Name") + "</b>"
                    ).set({
                      rich: true,
                      alignX: "center",
                    })
                  );
                  BasenBase.add(
                    new qx.ui.basic.Label("<b>" + MMt("Lvl") + "</b>").set({
                      rich: true,
                      alignX: "center",
                    })
                  );
                  BasenOffensive.add(
                    new qx.ui.basic.Label("<b>" + MMt("Off") + "</b>").set({
                      rich: true,
                      alignX: "center",
                    })
                  );
                  BasenDefensive.add(
                    new qx.ui.basic.Label("<b>" + MMt("Def") + "</b>").set({
                      rich: true,
                      alignX: "center",
                    })
                  );
                  BasenBH.add(
                    new qx.ui.basic.Label("<b>" + MMt("CY") + "</b>").set({
                      rich: true,
                      alignX: "center",
                    })
                  );
                  BasenCC.add(
                    new qx.ui.basic.Label("<b>" + MMt("CC") + "</b>").set({
                      rich: true,
                      alignX: "center",
                    })
                  );
                  BasenVE.add(
                    new qx.ui.basic.Label("<b>" + MMt("DF") + "</b>").set({
                      rich: true,
                      alignX: "center",
                    })
                  );
                  BasenVZ.add(
                    new qx.ui.basic.Label("<b>" + MMt("HQ") + "</b>").set({
                      rich: true,
                      alignX: "center",
                    })
                  );
                  BasenSupport.add(
                    new qx.ui.basic.Label("<b>" + MMt("Support") + "</b>").set({
                      rich: true,
                      alignX: "center",
                    })
                  );
                  BasenTiberium.add(
                    new qx.ui.basic.Label(
                      "<b>" + MMt("Tiberium") + "</b>"
                    ).set({
                      rich: true,
                      alignX: "center",
                    })
                  );
                  BasenCrystal.add(
                    new qx.ui.basic.Label(
                      "<b>" + MMt("Crystal") + "</b>"
                    ).set({
                      rich: true,
                      alignX: "center",
                    })
                  );
                  BasenPower.add(
                    new qx.ui.basic.Label(
                      "<b>" + MMt("Power") + "</b>"
                    ).set({
                      rich: true,
                      alignX: "center",
                    })
                  );
                  BasenCredits.add(
                    new qx.ui.basic.Label(
                      "<b>" + MMt("Credit") + "</b>"
                    ).set({
                      rich: true,
                      alignX: "center",
                    })
                  );

                  // Sortable All Bases table: collect each base into rows[] here, render it (with
                  // click-to-sort headers) after the loop. Lets us re-sort by any column without
                  // rebuilding the full table from the game data.
                  var rows = [];
                  for (var key in apcl) {
                    player_basen++;
                    var c = apcl[key];
                    try {
                      sd = c.get_SupportData();
                      if (sd !== null) {
                        support_gebaeude++;
                        support = sd.get_Level();
                        supportlvl = supportlvl + support;
                        supportname = c
                          .get_SupportWeapon()
                          .n.replace(/NOD_SUPPORT_/gi, "")
                          .replace(/GDI_SUPPORT_/gi, "")
                          .replace(/FOR_SUPPORT_/gi, "");
                      } else {
                        support = 0;
                        supportname = "-";
                      }
                      unitData = c.get_CityBuildingsData();
                      ve = unitData.GetUniqueBuildingByTechName(
                        ClientLib.Base.ETechName.Defense_Facility
                      );
                      vz = unitData.GetUniqueBuildingByTechName(
                        ClientLib.Base.ETechName.Defense_HQ
                      );
                      bh = unitData.GetUniqueBuildingByTechName(
                        ClientLib.Base.ETechName.Construction_Yard
                      );
                      cc = unitData.GetUniqueBuildingByTechName(
                        ClientLib.Base.ETechName.Command_Center
                      );
                      commandpointsMaxStorage = c.GetResourceMaxStorage(
                        ClientLib.Base.EResourceType.CommandPoints
                      );

                      creditPerHour =
                        ClientLib.Base.Resource.GetResourceGrowPerHour(
                          c.get_CityCreditsProduction(),
                          false
                        ) +
                        ClientLib.Base.Resource.GetResourceBonusGrowPerHour(
                          c.get_CityCreditsProduction(),
                          false
                        );

                      PowerPerHour =
                        c.GetResourceGrowPerHour(
                          ClientLib.Base.EResourceType.Power,
                          false,
                          false
                        ) +
                        c.GetResourceBonusGrowPerHour(
                          ClientLib.Base.EResourceType.Power
                        ) +
                        alliance.GetPOIBonusFromResourceType(
                          ClientLib.Base.EResourceType.Power
                        );
                      PowerProduction =
                        c.GetResourceGrowPerHour(
                          ClientLib.Base.EResourceType.Power,
                          false,
                          false
                        ) +
                        c.GetResourceBonusGrowPerHour(
                          ClientLib.Base.EResourceType.Power
                        );
                      TiberiumPerHour =
                        c.GetResourceGrowPerHour(
                          ClientLib.Base.EResourceType.Tiberium,
                          false,
                          false
                        ) +
                        c.GetResourceBonusGrowPerHour(
                          ClientLib.Base.EResourceType.Tiberium
                        ) +
                        alliance.GetPOIBonusFromResourceType(
                          ClientLib.Base.EResourceType.Tiberium
                        );
                      TiberiumProduction =
                        c.GetResourceGrowPerHour(
                          ClientLib.Base.EResourceType.Tiberium,
                          false,
                          false
                        ) +
                        c.GetResourceBonusGrowPerHour(
                          ClientLib.Base.EResourceType.Tiberium
                        );
                      CrystalPerHour =
                        c.GetResourceGrowPerHour(
                          ClientLib.Base.EResourceType.Crystal,
                          false,
                          false
                        ) +
                        c.GetResourceBonusGrowPerHour(
                          ClientLib.Base.EResourceType.Crystal
                        ) +
                        alliance.GetPOIBonusFromResourceType(
                          ClientLib.Base.EResourceType.Crystal
                        );
                      CrystalProduction =
                        c.GetResourceGrowPerHour(
                          ClientLib.Base.EResourceType.Crystal,
                          false,
                          false
                        ) +
                        c.GetResourceBonusGrowPerHour(
                          ClientLib.Base.EResourceType.Crystal
                        );

                      creditsPerHour = creditsPerHour + creditPerHour;

                      PowersPerHour = PowersPerHour + PowerPerHour;
                      PowersProduction = PowersProduction + PowerProduction;
                      TiberiumsPerHour = TiberiumsPerHour + TiberiumPerHour;
                      TiberiumsProduction =
                        TiberiumsProduction + TiberiumProduction;
                      CrystalsPerHour = CrystalsPerHour + CrystalPerHour;
                      CrystalsProduction =
                        CrystalsProduction + CrystalProduction;

                      if (c.get_CommandCenterLevel() > 0) {
                        repairMaxTime = c.GetResourceMaxStorage(
                          ClientLib.Base.EResourceType.RepairChargeInf
                        );
                        if (firstOfflvl < c.get_LvlOffense()) {
                          secondBaseName = firstBaseName;
                          secondBaselvl = firstBaselvl;
                          secondOfflvl = firstOfflvl;
                          secondDeflvl = firstDeflvl;
                          secondPowerProduction = firstPowerProduction;
                          secondRepairInfantry = firstRepairInfantry;
                          secondRepairVehicle = firstRepairVehicle;
                          secondRepairAir = firstRepairAir;

                          firstBaseName = c.get_Name();
                          firstBaselvl = c.get_LvlBase();
                          firstOfflvl = c.get_LvlOffense();
                          firstDeflvl = c.get_LvlDefense();
                          firstPowerProduction =
                            c.GetResourceGrowPerHour(
                              ClientLib.Base.EResourceType.Power,
                              false,
                              false
                            ) +
                            c.GetResourceBonusGrowPerHour(
                              ClientLib.Base.EResourceType.Power
                            ) +
                            alliance.GetPOIBonusFromResourceType(
                              ClientLib.Base.EResourceType.Power
                            );
                          firstRepairInfantry = c
                            .get_CityUnitsData()
                            .GetRepairTimeFromEUnitGroup(
                              ClientLib.Data.EUnitGroup.Infantry,
                              false
                            );
                          firstRepairVehicle = c
                            .get_CityUnitsData()
                            .GetRepairTimeFromEUnitGroup(
                              ClientLib.Data.EUnitGroup.Vehicle,
                              false
                            );
                          firstRepairAir = c
                            .get_CityUnitsData()
                            .GetRepairTimeFromEUnitGroup(
                              ClientLib.Data.EUnitGroup.Aircraft,
                              false
                            );
                        } else if (c.get_LvlOffense() > secondOfflvl) {
                          secondBaseName = c.get_Name();
                          secondBaselvl = c.get_LvlBase();
                          secondOfflvl = c.get_LvlOffense();
                          secondDeflvl = c.get_LvlDefense();
                          secondPowerProduction =
                            c.GetResourceGrowPerHour(
                              ClientLib.Base.EResourceType.Power,
                              false,
                              false
                            ) +
                            c.GetResourceBonusGrowPerHour(
                              ClientLib.Base.EResourceType.Power
                            ) +
                            alliance.GetPOIBonusFromResourceType(
                              ClientLib.Base.EResourceType.Power
                            );
                          secondRepairInfantry = c
                            .get_CityUnitsData()
                            .GetRepairTimeFromEUnitGroup(
                              ClientLib.Data.EUnitGroup.Infantry,
                              false
                            );
                          secondRepairVehicle = c
                            .get_CityUnitsData()
                            .GetRepairTimeFromEUnitGroup(
                              ClientLib.Data.EUnitGroup.Vehicle,
                              false
                            );
                          secondRepairAir = c
                            .get_CityUnitsData()
                            .GetRepairTimeFromEUnitGroup(
                              ClientLib.Data.EUnitGroup.Aircraft,
                              false
                            );
                        }
                      }
                      if (
                        c.get_CommandCenterLevel() > 0 &&
                        c.get_LvlOffense() > 0
                      ) {
                        offbasen++;
                      }
                      if (ve !== null) {
                        v++;
                        VE_lvl = VE_lvl + ve.get_CurrentLevel();
                      }
                      if (c.get_LvlDefense()) {
                        def_durchschnitt =
                          def_durchschnitt + c.get_LvlDefense();
                      }
                      if (ve !== null) {
                        aB_velvl = ve.get_CurrentLevel().toString();
                      } else {
                        aB_velvl = "-";
                      }
                      if (vz !== null) {
                        aB_vzlvl = vz.get_CurrentLevel().toString();
                      } else {
                        aB_vzlvl = "-";
                      }
                      if (bh !== null) {
                        aB_bhlvl = bh.get_CurrentLevel().toString();
                      } else {
                        aB_bhlvl = "-";
                      }
                      if (cc !== null) {
                        aB_cclvl = cc.get_CurrentLevel().toString();
                      } else {
                        aB_cclvl = "-";
                      }
                      if (baseidforWorldmap == null) {
                        baseidforWorldmap = key;
                        coordsforWorldmap = c.get_PosX() + ":" + c.get_PosY();
                      }

                      // Capture this base into rows[] for the sortable All Bases table. The actual
                      // Label widgets get created later in renderRows(). aB_*lvl come in as strings
                      // ("-" if the building is missing); we parse to a Number for sorting but keep
                      // the original display string so a missing building still shows as "-".
                      function _n(s) { var n = parseFloat(s); return isFinite(n) ? n : null; }
                      rows.push({
                        name: c.get_Name().toString(),
                        base: c.get_LvlBase(),
                        off:  c.get_LvlOffense(),
                        def:  c.get_LvlDefense(),
                        bh:   _n(aB_bhlvl), bhText: aB_bhlvl,
                        cc:   _n(aB_cclvl), ccText: aB_cclvl,
                        ve:   _n(aB_velvl), veText: aB_velvl,
                        vz:   _n(aB_vzlvl), vzText: aB_vzlvl,
                        support: support, supportName: supportname.toString(),
                        tib:  parseInt(TiberiumProduction),
                        cry:  parseInt(CrystalProduction),
                        pow:  parseInt(PowerProduction),
                        cred: parseInt(creditPerHour)
                      });
                    } catch (e) {
                      wwarn("AllBases row:", e);
                    }
                  }

                  def_durchschnitt = def_durchschnitt / player_basen;
                  newAusgabe["off_basen"] = offbasen;
                  if (player_basen > 0) {
                    newAusgabe["def_durchschnitt"] =
                      "" + def_durchschnitt.toFixed(2).toString() + "";
                  } else {
                    newAusgabe["def_durchschnitt"] = 0;
                  }
                  newAusgabe["support_basen"] = support_gebaeude;
                  if (support_gebaeude > 0) {
                    supportlvl = supportlvl / support_gebaeude;
                    newAusgabe["support_lvl"] =
                      "" + supportlvl.toFixed(2).toString() + "";
                  } else {
                    newAusgabe["support_lvl"] = 0;
                  }
                  VE_durchschnitt = VE_lvl / v;
                  if (v > 0) {
                    newAusgabe["ve"] =
                      "" + VE_durchschnitt.toFixed(2).toString() + "";
                  } else {
                    newAusgabe["ve"] = 0;
                  }
                  first_rep_flug =
                    ClientLib.Vis.VisMain.FormatTimespan(firstRepairAir);
                  first_rep_fahr =
                    ClientLib.Vis.VisMain.FormatTimespan(firstRepairVehicle);
                  first_rep_fuss =
                    ClientLib.Vis.VisMain.FormatTimespan(firstRepairInfantry);
                  if (first_rep_flug.split(":").length < 3) {
                    first_rep_flug = "0:" + first_rep_flug;
                  }
                  if (first_rep_flug.split(":").length < 4) {
                    first_rep_flug = "0:" + first_rep_flug;
                  }
                  if (first_rep_fahr.split(":").length < 3) {
                    first_rep_fahr = "0:" + first_rep_fahr;
                  }
                  if (first_rep_fahr.split(":").length < 4) {
                    first_rep_fahr = "0:" + first_rep_fahr;
                  }
                  if (first_rep_fuss.split(":").length < 3) {
                    first_rep_fuss = "0:" + first_rep_fuss;
                  }
                  if (first_rep_fuss.split(":").length < 4) {
                    first_rep_fuss = "0:" + first_rep_fuss;
                  }
                  second_rep_flug =
                    ClientLib.Vis.VisMain.FormatTimespan(secondRepairAir);
                  second_rep_fahr =
                    ClientLib.Vis.VisMain.FormatTimespan(secondRepairVehicle);
                  second_rep_fuss =
                    ClientLib.Vis.VisMain.FormatTimespan(secondRepairInfantry);
                  if (second_rep_flug.split(":").length < 3) {
                    second_rep_flug = "0:" + second_rep_flug;
                  }
                  if (second_rep_flug.split(":").length < 4) {
                    second_rep_flug = "0:" + second_rep_flug;
                  }
                  if (second_rep_fahr.split(":").length < 3) {
                    second_rep_fahr = "0:" + second_rep_fahr;
                  }
                  if (second_rep_fahr.split(":").length < 4) {
                    second_rep_fahr = "0:" + second_rep_fahr;
                  }
                  if (second_rep_fuss.split(":").length < 3) {
                    second_rep_fuss = "0:" + second_rep_fuss;
                  }
                  if (second_rep_fuss.split(":").length < 4) {
                    second_rep_fuss = "0:" + second_rep_fuss;
                  }

                  newAusgabe["AccountID"] = accountId;
                  newAusgabe["AllianzID"] = AllianzID;
                  if (AllianzID > 0)
                    newAusgabe["AllianzName"] = AllianzName.toString();
                  else newAusgabe["AllianzName"] = " ";
                  if (AllianzID > 0)
                    newAusgabe["AllianzRolle"] =
                      AllianzRolle[PlayerID].toString();
                  else newAusgabe["AllianzRolle"] = " ";
                  newAusgabe["ServerName"] = serverName.toString();
                  newAusgabe["SpielerID"] = PlayerID;
                  newAusgabe["Spieler"] = PlayerName;
                  newAusgabe["Klasse"] = factionArt[faction1];
                  newAusgabe["Datum"] = Datum;
                  newAusgabe["Uhrzeit"] = Uhrzeit;
                  newAusgabe["Rang"] = playerRank;
                  newAusgabe["Substitution"] = playerSubstitution;
                  newAusgabe["maxKP"] = commandpointsMaxStorage;
                  newAusgabe["repZeit"] = repairMaxTime / 60 / 60;
                  newAusgabe["Basen"] = player_basen;
                  newAusgabe["Creditproduktion"] = parseInt(creditsPerHour);
                  newAusgabe["Tiberiumproduktion"] = parseInt(TiberiumsPerHour);
                  newAusgabe["Kristallproduktion"] = parseInt(CrystalsPerHour);
                  newAusgabe["Stromproduktion"] = parseInt(PowersPerHour);
                  newAusgabe["1st_Base"] = firstBaselvl.toFixed(2).toString();
                  newAusgabe["1st_Def"] = firstDeflvl.toFixed(2).toString();
                  newAusgabe["1st_Off"] = firstOfflvl.toFixed(2).toString();
                  newAusgabe["1st_Stromproduktion"] =
                    parseInt(firstPowerProduction);
                  newAusgabe["1st_Flugzeuge"] = first_rep_flug;
                  newAusgabe["1st_Fahrzeuge"] = first_rep_fahr;
                  newAusgabe["1st_Fusstruppen"] = first_rep_fuss;
                  newAusgabe["2nd_Base"] = secondBaselvl.toFixed(2).toString();
                  newAusgabe["2nd_Def"] = secondDeflvl.toFixed(2).toString();
                  newAusgabe["2nd_Off"] = secondOfflvl.toFixed(2).toString();
                  newAusgabe["2nd_Stromproduktion"] = parseInt(
                    secondPowerProduction
                  );
                  newAusgabe["2nd_Flugzeuge"] = second_rep_flug;
                  newAusgabe["2nd_Fahrzeuge"] = second_rep_fahr;
                  newAusgabe["2nd_Fusstruppen"] = second_rep_fuss;
                  newAusgabe["Leaders"] =
                    leaders.l[leaders.l.indexOf(PlayerID)];
                  newAusgabe["WorldID"] = worldidforWorldmap[3];
                  newAusgabe["CoordsforWorldmap"] = coordsforWorldmap;
                  newAusgabe["ShowonWorldmap"] = baseidforWorldmap;
                  newAusgabe["Version"] = BIVERSION;

                  // Field 1
                  var GeneralField1 = new qx.ui.container.Composite(
                    new qx.ui.layout.VBox(2).set({
                      alignX: "center",
                    })
                  );
                  GeneralField1.add(
                    new qx.ui.basic.Label(
                      "<big><u><b>" +
                        MMt("General Information") +
                        "</b></u></big>"
                    ).set({
                      rich: true,
                      selectable: true,
                    })
                  );
                  GeneralField1.add(
                    new qx.ui.basic.Label("").set({
                      rich: true,
                      selectable: true,
                    })
                  );

                  // Field 2
                  var field2 = new qx.ui.container.Composite(
                    new qx.ui.layout.VBox(2).set({
                      alignX: "center",
                    })
                  );
                  field2.add(
                    new qx.ui.basic.Label(
                      "<big><u><b>" +
                        MMt("Total Production") +
                        "</b></u></big>"
                    ).set({
                      rich: true,
                      selectable: true,
                    })
                  );
                  field2.add(
                    new qx.ui.basic.Label("").set({
                      rich: true,
                      selectable: true,
                    })
                  );

                  // VBox (was HBox) so the "Players Production" and "Total Production" blocks stack
                  // vertically inside the General tab's "Total Production" COLUMN (see assembly below).
                  var production = new qx.ui.container.Composite(
                    new qx.ui.layout.VBox(8).set({
                      alignX: "center",
                    })
                  );
                  // 2.1
                  var playerproduction = new qx.ui.container.Composite(
                    new qx.ui.layout.VBox(2).set({
                      alignX: "center",
                    })
                  );
                  playerproduction.add(
                    new qx.ui.basic.Label(
                      "<b>" +
                        MMt("Players Production") +
                        "</b><br><i>(" +
                        MMt("all bases") +
                        ")</i>"
                    ).set({
                      rich: true,
                      selectable: true,
                    })
                  );
                  // 2.2
                  var overallproduction = new qx.ui.container.Composite(
                    new qx.ui.layout.VBox(2).set({
                      alignX: "center",
                    })
                  );
                  overallproduction.add(
                    new qx.ui.basic.Label(
                      "<b>" +
                        MMt("Total Production") +
                        "</b><br><i>(" +
                        MMt("inclusive Bonus POI") +
                        ")</i>"
                    ).set({
                      rich: true,
                      selectable: true,
                    })
                  );

                  // Field 3
                  var field3 = new qx.ui.container.Composite(
                    new qx.ui.layout.VBox(5).set({
                      alignX: "center",
                    })
                  );
                  field3.add(
                    new qx.ui.basic.Label("").set({
                      rich: true,
                      selectable: true,
                    })
                  );

                  var offensive = new qx.ui.container.Composite(
                    new qx.ui.layout.HBox(50).set({
                      alignX: "center",
                    })
                  );
                  // 3.1
                  var firstoff = new qx.ui.container.Composite(
                    new qx.ui.layout.VBox(2).set({
                      alignX: "center",
                    })
                  );
                  firstoff.add(
                    new qx.ui.basic.Label(
                      "<big><u><b>" +
                        MMt("First Offense") +
                        "</b></u></big>"
                    ).set({
                      rich: true,
                      selectable: true,
                    })
                  );
                  firstoff.add(
                    new qx.ui.basic.Label("").set({
                      rich: true,
                      selectable: true,
                    })
                  );
                  // 3.2
                  var secondoff = new qx.ui.container.Composite(
                    new qx.ui.layout.VBox(2).set({
                      alignX: "center",
                    })
                  );
                  secondoff.add(
                    new qx.ui.basic.Label(
                      "<big><u><b>" +
                        MMt("Second Offense") +
                        "</b></u></big>"
                    ).set({
                      rich: true,
                      selectable: true,
                    })
                  );
                  secondoff.add(
                    new qx.ui.basic.Label("").set({
                      rich: true,
                      selectable: true,
                    })
                  );

                  var chrystal,
                    tiberium,
                    power,
                    dollar,
                    squad,
                    vehicle,
                    plane,
                    firstoff,
                    secondoff,
                    name,
                    level,
                    off,
                    def,
                    strom;

                  GeneralField1.add(
                    new qx.ui.basic.Atom(
                      "<b>" +
                        MMt("Account Creation") +
                        ":</b> " +
                        accountCreate.toString()
                    ).set({
                      rich: true,
                    })
                  );
                  if (AllianzID > 0)
                    GeneralField1.add(
                      new qx.ui.basic.Atom(
                        "<b>" +
                          MMt("Alliance Role") +
                          ":</b> " +
                          AllianzRolle[PlayerID].toString()
                      ).set({
                        rich: true,
                      })
                    );
                  else
                    GeneralField1.add(
                      new qx.ui.basic.Atom(
                        "<b>" + MMt("Alliance Role") + ":</b> ---"
                      ).set({
                        rich: true,
                      })
                    );
                  GeneralField1.add(
                    new qx.ui.basic.Atom(
                      "<b>" + MMt("Player Name") + ":</b> " + PlayerName
                    ).set({
                      rich: true,
                    })
                  );
                  GeneralField1.add(
                    new qx.ui.basic.Atom(
                      "<b>" +
                        MMt("Player Class") +
                        ":</b> " +
                        factionArt[faction1]
                    ).set({
                      rich: true,
                    })
                  );
                  GeneralField1.add(
                    new qx.ui.basic.Atom(
                      "<b>" +
                        MMt("Current Time") +
                        ":</b> " +
                        Datum +
                        " " +
                        Uhrzeit
                    ).set({
                      rich: true,
                    })
                  );
                  GeneralField1.add(
                    new qx.ui.basic.Atom(
                      "<b>" + MMt("Rank") + ":</b> " + playerRank
                    ).set({
                      rich: true,
                    })
                  );
                  GeneralField1.add(
                    new qx.ui.basic.Atom(
                      "<b>" +
                        MMt("Maximal CP") +
                        ":</b> " +
                        commandpointsMaxStorage
                    ).set({
                      rich: true,
                    })
                  );
                  GeneralField1.add(
                    new qx.ui.basic.Atom(
                      "<b>" +
                        MMt("Maximal Reptime") +
                        ":</b> " +
                        repairMaxTime / 60 / 60 +
                        " " +
                        MMt("Hours")
                    ).set({
                      rich: true,
                    })
                  );
                  GeneralField1.add(
                    new qx.ui.basic.Atom(
                      "<b>" + MMt("Basecount") + ":</b> " + player_basen
                    ).set({
                      rich: true,
                    })
                  );
                  GeneralField1.add(
                    new qx.ui.basic.Atom(
                      "<b>" +
                        MMt("Offense Bases Count") +
                        ":</b> " +
                        offbasen
                    ).set({
                      rich: true,
                    })
                  );
                  GeneralField1.add(
                    new qx.ui.basic.Atom(
                      "<b>" +
                        MMt("Support Building Level Ø") +
                        ":</b> " +
                        newAusgabe["support_lvl"]
                    ).set({
                      rich: true,
                    })
                  );
                  GeneralField1.add(
                    new qx.ui.basic.Atom(
                      "<b>" +
                        MMt("DF Ø all Bases") +
                        ":</b> " +
                        newAusgabe["ve"]
                    ).set({
                      rich: true,
                    })
                  );
                  GeneralField1.add(
                    new qx.ui.basic.Atom(
                      "<b>" +
                        MMt("Def Ø all Bases") +
                        ":</b> " +
                        newAusgabe["def_durchschnitt"]
                    ).set({
                      rich: true,
                    })
                  );
                  GeneralField1.add(
                    new qx.ui.basic.Label("").set({
                      rich: true,
                      selectable: true,
                    })
                  );
                  playerproduction.add(
                    (chrystal = new qx.ui.basic.Atom(
                      "" + parseInt(CrystalsProduction).toLocaleString() + "",
                      "webfrontend/ui/common/icn_res_chrystal.png"
                    ).set({
                      rich: true,
                    }))
                  );
                  chrystal.setToolTipIcon(
                    "webfrontend/ui/common/icn_res_chrystal.png"
                  );
                  chrystal.setToolTipText(MMt("Crystal Production"));
                  chrystal.getChildControl("icon").set({
                    width: 18,
                    height: 18,
                    scale: true,
                    alignY: "middle",
                  });
                  production.add(playerproduction);
                  playerproduction.add(
                    (tiberium = new qx.ui.basic.Atom(
                      "" + parseInt(TiberiumsProduction).toLocaleString() + "",
                      "webfrontend/ui/common/icn_res_tiberium.png"
                    ).set({
                      rich: true,
                    }))
                  );
                  tiberium.setToolTipIcon(
                    "webfrontend/ui/common/icn_res_tiberium.png"
                  );
                  tiberium.setToolTipText(MMt("Tiberium Production"));
                  tiberium.getChildControl("icon").set({
                    width: 18,
                    height: 18,
                    scale: true,
                    alignY: "middle",
                  });
                  production.add(playerproduction);
                  playerproduction.add(
                    (power = new qx.ui.basic.Atom(
                      "" + parseInt(PowersProduction).toLocaleString() + "",
                      "webfrontend/ui/common/icn_res_power.png"
                    ).set({
                      rich: true,
                    }))
                  );
                  power.setToolTipIcon(
                    "webfrontend/ui/common/icn_res_power.png"
                  );
                  power.setToolTipText(MMt("Power Produktion"));
                  power.getChildControl("icon").set({
                    width: 18,
                    height: 18,
                    scale: true,
                    alignY: "middle",
                  });
                  production.add(playerproduction);
                  playerproduction.add(
                    (dollar = new qx.ui.basic.Atom(
                      "" + parseInt(creditsPerHour).toLocaleString() + "",
                      "webfrontend/ui/common/icn_res_dollar.png"
                    ).set({
                      rich: true,
                    }))
                  );
                  dollar.setToolTipIcon(
                    "webfrontend/ui/common/icn_res_dollar.png"
                  );
                  dollar.setToolTipText(MMt("Credit Production"));
                  dollar.getChildControl("icon").set({
                    width: 18,
                    height: 18,
                    scale: true,
                    alignY: "middle",
                  });
                  production.add(playerproduction);

                  overallproduction.add(
                    (chrystal = new qx.ui.basic.Atom(
                      "" + parseInt(CrystalsPerHour).toLocaleString() + "",
                      "webfrontend/ui/common/icn_res_chrystal.png"
                    ).set({
                      rich: true,
                    }))
                  );
                  chrystal.setToolTipIcon(
                    "webfrontend/ui/common/icn_res_chrystal.png"
                  );
                  chrystal.setToolTipText(
                    MMt("Total Crystal Production")
                  );
                  chrystal.getChildControl("icon").set({
                    width: 18,
                    height: 18,
                    scale: true,
                    alignY: "middle",
                  });
                  production.add(overallproduction);
                  overallproduction.add(
                    (tiberium = new qx.ui.basic.Atom(
                      "" + parseInt(TiberiumsPerHour).toLocaleString(),
                      "webfrontend/ui/common/icn_res_tiberium.png"
                    ).set({
                      rich: true,
                    }))
                  );
                  tiberium.setToolTipIcon(
                    "webfrontend/ui/common/icn_res_tiberium.png"
                  );
                  tiberium.setToolTipText(
                    MMt("Total Tiberium Production")
                  );
                  tiberium.getChildControl("icon").set({
                    width: 18,
                    height: 18,
                    scale: true,
                    alignY: "middle",
                  });
                  production.add(overallproduction);
                  overallproduction.add(
                    (power = new qx.ui.basic.Atom(
                      "" + parseInt(PowersPerHour).toLocaleString(),
                      "webfrontend/ui/common/icn_res_power.png"
                    ).set({
                      rich: true,
                    }))
                  );
                  power.setToolTipIcon(
                    "webfrontend/ui/common/icn_res_power.png"
                  );
                  power.setToolTipText(MMt("Total Power Production"));
                  power.getChildControl("icon").set({
                    width: 18,
                    height: 18,
                    scale: true,
                    alignY: "middle",
                  });
                  production.add(overallproduction);

                  firstoff.add(
                    (name = new qx.ui.basic.Atom(
                      firstBaseName,
                      "FactionUI/icons/icon_arsnl_base_buildings.png"
                    ).set({
                      rich: true,
                    }))
                  );
                  name.setToolTipIcon(
                    "FactionUI/icons/icon_arsnl_base_buildings.png"
                  );
                  name.setToolTipText(MMt("1st-OFF") + ": " + MMt("Base Name"));
                  name.getChildControl("icon").set({
                    width: 18,
                    height: 18,
                    scale: true,
                    alignY: "middle",
                  });
                  offensive.add(firstoff);
                  firstoff.add(
                    (level = new qx.ui.basic.Atom(
                      firstBaselvl.toFixed(2).toString(),
                      "FactionUI/icons/icon_arsnl_base_buildings.png"
                    ).set({
                      rich: true,
                    }))
                  );
                  level.setToolTipIcon(
                    "FactionUI/icons/icon_arsnl_base_buildings.png"
                  );
                  level.setToolTipText(MMt("1st-OFF") + ": " + MMt("Base Level"));
                  level.getChildControl("icon").set({
                    width: 18,
                    height: 18,
                    scale: true,
                    alignY: "middle",
                  });
                  offensive.add(firstoff);
                  firstoff.add(
                    (off = new qx.ui.basic.Atom(
                      firstOfflvl.toFixed(2).toString(),
                      "FactionUI/icons/icon_army_points.png"
                    ).set({
                      rich: true,
                    }))
                  );
                  off.setToolTipIcon("FactionUI/icons/icon_army_points.png");
                  off.setToolTipText(MMt("1st-OFF") + ": " + MMt("Offense Level"));
                  off.getChildControl("icon").set({
                    width: 18,
                    height: 18,
                    scale: true,
                    alignY: "middle",
                  });
                  offensive.add(firstoff);
                  firstoff.add(
                    (def = new qx.ui.basic.Atom(
                      firstDeflvl.toFixed(2).toString(),
                      "FactionUI/icons/icon_def_army_points.png"
                    ).set({
                      rich: true,
                    }))
                  );
                  def.setToolTipIcon(
                    "FactionUI/icons/icon_def_army_points.png"
                  );
                  def.setToolTipText(MMt("1st-OFF") + ": " + MMt("Defense Level"));
                  def.getChildControl("icon").set({
                    width: 18,
                    height: 18,
                    scale: true,
                    alignY: "middle",
                  });
                  offensive.add(firstoff);
                  firstoff.add(
                    (strom = new qx.ui.basic.Atom(
                      parseInt(firstPowerProduction).toLocaleString(),
                      "webfrontend/ui/common/icn_res_power.png"
                    ).set({
                      rich: true,
                    }))
                  );
                  strom.setToolTipIcon(
                    "webfrontend/ui/common/icn_res_power.png"
                  );
                  strom.setToolTipText(
                    MMt("1st-OFF") + ": " + MMt("Power Produktion")
                  );
                  strom.getChildControl("icon").set({
                    width: 18,
                    height: 18,
                    scale: true,
                    alignY: "middle",
                  });
                  offensive.add(firstoff);
                  firstoff.add(
                    (squad = new qx.ui.basic.Atom(
                      first_rep_fuss,
                      "FactionUI/icons/icon_arsnl_off_squad.png"
                    ).set({
                      rich: true,
                    }))
                  );
                  squad.setToolTipIcon(
                    "FactionUI/icons/icon_arsnl_off_squad.png"
                  );
                  squad.setToolTipText(
                    MMt("1st-OFF") + ": " + MMt("Infantry Repairtime")
                  );
                  squad.getChildControl("icon").set({
                    width: 18,
                    height: 18,
                    scale: true,
                    alignY: "middle",
                  });
                  offensive.add(firstoff);
                  firstoff.add(
                    (vehicle = new qx.ui.basic.Atom(
                      first_rep_fahr,
                      "FactionUI/icons/icon_arsnl_off_vehicle.png"
                    ).set({
                      rich: true,
                    }))
                  );
                  vehicle.setToolTipIcon(
                    "FactionUI/icons/icon_arsnl_off_vehicle.png"
                  );
                  vehicle.setToolTipText(
                    MMt("1st-OFF") + ": " + MMt("Vehicle Repairtime")
                  );
                  vehicle.getChildControl("icon").set({
                    width: 18,
                    height: 18,
                    scale: true,
                    alignY: "middle",
                  });
                  offensive.add(firstoff);
                  firstoff.add(
                    (plane = new qx.ui.basic.Atom(
                      first_rep_flug,
                      "FactionUI/icons/icon_arsnl_off_plane.png"
                    ).set({
                      rich: true,
                    }))
                  );
                  plane.setToolTipIcon(
                    "FactionUI/icons/icon_arsnl_off_plane.png"
                  );
                  plane.setToolTipText(
                    MMt("1st-OFF") + ": " + MMt("Aircraft Repairtime")
                  );
                  plane.getChildControl("icon").set({
                    width: 18,
                    height: 18,
                    scale: true,
                    alignY: "middle",
                  });
                  offensive.add(firstoff);

                  secondoff.add(
                    (name = new qx.ui.basic.Atom(
                      secondBaseName,
                      "FactionUI/icons/icon_arsnl_base_buildings.png"
                    ).set({
                      rich: true,
                    }))
                  );
                  name.setToolTipIcon(
                    "FactionUI/icons/icon_arsnl_base_buildings.png"
                  );
                  name.setToolTipText(MMt("2nd-OFF") + ": " + MMt("Base Name"));
                  name.getChildControl("icon").set({
                    width: 18,
                    height: 18,
                    scale: true,
                    alignY: "middle",
                  });
                  offensive.add(secondoff);
                  secondoff.add(
                    (level = new qx.ui.basic.Atom(
                      secondBaselvl.toFixed(2).toString(),
                      "FactionUI/icons/icon_arsnl_base_buildings.png"
                    ).set({
                      rich: true,
                    }))
                  );
                  level.setToolTipIcon(
                    "FactionUI/icons/icon_arsnl_base_buildings.png"
                  );
                  level.setToolTipText(MMt("2nd-OFF") + ": " + MMt("Base Level"));
                  level.getChildControl("icon").set({
                    width: 18,
                    height: 18,
                    scale: true,
                    alignY: "middle",
                  });
                  offensive.add(secondoff);
                  secondoff.add(
                    (off = new qx.ui.basic.Atom(
                      secondOfflvl.toFixed(2).toString(),
                      "FactionUI/icons/icon_army_points.png"
                    ).set({
                      rich: true,
                    }))
                  );
                  off.setToolTipIcon("FactionUI/icons/icon_army_points.png");
                  off.setToolTipText(MMt("2nd-OFF") + ": " + MMt("Offense Level"));
                  off.getChildControl("icon").set({
                    width: 18,
                    height: 18,
                    scale: true,
                    alignY: "middle",
                  });
                  offensive.add(secondoff);
                  secondoff.add(
                    (def = new qx.ui.basic.Atom(
                      secondDeflvl.toFixed(2).toString(),
                      "FactionUI/icons/icon_def_army_points.png"
                    ).set({
                      rich: true,
                    }))
                  );
                  def.setToolTipIcon(
                    "FactionUI/icons/icon_def_army_points.png"
                  );
                  def.setToolTipText(MMt("2nd-OFF") + ": " + MMt("Defensive Level"));
                  def.getChildControl("icon").set({
                    width: 18,
                    height: 18,
                    scale: true,
                    alignY: "middle",
                  });
                  offensive.add(secondoff);
                  secondoff.add(
                    (strom = new qx.ui.basic.Atom(
                      parseInt(secondPowerProduction).toLocaleString(),
                      "webfrontend/ui/common/icn_res_power.png"
                    ).set({
                      rich: true,
                    }))
                  );
                  strom.setToolTipIcon(
                    "webfrontend/ui/common/icn_res_power.png"
                  );
                  strom.setToolTipText(
                    MMt("2nd-OFF") + ": " + MMt("Power Produktion")
                  );
                  strom.getChildControl("icon").set({
                    width: 18,
                    height: 18,
                    scale: true,
                    alignY: "middle",
                  });
                  offensive.add(secondoff);
                  secondoff.add(
                    (squad = new qx.ui.basic.Atom(
                      second_rep_fuss,
                      "FactionUI/icons/icon_arsnl_off_squad.png"
                    ).set({
                      rich: true,
                    }))
                  );
                  squad.setToolTipIcon(
                    "FactionUI/icons/icon_arsnl_off_squad.png"
                  );
                  squad.setToolTipText(
                    MMt("2nd-OFF") + ": " + MMt("Infantry Repairtime")
                  );
                  squad.getChildControl("icon").set({
                    width: 18,
                    height: 18,
                    scale: true,
                    alignY: "middle",
                  });
                  offensive.add(secondoff);
                  secondoff.add(
                    (vehicle = new qx.ui.basic.Atom(
                      second_rep_fahr,
                      "FactionUI/icons/icon_arsnl_off_vehicle.png"
                    ).set({
                      rich: true,
                    }))
                  );
                  vehicle.setToolTipIcon(
                    "FactionUI/icons/icon_arsnl_off_vehicle.png"
                  );
                  vehicle.setToolTipText(
                    MMt("2nd-OFF") + ": " + MMt("Vehicle Repairtime")
                  );
                  vehicle.getChildControl("icon").set({
                    width: 18,
                    height: 18,
                    scale: true,
                    alignY: "middle",
                  });
                  offensive.add(secondoff);
                  secondoff.add(
                    (plane = new qx.ui.basic.Atom(
                      second_rep_flug,
                      "FactionUI/icons/icon_arsnl_off_plane.png"
                    ).set({
                      rich: true,
                    }))
                  );
                  plane.setToolTipIcon(
                    "FactionUI/icons/icon_arsnl_off_plane.png"
                  );
                  plane.setToolTipText(
                    MMt("2nd-OFF") + ": " + MMt("Aircraft Repairtime")
                  );
                  plane.getChildControl("icon").set({
                    width: 18,
                    height: 18,
                    scale: true,
                    alignY: "middle",
                  });
                  offensive.add(secondoff);

                  // Tab 1 General Information - 4 side-by-side columns (Mike's layout, 2026-06-20):
                  //   [Player info] | [Total Production (stacked: Players + Total)] | [First Offense] | [Second Offense]
                  // firstoff/secondoff already carry their own column headings + values; qx re-parents them
                  // out of the now-unused `offensive` HBox (which still gets the dozens of redundant
                  // `offensive.add(firstoff)` calls above - harmless: qx is a no-op when re-adding the same
                  // child to the same parent, and they all happen BEFORE the re-parent below).
                  field2.add(production);
                  var generalRow = new qx.ui.container.Composite(
                    new qx.ui.layout.HBox(24).set({ alignX: "left", alignY: "top" })
                  );
                  generalRow.add(GeneralField1);
                  generalRow.add(field2);
                  generalRow.add(firstoff);
                  generalRow.add(secondoff);
                  this.BaseinfoGeneralVBox.add(generalRow);

                  // === Tab 2 (All Bases): click-sortable columns ============================
                  // Each column VBox already has its header label (added at construction). We:
                  //   1) capture each header label,
                  //   2) make it clickable (toggles sort key/direction),
                  //   3) render row Labels from the rows[] collected during the per-base loop above.
                  // Sorting just re-renders from rows[] - no need to re-query the game data.
                  var COLS = [
                    { key: "name",    vbox: BasenName,      align: "left",  sortVal: function (r) { return String(r.name).toLowerCase(); }, display: function (r) { return r.name; } },
                    { key: "base",    vbox: BasenBase,      align: "right", sortVal: function (r) { return r.base; },                        display: function (r) { return r.base.toFixed(2); } },
                    { key: "off",     vbox: BasenOffensive, align: "right", sortVal: function (r) { return r.off; },                         display: function (r) { return r.off.toFixed(2); } },
                    { key: "def",     vbox: BasenDefensive, align: "right", sortVal: function (r) { return r.def; },                         display: function (r) { return r.def.toFixed(2); } },
                    { key: "bh",      vbox: BasenBH,        align: "right", sortVal: function (r) { return r.bh; },                          display: function (r) { return r.bhText; } },
                    { key: "cc",      vbox: BasenCC,        align: "right", sortVal: function (r) { return r.cc; },                          display: function (r) { return r.ccText; } },
                    { key: "ve",      vbox: BasenVE,        align: "right", sortVal: function (r) { return r.ve; },                          display: function (r) { return r.veText; } },
                    { key: "vz",      vbox: BasenVZ,        align: "right", sortVal: function (r) { return r.vz; },                          display: function (r) { return r.vzText; } },
                    { key: "support", vbox: BasenSupport,   align: "left",  sortVal: function (r) { return r.support; },                     display: function (r) { return r.support.toFixed(0) + " " + r.supportName; } },
                    { key: "tib",     vbox: BasenTiberium,  align: "right", sortVal: function (r) { return r.tib; },                         display: function (r) { return r.tib.toLocaleString(); } },
                    { key: "cry",     vbox: BasenCrystal,   align: "right", sortVal: function (r) { return r.cry; },                         display: function (r) { return r.cry.toLocaleString(); } },
                    { key: "pow",     vbox: BasenPower,     align: "right", sortVal: function (r) { return r.pow; },                         display: function (r) { return r.pow.toLocaleString(); } },
                    { key: "cred",    vbox: BasenCredits,   align: "right", sortVal: function (r) { return r.cred; },                        display: function (r) { return r.cred.toLocaleString(); } }
                  ];
                  var currentSort = { key: "name", dir: 1 }; // default: Name ascending
                  var headerHtml = {};

                  function renderAllBases() {
                    // 1) Update header labels with the sort indicator on the active column
                    COLS.forEach(function (c) {
                      if (!c._header) return;
                      var arrow = (currentSort.key === c.key) ? (currentSort.dir > 0 ? " ▲" : " ▼") : "";
                      try { c._header.setValue(headerHtml[c.key] + arrow); } catch (e) {}
                    });
                    // 2) Clear all rows under each column (keep header = first child)
                    COLS.forEach(function (c) {
                      try {
                        var kids = c.vbox.getChildren();
                        for (var i = kids.length - 1; i >= 1; i--) {
                          var k = kids[i];
                          c.vbox.remove(k);
                          try { k.destroy(); } catch (e) {}
                        }
                      } catch (e) {}
                    });
                    // 3) Sort rows[] by the current column. Nulls go to the bottom either way.
                    var col = null;
                    for (var i = 0; i < COLS.length; i++) if (COLS[i].key === currentSort.key) { col = COLS[i]; break; }
                    var sorted = rows.slice().sort(function (a, b) {
                      var av = col.sortVal(a), bv = col.sortVal(b);
                      var aNull = (av == null) || (typeof av === "number" && isNaN(av));
                      var bNull = (bv == null) || (typeof bv === "number" && isNaN(bv));
                      if (aNull && !bNull) return 1;
                      if (bNull && !aNull) return -1;
                      if (aNull && bNull) return 0;
                      if (av < bv) return -currentSort.dir;
                      if (av > bv) return  currentSort.dir;
                      return 0;
                    });
                    // 4) Render sorted rows under each column
                    sorted.forEach(function (r) {
                      COLS.forEach(function (c) {
                        try {
                          c.vbox.add(new qx.ui.basic.Label(c.display(r)).set({ rich: true, alignX: c.align }));
                        } catch (e) {}
                      });
                    });
                  }

                  // Capture headers + bind clicks. Done once, after the columns exist and before
                  // the first render.
                  COLS.forEach(function (c) {
                    try {
                      var kids = c.vbox.getChildren();
                      if (!kids || !kids.length) return;
                      c._header = kids[0];
                      headerHtml[c.key] = c._header.getValue();
                      c._header.set({ cursor: "pointer", toolTipText: MMt("Click to sort by this column") });
                      c._header.addListener("click", function () {
                        if (currentSort.key === c.key) currentSort.dir = -currentSort.dir;
                        else { currentSort.key = c.key; currentSort.dir = 1; }
                        renderAllBases();
                      });
                    } catch (e) {}
                  });
                  renderAllBases();

                  Basen.add(BasenName);
                  Basen.add(BasenBase);
                  Basen.add(BasenOffensive);
                  Basen.add(BasenDefensive);
                  Basen.add(BasenBH);
                  Basen.add(BasenCC);
                  Basen.add(BasenVE);
                  Basen.add(BasenVZ);
                  Basen.add(BasenSupport);
                  Basen.add(BasenTiberium);
                  Basen.add(BasenCrystal);
                  Basen.add(BasenPower);
                  Basen.add(BasenCredits);
                  GeneralField5.add(Basen);
                  this.BaseinfoAllBasesVBox.add(GeneralField5);
                } catch (e) {
                  werr("Loading error:", e);
                }
              },
            },
          });
      } catch (e) {
        wwarn("qx.Class.define failed:", e);
      }
      BaseInfo.getInstance();
    }

    function LoadExtension() {
      try {
        if (
          typeof qx != "undefined" &&
          qx.core.Init.getApplication() !== null
        ) {
          // Wait for the menu bar AND for MMCommon - we now register our button into the shared
          // MMCommon HUD tray, so we can't initialize before that library has installed.
          if (
            !!qx.core.Init.getApplication().getMenuBar() &&
            window.MMCommon && window.MMCommon.buttons
          ) {
            BaseInfoCreate();
            BaseInfo.getInstance().initialize();
            return;
          }
        }
      } catch (e) { werr("LoadExtension poll:", e); }
      window.setTimeout(LoadExtension, 1000);
    }
    LoadExtension();
  };

  function Inject() {
    if (window.location.pathname != "/login/auth") {
      var Script = document.createElement("script");
      Script.textContent = "(" + BaseInfoMain.toString() + ")();";
      Script.type = "text/javascript";
      document.getElementsByTagName("head")[0].appendChild(Script);
    }
  }
  Inject();
})();
