import test from 'node:test';
import assert from 'node:assert/strict';
import { bounds, frontBand, validate } from './engine.ts';
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

const bedroomRequest = (key: string) => ({
  name: 'Ten metre bedroom', widthCm: 1000, depthCm: 1000,
  profile: { kind: 'bedroom', sleeping: 'king', workspace: true, storage: true, bedsideQuantity: 2 },
  openings: [
    ...(['north', 'east', 'south', 'west'] as const).map(wall => ({ id: `window-${wall}`, kind: 'window', wall, offsetCm: 400, widthCm: 200, sillCm: 95, headCm: 215, type: 'fixed', windowAccess: false })),
    { id: 'entrance', kind: 'door', wall: 'south', offsetCm: 20, widthCm: 100, hinge: 'start', swing: 'in', angle: 90, mechanism: 'hinged', entrance: true },
  ], idempotencyKey: key,
});

test('generateRoom creates and displays the requested bedroom without discarding a locked lounge draft', async () => {
  const store = createStore();
  await store.execute('createProposal', {kind:'layout',expectedCurrentRevision:1,expectedRuleRevision:1,idempotencyKey:'old'});
  const before = clone(store.getState()), request = { ...bedroomRequest('new-bedroom'), variantIds: ['haven-king-160','tallline-wardrobe-160','line-desk-140','nest-chair-60','nook-bedside-40','fold-bench-100','weave-rug-200','fern-40'], quantities: [{variantId:'nook-bedside-40',quantity:2}] };
  const result = await store.execute('generateRoom', request);
  assert.equal(result.operationSucceeded, true, JSON.stringify(result));
  assert.equal(result.generatedRoom, true); assert.equal(result.selectedView, 'proposal');
  const after = store.getState(), proposal = after.proposal!;
  assert.deepEqual(store.getDocuments()[0], before);
  assert.deepEqual(after.room, proposal.room);
  assert.equal(after.room.widthCm, 1000); assert.equal(after.room.depthCm, 1000);
  assert.deepEqual(after.room.profile, request.profile);
  assert.equal(after.room.openings.filter(o => o.kind === 'window').length, 4);
  assert.equal(after.room.openings.filter(o => o.kind === 'door').length, 1);
  assert.deepEqual(after.inventory, []); assert.deepEqual(after.room.fixtures, []);
  assert.deepEqual(after.current.furniture, []); // Apply remains human.
  const report = validate(proposal.layout, proposal.room, proposal.rules, after.inventory);
  assert.equal(report.validation.hardFailures, 0, JSON.stringify(report.issues));
  assert.equal(report.brief.status, 'satisfied', JSON.stringify(result));
  assert.equal(proposal.layout.furniture.filter(o=>o.kind==='bed').length, 1);
  assert.equal(proposal.layout.furniture.filter(o=>o.tags.includes('bedside')).length, 2);
  assert.equal(report.validation.warnings,0,JSON.stringify(report.issues));
  assert.deepEqual(proposal.omitted,[]);
  const desk=proposal.layout.furniture.find(o=>o.kind==='desk')!, chair=proposal.layout.furniture.find(o=>o.linkedDeskId===desk.id)!;
  const approach=frontBand(desk,proposal.rules.chairPullCm), cb=bounds(chair);
  assert.ok(cb.x>=approach.x && cb.y>=approach.y && cb.x+cb.w<=approach.x+approach.w && cb.y+cb.d<=approach.y+approach.d);
  assert.equal(store.getHistory().canUndo, false); // History never crosses documents.
  const replay = await store.execute('generateRoom', request);
  assert.equal(replay.idempotentReplay, true); assert.equal(replay.documentId, result.documentId);
  assert.equal(store.getDocuments().length, 2);
  const conflict = await store.execute('generateRoom', {...request, widthCm:800});
  assert.equal(conflict.error?.code, 'idempotency_conflict');
  store.resetDemo();
  assert.equal(store.getState().documentId, after.documentId);
  assert.deepEqual(store.getDocuments()[0], before);
});

test('new room rejects invalid geometry, profile, palette and pre-cancellation without replacing anything', async () => {
  const store=createStore(), before=clone(store.getState()), request=bedroomRequest('invalid');
  for(const change of [{widthCm:1001},{profile:{kind:'bedroom'}},{appearance:{wall:'neon'}},{openings:[]},{openings:[...request.openings,request.openings[0]]}]) {
    assert.equal((await store.execute('generateRoom',{...request,...change})).operationSucceeded,false);
    assert.deepEqual(store.getState(),before);
  }
  const controller=new AbortController(); controller.abort();
  assert.equal((await store.execute('generateRoom',request,controller.signal)).error?.code,'cancelled');
  assert.deepEqual(store.getState(),before);
});

test('cancellation, concurrent generation and intervening human edits cannot replace the active room', async () => {
  const store=createStore(), before=clone(store.getState()), controller=new AbortController();
  const pending=store.execute('generateRoom',bedroomRequest('cancel'),controller.signal);
  controller.abort();
  assert.equal((await pending).error?.code,'cancelled'); assert.deepEqual(store.getState(),before);
  const planning=store.execute('generateRoom',bedroomRequest('race'));
  const competing=await store.execute('generateRoom',bedroomRequest('competing'));
  assert.equal(competing.error?.code,'generation_in_progress');
  store.humanAdd('current','fern-40'); const edited=clone(store.getState());
  assert.equal((await planning).error?.code,'revision_conflict'); assert.deepEqual(store.getState(),edited);
});

test('failure to save the document transition leaves the old room and proposal intact', async () => {
  const store=createStore(undefined,{beforeNewDocument:()=>{throw new Error('Quota exceeded');}}), before=clone(store.getState());
  const result=await store.execute('generateRoom',{...bedroomRequest('quota'),profile:{kind:'bedroom',sleeping:'single',storage:false,workspace:false}});
  assert.equal(result.error?.code,'save_failed'); assert.deepEqual(store.getState(),before);
  assert.equal(store.getDocuments().length,1);
});
