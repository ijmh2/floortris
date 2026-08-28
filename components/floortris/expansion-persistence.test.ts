import test from 'node:test';
import assert from 'node:assert/strict';
import { readSavedRoom } from './persistence.ts';
import { makeBedroomDouble, makeBedroomSingle, makeHomeOffice, makeBathroomConcept, makeCompactRoom } from './samples.ts';
import { createStore } from './store.ts';
import { CATALOGUE, fromVariant } from './data.ts';
import { conceptClearance, conceptOnWall } from './fixture-geometry.ts';
import { bounds } from './engine.ts';
import { type Furniture, type Wall } from './model.ts';

test('both V1 and V2 saves survive reload with edits, IDs, locks and stale proposal intact', () => {
  for (const version of [1,2] as const) {
    const original=makeCompactRoom(); original.version=version; original.currentRevision=9;
    const piece=fromVariant('fern-40','persisted-plant');piece.originCell={x:7,y:5};piece.appearance='clay';
    original.current.furniture.push(piece); original.current.appearance.wall='stone';
    const loaded=readSavedRoom(JSON.stringify(original));
    assert.deepEqual(loaded,original);
    const migrated=createStore(loaded!).getState();
    assert.deepEqual(migrated.current,original.current);
    assert.deepEqual(migrated.inventory,original.inventory);
    assert.equal(migrated.currentRevision,9);
    assert.equal(migrated.proposal!.baseCurrentRevision,1);
    assert.equal(migrated.proposal!.id,original.proposal!.id);
  }
});

test('every expanded preset round-trips without resetting to its seed', () => {
  for(const make of [makeBedroomSingle,makeBedroomDouble,makeHomeOffice,makeBathroomConcept]){
    const state=createStore(make()).getState();const saved=structuredClone(state);
    saved.currentRevision=8;saved.room.name='My measured room';
    assert.deepEqual(readSavedRoom(JSON.stringify(saved)),saved);
  }
  assert.equal(readSavedRoom('not json'),null);
  assert.equal(readSavedRoom('{"version":99}'),null);
});

test('catalogue profile filters offer no lounge furniture in bathroom concepts', () => {
  assert.ok(CATALOGUE.every(v=>v.recommendedProfiles?.length));
  const bathroom=CATALOGUE.filter(v=>v.recommendedProfiles!.includes('bathroom_concept'));
  assert.ok(bathroom.some(v=>v.id==='weave-mat-80'));
  assert.ok(bathroom.every(v=>['rug','plant'].includes(v.kind)));
});

test('concept fixtures stay measured and face inward on all four anchored walls', () => {
  const state=makeBathroomConcept();const wc=state.room.fixtures.find(f=>f.kind==='toilet')!;
  for(const wall of ['north','east','south','west'] as Wall[]){
    const next=conceptOnWall(wc,state.room,wall,100),b=bounds(next),c=next.clearance!.rect;
    assert.deepEqual(next.sizeCm,wc.sizeCm);
    assert.equal(Math.min(c.w,c.d),60);assert.equal(Math.max(c.w,c.d),80);
    if(wall==='north') {assert.equal(b.y,0);assert.equal(c.y,b.y+b.d);}
    if(wall==='south') {assert.equal(b.y+b.d,state.room.depthCm);assert.equal(c.y+c.d,b.y);}
    if(wall==='east') {assert.equal(b.x+b.w,state.room.widthCm);assert.equal(c.x+c.w,b.x);}
    if(wall==='west') {assert.equal(b.x,0);assert.equal(c.x,b.x+b.w);}
    assert.ok(c.x>=0&&c.y>=0&&c.x+c.w<=state.room.widthCm&&c.y+c.d<=state.room.depthCm);
  }
});

test('concept bath uses a measured long-side zone and towel rail has no invented zone',()=>{
  const f={...makeBathroomConcept().room.fixtures[0],kind:'bath',sizeCm:{w:170,d:75,h:55}} as Furniture;
  assert.deepEqual(conceptClearance(f)!.rect,{x:20,y:75,w:170,d:60});
  assert.equal(conceptClearance({...f,kind:'towel_rail'}),undefined);
});

test('room workspace saves old drafts and new rooms atomically, reloads active and selected rooms', async () => {
  const {saveWorkspaceRoom,loadWorkspaceRoom,readWorkspace}=await import('./persistence.ts');
  const data=new Map<string,string>(), storage={getItem:(k:string)=>data.get(k)||null,setItem:(k:string,v:string)=>{data.set(k,v);}};
  const original=makeCompactRoom(), generated={...makeBedroomDouble(),documentId:'room-new'};
  data.set('legacy',JSON.stringify(original));
  assert.deepEqual(loadWorkspaceRoom(storage,'legacy'),original);
  saveWorkspaceRoom(storage,'legacy',generated,original);
  assert.deepEqual(loadWorkspaceRoom(storage,'legacy'),generated);
  assert.deepEqual(loadWorkspaceRoom(storage,'legacy','original'),original);
  assert.deepEqual(loadWorkspaceRoom(storage,'legacy','missing-room'),generated);
  assert.deepEqual(JSON.parse(data.get('legacy')!),original);
  generated.room.name='Edited bedroom';saveWorkspaceRoom(storage,'legacy',generated);
  assert.equal(readWorkspace(storage,'legacy')!.documents.length,2);
  assert.equal(loadWorkspaceRoom(storage,'legacy')!.room.name,'Edited bedroom');
  const snapshot=data.get('legacy.workspace');
  assert.throws(()=>saveWorkspaceRoom({...storage,setItem:()=>{throw new Error('Quota');}},'legacy',{...generated,documentId:'room-third'},generated));
  assert.equal(data.get('legacy.workspace'),snapshot);
  data.set('legacy.workspace','broken');
  assert.throws(()=>saveWorkspaceRoom(storage,'legacy',generated,original));
  assert.equal(data.get('legacy.workspace'),'broken');
});
