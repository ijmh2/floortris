import type { AppState } from './model.ts';
import { validatePersistedDocument } from './document-schema.ts';

/** Accept both document versions; createStore performs the non-destructive migration. */
export function readSavedRoom(raw: string): AppState | null {
  try {
    const state: unknown = JSON.parse(raw);
    return validatePersistedDocument(state) ? null : state as AppState;
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
export type StoredRoomRecovery = { storageKey: string; damagedKeys: string[]; untouched: { key: string; raw: string }[]; validDocuments: { id: string; state: AppState }[]; message: string };
export type StoredRoomLoad = { state: AppState | null; recovery: StoredRoomRecovery | null };
export const documentId = (state: AppState) => state.documentId || 'original';
const workspaceKey = (key: string) => `${key}.workspace`;

/** One atomic storage write retains both the previous draft and the new room. */
export function readWorkspace(storage: Pick<Storage, 'getItem'>, key: string): RoomWorkspace | null {
  const raw = storage.getItem(workspaceKey(key));
  if (!raw) return null;
  const workspace = JSON.parse(raw) as RoomWorkspace;
  if (!workspace || typeof workspace !== 'object' || Object.keys(workspace).some(field => !['version','activeId','documents'].includes(field))
    || workspace.version !== 1 || typeof workspace.activeId !== 'string' || !workspace.activeId || !Array.isArray(workspace.documents) || !workspace.documents.length
    || workspace.documents.some(document => !document || typeof document !== 'object' || Object.keys(document).some(field => !['id','state'].includes(field)))
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

/** Read persistence without ever replacing damaged bytes. A partially readable
 * workspace is only offered for explicit human recovery. */
export function inspectStoredRoom(storage: Pick<Storage, 'getItem'>, key: string, requestedId?: string | null): StoredRoomLoad {
  const workspaceStorageKey = workspaceKey(key), workspaceRaw = storage.getItem(workspaceStorageKey), legacyRaw = storage.getItem(key);
  if (workspaceRaw) {
    try {
      const workspace = readWorkspace(storage, key)!;
      return { state: (workspace.documents.find(d => d.id === (requestedId || workspace.activeId)) || workspace.documents.find(d => d.id === workspace.activeId))!.state, recovery: null };
    } catch {
      const validDocuments: { id: string; state: AppState }[] = [];
      try {
        const candidate = JSON.parse(workspaceRaw) as { documents?: unknown[] };
        for (const entry of Array.isArray(candidate?.documents) ? candidate.documents : []) {
          if (!entry || typeof entry !== 'object') continue;
          const possible = entry as { id?: unknown; state?: unknown }, state = readSavedRoom(JSON.stringify(possible.state));
          if (typeof possible.id === 'string' && state && possible.id === documentId(state) && !validDocuments.some(d => d.id === possible.id)) validDocuments.push({ id: possible.id, state });
        }
      } catch { /* Untouched source is still available for download. */ }
      const legacy = legacyRaw ? readSavedRoom(legacyRaw) : null;
      if (legacy && !validDocuments.some(d => d.id === documentId(legacy))) validDocuments.push({ id: documentId(legacy), state: legacy });
      return { state: null, recovery: { storageKey: key, damagedKeys: [workspaceStorageKey], untouched: [{ key: workspaceStorageKey, raw: workspaceRaw }, ...(legacyRaw ? [{ key, raw: legacyRaw }] : [])], validDocuments, message: 'The saved room library failed validation. Floortris has not replaced or removed it.' } };
    }
  }
  if (!legacyRaw) return { state: null, recovery: null };
  const legacy = readSavedRoom(legacyRaw);
  if (legacy) return { state: legacy, recovery: null };
  return { state: null, recovery: { storageKey: key, damagedKeys: [key], untouched: [{ key, raw: legacyRaw }], validDocuments: [], message: 'The saved room failed validation. Floortris has not replaced or removed it.' } };
}

/** These are deliberately separate human-confirmed operations. */
export function restoreRecoveredRooms(storage: Pick<Storage, 'setItem'>, recovery: StoredRoomRecovery): RoomWorkspace | null {
  const documents = recovery.validDocuments.filter(d => d.id === documentId(d.state) && readSavedRoom(JSON.stringify(d.state)));
  if (!documents.length || documents.length !== recovery.validDocuments.length) return null;
  const workspace: RoomWorkspace = { version: 1, activeId: documents[0].id, documents: structuredClone(documents) };
  storage.setItem(workspaceKey(recovery.storageKey), JSON.stringify(workspace));
  return workspace;
}
export function resetDamagedStorage(storage: Pick<Storage, 'removeItem'>, recovery: StoredRoomRecovery) { for (const key of recovery.damagedKeys) storage.removeItem(key); }
