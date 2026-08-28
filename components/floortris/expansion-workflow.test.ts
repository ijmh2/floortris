import test from 'node:test';
import assert from 'node:assert/strict';
import { validate } from './engine.ts';
import { clone } from './model.ts';
import { roomEditStamp } from './room-inputs.ts';
import { makeBathroomConcept } from './samples.ts';
import { createStore } from './store.ts';

test('a profile remains human-staged until confirm and survives undo/redo', () => {
  const store = createStore(), before = clone(store.getState()), room = clone(before.room), rules = clone(before.rules);
  room.profile = { kind: 'bedroom', sleeping: 'single', workspace: false, storage: false, bedsideQuantity: 1 };
  rules.requiredKinds = ['bed'];
  const staged = store.humanStageRoom(room, rules, roomEditStamp(before));
  assert.equal(staged.operationSucceeded, true);
  assert.equal(store.getState().room.profile?.kind, 'lounge');
  assert.equal(store.getState().proposal?.kind, 'setup');
  const proposal = store.getState().proposal!;
  assert.equal(proposal.room.profile?.kind, 'bedroom');
  assert.equal(store.confirmSetup(proposal.id, proposal.revision).operationSucceeded, true);
  assert.equal(store.getState().room.profile?.kind, 'bedroom');
  assert.deepEqual(store.getState().current, before.current);
  assert.equal(store.undo().operationSucceeded, true);
  assert.equal(store.getState().room.profile?.kind, 'lounge');
  assert.equal(store.getState().proposal?.kind, 'setup');
  assert.equal(store.redo().operationSucceeded, true);
  assert.equal(store.getState().room.profile?.kind, 'bedroom');
  assert.equal(store.getState().proposal, null);
});

test('a fixed fixture blocks another fixed fixture approach, while a rug does not', () => {
  const state = makeBathroomConcept(), proposal = state.proposal!, room = clone(proposal.room);
  const basin = room.fixtures.find(f => f.id === 'basin-1')!, toilet = room.fixtures.find(f => f.id === 'toilet-1')!;
  toilet.originCell = { x: basin.clearance!.rect.x / 20, y: basin.clearance!.rect.y / 20 };
  const fixedReport = validate(proposal.layout, room, proposal.rules, state.inventory);
  assert.ok(fixedReport.issues.some(issue => issue.code === 'fixture_clearance_blocked' && issue.objectIds.includes(basin.id) && issue.objectIds.includes(toilet.id)));

  const rugRoom = clone(proposal.room), rug = { id: 'concept-rug', label: 'Concept mat', kind: 'rug' as const, ownership: 'catalogue' as const, sizeCm: { w: 60, d: 60, h: 1 }, originCell: { x: rugRoom.fixtures[0].clearance!.rect.x / 20, y: rugRoom.fixtures[0].clearance!.rect.y / 20 }, rotation: 0 as const, elevationCm: 0, locked: {}, appearance: 'oat', requiredInRoom: false, tags: [] };
  const rugReport = validate({ ...proposal.layout, furniture: [rug] }, rugRoom, proposal.rules, state.inventory);
  assert.equal(rugReport.issues.some(issue => issue.code === 'fixture_clearance_blocked' && issue.objectIds.includes('basin-1') && issue.objectIds.includes(rug.id)), false);
});

test('concept-only disclosure follows a fixed concept fixture in a mixed profile', () => {
  const state = makeBathroomConcept(), proposal = clone(state.proposal!);
  proposal.room.profile = { kind: 'lounge' };
  const report = validate(proposal.layout, proposal.room, proposal.rules, state.inventory);
  assert.equal(report.conceptualOnly, true);
});
