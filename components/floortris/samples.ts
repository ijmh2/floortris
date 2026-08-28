import { fromVariant, makeDemo } from './data.ts';
import { clone, type AppState } from './model.ts';

/** An independent, assumed room; never resize or relocate the user's existing room. */
export function makeCompactRoom(): AppState {
  const state = makeDemo();
  state.room.name = 'The 3 × 3 m lounge';
  state.room.widthCm = 300;
  state.room.depthCm = 300;
  state.room.openings = [
    { id: 'entrance', kind: 'door', wall: 'south', offsetCm: 0, widthCm: 80, hinge: 'start', swing: 'in', angle: 90, mechanism: 'hinged', entrance: true },
    { id: 'window-west', kind: 'window', wall: 'west', offsetCm: 20, widthCm: 100, sillCm: 95, headCm: 215, type: 'fixed', windowAccess: false },
  ];
  state.room.fixtures[0].originCell = { x: 14, y: 4 };
  state.room.fixtures[0].wallAnchor = { wall: 'east', offsetCm: 80 };
  state.current.furniture[0].originCell = { x: 4, y: 10 };
  state.inventory = clone(state.current.furniture);
  state.current.appearance = { wall: 'warm', floor: 'oak' };

  const tv = fromVariant('frame-tv-120', 'compact-tv');
  tv.wallAnchor = { wall: 'north', offsetCm: 140 };
  tv.targetSofaId = 'owned-sofa';
  const desk = fromVariant('line-desk-100', 'compact-desk');
  desk.originCell = { x: 0, y: 1 }; desk.rotation = 270;
  const chair = fromVariant('nest-chair-60', 'compact-chair');
  chair.originCell = { x: 3, y: 2 }; chair.rotation = 90; chair.linkedDeskId = desk.id;
  const table = fromVariant('pebble-table-80', 'compact-table');
  // Keep a real 40 cm gap between the table and the front of the sofa.
  table.originCell = { x: 9, y: 6 };
  const rug = fromVariant('weave-rug-200', 'compact-rug');
  rug.originCell = { x: 5, y: 2 };
  const storage = fromVariant('folio-storage-80', 'compact-storage');
  storage.originCell = { x: 13, y: 0 }; storage.rotation = 90;

  state.sequence = 1;
  state.proposal = {
    id: 'compact-proposal-1', kind: 'layout', revision: 1,
    baseCurrentRevision: state.currentRevision, baseRuleRevision: state.ruleRevision,
    room: clone(state.room), rules: clone(state.rules),
    layout: { furniture: [...clone(state.current.furniture), tv, desk, chair, table, rug, storage], appearance: clone(state.current.appearance) },
    omitted: [],
  };
  return state;
}

/** Fixed allowlist: sample navigation cannot replace the original device-local document. */
export function roomSession(search: string) {
  const compact = new URLSearchParams(search).get('sample') === '3m';
  return {
    compact,
    storageKey: compact ? 'floortris.v1.sample.3m' : 'floortris.v1.local',
    makeInitial: compact ? makeCompactRoom : makeDemo,
  };
}
