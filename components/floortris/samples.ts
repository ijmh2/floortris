import { normalizeFixturePlacement } from './fixture-placement.ts';
import { fromVariant, makeDemo } from './data.ts';
import { clone, type AppState, type FixedFixture, type RoomProfile } from './model.ts';
import { BENCHMARKS } from './benchmarks.ts';
import { ACCOMMODATION_PACKS } from './accommodation-packs.ts';

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
  const chair = fromVariant('nest-chair-60', 'office-chair'); chair.originCell = { x: 0, y: 3 }; chair.rotation = 180; chair.linkedDeskId = desk.id;
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
/** The measured plan sketched by hand: a 6 x 6 m envelope with a bay off the
 *  top wall and two corners cut away, 24 m2 of floor. Segment ids follow point
 *  order, so the door sits on wall-7 and the windows on wall-1 and wall-5. */
export function makeSketchRoom(): AppState {
  const state = blank('Measured sketch', 600, 600, { kind: 'lounge' });
  state.room.floorPlan = { kind: 'rectilinear', points: [
    { xCm: 100, yCm: 0 }, { xCm: 300, yCm: 0 }, { xCm: 300, yCm: 100 }, { xCm: 600, yCm: 100 },
    { xCm: 600, yCm: 400 }, { xCm: 200, yCm: 400 }, { xCm: 200, yCm: 600 }, { xCm: 0, yCm: 600 },
    { xCm: 0, yCm: 100 }, { xCm: 100, yCm: 100 },
  ] };
  state.room.openings = [
    { id: 'entrance', kind: 'door', wall: 'south', segmentId: 'wall-7', offsetCm: 20, widthCm: 100, hinge: 'start', swing: 'in', angle: 90, mechanism: 'hinged', entrance: true },
    { id: 'window-bay', kind: 'window', wall: 'north', segmentId: 'wall-1', offsetCm: 0, widthCm: 200, sillCm: 90, headCm: 210, type: 'fixed', windowAccess: false },
    { id: 'window-return', kind: 'window', wall: 'south', segmentId: 'wall-5', offsetCm: 100, widthCm: 200, sillCm: 90, headCm: 210, type: 'fixed', windowAccess: false },
  ];
  // Furnished so the sample opens as a room, not an outline. Fixtures carry the
  // relationships the engine checks — the TV names its sofa, the curtains and
  // blind name their openings, each lamp names what it stands on — and are then
  // put through the product's own placement normaliser rather than hand-placed.
  const rug = fromVariant('weave-rug-200', 'sketch-rug'); rug.originCell = { x: 19, y: 11 };
  const sofa = fromVariant('arc-sofa-200', 'sketch-sofa'); sofa.originCell = { x: 19, y: 9 }; sofa.rotation = 270;
  const table = fromVariant('pebble-table-80', 'sketch-table'); table.originCell = { x: 25, y: 13 };
  const side = fromVariant('pebble-side-45', 'sketch-side'); side.originCell = { x: 16, y: 9 };
  const desk = fromVariant('line-desk-100', 'sketch-desk'); desk.originCell = { x: 8, y: 1 };
  state.current.furniture = [rug, sofa, table, side, desk];

  const tv = fromVariant('frame-tv-120', 'sketch-tv'); tv.wallAnchor = { wall: 'east', segmentId: 'wall-4', offsetCm: 120 }; tv.targetSofaId = sofa.id;
  const curtains = fromVariant('soft-curtains-160', 'sketch-curtains'); curtains.attachedOpeningId = 'window-bay';
  const blind = fromVariant('line-blind-160', 'sketch-blind'); blind.attachedOpeningId = 'window-return';
  const ceiling = fromVariant('halo-flush-35', 'sketch-ceiling'); ceiling.originCell = { x: 12, y: 8 };
  const deskLamp = fromVariant('nook-table-lamp-28', 'sketch-desk-lamp'); deskLamp.supportObjectId = desk.id;
  const sofaLamp = fromVariant('nook-table-lamp-28', 'sketch-sofa-lamp'); sofaLamp.supportObjectId = side.id;
  const wallLight = fromVariant('arc-wall-light-24', 'sketch-wall-light'); wallLight.wallAnchor = { wall: 'east', segmentId: 'wall-4', offsetCm: 240 };
  for (const fixture of [tv, curtains, blind, ceiling, deskLamp, sofaLamp, wallLight]) state.current.furniture.push(normalizeFixturePlacement(fixture, state.room, state.rules, state.current, !!fixture.supportObjectId));

  return state;
}

export function roomSession(search: string) {
  const sample = new URLSearchParams(search).get('sample') || 'local';
  const sessions: Record<string, { storageKey: string; makeInitial: () => AppState }> = {
    '3m': { storageKey: 'floortris.v1.sample.3m', makeInitial: makeCompactRoom },
    'bedroom-single': { storageKey: 'floortris.v2.sample.bedroom-single', makeInitial: makeBedroomSingle },
    'bedroom-double': { storageKey: 'floortris.v2.sample.bedroom-double', makeInitial: makeBedroomDouble },
    office: { storageKey: 'floortris.v2.sample.office', makeInitial: makeHomeOffice },
    bathroom: { storageKey: 'floortris.v2.sample.bathroom', makeInitial: makeBathroomConcept },
    sketch: { storageKey: 'floortris.v4.sample.sketch', makeInitial: makeSketchRoom },
    local: { storageKey: 'floortris.v1.local', makeInitial: makeDemo },
    ...Object.fromEntries(BENCHMARKS.map(benchmark => [benchmark.id, { storageKey: `floortris.v1.${benchmark.id}`, makeInitial: benchmark.makeInitial }])),
    ...Object.fromEntries(ACCOMMODATION_PACKS.map(pack => [pack.id, { storageKey: `floortris.v1.${pack.id}`, makeInitial: pack.makeInitial }])),
  };
  return { compact: sample === '3m', sample, ...(sessions[sample] || sessions.local) };
}
