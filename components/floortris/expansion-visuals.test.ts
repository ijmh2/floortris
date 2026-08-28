import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Mesh } from 'three';
import { CATALOGUE, fromVariant, makeDemo } from './data.ts';
import { bounds, validate } from './engine.ts';
import { buildFurniture, disposeObject } from './scene3d.ts';
import { clone, rotations, type Furniture } from './model.ts';

test('every named bed has a recognisable 3D model inside its exact measured envelope', () => {
  const beds = CATALOGUE.filter(v => v.kind === 'bed');
  assert.ok(beds.length >= 3, 'single, double and king variants must be present');
  const room = makeDemo().room;
  for (const v of beds) for (const rotation of rotations) {
    const item = fromVariant(v.id, `test-${v.id}`);
    item.originCell = { x: 7, y: 8 }; item.rotation = rotation;
    const before = clone(item), mesh = buildFurniture(item, room), b = bounds(item), box = new Box3().setFromObject(mesh);
    let partCount = 0; mesh.traverse(o => { if (o instanceof Mesh) partCount++; });
    assert.ok(partCount >= 5, `${v.id}: bed needs distinct frame, headboard and bedding parts`);
    const epsilon = .003;
    assert.ok(box.min.x >= b.x / 100 - epsilon && box.max.x <= (b.x + b.w) / 100 + epsilon, `${v.id}/${rotation}: X envelope`);
    assert.ok(box.min.z >= b.y / 100 - epsilon && box.max.z <= (b.y + b.d) / 100 + epsilon, `${v.id}/${rotation}: Z envelope`);
    assert.ok(box.min.y >= -epsilon && box.max.y <= item.sizeCm.h! / 100 + epsilon, `${v.id}/${rotation}: height envelope`);
    assert.ok(box.max.y >= item.sizeCm.h! / 100 * .85, `${v.id}: headboard should express the measured height`);
    assert.deepEqual(item, before, 'rendering must not rewrite furniture');
    disposeObject(mesh);
  }
});

test('bed appearance and renderer never alter engine flags or measured dimensions', () => {
  const sample = makeDemo(), v = CATALOGUE.find(v => v.kind === 'bed');
  assert.ok(v);
  const bed = fromVariant(v.id, 'visual-bed'); bed.originCell = { x: 10, y: 3 };
  const layout = { furniture: [bed], appearance: clone(sample.current.appearance) };
  const first = validate(layout, sample.room, sample.rules, []), before = clone(layout);
  const mesh = buildFurniture(bed, sample.room); disposeObject(mesh);
  assert.deepEqual(layout, before);
  bed.appearance = 'clay';
  const second = validate(layout, sample.room, sample.rules, []);
  assert.deepEqual(second.cells, first.cells);
  assert.deepEqual(second.validation, first.validation);
  assert.deepEqual(bed.sizeCm, v.sizeCm);
});

test('bathroom concept meshes fit their declared envelope at every rotation, including tray-only height', () => {
  const s = makeDemo();
  const concepts = [
    ['basin', 60, 45, 85], ['basin', 80, 50, 85], ['toilet', 40, 65, 80],
    ['shower', 90, 90, 5], ['bath', 170, 75, 55], ['towel_rail', 50, 10, 100],
  ] as const;
  for (const [kind, w, d, h] of concepts) for (const rotation of rotations) {
    const item: Furniture = { ...clone(s.inventory[0]), id: `concept-${kind}`, kind: kind as Furniture['kind'], ownership: 'fixed', sizeCm: { w, d, h }, rotation, originCell: { x: 4, y: 5 } };
    const mesh = buildFurniture(item, s.room), b = bounds(item), box = new Box3().setFromObject(mesh), epsilon = .003;
    let parts = 0; mesh.traverse(o => { if (o instanceof Mesh) parts++; });
    assert.ok(parts >= 4, `${kind}: dedicated fixture representation`);
    assert.ok(box.min.x >= b.x / 100 - epsilon && box.max.x <= (b.x + b.w) / 100 + epsilon, `${kind}/${rotation}: X`);
    assert.ok(box.min.z >= b.y / 100 - epsilon && box.max.z <= (b.y + b.d) / 100 + epsilon, `${kind}/${rotation}: Z`);
    assert.ok(box.min.y >= -epsilon && box.max.y <= h / 100 + epsilon, `${kind}/${rotation}: height`);
    if (kind === 'shower') assert.ok(box.max.y <= .053, 'no invented tall glass around a 5 cm tray');
    disposeObject(mesh);
  }
});
