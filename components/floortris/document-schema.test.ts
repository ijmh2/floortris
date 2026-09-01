import test from 'node:test';
import assert from 'node:assert/strict';
import { fromVariant } from './data.ts';
import { validatePersistedDocument } from './document-schema.ts';
import { readImportedRoom, readSavedRoom } from './persistence.ts';
import { makeBathroomConcept, makeBedroomDouble, makeCompactRoom, makeHomeOffice } from './samples.ts';

test('closed persisted schema round-trips every current export shape', () => {
  for (const make of [makeCompactRoom,makeBedroomDouble,makeHomeOffice,makeBathroomConcept]) {
    const state=make(), raw=JSON.stringify(state);
    assert.equal(validatePersistedDocument(state),null);
    assert.deepEqual(readSavedRoom(raw),state);
    assert.deepEqual(readImportedRoom(raw)!.current,state.current);
  }
});

test('unknown future and authority fields fail closed at every document layer', () => {
  const cases=((base=makeCompactRoom())=>[
    {...base,version:99},
    {...base,futureCapability:true},
    {...base,currentRevision:-1},
    {...base,rules:{...base.rules,cellCm:10}},
    {...base,rules:{...base.rules,adminOverride:true}},
    {...base,room:{...base.room,authority:'agent'}},
    {...base,proposal:{...base.proposal!,confirmed:true}},
  ])();
  for(const value of cases) assert.equal(readSavedRoom(JSON.stringify(value)),null);
});

test('forged furniture roles, semantic tags, IDs and references are rejected', () => {
  const base=makeCompactRoom(), mutate=(fn:(state:ReturnType<typeof makeCompactRoom>)=>void)=>{const state=structuredClone(base);fn(state);return readSavedRoom(JSON.stringify(state));};
  assert.equal(mutate(state=>{(state.current.furniture[0] as unknown as Record<string,unknown>).ruleOverrides={collision:false};}),null);
  assert.equal(mutate(state=>{state.current.furniture[0].ownership='catalogue';state.current.furniture[0].variantId='frame-tv-120';}),null);
  assert.equal(mutate(state=>{state.proposal!.layout.furniture.find(item=>item.ownership==='catalogue')!.tags.push('wardrobe');}),null);
  assert.equal(mutate(state=>{state.inventory.push(structuredClone(state.inventory[0]));}),null);
  assert.equal(mutate(state=>{state.proposal!.layout.furniture.find(item=>item.kind==='tv')!.targetSofaId='missing';}),null);
  assert.equal(mutate(state=>{state.room.openingLocks=['missing'];}),null);
  assert.equal(mutate(state=>{state.proposal!.baseCurrentRevision=state.currentRevision+1;}),null);
});

test('fixture/custom claims cannot be smuggled through catalogue or owned records', () => {
  const base=makeCompactRoom();
  const custom=fromVariant('pebble-table-80','forged-custom');custom.ownership='custom';custom.customProvenance={source:'agent_authored_one_off',tool:'createCustomFurniture'};
  (custom as unknown as Record<string,unknown>).modelUrl='https://example.invalid/table.glb';base.proposal!.layout.furniture.push(custom);
  assert.equal(readSavedRoom(JSON.stringify(base)),null);
  const owned=makeCompactRoom();owned.inventory[0].fixtureType='wall_sconce';owned.inventory[0].wallAnchor={wall:'north',offsetCm:20};
  assert.equal(readSavedRoom(JSON.stringify(owned)),null);
});
