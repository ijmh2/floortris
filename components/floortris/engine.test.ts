import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDemo, fromVariant } from './data.ts';
import { bounds, openingMasks, rectCells, validate } from './engine.ts';
import { clone, type AppState, type Candidate, type Report } from './model.ts';
import { createStore } from './store.ts';

function complete(): AppState {
  const state = makeDemo(), tv = fromVariant('frame-tv-120', 'tv');
  tv.wallAnchor = { wall:'north', offsetCm:220 }; tv.targetSofaId = 'owned-sofa'; state.current.furniture.push(tv); return state;
}
const report = (s: AppState) => validate(s.current, s.room, s.rules, s.inventory);
const codes = (s: AppState) => report(s).issues.map(i => i.code);
async function draft(store = createStore()) { const s=store.getState(); const r=await store.execute('createProposal',{kind:'layout',expectedCurrentRevision:s.currentRevision,expectedRuleRevision:s.ruleRevision,idempotencyKey:'create-test'}); assert.equal(r.operationSucceeded,true); return store; }

test('demo is feasible, complete with one wall TV, and has no fabricated warnings', () => {
  const s = complete(), r=report(s); assert.equal(r.validation.status,'ok'); assert.equal(r.brief.status,'satisfied'); assert.equal(r.issues.length,0); assert(r.zones.every(z=>z.reachable));
});
test('wall TV has zero floor cells and target seats are excluded from TV obstacles',()=>{
  const s=complete(),r=report(s); assert.equal(r.cells.filter(c=>c.objectIds.includes('tv')).length,0); assert.equal(r.flagsSummary.tv_seat,6); assert.equal(r.flagsSummary.tv_seat_out,5); assert.equal(r.flagsSummary.tv_blocked,undefined);
});
test('a low table may occupy part of the sofa front if one real approach remains',()=>{
  const s=complete(), table=fromVariant('pebble-table-80','table'); table.originCell={x:13,y:15}; s.current.furniture.push(table);
  assert.equal(report(s).validation.status,'ok'); assert(!codes(s).includes('path_broken')); assert(!codes(s).includes('tv_blocked'));
});
test('a LOW obstruction spanning every sofa-front approach breaks floor access but not TV height rule',()=>{
  const s=complete(), table=fromVariant('pebble-table-80','wide-table'); table.ownership='owned'; table.sizeCm={w:240,d:60,h:38}; table.originCell={x:8,y:15}; s.current.furniture.push(table);
  const r=report(s); assert(r.issues.some(i=>i.code==='path_broken' && i.objectIds.includes('owned-sofa'))); assert(!r.issues.some(i=>i.code==='tv_blocked'));
});
test('linked desk chair is exempt from its pull reservation but remains solid for walking',()=>{
  const s=complete(), desk=fromVariant('line-desk-100','desk'), chair=fromVariant('nest-chair-60','chair'); desk.rotation=270; desk.originCell={x:0,y:4}; chair.originCell={x:3,y:5}; chair.linkedDeskId='desk'; s.current.furniture.push(desk,chair);
  const r=report(s); assert(!r.issues.some(i=>i.code==='chair_pull_blocked')); assert(r.cells.some(c=>c.objectIds.includes('chair') && c.flags.includes('walk_blocked')));
  delete chair.linkedDeskId; assert(codes(s).includes('chair_pull_blocked'));
});
test('door empty sweep remains walkable while its open leaf is blocked',()=>{
  const s=complete(), door=s.room.openings.find(o=>o.kind==='door')!, masks=openingMasks(s.room,door,s.rules), r=report(s);
  assert(masks.reserve.length>masks.leaf.length); assert(masks.leaf.every(c=>r.cells.find(g=>g.x===c.x&&g.y===c.y)?.flags.includes('walk_blocked')));
  assert(masks.reserve.some(c=>r.cells.find(g=>g.x===c.x&&g.y===c.y)?.flags.includes('walk_clear')));
});
test('unknown window mechanism is disclosed; tall pieces elsewhere do not trigger sill policy',()=>{
  const s=complete(); const w=s.room.openings.find(o=>o.kind==='window')!; if(w.kind==='window')w.type='unknown';
  const cabinet=fromVariant('folio-storage-80','cabinet'); cabinet.originCell={x:22,y:3}; s.current.furniture.push(cabinet); const r=report(s);
  assert(r.issues.some(i=>i.code==='window_opening_unverified')); assert(!r.issues.some(i=>i.code==='window_sill_collision'));
});
test('window sill vertical interval allows below-sill pieces and checks a scoped tall piece',()=>{
  const s=complete(), desk=fromVariant('line-desk-100','desk'); desk.originCell={x:0,y:4}; desk.rotation=270; s.current.furniture.push(desk); assert(!codes(s).includes('window_sill_collision'));
  desk.sizeCm.h=120; assert(codes(s).includes('window_sill_collision'));
});
test('radiator projection is separate from its configured front reserve',()=>{
  const s=complete(), table=fromVariant('pebble-table-80','table'); table.originCell={x:25,y:14}; s.current.furniture.push(table); assert(codes(s).includes('radiator_keepout')); assert(!codes(s).includes('solid_overlap'));
});
test('UNKNOWN_HEIGHT is fail-closed in the TV strip',()=>{
  const s=complete(), table=fromVariant('pebble-table-80','unknown'); table.originCell={x:12,y:8}; table.sizeCm.h=null; s.current.furniture.push(table); assert(codes(s).includes('tv_unknown'));
});
test('TV wall attachments use vertical intervals and ceiling bounds',()=>{
  const s=complete(); s.room.openings.push({id:'north-window',kind:'window',wall:'north',offsetCm:200,widthCm:180,sillCm:100,headCm:210,type:'fixed',windowAccess:false}); assert(codes(s).includes('wall_attachment_overlap'));
  const tv=s.current.furniture.find(o=>o.kind==='tv')!; tv.elevationCm=200; assert(codes(s).includes('ceiling_collision'));
});
test('cell raster covers positive area without expanding an exact boundary',()=>{
  assert.deepEqual(rectCells({x:20,y:20,w:20,d:20}),[{x:1,y:1}]); assert.equal(rectCells({x:0,y:0,w:21,d:20}).length,2); assert.equal(bounds({...fromVariant('line-desk-100','desk'),rotation:90}).w,60);
});
test('a partial room edge does not disconnect an otherwise clear south entrance',()=>{
  const s=complete(); s.room.widthCm=501; s.room.depthCm=481; s.room.fixtures=[];
  assert(!report(s).issues.some(i=>i.code==='path_broken' && i.objectIds.includes('entrance')));
  assert(report(s).cells.filter(c=>c.x===25||c.y===24).every(c=>c.flags.includes('walk_blocked')));
});
test('non-grid measured depths get a valid outward-snapped sofa approach',()=>{
  const s=makeDemo(); s.room.fixtures=[]; const sofa=s.current.furniture[0]; sofa.originCell={x:10,y:5}; sofa.rotation=0;
  const r=report(s); assert(!r.issues.some(i=>i.code==='path_broken'&&i.objectIds.includes(sofa.id))); assert.equal(sofa.sizeCm.d,90);
});
test('geometry validity and missing owned requirements remain separate',()=>{
  const s=makeDemo(); s.current.furniture=[]; const r=report(s); assert.equal(r.validation.hardFailures,0); assert.equal(r.brief.status,'incomplete'); assert(r.brief.missingRequired.includes('owned-sofa')); assert(r.brief.missingRequired.includes('kind:sofa'));
});
test('engine is pure across flags, appearance and geometry reports',()=>{
  const s=complete(), before=JSON.stringify(s), first=report(s); assert.equal(JSON.stringify(s),before); s.current.furniture[0].appearance='clay'; const second=report(s); assert.deepEqual(first,second);
});
test('planner completes the demo and never changes the measured locked sofa',async()=>{
  const store=await draft(), before=clone(store.getState().current.furniture[0]), p=store.getState().proposal!; const r=await store.execute('proposeLayout',{proposalId:p.id,revision:p.revision});
  assert.equal(r.operationSucceeded,true); assert.equal(r.status,'ready_for_review'); assert.deepEqual(store.getState().proposal!.layout.furniture.find(o=>o.id===before.id),before); assert.equal(store.getState().current.furniture.length,1);
});
test('finite inputs and unauthorized derived claims are rejected without revision changes',async()=>{
  const store=await draft(),p=store.getState().proposal!;
  for(const patch of [{originCell:{x:NaN,y:0}},{sizeCm:{w:1,d:1,h:1}},{heightClass:'LOW'},{locked:{}},{ownership:'catalogue'},{elevationCm:50}]) { const r=await store.execute('updateFurniture',{proposalId:p.id,revision:p.revision,objectId:'owned-sofa',...patch}); assert.equal(r.operationSucceeded,false); assert.equal(store.getState().proposal!.revision,p.revision); }
});
test('human optional-owned permission plus explicit unlock allows omission, not resize',async()=>{
  const store=createStore(); assert.equal(store.humanSetRequired('owned-sofa',false).operationSucceeded,true); store.humanSetLocks('owned-sofa',{}); await draft(store); const p=store.getState().proposal!;
  const resized=await store.execute('updateFurniture',{proposalId:p.id,revision:p.revision,objectId:'owned-sofa',variantId:'arc-sofa-160'}); assert.equal(resized.error?.code,'owned_resize_forbidden');
  const removed=await store.execute('removeFurniture',{proposalId:p.id,revision:p.revision,objectId:'owned-sofa'}); assert.equal(removed.operationSucceeded,true); assert.equal(store.getState().proposal!.omitted[0].objectId,'owned-sofa'); assert.equal(store.getState().inventory[0].sizeCm.w,220);
});
test('new measured owned records are required and tool geometry stays immutable',async()=>{
  const store=createStore(), result=store.humanAddOwned({label:'Measured chair',kind:'chair',sizeCm:{w:73,d:68,h:91}}); assert.equal(result.operationSucceeded,true); const id=result.objectId as string; assert.equal(store.getState().inventory.find(o=>o.id===id)?.requiredInRoom,true); await draft(store); const p=store.getState().proposal!;
  const r=await store.execute('updateFurniture',{proposalId:p.id,revision:p.revision,objectId:id,sizeCm:{w:60,d:60,h:60}}); assert.equal(r.operationSucceeded,false); assert.equal(store.getState().inventory.find(o=>o.id===id)?.sizeCm.w,73);
});
test('idempotent placement retries never duplicate a piece',async()=>{
  const store=await draft(), p=store.getState().proposal!, args={proposalId:p.id,revision:p.revision,variantId:'frame-tv-120',wallAnchor:{wall:'north',offsetCm:220},targetSofaId:'owned-sofa',idempotencyKey:'place-tv'};
  const first=await store.execute('placeFurniture',args), second=await store.execute('placeFurniture',args); assert.equal(first.operationSucceeded,true); assert.equal(second.idempotentReplay,true); assert.equal(store.getState().proposal!.layout.furniture.filter(o=>o.kind==='tv').length,1);
});
test('candidate validity is local, with full remaining layout status and paginated detail',async()=>{
  const state=complete(), blocking=fromVariant('line-desk-100','bad-desk'); blocking.originCell={x:1,y:21}; state.current.furniture.push(blocking); const store=await draft(createStore(state)), p=store.getState().proposal!;
  const r=await store.execute('findPlacements',{proposalId:p.id,revision:p.revision,variantId:'fern-40',limit:2}); assert.equal(r.operationSucceeded,true); const candidates=r.candidates as Candidate[]; assert(candidates.length>0); assert(candidates.every(c=>c.placementStatus==='valid'&&c.layoutStatus==='blocked')); assert(candidates[0].remainingIssueCount>0);
  const detail=await store.execute('checkLayout',candidates[0].details.args); assert.equal(detail.operationSucceeded,true); assert.equal(detail.scope,'hypothetical_candidate'); assert.equal((detail.validation as Report['validation']).status,'blocked');
});
test('setup commands cannot mutate an accepted layout or current geometry',async()=>{
  const store=await draft(),p=store.getState().proposal!,before=JSON.stringify(store.getState()); const result=await store.execute('setRoomGeometry',{proposalId:p.id,revision:p.revision,widthCm:1000}); assert.equal(result.operationSucceeded,false); assert.equal(JSON.stringify(store.getState()),before);
});
