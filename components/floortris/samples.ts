import { fromVariant, makeDemo } from './data.ts';
import { clone, type AppState, type FixedFixture, type RoomProfile } from './model.ts';

export const profileRules = (profile: RoomProfile) => profile.kind === 'lounge'
  ? ['sofa', 'tv'] as const
  : profile.kind === 'bedroom'
    ? ['bed', ...(profile.workspace ? ['desk', 'chair'] : []), ...(profile.storage ? ['storage'] : [])] as const
    : profile.kind === 'home_office' ? ['desk', 'chair'] as const : [] as const;

function proposal(state: AppState, furniture = state.current.furniture) {
  state.sequence++;
  state.proposal = { id: `preset-proposal-${state.sequence}`, kind: 'layout', revision: 1, baseCurrentRevision: state.currentRevision, baseRuleRevision: state.ruleRevision, room: clone(state.room), rules: clone(state.rules), layout: { furniture: clone(furniture), appearance: clone(state.current.appearance) }, omitted: [] };
  state.current.furniture = [];
  state.inventory = [];
  return state;
}
function blank(name: string, widthCm: number, depthCm: number, profile: RoomProfile): AppState {
  const state = makeDemo();
  state.room = { name, widthCm, depthCm, profile, openings: [{ id: 'entrance', kind: 'door', wall: 'south', offsetCm: 0, widthCm: 80, hinge: 'start', swing: 'in', angle: 90, mechanism: 'hinged', entrance: true }], fixtures: [] };
  state.rules.requiredKinds = [...profileRules(profile)] as AppState['rules']['requiredKinds'];
  state.current.appearance = { wall: 'warm', floor: 'oak' };
  state.current.furniture = [];
  state.inventory = [];
  return state;
}

/** Legacy lounge demo, kept as an independent document. */
export function makeCompactRoom(): AppState {
  const state = makeDemo();
  state.room.name = 'The 3 × 3 m lounge'; state.room.widthCm = 300; state.room.depthCm = 300; state.room.profile = { kind: 'lounge' };
  state.room.openings = [{ id: 'entrance', kind: 'door', wall: 'south', offsetCm: 0, widthCm: 80, hinge: 'start', swing: 'in', angle: 90, mechanism: 'hinged', entrance: true }, { id: 'window-west', kind: 'window', wall: 'west', offsetCm: 20, widthCm: 100, sillCm: 95, headCm: 215, type: 'fixed', windowAccess: false }];
  state.room.fixtures[0].originCell = { x: 14, y: 4 }; state.room.fixtures[0].wallAnchor = { wall: 'east', offsetCm: 80 };
  state.current.furniture[0].originCell = { x: 4, y: 10 }; state.inventory = clone(state.current.furniture); state.current.appearance = { wall: 'warm', floor: 'oak' };
  const sofa = state.current.furniture[0];
  const tv = fromVariant('frame-tv-120', 'compact-tv'); tv.wallAnchor = { wall: 'north', offsetCm: 140 }; tv.targetSofaId = sofa.id;
  const desk = fromVariant('line-desk-100', 'compact-desk'); desk.originCell = { x: 0, y: 1 }; desk.rotation = 270;
  const chair = fromVariant('nest-chair-60', 'compact-chair'); chair.originCell = { x: 3, y: 2 }; chair.rotation = 90; chair.linkedDeskId = desk.id;
  const table = fromVariant('pebble-table-80', 'compact-table'); table.originCell = { x: 9, y: 6 };
  const rug = fromVariant('weave-rug-200', 'compact-rug'); rug.originCell = { x: 5, y: 2 };
  const storage = fromVariant('folio-storage-80', 'compact-storage'); storage.originCell = { x: 13, y: 0 }; storage.rotation = 90;
  state.sequence = 1;
  state.proposal = { id: 'compact-proposal-1', kind: 'layout', revision: 1, baseCurrentRevision: state.currentRevision, baseRuleRevision: state.ruleRevision, room: clone(state.room), rules: clone(state.rules), layout: { furniture: [...clone(state.current.furniture), tv, desk, chair, table, rug, storage], appearance: clone(state.current.appearance) }, omitted: [] };
  return state;
}

export function makeBedroomSingle(): AppState {
  const state = blank('Compact single bedroom', 300, 300, { kind: 'bedroom', sleeping: 'single', workspace: false, storage: false, bedsideQuantity: 1 });
  const bed = fromVariant('haven-single-100', 'single-bed'); bed.originCell = { x: 4, y: 0 };
  return proposal(state, [bed]);
}

export function makeBedroomDouble(): AppState {
  const state = blank('Double bedroom', 440, 320, { kind: 'bedroom', sleeping: 'double', workspace: false, storage: true, bedsideQuantity: 2 });
  const bed = fromVariant('haven-double-140', 'double-bed'); bed.originCell = { x: 7, y: 1 };
  const wardrobe = fromVariant('tallline-wardrobe-100', 'double-wardrobe'); wardrobe.originCell = { x: 14, y: 3 };
  // Rotation 0 has its foot south, so the head wall is north. Keep both
  // nightstands at that real head end while retaining the 60 cm hard route.
  const left = fromVariant('nook-bedside-40', 'double-bedside-left'); left.originCell = { x: 5, y: 1 }; left.rotation = 90; left.tags.push('bedside-left');
  const right = fromVariant('nook-bedside-40', 'double-bedside-right'); right.originCell = { x: 14, y: 1 }; right.rotation = 270; right.tags.push('bedside-right');
  return proposal(state, [bed, wardrobe, left, right]);
}

export function makeHomeOffice(): AppState {
  const state = blank('Compact home office', 320, 300, { kind: 'home_office', seating: false, storage: true });
  state.room.openings.push({ id: 'office-window', kind: 'window', wall: 'north', offsetCm: 40, widthCm: 140, sillCm: 95, headCm: 215, type: 'fixed', windowAccess: false });
  const desk = fromVariant('line-desk-100', 'office-desk'); desk.originCell = { x: 0, y: 0 };
  const chair = fromVariant('nest-chair-60', 'office-chair'); chair.originCell = { x: 0, y: 3 }; chair.linkedDeskId = desk.id;
  const storage = fromVariant('archive-tall-80', 'office-storage'); storage.originCell = { x: 12, y: 0 };
  return proposal(state, [desk, chair, storage]);
}

export function makeBathroomConcept(): AppState {
  const state = blank('Bathroom concept', 300, 260, { kind: 'bathroom_concept', fixtureIds: ['basin-1', 'toilet-1', 'shower-1'], conceptualOnly: true });
  const fixed = (id: string, label: string, kind: FixedFixture['kind'], w: number, d: number, h: number, x: number, y: number, clearance: FixedFixture['clearance']): FixedFixture => ({ id, label, kind, ownership: 'fixed', sizeCm: { w, d, h }, originCell: { x: x / 20, y: y / 20 }, rotation: 0, elevationCm: 0, locked: { position: true, size: true, rotation: true }, appearance: 'oat', requiredInRoom: true, tags: ['concept-fixture'], conceptualOnly: true, clearance });
  state.room.fixtures = [
    fixed('basin-1', 'Wall basin 60', 'basin', 60, 45, 85, 20, 0, { label: 'Basin approach', rect: { x: 20, y: 45, w: 60, d: 60 } }),
    fixed('toilet-1', 'Compact WC', 'toilet', 40, 65, 80, 120, 0, { label: 'WC approach', rect: { x: 110, y: 65, w: 60, d: 80 } }),
    fixed('shower-1', 'Shower tray 90', 'shower', 90, 90, 5, 200, 0, { label: 'Shower entry', rect: { x: 200, y: 90, w: 90, d: 60 } }),
  ];
  return proposal(state, []);
}

/** Fixed allowlist: every sample has its own local document and starts as a proposal. */
export function roomSession(search: string) {
  const sample = new URLSearchParams(search).get('sample') || 'local';
  const sessions: Record<string, { storageKey: string; makeInitial: () => AppState }> = {
    '3m': { storageKey: 'floortris.v1.sample.3m', makeInitial: makeCompactRoom },
    'bedroom-single': { storageKey: 'floortris.v2.sample.bedroom-single', makeInitial: makeBedroomSingle },
    'bedroom-double': { storageKey: 'floortris.v2.sample.bedroom-double', makeInitial: makeBedroomDouble },
    office: { storageKey: 'floortris.v2.sample.office', makeInitial: makeHomeOffice },
    bathroom: { storageKey: 'floortris.v2.sample.bathroom', makeInitial: makeBathroomConcept },
    local: { storageKey: 'floortris.v1.local', makeInitial: makeDemo },
  };
  return { compact: sample === '3m', sample, ...(sessions[sample] || sessions.local) };
}
