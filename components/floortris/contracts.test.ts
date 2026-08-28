import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from './store.ts';
import { validate } from './engine.ts';
import { makeCompactRoom, roomSession } from './samples.ts';
import { makeDemo, DEFAULT_RULES } from './data.ts';

test('3 m sample furnishes a separate proposal without changing owned sizes or rules',async()=>{
  const original=makeDemo(),before=structuredClone(original),sample=makeCompactRoom(),p=sample.proposal!;
  assert.deepEqual(original,before);
  assert.equal(sample.room.widthCm,300);assert.equal(sample.room.depthCm,300);
  assert.deepEqual(sample.rules,DEFAULT_RULES);assert.deepEqual(p.rules,sample.rules);
  assert.deepEqual(sample.inventory[0].sizeCm,original.inventory[0].sizeCm);
  assert.deepEqual(sample.inventory[0].locked,original.inventory[0].locked);
  assert.equal(sample.current.furniture.length,1);assert.equal(p.layout.furniture.length,7);
  assert.deepEqual(p.layout.furniture.find(f=>f.id==='owned-sofa'),sample.inventory[0]);
  const report=validate(p.layout,p.room,p.rules,sample.inventory);
  assert.equal(report.validation.hardFailures,0,JSON.stringify(report.issues));
  assert.equal(report.brief.status,'satisfied');assert.ok(report.zones.every(z=>z.reachable));
  assert.ok(report.issues.some(i=>i.code==='walk_tight'));
  assert.ok(report.issues.some(i=>i.code==='prefer_open_floor'));
  const store=createStore(sample);
  assert.equal((await store.execute('updateFurniture',{proposalId:p.id,revision:p.revision,objectId:'owned-sofa',originCell:{x:0,y:0}})).error?.code,'lock_violation');
  assert.deepEqual(store.getState().current,sample.current);
  store.resetDemo(makeCompactRoom());
  assert.deepEqual(store.getState(),sample);
});

test('sample sessions use separate local storage and unknown sample names preserve the original',()=>{
  const original=roomSession(''),sample=roomSession('?sample=3m');
  assert.notEqual(original.storageKey,sample.storageKey);
  assert.equal(original.makeInitial().room.widthCm,600);
  assert.equal(sample.makeInitial().room.widthCm,300);
  assert.equal(roomSession('?sample=unknown').storageKey,original.storageKey);
  const a=sample.makeInitial(),b=sample.makeInitial();
  a.proposal!.layout.furniture[0].appearance='clay';
  assert.equal(b.proposal!.layout.furniture[0].appearance,'moss');
  assert.equal(a.current.furniture[0].appearance,'moss');
});

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

test('human room finish matches the setAppearance tool and never moves geometry',async()=>{
  const store=await draft();
  const before=store.getState(),beforeReport=validate(before.current,before.room,before.rules,before.inventory);

  // Rejected ids never touch the document.
  const bad=store.humanSetRoomFinish('current','wall','not-a-palette');
  assert.equal(bad.operationSucceeded,false);
  assert.equal((bad as {error:{code:string}}).error.code,'invalid_palette');
  assert.equal(store.getState().currentRevision,before.currentRevision);

  // Yours: the finish changes and C advances so a reviewer must see it.
  assert.equal(store.humanSetRoomFinish('current','wall','stone').operationSucceeded,true);
  assert.equal(store.humanSetRoomFinish('current','floor','cork').operationSucceeded,true);
  const after=store.getState();
  assert.equal(after.current.appearance.wall,'stone');
  assert.equal(after.current.appearance.floor,'cork');
  assert.equal(after.currentRevision,before.currentRevision+2);

  // Appearance is not geometry: the engine report is unchanged apart from nothing.
  const afterReport=validate(after.current,after.room,after.rules,after.inventory);
  assert.deepEqual(afterReport.validation,beforeReport.validation);
  assert.deepEqual(afterReport.flagsSummary,beforeReport.flagsSummary);
  assert.deepEqual(afterReport.cells.map(c=>c.heightClass),beforeReport.cells.map(c=>c.heightClass));
  assert.deepEqual(after.current.furniture,before.current.furniture);
});

test('human room finish on a draft advances P and equals the tool result',async()=>{
  const viaHuman=await draft(),viaTool=await draft();
  assert.equal(viaHuman.humanSetRoomFinish('proposal','floor','ash').operationSucceeded,true);
  assert.equal((await viaTool.execute('setAppearance',{...rev(viaTool),target:'floor',paletteId:'ash'})).operationSucceeded,true);
  const h=viaHuman.getState().proposal!,t=viaTool.getState().proposal!;
  assert.equal(h.layout.appearance.floor,'ash');
  assert.deepEqual(h.layout,t.layout);
  assert.equal(h.revision,t.revision);

  // A setup draft holds no layout to refinish.
  const setup=await draft('setup');
  const refused=setup.humanSetRoomFinish('proposal','wall','stone');
  assert.equal(refused.operationSucceeded,false);
  assert.equal((refused as {error:{code:string}}).error.code,'unconfirmed_setup');
});

// Direct-manipulation affordances must retain the authoritative command contracts.
import { fromVariant } from './data.ts';
import { dropPiece, editStamp, overlayCell, placementPreview, resizedVariant, wallSnap } from './interactions.ts';

test('dock drop is atomic: invalid new piece returns to dock without a revision or inventory change',async()=>{
  const store=await draft(),before=store.getState();
  const p=before.proposal!;
  const bad=store.humanAdd('proposal','line-desk-100',{originCell:{x:1,y:19},rotation:0},true);
  assert.equal(bad.operationSucceeded,false);assert.equal(bad.error?.code,'door_swing_obstructed');
  assert.deepEqual(store.getState(),before);
  const good=store.humanAdd('proposal','line-desk-100',{originCell:{x:0,y:4},rotation:270},true);
  assert.equal(good.operationSucceeded,true);assert.equal(store.getState().proposal!.revision,p.revision+1);
  const desk=store.getState().proposal!.layout.furniture.find(f=>f.id===good.objectId)!;
  assert.deepEqual(desk.originCell,{x:0,y:4});assert.equal(desk.rotation,270);
  assert.deepEqual(store.getState().current,before.current);
});

test('wall drop snaps to wall cells, targets the owned sofa, and creates no floor TV',async()=>{
  const store=await draft(),s=store.getState();
  for(const [x,y,wall] of [[280,2,'north'],[599,200,'east'],[300,479,'south'],[0,230,'west']] as const){
    const a=wallSnap(s.room,120,x,y)!;assert.equal(a.wall,wall);assert.equal(a.offsetCm%20,0);
  }
  const tv=dropPiece('frame-tv-120',s.room,s.current,290,0);
  assert.equal(tv.targetSofaId,'owned-sofa');assert.equal(tv.wallAnchor?.wall,'north');
  assert.equal(store.humanAdd('proposal',tv.variantId!,{wallAnchor:tv.wallAnchor,targetSofaId:tv.targetSofaId},true).operationSucceeded,true);
  const p=store.getState().proposal!,r=validate(p.layout,p.room,p.rules,s.inventory);
  assert.equal(r.validation.hardFailures,0);assert.equal(r.brief.status,'satisfied');
});

test('resize selects named dimensions with rotated footprints and never resizes owned furniture',async()=>{
  const store=await draft(),sofa=store.getState().inventory[0];
  assert.deepEqual(resizedVariant(sofa,500,300),sofa);
  const desk=fromVariant('line-desk-100','desk');
  const big=resizedVariant(desk,178,79);assert.equal(big.variantId,'line-desk-180');assert.deepEqual(big.sizeCm,{w:180,d:80,h:74});
  const turned=resizedVariant({...desk,rotation:90},80,180);assert.equal(turned.variantId,'line-desk-180');
  assert.deepEqual(resizedVariant({...desk,locked:{size:true}},180,80).sizeCm,desk.sizeCm);
});

test('drag ghost uses real rule codes without mutating the document',async()=>{
  const store=await draft(),s=store.getState(),before=JSON.stringify(s);
  const piece={...fromVariant('line-desk-100','ghost'),originCell:{x:1,y:19}};
  const preview=placementPreview(s.current,s.room,s.rules,s.inventory,piece);
  assert.ok(preview.blocking.some(i=>i.code==='door_swing_obstructed'));
  assert.equal(JSON.stringify(store.getState()),before);
  assert.deepEqual(overlayCell({x:0,y:0,heightClass:'LOW',flags:['walk_blocked','tv_clear'],objectIds:['table']},'walk'),{tone:'blocked',label:'×'});
  assert.deepEqual(overlayCell({x:0,y:0,heightClass:'LOW',flags:['walk_blocked','tv_clear'],objectIds:['table']},'tv'),{tone:'free',label:'·'});
});

test('proposal pins protect new catalogue pieces while owned lock authority remains in Yours',async()=>{
  const store=await draft();const added=store.humanAdd('proposal','line-desk-100');const id=added.objectId as string;
  assert.equal(store.humanSetLocks(id,{position:true,rotation:true},'proposal').operationSucceeded,true);
  assert.equal((await store.execute('updateFurniture',{...rev(store),objectId:id,originCell:{x:4,y:3}})).error?.code,'lock_violation');
  const before=store.getState();assert.equal(store.humanSetLocks('owned-sofa',{},'proposal').operationSucceeded,false);assert.deepEqual(store.getState(),before);
  assert.equal(store.humanSetLocks(id,{},'proposal').operationSucceeded,true);
  const stamp=editStamp(store.getState(),'proposal');store.humanSetRoomFinish('current','wall','stone');
  assert.notEqual(editStamp(store.getState(),'proposal'),stamp);
  assert.equal(store.humanSetLocks(id,{position:true},'proposal').error?.code,'stale_proposal');
});
