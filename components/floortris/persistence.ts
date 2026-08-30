import { validate } from './engine.ts';
import type { AppState } from './model.ts';
import { validateRoomInputs } from './room-inputs.ts';
import { invalidCustomFurnitureRecord } from './custom-furniture.ts';

/** Accept both document versions; createStore performs the non-destructive migration. */
export function readSavedRoom(raw: string): AppState | null {
  try {
    const state = JSON.parse(raw) as AppState;
    if (![1, 2].includes(state.version) || !Array.isArray(state.current?.furniture) || !Array.isArray(state.inventory)
      || !(state.room?.widthCm >= 240 && state.room.widthCm <= 1000 && state.room.depthCm >= 240 && state.room.depthCm <= 1000)
      || state.rules?.cellCm !== 20) return null;
    const records = [...state.current.furniture, ...state.inventory, ...(state.proposal?.layout.furniture || [])];
    if (records.some(item => invalidCustomFurnitureRecord(item))) return null;
    if (validateRoomInputs(state.room, state.rules)) return null;
    validate(state.current, state.room, state.rules, state.inventory);
    return state;
  } catch { return null; }
}

/** Validate a user-selected export before it can enter the local room library. */
export function readImportedRoom(raw: string): AppState | null {
  // A room export is tiny; refuse accidental binary/huge uploads before JSON.parse.
  if (raw.length > 1_000_000) return null;
  const state = readSavedRoom(raw);
  if (!state) return null;
  // Never let an imported file overwrite a room that is already open or saved.
  // Imported authority is refreshed again by humanOpenRoom.
  return { ...state, documentId: `import-${crypto.randomUUID()}` };
}

type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;
export type RoomWorkspace = { version: 1; activeId: string; documents: { id: string; state: AppState }[] };
export const documentId = (state: AppState) => state.documentId || 'original';
const workspaceKey = (key: string) => `${key}.workspace`;

/** One atomic storage write retains both the previous draft and the new room. */
export function readWorkspace(storage: StoragePort, key: string): RoomWorkspace | null {
  const raw = storage.getItem(workspaceKey(key));
  if (!raw) return null;
  const workspace = JSON.parse(raw) as RoomWorkspace;
  if (workspace.version !== 1 || !Array.isArray(workspace.documents) || !workspace.documents.length
    || new Set(workspace.documents.map(d => d.id)).size !== workspace.documents.length
    || !workspace.documents.every(d => d.id === documentId(d.state) && readSavedRoom(JSON.stringify(d.state)))
    || !workspace.documents.some(d => d.id === workspace.activeId)) throw new Error('Saved room library could not be read. Export your room before continuing.');
  return workspace;
}

export function saveWorkspaceRoom(storage: StoragePort, key: string, next: AppState, previous?: AppState): RoomWorkspace {
  const workspace = readWorkspace(storage, key) || { version: 1 as const, activeId: documentId(next), documents: [] };
  for (const state of [...(previous ? [previous] : []), next]) {
    const id = documentId(state), index = workspace.documents.findIndex(d => d.id === id);
    const entry = { id, state };
    if (index < 0) workspace.documents.push(entry); else workspace.documents[index] = entry;
  }
  workspace.activeId = documentId(next);
  storage.setItem(workspaceKey(key), JSON.stringify(workspace));
  return workspace;
}

export function loadWorkspaceRoom(storage: StoragePort, key: string, requestedId?: string | null): AppState | null {
  const workspace = readWorkspace(storage, key);
  if (workspace) return (workspace.documents.find(d => d.id === (requestedId || workspace.activeId)) || workspace.documents.find(d => d.id === workspace.activeId))!.state;
  const raw = storage.getItem(key);
  return raw ? readSavedRoom(raw) : null;
}
