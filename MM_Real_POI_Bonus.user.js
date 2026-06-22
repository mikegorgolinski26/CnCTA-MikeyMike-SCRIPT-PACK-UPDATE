// ==UserScript==
// @name           MM - Real POI Bonus
// @namespace      https://cncapp*.alliances.commandandconquer.com/*/index.aspx*
// @include        https://cncapp*.alliances.commandandconquer.com/*/index.aspx*
// @description    When you select a POI on the region map, shows the REAL gain/loss to your alliance's bonus if you took or lost it - correctly accounting for the alliance rank multiplier (which the game's own POI display ignores).
// @version        1.0.0
// @license        GPL version 3 or any later version; http://www.gnu.org/copyleft/gpl.html
// @author         MikeyMike (rework of petui's "Real POI Bonus")
// @contributor    petui
// @contributor    AlkalyneD4 (POI factor fix)
// @contributor    NetquiK (https://github.com/netquik) (regex update)
// @match          https://*.alliances.commandandconquer.com/*/index.aspx*
// @downloadURL    https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/MM_Real_POI_Bonus.user.js
// @updateURL      https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/MM_Real_POI_Bonus.user.js
// ==/UserScript==

/*
 * MM - Real POI Bonus
 * -------------------
 * WHAT IT DOES
 *   Select a POI on the region map and this adds a "Real gain:" / "Real loss:" line to the POI's info
 *   bubble showing the ACTUAL change to your alliance's bonus if you captured (or gave up) that POI.
 *
 * WHY IT'S NEEDED
 *   POI bonuses are not simply additive: your alliance's total bonus for a POI type is a function of
 *   (rank, accumulated score, global factor). Capturing a POI adds score that can also change your RANK
 *   (overtaking / falling behind other alliances), which changes the multiplier - so the naive "this POI
 *   is worth +X" the game implies is wrong near rank boundaries. This computes the true delta: the fast
 *   path when rank can't change, and - when it can (overtaking the next alliance, falling behind the
 *   previous, or the current owner losing score) - by fetching the live alliance rankings (RankingGetData)
 *   and recomputing where your new score lands. Ranking data is cached 10 minutes.
 *
 * HOW IT'S BUILT (vs petui / AlkalyneD4 / NetquiK's "Real POI Bonus")
 *   The original rank-correction math is PRESERVED verbatim (it's the value and it's correct). The MM rework
 *   is housekeeping: [MM] gated logging, the one de-obfuscation hack (deriving getObject from setObject)
 *   routed through the shared MMCommon.deobf.ensureGetObject (with the original inline regex as a guarded
 *   fallback), the POI-bubble handler wrapped so a failure can't break the bubble, and MMCommon.lifecycle
 *   wired so toggling the script off in the CnC Pack menu hides the readout without a reload.
 *
 * UX: passive - it only augments the POI info bubble. No HUD button, no options panel (nothing to configure).
 *
 * DEPENDENCIES (pack rule: wrapper + Common Library only)
 *   MMCommon.makeLogger / .deobf / .net / .lifecycle (all optional - degrades gracefully if absent)
 *   ClientLib / qx / webfrontend / phe (game page context)
 *
 * Debug: window.REALPOIBONUS_DEBUG = true (or window.MM_DEBUG = true). Warnings/errors are always on.
 */
'use strict';

(function () {
	var main = function () {
		'use strict';

		var OPTIONS_ID = 10023; // MM - Real POI Bonus (CnC Pack registry id; kept from the original)

		// ---- logger ----------------------------------------------------------------
		var LOG = (window.MMCommon && window.MMCommon.makeLogger)
			? window.MMCommon.makeLogger("Real POI Bonus")
			: {
				log: function () {},
				warn: function () { try { console.warn.apply(console, ["[MM Real POI Bonus]"].concat([].slice.call(arguments))); } catch (e) {} },
				err: function () { try { console.error.apply(console, ["[MM Real POI Bonus]"].concat([].slice.call(arguments))); } catch (e) {} }
			};
		if (typeof window.REALPOIBONUS_DEBUG === "undefined") {
			try { window.REALPOIBONUS_DEBUG = (window.localStorage.getItem("REALPOIBONUS_DEBUG") === "1"); } catch (e) { window.REALPOIBONUS_DEBUG = false; }
		}
		var wlog = function () { if (!(window.REALPOIBONUS_DEBUG || window.MM_DEBUG)) return; LOG.log.apply(LOG, arguments); };
		var wwarn = function () { LOG.warn.apply(LOG, arguments); };
		var werr = function () { LOG.err.apply(LOG, arguments); };

		var MM = window.MMCommon || null;
		var scriptEnabled = true; // flipped by MMCommon.lifecycle; gates the POI-bubble readout

		function createRealPOIBonus() {
			wlog('engine class defined');

			qx.Class.define('RealPOIBonus', {
				type: 'singleton',
				extend: qx.core.Object,
				statics: {
					PoiTypeToPoiRankingTypeMap: {},
					PoiRankingTypeToSortColumnMap: {}
				},
				defer: function (statics) {
					statics.PoiTypeToPoiRankingTypeMap[ClientLib.Base.EPOIType.TiberiumBonus] = ClientLib.Data.Ranking.ERankingType.BonusTiberium;
					statics.PoiTypeToPoiRankingTypeMap[ClientLib.Base.EPOIType.CrystalBonus] = ClientLib.Data.Ranking.ERankingType.BonusCrystal;
					statics.PoiTypeToPoiRankingTypeMap[ClientLib.Base.EPOIType.PowerBonus] = ClientLib.Data.Ranking.ERankingType.BonusPower;
					statics.PoiTypeToPoiRankingTypeMap[ClientLib.Base.EPOIType.InfanteryBonus] = ClientLib.Data.Ranking.ERankingType.BonusInfantry;
					statics.PoiTypeToPoiRankingTypeMap[ClientLib.Base.EPOIType.VehicleBonus] = ClientLib.Data.Ranking.ERankingType.BonusVehicles;
					statics.PoiTypeToPoiRankingTypeMap[ClientLib.Base.EPOIType.AirBonus] = ClientLib.Data.Ranking.ERankingType.BonusAircraft;
					statics.PoiTypeToPoiRankingTypeMap[ClientLib.Base.EPOIType.DefenseBonus] = ClientLib.Data.Ranking.ERankingType.BonusDefense;

					statics.PoiRankingTypeToSortColumnMap[ClientLib.Data.Ranking.ERankingType.BonusTiberium] = ClientLib.Data.Ranking.ESortColumn.TiberiumScore;
					statics.PoiRankingTypeToSortColumnMap[ClientLib.Data.Ranking.ERankingType.BonusCrystal] = ClientLib.Data.Ranking.ESortColumn.CrystalScore;
					statics.PoiRankingTypeToSortColumnMap[ClientLib.Data.Ranking.ERankingType.BonusPower] = ClientLib.Data.Ranking.ESortColumn.PowerScore;
					statics.PoiRankingTypeToSortColumnMap[ClientLib.Data.Ranking.ERankingType.BonusInfantry] = ClientLib.Data.Ranking.ESortColumn.InfantryScore;
					statics.PoiRankingTypeToSortColumnMap[ClientLib.Data.Ranking.ERankingType.BonusVehicles] = ClientLib.Data.Ranking.ESortColumn.VehicleScore;
					statics.PoiRankingTypeToSortColumnMap[ClientLib.Data.Ranking.ERankingType.BonusAircraft] = ClientLib.Data.Ranking.ESortColumn.AircraftScore;
					statics.PoiRankingTypeToSortColumnMap[ClientLib.Data.Ranking.ERankingType.BonusDefense] = ClientLib.Data.Ranking.ESortColumn.DefenseScore;
				},
				members: {
					rankingBonusDataCache: {},
					container: null,
					titleLabel: null,
					amountLabel: null,
					ownedPoiCount: 0,

					initialize: function () {
						this.initializeHacks();

						this.container = new qx.ui.container.Composite(new qx.ui.layout.HBox(4)).set({
							textColor: 'text-region-tooltip',
							marginRight: 10
						});
						this.container.add(this.titleLabel = new qx.ui.basic.Label());
						this.container.add(this.amountLabel = new qx.ui.basic.Label());

						var poiStatusInfo = webfrontend.gui.region.RegionPointOfInterestStatusInfo.getInstance();
						poiStatusInfo.getChildren()[0].addAt(this.container, 4);
						poiStatusInfo.addListener('appear', this.onStatusInfoAppear, this);

						// Alliance change -> invalidate the rank cache. Route through the Common Library's
						// net helper (phe.cnc.Util / gui.Util fallback); fall back to phe directly if absent.
						var attach = (MM && MM.net && MM.net.attach)
							? function (o, en, et, ctx, cb) { return MM.net.attach(o, en, et, ctx, cb); }
							: function (o, en, et, ctx, cb) { return phe.cnc.Util.attachNetEvent(o, en, et, ctx, cb); };
						attach(ClientLib.Data.MainData.GetInstance().get_Alliance(), 'Change', ClientLib.Data.AllianceChange, this, this.onAllianceChange);
						this.onAllianceChange();
					},

					initializeHacks: function () {
						try {
							var proto = webfrontend.gui.region.RegionPointOfInterestStatusInfo.prototype;
							if (typeof proto.getObject === 'function') return;
							// Prefer the shared Common Library helper (derives getObject from setObject).
							if (MM && MM.deobf && MM.deobf.ensureGetObject && MM.deobf.ensureGetObject(proto)) return;
							// Fallback: the original inline NOEVIL regex (NetquiK's).
							var m = proto.setObject.toString().match(/^function\s?\(([A-Za-z]+)\)\{this\.([A-Za-z_]+)=\1;/);
							if (!m) { wwarn('could not locate RegionPointOfInterestStatusInfo.getObject member (game may have updated); real gain/loss disabled'); return; }
							var objectMemberName = m[2];
							/**
							 * @returns {ClientLib.Vis.Region.RegionPointOfInterest}
							 */
							proto.getObject = function () {
								return this[objectMemberName];
							};
						} catch (e) { werr('initializeHacks:', e); }
					},

					onAllianceChange: function () {
						var alliance = ClientLib.Data.MainData.GetInstance().get_Alliance();
						var poiCount = alliance.get_Exists() ? alliance.get_OwnedPOIs().length : 0;

						if (poiCount !== this.ownedPoiCount) {
							this.ownedPoiCount = poiCount;
							this.rankingBonusDataCache = {};
						}
					},

					/**
					 * @param {qx.event.type.Event} event
					 */
					onStatusInfoAppear: function (event) {
						try {
						if (!scriptEnabled) { this.container.setVisibility('excluded'); return; }
						var visObject = event.getTarget().getObject();
						var allianceId = ClientLib.Data.MainData.GetInstance().get_Alliance().get_Id();

						if (allianceId > 0 && visObject.get_Type() !== ClientLib.Data.WorldSector.WorldObjectPointOfInterest.EPOIType.TunnelExit) {
							var selectedPoiScore = ClientLib.Base.PointOfInterestTypes.GetScoreByLevel(visObject.get_Level());
							var poiType = ClientLib.Base.PointOfInterestTypes.GetPOITypeFromWorldPOIType(visObject.get_Type());
							var poiRankScore = ClientLib.Data.MainData.GetInstance().get_Alliance().get_POIRankScore()[poiType - ClientLib.Base.EPOIType.RankedTypeBegin];
							var allianceRank = poiRankScore.r;
							var allianceScore = poiRankScore.s;
							var nextAllianceScore = poiRankScore.ns;
							var previousAllianceScore = poiRankScore.ps;
							var bonusMultiplier = ClientLib.Data.MainData.GetInstance().get_Server().get_POIGlobalBonusFactor();
							var currentTotalBonus = ClientLib.Base.PointOfInterestTypes.GetTotalBonusByType(poiType, allianceRank, allianceScore, bonusMultiplier);

							var gainOrLoss = null;

							if (visObject.get_OwnerAllianceId() === allianceId) {
								this.titleLabel.setValue('Real loss:');

								if (previousAllianceScore <= 0) {
									// No rank multiplier; no loss by rank
									gainOrLoss = currentTotalBonus - ClientLib.Base.PointOfInterestTypes.GetTotalBonusByType(poiType, allianceRank, allianceScore - selectedPoiScore, bonusMultiplier);
								} else if (allianceScore - selectedPoiScore < previousAllianceScore) {
									// Falling behind previous alliance; need to use rankings
								} else {
									// No loss by rank; if we end up with same score as previous alliance, our rank stays the same and they get same rank
									gainOrLoss = currentTotalBonus - ClientLib.Base.PointOfInterestTypes.GetTotalBonusByType(poiType, allianceRank, allianceScore - selectedPoiScore, bonusMultiplier);
								}
							} else {
								this.titleLabel.setValue('Real gain:');

								if (!allianceScore) {
									// Zero bonus; need to use rankings
								} else if (nextAllianceScore <= 0 || allianceRank <= 1) {
									// Already rank 1; no gain by rank
									gainOrLoss = ClientLib.Base.PointOfInterestTypes.GetTotalBonusByType(poiType, allianceRank, allianceScore + selectedPoiScore, bonusMultiplier) - currentTotalBonus;
								} else if (visObject.get_OwnerAllianceId() !== webfrontend.gui.widgets.AllianceLabel.ESpecialNoAllianceName) {
									// Current owner of POI will lose score while we gain; need to use rankings
								} else if (allianceScore + selectedPoiScore > nextAllianceScore) {
									// Overtaking next alliance; need to use rankings
								} else if (allianceScore + selectedPoiScore < nextAllianceScore) {
									// No gain by rank
									gainOrLoss = ClientLib.Base.PointOfInterestTypes.GetTotalBonusByType(poiType, allianceRank, allianceScore + selectedPoiScore, bonusMultiplier) - currentTotalBonus;
								} else {
									// Same score as next alliance; same rank and same bonus as them
									gainOrLoss = ClientLib.Base.PointOfInterestTypes.GetTotalBonusByType(poiType, allianceRank - 1, allianceScore + selectedPoiScore, bonusMultiplier) - currentTotalBonus;
								}
							}

							if (gainOrLoss === null) {
								this.amountLabel.setValue('Loading...');
								this.fetchAndCalculateBonusWithRankingData(poiType, allianceRank, allianceScore, selectedPoiScore, allianceId, visObject.get_OwnerAllianceId());
							} else {
								this.amountLabel.setValue(this.formatGainOrLoss(gainOrLoss, poiType));
							}

							this.container.setVisibility('visible');
						} else {
							this.container.setVisibility('excluded');
						}
						} catch (e) { werr('onStatusInfoAppear:', e); }
					},

					/**
					 * @param {ClientLib.Base.EPOIType} poiType
					 * @param {Number} currentRank
					 * @param {Number} currentScore
					 * @param {Number} poiScore
					 * @param {Number} allianceId
					 * @param {Number} poiOwnerId
					 */
					fetchAndCalculateBonusWithRankingData: function (poiType, currentRank, currentScore, poiScore, allianceId, poiOwnerId) {
						var context = {
							poiType: poiType,
							currentRank: currentRank,
							currentScore: currentScore,
							poiScore: poiScore,
							allianceId: allianceId,
							poiOwnerId: poiOwnerId
						};

						if (poiType in this.rankingBonusDataCache && this.rankingBonusDataCache[poiType].expire >= Date.now()) {
							this.calculateBonus(context, this.rankingBonusDataCache[poiType].results);
						} else {
							var lastMultiplierRank = Object.keys(ClientLib.Res.ResMain.GetInstance().GetGamedata().poibmbr).length;
							var rankingPoiType = RealPOIBonus.PoiTypeToPoiRankingTypeMap[poiType];
							var sortColumn = RealPOIBonus.PoiRankingTypeToSortColumnMap[rankingPoiType];

							ClientLib.Net.CommunicationManager.GetInstance().SendSimpleCommand('RankingGetData', {
								firstIndex: 0,
								lastIndex: lastMultiplierRank,
								view: ClientLib.Data.Ranking.EViewType.Alliance,
								rankingType: rankingPoiType,
								sortColumn: sortColumn,
								ascending: true
							}, phe.cnc.Util.createEventDelegate(ClientLib.Net.CommandResult, this, this.onRankingGetData), context);
						}
					},

					/**
					 * @param {Object} context
					 * @param {Object} results
					 */
					onRankingGetData: function (context, results) {
						if (results === null) {
							return;
						}

						var allianceBonuses = results.a;

						// Remove own alliance from list and add missing scores
						for (var i = 0; i < allianceBonuses.length; i++) {
							if (allianceBonuses[i].a === context.allianceId) {
								allianceBonuses.splice(i--, 1);
							} else if (allianceBonuses[i].pois === undefined) {
								allianceBonuses[i].pois = 0;
							}
						}

						this.rankingBonusDataCache[context.poiType] = {
							expire: Date.now() + 600000,
							results: allianceBonuses
						};

						this.calculateBonus(context, allianceBonuses);
					},

					/**
					 * @param {Object} context
					 * @param {Array} allianceBonuses
					 */
					calculateBonus: function (context, allianceBonuses) {
						var isGain = context.poiOwnerId !== context.allianceId;
						var i;

						if (isGain && context.poiOwnerId !== webfrontend.gui.widgets.AllianceLabel.ESpecialNoAllianceName) {
							// Subtract POI score from current owner
							for (i = 0; i < allianceBonuses.length; i++) {
								if (allianceBonuses[i].a === context.poiOwnerId) {
									// Array can be safely modified after cloning
									allianceBonuses = allianceBonuses.map(this.shallowClone);
									allianceBonuses[i].pois -= context.poiScore;

									allianceBonuses.sort(function (a, b) {
										return b.pois - a.pois;
									});
									break;
								}
							}
						}

						var newAllianceScore = context.currentScore + (isGain ? context.poiScore : -context.poiScore);

						for (i = 0; i < allianceBonuses.length; i++) {
							if (allianceBonuses[i].pois <= newAllianceScore) {
								break;
							}
						}
						var bonusMultiplier = ClientLib.Data.MainData.GetInstance().get_Server().get_POIGlobalBonusFactor();
						var currentTotalBonus = ClientLib.Base.PointOfInterestTypes.GetTotalBonusByType(context.poiType, context.currentRank, context.currentScore, bonusMultiplier);
						var newTotalBonus = ClientLib.Base.PointOfInterestTypes.GetTotalBonusByType(context.poiType, i + 1, newAllianceScore, bonusMultiplier);
						var gainOrLoss = isGain ?
							newTotalBonus - currentTotalBonus :
							currentTotalBonus - newTotalBonus;

						this.amountLabel.setValue(this.formatGainOrLoss(gainOrLoss, context.poiType));
					},

					/**
					 * @param {Number} gainOrLoss
					 * @param {ClientLib.Base.EPOIType} poiType
					 * @returns {String}
					 */
					formatGainOrLoss: function (gainOrLoss, poiType) {
						switch (poiType) {
							case ClientLib.Base.EPOIType.TiberiumBonus:
							case ClientLib.Base.EPOIType.CrystalBonus:
							case ClientLib.Base.EPOIType.PowerBonus:
								return phe.cnc.gui.util.Numbers.formatNumbers(gainOrLoss) + '/h';
							case ClientLib.Base.EPOIType.InfanteryBonus:
							case ClientLib.Base.EPOIType.VehicleBonus:
							case ClientLib.Base.EPOIType.AirBonus:
							case ClientLib.Base.EPOIType.DefenseBonus:
								return phe.cnc.gui.util.Numbers.formatNumbers(gainOrLoss) + '%';
						};
					},

					/**
					 * @param {Object} object
					 * @returns {Object}
					 */
					shallowClone: function (object) {
						var clone = new object.constructor;

						for (var key in object) {
							if (object.hasOwnProperty(key)) {
								clone[key] = object[key];
							}
						}

						return clone;
					}
				}
			});
		}

		function waitForGame() {
			try {
				if (typeof qx !== 'undefined' && qx.core.Init.getApplication() && qx.core.Init.getApplication().initDone) {
					createRealPOIBonus();
					var inst = RealPOIBonus.getInstance();
					inst.initialize();

					// Live enable/disable from the CnC Pack menu (no reload). On disable we just hide the
					// readout; the listeners stay attached and the scriptEnabled gate suppresses output.
					try {
						if (MM && MM.lifecycle && typeof MM.lifecycle.watch === 'function') {
							MM.lifecycle.watch(OPTIONS_ID, {
								onEnable: function () { scriptEnabled = true; },
								onDisable: function () {
									scriptEnabled = false;
									try { if (inst.container) inst.container.setVisibility('excluded'); } catch (e) {}
								}
							});
							if (typeof MM.lifecycle.isEnabled === 'function') {
								scriptEnabled = (MM.lifecycle.isEnabled(OPTIONS_ID) !== false);
							}
						}
					} catch (e) { werr('lifecycle.watch failed:', e); }
					wlog('ready (options id ' + OPTIONS_ID + ')');
				} else {
					setTimeout(waitForGame, 1000);
				}
			} catch (e) {
				werr('init failed:', (e && e.toString) ? e.toString() : e);
			}
		}

		setTimeout(waitForGame, 1000);
	};

	var script = document.createElement('script');
	script.textContent = '(' + main.toString() + ')();';
	script.type = 'text/javascript';
	document.getElementsByTagName('head')[0].appendChild(script);
})();