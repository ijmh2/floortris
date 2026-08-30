import test from 'node:test';
import assert from 'node:assert/strict';
import { bedAccessBands, bounds, frontBand, validate } from './engine.ts';
import { fromVariant, makeDemo, DEFAULT_RULES } from './data.ts';
import { clone, type Room } from './model.ts';
import { makeBathroomConcept, makeBedroomDouble, makeBedroomSingle, makeCompactRoom, makeHomeOffice } from './samples.ts';
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

test('a sofa seat frontage rejects parked furniture but still welcomes a coffee table', () => {
  // Regression: the sofa front was registered as a REACHABILITY zone only, so a
  // low cabinet parked in it left a route around itself and cleared the TV
  // strip, and the engine reported no hard failure at all.
  const room = { name: 'Frontage', widthCm: 600, depthCm: 500, profile: { kind: 'lounge' as const }, fixtures: [],
    openings: [{ id: 'e', kind: 'door' as const, wall: 'south' as const, offsetCm: 400, widthCm: 80, hinge: 'start' as const, swing: 'in' as const, angle: 90 as const, mechanism: 'hinged' as const, entrance: true }] };
  const rules = { ...DEFAULT_RULES, requiredKinds: [] };
  const inFront = (variantId: string | null) => {
    const sofa = fromVariant('arc-sofa-200', 'sofa-1'); sofa.originCell = { x: 1, y: 1 };
    const furniture = [sofa];
    if (variantId) { const b = frontBand(sofa, rules.walkHardCm, 20), o = fromVariant(variantId, 'parked'); o.originCell = o.kind === 'coffee_table' ? { x: Math.round(b.x / 20), y: (bounds(sofa).y + bounds(sofa).d + 40) / 20 } : { x: Math.round(b.x / 20), y: Math.round(b.y / 20) }; furniture.push(o); }
    return validate({ furniture, appearance: { wall: 'chalk', floor: 'ash' } }, room, rules, []);
  };
  assert.equal(inFront(null).issues.some(i => i.code === 'sofa_front_blocked'), false, 'an empty frontage is fine');
  for (const parked of ['folio-media-140', 'folio-shelf-80', 'nest-task-62']) {
    const report = inFront(parked);
    assert.ok(report.issues.some(i => i.code === 'sofa_front_blocked'), `${parked} in the seat frontage must be reported`);
    assert.ok(report.validation.hardFailures > 0, `${parked} in the seat frontage must be a hard failure`);
  }
  for (const welcome of ['pebble-table-80', 'pebble-ottoman-60', 'weave-rug-200']) {
    assert.equal(inFront(welcome).issues.some(i => i.code === 'sofa_front_blocked'), false, `${welcome} belongs in front of a sofa`);
  }
  const touching = fromVariant('pebble-table-80', 'touching'), sofa = fromVariant('arc-sofa-200', 'touching-sofa'); sofa.originCell = { x: 1, y: 1 }; touching.originCell = { x: 1, y: 5 };
  const touchingReport = validate({ furniture: [sofa, touching], appearance: { wall: 'chalk', floor: 'ash' } }, room, rules, []);
  assert.ok(touchingReport.issues.some(i => i.code === 'sofa_front_blocked'));
  assert.ok(touchingReport.issues.some(i => i.code === 'coffee_table_gap'));
  // A fixed fixture clipping the band is room fabric, not parked furniture.
  const withRadiator = makeDemo();
  assert.equal(validate(withRadiator.current, withRadiator.room, withRadiator.rules, withRadiator.inventory).issues.some(i => i.code === 'sofa_front_blocked'), false, 'a wall radiator is not parked furniture');
});

test('a dead desk link and a zero footprint are both reported', () => {
  // Both rot silently otherwise: a chair keeps pointing at a removed desk, and a
  // zero-depth piece rasterises to no cells at all, so every clearance and route
  // rule simply cannot see it.
  const room = { name: 'Rot', widthCm: 600, depthCm: 500, profile: { kind: 'lounge' as const }, fixtures: [],
    openings: [{ id: 'e', kind: 'door' as const, wall: 'south' as const, offsetCm: 400, widthCm: 80, hinge: 'start' as const, swing: 'in' as const, angle: 90 as const, mechanism: 'hinged' as const, entrance: true }] };
  const rules = { ...DEFAULT_RULES, requiredKinds: [] };
  const report = (furniture: ReturnType<typeof fromVariant>[]) => validate({ furniture, appearance: { wall: 'chalk', floor: 'ash' } }, room, rules, []);

  const chair = fromVariant('nest-chair-60', 'chair'); chair.originCell = { x: 1, y: 1 }; chair.linkedDeskId = 'removed-desk';
  const dangling = report([chair]).issues.find(i => i.code === 'link_dangling');
  assert.ok(dangling, 'a chair linked to a missing desk must be reported');
  assert.equal(dangling!.severity, 'warning', 'a stale link is untidy, not a physical failure');
  assert.deepEqual(dangling!.objectIds, ['chair']);

  const desk = fromVariant('line-desk-100', 'removed-desk'); desk.originCell = { x: 1, y: 6 };
  assert.equal(report([chair, desk]).issues.some(i => i.code === 'link_dangling'), false, 'a resolvable link is silent');

  const flat = fromVariant('folio-storage-80', 'flat'); flat.originCell = { x: 10, y: 1 }; flat.sizeCm = { ...flat.sizeCm, d: 0 };
  const invalid = report([flat]).issues.find(i => i.code === 'footprint_invalid');
  assert.ok(invalid, 'a zero-depth piece must be refused rather than silently ignored');
  assert.equal(invalid!.severity, 'block');
});

test('a sofa only warns when it faces a nearby blank wall with a better direction behind it', () => {
  const room: Room = { name: 'Sofa outlook', widthCm: 600, depthCm: 500, profile: { kind: 'lounge' as const }, fixtures: [],
    openings: [{ id: 'e', kind: 'door' as const, wall: 'south' as const, offsetCm: 400, widthCm: 80, hinge: 'start' as const, swing: 'in' as const, angle: 90 as const, mechanism: 'hinged' as const, entrance: true }] };
  const rules = { ...DEFAULT_RULES, requiredKinds: [], openFloorM2: 0 };
  const layout = (furniture: ReturnType<typeof fromVariant>[]) => validate({ furniture, appearance: { wall: 'chalk', floor: 'ash' } }, room, rules, []);
  const sofa = fromVariant('arc-sofa-200', 'sofa'); sofa.originCell = { x: 5, y: 5 }; sofa.rotation = 180;
  const bad = layout([sofa]), warning = bad.issues.find(i => i.code === 'prefer_sofa_into_room');
  assert.ok(warning, 'a sofa looking at a nearby blank wall with open room behind it should warn');
  assert.equal(warning!.severity, 'warning');

  const intoRoom = clone(sofa); intoRoom.originCell.y = 0; intoRoom.rotation = 0;
  assert.equal(layout([intoRoom]).issues.some(i => i.code === 'prefer_sofa_into_room'), false, 'a wall-backed sofa facing across the room is normal');

  const withWindow = clone(room); withWindow.openings.push({ id: 'north-window', kind: 'window', wall: 'north', offsetCm: 140, widthCm: 120, sillCm: 95, headCm: 215, type: 'fixed', windowAccess: false });
  assert.equal(validate({ furniture: [sofa], appearance: { wall: 'chalk', floor: 'ash' } }, withWindow, rules, []).issues.some(i => i.code === 'prefer_sofa_into_room'), false, 'an opening on the faced wall is a deliberate outlook');

  const northTv = fromVariant('frame-tv-120', 'north-tv'); northTv.wallAnchor = { wall: 'north', offsetCm: 140 }; northTv.targetSofaId = sofa.id;
  assert.equal(layout([sofa, northTv]).issues.some(i => i.code === 'prefer_sofa_into_room'), false, 'a TV on the faced wall is a deliberate outlook');

  const eastTv = clone(northTv); eastTv.id = 'east-tv'; eastTv.wallAnchor = { wall: 'east', offsetCm: 100 };
  assert.equal(layout([sofa, eastTv]).issues.some(i => i.code === 'prefer_sofa_into_room'), true, 'a linked TV on another wall does not make the faced wall non-blank');

  for (const state of [makeDemo(), makeCompactRoom(), makeBedroomSingle(), makeBedroomDouble(), makeHomeOffice(), makeBathroomConcept()]) {
    const proposal = state.proposal;
    assert.equal(validate(proposal?.layout || state.current, proposal?.room || state.room, proposal?.rules || state.rules, state.inventory).issues.some(i => i.code === 'prefer_sofa_into_room'), false, `${state.room.name} stays quiet`);
  }
});

test('detached wall anchors and deliberately disabled checks remain visible in reports', () => {
  const detached = makeDemo(); detached.room.widthCm = 800;
  const anchor = validate(detached.current, detached.room, detached.rules, detached.inventory).issues.find(i => i.code === 'fixture_anchor_detached');
  assert.ok(anchor, 'a room resize must not leave a wall-anchored fixture silently floating in the room');
  assert.equal(anchor!.severity, 'warning');

  const tvState = makeDemo(), sofa = tvState.current.furniture[0], tv = fromVariant('frame-tv-120', 'tv');
  tv.wallAnchor = { wall: 'north', offsetCm: 220 }; tv.targetSofaId = sofa.id; tvState.current.furniture.push(tv);
  const tallDisabled = validate(tvState.current, tvState.room, { ...tvState.rules, H_lowCm: tvState.rules.ceilingCm }, tvState.inventory).issues.filter(i => i.code === 'rule_disabled_by_constraint');
  assert.equal(tallDisabled.length, 1); assert.match(tallDisabled[0].message, /known-height obstruction/i);

  const radiatorDisabled = validate(tvState.current, tvState.room, { ...tvState.rules, radiatorFrontCm: 0 }, tvState.inventory).issues.filter(i => i.code === 'rule_disabled_by_constraint');
  assert.equal(radiatorDisabled.length, 1); assert.match(radiatorDisabled[0].message, /radiator keep-out depth is 0/i);

  const windowDisabled = validate(tvState.current, tvState.room, { ...tvState.rules, windowFrontCm: 0 }, tvState.inventory).issues.filter(i => i.code === 'rule_disabled_by_constraint');
  assert.equal(windowDisabled.length, 1); assert.match(windowDisabled[0].message, /window-front depth is 0/i);

  const irrelevant = makeHomeOffice(); irrelevant.room.fixtures = []; irrelevant.room.openings = irrelevant.room.openings.filter(o => o.kind !== 'window');
  const proposal = irrelevant.proposal!;
  assert.equal(validate(proposal.layout, irrelevant.room, { ...proposal.rules, H_lowCm: proposal.rules.ceilingCm, radiatorFrontCm: 0, windowFrontCm: 0 }, irrelevant.inventory).issues.some(i => i.code === 'rule_disabled_by_constraint'), false, 'disabled checks stay quiet when the room has no relevant object or fixture');
});
