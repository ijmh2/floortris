import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, fromVariant, makeDemo } from './data.ts';
import { bounds, furnitureBackWall, sofaTableRelation, validate } from './engine.ts';
import { clone, faces, type Candidate, type Furniture, type Room } from './model.ts';
import { makeBathroomConcept } from './samples.ts';
import { createStore } from './store.ts';

const entrance = { id: 'entrance', kind: 'door' as const, wall: 'south' as const, offsetCm: 0, widthCm: 80, hinge: 'start' as const, swing: 'in' as const, angle: 90 as const, mechanism: 'hinged' as const, entrance: true };
const room = (widthCm = 600, depthCm = 500, profile: Room['profile'] = { kind: 'lounge' }): Room => ({ name: 'Correction fixture', widthCm, depthCm, profile, fixtures: [], openings: [clone(entrance)] });
const rules = { ...DEFAULT_RULES, requiredKinds: [], openFloorM2: 0, deskNearWindow: false };
const report = (furniture: Furniture[], r = room()) => validate({ furniture, appearance: { wall: 'chalk', floor: 'ash' } }, r, rules, []);

test('coffee tables need the facing half-plane and a 40–60 cm sofa edge gap at every rotation', () => {
  for (const rotation of [0, 90, 180, 270] as const) {
    const sofa = fromVariant('arc-sofa-200', `sofa-${rotation}`); sofa.originCell = { x: 15, y: 15 }; sofa.rotation = rotation;
    const table = fromVariant('pebble-table-80', `table-${rotation}`), s = bounds(sofa), face = faces[rotation], tableRotation = (face === 'north' || face === 'south' ? 0 : 90) as Furniture['rotation'];
    table.rotation = tableRotation; const t = bounds(table);
    table.originCell = face === 'north' ? { x: (s.x + (s.w - t.w) / 2) / 20, y: (s.y - t.d - 40) / 20 }
      : face === 'south' ? { x: (s.x + (s.w - t.w) / 2) / 20, y: (s.y + s.d + 40) / 20 }
        : face === 'west' ? { x: (s.x - t.w - 40) / 20, y: (s.y + (s.d - t.d) / 2) / 20 }
          : { x: (s.x + s.w + 40) / 20, y: (s.y + (s.d - t.d) / 2) / 20 };
    const good = sofaTableRelation(sofa, table);
    assert.equal(good.validFrontageExemption, true, `rotation ${rotation}`);
    assert.equal(report([sofa, table], room(900, 900)).issues.some(i => ['coffee_table_position', 'coffee_table_gap', 'sofa_front_blocked'].includes(i.code)), false, `rotation ${rotation}`);
    const touching = clone(table), tb = bounds(table); touching.originCell = face === 'north' ? { ...table.originCell, y: (s.y - tb.d) / 20 } : face === 'south' ? { ...table.originCell, y: (s.y + s.d) / 20 } : face === 'west' ? { ...table.originCell, x: (s.x - tb.w) / 20 } : { ...table.originCell, x: (s.x + s.w) / 20 };
    const bad = report([sofa, touching], room(900, 900));
    assert.ok(bad.issues.some(i => i.code === 'coffee_table_gap'), `rotation ${rotation}`);
    assert.ok(bad.issues.some(i => i.code === 'sofa_front_blocked'), `rotation ${rotation}`);
  }
});

test('an adjacent-wall TV cannot hide behind a green door check', () => {
  const r = room(400, 400); r.openings = [{ ...entrance, wall: 'west', offsetCm: 320, hinge: 'end' }];
  const tv = fromVariant('frame-tv-120', 'door-tv'); tv.wallAnchor = { wall: 'south', offsetCm: 0 };
  assert.ok(report([tv], r).issues.some(i => i.code === 'door_leaf_wall_attachment' && i.severity === 'block'));
  tv.wallAnchor.offsetCm = 160;
  assert.equal(report([tv], r).issues.some(i => i.code === 'door_leaf_wall_attachment'), false);
});

test('bed access counts only a side that is both physically valid and entrance-reachable', () => {
  const r = room(600, 500), bed = fromVariant('haven-double-140', 'bed'), plant = fromVariant('fern-40', 'invalid-side-plant'), footBlock = fromVariant('folio-storage-80', 'foot-barrier');
  bed.originCell = { x: 10, y: 0 }; plant.originCell = { x: 8, y: 3 };
  footBlock.originCell = { x: 10, y: 10 }; footBlock.sizeCm = { w: 400, d: 100, h: 100 };
  const result = report([bed, plant, footBlock], r);
  assert.ok(result.zones.find(z => z.id === 'bed:bed:left')?.reachable, 'the occupied/invalid side remains locally reachable');
  assert.equal(result.zones.find(z => z.id === 'bed:bed:right')?.reachable, false, 'the physically clear side is isolated');
  assert.ok(result.issues.some(i => i.code === 'path_broken' && i.objectIds.includes(bed.id) && i.flags.includes('bed_long_side_unreachable')));
});

test('a narrow storage front is reachable when a free walking footprint straddles its edge', () => {
  const storage = fromVariant('archive-pedestal-42', 'narrow-storage'); storage.originCell = { x: 1, y: 1 };
  const result = report([storage], room(500, 400, { kind: 'home_office', seating: false, storage: true }));
  assert.equal(result.zones.find(z => z.id === `storage:${storage.id}`)?.reachable, true);
  assert.equal(result.issues.some(i => i.code === 'path_broken' && i.objectIds.includes(storage.id)), false);
});

test('each office desk needs a nearby linked chair in its pull zone', () => {
  const r = room(800, 600, { kind: 'home_office', seating: false, storage: false }), desk = fromVariant('line-desk-100', 'desk-a'), second = fromVariant('line-desk-100', 'desk-b'), chair = fromVariant('nest-chair-60', 'far-chair');
  desk.originCell = { x: 1, y: 1 }; second.originCell = { x: 20, y: 1 }; chair.originCell = { x: 30, y: 20 }; chair.rotation = 180; chair.linkedDeskId = desk.id;
  const result = report([desk, second, chair], r), relationship = result.brief.requirements!.find(x => x.key === 'desk-chair-link')!;
  assert.ok(result.issues.some(i => i.code === 'chair_desk_distance' && i.severity === 'block'));
  assert.deepEqual({ quantity: relationship.quantity, met: relationship.met }, { quantity: 2, met: 1 });
  assert.ok(result.issues.some(i => i.code === 'desk_chair_missing'));
});

test('wall-backed catalogue semantics use the real rotated back edge and centimetre flush candidates', async () => {
  const r = room(400, 500), shelf = fromVariant('folio-shelf-80', 'shelf'); shelf.originCell = { x: 16, y: 5 };
  const wrong = report([shelf], r);
  assert.equal(furnitureBackWall(shelf), 'north');
  assert.ok(wrong.issues.some(i => i.code === 'side_against_wall'));
  const correct = clone(shelf); correct.rotation = 90; correct.originCell = { x: 18.4, y: 5 };
  assert.equal(furnitureBackWall(correct), 'east');
  assert.equal(report([correct], r).issues.some(i => ['side_against_wall', 'prefer_wall_backing', 'prefer_flush_to_wall'].includes(i.code)), false);

  const searchRoom = clone(r); searchRoom.openings.push(
    { id: 'north-window', kind: 'window', wall: 'north', offsetCm: 0, widthCm: 400, sillCm: 60, headCm: 220, type: 'fixed', windowAccess: false },
    { id: 'west-window', kind: 'window', wall: 'west', offsetCm: 0, widthCm: 500, sillCm: 60, headCm: 220, type: 'fixed', windowAccess: false },
    { id: 'south-window', kind: 'window', wall: 'south', offsetCm: 80, widthCm: 320, sillCm: 60, headCm: 220, type: 'fixed', windowAccess: false },
  );
  const state = makeDemo(); state.room = searchRoom; state.rules = clone(rules); state.inventory = []; state.current = { furniture: [clone(shelf)], appearance: { wall: 'chalk', floor: 'ash' } };
  state.proposal = { id: 'wall-proposal', kind: 'layout', revision: 1, baseCurrentRevision: state.currentRevision, baseRuleRevision: state.ruleRevision, layout: clone(state.current), room: clone(searchRoom), rules: clone(rules), omitted: [] };
  const store = createStore(state), result = await store.execute('findPlacements', { proposalId: 'wall-proposal', revision: 1, objectId: shelf.id, limit: 8 }), candidates = result.candidates as Candidate[];
  assert.ok(candidates.length > 0);
  assert.ok(candidates.every(c => c.checkedRules.includes('wall_backing') && c.backWall && Number.isFinite(c.backGapCm)));
  assert.ok(candidates[0].backGapCm <= 0.5 && candidates[0].touchingWalls.includes(candidates[0].backWall));
  assert.ok(candidates.some(c => !Number.isInteger(c.originCell.x) || !Number.isInteger(c.originCell.y)), 'non-grid furniture depth needs a fractional flush origin');
  assert.ok(candidates.every(c => c.qualityScore >= candidates[0].qualityScore));
});

test('day-bed and meeting-table catalogue promises have matching geometry rules', () => {
  const day = fromVariant('haven-day-90', 'day'); day.originCell = { x: 0, y: 5 };
  assert.equal(day.backEdge, 'west'); assert.equal(furnitureBackWall(day), 'west');
  assert.equal(report([day], room(700, 700, { kind: 'bedroom', sleeping: 'single', workspace: false, storage: false })).issues.some(i => i.code === 'bed_head_wall'), false);
  const meeting = fromVariant('fold-meeting-120', 'meeting'); meeting.originCell = { x: 0, y: 0 };
  assert.ok(report([meeting], room(700, 700, { kind: 'home_office', seating: false, storage: false })).issues.some(i => i.code === 'meeting_table_clearance'));
  meeting.originCell = { x: 10, y: 10 };
  assert.equal(report([meeting], room(700, 700, { kind: 'home_office', seating: false, storage: false })).issues.some(i => i.code === 'meeting_table_clearance'), false);
});

test('fixed fixture clearance reports one cause instead of three duplicate blockers', () => {
  const state = makeBathroomConcept(), proposal = state.proposal!, r = clone(proposal.room), basin = r.fixtures.find(f => f.id === 'basin-1')!, toilet = r.fixtures.find(f => f.id === 'toilet-1')!;
  toilet.originCell = { x: basin.clearance!.rect.x / 20, y: basin.clearance!.rect.y / 20 };
  const result = validate(proposal.layout, r, proposal.rules, state.inventory), related = result.issues.filter(i => i.objectIds.includes(basin.id));
  assert.ok(related.some(i => i.code === 'fixture_clearance_blocked'));
  assert.equal(related.some(i => i.code === 'fixture_clearance_unreachable'), false);
  assert.equal(related.some(i => i.code === 'path_broken' && i.destinationId === `fixture:${basin.id}`), false);
});
