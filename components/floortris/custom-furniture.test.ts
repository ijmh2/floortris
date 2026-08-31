import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createStore } from './store.ts';
import { DEFAULT_RULES } from './data.ts';
import { buildFurniture } from './scene3d.ts';
import { makeCustomFurniture } from './custom-furniture.ts';
import { readImportedRoom, readSavedRoom } from './persistence.ts';
import { TOOL_SCHEMAS, validateSchema } from './schemas.ts';
import { validate } from './engine.ts';
import type { AppState, FloorPlan, Furniture, RoomProfile } from './model.ts';

function blank(profile: RoomProfile = { kind: 'lounge' }, floorPlan?: FloorPlan): AppState {
  return {
    version: 2, documentId: 'custom-test', currentRevision: 1, ruleRevision: 1, sequence: 0, proposal: null,
    rules: { ...structuredClone(DEFAULT_RULES), requiredKinds: [] }, inventory: [],
    room: {
      name: 'Custom test room', widthCm: 600, depthCm: 500, profile, ...(floorPlan ? { floorPlan } : {}), fixtures: [],
      openings: [{ id: 'entrance', kind: 'door', wall: 'south', ...(floorPlan ? { segmentId: 'wall-5' } : {}), offsetCm: 20, widthCm: 80, hinge: 'start', swing: 'in', angle: 90, mechanism: 'hinged', entrance: true }],
    },
    current: { furniture: [], appearance: { wall: 'cream', floor: 'oak' } },
  };
}
async function draft(state = blank()) {
  const store = createStore(state), accepted = store.getState();
  const made = await store.execute('createProposal', { kind: 'layout', expectedCurrentRevision: accepted.currentRevision, expectedRuleRevision: accepted.ruleRevision, idempotencyKey: `draft-${Math.random()}` });
  assert.equal(made.operationSucceeded, true, JSON.stringify(made));
  return store;
}
const revision = (store: ReturnType<typeof createStore>) => ({ proposalId: store.getState().proposal!.id, revision: store.getState().proposal!.revision });
const input = (store: ReturnType<typeof createStore>, key = 'custom-1') => ({
  ...revision(store), label: 'Made-to-measure side table', kind: 'table', widthCm: 87.5, depthCm: 43.25, heightCm: 61.5,
  positionCm: { xCm: 220.5, yCm: 180.25 }, rotation: 90, appearance: 'oak', idempotencyKey: key,
});

test('createCustomFurniture preserves exact measurements, provenance and proposal-only authority', async () => {
  const store = await draft(), currentBefore = structuredClone(store.getState().current);
  const result = await store.execute('createCustomFurniture', input(store));
  assert.equal(result.operationSucceeded, true, JSON.stringify(result));
  assert.deepEqual(store.getState().current, currentBefore, 'Current must remain untouched');
  const item = store.getState().proposal!.layout.furniture.find(piece => piece.ownership === 'custom')!;
  assert.deepEqual(item.sizeCm, { w: 87.5, d: 43.25, h: 61.5 });
  assert.deepEqual(item.originCell, { x: 11.025, y: 9.0125 });
  assert.equal(item.kind, 'table'); assert.deepEqual(item.tags, []); assert.equal(item.requiredInRoom, false);
  assert.equal(item.locked.size, true); assert.equal(item.variantId, undefined);
  assert.deepEqual(item.customProvenance, { source: 'agent_authored_one_off', tool: 'createCustomFurniture' });
  assert.deepEqual(result.measuredEnvelopeCm, item.sizeCm);
  assert.equal((result.review as { requiresHumanApply: boolean }).requiresHumanApply, true);
  assert.equal((result.review as { applied: boolean }).applied, false);
  const listed = await store.execute('listFurniture', { which: 'proposal' });
  assert.ok((listed.furniture as Furniture[]).some(piece => piece.id === item.id && piece.ownership === 'custom'));
  const p = store.getState().proposal!;
  assert.equal(store.applyProposal(p.id, p.revision).operationSucceeded, true, 'only the human API publishes the reviewed revision');
  assert.ok(store.getState().current.furniture.some(piece => piece.id === item.id && piece.ownership === 'custom'));
});

test('custom creation is idempotent, revision-bound and rejects key reuse with changed measurements', async () => {
  const store = await draft(), args = input(store, 'same-custom');
  const first = await store.execute('createCustomFurniture', args), count = store.getState().proposal!.layout.furniture.length;
  const replay = await store.execute('createCustomFurniture', args);
  assert.equal(first.operationSucceeded, true); assert.equal(replay.operationSucceeded, true); assert.equal(replay.idempotentReplay, true);
  assert.equal(store.getState().proposal!.layout.furniture.length, count);
  const conflict = await store.execute('createCustomFurniture', { ...args, widthCm: 88 });
  assert.equal(conflict.operationSucceeded, false); assert.equal(conflict.error?.code, 'idempotency_conflict');
  const stale = await store.execute('createCustomFurniture', { ...input(store, 'stale-custom'), revision: args.revision });
  assert.equal(stale.operationSucceeded, false); assert.equal(stale.error?.code, 'revision_conflict');
});

test('schema fails closed on unsupported kinds, dimensions, relationship claims and injected properties', async () => {
  const store = await draft(), base = input(store);
  for (const patch of [
    { kind: 'tv' }, { kind: 'rug' }, { widthCm: 0 }, { heightCm: 501 }, { rotation: 45 }, { appearance: 'url(https://example.test/model.glb)' },
    { tags: ['wardrobe'] }, { svg: '<svg onload=alert(1) />' }, { modelUrl: 'https://example.test/model.glb' }, { ruleOverrides: { collision: false } },
  ]) {
    const result = await store.execute('createCustomFurniture', { ...base, ...patch, idempotencyKey: `bad-${Object.keys(patch)[0]}` });
    assert.equal(result.operationSucceeded, false, JSON.stringify(patch)); assert.equal(result.error?.code, 'invalid_arguments');
  }
  const wrongLink = await store.execute('createCustomFurniture', { ...base, kind: 'table', linkedDeskId: 'desk', idempotencyKey: 'bad-link' });
  assert.equal(wrongLink.operationSucceeded, false); assert.equal(wrongLink.error?.code, 'invalid_property');
  assert.equal(store.getState().proposal!.layout.furniture.length, 0);
});

test('new collision, ceiling and out-of-room failures are refused atomically', async () => {
  const store = await draft();
  const first = await store.execute('createCustomFurniture', { ...input(store, 'first'), positionCm: { xCm: 240, yCm: 200 }, rotation: 0 });
  assert.equal(first.operationSucceeded, true, JSON.stringify(first));
  const count = store.getState().proposal!.layout.furniture.length;
  for (const [key, patch, code] of [
    ['collision', { positionCm: { xCm: 250, yCm: 210 } }, 'solid_overlap'],
    ['outside', { positionCm: { xCm: 580, yCm: 200 } }, 'out_of_room'],
    ['ceiling', { positionCm: { xCm: 400, yCm: 200 }, heightCm: 300 }, 'ceiling_collision'],
  ] as const) {
    const result = await store.execute('createCustomFurniture', { ...input(store, key), ...patch });
    assert.equal(result.operationSucceeded, false, JSON.stringify(result)); assert.equal(result.error?.code, code);
    assert.equal(store.getState().proposal!.layout.furniture.length, count);
  }
});

test('custom furniture respects an L-shaped floor boundary', async () => {
  const plan: FloorPlan = { kind: 'rectilinear', points: [
    { xCm: 0, yCm: 0 }, { xCm: 600, yCm: 0 }, { xCm: 600, yCm: 300 },
    { xCm: 300, yCm: 300 }, { xCm: 300, yCm: 500 }, { xCm: 0, yCm: 500 },
  ] };
  const store = await draft(blank({ kind: 'lounge' }, plan));
  const voidResult = await store.execute('createCustomFurniture', { ...input(store, 'l-void'), widthCm: 80, depthCm: 60, heightCm: 70, positionCm: { xCm: 420, yCm: 380 }, rotation: 0 });
  assert.equal(voidResult.operationSucceeded, false); assert.equal(voidResult.error?.code, 'out_of_room');
  const inside = await store.execute('createCustomFurniture', { ...input(store, 'l-inside'), widthCm: 80, depthCm: 60, heightCm: 70, positionCm: { xCm: 420, yCm: 180 }, rotation: 0 });
  assert.equal(inside.operationSucceeded, true, JSON.stringify(inside));
});

test('the only optional relationship is a verified custom chair to an existing desk', async () => {
  const store = await draft();
  const desk = await store.execute('createCustomFurniture', { ...input(store, 'custom-desk'), label: 'Measured desk', kind: 'desk', widthCm: 120, depthCm: 60, heightCm: 74, positionCm: { xCm: 200, yCm: 100 }, rotation: 0 });
  assert.equal(desk.operationSucceeded, true, JSON.stringify(desk));
  const deskId = store.getState().proposal!.layout.furniture[0].id;
  const linked = await store.execute('createCustomFurniture', { ...input(store, 'custom-chair'), label: 'Measured task chair', kind: 'chair', widthCm: 60, depthCm: 60, heightCm: 90, positionCm: { xCm: 230, yCm: 160 }, rotation: 180, linkedDeskId: deskId });
  assert.equal(linked.operationSucceeded, true, JSON.stringify(linked));
  assert.equal(store.getState().proposal!.layout.furniture.find(piece => piece.kind === 'chair')?.linkedDeskId, deskId);
  const missing = await store.execute('createCustomFurniture', { ...input(store, 'missing-desk'), label: 'Untrusted linked chair', kind: 'chair', widthCm: 60, depthCm: 60, heightCm: 90, positionCm: { xCm: 400, yCm: 180 }, rotation: 180, linkedDeskId: 'not-a-desk' });
  assert.equal(missing.operationSucceeded, false); assert.equal(missing.error?.code, 'invalid_id');
});

test('dimensions and kind stay immutable while move, appearance, review and remove flows work', async () => {
  const store = await draft(); await store.execute('createCustomFurniture', input(store));
  const item = store.getState().proposal!.layout.furniture[0], original = structuredClone(item.sizeCm);
  const candidates = await store.execute('findPlacements', { ...revision(store), objectId: item.id, limit: 1 });
  assert.equal(candidates.operationSucceeded, true); assert.ok((candidates.candidates as unknown[]).length > 0, 'existing checked-placement flow supports custom objects');
  const variant = await store.execute('updateFurniture', { ...revision(store), objectId: item.id, variantId: 'fold-console-120' });
  assert.equal(variant.operationSucceeded, false); assert.equal(variant.error?.code, 'custom_resize_forbidden');
  const directSize = await store.execute('updateFurniture', { ...revision(store), objectId: item.id, sizeCm: { w: 1, d: 1, h: 1 } });
  assert.equal(directSize.operationSucceeded, false); assert.equal(directSize.error?.code, 'invalid_arguments');
  const moved = await store.execute('updateFurniture', { ...revision(store), objectId: item.id, originCell: { x: 18, y: 7 }, rotation: 180 });
  assert.equal(moved.operationSucceeded, true); assert.deepEqual(store.getState().proposal!.layout.furniture[0].sizeCm, original);
  const finish = await store.execute('setAppearance', { ...revision(store), target: 'furniture', objectId: item.id, paletteId: 'clay' });
  assert.equal(finish.operationSucceeded, true); assert.equal(store.getState().proposal!.layout.furniture[0].appearance, 'clay');
  const checked = await store.execute('checkLayout', { which: 'proposal', objectId: item.id, detail: 'issues' });
  assert.equal(checked.operationSucceeded, true);
  const removed = await store.execute('removeFurniture', { ...revision(store), objectId: item.id });
  assert.equal(removed.operationSucceeded, true); assert.equal(store.getState().proposal!.layout.furniture.length, 0);
});

test('custom labels cannot claim protected bedroom classifications or inventory authority', () => {
  const state = blank({ kind: 'bedroom', sleeping: 'double', workspace: false, storage: true });
  const bed = makeCustomFurniture({ label: 'Double bed wardrobe bedside', kind: 'bed', widthCm: 140, depthCm: 200, heightCm: 90, positionCm: { xCm: 200, yCm: 80 }, rotation: 0, appearance: 'oat' }, 'custom-bed');
  const storage = makeCustomFurniture({ label: 'Wardrobe', kind: 'storage', widthCm: 100, depthCm: 60, heightCm: 210, positionCm: { xCm: 20, yCm: 80 }, rotation: 0, appearance: 'oak' }, 'custom-storage');
  const report = validate({ ...state.current, furniture: [bed, storage] }, state.room, state.rules, state.inventory);
  assert.ok(report.brief.missingRequired.includes('bed:sleep-size'));
  assert.ok(report.brief.missingRequired.includes('wardrobe'));
  assert.deepEqual(bed.tags, []); assert.equal(bed.sleepSize, undefined); assert.deepEqual(storage.tags, []);
});

test('custom records persist/export/import locally, while forged role tags are rejected', async () => {
  const store = await draft(); await store.execute('createCustomFurniture', input(store));
  const raw = JSON.stringify(store.getState()), restored = readSavedRoom(raw), imported = readImportedRoom(raw);
  assert.equal(restored?.proposal?.layout.furniture[0].ownership, 'custom');
  assert.equal(imported?.proposal?.layout.furniture[0].customProvenance?.tool, 'createCustomFurniture');
  const forged = structuredClone(store.getState()); forged.proposal!.layout.furniture[0].tags = ['wardrobe'];
  assert.equal(readSavedRoom(JSON.stringify(forged)), null);
  const injected = JSON.parse(raw) as AppState & { proposal: NonNullable<AppState['proposal']> };
  Object.assign(injected.proposal.layout.furniture[0], { modelUrl: 'https://example.test/remote.glb', html: '<script>bad()</script>' });
  assert.equal(readSavedRoom(JSON.stringify(injected)), null);
});

test('safe 3D primitive stays inside its exact measured envelope and exposes provenance metadata', () => {
  const room = blank().room;
  const item = makeCustomFurniture({ label: 'Odd measured table', kind: 'table', widthCm: 87.5, depthCm: 43.25, heightCm: 61.5, positionCm: { xCm: 200, yCm: 180 }, rotation: 0, appearance: 'oak' }, 'custom-render');
  const group = buildFurniture(item, room); group.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
  assert.ok(size.x <= .875001 && size.z <= .432501 && size.y <= .615001, `${size.x},${size.y},${size.z}`);
  assert.deepEqual(group.userData.measuredEnvelopeCm, item.sizeCm);
  assert.equal(group.userData.custom, true); assert.equal(group.userData.provenance, 'agent_authored_one_off');
});

test('native schema exposes the strict custom contract', () => {
  const schema = TOOL_SCHEMAS.createCustomFurniture;
  assert.equal(schema.readOnly, false); assert.match(schema.description, /human Apply|No arbitrary tags/i);
  assert.equal(validateSchema({ proposalId: 'p', revision: 1, label: 'x', kind: 'table', widthCm: 40, depthCm: 40, heightCm: 40, positionCm: { xCm: 0, yCm: 0 }, rotation: 0, appearance: 'oak', idempotencyKey: 'k' }, schema.inputSchema), null);
  assert.match(validateSchema({ proposalId: 'p', revision: 1, label: 'x', kind: 'rug', widthCm: 40, depthCm: 40, heightCm: 1, positionCm: { xCm: 0, yCm: 0 }, rotation: 0, appearance: 'oak', idempotencyKey: 'k' }, schema.inputSchema) || '', /must be one of|does not match/);
  assert.match(validateSchema({ proposalId: 'p', revision: 1, label: 'x', kind: 'other', widthCm: 40, depthCm: 40, heightCm: 40, positionCm: { xCm: 0, yCm: 0 }, rotation: 0, appearance: 'oak', idempotencyKey: 'k' }, schema.inputSchema) || '', /must be one of|does not match/);
});
