import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, fromVariant, makeDemo } from './data.ts';
import { bounds, validate, wallBand } from './engine.ts';
import { floorAreaM2, floorPlanError, planClipPath, rectInsideRoom, wallSegments } from './floorplan.ts';
import { clone, type FloorPlan, type Layout, type Room } from './model.ts';
import { furniturePose, buildRoomScene, disposeObject } from './scene3d.ts';
import { createStore } from './store.ts';
import { readSavedRoom } from './persistence.ts';

const lPlan: FloorPlan = { kind: 'rectilinear', points: [
  { xCm: 0, yCm: 0 }, { xCm: 500, yCm: 0 }, { xCm: 500, yCm: 300 },
  { xCm: 300, yCm: 300 }, { xCm: 300, yCm: 500 }, { xCm: 0, yCm: 500 },
] };
const lRoom = (): Room => ({ name: 'Measured L room', widthCm: 500, depthCm: 500, floorPlan: clone(lPlan), profile: { kind: 'lounge' }, openings: [{ id: 'entry', kind: 'door', wall: 'south', segmentId: 'wall-5', offsetCm: 20, widthCm: 100, hinge: 'start', swing: 'in', angle: 90, mechanism: 'hinged', entrance: true }], fixtures: [] });
const emptyLayout = (): Layout => ({ furniture: [], appearance: { wall: 'warm', floor: 'oak' } });

test('ordered rectilinear points derive a stable L-shaped floor and addressable wall segments', () => {
  const room = lRoom(), segments = wallSegments(room);
  assert.equal(floorPlanError(room.floorPlan, room.widthCm, room.depthCm), null);
  assert.equal(floorAreaM2(room), 21);
  assert.equal(planClipPath(room), 'polygon(0% 0%,100% 0%,100% 60%,60% 60%,60% 100%,0% 100%)');
  assert.deepEqual(segments.map(segment => [segment.id, segment.wall, segment.lengthCm]), [
    ['wall-1', 'north', 500], ['wall-2', 'east', 300], ['wall-3', 'south', 200],
    ['wall-4', 'east', 200], ['wall-5', 'south', 300], ['wall-6', 'west', 500],
  ]);
  assert.equal(floorPlanError({ kind: 'rectilinear', points: [{ xCm: 0, yCm: 0 }, { xCm: 500, yCm: 0 }, { xCm: 400, yCm: 300 }, { xCm: 0, yCm: 300 }] }, 500, 300), 'Custom floor-plan edges must be horizontal or vertical.');
  assert.match(floorPlanError(lPlan, 600, 500) || '', /bounding box/);
});

test('the missing corner is blocked floor, not usable furniture or walking space', () => {
  const room = lRoom(), inside = fromVariant('pebble-table-80', 'inside'), outside = fromVariant('pebble-table-80', 'outside');
  inside.originCell = { x: 3, y: 17 }; outside.originCell = { x: 18, y: 18 };
  assert.equal(rectInsideRoom(room, bounds(inside)), true);
  assert.equal(rectInsideRoom(room, bounds(outside)), false);
  const rules = { ...clone(DEFAULT_RULES), requiredKinds: [] }, report = validate({ ...emptyLayout(), furniture: [inside, outside] }, room, rules, []);
  assert.ok(report.issues.some(issue => issue.code === 'out_of_room' && issue.objectIds.includes(outside.id)));
  assert.ok(report.cells.filter(cell => cell.x >= 15 && cell.y >= 15).every(cell => cell.flags.includes('outside_floorplan') && cell.flags.includes('walk_blocked')));
});

test('entrances, wall bands and TV poses use the named inset or outer segment', () => {
  const room = lRoom(); room.openings = [{ id: 'nook-entry', kind: 'door', wall: 'south', segmentId: 'wall-3', offsetCm: 40, widthCm: 120, hinge: 'start', swing: 'in', angle: 90, mechanism: 'hinged', entrance: true }];
  assert.deepEqual(wallBand(room, 'south', 40, 120, 60, 'wall-3'), { x: 340, y: 240, w: 120, d: 60 });
  const report = validate(emptyLayout(), room, { ...clone(DEFAULT_RULES), requiredKinds: [] }, []);
  assert.ok(!report.issues.some(issue => issue.code === 'path_broken' && issue.objectIds.includes('nook-entry')), JSON.stringify(report.issues));
  const tv = fromVariant('frame-tv-120', 'nook-tv'); tv.wallAnchor = { wall: 'east', segmentId: 'wall-4', offsetCm: 20 }; tv.elevationCm = 95;
  const pose = furniturePose(tv, room);
  assert.equal(pose.x, (300 - tv.sizeCm.d / 2) / 100); assert.equal(pose.z, 3.8); assert.equal(pose.y, .95);
});

test('custom floor and six independent walls reach the 3D scene without changing the document', () => {
  const room = lRoom(), before = clone(room), scene = buildRoomScene(room, emptyLayout(), DEFAULT_RULES);
  assert.equal(scene.walls.size, 6);
  assert.ok(scene.walls.has('wall-3') && scene.walls.has('wall-5'));
  assert.deepEqual(room, before);
  disposeObject(scene.root);
});

test('an agent can generate, read and persist an L-shaped proposal; ambiguous custom openings are rejected', async () => {
  const store = createStore(makeDemo()), prior = clone(store.getState());
  const args = { name: 'Agent L', widthCm: 500, depthCm: 500, floorPlan: clone(lPlan), profile: { kind: 'lounge' as const }, openings: clone(lRoom().openings), idempotencyKey: 'custom-l-room' };
  const generated = await store.execute('generateRoom', args);
  assert.equal(generated.operationSucceeded, true, generated.error?.message);
  assert.equal(generated.generatedRoom, true); assert.equal((generated.review as { requiresHumanApply?: boolean } | undefined)?.requiresHumanApply, true);
  assert.equal(store.getState().proposal?.room.floorPlan?.points.length, 6);
  const read = await store.execute('getRoomState', { which: 'proposal' });
  assert.deepEqual((read.wallSegments as { id: string }[]).map(segment => segment.id), ['wall-1', 'wall-2', 'wall-3', 'wall-4', 'wall-5', 'wall-6']);
  assert.deepEqual(readSavedRoom(JSON.stringify(store.getState())), store.getState());

  const ambiguousOpening: Partial<(typeof args.openings)[number]> = { ...args.openings[0] }; delete ambiguousOpening.segmentId;
  const rejectedStore = createStore(prior), invalid = await rejectedStore.execute('generateRoom', { ...args, openings: [ambiguousOpening], idempotencyKey: 'missing-segment' });
  assert.equal(invalid.operationSucceeded, false); assert.equal(invalid.error?.code, 'invalid_room_inputs');
  assert.deepEqual(rejectedStore.getState(), prior);
});
