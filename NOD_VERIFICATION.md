# MM Base Tools — NOD-faction verification

The Layout Optimizer + Phase B auto-apply were built and validated on a **GDI** base
(MikeyMike68 / "Destroyer 1.2" / cncapp09 world 473). Before publishing we want to confirm
the model holds on a **NOD** base. Most of the tool is faction-proof by design; this doc
captures the GDI baseline + a one-paste snippet so the NOD check is a quick diff.

## What is already faction-proof (no NOD base needed)
- **Building icons** — harvested live from each building's `IconPath`, which embeds
  `Player.get_FactionFolder()` (→ `"nod"` on a NOD base). Auto-adapts.
- **Phase B primitives** — `IXYXAF(x,y)` (move) and `BFHPNB()` (demolish) are obfuscated
  methods on the **shared** `ClientLib.Data.CityBuilding.prototype`. The client JS is
  identical for both factions (faction only swaps art/data), so they resolve the same on NOD.
  Still: the snippet re-checks they exist, in case a client update renamed them.
- **Building names** — via faction-neutral `ClientLib.Data.ETechName`.

## What genuinely needs a NOD base to confirm
1. The economy tech-IDs map to the same NOD buildings (Harvester=11, Silo=15, Refinery=1,
   PowerPlant=2, Accumulator=16).
2. The adjacency/bonus **link graph** (which modifier on which building receives which
   link-type from which neighbour, and the max-connection caps) is identical to GDI.

## GDI baseline (captured 2026-06-20) — NOD must match this
- `faction` = 1, `factionFolder` = `"gdi"`; grid 9×8; terrain enum
  {NONE:0, CRYSTAL:1, TIBERIUM:2, BLOCKED:3, FOREST:4, BRIAR:5, SWAMP:6, WATER:7}.
- Primitives: `IXYXAF` ✓, `BFHPNB` ✓, `IsBuildingFreeToBePlaced` ✓.
- Per-tech model — `mod` = production modifier id (1=tib, 4=cry, 6=pow, 30=credits);
  each entry is `{link: linkTypeId, max: maxConnections}`:

| Tech (id) | mod | links (link×max) |
|---|---|---|
| Harvester (11) | 4 (cry) | 35×1 &nbsp;(tib harvester instead shows mod 1 → link 34×1) |
| Silo (15) | 1 (tib) / 4 (cry) | 39×8 / 40×8 |
| Refinery (1) | 30 (credits) | 36×1, 37×8 |
| PowerPlant (2) | 6 (pow) / 30 (credits) | 29×1, 38×8 / 42×8 |
| Accumulator (16) | 6 (pow) | 41×8 |
| Construction_Yard (0), Defense_HQ (4-tech), Defense_Facility (8), Support_Art (14) | — | no production modifiers (fixed obstacles) |

Bonus-graph reading (same as the `base-layout-bonus-model` memory): Harvester←Silo (34/35,×1);
Silo←Harvesters (39/40,×8); PowerPlant←Accumulator (29,×1)+CrystalField (38,×8);
Accumulator←PowerPlants (41,×8); Refinery←PowerPlant (36,×1)+TiberiumField (37,×8);
PowerPlant credits←Refineries (42,×8).

## PASS criteria for NOD
- `factionFolder` = `"nod"`; icon URLs contain `/nod/`.
- Same five economy tech-IDs present (11/15/1/2/16) as movable producers.
- The per-tech `mods`→`links` map (the table above) is **identical** (same modifier ids,
  same link-type ids, same max caps). Harvester may surface mod 1 (tib) or mod 4 (cry)
  depending on which representative is sampled — both are fine.
- `IXYXAF` / `BFHPNB` still `typeof === "function"`.
If all match → the optimizer + auto-apply are faction-complete and we can publish.
Any mismatch → note the differing tech-id/link and adjust `OPT` (LINK table / movable sets).

## One-paste NOD verification snippet
Run on a loaded NOD base (paste into the console, or have Claude run it via Claude-in-Chrome),
then diff its output against the GDI baseline above:

```js
JSON.stringify((function(){
  function N(v){ try{ return (v&&v.valueOf)?Number(v):v; }catch(e){ return v; } }
  var md=ClientLib.Data.MainData.GetInstance();
  var p=md.get_Player(), city=md.get_Cities().get_CurrentOwnCity();
  var out={ faction:N(p.get_Faction()), factionFolder:p.get_FactionFolder(), city:city.get_Name() };
  var proto=ClientLib.Data.CityBuilding.prototype;
  out.primitives={ move_IXYXAF: typeof proto.IXYXAF, demolish_BFHPNB: typeof proto.BFHPNB, IsBuildingFreeToBePlaced: typeof city.IsBuildingFreeToBePlaced };
  var bd=city.get_Buildings().d, model={}, counts={}, icons={};
  for(var key in bd){ var b=bd[key]; if(!b||!b.get_Id) continue;
    var t=N(b.get_TechName()), tn='#'+t; counts[tn]=(counts[tn]||0)+1;
    var dv; try{ dv=city.GetBuildingDetailViewInfo(b); }catch(e){ dv=null; }
    if(!model[tn]){ var entry={ techId:t, mods:{} };
      if(dv && dv.OwnProdModifiers && dv.OwnProdModifiers.d){ var mods=dv.OwnProdModifiers.d;
        for(var mt in mods){ var m=mods[mt]; if(typeof m!=='object')continue; var mid=N(m.ModifierTypeId);
          if([1,4,6,30].indexOf(mid)<0)continue; var links=[];
          if(m.ConnectedLinkTypes && m.ConnectedLinkTypes.d){ var C=m.ConnectedLinkTypes.d;
            for(var lt in C){ var l=C[lt]; if(typeof l!=='object')continue; links.push({link:N(l.LQJDCI),max:N(l.MaxConnections)});
              if(l.IconPath && icons[N(l.LQJDCI)]==null) icons[N(l.LQJDCI)]=l.IconPath; } }
          links.sort(function(a,b){return a.link-b.link;}); entry.mods[mid]=links; } }
      model[tn]=entry; }
  }
  out.counts=counts; out.model=model; out.sampleIconUrls=icons;
  return out;
})())
```

## How to reconnect for the NOD run (Claude-in-Chrome)
Mike is reusing the same Chrome window, navigating it to a different server for the NOD
account. When the NOD base is loaded: re-select the browser, `tabs_context_mcp`, then poll
`ClientLib.Data.MainData.GetInstance().get_Cities().get_CurrentOwnCity()` until buildings load
(same as the GDI reconnect recipe in the `session-handoff` memory), then run the snippet above.
