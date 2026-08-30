import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Box3, Mesh } from 'three';
import { CATALOGUE, fromVariant, makeDemo } from './data.ts';
import { FORM_PARTS, type Form } from './forms.ts';
import { TOOL_SCHEMAS } from './schemas.ts';
import { bounds, validate } from './engine.ts';
import { buildFurniture, disposeObject } from './scene3d.ts';
import { clone, rotations, type Furniture } from './model.ts';

const used = [...new Set(CATALOGUE.map(v => v.form).filter(Boolean) as Form[])];
const css = readFileSync(new URL('./floortris.css', import.meta.url), 'utf8');
/** Structural fingerprint of a built piece: enough to tell two treatments apart
 *  without pinning any coordinate, so geometry can be retuned freely. */
function digest(item: Furniture): string {
  const mesh = buildFurniture(item, makeDemo().room), parts: string[] = [];
  mesh.traverse(o => { if (o instanceof Mesh) parts.push(`${o.geometry.type}:${o.position.toArray().map(n => n.toFixed(4))}:${o.scale.toArray().map(n => n.toFixed(3))}:${(o.geometry.getAttribute('position')?.count ?? 0)}`); });
  disposeObject(mesh);
  return parts.sort().join('|');
}

test('every form the catalogue names is one both renderers actually handle', () => {
  assert.ok(used.length >= 15, 'the form vocabulary should cover the crowded kinds');
  for (const form of used) {
    assert.ok(form in FORM_PARTS, `${form}: no 2D part count in forms.ts`);
    assert.ok(css.includes(`.ft-form-${form}`), `${form}: no .ft-form-${form} rule in floortris.css`);
    const v = CATALOGUE.find(v => v.form === form)!;
    const item = fromVariant(v.id, `form-${v.id}`), fallback = { ...clone(item), variantId: undefined };
    assert.notEqual(digest(item), digest(fallback), `${form}: 3D falls back to the plain ${v.kind} shape, so the form does nothing`);
  }
});

test('a variant without a form, and any measured piece, keeps the kind shape', () => {
  const plain = CATALOGUE.find(v => v.kind === 'storage' && !v.form)!;
  const item = fromVariant(plain.id, 'plain-storage');
  assert.equal(digest(item), digest({ ...clone(item), variantId: undefined }));
  const owned = { ...clone(makeDemo().inventory[0]), kind: 'storage' as const, sizeCm: { w: 80, d: 40, h: 100 } };
  assert.equal(owned.variantId, undefined);
  assert.ok(digest(owned).length > 0);
});

test('every catalogue piece models itself inside its measured envelope at every rotation', () => {
  const room = makeDemo().room, epsilon = .003;
  for (const v of CATALOGUE) {
    if (v.kind === 'tv') continue; // Wall anchored: engine.test.ts pins its exact metres.
    for (const rotation of rotations) {
      const item = fromVariant(v.id, `fit-${v.id}`);
      item.originCell = { x: 6, y: 7 }; item.rotation = rotation;
      const before = clone(item), mesh = buildFurniture(item, room), b = bounds(item), box = new Box3().setFromObject(mesh);
      let parts = 0; mesh.traverse(o => { if (o instanceof Mesh) parts++; });
      assert.ok(parts >= 3, `${v.id}: too few parts to read as furniture`);
      assert.ok(box.min.x >= b.x / 100 - epsilon && box.max.x <= (b.x + b.w) / 100 + epsilon, `${v.id}/${rotation}: X envelope`);
      assert.ok(box.min.z >= b.y / 100 - epsilon && box.max.z <= (b.y + b.d) / 100 + epsilon, `${v.id}/${rotation}: Z envelope`);
      assert.ok(box.min.y >= -epsilon && box.max.y <= v.sizeCm.h! / 100 + epsilon, `${v.id}/${rotation}: height envelope`);
      assert.deepEqual(item, before, `${v.id}: rendering must not rewrite furniture`);
      disposeObject(mesh);
    }
  }
});

test('a form is a catalogue-only visual: it never reaches the document, the engine or a tool schema', () => {
  for (const v of CATALOGUE) assert.ok(!('form' in fromVariant(v.id, `doc-${v.id}`)), `${v.id}: form leaked into the placed piece`);
  const kinds = (TOOL_SCHEMAS.listCatalogue.inputSchema.properties!.kind.enum || []) as string[];
  for (const form of used) assert.ok(!kinds.includes(form), `${form}: forms must stay out of the agent-facing kind enum`);
  const sample = makeDemo(), variant = CATALOGUE.find(v => v.form === 'wardrobe')!;
  const piece = fromVariant(variant.id, 'formed-piece'); piece.originCell = { x: 4, y: 4 };
  const layout = { furniture: [piece], appearance: clone(sample.current.appearance) };
  const first = validate(layout, sample.room, sample.rules, []), shape = digest(piece), original = variant.form;
  variant.form = 'basket';
  try {
    const second = validate(layout, sample.room, sample.rules, []);
    assert.deepEqual(second.cells, first.cells);
    assert.deepEqual(second.validation, first.validation);
    assert.notEqual(digest(piece), shape, 'the form should still be the only thing that changed');
  } finally { variant.form = original; }
});
