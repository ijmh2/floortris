/**
 * iOS native bridge for Floortris Pocket.
 *
 * Swift sends a small ScanResult JSON over WKScriptMessageHandler.
 * This module converts it into a valid AppState, runs
 * validatePersistedDocument(), and calls humanOpenRoom() if it passes.
 * Results are posted back to Swift via plannerBridge message handler.
 *
 * Swift never constructs AppState. This file owns that conversion.
 */

import { validatePersistedDocument } from './document-schema.ts';
import type { AppState, Layout, Opening, Room, Rules } from './model.ts';
import type { FloortrisStore } from './store.ts';

// ---------------------------------------------------------------------------
// Types mirrored from Swift ScanResult struct
// ---------------------------------------------------------------------------

type ScanResultOpening = {
  wall: 'north' | 'east' | 'south' | 'west';
  offsetCm: number;
  widthCm: number;
  kind: 'door' | 'window';
};

type ScanResultPayload = {
  source: 'manual' | 'roomplan';
  widthCm: number;
  depthCm: number;
  outline?: { xCm: number; yCm: number }[];
  openings: ScanResultOpening[];
  objects: unknown[]; // reserved for Gate 3 (scan objects)
};

type BridgeResult = { ok: true } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function snap20(cm: number): number {
  return Math.round(cm / 20) * 20;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ---------------------------------------------------------------------------
// ScanResult → AppState
// ---------------------------------------------------------------------------

function buildAppState(scan: ScanResultPayload, roomName: string): AppState {
  const widthCm = clamp(snap20(scan.widthCm), 240, 1000);
  const depthCm = clamp(snap20(scan.depthCm), 240, 1000);

  // Build openings. validateRoomInputs requires at least one entrance door.
  const openings: Opening[] = [];
  let doorIndex = 0;

  for (let i = 0; i < scan.openings.length && openings.length < 12; i++) {
    const o = scan.openings[i];
    if (o.kind === 'door') {
      openings.push({
        id: `door-${i}`,
        kind: 'door',
        wall: o.wall,
        offsetCm: o.offsetCm,
        widthCm: o.widthCm,
        hinge: 'start',
        swing: 'in',
        angle: 90,
        mechanism: 'hinged',
        entrance: doorIndex === 0, // first door is the entrance
      });
      doorIndex++;
    } else {
      openings.push({
        id: `window-${i}`,
        kind: 'window',
        wall: o.wall,
        offsetCm: o.offsetCm,
        widthCm: o.widthCm,
        sillCm: 90,
        headCm: 210,
        type: 'unknown',
        windowAccess: false,
      });
    }
  }

  // If no door was provided (manual entry path), synthesise a centred south door.
  if (doorIndex === 0) {
    const doorWidth = 80;
    const offset = snap20(Math.max(0, widthCm / 2 - doorWidth / 2));
    openings.unshift({
      id: 'entrance',
      kind: 'door',
      wall: 'south',
      offsetCm: offset,
      widthCm: doorWidth,
      hinge: 'start',
      swing: 'in',
      angle: 90,
      mechanism: 'hinged',
      entrance: true,
    });
  }

  const room: Room = {
    name: roomName.trim() || 'My Room',
    widthCm,
    depthCm,
    openings,
    fixtures: [],
    profile: { kind: 'lounge' },
  };

  if (
    scan.outline &&
    scan.outline.length >= 4 &&
    scan.outline.length <= 24
  ) {
    room.floorPlan = { kind: 'rectilinear', points: scan.outline };
  }

  const rules: Rules = {
    cellCm: 20,
    H_lowCm: 130,
    walkHardCm: 60,
    walkPreferredCm: 90,
    storageFrontCm: 60,
    chairPullCm: 90,
    bedLongSideAccessCm: 60,
    radiatorFrontCm: 30,
    windowFrontCm: 30,
    ceilingCm: 250,
    requiredKinds: [],
    deskNearWindow: false,
    openFloorM2: 0,
  };

  const current: Layout = {
    furniture: [],
    appearance: { wall: 'cream', floor: 'oak' },
  };

  const appState: AppState = {
    version: 2,
    documentId: `ios-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    currentRevision: 1,
    ruleRevision: 1,
    current,
    room,
    rules,
    inventory: [],
    proposal: null,
    sequence: 0,
  };

  return appState;
}

// ---------------------------------------------------------------------------
// Bridge factory — called from FloortrisApp.tsx once the store is ready
// ---------------------------------------------------------------------------

export function createIosBridge(store: FloortrisStore) {
  const bridge = {
    applyIosScanResult(scanResultJSON: string, roomName: string): BridgeResult {
      let scan: ScanResultPayload;
      try {
        scan = JSON.parse(scanResultJSON) as ScanResultPayload;
      } catch {
        const result: BridgeResult = { ok: false, error: 'Invalid ScanResult JSON from native layer.' };
        postToNative(result);
        return result;
      }

      const appState = buildAppState(scan, roomName);

      const validationError = validatePersistedDocument(appState);
      if (validationError) {
        const result: BridgeResult = { ok: false, error: validationError };
        postToNative(result);
        return result;
      }

      const storeResult = store.humanOpenRoom(appState);
      if (!storeResult.operationSucceeded) {
        const result: BridgeResult = {
          ok: false,
          error: storeResult.error?.message ?? 'Failed to open room.',
        };
        postToNative(result);
        return result;
      }

      const result: BridgeResult = { ok: true };
      postToNative(result);
      return result;
    },
  };

  // Expose globally so injected WKUserScript can call it
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__floortrisBridge = bridge;

  // Tell Swift the bridge is ready
  window.dispatchEvent(new CustomEvent('floortrisBridgeReady'));

  return bridge;
}

function postToNative(result: BridgeResult) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).webkit?.messageHandlers?.plannerBridge?.postMessage(result);
  } catch {
    // Not in a WKWebView context — no-op
  }
}
