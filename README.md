# CnCTA-MikeyMike-SCRIPT-PACK

A personal fork of [netquik/CnCTA-SoO-SCRIPT-PACK](https://github.com/netquik/CnCTA-SoO-SCRIPT-PACK)
(userscripts for *Command & Conquer: Tiberium Alliances*).

All scripts are copied verbatim from the upstream repository. One script has been
extended — see below.

## License / credits

Upstream is licensed under **GPL-3.0** (see [LICENSE](LICENSE)), so this fork is
also GPL-3.0. All original authors and contributors are kept in each script's
header. Please keep them there if you redistribute.

## Modified script

### `TA_Tiberium_Alliances_Battle_Simulator_V2.user.js`

Adds an **automatic battle-layout optimizer** that tries several formations built
from your current army and applies the best one. There are **two modes**, each
with its own **✨ wand button** and console command:

| Mode | Column | Goal | Console |
|------|--------|------|---------|
| **Lowest Repair (must win)** | `LowRep` (#6) | Requires a full kill (enemy health 0), then picks the layout with the **lowest repair time**. | `MikeyMike_OptimizeRepair()` |
| **Best Value (balanced)** | `Best` (#7) | Picks the best **damage-for-repair** layout — minimizes remaining enemy health **and** repair together. Can prefer a cheap near-kill. | `MikeyMike_OptimizeBest()` |

**Scoring details:**

- **Lowest Repair** ranks by: *victory → lowest `max(infantry, vehicle, aircraft)`
  repair charge → most surviving offense → shortest battle*. The three repair
  pools recharge in parallel, so the largest pool drives wall-clock repair time;
  minimising that maximum minimises time.
- **Best Value** ranks by a single composite score (lower = better):
  `wEnemy × (remaining enemy health %) + wRepair × (own army losses %)`.
  Both terms are 0–100% fractions, so they are directly comparable. Army-losses %
  is used as the repair-time proxy here because it is normalisable per-simulation.
  Weights default to `1`/`1` and are adjustable via the settings
  `Optimizer.BestBalance.wEnemy` and `Optimizer.BestBalance.wRepair` (raise
  `wRepair` to favour cheaper layouts, raise `wEnemy` to favour more damage).

**`TABS.OPTIMIZER` engine** — generates candidate layouts from the current army
using the script's existing transform helpers (horizontal/vertical mirrors and row
swaps), simulates each one against the server (throttled, capped at 24 simulations
per run), then applies that mode's best layout. Both columns update from the same
cache, so after one run you can compare both recommendations side by side.

**How to use:**

1. Open an attack on a target (combat-setup view) with your army placed.
2. Widen the Stats window until the **LowRep** (#6) and **Best** (#7) columns appear.
3. Click the **✨** button in whichever column you want. Status updates show
   progress (`Tested N/M layouts...`). When finished it applies that mode's layout.

**Notes & limits:**

- Each candidate is a real server simulation gated by a ~3s lock, so a run takes
  roughly `candidates × 3s`. The candidate set is intentionally small/heuristic
  (mirrors + row swaps) — it does **not** brute-force every permutation, which
  would be astronomically large and would hammer the game server.
- "Repair time" here is approximated by repair *charge* (the max parallel pool).
  This is an excellent proxy for time at a fixed base; it does not divide by your
  base's specific repair-facility rates.
- The optimizer moves your real units while testing and restores/applies a layout
  at the end. If no winning layout is found, it restores your original formation.

## Install

Install with Tampermonkey/Violentmonkey by opening the raw file:

```
https://raw.githubusercontent.com/mikegorgolinski26/CnCTA-MikeyMike-SCRIPT-PACK-UPDATE/main/TA_Tiberium_Alliances_Battle_Simulator_V2.user.js
```

The script's `@updateURL` / `@downloadURL` point at this repo's `main` branch, so
your userscript manager will pick up future updates automatically.
