import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as THREE from 'three';
import { PALETTES } from './data.ts';
import { createStore } from './store.ts';
import { makeCompactRoom } from './samples.ts';
import { validate } from './engine.ts';
import { readSavedRoom } from './persistence.ts';
import { finishMaterial, mapFinishUV, type TextureOptions } from './finish-material.ts';
import { buildRoomScene, disposeObject } from './scene3d.ts';
import FinishPicker from './FinishPicker.tsx';

const textures = [...PALETTES.wall, ...PALETTES.floor].filter(f => f.texture);
const revision = (store: ReturnType<typeof createStore>) => {
  const p = store.getState().proposal!;
  return { proposalId: p.id, revision: p.revision };
};
const report = (store: ReturnType<typeof createStore>) => {
  const s = store.getState(), p = s.proposal!;
  return validate(p.layout, p.room, p.rules, s.inventory);
};

test('six named concept textures ship as local WebP assets and are discoverable without furniture filters', async () => {
  assert.equal(textures.length, 6);
  assert.equal(new Set(textures.map(f => f.id)).size, 6);
  const store = createStore(makeCompactRoom()), before = structuredClone(store.getState());
  const result = await store.execute('listCatalogue', { profile: 'bedroom', tag: 'single', limit: 1 });
  assert.deepEqual(result.palettes, PALETTES);
  assert.deepEqual(store.getState(), before);
  for (const f of textures) {
    assert.equal(f.pack, 'studio-01'); assert.equal(f.conceptOnly, true);
    assert.ok(f.description && f.tags?.length);
    assert.match(f.texture!.url, /^\/textures\/[a-z-]+\.webp$/);
    assert.ok(f.texture!.repeatCm.every(n => n > 0));
    const bytes = readFileSync(new URL('../../public' + f.texture!.url, import.meta.url));
    assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), 'RIFF');
    assert.equal(new TextDecoder().decode(bytes.subarray(8, 12)), 'WEBP');
    assert.ok(bytes.length < 400_000);
  }
});

test('human and native texture edits have identical appearance, revisions and complete rule reports', async () => {
  const human = createStore(makeCompactRoom()), agent = createStore(makeCompactRoom());
  const before = structuredClone(agent.getState()), originalReport = report(agent);
  for (const target of ['wall', 'floor'] as const) for (const finish of PALETTES[target].filter(f => f.texture)) {
    assert.equal(human.humanSetRoomFinish('proposal', target, finish.id).operationSucceeded, true);
    const result = await agent.execute('setAppearance', { ...revision(agent), target, paletteId: finish.id });
    assert.equal(result.operationSucceeded, true);
    assert.deepEqual(result.appearance, agent.getState().proposal!.layout.appearance);
    assert.deepEqual(agent.getState().proposal!.layout, human.getState().proposal!.layout);
    assert.equal(agent.getState().proposal!.revision, human.getState().proposal!.revision);
    assert.deepEqual(report(agent), originalReport);
    assert.deepEqual(agent.getState().current, before.current);
    assert.deepEqual(agent.getState().room, before.room);
    assert.deepEqual(agent.getState().inventory, before.inventory);
  }
  const snap = await agent.execute('getRoomState', { which: 'proposal' });
  assert.deepEqual(snap.appearance, { wall: 'woven-linen', floor: 'warm-terrazzo' });
  assert.deepEqual((await agent.execute('getRoomState', { which: 'current' })).appearance, before.current.appearance);
  const saved = readSavedRoom(JSON.stringify(agent.getState()));
  assert.ok(saved);
  assert.deepEqual(createStore(saved).getState().proposal!.layout.appearance, snap.appearance);
});

test('wrong target, unknown texture and stale appearance writes never mutate a room', async () => {
  const store = createStore(makeCompactRoom());
  for (const [target, paletteId] of [['wall', 'pale-oak'], ['floor', 'sage-botanical'], ['furniture', 'woven-linen'], ['wall', 'https://external.example/texture']]) {
    const before = structuredClone(store.getState());
    assert.equal((await store.execute('setAppearance', { ...revision(store), target, paletteId })).error?.code, target === 'furniture' ? 'invalid_arguments' : 'invalid_palette');
    assert.deepEqual(store.getState(), before);
  }
  const stale = revision(store);
  assert.equal(store.humanSetRoomFinish('proposal', 'wall', 'sage-botanical').operationSucceeded, true);
  const after = structuredClone(store.getState());
  assert.equal((await store.execute('setAppearance', { ...stale, target: 'floor', paletteId: 'pale-oak' })).error?.code, 'revision_conflict');
  assert.deepEqual(store.getState(), after);
});

test('generateRoom accepts the same named textures and still leaves Apply to the human', async () => {
  const store = createStore();
  const result = await store.execute('generateRoom', {
    name: 'Textured bedroom', widthCm: 300, depthCm: 450,
    profile: { kind: 'bedroom', sleeping: 'single', workspace: false, storage: false, bedsideQuantity: 0 },
    openings: [{ id: 'door', kind: 'door', wall: 'south', offsetCm: 20, widthCm: 80, hinge: 'start', swing: 'in', angle: 90, mechanism: 'hinged', entrance: true }],
    appearance: { wall: 'blue-gingham', floor: 'pale-oak' }, idempotencyKey: 'texture-generation',
  });
  assert.equal(result.operationSucceeded, true, JSON.stringify(result));
  assert.deepEqual(result.appearance, { wall: 'blue-gingham', floor: 'pale-oak' });
  assert.equal(store.getState().current.furniture.length, 0);
  assert.ok(store.getState().proposal!.layout.furniture.length > 0);
});

test('texture cards expose named selected and disabled controls for every finish', () => {
  for (const target of ['wall', 'floor'] as const) {
    const finish = PALETTES[target].find(f => f.texture)!;
    const markup = renderToStaticMarkup(React.createElement(FinishPicker, { target, value: finish.id, disabled: true, onChange: () => {} }));
    for (const f of PALETTES[target]) assert.ok(markup.includes(`Set ${f.name} ${target} finish`));
    assert.equal((markup.match(/aria-pressed="true"/g) || []).length, 1);
    assert.equal((markup.match(/disabled=""/g) || []).length, PALETTES[target].length);
    assert.ok(markup.includes(finish.texture!.url));
  }
});

function fakeLoader() {
  const texture = new THREE.Texture();
  let loaded!: (map: THREE.Texture) => void, failed!: () => void, disposed = 0, rendered = 0, errors = 0;
  texture.addEventListener('dispose', () => disposed++);
  const options: TextureOptions = {
    loadTexture: (_url, onLoad, onError) => { loaded = onLoad; failed = onError; return texture; },
    onTextureLoad: () => rendered++, onTextureError: () => errors++,
  };
  return { texture, options, load: () => loaded(texture), fail: () => failed(), counts: () => ({ disposed, rendered, errors }) };
}

test('3D textures use physical repeats and neutral image colour, and dispose their GPU maps', () => {
  const f = textures[0], loader = fakeLoader(), material = finishMaterial(f, loader.options);
  assert.equal(material.map, null); assert.equal(material.color.getHexString(), f.color.slice(1));
  loader.load();
  assert.equal(material.map, loader.texture);
  assert.equal(material.color.getHexString(), 'ffffff');
  assert.equal(loader.texture.colorSpace, THREE.SRGBColorSpace);
  assert.equal(loader.texture.wrapS, THREE.MirroredRepeatWrapping);
  assert.deepEqual(loader.texture.repeat.toArray(), f.texture!.repeatCm.map(n => 100 / n));
  material.dispose(); loader.load(); loader.fail();
  assert.deepEqual(loader.counts(), { disposed: 1, rendered: 1, errors: 0 });
});

test('failed or late image loads keep the base colour and never update a retired scene', () => {
  const f = textures[0], loader = fakeLoader(), material = finishMaterial(f, loader.options);
  loader.fail();
  assert.equal(material.map, null);
  assert.equal(material.color.getHexString(), f.color.slice(1));
  assert.deepEqual(loader.counts(), { disposed: 0, rendered: 0, errors: 1 });
  material.dispose(); loader.load(); loader.fail();
  assert.deepEqual(loader.counts(), { disposed: 1, rendered: 0, errors: 1 });
});

test('UV scale and phase use world metres rather than stretching each wall segment', () => {
  for (const plane of ['floor', 'north-south', 'east-west'] as const) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 3), new THREE.MeshStandardMaterial());
    mesh.position.set(4, 1.5, 6); mapFinishUV(mesh, plane);
    const pos = mesh.geometry.getAttribute('position'), uv = mesh.geometry.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) {
      assert.equal(uv.getX(i), plane === 'east-west' ? pos.getZ(i) + 6 : pos.getX(i) + 4);
      assert.equal(uv.getY(i), plane === 'floor' ? pos.getZ(i) + 6 : pos.getY(i) + 1.5);
    }
    disposeObject(mesh);
  }
});

test('full scene shares one texture per finish across wall openings and leaves document and rules untouched', () => {
  const state = makeCompactRoom(), p = state.proposal!;
  p.layout.appearance = { wall: 'sage-botanical', floor: 'warm-terrazzo' };
  const before = structuredClone(state), beforeReport = validate(p.layout, p.room, p.rules, state.inventory);
  const loaders: ReturnType<typeof fakeLoader>[] = [];
  const model = buildRoomScene(p.room, p.layout, p.rules, {
    loadTexture: (url, loaded, failed) => { const loader = fakeLoader(); loaders.push(loader); return loader.options.loadTexture!(url, loaded, failed); },
  });
  assert.equal(loaders.length, 2);
  const wallMaterials = new Set<THREE.Material>();
  for (const wall of model.walls.values()) wall.traverse(o => {
    if (o instanceof THREE.Mesh && o.material instanceof THREE.Material && o.material.userData.finishId === 'sage-botanical') wallMaterials.add(o.material);
  });
  assert.equal(wallMaterials.size, 1);
  disposeObject(model.root);
  assert.ok(loaders.every(l => l.counts().disposed === 1));
  assert.deepEqual(state, before);
  assert.deepEqual(validate(p.layout, p.room, p.rules, state.inventory), beforeReport);
});
