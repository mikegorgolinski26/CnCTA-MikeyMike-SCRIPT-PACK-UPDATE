// ==UserScript==
// @name            MM - Common Library
// @description     Shared foundation library for the CnCTA MikeyMike pack. Runs in the game's page context and exposes window.MMCommon: one place for logging, net-events, settings, number/time formatting, coordinate helpers, and (being filled in during migration) the cnctaopt link encoder, base-scan, repair/loot calc, and a dockable-window + CommonButtonHandler UI. Load right after MM - Framework Wrapper.
// @author          MikeyMike (CnCTA-MikeyMike-SCRIPT-PACK)
// @version         1.0.35
// @match           https://*.alliances.commandandconquer.com/*/index.aspx*
// @downloadURL     https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/MM_CommonLibrary.user.js
// @updateURL       https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/MM_CommonLibrary.user.js
// ==/UserScript==

/*
================================================================================
 MM - Common Library  (window.MMCommon)  -  what it is & why it exists
================================================================================
 The pack's scripts each re-implement the same handful of mechanisms (logging,
 net-event binding, localStorage settings, number/time formatting, coordinate
 parsing, base scanning, cnctaopt link encoding, repair/loot math, movable
 windows). This library centralizes them so scripts can share ONE correct,
 maintained copy instead of many drifting ones. See MM_SCRIPT_AUDIT.md section 4.

 HOW IT LOADS
 Like the Framework Wrapper, it injects itself as a <script> into the page <head>
 so it runs in the GAME's JavaScript context (where qx / ClientLib / webfrontend
 live) and publishes a single global, window.MMCommon, plus window.MMCommon_IsInstalled.
 It must load before the scripts that use it (place it right after the wrapper).

 STATUS OF EACH MODULE
   Implemented & ready:  log, net, settings, num, time, coords, deobf, scan, loot,
   base, map, ui (dockable window), buttons (CommonButtonHandler, now optionally
   shown), menu (the in-game "CnC Pack" top menu), cnctaopt (base->cnctaopt.com link)
   Scaffold (TODO, ported as each consumer script is migrated): repair

 DEBUG: set  window.MM_DEBUG = true  in the game console for verbose [MM ...] logs.
================================================================================
*/

(function () {
    var MMCommon_main = function () {
        // ---------------------------------------------------------------------
        // Console-noise guard: filter qx's unload-listener registration.
        // ---------------------------------------------------------------------
        // Chromium's Permissions Policy disallows 'unload' listeners on this
        // page, but qooxdoo still tries to add them during startup and the
        // browser logs a "Permissions policy violation: unload is not allowed"
        // message every time. The registration is blocked anyway - the
        // listener never would have fired - so we just no-op the call to keep
        // the console clean. Only the exact 'unload' event is filtered;
        // 'beforeunload' (used by the game and by our ui.Window for refresh
        // detection) is untouched. Idempotent. Must run BEFORE qx attaches
        // its observers; placed first in MMCommon_main and outside the
        // if-already-installed guard so it applies even if MMCommon is somehow
        // injected twice.
        try {
            if (!window.__MM_unloadGuardInstalled && typeof EventTarget !== 'undefined') {
                var origAdd = EventTarget.prototype.addEventListener;
                EventTarget.prototype.addEventListener = function (type, listener, options) {
                    if (type === 'unload') return; // browser blocks this anyway; suppress the violation log
                    return origAdd.apply(this, arguments);
                };
                window.__MM_unloadGuardInstalled = true;
            }
        } catch (e) { /* cosmetic - never break MMCommon over this */ }

        if (window.MMCommon) return; // already installed

        // Verbose logging is off by default; persist the toggle so it survives a reload. Enable with:
        //   localStorage.MM_DEBUG = '1'   (then reload)   /   localStorage.removeItem('MM_DEBUG')
        if (typeof window.MM_DEBUG === "undefined") {
            try { window.MM_DEBUG = (window.localStorage.getItem("MM_DEBUG") === "1"); } catch (e) { window.MM_DEBUG = false; }
        }

        var NS = {
            version: "1.0.35"
        };

        // -------------------------------------------------------------------
        // log - prefixed, gated verbose logging (shared convention)
        // -------------------------------------------------------------------
        NS.makeLogger = function (name) {
            var prefix = "[MM " + (name || "Common") + "]";
            return {
                log: function () {
                    if (!window.MM_DEBUG) return;
                    try { console.log.apply(console, [prefix].concat([].slice.call(arguments))); } catch (e) {}
                },
                // verbose: routine high-volume chatter (window position restore, etc.) - gated behind a SEPARATE
                // MM_DEBUG_VERBOSE flag so normal MM_DEBUG stays readable.
                verbose: function () {
                    if (!window.MM_DEBUG_VERBOSE) return;
                    try { console.log.apply(console, [prefix].concat([].slice.call(arguments))); } catch (e) {}
                },
                warn: function () {
                    try { console.warn.apply(console, [prefix].concat([].slice.call(arguments))); } catch (e) {}
                },
                err: function () {
                    try { console.error.apply(console, [prefix].concat([].slice.call(arguments))); } catch (e) {}
                }
            };
        };
        var log = NS.log = NS.makeLogger("Common");

        // -------------------------------------------------------------------
        // net - attach/detach net events with the phe.cnc.Util / gui.Util fallback
        // -------------------------------------------------------------------
        function netUtil() {
            try { if (webfrontend.phe.cnc.Util && webfrontend.phe.cnc.Util.attachNetEvent) return webfrontend.phe.cnc.Util; } catch (e) {}
            try { if (webfrontend.gui.Util && webfrontend.gui.Util.attachNetEvent) return webfrontend.gui.Util; } catch (e) {}
            return null;
        }
        NS.net = {
            util: netUtil,
            attach: function (obj, eventName, eventType, ctx, cb) {
                var u = netUtil();
                if (u) return u.attachNetEvent(obj, eventName, eventType, ctx, cb);
                log.warn("net.attach: no net-event util available");
                return null;
            },
            detach: function (obj, eventName, eventType, ctx, cb) {
                var u = netUtil();
                if (u) return u.detachNetEvent(obj, eventName, eventType, ctx, cb);
                return null;
            }
        };

        // -------------------------------------------------------------------
        // settings - per player+world localStorage store (MM.SETTINGS.<pid>.<wid>)
        // -------------------------------------------------------------------
        NS.settings = (function () {
            var cache = {}, key = null;
            function storeKey() {
                try {
                    var md = ClientLib.Data.MainData.GetInstance();
                    return "MM.SETTINGS." + md.get_Player().get_Id() + "." + md.get_Server().get_WorldId();
                } catch (e) {
                    return "MM.SETTINGS.default";
                }
            }
            function load() {
                key = storeKey();
                try {
                    var raw = window.localStorage.getItem(key);
                    cache = raw ? JSON.parse(raw) : {};
                } catch (e) { cache = {}; }
                return cache;
            }
            function save() {
                try { window.localStorage.setItem(key, JSON.stringify(cache)); } catch (e) {}
            }
            return {
                get: function (prop, def) {
                    load();
                    if (cache[prop] === undefined && def !== undefined) { cache[prop] = def; save(); }
                    return cache[prop];
                },
                set: function (prop, val) { load(); cache[prop] = val; save(); return val; },
                del: function (prop) { load(); delete cache[prop]; save(); return true; }
            };
        })();

        // -------------------------------------------------------------------
        // i18n - inline translation catalogs (gettext-style). Every user-facing
        // string in the pack is wrapped as MMt("English text"); t() returns the
        // ENGLISH SOURCE unchanged when the language is English OR when a catalog
        // entry is missing, so the pack always renders correctly even with partial
        // translations and English is a guaranteed zero-change path.
        //
        // Language is auto-detected from the GAME's locale (qx.locale.Manager ->
        // "de_DE" -> "de"), with an optional override in localStorage["MM.i18n.lang"]
        // (set via setLang() or the debug menu). To translate the pack into a language, add a block to
        // CATALOGS keyed by the 2-letter code, then by the exact English source:
        //     fr: { "Scan": "Scanner", "Stop": "Arrêter", ... }
        // Missing keys silently fall back to English.
        // -------------------------------------------------------------------
        NS.i18n = (function () {
            // Inline translation catalogs (auto-assembled). Keyed by language code, then by the
            // ENGLISH SOURCE string -> translation. English needs no catalog (t() returns the source
            // unchanged); a missing key also falls back to English, so partial catalogs are safe.
            // To add/fix a translation edit the entry here, or add a new 2-letter language block.
            // Inline translation catalogs (auto-assembled). Keyed by language code, then by the
            // ENGLISH SOURCE string -> translation. English needs no catalog (t() returns the source
            // unchanged); a missing key also falls back to English, so partial catalogs are safe.
            // fr/de/ru/es are broad; the others are seeded from the old BaseInfo 25-language table
            // (partial - mostly the base-overview phrases). Add/fix entries or new language blocks freely.
            // Inline translation catalogs (auto-assembled). Keyed by language code, then by the
            // ENGLISH SOURCE string -> translation. English needs no catalog (t() returns the source
            // unchanged); a missing key also falls back to English, so partial catalogs are safe.
            // fr/de/ru/es are broad; the others are seeded from the old BaseInfo 25-language table
            // (partial - mostly the base-overview phrases). Add/fix entries or new language blocks freely.
            // Inline translation catalogs (auto-assembled). Keyed by language code, then by the
            // ENGLISH SOURCE string -> translation. English needs no catalog (t() returns the source
            // unchanged); a missing key also falls back to English, so partial catalogs are safe.
            // fr/de/ru/es are broad; the others are seeded from the old BaseInfo 25-language table
            // (partial - mostly the base-overview phrases). Add/fix entries or new language blocks freely.
            // Inline translation catalogs (auto-assembled). Keyed by language code, then by the
            // ENGLISH SOURCE string -> translation. English needs no catalog (t() returns the source
            // unchanged); a missing key also falls back to English, so partial catalogs are safe.
            // fr/de/ru/es are broad; the others are seeded from the old BaseInfo 25-language table
            // (partial - mostly the base-overview phrases). Add/fix entries or new language blocks freely.
            // Inline translation catalogs (auto-assembled). Keyed by language code, then by the
            // ENGLISH SOURCE string -> translation. English needs no catalog (t() returns the source
            // unchanged); a missing key also falls back to English, so partial catalogs are safe.
            // fr/de/ru/es are broad; the others are seeded from the old BaseInfo 25-language table
            // (partial - mostly the base-overview phrases). Add/fix entries or new language blocks freely.
            // Inline translation catalogs (auto-assembled). Keyed by language code, then by the
            // ENGLISH SOURCE string -> translation. English needs no catalog (t() returns the source
            // unchanged); a missing key also falls back to English, so partial catalogs are safe.
            // fr/de/ru/es are broad; others seeded from the old BaseInfo + script translation tables.
            // Inline translation catalogs (auto-assembled). Keyed by language code, then by the
            // ENGLISH SOURCE string -> translation. English needs no catalog (t() returns the source
            // unchanged); a missing key also falls back to English, so partial catalogs are safe.
            // fr/de/ru/es are broad; others seeded from the old BaseInfo + script translation tables.
            var CATALOGS = {
              "fr": {
                " (Pending ": " (En attente ",
                " (stored power covers ~": " (l'énergie stockée couvre ~",
                " - upgrading what fits.": " - amélioration de ce qui rentre.",
                " NO GROW!": " AUCUNE CROISSANCE !",
                " cell(s), climb within ": " case(s), montée dans ",
                " credits)...": " crédits)...",
                " didn't fully arrive - upgrading what fits.": " n'est pas entièrement arrivé - amélioration de ce qui rentre.",
                " done": " terminé",
                " layouts (": " agencements (",
                " loaded": " chargé",
                " loading…": " chargement…",
                " resource type": " type de ressource",
                " row(s) of start, kicks may go further if it helps...": " ligne(s) de départ, les secousses peuvent aller plus loin si ça aide...",
                " sims used)...": " sims utilisées)...",
                " sims, maxRepair ": " sims, répar. max ",
                " tweaks (": " ajustements (",
                " under attack!": " attaquée !",
                "% of the batch - bringing only that much; run again as power regrows)": "% du lot - n'apporte que cette quantité ; relancez à mesure que l'énergie se régénère)",
                "&mdash; click to expand": "&mdash; cliquez pour déplier",
                "&mdash; defaults are fine": "&mdash; les valeurs par défaut conviennent",
                "&ndash; optional; changes what gets proposed": "&ndash; optionnel ; modifie ce qui est proposé",
                "(0 = auto from alliance [tir], else 10)": "(0 = auto depuis l'alliance [tir], sinon 10)",
                "(0 = auto from alliance [tir], else 6)": "(0 = auto depuis l'alliance [tir], sinon 6)",
                "(after apply) -": "(après application) -",
                "(continuous /h):": "(continu /h) :",
                "(no force-sellable buildings on this base)": "(aucun bâtiment à vente forcée sur cette base)",
                "(no members online)": "(aucun membre en ligne)",
                "(nothing to show - try the 'Show' filter, e.g. 'All candidates')": "(rien à afficher - essayez le filtre « Afficher », p. ex. « Tous les candidats »)",
                "(open or select a base)": "(ouvrez ou sélectionnez une base)",
                "(refreshing...)": "(actualisation...)",
                "(target)": "(cible)",
                "(via transfers)": "(via transferts)",
                "): step ": ") : étape ",
                "+ apply": "+ appliquer",
                "+ building": "+ bâtiment",
                ", best enemy ": ", meilleur ennemi ",
                ", fee ~": ", frais ~",
                ", maxRepair ": ", répar. max ",
                "/1d": "/1j",
                "1 &middot; Pick a base, then a resource to maximize": "1 &middot; Choisissez une base, puis une ressource à maximiser",
                "1 = a unit may only move ONE cell up/down/left/right per try. After an improvement the search re-bases on the new position and steps again, so larger overall moves still build up across rounds.": "1 = une unite ne peut se deplacer que d'UNE seule case haut/bas/gauche/droite par essai. Apres une amelioration, la recherche se rebase sur la nouvelle position et avance a nouveau, de sorte que des deplacements globaux plus importants s'accumulent au fil des rondes.",
                "1 wave": "1 vague",
                "1st-OFF": "1re-OFF",
                "2 &middot; Selling": "2 &middot; Vente",
                "2 waves": "2 vagues",
                "2nd run": "2e passage",
                "2nd-OFF": "2e-OFF",
                "3 waves": "3 vagues",
                "3rd run": "3e passage",
                "4 waves": "4 vagues",
                "5+ waves": "5+ vagues",
                ": exploring a new region, ": " : exploration d'une nouvelle région, ",
                ": trying ": " : essai de ",
                "<b style='color:#5fe0f5'>Force-sell</b> &ndash; just <b>check</b> the “one-of” buildings you'll sacrifice (count is automatic &ndash; you do <b>not</b> need “Sell up to”). Their pooled refund funds new producers of the chosen resource. Works regardless of “Allow reductions”. (Economy/duplicate buildings: use “Sell up to” instead.)": "<b style='color:#5fe0f5'>Vente forcée</b> &ndash; il suffit de <b>cocher</b> les bâtiments « uniques » que vous sacrifierez (le nombre est automatique &ndash; vous n'avez <b>pas</b> besoin de « Vendre jusqu'à »). Leur remboursement mutualisé finance de nouveaux producteurs de la ressource choisie. Fonctionne indépendamment de « Autoriser les réductions ». (Bâtiments d'économie/en double : utilisez plutôt « Vendre jusqu'à ».)",
                "<b>Force-sell special buildings</b> &ndash; reveals a checklist of the base's 'one-of' buildings (Defense HQ/Facility, Command Center, etc.). Sacrifices the checked ones and fills the freed tiles with the best new producers (early-game strip-to-CY). Apply does demolish &rarr; move &rarr; build &rarr; upgrade automatically.": "<b>Vente forcée des bâtiments spéciaux</b> &ndash; affiche une liste des bâtiments « uniques » de la base (QG/Installation de défense, Centre de commandement, etc.). Sacrifie ceux qui sont cochés et remplit les cases libérées avec les meilleurs nouveaux producteurs (réduction au CY en début de partie). Appliquer effectue démolition &rarr; déplacement &rarr; construction &rarr; amélioration automatiquement.",
                "<b>Kicks</b> &ndash; random shake-ups to escape a 'good-but-not-best' layout.": "<b>Secousses</b> &ndash; bouleversements aléatoires pour échapper à un agencement « bon mais pas optimal ».",
                "<b>Neighbors</b> &ndash; candidate destination tiles tested per building each pass.": "<b>Voisins</b> &ndash; cases de destination candidates testées par bâtiment à chaque passage.",
                "<b>Rounds</b> &ndash; improvement passes per attempt (higher = more thorough, slower).": "<b>Tours</b> &ndash; passages d'amélioration par tentative (plus élevé = plus approfondi, plus lent).",
                "<b>Sell up to N</b> &ndash; the MOST low-impact economy buildings the optimizer may demolish to make room. For each one it sells, it builds a new producer of the chosen resource in the freed tile, paid for by that building's 90% demolish refund (your stored resources are untouched). It's a ceiling, not a quota: it sells only as many as actually help and stops early. Each <span style='color:#ff8a8a'>&times; red sell tile</span> is paired with a <span style='color:#4dd0e1'>&#43; cyan build tile</span> in the results list (\"paid for by selling &hellip;\"). With <b>Allow reductions</b> on it may also trade a little of another resource (e.g. sell an Accumulator for Power) when that yields a bigger gain in the one you picked.": "<b>Vendre jusqu'à N</b> &ndash; le nombre MAXIMAL de bâtiments d'économie à faible impact que l'optimiseur peut démolir pour faire de la place. Pour chacun vendu, il construit un nouveau producteur de la ressource choisie dans la case libérée, payé par le remboursement de démolition de 90 % de ce bâtiment (vos ressources stockées restent intactes). C'est un plafond, pas un quota : il n'en vend que le nombre réellement utile et s'arrête tôt. Chaque <span style='color:#ff8a8a'>&times; case de vente rouge</span> est associée à une <span style='color:#4dd0e1'>&#43; case de construction cyan</span> dans la liste des résultats (« payé par la vente de &hellip; »). Avec <b>Autoriser les réductions</b> activé, il peut aussi échanger un peu d'une autre ressource (p. ex. vendre un Accumulateur pour de l'Énergie) lorsque cela produit un gain plus important dans celle que vous avez choisie.",
                "<i>A ceiling, not a quota &mdash; the optimizer sells only as many as actually help, and builds a producer in each freed tile paid for by that building's 90% demolish refund. Your stored resources are untouched.</i>": "<i>Un plafond, pas un quota &mdash; l'optimiseur n'en vend que le nombre réellement utile, et construit un producteur dans chaque case libérée, payé par le remboursement de démolition de 90 % de ce bâtiment. Vos ressources stockées restent intactes.</i>",
                "<i>Tip: after applying, run <b>Upgrade Priority</b> (Transfer as needed) to push further using other bases.</i>": "<i>Astuce : après l'application, lancez <b>Priorité d'amélioration</b> (Transférer au besoin) pour aller plus loin en utilisant d'autres bases.</i>",
                "Account Creation": "Création de Compte",
                "Affordable in about": "Abordable dans environ",
                "After": "Après",
                "Aircraft Repairtime": "Temps de réparation d'aéronefs",
                "Alert me when one of my bases is attacked:": "M'alerter lorsqu'une de mes bases est attaquée :",
                "All Bases": "Toutes les bases",
                "All Bases Overview": "Aperçu de toutes les bases",
                "All army units": "Toutes les unites d'armee",
                "All buildings": "Tous les batiments",
                "All defense units": "Toutes les unites de defense",
                "Alliance Bonus": "Bonus d'alliance",
                "Alliance Role": "rôle de l'Alliance",
                "Alliance bases": "Bases de l'alliance",
                "Alliance bases (blue)": "Bases de l'alliance (bleu)",
                "Allow reductions": "Autoriser les réductions",
                "Applied": "Appliqué",
                "Applied cheapest winning layout (lowest max repair time).": "Agencement gagnant le moins cher appliqué (temps de réparation max le plus bas).",
                "Apply": "Appliquer",
                "Apply layout changes?": "Appliquer les modifications d'agencement ?",
                "Apply to base": "Appliquer à la base",
                "Applying": "Application",
                "Applying&hellip;": "Application&hellip;",
                "Attack Alert": "Alerte d'attaque",
                "Attack Range": "Portée d'attaque",
                "Attack loot data unavailable": "Données de butin d'attaque indisponibles",
                "Auto-collect / auto-repair": "Collecte auto / réparation auto",
                "Auto-collect packages": "Collecte auto des colis",
                "Auto-repair buildings": "Réparation auto des bâtiments",
                "Auto-repair by priority + ROI": "Réparation auto par priorité + ROI",
                "Auto-repair units": "Réparation auto des unités",
                "Auto-try several army layouts and apply the WINNING layout (enemy destroyed) with the lowest repair time.": "Essaie automatiquement plusieurs dispositions d'armee et applique la disposition GAGNANTE (ennemi detruit) avec le temps de reparation le plus bas.",
                "Auto-try several army layouts to DESTROY the enemy Defense Facility (DF): applies the layout that gets DF health as close to 0 as possible, then the lowest max repair time.": "Essaie automatiquement plusieurs dispositions d'armee pour DETRUIRE l'Installation de defense (DF) ennemie : applique la disposition qui rapproche le plus possible la sante du DF de 0, puis le temps de reparation maximal le plus bas.",
                "Auto-try several layouts and apply the winning layout with the lowest repair time. (or call window.MikeyMike_OptimizeRepair())": "Essaie automatiquement plusieurs dispositions et applique la disposition gagnante avec le temps de reparation le plus bas. (ou appelle window.MikeyMike_OptimizeRepair())",
                "Auto-try several layouts to destroy the Defense Facility: applies the layout with DF closest to 0, then lowest max repair time. (or call window.MikeyMike_OptimizeDF0())": "Essaie automatiquement plusieurs dispositions pour detruire l'Installation de defense : applique la disposition avec le DF le plus proche de 0, puis le temps de reparation maximal le plus bas. (ou appelle window.MikeyMike_OptimizeDF0())",
                "BUILD NEW": "CONSTRUIRE NEUF",
                "Base Level": "Niveau de base",
                "Base Name": "nom de la base",
                "Base Scanner": "Scanner de base",
                "Base Tools": "Outils de base",
                "Base layout": "Agencement de la base",
                "Base:": "Base :",
                "Basecount": "Nombre de base",
                "Bases with collectable packages:": "Bases avec des colis à collecter :",
                "Before": "Avant",
                "Best (highest) defense level": "Meilleur niveau de défense (le plus élevé)",
                "Best (highest) offense/army unit level": "Meilleur niveau d'unité d'attaque/d'armée (le plus élevé)",
                "Best DF 0": "Meilleur DF 0",
                "Best Win": "Meilleure victoire",
                "Best so far: ": "Meilleur jusqu'ici : ",
                "Build": "Construire",
                "Building": "Bâtiment",
                "Buildings": "Bâtiments",
                "Built": "Construit",
                "CEILING on how many ECONOMY / duplicate buildings (Silo, Refinery, spare Harvester/PowerPlant/Accumulator) the optimizer may demolish to make room - it then builds a new producer of the chosen resource in EACH freed tile, paid for entirely by that building's 90% demolish refund (none of your stored resources are spent). It's a ceiling, not a quota: 'Sell up to 3' will sell 1, 2, or 3 - whatever actually raises the resource - and stops when one more sell wouldn't help. This is SEPARATE from 'Force-sell special buildings' (Defense HQ, Airport, etc.), which you pick by checking them. 0 = don't sell anything.": "PLAFOND du nombre de bâtiments d'ÉCONOMIE / en double (Silo, Raffinerie, Récolteuse/Centrale/Accumulateur en surplus) que l'optimiseur peut démolir pour faire de la place - il construit ensuite un nouveau producteur de la ressource choisie dans CHAQUE case libérée, entièrement payé par le remboursement de démolition de 90 % de ce bâtiment (aucune de vos ressources stockées n'est dépensée). C'est un plafond, pas un quota : « Vendre jusqu'à 3 » vendra 1, 2 ou 3 - selon ce qui augmente réellement la ressource - et s'arrête quand une vente de plus n'aiderait pas. Ceci est DISTINCT de « Vente forcée des bâtiments spéciaux » (QG de défense, Aéroport, etc.), que vous choisissez en les cochant. 0 = ne rien vendre.",
                "CY row": "Rangée CY",
                "Calculating attack loot...": "Calcul du butin d'attaque...",
                "Can't apply:": "Impossible d'appliquer :",
                "Can't be upgraded right now": "Ne peut pas être amélioré pour l'instant",
                "Cancel": "Annuler",
                "City": "Ville",
                "Click Refresh to recompute the list.": "Cliquez sur Actualiser pour recalculer la liste.",
                "Click a base or camp on the map.": "Cliquez sur une base ou un camp sur la carte.",
                "Click a column header to sort (try 'Xfer $' for cheapest transfers).": "Cliquez sur un en-tête de colonne pour trier (essayez « Xfer $ » pour les transferts les moins chers).",
                "Click a resource above (<b>Tiberium / Crystal / Power / Credits</b>) to generate a plan, then <b>Apply to base</b> to make those changes in-game.": "Cliquez sur une ressource ci-dessus (<b>Tibérium / Cristal / Énergie / Crédits</b>) pour générer un plan, puis sur <b>Appliquer à la base</b> pour effectuer ces modifications dans le jeu.",
                "Click to sort by": "Cliquez pour trier par",
                "Click to sort by this column": "Cliquez pour trier par cette colonne",
                "Close": "Fermer",
                "Collect & Repair": "Collecter et réparer",
                "Collect All Packages": "Collecter tous les colis",
                "Collect packages from every base that has them ready": "Collecter les colis de chaque base qui en a de prêts",
                "Collect packages on bases that have them ready": "Collecter les colis sur les bases qui en ont de prêts",
                "Continuous Production": "Production continue",
                "Controls": "Commandes",
                "Cooldown expiry + farmable bases in range, shown while you move a base": "Fin du temps de recharge + bases exploitables à portée, affichées pendant le déplacement d'une base",
                "Could not find that base. Open it in-game and use 'Current base'.": "Impossible de trouver cette base. Ouvrez-la dans le jeu et utilisez « Base actuelle ».",
                "Could not optimize:": "Impossible d'optimiser :",
                "Couldn't load that target.": "Impossible de charger cette cible.",
                "Couldn't read that target.": "Impossible de lire cette cible.",
                "Credit": "Crédit",
                "Credit Production": "Crédit de production",
                "Credits": "Crédits",
                "Credits  ": "Crédits  ",
                "Credits  NoGrow": "Crédits  AucuneCrois",
                "Credits  OK!": "Crédits  OK !",
                "Credits ($)": "Crédits ($)",
                "Crystal": "Cristaux",
                "Crystal Harvester": "Récolteuse de cristal",
                "Crystal Production": "cristaux de production",
                "Current Base": "Base actuelle",
                "Current Time": "Date actuelle",
                "Current base": "Base actuelle",
                "Current layout": "Agencement actuel",
                "DF can't be fully destroyed; applied closest-to-0 DF layout with lowest max repair time.": "Le DF ne peut pas être entièrement détruit ; agencement DF le plus proche de 0 appliqué avec le temps de réparation max le plus bas.",
                "DF destroyed (DF=0); applied lowest max repair time layout.": "DF détruit (DF=0) ; agencement avec le temps de réparation max le plus bas appliqué.",
                "DF row": "Rangée DF",
                "DF Ø all Bases": "Fonds de défense Ø de toutes les bases",
                "Def Ø all Bases": "Def Ø de toutes les bases",
                "Defaults restored - press Save to apply.": "Valeurs par defaut restaurees - appuyez sur Enregistrer pour appliquer.",
                "Defense": "Défense",
                "Defense Level": "Niveau défensif",
                "Defensive Level": "Niveau défensif",
                "Demolish": "Démolir",
                "Demolish + build + apply": "Démolir + construire + appliquer",
                "Demolished": "Démoli",
                "Dock in game menu bar": "Ancrer dans la barre de menu du jeu",
                "Don't move a unit back to the cell it just left": "Ne pas ramener une unite sur la case qu'elle vient de quitter",
                "Done.": "Terminé.",
                "Done. ": "Terminé. ",
                "Down": "Bas",
                "Enables/Disables all aircrafts.": "Active/Desactive tous les aeronefs.",
                "Enables/Disables all infantry units.": "Active/Desactive toutes les unites d'infanterie.",
                "Enables/Disables all units.": "Active/Desactive toutes les unites.",
                "Enables/Disables all vehicles.": "Active/Desactive tous les vehicules.",
                "Enemy bases": "Bases ennemies",
                "Enter CNCTAOpt Long Link:": "Entrez le lien long CNCTAOpt :",
                "Enumerating…": "Énumération…",
                "Error saving: ": "Erreur d'enregistrement : ",
                "FAILED": "ÉCHEC",
                "Farmable NPC bases in attack range (+ levels + wave estimate)": "Bases PNJ exploitables à portée d'attaque (+ niveaux + estimation des vagues)",
                "Field tiles tinted: <span style='color:#7ed07e'>tiberium</span> / <span style='color:#8fc0ff'>crystal</span>.": "Cases de champ teintées : <span style='color:#7ed07e'>tibérium</span> / <span style='color:#8fc0ff'>cristal</span>.",
                "Figures are continuous production (packages aren't layout-dependent).": "Les chiffres correspondent à la production continue (les colis ne dépendent pas de l'agencement).",
                "Finished, but could not apply layout: ": "Terminé, mais impossible d'appliquer l'agencement : ",
                "First Offense": "Première Offensive",
                "Flash the browser-tab favicon (siren icon)": "Faire clignoter le favicon de l'onglet du navigateur (icône de sirène)",
                "Flash the browser-tab title": "Faire clignoter le titre de l'onglet du navigateur",
                "Foe": "Ennemi",
                "Force-sell special buildings": "Vente forcée des bâtiments spéciaux",
                "Forgotten / NPC bases (green)": "Bases Oubliés / PNJ (vert)",
                "Found": "Trouvé",
                "Friend": "Ami",
                "From:": "De :",
                "Game will reload now.": "Le jeu va se recharger maintenant.",
                "General": "Générales",
                "General Information": "Informations Générales",
                "Go": "Lancer",
                "Green = your offense can activate it · Red = blocked (offense too low)": "Vert = votre attaque peut l'activer · Rouge = bloqué (attaque trop faible)",
                "HQ": "QG",
                "Hard cap on battle simulations per click (the main safety net).": "Plafond strict sur les simulations de combat par clic (le principal filet de securite).",
                "Hard cap on climb+kick rounds for a single optimize click.": "Plafond strict sur les rondes de montee+ejection pour un seul clic d'optimisation.",
                "Highest first &middot; select then Up/Down to reorder": "Le plus élevé d'abord &middot; sélectionnez puis Haut/Bas pour réordonner",
                "Highlight bases in range while moving a base": "Surligner les bases à portée pendant le déplacement d'une base",
                "Highlight in move-base view:": "Surligner dans la vue de déplacement de base :",
                "Homepage": "Page d'accueil",
                "Hours": "Heures",
                "How many candidate destination tiles to test per building each pass. Higher = more thorough but slower.": "Nombre de cases de destination candidates à tester par bâtiment à chaque passage. Plus élevé = plus approfondi mais plus lent.",
                "How many candidate layouts to evaluate each round. Higher = more thorough but more simulations.": "Combien de dispositions candidates evaluer a chaque ronde. Plus eleve = plus approfondi mais plus de simulations.",
                "How many of the top rows Go will upgrade. Auto-capped to how many will actually succeed (a batch never fails), and reset to 5 (or fewer) on Refresh and whenever you toggle 'Transfer as needed'.": "Nombre de lignes du haut que Lancer améliorera. Plafonné automatiquement au nombre qui réussira réellement (un lot n'échoue jamais), et réinitialisé à 5 (ou moins) lors de l'actualisation et chaque fois que vous basculez « Transférer au besoin ».",
                "How many rows a unit may drift away from its starting row while climbing (kicks may go further if it helps).": "De combien de rangees une unite peut s'eloigner de sa rangee de depart pendant la montee (les ejections peuvent aller plus loin si cela aide).",
                "Improvement passes per attempt. Higher = more thorough but slower.": "Passages d'amélioration par tentative. Plus élevé = plus approfondi mais plus lent.",
                "Infantry Repairtime": "Temps de réparation d'infanterie",
                "Infected": "Infecté",
                "Interval (minutes):": "Intervalle (minutes) :",
                "Keep upgraded rows (clear on Refresh)": "Conserver les lignes améliorées (effacer à l'actualisation)",
                "Kick ": "Secousse ",
                "Kicks:": "Secousses :",
                "Last update:": "Dernière mise à jour :",
                "Layout Optimizer": "Optimiseur d'agencement",
                "Legend": "Légende",
                "Levels:": "Niveaux :",
                "Loading...": "Chargement...",
                "Loot + levels of the base you click on the map": "Butin + niveaux de la base sur laquelle vous cliquez sur la carte",
                "Loot Info": "Infos sur le butin",
                "Loot Summary": "Résumé du butin",
                "Lootable resources": "Ressources pillables",
                "Lvl": "Niv",
                "Lvl≥": "Niv≥",
                "MM - Base Scanner": "MM - Scanner de base",
                "Master: enable Attack Alert": "Principal : activer l'alerte d'attaque",
                "Master: enable the move-panel readout": "Principal : activer l'affichage du panneau de déplacement",
                "Master: enable the range overlay": "Principal : activer la superposition de portée",
                "Master: enable the tunnel overlay": "Principal : activer la superposition de tunnels",
                "Master: show the overlay at all": "Principal : afficher la superposition",
                "Max bases": "Bases max",
                "Max bases founded": "Bases max fondées",
                "Max fruitless kicks": "Ejections infructueuses max",
                "Max rounds per click": "Rondes max par clic",
                "Max row drift from start": "Derive max de rangee depuis le depart",
                "Max simulations per click": "Simulations max par clic",
                "Max step (cells per move)": "Pas max (cases par deplacement)",
                "Maximal CP": "Points de Commandement maximum",
                "Maximal Reptime": "Temps maximum de réparation",
                "Member": "Membre",
                "Member Status": "Statut des membres",
                "Members": "membres",
                "Mirrors units horizontally.": "Reflete les unites horizontalement.",
                "Mirrors units vertically.": "Reflete les unites verticalement.",
                "Morale": "Moral",
                "Move": "Déplacer",
                "Move (and, if proposed, demolish) buildings in-game to match the proposed layout. Shows a confirmation with exactly what will change first.": "Déplacer (et, si proposé, démolir) les bâtiments dans le jeu pour correspondre à l'agencement proposé. Affiche d'abord une confirmation indiquant exactement ce qui changera.",
                "Move Info": "Infos sur le déplacement",
                "Move ready:": "Déplacement prêt :",
                "Move-cooldown expiry time (when the spot is free to move into)": "Heure de fin du temps de recharge de déplacement (quand l'emplacement est libre)",
                "Moved": "Déplacé",
                "Movement": "Mouvement",
                "Moves": "Déplacements",
                "Moves (0)": "Déplacements (0)",
                "NPC bases in range:": "Bases PNJ à portée :",
                "Needs a Tiberium transfer": "Nécessite un transfert de tibérium",
                "Neighbors:": "Voisins :",
                "Net production change (continuous /h)": "Variation nette de production (continu /h)",
                "Neutral": "Neutre",
                "Neutral bases (peace/NAP)": "Bases neutres (paix/PNA)",
                "Next MCV": "Prochain MCV",
                "No alliance": "Aucune alliance",
                "No army units found to optimize.": "Aucune unité d'armée trouvée à optimiser.",
                "No layout found; restored original.": "Aucun agencement trouvé ; original restauré.",
                "No loot data for this object": "Aucune donnée de butin pour cet objet",
                "No moves improve": "Aucun déplacement n'améliore",
                "No transferable resources within your credit budget": "Aucune ressource transférable dans votre budget de crédits",
                "No winning layout found (enemy can't be destroyed) - try 'Best DF 0'. Restored original.": "Aucun agencement gagnant trouvé (l'ennemi ne peut pas être détruit) - essayez « Meilleur DF 0 ». Original restauré.",
                "NoGrow": "AucuneCrois",
                "None": "Aucun",
                "Note: build &amp; upgrade are queued as game commands; the new building appears immediately and upgrades complete over time. Make sure the demolition refund covers the cost.": "Note : la construction et l'amélioration sont mises en file comme commandes de jeu ; le nouveau bâtiment apparaît immédiatement et les améliorations se terminent au fil du temps. Assurez-vous que le remboursement de démolition couvre le coût.",
                "Nothing to apply - the base already matches the proposal.": "Rien à appliquer - la base correspond déjà à la proposition.",
                "Nothing to upgrade right now - not enough resources (or credits for the transfer fees).": "Rien à améliorer pour l'instant - pas assez de ressources (ou de crédits pour les frais de transfert).",
                "Nothing to upgrade without transfers - tick \"Transfer as needed\" to allow them, or wait for this base to produce more Tiberium.": "Rien à améliorer sans transferts - cochez « Transférer au besoin » pour les autoriser, ou attendez que cette base produise plus de tibérium.",
                "Numbers match the grid.": "Les chiffres correspondent à la grille.",
                "Numbers match the grid. Click <b>Apply to base</b> above to make these changes in-game (you'll get a confirmation first), or do them by hand in move mode.": "Les chiffres correspondent à la grille. Cliquez sur <b>Appliquer à la base</b> ci-dessus pour effectuer ces modifications dans le jeu (vous recevrez d'abord une confirmation), ou faites-les à la main en mode déplacement.",
                "OFF (default): only suggest moves that improve the chosen resource without hurting the others. Strict but limited - a swap that's blocked by, say, a Refinery in the way is never considered.\n\nON: widen the search to ALL resource buildings and let the optimizer trade small losses in other resources for a larger target gain (score = target_gain - 0.5 * sum_of_other_losses). The results panel shows the net change for all 4 resources so you can see exactly what's being traded.": "DÉSACTIVÉ (par défaut) : ne suggère que les déplacements qui améliorent la ressource choisie sans nuire aux autres. Strict mais limité - un échange bloqué par, disons, une Raffinerie sur le chemin n'est jamais envisagé.\n\nACTIVÉ : élargit la recherche à TOUS les bâtiments de ressources et laisse l'optimiseur échanger de petites pertes dans d'autres ressources contre un gain cible plus important (score = gain_cible - 0,5 * somme_des_autres_pertes). Le panneau de résultats affiche la variation nette pour les 4 ressources afin que vous voyiez exactement ce qui est échangé.",
                "OK!": "OK !",
                "Off/Def Bubbles": "Bulles Off/Def",
                "Offense": "Attaque",
                "Offense Bases Count": "Nombre de bases offensives",
                "Offense Level": "Niveau offensive",
                "Offense Level:": "Niveau d'attaque :",
                "On-grid overlay (Ctrl-hold)": "Superposition sur grille (maintenir Ctrl)",
                "On-map off/def bubbles (enemy / alliance / own)": "Bulles off/def sur la carte (ennemi / alliance / soi)",
                "On: upgraded rows stay marked '✓ Upgraded' until you Refresh.\nOff: each row vanishes the instant its upgrade succeeds (the classic behavior).": "Activé : les lignes améliorées restent marquées « ✓ Amélioré » jusqu'à l'actualisation.\nDésactivé : chaque ligne disparaît dès que son amélioration réussit (comportement classique).",
                "Only alarm while the game tab is in the background": "N'alarmer que lorsque l'onglet du jeu est en arrière-plan",
                "Open an attack (combat setup) on a target first.": "Ouvrez d'abord une attaque (configuration de combat) sur une cible.",
                "Open this base": "Ouvrir cette base",
                "Optimize this base's layout to maximize": "Optimiser l'agencement de cette base pour maximiser",
                "Optimizer Options": "Options de l'optimiseur",
                "Optimizer already running...": "Optimiseur déjà en cours...",
                "Optimizer stopped by user.": "Optimiseur arrêté par l'utilisateur.",
                "Optimizing": "Optimisation",
                "Optimizing (": "Optimisation (",
                "Origin base not loaded": "Base d'origine non chargée",
                "Other players' bases (orange)": "Bases des autres joueurs (orange)",
                "Outpost": "Avant-poste",
                "Outposts": "Avant-postes",
                "Own bases": "Vos bases",
                "Package Production": "Production de colis",
                "Pick an origin base": "Choisissez une base d'origine",
                "Pin into the game menu / unpin to a movable panel": "Épingler dans le menu du jeu / désépingler vers un panneau déplaçable",
                "Plan level up": "Planifier la montée de niveau",
                "Plan move base": "Planifier le déplacement de base",
                "Plan remove": "Planifier le retrait",
                "Plan ruin": "Planifier la destruction",
                "Plan ruin for": "Planifier la destruction pour",
                "Play an alarm sound": "Jouer un son d'alarme",
                "Player": "Joueur",
                "Player Class": "Faction",
                "Player Name": "Nom du joueur",
                "Players": "Joueurs",
                "Players Production": "Les joueurs de production",
                "Pooled refund": "Remboursement mutualisé",
                "Possible attacks from this base (available CP):": "Attaques possibles depuis cette base (CP disponibles) :",
                "Pow cost": "Coût énergie",
                "Pow on builds+upgrades.": "Énergie sur constructions+améliorations.",
                "Pow/gain": "Énergie/gain",
                "Power": "Énergie",
                "Power Produktion": "la production d'énergie",
                "Preset": "Preconfiguration",
                "Prevents a unit bouncing back and forth between the same two cells.": "Empeche une unite de faire des allers-retours entre les deux memes cases.",
                "Preview the siren / title / favicon (click once to allow sound).": "Aperçu de la sirène / du titre / du favicon (cliquez une fois pour autoriser le son).",
                "Priority Setup": "Configuration des priorites",
                "Processed": "Traité",
                "Proposed layout": "Agencement proposé",
                "Pull the missing Tiberium from your other bases (cheapest first), then upgrade.\nTransfer fee:": "Tirer le tibérium manquant de vos autres bases (le moins cher d'abord), puis améliorer.\nFrais de transfert :",
                "RP  OK!": "RP  OK !",
                "RP OK!": "RP OK !",
                "RP: ": "RP : ",
                "Random shake-ups to escape a 'good but not best' layout and explore a different arrangement. More = explores more but slower.": "Bouleversements aléatoires pour échapper à un agencement « bon mais pas optimal » et explorer une disposition différente. Plus = explore davantage mais plus lentement.",
                "Range override:": "Remplacement de portée :",
                "Rank": "Classement",
                "Re-reading base&hellip;": "Relecture de la base&hellip;",
                "Real gain:": "Gain réel :",
                "Real loss:": "Perte réelle :",
                "Recompute the list (clears the '✓ Upgraded' marks and rescans every base)": "Recalculer la liste (efface les marques « ✓ Amélioré » et rescanne chaque base)",
                "Recompute the table from the current game state": "Recalculer le tableau à partir de l'état actuel du jeu",
                "Refresh": "Actualiser",
                "Region map": "Carte de la région",
                "Relative chance of trying a horizontal (left/right) move. Higher = more likely to be picked.": "Probabilite relative d'essayer un deplacement horizontal (gauche/droite). Plus eleve = plus susceptible d'etre choisi.",
                "Relative chance of trying a vertical (up/down) move. Keep below the left/right weight to favour horizontal changes (e.g. 0.75).": "Probabilite relative d'essayer un deplacement vertical (haut/bas). Gardez-la sous le poids gauche/droite pour favoriser les changements horizontaux (par ex. 0.75).",
                "Remember transported units are not supported.": "Rappelez-vous que les unites transportees ne sont pas prises en charge.",
                "Repair All Buildings": "Réparer tous les bâtiments",
                "Repair All Units": "Réparer toutes les unités",
                "Repair buildings (where allowed) across every base": "Réparer les bâtiments (où c'est autorisé) sur chaque base",
                "Repair buildings on bases where repair is available": "Réparer les bâtiments sur les bases où la réparation est disponible",
                "Repair units across every base": "Réparer les unités sur chaque base",
                "Repair units on bases where repair is available": "Réparer les unités sur les bases où la réparation est disponible",
                "Required Level:": "Niveau requis :",
                "Reset": "Reinitialiser",
                "Reset Defaults": "Reinitialiser les valeurs par defaut",
                "Reset Formation": "Reinitialiser la formation",
                "Reset plans": "Réinitialiser les plans",
                "Reset to default": "Réinitialiser par défaut",
                "Resource": "Ressource",
                "Resource:": "Ressource :",
                "Reveals a checklist of the 'one-of' special buildings on this base (Defense HQ/Facility, Command Center, Barracks, Factory, Airport, Support). Check any you're willing to sacrifice; the optimizer demolishes them, pools their 90% refund, and fills the freed tiles with the best new producers of the chosen resource (early-game 'strip to the Construction Yard' play).\n\nYou do NOT need this for the normal case: with 'Sell up to' >= 1 and 'Allow reductions' on, the optimizer already auto-considers selling an economy building (e.g. a Silo) and building a producer (e.g. an Accumulator) in its place.": "Affiche une liste des bâtiments spéciaux « uniques » de cette base (QG/Installation de défense, Centre de commandement, Caserne, Usine, Aéroport, Soutien). Cochez ceux que vous êtes prêt à sacrifier ; l'optimiseur les démolit, mutualise leur remboursement de 90 % et remplit les cases libérées avec les meilleurs nouveaux producteurs de la ressource choisie (stratégie de début de partie « réduction au Chantier de construction »).\n\nVous n'en avez PAS besoin pour le cas normal : avec « Vendre jusqu'à » >= 1 et « Autoriser les réductions » activé, l'optimiseur envisage déjà automatiquement de vendre un bâtiment d'économie (p. ex. un Silo) et de construire un producteur (p. ex. un Accumulateur) à sa place.",
                "Right click: Set formation from CNCTAOpt Long Link": "Clic droit : Definir la formation a partir du lien long CNCTAOpt",
                "Round ": "Tour ",
                "Round tweaks: ": "Ajustements du tour : ",
                "Rounds:": "Tours :",
                "Rule Out": "Exclure",
                "Run periodically across every base. Off by default for units to avoid surprise resource spend.": "S'exécute périodiquement sur chaque base. Désactivé par défaut pour les unités afin d'éviter des dépenses de ressources surprises.",
                "SELL": "VENDRE",
                "Save": "Enregistrer",
                "Save/Load Formation [NUM ,]": "Enregistrer/Charger la formation [NUM ,]",
                "Saved - applies on the next optimize click.": "Enregistre - s'applique au prochain clic d'optimisation.",
                "Scan": "Scanner",
                "Scan attackable bases near one of your bases": "Scanner les bases attaquables près d'une de vos bases",
                "Scanning…": "Analyse…",
                "Search Budget": "Budget de recherche",
                "Search quality (advanced)": "Qualité de recherche (avancé)",
                "Second Offense": "Deuxième Offensive",
                "Select at least one type": "Sélectionnez au moins un type",
                "Selected army unit": "Unite d'armee selectionnee",
                "Selected building": "Batiment selectionne",
                "Selected defense unit": "Unite de defense selectionnee",
                "Self-funded plan:": "Plan autofinancé :",
                "Sell": "Vendre",
                "Sell up to:": "Vendre jusqu'à :",
                "Server Language": "Langage de Serveur",
                "Set error: ": "Erreur de définition : ",
                "Settings": "Paramètres",
                "Shifts units one space down.": "Decale les unites d'un espace vers le bas.",
                "Shifts units one space left.": "Decale les unites d'un espace vers la gauche.",
                "Shifts units one space right.": "Decale les unites d'un espace vers la droite.",
                "Shifts units one space up.": "Decale les unites d'un espace vers le haut.",
                "Show attack loot summary in region base popups": "Afficher le résumé du butin d'attaque dans les fenêtres de base de la région",
                "Show current formation with CNCTAOpt": "Afficher la formation actuelle avec CNCTAOpt",
                "Show the Offense / Required level readout in the move panel": "Afficher l'affichage du niveau Attaque / Requis dans le panneau de déplacement",
                "Show the off/def map bubble for:": "Afficher la bulle off/def sur la carte pour :",
                "Show which tunnels you can activate while moving a base": "Afficher les tunnels que vous pouvez activer pendant le déplacement d'une base",
                "Show:": "Afficher :",
                "Sim result error: ": "Erreur de résultat de sim : ",
                "Sim send error: ": "Erreur d'envoi de sim : ",
                "Skip Victory-Popup After Battle": "Ignorer la fenetre de victoire apres le combat",
                "Skipped": "Ignoré",
                "Staged": "En attente",
                "Statistic": "Statistique",
                "Stop": "Arrêter",
                "Stop after this many random jumps in a row that find no improvement.": "Arreter apres ce nombre de sauts aleatoires consecutifs sans amelioration.",
                "Stopped - ": "Arrêté - ",
                "Stopped at": "Arrêté à",
                "Stopped. ": "Arrêté. ",
                "Stored resources": "Ressources stockées",
                "Sum": "Somme",
                "Sum/CP": "Somme/CP",
                "Support": "Soutien",
                "Support Building Level Ø": "Bâtiment Niveau de soutien",
                "Support row": "Rangée de soutien",
                "Swaps lines 1 & 2.": "Echange les lignes 1 et 2.",
                "Swaps lines 2 & 3.": "Echange les lignes 2 et 3.",
                "Swaps lines 3 & 4.": "Echange les lignes 3 et 4.",
                "Target": "Cible",
                "Target out of range, no attack-loot calculation possible": "Cible hors de portée, aucun calcul de butin d'attaque possible",
                "Test alarm": "Tester l'alarme",
                "Tib cost": "Coût tib",
                "Tiberium": "Tibérium",
                "Tiberium Harvester": "Récolteuse de tibérium",
                "Tiberium Production": "Tiberium de production",
                "Tick \"Transfer as needed\" above to allow it.": "Cochez « Transférer au besoin » ci-dessus pour l'autoriser.",
                "Tiles show each building's icon + its <b>level</b> (corner).": "Les cases affichent l'icône de chaque bâtiment + son <b>niveau</b> (coin).",
                "Time/resources until your next base (MCV)": "Temps/ressources jusqu'à votre prochaine base (MCV)",
                "Toggle the Base Tools window": "Basculer la fenêtre Outils de base",
                "Toggle the Member Status display": "Basculer l'affichage du statut des membres",
                "Total / BaseLevel": "Total / Niveau de base",
                "Total Crystal Production": "cristaux de production",
                "Total Power Production": "Énergie de production",
                "Total Production": "La production totale",
                "Total Tiberium Production": "Tiberium de production",
                "Transfer + upgrade": "Transférer + améliorer",
                "Transfer as needed": "Transférer au besoin",
                "Transferred all available - upgrading as many as fit.": "Tout le disponible a été transféré - amélioration d'autant que possible.",
                "Transferring max available (": "Transfert du maximum disponible (",
                "Transfers complete - upgrading.": "Transferts terminés - amélioration.",
                "Tune how the auto-optimizer searches layouts: step size, left/right vs up/down weighting, row drift and search budgets.": "Reglez la facon dont l'optimiseur automatique recherche les dispositions : taille du pas, ponderation gauche/droite vs haut/bas, derive de rangee et budgets de recherche.",
                "Tunnel Info": "Infos sur le tunnel",
                "Tweaks tried per round": "Ajustements essayes par ronde",
                "Undo": "Annuler",
                "Up": "Haut",
                "Upgrade": "Améliorer",
                "Upgrade Priority": "Priorité d'amélioration",
                "Upgrade the top N rows in the list below (in the current sort order). Re-validates each row before firing it so resource drains from earlier rows are accounted for; if 'Transfer as needed' is on, will transfer Tiberium in from other bases when the local base is short.": "Améliorer les N premières lignes de la liste ci-dessous (dans l'ordre de tri actuel). Revalide chaque ligne avant de la lancer afin de tenir compte des ressources épuisées par les lignes précédentes ; si « Transférer au besoin » est activé, transférera du tibérium depuis d'autres bases lorsque la base locale est à court.",
                "Upgrade this building now": "Améliorer ce bâtiment maintenant",
                "Upgrade top": "Améliorer les premiers",
                "Upgrade: Base": "Amélioration : Base",
                "Upgrade: Defense": "Amélioration : Défense",
                "Upgrade: Offense": "Amélioration : Attaque",
                "Upgraded": "Amélioré",
                "Upgrading": "Amélioration",
                "Use floating panel": "Utiliser un panneau flottant",
                "Vehicle Repairtime": "Temps de réparation du véhicule",
                "View Simulation": "Voir la simulation",
                "Warn me (sound + tab title + favicon) when a base is under attack": "M'avertir (son + titre d'onglet + favicon) lorsqu'une base est attaquée",
                "Weight: left/right moves": "Poids : deplacements gauche/droite",
                "Weight: up/down moves": "Poids : deplacements haut/bas",
                "When a row in the batch would otherwise fail because the local base is short on Tiberium, transfer from your other bases (cheapest first) before upgrading. Skipped if no transfer plan covers the gap or you can't afford the transfer fee. Off by default - transfers cost credits.": "Lorsqu'une ligne du lot échouerait autrement parce que la base locale est à court de tibérium, transférer depuis vos autres bases (le moins cher d'abord) avant l'amélioration. Ignoré si aucun plan de transfert ne couvre le manque ou si vous ne pouvez pas payer les frais de transfert. Désactivé par défaut - les transferts coûtent des crédits.",
                "When on, hold Ctrl while viewing your own base to see a translucent gain/cost overlay on each resource-producing tile (Harvester, Silo, PowerPlant, Accumulator, Refinery). Best = green, worst = red, label is the ratio. Release Ctrl to hide. Salvaged from xTr1m's Base Overlay (retired).": "Lorsque c'est activé, maintenez Ctrl en regardant votre propre base pour voir une superposition translucide gain/coût sur chaque case produisant des ressources (Récolteuse, Silo, Centrale, Accumulateur, Raffinerie). Meilleur = vert, pire = rouge, l'étiquette est le ratio. Relâchez Ctrl pour masquer. Récupéré de la superposition de base de xTr1m (retirée).",
                "When on, opening the info popup for any non-own base on the region map (camp / outpost / forgotten / enemy player) appends a quick loot summary: 'Possible attacks (available CP)', 'Lootable resources', 'per CP', '2nd run' and '3rd run' breakdowns of Tiberium / Crystal / Credits / Research Points - so you can pick the best farm/attack target without opening each base's attack screen.": "Lorsque c'est activé, l'ouverture de la fenêtre d'infos de toute base non vous appartenant sur la carte de région (camp / avant-poste / oublié / joueur ennemi) ajoute un résumé rapide du butin : « Attaques possibles (CP disponibles) », « Ressources pillables », « par CP », ventilations du « 2e passage » et du « 3e passage » de Tibérium / Cristal / Crédits / Points de recherche - afin que vous puissiez choisir la meilleure cible de farm/attaque sans ouvrir l'écran d'attaque de chaque base.",
                "When on, the auto-repair tick walks the priority list below and ROI-sorts damaged buildings within each tier. Off = call the game's RepairAll in its default order.": "Lorsque c'est activé, le cycle de réparation auto parcourt la liste de priorité ci-dessous et trie les bâtiments endommagés par ROI au sein de chaque palier. Désactivé = appelle le RepairAll du jeu dans son ordre par défaut.",
                "When the current base lacks Tiberium or Crystal for an upgrade, transfer the shortfall in from your other bases (cheapest first) before firing the upgrade. Power isn't transferable - those shortages still fall through. Off by default (transfers cost credits).": "Lorsque la base actuelle manque de tibérium ou de cristal pour une amélioration, transférer le manque depuis vos autres bases (le moins cher d'abord) avant de lancer l'amélioration. L'énergie n'est pas transférable - ces manques échouent quand même. Désactivé par défaut (les transferts coûtent des crédits).",
                "Which RESOURCE this upgrade boosts (Tib / Cry / Pow / $=Credits). The building type itself is in the Building column.": "Quelle RESSOURCE cette amélioration augmente (Tib / Cry / Énergie / $=Crédits). Le type de bâtiment lui-même se trouve dans la colonne Bâtiment.",
                "While moving a base, add to the move panel:": "Pendant le déplacement d'une base, ajouter au panneau de déplacement :",
                "While moving a base, show tunnel activation:": "Pendant le déplacement d'une base, afficher l'activation des tunnels :",
                "Works on its OWN, but the upgrades above drain this base first - it will FAIL if you batch them with Go. Lower 'Upgrade top', or click this row by itself.": "Fonctionne SEUL, mais les améliorations ci-dessus épuisent d'abord cette base - cela ÉCHOUERA si vous les groupez avec Lancer. Réduisez « Améliorer les premiers », ou cliquez sur cette ligne seule.",
                "[allow reductions: ON]": "[autoriser les réductions : ACTIVÉ]",
                "a base": "une base",
                "a move target is blocked by a fixed building - re-run the optimizer": "une cible de déplacement est bloquée par un bâtiment fixe - relancez l'optimiseur",
                "all bases": "toutes les bases",
                "allowing reductions": "autorisation des réductions",
                "and spend the 90% demolish refund to build": "et dépenser le remboursement de démolition de 90 % pour construire",
                "at": "à",
                "at ": "à ",
                "auto-build": "construction auto",
                "base drained by the upgrades above": "base épuisée par les améliorations ci-dessus",
                "base is locked": "la base est verrouillée",
                "base unavailable": "base indisponible",
                "best DF=0": "meilleur DF=0",
                "best win": "meilleure victoire",
                "blocked": "bloqué",
                "build manager unavailable": "gestionnaire de construction indisponible",
                "build tile is occupied": "la case de construction est occupée",
                "build(s)": "construction(s)",
                "building": "bâtiment",
                "building not found": "bâtiment introuvable",
                "building to upgrade not found": "bâtiment à améliorer introuvable",
                "buildings": "bâtiments",
                "buildings to repair:": "bâtiments à réparer :",
                "can't afford transfer fee": "frais de transfert non abordables",
                "candidate(s),": "candidat(s),",
                "change(s)": "modification(s)",
                "could not read base layout": "impossible de lire l'agencement de la base",
                "could not read the base": "impossible de lire la base",
                "could not read the build-cost API (game may have updated)": "impossible de lire l'API de coût de construction (le jeu a peut-être été mis à jour)",
                "couldn't sequence all moves automatically - apply by hand in move mode": "impossible de séquencer tous les déplacements automatiquement - appliquez à la main en mode déplacement",
                "couldn't sequence the moves automatically (no free staging tile) - apply by hand in move mode": "impossible de séquencer les déplacements automatiquement (aucune case d'attente libre) - appliquez à la main en mode déplacement",
                "credits": "crédits",
                "credits.": "crédits.",
                "cyan tile = <b>build new</b> building here (self-funded by a sell's refund).": "case cyan = <b>construire un nouveau</b> bâtiment ici (autofinancé par le remboursement d'une vente).",
                "demolish": "démolir",
                "demolished": "démoli",
                "demolition(s)": "démolition(s)",
                "done": "terminé",
                "enemy ": "ennemi ",
                "enough to be worth demolishing another building (raising “Sell up to” past": "suffisant pour valoir la démolition d'un autre bâtiment (augmenter « Vendre jusqu'à » au-delà de",
                "error - see console": "erreur - voir la console",
                "eval error - see console": "erreur d'évaluation - voir la console",
                "failed": "échoué",
                "force-selling": "vente forcée",
                "from this base's production": "de la production de cette base",
                "game refused demolish": "le jeu a refusé la démolition",
                "green tile / #badge = building <b>moves here</b> (matching <span style='color:#ff8a8a'>&rarr;#</span> red tile = where it left).": "case verte / badge n° = le bâtiment <b>se déplace ici</b> (la case rouge <span style='color:#ff8a8a'>&rarr;n°</span> correspondante = d'où il est parti).",
                "harvester": "récolteuse",
                "in": "dans",
                "inclusive Bonus POI": "y compris POI Bonus",
                "internal error (see console)": "erreur interne (voir la console)",
                "last:": "dernier :",
                "link(s) uncalibrated": "lien(s) non calibré(s)",
                "load": "charger",
                "low-impact building": "bâtiment à faible impact",
                "max 2 waves": "max 2 vagues",
                "max 3 waves": "max 3 vagues",
                "max 4 waves": "max 4 vagues",
                "missing build type id": "id de type de construction manquant",
                "move": "déplacer",
                "move(s)": "déplacement(s)",
                "moves": "déplacements",
                "moves here - #": "se déplace ici - n°",
                "new": "nouveau",
                "new building": "nouveau bâtiment",
                "new producers": "nouveaux producteurs",
                "no base can transfer enough Tiberium": "aucune base ne peut transférer assez de tibérium",
                "no buildable": "rien à construire",
                "no further MCV to research": "aucun autre MCV à rechercher",
                "no further sell raised": "aucune autre vente n'a augmenté",
                "no income": "aucun revenu",
                "no movable buildings for this resource": "aucun bâtiment déplaçable pour cette ressource",
                "no movable buildings on this base": "aucun bâtiment déplaçable sur cette base",
                "no optimization result to apply": "aucun résultat d'optimisation à appliquer",
                "no transfer plan can cover the gap": "aucun plan de transfert ne peut couvrir le manque",
                "no visible effect after": "aucun effet visible après",
                "none of the selected force-sell buildings are on this base": "aucun des bâtiments à vente forcée sélectionnés n'est sur cette base",
                "none of your stored resources are spent.": "aucune de vos ressources stockées n'est dépensée.",
                "not enough power": "pas assez d'énergie",
                "not enough tiberium (enable \"Transfer as needed\" to pull from other bases)": "pas assez de tibérium (activez « Transférer au besoin » pour tirer depuis d'autres bases)",
                "now": "maintenant",
                "now harvests": "récolte maintenant",
                "of": "de",
                "on this base, even when trading other resources.": "sur cette base, même en échangeant d'autres ressources.",
                "on this base. Try <b>Allow reductions</b> to consider moves that trade other resources for a bigger target gain.": "sur cette base. Essayez <b>Autoriser les réductions</b> pour envisager des déplacements qui échangent d'autres ressources contre un gain cible plus important.",
                "paid for by selling": "payé par la vente de",
                "per CP": "par CP",
                "producer": "producteur",
                "producer exists on this base to clone": "producteur existe sur cette base à cloner",
                "producer here": "producteur ici",
                "red tile = recommended <b>sell</b> (demolish).": "case rouge = <b>vente</b> recommandée (démolir).",
                "refund": "remboursement",
                "reset": "reinitialiser",
                "s (the game may have rejected it - check resources / build slots)": "s (le jeu l'a peut-être rejeté - vérifiez les ressources / emplacements de construction)",
                "save": "enregistrer",
                "sell": "vendre",
                "sell(s)": "vente(s)",
                "sells": "ventes",
                "simulations in cache": "simulations en cache",
                "skipped": "ignoré",
                "spent": "dépensé",
                "target": "cible",
                "target base cannot trade right now": "la base cible ne peut pas échanger pour l'instant",
                "targets": "cibles",
                "the base changed since you optimized (a building is gone) - re-run the optimizer": "la base a changé depuis votre optimisation (un bâtiment a disparu) - relancez l'optimiseur",
                "the base changed since you optimized (a building moved) - re-run the optimizer": "la base a changé depuis votre optimisation (un bâtiment a été déplacé) - relancez l'optimiseur",
                "the refund from those sells can't fund any useful new": "le remboursement de ces ventes ne peut financer aucun nouveau",
                "tile": "case",
                "tile vacated by move #": "case libérée par le déplacement n°",
                "tiles": "cases",
                "units to repair:": "unités à réparer :",
                "unknown": "inconnu",
                "up to": "jusqu'à",
                "upgradeable now": "améliorable maintenant",
                "via a temporary staging hop to untangle a swap": "via un saut d'attente temporaire pour démêler un échange",
                "via transfer": "via transfert",
                "wait": "attendre",
                "will be <b>moved</b>": "sera <b>déplacé</b>",
                "will be BUILT and UPGRADED</b> (paid from the demolition refund):": "sera CONSTRUIT et AMÉLIORÉ</b> (payé par le remboursement de démolition) :",
                "will be PERMANENTLY DEMOLISHED:": "sera DÉMOLI DÉFINITIVEMENT :",
                "will succeed": "réussira",
                "will switch field type (tiberium &harr; crystal) - this <b>resets that harvester's in-progress package</b>. Continuous production still improves; you just lose the partial package.": "changera de type de champ (tibérium &harr; cristal) - cela <b>réinitialise le colis en cours de cette récolteuse</b>. La production continue s'améliore quand même ; vous perdez simplement le colis partiel.",
                "won't change this plan). Enable <i>localStorage.MMBASETOOLS_DEBUG='1'</i> + reload to see the per-round numbers in the console.": "ne changera pas ce plan). Activez <i>localStorage.MMBASETOOLS_DEBUG='1'</i> + rechargez pour voir les chiffres par tour dans la console.",
                "→Lvl": "→Niv",
                "⇄ Transfer & Upgrade": "⇄ Transférer et améliorer",
                "⚠ ALERT - ": "⚠ ALERTE - ",
                "✓ Upgraded": "✓ Amélioré",
                "✗ failed": "✗ échoué",
                "⬆ Upgrade": "⬆ Améliorer"
              },
              "de": {
                " (Pending ": " (Ausstehend ",
                " (stored power covers ~": " (gespeicherter Strom deckt ~",
                " - upgrading what fits.": " - es wird verbessert, was passt.",
                " NO GROW!": " KEIN WACHSTUM!",
                " cell(s), climb within ": " Zelle(n), Anstieg innerhalb ",
                " credits)...": " Credits)...",
                " didn't fully arrive - upgrading what fits.": " ist nicht vollständig angekommen - es wird verbessert, was passt.",
                " done": " fertig",
                " layouts (": " Layouts (",
                " loaded": " geladen",
                " loading…": " wird geladen…",
                " resource type": " Ressourcentyp",
                " row(s) of start, kicks may go further if it helps...": " Zeile(n) ab Start, Kicks können weiter gehen, wenn es hilft...",
                " sims used)...": " Sims verwendet)...",
                " sims)": " Sims)",
                " sims, maxRepair ": " Sims, maxReparatur ",
                " tweaks (": " Anpassungen (",
                " under attack!": " wird angegriffen!",
                "% of the batch - bringing only that much; run again as power regrows)": "% des Stapels - es wird nur so viel geholt; erneut ausführen, sobald Strom nachwächst)",
                "&mdash; click to expand": "&mdash; zum Aufklappen klicken",
                "&mdash; defaults are fine": "&mdash; Standardwerte sind in Ordnung",
                "&ndash; optional; changes what gets proposed": "&ndash; optional; ändert, was vorgeschlagen wird",
                "(0 = auto from alliance [tir], else 10)": "(0 = automatisch aus Allianz [tir], sonst 10)",
                "(0 = auto from alliance [tir], else 6)": "(0 = automatisch aus Allianz [tir], sonst 6)",
                "(after apply) -": "(nach Anwenden) -",
                "(continuous /h):": "(kontinuierlich /h):",
                "(no force-sellable buildings on this base)": "(keine zwangsverkaufbaren Gebäude auf dieser Basis)",
                "(no members online)": "(keine Mitglieder online)",
                "(nothing to show - try the 'Show' filter, e.g. 'All candidates')": "(nichts anzuzeigen - probiere den 'Anzeigen'-Filter, z. B. 'Alle Kandidaten')",
                "(open or select a base)": "(eine Basis öffnen oder auswählen)",
                "(refreshing...)": "(wird aktualisiert...)",
                "(target)": "(Ziel)",
                "(via transfers)": "(über Transfers)",
                "): step ": "): Schritt ",
                "+ apply": "+ anwenden",
                "+ building": "+ Gebäude",
                ", best enemy ": ", bester Gegner ",
                ", fee ~": ", Gebühr ~",
                ", maxRepair ": ", maxReparatur ",
                "/1d": "/1T",
                "1 &middot; Pick a base, then a resource to maximize": "1 &middot; Wähle eine Basis, dann eine zu maximierende Ressource",
                "1 = a unit may only move ONE cell up/down/left/right per try. After an improvement the search re-bases on the new position and steps again, so larger overall moves still build up across rounds.": "1 = eine Einheit darf pro Versuch nur EINE Zelle nach oben/unten/links/rechts bewegt werden. Nach einer Verbesserung setzt die Suche auf der neuen Position neu an und macht erneut einen Schritt, sodass sich über die Runden hinweg trotzdem größere Gesamtbewegungen aufbauen.",
                "1 wave": "1 Welle",
                "1st-OFF": "1.-OFF",
                "2 &middot; Selling": "2 &middot; Verkaufen",
                "2 waves": "2 Wellen",
                "2nd run": "2. Durchlauf",
                "2nd-OFF": "2.-OFF",
                "3 waves": "3 Wellen",
                "3rd run": "3. Durchlauf",
                "4 waves": "4 Wellen",
                "5+ waves": "5+ Wellen",
                ": exploring a new region, ": ": eine neue Region wird erkundet, ",
                ": trying ": ": es wird versucht ",
                "<b style='color:#5fe0f5'>Force-sell</b> &ndash; just <b>check</b> the “one-of” buildings you'll sacrifice (count is automatic &ndash; you do <b>not</b> need “Sell up to”). Their pooled refund funds new producers of the chosen resource. Works regardless of “Allow reductions”. (Economy/duplicate buildings: use “Sell up to” instead.)": "<b style='color:#5fe0f5'>Zwangsverkauf</b> &ndash; <b>hake</b> einfach die „Einzel“-Gebäude an, die du opferst (die Anzahl ist automatisch &ndash; du brauchst „Verkaufe bis zu“ <b>nicht</b>). Ihre gebündelte Rückerstattung finanziert neue Produzenten der gewählten Ressource. Funktioniert unabhängig von „Reduzierungen erlauben“. (Wirtschafts-/Duplikatgebäude: stattdessen „Verkaufe bis zu“ verwenden.)",
                "<b>Force-sell special buildings</b> &ndash; reveals a checklist of the base's 'one-of' buildings (Defense HQ/Facility, Command Center, etc.). Sacrifices the checked ones and fills the freed tiles with the best new producers (early-game strip-to-CY). Apply does demolish &rarr; move &rarr; build &rarr; upgrade automatically.": "<b>Spezialgebäude zwangsverkaufen</b> &ndash; zeigt eine Checkliste der „Einzel“-Gebäude der Basis (Verteidigungs-HQ/-Anlage, Kommandozentrale usw.). Opfert die angehakten und füllt die freigewordenen Felder mit den besten neuen Produzenten (Early-Game-Abriss bis zur CY). Anwenden führt automatisch Abriss &rarr; Verschieben &rarr; Bauen &rarr; Verbessern aus.",
                "<b>Kicks</b> &ndash; random shake-ups to escape a 'good-but-not-best' layout.": "<b>Kicks</b> &ndash; zufällige Umstellungen, um einem 'guten, aber nicht besten' Layout zu entkommen.",
                "<b>Neighbors</b> &ndash; candidate destination tiles tested per building each pass.": "<b>Nachbarn</b> &ndash; pro Durchlauf je Gebäude getestete Kandidaten-Zielfelder.",
                "<b>Rounds</b> &ndash; improvement passes per attempt (higher = more thorough, slower).": "<b>Runden</b> &ndash; Verbesserungsdurchläufe pro Versuch (höher = gründlicher, langsamer).",
                "<b>Sell up to N</b> &ndash; the MOST low-impact economy buildings the optimizer may demolish to make room. For each one it sells, it builds a new producer of the chosen resource in the freed tile, paid for by that building's 90% demolish refund (your stored resources are untouched). It's a ceiling, not a quota: it sells only as many as actually help and stops early. Each <span style='color:#ff8a8a'>&times; red sell tile</span> is paired with a <span style='color:#4dd0e1'>&#43; cyan build tile</span> in the results list (\"paid for by selling &hellip;\"). With <b>Allow reductions</b> on it may also trade a little of another resource (e.g. sell an Accumulator for Power) when that yields a bigger gain in the one you picked.": "<b>Verkaufe bis zu N</b> &ndash; die HÖCHSTZAHL der wenig wirkungsvollen Wirtschaftsgebäude, die der Optimierer abreißen darf, um Platz zu schaffen. Für jedes verkaufte baut er im freigewordenen Feld einen neuen Produzenten der gewählten Ressource, bezahlt durch die 90%-Abrissrückerstattung dieses Gebäudes (deine gespeicherten Ressourcen bleiben unberührt). Es ist eine Obergrenze, kein Soll: Es verkauft nur so viele, wie tatsächlich helfen, und stoppt frühzeitig. Jedes <span style='color:#ff8a8a'>&times; rote Verkaufsfeld</span> wird in der Ergebnisliste mit einem <span style='color:#4dd0e1'>&#43; cyanfarbenen Baufeld</span> gepaart (\"bezahlt durch Verkauf von &hellip;\"). Mit aktiviertem <b>Reduzierungen erlauben</b> kann er auch ein wenig einer anderen Ressource eintauschen (z. B. einen Akkumulator für Strom verkaufen), wenn das in der von dir gewählten Ressource einen größeren Gewinn bringt.",
                "<i>A ceiling, not a quota &mdash; the optimizer sells only as many as actually help, and builds a producer in each freed tile paid for by that building's 90% demolish refund. Your stored resources are untouched.</i>": "<i>Eine Obergrenze, kein Soll &mdash; der Optimierer verkauft nur so viele, wie tatsächlich helfen, und baut in jedem freigewordenen Feld einen Produzenten, bezahlt durch die 90%-Abrissrückerstattung dieses Gebäudes. Deine gespeicherten Ressourcen bleiben unberührt.</i>",
                "<i>Tip: after applying, run <b>Upgrade Priority</b> (Transfer as needed) to push further using other bases.</i>": "<i>Tipp: Führe nach dem Anwenden <b>Verbesserungspriorität</b> (Bei Bedarf transferieren) aus, um mithilfe anderer Basen weiter zu kommen.</i>",
                "Account Creation": "Account Erstellung",
                "Action": "Aktion",
                "Affordable in about": "Leistbar in etwa",
                "After": "Nachher",
                "Aircraft Repairtime": "Flugzeug Reparaturzeit",
                "Alert me when one of my bases is attacked:": "Mich benachrichtigen, wenn eine meiner Basen angegriffen wird:",
                "All Bases": "Alle Basen",
                "All Bases Overview": "Überblick über die Basen",
                "All army units": "Alle Armee-Einheiten",
                "All buildings": "Alle Gebäude",
                "All defense units": "Alle Abwehrstellungen",
                "Alliance Bonus": "Allianz-Bonus",
                "Alliance Role": "Allianz Rolle",
                "Alliance bases": "Allianz-Basen",
                "Alliance bases (blue)": "Allianz-Basen (blau)",
                "Allow reductions": "Reduzierungen erlauben",
                "Applied": "Angewendet",
                "Applied cheapest winning layout (lowest max repair time).": "Günstigstes Sieger-Layout angewendet (niedrigste maximale Reparaturzeit).",
                "Apply": "Anwenden",
                "Apply layout changes?": "Layout-Änderungen anwenden?",
                "Apply to base": "Auf Basis anwenden",
                "Applying": "Wird angewendet",
                "Applying&hellip;": "Wird angewendet&hellip;",
                "Attack Alert": "Angriffsalarm",
                "Attack Range": "Angriffsreichweite",
                "Attack loot data unavailable": "Angriffsbeute-Daten nicht verfügbar",
                "Auto-collect / auto-repair": "Auto-Einsammeln / Auto-Reparatur",
                "Auto-collect packages": "Pakete automatisch einsammeln",
                "Auto-repair buildings": "Gebäude automatisch reparieren",
                "Auto-repair by priority + ROI": "Auto-Reparatur nach Priorität + ROI",
                "Auto-repair units": "Einheiten automatisch reparieren",
                "Auto-try several army layouts and apply the WINNING layout (enemy destroyed) with the lowest repair time.": "Probiert automatisch mehrere Armee-Aufstellungen aus und wendet die SIEGREICHE Aufstellung (Gegner zerstört) mit der niedrigsten Reparaturzeit an.",
                "Auto-try several army layouts to DESTROY the enemy Defense Facility (DF): applies the layout that gets DF health as close to 0 as possible, then the lowest max repair time.": "Probiert automatisch mehrere Armee-Aufstellungen aus, um die gegnerische Verteidigungsanlage (DF) zu ZERSTÖREN: wendet die Aufstellung an, die die DF-Gesundheit so nah wie möglich an 0 bringt, und dann die niedrigste maximale Reparaturzeit.",
                "Auto-try several layouts and apply the winning layout with the lowest repair time. (or call window.MikeyMike_OptimizeRepair())": "Probiert automatisch mehrere Aufstellungen aus und wendet die siegreiche Aufstellung mit der niedrigsten Reparaturzeit an. (oder rufe window.MikeyMike_OptimizeRepair() auf)",
                "Auto-try several layouts to destroy the Defense Facility: applies the layout with DF closest to 0, then lowest max repair time. (or call window.MikeyMike_OptimizeDF0())": "Probiert automatisch mehrere Aufstellungen aus, um die Verteidigungsanlage zu zerstören: wendet die Aufstellung mit der DF am nächsten an 0 an, und dann die niedrigste maximale Reparaturzeit. (oder rufe window.MikeyMike_OptimizeDF0() auf)",
                "BUILD NEW": "NEU BAUEN",
                "Base": "Basis",
                "Base Level": "Basis Level",
                "Base Name": "Basis Name",
                "Base Scanner": "Basis-Scanner",
                "Base Tools": "Basis-Tools",
                "Base layout": "Basis-Layout",
                "Base:": "Basis:",
                "Basecount": "Basenanzahl",
                "Bases": "Basen",
                "Bases with collectable packages:": "Basen mit einsammelbaren Paketen:",
                "Before": "Vorher",
                "Best (highest) defense level": "Bestes (höchstes) Verteidigungslevel",
                "Best (highest) offense/army unit level": "Bestes (höchstes) Offensiv-/Armeeeinheiten-Level",
                "Best DF 0": "Beste DF 0",
                "Best Win": "Bester Sieg",
                "Best so far: ": "Bisher bestes: ",
                "Build": "Bauen",
                "Building": "Gebäude",
                "Buildings": "Gebäude",
                "Built": "Gebaut",
                "CC": "KZ",
                "CEILING on how many ECONOMY / duplicate buildings (Silo, Refinery, spare Harvester/PowerPlant/Accumulator) the optimizer may demolish to make room - it then builds a new producer of the chosen resource in EACH freed tile, paid for entirely by that building's 90% demolish refund (none of your stored resources are spent). It's a ceiling, not a quota: 'Sell up to 3' will sell 1, 2, or 3 - whatever actually raises the resource - and stops when one more sell wouldn't help. This is SEPARATE from 'Force-sell special buildings' (Defense HQ, Airport, etc.), which you pick by checking them. 0 = don't sell anything.": "OBERGRENZE dafür, wie viele WIRTSCHAFTS-/Duplikatgebäude (Silo, Raffinerie, überzählige Erntemaschine/Kraftwerk/Akkumulator) der Optimierer abreißen darf, um Platz zu schaffen - er baut dann in JEDES freigewordene Feld einen neuen Produzenten der gewählten Ressource, vollständig bezahlt durch die 90%-Abrissrückerstattung dieses Gebäudes (keine deiner gespeicherten Ressourcen werden ausgegeben). Es ist eine Obergrenze, kein Soll: 'Verkaufe bis zu 3' verkauft 1, 2 oder 3 - je nachdem, was die Ressource tatsächlich erhöht - und stoppt, wenn ein weiterer Verkauf nicht helfen würde. Dies ist GETRENNT von 'Spezialgebäude zwangsverkaufen' (Verteidigungs-HQ, Flughafen usw.), die du durch Anhaken auswählst. 0 = nichts verkaufen.",
                "CY": "BH",
                "CY row": "CY-Reihe",
                "Calculating attack loot...": "Angriffsbeute wird berechnet...",
                "Camp": "Lager",
                "Camps": "Lager",
                "Can't apply:": "Kann nicht angewendet werden:",
                "Can't be upgraded right now": "Kann derzeit nicht verbessert werden",
                "Cancel": "Abbrechen",
                "City": "Stadt",
                "Click Refresh to recompute the list.": "Klicke auf Aktualisieren, um die Liste neu zu berechnen.",
                "Click a base or camp on the map.": "Klicke auf eine Basis oder ein Lager auf der Karte.",
                "Click a column header to sort (try 'Xfer $' for cheapest transfers).": "Klicke auf eine Spaltenüberschrift zum Sortieren (probiere 'Transfer $' für die günstigsten Transfers).",
                "Click a resource above (<b>Tiberium / Crystal / Power / Credits</b>) to generate a plan, then <b>Apply to base</b> to make those changes in-game.": "Klicke oben auf eine Ressource (<b>Tiberium / Kristall / Strom / Credits</b>), um einen Plan zu erstellen, dann auf <b>Auf Basis anwenden</b>, um diese Änderungen im Spiel vorzunehmen.",
                "Click to sort by": "Klicken zum Sortieren nach",
                "Click to sort by this column": "Klicken zum Sortieren nach dieser Spalte",
                "Close": "Schließen",
                "Collect & Repair": "Einsammeln & Reparieren",
                "Collect All Packages": "Alle Pakete einsammeln",
                "Collect packages from every base that has them ready": "Pakete von jeder Basis einsammeln, die sie bereithält",
                "Collect packages on bases that have them ready": "Pakete auf Basen einsammeln, die sie bereithalten",
                "Continuous Production": "Kontinuierliche Produktion",
                "Controls": "Steuerung",
                "Cooldown expiry + farmable bases in range, shown while you move a base": "Abklingzeit-Ablauf + farmbare Basen in Reichweite, angezeigt während du eine Basis verschiebst",
                "Could not find that base. Open it in-game and use 'Current base'.": "Diese Basis konnte nicht gefunden werden. Öffne sie im Spiel und verwende 'Aktuelle Basis'.",
                "Could not optimize:": "Konnte nicht optimiert werden:",
                "Couldn't load that target.": "Dieses Ziel konnte nicht geladen werden.",
                "Couldn't read that target.": "Dieses Ziel konnte nicht gelesen werden.",
                "Credit Production": "Credit Produktion",
                "Credits  NoGrow": "Credits  KeinWachstum",
                "Crystal": "Kristall",
                "Crystal Harvester": "Kristall-Erntemaschine",
                "Crystal Production": "Kristall Produktion",
                "Current Base": "Aktuelle Basis",
                "Current Time": "Aktuelle Uhrzeit",
                "Current base": "Aktuelle Basis",
                "Current layout": "Aktuelles Layout",
                "DF": "VE",
                "DF can't be fully destroyed; applied closest-to-0 DF layout with lowest max repair time.": "DF kann nicht vollständig zerstört werden; Layout mit DF am nächsten an 0 und niedrigster maximaler Reparaturzeit angewendet.",
                "DF destroyed (DF=0); applied lowest max repair time layout.": "DF zerstört (DF=0); Layout mit niedrigster maximaler Reparaturzeit angewendet.",
                "DF row": "DF-Reihe",
                "DF Ø all Bases": "VE Ø aller Basen",
                "Def Ø all Bases": "Def Ø aller Basen",
                "Defaults restored - press Save to apply.": "Standardwerte wiederhergestellt - drücke Speichern, um anzuwenden.",
                "Defense": "Verteidigung",
                "Defense Level": "Defensiv Level",
                "Defensive Level": "Verteidigungslevel",
                "Demolish": "Abreißen",
                "Demolish + build + apply": "Abreißen + bauen + anwenden",
                "Demolished": "Abgerissen",
                "Dock in game menu bar": "In der Spielmenüleiste andocken",
                "Don't move a unit back to the cell it just left": "Bewege eine Einheit nicht zurück in die Zelle, die sie gerade verlassen hat",
                "Done.": "Fertig.",
                "Done. ": "Fertig. ",
                "Down": "Runter",
                "Enables/Disables all aircrafts.": "Aktiviert/Deaktiviert alle Flugzeuge.",
                "Enables/Disables all infantry units.": "Aktiviert/Deaktiviert alle Infanterie-Einheiten.",
                "Enables/Disables all units.": "Aktiviert/Deaktiviert alle Einheiten.",
                "Enables/Disables all vehicles.": "Aktiviert/Deaktiviert alle Fahrzeuge.",
                "Enemy bases": "Feindliche Basen",
                "Enter CNCTAOpt Long Link:": "CNCTAOpt Long Link eingeben:",
                "Enumerating…": "Wird aufgelistet…",
                "Error saving: ": "Fehler beim Speichern: ",
                "FAILED": "FEHLGESCHLAGEN",
                "Farmable NPC bases in attack range (+ levels + wave estimate)": "Farmbare NPC-Basen in Angriffsreichweite (+ Level + Wellenschätzung)",
                "Field tiles tinted: <span style='color:#7ed07e'>tiberium</span> / <span style='color:#8fc0ff'>crystal</span>.": "Feldfelder eingefärbt: <span style='color:#7ed07e'>Tiberium</span> / <span style='color:#8fc0ff'>Kristall</span>.",
                "Figures are continuous production (packages aren't layout-dependent).": "Die Zahlen sind kontinuierliche Produktion (Pakete sind nicht layoutabhängig).",
                "Finished, but could not apply layout: ": "Abgeschlossen, aber Layout konnte nicht angewendet werden: ",
                "First Offense": "Erste Offensive",
                "Flash the browser-tab favicon (siren icon)": "Das Browser-Tab-Favicon aufblinken lassen (Sirenen-Symbol)",
                "Flash the browser-tab title": "Den Browser-Tab-Titel aufblinken lassen",
                "Foe": "Feind",
                "Force-sell special buildings": "Spezialgebäude zwangsverkaufen",
                "Forgotten / NPC bases (green)": "Vergessene / NPC-Basen (grün)",
                "Found": "Gefunden",
                "Friend": "Freund",
                "From:": "Von:",
                "Gain/h": "Gewinn/h",
                "Game will reload now.": "Das Spiel wird jetzt neu geladen.",
                "General": "Allgemein",
                "General Information": "Allgemeine Informationen",
                "Go": "Los",
                "Green = your offense can activate it · Red = blocked (offense too low)": "Grün = deine Offensive kann es aktivieren · Rot = blockiert (Offensive zu niedrig)",
                "HQ": "VZ",
                "Hard cap on battle simulations per click (the main safety net).": "Harte Obergrenze für Kampfsimulationen pro Klick (das wichtigste Sicherheitsnetz).",
                "Hard cap on climb+kick rounds for a single optimize click.": "Harte Obergrenze für Climb+Kick-Runden bei einem einzelnen Optimieren-Klick.",
                "Highest first &middot; select then Up/Down to reorder": "Höchste zuerst &middot; auswählen, dann Hoch/Runter zum Umsortieren",
                "Highlight bases in range while moving a base": "Basen in Reichweite hervorheben, während eine Basis verschoben wird",
                "Highlight in move-base view:": "In der Basis-Verschiebe-Ansicht hervorheben:",
                "Homepage": "Webseite",
                "Hours": "Stunden",
                "How many candidate destination tiles to test per building each pass. Higher = more thorough but slower.": "Wie viele Kandidaten-Zielfelder pro Durchlauf je Gebäude getestet werden. Höher = gründlicher, aber langsamer.",
                "How many candidate layouts to evaluate each round. Higher = more thorough but more simulations.": "Wie viele Kandidaten-Aufstellungen pro Runde ausgewertet werden. Höher = gründlicher, aber mehr Simulationen.",
                "How many of the top rows Go will upgrade. Auto-capped to how many will actually succeed (a batch never fails), and reset to 5 (or fewer) on Refresh and whenever you toggle 'Transfer as needed'.": "Wie viele der obersten Zeilen 'Los' verbessern wird. Automatisch begrenzt auf die Anzahl, die tatsächlich gelingen wird (ein Stapel schlägt nie fehl), und beim Aktualisieren sowie beim Umschalten von 'Bei Bedarf transferieren' auf 5 (oder weniger) zurückgesetzt.",
                "How many rows a unit may drift away from its starting row while climbing (kicks may go further if it helps).": "Um wie viele Reihen eine Einheit beim Climbing von ihrer Startreihe abdriften darf (Kicks dürfen weiter gehen, wenn es hilft).",
                "Improvement passes per attempt. Higher = more thorough but slower.": "Verbesserungsdurchläufe pro Versuch. Höher = gründlicher, aber langsamer.",
                "Infantry Repairtime": "Fußtruppen Reparaturzeit",
                "Infected": "Infiziert",
                "Interval (minutes):": "Intervall (Minuten):",
                "Keep upgraded rows (clear on Refresh)": "Verbesserte Zeilen behalten (beim Aktualisieren löschen)",
                "Last update:": "Letzte Aktualisierung:",
                "Layout Optimizer": "Layout-Optimierer",
                "Legend": "Legende",
                "Levels:": "Level:",
                "Loading...": "Wird geladen...",
                "Loc": "Pos",
                "Loot + levels of the base you click on the map": "Beute + Level der Basis, die du auf der Karte anklickst",
                "Loot Info": "Beute-Info",
                "Loot Summary": "Beute-Übersicht",
                "Lootable resources": "Erbeutbare Ressourcen",
                "MM - Base Scanner": "MM - Basis-Scanner",
                "Master: enable Attack Alert": "Hauptschalter: Angriffsalarm aktivieren",
                "Master: enable the move-panel readout": "Hauptschalter: die Verschiebe-Panel-Anzeige aktivieren",
                "Master: enable the range overlay": "Hauptschalter: das Reichweiten-Overlay aktivieren",
                "Master: enable the tunnel overlay": "Hauptschalter: das Tunnel-Overlay aktivieren",
                "Master: show the overlay at all": "Hauptschalter: Overlay überhaupt anzeigen",
                "Max bases": "Max. Basen",
                "Max bases founded": "Max. gegründete Basen",
                "Max fruitless kicks": "Max. erfolglose Kicks",
                "Max rounds per click": "Max. Runden pro Klick",
                "Max row drift from start": "Max. Reihen-Abweichung vom Start",
                "Max simulations per click": "Max. Simulationen pro Klick",
                "Max step (cells per move)": "Max. Schritt (Zellen pro Bewegung)",
                "Maximal CP": "Maximale KP",
                "Maximal Reptime": "Maximale Repzeit",
                "Member": "Mitglied",
                "Member Status": "Mitgliederstatus",
                "Members": "Mitglieder",
                "Mirrors units horizontally.": "Spiegelt die Einheiten horizontal.",
                "Mirrors units vertically.": "Spiegelt die Einheiten vertikal.",
                "Morale": "Moral",
                "Move": "Verschieben",
                "Move (and, if proposed, demolish) buildings in-game to match the proposed layout. Shows a confirmation with exactly what will change first.": "Gebäude im Spiel verschieben (und, falls vorgeschlagen, abreißen), um dem vorgeschlagenen Layout zu entsprechen. Zeigt zuerst eine Bestätigung mit genau dem, was sich ändern wird.",
                "Move Info": "Verschiebe-Info",
                "Move ready:": "Verschieben bereit:",
                "Move-cooldown expiry time (when the spot is free to move into)": "Verschiebe-Abklingzeit-Ablauf (wann der Platz frei zum Hineinverschieben ist)",
                "Moved": "Verschoben",
                "Movement": "Bewegung",
                "Moves": "Verschiebungen",
                "Moves (0)": "Verschiebungen (0)",
                "NPC bases in range:": "NPC-Basen in Reichweite:",
                "Needs a Tiberium transfer": "Benötigt einen Tiberium-Transfer",
                "Neighbors:": "Nachbarn:",
                "Net production change (continuous /h)": "Netto-Produktionsänderung (kontinuierlich /h)",
                "Neutral bases (peace/NAP)": "Neutrale Basen (Frieden/NAP)",
                "Next MCV": "Nächste MCV",
                "No alliance": "Keine Allianz",
                "No army units found to optimize.": "Keine Armeeeinheiten zum Optimieren gefunden.",
                "No layout found; restored original.": "Kein Layout gefunden; Original wiederhergestellt.",
                "No loot data for this object": "Keine Beute-Daten für dieses Objekt",
                "No moves improve": "Keine Verschiebung verbessert",
                "No transferable resources within your credit budget": "Keine transferierbaren Ressourcen innerhalb deines Credit-Budgets",
                "No winning layout found (enemy can't be destroyed) - try 'Best DF 0'. Restored original.": "Kein Sieger-Layout gefunden (Gegner kann nicht zerstört werden) - probiere 'Bestes DF 0'. Original wiederhergestellt.",
                "NoGrow": "KeinWachstum",
                "None": "Keine",
                "Note: build &amp; upgrade are queued as game commands; the new building appears immediately and upgrades complete over time. Make sure the demolition refund covers the cost.": "Hinweis: Bauen &amp; Verbessern werden als Spielbefehle in die Warteschlange gestellt; das neue Gebäude erscheint sofort und Verbesserungen werden mit der Zeit abgeschlossen. Stelle sicher, dass die Abrissrückerstattung die Kosten deckt.",
                "Nothing to apply - the base already matches the proposal.": "Nichts anzuwenden - die Basis entspricht bereits dem Vorschlag.",
                "Nothing to upgrade right now - not enough resources (or credits for the transfer fees).": "Derzeit nichts zu verbessern - nicht genug Ressourcen (oder Credits für die Transfergebühren).",
                "Nothing to upgrade without transfers - tick \"Transfer as needed\" to allow them, or wait for this base to produce more Tiberium.": "Nichts ohne Transfers zu verbessern - hake \"Bei Bedarf transferieren\" an, um sie zu erlauben, oder warte, bis diese Basis mehr Tiberium produziert.",
                "Numbers match the grid.": "Die Zahlen stimmen mit dem Raster überein.",
                "Numbers match the grid. Click <b>Apply to base</b> above to make these changes in-game (you'll get a confirmation first), or do them by hand in move mode.": "Die Zahlen stimmen mit dem Raster überein. Klicke oben auf <b>Auf Basis anwenden</b>, um diese Änderungen im Spiel vorzunehmen (du erhältst zuerst eine Bestätigung), oder mache sie von Hand im Verschiebemodus.",
                "OFF (default): only suggest moves that improve the chosen resource without hurting the others. Strict but limited - a swap that's blocked by, say, a Refinery in the way is never considered.\n\nON: widen the search to ALL resource buildings and let the optimizer trade small losses in other resources for a larger target gain (score = target_gain - 0.5 * sum_of_other_losses). The results panel shows the net change for all 4 resources so you can see exactly what's being traded.": "AUS (Standard): nur Verschiebungen vorschlagen, die die gewählte Ressource verbessern, ohne den anderen zu schaden. Streng, aber begrenzt - ein Tausch, der z. B. durch eine im Weg stehende Raffinerie blockiert wird, wird nie berücksichtigt.\n\nEIN: die Suche auf ALLE Ressourcengebäude erweitern und den Optimierer kleine Verluste bei anderen Ressourcen gegen einen größeren Zielgewinn eintauschen lassen (Punktzahl = Zielgewinn - 0,5 * Summe_der_anderen_Verluste). Das Ergebnis-Panel zeigt die Nettoänderung für alle 4 Ressourcen, damit du genau siehst, was eingetauscht wird.",
                "Off": "Aus",
                "Off/Def Bubbles": "Off/Def-Blasen",
                "Offense": "Offensive",
                "Offense Bases Count": "Anzahl Offensiv Basen",
                "Offense Level": "Offensiv Level",
                "Offense Level:": "Offensivlevel:",
                "On-grid overlay (Ctrl-hold)": "Raster-Overlay (Strg halten)",
                "On-map off/def bubbles (enemy / alliance / own)": "Off/Def-Blasen auf der Karte (Gegner / Allianz / eigene)",
                "On: upgraded rows stay marked '✓ Upgraded' until you Refresh.\nOff: each row vanishes the instant its upgrade succeeds (the classic behavior).": "Ein: verbesserte Zeilen bleiben mit '✓ Verbessert' markiert, bis du aktualisierst.\nAus: jede Zeile verschwindet in dem Moment, in dem ihre Verbesserung gelingt (das klassische Verhalten).",
                "Only alarm while the game tab is in the background": "Nur alarmieren, während der Spiel-Tab im Hintergrund ist",
                "Open an attack (combat setup) on a target first.": "Öffne zuerst einen Angriff (Kampfaufbau) auf ein Ziel.",
                "Open this base": "Diese Basis öffnen",
                "Optimize this base's layout to maximize": "Das Layout dieser Basis optimieren, um zu maximieren",
                "Optimizer Options": "Optimierer-Optionen",
                "Optimizer already running...": "Optimierer läuft bereits...",
                "Optimizer stopped by user.": "Optimierer vom Benutzer gestoppt.",
                "Optimizing": "Wird optimiert",
                "Optimizing (": "Wird optimiert (",
                "Origin base not loaded": "Ursprungsbasis nicht geladen",
                "Other players' bases (orange)": "Basen anderer Spieler (orange)",
                "Outpost": "Außenposten",
                "Outposts": "Außenposten",
                "Own bases": "Eigene Basen",
                "Package Production": "Paket-Produktion",
                "Pick an origin base": "Wähle eine Ursprungsbasis",
                "Pin into the game menu / unpin to a movable panel": "Im Spielmenü anheften / zu einem beweglichen Panel lösen",
                "Plan level up": "Level-Up planen",
                "Plan move base": "Basis-Verschieben planen",
                "Plan remove": "Entfernen planen",
                "Plan ruin": "Ruinieren planen",
                "Plan ruin for": "Ruinieren planen für",
                "Play an alarm sound": "Einen Alarmton abspielen",
                "Player": "Spieler",
                "Player Class": "Spielerklasse",
                "Player Name": "Spielername",
                "Players": "Spieler",
                "Players Production": "Spieler Produktion",
                "Pooled refund": "Gebündelte Rückerstattung",
                "Possible attacks from this base (available CP):": "Mögliche Angriffe von dieser Basis (verfügbare CP):",
                "Pow cost": "Strom-Kosten",
                "Pow on builds+upgrades.": "Strom bei Bauten+Verbesserungen.",
                "Pow/gain": "Strom/Gewinn",
                "Power": "Strom",
                "Power Produktion": "Strom Produktion",
                "Preset": "Voreinstellung",
                "Prevents a unit bouncing back and forth between the same two cells.": "Verhindert, dass eine Einheit zwischen denselben zwei Zellen hin und her springt.",
                "Preview the siren / title / favicon (click once to allow sound).": "Sirene / Titel / Favicon vorschauen (einmal klicken, um Ton zu erlauben).",
                "Priority Setup": "Prioritäts-Einrichtung",
                "Processed": "Verarbeitet",
                "Production": "Produktion",
                "Proposed layout": "Vorgeschlagenes Layout",
                "Pull the missing Tiberium from your other bases (cheapest first), then upgrade.\nTransfer fee:": "Das fehlende Tiberium von deinen anderen Basen holen (günstigste zuerst), dann verbessern.\nTransfergebühr:",
                "Random shake-ups to escape a 'good but not best' layout and explore a different arrangement. More = explores more but slower.": "Zufällige Umstellungen, um einem 'guten, aber nicht besten' Layout zu entkommen und eine andere Anordnung zu erkunden. Mehr = erkundet mehr, aber langsamer.",
                "Range override:": "Reichweiten-Überschreibung:",
                "Rank": "Rang",
                "Re-reading base&hellip;": "Basis wird erneut gelesen&hellip;",
                "Real gain:": "Realer Gewinn:",
                "Real loss:": "Realer Verlust:",
                "Recompute the list (clears the '✓ Upgraded' marks and rescans every base)": "Die Liste neu berechnen (löscht die '✓ Verbessert'-Markierungen und scannt jede Basis erneut)",
                "Recompute the table from the current game state": "Die Tabelle aus dem aktuellen Spielzustand neu berechnen",
                "Refresh": "Aktualisieren",
                "Region map": "Regionskarte",
                "Relative chance of trying a horizontal (left/right) move. Higher = more likely to be picked.": "Relative Chance, eine horizontale (links/rechts) Bewegung auszuprobieren. Höher = wird eher ausgewählt.",
                "Relative chance of trying a vertical (up/down) move. Keep below the left/right weight to favour horizontal changes (e.g. 0.75).": "Relative Chance, eine vertikale (oben/unten) Bewegung auszuprobieren. Halte sie unter der Links/Rechts-Gewichtung, um horizontale Änderungen zu bevorzugen (z. B. 0,75).",
                "Remember transported units are not supported.": "Denk daran das transportierte Einheiten nicht unterstützt werden.",
                "Repair All Buildings": "Alle Gebäude reparieren",
                "Repair All Units": "Alle Einheiten reparieren",
                "Repair buildings (where allowed) across every base": "Gebäude (wo erlaubt) auf jeder Basis reparieren",
                "Repair buildings on bases where repair is available": "Gebäude auf Basen reparieren, wo Reparatur verfügbar ist",
                "Repair units across every base": "Einheiten auf jeder Basis reparieren",
                "Repair units on bases where repair is available": "Einheiten auf Basen reparieren, wo Reparatur verfügbar ist",
                "Required Level:": "Erforderliches Level:",
                "Reset": "Zurücksetzen",
                "Reset Defaults": "Standardwerte zurücksetzen",
                "Reset Formation": "Formation zurücksetzen",
                "Reset plans": "Pläne zurücksetzen",
                "Reset to default": "Auf Standard zurücksetzen",
                "Resource": "Ressource",
                "Resource:": "Ressource:",
                "Reveals a checklist of the 'one-of' special buildings on this base (Defense HQ/Facility, Command Center, Barracks, Factory, Airport, Support). Check any you're willing to sacrifice; the optimizer demolishes them, pools their 90% refund, and fills the freed tiles with the best new producers of the chosen resource (early-game 'strip to the Construction Yard' play).\n\nYou do NOT need this for the normal case: with 'Sell up to' >= 1 and 'Allow reductions' on, the optimizer already auto-considers selling an economy building (e.g. a Silo) and building a producer (e.g. an Accumulator) in its place.": "Zeigt eine Checkliste der 'Einzel'-Spezialgebäude auf dieser Basis (Verteidigungs-HQ/-Anlage, Kommandozentrale, Kaserne, Fabrik, Flughafen, Unterstützung). Hake alle an, die du zu opfern bereit bist; der Optimierer reißt sie ab, bündelt ihre 90%-Rückerstattung und füllt die freigewordenen Felder mit den besten neuen Produzenten der gewählten Ressource (Early-Game-'Abriss bis zur Bauwerft'-Spielweise).\n\nFür den Normalfall brauchst du dies NICHT: mit 'Verkaufe bis zu' >= 1 und aktiviertem 'Reduzierungen erlauben' erwägt der Optimierer bereits automatisch, ein Wirtschaftsgebäude (z. B. ein Silo) zu verkaufen und an seiner Stelle einen Produzenten (z. B. einen Akkumulator) zu bauen.",
                "Right click: Set formation from CNCTAOpt Long Link": "Rechtsklick: Formation von CNCTAOpt Long Link laden",
                "Round ": "Runde ",
                "Round tweaks: ": "Runden-Anpassungen: ",
                "Rounds:": "Runden:",
                "Rule Out": "Ausschließen",
                "Run periodically across every base. Off by default for units to avoid surprise resource spend.": "Regelmäßig auf jeder Basis ausführen. Standardmäßig für Einheiten aus, um überraschende Ressourcenausgaben zu vermeiden.",
                "SELL": "VERKAUFEN",
                "Save": "Speichern",
                "Save/Load Formation [NUM ,]": "Formation speichern/laden [NUM ,]",
                "Saved - applies on the next optimize click.": "Gespeichert - wird beim nächsten Optimieren-Klick angewendet.",
                "Scan": "Scannen",
                "Scan attackable bases near one of your bases": "Angreifbare Basen in der Nähe einer deiner Basen scannen",
                "Scanning…": "Wird gescannt…",
                "Search Budget": "Suchbudget",
                "Search quality (advanced)": "Suchqualität (erweitert)",
                "Second Offense": "Zweite Offensive",
                "Select at least one type": "Mindestens einen Typ auswählen",
                "Selected army unit": "Markierte Armee-Einheit",
                "Selected building": "Markiertes Gebäude",
                "Selected defense unit": "Markierte Abwehrstellung",
                "Self-funded plan:": "Selbstfinanzierter Plan:",
                "Sell": "Verkaufen",
                "Sell up to:": "Verkaufe bis zu:",
                "Server Language": "Server Sprache",
                "Set error: ": "Fehler beim Setzen: ",
                "Settings": "Einstellungen",
                "Shifts units one space down.": "Verschiebt die Einheiten einen Platz nach unten.",
                "Shifts units one space left.": "Verschiebt die Einheiten einen Platz nach links.",
                "Shifts units one space right.": "Verschiebt die Einheiten einen Platz nach rechts.",
                "Shifts units one space up.": "Verschiebt Einheiten einen Platz nach oben.",
                "Show attack loot summary in region base popups": "Angriffsbeute-Übersicht in den Regions-Basis-Popups anzeigen",
                "Show current formation with CNCTAOpt": "Zeigt die aktuelle Formation mit CNCTAOpt an",
                "Show the Offense / Required level readout in the move panel": "Die Offensiv-/Erforderliches-Level-Anzeige im Verschiebe-Panel anzeigen",
                "Show the off/def map bubble for:": "Die Off/Def-Kartenblase anzeigen für:",
                "Show which tunnels you can activate while moving a base": "Anzeigen, welche Tunnel du beim Verschieben einer Basis aktivieren kannst",
                "Show:": "Anzeigen:",
                "Sim result error: ": "Sim-Ergebnisfehler: ",
                "Sim send error: ": "Sim-Sendefehler: ",
                "Skip Victory-Popup After Battle": "Sieg-Popup nach dem Kampf überspringen",
                "Skipped": "Übersprungen",
                "Staged": "Bereitgestellt",
                "Statistic": "Statistik",
                "Stop": "Stopp",
                "Stop after this many random jumps in a row that find no improvement.": "Stoppt nach so vielen zufälligen Sprüngen in Folge, die keine Verbesserung finden.",
                "Stopped - ": "Gestoppt - ",
                "Stopped at": "Gestoppt bei",
                "Stopped. ": "Gestoppt. ",
                "Stored resources": "Gespeicherte Ressourcen",
                "Sum": "Summe",
                "Sum/CP": "Summe/CP",
                "Support": "Unterstützung",
                "Support Building Level Ø": "Support Gebäude Level Ø",
                "Support row": "Unterstützungs-Reihe",
                "Swaps lines 1 & 2.": "Tauscht Linien 1 & 2.",
                "Swaps lines 2 & 3.": "Tauscht Linien 2 & 3.",
                "Swaps lines 3 & 4.": "Tauscht Linien 3 & 4.",
                "Target": "Ziel",
                "Target out of range, no attack-loot calculation possible": "Ziel außer Reichweite, keine Angriffsbeute-Berechnung möglich",
                "Test alarm": "Alarm testen",
                "Tib cost": "Tib-Kosten",
                "Tib/gain": "Tib/Gewinn",
                "Tiberium Harvester": "Tiberium-Erntemaschine",
                "Tiberium Production": "Tiberium Produktion",
                "Tick \"Transfer as needed\" above to allow it.": "Hake oben \"Bei Bedarf transferieren\" an, um es zu erlauben.",
                "Tiles show each building's icon + its <b>level</b> (corner).": "Felder zeigen das Symbol jedes Gebäudes + sein <b>Level</b> (Ecke).",
                "Time/resources until your next base (MCV)": "Zeit/Ressourcen bis zu deiner nächsten Basis (MCV)",
                "Toggle the Base Tools window": "Das Basis-Tools-Fenster umschalten",
                "Toggle the Member Status display": "Die Mitgliederstatus-Anzeige umschalten",
                "Total / BaseLevel": "Gesamt / Basis-Level",
                "Total / h": "Gesamt / h",
                "Total Crystal Production": "Gesamte Kristall Produktion",
                "Total Power Production": "Gesamte Strom Produktion",
                "Total Production": "Gesamte Produktion",
                "Total Tiberium Production": "Gesamte Tiberium Produktion",
                "Transfer + upgrade": "Transferieren + verbessern",
                "Transfer as needed": "Bei Bedarf transferieren",
                "Transferred all available - upgrading as many as fit.": "Alles Verfügbare transferiert - es werden so viele verbessert, wie passen.",
                "Transferring max available (": "Maximal Verfügbares wird transferiert (",
                "Transfers complete - upgrading.": "Transfers abgeschlossen - wird verbessert.",
                "Tune how the auto-optimizer searches layouts: step size, left/right vs up/down weighting, row drift and search budgets.": "Stelle ein, wie der Auto-Optimierer Aufstellungen durchsucht: Schrittweite, Links/Rechts- vs. Oben/Unten-Gewichtung, Reihen-Abweichung und Suchbudgets.",
                "Tunnel Info": "Tunnel-Info",
                "Tweaks tried per round": "Pro Runde ausprobierte Anpassungen",
                "Type": "Typ",
                "Undo": "Rückgängig",
                "Up": "Hoch",
                "Upgrade": "Verbessern",
                "Upgrade Priority": "Verbesserungspriorität",
                "Upgrade the top N rows in the list below (in the current sort order). Re-validates each row before firing it so resource drains from earlier rows are accounted for; if 'Transfer as needed' is on, will transfer Tiberium in from other bases when the local base is short.": "Verbessert die obersten N Zeilen der Liste unten (in der aktuellen Sortierreihenfolge). Validiert jede Zeile vor dem Auslösen erneut, damit Ressourcenverbräuche früherer Zeilen berücksichtigt werden; wenn 'Bei Bedarf transferieren' aktiv ist, wird Tiberium von anderen Basen herangeschafft, wenn die lokale Basis knapp ist.",
                "Upgrade this building now": "Dieses Gebäude jetzt verbessern",
                "Upgrade top": "Oberste verbessern",
                "Upgrade: Base": "Verbessern: Basis",
                "Upgrade: Defense": "Verbessern: Verteidigung",
                "Upgrade: Offense": "Verbessern: Offensive",
                "Upgraded": "Verbessert",
                "Upgrading": "Wird verbessert",
                "Use floating panel": "Schwebendes Panel verwenden",
                "Vehicle Repairtime": "Fahrzeug Reparaturzeit",
                "View Simulation": "Simulation anzeigen",
                "Warn me (sound + tab title + favicon) when a base is under attack": "Mich warnen (Ton + Tab-Titel + Favicon), wenn eine Basis angegriffen wird",
                "Weight: left/right moves": "Gewichtung: Links/Rechts-Bewegungen",
                "Weight: up/down moves": "Gewichtung: Oben/Unten-Bewegungen",
                "When a row in the batch would otherwise fail because the local base is short on Tiberium, transfer from your other bases (cheapest first) before upgrading. Skipped if no transfer plan covers the gap or you can't afford the transfer fee. Off by default - transfers cost credits.": "Wenn eine Zeile im Stapel sonst fehlschlagen würde, weil die lokale Basis zu wenig Tiberium hat, vor dem Verbessern von deinen anderen Basen transferieren (günstigste zuerst). Wird übersprungen, wenn kein Transferplan die Lücke deckt oder du dir die Transfergebühr nicht leisten kannst. Standardmäßig aus - Transfers kosten Credits.",
                "When on, hold Ctrl while viewing your own base to see a translucent gain/cost overlay on each resource-producing tile (Harvester, Silo, PowerPlant, Accumulator, Refinery). Best = green, worst = red, label is the ratio. Release Ctrl to hide. Salvaged from xTr1m's Base Overlay (retired).": "Wenn aktiviert, halte Strg, während du deine eigene Basis betrachtest, um ein durchscheinendes Gewinn-/Kosten-Overlay auf jedem ressourcenproduzierenden Feld zu sehen (Erntemaschine, Silo, Kraftwerk, Akkumulator, Raffinerie). Bestes = grün, schlechtestes = rot, die Beschriftung ist das Verhältnis. Strg loslassen zum Ausblenden. Übernommen aus xTr1ms Base Overlay (eingestellt).",
                "When on, opening the info popup for any non-own base on the region map (camp / outpost / forgotten / enemy player) appends a quick loot summary: 'Possible attacks (available CP)', 'Lootable resources', 'per CP', '2nd run' and '3rd run' breakdowns of Tiberium / Crystal / Credits / Research Points - so you can pick the best farm/attack target without opening each base's attack screen.": "Wenn aktiviert, fügt das Öffnen des Info-Popups für jede fremde Basis auf der Regionskarte (Lager / Außenposten / vergessen / gegnerischer Spieler) eine schnelle Beute-Übersicht hinzu: 'Mögliche Angriffe (verfügbare CP)', 'Erbeutbare Ressourcen', 'pro CP', '2. Durchlauf'- und '3. Durchlauf'-Aufschlüsselungen von Tiberium / Kristall / Credits / Forschungspunkten - so kannst du das beste Farm-/Angriffsziel auswählen, ohne den Angriffsbildschirm jeder Basis zu öffnen.",
                "When on, the auto-repair tick walks the priority list below and ROI-sorts damaged buildings within each tier. Off = call the game's RepairAll in its default order.": "Wenn aktiviert, durchläuft der Auto-Reparatur-Tick die Prioritätsliste unten und sortiert beschädigte Gebäude innerhalb jeder Stufe nach ROI. Aus = das spieleigene RepairAll in seiner Standardreihenfolge aufrufen.",
                "When the current base lacks Tiberium or Crystal for an upgrade, transfer the shortfall in from your other bases (cheapest first) before firing the upgrade. Power isn't transferable - those shortages still fall through. Off by default (transfers cost credits).": "Wenn der aktuellen Basis Tiberium oder Kristall für eine Verbesserung fehlt, den Fehlbetrag von deinen anderen Basen herantransferieren (günstigste zuerst), bevor die Verbesserung ausgelöst wird. Strom ist nicht transferierbar - solche Engpässe bleiben bestehen. Standardmäßig aus (Transfers kosten Credits).",
                "Which RESOURCE this upgrade boosts (Tib / Cry / Pow / $=Credits). The building type itself is in the Building column.": "Welche RESSOURCE diese Verbesserung steigert (Tib / Cry / Pow / $=Credits). Der Gebäudetyp selbst steht in der Spalte Gebäude.",
                "While moving a base, add to the move panel:": "Während des Verschiebens einer Basis zum Verschiebe-Panel hinzufügen:",
                "While moving a base, show tunnel activation:": "Während des Verschiebens einer Basis die Tunnelaktivierung anzeigen:",
                "Works on its OWN, but the upgrades above drain this base first - it will FAIL if you batch them with Go. Lower 'Upgrade top', or click this row by itself.": "Funktioniert ALLEINE, aber die obigen Verbesserungen leeren diese Basis zuerst - es wird FEHLSCHLAGEN, wenn du sie mit 'Los' im Stapel ausführst. Senke 'Oberste verbessern' oder klicke diese Zeile einzeln an.",
                "Xfer $": "Transfer $",
                "[allow reductions: ON]": "[Reduzierungen erlauben: EIN]",
                "a base": "eine Basis",
                "a move target is blocked by a fixed building - re-run the optimizer": "ein Verschiebeziel wird durch ein festes Gebäude blockiert - den Optimierer erneut ausführen",
                "all bases": "aller Basen",
                "allowing reductions": "Reduzierungen werden erlaubt",
                "and spend the 90% demolish refund to build": "und die 90%-Abrissrückerstattung zum Bauen ausgeben",
                "at": "bei",
                "at ": "bei ",
                "auto-build": "Auto-Bauen",
                "base drained by the upgrades above": "Basis durch die obigen Verbesserungen geleert",
                "base is locked": "Basis ist gesperrt",
                "base unavailable": "Basis nicht verfügbar",
                "best DF=0": "bestes DF=0",
                "best win": "bester Sieg",
                "blocked": "blockiert",
                "build manager unavailable": "Bau-Manager nicht verfügbar",
                "build tile is occupied": "Baufeld ist belegt",
                "build(s)": "Bau(ten)",
                "building": "Gebäude",
                "building not found": "Gebäude nicht gefunden",
                "building to upgrade not found": "Zu verbesserndes Gebäude nicht gefunden",
                "buildings": "Gebäude",
                "buildings to repair:": "Zu reparierende Gebäude:",
                "can't afford transfer fee": "Transfergebühr nicht leistbar",
                "candidate(s),": "Kandidat(en),",
                "change(s)": "Änderung(en)",
                "could not read base layout": "Basis-Layout konnte nicht gelesen werden",
                "could not read the base": "die Basis konnte nicht gelesen werden",
                "could not read the build-cost API (game may have updated)": "die Baukosten-API konnte nicht gelesen werden (das Spiel wurde möglicherweise aktualisiert)",
                "couldn't sequence all moves automatically - apply by hand in move mode": "konnte nicht alle Verschiebungen automatisch anordnen - von Hand im Verschiebemodus anwenden",
                "couldn't sequence the moves automatically (no free staging tile) - apply by hand in move mode": "konnte die Verschiebungen nicht automatisch anordnen (kein freies Bereitstellungsfeld) - von Hand im Verschiebemodus anwenden",
                "credits": "Credits",
                "credits.": "Credits.",
                "cyan tile = <b>build new</b> building here (self-funded by a sell's refund).": "cyanfarbenes Feld = hier <b>neu bauen</b> (selbstfinanziert durch die Rückerstattung eines Verkaufs).",
                "demolish": "abreißen",
                "demolished": "abgerissen",
                "demolition(s)": "Abriss(e)",
                "done": "fertig",
                "enemy ": "Gegner ",
                "enough to be worth demolishing another building (raising “Sell up to” past": "genug, um den Abriss eines weiteren Gebäudes zu rechtfertigen („Verkaufe bis zu“ über",
                "error - see console": "Fehler - siehe Konsole",
                "eval error - see console": "Auswertungsfehler - siehe Konsole",
                "failed": "fehlgeschlagen",
                "force-selling": "Zwangsverkauf",
                "from this base's production": "aus der Produktion dieser Basis",
                "game refused demolish": "Spiel hat Abriss verweigert",
                "green tile / #badge = building <b>moves here</b> (matching <span style='color:#ff8a8a'>&rarr;#</span> red tile = where it left).": "grünes Feld / #-Abzeichen = Gebäude <b>verschiebt sich hierher</b> (passendes <span style='color:#ff8a8a'>&rarr;#</span> rotes Feld = wo es weggegangen ist).",
                "harvester": "Erntemaschine",
                "inclusive Bonus POI": "inklusive POI Bonus",
                "internal error (see console)": "interner Fehler (siehe Konsole)",
                "last:": "letztes:",
                "link(s) uncalibrated": "Verbindung(en) nicht kalibriert",
                "load": "laden",
                "low-impact building": "wenig wirkungsvolles Gebäude",
                "max 2 waves": "max. 2 Wellen",
                "max 3 waves": "max. 3 Wellen",
                "max 4 waves": "max. 4 Wellen",
                "missing build type id": "fehlende Bautyp-ID",
                "move": "verschieben",
                "move(s)": "Verschiebung(en)",
                "moves": "Verschiebungen",
                "moves here - #": "verschiebt sich hierher - #",
                "new": "neu",
                "new building": "neues Gebäude",
                "new producers": "neue Produzenten",
                "no base can transfer enough Tiberium": "keine Basis kann genug Tiberium transferieren",
                "no buildable": "nicht baubar",
                "no further MCV to research": "keine weitere MCV zu erforschen",
                "no further sell raised": "kein weiterer Verkauf hat erhöht",
                "no income": "kein Einkommen",
                "no movable buildings for this resource": "keine verschiebbaren Gebäude für diese Ressource",
                "no movable buildings on this base": "keine verschiebbaren Gebäude auf dieser Basis",
                "no optimization result to apply": "kein Optimierungsergebnis zum Anwenden",
                "no transfer plan can cover the gap": "kein Transferplan kann die Lücke decken",
                "no visible effect after": "kein sichtbarer Effekt nach",
                "none of the selected force-sell buildings are on this base": "keines der ausgewählten Zwangsverkauf-Gebäude befindet sich auf dieser Basis",
                "none of your stored resources are spent.": "keine deiner gespeicherten Ressourcen werden ausgegeben.",
                "not enough power": "nicht genug Strom",
                "not enough tiberium (enable \"Transfer as needed\" to pull from other bases)": "nicht genug Tiberium (aktiviere \"Bei Bedarf transferieren\", um von anderen Basen zu holen)",
                "now": "jetzt",
                "now harvests": "erntet jetzt",
                "of": "von",
                "on this base, even when trading other resources.": "auf dieser Basis, selbst beim Eintausch anderer Ressourcen.",
                "on this base. Try <b>Allow reductions</b> to consider moves that trade other resources for a bigger target gain.": "auf dieser Basis. Probiere <b>Reduzierungen erlauben</b>, um Verschiebungen zu erwägen, die andere Ressourcen gegen einen größeren Zielgewinn eintauschen.",
                "paid for by selling": "bezahlt durch Verkauf von",
                "per CP": "pro CP",
                "producer": "Produzent",
                "producer exists on this base to clone": "Produzent existiert auf dieser Basis zum Klonen",
                "producer here": "Produzent hier",
                "production": "Produktion",
                "red tile = recommended <b>sell</b> (demolish).": "rotes Feld = empfohlener <b>Verkauf</b> (Abriss).",
                "refund": "Rückerstattung",
                "reset": "zurücksetzen",
                "s (the game may have rejected it - check resources / build slots)": "s (das Spiel hat es möglicherweise abgelehnt - prüfe Ressourcen / Bauplätze)",
                "save": "speichern",
                "sell": "verkaufen",
                "sell(s)": "Verkauf/Verkäufe",
                "sells": "verkauft",
                "simulations in cache": "Simulationen im Cache",
                "skipped": "übersprungen",
                "spent": "ausgegeben",
                "target": "Ziel",
                "target base cannot trade right now": "Zielbasis kann derzeit nicht handeln",
                "targets": "Ziele",
                "the base changed since you optimized (a building is gone) - re-run the optimizer": "die Basis hat sich seit der Optimierung geändert (ein Gebäude ist weg) - den Optimierer erneut ausführen",
                "the base changed since you optimized (a building moved) - re-run the optimizer": "die Basis hat sich seit der Optimierung geändert (ein Gebäude wurde verschoben) - den Optimierer erneut ausführen",
                "the refund from those sells can't fund any useful new": "die Rückerstattung aus diesen Verkäufen kann nichts sinnvolles Neues finanzieren",
                "tile": "Feld",
                "tile vacated by move #": "Feld freigemacht durch Verschiebung #",
                "tiles": "Felder",
                "units to repair:": "Zu reparierende Einheiten:",
                "unknown": "unbekannt",
                "up to": "bis zu",
                "upgradeable now": "jetzt verbesserbar",
                "via": "über",
                "via a temporary staging hop to untangle a swap": "über einen temporären Bereitstellungsschritt, um einen Tausch zu entwirren",
                "via transfer": "über Transfer",
                "wait": "warten",
                "will be <b>moved</b>": "wird <b>verschoben</b>",
                "will be BUILT and UPGRADED</b> (paid from the demolition refund):": "wird GEBAUT und VERBESSERT</b> (aus der Abrissrückerstattung bezahlt):",
                "will be PERMANENTLY DEMOLISHED:": "wird DAUERHAFT ABGERISSEN:",
                "will succeed": "wird gelingen",
                "will switch field type (tiberium &harr; crystal) - this <b>resets that harvester's in-progress package</b>. Continuous production still improves; you just lose the partial package.": "wechselt den Feldtyp (Tiberium &harr; Kristall) - dies <b>setzt das laufende Paket dieser Erntemaschine zurück</b>. Die kontinuierliche Produktion verbessert sich trotzdem; du verlierst nur das Teilpaket.",
                "won't change this plan). Enable <i>localStorage.MMBASETOOLS_DEBUG='1'</i> + reload to see the per-round numbers in the console.": "ändert diesen Plan nicht). Aktiviere <i>localStorage.MMBASETOOLS_DEBUG='1'</i> + neu laden, um die Zahlen pro Runde in der Konsole zu sehen.",
                "⇄ Transfer & Upgrade": "⇄ Transferieren & Verbessern",
                "⚠ ALERT - ": "⚠ ALARM - ",
                "✓ Upgraded": "✓ Verbessert",
                "✗ failed": "✗ fehlgeschlagen",
                "⬆ Upgrade": "⬆ Verbessern"
              },
              "ru": {
                " (Pending ": " (Ожидается ",
                " (stored power covers ~": " (запасённая энергия покрывает ~",
                " - upgrading what fits.": " - улучшаем то, что помещается.",
                " NO GROW!": " БЕЗ РОСТА!",
                " cell(s), climb within ": " ячеек, подъём в пределах ",
                " credits)...": " кредитов)...",
                " didn't fully arrive - upgrading what fits.": " прибыло не полностью - улучшаем то, что помещается.",
                " done": " готово",
                " layouts (": " планировок (",
                " loaded": " загружено",
                " loading…": " загрузка…",
                " resource type": " тип ресурса",
                " row(s) of start, kicks may go further if it helps...": " строк от начала, толчки могут пойти дальше, если это поможет...",
                " sims used)...": " симуляций использовано)...",
                " sims)": " симуляций)",
                " sims, maxRepair ": " симуляций, maxRepair ",
                " tweaks (": " правок (",
                " under attack!": " под атакой!",
                "% of the batch - bringing only that much; run again as power regrows)": "% партии - доставляем только столько; запустите снова по мере восстановления энергии)",
                "&mdash; click to expand": "&mdash; нажмите, чтобы развернуть",
                "&mdash; defaults are fine": "&mdash; значения по умолчанию подходят",
                "&ndash; optional; changes what gets proposed": "&ndash; необязательно; меняет то, что предлагается",
                "(0 = auto from alliance [tir], else 10)": "(0 = авто из альянса [tir], иначе 10)",
                "(0 = auto from alliance [tir], else 6)": "(0 = авто из альянса [tir], иначе 6)",
                "(after apply) -": "(после применения) -",
                "(continuous /h):": "(непрерывно /ч):",
                "(no force-sellable buildings on this base)": "(на этой базе нет зданий для принудительной продажи)",
                "(no members online)": "(нет участников онлайн)",
                "(nothing to show - try the 'Show' filter, e.g. 'All candidates')": "(нечего показать - попробуйте фильтр 'Показать', например 'Все кандидаты')",
                "(open or select a base)": "(откройте или выберите базу)",
                "(refreshing...)": "(обновление...)",
                "(target)": "(цель)",
                "(via transfers)": "(через переводы)",
                "): step ": "): шаг ",
                "+ apply": "+ применить",
                "+ building": "+ здание",
                ", best enemy ": ", лучший враг ",
                ", fee ~": ", комиссия ~",
                "/1d": "/1д",
                "1 &middot; Pick a base, then a resource to maximize": "1 &middot; Выберите базу, затем ресурс для максимизации",
                "1 = a unit may only move ONE cell up/down/left/right per try. After an improvement the search re-bases on the new position and steps again, so larger overall moves still build up across rounds.": "1 = юнит может сдвинуться только на ОДНУ клетку вверх/вниз/влево/вправо за попытку. После улучшения поиск отталкивается от новой позиции и делает шаг снова, поэтому более крупные суммарные перемещения всё равно накапливаются за раунды.",
                "1 wave": "1 волна",
                "1st-OFF": "1-я ОФФ",
                "2 &middot; Selling": "2 &middot; Продажа",
                "2 waves": "2 волны",
                "2nd run": "2-й заход",
                "2nd-OFF": "2-я ОФФ",
                "3 waves": "3 волны",
                "3rd run": "3-й заход",
                "4 waves": "4 волны",
                "5+ waves": "5+ волн",
                ": exploring a new region, ": ": исследуем новый регион, ",
                ": trying ": ": пробуем ",
                "<b style='color:#5fe0f5'>Force-sell</b> &ndash; just <b>check</b> the “one-of” buildings you'll sacrifice (count is automatic &ndash; you do <b>not</b> need “Sell up to”). Their pooled refund funds new producers of the chosen resource. Works regardless of “Allow reductions”. (Economy/duplicate buildings: use “Sell up to” instead.)": "<b style='color:#5fe0f5'>Принудительная продажа</b> &ndash; просто <b>отметьте</b> уникальные здания, которыми пожертвуете (количество определяется автоматически &ndash; <b>не</b> нужно «Продать до»). Их совокупный возврат финансирует новых производителей выбранного ресурса. Работает независимо от «Разрешить ухудшения». (Экономические/дублирующие здания: используйте «Продать до».)",
                "<b>Force-sell special buildings</b> &ndash; reveals a checklist of the base's 'one-of' buildings (Defense HQ/Facility, Command Center, etc.). Sacrifices the checked ones and fills the freed tiles with the best new producers (early-game strip-to-CY). Apply does demolish &rarr; move &rarr; build &rarr; upgrade automatically.": "<b>Принудительная продажа особых зданий</b> &ndash; открывает список уникальных зданий базы (Штаб/Объект обороны, Командный центр и т.д.). Жертвует отмеченными и заполняет освободившиеся клетки лучшими новыми производителями (ранняя зачистка до CY). Применение автоматически выполняет снос &rarr; перемещение &rarr; строительство &rarr; улучшение.",
                "<b>Kicks</b> &ndash; random shake-ups to escape a 'good-but-not-best' layout.": "<b>Толчки</b> &ndash; случайные встряски, чтобы выйти из планировки «хорошей, но не лучшей».",
                "<b>Neighbors</b> &ndash; candidate destination tiles tested per building each pass.": "<b>Соседи</b> &ndash; число клеток-кандидатов, проверяемых для каждого здания за проход.",
                "<b>Rounds</b> &ndash; improvement passes per attempt (higher = more thorough, slower).": "<b>Раунды</b> &ndash; проходы улучшения за попытку (больше = тщательнее, медленнее).",
                "<b>Sell up to N</b> &ndash; the MOST low-impact economy buildings the optimizer may demolish to make room. For each one it sells, it builds a new producer of the chosen resource in the freed tile, paid for by that building's 90% demolish refund (your stored resources are untouched). It's a ceiling, not a quota: it sells only as many as actually help and stops early. Each <span style='color:#ff8a8a'>&times; red sell tile</span> is paired with a <span style='color:#4dd0e1'>&#43; cyan build tile</span> in the results list (\"paid for by selling &hellip;\"). With <b>Allow reductions</b> on it may also trade a little of another resource (e.g. sell an Accumulator for Power) when that yields a bigger gain in the one you picked.": "<b>Продать до N</b> &ndash; максимальное число наименее значимых экономических зданий, которые оптимизатор может снести для освобождения места. За каждое проданное он строит нового производителя выбранного ресурса на освободившейся клетке, оплачивая это 90% возвратом за снос (ваши запасённые ресурсы не трогаются). Это потолок, а не квота: продаёт лишь столько, сколько реально помогает, и останавливается раньше. Каждая <span style='color:#ff8a8a'>&times; красная клетка продажи</span> сопряжена с <span style='color:#4dd0e1'>&#43; голубой клеткой строительства</span> в списке результатов («оплачено продажей &hellip;»). При включённом <b>Разрешить ухудшения</b> может также немного пожертвовать другим ресурсом (например, продать Аккумулятор ради Энергии), когда это даёт больший прирост выбранного.",
                "<i>A ceiling, not a quota &mdash; the optimizer sells only as many as actually help, and builds a producer in each freed tile paid for by that building's 90% demolish refund. Your stored resources are untouched.</i>": "<i>Это потолок, а не квота &mdash; оптимизатор продаёт лишь столько, сколько реально помогает, и строит производителя на каждой освободившейся клетке за счёт 90% возврата за снос этого здания. Ваши запасённые ресурсы не трогаются.</i>",
                "<i>Tip: after applying, run <b>Upgrade Priority</b> (Transfer as needed) to push further using other bases.</i>": "<i>Совет: после применения запустите <b>Приоритет улучшений</b> (Переводить при необходимости), чтобы продвинуться дальше за счёт других баз.</i>",
                "Account Creation": "Создание аккаунта",
                "Action": "Действие",
                "Affordable in about": "Доступно примерно через",
                "After": "После",
                "Aircraft Repairtime": "Время ремонта авиации",
                "Alert me when one of my bases is attacked:": "Оповещать меня при атаке на одну из моих баз:",
                "All Bases": "Все базы",
                "All Bases Overview": "Обзор всех баз",
                "All army units": "Все армейские юниты",
                "All buildings": "Все здания",
                "All defense units": "Все оборонительные юниты",
                "Alliance Bonus": "Бонус альянса",
                "Alliance Role": "Роль в альянсе",
                "Alliance bases": "Базы альянса",
                "Alliance bases (blue)": "Базы альянса (синие)",
                "Allow reductions": "Разрешить ухудшения",
                "Applied": "Применено",
                "Applied cheapest winning layout (lowest max repair time).": "Применена самая дешёвая выигрышная планировка (наименьшее макс. время ремонта).",
                "Apply": "Применить",
                "Apply layout changes?": "Применить изменения планировки?",
                "Apply to base": "Применить к базе",
                "Applying": "Применение",
                "Applying&hellip;": "Применение&hellip;",
                "Attack Alert": "Оповещение об атаке",
                "Attack Range": "Радиус атаки",
                "Attack loot data unavailable": "Данные о добыче с атаки недоступны",
                "Auto-collect / auto-repair": "Авто-сбор / авто-ремонт",
                "Auto-collect packages": "Авто-сбор посылок",
                "Auto-repair buildings": "Авто-ремонт зданий",
                "Auto-repair by priority + ROI": "Авто-ремонт по приоритету + ROI",
                "Auto-repair units": "Авто-ремонт юнитов",
                "Auto-try several army layouts and apply the WINNING layout (enemy destroyed) with the lowest repair time.": "Автоматически перебрать несколько армейских расстановок и применить ПОБЕДНУЮ расстановку (враг уничтожен) с наименьшим временем ремонта.",
                "Auto-try several army layouts to DESTROY the enemy Defense Facility (DF): applies the layout that gets DF health as close to 0 as possible, then the lowest max repair time.": "Автоматически перебрать несколько армейских расстановок, чтобы УНИЧТОЖИТЬ вражеский Оборонительный объект (DF): применяется расстановка, которая снижает здоровье DF как можно ближе к 0, а затем имеет наименьшее максимальное время ремонта.",
                "Auto-try several layouts and apply the winning layout with the lowest repair time. (or call window.MikeyMike_OptimizeRepair())": "Автоматически перебрать несколько расстановок и применить победную расстановку с наименьшим временем ремонта. (или вызвать window.MikeyMike_OptimizeRepair())",
                "Auto-try several layouts to destroy the Defense Facility: applies the layout with DF closest to 0, then lowest max repair time. (or call window.MikeyMike_OptimizeDF0())": "Автоматически перебрать несколько расстановок, чтобы уничтожить Оборонительный объект: применяется расстановка с DF, наиболее близким к 0, а затем с наименьшим максимальным временем ремонта. (или вызвать window.MikeyMike_OptimizeDF0())",
                "BUILD NEW": "ПОСТРОИТЬ НОВОЕ",
                "Base": "База",
                "Base Level": "Уровень базы",
                "Base Name": "Basename",
                "Base Scanner": "Сканер базы",
                "Base Tools": "Инструменты базы",
                "Base layout": "Планировка базы",
                "Base:": "База:",
                "Basecount": "Число баз",
                "Bases": "Базы",
                "Bases with collectable packages:": "Базы с собираемыми посылками:",
                "Battle Simulator V2": "Симулятор боя V2",
                "Before": "До",
                "Best (highest) defense level": "Лучший (наивысший) уровень обороны",
                "Best (highest) offense/army unit level": "Лучший (наивысший) уровень атаки/армейского юнита",
                "Best DF 0": "Лучший DF 0",
                "Best Win": "Лучшая победа",
                "Best so far: ": "Лучшее на данный момент: ",
                "Build": "Строить",
                "Building": "Здание",
                "Buildings": "Здания",
                "Built": "Построено",
                "CEILING on how many ECONOMY / duplicate buildings (Silo, Refinery, spare Harvester/PowerPlant/Accumulator) the optimizer may demolish to make room - it then builds a new producer of the chosen resource in EACH freed tile, paid for entirely by that building's 90% demolish refund (none of your stored resources are spent). It's a ceiling, not a quota: 'Sell up to 3' will sell 1, 2, or 3 - whatever actually raises the resource - and stops when one more sell wouldn't help. This is SEPARATE from 'Force-sell special buildings' (Defense HQ, Airport, etc.), which you pick by checking them. 0 = don't sell anything.": "ПОТОЛОК на число ЭКОНОМИЧЕСКИХ / дублирующих зданий (Силос, Очистительный завод, лишний Харвестер/Электростанция/Аккумулятор), которые оптимизатор может снести для освобождения места - затем он строит нового производителя выбранного ресурса на КАЖДОЙ освободившейся клетке, полностью оплачивая это 90% возвратом за снос здания (ни один из ваших запасённых ресурсов не тратится). Это потолок, а не квота: 'Продать до 3' продаст 1, 2 или 3 - сколько реально повышает ресурс - и остановится, когда ещё одна продажа не поможет. Это ОТДЕЛЬНО от 'Принудительной продажи особых зданий' (Штаб обороны, Аэропорт и т.д.), которые вы выбираете отметкой. 0 = ничего не продавать.",
                "CY row": "ряд CY",
                "Calculating attack loot...": "Расчёт добычи с атаки...",
                "Camp": "Лагерь",
                "Camps": "Лагеря",
                "Can't apply:": "Невозможно применить:",
                "Can't be upgraded right now": "Сейчас невозможно улучшить",
                "Cancel": "Отмена",
                "City": "Город",
                "Click Refresh to recompute the list.": "Нажмите Обновить, чтобы пересчитать список.",
                "Click a base or camp on the map.": "Нажмите на базу или лагерь на карте.",
                "Click a column header to sort (try 'Xfer $' for cheapest transfers).": "Нажмите на заголовок столбца для сортировки (попробуйте 'Xfer $' для самых дешёвых переводов).",
                "Click a resource above (<b>Tiberium / Crystal / Power / Credits</b>) to generate a plan, then <b>Apply to base</b> to make those changes in-game.": "Нажмите на ресурс выше (<b>Тиберий / Кристалл / Энергия / Кредиты</b>), чтобы создать план, затем <b>Применить к базе</b>, чтобы внести эти изменения в игре.",
                "Click to sort by": "Нажмите для сортировки по",
                "Click to sort by this column": "Нажмите для сортировки по этому столбцу",
                "Close": "Закрыть",
                "Collect & Repair": "Сбор и ремонт",
                "Collect All Packages": "Собрать все посылки",
                "Collect packages from every base that has them ready": "Собрать посылки со всех баз, где они готовы",
                "Collect packages on bases that have them ready": "Собрать посылки на базах, где они готовы",
                "Continuous Production": "Непрерывное производство",
                "Controls": "Управление",
                "Cooldown expiry + farmable bases in range, shown while you move a base": "Истечение кулдауна + фармабельные базы в радиусе, отображается при перемещении базы",
                "Could not find that base. Open it in-game and use 'Current base'.": "Не удалось найти эту базу. Откройте её в игре и используйте 'Текущая база'.",
                "Could not optimize:": "Не удалось оптимизировать:",
                "Couldn't load that target.": "Не удалось загрузить эту цель.",
                "Couldn't read that target.": "Не удалось прочитать эту цель.",
                "Credit": "Кредит",
                "Credit Production": "Производство кредитов",
                "Credits": "Кредиты",
                "Credits  ": "Кредиты  ",
                "Credits  NoGrow": "Кредиты  БезРоста",
                "Credits  OK!": "Кредиты  OK!",
                "Credits ($)": "Кредиты ($)",
                "Crystal": "Кристалл",
                "Crystal Harvester": "Харвестер кристалла",
                "Crystal Production": "Производство кристалла",
                "Current Base": "Текущая база",
                "Current Time": "Текущее время",
                "Current base": "Текущая база",
                "Current layout": "Текущая планировка",
                "DF can't be fully destroyed; applied closest-to-0 DF layout with lowest max repair time.": "DF нельзя полностью уничтожить; применена планировка с DF ближайшим к 0 и наименьшим макс. временем ремонта.",
                "DF destroyed (DF=0); applied lowest max repair time layout.": "DF уничтожен (DF=0); применена планировка с наименьшим макс. временем ремонта.",
                "DF row": "ряд DF",
                "DF Ø all Bases": "DF Ø всех баз",
                "Def Ø all Bases": "Def Ø всех баз",
                "Defaults restored - press Save to apply.": "Значения по умолчанию восстановлены — нажмите Сохранить, чтобы применить.",
                "Defense": "Оборона",
                "Defense Level": "Уровень обороны",
                "Defensive Level": "Оборонительный уровень",
                "Delta": "Дельта",
                "Demolish": "Снести",
                "Demolish + build + apply": "Снести + построить + применить",
                "Demolished": "Снесено",
                "Dock in game menu bar": "Закрепить в строке игрового меню",
                "Don't move a unit back to the cell it just left": "Не возвращать юнит в клетку, которую он только что покинул",
                "Done.": "Готово.",
                "Done. ": "Готово. ",
                "Down": "Вниз",
                "Enables/Disables all aircrafts.": "Включает/отключает всю авиацию.",
                "Enables/Disables all infantry units.": "Включает/отключает всю пехоту.",
                "Enables/Disables all units.": "Включает/отключает все юниты.",
                "Enables/Disables all vehicles.": "Включает/отключает всю технику.",
                "Enemy bases": "Вражеские базы",
                "Enter CNCTAOpt Long Link:": "Введите длинную ссылку CNCTAOpt:",
                "Enumerating…": "Перечисление…",
                "Error saving: ": "Ошибка сохранения: ",
                "FAILED": "СБОЙ",
                "Farmable NPC bases in attack range (+ levels + wave estimate)": "Фармабельные NPC-базы в радиусе атаки (+ уровни + оценка волн)",
                "Field tiles tinted: <span style='color:#7ed07e'>tiberium</span> / <span style='color:#8fc0ff'>crystal</span>.": "Клетки полей подсвечены: <span style='color:#7ed07e'>тиберий</span> / <span style='color:#8fc0ff'>кристалл</span>.",
                "Figures are continuous production (packages aren't layout-dependent).": "Цифры - непрерывное производство (посылки не зависят от планировки).",
                "Finished, but could not apply layout: ": "Завершено, но не удалось применить планировку: ",
                "First Offense": "Первая атака",
                "Flash the browser-tab favicon (siren icon)": "Мигать значком вкладки браузера (иконка сирены)",
                "Flash the browser-tab title": "Мигать заголовком вкладки браузера",
                "Foe": "Враг",
                "Force-sell special buildings": "Принудительно продать особые здания",
                "Forgotten / NPC bases (green)": "Базы Забытых / NPC (зелёные)",
                "Found": "Найдено",
                "Friend": "Друг",
                "From:": "От:",
                "Gain/h": "Прирост/ч",
                "Game will reload now.": "Игра сейчас перезагрузится.",
                "General": "Общее",
                "General Information": "Общая информация",
                "Go": "Пуск",
                "Green = your offense can activate it · Red = blocked (offense too low)": "Зелёный = ваша атака может активировать · Красный = заблокировано (атака слишком низкая)",
                "HQ": "Штаб",
                "Hard cap on battle simulations per click (the main safety net).": "Жёсткий предел числа боевых симуляций за один клик (основная защита).",
                "Hard cap on climb+kick rounds for a single optimize click.": "Жёсткий предел числа раундов подъёма+толчка за один клик оптимизации.",
                "Highest first &middot; select then Up/Down to reorder": "Сначала наивысшие &middot; выберите, затем Вверх/Вниз для перестановки",
                "Highlight bases in range while moving a base": "Подсвечивать базы в радиусе при перемещении базы",
                "Highlight in move-base view:": "Подсветка в режиме перемещения базы:",
                "Hours": "Часы",
                "How many candidate destination tiles to test per building each pass. Higher = more thorough but slower.": "Сколько клеток-кандидатов проверять для каждого здания за проход. Больше = тщательнее, но медленнее.",
                "How many candidate layouts to evaluate each round. Higher = more thorough but more simulations.": "Сколько вариантов расстановок оценивать в каждом раунде. Больше = тщательнее, но больше симуляций.",
                "How many of the top rows Go will upgrade. Auto-capped to how many will actually succeed (a batch never fails), and reset to 5 (or fewer) on Refresh and whenever you toggle 'Transfer as needed'.": "Сколько верхних строк улучшит Пуск. Автоматически ограничено числом тех, что действительно пройдут (партия не даёт сбой), и сбрасывается до 5 (или меньше) при Обновлении и каждый раз при переключении 'Переводить при необходимости'.",
                "How many rows a unit may drift away from its starting row while climbing (kicks may go further if it helps).": "На сколько рядов юнит может отклониться от своего начального ряда во время подъёма (толчки могут уходить дальше, если это помогает).",
                "Improvement passes per attempt. Higher = more thorough but slower.": "Проходы улучшения за попытку. Больше = тщательнее, но медленнее.",
                "Infantry Repairtime": "Время ремонта пехоты",
                "Infected": "Заражено",
                "Info": "Инфо",
                "Interval (minutes):": "Интервал (минуты):",
                "Keep upgraded rows (clear on Refresh)": "Сохранять улучшенные строки (очищать при Обновлении)",
                "Kick ": "Толчок ",
                "Kicks:": "Толчки:",
                "Last update:": "Последнее обновление:",
                "Layout Optimizer": "Оптимизатор планировки",
                "Legend": "Легенда",
                "Levels:": "Уровни:",
                "Loading...": "Загрузка...",
                "Loc": "Локация",
                "Loot + levels of the base you click on the map": "Добыча + уровни базы, на которую вы нажали на карте",
                "Loot Info": "Инфо о добыче",
                "Loot Summary": "Сводка добычи",
                "Lootable resources": "Захватываемые ресурсы",
                "Lvl": "Ур",
                "Lvl≥": "Ур≥",
                "MM - Base Scanner": "MM - Сканер баз",
                "Master: enable Attack Alert": "Главное: включить оповещение об атаке",
                "Master: enable the move-panel readout": "Главное: включить показания панели перемещения",
                "Master: enable the range overlay": "Главное: включить наложение радиуса",
                "Master: enable the tunnel overlay": "Главное: включить наложение туннелей",
                "Master: show the overlay at all": "Главный: показывать наложение целиком",
                "Max bases": "Макс. баз",
                "Max bases founded": "Макс. основано баз",
                "Max fruitless kicks": "Макс. безрезультатных толчков",
                "Max rounds per click": "Макс. раундов за клик",
                "Max row drift from start": "Макс. отклонение ряда от начала",
                "Max simulations per click": "Макс. симуляций за клик",
                "Max step (cells per move)": "Макс. шаг (клеток за перемещение)",
                "Maximal CP": "Максимальный CP",
                "Maximal Reptime": "Максимальное время ремонта",
                "Member": "Участник",
                "Member Status": "Статус участников",
                "Members": "Участники",
                "Mirrors units horizontally.": "Зеркально отражает юниты по горизонтали.",
                "Mirrors units vertically.": "Зеркально отражает юниты по вертикали.",
                "Morale": "Боевой дух",
                "Move": "Переместить",
                "Move (and, if proposed, demolish) buildings in-game to match the proposed layout. Shows a confirmation with exactly what will change first.": "Переместить (и, если предложено, снести) здания в игре для соответствия предложенной планировке. Сначала показывает подтверждение с точным перечнем изменений.",
                "Move Info": "Инфо о перемещении",
                "Move ready:": "Перемещение готово:",
                "Move-cooldown expiry time (when the spot is free to move into)": "Время истечения кулдауна перемещения (когда место свободно для въезда)",
                "Moved": "Перемещено",
                "Movement": "Перемещение",
                "Moves": "Перемещения",
                "Moves (0)": "Перемещения (0)",
                "NPC bases in range:": "NPC-базы в радиусе:",
                "Needs a Tiberium transfer": "Требуется перевод тиберия",
                "Neighbors:": "Соседи:",
                "Net production change (continuous /h)": "Чистое изменение производства (непрерывно /ч)",
                "Neutral": "Нейтральный",
                "Neutral bases (peace/NAP)": "Нейтральные базы (мир/ПНА)",
                "Next MCV": "Следующий MCV",
                "No alliance": "Нет альянса",
                "No army units found to optimize.": "Не найдено армейских юнитов для оптимизации.",
                "No layout found; restored original.": "Планировка не найдена; восстановлена исходная.",
                "No loot data for this object": "Нет данных о добыче для этого объекта",
                "No moves improve": "Ни одно перемещение не улучшает",
                "No transferable resources within your credit budget": "Нет ресурсов для перевода в рамках вашего бюджета кредитов",
                "No winning layout found (enemy can't be destroyed) - try 'Best DF 0'. Restored original.": "Выигрышная планировка не найдена (врага нельзя уничтожить) - попробуйте 'Best DF 0'. Восстановлена исходная.",
                "NoGrow": "БезРоста",
                "None": "Нет",
                "Note: build &amp; upgrade are queued as game commands; the new building appears immediately and upgrades complete over time. Make sure the demolition refund covers the cost.": "Примечание: строительство и улучшение ставятся в очередь как игровые команды; новое здание появляется сразу, а улучшения завершаются со временем. Убедитесь, что возврат за снос покрывает стоимость.",
                "Nothing to apply - the base already matches the proposal.": "Нечего применять - база уже соответствует предложению.",
                "Nothing to upgrade right now - not enough resources (or credits for the transfer fees).": "Сейчас нечего улучшать - недостаточно ресурсов (или кредитов на комиссии за перевод).",
                "Nothing to upgrade without transfers - tick \"Transfer as needed\" to allow them, or wait for this base to produce more Tiberium.": "Нечего улучшить без переводов - отметьте \"Переводить при необходимости\", чтобы разрешить их, или дождитесь, пока эта база произведёт больше тиберия.",
                "Numbers match the grid.": "Числа соответствуют сетке.",
                "Numbers match the grid. Click <b>Apply to base</b> above to make these changes in-game (you'll get a confirmation first), or do them by hand in move mode.": "Числа соответствуют сетке. Нажмите <b>Применить к базе</b> выше, чтобы внести эти изменения в игре (сначала вы получите подтверждение), или сделайте их вручную в режиме перемещения.",
                "OFF (default): only suggest moves that improve the chosen resource without hurting the others. Strict but limited - a swap that's blocked by, say, a Refinery in the way is never considered.\n\nON: widen the search to ALL resource buildings and let the optimizer trade small losses in other resources for a larger target gain (score = target_gain - 0.5 * sum_of_other_losses). The results panel shows the net change for all 4 resources so you can see exactly what's being traded.": "ВЫКЛ (по умолчанию): предлагать только перемещения, улучшающие выбранный ресурс без ущерба остальным. Строго, но ограниченно - перестановка, заблокированная, скажем, Очистительным заводом на пути, никогда не рассматривается.\n\nВКЛ: расширить поиск на ВСЕ ресурсные здания и позволить оптимизатору обменивать небольшие потери в других ресурсах на больший прирост целевого (оценка = прирост_цели - 0.5 * сумма_прочих_потерь). Панель результатов показывает чистое изменение по всем 4 ресурсам, чтобы вы видели точно, чем жертвуете.",
                "Off/Def Bubbles": "Пузыри Off/Def",
                "Offense": "Атака",
                "Offense Bases Count": "Число баз атаки",
                "Offense Level": "Уровень атаки",
                "Offense Level:": "Уровень атаки:",
                "On-grid overlay (Ctrl-hold)": "Наложение на сетку (удержание Ctrl)",
                "On-map off/def bubbles (enemy / alliance / own)": "Пузыри off/def на карте (враг / альянс / свои)",
                "On: upgraded rows stay marked '✓ Upgraded' until you Refresh.\nOff: each row vanishes the instant its upgrade succeeds (the classic behavior).": "Вкл: улучшенные строки остаются помеченными '✓ Улучшено' до Обновления.\nВыкл: каждая строка исчезает в момент успешного улучшения (классическое поведение).",
                "Only alarm while the game tab is in the background": "Сигнализировать только когда вкладка игры в фоне",
                "Open an attack (combat setup) on a target first.": "Сначала откройте атаку (настройку боя) по цели.",
                "Open this base": "Открыть эту базу",
                "Optimize this base's layout to maximize": "Оптимизировать планировку этой базы для максимизации",
                "Optimizer Options": "Параметры оптимизатора",
                "Optimizer already running...": "Оптимизатор уже работает...",
                "Optimizer stopped by user.": "Оптимизатор остановлен пользователем.",
                "Optimizing": "Оптимизация",
                "Optimizing (": "Оптимизация (",
                "Origin base not loaded": "База-источник не загружена",
                "Other players' bases (orange)": "Базы других игроков (оранжевые)",
                "Outpost": "Аванпост",
                "Outposts": "Аванпосты",
                "Own bases": "Свои базы",
                "Package Production": "Производство посылок",
                "Pick an origin base": "Выберите базу-источник",
                "Pin into the game menu / unpin to a movable panel": "Закрепить в игровом меню / открепить в перемещаемую панель",
                "Plan level up": "Запланировать повышение уровня",
                "Plan move base": "Запланировать перемещение базы",
                "Plan remove": "Запланировать удаление",
                "Plan ruin": "Запланировать разрушение",
                "Plan ruin for": "Запланировать разрушение для",
                "Play an alarm sound": "Воспроизводить звук сигнала",
                "Player": "Игрок",
                "Player Class": "Класс игрока",
                "Player Name": "Имя игрока",
                "Players": "Игроки",
                "Players Production": "Производство игроков",
                "Pooled refund": "Совокупный возврат",
                "Possible attacks from this base (available CP):": "Возможные атаки с этой базы (доступный CP):",
                "Pow cost": "Затраты энергии",
                "Pow on builds+upgrades.": "Энергия на строительство+улучшения.",
                "Pow/gain": "Энергия/прирост",
                "Power": "Энергия",
                "Power Produktion": "Производство энергии",
                "Preset": "Пресет",
                "Prevents a unit bouncing back and forth between the same two cells.": "Не даёт юниту метаться туда-сюда между одними и теми же двумя клетками.",
                "Preview the siren / title / favicon (click once to allow sound).": "Предпросмотр сирены / заголовка / значка (нажмите один раз для разрешения звука).",
                "Priority Setup": "Настройка приоритетов",
                "Processed": "Обработано",
                "Production": "Производство",
                "Proposed layout": "Предложенная планировка",
                "Pull the missing Tiberium from your other bases (cheapest first), then upgrade.\nTransfer fee:": "Подтянуть недостающий тиберий с других ваших баз (сначала самые дешёвые), затем улучшить.\nКомиссия за перевод:",
                "Random shake-ups to escape a 'good but not best' layout and explore a different arrangement. More = explores more but slower.": "Случайные встряски, чтобы выйти из планировки «хорошей, но не лучшей» и исследовать иное расположение. Больше = исследует больше, но медленнее.",
                "Range override:": "Переопределение радиуса:",
                "Rank": "Ранг",
                "Re-reading base&hellip;": "Перечитывание базы&hellip;",
                "Real gain:": "Реальный прирост:",
                "Real loss:": "Реальная потеря:",
                "Recompute the list (clears the '✓ Upgraded' marks and rescans every base)": "Пересчитать список (очищает метки '✓ Улучшено' и пересканирует все базы)",
                "Recompute the table from the current game state": "Пересчитать таблицу из текущего состояния игры",
                "Refresh": "Обновить",
                "Region map": "Карта региона",
                "Relative chance of trying a horizontal (left/right) move. Higher = more likely to be picked.": "Относительная вероятность попытки горизонтального (влево/вправо) перемещения. Больше = выше шанс быть выбранным.",
                "Relative chance of trying a vertical (up/down) move. Keep below the left/right weight to favour horizontal changes (e.g. 0.75).": "Относительная вероятность попытки вертикального (вверх/вниз) перемещения. Держите ниже веса влево/вправо, чтобы отдавать предпочтение горизонтальным изменениям (например, 0.75).",
                "Remember transported units are not supported.": "Помните, что перевозимые юниты не поддерживаются.",
                "Repair All Buildings": "Отремонтировать все здания",
                "Repair All Units": "Отремонтировать все юниты",
                "Repair buildings (where allowed) across every base": "Ремонтировать здания (где разрешено) на всех базах",
                "Repair buildings on bases where repair is available": "Ремонтировать здания на базах, где ремонт доступен",
                "Repair units across every base": "Ремонтировать юниты на всех базах",
                "Repair units on bases where repair is available": "Ремонтировать юниты на базах, где ремонт доступен",
                "Required Level:": "Требуемый уровень:",
                "Res": "Рес",
                "Reset": "Сбросить",
                "Reset Defaults": "Сбросить по умолчанию",
                "Reset Formation": "Сбросить формацию",
                "Reset plans": "Сбросить планы",
                "Reset to default": "Сбросить по умолчанию",
                "Resource": "Ресурс",
                "Resource:": "Ресурс:",
                "Reveals a checklist of the 'one-of' special buildings on this base (Defense HQ/Facility, Command Center, Barracks, Factory, Airport, Support). Check any you're willing to sacrifice; the optimizer demolishes them, pools their 90% refund, and fills the freed tiles with the best new producers of the chosen resource (early-game 'strip to the Construction Yard' play).\n\nYou do NOT need this for the normal case: with 'Sell up to' >= 1 and 'Allow reductions' on, the optimizer already auto-considers selling an economy building (e.g. a Silo) and building a producer (e.g. an Accumulator) in its place.": "Открывает список уникальных особых зданий на этой базе (Штаб/Объект обороны, Командный центр, Казармы, Завод, Аэропорт, Поддержка). Отметьте те, которыми готовы пожертвовать; оптимизатор снесёт их, объединит их 90% возврат и заполнит освободившиеся клетки лучшими новыми производителями выбранного ресурса (ранняя стратегия «зачистка до Строительного двора»).\n\nДля обычного случая это НЕ нужно: при 'Продать до' >= 1 и включённом 'Разрешить ухудшения' оптимизатор уже автоматически рассматривает продажу экономического здания (например, Силоса) и строительство производителя (например, Аккумулятора) на его месте.",
                "Right click: Set formation from CNCTAOpt Long Link": "Правый клик: задать формацию из длинной ссылки CNCTAOpt",
                "Round ": "Раунд ",
                "Round tweaks: ": "Правки раунда: ",
                "Rounds:": "Раунды:",
                "Rule Out": "Исключить",
                "Run periodically across every base. Off by default for units to avoid surprise resource spend.": "Выполнять периодически на всех базах. Для юнитов выключено по умолчанию во избежание неожиданных трат ресурсов.",
                "SELL": "ПРОДАТЬ",
                "Save": "Сохранить",
                "Save/Load Formation [NUM ,]": "Сохранить/Загрузить формацию [NUM ,]",
                "Saved - applies on the next optimize click.": "Сохранено — применится при следующем клике оптимизации.",
                "Scan": "Сканировать",
                "Scan attackable bases near one of your bases": "Сканировать атакуемые базы рядом с одной из ваших баз",
                "Scanning…": "Сканирование…",
                "Search Budget": "Бюджет поиска",
                "Search quality (advanced)": "Качество поиска (расширенно)",
                "Second Offense": "Вторая атака",
                "Select at least one type": "Выберите хотя бы один тип",
                "Selected army unit": "Выбранный армейский юнит",
                "Selected building": "Выбранное здание",
                "Selected defense unit": "Выбранный оборонительный юнит",
                "Self-funded plan:": "Самофинансируемый план:",
                "Sell": "Продать",
                "Sell up to:": "Продать до:",
                "Server Language": "Язык сервера",
                "Set error: ": "Ошибка установки: ",
                "Settings": "Настройки",
                "Shifts units one space down.": "Сдвигает юниты на одну клетку вниз.",
                "Shifts units one space left.": "Сдвигает юниты на одну клетку влево.",
                "Shifts units one space right.": "Сдвигает юниты на одну клетку вправо.",
                "Shifts units one space up.": "Сдвигает юниты на одну клетку вверх.",
                "Show attack loot summary in region base popups": "Показывать сводку добычи с атаки во всплывающих окнах баз региона",
                "Show current formation with CNCTAOpt": "Показать текущую формацию через CNCTAOpt",
                "Show the Offense / Required level readout in the move panel": "Показывать данные уровня Атаки / Требуемого в панели перемещения",
                "Show the off/def map bubble for:": "Показывать пузырь off/def на карте для:",
                "Show which tunnels you can activate while moving a base": "Показывать, какие туннели можно активировать при перемещении базы",
                "Show:": "Показать:",
                "Sim result error: ": "Ошибка результата симуляции: ",
                "Sim send error: ": "Ошибка отправки симуляции: ",
                "Skip Victory-Popup After Battle": "Пропускать всплывающее окно победы после боя",
                "Skipped": "Пропущено",
                "Staged": "Размещено",
                "Statistic": "Статистика",
                "Stop": "Стоп",
                "Stop after this many random jumps in a row that find no improvement.": "Остановиться после такого количества случайных прыжков подряд, не давших улучшения.",
                "Stopped - ": "Остановлено - ",
                "Stopped at": "Остановлено на",
                "Stopped. ": "Остановлено. ",
                "Stored resources": "Запасённые ресурсы",
                "Sum": "Сумма",
                "Sum/CP": "Сумма/CP",
                "Support": "Поддержка",
                "Support Building Level Ø": "Уровень зданий поддержки Ø",
                "Support row": "ряд поддержки",
                "Swaps lines 1 & 2.": "Меняет местами линии 1 и 2.",
                "Swaps lines 2 & 3.": "Меняет местами линии 2 и 3.",
                "Swaps lines 3 & 4.": "Меняет местами линии 3 и 4.",
                "TEST": "ТЕСТ",
                "Target": "Цель",
                "Target out of range, no attack-loot calculation possible": "Цель вне радиуса, расчёт добычи с атаки невозможен",
                "Test alarm": "Проверить сигнал",
                "Tib cost": "Затраты тиберия",
                "Tib/gain": "Тиберий/прирост",
                "Tiberium": "Тиберий",
                "Tiberium Harvester": "Харвестер тиберия",
                "Tiberium Production": "Производство тиберия",
                "Tick \"Transfer as needed\" above to allow it.": "Отметьте \"Переводить при необходимости\" выше, чтобы разрешить это.",
                "Tiles show each building's icon + its <b>level</b> (corner).": "Клетки показывают иконку каждого здания + его <b>уровень</b> (в углу).",
                "Time/resources until your next base (MCV)": "Время/ресурсы до вашей следующей базы (MCV)",
                "Toggle the Base Tools window": "Переключить окно Инструментов базы",
                "Toggle the Member Status display": "Переключить отображение статуса участников",
                "Total / BaseLevel": "Всего / Уровень базы",
                "Total / h": "Всего / ч",
                "Total Crystal Production": "Общее производство кристалла",
                "Total Power Production": "Общее производство энергии",
                "Total Production": "Общее производство",
                "Total Tiberium Production": "Общее производство тиберия",
                "Transfer + upgrade": "Перевести + улучшить",
                "Transfer as needed": "Переводить при необходимости",
                "Transferred all available - upgrading as many as fit.": "Переведено всё доступное - улучшаем столько, сколько помещается.",
                "Transferring max available (": "Перевод максимально доступного (",
                "Transfers complete - upgrading.": "Переводы завершены - улучшаем.",
                "Tune how the auto-optimizer searches layouts: step size, left/right vs up/down weighting, row drift and search budgets.": "Настройте, как авто-оптимизатор ищет расстановки: размер шага, веса влево/вправо относительно вверх/вниз, отклонение ряда и бюджеты поиска.",
                "Tunnel Info": "Инфо о туннелях",
                "Tweaks tried per round": "Корректировок за раунд",
                "Type": "Тип",
                "Undo": "Отменить",
                "Up": "Вверх",
                "Upgrade": "Улучшить",
                "Upgrade Priority": "Приоритет улучшений",
                "Upgrade the top N rows in the list below (in the current sort order). Re-validates each row before firing it so resource drains from earlier rows are accounted for; if 'Transfer as needed' is on, will transfer Tiberium in from other bases when the local base is short.": "Улучшить верхние N строк в списке ниже (в текущем порядке сортировки). Перепроверяет каждую строку перед запуском, чтобы учесть расход ресурсов из предыдущих строк; если 'Переводить при необходимости' включено, переведёт тиберий с других баз, когда локальной базе не хватает.",
                "Upgrade this building now": "Улучшить это здание сейчас",
                "Upgrade top": "Улучшить верхние",
                "Upgrade: Base": "Улучшить: База",
                "Upgrade: Defense": "Улучшить: Оборона",
                "Upgrade: Offense": "Улучшить: Атака",
                "Upgraded": "Улучшено",
                "Upgrading": "Улучшение",
                "Use floating panel": "Использовать плавающую панель",
                "Vehicle Repairtime": "Время ремонта техники",
                "View Simulation": "Просмотреть симуляцию",
                "Warn me (sound + tab title + favicon) when a base is under attack": "Предупреждать меня (звук + заголовок вкладки + значок) при атаке на базу",
                "Weight: left/right moves": "Вес: перемещения влево/вправо",
                "Weight: up/down moves": "Вес: перемещения вверх/вниз",
                "When a row in the batch would otherwise fail because the local base is short on Tiberium, transfer from your other bases (cheapest first) before upgrading. Skipped if no transfer plan covers the gap or you can't afford the transfer fee. Off by default - transfers cost credits.": "Когда строка в партии иначе не прошла бы из-за нехватки тиберия на локальной базе, перевести с других ваших баз (сначала самые дешёвые) перед улучшением. Пропускается, если ни один план перевода не покрывает дефицит или вам не по карману комиссия за перевод. Выключено по умолчанию - переводы стоят кредитов.",
                "When on, hold Ctrl while viewing your own base to see a translucent gain/cost overlay on each resource-producing tile (Harvester, Silo, PowerPlant, Accumulator, Refinery). Best = green, worst = red, label is the ratio. Release Ctrl to hide. Salvaged from xTr1m's Base Overlay (retired).": "Когда включено, удерживайте Ctrl при просмотре своей базы, чтобы увидеть полупрозрачное наложение прироста/затрат на каждой ресурсопроизводящей клетке (Харвестер, Силос, Электростанция, Аккумулятор, Очистительный завод). Лучшее = зелёный, худшее = красный, метка - это соотношение. Отпустите Ctrl, чтобы скрыть. Восстановлено из Base Overlay от xTr1m (изъято).",
                "When on, opening the info popup for any non-own base on the region map (camp / outpost / forgotten / enemy player) appends a quick loot summary: 'Possible attacks (available CP)', 'Lootable resources', 'per CP', '2nd run' and '3rd run' breakdowns of Tiberium / Crystal / Credits / Research Points - so you can pick the best farm/attack target without opening each base's attack screen.": "Когда включено, открытие всплывающего окна информации для любой не своей базы на карте региона (лагерь / аванпост / забытая / вражеский игрок) добавляет краткую сводку добычи: 'Возможные атаки (доступный CP)', 'Захватываемые ресурсы', 'на CP', разбивки '2-й заход' и '3-й заход' по Тиберию / Кристаллу / Кредитам / Очкам исследований - чтобы вы могли выбрать лучшую цель для фарма/атаки без открытия экрана атаки каждой базы.",
                "When on, the auto-repair tick walks the priority list below and ROI-sorts damaged buildings within each tier. Off = call the game's RepairAll in its default order.": "Когда включено, тик авто-ремонта проходит по списку приоритетов ниже и сортирует повреждённые здания по ROI внутри каждого уровня. Выключено = вызов игрового RepairAll в порядке по умолчанию.",
                "When the current base lacks Tiberium or Crystal for an upgrade, transfer the shortfall in from your other bases (cheapest first) before firing the upgrade. Power isn't transferable - those shortages still fall through. Off by default (transfers cost credits).": "Когда текущей базе не хватает тиберия или кристалла для улучшения, перевести дефицит с других ваших баз (сначала самые дешёвые) перед запуском улучшения. Энергия не переводится - такая нехватка по-прежнему остаётся. Выключено по умолчанию (переводы стоят кредитов).",
                "Which RESOURCE this upgrade boosts (Tib / Cry / Pow / $=Credits). The building type itself is in the Building column.": "Какой РЕСУРС усиливает это улучшение (Tib / Cry / Pow / $=Кредиты). Сам тип здания указан в столбце Здание.",
                "While moving a base, add to the move panel:": "При перемещении базы добавлять в панель перемещения:",
                "While moving a base, show tunnel activation:": "При перемещении базы показывать активацию туннелей:",
                "Works on its OWN, but the upgrades above drain this base first - it will FAIL if you batch them with Go. Lower 'Upgrade top', or click this row by itself.": "Работает ОТДЕЛЬНО, но улучшения выше сначала истощают эту базу - оно ДАСТ СБОЙ, если объединить их через Пуск. Уменьшите 'Улучшить верхние' или нажмите на эту строку отдельно.",
                "[allow reductions: ON]": "[разрешить ухудшения: ВКЛ]",
                "a base": "база",
                "a move target is blocked by a fixed building - re-run the optimizer": "цель перемещения заблокирована фиксированным зданием - перезапустите оптимизатор",
                "all bases": "все базы",
                "allowing reductions": "разрешая ухудшения",
                "and spend the 90% demolish refund to build": "и потратить 90% возврат за снос на строительство",
                "at": "в",
                "at ": "в ",
                "auto-build": "авто-строительство",
                "base drained by the upgrades above": "база истощена улучшениями выше",
                "base is locked": "база заблокирована",
                "base unavailable": "база недоступна",
                "best DF=0": "лучший DF=0",
                "best win": "лучший выигрыш",
                "blocked": "заблокировано",
                "build manager unavailable": "менеджер строительства недоступен",
                "build tile is occupied": "клетка строительства занята",
                "build(s)": "построек",
                "building": "здание",
                "building not found": "здание не найдено",
                "building to upgrade not found": "здание для улучшения не найдено",
                "buildings": "здания",
                "buildings to repair:": "здания для ремонта:",
                "can't afford transfer fee": "не по карману комиссия за перевод",
                "candidate(s),": "кандидатов,",
                "change(s)": "изменений",
                "could not read base layout": "не удалось прочитать планировку базы",
                "could not read the base": "не удалось прочитать базу",
                "could not read the build-cost API (game may have updated)": "не удалось прочитать API стоимости строительства (игра могла обновиться)",
                "couldn't sequence all moves automatically - apply by hand in move mode": "не удалось автоматически упорядочить все перемещения - примените вручную в режиме перемещения",
                "couldn't sequence the moves automatically (no free staging tile) - apply by hand in move mode": "не удалось автоматически упорядочить перемещения (нет свободной промежуточной клетки) - примените вручную в режиме перемещения",
                "credits": "кредиты",
                "credits.": "кредиты.",
                "cyan tile = <b>build new</b> building here (self-funded by a sell's refund).": "голубая клетка = <b>построить новое</b> здание здесь (самофинансируется возвратом от продажи).",
                "demolish": "снести",
                "demolished": "снесено",
                "demolition(s)": "сносов",
                "done": "готово",
                "enemy ": "враг ",
                "enough to be worth demolishing another building (raising “Sell up to” past": "достаточно, чтобы стоило снести ещё одно здание (повышение «Продать до» сверх",
                "error - see console": "ошибка - см. консоль",
                "eval error - see console": "ошибка вычисления - см. консоль",
                "failed": "сбой",
                "force-selling": "принудительная продажа",
                "from this base's production": "из производства этой базы",
                "game refused demolish": "игра отклонила снос",
                "green tile / #badge = building <b>moves here</b> (matching <span style='color:#ff8a8a'>&rarr;#</span> red tile = where it left).": "зелёная клетка / #значок = здание <b>перемещается сюда</b> (соответствующая <span style='color:#ff8a8a'>&rarr;#</span> красная клетка = откуда оно ушло).",
                "harvester": "харвестер",
                "in": "в",
                "inclusive Bonus POI": "включая бонусный POI",
                "internal error (see console)": "внутренняя ошибка (см. консоль)",
                "last:": "последнее:",
                "link(s) uncalibrated": "связей не откалибровано",
                "load": "загрузить",
                "low-impact building": "малозначимое здание",
                "max 2 waves": "макс. 2 волны",
                "max 3 waves": "макс. 3 волны",
                "max 4 waves": "макс. 4 волны",
                "missing build type id": "отсутствует id типа постройки",
                "move": "переместить",
                "move(s)": "перемещений",
                "moves": "перемещения",
                "moves here - #": "перемещается сюда - #",
                "new": "новое",
                "new building": "новое здание",
                "new producers": "новые производители",
                "no base can transfer enough Tiberium": "ни одна база не может перевести достаточно тиберия",
                "no buildable": "нет доступных для постройки",
                "no further MCV to research": "больше нет MCV для исследования",
                "no further sell raised": "дальнейшая продажа не повысила",
                "no income": "нет дохода",
                "no movable buildings for this resource": "нет перемещаемых зданий для этого ресурса",
                "no movable buildings on this base": "нет перемещаемых зданий на этой базе",
                "no optimization result to apply": "нет результата оптимизации для применения",
                "no transfer plan can cover the gap": "ни один план перевода не покрывает дефицит",
                "no visible effect after": "нет видимого эффекта после",
                "none of the selected force-sell buildings are on this base": "ни одного из выбранных зданий для принудительной продажи нет на этой базе",
                "none of your stored resources are spent.": "ни один из ваших запасённых ресурсов не тратится.",
                "not enough power": "недостаточно энергии",
                "not enough tiberium (enable \"Transfer as needed\" to pull from other bases)": "недостаточно тиберия (включите \"Переводить при необходимости\", чтобы подтянуть с других баз)",
                "now": "сейчас",
                "now harvests": "теперь добывает",
                "of": "из",
                "on this base, even when trading other resources.": "на этой базе, даже при обмене других ресурсов.",
                "on this base. Try <b>Allow reductions</b> to consider moves that trade other resources for a bigger target gain.": "на этой базе. Попробуйте <b>Разрешить ухудшения</b>, чтобы рассмотреть перемещения, обменивающие другие ресурсы на больший прирост целевого.",
                "paid for by selling": "оплачено продажей",
                "per CP": "на CP",
                "producer": "производитель",
                "producer exists on this base to clone": "производитель существует на этой базе для клонирования",
                "producer here": "производитель здесь",
                "production": "производство",
                "red tile = recommended <b>sell</b> (demolish).": "красная клетка = рекомендуемая <b>продажа</b> (снос).",
                "refund": "возврат",
                "reset": "сбросить",
                "s": "с",
                "s (the game may have rejected it - check resources / build slots)": "с (игра могла отклонить это - проверьте ресурсы / слоты строительства)",
                "save": "сохранить",
                "sell": "продать",
                "sell(s)": "продаж",
                "sells": "продаёт",
                "simulations in cache": "симуляций в кэше",
                "skipped": "пропущено",
                "spent": "потрачено",
                "target": "цель",
                "target base cannot trade right now": "целевая база сейчас не может торговать",
                "targets": "цели",
                "the base changed since you optimized (a building is gone) - re-run the optimizer": "база изменилась с момента оптимизации (здание исчезло) - перезапустите оптимизатор",
                "the base changed since you optimized (a building moved) - re-run the optimizer": "база изменилась с момента оптимизации (здание переместилось) - перезапустите оптимизатор",
                "the refund from those sells can't fund any useful new": "возврат от этих продаж не может профинансировать ни одного полезного нового",
                "tile": "клетка",
                "tile vacated by move #": "клетка, освобождённая перемещением #",
                "tiles": "клетки",
                "units to repair:": "юниты для ремонта:",
                "unknown": "неизвестно",
                "up to": "до",
                "upgradeable now": "можно улучшить сейчас",
                "via": "через",
                "via a temporary staging hop to untangle a swap": "через временную промежуточную пересадку для распутывания перестановки",
                "via transfer": "через перевод",
                "wait": "ожидание",
                "will be <b>moved</b>": "будет <b>перемещено</b>",
                "will be BUILT and UPGRADED</b> (paid from the demolition refund):": "будет ПОСТРОЕНО и УЛУЧШЕНО</b> (оплачено возвратом за снос):",
                "will be PERMANENTLY DEMOLISHED:": "будет БЕЗВОЗВРАТНО СНЕСЕНО:",
                "will succeed": "пройдёт успешно",
                "will switch field type (tiberium &harr; crystal) - this <b>resets that harvester's in-progress package</b>. Continuous production still improves; you just lose the partial package.": "сменит тип поля (тиберий &harr; кристалл) - это <b>сбрасывает незавершённую посылку этого харвестера</b>. Непрерывное производство всё равно улучшается; вы лишь теряете частичную посылку.",
                "won't change this plan). Enable <i>localStorage.MMBASETOOLS_DEBUG='1'</i> + reload to see the per-round numbers in the console.": "не изменит этот план). Включите <i>localStorage.MMBASETOOLS_DEBUG='1'</i> + перезагрузите, чтобы увидеть числа по раундам в консоли.",
                "→Lvl": "→Ур",
                "⇄ Transfer & Upgrade": "⇄ Перевести и улучшить",
                "⚠ ALERT - ": "⚠ ТРЕВОГА - ",
                "✓ Upgraded": "✓ Улучшено",
                "✗ failed": "✗ сбой",
                "⬆ Upgrade": "⬆ Улучшить"
              },
              "es": {
                " (Pending ": " (Pendiente ",
                " (stored power covers ~": " (la energía almacenada cubre ~",
                " - upgrading what fits.": " - mejorando lo que cabe.",
                " NO GROW!": " ¡NO CRECE!",
                " cell(s), climb within ": " celda(s), sube dentro de ",
                " credits)...": " créditos)...",
                " didn't fully arrive - upgrading what fits.": " no llegó por completo - mejorando lo que cabe.",
                " done": " hecho",
                " layouts (": " distribuciones (",
                " loaded": " cargado",
                " loading…": " cargando…",
                " resource type": " tipo de recurso",
                " row(s) of start, kicks may go further if it helps...": " fila(s) del inicio, los empujones pueden ir más allá si ayuda...",
                " sims used)...": " sims usadas)...",
                " sims, maxRepair ": " sims, repMáx ",
                " tweaks (": " ajustes (",
                " under attack!": " ¡bajo ataque!",
                "% of the batch - bringing only that much; run again as power regrows)": "% del lote - trayendo solo esa cantidad; vuelve a ejecutar a medida que la energía se regenere)",
                "&mdash; click to expand": "&mdash; clic para expandir",
                "&mdash; defaults are fine": "&mdash; los valores por defecto están bien",
                "&ndash; optional; changes what gets proposed": "&ndash; opcional; cambia lo que se propone",
                "(0 = auto from alliance [tir], else 10)": "(0 = automático desde la alianza [tir], si no 10)",
                "(0 = auto from alliance [tir], else 6)": "(0 = automático desde la alianza [tir], si no 6)",
                "(after apply) -": "(tras aplicar) -",
                "(continuous /h):": "(continua /h):",
                "(no force-sellable buildings on this base)": "(no hay edificios de venta forzada en esta base)",
                "(no members online)": "(no hay miembros en línea)",
                "(nothing to show - try the 'Show' filter, e.g. 'All candidates')": "(nada que mostrar - prueba el filtro 'Mostrar', p. ej. 'Todos los candidatos')",
                "(open or select a base)": "(abre o selecciona una base)",
                "(refreshing...)": "(actualizando...)",
                "(target)": "(objetivo)",
                "(via transfers)": "(mediante transferencias)",
                "): step ": "): paso ",
                "+ apply": "+ aplicar",
                "+ building": "+ edificio",
                ", best enemy ": ", mejor enemigo ",
                ", fee ~": ", tarifa ~",
                ", maxRepair ": ", repMáx ",
                "1 &middot; Pick a base, then a resource to maximize": "1 &middot; Elige una base, luego un recurso a maximizar",
                "1 = a unit may only move ONE cell up/down/left/right per try. After an improvement the search re-bases on the new position and steps again, so larger overall moves still build up across rounds.": "1 = una unidad solo puede moverse UNA celda arriba/abajo/izquierda/derecha por intento. Tras una mejora, la busqueda se reposiciona sobre la nueva ubicacion y vuelve a avanzar, de modo que los movimientos mas grandes igual se acumulan a lo largo de las rondas.",
                "1 wave": "1 oleada",
                "1st-OFF": "1ª-OFF",
                "2 &middot; Selling": "2 &middot; Venta",
                "2 waves": "2 oleadas",
                "2nd run": "2ª pasada",
                "2nd-OFF": "2ª-OFF",
                "3 waves": "3 oleadas",
                "3rd run": "3ª pasada",
                "4 waves": "4 oleadas",
                "5+ waves": "5+ oleadas",
                ": exploring a new region, ": ": explorando una nueva región, ",
                ": trying ": ": probando ",
                "<b style='color:#5fe0f5'>Force-sell</b> &ndash; just <b>check</b> the “one-of” buildings you'll sacrifice (count is automatic &ndash; you do <b>not</b> need “Sell up to”). Their pooled refund funds new producers of the chosen resource. Works regardless of “Allow reductions”. (Economy/duplicate buildings: use “Sell up to” instead.)": "<b style='color:#5fe0f5'>Venta forzada</b> &ndash; simplemente <b>marca</b> los edificios \"únicos\" que sacrificarás (el conteo es automático &ndash; <b>no</b> necesitas \"Vender hasta\"). Su reembolso combinado financia nuevos productores del recurso elegido. Funciona independientemente de \"Permitir reducciones\". (Edificios de economía/duplicados: usa \"Vender hasta\" en su lugar.)",
                "<b>Force-sell special buildings</b> &ndash; reveals a checklist of the base's 'one-of' buildings (Defense HQ/Facility, Command Center, etc.). Sacrifices the checked ones and fills the freed tiles with the best new producers (early-game strip-to-CY). Apply does demolish &rarr; move &rarr; build &rarr; upgrade automatically.": "<b>Venta forzada de edificios especiales</b> &ndash; revela una lista de verificación de los edificios 'únicos' de la base (Cuartel/Instalación de Defensa, Centro de Mando, etc.). Sacrifica los marcados y rellena las casillas liberadas con los mejores productores nuevos (despeje hacia el CY de inicio de partida). Aplicar hace demoler &rarr; mover &rarr; construir &rarr; mejorar automáticamente.",
                "<b>Kicks</b> &ndash; random shake-ups to escape a 'good-but-not-best' layout.": "<b>Empujones</b> &ndash; sacudidas aleatorias para escapar de una distribución 'buena pero no la mejor'.",
                "<b>Neighbors</b> &ndash; candidate destination tiles tested per building each pass.": "<b>Vecinos</b> &ndash; casillas de destino candidatas probadas por edificio en cada pasada.",
                "<b>Rounds</b> &ndash; improvement passes per attempt (higher = more thorough, slower).": "<b>Rondas</b> &ndash; pasadas de mejora por intento (mayor = más exhaustivo, más lento).",
                "<b>Sell up to N</b> &ndash; the MOST low-impact economy buildings the optimizer may demolish to make room. For each one it sells, it builds a new producer of the chosen resource in the freed tile, paid for by that building's 90% demolish refund (your stored resources are untouched). It's a ceiling, not a quota: it sells only as many as actually help and stops early. Each <span style='color:#ff8a8a'>&times; red sell tile</span> is paired with a <span style='color:#4dd0e1'>&#43; cyan build tile</span> in the results list (\"paid for by selling &hellip;\"). With <b>Allow reductions</b> on it may also trade a little of another resource (e.g. sell an Accumulator for Power) when that yields a bigger gain in the one you picked.": "<b>Vender hasta N</b> &ndash; la MAYOR cantidad de edificios de economía de bajo impacto que el optimizador puede demoler para hacer sitio. Por cada uno que vende, construye un nuevo productor del recurso elegido en la casilla liberada, pagado con el reembolso del 90% por demolición de ese edificio (tus recursos almacenados quedan intactos). Es un tope, no una cuota: vende solo tantos como realmente ayuden y se detiene antes. Cada <span style='color:#ff8a8a'>&times; casilla roja de venta</span> se empareja con una <span style='color:#4dd0e1'>&#43; casilla cian de construcción</span> en la lista de resultados (\"pagado vendiendo &hellip;\"). Con <b>Permitir reducciones</b> activado también puede intercambiar un poco de otro recurso (p. ej. vender un Acumulador por Energía) cuando eso produce una mayor ganancia en el que elegiste.",
                "<i>A ceiling, not a quota &mdash; the optimizer sells only as many as actually help, and builds a producer in each freed tile paid for by that building's 90% demolish refund. Your stored resources are untouched.</i>": "<i>Un tope, no una cuota &mdash; el optimizador vende solo tantos como realmente ayuden, y construye un productor en cada casilla liberada pagado con el reembolso del 90% por demolición de ese edificio. Tus recursos almacenados quedan intactos.</i>",
                "<i>Tip: after applying, run <b>Upgrade Priority</b> (Transfer as needed) to push further using other bases.</i>": "<i>Consejo: tras aplicar, ejecuta <b>Prioridad de mejora</b> (Transferir según necesidad) para avanzar más usando otras bases.</i>",
                "Account Creation": "La creación de Cuentas",
                "Action": "Acción",
                "Affordable in about": "Asequible en aproximadamente",
                "After": "Después",
                "Aircraft Repairtime": "El tiempo de reparación de aeronaves",
                "Alert me when one of my bases is attacked:": "Avísame cuando una de mis bases sea atacada:",
                "All Bases": "Todas las bases",
                "All Bases Overview": "Resumen de todas las bases",
                "All army units": "Todas las unidades de ataque",
                "All buildings": "Todos los edificios",
                "All defense units": "Todas las unidades defensivas",
                "Alliance Bonus": "Bonificación de alianza",
                "Alliance Role": "papel Alianza",
                "Alliance bases": "Bases de la alianza",
                "Alliance bases (blue)": "Bases de la alianza (azul)",
                "Allow reductions": "Permitir reducciones",
                "Applied": "Aplicado",
                "Applied cheapest winning layout (lowest max repair time).": "Aplicada la distribución ganadora más barata (menor tiempo máximo de reparación).",
                "Apply": "Aplicar",
                "Apply layout changes?": "¿Aplicar cambios de distribución?",
                "Apply to base": "Aplicar a la base",
                "Applying": "Aplicando",
                "Applying&hellip;": "Aplicando&hellip;",
                "Attack Alert": "Alerta de ataque",
                "Attack Range": "Alcance de ataque",
                "Attack loot data unavailable": "Datos de botín de ataque no disponibles",
                "Auto-collect / auto-repair": "Recolección automática / reparación automática",
                "Auto-collect packages": "Recolectar paquetes automáticamente",
                "Auto-repair buildings": "Reparar edificios automáticamente",
                "Auto-repair by priority + ROI": "Reparación automática por prioridad + ROI",
                "Auto-repair units": "Reparar unidades automáticamente",
                "Auto-try several army layouts and apply the WINNING layout (enemy destroyed) with the lowest repair time.": "Prueba automaticamente varias formaciones del ejercito y aplica la formacion GANADORA (enemigo destruido) con el menor tiempo de reparacion.",
                "Auto-try several army layouts to DESTROY the enemy Defense Facility (DF): applies the layout that gets DF health as close to 0 as possible, then the lowest max repair time.": "Prueba automaticamente varias formaciones del ejercito para DESTRUIR la Instalacion de Defensa (DF) enemiga: aplica la formacion que deja la salud de la DF lo mas cerca posible de 0 y, despues, el menor tiempo maximo de reparacion.",
                "Auto-try several layouts and apply the winning layout with the lowest repair time. (or call window.MikeyMike_OptimizeRepair())": "Prueba automaticamente varias formaciones y aplica la formacion ganadora con el menor tiempo de reparacion. (o llama a window.MikeyMike_OptimizeRepair())",
                "Auto-try several layouts to destroy the Defense Facility: applies the layout with DF closest to 0, then lowest max repair time. (or call window.MikeyMike_OptimizeDF0())": "Prueba automaticamente varias formaciones para destruir la Instalacion de Defensa: aplica la formacion con la DF mas cerca de 0 y, despues, el menor tiempo maximo de reparacion. (o llama a window.MikeyMike_OptimizeDF0())",
                "BUILD NEW": "CONSTRUIR NUEVO",
                "Base Level": "Nivel Básico",
                "Base Name": "basename",
                "Base Scanner": "Escáner de base",
                "Base Tools": "Herramientas de base",
                "Base layout": "Distribución de base",
                "Basecount": "Número Base",
                "Bases with collectable packages:": "Bases con paquetes recolectables:",
                "Before": "Antes",
                "Best (highest) defense level": "Mejor (más alto) nivel de defensa",
                "Best (highest) offense/army unit level": "Mejor (más alto) nivel de unidad de ofensiva/ejército",
                "Best DF 0": "Mejor DF 0",
                "Best Win": "Mejor victoria",
                "Best so far: ": "Mejor hasta ahora: ",
                "Build": "Construir",
                "Building": "Edificio",
                "Buildings": "Edificios",
                "Built": "Construido",
                "CEILING on how many ECONOMY / duplicate buildings (Silo, Refinery, spare Harvester/PowerPlant/Accumulator) the optimizer may demolish to make room - it then builds a new producer of the chosen resource in EACH freed tile, paid for entirely by that building's 90% demolish refund (none of your stored resources are spent). It's a ceiling, not a quota: 'Sell up to 3' will sell 1, 2, or 3 - whatever actually raises the resource - and stops when one more sell wouldn't help. This is SEPARATE from 'Force-sell special buildings' (Defense HQ, Airport, etc.), which you pick by checking them. 0 = don't sell anything.": "TOPE de cuántos edificios de ECONOMÍA / duplicados (Silo, Refinería, Cosechadora/Central Eléctrica/Acumulador de sobra) puede demoler el optimizador para hacer sitio - luego construye un nuevo productor del recurso elegido en CADA casilla liberada, pagado por completo con el reembolso del 90% por demolición de ese edificio (no se gasta ninguno de tus recursos almacenados). Es un tope, no una cuota: 'Vender hasta 3' venderá 1, 2 o 3 - lo que realmente aumente el recurso - y se detiene cuando una venta más no ayudaría. Esto es DISTINTO de 'Venta forzada de edificios especiales' (Cuartel de Defensa, Aeropuerto, etc.), que eliges marcándolos. 0 = no vender nada.",
                "CY row": "Fila CY",
                "Calculating attack loot...": "Calculando botín de ataque...",
                "Camp": "Campamento",
                "Camps": "Campamentos",
                "Can't apply:": "No se puede aplicar:",
                "Can't be upgraded right now": "No se puede mejorar ahora mismo",
                "Cancel": "Cancelar",
                "City": "Ciudad",
                "Click Refresh to recompute the list.": "Haz clic en Actualizar para recalcular la lista.",
                "Click a base or camp on the map.": "Haz clic en una base o campamento del mapa.",
                "Click a column header to sort (try 'Xfer $' for cheapest transfers).": "Haz clic en un encabezado de columna para ordenar (prueba 'Xfer $' para las transferencias más baratas).",
                "Click a resource above (<b>Tiberium / Crystal / Power / Credits</b>) to generate a plan, then <b>Apply to base</b> to make those changes in-game.": "Haz clic en un recurso de arriba (<b>Tiberio / Cristal / Energía / Créditos</b>) para generar un plan, luego <b>Aplicar a la base</b> para hacer esos cambios en el juego.",
                "Click to sort by": "Clic para ordenar por",
                "Click to sort by this column": "Clic para ordenar por esta columna",
                "Close": "Cerrar",
                "Collect & Repair": "Recolectar y reparar",
                "Collect All Packages": "Recolectar todos los paquetes",
                "Collect packages from every base that has them ready": "Recolectar paquetes de cada base que los tenga listos",
                "Collect packages on bases that have them ready": "Recolectar paquetes en las bases que los tengan listos",
                "Continuous Production": "Producción continua",
                "Controls": "Controles",
                "Cooldown expiry + farmable bases in range, shown while you move a base": "Vencimiento del enfriamiento + bases cultivables en alcance, mostrado mientras mueves una base",
                "Could not find that base. Open it in-game and use 'Current base'.": "No se encontró esa base. Ábrela en el juego y usa 'Base actual'.",
                "Could not optimize:": "No se pudo optimizar:",
                "Couldn't load that target.": "No se pudo cargar ese objetivo.",
                "Couldn't read that target.": "No se pudo leer ese objetivo.",
                "Credit": "crédito",
                "Credit Production": "la producción de Crédito",
                "Credits": "Créditos",
                "Credits  ": "Créditos  ",
                "Credits  NoGrow": "Créditos  NoCrece",
                "Credits  OK!": "Créditos  ¡OK!",
                "Credits ($)": "Créditos ($)",
                "Crystal": "cristal",
                "Crystal Harvester": "Cosechadora de cristal",
                "Crystal Production": "la producción de cristal",
                "Current Base": "Base actual",
                "Current Time": "Tiempo Actual",
                "Current base": "Base actual",
                "Current layout": "Distribución actual",
                "DF can't be fully destroyed; applied closest-to-0 DF layout with lowest max repair time.": "El DF no se puede destruir por completo; aplicada la distribución de DF más cercana a 0 con el menor tiempo máximo de reparación.",
                "DF destroyed (DF=0); applied lowest max repair time layout.": "DF destruido (DF=0); aplicada la distribución con el menor tiempo máximo de reparación.",
                "DF row": "Fila DF",
                "DF Ø all Bases": "DF Ø todas las bases",
                "Def Ø all Bases": "Def Ø todas las bases",
                "Defaults restored - press Save to apply.": "Valores predeterminados restaurados - pulsa Guardar para aplicar.",
                "Defense": "Defensa",
                "Defense Level": "Nivel Defensivo",
                "Defensive Level": "Nivel defensivo",
                "Demolish": "Demoler",
                "Demolish + build + apply": "Demoler + construir + aplicar",
                "Demolished": "Demolido",
                "Dock in game menu bar": "Acoplar en la barra de menú del juego",
                "Don't move a unit back to the cell it just left": "No mover una unidad de vuelta a la celda que acaba de dejar",
                "Done.": "Hecho.",
                "Done. ": "Hecho. ",
                "Down": "Abajo",
                "Enables/Disables all aircrafts.": "Activa/Desactiva todas las aeronaves.",
                "Enables/Disables all infantry units.": "Activa/Desactiva todas las unidades de infanteria.",
                "Enables/Disables all units.": "Activa/Desactiva todas las unidades.",
                "Enables/Disables all vehicles.": "Activa/Desactiva todos los vehiculos.",
                "Enemy bases": "Bases enemigas",
                "Enter CNCTAOpt Long Link:": "Introduce el enlace largo de CNCTAOpt:",
                "Enumerating…": "Enumerando…",
                "Error saving: ": "Error al guardar: ",
                "FAILED": "FALLÓ",
                "Farmable NPC bases in attack range (+ levels + wave estimate)": "Bases NPC cultivables en alcance de ataque (+ niveles + estimación de oleadas)",
                "Field tiles tinted: <span style='color:#7ed07e'>tiberium</span> / <span style='color:#8fc0ff'>crystal</span>.": "Casillas de campo teñidas: <span style='color:#7ed07e'>tiberio</span> / <span style='color:#8fc0ff'>cristal</span>.",
                "Figures are continuous production (packages aren't layout-dependent).": "Las cifras son de producción continua (los paquetes no dependen de la distribución).",
                "Finished, but could not apply layout: ": "Terminado, pero no se pudo aplicar la distribución: ",
                "First Offense": "primero Ofensivo",
                "Flash the browser-tab favicon (siren icon)": "Parpadear el favicon de la pestaña del navegador (icono de sirena)",
                "Flash the browser-tab title": "Parpadear el título de la pestaña del navegador",
                "Foe": "Enemigo",
                "Force-sell special buildings": "Venta forzada de edificios especiales",
                "Forgotten / NPC bases (green)": "Bases Olvidados / PNJ (verde)",
                "Found": "Encontrado",
                "Friend": "Amigo",
                "From:": "De:",
                "Gain/h": "Ganancia/h",
                "Game will reload now.": "El juego se recargará ahora.",
                "General": "general",
                "General Information": "Información General",
                "Go": "Ir",
                "Green = your offense can activate it · Red = blocked (offense too low)": "Verde = tu ofensiva puede activarlo · Rojo = bloqueado (ofensiva demasiado baja)",
                "Hard cap on battle simulations per click (the main safety net).": "Limite maximo de simulaciones de batalla por clic (la red de seguridad principal).",
                "Hard cap on climb+kick rounds for a single optimize click.": "Limite maximo de rondas de ascenso+patada para un solo clic de optimizacion.",
                "Highest first &middot; select then Up/Down to reorder": "Más alto primero &middot; selecciona y luego Arriba/Abajo para reordenar",
                "Highlight bases in range while moving a base": "Resaltar bases en alcance mientras mueves una base",
                "Highlight in move-base view:": "Resaltar en la vista de mover base:",
                "Homepage": "sitio web",
                "Hours": "horas",
                "How many candidate destination tiles to test per building each pass. Higher = more thorough but slower.": "Cuántas casillas de destino candidatas probar por edificio en cada pasada. Mayor = más exhaustivo pero más lento.",
                "How many candidate layouts to evaluate each round. Higher = more thorough but more simulations.": "Cuantas formaciones candidatas evaluar en cada ronda. Mas alto = mas exhaustivo pero mas simulaciones.",
                "How many of the top rows Go will upgrade. Auto-capped to how many will actually succeed (a batch never fails), and reset to 5 (or fewer) on Refresh and whenever you toggle 'Transfer as needed'.": "Cuántas de las filas superiores mejorará Ir. Auto-limitado a cuántas tendrán éxito realmente (un lote nunca falla), y restablecido a 5 (o menos) al Actualizar y cada vez que cambies 'Transferir según necesidad'.",
                "How many rows a unit may drift away from its starting row while climbing (kicks may go further if it helps).": "Cuantas filas puede alejarse una unidad de su fila inicial mientras asciende (las patadas pueden ir mas lejos si ayuda).",
                "Improvement passes per attempt. Higher = more thorough but slower.": "Pasadas de mejora por intento. Mayor = más exhaustivo pero más lento.",
                "Infantry Repairtime": "El tiempo de reparación de Infantería",
                "Infected": "Infectado",
                "Interval (minutes):": "Intervalo (minutos):",
                "Keep upgraded rows (clear on Refresh)": "Mantener las filas mejoradas (borrar al Actualizar)",
                "Kick ": "Empujón ",
                "Kicks:": "Empujones:",
                "Last update:": "Última actualización:",
                "Layout Optimizer": "Optimizador de distribución",
                "Legend": "Leyenda",
                "Levels:": "Niveles:",
                "Loading...": "Cargando...",
                "Loc": "Ubic",
                "Loot + levels of the base you click on the map": "Botín + niveles de la base en la que haces clic en el mapa",
                "Loot Info": "Info de botín",
                "Loot Summary": "Resumen de botín",
                "Lootable resources": "Recursos saqueables",
                "Lvl": "Nvl",
                "Lvl≥": "Nvl≥",
                "MM - Base Scanner": "MM - Escáner de base",
                "Master: enable Attack Alert": "Principal: activar Alerta de ataque",
                "Master: enable the move-panel readout": "Principal: activar la lectura del panel de movimiento",
                "Master: enable the range overlay": "Principal: activar la superposición de alcance",
                "Master: enable the tunnel overlay": "Principal: activar la superposición de túneles",
                "Master: show the overlay at all": "Principal: mostrar la superposición",
                "Max bases": "Máx. bases",
                "Max bases founded": "Máx. bases fundadas",
                "Max fruitless kicks": "Maximo de patadas infructuosas",
                "Max rounds per click": "Maximo de rondas por clic",
                "Max row drift from start": "Maxima desviacion de filas desde el inicio",
                "Max simulations per click": "Maximo de simulaciones por clic",
                "Max step (cells per move)": "Paso maximo (celdas por movimiento)",
                "Maximal CP": "CP máximo",
                "Maximal Reptime": "Repzeit máximo",
                "Member": "Miembro",
                "Member Status": "Estado de miembros",
                "Members": "Miembros",
                "Mirrors units horizontally.": "Refleja las unidades horizontalmente.",
                "Mirrors units vertically.": "Refleja las unidades verticalmente.",
                "Morale": "Moral",
                "Move": "Mover",
                "Move (and, if proposed, demolish) buildings in-game to match the proposed layout. Shows a confirmation with exactly what will change first.": "Mover (y, si se propone, demoler) edificios en el juego para coincidir con la distribución propuesta. Muestra primero una confirmación con exactamente lo que cambiará.",
                "Move Info": "Info de movimiento",
                "Move ready:": "Movimiento listo:",
                "Move-cooldown expiry time (when the spot is free to move into)": "Hora de vencimiento del enfriamiento de movimiento (cuando el lugar queda libre para mover ahí)",
                "Moved": "Movido",
                "Movement": "Movimiento",
                "Moves": "Movimientos",
                "Moves (0)": "Movimientos (0)",
                "NPC bases in range:": "Bases NPC en alcance:",
                "Needs a Tiberium transfer": "Necesita una transferencia de Tiberio",
                "Neighbors:": "Vecinos:",
                "Net production change (continuous /h)": "Cambio neto de producción (continua /h)",
                "Neutral bases (peace/NAP)": "Bases neutrales (paz/PNA)",
                "Next MCV": "Próximo MCV",
                "No alliance": "Sin alianza",
                "No army units found to optimize.": "No se encontraron unidades de ejército para optimizar.",
                "No layout found; restored original.": "No se encontró distribución; restaurada la original.",
                "No loot data for this object": "No hay datos de botín para este objeto",
                "No moves improve": "Ningún movimiento mejora",
                "No transferable resources within your credit budget": "No hay recursos transferibles dentro de tu presupuesto de créditos",
                "No winning layout found (enemy can't be destroyed) - try 'Best DF 0'. Restored original.": "No se encontró distribución ganadora (no se puede destruir al enemigo) - prueba 'Mejor DF 0'. Restaurada la original.",
                "NoGrow": "NoCrece",
                "None": "Ninguno",
                "Note: build &amp; upgrade are queued as game commands; the new building appears immediately and upgrades complete over time. Make sure the demolition refund covers the cost.": "Nota: construir y mejorar se ponen en cola como comandos del juego; el nuevo edificio aparece de inmediato y las mejoras se completan con el tiempo. Asegúrate de que el reembolso por demolición cubra el coste.",
                "Nothing to apply - the base already matches the proposal.": "Nada que aplicar - la base ya coincide con la propuesta.",
                "Nothing to upgrade right now - not enough resources (or credits for the transfer fees).": "Nada que mejorar ahora mismo - no hay suficientes recursos (o créditos para las tarifas de transferencia).",
                "Nothing to upgrade without transfers - tick \"Transfer as needed\" to allow them, or wait for this base to produce more Tiberium.": "Nada que mejorar sin transferencias - marca \"Transferir según necesidad\" para permitirlas, o espera a que esta base produzca más Tiberio.",
                "Numbers match the grid.": "Los números coinciden con la cuadrícula.",
                "Numbers match the grid. Click <b>Apply to base</b> above to make these changes in-game (you'll get a confirmation first), or do them by hand in move mode.": "Los números coinciden con la cuadrícula. Haz clic en <b>Aplicar a la base</b> arriba para hacer estos cambios en el juego (primero recibirás una confirmación), o hazlos a mano en el modo de movimiento.",
                "OFF (default): only suggest moves that improve the chosen resource without hurting the others. Strict but limited - a swap that's blocked by, say, a Refinery in the way is never considered.\n\nON: widen the search to ALL resource buildings and let the optimizer trade small losses in other resources for a larger target gain (score = target_gain - 0.5 * sum_of_other_losses). The results panel shows the net change for all 4 resources so you can see exactly what's being traded.": "OFF (por defecto): solo sugerir movimientos que mejoren el recurso elegido sin perjudicar a los demás. Estricto pero limitado - un intercambio bloqueado por, digamos, una Refinería de por medio nunca se considera.\n\nON: ampliar la búsqueda a TODOS los edificios de recursos y dejar que el optimizador intercambie pequeñas pérdidas en otros recursos por una mayor ganancia objetivo (puntuación = ganancia_objetivo - 0.5 * suma_de_otras_pérdidas). El panel de resultados muestra el cambio neto de los 4 recursos para que veas exactamente qué se está intercambiando.",
                "OK!": "¡OK!",
                "Off/Def Bubbles": "Burbujas Off/Def",
                "Offense": "Ofensiva",
                "Offense Bases Count": "Bases Número ofensivas",
                "Offense Level": "Nivel Ofensivo",
                "Offense Level:": "Nivel de ofensiva:",
                "On-grid overlay (Ctrl-hold)": "Superposición en cuadrícula (mantener Ctrl)",
                "On-map off/def bubbles (enemy / alliance / own)": "Burbujas off/def en el mapa (enemigo / alianza / propio)",
                "On: upgraded rows stay marked '✓ Upgraded' until you Refresh.\nOff: each row vanishes the instant its upgrade succeeds (the classic behavior).": "On: las filas mejoradas permanecen marcadas '✓ Mejorado' hasta que Actualices.\nOff: cada fila desaparece en el instante en que su mejora tiene éxito (el comportamiento clásico).",
                "Only alarm while the game tab is in the background": "Alarmar solo mientras la pestaña del juego está en segundo plano",
                "Open an attack (combat setup) on a target first.": "Abre primero un ataque (configuración de combate) sobre un objetivo.",
                "Open this base": "Abrir esta base",
                "Optimize this base's layout to maximize": "Optimizar la distribución de esta base para maximizar",
                "Optimizer Options": "Opciones del optimizador",
                "Optimizer already running...": "El optimizador ya está en ejecución...",
                "Optimizer stopped by user.": "Optimizador detenido por el usuario.",
                "Optimizing": "Optimizando",
                "Optimizing (": "Optimizando (",
                "Origin base not loaded": "Base de origen no cargada",
                "Other players' bases (orange)": "Bases de otros jugadores (naranja)",
                "Outpost": "Puesto avanzado",
                "Outposts": "Puestos avanzados",
                "Own bases": "Bases propias",
                "Package Production": "Producción de paquetes",
                "Pick an origin base": "Elige una base de origen",
                "Pin into the game menu / unpin to a movable panel": "Fijar en el menú del juego / desfijar a un panel movible",
                "Plan level up": "Planificar subida de nivel",
                "Plan move base": "Planificar mover base",
                "Plan remove": "Planificar eliminación",
                "Plan ruin": "Planificar ruina",
                "Plan ruin for": "Planificar ruina para",
                "Play an alarm sound": "Reproducir un sonido de alarma",
                "Player": "Jugador",
                "Player Class": "Clase jugador",
                "Player Name": "Jugadores Nombre",
                "Players": "Jugadores",
                "Players Production": "Jugadores Producción",
                "Pooled refund": "Reembolso combinado",
                "Possible attacks from this base (available CP):": "Ataques posibles desde esta base (CP disponible):",
                "Pow cost": "Coste de energía",
                "Pow on builds+upgrades.": "Energía en construcciones+mejoras.",
                "Pow/gain": "Energía/ganancia",
                "Power": "corriente",
                "Power Produktion": "La producción actual",
                "Preset": "Preajuste",
                "Prevents a unit bouncing back and forth between the same two cells.": "Evita que una unidad rebote de un lado a otro entre las mismas dos celdas.",
                "Preview the siren / title / favicon (click once to allow sound).": "Previsualizar la sirena / título / favicon (haz clic una vez para permitir el sonido).",
                "Priority Setup": "Configuracion de prioridad",
                "Processed": "Procesado",
                "Production": "Producción",
                "Proposed layout": "Distribución propuesta",
                "Pull the missing Tiberium from your other bases (cheapest first), then upgrade.\nTransfer fee:": "Traer el Tiberio faltante de tus otras bases (lo más barato primero), luego mejorar.\nTarifa de transferencia:",
                "RP  OK!": "RP  ¡OK!",
                "RP OK!": "RP ¡OK!",
                "Random shake-ups to escape a 'good but not best' layout and explore a different arrangement. More = explores more but slower.": "Sacudidas aleatorias para escapar de una distribución 'buena pero no la mejor' y explorar una disposición diferente. Más = explora más pero más lento.",
                "Range override:": "Anulación de alcance:",
                "Rank": "rango",
                "Re-reading base&hellip;": "Releyendo la base&hellip;",
                "Real gain:": "Ganancia real:",
                "Real loss:": "Pérdida real:",
                "Recompute the list (clears the '✓ Upgraded' marks and rescans every base)": "Recalcular la lista (borra las marcas '✓ Mejorado' y reescanea cada base)",
                "Recompute the table from the current game state": "Recalcular la tabla desde el estado actual del juego",
                "Refresh": "Actualizar",
                "Region map": "Mapa de la región",
                "Relative chance of trying a horizontal (left/right) move. Higher = more likely to be picked.": "Probabilidad relativa de intentar un movimiento horizontal (izquierda/derecha). Mas alto = mas probable de ser elegido.",
                "Relative chance of trying a vertical (up/down) move. Keep below the left/right weight to favour horizontal changes (e.g. 0.75).": "Probabilidad relativa de intentar un movimiento vertical (arriba/abajo). Mantenlo por debajo del peso izquierda/derecha para favorecer los cambios horizontales (p. ej. 0.75).",
                "Remember transported units are not supported.": "Recuerda que las unidades transportadas no son compatibles.",
                "Repair All Buildings": "Reparar todos los edificios",
                "Repair All Units": "Reparar todas las unidades",
                "Repair buildings (where allowed) across every base": "Reparar edificios (donde esté permitido) en cada base",
                "Repair buildings on bases where repair is available": "Reparar edificios en las bases donde la reparación esté disponible",
                "Repair units across every base": "Reparar unidades en cada base",
                "Repair units on bases where repair is available": "Reparar unidades en las bases donde la reparación esté disponible",
                "Required Level:": "Nivel requerido:",
                "Res": "Rec",
                "Reset": "Restablecer",
                "Reset Defaults": "Restablecer valores predeterminados",
                "Reset Formation": "Restablecer formacion",
                "Reset plans": "Restablecer planes",
                "Reset to default": "Restablecer por defecto",
                "Resource": "Recurso",
                "Resource:": "Recurso:",
                "Reveals a checklist of the 'one-of' special buildings on this base (Defense HQ/Facility, Command Center, Barracks, Factory, Airport, Support). Check any you're willing to sacrifice; the optimizer demolishes them, pools their 90% refund, and fills the freed tiles with the best new producers of the chosen resource (early-game 'strip to the Construction Yard' play).\n\nYou do NOT need this for the normal case: with 'Sell up to' >= 1 and 'Allow reductions' on, the optimizer already auto-considers selling an economy building (e.g. a Silo) and building a producer (e.g. an Accumulator) in its place.": "Revela una lista de verificación de los edificios especiales 'únicos' de esta base (Cuartel/Instalación de Defensa, Centro de Mando, Barracones, Fábrica, Aeropuerto, Apoyo). Marca los que estés dispuesto a sacrificar; el optimizador los demuele, combina su reembolso del 90% y rellena las casillas liberadas con los mejores productores nuevos del recurso elegido (jugada de inicio de partida 'despejar hasta el Patio de Construcción').\n\nNO necesitas esto para el caso normal: con 'Vender hasta' >= 1 y 'Permitir reducciones' activado, el optimizador ya considera automáticamente vender un edificio de economía (p. ej. un Silo) y construir un productor (p. ej. un Acumulador) en su lugar.",
                "Right click: Set formation from CNCTAOpt Long Link": "Clic derecho: Establecer formacion desde el enlace largo de CNCTAOpt",
                "Round ": "Ronda ",
                "Round tweaks: ": "Ajustes de ronda: ",
                "Rounds:": "Rondas:",
                "Rule Out": "Descartar",
                "Run periodically across every base. Off by default for units to avoid surprise resource spend.": "Ejecutar periódicamente en cada base. Desactivado por defecto para unidades a fin de evitar un gasto de recursos sorpresa.",
                "SELL": "VENDER",
                "Save": "Guardar",
                "Save/Load Formation [NUM ,]": "Guardar/Cargar formación [NUM ,]",
                "Saved - applies on the next optimize click.": "Guardado - se aplica en el proximo clic de optimizacion.",
                "Scan": "Escanear",
                "Scan attackable bases near one of your bases": "Escanear bases atacables cerca de una de tus bases",
                "Scanning…": "Escaneando…",
                "Search Budget": "Presupuesto de busqueda",
                "Search quality (advanced)": "Calidad de búsqueda (avanzado)",
                "Second Offense": "Segundo Ofensivo",
                "Select at least one type": "Selecciona al menos un tipo",
                "Selected army unit": "Unidad de ataque seleccionada",
                "Selected building": "Edificio seleccionado",
                "Selected defense unit": "Unidad defensiva seleccionada",
                "Self-funded plan:": "Plan autofinanciado:",
                "Sell": "Vender",
                "Sell up to:": "Vender hasta:",
                "Server Language": "Idioma del Servidor",
                "Set error: ": "Error al establecer: ",
                "Settings": "Ajustes",
                "Shifts units one space down.": "Desplaza las unidades un espacio hacia abajo.",
                "Shifts units one space left.": "Desplaza las unidades un espacio hacia la izquierda.",
                "Shifts units one space right.": "Desplaza las unidades un espacio hacia la derecha.",
                "Shifts units one space up.": "Desplaza las unidades un espacio hacia arriba.",
                "Show attack loot summary in region base popups": "Mostrar resumen de botín de ataque en las ventanas emergentes de bases de la región",
                "Show current formation with CNCTAOpt": "Mostrar la formacion actual con CNCTAOpt",
                "Show the Offense / Required level readout in the move panel": "Mostrar la lectura de nivel de Ofensiva / Requerido en el panel de movimiento",
                "Show the off/def map bubble for:": "Mostrar la burbuja off/def del mapa para:",
                "Show which tunnels you can activate while moving a base": "Mostrar qué túneles puedes activar mientras mueves una base",
                "Show:": "Mostrar:",
                "Sim result error: ": "Error de resultado de sim: ",
                "Sim send error: ": "Error de envío de sim: ",
                "Skip Victory-Popup After Battle": "Omitir la ventana emergente de victoria tras la batalla",
                "Skipped": "Omitido",
                "Staged": "Preparado",
                "Statistic": "Estadistica",
                "Stop": "Detener",
                "Stop after this many random jumps in a row that find no improvement.": "Detenerse despues de esta cantidad de saltos aleatorios seguidos que no encuentran ninguna mejora.",
                "Stopped - ": "Detenido - ",
                "Stopped at": "Detenido en",
                "Stopped. ": "Detenido. ",
                "Stored resources": "Recursos almacenados",
                "Sum": "Suma",
                "Sum/CP": "Suma/CP",
                "Support": "Apoyo",
                "Support Building Level Ø": "Soporte Nivel Edificio Ø",
                "Support row": "Fila de apoyo",
                "Swaps lines 1 & 2.": "Intercambia las lineas 1 y 2.",
                "Swaps lines 2 & 3.": "Intercambia las lineas 2 y 3.",
                "Swaps lines 3 & 4.": "Intercambia las lineas 3 y 4.",
                "TEST": "PRUEBA",
                "Target": "Objetivo",
                "Target out of range, no attack-loot calculation possible": "Objetivo fuera de alcance, no es posible calcular el botín de ataque",
                "Test alarm": "Probar alarma",
                "Tib cost": "Coste de Tib",
                "Tib/gain": "Tib/ganancia",
                "Tiberium": "Tiberio",
                "Tiberium Harvester": "Cosechadora de tiberio",
                "Tiberium Production": "producción Tiberium",
                "Tick \"Transfer as needed\" above to allow it.": "Marca \"Transferir según necesidad\" arriba para permitirlo.",
                "Tiles show each building's icon + its <b>level</b> (corner).": "Las casillas muestran el icono de cada edificio + su <b>nivel</b> (esquina).",
                "Time/resources until your next base (MCV)": "Tiempo/recursos hasta tu próxima base (MCV)",
                "Toggle the Base Tools window": "Alternar la ventana de Herramientas de base",
                "Toggle the Member Status display": "Alternar la visualización de Estado de miembros",
                "Total / BaseLevel": "Total / Nivel de base",
                "Total Crystal Production": "La producción total de cristal",
                "Total Power Production": "La producción total de electricidad",
                "Total Production": "La producción total",
                "Total Tiberium Production": "La producción total de Tiberium",
                "Transfer + upgrade": "Transferir + mejorar",
                "Transfer as needed": "Transferir según necesidad",
                "Transferred all available - upgrading as many as fit.": "Transferido todo lo disponible - mejorando tantas como quepan.",
                "Transferring max available (": "Transfiriendo el máximo disponible (",
                "Transfers complete - upgrading.": "Transferencias completadas - mejorando.",
                "Tune how the auto-optimizer searches layouts: step size, left/right vs up/down weighting, row drift and search budgets.": "Ajusta como el auto-optimizador busca formaciones: tamano del paso, ponderacion izquierda/derecha frente a arriba/abajo, desviacion de filas y presupuestos de busqueda.",
                "Tunnel Info": "Info de túnel",
                "Tweaks tried per round": "Ajustes probados por ronda",
                "Type": "Tipo",
                "Undo": "Deshacer",
                "Up": "Arriba",
                "Upgrade": "Mejorar",
                "Upgrade Priority": "Prioridad de mejora",
                "Upgrade the top N rows in the list below (in the current sort order). Re-validates each row before firing it so resource drains from earlier rows are accounted for; if 'Transfer as needed' is on, will transfer Tiberium in from other bases when the local base is short.": "Mejorar las N filas superiores de la lista de abajo (en el orden de clasificación actual). Revalida cada fila antes de activarla para tener en cuenta los gastos de recursos de las filas anteriores; si 'Transferir según necesidad' está activado, transferirá Tiberio de otras bases cuando la base local vaya corta.",
                "Upgrade this building now": "Mejorar este edificio ahora",
                "Upgrade top": "Mejorar las primeras",
                "Upgrade: Base": "Mejora: Base",
                "Upgrade: Defense": "Mejora: Defensa",
                "Upgrade: Offense": "Mejora: Ofensiva",
                "Upgraded": "Mejorado",
                "Upgrading": "Mejorando",
                "Use floating panel": "Usar panel flotante",
                "Vehicle Repairtime": "El tiempo de reparación de vehículos",
                "View Simulation": "Ver simulacion",
                "Warn me (sound + tab title + favicon) when a base is under attack": "Avísame (sonido + título de pestaña + favicon) cuando una base esté bajo ataque",
                "Weight: left/right moves": "Peso: movimientos izquierda/derecha",
                "Weight: up/down moves": "Peso: movimientos arriba/abajo",
                "When a row in the batch would otherwise fail because the local base is short on Tiberium, transfer from your other bases (cheapest first) before upgrading. Skipped if no transfer plan covers the gap or you can't afford the transfer fee. Off by default - transfers cost credits.": "Cuando una fila del lote fallaría porque la base local va corta de Tiberio, transferir de tus otras bases (lo más barato primero) antes de mejorar. Se omite si ningún plan de transferencia cubre la diferencia o no puedes pagar la tarifa de transferencia. Desactivado por defecto - las transferencias cuestan créditos.",
                "When on, hold Ctrl while viewing your own base to see a translucent gain/cost overlay on each resource-producing tile (Harvester, Silo, PowerPlant, Accumulator, Refinery). Best = green, worst = red, label is the ratio. Release Ctrl to hide. Salvaged from xTr1m's Base Overlay (retired).": "Cuando está activado, mantén Ctrl mientras ves tu propia base para ver una superposición translúcida de ganancia/coste en cada casilla productora de recursos (Cosechadora, Silo, Central Eléctrica, Acumulador, Refinería). Mejor = verde, peor = rojo, la etiqueta es la proporción. Suelta Ctrl para ocultar. Rescatado del Base Overlay de xTr1m (retirado).",
                "When on, opening the info popup for any non-own base on the region map (camp / outpost / forgotten / enemy player) appends a quick loot summary: 'Possible attacks (available CP)', 'Lootable resources', 'per CP', '2nd run' and '3rd run' breakdowns of Tiberium / Crystal / Credits / Research Points - so you can pick the best farm/attack target without opening each base's attack screen.": "Cuando está activado, al abrir la ventana emergente de información de cualquier base ajena en el mapa de la región (campamento / puesto avanzado / olvidada / jugador enemigo) se añade un resumen rápido de botín: 'Ataques posibles (CP disponible)', 'Recursos saqueables', 'por CP', desgloses de '2ª pasada' y '3ª pasada' de Tiberio / Cristal / Créditos / Puntos de Investigación - para que puedas elegir el mejor objetivo de cultivo/ataque sin abrir la pantalla de ataque de cada base.",
                "When on, the auto-repair tick walks the priority list below and ROI-sorts damaged buildings within each tier. Off = call the game's RepairAll in its default order.": "Cuando está activado, el ciclo de reparación automática recorre la lista de prioridades de abajo y ordena por ROI los edificios dañados dentro de cada nivel. Desactivado = llama al RepairAll del juego en su orden por defecto.",
                "When the current base lacks Tiberium or Crystal for an upgrade, transfer the shortfall in from your other bases (cheapest first) before firing the upgrade. Power isn't transferable - those shortages still fall through. Off by default (transfers cost credits).": "Cuando la base actual carece de Tiberio o Cristal para una mejora, transferir la diferencia de tus otras bases (lo más barato primero) antes de activar la mejora. La Energía no es transferible - esas carencias siguen sin resolverse. Desactivado por defecto (las transferencias cuestan créditos).",
                "Which RESOURCE this upgrade boosts (Tib / Cry / Pow / $=Credits). The building type itself is in the Building column.": "Qué RECURSO impulsa esta mejora (Tib / Cry / Pow / $=Créditos). El tipo de edificio en sí está en la columna Edificio.",
                "While moving a base, add to the move panel:": "Mientras mueves una base, añadir al panel de movimiento:",
                "While moving a base, show tunnel activation:": "Mientras mueves una base, mostrar activación de túneles:",
                "Works on its OWN, but the upgrades above drain this base first - it will FAIL if you batch them with Go. Lower 'Upgrade top', or click this row by itself.": "Funciona por SÍ SOLO, pero las mejoras de arriba agotan esta base primero - FALLARÁ si las agrupas con Ir. Baja 'Mejorar las primeras', o haz clic en esta fila por sí sola.",
                "[allow reductions: ON]": "[permitir reducciones: ON]",
                "a base": "una base",
                "a move target is blocked by a fixed building - re-run the optimizer": "un destino de movimiento está bloqueado por un edificio fijo - vuelve a ejecutar el optimizador",
                "all bases": "todas las bases",
                "allowing reductions": "permitiendo reducciones",
                "and spend the 90% demolish refund to build": "y gastar el reembolso del 90% por demolición para construir",
                "at": "en",
                "at ": "en ",
                "auto-build": "auto-construir",
                "base drained by the upgrades above": "base agotada por las mejoras de arriba",
                "base is locked": "la base está bloqueada",
                "base unavailable": "base no disponible",
                "best DF=0": "mejor DF=0",
                "best win": "mejor victoria",
                "blocked": "bloqueado",
                "build manager unavailable": "gestor de construcción no disponible",
                "build tile is occupied": "la casilla de construcción está ocupada",
                "build(s)": "construcción(es)",
                "building": "edificio",
                "building not found": "edificio no encontrado",
                "building to upgrade not found": "edificio a mejorar no encontrado",
                "buildings": "edificios",
                "buildings to repair:": "edificios a reparar:",
                "can't afford transfer fee": "no se puede pagar la tarifa de transferencia",
                "candidate(s),": "candidato(s),",
                "change(s)": "cambio(s)",
                "could not read base layout": "no se pudo leer la distribución de la base",
                "could not read the base": "no se pudo leer la base",
                "could not read the build-cost API (game may have updated)": "no se pudo leer la API de coste de construcción (el juego puede haberse actualizado)",
                "couldn't sequence all moves automatically - apply by hand in move mode": "no se pudieron secuenciar todos los movimientos automáticamente - aplica a mano en el modo de movimiento",
                "couldn't sequence the moves automatically (no free staging tile) - apply by hand in move mode": "no se pudieron secuenciar los movimientos automáticamente (no hay casilla de preparación libre) - aplica a mano en el modo de movimiento",
                "credits": "créditos",
                "credits.": "créditos.",
                "cyan tile = <b>build new</b> building here (self-funded by a sell's refund).": "casilla cian = <b>construir nuevo</b> edificio aquí (autofinanciado por el reembolso de una venta).",
                "demolish": "demoler",
                "demolished": "demolido",
                "demolition(s)": "demolición(es)",
                "done": "hecho",
                "enemy ": "enemigo ",
                "enough to be worth demolishing another building (raising “Sell up to” past": "suficiente para que valga la pena demoler otro edificio (subir \"Vender hasta\" más allá de",
                "error - see console": "error - ver consola",
                "eval error - see console": "error de evaluación - ver consola",
                "failed": "falló",
                "force-selling": "venta forzada",
                "from this base's production": "de la producción de esta base",
                "game refused demolish": "el juego rechazó la demolición",
                "green tile / #badge = building <b>moves here</b> (matching <span style='color:#ff8a8a'>&rarr;#</span> red tile = where it left).": "casilla verde / #insignia = el edificio <b>se mueve aquí</b> (la casilla roja <span style='color:#ff8a8a'>&rarr;#</span> coincidente = de dónde salió).",
                "harvester": "cosechadora",
                "in": "en",
                "inclusive Bonus POI": "incluyendo PDI Bono",
                "internal error (see console)": "error interno (ver consola)",
                "last:": "última:",
                "link(s) uncalibrated": "enlace(s) sin calibrar",
                "load": "cargar",
                "low-impact building": "edificio de bajo impacto",
                "max 2 waves": "máx 2 oleadas",
                "max 3 waves": "máx 3 oleadas",
                "max 4 waves": "máx 4 oleadas",
                "missing build type id": "falta el id del tipo de construcción",
                "move": "mover",
                "move(s)": "movimiento(s)",
                "moves": "movimientos",
                "moves here - #": "se mueve aquí - #",
                "new": "nuevo",
                "new building": "nuevo edificio",
                "new producers": "nuevos productores",
                "no base can transfer enough Tiberium": "ninguna base puede transferir suficiente Tiberio",
                "no buildable": "no construible",
                "no further MCV to research": "no hay más MCV que investigar",
                "no further sell raised": "ninguna venta adicional aumentó",
                "no income": "sin ingresos",
                "no movable buildings for this resource": "no hay edificios movibles para este recurso",
                "no movable buildings on this base": "no hay edificios movibles en esta base",
                "no optimization result to apply": "no hay resultado de optimización para aplicar",
                "no transfer plan can cover the gap": "ningún plan de transferencia puede cubrir la diferencia",
                "no visible effect after": "sin efecto visible tras",
                "none of the selected force-sell buildings are on this base": "ninguno de los edificios de venta forzada seleccionados está en esta base",
                "none of your stored resources are spent.": "no se gasta ninguno de tus recursos almacenados.",
                "not enough power": "no hay suficiente energía",
                "not enough tiberium (enable \"Transfer as needed\" to pull from other bases)": "no hay suficiente tiberio (activa \"Transferir según necesidad\" para traer de otras bases)",
                "now": "ahora",
                "now harvests": "ahora cosecha",
                "of": "de",
                "on this base, even when trading other resources.": "en esta base, incluso intercambiando otros recursos.",
                "on this base. Try <b>Allow reductions</b> to consider moves that trade other resources for a bigger target gain.": "en esta base. Prueba <b>Permitir reducciones</b> para considerar movimientos que intercambien otros recursos por una mayor ganancia objetivo.",
                "paid for by selling": "pagado vendiendo",
                "per CP": "por CP",
                "producer": "productor",
                "producer exists on this base to clone": "existe un productor en esta base para clonar",
                "producer here": "productor aquí",
                "production": "producción",
                "red tile = recommended <b>sell</b> (demolish).": "casilla roja = <b>venta</b> recomendada (demoler).",
                "refund": "reembolso",
                "reset": "restablecer",
                "s (the game may have rejected it - check resources / build slots)": "s (el juego puede haberlo rechazado - revisa recursos / ranuras de construcción)",
                "save": "guardar",
                "sell": "vender",
                "sell(s)": "venta(s)",
                "sells": "vende",
                "simulations in cache": "simulaciones en cache",
                "skipped": "omitido",
                "spent": "gastado",
                "target": "objetivo",
                "target base cannot trade right now": "la base objetivo no puede comerciar ahora mismo",
                "targets": "objetivos",
                "the base changed since you optimized (a building is gone) - re-run the optimizer": "la base cambió desde que optimizaste (un edificio ya no está) - vuelve a ejecutar el optimizador",
                "the base changed since you optimized (a building moved) - re-run the optimizer": "la base cambió desde que optimizaste (un edificio se movió) - vuelve a ejecutar el optimizador",
                "the refund from those sells can't fund any useful new": "el reembolso de esas ventas no puede financiar ningún nuevo útil",
                "tile": "casilla",
                "tile vacated by move #": "casilla desocupada por el movimiento #",
                "tiles": "casillas",
                "units to repair:": "unidades a reparar:",
                "unknown": "desconocido",
                "up to": "hasta",
                "upgradeable now": "mejorable ahora",
                "via": "vía",
                "via a temporary staging hop to untangle a swap": "mediante un salto de preparación temporal para desenredar un intercambio",
                "via transfer": "vía transferencia",
                "wait": "esperar",
                "will be <b>moved</b>": "será <b>movido</b>",
                "will be BUILT and UPGRADED</b> (paid from the demolition refund):": "será CONSTRUIDO y MEJORADO</b> (pagado con el reembolso por demolición):",
                "will be PERMANENTLY DEMOLISHED:": "será DEMOLIDO PERMANENTEMENTE:",
                "will succeed": "tendrá éxito",
                "will switch field type (tiberium &harr; crystal) - this <b>resets that harvester's in-progress package</b>. Continuous production still improves; you just lose the partial package.": "cambiará el tipo de campo (tiberio &harr; cristal) - esto <b>reinicia el paquete en curso de esa cosechadora</b>. La producción continua sigue mejorando; solo pierdes el paquete parcial.",
                "won't change this plan). Enable <i>localStorage.MMBASETOOLS_DEBUG='1'</i> + reload to see the per-round numbers in the console.": "no cambiará este plan). Activa <i>localStorage.MMBASETOOLS_DEBUG='1'</i> + recarga para ver los números por ronda en la consola.",
                "→Lvl": "→Nvl",
                "⇄ Transfer & Upgrade": "⇄ Transferir y mejorar",
                "⚠ ALERT - ": "⚠ ALERTA - ",
                "✓ Upgraded": "✓ Mejorado",
                "✗ failed": "✗ falló",
                "⬆ Upgrade": "⬆ Mejorar"
              },
              "it": {
                "Account Creation": "Creazione di un Account",
                "Aircraft Repairtime": "Tempo di riparazione Aeromobile",
                "Alliance Role": "Ruolo Alleanza",
                "Base Level": "Livello Base",
                "Base Name": "Nome di Base",
                "Basecount": "Numero di Base",
                "Credit": "Crediti",
                "Credit Production": "Produzione del Crediti",
                "Crystal": "Cristallo",
                "Crystal Production": "Produzione del Cristallo",
                "Current Time": "Ora Attuale",
                "DF Ø all Bases": "Stazioni di difesa Ø di tutte le basi",
                "Def Ø all Bases": "Def Ø di tutte le basi",
                "Defense Level": "Livello Difensiva",
                "First Offense": "Prima Attaccante",
                "General Information": "Informazioni Generali",
                "Hours": "Orario",
                "Infantry Repairtime": "Tempo di riparazione Fanteria",
                "Maximal CP": "Comando il Massimo dei Punti",
                "Maximal Reptime": "Tempo Massimo di Riparazione",
                "Members": "Membri",
                "Offense Bases Count": "Basi numero Attaccante",
                "Offense Level": "Livello Attaccante",
                "Player Class": "Fazione",
                "Player Name": "Nome Giocatore",
                "Players Production": "Giocatori di produzione",
                "Power": "Energia",
                "Power Produktion": "Produzione di Energia",
                "Rank": "rango",
                "Second Offense": "Secondo Attaccante",
                "Server Language": "Lingua Server",
                "Support Building Level Ø": "Supporto Livello Edificio Ø",
                "Tiberium Production": "Produzione del Tiberium",
                "Total Crystal Production": "Produzione del Cristallo totale",
                "Total Power Production": "Produzione del Energia totale",
                "Total Production": "La produzione totale",
                "Total Tiberium Production": "Produzione del Tiberium totale",
                "Vehicle Repairtime": "Tempo di riparazione Veicolo",
                "all bases": "tutte le basi",
                "inclusive Bonus POI": "compresi POI Bonus"
              },
              "pt": {
                "Account Creation": "A criação de Contas",
                "Aircraft Repairtime": "Tempo de reparação de aeronaves",
                "Alliance Role": "papel Alliance",
                "Base Level": "Nível Básico",
                "Base Name": "basename",
                "Basecount": "Número de base",
                "Credit": "crédito",
                "Credit Production": "produção de Crédito",
                "Crystal": "cristal",
                "Crystal Production": "produção de cristal",
                "Current Time": "Tempo Atual",
                "DF Ø all Bases": "DF Ø todas as bases",
                "Def Ø all Bases": "Def Ø todas as bases",
                "Defense Level": "Nível defensivo",
                "First Offense": "primeiro Ofensivo",
                "General": "geralmente",
                "General Information": "Informação Geral",
                "Homepage": "site",
                "Hours": "horas",
                "Infantry Repairtime": "Tempo de reparação de infantaria",
                "Maximal CP": "CP máxima",
                "Maximal Reptime": "Repzeit máxima",
                "Members": "membros",
                "Offense Bases Count": "Número bases ofensivas",
                "Offense Level": "Nível ofensivo",
                "Player Class": "Classe jogador",
                "Player Name": "Nome Jogadores",
                "Players Production": "jogadores de Produção",
                "Power": "atual",
                "Power Produktion": "A produção atual",
                "Rank": "categoria",
                "Second Offense": "segundo Ofensivo",
                "Server Language": "Servidor Idioma",
                "Support Building Level Ø": "Suporte Nível Edifício Ø",
                "Tiberium Production": "produção Tiberium",
                "Total Crystal Production": "A produção total de cristal",
                "Total Power Production": "A produção total de electricidade",
                "Total Production": "A produção total",
                "Total Tiberium Production": "A produção total de Tiberium",
                "Vehicle Repairtime": "Tempo de reparação de veículos",
                "all bases": "todas as bases",
                "inclusive Bonus POI": "incluindo POI Bonus"
              },
              "nl": {
                "Account Creation": "Aanmaken van een Account",
                "Aircraft Repairtime": "Vliegtuigen reparatietijd",
                "Alliance Role": "Alliance rol",
                "Base Level": "Basic Level",
                "Base Name": "basename",
                "Basecount": "Base Number",
                "Credit": "krediet",
                "Credit Production": "credit productie",
                "Crystal": "kristal",
                "Crystal Production": "Crystal productie",
                "Current Time": "huidige Tijd",
                "DF Ø all Bases": "DF Ø alle bases",
                "Def Ø all Bases": "Def Ø alle bases",
                "Defense Level": "defensieve Level",
                "First Offense": "eerste Offensive",
                "General": "algemeen",
                "General Information": "Algemene Informatie",
                "Homepage": "website",
                "Infantry Repairtime": "Infanterie reparatietijd",
                "Maximal CP": "maximale CP",
                "Maximal Reptime": "maximale Repzeit",
                "Members": "leden",
                "Offense Bases Count": "Aantal offensief bases",
                "Offense Level": "Offensive Level",
                "Player Name": "spelers Naam",
                "Players Production": "spelers Production",
                "Power": "stroom",
                "Power Produktion": "De huidige productie",
                "Rank": "rang",
                "Second Offense": "tweede Offensive",
                "Server Language": "Server Taal",
                "Support Building Level Ø": "Ondersteuning Building Level Ø",
                "Tiberium Production": "Tiberium productie",
                "Total Crystal Production": "Totaal kristal productie",
                "Total Power Production": "Totale elektriciteitsproductie",
                "Total Production": "De totale productie",
                "Total Tiberium Production": "Totaal Tiberium productie",
                "Vehicle Repairtime": "Voertuig reparatietijd",
                "all bases": "alle bases",
                "inclusive Bonus POI": "waaronder POI Bonus"
              },
              "pl": {
                "Account Creation": "Utworzenie Konta",
                "Aircraft Repairtime": "Samoloty czas naprawy",
                "Alliance Role": "rola sojuszu",
                "Base Level": "Poziom Podstawowy",
                "Base Name": "basename",
                "Basecount": "Ilosc bazowa",
                "Credit": "kredyt",
                "Credit Production": "produkcja kredytowej",
                "Crystal": "krysztal",
                "Crystal Production": "produkcji krysztalu",
                "Current Time": "Obecny Czas",
                "DF Ø all Bases": "DF Ø wszystkich baz",
                "Def Ø all Bases": "Def Ø wszystkich baz",
                "Defense Level": "Defensywny Level",
                "First Offense": "pierwszy Ofensywny",
                "General": "ogólny",
                "General Information": "Informacje Ogólne",
                "Homepage": "witryna internetowa",
                "Hours": "godziny",
                "Infantry Repairtime": "Czas naprawy Piechota",
                "Maximal CP": "Maksymalna CP",
                "Maximal Reptime": "Maksymalna Repzeit",
                "Members": "Uzytkownicy",
                "Offense Bases Count": "Podstawy Liczba obrazliwe",
                "Offense Level": "Ofensywny Level",
                "Player Class": "Klasa graczem",
                "Player Name": "Gracze Nazwa",
                "Players Production": "Gracze Produkcja",
                "Power": "prad",
                "Power Produktion": "Obecna produkcja",
                "Rank": "ranga",
                "Second Offense": "drugi Ofensywny",
                "Server Language": "Serwer Jezyk",
                "Support Building Level Ø": "Pomoc budynek Poziom Ø",
                "Tiberium": "tyberium",
                "Tiberium Production": "produkcja tyberium",
                "Total Crystal Production": "Calkowita produkcja krysztalów",
                "Total Power Production": "Calkowita produkcja energii elektrycznej",
                "Total Production": "Calkowita produkcja",
                "Total Tiberium Production": "Calkowita produkcja tyberium",
                "Vehicle Repairtime": "Czas naprawy pojazdu",
                "all bases": "wszystkie zasady",
                "inclusive Bonus POI": "w tym Bonus POI"
              },
              "ro": {
                "Account Creation": "Crearea de Conturi",
                "Aircraft Repairtime": "Timp de Repara?ii de Avioane",
                "Alliance Role": "Rol Alian?a",
                "Base Level": "Nivelul de Baza",
                "Base Name": "Numele de Baza",
                "Basecount": "Numarul de Baza",
                "Credit Production": "Produc?ia de Credit",
                "Crystal": "Cristal",
                "Crystal Production": "Produc?ia de Cristal",
                "Current Time": "Ora curenta",
                "DF Ø all Bases": "Ø Unitate de Aparare Toate Bazele",
                "Def Ø all Bases": "Ø Unitate de Def Toate Bazele",
                "Defense Level": "Nivelul Defensiv",
                "First Offense": "Primul Ofensiva",
                "General": "Generale",
                "General Information": "Informa?ii Generale",
                "Homepage": "Pagina de start",
                "Hours": "Ore",
                "Infantry Repairtime": "Timp de Repara?ii de Infanterie",
                "Maximal CP": "Puncte de Comando Maxime",
                "Maximal Reptime": "Timp Maxim de Repara?ie",
                "Members": "Membrii",
                "Offense Bases Count": "Baze numar Ofensiva",
                "Offense Level": "Nivelul Ofensiva",
                "Player Class": "Clasa Jucator",
                "Player Name": "Nume Jucator",
                "Players Production": "Jucatori de Produc?ie",
                "Power": "Putere",
                "Power Produktion": "Produc?ia de Energie",
                "Rank": "Rang",
                "Second Offense": "Al Doilea Ofensiva",
                "Server Language": "Limbaj Server",
                "Support Building Level Ø": "Suport de Constructii Nivel Ø",
                "Tiberium Production": "Produc?ia de Tiberium",
                "Total Crystal Production": "Produc?ia Totala de Cristal",
                "Total Power Production": "Produc?ia Totala de Putere",
                "Total Production": "Produc?ia totala",
                "Total Tiberium Production": "Produc?ia Totala de Tiberium",
                "Vehicle Repairtime": "Timp de Repara?ii de Vehicul",
                "all bases": "toate bazele",
                "inclusive Bonus POI": "inclusiv de POI"
              },
              "hu": {
                "Account Creation": "Fiók Létrehozása",
                "Aircraft Repairtime": "Repülogép Javítási Ido",
                "All army units": "Minden katonai egység",
                "All buildings": "Összes létesítmény",
                "All defense units": "Minden védelmi egység",
                "Alliance Role": "Szövetség Szerepe",
                "Base Level": "Bázis Szint",
                "Base Name": "Bázis Név",
                "Basecount": "Szám Bázisok",
                "Credit": "Kredit",
                "Credit Production": "Összes Kredit Termelés",
                "Crystal": "Kristály",
                "Crystal Production": "Összes Kristály Termelés",
                "Current Time": "Ido",
                "DF Ø all Bases": "Védelem Létrehozása Ø Összes Bázisok",
                "Def Ø all Bases": "Def Ø Összes Bázisok",
                "Defense Level": "Védelmi Szint",
                "First Offense": "Elso Támadó",
                "General": "Általános",
                "General Information": "Általános Információk",
                "Homepage": "Honlap",
                "Hours": "Óra",
                "Infantry Repairtime": "Gyalogos Javítási Ido",
                "Maximal CP": "Maximális Parancsnoki Pont",
                "Maximal Reptime": "Maximális Javítási Ido",
                "Members": "Tagok",
                "Offense Bases Count": "Szám Sérto Bázisok",
                "Offense Level": "Támadó Szint",
                "Player Class": "Töredék",
                "Player Name": "Játékos Neve",
                "Players Production": "A játékosok Termelés",
                "Power": "Áram",
                "Power Produktion": "Áram Termelés",
                "Rank": "Helyezés",
                "Second Offense": "Második Támadó",
                "Selected army unit": "Kiválasztott katonai egység",
                "Selected building": "Kiválasztott létesítmény",
                "Selected defense unit": "Kiválasztott védelmi egység",
                "Server Language": "Szerver nyelv",
                "Support Building Level Ø": "Támogatás Építési Szint Ø",
                "Tiberium": "Tibérium",
                "Tiberium Production": "Összes Tibérium Termelés",
                "Total Crystal Production": "Összes Kristály Termelés",
                "Total Power Production": "Összes Áram Termelés",
                "Total Production": "Összes termelés",
                "Total Tiberium Production": "Összes Tibérium Termelés",
                "Vehicle Repairtime": "Jármu Javítási Ido",
                "all bases": "minden bázisok",
                "inclusive Bonus POI": "beleértve POI Bonus"
              },
              "tr": {
                "Account Creation": "Hesap Olusturma",
                "Aircraft Repairtime": "Uçak onarim süresi",
                "Alliance Role": "Ittifak rolü",
                "Base Level": "Üs seviye",
                "Base Name": "Üs isim",
                "Basecount": "Üs Numarasi",
                "Credit": "Kredi",
                "Credit Production": "Toplam kredi üretimi",
                "Crystal": "Kristal",
                "Crystal Production": "Toplam Kristal üretimi",
                "Current Time": "simdiki zaman",
                "DF Ø all Bases": "Savunma Tesis Ø bütün Üs",
                "Def Ø all Bases": "Def Ø bütün Üs",
                "Defense Level": "Defansif Seviye",
                "First Offense": "Birinci Ofansif",
                "General": "Genel",
                "General Information": "Genel bilgi",
                "Homepage": "Anasayfa",
                "Hours": "Saatleri",
                "Infantry Repairtime": "Piyade onarim süresi",
                "Maximal CP": "Maksimum Komutanligi Puan",
                "Maximal Reptime": "Maksimum onarim süresi",
                "Members": "Üyeler",
                "Offense Bases Count": "Numara saldirgan Üs",
                "Offense Level": "Saldirgan Seviye",
                "Player Class": "Grup",
                "Player Name": "Oyuncu Adi",
                "Players Production": "Oyuncular Üretim",
                "Power": "Enerji",
                "Power Produktion": "enerji üretimi",
                "Rank": "Derece",
                "Second Offense": "Ikinci bir Ofansif",
                "Server Language": "Sunucu Dil",
                "Support Building Level Ø": "Destek Bina Seviye Ø",
                "Tiberium Production": "Toplam Tiberium üretimi",
                "Total Crystal Production": "Toplam Kristal üretimi",
                "Total Power Production": "Toplam enerji üretimi",
                "Total Production": "Toplam Üretim",
                "Total Tiberium Production": "Toplam Tiberium üretimi",
                "Vehicle Repairtime": "Araç onarim süresi",
                "all bases": "tüm üsleri",
                "inclusive Bonus POI": "dahil POI Bonus"
              },
              "cs": {
                "Account Creation": "Vytvorení úctu",
                "Aircraft Repairtime": "Oprava letadla cas",
                "Alliance Role": "Alliance role",
                "Base Level": "Základní Úroven",
                "Base Name": "basename",
                "Basecount": "Základní Number",
                "Credit": "úver",
                "Credit Production": "Credit výroba",
                "Crystal": "krystal",
                "Crystal Production": "výroba Crystal",
                "Current Time": "Aktuální cas",
                "DF Ø all Bases": "DF Ø Všechny základny",
                "Def Ø all Bases": "Def Ø Všechny základny",
                "Defense Level": "defenzivní Level",
                "First Offense": "První Ofenzivní",
                "General": "obecný",
                "General Information": "Obecná Informace",
                "Homepage": "webové stránky",
                "Hours": "hodiny",
                "Infantry Repairtime": "Pechota doba opravy",
                "Maximal CP": "Maximální CP",
                "Maximal Reptime": "Maximální Repzeit",
                "Members": "Clenové",
                "Offense Bases Count": "Pocet ofenzivní základny",
                "Offense Level": "Ofenzivní Level",
                "Player Class": "hrác Class",
                "Player Name": "hráci Jméno",
                "Players Production": "hráci Production",
                "Power": "proud",
                "Power Produktion": "Aktuální produkce",
                "Rank": "hodnost",
                "Second Offense": "druhý Ofenzivní",
                "Server Language": "Serveru Jazyka",
                "Support Building Level Ø": "Podpora budova úroven Ø",
                "Tiberium Production": "výroba Tiberium",
                "Total Crystal Production": "Celková produkce krystal",
                "Total Power Production": "Celková výroba elektrické energie",
                "Total Production": "celková produkce",
                "Total Tiberium Production": "Celková výroba Tiberium",
                "Vehicle Repairtime": "Opravy vozidel cas",
                "all bases": "všechny základny",
                "inclusive Bonus POI": "vcetne POI Bonus"
              },
              "sk": {
                "Account Creation": "Vytvorenie úctu",
                "Aircraft Repairtime": "Oprava lietadla cas",
                "Alliance Role": "alliance role",
                "Base Level": "základné Úroven",
                "Base Name": "basename",
                "Basecount": "základné Number",
                "Credit": "úver",
                "Credit Production": "credit výroba",
                "Crystal": "kryštál",
                "Crystal Production": "výroba Crystal",
                "Current Time": "aktuálny cas",
                "DF Ø all Bases": "DF Ø Všetky základne",
                "Def Ø all Bases": "Def Ø Všetky základne",
                "Defense Level": "defenzívne Level",
                "First Offense": "prvý Ofenzívny",
                "General": "obvykle",
                "General Information": "Všeobecná Informácie",
                "Homepage": "webové stránky",
                "Hours": "hodiny",
                "Infantry Repairtime": "Pechota doba opravy",
                "Maximal CP": "maximálna CP",
                "Maximal Reptime": "maximálna Repzeit",
                "Members": "clenovia",
                "Offense Bases Count": "Pocet ofenzívnej základne",
                "Offense Level": "ofenzívny Level",
                "Player Class": "hrác Class",
                "Player Name": "hráci Meno",
                "Players Production": "hráci Production",
                "Power": "prúd",
                "Power Produktion": "aktuálnej produkcie",
                "Rank": "hodnost",
                "Second Offense": "druhý Ofenzívny",
                "Server Language": "Servera Language",
                "Support Building Level Ø": "Podpora budova úroven Ø",
                "Tiberium Production": "výroba Tiberium",
                "Total Crystal Production": "Celková produkcia kryštál",
                "Total Power Production": "Celková výroba elektrickej energie",
                "Total Production": "Celková produkcia",
                "Total Tiberium Production": "Celková výroba Tiberium",
                "Vehicle Repairtime": "Opravy vozidiel cas",
                "all bases": "všetky základne",
                "inclusive Bonus POI": "vrátane POI Bonus"
              },
              "sv": {
                "Account Creation": "skapa konto",
                "Aircraft Repairtime": "Flygplan reparationstiden",
                "Alliance Role": "Alliance roll",
                "Base Level": "Grundläggande nivå",
                "Base Name": "grundnamn",
                "Basecount": "basnummer",
                "Credit": "kredit",
                "Credit Production": "kredit produktion",
                "Crystal": "kristall",
                "Crystal Production": "kristallproduktion",
                "Current Time": "Aktuell tid",
                "DF Ø all Bases": "DF Ø alla baser",
                "Def Ø all Bases": "Def Ø alla baser",
                "Defense Level": "defensiv Nivå",
                "First Offense": "första offensiv",
                "General": "Allmänt",
                "General Information": "Allmän Information",
                "Homepage": "Webbplats",
                "Hours": "timmar",
                "Infantry Repairtime": "Infanteri reparationstiden",
                "Maximal CP": "maximal CP",
                "Maximal Reptime": "maximal Repzeit",
                "Members": "Medlemmar",
                "Offense Bases Count": "Antal offensiva baser",
                "Offense Level": "offensiv Nivå",
                "Player Class": "Spelar klass",
                "Player Name": "spelare Namn",
                "Players Production": "spelare Produktion",
                "Power": "Aktuell",
                "Power Produktion": "Aktuell produktion",
                "Rank": "Placering",
                "Second Offense": "andra Offensive",
                "Server Language": "Serverspråk",
                "Tiberium Production": "Tiberium produktion",
                "Total Crystal Production": "Totalt kristallproduktion",
                "Total Power Production": "Total elproduktion",
                "Total Production": "Total produktion",
                "Total Tiberium Production": "Totalt Tiberium produktion",
                "Vehicle Repairtime": "Fordonsreparationstiden",
                "all bases": "alla baser",
                "inclusive Bonus POI": "inklusive POI Bonus"
              },
              "nb": {
                "Account Creation": "kontoopprettelse",
                "Aircraft Repairtime": "Aircraft reparasjonstiden",
                "Alliance Role": "Alliance rolle",
                "Base Level": "grunnleggende nivå",
                "Base Name": "basename",
                "Basecount": "Base Number",
                "Credit Production": "Credit produksjon",
                "Crystal": "krystall",
                "Crystal Production": "Crystal produksjon",
                "Current Time": "Nåværende Tid",
                "DF Ø all Bases": "DF Ø alle baser",
                "Def Ø all Bases": "Def Ø alle baser",
                "Defense Level": "defensive nivå",
                "First Offense": "First Offensive",
                "General": "Generelt",
                "General Information": "Generell Informasjon",
                "Homepage": "nettsted",
                "Hours": "timer",
                "Infantry Repairtime": "Infantry reparasjonstiden",
                "Maximal CP": "maksimal CP",
                "Maximal Reptime": "maksimal Repzeit",
                "Members": "medlemmer",
                "Offense Bases Count": "Antall offensive baser",
                "Offense Level": "offensive nivå",
                "Player Class": "spiller Class",
                "Player Name": "spillere Navn",
                "Players Production": "spillere Produksjon",
                "Power": "Nåværende",
                "Power Produktion": "dagens produksjon",
                "Second Offense": "Second Offensive",
                "Server Language": "Server Språk",
                "Support Building Level Ø": "Support Bygning Nivå Ø",
                "Tiberium Production": "Tiberium produksjon",
                "Total Crystal Production": "Total krystall produksjon",
                "Total Power Production": "Total produksjon av elektrisitet",
                "Total Production": "Total produksjon",
                "Total Tiberium Production": "Total Tiberium produksjon",
                "Vehicle Repairtime": "Vehicle reparasjonstiden",
                "all bases": "alle baser",
                "inclusive Bonus POI": "inkludert POI Bonus"
              },
              "da": {
                "Account Creation": "Kontooprettelse",
                "Aircraft Repairtime": "Aircraft reparationstid",
                "Alliance Role": "alliance rolle",
                "Base Level": "grundlæggende Level",
                "Base Name": "basename",
                "Basecount": "Base Number",
                "Credit Production": "Credit produktion",
                "Crystal": "krystal",
                "Crystal Production": "krystal produktion",
                "Current Time": "Aktuel tid",
                "DF Ø all Bases": "DF Ø alle baser",
                "Def Ø all Bases": "Def Ø alle baser",
                "Defense Level": "defensiv Level",
                "First Offense": "First Offensive",
                "General": "generelt",
                "General Information": "generelle oplysninger",
                "Homepage": "websted",
                "Hours": "Timer",
                "Infantry Repairtime": "Infanteri reparationstid",
                "Maximal CP": "maksimal CP",
                "Maximal Reptime": "maksimal Repzeit",
                "Members": "medlemmer",
                "Offense Bases Count": "Nummer offensive baser",
                "Offense Level": "offensiv Level",
                "Player Class": "Spiller Class",
                "Player Name": "spillere Navn",
                "Power": "nuværende",
                "Power Produktion": "nuværende produktion",
                "Second Offense": "Second Offensive",
                "Server Language": "Server Sprog",
                "Tiberium Production": "Tiberium produktion",
                "Total Crystal Production": "Samlede krystal produktion",
                "Total Power Production": "Samlet elproduktion",
                "Total Production": "samlet produktion",
                "Total Tiberium Production": "Total Tiberium produktion",
                "Vehicle Repairtime": "Køretøj reparationstid",
                "all bases": "alle baser",
                "inclusive Bonus POI": "herunder POI Bonus"
              },
              "fi": {
                "Account Creation": "Tilin Luominen",
                "Aircraft Repairtime": "Lentokoneiden korjaus- aika",
                "Alliance Role": "Alliance rooli",
                "Base Level": "Perustaso",
                "Base Name": "basename",
                "Basecount": "Base Number",
                "Credit": "luotto",
                "Credit Production": "luotto tuotanto",
                "Crystal": "kristalli",
                "Crystal Production": "Crystal tuotanto",
                "Current Time": "Nykyinen aika",
                "DF Ø all Bases": "DF Ø kaikki alustat",
                "Def Ø all Bases": "Def Ø kaikki alustat",
                "Defense Level": "puolustava Level",
                "First Offense": "First Hyökkäävä",
                "General": "yleinen",
                "General Information": "Yleistiedot",
                "Homepage": "verkkosivusto",
                "Hours": "tuntia",
                "Infantry Repairtime": "Jalkaväki korjausaika",
                "Maximal CP": "Suurin CP",
                "Maximal Reptime": "Suurin Repzeit",
                "Members": "jäsenet",
                "Offense Bases Count": "Numero loukkaavaa emäkset",
                "Offense Level": "Hyökkäävä Level",
                "Player Name": "Pelaajat Nimi",
                "Players Production": "Pelaajat Tuotanto",
                "Power": "nykyinen",
                "Power Produktion": "Nykyinen tuotanto",
                "Rank": "arvo",
                "Second Offense": "toinen Hyökkäävä",
                "Server Language": "Server Kieli",
                "Support Building Level Ø": "Tuki Building Level Ø",
                "Tiberium Production": "Tiberium tuotanto",
                "Total Crystal Production": "Total kristalli tuotanto",
                "Total Power Production": "Koko sähköntuotannosta",
                "Total Production": "kokonaistuotanto",
                "Total Tiberium Production": "Total Tiberium tuotanto",
                "Vehicle Repairtime": "Ajoneuvojen korjausaika",
                "all bases": "kaikki alustat",
                "inclusive Bonus POI": "mukaan lukien KP Bonus"
              },
              "hr": {
                "Account Creation": "Izrada Racuna",
                "Aircraft Repairtime": "Vrijeme popravak zrakoplova",
                "Alliance Role": "Savez uloga",
                "Base Level": "Osnovna razina",
                "Base Name": "basename",
                "Basecount": "baza broj",
                "Credit": "kredit",
                "Credit Production": "Kreditni proizvodnja",
                "Crystal": "kristal",
                "Crystal Production": "Crystal proizvodnja",
                "Current Time": "Trenutno vrijeme",
                "DF Ø all Bases": "DF Ø Svi baze",
                "Def Ø all Bases": "Def Ø Svi baze",
                "Defense Level": "Povucen Razina",
                "First Offense": "Prvo Uvredljiva",
                "General": "obicno",
                "General Information": "Opce Informacije",
                "Homepage": "website",
                "Hours": "Radno vrijeme",
                "Infantry Repairtime": "Vrijeme Pješacko popravak",
                "Maximal CP": "maksimalna CP",
                "Maximal Reptime": "maksimalna Repzeit",
                "Members": "clanovi",
                "Offense Bases Count": "Broj uvredljive baze",
                "Offense Level": "Uvredljiva Razina",
                "Player Class": "igrac klase",
                "Player Name": "igraci Ime",
                "Players Production": "igraci Proizvodnja",
                "Power": "struja",
                "Power Produktion": "Trenutna proizvodnja",
                "Rank": "cin",
                "Second Offense": "Drugo Uvredljiva",
                "Server Language": "Poslužitelj Jezik",
                "Support Building Level Ø": "Podrška Gradevinska Razina Ø",
                "Tiberium Production": "proizvodnja Tiberium",
                "Total Crystal Production": "Ukupna proizvodnja kristala",
                "Total Power Production": "Ukupna proizvodnja elektricne energije",
                "Total Production": "Ukupna proizvodnja",
                "Total Tiberium Production": "Ukupno Tiberium proizvodnja",
                "Vehicle Repairtime": "Vrijeme za popravak vozila",
                "all bases": "sve baze",
                "inclusive Bonus POI": "ukljucujuci POI bonus"
              },
              "uk": {
                "Base Name": "Basename"
              },
              "be": {
                "Base Name": "Basename"
              },
              "bg": {
                "Base Name": "Basename",
                "Basecount": "Base Number",
                "Offense Level": "Offensive Level"
              },
              "el": {
                "Base Name": "basename"
              },
              "ar": {
                "Base Name": "Basename"
              },
              "id": {
                "Account Creation": "Pembuatan Akun",
                "Aircraft Repairtime": "Waktu perbaikan Pesawat",
                "Alliance Role": "peran aliansi",
                "Base Level": "Tingkat Dasar",
                "Base Name": "basename",
                "Basecount": "Jumlah dasar",
                "Credit": "kredit",
                "Credit Production": "produksi kredit",
                "Crystal": "kristal",
                "Crystal Production": "produksi kristal",
                "Current Time": "Waktu Saat Ini",
                "DF Ø all Bases": "DF Ø semua basis",
                "Def Ø all Bases": "Def Ø semua basis",
                "Defense Level": "Tingkat defensif",
                "First Offense": "pertama Serangan",
                "General": "umum",
                "General Information": "Informasi Umum",
                "Homepage": "situs web",
                "Hours": "jam",
                "Infantry Repairtime": "Waktu perbaikan Infanteri",
                "Maximal CP": "maksimum CP",
                "Maximal Reptime": "Repzeit maksimum",
                "Members": "anggota",
                "Offense Bases Count": "Basis Nomor ofensif",
                "Offense Level": "Tingkat Serangan",
                "Player Class": "pemain Kelas",
                "Player Name": "pemain Nama",
                "Players Production": "Produksi pemain",
                "Power": "arus",
                "Power Produktion": "produksi saat ini",
                "Rank": "pangkat",
                "Second Offense": "kedua Serangan",
                "Server Language": "Server Bahasa",
                "Support Building Level Ø": "Dukungan Building Tingkat Ø",
                "Tiberium Production": "produksi Tiberium",
                "Total Crystal Production": "Total produksi kristal",
                "Total Power Production": "Total produksi listrik",
                "Total Production": "total produksi",
                "Total Tiberium Production": "Total produksi Tiberium",
                "Vehicle Repairtime": "Waktu perbaikan kendaraan",
                "all bases": "semua basis",
                "inclusive Bonus POI": "termasuk Bonus POI"
              }
            };
            var lang = null;
            // Language override is stored in a STABLE, player-independent localStorage key (NOT the
            // per-player NS.settings store): detect() runs on the FIRST t() call, which can fire at page
            // load before the player/world is loaded - at which point NS.settings.storeKey() falls back to
            // a "default" bucket and would miss a per-player override, caching "en" for the whole session.
            // localStorage is readable synchronously at any time, so the override always sticks across reload.
            var LANG_KEY = "MM.i18n.lang";
            function detect() {
                try { var o = window.localStorage.getItem(LANG_KEY); if (o) return String(o); } catch (e) {}
                try { var l = qx.locale.Manager.getInstance().getLocale(); if (l) return String(l).split("_")[0]; } catch (e) {}
                try { if (navigator && navigator.language) return String(navigator.language).split("-")[0]; } catch (e) {}
                return "en";
            }
            function cur() { if (lang == null) lang = detect(); return lang; }
            function t(s) {
                if (s == null) return s;
                var L = cur();
                if (L === "en") return s;
                var d = CATALOGS[L];
                return (d && d[s] != null) ? d[s] : s;
            }
            return {
                t: t,
                getLang: function () { return cur(); },
                // Force a language code ("en","de",...) persisted in localStorage (survives reload,
                // shared across all worlds), or pass a falsy value to clear it and re-detect the game locale.
                setLang: function (l) {
                    try { if (l) window.localStorage.setItem(LANG_KEY, l); else window.localStorage.removeItem(LANG_KEY); } catch (e) {}
                    lang = l || detect();
                    return lang;
                },
                // Merge more strings into a language catalog at runtime.
                add: function (l, map) {
                    var d = CATALOGS[l] || (CATALOGS[l] = {});
                    for (var k in map) if (map.hasOwnProperty(k)) d[k] = map[k];
                    return d;
                },
                catalogs: CATALOGS
            };
        })();

        // -------------------------------------------------------------------
        // num - compact number formatting (k / M / G / T)
        // -------------------------------------------------------------------
        NS.num = {
            compact: function (n, dec) {
                if (typeof n !== "number" || !isFinite(n)) return String(n);
                dec = (dec == null) ? 1 : dec;
                var a = Math.abs(n), s = n < 0 ? "-" : "";
                if (a >= 1e12) return s + (a / 1e12).toFixed(dec) + "T";
                if (a >= 1e9) return s + (a / 1e9).toFixed(dec) + "G";
                if (a >= 1e6) return s + (a / 1e6).toFixed(dec) + "M";
                if (a >= 1e3) return s + (a / 1e3).toFixed(dec) + "k";
                return s + a.toFixed(0);
            }
        };

        // -------------------------------------------------------------------
        // color - rgb interpolation + ratio->hex gradient. Salvaged from the
        // retired TA_Info_Sticker (interpolateColor / formatNumberColor). This is a
        // SMOOTH green->amber->red gradient; for the 3-step red/yellow/green bars use
        // the barColor pattern in Next MCV / Loot Summary instead.
        // -------------------------------------------------------------------
        NS.color = {
            // Linear interpolate two [r,g,b] arrays; s clamped to [0,1] -> [r,g,b].
            interpolate: function (c1, c2, s) {
                s = Math.max(0, Math.min(1, s));
                return [
                    Math.floor(c1[0] + s * (c2[0] - c1[0])),
                    Math.floor(c1[1] + s * (c2[1] - c1[1])),
                    Math.floor(c1[2] + s * (c2[2] - c1[2]))
                ];
            },
            // Map a fill ratio (value/max) to "#rrggbb": green up to 50%, blending to
            // amber by 75%, to red by 100%. Default palette = the old Info Sticker colours.
            ratioHex: function (ratio, palette) {
                if (!isFinite(ratio)) ratio = 0;
                ratio = Math.max(0, ratio);
                var p = palette || {};
                var green = p.green || [40, 150, 40];
                var middle = p.middle || [181, 151, 0];
                var red = p.red || [157, 43, 43];
                var c;
                if (ratio < 0.5) c = green;
                else if (ratio < 0.75) c = NS.color.interpolate(green, middle, (ratio - 0.5) / 0.25);
                else if (ratio < 1) c = NS.color.interpolate(middle, red, (ratio - 0.75) / 0.25);
                else c = red;
                try { return qx.util.ColorUtil.rgbToHexString(c); }
                catch (e) {
                    return "#" + c.map(function (n) { return (n < 16 ? "0" : "") + n.toString(16); }).join("");
                }
            },
            // Convenience matching the old formatNumberColor(value, max) signature.
            valueHex: function (value, max, palette) { return NS.color.ratioHex(max ? value / max : 0, palette); }
        };

        // -------------------------------------------------------------------
        // time - second -> H:MM:SS / D H:MM:SS
        // -------------------------------------------------------------------
        function pad2(n) { return (n < 10 ? "0" : "") + n; }
        NS.time = {
            hms: function (sec) {
                sec = Math.max(0, Math.floor(sec || 0));
                var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
                return h + ":" + pad2(m) + ":" + pad2(s);
            },
            dhms: function (sec) {
                sec = Math.max(0, Math.floor(sec || 0));
                var d = Math.floor(sec / 86400); sec -= d * 86400;
                var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
                return (d > 0 ? d + "d " : "") + h + ":" + pad2(m) + ":" + pad2(s);
            }
        };

        // -------------------------------------------------------------------
        // coords - parse / format [coords]X:Y[/coords], chat insert, map center, sector
        // -------------------------------------------------------------------
        NS.coords = {
            // Accepts "[coords]X:Y[/coords]" or "X:Y" / "X;Y" / "X,Y" / "X Y" / "X.Y". Returns {x,y} or null.
            parse: function (str) {
                if (str == null) return null;
                var s = String(str);
                var m = s.match(/\[coords\]\s*(\d+)\s*[:;,. ]\s*(\d+)\s*\[\/coords\]/i);
                if (m) return { x: +m[1], y: +m[2] };
                m = s.match(/(-?\d+)\s*[:;,. ]\s*(-?\d+)/);
                if (m) return { x: +m[1], y: +m[2] };
                return null;
            },
            format: function (x, y) { return "[coords]" + x + ":" + y + "[/coords]"; },
            // A replacement chat UI (e.g. MM - Translated Chat) registers its input here so that anything
            // aimed at the chat (Paste Coords, etc.) lands in whichever chat is actually ACTIVE. provider =
            // { isActive(): bool, insert(text): bool }. While isActive() is true, insertIntoChat routes text
            // to provider.insert instead of the native chat input (which may be hidden). Pass null to clear.
            _chatInput: null,
            setChatInputProvider: function (p) { this._chatInput = p || null; },
            // Insert text into the ACTIVE chat input (registered provider if open, else the native input).
            // Returns true on success.
            insertIntoChat: function (text) {
                try {
                    var p = this._chatInput;
                    if (p && p.isActive && p.isActive()) {
                        try { if (p.insert(text) !== false) return true; } catch (e) { NS.log.err("chatInput provider:", e); }
                    }
                } catch (e) {}
                try {
                    var dom = qx.core.Init.getApplication().getChat().getChatWidget().getEditable()
                        .getContentElement().getDomElement();
                    if (!dom) return false;
                    var a = dom.selectionStart, b = dom.selectionEnd, v = dom.value;
                    dom.value = v.substring(0, a) + text + v.substring(b);
                    dom.selectionStart = dom.selectionEnd = a + text.length;
                    dom.focus();
                    return true;
                } catch (e) { return false; }
            },
            // Pan the region map to a grid coordinate (assumes you're already in region view).
            center: function (x, y) {
                try { ClientLib.Vis.VisMain.GetInstance().get_Region().CenterGridPosition(x, y); return true; }
                catch (e) { return false; }
            },
            // Leave any open base view and return to the region/area map. IMPORTANT: the in-base screen
            // is a GUI OVERLAY, not a VisMain mode - calling VisMain.set_Mode(Region) alone flips the
            // internal mode but leaves the base overlay on screen. The game's own "close base" button
            // ultimately calls Application.showMainOverlay() (sniffed from its _onClose handler), which
            // tears down the base overlay AND sets region mode. We do the same, then re-assert the mode
            // as a belt-and-braces fallback for clients where showMainOverlay isn't present.
            exitToRegion: function () {
                var ok = false;
                try {
                    var app = qx.core.Init.getApplication();
                    if (app && typeof app.showMainOverlay === "function") { app.showMainOverlay(); ok = true; }
                } catch (e) { NS.log.warn("showMainOverlay failed:", e); }
                try { ClientLib.Vis.VisMain.GetInstance().set_Mode(ClientLib.Vis.Mode.Region); } catch (e) {}
                return ok;
            },
            // Go look at a coordinate: close any open base, switch to the region/area map AND center there.
            // The complete "jump to this base" helper (bare center() only pans, and only in region view).
            // NOTE: this does not natively SELECT/highlight the base - the Vis object the game's
            // set_SelectedObject() needs isn't reachable by any readable API (obfuscated, like the
            // base-edit move primitive); centering puts the base dead-centre, which is the reliable part.
            goTo: function (x, y) {
                try {
                    NS.coords.exitToRegion();
                    // center after the overlay/mode switch settles (a same-tick center can be lost)
                    try { ClientLib.Vis.VisMain.GetInstance().get_Region().CenterGridPosition(x, y); } catch (e) {}
                    window.setTimeout(function () { try { ClientLib.Vis.VisMain.GetInstance().get_Region().CenterGridPosition(x, y); } catch (e) {} }, 300);
                    return true;
                } catch (e) { NS.log.err("coords.goTo failed:", e); return false; }
            },
            // 8-way sector label of (x,y) relative to a center (cx,cy). Y grows downward.
            sector: function (x, y, cx, cy) {
                var dx = x - cx, dy = y - cy;
                if (dx === 0 && dy === 0) return "C";
                var ang = Math.atan2(-dy, dx) * 180 / Math.PI;
                if (ang < 0) ang += 360;
                return ["E", "NE", "N", "NW", "W", "SW", "S", "SE"][Math.round(ang / 45) % 8];
            },
            // Straight-line distance between two grid coords. Prefers the game's own
            // ClientLib.Base.Util.CalculateDistance (matches the in-game distance readout),
            // falling back to Euclidean. Always returns a finite Number. Salvaged from the
            // retired compass scripts (CD Compass / mhNavigator / Compass-ALT).
            distance: function (x1, y1, x2, y2) {
                try {
                    var U = ClientLib.Base.Util;
                    if (U && typeof U.CalculateDistance === "function") {
                        var d = U.CalculateDistance(x1, y1, x2, y2);
                        if (typeof d === "number" && !isNaN(d)) return d;
                    }
                } catch (e) {}
                var dx = x2 - x1, dy = y2 - y1;
                return Math.sqrt(dx * dx + dy * dy);
            }
        };

        // -------------------------------------------------------------------
        // deobf - generic helpers for de-obfuscating widget getters at runtime.
        // The Framework Wrapper already publishes the common ones (battle sim,
        // unit getters, WorldObject get_BaseLevel/getID/get_CampType). These
        // helpers cover the remaining per-widget cases (e.g. a StatusInfo widget's
        // getObject), so scripts don't each hand-roll the same regex.
        // -------------------------------------------------------------------
        NS.deobf = {
            // From a getter whose source is `return this.<6>.<6>` -> the inner field name (or null).
            fieldFromGetter: function (fn) {
                try {
                    var m = fn.toString().match(/return this\.[A-Z]{6}\.([A-Z]{6})/);
                    return m ? m[1] : null;
                } catch (e) { return null; }
            },
            // From a `setObject` of the form `function(a){this.MEMBER=a; ...}` -> "MEMBER" (or null).
            objectMemberOfSetter: function (setObjectFn) {
                try {
                    var m = setObjectFn.toString().match(/^function\s?\(([A-Za-z_$][\w$]*)\)\{this\.([A-Za-z_$][\w$]*)=\1;/);
                    return m ? m[2] : null;
                } catch (e) { return null; }
            },
            // Ensure proto.getObject exists by deriving the member from proto.setObject.
            // Returns true if getObject is available afterwards.
            ensureGetObject: function (proto) {
                try {
                    if (typeof proto.getObject === "function") return true;
                    if (typeof proto.setObject !== "function") return false;
                    var member = NS.deobf.objectMemberOfSetter(proto.setObject);
                    if (!member) return false;
                    proto.getObject = function () { return this[member]; };
                    return true;
                } catch (e) { return false; }
            }
        };

        // -------------------------------------------------------------------
        // Scaffolded modules - interfaces defined now, ported during migration.
        // They warn (once) instead of silently failing so consumers are obvious.
        // -------------------------------------------------------------------
        function todo(modName) {
            var warned = false;
            return function () {
                if (!warned) { warned = true; NS.log.warn(modName + " is not implemented yet (ported during script migration)."); }
                return null;
            };
        }

        // cnctaopt: encode a city/base into a cnctaopt.com share link.
        // Faithful port of TA_CnCTAOpt_Link_Button.user.js (zbluebugz, v1.0.7.7) - the LIVE cnctaopt.com
        // "ver=3" encoder: the base/defense/offense hotkey maps + the 20x9 grid walk + faction logic.
        // Runs in page context, so GAMEDATA / PerforceChangelist / ClientLib are available.
        //   MMCommon.cnctaopt.url(cityId) / .encode(cityId) -> full https://www.cnctaopt.com/index.html?... URL
        //   MMCommon.cnctaopt.payload(cityId)               -> the raw "ver=3~...~ML=.." string (pre-encodeURI)
        //   MMCommon.cnctaopt.open(cityId)                  -> opens the URL in a new tab; returns it
        // All return null (and warn) on error so callers can guard. cityId is a city/base id
        // (e.g. visObject.get_Id()); the base's data must be loaded (GetCity owner != 0).
        NS.cnctaopt = (function () {
            var clog = NS.makeLogger("cnctaopt");

            // base / defense / offense - map the game's unit names to cnctaopt's single-letter hotkeys.
            var base_unit_map = {
                /* GDI Buildings */
                "GDI_Construction Yard": "y", "GDI_Power Plant": "p", "GDI_Refinery": "r", "GDI_Silo": "s",
                "GDI_Accumulator": "a", "GDI_Command Center": "e", "GDI_Barracks": "b", "GDI_Factory": "f",
                "GDI_Airport": "d", "GDI_Defense HQ": "q", "GDI_Defense Facility": "w", "GDI_Support_Air": "i",
                "GDI_Support_Ion": "x", "GDI_Support_Art": "z", "GDI_Harvester": "h",
                "GDI_Harvester_Crystal": "n", "GDI_Harvester_Tiberium": "j",
                /* Nod Buildings */
                "NOD_Construction Yard": "y", "NOD_Power Plant": "p", "NOD_Refinery": "r", "NOD_Silo": "s",
                "NOD_Accumulator": "a", "NOD_Command Post": "e", "NOD_Barracks": "b", "NOD_Factory": "f",
                "NOD_Airport": "d", "NOD_Defense HQ": "q", "NOD_Defense Facility": "w", "NOD_Support_Air": "i",
                "NOD_Support_Ion": "x", "NOD_Support_Art": "z", "NOD_Harvester": "h",
                "NOD_Harvester_Crystal": "n", "NOD_Harvester_Tiberium": "j",
                /* Forgotten Buildings */
                "FOR_Construction Yard": "y", "FOR_Refinery": "r", "FOR_Trade Center": "u", "FOR_Silo": "s",
                "FOR_Defense HQ": "q", "FOR_Defense Facility": "w", "FOR_Harvester_Crystal": "n",
                "FOR_Harvester_Tiberium": "j", "FOR_Crystal Booster": "v", "FOR_Tiberium Booster": "o",
                /* Forgotten Infected Buildings */
                "FOR_EVENT_Construction_Yard": "y", "FOR_GDI_Construction Yard": "y", "FOR_GDI_Power Plant": "p",
                "FOR_GDI_Refinery": "r", "FOR_GDI_Silo": "s", "FOR_GDI_Accumulator": "a",
                "FOR_GDI_Command Center": "e", "FOR_GDI_Barracks": "b", "FOR_GDI_Factory": "f",
                "FOR_GDI_Airport": "d", "FOR_GDI_Defense HQ": "q", "FOR_GDI_Defense Facility": "w",
                "FOR_GDI_Support_Air": "i", "FOR_GDI_Support_Ion": "x", "FOR_GDI_Support_Art": "z",
                "FOR_GDI_Harvester": "h", "FOR_GDI_Harvester_Crystal": "n", "FOR_GDI_Harvester_Tiberium": "j",
                "FOR_NOD_Construction Yard": "y", "FOR_NOD_Power Plant": "p", "FOR_NOD_Refinery": "r",
                "FOR_NOD_Silo": "s", "FOR_NOD_Accumulator": "a", "FOR_NOD_Command Post": "e",
                "FOR_NOD_Barracks": "b", "FOR_NOD_Factory": "f", "FOR_NOD_Airport": "d", "FOR_NOD_Defense HQ": "q",
                "FOR_NOD_Defense Facility": "w", "FOR_NOD_Support_Air": "i", "FOR_NOD_Support_Ion": "x",
                "FOR_NOD_Support_Art": "z", "FOR_NOD_Harvester": "h", "FOR_NOD_Harvester_Crystal": "n",
                "FOR_NOD_Harvester_Tiberium": "j",
                "": ""
            };
            var defense_unit_map = {
                /* GDI */
                "GDI_Wall": "w", "GDI_Def_Predator": "d", "GDI_Turret": "m", "GDI_Def_Pitbull": "p",
                "GDI_Barbwire": "b", "GDI_Def_Zone Trooper": "z", "GDI_Flak": "f", "GDI_Def_Missile Squad": "q",
                "GDI_Antitank Barrier": "t", "GDI_Def_Sniper": "s", "GDI_Cannon": "c", "GDI_Def_APC Guardian": "g",
                "GDI_Art Tank": "a", "GDI_Art Air": "e", "GDI_Art Inf": "r",
                /* Nod */
                "NOD_Def_Wall": "w", "NOD_Def_Scorpion Tank": "d", "NOD_Def_MG Nest": "m",
                "NOD_Def_Attack Bike": "p", "NOD_Def_Barbwire": "b", "NOD_Def_Black Hand": "z", "NOD_Def_Flak": "f",
                "NOD_Def_Militant Rocket Soldiers": "q", "NOD_Def_Antitank Barrier": "t", "NOD_Def_Confessor": "s",
                "NOD_Def_Cannon": "c", "NOD_Def_Reckoner": "g", "NOD_Def_Art Tank": "a", "NOD_Def_Art Air": "e",
                "NOD_Def_Art Inf": "r",
                /* Forgotten */
                "FOR_Wall": "w", "FOR_Mammoth": "d", "FOR_Turret_VS_Inf": "m", "FOR_Veh_VS_Air": "p",
                "FOR_Barbwire_VS_Inf": "b", "FOR_Inf_VS_Veh": "z", "FOR_Turret_VS_Air": "f", "FOR_Inf_VS_Air": "q",
                "FOR_Barrier_VS_Veh": "t", "FOR_Sniper": "s", "FOR_Turret_VS_Veh": "c", "FOR_Veh_VS_Inf": "g",
                "FOR_Turret_VS_Veh_ranged": "a", "FOR_Turret_VS_Air_ranged": "e", "FOR_Turret_VS_Inf_ranged": "r",
                "FOR_Inf_VS_Inf": "i", "FOR_Veh_VS_Veh": "o",
                /* Forgotten Fortress */
                "FOR_Fortress_DEF_Sniper": "s", "FOR_Fortress_DEF_Inf_VS_Inf": "i", "FOR_Fortress_DEF_Veh_VS_Air": "p",
                "FOR_Fortress_DEF_Turret_VS_Inf": "m", "FOR_Fortress_DEF_Turret_VS_Veh": "c",
                "FOR_Fortress_DEF_Turret_VS_Air": "f", "FOR_Fortress_DEF_Turret_VS_Veh_ranged": "a",
                "FOR_Fortress_DEF_Turret_VS_Air_ranged": "e", "FOR_Fortress_DEF_Turret_VS_Inf_ranged": "r",
                "FOR_Fortress_DEF_Mammoth": "d",
                /* Forgotten Infected GDI */
                "FOR_GDI_Wall": "w", "FOR_GDI_Def_Predator": "d", "FOR_GDI_Turret": "m", "FOR_GDI_Def_Pitbull": "p",
                "FOR_GDI_Barbwire": "b", "FOR_GDI_Def_Zone Trooper": "z", "FOR_GDI_Flak": "f",
                "FOR_GDI_Def_Missile Squad": "q", "FOR_GDI_Antitank Barrier": "t", "FOR_GDI_Def_Sniper": "s",
                "FOR_GDI_Cannon": "c", "FOR_GDI_Def_APC Guardian": "g", "FOR_GDI_Art Tank": "a",
                "FOR_GDI_Art Air": "e", "FOR_GDI_Art Inf": "r",
                /* Forgotten Infected NOD */
                "FOR_NOD_Def_Wall": "w", "FOR_NOD_Def_Scorpion Tank": "d", "FOR_NOD_Def_MG Nest": "m",
                "FOR_NOD_Def_Attack Bike": "p", "FOR_NOD_Def_Barbwire": "b", "FOR_NOD_Def_Black Hand": "z",
                "FOR_NOD_Def_Flak": "f", "FOR_NOD_Def_Militant Rocket Soldiers": "q",
                "FOR_NOD_Def_Antitank Barrier": "t", "FOR_NOD_Def_Confessor": "s", "FOR_NOD_Def_Cannon": "c",
                "FOR_NOD_Def_Reckoner": "g", "FOR_NOD_Def_Art Tank": "a", "FOR_NOD_Def_Art Air": "e",
                "FOR_NOD_Def_Art Inf": "r",
                "": ""
            };
            var offense_unit_map = {
                /* GDI */
                "GDI_Riflemen": "i", "GDI_Missile Squad": "q", "GDI_Zone Trooper": "z", "GDI_Commando": "c",
                "GDI_Sniper Team": "s", "GDI_APC Guardian": "g", "GDI_Pitbull": "p", "GDI_Predator": "d",
                "GDI_Juggernaut": "j", "GDI_Mammoth": "a", "GDI_Orca": "v", "GDI_Firehawk": "f", "GDI_Paladin": "o",
                "GDI_Kodiak": "k",
                /* Nod */
                "NOD_Militants": "i", "NOD_Militant Rocket Soldiers": "q", "NOD_Black Hand": "z", "NOD_Commando": "c",
                "NOD_Confessor": "s", "NOD_Reckoner": "g", "NOD_Attack Bike": "p", "NOD_Scorpion Tank": "d",
                "NOD_Specter Artilery": "j", "NOD_Avatar": "a", "NOD_Venom": "v", "NOD_Vertigo": "f",
                "NOD_Cobra": "o", "NOD_Salamander": "k",
                "": ""
            };

            function findTechLayout(city) {
                for (var k in city) {
                    if ((typeof (city[k]) == "object") && city[k] && (0 in city[k]) && (8 in city[k])) {
                        if ((typeof (city[k][0]) == "object") && city[k][0] && (0 in city[k][0]) && (15 in city[k][0])) {
                            if ((typeof (city[k][0][0]) == "object") && city[k][0][0] && ("BuildingIndex" in city[k][0][0])) {
                                return city[k];
                            }
                        }
                    }
                }
                return null;
            }
            function findBuildings(city) {
                var cityBuildings = city.get_CityBuildingsData();
                for (var k in cityBuildings) {
                    if (PerforceChangelist >= 376877) {
                        if ((typeof (cityBuildings[k]) === "object") && cityBuildings[k] && ("d" in cityBuildings[k]) && ("c" in cityBuildings[k]) && (cityBuildings[k].c > 0)) {
                            return cityBuildings[k].d;
                        }
                    } else {
                        if ((typeof (cityBuildings[k]) === "object") && cityBuildings[k] && "l" in cityBuildings[k]) {
                            return cityBuildings[k].l;
                        }
                    }
                }
            }
            function isDefenseUnit(unit) { return (unit.get_UnitGameData_Obj().n in defense_unit_map); }
            function isOffenseUnit(unit) { return (unit.get_UnitGameData_Obj().n in offense_unit_map); }
            function getUnitArrays(city) {
                var ret = [];
                for (var k in city) {
                    if ((typeof (city[k]) == "object") && city[k]) {
                        for (var k2 in city[k]) {
                            var lst;
                            if (PerforceChangelist >= 376877) {
                                if ((typeof (city[k][k2]) == "object") && city[k][k2] && "d" in city[k][k2]) {
                                    lst = city[k][k2].d;
                                    if ((typeof (lst) == "object") && lst) {
                                        for (var i in lst) {
                                            if (typeof (lst[i]) == "object" && lst[i] && "get_CurrentLevel" in lst[i]) { ret.push(lst); }
                                        }
                                    }
                                }
                            } else {
                                if ((typeof (city[k][k2]) == "object") && city[k][k2] && "l" in city[k][k2]) {
                                    lst = city[k][k2].l;
                                    if ((typeof (lst) == "object") && lst) {
                                        for (var j in lst) {
                                            if (typeof (lst[j]) == "object" && lst[j] && "get_CurrentLevel" in lst[j]) { ret.push(lst); }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                return ret;
            }
            function getDefenseUnits(city) {
                var arr = getUnitArrays(city);
                for (var i = 0; i < arr.length; ++i) { for (var j in arr[i]) { if (isDefenseUnit(arr[i][j])) { return arr[i]; } } }
                return [];
            }
            function getOffenseUnits(city) {
                var arr = getUnitArrays(city);
                for (var i = 0; i < arr.length; ++i) { for (var j in arr[i]) { if (isOffenseUnit(arr[i][j])) { return arr[i]; } } }
                return [];
            }

            // Build the raw "ver=3~...~ML=.." payload for a city id (pre-encodeURI). Returns null on error.
            function payload(cityId) {
                try {
                    var city = ClientLib.Data.MainData.GetInstance().get_Cities().GetCity(cityId);
                    var own_city = ClientLib.Data.MainData.GetInstance().get_Cities().get_CurrentOwnCity();
                    var server = ClientLib.Data.MainData.GetInstance().get_Server();
                    if (!city) { clog.warn("payload: no city for id", cityId); return null; }
                    var coordX = city.get_X();
                    var coordY = city.get_Y();
                    var worldName = server.get_Name().trim();
                    var worldId = server.get_WorldId();
                    var maxLevel = server.get_PlayerUpgradeCap();
                    var economy = (server.get_TechLevelUpgradeFactorBonusAmount() != 1.20) ? "new" : "old";

                    var link = "ver=3~";
                    // base / defense faction (of the base being viewed)
                    var faction = city.get_CityFaction();
                    if (faction === 1) { link += "G~"; }
                    else if (faction === 2) { link += "N~"; }
                    else if (faction > 2 && faction < 9) { link += "F~"; }
                    else { clog.warn("Unknown faction (1):", faction); link += "E~"; }
                    // offense faction - for a Forgotten target, use the player's own offense setup
                    faction = city.get_CityFaction();
                    if (faction > 2) { faction = own_city.get_CityFaction(); }
                    if (faction === 1) { link += "G~"; }
                    else if (faction === 2) { link += "N~"; }
                    else { clog.warn("Unknown faction (2):", faction); link += "E~"; }
                    // city name
                    link += city.get_Name().trim() + "~";

                    // 20x9 defense-unit grid (offset +8)
                    var defense_units = [], i, j, col;
                    for (i = 0; i < 20; ++i) { col = []; for (j = 0; j < 9; ++j) { col.push(null); } defense_units.push(col); }
                    var defense_unit_list = getDefenseUnits(city);
                    for (i in defense_unit_list) { var du = defense_unit_list[i]; defense_units[du.get_CoordX()][du.get_CoordY() + 8] = du; }
                    // 20x9 offense-unit grid (offset +16); for a Forgotten target use own city's offense
                    var offense_units = [];
                    for (i = 0; i < 20; ++i) { col = []; for (j = 0; j < 9; ++j) { col.push(null); } offense_units.push(col); }
                    var offense_unit_list = (city.get_CityFaction() == 1 || city.get_CityFaction() == 2) ? getOffenseUnits(city) : getOffenseUnits(own_city);
                    for (i in offense_unit_list) { var ou = offense_unit_list[i]; offense_units[ou.get_CoordX()][ou.get_CoordY() + 16] = ou; }

                    // walk the 20x9 grid: building / defense / offense / terrain
                    var techLayout = findTechLayout(city);
                    var buildings = findBuildings(city);
                    for (i = 0; i < 20; ++i) {
                        for (j = 0; j < 9; ++j) {
                            var spot = i > 16 ? null : techLayout[j][i];
                            var level = 0;
                            var building = null;
                            if (spot && spot.BuildingIndex >= 0) { building = buildings[spot.BuildingIndex]; level = building.get_CurrentLevel(); }
                            var defense_unit = defense_units[j][i];
                            if (defense_unit) { level = defense_unit.get_CurrentLevel(); }
                            var offense_unit = offense_units[j][i];
                            if (offense_unit) { level = offense_unit.get_CurrentLevel(); }
                            if (level > 0) { link += level; }

                            switch (i > 16 ? 0 : city.GetResourceType(j, i)) {
                                case 0:
                                    if (building) {
                                        var techId = building.get_MdbBuildingId();
                                        if (GAMEDATA.Tech[techId].n in base_unit_map) { link += base_unit_map[GAMEDATA.Tech[techId].n]; }
                                        else { clog.warn("Unhandled building:", techId); link += "."; }
                                    } else if (defense_unit) {
                                        if (defense_unit.get_UnitGameData_Obj().n in defense_unit_map) { link += defense_unit_map[defense_unit.get_UnitGameData_Obj().n]; }
                                        else { clog.warn("Unhandled defense unit:", defense_unit.get_UnitGameData_Obj().n); link += "."; }
                                    } else if (offense_unit) {
                                        if (offense_unit.get_UnitGameData_Obj().n in offense_unit_map) { link += offense_unit_map[offense_unit.get_UnitGameData_Obj().n]; }
                                        else { clog.warn("Unhandled offense unit:", offense_unit.get_UnitGameData_Obj().n); link += "."; }
                                    } else { link += "."; }
                                    break;
                                case 1: link += (spot.BuildingIndex < 0) ? "c" : "n"; break; /* crystal */
                                case 2: link += (spot.BuildingIndex < 0) ? "t" : "j"; break; /* tiberium */
                                case 4: link += "j"; break; /* woods */
                                case 5: link += "h"; break; /* scrub */
                                case 6: link += "l"; break; /* oil */
                                case 7: link += "k"; break; /* swamp */
                                default: clog.warn("Unhandled resource type:", city.GetResourceType(j, i)); link += "."; break;
                            }
                        }
                    }

                    link += "~E=" + economy;
                    link += "~X=" + coordX + "~Y=" + coordY;
                    link += "~WID=" + worldId;
                    link += "~WN=" + worldName;
                    link += "~ML=" + maxLevel;
                    return link;
                } catch (e) { clog.warn("payload error:", e); return null; }
            }
            function url(cityId) {
                var p = payload(cityId);
                return p ? ("https://www.cnctaopt.com/index.html?" + encodeURI(p)) : null;
            }
            return {
                maps: { base: base_unit_map, defense: defense_unit_map, offense: offense_unit_map },
                payload: payload,
                url: url,
                encode: url, // alias: the practical output is the full URL
                open: function (cityId) { var u = url(cityId); if (u) { window.open(u, "_blank"); } return u; }
            };
        })();

        // scan: iterate attackable world objects within range of an origin base.
        // Ported from TA_Maelstrom_ADDON_Basescanner_AIO's FJ enumeration (the sync phase).
        // This is phase 1 only: it returns lightweight candidate descriptors. Per-base DETAIL
        // (loot, fields, condition) is async - the consumer loads each city by id and waits for
        // get_Version()>0 (GetCity returns version:-1/name:null until the server round-trip lands),
        // then calls MMCommon.loot.ofCity etc. (this is the AIO FG pattern).
        NS.scan = {
            // opts: { origin (city; default current own city), maxDistance (default server max),
            //   types ([1,2,3]: 1=player, 2=NPC base, 3=camp/outpost), cpLimit (default Infinity),
            //   minLevel (default 0), playerCP (bool, default true: pass the player-CP flags to
            //   CalculateAttackCommandPointCostToCoord for type-1 targets, matching AIO),
            //   excludeOwn (default true: skip your own bases by id), excludeIds (array or id->true map),
            //   attackableOnly (default true: drop targets the origin can't actually attack - out of
            //   range or beyond its command-point capacity - via the game's own CheckAttackBase) }
            // Returns [{ id, type, x, y, baseLevel, campType, cp }] (campType null for non-camps,
            // cp null if the cost call threw). Ally exclusion is left to the detail phase, where the
            // alliance relationship is authoritative (same as AIO's FG re-check).
            inRange: function (opts) {
                opts = opts || {};
                var out = [];
                try {
                    var md = ClientLib.Data.MainData.GetInstance();
                    var world = md.get_World();
                    var cities = md.get_Cities();
                    var origin = opts.origin || cities.get_CurrentOwnCity();
                    if (!origin) return out;
                    var px = origin.get_PosX(), py = origin.get_PosY();
                    var maxD = (opts.maxDistance != null) ? opts.maxDistance : md.get_Server().get_MaxAttackDistance();
                    var types = opts.types || [1, 2, 3];
                    var cpLimit = (opts.cpLimit != null) ? opts.cpLimit : Infinity;
                    var minLevel = opts.minLevel || 0;
                    var playerCP = (opts.playerCP !== false);
                    // attackableOnly (default true): use the game's own CheckAttackBase to drop targets
                    // that are out of real attack range (FailDistance). We gate ONLY on FailDistance.
                    //
                    // We deliberately do NOT gate on FailInsufficientCommandPoints: that bit reflects the
                    // command points you have AVAILABLE RIGHT NOW, which deplete as you play, so including
                    // it made the scanner show ~0 targets whenever your CP pool was spent (confirmed live:
                    // bit 16 was set on 120/125 in-range targets when CP was low, and the count fluctuated
                    // run-to-run as CP regenerated/drained). The scanner is a planning tool - it must list
                    // every worthwhile target in range regardless of your current CP. CP filtering is the
                    // user's job via cpLimit, which filters the actual per-target cost computed below from
                    // CalculateAttackCommandPointCostToCoord. Other failure reasons (no army staged, ally,
                    // ghost, protection) are likewise IGNORED here, so a scan works without a loaded army
                    // and leaves ally/ghost handling to the caller's detail phase.
                    var attackableOnly = (opts.attackableOnly !== false);
                    var FAIL_MASK = 0;
                    if (attackableOnly) {
                        try {
                            var EA = ClientLib.Data.EAttackBaseResult;
                            FAIL_MASK = (EA && EA.FailDistance != null) ? EA.FailDistance : 1;
                        } catch (e) { FAIL_MASK = 1; }
                        if (typeof world.CheckAttackBase !== "function") attackableOnly = false; // not available -> skip the gate
                    }
                    var ownIds = {};
                    if (opts.excludeOwn !== false) {
                        try {
                            var ac = cities.get_AllCities && cities.get_AllCities();
                            var dd = ac && ac.d;
                            for (var k in dd) { if (dd[k] && dd[k].get_Id) ownIds[dd[k].get_Id()] = true; }
                        } catch (e) {}
                    }
                    var exIds = {};
                    if (opts.excludeIds) {
                        if (opts.excludeIds.length != null) { for (var j = 0; j < opts.excludeIds.length; j++) exIds[opts.excludeIds[j]] = true; }
                        else exIds = opts.excludeIds;
                    }
                    var step = Math.floor(maxD + 1);
                    for (var sy = py - step; sy <= py + step; sy++) {
                        for (var sx = px - step; sx <= px + step; sx++) {
                            var ddx = px - sx, ddy = py - sy;
                            if (Math.sqrt(ddx * ddx + ddy * ddy) > maxD) continue;
                            var obj = world.GetObjectFromPosition(sx, sy);
                            if (!obj || types.indexOf(obj.Type) === -1) continue;
                            if (typeof obj.getID !== "function" || typeof obj.get_BaseLevel !== "function") continue;
                            var id = obj.getID();
                            if (ownIds[id] || exIds[id]) continue;
                            if (parseInt(obj.get_BaseLevel(), 10) < minLevel) continue;
                            var cp;
                            try {
                                cp = (obj.Type === 1 && playerCP)
                                    ? origin.CalculateAttackCommandPointCostToCoord(sx, sy, true, true)
                                    : origin.CalculateAttackCommandPointCostToCoord(sx, sy);
                            } catch (e) { cp = null; }
                            if (cp != null && cp > cpLimit) continue;
                            if (attackableOnly) {
                                var car; try { car = world.CheckAttackBase(sx, sy); } catch (e) { car = 0; }
                                if (car & FAIL_MASK) continue; // out of range / not enough command points
                            }
                            out.push({
                                id: id, type: obj.Type, x: sx, y: sy, baseLevel: obj.get_BaseLevel(),
                                campType: (typeof obj.get_CampType === "function") ? obj.get_CampType() : null,
                                cp: cp
                            });
                        }
                    }
                } catch (e) { NS.log.err("scan.inRange failed:", e); }
                return out;
            }
        };

        // repair: repair-time / repair-cost helpers (port from battle sim + TA_Auto_Repair).
        NS.repair = {
            unitGroupTime: todo("repair.unitGroupTime"),
            entityFullCost: todo("repair.entityFullCost")
        };

        // loot: loot / lootable-resource summary for a base.
        // Ported from the AIO scanner's getResourcesPart: the lootable value of an entity is its
        // UnitLevelRepairRequirements (the resource cost to repair it), scaled by current hitpoints%
        // so damaged bases show reduced loot. Sums buildings + defense units.
        NS.loot = {
            // ofCity(ncity, opts) -> array indexed by ClientLib.Base.EResourceType
            //   (Tiberium=1, Crystal=2, Gold=3, ResearchPoints=6). opts: { buildings (default true),
            //   units (default true) }. Returns all-zeros on any failure (never throws).
            ofCity: function (ncity, opts) {
                opts = opts || {};
                var loot = [0, 0, 0, 0, 0, 0, 0, 0];
                try {
                    if (!ncity) return loot;
                    function add(entities) {
                        if (!entities) return;
                        for (var i in entities) {
                            var e = entities[i];
                            if (!e || typeof e.get_UnitLevelRepairRequirements !== "function") continue;
                            var req = e.get_UnitLevelRepairRequirements();
                            if (!req) continue;
                            var hp = (typeof e.get_HitpointsPercent === "function") ? e.get_HitpointsPercent() : 1;
                            for (var x = 0; x < req.length; x++) {
                                if (loot[req[x].Type] == null) loot[req[x].Type] = 0;
                                loot[req[x].Type] += req[x].Count * hp;
                            }
                        }
                    }
                    if (opts.buildings !== false) {
                        try { var b = ncity.get_Buildings(); add(b && b.d); } catch (e) {}
                    }
                    if (opts.units !== false) {
                        try {
                            var cu = ncity.get_CityUnitsData();
                            var du = cu && cu.get_DefenseUnits && cu.get_DefenseUnits();
                            add(du && du.d);
                        } catch (e) {}
                    }
                } catch (e) { NS.log.err("loot.ofCity failed:", e); }
                return loot;
            }
        };

        // base: per-city data summaries salvaged from MaelstromTools Dev (Army Overview / Base
        // Resources / Base Status). Data-only (no UI) - each takes a city object and returns a plain
        // object, so any script can build its own view. (Originals iterated all cities into a cache;
        // these are per-city + an ownCities() helper, which composes better.) PerforceChangelist
        // version branches dropped - modern client only.
        NS.base = {
            // All of the player's own bases (city objects).
            ownCities: function () {
                var out = [];
                try {
                    var arr = ClientLib.Data.MainData.GetInstance().get_Cities().get_AllCities();
                    var d = arr && arr.d;
                    for (var k in d) { var c = d[k]; try { if (c && c.IsOwnBase && c.IsOwnBase()) out.push(c); } catch (e) {} }
                } catch (e) { NS.log.err("base.ownCities failed:", e); }
                return out;
            },
            // Map of the player's own base ids -> own city object (already loaded). Cheap own-check.
            ownIdMap: function () {
                var m = {};
                try {
                    var arr = ClientLib.Data.MainData.GetInstance().get_Cities().get_AllCities();
                    var d = arr && arr.d;
                    for (var k in d) { var c = d[k]; if (c && c.get_Id) m[c.get_Id()] = c; }
                } catch (e) { NS.log.err("base.ownIdMap failed:", e); }
                return m;
            },
            // Is a base whose owner is in alliance theirAllianceId an ally of ours (same alliance, or
            // NAP/ally by diplomacy)? Faithful port of the AIO / Base-Scanner FG alliance re-check (the
            // authoritative relationship pass). myAllianceId optional (defaults to our alliance).
            isAlly: function (theirAllianceId, myAllianceId) {
                try {
                    if (myAllianceId == null) {
                        try { myAllianceId = ClientLib.Data.MainData.GetInstance().get_Alliance().get_Id(); } catch (e) { myAllianceId = 0; }
                    }
                    if (!theirAllianceId || !myAllianceId) return false;
                    if (theirAllianceId === myAllianceId) return true;
                    var rel = ClientLib.Data.MainData.GetInstance().get_Alliance().get_Relationships();
                    if (rel) {
                        for (var k in rel) {
                            var r = rel[k];
                            if (r && r.OtherAllianceId === theirAllianceId && (r.Relationship === 1 || r.Relationship === 2)) return true;
                        }
                    }
                } catch (e) {}
                return false;
            },
            // Classify a loaded city as "own" | "alliance" | "neutral" | "enemy":
            //   own      - one of your bases
            //   alliance - same alliance as you
            //   neutral  - a DIFFERENT alliance you're at peace/NAP/ally with (diplomacy)
            //   enemy    - everyone else (attackable, incl. unaffiliated players)
            // ncity = the detail city (get_OwnerAllianceId valid once loaded). ownMap optional.
            relationship: function (id, ncity, ownMap) {
                try {
                    if (!ownMap) ownMap = NS.base.ownIdMap();
                    if (ownMap[id]) return "own";
                    var their = (ncity && ncity.get_OwnerAllianceId) ? ncity.get_OwnerAllianceId() : 0;
                    var mine = 0; try { mine = ClientLib.Data.MainData.GetInstance().get_Alliance().get_Id(); } catch (e) {}
                    if (their && mine && their === mine) return "alliance";
                    if (NS.base.isAlly(their)) return "neutral"; // different alliance, but NAP/ally by diplomacy
                    return "enemy";
                } catch (e) { return "enemy"; }
            },
            // SYNCHRONOUS own/alliance/neutral/enemy from a VIS region object (see map.visObjectAt).
            // The vis object carries get_AllianceId()/IsOwnBase() live, so this needs NO detail-load
            // survey (unlike relationship(), which reads a loaded detail city's get_OwnerAllianceId -
            // that path mis-bucketed alliance members as neutral; this one keys off the same field the
            // game colours outlines from). myAllianceId optional (defaults to ours). Classifies:
            //   own = your base; alliance = your alliance id; neutral = a different alliance you have
            //   NAP/peace/ally diplomacy with; enemy = everyone else (incl. unaffiliated).
            relationshipFromVis: function (vo, myAllianceId) {
                try {
                    if (!vo) return "enemy";
                    if (typeof vo.IsOwnBase === "function" && vo.IsOwnBase()) return "own";
                    var their = (typeof vo.get_AllianceId === "function") ? (vo.get_AllianceId() || 0) : 0;
                    if (myAllianceId == null) {
                        try { myAllianceId = ClientLib.Data.MainData.GetInstance().get_Alliance().get_Id(); } catch (e) { myAllianceId = 0; }
                    }
                    if (their && myAllianceId && their === myAllianceId) return "alliance";
                    if (their && NS.base.isAlly(their, myAllianceId)) return "neutral";
                    return "enemy";
                } catch (e) { return "enemy"; }
            },
            // Async-load a base's server detail by id and call cb(ncity) once it lands (or cb(null) on
            // timeout). GetCity returns a version:-1 stub until you TRIGGER the load with
            // set_CurrentCityId(id) (one shared "current city" pointer), so by default this triggers it
            // then polls get_Version()>0. Because there is only one current-city pointer, callers MUST
            // serialize fetchDetail (one in flight at a time) - concurrent calls thrash each other - and
            // should restore the prior current-city id when their batch drains (see base.currentCityId /
            // setCurrentCityId). opts: { trigger (default true), tries (20), intervalMs (250) }.
            fetchDetail: function (id, cb, opts) {
                opts = opts || {};
                var tries = opts.tries || 20, interval = opts.intervalMs || 250, n = 0;
                if (opts.trigger !== false) {
                    try { ClientLib.Data.MainData.GetInstance().get_Cities().set_CurrentCityId(id); } catch (e) {}
                }
                function poll() {
                    var ncity = null;
                    try { ncity = ClientLib.Data.MainData.GetInstance().get_Cities().GetCity(id); } catch (e) {}
                    if (ncity && ncity.get_Version() > 0) { try { cb(ncity); } catch (e) { NS.log.err("fetchDetail cb:", e); } return; }
                    if (++n > tries) { try { cb(null); } catch (e) {} return; }
                    window.setTimeout(poll, interval);
                }
                poll();
            },
            // The game's current-city pointer (the base loaded as "current"; -1 in region view). Used to
            // save/restore around a fetchDetail survey so it doesn't leave someone else's base "current".
            currentCityId: function () { try { return ClientLib.Data.MainData.GetInstance().get_Cities().get_CurrentCityId(); } catch (e) { return -1; } },
            setCurrentCityId: function (id) { try { ClientLib.Data.MainData.GetInstance().get_Cities().set_CurrentCityId(id); } catch (e) {} },
            // Army Overview data: repair times per unit group, repair charges, possible/max attacks
            // (PossibleAttacks gets a trailing "*" when offense isn't 100% healthy), and base/offense/
            // defense level + head-count + health. From MaelstromTools.RepairTime.updateCache.
            army: function (ncity) {
                var out = { repairTime: {}, repaircharge: {}, base: {}, offense: {}, defense: {} };
                try {
                    if (!ncity) return out;
                    var EU = ClientLib.Data.EUnitGroup, ER = ClientLib.Base.EResourceType;
                    var ud = ncity.get_CityUnitsData();
                    var rt = out.repairTime, rc = out.repaircharge;
                    rt.Infantry = ud.GetRepairTimeFromEUnitGroup(EU.Infantry, false);
                    rt.Vehicle = ud.GetRepairTimeFromEUnitGroup(EU.Vehicle, false);
                    rt.Aircraft = ud.GetRepairTimeFromEUnitGroup(EU.Aircraft, false);
                    rt.Maximum = ncity.GetResourceMaxStorage(ER.RepairChargeInf);
                    rc.Infantry = ncity.GetResourceCount(ER.RepairChargeInf);
                    rc.Vehicle = ncity.GetResourceCount(ER.RepairChargeVeh);
                    rc.Aircraft = ncity.GetResourceCount(ER.RepairChargeAir);
                    rc.Smallest = Math.min(rc.Infantry, rc.Vehicle, rc.Aircraft);
                    var largest = 0, repLargest = "";
                    ["Infantry", "Vehicle", "Aircraft"].forEach(function (g) { if (rt[g] > largest) { largest = rt[g]; repLargest = g; } });
                    rt.Largest = largest;
                    var offHealth = ncity.GetOffenseConditionInPercent();
                    if (repLargest !== "") {
                        rt.LargestDiv = rt[repLargest];
                        var i = Math.ceil(rc.Smallest / rt.LargestDiv);
                        if (offHealth !== 100) { i--; i += "*"; } // unhealthy units: one fewer attack, flagged with *
                        rt.PossibleAttacks = i;
                        rt.MaxAttacks = Math.ceil(rt.Maximum / rt.LargestDiv);
                    } else { rt.LargestDiv = 0; rt.PossibleAttacks = 0; rt.MaxAttacks = 0; }
                    var b = out.base;
                    b.Level = (Math.floor(ncity.get_LvlBase() * 100) / 100).toFixed(2);
                    b.UnitLimit = ncity.GetBuildingSlotLimit();
                    b.TotalHeadCount = ncity.GetBuildingSlotCount();
                    b.FreeHeadCount = b.UnitLimit - b.TotalHeadCount;
                    b.HealthInPercent = ncity.GetBuildingsConditionInPercent();
                    var o = out.offense;
                    o.Level = (Math.floor(ncity.get_LvlOffense() * 100) / 100).toFixed(2);
                    o.UnitLimit = ud.get_UnitLimitOffense();
                    o.TotalHeadCount = ud.get_TotalOffenseHeadCount();
                    o.FreeHeadCount = ud.get_FreeOffenseHeadCount();
                    o.HealthInPercent = offHealth > 0 ? offHealth : 0;
                    var df = out.defense;
                    df.Level = (Math.floor(ncity.get_LvlDefense() * 100) / 100).toFixed(2);
                    df.UnitLimit = ud.get_UnitLimitDefense();
                    df.TotalHeadCount = ud.get_TotalDefenseHeadCount();
                    df.FreeHeadCount = ud.get_FreeDefenseHeadCount();
                    var dHealth = ncity.GetDefenseConditionInPercent();
                    df.HealthInPercent = dHealth > 0 ? dHealth : 0;
                } catch (e) { NS.log.err("base.army failed:", e); }
                return out;
            },
            // Base Resources data: count / max-storage / step+time-until-full for Tiberium, Crystal,
            // Power. From MaelstromTools.ResourceOverview.updateCache.
            resources: function (ncity) {
                var out = {};
                try {
                    if (!ncity) return out;
                    var ER = ClientLib.Base.EResourceType;
                    var t = ClientLib.Data.MainData.GetInstance().get_Time();
                    function res(type) {
                        var fullStep = ncity.GetResourceStorageFullStep(type);
                        return {
                            count: ncity.GetResourceCount(type),
                            max: ncity.GetResourceMaxStorage(type),
                            fullStep: fullStep,
                            fullTime: t.GetJSStepTime(fullStep)
                        };
                    }
                    out.tiberium = res(ER.Tiberium);
                    out.crystal = res(ER.Crystal);
                    out.power = res(ER.Power);
                } catch (e) { NS.log.err("base.resources failed:", e); }
                return out;
            },
            // Base Status data: movement cooldown / lockdown, protection, alert state, and dedicated
            // support-weapon details (name/level/range + the supported base id/name/coords, decoded from
            // the 32-bit packed coord). From MaelstromTools.BaseStatus.updateCache.
            status: function (ncity) {
                var out = { support: { has: false } };
                try {
                    if (!ncity) return out;
                    out.hasCooldown = ncity.get_hasCooldown();
                    out.cooldownEnd = Math.max(ncity.get_MoveCooldownEndStep(), ncity.get_MoveRestictionEndStep());
                    out.moveCooldownEnd = ncity.get_MoveCooldownEndStep();
                    out.moveLockdownEnd = ncity.get_MoveRestictionEndStep();
                    out.isProtected = ncity.get_isProtected();
                    out.protectionEnd = ncity.get_ProtectionEndStep();
                    out.isAlerted = ncity.get_isAlerted();
                    var sd = ncity.get_SupportData();
                    if (sd) {
                        var s = out.support; s.has = true;
                        if (ncity.get_SupportDedicatedBaseId() > 0) {
                            s.dedicatedBaseId = ncity.get_SupportDedicatedBaseId();
                            s.dedicatedBaseName = ncity.get_SupportDedicatedBaseName();
                            var coordId = ncity.get_SupportDedicatedBaseCoordId();
                            s.dedicatedBaseX = (coordId & 0xffff);            // 32-bit packed coord: low word = X
                            s.dedicatedBaseY = ((coordId >> 0x10) & 0xffff);  // high word = Y
                        }
                        try { s.range = ncity.get_SupportWeapon().r; } catch (e) {}
                        try {
                            var player = ClientLib.Data.MainData.GetInstance().get_Player();
                            var techName = ClientLib.Base.Tech.GetTechNameFromTechId(sd.get_Type(), player.get_Faction());
                            s.name = ClientLib.Base.Tech.GetProductionBuildingNameFromFaction(techName, player.get_Faction());
                        } catch (e) {}
                        s.level = sd.get_Level();
                    }
                } catch (e) { NS.log.err("base.status failed:", e); }
                return out;
            },
            // Find the Construction Yard / Defense Facility / support-weapon buildings in a base's grid,
            // keyed by MdbUnitId (faction-spanning: CY 112/151/177, DF 158/131/195, support 200-205).
            // Returns { cy, df, support }, each { row (8 - CoordY = rows from the front), col, condition
            // (% health) } or null if absent. Shared scan for MM - Loot Summary (and Base Scanner).
            keyBuildings: function (ncity) {
                var out = { cy: null, df: null, support: null };
                try {
                    var b = ncity && ncity.get_Buildings(); var d = b && b.d;
                    for (var k in d) {
                        var u = d[k];
                        if (!u || typeof u.get_MdbUnitId !== "function") continue;
                        var id = u.get_MdbUnitId();
                        var slot = { row: 8 - u.get_CoordY(), col: u.get_CoordX(), condition: 100 * u.get_HitpointsPercent() };
                        if (id >= 200 && id <= 205) out.support = slot;
                        else if (id === 112 || id === 151 || id === 177) out.cy = slot;
                        else if (id === 158 || id === 131 || id === 195) out.df = slot;
                    }
                } catch (e) { NS.log.err("base.keyBuildings failed:", e); }
                return out;
            },
            // Per-hour production for a base: tiberium / crystal / power / credits. (GetResourceGrowPerHour
            // returns a per-hour rate; credits come via the packed CityCreditsProduction record.)
            production: function (ncity) {
                var out = { tiberium: 0, crystal: 0, power: 0, credits: 0 };
                try {
                    if (!ncity) return out;
                    var ER = ClientLib.Base.EResourceType;
                    out.tiberium = ncity.GetResourceGrowPerHour(ER.Tiberium, true, true);
                    out.crystal = ncity.GetResourceGrowPerHour(ER.Crystal, true, true);
                    out.power = ncity.GetResourceGrowPerHour(ER.Power, true, true);
                    try { out.credits = ClientLib.Base.Resource.GetResourceGrowPerHour(ncity.get_CityCreditsProduction(), true); } catch (e) {}
                } catch (e) { NS.log.err("base.production failed:", e); }
                return out;
            }
        };

        // map: region-map world<->screen projection, visible-base enumeration, and pan/zoom/mode
        // tracking. Live-sniffed (gridWidth 128 / gridHeight 96 at zoom 1; ScreenPosFromWorldPos +
        // its inverse; PositionChange/ZoomFactorChange/ModeChange net events). Lets any script anchor
        // an on-map overlay to bases without re-deriving the obfuscated projection. First consumer:
        // MM - Player Base Info.
        NS.map = (function () {
            function vm() { return ClientLib.Vis.VisMain.GetInstance(); }
            function rg() { return vm().get_Region(); }
            function gw() { try { return rg().get_GridWidth() || 128; } catch (e) { return 128; } }
            function gh() { try { return rg().get_GridHeight() || 96; } catch (e) { return 96; } }
            var api = {
                // projection usable (region scene + projector present)?
                ready: function () {
                    try { return typeof vm().ScreenPosFromWorldPosX === "function" && !!rg() && typeof rg().GetObjectFromPosition === "function"; }
                    catch (e) { return false; }
                },
                // are we in the region/overworld view (vs a base)?
                inRegionView: function () {
                    try {
                        var m = vm().get_Mode();
                        var R = (ClientLib.Vis.EViewMode && ClientLib.Vis.EViewMode.Region);
                        return (R != null) ? (m === R) : (m === 2);
                    } catch (e) { return false; }
                },
                grid: function () { return { w: gw(), h: gh() }; },
                // grid coords -> screen px {x,y}
                worldToScreen: function (gx, gy) {
                    var v = vm();
                    return { x: v.ScreenPosFromWorldPosX(gx * gw()), y: v.ScreenPosFromWorldPosY(gy * gh()) };
                },
                // screen px -> fractional grid coords {x,y}
                screenToWorld: function (sx, sy) {
                    var v = vm();
                    return { x: v.WorldPosFromScreenPosX(sx) / gw(), y: v.WorldPosFromScreenPosY(sy) / gh() };
                },
                // fractional grid coord currently at the CENTRE of the view {x,y}. ("Where am I
                // looking?" - the value the retired compass scripts derived by hand from region
                // pos/zoom/grid.) Uses the game canvas size, like visibleBounds().
                viewCenter: function () {
                    var cv = document.querySelector("canvas");
                    var r = cv ? cv.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
                    return api.screenToWorld(r.width / 2, r.height / 2);
                },
                // The VIS region object at grid (gx,gy) - the RENDERED object, which (unlike the
                // lightweight data world object from get_World().GetObjectFromPosition) exposes
                // synchronous owner/alliance getters: get_AllianceId(), get_AllianceName(),
                // IsOwnBase(), get_PlayerId()/get_PlayerName(), get_RawX()/get_RawY(),
                // get_VisObjectType(). This is what the game itself colours base outlines from, so it
                // lets a script classify relationship LIVE (no detail-load survey). Returns null if
                // nothing is there / not in region view. (region.GetObjectFromPosition wants PIXEL
                // coords = grid * gridWidth/Height.)
                visObjectAt: function (gx, gy) {
                    try { return rg().GetObjectFromPosition(gx * gw(), gy * gh()); }
                    catch (e) { return null; }
                },
                // visible grid rect (padded 1 tile). Defaults to the game canvas size.
                visibleBounds: function (w, h) {
                    var v = vm();
                    if (w == null || h == null) {
                        var cv = document.querySelector("canvas");
                        var r = cv ? cv.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
                        w = r.width; h = r.height;
                    }
                    return {
                        gx0: Math.floor(v.WorldPosFromScreenPosX(0) / gw()) - 1,
                        gx1: Math.ceil(v.WorldPosFromScreenPosX(w) / gw()) + 1,
                        gy0: Math.floor(v.WorldPosFromScreenPosY(0) / gh()) - 1,
                        gy1: Math.ceil(v.WorldPosFromScreenPosY(h) / gh()) + 1
                    };
                },
                // enumerate bases currently in view. opts: { types ([1]=player; 2=NPC base; 3=camp),
                // max (120) }. Returns [{ id, x, y, type, baseLevel }].
                visibleBases: function (opts) {
                    opts = opts || {};
                    var types = opts.types || [1];
                    var max = opts.max || 120;
                    var out = [];
                    try {
                        var w = ClientLib.Data.MainData.GetInstance().get_World();
                        var b = api.visibleBounds();
                        var seen = {};
                        for (var y = b.gy0; y <= b.gy1; y++) {
                            for (var x = b.gx0; x <= b.gx1; x++) {
                                var o;
                                try { o = w.GetObjectFromPosition(x, y); } catch (e) { o = null; }
                                if (!o || types.indexOf(o.Type) === -1 || typeof o.getID !== "function") continue;
                                var id = o.getID();
                                if (seen[id]) continue;
                                seen[id] = true;
                                out.push({ id: id, x: x, y: y, type: o.Type, baseLevel: (typeof o.get_BaseLevel === "function") ? o.get_BaseLevel() : 0 });
                                if (out.length >= max) return out;
                            }
                        }
                    } catch (e) { NS.log.err("map.visibleBases failed:", e); }
                    return out;
                },
                // attach pan/zoom/mode handlers. opts: { onMove, onZoom, onMode }. Returns a detach fn.
                // CRITICAL: these events fire DURING the game's own render/layout (e.g. _onMapAreaResize
                // -> renderLayout). Running consumer code synchronously inside that dispatch - or letting
                // it throw - corrupts the game's render (black map). So every handler is (a) given a real
                // context object (the net layer mishandles a null context) and (b) wrapped to defer to a
                // fresh task via setTimeout(0) AND swallow errors, so it can never re-enter or throw into
                // the game's dispatch. The ~0ms defer is invisible for pan tracking.
                track: function (opts) {
                    opts = opts || {};
                    var r = rg(), v = vm(), bound = [];
                    var ctx = { __mmMapTrack: true };
                    function wrap(fn) {
                        return function () {
                            window.setTimeout(function () { try { fn(); } catch (e) { NS.log.err("map.track handler:", e); } }, 0);
                        };
                    }
                    function on(obj, name, evt, fn) {
                        if (!fn || !evt) return;
                        var w = wrap(fn);
                        try { NS.net.attach(obj, name, evt, ctx, w); bound.push([obj, name, evt, w]); }
                        catch (e) { NS.log.err("map.track attach " + name + ":", e); }
                    }
                    on(r, "PositionChange", ClientLib.Vis.PositionChange, opts.onMove);
                    on(r, "ZoomFactorChange", ClientLib.Vis.ZoomFactorChange, opts.onZoom);
                    on(v, "ModeChange", ClientLib.Vis.ModeChange, opts.onMode);
                    return function detach() {
                        for (var i = 0; i < bound.length; i++) {
                            try { NS.net.detach(bound[i][0], bound[i][1], bound[i][2], ctx, bound[i][3]); } catch (e) {}
                        }
                        bound = [];
                    };
                },
                // SAFE pan/zoom/mode watcher: POLLS the camera (position/zoom/mode) on an interval
                // instead of hooking the game's net events. It never touches the game's event dispatch,
                // so it cannot interfere with the game's render/layout (unlike track(), which hooks events
                // that fire mid-render - kept for lightweight DOM-only consumers, but prefer watch() for
                // anything that does real work). opts: { onChange(state), interval (default 200ms) } where
                // state = { posX, posY, zoom, mode, region:bool }. Fires onChange once immediately, then
                // whenever any of those change. Returns a stop() fn.
                watch: function (opts) {
                    opts = opts || {};
                    var interval = opts.interval || 200, cb = opts.onChange, last = null, timer = null;
                    function snap() {
                        try { var v = vm(); return { x: v.get_PositionX(), y: v.get_PositionY(), z: v.get_ZoomFactor(), m: v.get_Mode() }; }
                        catch (e) { return null; }
                    }
                    function tick() {
                        try {
                            var s = snap();
                            if (s && (!last || s.x !== last.x || s.y !== last.y || s.z !== last.z || s.m !== last.m)) {
                                last = s;
                                if (cb) { try { cb({ posX: s.x, posY: s.y, zoom: s.z, mode: s.m, region: api.inRegionView() }); } catch (e) { NS.log.err("map.watch cb:", e); } }
                            }
                        } catch (e) {}
                    }
                    timer = window.setInterval(tick, interval);
                    tick();
                    return function stop() { if (timer) { window.clearInterval(timer); timer = null; } };
                },
                // The region object the user currently has SELECTED (clicked), or null. Same vis-object
                // family as visObjectAt - exposes get_VisObjectType()/get_Id()/IsOwnBase()/get_AllianceId()/
                // get_PlayerName() etc. (first consumer: MM - Loot Summary).
                selectedObject: function () {
                    try { return vm().get_SelectedObject() || null; } catch (e) { return null; }
                },
                // Fire cb(selectedObjectOrNull) whenever the region selection changes (clicking a base/camp/
                // POI, or clicking empty map to deselect), and cb(null) when leaving region view. Deferred to
                // a fresh task + error-swallowed like track(), and given a real context object (the net layer
                // mishandles a null context). Returns a detach fn.
                onSelection: function (cb) {
                    if (!cb) return function () {};
                    var v = vm(), ctx = { __mmSel: true }, bound = [];
                    function fire() { window.setTimeout(function () { try { cb(api.inRegionView() ? api.selectedObject() : null); } catch (e) { NS.log.err("map.onSelection cb:", e); } }, 0); }
                    function on(name, evt) {
                        if (!evt) return;
                        try { NS.net.attach(v, name, evt, ctx, fire); bound.push([name, evt]); }
                        catch (e) { NS.log.err("map.onSelection attach " + name + ":", e); }
                    }
                    on("SelectionChange", ClientLib.Vis.SelectionChange);
                    on("ModeChange", ClientLib.Vis.ModeChange);
                    return function detach() {
                        for (var i = 0; i < bound.length; i++) { try { NS.net.detach(v, bound[i][0], bound[i][1], ctx, fire); } catch (e) {} }
                        bound = [];
                    };
                },

                // ---- reusable on-map bubble overlay ----------------------------------------
                // Generalises the MM - Player Base Info off/def overlay into a shared layer ANY script can
                // drive. It owns a DOM layer pinned right after the map canvas (z-index:10,
                // pointer-events:none - paints over the terrain but under every HUD panel and never blocks
                // map interaction), holding one "bubble" per key, each anchored to a base's grid tile and
                // optionally joined to it by a thin SVG leader line ("thought bubble"). The layer owns its
                // OWN pan/zoom tracking (via map.watch) and hides bubbles that fall under an open region
                // panel, so a consumer only ever calls set()/remove()/clear(). Returns a handle:
                //   set(key, base, content) : create-or-update. base={x,y} GRID coords; content =
                //                             { html, accent (border + leader colour), title }.
                //   remove(key) / clear() / has(key) / keys() / count()
                //   visible(bool)  : master show/hide (kept across reprojects)
                //   reposition()   : force a reproject (normally automatic)
                //   destroy()      : remove the layer + stop all watchers
                // opts:
                //   offset : { x, y } screen-px offset of the bubble's anchor from the base tile (default
                //            {0,0}). Base Scanner uses +x so its bubbles sit to the RIGHT, leaving the
                //            left/top free for Player Base Info's off/def bubbles.
                //   leader : true to draw a leader line from the base tile to the bubble's anchor edge.
                //   tip    : { x, y } GRID-cell fraction added to the base coord for the leader's BASE end
                //            (projected, so zoom-correct). worldToScreen(base) is the base's top-centre, so
                //            tip {x:0,y:1.0} drops the leader onto the base body. Default {0,0}.
                //   arrow  : true to draw an arrowhead at the leader's tip end, pointing into the base.
                //   anchor : "left" (default - bubble extends to the right of the anchor; the leader meets
                //            its left-middle) or "center" (bubble centred above the anchor, PBI-style).
                //   id     : DOM id for the layer (default "mm_bubble_layer"); use a unique id per consumer.
                bubbleLayer: function (opts) {
                    opts = opts || {};
                    var offX = (opts.offset && opts.offset.x) || 0;
                    var offY = (opts.offset && opts.offset.y) || 0;
                    var useLeader = (opts.leader === true);
                    // tip = where the leader's BASE end lands, as a GRID-cell fraction added to the base
                    // coord (projected, so it's zoom-correct). worldToScreen(base.x,base.y) is the base's
                    // top-centre, so tip {x:0,y:0.5} drops the leader onto the base's centre instead of
                    // floating above it. Default {0,0} = the bare projection point (unchanged).
                    var tipX = (opts.tip && opts.tip.x) || 0;
                    var tipY = (opts.tip && opts.tip.y) || 0;
                    var useArrow = (opts.arrow === true);   // draw an arrowhead at the leader's base (tip) end
                    var anchorLeft = (opts.anchor !== "center");
                    var layerId = opts.id || "mm_bubble_layer";
                    var SVGNS = "http://www.w3.org/2000/svg";
                    var NEUTRAL = "#8fa0ab";

                    var layer = null, svg = null;
                    var items = {};   // key -> { base:{x,y}, content, el, line }
                    var master = true;
                    var watchStop = null, popupTimer = null;

                    function ensureLayer() {
                        var old = document.getElementById(layerId);
                        if (old && old !== layer) { try { old.remove(); } catch (e) {} }
                        layer = document.createElement("div");
                        layer.id = layerId;
                        // Slot the overlay just above the map but UNDER all the game's UI chrome. The map
                        // canvas container is the FIRST child of the game root and every HUD/menu panel is a
                        // LATER sibling at z-index:10 (stacked purely by DOM order). Inserting right after the
                        // canvas WITH z-index:10 paints us over the map yet below every panel. Falls back to a
                        // top-level fixed layer if the game root isn't reachable.
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
                        if (useLeader) {
                            svg = document.createElementNS(SVGNS, "svg");
                            svg.setAttribute("style", "position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;overflow:visible");
                            layer.appendChild(svg);
                        }
                    }
                    function makeEl() {
                        var el = document.createElement("div");
                        el.style.cssText = [
                            "position:absolute", "white-space:nowrap",
                            anchorLeft ? "transform:translate(0,-50%)" : "transform:translate(-50%,-100%)",
                            "padding:2px 7px 3px", "border:2px solid " + NEUTRAL, "border-radius:8px",
                            "background:rgba(15,20,25,0.92)", "box-shadow:0 2px 7px rgba(0,0,0,0.5)",
                            "font:bold 12px sans-serif", "color:#fff", "pointer-events:none"
                        ].join(";");
                        layer.appendChild(el);
                        return el;
                    }
                    function makeLine() {
                        var ln = document.createElementNS(SVGNS, "line");
                        ln.setAttribute("stroke", NEUTRAL);
                        ln.setAttribute("stroke-width", "1.5");
                        ln.setAttribute("stroke-dasharray", "3,3");
                        if (svg) svg.appendChild(ln);
                        return ln;
                    }
                    function makeArrow() {
                        var ar = document.createElementNS(SVGNS, "polygon");
                        ar.setAttribute("fill", NEUTRAL);
                        if (svg) svg.appendChild(ar);
                        return ar;
                    }
                    // If qx ever rebuilt the map container and dropped our layer, re-create it and re-attach
                    // every bubble from its stored base+content (the detached DOM nodes are gone).
                    function healLayer() {
                        if (layer && layer.isConnected) return;
                        var saved = items; items = {};
                        ensureLayer();
                        for (var k in saved) {
                            var o = saved[k];
                            var it = items[k] = { base: o.base, content: o.content, el: makeEl(), line: useLeader ? makeLine() : null, arrow: (useLeader && useArrow) ? makeArrow() : null };
                            paint(k, it);
                        }
                    }
                    function paint(key, it) {
                        var c = it.content || {};
                        var acc = c.accent || NEUTRAL;
                        it.el.style.borderColor = acc;
                        it.el.innerHTML = c.html || "";
                        if (c.title != null) it.el.title = c.title;
                        if (it.line) it.line.setAttribute("stroke", acc);
                        if (it.arrow) it.arrow.setAttribute("fill", acc);
                    }
                    function position(key) {
                        var it = items[key]; if (!it) return;
                        var p;
                        try { p = api.worldToScreen(it.base.x, it.base.y); } catch (e) { return; }
                        var ax = p.x + offX, ay = p.y + offY;
                        it.el.style.left = Math.round(ax) + "px";
                        it.el.style.top = Math.round(ay) + "px";
                        if (it.line) {
                            // leader runs from the base (its tip point) to the bubble's anchor edge (left-middle)
                            var tp = p;
                            if (tipX || tipY) { try { tp = api.worldToScreen(it.base.x + tipX, it.base.y + tipY); } catch (e) { tp = p; } }
                            it.line.setAttribute("x1", Math.round(tp.x));
                            it.line.setAttribute("y1", Math.round(tp.y));
                            it.line.setAttribute("x2", Math.round(ax));
                            it.line.setAttribute("y2", Math.round(ay));
                            // arrowhead at the tip, oriented along the leader (points INTO the base)
                            if (it.arrow) {
                                var dx = tp.x - ax, dy = tp.y - ay, len = Math.sqrt(dx * dx + dy * dy) || 1;
                                var ux = dx / len, uy = dy / len, AL = 10, AW = 5;
                                var bx = tp.x - ux * AL, by = tp.y - uy * AL, px = -uy, py = ux;
                                it.arrow.setAttribute("points",
                                    Math.round(tp.x) + "," + Math.round(tp.y) + " " +
                                    Math.round(bx + px * AW) + "," + Math.round(by + py * AW) + " " +
                                    Math.round(bx - px * AW) + "," + Math.round(by - py * AW));
                            }
                        }
                    }
                    // ---- region popup overlap hiding (a bubble shares the panels' z-index, so one sitting
                    // over an open base-info panel would paint on top of it; hide just those). Discover the
                    // panel singletons by name pattern - their class names vary by relationship + game
                    // version - and confirm each with a real DOM rect.
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
                    function popupRects() {
                        var rects = [], names = infoPanelNames();
                        for (var i = 0; i < names.length; i++) { var r = infoRect(names[i]); if (r) rects.push(r); }
                        var menu = infoRect("RegionCityMenu"); if (menu) rects.push(menu);
                        return rects;
                    }
                    function rectsIntersect(a, b) { return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom); }
                    function updatePopupVisibility() {
                        if (!layer || layer.style.display === "none") return;
                        var rects = popupRects();
                        for (var k in items) {
                            var it = items[k]; if (!it || !it.el) continue;
                            var hide = false;
                            if (rects.length) {
                                var br = it.el.getBoundingClientRect();
                                for (var i = 0; i < rects.length; i++) { if (rectsIntersect(br, rects[i])) { hide = true; break; } }
                            }
                            it.el.style.visibility = hide ? "hidden" : "visible";
                            if (it.line) it.line.style.visibility = hide ? "hidden" : "visible";
                            if (it.arrow) it.arrow.style.visibility = hide ? "hidden" : "visible";
                        }
                    }
                    function hideLayer() {
                        if (layer) layer.style.display = "none";
                        if (svg) svg.style.display = "none";
                    }
                    function reprojectAll() {
                        if (!master || !api.inRegionView()) { hideLayer(); return; }
                        healLayer();
                        if (layer) layer.style.display = "block";
                        if (svg) svg.style.display = "block";
                        for (var k in items) position(k);
                        updatePopupVisibility();
                    }

                    // bring-up: layer + SAFE camera watcher (poll, never hook render-path events) + popup poll
                    ensureLayer();
                    try {
                        watchStop = api.watch({ onChange: function (st) {
                            try { if (st.region) reprojectAll(); else hideLayer(); } catch (e) { NS.log.err("bubbleLayer watch:", e); }
                        } });
                    } catch (e) { NS.log.err("bubbleLayer watch attach:", e); }
                    popupTimer = window.setInterval(function () {
                        try { if (master && api.inRegionView()) updatePopupVisibility(); } catch (e) {}
                    }, 200);

                    var handle = {
                        set: function (key, base, content) {
                            try {
                                healLayer();
                                var it = items[key];
                                if (!it) it = items[key] = { base: base, content: content, el: makeEl(), line: useLeader ? makeLine() : null, arrow: (useLeader && useArrow) ? makeArrow() : null };
                                it.base = base; it.content = content || {};
                                paint(key, it);
                                position(key);
                                if (!master || !api.inRegionView()) hideLayer();
                                return it;
                            } catch (e) { NS.log.err("bubbleLayer.set:", e); return null; }
                        },
                        remove: function (key) {
                            var it = items[key]; if (!it) return;
                            try { if (it.el && it.el.parentNode) it.el.parentNode.removeChild(it.el); } catch (e) {}
                            try { if (it.line && it.line.parentNode) it.line.parentNode.removeChild(it.line); } catch (e) {}
                            try { if (it.arrow && it.arrow.parentNode) it.arrow.parentNode.removeChild(it.arrow); } catch (e) {}
                            delete items[key];
                        },
                        clear: function () { for (var k in items) handle.remove(k); },
                        has: function (key) { return !!items[key]; },
                        keys: function () { var o = []; for (var k in items) o.push(k); return o; },
                        count: function () { var n = 0; for (var k in items) n++; return n; },
                        visible: function (b) { master = (b !== false); reprojectAll(); },
                        reposition: function () { reprojectAll(); },
                        destroy: function () {
                            try { if (watchStop) watchStop(); } catch (e) {} watchStop = null;
                            try { if (popupTimer) window.clearInterval(popupTimer); } catch (e) {} popupTimer = null;
                            for (var k in items) handle.remove(k);
                            try { if (layer && layer.parentNode) layer.parentNode.removeChild(layer); } catch (e) {}
                            layer = null; svg = null;
                        }
                    };
                    return handle;
                }
            };
            return api;
        })();

        // ui: consistent, movable, position-persistent MMCommon window factory.
        NS.ui = {
            num: NS.num, // convenience alias
            // Create a window with standard chrome whose position (and optional size) persist via
            // MMCommon.settings. opts: { caption, icon, key, layout, width, height, pos:[x,y], resizable,
            //   contentPadding, restoreOpen, persistSize, dock }
            //   persistSize: true  -> remember BOTH width and height across reloads (use width/height as
            //                         the first-run defaults). Without it, only width persists (legacy),
            //                         and only when opts.width is set.
            //   dock: true (or a px threshold, default 24) enables edge-docking - when a drag settles
            //   within the threshold of a viewport edge the window snaps flush to it, the edge persists,
            //   and a docked window re-hugs that edge on viewport/content resize and after a refresh.
            // Returns a qx.ui.window.Window (call .open()/.close()) or null on failure. Call at game-ready.
            Window: function (opts) {
                opts = opts || {};
                try {
                    var key = opts.key || ("GUI.Window." + String(opts.caption || "MM").replace(/\s+/g, "_"));
                    var defPos = opts.pos || [220, 120];
                    var win = new qx.ui.window.Window(opts.caption || "MM", opts.icon || null);
                    win.set({
                        layout: opts.layout || new qx.ui.layout.VBox(),
                        allowMaximize: false, showMaximize: false,
                        allowMinimize: false, showMinimize: false,
                        resizable: (opts.resizable !== false),
                        contentPadding: (opts.contentPadding != null ? opts.contentPadding : 4)
                    });

                    // frameless: a clean "floating panel" with no title bar / window chrome, dragged by
                    // its whole body (e.g. the Next MCV counter). It's still a real qx.ui.window.Window, so
                    // geometry persistence, on-screen clamping and docking all still apply - we just hide the
                    // captionbar + decorator and drive moves ourselves (qx normally drags via the captionbar,
                    // which we've removed). Caller should keep frameless windows simple (no buttons/inputs),
                    // since a mousedown ANYWHERE in the body starts a drag. The HUD-tray toggle opens/closes
                    // it (there's no X). Uses the same mouse-capture drag idiom as the HUD tray.
                    if (opts.frameless) {
                        try { var cb = win.getChildControl("captionbar"); if (cb) cb.exclude(); } catch (e) {}
                        try { win.setDecorator(null); } catch (e) {}
                        try { win.setContentPadding(opts.contentPadding != null ? opts.contentPadding : 0); } catch (e) {}
                        // The inner "pane" child control still carries the theme's "window" decorator, which
                        // borders the sides + bottom but NOT the top (the top normally meets the captionbar we
                        // removed) - the lop-sided "3-sided border" look. Drop it and paint our own uniform thin
                        // border + radius on the window's content element so all four edges match.
                        try { var fp = win.getChildControl("pane"); if (fp) fp.setDecorator(null); } catch (e) {}
                        function styleFrame() {
                            try {
                                var de = win.getContentElement().getDomElement();
                                if (de) { de.style.border = "1px solid rgba(150,170,190,0.55)"; de.style.borderRadius = "6px"; de.style.boxShadow = "0 2px 10px rgba(0,0,0,0.55)"; de.style.boxSizing = "border-box"; de.style.overflow = "hidden"; }
                            } catch (e) {}
                        }
                        win.addListener("appear", styleFrame);
                        styleFrame();
                        (function () {
                            var fDrag = false, fox = 0, foy = 0;
                            win.addListener("mousedown", function (e) {
                                try { var b = win.getBounds(); if (!b || b.left == null) return; fox = e.getDocumentLeft() - b.left; foy = e.getDocumentTop() - b.top; fDrag = true; win.capture(true); e.stop(); } catch (er) {}
                            });
                            win.addListener("mousemove", function (e) {
                                if (!fDrag) return;
                                try { win.moveTo(Math.max(0, e.getDocumentLeft() - fox), Math.max(0, e.getDocumentTop() - foy)); } catch (er) {}
                            });
                            function fEnd() { if (!fDrag) return; fDrag = false; try { win.releaseCapture(); } catch (er) {} savePos(); }
                            win.addListener("mouseup", fEnd);
                            win.addListener("losecapture", fEnd);
                        })();
                    }

                    var lastSaved = null, pollId = null;
                    // Position model for on-screen clamping: `desired` is where the USER parked the window;
                    // the window is DISPLAYED at clampToView(desired) for the current viewport. So when the
                    // viewport shrinks the window slides in only as far as needed, and when it grows back the
                    // window returns to `desired` (instead of staying jammed where the shrink left it).
                    // We don't use a "is this our move or the user's" flag (qooxdoo fires the move event
                    // asynchronously, so a flag set around moveTo is already cleared by the time it fires).
                    // Instead savePos COMPARES the live position to clampToView(desired): if they match it's
                    // our clamp (leave `desired` alone); if they differ the user dragged it (adopt the new
                    // spot). Position comparison is immune to event timing.
                    var desired = null;
                    function clampToView(pos) {
                        var b = win.getBounds() || {};
                        var root = qx.core.Init.getApplication().getRoot().getBounds();
                        var vw = (root && root.width) || window.innerWidth || 1280;
                        var vh = (root && root.height) || window.innerHeight || 720;
                        var maxLeft = Math.max(0, vw - (b.width || 0)), maxTop = Math.max(0, vh - (b.height || 0));
                        return { left: Math.min(Math.max(0, pos.left), maxLeft), top: Math.min(Math.max(0, pos.top), maxTop) };
                    }

                    // Save current bounds (only when actually changed). Polled while visible so this works
                    // even if this qooxdoo build doesn't fire a "move"/"resize" event on drag. When
                    // persistSize is on we save width+height here too (the dedicated "resize" listener
                    // isn't reliable across qooxdoo builds, but this poll is - same mechanism that makes
                    // position persistence work).
                    function savePos() {
                        try {
                            var b = win.getBounds();
                            if (!b || b.left == null) return;
                            if (!desired) desired = { left: b.left, top: b.top };
                            // Is the live position a USER placement, or just where our on-screen clamp put it?
                            // clampToView(desired) is where WE would have placed it. If the live position
                            // differs, the user dragged it -> adopt the new spot as `desired`. If it matches,
                            // leave `desired` alone, so a temporary clamp (viewport too small) never overwrites
                            // the parked spot and a grow-back restores it.
                            var exp = clampToView(desired);
                            if (Math.abs(b.left - exp.left) > 1 || Math.abs(b.top - exp.top) > 1) {
                                desired = { left: b.left, top: b.top };
                            }
                            var v = desired.left + "," + desired.top + (opts.persistSize ? ("," + b.width + "x" + b.height) : "");
                            if (v === lastSaved) return;
                            lastSaved = v;
                            NS.settings.set(key + ".pos", [desired.left, desired.top]);
                            if (opts.persistSize) {
                                if (b.width) NS.settings.set(key + ".w", b.width);
                                if (b.height) NS.settings.set(key + ".h", b.height);
                            }
                            // (no per-save log here - it fires on every drag tick and floods even MM_DEBUG)
                        } catch (e) {}
                    }
                    // Apply saved position/size. CRITICAL: this must NOT run before the player id is loaded.
                    // Until then the settings store resolves to the "default" bucket (not
                    // MM.SETTINGS.<pid>.<wid>), so we'd read defaults and clobber the real saved geometry -
                    // this is the same trap that broke open-state restore. Returns false when the player id
                    // isn't ready yet, so restoreGeometry() can retry.
                    function applyPos() {
                        try {
                            var pid = 0;
                            try { pid = ClientLib.Data.MainData.GetInstance().get_Player().get_Id(); } catch (e) {}
                            if (!pid) return false;
                            var p = NS.settings.get(key + ".pos", defPos);
                            if (p && p.length === 2) {
                                desired = { left: p[0], top: p[1] };   // remember the parked spot
                                win.moveTo(p[0], p[1]);
                                lastSaved = p[0] + "," + p[1];
                            }
                            if (opts.persistSize) {
                                var sw = NS.settings.get(key + ".w", opts.width || null);
                                var sh = NS.settings.get(key + ".h", opts.height || null);
                                if (sw) win.setWidth(sw);
                                if (sh) win.setHeight(sh);
                                // Re-apply once after layout settles - a single early set can be overridden
                                // by the window's content size hint before it's fully realized.
                                window.setTimeout(function () { try { if (sw) win.setWidth(sw); if (sh) win.setHeight(sh); } catch (e) {} }, 300);
                                NS.log.verbose("window", key, "restored pos", p, "size", sw + "x" + sh, "(pid", pid + ")");
                            } else {
                                if (opts.width) { var w = NS.settings.get(key + ".w", opts.width); if (w) win.setWidth(w); }
                                NS.log.verbose("window", key, "restored pos", p, "(pid", pid + ")");
                            }
                            return true;
                        } catch (e) { return false; }
                    }
                    // Apply saved geometry as soon as the player id is ready, retrying briefly if it isn't.
                    function restoreGeometry() {
                        if (applyPos()) return;
                        var t = 0, id = window.setInterval(function () {
                            if (applyPos() || ++t > 40) window.clearInterval(id);
                        }, 150);
                    }

                    // --- edge-docking (opt-in via opts.dock, but OFF unless the user enables it) ----------
                    // The feature is WIRED when opts.dock is set, but actual snapping is gated on a
                    // persisted per-window toggle (<key>.dockEnabled, default false) so it ships OFF and
                    // can't surprise anyone on a different resolution. Toggle at runtime with
                    //   MMCommon.ui.setDock("<window key>", true|false)   (key here = "AllianceOverview.Window").
                    //
                    // Snap MODEL: the window slots into the MARGINS around the game's play area - i.e. the
                    // strips between the play-area letterbox and the browser walls, which is where the
                    // game's own side/corner panels live (next to ICE Crackdown / Destroyer list / etc).
                    // So "dock right" puts the window flush against the LEFT edge of the right-side panel
                    // (window.left = playArea.right), not behind it. Snap target rectangle = the play area
                    // in screen coords (getContentLocation, NOT getBounds which is a scaled coord space).
                    // Falls back to root rect if the play area isn't available - in that case it snaps to
                    // the browser walls instead. Detection: each side measures the distance from the
                    // window's INNER-FACING edge to the play-area's corresponding edge.
                    var DOCK_WIRED = !!opts.dock;
                    var DOCK_T = (typeof opts.dock === "number") ? opts.dock : 40; // snap threshold (px) - generous so the margin strip is easy to hit
                    var snapTimer = null;
                    function dockEnabled() {
                        try { return NS.settings.get(key + ".dockEnabled", false) === true; } catch (e) { return false; }
                    }
                    function dockRect() {
                        try {
                            var pa = qx.core.Init.getApplication().getPlayArea();
                            var loc = pa && pa.getContentLocation && pa.getContentLocation();
                            if (loc && (loc.right - loc.left) > 100 && (loc.bottom - loc.top) > 100) {
                                return { left: loc.left, top: loc.top, right: loc.right, bottom: loc.bottom };
                            }
                        } catch (e) {}
                        try {
                            var r = qx.core.Init.getApplication().getRoot().getBounds();
                            if (r && r.width) return { left: 0, top: 0, right: r.width, bottom: r.height };
                        } catch (e) {}
                        return { left: 0, top: 0, right: window.innerWidth || 1280, bottom: window.innerHeight || 720 };
                    }
                    // Re-pin a docked window into its saved margin (used after positioning, on viewport
                    // resize, and when the window's own content resizes it).
                    function reanchorDock() {
                        try {
                            if (!dockEnabled()) return;
                            var dock = NS.settings.get(key + ".dock", null);
                            if (!dock) return;
                            var b = win.getBounds(); if (!b || b.left == null) return;
                            var R = dockRect(), left = b.left, top = b.top;
                            if (dock === "left") left = Math.max(0, R.left - b.width);   // sit in left margin, right edge flush
                            else if (dock === "right") left = R.right;                   // sit in right margin, left edge flush
                            else if (dock === "top") top = Math.max(0, R.top - b.height); // sit in top margin, bottom edge flush
                            else if (dock === "bottom") top = R.bottom;                  // sit in bottom margin, top edge flush
                            if (left !== b.left || top !== b.top) win.moveTo(left, top);
                        } catch (e) {}
                    }
                    // Keep the window on-screen as the viewport changes, WITHOUT forgetting where the user
                    // parked it. Display position = `desired` pulled in only as far as needed to fit the
                    // current viewport. So: shrink the viewport and a window parked near the right/bottom
                    // edge slides in just enough to stay fully visible; grow it back and the window returns
                    // to `desired` (its parked spot) instead of staying jammed where the shrink left it -
                    // which is what was blocking the view on restore. savePos tells our clamp moves from real
                    // user drags by comparing positions (see clampToView/savePos). Docking takes precedence.
                    function clampIntoView() {
                        try {
                            if (DOCK_WIRED && dockEnabled()) return;
                            var b = win.getBounds(); if (!b || b.left == null || !b.width) return;
                            if (!desired) desired = { left: b.left, top: b.top };
                            var d = clampToView(desired);
                            if (d.left !== b.left || d.top !== b.top) {
                                win.moveTo(d.left, d.top);
                                NS.log.log("window", key, "clamp display", [d.left, d.top], "desired", [desired.left, desired.top]);
                            }
                        } catch (e) {}
                    }
                    // After a drag settles, snap into the closest margin if the window's inner-facing edge
                    // is within DOCK_T of the play-area boundary. Debounced off "move" so it never fights
                    // an in-progress drag.
                    function maybeDock() {
                        try {
                            if (!dockEnabled()) return;
                            var b = win.getBounds(); if (!b || b.left == null) return;
                            var R = dockRect();
                            // Each distance: how far the window's INNER-facing edge is from the play-area
                            // edge on that side (positive = window is outside the play area on that side,
                            // sitting in the margin where it belongs; negative = window overlaps the play
                            // area on that side).
                            var distL = R.left - (b.left + b.width); // left margin: window's right edge vs playArea.left
                            var distR = b.left - R.right;            // right margin: window's left edge vs playArea.right
                            var distT = R.top - (b.top + b.height);  // top margin: window's bottom edge vs playArea.top
                            var distB = b.top - R.bottom;            // bottom margin: window's top edge vs playArea.bottom
                            // Only consider candidates where the window's inner edge is within DOCK_T of
                            // the play-area boundary (can be slightly negative = window juuust overlapping).
                            function score(d) { return (Math.abs(d) <= DOCK_T) ? Math.abs(d) : Infinity; }
                            var sL = score(distL), sR = score(distR), sT = score(distT), sB = score(distB);
                            var min = Math.min(sL, sR, sT, sB), dock = null, left = b.left, top = b.top;
                            if (min < Infinity) {
                                if (min === sL)      { dock = "left";   left = Math.max(0, R.left - b.width); }
                                else if (min === sR) { dock = "right";  left = R.right; }
                                else if (min === sT) { dock = "top";    top  = Math.max(0, R.top - b.height); }
                                else                  { dock = "bottom"; top  = R.bottom; }
                                win.moveTo(Math.max(0, left), Math.max(0, top));
                            }
                            NS.settings.set(key + ".dock", dock);
                            NS.log.log("window", key, "dock =", dock, "playArea", [R.left, R.top, R.right, R.bottom], "dists L/R/T/B", [distL, distR, distT, distB]);
                            savePos();
                        } catch (e) {}
                    }
                    function scheduleSnap() {
                        if (!DOCK_WIRED || !dockEnabled()) return;
                        try { if (snapTimer) window.clearTimeout(snapTimer); } catch (e) {}
                        try { snapTimer = window.setTimeout(maybeDock, 220); } catch (e) {}
                    }
                    // Keep every window usable when the game viewport changes size (e.g. the browser is
                    // restored from maximised, which shrinks the viewport): a docked window re-hugs its
                    // edge; any other window now hanging off an edge is pulled fully back on-screen.
                    try {
                        qx.core.Init.getApplication().getRoot().addListener("resize", function () {
                            if (!win.isVisible()) return;
                            if (DOCK_WIRED && dockEnabled()) reanchorDock();
                            else clampIntoView();
                        });
                    } catch (e) {}
                    if (DOCK_WIRED) {
                        // and when the window's own content grows/shrinks (e.g. a shrink-wrapped list)
                        win.addListener("resize", function () { if (win.isVisible()) reanchorDock(); });
                    }

                    restoreGeometry();
                    win.addListener("appear", function () {
                        restoreGeometry();
                        if (DOCK_WIRED) reanchorDock();
                        // pull on-screen if a saved position is now off-screen (e.g. opened at a smaller
                        // resolution than it was saved at); defer so persistSize width/height have settled.
                        else window.setTimeout(function () { if (win.isVisible()) clampIntoView(); }, 350);
                        try { NS.settings.set(key + ".open", true); } catch (e) {}
                        try { if (pollId == null) pollId = window.setInterval(savePos, 1500); } catch (e) {}
                    });
                    win.addListener("disappear", function () {
                        // NOTE: do NOT clear the ".open" flag here. "disappear" also fires when qooxdoo
                        // tears the widget down on a browser refresh/unload - clearing it there is exactly
                        // what stopped the window re-opening after a refresh. Only an explicit user close
                        // (the "close" event below) should mark it closed.
                        savePos();
                        try { if (pollId != null) { window.clearInterval(pollId); pollId = null; } } catch (e) {}
                    });
                    // Explicit close (X button or win.close()) is the right place to persist "user wants
                    // this closed" - but qooxdoo can also fire lifecycle events while the page is being
                    // torn down on a refresh. Guard with an unload flag so a teardown never clobbers ".open".
                    var unloading = false;
                    try { window.addEventListener("beforeunload", function () { unloading = true; }); } catch (e) {}
                    win.addListener("close", function () {
                        if (unloading) return; // a page refresh/teardown is not a user close
                        try { NS.settings.set(key + ".open", false); } catch (e) {}
                    });
                    // save (savePos decides user-drag vs our-clamp by comparing positions) + edge-snap.
                    win.addListener("move", function () { savePos(); scheduleSnap(); });
                    if (opts.persistSize) {
                        // Persist both dimensions on resize (getBounds is the real on-screen size; getWidth
                        // can read null when the size came from a layout rather than an explicit set).
                        win.addListener("resize", function () {
                            try {
                                var b = win.getBounds();
                                if (b) {
                                    if (b.width) NS.settings.set(key + ".w", b.width);
                                    if (b.height) NS.settings.set(key + ".h", b.height);
                                }
                            } catch (e) {}
                        });
                    } else if (opts.width) {
                        win.addListener("resize", function () { try { NS.settings.set(key + ".w", win.getWidth()); } catch (e) {} });
                    }

                    // Auto-reopen if it was open last session (so a refresh keeps it showing). CRITICAL:
                    // do NOT read the flag at construction - build() only waits for the nav bar, and at
                    // that point the player id isn't loaded yet, so the settings store resolves to the
                    // "MM.SETTINGS.default" bucket instead of "MM.SETTINGS.<pid>.<wid>" and we'd read a
                    // stale/default value (this is exactly what made restore fail). So poll until the
                    // player id is ready, THEN read the flag from the correct per-player store, then keep
                    // retrying open() until the window is actually visible (a single early open() can
                    // silently no-op while the game UI is still settling).
                    if (opts.restoreOpen) {
                        var tries = 0, decided = false, reopenId = window.setInterval(function () {
                            try {
                                var pid = 0;
                                try { pid = ClientLib.Data.MainData.GetInstance().get_Player().get_Id(); } catch (e) {}
                                if (!pid) { if (++tries > 40) window.clearInterval(reopenId); return; } // wait for player id

                                if (!decided) {
                                    decided = true;
                                    var wantOpen = NS.settings.get(key + ".open", false);
                                    NS.log.verbose("window", key, "restoreOpen flag =", wantOpen, "(pid", pid + ")");
                                    if (wantOpen !== true) { window.clearInterval(reopenId); return; }
                                    tries = 0; // reset the budget for the open() retries
                                }

                                if (win.isVisible()) {
                                    window.clearInterval(reopenId);
                                    NS.log.verbose("window", key, "restored open after", tries, "tries");
                                    return;
                                }
                                tries++;
                                win.open();
                                if (tries >= 12) { // ~3.6s of open() retries, then give up
                                    window.clearInterval(reopenId);
                                    NS.log.warn("window", key, "restore gave up after", tries, "tries");
                                }
                            } catch (e) { NS.log.err("restore open failed:", e); }
                        }, 300);
                    }
                    return win;
                } catch (e) {
                    NS.log.err("ui.Window failed:", e);
                    return null;
                }
            }
        };
        // ui.setDock / ui.getDock - runtime toggle for a window's edge-docking. The window must have been
        // created with opts.dock (so the listeners are wired); this just flips the persisted per-window
        // gate. Pass the same `key` you passed to ui.Window(). Default state for every window is OFF, so
        // scripts ship a safe, no-surprises experience and users opt in per window. Examples:
        //   MMCommon.ui.setDock("AllianceOverview.Window", true)
        //   MMCommon.ui.getDock("AllianceOverview.Window")  // -> true/false
        NS.ui.setDock = function (key, on) {
            try {
                NS.settings.set(key + ".dockEnabled", on === true);
                if (on !== true) NS.settings.set(key + ".dock", null); // clear any saved edge so a refresh doesn't pin it
                NS.log.log("window", key, "dockEnabled =", on === true);
                return on === true;
            } catch (e) { NS.log.err("setDock failed:", e); return false; }
        };
        NS.ui.getDock = function (key) {
            try { return NS.settings.get(key + ".dockEnabled", false) === true; } catch (e) { return false; }
        };

        // -------------------------------------------------------------------
        // menubar: dock a widget INTO the game's right-side base-navigation bar
        // (the vertical strip listing your bases + "reset sort order" / "found
        // base" etc.), styled to match the bar so it reads like a native item.
        // This is the capability behind "lock the MCV / the MM buttons into the
        // game menu" (the look Info Sticker had). The insertion target is the
        // proven path Info Sticker uses: getBaseNavigationBar().getChildren()[0]
        // .getChildren()[0] = the list container that exposes addAt/indexOf/
        // remove/getChildren. We do NOT hook the game's reorder method (fragile
        // regex); instead a light shared timer re-inserts our items if the game
        // rebuilds the bar after a base add/remove/reorder. All guarded - if the
        // bar isn't reachable, dock() is a safe no-op and callers fall back.
        // -------------------------------------------------------------------
        NS.menubar = (function () {
            var items = [];   // { widget, getPos(), enabled() , last }
            var timer = null;
            var moAttached = false;   // bar-rebuild MutationObserver wired yet?

            // The qx list-container inside the base navigation bar (or null if not reachable).
            function getBar() {
                try {
                    var app = qx.core.Init.getApplication();
                    var b = app && app.getBaseNavigationBar && app.getBaseNavigationBar();
                    if (!b || !b.getChildren) return null;
                    var c0 = b.getChildren(); if (!c0 || !c0.length || !c0[0].getChildren) return null;
                    var c1 = c0[0].getChildren(); if (!c1 || !c1.length) return null;
                    var list = c1[0];
                    return (list && typeof list.addAt === "function" && typeof list.indexOf === "function") ? list : null;
                } catch (e) { return null; }
            }
            function available() { return !!getBar(); }

            // A container styled like the game's mission-bar buttons (same texture Info Sticker used).
            function styledPanel(opt) {
                opt = opt || {};
                var c = new qx.ui.container.Composite(new qx.ui.layout.VBox(opt.spacing != null ? opt.spacing : 2)).set({
                    padding: opt.padding || [4, 5, 4, 6],
                    width: opt.width || 124,
                    alignX: "right"
                });
                try {
                    c.setDecorator(new qx.ui.decoration.Decorator().set({
                        backgroundImage: "decoration2/button-missionbar/button-missionbar.png",
                        backgroundRepeat: "scale"
                    }));
                } catch (e) {}
                if (opt.marginLeft != null) { try { c.setMarginLeft(opt.marginLeft); } catch (e) {} }
                return c;
            }

            function clampPos(bar, pos) {
                try {
                    var n = bar.getChildren().length;
                    if (pos == null || pos < 0) pos = n; // default = append (bottom of the bar)
                    return Math.max(0, Math.min(pos, n));
                } catch (e) { return 0; }
            }
            function reinsertAll() {
                var bar = getBar();
                if (!bar) return;
                for (var i = 0; i < items.length; i++) {
                    var it = items[i];
                    try {
                        if (it.widget.isDisposed && it.widget.isDisposed()) continue;
                        var on = it.enabled ? (it.enabled() === true) : true;
                        var cur = bar.indexOf(it.widget);
                        if (!on) { if (cur >= 0) bar.remove(it.widget); continue; }
                        var rawPos = it.getPos ? it.getPos() : null;
                        if (cur < 0) {
                            // absent (first insert, or the game rebuilt the bar) -> add it.
                            bar.addAt(it.widget, clampPos(bar, rawPos));
                        } else if (rawPos != null) {
                            // Explicit target index: only move when genuinely out of place. The widget is
                            // already a child, so its valid in-place range is [0, count-1]; comparing cur to
                            // clampPos's append index (count) would never match and churn every tick.
                            var target = Math.max(0, Math.min(rawPos, bar.getChildren().length - 1));
                            if (cur !== target) { bar.remove(it.widget); bar.addAt(it.widget, clampPos(bar, rawPos)); }
                        }
                        // else: append mode (rawPos == null) and already present -> leave as-is. Re-adding
                        // every 1.5s was the cause of anchored buttons flickering (remove+addAt each tick).
                    } catch (e) { /* never let one item break the bar */ }
                }
                attachObserver();   // wire (or retry wiring) the bar-rebuild watcher once the bar DOM exists
            }
            // When the game rebuilds the base-navigation bar (clicking "collect resources" re-sorts the bases
            // and wipes the list), our docked panel is dropped and only the 1.5s timer would bring it back - a
            // visible "buttons vanish then return" gap. Watch the bar's DOM for child changes and re-assert on
            // the next frame. reinsertAll is idempotent (no-op when our items are present) so this can't loop.
            function attachObserver() {
                if (moAttached || typeof MutationObserver === "undefined") return;
                try {
                    var bar = getBar();
                    var dom = bar && bar.getContentElement && bar.getContentElement().getDomElement();
                    if (!dom) return;   // bar not rendered yet - reinsertAll retries this each 1.5s tick
                    new MutationObserver(function () {
                        try { window.requestAnimationFrame(reinsertAll); } catch (e) { reinsertAll(); }
                    }).observe(dom, { childList: true });
                    moAttached = true;
                } catch (e) {}
            }
            function ensureTimer() { if (!timer) { try { timer = window.setInterval(reinsertAll, 1500); } catch (e) {} } }

            return {
                available: available,
                styledPanel: styledPanel,
                // Screen rect {left,top,right,bottom,width,height} of the base navigation bar, or null - for
                // anchoring a panel NEXT TO the bar (vs dock() which inserts INTO it).
                barRect: function () {
                    try {
                        var app = qx.core.Init.getApplication();
                        var b = app && app.getBaseNavigationBar && app.getBaseNavigationBar();
                        if (b && b.getContentLocation) { var l = b.getContentLocation(); if (l && (l.left || l.right)) return l; }
                    } catch (e) {}
                    return null;
                },
                // dock(widget, { pos, enabled }) -> { remove(), refresh() }. pos = index (number|fn|null=append);
                // enabled = optional fn; when it returns false the widget is pulled out of the bar (kept for re-add).
                dock: function (widget, o) {
                    o = o || {};
                    var rec = {
                        widget: widget,
                        getPos: (typeof o.pos === "function") ? o.pos : function () { return (o.pos == null ? null : o.pos); },
                        enabled: (typeof o.enabled === "function") ? o.enabled : null
                    };
                    items.push(rec);
                    ensureTimer();
                    reinsertAll();
                    return {
                        remove: function () {
                            try { var bar = getBar(); if (bar && bar.indexOf(widget) >= 0) bar.remove(widget); } catch (e) {}
                            var idx = items.indexOf(rec); if (idx >= 0) items.splice(idx, 1);
                        },
                        refresh: reinsertAll
                    };
                }
            };
        })();

        // buttons: CommonButtonHandler - a single draggable HUD "tray" that every script's button
        // registers into. Plug-n-play: no matter which scripts are enabled or in what order, their
        // buttons stack side-by-side in one bar instead of fighting for fixed corners.
        //
        // WHY (Mike's feedback on the old version): a per-script fixed bottom-right offset (right: 120 + idx*130)
        // a) overlaps the game's own corner widgets on some resolutions, and b) gets unusable when several
        // scripts each compute their own offset (the offsets are blind to each other across script loads).
        // A single shared tray fixes both: it occupies one rectangle the user can park anywhere.
        //
        // UX: a small "::" handle on the left of the tray is the drag affordance. Buttons stay clickable.
        // Position persists per player+world via MMCommon.settings (key "HUDTray.pos" = {left, top}).
        // Initial default = bottom-right with margins that clear the game's own bottom-right UI block.
        //
        // opts: { id, label, icon, tooltip, onExecute }. Returns the qx button or null. Call at game-ready.
        NS.buttons = (function () {
            var tray = null, handle = null, slots = [];
            var menuPanel = null, menuDock = null;   // when docked into the game menu bar instead of the float tray
            var pendingMenu = [], placeTries = 0, placeTimer = null;   // buttons waiting for the base bar (menubar mode)
            var DEFAULTS = { bottom: 40, right: 220 }; // initial parking spot, clear of game UI
            var KEY = "HUDTray";

            // Order docked buttons alphabetically (ascending) by label. Used ONLY for the in-menu-bar
            // ("docked") placement; the float tray keeps registration order.
            function byLabelAsc(btnA, btnB) {
                var la = "", lb = "";
                try { la = (btnA.getLabel && btnA.getLabel()) || ""; } catch (e) {}
                try { lb = (btnB.getLabel && btnB.getLabel()) || ""; } catch (e) {}
                return String(la).toLowerCase().localeCompare(String(lb).toLowerCase());
            }

            // Display mode: "float" (the draggable tray, default) or "menubar" (the buttons live inside the
            // game's base-navigation bar via NS.menubar). Read once at register time; changing it needs a reload.
            // IMPORTANT: stored in plain localStorage (a GLOBAL pref), NOT the pid-keyed NS.settings. register()
            // runs right after nav-ready, BEFORE the per-player settings bucket exists (same pid-timing trap as
            // the saved tray position below) - so a pid-keyed read would always return the "float" default on
            // reload and the buttons would never move off the tray. localStorage is available immediately.
            function dockMode() { try { return (window.localStorage.getItem("MM.HUDTray.dock") === "menubar") ? "menubar" : "float"; } catch (e) { return "float"; } }
            // Build (once) a styled panel docked in the game menu bar that the MM buttons stack into.
            // Returns null if the bar isn't reachable, so register() falls back to the float tray.
            function ensureMenuPanel() {
                if (menuPanel) return menuPanel;
                try {
                    if (!NS.menubar || !NS.menubar.available()) return null;
                    menuPanel = NS.menubar.styledPanel({ width: 124, spacing: 3, marginLeft: 5 });
                    menuPanel.add(new qx.ui.basic.Label(NS.i18n.t("MM Tools")).set({ font: "bold", textColor: "#595969", textAlign: "center", alignX: "center" }));
                    menuDock = NS.menubar.dock(menuPanel, { pos: null, enabled: function () { return showPref() && dockMode() === "menubar"; } });
                } catch (e) { NS.log.err("menubar panel:", e); menuPanel = null; }
                return menuPanel;
            }
            // Place queued menubar buttons once the base bar is reachable. register() runs at nav-ready, which
            // can be slightly BEFORE getBaseNavigationBar() is populated - so rather than fall straight back to
            // the float tray (which stranded the buttons there), we queue and retry for ~30s, then fall back.
            function flushMenuButtons() {
                placeTimer = null;
                if (!pendingMenu.length) return;
                var mp = ensureMenuPanel();
                if (mp) {
                    // Re-sort the ENTIRE docked set, not just this batch. register() runs once per script
                    // across several ticks, so a heavy/slow script (e.g. Base Tools) flushes in a LATER batch;
                    // a per-batch sort+append stranded it at the bottom instead of its global alphabetical slot.
                    // moveButtonsTo(mp) re-orders every registered button (the "MM Tools" label is left alone).
                    pendingMenu = [];
                    moveButtonsTo(mp);
                    return;
                }
                if (++placeTries <= 30) { placeTimer = window.setTimeout(flushMenuButtons, 1000); return; }
                var t = ensureTray();   // bar never showed up - don't lose the buttons
                if (t) { for (var j = 0; j < pendingMenu.length; j++) { try { t.add(pendingMenu[j]); } catch (e) {} } }
                pendingMenu = [];
            }
            function scheduleFlush() { if (!placeTimer) placeTimer = window.setTimeout(flushMenuButtons, 0); }

            // Move every registered button into `container` (re-parenting from wherever it currently lives).
            function moveButtonsTo(container) {
                // Docking into the in-game menu bar: place buttons alphabetically and re-add even those
                // already present so the order is enforced. Float tray: keep registration order (skip
                // buttons already parented there).
                var sorted = (container === menuPanel);
                var list = slots.slice();
                if (sorted) list.sort(function (a, b) { return byLabelAsc(a.btn, b.btn); });
                for (var i = 0; i < list.length; i++) {
                    var b = list[i].btn;
                    try {
                        var p = b.getLayoutParent && b.getLayoutParent();
                        if (p === container && !sorted) continue;
                        if (p && p.remove) p.remove(b);
                        container.add(b);
                    } catch (e) {}
                }
            }
            // Apply the current dock mode LIVE (no reload): re-parent the buttons between the float tray and the
            // in-bar "MM Tools" panel, and add/remove that panel from the bar.
            function applyDockMode() {
                try {
                    if (dockMode() === "menubar") {
                        var mp = ensureMenuPanel();
                        if (mp) {
                            pendingMenu = [];               // anything queued is about to be placed directly
                            moveButtonsTo(mp);
                            if (menuDock) menuDock.refresh(); // enabled()=true now -> panel inserted into the bar
                        } else {                            // bar not ready yet - queue for placement
                            for (var i = 0; i < slots.length; i++) {
                                var b = slots[i].btn;
                                try { var p = b.getLayoutParent && b.getLayoutParent(); if (p && p.remove) p.remove(b); } catch (e) {}
                                pendingMenu.push(b);
                            }
                            scheduleFlush();
                        }
                    } else {
                        var t = ensureTray();
                        if (t) moveButtonsTo(t);
                        if (menuDock) menuDock.refresh();   // enabled()=false now -> panel pulled out of the bar
                    }
                    applyVisible(showPref());
                } catch (e) { NS.log.err("applyDockMode:", e); }
            }

            // Optional display: the HUD tray can be hidden (the CnC Pack menu provides the same
            // window-openers). The intent is persisted per player+world; default = shown so existing
            // installs are unchanged. The "Show Toolbar Buttons" item in the CnC Pack menu flips it.
            function showPref() {
                try { return NS.settings.get(KEY + ".show", true) !== false; } catch (e) { return true; }
            }
            function applyVisible(v) {
                var menubar = (dockMode() === "menubar");
                // in menubar mode the float tray is always hidden (it's empty - buttons live in the bar)
                try { if (tray) { if (v && !menubar) tray.show(); else tray.exclude(); } } catch (e) {}
                try { if (menuPanel) { if (v) menuPanel.show(); else menuPanel.exclude(); } } catch (e) {}
                try { if (menuDock) menuDock.refresh(); } catch (e) {}
            }

            // Apply absolute {left,top} layout properties to the tray, replacing whatever placement
            // (default bottom/right anchors or a prior left/top) is currently in effect. Canvas layouts
            // ignore unset hints, so we explicitly null the others when switching to absolute mode.
            function placeAbsolute(left, top) {
                try {
                    tray.setLayoutProperties({ left: left, top: top, right: null, bottom: null });
                } catch (e) {}
            }

            function ensureTray() {
                if (tray) return tray;
                try {
                    var app = qx.core.Init.getApplication();
                    tray = new qx.ui.container.Composite(new qx.ui.layout.HBox(4)).set({
                        padding: 3,
                        zIndex: 10000
                    });
                    // The drag handle sits left of the buttons. Listening on the handle (not the tray)
                    // keeps the buttons themselves freely clickable - dragging anywhere else does nothing.
                    handle = new qx.ui.basic.Label("::").set({
                        cursor: "move",
                        paddingLeft: 4, paddingRight: 6, paddingTop: 2, paddingBottom: 2,
                        textColor: "#cccccc",
                        font: new qx.bom.Font(14, ["monospace"]).set({ bold: true }),
                        toolTipText: "Drag to reposition the MM button bar"
                    });
                    tray.add(handle);
                    app.getDesktop().add(tray, DEFAULTS);
                    applyVisible(showPref()); // honor the hidden/shown intent (re-checked once the player id loads)

                    // --- drag handling -------------------------------------------------------------
                    // The qooxdoo "mousemove" only fires on a widget when the cursor is inside its
                    // bounds. While dragging, the cursor often leaves the tray, so we capture(true)
                    // on mousedown to route all pointer events to the tray until mouseup. This is
                    // the standard qooxdoo idiom for in-app drag; no global document handlers needed.
                    var dragging = false, dx = 0, dy = 0;
                    handle.addListener("mousedown", function (e) {
                        try {
                            var loc = tray.getContentLocation();
                            dx = e.getDocumentLeft() - loc.left;
                            dy = e.getDocumentTop() - loc.top;
                            dragging = true;
                            tray.capture(true);
                            e.stop();
                        } catch (e2) { NS.log.err("tray drag start failed:", e2); }
                    });
                    tray.addListener("mousemove", function (e) {
                        if (!dragging) return;
                        try {
                            var nx = Math.max(0, e.getDocumentLeft() - dx);
                            var ny = Math.max(0, e.getDocumentTop() - dy);
                            placeAbsolute(nx, ny);
                        } catch (e2) {}
                    });
                    function endDrag(e) {
                        if (!dragging) return;
                        dragging = false;
                        try {
                            tray.releaseCapture();
                            var loc = tray.getContentLocation();
                            NS.settings.set(KEY + ".pos", { left: loc.left, top: loc.top });
                            NS.log.log("HUDTray saved pos", loc);
                        } catch (e2) {}
                    }
                    tray.addListener("mouseup", endDrag);
                    tray.addListener("losecapture", endDrag); // safety: if capture is lost mid-drag

                    // --- restore saved position (player-id gated, same pattern as ui.Window restore) -
                    // Same trap as the window bug we already fixed: building right after nav-ready
                    // means settings.storeKey() resolves to the "default" bucket because the player
                    // id hasn't loaded. Wait for it, then apply the saved pos.
                    var tries = 0, restoreId = window.setInterval(function () {
                        try {
                            var pid = 0;
                            try { pid = ClientLib.Data.MainData.GetInstance().get_Player().get_Id(); } catch (_) {}
                            if (!pid) { if (++tries > 40) window.clearInterval(restoreId); return; }
                            window.clearInterval(restoreId);
                            var saved = NS.settings.get(KEY + ".pos", null);
                            if (saved && saved.left != null) {
                                placeAbsolute(saved.left, saved.top);
                                NS.log.verbose("HUDTray restored pos", saved);
                            }
                            applyVisible(showPref()); // re-apply from the correct per-player bucket
                        } catch (_) {}
                    }, 300);

                    return tray;
                } catch (e) {
                    NS.log.err("HUDTray creation failed:", e);
                    return null;
                }
            }

            // Mirror a registered button into the CnC Pack menu's "Open Window" submenu, so a tool's
            // window can be opened from the top menu even when the tray is hidden. Safe if NS.menu
            // isn't ready yet (it polls/rebuilds from its own side).
            function feedMenu(opts) {
                try {
                    if (opts && opts.onExecute && NS.menu && NS.menu.registerWindow) {
                        NS.menu.registerWindow({ id: opts.id, label: opts.label, icon: opts.icon, run: opts.onExecute });
                    }
                } catch (e) {}
            }

            return {
                register: function (opts) {
                    opts = opts || {};
                    try {
                        // de-dupe: if a script registers twice (e.g. on reload), return the existing button
                        if (opts.id) {
                            for (var i = 0; i < slots.length; i++) {
                                if (slots[i].id === opts.id) { feedMenu(opts); return slots[i].btn; }
                            }
                        }
                        // text-only: not every tool ships an icon, so show none for a consistent bar
                        var btn = new qx.ui.form.Button(opts.label || "").set({
                            toolTipText: opts.tooltip || opts.label || "",
                            alignY: "middle",
                            appearance: "button-text-small"
                        });
                        if (opts.onExecute) btn.addListener("execute", opts.onExecute);
                        // menubar mode: queue into the in-game panel (placed once the base bar is ready, with a
                        // ~30s fallback to the float tray so buttons are never lost). float mode: the tray.
                        if (dockMode() === "menubar") {
                            pendingMenu.push(btn);
                            scheduleFlush();
                        } else {
                            var t = ensureTray();
                            if (!t) return null;
                            t.add(btn);
                        }
                        slots.push({ id: opts.id, label: opts.label, btn: btn });
                        feedMenu(opts);
                        return btn;
                    } catch (e) {
                        NS.log.err("buttons.register failed:", e);
                        return null;
                    }
                },
                // Display mode for the MM buttons: "float" (draggable tray) or "menubar" (in the game's base
                // navigation bar). Changing it takes effect on the next game reload.
                dockMode: function () { return dockMode(); },
                setDockMode: function (m) {
                    try { window.localStorage.setItem("MM.HUDTray.dock", (m === "menubar") ? "menubar" : "float"); } catch (e) {}
                    try { applyDockMode(); } catch (e) {}   // live - no reload needed
                    return dockMode();
                },
                // Optional-display control (used by the CnC Pack menu's "Show Toolbar Buttons" toggle).
                isVisible: function () { return showPref(); },
                setVisible: function (v) {
                    v = (v !== false);
                    try { NS.settings.set(KEY + ".show", v); } catch (e) {}
                    applyVisible(v);
                    return v;
                },
                // Show/hide a single registered button by its label (used by the CnC Pack menu to instantly
                // add/remove a script's button when you enable/disable that script). No-op if no match.
                setButtonEnabled: function (label, on) {
                    try {
                        for (var i = 0; i < slots.length; i++) {
                            if (slots[i].label === label && slots[i].btn) {
                                if (on === false) slots[i].btn.exclude(); else slots[i].btn.show();
                            }
                        }
                    } catch (e) {}
                }
            };
        })();

        // -------------------------------------------------------------------
        // lifecycle: let a RUNNING script react when it's enabled/disabled from
        // the CnC Pack menu (or the options page) WITHOUT a game refresh. The
        // menu writes CNCTA_ENABLED via the content.js bridge, which re-broadcasts
        // the full {kind:"state"} map; we listen to that same broadcast and fire a
        // per-script onDisable/onEnable when its bit flips. A script registers with
        // its registry id and a teardown/resume pair - e.g. Off/Def Bubbles stops
        // its survey + clears its overlay on disable instead of churning on until a
        // refresh. (Enabling a script that was OFF at PAGE LOAD still needs a
        // refresh - it was never injected - but toggling within a session is live.)
        // -------------------------------------------------------------------
        NS.lifecycle = (function () {
            var MARK = "__cncpack";
            var enabled = {};   // id -> last-known bool
            var subs = [];      // { id, onEnable, onDisable }

            function post(msg) { try { msg[MARK] = 1; window.postMessage(msg, "*"); } catch (e) {} }
            function onMsg(ev) {
                try {
                    if (ev.source !== window) return;
                    var d = ev.data;
                    if (!d || d[MARK] !== 1 || d.kind !== "state") return;
                    var em = d.enabled || {};
                    for (var i = 0; i < subs.length; i++) {
                        var s = subs[i];
                        var now = em[s.id] === true;
                        var was = enabled[s.id];
                        enabled[s.id] = now;
                        if (was === undefined) continue;          // first read = baseline, don't fire
                        if (now === was) continue;
                        try {
                            if (now) { if (s.onEnable) s.onEnable(); }
                            else { if (s.onDisable) s.onDisable(); }
                        } catch (e) { NS.log.err("lifecycle cb (id " + s.id + "):", e); }
                    }
                } catch (e) {}
            }
            try { window.addEventListener("message", onMsg); } catch (e) {}

            return {
                // watch(id, { onEnable, onDisable }) - callbacks fire on a real transition only.
                watch: function (id, opts) {
                    if (!id || !opts) return;
                    subs.push({ id: id, onEnable: opts.onEnable, onDisable: opts.onDisable });
                    post({ req: "get" });   // ensure a state broadcast arrives to baseline this id
                },
                // current known state (undefined until the first broadcast lands)
                isEnabled: function (id) { return enabled[id]; }
            };
        })();

        // -------------------------------------------------------------------
        // menu: the in-game "CnC Pack" top menu - one control center for the
        // reworked MM scripts. It RENAMES the game's native "Scripts" top-bar
        // button to "CnC Pack" and fills it with:
        //   * the MM scripts grouped exactly like the options page (SIMULATOR /
        //     GET INFO HELPER / TOOL AND TOOL-PACK / GUI ENHANCER), each a
        //     Windows-style checkbox = enabled-state. Clicking toggles enable/
        //     disable and the menu STAYS OPEN (multi-toggle) - we override the
        //     menu item's _onTap so it doesn't hideAll() like a normal item.
        //   * an "Open Window" submenu listing every tool that registered a HUD
        //     button (so windows open from the menu even when the tray is hidden).
        //   * a "Show Toolbar Buttons" toggle (the HUD tray is now optional).
        // The enabled-state is the extension's CNCTA_ENABLED map, mirrored to the
        // options page. The page can't read chrome.storage, so this talks to the
        // bridge in content.js via window.postMessage. The Framework Wrapper and
        // Common Library are intentionally NOT listed (always on, not toggleable).
        // -------------------------------------------------------------------
        NS.menu = (function () {
            var MARK = "__cncpack";
            var state = { scripts: [], enabled: {}, ready: false };
            var openers = [];          // {id,label,icon,run} window-openers (fed by buttons.register / registerWindow)
            var itemsById = {};        // script id -> its CheckBox (for in-place value refresh)
            var built = false, packBtn = null, openSubBtn = null, ensureTimer = null;

            // category key -> options-page header, in options-page order. Wrapper category excluded.
            var CATS = [
                ["simulator", "SIMULATOR"],
                ["infotool", "GET INFO HELPER"],
                ["tool", "TOOL AND TOOL-PACK"],
                ["gui", "GUI ENHANCER"]
            ];
            var LOCKED = { 10001: true, 10200: true }; // wrapper + common library: never listed/toggled

            function cleanName(name) { return String(name || "").replace(/^MM\s*-\s*/, ""); }
            function isPackScript(s) {
                if (!s || LOCKED[s.id]) return false;
                if (s.cat === "wrapper") return false;
                return /^MM\s*-/.test(s.name || "");
            }

            // --- bridge to content.js -----------------------------------------------------------
            function post(msg) { try { msg[MARK] = 1; window.postMessage(msg, "*"); } catch (e) {} }
            function requestState() { post({ req: "get" }); }
            function setEnabled(id, on) {
                if (LOCKED[id]) return;
                state.enabled[id] = on;            // optimistic; content.js echoes the authoritative state back
                post({ req: "set", id: id, enabled: on });
            }
            function onMsg(ev) {
                try {
                    if (ev.source !== window) return;
                    var d = ev.data;
                    if (!d || d[MARK] !== 1 || d.kind !== "state") return;
                    state.scripts = d.scripts || [];
                    state.enabled = d.enabled || {};
                    state.ready = true;
                    onStateUpdated();
                } catch (e) {}
            }

            // --- the menu -----------------------------------------------------------------------
            function packButton() {
                try {
                    var app = qx.core.Init.getApplication();
                    var mb = app.getMenuBar ? app.getMenuBar() : null;
                    var sb = (mb && mb.getScriptsButton) ? mb.getScriptsButton() : null;
                    if (!sb) {
                        var item = app.getUIItem(ClientLib.Data.Missions.PATH.BAR_MENU);
                        sb = (item && item.getScriptsButton) ? item.getScriptsButton() : null;
                    }
                    return sb || null;
                } catch (e) { return null; }
            }

            // A qx.ui.menu.CheckBox whose tap toggles the value but does NOT close the menu, so several
            // entries can be flipped in one visit. The close-on-tap lives in AbstractButton._onTap (it
            // calls execute() then defers Manager.hideAll()). That tap listener is bound to the PROTOTYPE
            // method at construction, so overriding _onTap on an instance is ignored by real taps - it must
            // be overridden on a subclass prototype. Here _onTap calls execute() (which toggles the value +
            // fires "execute") and intentionally skips hideAll().
            function checkBoxClass() {
                try {
                    if (!qx.Class.isDefined("mm.MenuCheckBox")) {
                        qx.Class.define("mm.MenuCheckBox", {
                            extend: qx.ui.menu.CheckBox,
                            members: {
                                _onTap: function (e) {
                                    try { if (e && e.isLeftPressed && !e.isLeftPressed()) return; } catch (_) {}
                                    this.execute(); // toggles value + fires "execute"; deliberately no Manager.hideAll()
                                }
                            }
                        });
                    }
                    return qx.Class.getByName("mm.MenuCheckBox") || qx.ui.menu.CheckBox;
                } catch (e) { NS.log.err("MenuCheckBox define:", e); return qx.ui.menu.CheckBox; }
            }

            // Build a keep-open checkbox item. onToggle(newValue) runs ONLY on a real user tap (via the
            // "execute" event), NOT on programmatic setValue - so refreshValues() can sync the displayed
            // values without re-persisting (avoids a feedback loop).
            function makeToggle(label, initial, onToggle, tooltip) {
                var Cls = checkBoxClass();
                var cb = new Cls(label);
                try { cb.setValue(initial === true); } catch (e) {}
                if (tooltip) { try { cb.setToolTipText(tooltip); } catch (e) {} }
                cb.addListener("execute", function () { try { onToggle(cb.getValue()); } catch (err) { NS.log.err("toggle:", err); } });
                return cb;
            }

            function makeCheckItem(s) {
                return makeToggle(cleanName(s.name), state.enabled[s.id] === true,
                    function (v) { setEnabled(s.id, v); },
                    "Enable/disable " + (s.name || "") + " (takes effect on next game refresh)");
            }

            function buildOpenSubmenu() {
                var m = new qx.ui.menu.Menu();
                var any = false;
                for (var i = 0; i < openers.length; i++) {
                    (function (op) {
                        if (!op || !op.run) return;
                        if (op.id && state.enabled[op.id] === false) return; // only enabled tools
                        any = true;
                        // no icons: we don't have one for every tool, so show none (consistency)
                        var b = new qx.ui.menu.Button(op.label || NS.i18n.t("Open"));
                        b.addListener("execute", function () { try { op.run(); } catch (e) { NS.log.err("opener:", e); } });
                        m.add(b);
                    })(openers[i]);
                }
                if (!any) {
                    var none = new qx.ui.menu.Button(NS.i18n.t("(enable a tool first)"));
                    try { none.setEnabled(false); } catch (e) {}
                    m.add(none);
                }
                return m;
            }

            function build() {
                var sb = packButton();
                if (!sb || !state.ready) return false;
                try {
                    packBtn = sb;
                    sb.setLabel(NS.i18n.t("CnC Pack"));
                    // The native Scripts button ships hidden AND, when revealed via its .Add() method,
                    // re-tiles the bar so the previous end button (Ranking) becomes a middle tile and the
                    // Scripts button becomes the right end-cap. We populate it with setMenu() instead of
                    // .Add(), so we call the same native integrator (__Hi) to both reveal it and fix the
                    // tiling - a plain show() leaves it as a detached extra tile with a seam after Ranking.
                    // __Hi is obfuscated; if a game update renames it, fall back to show() (menu still works,
                    // just with the cosmetic seam).
                    var revealed = false;
                    try { if (typeof sb.__Hi === "function") { sb.__Hi(); revealed = true; } } catch (e) {}
                    if (!revealed) { try { sb.show(); } catch (e) {} }
                    var menu = new qx.ui.menu.Menu();
                    itemsById = {};
                    for (var c = 0; c < CATS.length; c++) {
                        var cat = CATS[c][0], title = CATS[c][1];
                        var items = state.scripts.filter(function (s) { return isPackScript(s) && (s.cat || "") === cat; });
                        if (!items.length) continue;
                        items.sort(function (a, b) { return cleanName(a.name).localeCompare(cleanName(b.name)); });
                        // Single-item categories get hoisted to the top level - a one-item drill-down
                        // submenu is just clicks-for-no-reason. Multi-item categories keep their submenu
                        // group label (SIMULATOR / GET INFO HELPER / etc).
                        if (items.length === 1) {
                            var soleCb = makeCheckItem(items[0]);
                            itemsById[items[0].id] = soleCb;
                            menu.add(soleCb);
                            continue;
                        }
                        var sub = new qx.ui.menu.Menu();
                        for (var i = 0; i < items.length; i++) {
                            var cb = makeCheckItem(items[i]);
                            itemsById[items[i].id] = cb;
                            sub.add(cb);
                        }
                        var groupBtn = new qx.ui.menu.Button(NS.i18n.t(title));
                        groupBtn.setMenu(sub);
                        menu.add(groupBtn);
                    }
                    menu.addSeparator();
                    openSubBtn = new qx.ui.menu.Button(NS.i18n.t("Open Window"));
                    openSubBtn.setMenu(buildOpenSubmenu());
                    menu.add(openSubBtn);
                    menu.addSeparator();
                    var trayCb = makeToggle(NS.i18n.t("Show Toolbar Buttons"), NS.buttons.isVisible(),
                        function (v) { NS.buttons.setVisible(v); },
                        NS.i18n.t("Show or hide the MM button bar"));
                    menu.add(trayCb);
                    // Dock the MM buttons inside the game's base menu bar instead of the floating tray.
                    // Changing it needs a game reload (buttons are placed at register time), so we note that.
                    try {
                        var dockCb = makeToggle(NS.i18n.t("Dock buttons in game menu"),
                            (NS.buttons.dockMode && NS.buttons.dockMode() === "menubar"),
                            function (v) { try { NS.buttons.setDockMode(v ? "menubar" : "float"); } catch (e) {} },
                            NS.i18n.t("Put the MM buttons inside the game's base-navigation bar (applies immediately)"));
                        menu.add(dockCb);
                    } catch (e) { NS.log.err("dock toggle:", e); }

                    // Debug-only language switcher: simulate any region's locale to test translations.
                    // Intentionally ALWAYS English (a developer tool) and only present when debug mode is
                    // on (window.MM_DEBUG === true, or localStorage MM_DEBUG === "1"). Selecting a language
                    // persists the override and reloads so every script rebuilds in it; "Auto" clears it.
                    try {
                        var dbg = false;
                        try { dbg = (window.MM_DEBUG === true) || (window.localStorage.getItem("MM_DEBUG") === "1"); } catch (e) {}
                        if (dbg) {
                            menu.addSeparator();
                            var curLang = NS.i18n.getLang();
                            // Build the list dynamically: Auto + English + every language present in the
                            // catalogs (so new languages show up automatically). Names are display-only.
                            var NAMES = { en: "English", fr: "Francais", de: "Deutsch", ru: "Russian",
                                es: "Espanol", it: "Italiano", pt: "Portugues", nl: "Nederlands", pl: "Polski",
                                ro: "Romana", hu: "Magyar", tr: "Turkce", cs: "Cestina", sk: "Slovencina",
                                sv: "Svenska", nb: "Norsk", da: "Dansk", fi: "Suomi", hr: "Hrvatski",
                                uk: "Ukrainian", be: "Belarusian", bg: "Bulgarian", el: "Greek", ar: "Arabic",
                                id: "Bahasa" };
                            var LANGS = [["", "Auto (game locale)"], ["en", "English"]];
                            try {
                                Object.keys(NS.i18n.catalogs).sort().forEach(function (c) {
                                    if (c !== "en") LANGS.push([c, NAMES[c] || c]);
                                });
                            } catch (e) {}
                            var langSub = new qx.ui.menu.Menu();
                            for (var li = 0; li < LANGS.length; li++) {
                                (function (code, name) {
                                    var lb = new qx.ui.menu.Button(name + (code && code === curLang ? "  (*)" : ""));
                                    lb.addListener("execute", function () {
                                        try { NS.i18n.setLang(code || null); } catch (e) {}
                                        try { window.location.reload(); } catch (e) {}
                                    });
                                    langSub.add(lb);
                                })(LANGS[li][0], LANGS[li][1]);
                            }
                            var langBtn = new qx.ui.menu.Button("Language (debug)");
                            langBtn.setMenu(langSub);
                            menu.add(langBtn);
                        }
                    } catch (e) { NS.log.err("debug lang menu:", e); }
                    sb.setMenu(menu);
                    built = true;
                    NS.log.log("CnC Pack menu built");
                    return true;
                } catch (e) { NS.log.err("menu.build:", e); return false; }
            }

            // Update item values + the Open submenu in place, WITHOUT rebuilding the menu (a rebuild would
            // collapse the menu mid-use). Falls back to build() if we haven't built yet.
            // Instantly add/remove each script's HUD/menu button to match its enabled state (so toggling a
            // script in the CnC Pack menu adds/removes its button right away, not on reload). Matches a button
            // to a script by its label == the short (MM-stripped) script name.
            function syncButtonsEnabled() {
                try {
                    if (!NS.buttons || !NS.buttons.setButtonEnabled || !state.scripts) return;
                    for (var i = 0; i < state.scripts.length; i++) {
                        var s = state.scripts[i];
                        if (!isPackScript(s)) continue;
                        NS.buttons.setButtonEnabled(cleanName(s.name), state.enabled[s.id] !== false);
                    }
                } catch (e) {}
            }
            function onStateUpdated() {
                syncButtonsEnabled();
                if (!built) { if (!build()) scheduleEnsure(); return; }
                try {
                    for (var id in itemsById) { try { itemsById[id].setValue(state.enabled[id] === true); } catch (e) {} }
                    if (openSubBtn) openSubBtn.setMenu(buildOpenSubmenu());
                } catch (e) { NS.log.err("menu.refresh:", e); }
            }

            function scheduleEnsure() {
                try { if (ensureTimer) window.clearTimeout(ensureTimer); } catch (e) {}
                ensureTimer = window.setTimeout(function () { if (!built) { if (!build()) scheduleEnsure(); } }, 400);
            }

            function init() {
                try { window.addEventListener("message", onMsg); } catch (e) {}
                // wait for the game menu bar, then ask the bridge for state and build
                var tries = 0, id = window.setInterval(function () {
                    if (packButton()) { window.clearInterval(id); requestState(); }
                    else if (++tries > 160) window.clearInterval(id);
                }, 250);
                window.setTimeout(requestState, 1500); // belt-and-braces re-request
            }

            return {
                init: init,
                refresh: requestState,
                packButton: packButton,
                // A loaded script can register a window-opener directly (e.g. the battle sim, which has no
                // HUD tray button). buttons.register() also calls this automatically.
                registerWindow: function (opts) {
                    opts = opts || {};
                    if (!opts.run) return;
                    for (var i = 0; i < openers.length; i++) {
                        if (openers[i].id && openers[i].id === opts.id) { openers[i] = opts; if (built && openSubBtn) try { openSubBtn.setMenu(buildOpenSubmenu()); } catch (e) {} return; }
                    }
                    openers.push(opts);
                    if (built && openSubBtn) { try { openSubBtn.setMenu(buildOpenSubmenu()); } catch (e) {} }
                }
            };
        })();

        window.MMCommon = NS;
        window.MMCommon_IsInstalled = true;
        // Global translation shorthand used by every pack script: MMt("English text").
        // Defensive - returns the source string unchanged if i18n isn't ready, so a script
        // that calls it early never breaks and English is always identity.
        try {
            window.MMt = function (s) {
                try { return (window.MMCommon && window.MMCommon.i18n) ? window.MMCommon.i18n.t(s) : s; }
                catch (e) { return s; }
            };
        } catch (e) {}
        try { NS.menu.init(); } catch (e) { NS.log.err("menu.init:", e); }
        log.log("MMCommon " + NS.version + " ready");
    };

    try {
        var el = document.createElement("script");
        el.textContent = "(" + MMCommon_main.toString() + ")();";
        el.type = "text/javascript";
        if (/commandandconquer\.com/i.test(document.domain)) {
            (document.head || document.documentElement).appendChild(el);
        }
    } catch (e) {
        console.error("[MM Common] init error: ", e);
    }
})();
