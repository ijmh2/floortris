import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCompactRoom } from './samples.ts';
import { createStore, proposalStatus } from './store.ts';
import { clone, type Wall } from './model.ts';
import { bounds, validate } from './engine.ts';
import { radiatorMeasures, radiatorOnWall, roomEditStamp, validateRoomInputs } from './room-inputs.ts';

test('history is session-only, bounded, atomic and clears redo on a new edit', () => {
  const store = createStore();
  assert.equal(store.getHistory().canUndo, false);
  const before = clone(store.getState());
  store.humanAdd('current', 'fern-40');
  const added = clone(store.getState());
  assert.equal(store.getHistory().undoCount, 1);
  assert.equal(store.undo().operationSucceeded, true);
  assert.deepEqual(store.getState().current, before.current);
  assert.ok(store.getState().currentRevision > added.currentRevision);
  assert.ok(store.getState().ruleRevision > added.ruleRevision);
  store.redo(); assert.deepEqual(store.getState().current, added.current);
  store.undo(); store.humanAdd('current', 'fern-40');
  assert.equal(store.getHistory().canRedo, false);
  for (let i = 0; i < 60; i++) store.humanSetRequired('owned-sofa', i % 2 === 0);
  assert.equal(store.getHistory().undoCount, 50);
  assert.equal(createStore(store.getState()).getHistory().canUndo, false);
});

test('undo restores owned lock authority and measurements together', () => {
  const store = createStore(), before = clone(store.getState());
  store.humanSetLocks('owned-sofa', {});
  store.humanMeasureOwned('owned-sofa', { w: 200, d: 80, h: 90 });
  store.undo(); store.undo();
  assert.deepEqual(store.getState().inventory, before.inventory);
  assert.deepEqual(store.getState().current, before.current);
  assert.equal(store.humanUpdate('current', 'owned-sofa', { originCell: { x: 0, y: 0 } }).error?.code, 'lock_violation');
});

test('undo Apply restores the review draft with new authority; captured Apply and agent edits fail', async () => {
  const store = createStore(makeCompactRoom()), before = clone(store.getState()), p = before.proposal!;
  assert.equal(store.applyProposal(p.id, p.revision).operationSucceeded, true);
  store.undo();
  const restored = store.getState().proposal!;
  assert.deepEqual(store.getState().current, before.current);
  assert.deepEqual(restored.layout, p.layout);
  assert.notEqual(restored.id, p.id);
  assert.equal(proposalStatus(store.getState()), 'ready_for_review');
  assert.equal(store.applyProposal(p.id, p.revision).operationSucceeded, false);
  assert.equal((await store.execute('setAppearance', { proposalId: p.id, revision: p.revision, target: 'wall', paletteId: 'chalk' })).operationSucceeded, false);
  store.redo(); assert.equal(store.getState().proposal, null);
  assert.deepEqual(store.getState().current, p.layout);
});

test('history restores independent drafts; human edits on Yours do not freeze them', () => {
  const store = createStore(makeCompactRoom());
  store.humanAdd('current', 'fern-40'); store.discardProposal(); store.undo();
  assert.equal(proposalStatus(store.getState()), 'ready_for_review');
  assert.equal(store.humanAdd('proposal', 'fern-40').operationSucceeded, true);
  assert.equal(store.humanSetRoomFinish('proposal', 'wall', 'stone').operationSucceeded, true);
  store.undo(); assert.notEqual(proposalStatus(store.getState()), 'none');
});

test('Apply reconciles overlapping branch edits explicitly and preserves the selected result', () => {
  const store = createStore(makeCompactRoom());
  assert.equal(store.humanSetRoomFinish('current', 'wall', 'stone').operationSucceeded, true);
  assert.equal(store.humanSetRoomFinish('proposal', 'wall', 'cream').operationSucceeded, true);
  const changed = store.getState().proposal!;
  const required = store.applyProposal(changed.id, changed.revision);
  assert.equal(required.error?.code, 'reconciliation_required');
  assert.ok((required.conflicts as { key: string }[]).some(conflict => conflict.key === 'appearance:wall'));
  const applied = store.applyProposal(changed.id, changed.revision, { 'appearance:wall': 'proposal' });
  assert.equal(applied.operationSucceeded, true);
  assert.equal(store.getState().current.appearance.wall, 'cream');
});

test('undo invalidates cached idempotency results and checked candidates', async () => {
  const store = createStore(makeCompactRoom()), p = store.getState().proposal!;
  const checked = await store.execute('findPlacements', { proposalId: p.id, revision: p.revision, variantId: 'weave-mat-80', limit: 1 });
  const args = { proposalId: p.id, revision: p.revision, candidateId: (checked.candidates as {candidateId:string}[])[0].candidateId, idempotencyKey: 'placed-before-undo' };
  assert.equal((await store.execute('placeFurniture', args)).operationSucceeded, true);
  store.undo();
  assert.equal((await store.execute('placeFurniture', args)).operationSucceeded, false);
  const next = store.getState().proposal!;
  const objectId = next.layout.furniture.find(f => f.kind === 'tv')!.id;
  const result = await store.execute('findPlacements', { proposalId: next.id, revision: next.revision, objectId, limit: 1 });
  const candidates = result.candidates as { candidateId: string }[];
  assert.ok(candidates.length);
  store.humanAdd('proposal', 'fern-40'); store.undo();
  const restored = store.getState().proposal!;
  assert.equal((await store.execute('updateFurniture', { proposalId: restored.id, revision: restored.revision, objectId, candidateId: candidates[0].candidateId })).operationSucceeded, false);
});

test('an in-flight planner cannot commit across reset or undo', async () => {
  const store = createStore(makeCompactRoom()), p = store.getState().proposal!;
  const pending = store.execute('findPlacements', { proposalId: p.id, revision: p.revision, variantId: 'fern-40', limit: 8 });
  store.resetDemo(makeCompactRoom());
  const after = clone(store.getState());
  assert.equal((await pending).error?.code, 'proposal_not_found');
  assert.deepEqual(store.getState(), after);
});

test('radiators preserve exact measured footprints on all four walls', () => {
  const s = makeCompactRoom(), fixture = s.room.fixtures[0];
  const expected = { north: { x: 35, y: 0, w: 91, d: 17 }, south: { x: 35, y: 283, w: 91, d: 17 }, east: { x: 283, y: 35, w: 17, d: 91 }, west: { x: 0, y: 35, w: 17, d: 91 } };
  for (const wall of Object.keys(expected) as Wall[]) {
    const f = radiatorOnWall(fixture, s.room, wall, 35, 91, 17, 63);
    assert.deepEqual(bounds(f), expected[wall]);
    assert.deepEqual(radiatorMeasures(f), { width: 91, depth: 17 });
    assert.equal(f.sizeCm.h, 63); assert.equal(f.ownership, 'fixed');
    assert.equal(validateRoomInputs({ ...s.room, fixtures: [f] }, s.rules), null);
  }
});

test('human room edits stage additions, removals, pins and fixture changes in one reversible transaction', () => {
  const store = createStore(makeCompactRoom()), before = clone(store.getState()), room = clone(before.room);
  room.openings = room.openings.filter(o => o.kind === 'door');
  room.openingLocks = [room.openings[0].id];
  room.fixtures = [radiatorOnWall(room.fixtures[0], room, 'north', 30, 100, 15, 70)];
  const stamp = roomEditStamp(before);
  assert.equal(store.humanStageRoom(room, before.rules, stamp).operationSucceeded, false);
  assert.deepEqual(store.getState(), before);
  assert.equal(store.humanStageRoom(room, before.rules, stamp, true).operationSucceeded, true);
  assert.equal(store.getHistory().undoCount, 1);
  assert.deepEqual(store.getState().room, before.room);
  assert.deepEqual(store.getState().proposal!.room, room);
  const p = store.getState().proposal!;
  assert.equal(store.confirmSetup(p.id, p.revision).operationSucceeded, true);
  assert.deepEqual(store.getState().room, room);
  assert.deepEqual(store.getState().current, before.current);
  store.undo(); assert.deepEqual(store.getState().room, before.room);
  assert.equal(store.getState().proposal!.kind, 'setup');
  store.undo(); assert.equal(store.getState().proposal!.kind, 'layout');
  assert.deepEqual(store.getState().proposal!.layout, before.proposal!.layout);
});

test('stale editor input and invalid measured input publish nothing', () => {
  const store = createStore(), before = clone(store.getState()), stamp = roomEditStamp(before);
  const bad = clone(before.room); bad.openings[0].offsetCm = 9999;
  assert.equal(store.humanStageRoom(bad, before.rules, stamp).operationSucceeded, false);
  assert.deepEqual(store.getState(), before);
  assert.equal(store.getHistory().canUndo, false);
  store.humanAdd('current', 'fern-40'); const current = clone(store.getState());
  assert.equal(store.humanStageRoom(before.room, before.rules, stamp).error?.code, 'revision_conflict');
  assert.deepEqual(store.getState(), current);
});

test('accepted pins cannot be changed by native setup tools; human unpin is staged', async () => {
  const initial = makeCompactRoom(); initial.proposal = null;
  initial.room.openingLocks = [initial.room.openings[0].id];
  const store = createStore(initial);
  await store.execute('createProposal', { kind: 'setup', expectedCurrentRevision: initial.currentRevision, expectedRuleRevision: initial.ruleRevision, idempotencyKey: 'setup-pins' });
  const p = store.getState().proposal!, opening = { ...initial.room.openings[0], offsetCm: 20 };
  assert.equal((await store.execute('setOpening', { proposalId: p.id, revision: p.revision, opening })).error?.code, 'lock_violation');
  const room = clone(initial.room); room.openingLocks = [];
  assert.equal(store.humanStageRoom(room, initial.rules, roomEditStamp(store.getState())).operationSucceeded, true);
  const staged = store.getState().proposal!;
  assert.equal((await store.execute('setOpening', { proposalId: staged.id, revision: staged.revision, opening })).error?.code, 'lock_violation');
  store.confirmSetup(staged.id, staged.revision);
  assert.deepEqual(store.getState().room.openingLocks, []);
});

test('room validation rejects malformed geometry without treating furniture conflicts as measurement errors', () => {
  const s = makeCompactRoom();
  assert.equal(validateRoomInputs(s.room, s.rules), null);
  for (const widthCm of [NaN, Infinity, 0, 1200]) assert.ok(validateRoomInputs({ ...s.room, widthCm }, s.rules));
  const room = clone(s.room); const w = room.openings.find(o => o.kind === 'window')!;
  w.headCm = 600; assert.ok(validateRoomInputs(room, s.rules));
  const noDoor = { ...s.room, openings: s.room.openings.filter(o => o.kind !== 'door') };
  assert.ok(validateRoomInputs(noDoor, s.rules));
  const moved = { ...s.room, fixtures: [radiatorOnWall(s.room.fixtures[0], s.room, 'south', 80, 100, 20, 60)] };
  assert.equal(validateRoomInputs(moved, s.rules), null);
  assert.ok(validate(s.current, moved, s.rules, s.inventory).validation.hardFailures);
  assert.ok(validateRoomInputs({ ...moved, depthCm: 320 }, s.rules));
});

test('room switches refresh authority even when samples reuse IDs and revision numbers',async()=>{
  const {makeBedroomDouble,makeHomeOffice}=await import('./samples.ts');
  const bedroom=makeBedroomDouble(), office=makeHomeOffice(), store=createStore(bedroom), old=bedroom.proposal!;
  assert.equal(old.id,office.proposal!.id); assert.equal(old.revision,office.proposal!.revision);
  const queued={proposalId:old.id,revision:old.revision,variantId:'fern-40',idempotencyKey:'queued-before-switch'};
  assert.equal(store.humanOpenRoom(office).operationSucceeded,true);
  const opened=clone(store.getState());
  assert.notEqual(opened.proposal!.id,old.id);
  assert.deepEqual(opened.proposal!.layout,office.proposal!.layout);
  assert.deepEqual(opened.room,office.room);
  assert.deepEqual(opened.inventory,office.inventory);
  assert.equal((await store.execute('placeFurniture',queued)).operationSucceeded,false);
  assert.equal(store.applyProposal(old.id,old.revision).operationSucceeded,false);
  assert.deepEqual(store.getState(),opened);
  store.humanOpenRoom(bedroom);
  assert.equal((await store.execute('placeFurniture',queued)).operationSucceeded,false,'returning to the same room must not revive old authority');
  assert.deepEqual(store.getState().proposal!.layout,bedroom.proposal!.layout);
  assert.equal(store.getHistory().canUndo,false);
});

test('room switching rejects in-flight planning and clears replay and candidate caches',async()=>{
  const {makeBedroomDouble,makeHomeOffice}=await import('./samples.ts');
  const bedroom=makeBedroomDouble(), store=createStore(bedroom), p=bedroom.proposal!;
  const checked=await store.execute('findPlacements',{proposalId:p.id,revision:p.revision,variantId:'fern-40',limit:1});
  const placed={proposalId:p.id,revision:p.revision,candidateId:(checked.candidates as {candidateId:string}[])[0].candidateId,idempotencyKey:'old-replay'};
  assert.equal((await store.execute('placeFurniture',placed)).operationSucceeded,true);
  const current=store.getState().proposal!;
  const candidates=await store.execute('findPlacements',{proposalId:current.id,revision:current.revision,variantId:'fern-40',limit:1});
  assert.ok((candidates.candidates as unknown[]).length);
  const candidateId=(candidates.candidates as {candidateId:string}[])[0].candidateId;
  const pending=store.execute('proposeLayout',{proposalId:current.id,revision:current.revision,variantIds:['line-desk-140','nest-chair-60']});
  store.humanOpenRoom(makeHomeOffice());const opened=clone(store.getState());
  assert.equal((await pending).operationSucceeded,false);
  assert.equal((await store.execute('placeFurniture',placed)).operationSucceeded,false);
  const active=store.getState().proposal!;
  assert.equal((await store.execute('placeFurniture',{proposalId:active.id,revision:active.revision,candidateId,idempotencyKey:'old-candidate'})).error?.code,'revision_conflict');
  assert.deepEqual(store.getState(),opened);
});

test('opening a saved proposal preserves its independent branch and invalidates old current revisions',async()=>{
  const {makeBedroomDouble,makeHomeOffice}=await import('./samples.ts');
  const stale=makeBedroomDouble();stale.currentRevision++;
  const store=createStore(makeHomeOffice());store.humanOpenRoom(stale);
  assert.equal(proposalStatus(store.getState()),'ready_for_review');
  assert.deepEqual(store.getState().proposal!.layout,stale.proposal!.layout);
  const blank=makeHomeOffice();blank.proposal=null;
  store.humanOpenRoom(blank);
  const before=clone(store.getState());
  const rejected=await store.execute('createProposal',{kind:'layout',expectedCurrentRevision:blank.currentRevision,expectedRuleRevision:blank.ruleRevision,idempotencyKey:'old-current-authority'});
  assert.equal(rejected.error?.code,'revision_conflict');assert.deepEqual(store.getState(),before);
});
