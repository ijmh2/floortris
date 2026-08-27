import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from './store.ts';
import { validate } from './engine.ts';

async function draft(kind:'layout'|'setup'='layout') {
  const store=createStore();const state=store.getState();
  assert.equal((await store.execute('createProposal',{kind,expectedCurrentRevision:state.currentRevision,expectedRuleRevision:state.ruleRevision,idempotencyKey:'create-one'})).operationSucceeded,true);
  return store;
}
function rev(store:ReturnType<typeof createStore>) {const p=store.getState().proposal!;return {proposalId:p.id,revision:p.revision};}

test('all read tools and malformed writes preserve state',async()=>{
  const store=await draft(); const before=JSON.stringify(store.getState());
  for(const [name,args] of [['getRoomState',{which:'proposal'}],['listFurniture',{which:'proposal'}],['listCatalogue',{}],['checkLayout',{which:'proposal',detail:'flags',limit:4}]] as const){
    assert.equal((await store.execute(name,args)).operationSucceeded,true,name);assert.equal(JSON.stringify(store.getState()),before,name);
  }
  for(const patch of [{heightClass:'FREE'},{sizeCm:{w:20,d:20,h:1}},{ownership:'catalogue'},{originCell:{x:NaN,y:0}},{rotation:45}]) {
    const result=await store.execute('updateFurniture',{...rev(store),objectId:'owned-sofa',...patch});
    assert.equal(result.operationSucceeded,false,JSON.stringify(patch));assert.equal(JSON.stringify(store.getState()),before);
  }
});

test('owned locks and required status reject move and removal through tools',async()=>{
  const store=await draft();const before=JSON.stringify(store.getState());
  assert.equal((await store.execute('updateFurniture',{...rev(store),objectId:'owned-sofa',originCell:{x:1,y:1}})).operationSucceeded,false);
  assert.equal((await store.execute('removeFurniture',{...rev(store),objectId:'owned-sofa'})).operationSucceeded,false);
  assert.equal(JSON.stringify(store.getState()),before);
});

test('setup cannot change Current until the human confirms it; layouts cannot weaken rules',async()=>{
  const store=await draft('setup');const before=structuredClone(store.getState());
  const edit=await store.execute('setRoomGeometry',{...rev(store),widthCm:640});assert.equal(edit.operationSucceeded,true);
  assert.equal(store.getState().room.widthCm,before.room.widthCm);assert.equal(store.getState().proposal!.room.widthCm,640);
  assert.equal(store.getState().currentRevision,before.currentRevision);
  const p=rev(store);assert.equal(store.confirmSetup(p.proposalId,p.revision).operationSucceeded,true);
  assert.equal(store.getState().room.widthCm,640);
  const layout=await draft();
  assert.equal((await layout.execute('setConstraints',{...rev(layout),constraints:{walkHardCm:20,requiredKinds:[]}})).operationSucceeded,false);
});

test('creation and placement retries do not duplicate records',async()=>{
  const store=createStore();const start=store.getState();const args={kind:'layout',expectedCurrentRevision:start.currentRevision,expectedRuleRevision:start.ruleRevision,idempotencyKey:'same-create'};
  assert.equal((await store.execute('createProposal',args)).operationSucceeded,true);const after=JSON.stringify(store.getState());
  assert.equal((await store.execute('createProposal',args)).operationSucceeded,true);assert.equal(JSON.stringify(store.getState()),after);
  const placement={...rev(store),variantId:'pebble-table-80',originCell:{x:12,y:12},idempotencyKey:'same-place'};
  assert.equal((await store.execute('placeFurniture',placement)).operationSucceeded,true);const placed=JSON.stringify(store.getState());
  assert.equal((await store.execute('placeFurniture',placement)).operationSucceeded,true);assert.equal(JSON.stringify(store.getState()),placed);
});

test('palette changes cannot change geometry or semantic cell flags',async()=>{
  const store=await draft();const p=store.getState().proposal!;const before=validate(p.layout,p.room,p.rules,store.getState().inventory);
  assert.equal((await store.execute('setAppearance',{...rev(store),target:'furniture',objectId:'owned-sofa',paletteId:'clay'})).operationSucceeded,true);
  const next=store.getState().proposal!;assert.deepEqual(validate(next.layout,next.room,next.rules,store.getState().inventory),before);
});

test('human proposal edit rejects an old agent revision; Apply rejects an unreviewed revision',async()=>{
  const store=await draft();const old=rev(store);
  assert.equal(store.humanAdd('proposal','pebble-table-80').operationSucceeded,true);
  const after=JSON.stringify(store.getState());
  assert.equal((await store.execute('setAppearance',{...old,target:'wall',paletteId:'stone'})).operationSucceeded,false);
  assert.equal(store.applyProposal(old.proposalId,old.revision).operationSucceeded,false);
  assert.equal(JSON.stringify(store.getState()),after);
});

test('already cancelled planner does not commit',async()=>{
  const store=await draft();const before=JSON.stringify(store.getState());const ac=new AbortController();ac.abort();
  assert.equal((await store.execute('proposeLayout',rev(store),ac.signal)).operationSucceeded,false);
  assert.equal(JSON.stringify(store.getState()),before);
});

test('intervening human edit prevents the planner from overwriting its revision',async()=>{
  const store=await draft();const plan=store.execute('proposeLayout',rev(store));
  assert.equal(store.humanAdd('proposal','fern-40').operationSucceeded,true);const after=JSON.stringify(store.getState());
  const result=await plan;assert.equal(result.operationSucceeded,false);assert.equal(JSON.stringify(store.getState()),after);
});

test('planner fixture completes required lounge while preserving the locked owned sofa',async()=>{
  const store=await draft();const sofa=structuredClone(store.getState().proposal!.layout.furniture.find(o=>o.id==='owned-sofa'));
  const result=await store.execute('proposeLayout',rev(store));assert.equal(result.operationSucceeded,true,JSON.stringify(result));
  const p=store.getState().proposal!;assert.deepEqual(p.layout.furniture.find(o=>o.id==='owned-sofa'),sofa);
  const report=validate(p.layout,p.room,p.rules,store.getState().inventory);assert.equal(report.validation.hardFailures,0,JSON.stringify(report.issues));assert.equal(report.brief.status,'satisfied');
  assert.equal(store.applyProposal(p.id,p.revision).operationSucceeded,true);assert.equal(store.getState().proposal,null);
});

test('candidate references become invalid after a palette mutation',async()=>{
  const store=await draft();const result=await store.execute('findPlacements',{...rev(store),variantId:'pebble-table-80',limit:1});
  assert.equal(result.operationSucceeded,true);const candidate=(result.candidates as Array<{candidateId:string}>)[0];assert.ok(candidate);
  assert.equal((await store.execute('setAppearance',{...rev(store),target:'wall',paletteId:'stone'})).operationSucceeded,true);const before=JSON.stringify(store.getState());
  assert.equal((await store.execute('placeFurniture',{...rev(store),candidateId:candidate.candidateId,idempotencyKey:'stale-candidate'})).operationSucceeded,false);
  assert.equal(JSON.stringify(store.getState()),before);
});

test('demo repair journey: real door conflict, checked placement, exact reviewed Apply',async()=>{
  const store=await draft();assert.equal((await store.execute('proposeLayout',rev(store))).operationSucceeded,true);
  const desk=store.getState().proposal!.layout.furniture.find(o=>o.kind==='desk')!;assert.ok(desk);
  assert.equal(store.humanUpdate('proposal',desk.id,{originCell:{x:2,y:20}}).operationSucceeded,true);
  const broken=store.getState().proposal!;assert.ok(validate(broken.layout,broken.room,broken.rules,store.getState().inventory).issues.some(i=>i.code==='door_swing_obstructed'));
  assert.equal(store.applyProposal(broken.id,broken.revision).operationSucceeded,false);
  const found=await store.execute('findPlacements',{...rev(store),objectId:desk.id,limit:1});assert.equal(found.operationSucceeded,true);
  const candidate=(found.candidates as Array<{candidateId:string}>)[0];assert.ok(candidate,'A real repair must be found');
  assert.equal((await store.execute('updateFurniture',{...rev(store),objectId:desk.id,candidateId:candidate.candidateId})).operationSucceeded,true);
  const repaired=store.getState().proposal!;assert.equal(validate(repaired.layout,repaired.room,repaired.rules,store.getState().inventory).validation.hardFailures,0);
  assert.equal(store.applyProposal(repaired.id,repaired.revision).operationSucceeded,true);
});
