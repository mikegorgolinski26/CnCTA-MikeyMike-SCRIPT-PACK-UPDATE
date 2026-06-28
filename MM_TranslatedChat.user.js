// ==UserScript==
// @name            MM - Translated Chat
// @description     A full replacement chat window that auto-translates incoming messages into your region language, entirely on-device (Chrome/Edge built-in Translator + Language Detector - nothing leaves your browser). Channel tabs (All / Alliance / Global / Whisper / ...) switch the channel and target your sends; type and send from the window; each translated line is tagged with a two-letter source-language code between the [channel] and the [player], original shown dimmed. Locks docked lower-left like the native chat, or unlock to move + resize. Hides the native chat (toggle to bring it back).
// @author          MikeyMike (CnCTA-MikeyMike-SCRIPT-PACK)
// @contributor     MikeyMike (CnCTA-MikeyMike-SCRIPT-PACK)
// @version         1.1.0
// @match           https://*.alliances.commandandconquer.com/*/index.aspx*
// @downloadURL     https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/MM_TranslatedChat.user.js
// @updateURL       https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/MM_TranslatedChat.user.js
// ==/UserScript==

/*
================================================================================
 MM - Translated Chat
================================================================================
 WHAT IT DOES
   A full custom chat window that REPLACES the native game chat (the native one is
   hidden; a header toggle brings it back). It:
     - Mirrors every message and auto-translates it into your region language,
       ON-DEVICE (Chrome: Translator + LanguageDetector / Gemini Nano; Edge 148+:
       Phi-4-mini). The text never leaves your browser (zero-telemetry).
     - Tags each line:  HH:MM:SS  [Channel]  [LANG]  [Player]: text. The 2-letter
       LANG code shows only when the message was translated FROM a non-region
       language (keyed off the DETECTED language); the original is shown dimmed.
     - Channel tabs (All / Alliance / Global / Whisper / ...) built live from the
       native chat's own channels. Picking a tab filters the feed AND sets the
       channel your typed messages go to.
     - Type + send from the window (routes through the game's own send()).
     - Locks docked lower-left like the native chat; UNLOCK to move + resize
       (size/position are remembered).

 HOW IT HOOKS THE GAME (readable game API - no de-obfuscation)
   Native chat = webfrontend.gui.chat.ChatWindow; .getChatWidget() =
   webfrontend.gui.chat.ChatWidget. Every message (in + out) is rendered through
   ONE method: showMessage(html, senderSpan, channelIndex, bool). We wrap it (call
   original, then mirror): the HTML carries data-chat-message (raw text),
   data-chat-senderId, sender name, data-chat-messagetype, the [Channel] label +
   colour and the timestamp; the 3rd arg is the channel/tab index. Channels are
   the ChatWidget's TabView pages (.getChildren()[0]); we switch channel by
   setting the TabView selection and send via ChatWidget.send("text"). The native
   window is hidden with setVisibility("excluded") (the widget stays alive and
   keeps calling showMessage, so the mirror keeps working).

 DEPENDENCIES (pack rule: wrapper + Common Library only)
     MMCommon.ui.Window + MMCommon.buttons - the window + HUD toggle
     MMCommon.settings - per player+world persistence
     MMCommon.i18n     - getLang() = the translation target; t() for UI strings
   No dependency on any other userscript. The on-device translation engine is
   self-contained here.

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
        // Native chat access helpers
        // ----------------------------------------------------------------------
        function getChat() { try { return qx.core.Init.getApplication().getChat(); } catch (e) { return null; } }
        function getWidget() { try { var c = getChat(); return c && c.getChatWidget ? c.getChatWidget() : null; } catch (e) { return null; } }
        function getTabView() { try { var w = getWidget(); var ch = w && w.getChildren && w.getChildren(); return (ch && ch[0]) || null; } catch (e) { return null; } }
        function pagesOf(tv) { try { return (tv.getSelectables ? tv.getSelectables() : tv.getChildren()) || []; } catch (e) { return []; } }
        function labelFromIcon(icon) {
            var m = String(icon || "").match(/icon_chat_channel_([a-z0-9]+)/i);
            var key = m ? m[1].toLowerCase() : "";
            var map = { world: "Global", global: "Global", alliance: "Alliance", officer: "Officer", "private": "Whisper", whisper: "Whisper", trade: "Trade", help: "Help" };
            return MMt(map[key] || (key ? (key.charAt(0).toUpperCase() + key.slice(1)) : "Chat"));
        }
        function enumChannels() {
            var out = [];
            try {
                var tv = getTabView(); if (!tv) return out;
                var pages = pagesOf(tv);
                for (var i = 0; i < pages.length; i++) {
                    var icon = ""; try { icon = pages[i].getIcon() || ""; } catch (e) {}
                    out.push({ idx: i, page: pages[i], icon: icon, label: labelFromIcon(icon) });
                }
            } catch (e) { wwarn("enumChannels:", e); }
            return out;
        }
        function currentNativeIdx() {
            try {
                var tv = getTabView(); var sel = tv && tv.getSelection ? tv.getSelection()[0] : null;
                var pages = pagesOf(tv);
                for (var i = 0; i < pages.length; i++) if (pages[i] === sel) return i;
            } catch (e) {}
            return 0;
        }
        function selectChannelIdx(idx) {
            try { var tv = getTabView(); var pages = pagesOf(tv); if (pages[idx] && tv.setSelection) { tv.setSelection([pages[idx]]); return true; } }
            catch (e) { wwarn("selectChannelIdx:", e); }
            return false;
        }
        function setNativeHidden(hidden) {
            try { var chat = getChat(); if (chat && chat.setVisibility) chat.setVisibility(hidden ? "excluded" : "visible"); }
            catch (e) { wwarn("setNativeHidden:", e); }
        }

        // ----------------------------------------------------------------------
        // Render one line
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
                var chan = "", chanColor = null;
                var fonts = d.querySelectorAll("font");
                for (var i = 0; i < fonts.length; i++) {
                    var col = fonts[i].getAttribute("color");
                    if (col && col.toLowerCase() !== "white") {
                        var m = (fonts[i].textContent || "").match(/^\s*\[([^\]]+)\]/);
                        if (m) { chan = m[1]; chanColor = col; break; }
                    }
                }
                return { time: time, chan: chan, chanColor: chanColor, sender: sender, senderId: senderId, mtype: mtype, raw: raw, plain: (d.textContent || "").trim() };
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

            var rows = [];          // { lbl, p, tr, chanIdx }
            var activeFilter = -1;  // -1 = All, else channel index
            var TXT = "#e8e8e8";

            var list = new qx.ui.container.Composite(new qx.ui.layout.VBox(2)).set({ padding: 6, backgroundColor: "#0c1a28" });
            var scroll = new qx.ui.container.Scroll();
            scroll.add(list);

            function atBottom() { try { return (scroll.getScrollY() >= scroll.getScrollMaxY() - 24); } catch (e) { return true; } }
            function scrollBottomSoon(force) { var stick = force || atBottom(); if (!stick) return; window.setTimeout(function () { try { scroll.scrollToY(scroll.getScrollMaxY()); } catch (e) {} }, 0); }

            function rowVisible(r) { return (activeFilter < 0) || (r.chanIdx === activeFilter); }
            function applyFilter() {
                for (var i = 0; i < rows.length; i++) { try { rows[i].lbl.setVisibility(rowVisible(rows[i]) ? "visible" : "excluded"); } catch (e) {} }
                scrollBottomSoon(true);
            }

            function addRow(p, chanIdx) {
                var r = { lbl: null, p: p, tr: null, chanIdx: (typeof chanIdx === "number" ? chanIdx : null) };
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

            function onMessage(html, chanIdx) {
                if (!enabled()) return;
                var p = parseMessage(html);
                if (!p) return;
                ensureTabFor(chanIdx, p);   // a new (e.g. whisper) channel may need a tab
                var row = addRow(p, chanIdx);
                if (p.raw && Tr.supported) {
                    var tgt = targetLang(), done = false;
                    var hintTimer = window.setTimeout(function () { if (!done) { try { row.lbl.setValue(lineHtml(p, null, true)); } catch (e) {} } }, 400);
                    Tr.process(p.raw, tgt).then(function (tr) {
                        done = true; try { window.clearTimeout(hintTimer); } catch (e) {}
                        try { row.tr = tr; row.lbl.setValue(lineHtml(p, tr)); if (tr && tr.translated && rowVisible(row)) scrollBottomSoon(); } catch (e) {}
                    });
                }
            }

            // ---- hook the game's chat render ----
            function hookChat() {
                try {
                    var cw = getWidget();
                    if (!cw) return false;
                    if (cw.__mmTransHooked) return true;
                    var orig = cw.showMessage;
                    if (typeof orig !== "function") { werr("showMessage not found"); return false; }
                    cw.showMessage = function () {
                        var r = orig.apply(this, arguments);
                        try { onMessage(arguments[0], arguments[2]); } catch (e) { wwarn("onMessage:", e); }
                        return r;
                    };
                    cw.__mmTransHooked = true;
                    wlog("showMessage hooked");
                    return true;
                } catch (e) { werr("hookChat failed:", e); return false; }
            }
            if (!hookChat()) window.setTimeout(hookChat, 1500);

            // ---- channel tabs (built live from the native channels) ----
            var tabsBar = new qx.ui.container.Composite(new qx.ui.layout.Flow(3, 3)).set({ padding: 4, backgroundColor: "#0a1521" });
            var tabGroup = new qx.ui.form.RadioGroup().set({ allowEmptySelection: false });
            var knownTabs = {};   // idx -> button ("all" -> button)
            function makeTab(key, label) {
                var b = new qx.ui.form.ToggleButton(label).set({ focusable: false, padding: [2, 8] });
                b.setUserData("chanKey", key);
                tabGroup.add(b);
                tabsBar.add(b);
                b.addListener("changeValue", function (e) {
                    if (!e.getData()) return;
                    activeFilter = (key === "all") ? -1 : key;
                    if (key !== "all") selectChannelIdx(key);   // align native send-target with the viewed channel
                    applyFilter();
                });
                return b;
            }
            function ensureTabFor(chanIdx, p) {
                if (typeof chanIdx !== "number" || knownTabs[chanIdx]) return;
                var label = p && p.chan ? p.chan : (labelFromIcon((enumChannels()[chanIdx] || {}).icon) || (MMt("Channel") + " " + chanIdx));
                knownTabs[chanIdx] = makeTab(chanIdx, label);
            }
            function buildTabs() {
                if (!knownTabs.all) knownTabs.all = makeTab("all", MMt("All"));
                var chans = enumChannels();
                for (var i = 0; i < chans.length; i++) if (!knownTabs[chans[i].idx]) knownTabs[chans[i].idx] = makeTab(chans[i].idx, chans[i].label);
                try { knownTabs.all.setValue(true); } catch (e) {}
            }

            // ---- header ----
            var header = new qx.ui.container.Composite(new qx.ui.layout.HBox(8)).set({ padding: 5, backgroundColor: "#10243a" });
            var lockBtn = new qx.ui.form.Button(MMt("Unlock")).set({ focusable: false, padding: [2, 8] });
            var origChk = new qx.ui.form.CheckBox(MMt("Show original")).set({ alignY: "middle", textColor: TXT });
            var nativeChk = new qx.ui.form.CheckBox(MMt("Hide native chat")).set({ alignY: "middle", textColor: TXT });
            var statusLbl = new qx.ui.basic.Label("").set({ alignY: "middle", rich: true, textColor: "#9fb4c0", font: new qx.bom.Font(11, ["sans-serif"]) });
            origChk.setValue(showOriginal());
            origChk.addListener("changeValue", function () {
                try { MM.settings.set(SET + "showOriginal", origChk.getValue()); for (var i = 0; i < rows.length; i++) rows[i].lbl.setValue(lineHtml(rows[i].p, rows[i].tr)); } catch (e) {}
            });
            header.add(lockBtn);
            header.add(new qx.ui.basic.Label(MMt("to:")).set({ alignY: "middle", textColor: TXT }));
            header.add(new qx.ui.basic.Label(String(targetLang()).toUpperCase()).set({ alignY: "middle", textColor: "#cfe6ff", font: new qx.bom.Font(12, ["sans-serif"]).set({ bold: true }) }));
            header.add(origChk);
            header.add(nativeChk);
            header.add(new qx.ui.core.Spacer(), { flex: 1 });
            header.add(statusLbl);

            (function () {
                function setStatus(s) {
                    var map = {
                        ready: '<span style="color:#7bd88f;">' + MMt("translation ready") + '</span>',
                        downloading: '<span style="color:#e6c662;">' + MMt("preparing model…") + '</span>',
                        unavailable: '<span style="color:#e08a8a;">' + MMt("translation unavailable") + '</span>',
                        unsupported: '<span style="color:#e08a8a;">' + MMt("no built-in translator") + '</span>'
                    };
                    try { statusLbl.setValue(map[s] || ""); } catch (e) {}
                }
                Tr.status().then(setStatus, function () { setStatus("unavailable"); });
            })();

            // ---- input row ----
            var inputRow = new qx.ui.container.Composite(new qx.ui.layout.HBox(6)).set({ padding: 5, backgroundColor: "#10243a" });
            var input = new qx.ui.form.TextField().set({ placeholder: MMt("Type a message"), maxLength: 256 });
            var sendBtn = new qx.ui.form.Button(MMt("Send")).set({ focusable: false });
            function doSend() {
                var text = (input.getValue() || "").trim();
                if (!text) return;
                try {
                    var idx = (activeFilter >= 0) ? activeFilter : currentNativeIdx();
                    selectChannelIdx(idx);
                    var cw = getWidget();
                    if (cw && typeof cw.send === "function") cw.send(text);   // game echoes it back through showMessage -> appears in feed
                    input.setValue("");
                } catch (e) { werr("send failed:", e); }
            }
            sendBtn.addListener("execute", doSend);
            input.addListener("keypress", function (e) { if (e.getKeyIdentifier() === "Enter") doSend(); });
            inputRow.add(input, { flex: 1 });
            inputRow.add(sendBtn);

            // ---- window ----
            var win = MM.ui.Window({
                caption: MMt("MM - Translated Chat"),
                key: "TranslatedChat.Window",
                layout: new qx.ui.layout.VBox(0),
                width: 460, height: 320,
                persistSize: true,
                restoreOpen: true,
                resizable: true,
                dock: true
            });
            if (!win) { werr("window creation failed"); return; }
            win.add(header);
            win.add(tabsBar);
            win.add(scroll, { flex: 1 });
            win.add(inputRow);

            buildTabs();

            // ---- lock / unlock (locked = pinned lower-left, not movable/resizable) ----
            function dockLowerLeft() {
                try {
                    var root = qx.core.Init.getApplication().getRoot().getBounds() || {};
                    var b = win.getBounds() || {};
                    var vh = root.height || window.innerHeight || 720;
                    win.moveTo(6, Math.max(0, vh - (b.height || 320) - 6));
                } catch (e) {}
            }
            function isLocked() { try { return MM.settings.get(SET + "locked", true) !== false; } catch (e) { return true; } }
            function applyLock(locked) {
                try {
                    win.setMovable(!locked);
                    win.setResizable(!locked);
                    lockBtn.setLabel(locked ? MMt("Unlock") : MMt("Lock"));
                    if (locked) dockLowerLeft();
                } catch (e) { wwarn("applyLock:", e); }
            }
            lockBtn.addListener("execute", function () {
                var next = !isLocked();
                try { MM.settings.set(SET + "locked", next); } catch (e) {}
                applyLock(next);
            });

            // ---- native replace (hide native while our window is open; restore on close) ----
            function replaceMode() { try { return MM.settings.get(SET + "hideNative", true) !== false; } catch (e) { return true; } }
            nativeChk.setValue(replaceMode());
            nativeChk.addListener("changeValue", function () {
                try { MM.settings.set(SET + "hideNative", nativeChk.getValue()); setNativeHidden(nativeChk.getValue() && win.isVisible()); } catch (e) {}
            });

            win.addListener("appear", function () {
                buildTabs();
                applyLock(isLocked());
                setNativeHidden(replaceMode());   // hide native when our window is up (if replace mode)
            });
            win.addListener("disappear", function () { setNativeHidden(false); });   // always restore native when ours closes

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
