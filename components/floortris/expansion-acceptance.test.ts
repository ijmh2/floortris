import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOGUE, DEFAULT_RULES, fromVariant, makeDemo } from './data.ts';
import { validate } from './engine.ts';
import { clone } from './model.ts';
import { makeBedroomSingle, makeBedroomDouble, makeHomeOffice, makeBathroomConcept, roomSession } from './samples.ts';
import { createStore, migrateState } from './store.ts';

const factories = [makeBedroomSingle, makeBedroomDouble, makeHomeOffice, makeBathroomConcept];

test('new presets are valid and complete without weakening hard walking width', () => {
  for (const factory of factories) {
    const state = factory(), p = state.proposal!;
    const report = validate(p.layout, p.room, p.rules, state.inventory);
    assert.equal(report.validation.hardFailures, 0, state.room.name + JSON.stringify(report.issues));
    assert.equal(report.brief.status, 'satisfied', state.room.name + JSON.stringify(report.brief));
    assert.equal(p.rules.walkHardCm, DEFAULT_RULES.walkHardCm);
    assert.equal(state.current.furniture.length, 0, 'preset furniture waits for Apply');
    assert.ok(!p.rules.requiredKinds.includes('sofa') && !p.rules.requiredKinds.includes('tv'));
    assert.equal(new Set(p.layout.furniture.map(f => f.id)).size, p.layout.furniture.length);
  }
});

test('preset creation, store freezing and role tags never mutate the catalogue', () => {
  const before = clone(CATALOGUE);
  for (let i = 0; i < 3; i++) for (const factory of factories) createStore(factory());
  const item = fromVariant('nook-bedside-40', 'tag-test'); item.tags.push('human-label');
  assert.deepEqual(CATALOGUE, before);
  assert.ok(!fromVariant('nook-bedside-40', 'another').tags.includes('human-label'));
});

test('all presets have isolated persistence and legacy storage keys are unchanged', () => {
  const ids = ['', '3m', 'bedroom-single', 'bedroom-double', 'office', 'bathroom'];
  const sessions = ids.map(id => roomSession(id ? '?sample=' + id : ''));
  assert.equal(new Set(sessions.map(s => s.storageKey)).size, ids.length);
  assert.equal(sessions[0].storageKey, 'floortris.v1.local');
  assert.equal(sessions[1].storageKey, 'floortris.v1.sample.3m');
  assert.equal(roomSession('?sample=unrecognised').storageKey, sessions[0].storageKey);
});

test('legacy migration preserves measured data and stale authority tokens', () => {
  const legacy = makeDemo(); legacy.version = 1; delete legacy.room.profile;
  legacy.proposal = { id: 'legacy-draft', kind: 'layout', revision: 7, baseCurrentRevision: 1, baseRuleRevision: 1, room: clone(legacy.room), rules: clone(legacy.rules), layout: clone(legacy.current), omitted: [] };
  legacy.currentRevision = 4;
  const before = clone(legacy), upgraded = migrateState(legacy);
  assert.deepEqual(legacy, before);
  assert.deepEqual(upgraded.current, before.current);
  assert.deepEqual(upgraded.inventory, before.inventory);
  assert.deepEqual(upgraded.room.fixtures, before.room.fixtures);
  assert.deepEqual(upgraded.room.openings, before.room.openings);
  assert.equal(upgraded.currentRevision, 4);
  assert.equal(upgraded.proposal!.id, 'legacy-draft');
  assert.equal(upgraded.proposal!.revision, 7);
  assert.equal(upgraded.proposal!.baseCurrentRevision, 1);
  assert.equal(upgraded.room.profile?.kind, 'lounge');
});

test('nightstands cannot satisfy wardrobe requirement; single bed cannot satisfy double brief', () => {
  const state = makeBedroomDouble(), p = clone(state.proposal!);
  p.layout.furniture = p.layout.furniture.filter(f => !f.tags.includes('wardrobe'));
  assert.equal(p.layout.furniture.filter(f => f.tags.includes('bedside')).length, 2);
  assert.equal(validate(p.layout, p.room, p.rules, state.inventory).brief.status, 'incomplete');
  const other = clone(state.proposal!);
  other.layout.furniture = other.layout.furniture.map(f => f.kind === 'bed' ? { ...fromVariant('haven-single-100', f.id), originCell: f.originCell, rotation: f.rotation } : f);
  assert.equal(validate(other.layout, other.room, other.rules, state.inventory).brief.status, 'incomplete');
});

test('office chair must link to the desk to complete the brief', () => {
  const s = makeHomeOffice(), p = clone(s.proposal!);
  delete p.layout.furniture.find(f => f.kind === 'chair')!.linkedDeskId;
  const report = validate(p.layout, p.room, p.rules, s.inventory);
  assert.equal(report.brief.status, 'incomplete');
  assert.ok(report.issues.some(i => i.code === 'desk_chair_missing' && i.severity === 'block'));
});

test('bathroom fixed fixtures fulfil the brief and native reads disclose concept limitations', async () => {
  const state = makeBathroomConcept(), p = state.proposal!, store = createStore(state);
  const report = validate(p.layout, p.room, p.rules, state.inventory);
  assert.equal(report.conceptualOnly, true);
  assert.equal(report.brief.status, 'satisfied');
  assert.equal(p.layout.furniture.some(f => ['basin','toilet','shower','bath'].includes(f.kind)), false);
  const before = clone(store.getState());
  for (const name of ['getRoomState', 'listFurniture', 'checkLayout']) {
    const r = await store.execute(name, { which: 'proposal' });
    assert.equal(r.operationSucceeded, true); assert.equal(r.conceptualOnly, true, name);
  }
  for (const f of state.room.fixtures) {
    const update = await store.execute('updateFurniture', { proposalId: p.id, revision: p.revision, objectId: f.id, originCell: { x: 1, y: 1 } });
    assert.equal(update.operationSucceeded, false);
    const remove = await store.execute('removeFurniture', { proposalId: p.id, revision: p.revision, objectId: f.id });
    assert.equal(remove.operationSucceeded, false);
  }
  assert.deepEqual(store.getState(), before);
});
