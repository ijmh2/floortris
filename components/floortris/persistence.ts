import { validate } from './engine.ts';
import type { AppState } from './model.ts';

/** Accept both document versions; createStore performs the non-destructive migration. */
export function readSavedRoom(raw: string): AppState | null {
  try {
    const state = JSON.parse(raw) as AppState;
    if (![1, 2].includes(state.version) || !Array.isArray(state.current?.furniture) || !Array.isArray(state.inventory)
      || !(state.room?.widthCm >= 240 && state.room.widthCm <= 1000 && state.room.depthCm >= 240 && state.room.depthCm <= 1000)
      || state.rules?.cellCm !== 20) return null;
    validate(state.current, state.room, state.rules, state.inventory);
    return state;
  } catch { return null; }
}
