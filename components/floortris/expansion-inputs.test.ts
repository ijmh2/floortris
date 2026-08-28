import test from 'node:test';
import assert from 'node:assert/strict';
import { clone } from './model.ts';
import { makeBathroomConcept, makeCompactRoom } from './samples.ts';
import { validateRoomInputs } from './room-inputs.ts';

test('legacy lounge and complete bathroom concept inputs remain structurally valid', () => {
  const lounge = makeCompactRoom();
  assert.equal(validateRoomInputs(lounge.room, lounge.rules), null);
  const bathroom = makeBathroomConcept();
  assert.equal(validateRoomInputs(bathroom.room, bathroom.rules), null);
});

test('profiles and bathroom fixture references are structurally checked', () => {
  const state = makeBathroomConcept(), room = clone(state.room);
  room.profile = { kind: 'bathroom_concept', fixtureIds: ['missing'], conceptualOnly: true };
  assert.match(validateRoomInputs(room, state.rules) || '', /fixture ID/i);
  room.profile = { kind: 'bathroom_concept', fixtureIds: ['basin-1'], conceptualOnly: false } as never;
  assert.match(validateRoomInputs(room, state.rules) || '', /conceptual-only/i);
  const bedroom = clone(state.room); bedroom.profile = { kind: 'bedroom', sleeping: 'single', workspace: true, storage: false, bedsideQuantity: 3 } as never;
  assert.match(validateRoomInputs(bedroom, state.rules) || '', /0, 1, or 2/i);
  const radiatorId = clone(state.room); radiatorId.profile = { kind: 'bathroom_concept', fixtureIds: ['radiator-east'], conceptualOnly: true };
  assert.match(validateRoomInputs(radiatorId, state.rules) || '', /concept fixture/i);
});

test('concept fixture pose, kind, flags, footprint and access zone are strict', () => {
  const state = makeBathroomConcept();
  const invalid = (mutate: (room: typeof state.room) => void, pattern: RegExp) => {
    const room = clone(state.room); room.profile = {kind:'lounge'}; mutate(room); assert.match(validateRoomInputs(room, state.rules) || '', pattern);
  };
  invalid(room => { room.fixtures[0].originCell.x = Number.NaN; }, /finite floor position/i);
  invalid(room => { room.fixtures[0].rotation = 45 as never; }, /quarter-turn/i);
  invalid(room => { room.fixtures[0].elevationCm = 10; }, /zero elevation/i);
  invalid(room => { room.profile = {kind:'lounge'}; room.fixtures[0].kind = 'other'; }, /unsupported fixed fixture kind/i);
  invalid(room => { delete room.fixtures[0].conceptualOnly; }, /conceptual-only marker/i);
  invalid(room => { room.fixtures[0].originCell.x = 99; }, /extends beyond the room/i);
  invalid(room => { room.fixtures[0].clearance!.rect.x = 20; room.fixtures[0].clearance!.rect.y = 20; }, /outside its solid fixture footprint/i);
  invalid(room => { room.fixtures[0].clearance!.rect.x = 299; }, /approach extends beyond/i);
  invalid(room => { room.fixtures[0].locked.position = 'yes' as never; }, /boolean lock metadata/i);
  invalid(room => { (room.fixtures[0].locked as Record<string, unknown>).movedByAgent = false; }, /boolean lock metadata/i);
  invalid(room => { room.fixtures[0].id = 42 as never; }, /unique IDs/i);
});

test('concept fixtures may use a canonical wall anchor or free pose in mixed rooms', () => {
  const state = makeBathroomConcept(), anchored = clone(state.room), basin = anchored.fixtures[0];
  basin.wallAnchor = { wall: 'north', offsetCm: 20 }; basin.rotation = 0; basin.originCell = { x: 1, y: 0 };
  assert.equal(validateRoomInputs(anchored, state.rules), null);
  basin.originCell = { x: 2, y: 0 };
  assert.match(validateRoomInputs(anchored, state.rules) || '', /wall anchor/i);

  const mixed = clone(state.room); mixed.profile = { kind: 'lounge' };
  delete mixed.fixtures[0].wallAnchor;
  assert.equal(validateRoomInputs(mixed, state.rules), null);
});

test('fixed geometry conflicts remain engine-visible rather than input errors', () => {
  const state = makeBathroomConcept(), room = clone(state.room);
  room.fixtures[1].originCell = clone(room.fixtures[0].originCell);
  assert.equal(validateRoomInputs(room, state.rules), null);
});
