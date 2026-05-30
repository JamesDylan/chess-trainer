// Pure translation of Stage 0's `EngineOptions` into the exact UCI `setoption`
// lines to send before searching. Kept pure (no engine, no I/O) so it is fully
// unit-testable — see REFERENCE.md §3 "Strength limiting".
//
// Rules (REFERENCE §3):
//   - ALWAYS `setoption name Threads value 1` for the bot.
//   - If limitStrength: UCI_LimitStrength=true + UCI_Elo=<clamped elo>.
//   - Else (below the 1320 Elo floor): UCI_LimitStrength=false + Skill Level=<n>.
//   - MultiPV is set explicitly (1 for play; raised only for analysis later).
// `movetimeMs` is applied at `go` time, not here.

import type { EngineOptions } from '../core/types';

export function buildStrengthCommands(opts: EngineOptions): string[] {
  const cmds: string[] = ['setoption name Threads value 1'];

  if (opts.limitStrength) {
    cmds.push('setoption name UCI_LimitStrength value true');
    if (opts.uciElo !== undefined) {
      cmds.push(`setoption name UCI_Elo value ${opts.uciElo}`);
    }
  } else {
    // Make the "off" state explicit so a previous Elo limit can't linger.
    cmds.push('setoption name UCI_LimitStrength value false');
    if (opts.skillLevel !== undefined) {
      cmds.push(`setoption name Skill Level value ${opts.skillLevel}`);
    }
  }

  cmds.push(`setoption name MultiPV value ${opts.multipv}`);
  return cmds;
}
