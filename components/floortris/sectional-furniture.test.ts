import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { createStore } from './store.ts';
import { DEFAULT_RULES } from './data.ts';
import { makeCustomFurniture } from './custom-furniture.ts';
import { validate } from './sectional-engine.ts';
import { sectionalGeometryError, sectionalEnvelope, transformedModuleRect } from './sectional.ts';
import { readSavedRoom } from './persistence.ts';
import { TOOL_SCHEMAS, validateSchema } from './schemas.ts';
import { buildFurniture } from './scene3d.ts';
import type { AppState, FloorPlan, SectionalGeometry } from './model.ts';

const U: SectionalGeometry = { type: 'sectional', primaryFacing: 'south', modules: [
  { id: 'left-return', type: 'chaise', xCm: 0, yCm: 0, widthCm: 80, depthCm: 240, heightCm: 85, facing: 'east' },
  { id: 'centre', type: 'seat', xCm: 80, yCm: 0, widthCm: 240, depthCm: 80, heightCm: 85, facing: 'south' },
  { id: 'right-return', type: 'chaise', xCm: 320, yCm: 0, widthCm: 80, depthCm: 240, heightCm: 85, facing: 'west' },
] };
const L: SectionalGeometry = { type: 'sectional', primaryFacing: 'south', modules: [
  { id: 'run', type: 'seat', xCm: 0, yCm: 0, widthCm: 240, depthCm: 80, heightCm: 85, facing: 'south' },
  { id: 'return', type: 'chaise', xCm: 0, yCm: 80, widthCm: 80, depthCm: 160, heightCm: 85, facing: 'east' },
] };

function state(floorPlan?: FloorPlan): AppState {
  return { version: 2, documentId: 'sectional-test', currentRevision: 1, ruleRevision: 1, sequence: 0, proposal: null,
    rules: { ...structuredClone(DEFAULT_RULES), requiredKinds: [] }, inventory: [],
    room: { name: 'Sectional room', widthCm: floorPlan ? 600 : 800, depthCm: floorPlan ? 600 : 700, ...(floorPlan ? { floorPlan } : {}), profile: { kind: 'lounge' }, fixtures: [], openings: [{ id: 'entrance', kind: 'door', wall: 'south', ...(floorPlan ? { segmentId: 'wall-5' } : {}), offsetCm: 20, widthCm: 80, hinge: 'start', swing: 'in', angle: 90, mechanism: 'hinged', entrance: true }] },
    current: { furniture: [], appearance: { wall: 'cream', floor: 'oak' } } };
}
const custom = (geometry = U, id = 'sectional', xCm = 200, yCm = 40, rotation: 0|90|180|270 = 0) => {
  const envelope = sectionalEnvelope(geometry);
  return makeCustomFurniture({ label: 'Measured U sectional', kind: 'sofa', widthCm: envelope.w, depthCm: envelope.d, heightCm: envelope.h, positionCm: { xCm, yCm }, rotation, appearance: 'moss', geometry }, id);
};
async function draft() {
  const store = createStore(state()), accepted = store.getState();
  const made = await store.execute('createProposal', { kind: 'layout', expectedCurrentRevision: accepted.currentRevision, expectedRuleRevision: accepted.ruleRevision, idempotencyKey: 'sectional-draft' });
  assert.equal(made.operationSucceeded, true); return store;
}

test('strict module geometry accepts genuine connected L and U assemblies', () => {
  assert.equal(sectionalGeometryError(U, { w: 400, d: 240, h: 85 }), null);
  assert.equal(sectionalGeometryError(L, { w: 240, d: 240, h: 85 }), null);
  assert.deepEqual(sectionalEnvelope(U), { w: 400, d: 240, h: 85 });
});

test('sectional geometry rejects overlap, islands, wrong envelope and unsafe extra data', async () => {
  const overlap = structuredClone(L); overlap.modules[1].yCm = 40;
  const island = structuredClone(L); island.modules[1].xCm = 300;
  assert.match(sectionalGeometryError(overlap) || '', /overlap/);
  assert.match(sectionalGeometryError(island) || '', /connected/);
  assert.match(sectionalGeometryError(L, { w: 241, d: 240, h: 85 }) || '', /exactly match/);
  const store = await draft(), p = store.getState().proposal!;
  const injected = structuredClone(U) as SectionalGeometry & { modelUrl?: string }; injected.modelUrl = 'https://example.test/sofa.glb';
  const result = await store.execute('createCustomFurniture', { proposalId: p.id, revision: p.revision, label: 'Injected', kind: 'sofa', widthCm: 400, depthCm: 240, heightCm: 85, positionCm: { xCm: 200, yCm: 40 }, rotation: 0, appearance: 'moss', geometry: injected, idempotencyKey: 'injected' });
  assert.equal(result.operationSucceeded, false); assert.equal(result.error?.code, 'invalid_arguments');
});

test('tool creates one immutable U sectional with proposal-only authority and idempotency', async () => {
  const store = await draft(), current = structuredClone(store.getState().current), p = store.getState().proposal!;
  const args = { proposalId: p.id, revision: p.revision, label: 'Measured U sectional', kind: 'sofa', widthCm: 400, depthCm: 240, heightCm: 85, positionCm: { xCm: 200, yCm: 40 }, rotation: 0, appearance: 'moss', geometry: U, idempotencyKey: 'u-one' };
  const made = await store.execute('createCustomFurniture', args);
  assert.equal(made.operationSucceeded, true, JSON.stringify(made)); assert.deepEqual(store.getState().current, current);
  assert.equal(store.getState().proposal!.layout.furniture.length, 1); assert.deepEqual(store.getState().proposal!.layout.furniture[0].geometry, U);
  const replay = await store.execute('createCustomFurniture', args); assert.equal(replay.idempotentReplay, true);
  const id = store.getState().proposal!.layout.furniture[0].id;
  const found = await store.execute('findPlacements', { proposalId: p.id, revision: store.getState().proposal!.revision, objectId: id, limit: 1 });
  assert.equal(found.operationSucceeded, true);
  const moved = await store.execute('updateFurniture', { proposalId: p.id, revision: store.getState().proposal!.revision, objectId: id, originCell: { x: 7, y: 2 }, rotation: 90 });
  assert.equal(moved.operationSucceeded, true); assert.deepEqual(store.getState().proposal!.layout.furniture[0].geometry, U);
  const coloured = await store.execute('setAppearance', { proposalId: p.id, revision: store.getState().proposal!.revision, target: 'furniture', objectId: id, paletteId: 'clay' });
  assert.equal(coloured.operationSucceeded, true); assert.deepEqual(store.getState().proposal!.layout.furniture[0].geometry, U);
  const resized = await store.execute('updateFurniture', { proposalId: p.id, revision: store.getState().proposal!.revision, objectId: store.getState().proposal!.layout.furniture[0].id, variantId: 'corner-sofa-240' });
  assert.equal(resized.operationSucceeded, false); assert.equal(resized.error?.code, 'custom_resize_forbidden');
  const removed = await store.execute('removeFurniture', { proposalId: p.id, revision: store.getState().proposal!.revision, objectId: id });
  assert.equal(removed.operationSucceeded, true); assert.equal(store.getState().proposal!.layout.furniture.length, 0);
});

test('exact union leaves the L notch empty but detects real module collisions', () => {
  const sectional = custom(L, 'l', 100, 100), notch = makeCustomFurniture({ label: 'Notch plant', kind: 'plant', widthCm: 40, depthCm: 40, heightCm: 50, positionCm: { xCm: 220, yCm: 220 }, rotation: 0, appearance: 'oak' }, 'notch');
  const clear = validate({ ...state().current, furniture: [sectional, notch] }, state().room, state().rules, []);
  assert.equal(clear.issues.some(issue => issue.code === 'solid_overlap' && issue.objectIds.includes('notch')), false);
  notch.originCell = { x: 6, y: 6 };
  const hit = validate({ ...state().current, furniture: [sectional, notch] }, state().room, state().rules, []);
  assert.ok(hit.issues.some(issue => issue.code === 'solid_overlap' && issue.objectIds.includes('l') && issue.objectIds.includes('notch')));
});

test('module union can follow an L-shaped room while its empty bounding corner lies outside', () => {
  const plan: FloorPlan = { kind: 'rectilinear', points: [{xCm:0,yCm:0},{xCm:600,yCm:0},{xCm:600,yCm:300},{xCm:300,yCm:300},{xCm:300,yCm:600},{xCm:0,yCm:600}] };
  const geometry: SectionalGeometry = { type: 'sectional', primaryFacing: 'south', modules: [
    { id: 'top', type: 'seat', xCm: 0, yCm: 0, widthCm: 400, depthCm: 80, heightCm: 80, facing: 'south' },
    { id: 'leg', type: 'chaise', xCm: 0, yCm: 80, widthCm: 80, depthCm: 320, heightCm: 80, facing: 'east' },
  ] };
  const app = state(plan), sectional = custom(geometry, 'room-l', 200, 200);
  const report = validate({ ...app.current, furniture: [sectional] }, app.room, app.rules, []);
  assert.equal(report.issues.some(issue => issue.code === 'out_of_room' && issue.objectIds.includes('room-l')), false);
});

test('internal joins do not self-collide or self-block, while exposed fronts remain checked', () => {
  const app = state(), sectional = custom();
  const clear = validate({ ...app.current, furniture: [sectional] }, app.room, app.rules, []);
  assert.equal(clear.issues.some(issue => issue.code === 'solid_overlap' && issue.objectIds.every(id => id === sectional.id)), false);
  assert.equal(clear.issues.some(issue => issue.code === 'sofa_front_blocked' && new Set(issue.objectIds).size === 1), false);
  assert.ok(clear.zones.filter(zone => zone.objectId === sectional.id && zone.id.startsWith('sofa:')).length >= 3);
  const blocker = makeCustomFurniture({ label: 'Front blocker', kind: 'storage', widthCm: 80, depthCm: 40, heightCm: 80, positionCm: { xCm: 360, yCm: 140 }, rotation: 0, appearance: 'oak' }, 'blocker');
  const blocked = validate({ ...app.current, furniture: [sectional, blocker] }, app.room, app.rules, []);
  assert.ok(blocked.issues.some(issue => issue.code === 'sofa_front_blocked' && issue.objectIds.includes('blocker')));
});

test('moving and quarter-turning the parent transforms the complete union', () => {
  const item = custom(L, 'moving', 100, 120, 90);
  const rects = item.geometry!.modules.map(module => transformedModuleRect(item, module));
  assert.deepEqual(rects, [{ x: 260, y: 120, w: 80, d: 240 }, { x: 100, y: 120, w: 160, d: 80 }]);
  item.originCell = { x: 10, y: 11 };
  const moved = transformedModuleRect(item, item.geometry!.modules[0]);
  assert.deepEqual(moved, { x: 360, y: 220, w: 80, d: 240 });
});

test('sectionals persist locally and forged module data fails closed', () => {
  const app = state(); app.current.furniture = [custom()];
  assert.deepEqual(readSavedRoom(JSON.stringify(app))?.current.furniture[0].geometry, U);
  const forged = structuredClone(app) as AppState; Object.assign(forged.current.furniture[0].geometry!.modules[0], { html: '<img onerror=alert(1)>' });
  assert.equal(readSavedRoom(JSON.stringify(forged)), null);
});

test('3D sectional primitives stay inside the exact envelope and disclose modules', () => {
  const item = custom(), group = buildFurniture(item, state().room); group.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
  assert.ok(size.x <= 4.000001 && size.z <= 2.400001 && size.y <= .850001, `${size.x},${size.y},${size.z}`);
  assert.equal(group.userData.sectional, true); assert.equal(group.userData.modules.length, 3); assert.match(group.userData.accessibleLabel, /CUSTOM SECTIONAL/);
});

test('native schema preserves rectangle compatibility and strictly discriminates sectionals', () => {
  const schema = TOOL_SCHEMAS.createCustomFurniture.inputSchema;
  const base = { proposalId: 'p', revision: 1, label: 'x', kind: 'table', widthCm: 40, depthCm: 40, heightCm: 40, positionCm: { xCm: 0, yCm: 0 }, rotation: 0, appearance: 'oak', idempotencyKey: 'k' };
  assert.equal(validateSchema(base, schema), null);
  assert.equal(validateSchema({ ...base, kind: 'sofa', widthCm: 400, depthCm: 240, heightCm: 85, geometry: U }, schema), null);
  assert.match(validateSchema({ ...base, kind: 'table', geometry: U }, schema) || '', /does not match/);
});

test('2D board exposes a dedicated continuous CUSTOM SECTIONAL renderer and module disclosure', () => {
  const source = readFileSync(new URL('./FloortrisApp.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('./floortris.css', import.meta.url), 'utf8');
  assert.match(source, /function SectionalShape/); assert.match(source, /CUSTOM SECTIONAL/); assert.match(source, /module\.widthCm/);
  assert.match(css, /\.ft-sectional-module/); assert.match(css, /\.ft-sectional-back/); assert.match(css, /\.ft-sectional-arm/);
});
