import test from 'node:test';
import assert from 'node:assert/strict';
import { bedAccessBands, bounds, validate } from './engine.ts';
import { fromVariant, makeDemo } from './data.ts';
import { clone } from './model.ts';
import { makeBedroomDouble, makeHomeOffice } from './samples.ts';
import { createStore } from './store.ts';

test('bed side bands trim the actual head end for every rotation', () => {
  const cases = [
    { rotation: 0 as const, head: 'north', horizontal: false, trimAtStart: true },
    { rotation: 90 as const, head: 'east', horizontal: true, trimAtStart: false },
    { rotation: 180 as const, head: 'south', horizontal: false, trimAtStart: false },
    { rotation: 270 as const, head: 'west', horizontal: true, trimAtStart: true },
  ];
  for (const expected of cases) {
    const bed = fromVariant('haven-double-140', `bed-${expected.rotation}`);
    bed.originCell = { x: 10, y: 10 }; bed.rotation = expected.rotation;
    const b = bounds(bed), bands = bedAccessBands(bed, 40, 60);
    assert.equal(bands.length, 2);
    for (const band of bands) {
      const retained = expected.horizontal ? band.rect.w : band.rect.d;
      assert.equal(retained, 140, `rotation ${expected.rotation} retains a 140 cm side segment`);
      if (expected.horizontal) {
        assert.equal(band.headExcluded.x, expected.trimAtStart ? b.x : b.x + b.w - 60);
        assert.equal(band.rect.x, expected.trimAtStart ? b.x + 60 : b.x);
      } else {
        assert.equal(band.headExcluded.y, expected.trimAtStart ? b.y : b.y + b.d - 60);
        assert.equal(band.rect.y, expected.trimAtStart ? b.y + 60 : b.y);
      }
    }
  }
});

test('blocked bed sides are exposed as blocked access flags', () => {
  const state = makeBedroomDouble(), p = clone(state.proposal!), bed = p.layout.furniture.find(o => o.kind === 'bed')!;
  for (const [index, band] of bedAccessBands(bed, p.rules.bedLongSideAccessCm, 60).entries()) {
    const blocker = fromVariant('folio-storage-80', `side-blocker-${index}`);
    blocker.sizeCm = { w: band.rect.w, d: band.rect.d, h: 100 };
    blocker.originCell = { x: band.rect.x / p.rules.cellCm, y: band.rect.y / p.rules.cellCm };
    p.layout.furniture.push(blocker);
  }
  const report = validate(p.layout, p.room, p.rules, state.inventory);
  assert.ok(report.issues.some(issue => issue.code === 'bed_access_blocked'));
  assert.ok((report.flagsSummary.bed_long_side_blocked || 0) > 0);
});

test('an unreachable nonblocking bedside does not claim hard-width reachability', () => {
  const state = makeDemo();
  state.room = { name: 'Isolated bedside', widthCm: 400, depthCm: 300, profile: { kind: 'bedroom', sleeping: 'single', workspace: false, storage: false }, fixtures: [], openings: [{ id: 'entrance', kind: 'door', wall: 'south', offsetCm: 0, widthCm: 80, hinge: 'start', swing: 'in', angle: 90, mechanism: 'hinged', entrance: true }] };
  state.rules.requiredKinds = [];
  const bedside = fromVariant('nook-bedside-40', 'isolated-bedside');
  const barrier = fromVariant('folio-storage-80', 'barrier');
  bedside.originCell = { x: 0, y: 0 };
  barrier.sizeCm = { w: 400, d: 40, h: 100 }; barrier.originCell = { x: 0, y: 5 };
  state.current.furniture = [bedside, barrier]; state.inventory = [];
  const report = validate(state.current, state.room, state.rules, state.inventory);
  assert.equal(report.zones.find(zone => zone.objectId === bedside.id)?.reachable, false);
  assert.equal(report.issues.some(issue => issue.code === 'walk_tight' && issue.objectIds.includes(bedside.id)), false);
});

test('catalogue variant changes replace semantic role tags', () => {
  const state = makeBedroomDouble(), store = createStore(state), p = store.getState().proposal!;
  const wardrobe = p.layout.furniture.find(o => o.tags.includes('wardrobe'))!;
  const result = store.humanUpdate('proposal', wardrobe.id, { variantId: 'nook-bedside-40' });
  assert.equal(result.operationSucceeded, true);
  const changed = store.getState().proposal!.layout.furniture.find(o => o.id === wardrobe.id)!;
  assert.deepEqual(changed.tags, ['bedside']);
  assert.equal(validate(store.getState().proposal!.layout, p.room, p.rules, state.inventory).brief.status, 'incomplete');
});

test('office profile requests guest seating and storage, and the planner keeps exact quantities on retry', async () => {
  const state = makeHomeOffice();
  state.proposal!.layout.furniture = [];
  state.proposal!.room.profile = { kind: 'home_office', seating: true, storage: true };
  const store = createStore(state), firstProposal = store.getState().proposal!;
  const first = await store.execute('proposeLayout', { proposalId: firstProposal.id, revision: firstProposal.revision });
  assert.equal(first.operationSucceeded, true);
  const afterFirst = store.getState().proposal!, firstItems = afterFirst.layout.furniture;
  assert.equal(firstItems.filter(o => o.kind === 'desk').length, 1);
  assert.equal(firstItems.filter(o => o.kind === 'chair').length, 2);
  assert.equal(firstItems.filter(o => o.variantId === 'archive-tall-80').length, 1);
  const desk = firstItems.find(o => o.kind === 'desk')!;
  assert.equal(firstItems.filter(o => o.kind === 'chair' && o.linkedDeskId === desk.id).length, 1);
  assert.equal(firstItems.filter(o => o.kind === 'chair' && !o.linkedDeskId).length, 1);
  const second = await store.execute('proposeLayout', { proposalId: afterFirst.id, revision: afterFirst.revision });
  assert.equal(second.operationSucceeded, true);
  const afterSecond = store.getState().proposal!.layout.furniture;
  assert.equal(afterSecond.filter(o => o.kind === 'desk').length, 1);
  assert.equal(afterSecond.filter(o => o.kind === 'chair').length, 2);
  assert.equal(afterSecond.filter(o => o.variantId === 'archive-tall-80').length, 1);
});

test('an explicit quantity replaces the matching profile default instead of growing on retry', async () => {
  const state = makeBedroomDouble(), store = createStore(state), p = store.getState().proposal!;
  const first = await store.execute('proposeLayout', { proposalId: p.id, revision: p.revision, quantities: [{ variantId: 'nook-bedside-40', quantity: 2 }] });
  assert.equal(first.operationSucceeded, true);
  const afterFirst = store.getState().proposal!;
  assert.equal(afterFirst.layout.furniture.filter(o => o.variantId === 'nook-bedside-40').length, 2);
  const second = await store.execute('proposeLayout', { proposalId: afterFirst.id, revision: afterFirst.revision, quantities: [{ variantId: 'nook-bedside-40', quantity: 2 }] });
  assert.equal(second.operationSucceeded, true);
  assert.equal(store.getState().proposal!.layout.furniture.filter(o => o.variantId === 'nook-bedside-40').length, 2);
});

test('matching owned bedroom roles satisfy singular profile defaults', async () => {
  const state = makeBedroomDouble(), p = state.proposal!;
  const ownedBed = p.layout.furniture.find(o => o.kind === 'bed')!;
  const ownedWardrobe = p.layout.furniture.find(o => o.tags.includes('wardrobe'))!;
  Object.assign(ownedBed, { ownership: 'owned' as const, variantId: undefined, sleepSize: 'double' as const });
  Object.assign(ownedWardrobe, { ownership: 'owned' as const, variantId: undefined });
  state.inventory = [clone(ownedBed), clone(ownedWardrobe)];
  const store = createStore(state), before = store.getState().proposal!;
  const result = await store.execute('proposeLayout', { proposalId: before.id, revision: before.revision });
  assert.equal(result.operationSucceeded, true);
  const furniture = store.getState().proposal!.layout.furniture;
  assert.equal(furniture.filter(o => o.kind === 'bed').length, 1);
  assert.equal(furniture.filter(o => o.tags.includes('wardrobe')).length, 1);
});

test('planner reserves room for a desk-chair pair at the 30-piece limit', async () => {
  const state = makeHomeOffice(), p = state.proposal!;
  p.layout.furniture = Array.from({ length: 29 }, (_, index) => {
    const rug = fromVariant('weave-rug-200', `nonblocking-rug-${index}`);
    rug.originCell = { x: 0, y: 0 };
    return rug;
  });
  const store = createStore(state), before = store.getState().proposal!;
  const result = await store.execute('proposeLayout', { proposalId: before.id, revision: before.revision });
  assert.equal(result.operationSucceeded, true);
  const furniture = store.getState().proposal!.layout.furniture;
  assert.ok(furniture.length <= 30);
  for (const desk of furniture.filter(o => o.kind === 'desk')) assert.ok(furniture.some(o => o.kind === 'chair' && o.linkedDeskId === desk.id));
});

test('owned storage classifications and conceptual markers survive report generation', () => {
  const store = createStore(makeDemo());
  const added = store.humanAddOwned({ label: 'Measured cabinet', kind: 'storage', sizeCm: { w: 80, d: 40, h: 90 }, storageRole: 'general' });
  assert.equal(added.operationSucceeded, true);
  assert.equal(store.humanClassifyOwned(added.objectId as string, { storageRole: 'wardrobe' }).operationSucceeded, true);
  assert.ok(store.getState().inventory.find(o => o.id === added.objectId)?.tags.includes('wardrobe'));
  const state = makeDemo(); state.room.fixtures[0].conceptualOnly = true;
  assert.equal(validate(state.current, state.room, state.rules, state.inventory).conceptualOnly, true);
});

test('bedside relationship follows the bed head for every rotation', () => {
  for (const rotation of [0,90,180,270] as const) {
    const state=makeDemo();state.room.fixtures=[];state.inventory=[];
    const bed=fromVariant('haven-double-140','relationship-bed');bed.originCell={x:10,y:10};bed.rotation=rotation;
    const bedside=fromVariant('nook-bedside-40','relationship-table');
    const h=bedAccessBands(bed,60)[0].headExcluded;
    bedside.originCell={x:h.x/20,y:h.y/20};
    state.current.furniture=[bed,bedside];
    assert.equal(validate(state.current,state.room,state.rules,[]).issues.some(i=>i.code==='prefer_bedside_near_bed'),false);
    bedside.originCell={x:0,y:0};
    assert.equal(validate(state.current,state.room,state.rules,[]).issues.some(i=>i.code==='prefer_bedside_near_bed'),true);
  }
});
