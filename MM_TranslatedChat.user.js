// ==UserScript==
// @name            MM - Translated Chat
// @description     A frameless replacement chat window that auto-translates incoming messages into your region language, entirely on-device (Chrome/Edge built-in Translator + Language Detector - nothing leaves your browser). Channel tabs (All / Global / Alliance / Whisper) switch the channel and target your sends; type and send from the window; each translated line is tagged with a two-letter source-language code between the [channel] and the [player], original shown dimmed. Padlock docks it lower-left like the native chat, or unlock to move + resize. Hides the native chat; remembers everything across logins.
// @author          MikeyMike (CnCTA-MikeyMike-SCRIPT-PACK)
// @contributor     MikeyMike (CnCTA-MikeyMike-SCRIPT-PACK)
// @version         1.2.7
// @match           https://*.alliances.commandandconquer.com/*/index.aspx*
// @downloadURL     https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/MM_TranslatedChat.user.js
// @updateURL       https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/MM_TranslatedChat.user.js
// ==/UserScript==

/*
================================================================================
 MM - Translated Chat
================================================================================
 A frameless custom chat window that REPLACES the native game chat (hidden; a
 header toggle / closing the window brings it back). It mirrors every message and
 auto-translates it into your region language ON-DEVICE (Chrome: Translator +
 LanguageDetector / Gemini Nano; Edge 148+: Phi-4-mini) - text never leaves the
 browser. Each line: HH:MM:SS [Channel] [LANG] [Player]: text (LANG only when
 translated from a non-region language; original shown dimmed).

 CHROME / UX (matches the native chat)
   - Custom blue title strip: [minimize ✕] [padlock] "Translated Chat (Channel)".
   - Padlock: 🔒 = docked lower-left, fixed (locked); 🔓 = free to drag + resize.
   - Minimize ✕ closes the window; reopen with the "Translated Chat" button in the
     MM Tools bar (native stays hidden = still replaced).
   - Channel tabs All / Global / Alliance / Whisper: filter the feed AND set the
     channel your typed messages go to. The title shows the selected channel.
   - Everything persists per player+world: locked state, hide-native, window
     position/size, and open state - restored on next login.

 HOW IT HOOKS THE GAME (readable game API - no de-obfuscation)
   Native chat = webfrontend.gui.chat.ChatWindow; .getChatWidget() =
   webfrontend.gui.chat.ChatWidget renders every message through showMessage(html,
   ...). We wrap it (call original, then mirror) and parse the HTML
   (data-chat-message = raw text, data-chat-senderId, sender name,
   data-chat-messagetype, channel colour, timestamp). Channel is classified by
   data-chat-messagetype (6=Global, 8=Alliance, 7=Whisper); Global carries no
   [label] bracket so we never parse it from text. Channels live in the
   ChatWidget's TabView (.getChildren()[0]); we switch channel by setting its
   selection (page resolved by icon) and send via ChatWidget.send("text"). The
   native window is hidden with setVisibility("excluded") (the widget stays alive
   and keeps calling showMessage, so the mirror keeps working).

 DEPENDENCIES (pack rule: wrapper + Common Library only)
     MMCommon.ui.Window + MMCommon.buttons - the window + HUD toggle
     MMCommon.settings - per player+world persistence
     MMCommon.i18n     - getLang() = the translation target; t() for UI strings
   No dependency on any other userscript. Translation engine is self-contained.

 Settings (MMCommon.settings, per player+world): TranslatedChat.* (enabled,
   showOriginal, target, locked, hideNative, window geom + open state).
 Debug: window.MMTRANSLATEDCHAT_DEBUG = true (or window.MM_DEBUG = true).
================================================================================
*/

(function () {
    var TranslatedChat_main = function () {
        function MMt(s) { try { return (window.MMCommon && window.MMCommon.i18n) ? window.MMCommon.i18n.t(s) : s; } catch (e) { return s; } }
        var LOG = (window.MMCommon && window.MMCommon.makeLogger)
            ? window.MMCommon.makeLogger("Translated Chat")
            : { log: function () {}, warn: function () { try { console.warn.apply(console, arguments); } catch (e) {} }, err: function () { try { console.error.apply(console, arguments); } catch (e) {} } };

        if (typeof window.MMTRANSLATEDCHAT_DEBUG === "undefined") {
            try { window.MMTRANSLATEDCHAT_DEBUG = (window.localStorage.getItem("MMTRANSLATEDCHAT_DEBUG") === "1"); } catch (e) { window.MMTRANSLATEDCHAT_DEBUG = false; }
        }
        var wlog = function () { if (!(window.MMTRANSLATEDCHAT_DEBUG || window.MM_DEBUG)) return; LOG.log.apply(LOG, arguments); };
        var wwarn = function () { LOG.warn.apply(LOG, arguments); };
        var werr = function () { LOG.err.apply(LOG, arguments); };

        var MM = window.MMCommon;
        var SET = "TranslatedChat.";
        var MAXROWS = 250;

        function esc(s) { try { return qx.bom.String.escape(String(s == null ? "" : s)); } catch (e) { return String(s == null ? "" : s); } }
        function enabled() { try { return MM.settings.get(SET + "enabled", true) !== false; } catch (e) { return true; } }
        function showOriginal() { try { return MM.settings.get(SET + "showOriginal", true) !== false; } catch (e) { return true; } }
        function targetLang() { try { var o = MM.settings.get(SET + "target", null); return o || MM.i18n.getLang() || "en"; } catch (e) { return "en"; } }
        function isLocked() { try { return MM.settings.get(SET + "locked", true) !== false; } catch (e) { return true; } }
        // Default OFF: keep the game's native chat unless the user deliberately opts in to replacing it.
        function hideNative() { try { return MM.settings.get(SET + "hideNative", false) === true; } catch (e) { return false; } }

        // ----------------------------------------------------------------------
        // On-device translation engine
        // ----------------------------------------------------------------------
        var Tr = (function () {
            function has(name) { try { return (name in self) && typeof self[name] !== "undefined"; } catch (e) { return false; } }
            var supported = has("Translator") && has("LanguageDetector");
            var detectorP = null, translators = {}, cache = {};
            function getDetector() {
                if (detectorP) return detectorP;
                detectorP = (async function () {
                    var av = await LanguageDetector.availability();
                    if (av === "unavailable") throw new Error("LanguageDetector unavailable");
                    return await LanguageDetector.create();
                })();
                detectorP.catch(function () { detectorP = null; });
                return detectorP;
            }
            function getTranslator(src, tgt) {
                var k = src + ">" + tgt;
                if (translators[k]) return translators[k];
                translators[k] = (async function () {
                    var av = await Translator.availability({ sourceLanguage: src, targetLanguage: tgt });
                    if (av === "unavailable") throw new Error("Translator unavailable " + k);
                    return await Translator.create({ sourceLanguage: src, targetLanguage: tgt });
                })();
                translators[k].catch(function () { delete translators[k]; });
                return translators[k];
            }
            return {
                supported: supported,
                warm: function () { if (supported) { try { getDetector(); } catch (e) {} } },
                status: function () {
                    if (!supported) return Promise.resolve("unsupported");
                    return (async function () {
                        try { var a = await LanguageDetector.availability(); return (a === "unavailable") ? "unavailable" : (a === "available" ? "ready" : "downloading"); }
                        catch (e) { return "unavailable"; }
                    })();
                },
                process: function (text, tgt) {
                    if (!supported || !text) return Promise.resolve({ translated: false });
                    var key = tgt + "|" + text;
                    if (cache[key]) return cache[key];
                    var p = (async function () {
                        var det = await getDetector();
                        var res = await det.detect(text);
                        var top = res && res[0];
                        var src = top && top.detectedLanguage;
                        var conf = top ? (top.confidence || 0) : 0;
                        if (!src || src === "und" || src === tgt || conf < 0.5) return { translated: false, src: src };
                        var tr = await getTranslator(src, tgt);
                        var out = await tr.translate(text);
                        if (out == null || out === text) return { translated: false, src: src };
                        return { translated: true, src: src, out: out };
                    })().catch(function (e) { wwarn("translate failed:", e); return { translated: false }; });
                    cache[key] = p;
                    return p;
                }
            };
        })();

        // ----------------------------------------------------------------------
        // Channel model (classify INCOMING by data-chat-messagetype; resolve the
        // native page index for SENDING by icon).
        // ----------------------------------------------------------------------
        var MTYPE_CHAN = { "6": "global", "8": "alliance", "7": "whisper" };
        var CHAN = {
            all:      { label: MMt("All"),      color: "#cfe6ff", icons: ["all"] },
            global:   { label: MMt("Global"),   color: "#FFAA00", icons: ["world", "global"] },
            alliance: { label: MMt("Alliance"), color: "#ABFF5C", icons: ["alliance"] },
            whisper:  { label: MMt("Whisper"),  color: "#ff95b3", icons: ["whisper", "private"] }
        };
        var TAB_ORDER = ["all", "global", "alliance", "whisper"];

        function getChat() { try { return qx.core.Init.getApplication().getChat(); } catch (e) { return null; } }
        function getWidget() { try { var c = getChat(); return c && c.getChatWidget ? c.getChatWidget() : null; } catch (e) { return null; } }
        function getTabView() { try { var w = getWidget(); var ch = w && w.getChildren && w.getChildren(); return (ch && ch[0]) || null; } catch (e) { return null; } }
        function pagesOf(tv) { try { return (tv.getSelectables ? tv.getSelectables() : tv.getChildren()) || []; } catch (e) { return []; } }
        function nativeIdxFor(key) {
            try {
                var keys = (CHAN[key] && CHAN[key].icons) || [];
                var pages = pagesOf(getTabView());
                for (var i = 0; i < pages.length; i++) {
                    var icon = ""; try { icon = String(pages[i].getIcon() || "").toLowerCase(); } catch (e) {}
                    for (var k = 0; k < keys.length; k++) if (icon.indexOf("channel_" + keys[k]) !== -1) return i;
                }
            } catch (e) { wwarn("nativeIdxFor:", e); }
            return -1;
        }
        function selectChannelIdx(idx) {
            try { if (idx < 0) return false; var tv = getTabView(); var pages = pagesOf(tv); if (pages[idx] && tv.setSelection) { tv.setSelection([pages[idx]]); return true; } }
            catch (e) { wwarn("selectChannelIdx:", e); }
            return false;
        }
        function setNativeHidden(hidden) {
            try { var chat = getChat(); if (chat && chat.setVisibility) chat.setVisibility(hidden ? "excluded" : "visible"); }
            catch (e) { wwarn("setNativeHidden:", e); }
        }
        // Are we actually in an alliance? (so we don't let an Alliance send fall through to Global.)
        function inAlliance() {
            try { var md = ClientLib.Data.MainData.GetInstance(); var a = md.get_Alliance && md.get_Alliance(); if (a) { if (typeof a.get_Exists === "function") return !!a.get_Exists(); if (typeof a.get_Id === "function") return a.get_Id() > 0; } } catch (e) {}
            try { var p = ClientLib.Data.MainData.GetInstance().get_Player(); if (p && typeof p.get_AllianceId === "function") return p.get_AllianceId() > 0; } catch (e) {}
            return true; // unknown -> don't block
        }
        // Can we send on this channel right now? (alliance requires actually being in one + the page existing)
        function channelAvailable(key) {
            if (key === "alliance") return inAlliance() && nativeIdxFor("alliance") >= 0;
            return nativeIdxFor(key) >= 0;
        }

        // ----------------------------------------------------------------------
        // Parse / render
        // ----------------------------------------------------------------------
        function parseMessage(html) {
            try {
                var d = document.createElement("div");
                d.innerHTML = String(html == null ? "" : html);
                var span = d.querySelector("span[data-chat-message]");
                var raw = span ? span.getAttribute("data-chat-message") : null;
                var senderId = span ? span.getAttribute("data-chat-senderId") : null;
                var mtype = span ? span.getAttribute("data-chat-messagetype") : null;
                var sender = span ? (span.textContent || "") : "";
                var tm = String(html).match(/(\d{1,2}:\d{2}:\d{2})/);
                var time = tm ? tm[1] : "";
                var chanColor = null;
                var fonts = d.querySelectorAll("font");
                for (var i = 0; i < fonts.length; i++) {
                    var col = fonts[i].getAttribute("color");
                    if (col && col.toLowerCase() !== "white") { chanColor = col; break; }
                }
                var chanKey = MTYPE_CHAN[String(mtype)] || "other";
                var def = CHAN[chanKey];
                return {
                    time: time, chanKey: chanKey,
                    chan: def ? def.label : "",
                    chanColor: chanColor || (def ? def.color : null),
                    sender: sender, senderId: senderId, mtype: mtype, raw: raw,
                    plain: (d.textContent || "").trim()
                };
            } catch (e) { wwarn("parse failed:", e); return null; }
        }

        function lineHtml(p, tr, pending) {
            var s = "";
            if (p.time) s += '<span style="color:#6f8aa3;">' + esc(p.time) + '</span> ';
            if (p.chan) s += '<span style="color:' + (p.chanColor || "#9ab0c0") + ';">[' + esc(p.chan) + ']</span> ';
            if (tr && tr.translated && tr.src) s += '<span style="background:#5a4410;color:#f0c662;font-size:10px;font-weight:bold;padding:0 4px;border-radius:3px;">' + esc(String(tr.src).toUpperCase()) + '</span> ';
            if (p.sender) s += '<span style="color:#d8b878;">[' + esc(p.sender) + ']:</span> ';
            var bodyText = (tr && tr.translated) ? tr.out : (p.raw != null ? p.raw : p.plain);
            s += '<span style="color:#e6edf3;">' + esc(bodyText) + '</span>';
            if (tr && tr.translated && showOriginal() && p.raw != null) s += ' <span style="color:#5d7d9c;font-style:italic;font-size:11px;">(' + esc(p.raw) + ')</span>';
            if (!tr && pending) s += ' <span style="color:#5d7d9c;font-style:italic;font-size:11px;">· ' + esc(MMt("translating…")) + '</span>';
            return s;
        }

        // ----------------------------------------------------------------------
        // UI
        // ----------------------------------------------------------------------
        function build() {
            wlog("building UI");
            try { Tr.warm(); } catch (e) {}

            var rows = [];
            // Restore the channel tab + last send-channel the user left on (persisted per player+world);
            // re-read on appear too, in case build() ran before the settings store keyed to the player.
            var activeFilter = MM.settings.get(SET + "filter", "all") || "all";
            var lastChanKey = MM.settings.get(SET + "lastChan", "global") || "global";   // All-tab send target until a channel tab is picked (global is always available)
            var TXT = "#e8e8e8";

            // ---- feed ----
            var list = new qx.ui.container.Composite(new qx.ui.layout.VBox(2)).set({ padding: 6, backgroundColor: "#0c1a28" });
            var scroll = new qx.ui.container.Scroll();
            scroll.add(list);
            function atBottom() { try { return (scroll.getScrollY() >= scroll.getScrollMaxY() - 24); } catch (e) { return true; } }
            function scrollBottomSoon(force) { var stick = force || atBottom(); if (!stick) return; window.setTimeout(function () { try { scroll.scrollToY(scroll.getScrollMaxY()); } catch (e) {} }, 0); }
            function rowVisible(r) { return (activeFilter === "all") || (r.chanKey === activeFilter); }
            function applyFilter() { for (var i = 0; i < rows.length; i++) { try { rows[i].lbl.setVisibility(rowVisible(rows[i]) ? "visible" : "excluded"); } catch (e) {} } scrollBottomSoon(true); }
            function addRow(p) {
                var r = { lbl: null, p: p, tr: null, chanKey: p.chanKey };
                var lbl = new qx.ui.basic.Label(lineHtml(p, null)).set({ rich: true, selectable: true, allowGrowX: true, font: new qx.bom.Font(12, ["sans-serif"]) });
                r.lbl = lbl;
                var wasBottom = atBottom();
                list.add(lbl);
                if (!rowVisible(r)) lbl.setVisibility("excluded");
                rows.push(r);
                while (rows.length > MAXROWS) { var old = rows.shift(); try { list.remove(old.lbl); old.lbl.dispose && old.lbl.dispose(); } catch (e) {} }
                scrollBottomSoon(wasBottom);
                return r;
            }
            function onMessage(html) {
                if (!enabled()) return;
                var p = parseMessage(html);
                if (!p) return;
                if (!p.raw || String(p.mtype) === "0") return;
                var row = addRow(p);
                if (p.raw && Tr.supported) {
                    var tgt = targetLang(), done = false;
                    var hintTimer = window.setTimeout(function () { if (!done) { try { row.lbl.setValue(lineHtml(p, null, true)); } catch (e) {} } }, 400);
                    Tr.process(p.raw, tgt).then(function (tr) {
                        done = true; try { window.clearTimeout(hintTimer); } catch (e) {}
                        try { row.tr = tr; row.lbl.setValue(lineHtml(p, tr)); if (tr && tr.translated && rowVisible(row)) scrollBottomSoon(); } catch (e) {}
                    });
                }
            }
            function hookChat() {
                try {
                    var cw = getWidget();
                    if (!cw) return false;
                    if (cw.__mmTransHooked) return true;
                    var orig = cw.showMessage;
                    if (typeof orig !== "function") { werr("showMessage not found"); return false; }
                    cw.showMessage = function () { var r = orig.apply(this, arguments); try { onMessage(arguments[0]); } catch (e) { wwarn("onMessage:", e); } return r; };
                    cw.__mmTransHooked = true;
                    wlog("showMessage hooked");
                    return true;
                } catch (e) { werr("hookChat failed:", e); return false; }
            }
            if (!hookChat()) window.setTimeout(hookChat, 1500);

            // ---- title strip (frameless chrome: minimize, padlock, channel-aware title) ----
            var titleStrip = new qx.ui.container.Composite(new qx.ui.layout.HBox(6)).set({ padding: [3, 7], backgroundColor: "#1c4f7c" });
            var minBtn = new qx.ui.basic.Label("✕").set({ cursor: "pointer", alignY: "middle", textColor: "#cfe6ff", font: new qx.bom.Font(13, ["sans-serif"]).set({ bold: true }), toolTipText: MMt("Minimize") });
            var lockLbl = new qx.ui.basic.Label("🔓").set({ cursor: "pointer", alignY: "middle", font: new qx.bom.Font(13, ["sans-serif"]), toolTipText: MMt("Lock") });
            var titleLbl = new qx.ui.basic.Label("").set({ alignY: "middle", textColor: "#ffffff", font: new qx.bom.Font(12, ["sans-serif"]).set({ bold: true }) });
            titleStrip.add(minBtn);
            titleStrip.add(lockLbl);
            titleStrip.add(titleLbl, { flex: 1 });
            // clicks on the buttons must not start a drag
            minBtn.addListener("mousedown", function (e) { e.stopPropagation(); });
            lockLbl.addListener("mousedown", function (e) { e.stopPropagation(); });
            function sendKeyNow() { return (activeFilter === "all") ? lastChanKey : activeFilter; }
            function updateTitle() {
                try {
                    var label;
                    if (activeFilter === "all") { var sk = CHAN[sendKeyNow()]; label = MMt("All") + " → " + (sk ? sk.label : ""); }
                    else { var d = CHAN[activeFilter]; label = d ? d.label : MMt("All"); }
                    titleLbl.setValue(MMt("Translated Chat") + " (" + label + ")");
                } catch (e) {}
            }

            // ---- channel tabs ----
            var tabsBar = new qx.ui.container.Composite(new qx.ui.layout.Flow(3, 3)).set({ padding: 4, backgroundColor: "#0a1521" });
            var tabBtns = {};
            function makeTab(key) {
                var def = CHAN[key];
                var b = new qx.ui.form.ToggleButton(def.label).set({ focusable: false, padding: [2, 8] });
                if (key !== "all") { try { b.setTextColor(def.color); } catch (e) {} }
                tabsBar.add(b);
                // use execute (click), not the toggle's own value/RadioGroup, so re-clicking the active tab
                // keeps it selected (a RadioGroup let a second click toggle off and fall back to All)
                b.addListener("execute", function () { selectTab(key); });
                return b;
            }
            function selectTab(key) {
                activeFilter = key;
                try { MM.settings.set(SET + "filter", key); } catch (e) {}
                if (key !== "all") { lastChanKey = key; try { MM.settings.set(SET + "lastChan", key); } catch (e) {} selectChannelIdx(nativeIdxFor(key)); }
                for (var i = 0; i < TAB_ORDER.length; i++) { var k = TAB_ORDER[i]; var bb = tabBtns[k]; if (bb) try { bb.setValue(k === key); } catch (e) {} }
                updateTitle(); updateSendTarget(); applyFilter();
            }
            function buildTabs() {
                for (var i = 0; i < TAB_ORDER.length; i++) { var k = TAB_ORDER[i]; if (!tabBtns[k]) tabBtns[k] = makeTab(k); }
                for (var j = 0; j < TAB_ORDER.length; j++) { var kk = TAB_ORDER[j]; var b = tabBtns[kk]; if (b) try { b.setValue(kk === activeFilter); } catch (e) {} }
            }
            // grey out channels you can't use right now (e.g. Alliance when you're not in an alliance)
            function updateTabAvailability() {
                try {
                    for (var i = 0; i < TAB_ORDER.length; i++) {
                        var k = TAB_ORDER[i]; if (k === "all") continue;
                        var b = tabBtns[k]; if (!b) continue;
                        var ok = channelAvailable(k);
                        b.setEnabled(ok);
                        if (!ok && activeFilter === k) { selectTab("all"); }
                    }
                } catch (e) {}
            }

            // ---- controls row ----
            var controls = new qx.ui.container.Composite(new qx.ui.layout.HBox(8)).set({ padding: 5, backgroundColor: "#10243a" });
            var origChk = new qx.ui.form.CheckBox(MMt("Show original")).set({ alignY: "middle", textColor: TXT });
            var nativeChk = new qx.ui.form.CheckBox(MMt("Hide native chat")).set({ alignY: "middle", textColor: TXT });
            var statusLbl = new qx.ui.basic.Label("").set({ alignY: "middle", rich: true, textColor: "#9fb4c0", font: new qx.bom.Font(11, ["sans-serif"]) });
            origChk.setValue(showOriginal());
            origChk.addListener("changeValue", function () { try { MM.settings.set(SET + "showOriginal", origChk.getValue()); for (var i = 0; i < rows.length; i++) rows[i].lbl.setValue(lineHtml(rows[i].p, rows[i].tr)); } catch (e) {} });
            controls.add(new qx.ui.basic.Label(MMt("to:")).set({ alignY: "middle", textColor: TXT }));
            controls.add(new qx.ui.basic.Label(String(targetLang()).toUpperCase()).set({ alignY: "middle", textColor: "#cfe6ff", font: new qx.bom.Font(12, ["sans-serif"]).set({ bold: true }) }));
            controls.add(origChk);
            controls.add(nativeChk);
            controls.add(new qx.ui.core.Spacer(), { flex: 1 });
            controls.add(statusLbl);
            function setStatus(s) {
                var map = {
                    ready: '<span style="color:#7bd88f;">' + MMt("translation ready") + '</span>',
                    downloading: '<span style="color:#e6c662;">' + MMt("preparing model…") + '</span>',
                    unavailable: '<span style="color:#e08a8a;">' + MMt("translation unavailable") + '</span>',
                    unsupported: '<span style="color:#e08a8a;">' + MMt("no built-in translator") + '</span>'
                };
                try { statusLbl.setValue(map[s] || ""); } catch (e) {}
            }
            function refreshStatus() { Tr.status().then(setStatus, function () { setStatus("unavailable"); }); }
            function flashNotice(msg) { try { statusLbl.setValue('<span style="color:#ff8a8a;">' + esc(msg) + '</span>'); window.setTimeout(refreshStatus, 3500); } catch (e) {} }
            refreshStatus();

            // ---- input row ----
            var inputRow = new qx.ui.container.Composite(new qx.ui.layout.HBox(6)).set({ padding: 5, backgroundColor: "#10243a" });
            var input = new qx.ui.form.TextField().set({ placeholder: MMt("Type a message"), maxLength: 256 });
            var sendBtn = new qx.ui.form.Button(MMt("Send")).set({ focusable: false });
            // prominent "where your message goes" chip (matters most on the All tab, where you view all but
            // send to one channel) - coloured by that channel
            var sendChip = new qx.ui.basic.Label("").set({ rich: true, alignY: "middle", font: new qx.bom.Font(12, ["sans-serif"]) });
            function updateSendTarget() {
                try { var d = CHAN[sendKeyNow()] || CHAN.global; sendChip.setValue('<span style="background:' + d.color + ';color:#10243a;padding:2px 9px;border-radius:4px;font-weight:bold;">➤ ' + esc(d.label) + '</span>'); } catch (e) {}
            }
            function doSend() {
                var text = (input.getValue() || "").trim();
                if (!text) return;
                var key = (activeFilter === "all") ? lastChanKey : activeFilter;
                // never let an unavailable channel (e.g. Alliance when you're not in one) fall through to another
                if (!channelAvailable(key)) {
                    flashNotice((key === "alliance") ? MMt("Can't send — you're not in an alliance.") : (MMt("Can't send — channel unavailable.")));
                    return;
                }
                try {
                    selectChannelIdx(nativeIdxFor(key));
                    var cw = getWidget();
                    if (cw && typeof cw.send === "function") cw.send(text);
                    input.setValue("");
                } catch (e) { werr("send failed:", e); }
            }
            sendBtn.addListener("execute", doSend);
            input.addListener("keypress", function (e) { if (e.getKeyIdentifier() === "Enter") doSend(); });
            inputRow.add(sendChip);
            inputRow.add(input, { flex: 1 });
            inputRow.add(sendBtn);

            // ---- window (frameless: own title strip is the chrome) ----
            var win = MM.ui.Window({
                caption: MMt("MM - Translated Chat"),
                key: "TranslatedChat.Window",
                layout: new qx.ui.layout.VBox(0),
                width: 460, height: 320,
                persistSize: false, restoreOpen: true, resizable: true,
                dock: false, contentPadding: 0
            });
            if (!win) { werr("window creation failed"); return; }
            // frameless-ish: drop the qx caption bar so our blue title strip is the only chrome
            // (keep the window decorator so the resize handles still work when unlocked)
            try { var cb = win.getChildControl("captionbar"); if (cb) cb.exclude(); } catch (e) {}
            // the theme's pane decorator only borders 3 sides (no top, where the caption bar used to be) -
            // drop it and paint our own uniform border so all four edges match
            try { var pane = win.getChildControl("pane"); if (pane) pane.setDecorator(null); } catch (e) {}
            function styleFrame() { try { var de = win.getContentElement().getDomElement(); if (de) { de.style.border = "1px solid #3a6e9c"; de.style.borderRadius = "4px"; de.style.boxSizing = "border-box"; } } catch (e) {} }
            win.addListener("appear", styleFrame);
            styleFrame();
            win.add(titleStrip);
            win.add(controls);
            win.add(tabsBar);
            win.add(scroll, { flex: 1 });
            win.add(inputRow);
            buildTabs();
            updateTabAvailability();
            updateTitle();
            updateSendTarget();

            // ---- drag by the title strip (only when unlocked); win captures so moves track ----
            (function () {
                var drag = false, ox = 0, oy = 0;
                titleStrip.addListener("mousedown", function (e) {
                    if (isLocked()) return;
                    try { var b = win.getBounds(); if (!b || b.left == null) return; ox = e.getDocumentLeft() - b.left; oy = e.getDocumentTop() - b.top; drag = true; win.capture(true); e.stop(); } catch (er) {}
                });
                win.addListener("mousemove", function (e) { if (!drag) return; try { win.moveTo(Math.max(0, e.getDocumentLeft() - ox), Math.max(0, e.getDocumentTop() - oy)); } catch (er) {} });
                function end() { if (!drag) return; drag = false; try { win.releaseCapture(); } catch (er) {} saveUG(); }
                win.addListener("mouseup", end);
                win.addListener("losecapture", end);
            })();

            // ---- lock / dock + geometry memory ----
            // Locked = a fixed compact size docked lower-left (like the native chat). Unlocked = the last
            // size/position you left it at (remembered separately, so locking doesn't clobber it).
            var DOCK = { w: 430, h: 250 };
            var DEF_UG = { left: 220, top: 120, width: 460, height: 320 };
            var MIN_W = 280, MIN_H = 220;   // smallest sane unlocked size; rejects/repairs a collapsed box
            var applyingGeom = false;       // suppress saveUG while we're (re)applying a restored size on appear
            // Read the saved unlocked geometry, CLAMPED to sane minimums. A collapsed height (the window
            // briefly shrinks to its content height on open) used to get saved and then faithfully re-applied
            // every reload, so the window came back short forever. Clamping here repairs any such stale value.
            function getUG() {
                try {
                    var g = MM.settings.get(SET + "ug", null);
                    if (!g || !g.width) return DEF_UG;
                    return {
                        left: (g.left != null ? g.left : DEF_UG.left),
                        top: (g.top != null ? g.top : DEF_UG.top),
                        width: Math.max(MIN_W, g.width),
                        height: Math.max(MIN_H, g.height)
                    };
                } catch (e) { return DEF_UG; }
            }
            // Save only a real, settled, on-screen size - never while we're mid-restore, and never a
            // collapsed box (below the sane minimum), so a transient shrink can't corrupt the saved size.
            function saveUG() {
                try {
                    if (isLocked() || applyingGeom || !win.isVisible()) return;
                    var b = win.getBounds();
                    if (b && b.left != null && b.width >= MIN_W && b.height >= MIN_H) {
                        MM.settings.set(SET + "ug", { left: b.left, top: b.top, width: b.width, height: b.height });
                    }
                } catch (e) {}
            }
            function viewH() { try { var r = qx.core.Init.getApplication().getRoot().getBounds() || {}; return r.height || window.innerHeight || 720; } catch (e) { return 720; } }
            function applyDocked() { try { win.setWidth(DOCK.w); win.setHeight(DOCK.h); win.moveTo(6, Math.max(0, viewH() - DOCK.h - 4)); } catch (e) {} }
            // Apply the saved unlocked size/pos, then RE-APPLY after layout settles: a single early setHeight
            // gets overridden by the content size hint before the window is fully realized (same trap the
            // MM.ui.Window geometry restore guards against), which collapsed the height on reload.
            function applyUnlockedGeom() {
                var g = getUG();
                applyingGeom = true;
                function put() { try { win.setWidth(g.width); win.setHeight(g.height); win.moveTo(g.left, g.top); } catch (e) {} }
                put();
                // re-apply across several frames - a late layout flush (tab build / translation-status update)
                // can re-collapse the height after a single set; saving stays suppressed until the last one
                window.setTimeout(function () { if (!isLocked()) put(); }, 60);
                window.setTimeout(function () { if (!isLocked()) put(); }, 360);
                window.setTimeout(function () { if (!isLocked()) put(); applyingGeom = false; }, 850);
            }
            function applyLock(locked, captureFirst) {
                try {
                    lockLbl.setValue(locked ? "🔒" : "🔓");
                    lockLbl.setToolTipText(locked ? MMt("Unlock") : MMt("Lock"));
                    win.setResizable(!locked);
                    if (locked) { if (captureFirst) saveUG(); applyDocked(); }
                    else { applyUnlockedGeom(); }
                } catch (e) { wwarn("applyLock:", e); }
            }
            lockLbl.addListener("tap", function () { var n = !isLocked(); try { MM.settings.set(SET + "locked", n); } catch (e) {} applyLock(n, true); });
            // keep the unlocked geometry fresh as the user moves/resizes (resize event is unreliable across
            // qooxdoo builds, so also poll lightly while unlocked)
            try { win.addListener("resize", saveUG); } catch (e) {}
            window.setInterval(function () { try { if (win.isVisible() && !isLocked()) saveUG(); } catch (e) {} }, 1500);

            // ---- minimize: closes our window; the disappear handler restores native chat ----
            minBtn.addListener("tap", function () { try { win.close(); } catch (e) {} });

            // ---- native replace (ONLY while THIS window is open) ----
            // The native chat is hidden only when the user has BOTH this window open AND "Hide native chat"
            // ticked. So a fresh install - and a minimized/closed window - always leaves a working chat on
            // screen, never a blank where both are hidden. (This was the first-load complaint: native was
            // hidden by default but our window doesn't auto-open, so there was no chat at all.)
            function applyNativeVisibility() { try { setNativeHidden(win.isVisible() && hideNative()); } catch (e) {} }
            nativeChk.setValue(hideNative());
            nativeChk.addListener("changeValue", function () { try { MM.settings.set(SET + "hideNative", nativeChk.getValue()); applyNativeVisibility(); } catch (e) {} });
            // The game can (re)show its chat AFTER our build runs; re-assert the hide, but ONLY while our
            // window is open and the setting is on - otherwise leave native alone so it stays visible.
            function enforceNativeHidden() { try { if (!(win.isVisible() && hideNative())) return; var c = getChat(); if (c && c.getVisibility && c.getVisibility() !== "excluded") setNativeHidden(true); } catch (e) {} }
            try { var nchat = getChat(); if (nchat && nchat.addListener) nchat.addListener("changeVisibility", enforceNativeHidden); } catch (e) {}
            [300, 1000, 2500, 5000].forEach(function (d) { window.setTimeout(enforceNativeHidden, d); });
            // restore native whenever this window closes/minimizes, so chat is never left blank
            win.addListener("disappear", function () { try { setNativeHidden(false); } catch (e) {} });
            applyNativeVisibility();

            win.addListener("appear", function () {
                // re-read the remembered channel filter (build() may have read settings before the player
                // was loaded), reflect it on the tabs + feed, then restore geometry + native state
                try { activeFilter = MM.settings.get(SET + "filter", activeFilter) || activeFilter; lastChanKey = MM.settings.get(SET + "lastChan", lastChanKey) || lastChanKey; } catch (e) {}
                buildTabs(); updateTabAvailability(); applyFilter(); updateTitle(); updateSendTarget(); applyLock(isLocked(), false); applyNativeVisibility();
            });

            MM.buttons.register({
                id: "mm-translated-chat",
                label: MMt("Translated Chat"),
                tooltip: MMt("Auto-translating chat window (replaces the game chat)"),
                onExecute: function () { try { if (win.isVisible()) win.close(); else win.open(); } catch (e) { werr("toggle failed:", e); } }
            });

            wlog("ready");
        }

        var tries = 0;
        function waitReady() {
            try {
                var app = (typeof qx != "undefined" && qx.core && qx.core.Init) ? qx.core.Init.getApplication() : null;
                var navReady = app && app.getUIItem && app.getUIItem(ClientLib.Data.Missions.PATH.BAR_NAVIGATION) && app.getUIItem(ClientLib.Data.Missions.PATH.BAR_NAVIGATION).isVisible();
                var chatReady = false;
                try { chatReady = !!(app && app.getChat && app.getChat() && app.getChat().getChatWidget); } catch (e) { chatReady = false; }
                if (navReady && chatReady && window.MMCommon && window.MMCommon.ui && window.MMCommon.buttons && window.MMCommon.settings && window.MMCommon.i18n) {
                    MM = window.MMCommon;
                    try { build(); } catch (e2) { werr("build failed (not retrying):", e2); }
                } else {
                    tries++;
                    if (tries === 30) wwarn("still waiting for game UI / chat / MMCommon...");
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
        script.textContent = "(" + TranslatedChat_main.toString() + ")();";
        script.type = "text/javascript";
        if (/commandandconquer\.com/i.test(document.domain)) {
            (document.head || document.documentElement).appendChild(script);
        }
    } catch (e) {
        console.error("[MM Translated Chat] init error: ", e);
    }
})();
