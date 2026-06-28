// ==UserScript==
// @name            MM - Translated Chat
// @description     A resizable, dockable mirror of the in-game chat that auto-translates incoming messages into your region language, entirely on-device (Chrome/Edge built-in Translator + Language Detector - nothing leaves your browser). Each translated line is tagged with a two-letter source-language code between the [channel] and the [player], with the original text shown dimmed. Stage 1: read-only mirror alongside the native chat.
// @author          MikeyMike (CnCTA-MikeyMike-SCRIPT-PACK)
// @contributor     MikeyMike (CnCTA-MikeyMike-SCRIPT-PACK)
// @version         1.0.1
// @match           https://*.alliances.commandandconquer.com/*/index.aspx*
// @downloadURL     https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/MM_TranslatedChat.user.js
// @updateURL       https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/MM_TranslatedChat.user.js
// ==/UserScript==

/*
================================================================================
 MM - Translated Chat
================================================================================
 WHAT IT DOES
   Opens a floating, resizable, edge-dockable window that mirrors the game chat
   and auto-translates each incoming message into your region language. The
   translation runs ON-DEVICE using the browser's built-in AI:
     - Chrome  : Translator + LanguageDetector (Gemini Nano)
     - Edge 148+: Translator + LanguageDetector (Phi-4-mini)
   The message text never leaves your browser (zero-telemetry, like the rest of
   the pack). Desktop only - these APIs aren't on mobile browsers.

   Each line reads:  HH:MM:SS  [Channel]  [LANG]  [Player]: text
   The two-letter LANG code appears ONLY when a message was translated from a
   language other than your region language (it keys off the DETECTED language,
   so a fluent message in your own language gets no badge). The original text is
   shown dimmed in parentheses (toggle in the header).

 HOW IT HOOKS THE GAME (no de-obfuscation - all readable game API)
   The native chat is webfrontend.gui.chat.ChatWindow; its widget
   (.getChatWidget(), class webfrontend.gui.chat.ChatWidget) renders every
   message - incoming AND outgoing - through one method: showMessage(html, ...).
   We wrap showMessage (call the original, then mirror), parse the structured
   HTML it is handed (data-chat-message = raw text, data-chat-senderId, sender
   name, data-chat-messagetype, the [Channel] label + its colour, timestamp),
   detect + translate the raw text, and render it into our window. The native
   chat is left fully intact and keeps doing all the networking - we only read.

   STAGE 1 = read-only mirror alongside the native chat. STAGE 2 (later) will
   hide the native UI and add outgoing send via chatWidget.send("text").

 DEPENDENCIES (pack rule: wrapper + Common Library only)
     MMCommon.ui.Window + MMCommon.buttons - the window + HUD toggle
     MMCommon.settings - per player+world persistence
     MMCommon.i18n     - getLang() = the translation target; t() for UI strings
   No dependency on any other userscript. The on-device translation engine is
   self-contained here (promote to MMCommon if a second script ever needs it).

 Settings (MMCommon.settings, per player+world): TranslatedChat.* (enabled,
   showOriginal, target override, window geom + open state).
 Debug: window.MMTRANSLATEDCHAT_DEBUG = true (or window.MM_DEBUG = true).
================================================================================
*/

(function () {
    var TranslatedChat_main = function () {
        // i18n fallback: hoisted so MMt() is always defined even if the Common Library's global
        // loads after this script (extension injection order isn't guaranteed). Identity in English.
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
        var MAXROWS = 250;   // cap mirrored lines to keep the DOM light

        function esc(s) { try { return qx.bom.String.escape(String(s == null ? "" : s)); } catch (e) { return String(s == null ? "" : s); } }

        // ----------------------------------------------------------------------
        // On-device translation engine (Chrome/Edge built-in Translator +
        // LanguageDetector). All async; everything stays on the device. Detector
        // and per-(src>tgt) translator instances are created lazily and reused;
        // results are cached per (target|text) so re-renders are free.
        // ----------------------------------------------------------------------
        var Tr = (function () {
            function has(name) { try { return (name in self) && typeof self[name] !== "undefined"; } catch (e) { return false; } }
            var supported = has("Translator") && has("LanguageDetector");
            var detectorP = null;
            var translators = {};   // "src>tgt" -> Promise<translator>
            var cache = {};         // "tgt|text" -> Promise<result>

            function getDetector() {
                if (detectorP) return detectorP;
                detectorP = (async function () {
                    var av = await LanguageDetector.availability();
                    if (av === "unavailable") throw new Error("LanguageDetector unavailable");
                    return await LanguageDetector.create();
                })();
                detectorP.catch(function () { detectorP = null; });  // allow a later retry if it failed
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
                // Pre-create the detector so the FIRST message doesn't pay model warm-up at translate time.
                warm: function () { if (supported) { try { getDetector(); } catch (e) {} } },
                // Resolve "ready" / "unavailable" / "downloading" for the status line.
                status: function () {
                    if (!supported) return Promise.resolve("unsupported");
                    return (async function () {
                        try { var a = await LanguageDetector.availability(); return (a === "unavailable") ? "unavailable" : (a === "available" ? "ready" : "downloading"); }
                        catch (e) { return "unavailable"; }
                    })();
                },
                // -> Promise<{translated:bool, src?:string, out?:string}>
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
                        // skip: undetermined, already our language, or low confidence (short/ambiguous text)
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

        function enabled() { try { return MM.settings.get(SET + "enabled", true) !== false; } catch (e) { return true; } }
        function showOriginal() { try { return MM.settings.get(SET + "showOriginal", true) !== false; } catch (e) { return true; } }
        function targetLang() { try { var o = MM.settings.get(SET + "target", null); return o || MM.i18n.getLang() || "en"; } catch (e) { return "en"; } }

        // ----------------------------------------------------------------------
        // Parse one showMessage() HTML line into structured fields.
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
                // channel label + colour come from the first non-white <font> ("[Alliance] [name]: ...")
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

        // ----------------------------------------------------------------------
        // Render one line. tr = translation result (or null = not translated yet).
        // Order: time  [channel]  [LANG]  [player]: text   (original dimmed)
        // ----------------------------------------------------------------------
        function lineHtml(p, tr, pending) {
            var s = "";
            if (p.time) s += '<span style="color:#6f8aa3;">' + esc(p.time) + '</span> ';
            if (p.chan) s += '<span style="color:' + (p.chanColor || "#9ab0c0") + ';">[' + esc(p.chan) + ']</span> ';
            if (tr && tr.translated && tr.src) {
                s += '<span style="background:#5a4410;color:#f0c662;font-size:10px;font-weight:bold;padding:0 4px;border-radius:3px;">' + esc(String(tr.src).toUpperCase()) + '</span> ';
            }
            if (p.sender) s += '<span style="color:#d8b878;">[' + esc(p.sender) + ']:</span> ';
            var bodyText = (tr && tr.translated) ? tr.out : (p.raw != null ? p.raw : p.plain);
            s += '<span style="color:#e6edf3;">' + esc(bodyText) + '</span>';
            if (tr && tr.translated && showOriginal() && p.raw != null) {
                s += ' <span style="color:#5d7d9c;font-style:italic;font-size:11px;">(' + esc(p.raw) + ')</span>';
            }
            // shown only while a translation is still in flight (gated by a short delay, so fast/no-op
            // resolutions - e.g. messages already in your language - never flash it)
            if (!tr && pending) {
                s += ' <span style="color:#5d7d9c;font-style:italic;font-size:11px;">· ' + esc(MMt("translating…")) + '</span>';
            }
            return s;
        }

        // ----------------------------------------------------------------------
        // UI
        // ----------------------------------------------------------------------
        function build() {
            wlog("building UI");
            try { Tr.warm(); } catch (e) {}   // pre-create the detector so the first translation is quicker

            var rows = [];   // { lbl, p, tr }
            var list = new qx.ui.container.Composite(new qx.ui.layout.VBox(2)).set({ padding: 6, backgroundColor: "#0c1a28" });
            var scroll = new qx.ui.container.Scroll();
            scroll.add(list);

            function atBottom() {
                try { return (scroll.getScrollY() >= scroll.getScrollMaxY() - 24); } catch (e) { return true; }
            }
            function scrollBottomSoon(force) {
                var stick = force || atBottom();
                if (!stick) return;
                window.setTimeout(function () { try { scroll.scrollToY(scroll.getScrollMaxY()); } catch (e) {} }, 0);
            }

            function addRow(p) {
                var lbl = new qx.ui.basic.Label(lineHtml(p, null)).set({
                    rich: true, selectable: true, allowGrowX: true,
                    font: new qx.bom.Font(12, ["sans-serif"])
                });
                var wasBottom = atBottom();
                list.add(lbl);
                var row = { lbl: lbl, p: p, tr: null };
                rows.push(row);
                while (rows.length > MAXROWS) {
                    var old = rows.shift();
                    try { list.remove(old.lbl); old.lbl.dispose && old.lbl.dispose(); } catch (e) {}
                }
                scrollBottomSoon(wasBottom);
                return row;
            }

            function onMessage(html) {
                if (!enabled()) return;
                var p = parseMessage(html);
                if (!p) return;
                var row = addRow(p);
                if (p.raw && Tr.supported) {
                    var tgt = targetLang();
                    var done = false;
                    // only surface a "translating…" hint if it's taking a moment (>400ms): fast resolutions
                    // and same-language no-ops resolve first and clear the timer, so they never flash it.
                    var hintTimer = window.setTimeout(function () {
                        if (!done) { try { row.lbl.setValue(lineHtml(p, null, true)); } catch (e) {} }
                    }, 400);
                    Tr.process(p.raw, tgt).then(function (tr) {
                        done = true;
                        try { window.clearTimeout(hintTimer); } catch (e) {}
                        try {
                            row.tr = tr;
                            row.lbl.setValue(lineHtml(p, tr));
                            if (tr && tr.translated) scrollBottomSoon();
                        } catch (e) {}
                    });
                }
            }

            // ---- hook the game's chat render (call original, then mirror) ----
            function hookChat() {
                try {
                    var chat = qx.core.Init.getApplication().getChat();
                    var cw = chat && chat.getChatWidget && chat.getChatWidget();
                    if (!cw) return false;
                    if (cw.__mmTransHooked) return true;
                    var orig = cw.showMessage;
                    if (typeof orig !== "function") { werr("showMessage not found on ChatWidget"); return false; }
                    cw.showMessage = function () {
                        var r = orig.apply(this, arguments);
                        try { onMessage(arguments[0]); } catch (e) { wwarn("onMessage:", e); }
                        return r;
                    };
                    cw.__mmTransHooked = true;
                    wlog("showMessage hooked");
                    return true;
                } catch (e) { werr("hookChat failed:", e); return false; }
            }
            if (!hookChat()) { window.setTimeout(hookChat, 1500); }

            // ---- header controls (own dark background; window content is transparent) ----
            var TXT = "#e8e8e8";
            var header = new qx.ui.container.Composite(new qx.ui.layout.HBox(8)).set({ padding: 5, backgroundColor: "#10243a" });
            var statusLbl = new qx.ui.basic.Label("").set({ alignY: "middle", rich: true, textColor: "#9fb4c0", font: new qx.bom.Font(11, ["sans-serif"]) });
            var origChk = new qx.ui.form.CheckBox(MMt("Show original")).set({ alignY: "middle", textColor: TXT });
            origChk.setValue(showOriginal());
            origChk.addListener("changeValue", function () {
                try {
                    MM.settings.set(SET + "showOriginal", origChk.getValue());
                    for (var i = 0; i < rows.length; i++) rows[i].lbl.setValue(lineHtml(rows[i].p, rows[i].tr));
                } catch (e) {}
            });
            header.add(new qx.ui.basic.Label(MMt("Translate to:")).set({ alignY: "middle", textColor: TXT, font: new qx.bom.Font(12, ["sans-serif"]).set({ bold: true }) }));
            header.add(new qx.ui.basic.Label(String(targetLang()).toUpperCase()).set({ alignY: "middle", textColor: "#cfe6ff", font: new qx.bom.Font(12, ["sans-serif"]).set({ bold: true }) }));
            header.add(origChk);
            header.add(new qx.ui.core.Spacer(), { flex: 1 });
            header.add(statusLbl);

            // status text from the on-device API availability
            (function () {
                function setStatus(s) {
                    var map = {
                        ready: '<span style="color:#7bd88f;">' + MMt("On-device translation ready") + '</span>',
                        downloading: '<span style="color:#e6c662;">' + MMt("Preparing language model…") + '</span>',
                        unavailable: '<span style="color:#e08a8a;">' + MMt("Translation unavailable on this browser") + '</span>',
                        unsupported: '<span style="color:#e08a8a;">' + MMt("Browser has no built-in translator") + '</span>'
                    };
                    try { statusLbl.setValue(map[s] || ""); } catch (e) {}
                }
                Tr.status().then(setStatus, function () { setStatus("unavailable"); });
            })();

            // ---- window ----
            var win = MM.ui.Window({
                caption: MMt("MM - Translated Chat"),
                key: "TranslatedChat.Window",
                layout: new qx.ui.layout.VBox(0),
                width: 440, height: 300,
                persistSize: true,
                restoreOpen: true,
                resizable: true,
                dock: true
            });
            if (!win) { werr("window creation failed"); return; }
            win.add(header);
            win.add(scroll, { flex: 1 });

            MM.buttons.register({
                id: "mm-translated-chat",
                label: MMt("Translated Chat"),
                tooltip: MMt("Auto-translating mirror of the game chat"),
                onExecute: function () {
                    try { if (win.isVisible()) win.close(); else win.open(); } catch (e) { werr("toggle failed:", e); }
                }
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
