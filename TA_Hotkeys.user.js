// ==UserScript==
// @name            C&C: TA Hotkeys
// @namespace       https://greasyfork.org/users/12491
// @icon            https://cncapp05.alliances.commandandconquer.com/339/favicon.ico
// @description     Hotkey script for inserting your player data into messages/chat/forum. (MikeyMike: the multi-account login/logout feature and its plaintext password table were removed for security.)
// @version         2.2.5
// @author          Gryphon - Based on MrHIDEn's code. Modified.
// @license         MIT License
// @grant           none
// @include         *tiberiumalliances.com*
// @include     	https://cncapp*.alliances.commandandconquer.com/*/index.aspx*
// @grant           none
// ==/UserScript==

/*
                    Based on MrHIDEn's CnC: Tiberium Alliances Shortcuts. Original at http://userscripts.org/scripts/show/135806
				    MikeyMike: the Login/Logout (multi-account) feature was removed for security - see note below.

				    Alt+Y - Message/Forum Signature
				    Alt+I - Insert to message/chat/post all your bases/cities info
*/

// MikeyMike (2026-06-21): REMOVED the plaintext multi-account email/password table and the
// auto-login feature (Alt+1-9 to fill+submit the login form, Alt+0 to log out). Storing account
// credentials in a userscript is a security risk and has no place in the published pack. The safe
// hotkeys remain: Alt+Y (forum/message signature) and Alt+I (insert all your bases' info). Those
// are slated to move into MM - Base Info (via MMCommon.base / MMCommon.coords).

function Ini() {
	console.log("CnC: TA Shortcuts has been loaded.");
};


function Key(e) {
	var s = String.fromCharCode(e.keyCode);
	// ALT+
	if (e.altKey && !e.altGraphKey && !e.ctrlKey && !e.shiftKey) {
		//console.log("Alt+"+s);	
		switch (s) {
			case "Y":
				// Signature Line
				var inputField = document.querySelector('input:focus, textarea:focus');
				if (inputField != null) {
					var apc = ClientLib.Data.MainData.GetInstance().get_Cities();
					var Alliance = apc.get_CurrentOwnCity().get_AllianceName();
					var PlayerName = apc.get_CurrentOwnCity().get_PlayerName();
					var getRole = ClientLib.Data.MainData.GetInstance().get_Alliance().get_CurrentMemberRoleInfo().Name;
					if (getRole == "Leader") {
						var Role = "CiC";
					} else if (getRole == "Second Commander") {
						var Role = "SiC";
					} else {
						var Role = getRole;
					}
					var txt = "[player]" + PlayerName + "[/player]" + "\r\n" + Role + "\r\n" + "[alliance]" + Alliance + "[/alliance]";
					inputField.value += txt;
				}
				break;
			case "I":
				// player bases info to share with others
				var serverName = ClientLib.Data.MainData.GetInstance().get_Server().get_Name();
				var inputField = document.querySelector('input:focus, textarea:focus');
				if (inputField != null) {
					var apc = ClientLib.Data.MainData.GetInstance().get_Cities(); //all player cities
					var PlayerName = apc.get_CurrentOwnCity().get_PlayerName();
					var Alliance = apc.get_CurrentOwnCity().get_AllianceName();
					var txt = '[b]Player: ' + PlayerName + "[/b]" + "\r\n----------------------------------\r\n";
					var apcl = apc.get_AllCities().d; //all player cities list
					for (var key in apcl) {
						var c = apcl[key];
						try {
							var sd = c.get_SupportData();
							var sn = '--';
							var sl = '--';
							if (sd !== null) {
								sl = sd.get_Level().toString();
								sn = c.get_SupportWeapon().dn;
							}
							txt += "Base \'" + c.get_Name() + "\' info:\r\n"; //m_Level
							txt += "Base       lvl: " + c.get_LvlBase().toFixed(2).toString() + "\r\n";
							txt += "Defense lvl: " + c.get_LvlDefense().toFixed(2).toString() + "\r\n";
							txt += "Offense  lvl: " + c.get_LvlOffense().toFixed(2).toString() + "\r\n";
							txt += "Support  lvl: " + sl + " - " + sn + "\r\n";
							txt += "Distance to center: " + Math.round(ClientLib.Base.Util.CalculateDistance(ClientLib.Data.MainData.GetInstance().get_Server().get_ContinentWidth() / 2, ClientLib.Data.MainData.GetInstance().get_Server().get_ContinentHeight() / 2, c.get_PosX(), c.get_PosY())) + "\r\n";
							txt += "[coords]" + c.get_PosX() + ":" + c.get_PosY() + "[/coords]\r\n";
						} catch (e) {
							console.warn("MHTools.Shortcuts.INFO exception: ", e);
						}
						txt += "----------------------------------\r\n";
					}
					inputField.value += txt;
				}
				break;
			default:
				// other letters
		}
	}
};

// Events
document.addEventListener("keyup", Key, false);
Ini();