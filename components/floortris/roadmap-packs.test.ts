import test from 'node:test';
import assert from 'node:assert/strict';
import { ACCOMMODATION_PACKS } from './accommodation-packs.ts';
import { makeBedroomSingle } from './samples.ts';
import { validatePersistedDocument } from './document-schema.ts';
import { validate } from './sectional-engine.ts';
import { createStore } from './store.ts';
import { TOOL_SCHEMAS, validateSchema } from './schemas.ts';
import { PROVIDER_PRODUCTS } from './provider-catalogues.ts';

test('local accommodation packs retain provider identity, locks and approved measured inventory', () => {
  assert.equal(ACCOMMODATION_PACKS.length,2);
  for(const pack of ACCOMMODATION_PACKS){
    const state=pack.makeInitial(),context=state.room.accommodation!;
    assert.equal(context.packId,pack.id.replace(/^pack-/,''));
    assert.ok(context.providerId&&context.buildingId&&context.roomId);
    assert.ok(context.approvedVariantIds.length>=6);
    assert.ok(context.fixedFurnitureIds.every(id=>state.current.furniture.some(item=>item.id===id&&item.locked.position&&item.locked.rotation&&item.locked.size)));
    assert.equal(validatePersistedDocument(state),null,pack.id);
  }
});

test('accommodation pack refuses unapproved catalogue and custom proposal furniture', async () => {
  const store=createStore(ACCOMMODATION_PACKS[0].makeInitial()),accepted=store.getState();
  await store.execute('createProposal',{kind:'layout',expectedCurrentRevision:accepted.currentRevision,expectedRuleRevision:accepted.ruleRevision,idempotencyKey:'pack-draft'});
  let p=store.getState().proposal!;
  const refused=await store.execute('placeFurniture',{proposalId:p.id,revision:p.revision,variantId:'arc-sofa-200',originCell:{x:5,y:5},rotation:0,idempotencyKey:'unapproved'});
  assert.equal(refused.operationSucceeded,false);assert.equal(refused.error?.code,'provider_restriction');
  p=store.getState().proposal!;
  const custom=await store.execute('createCustomFurniture',{proposalId:p.id,revision:p.revision,label:'Injected shelf',kind:'storage',widthCm:80,depthCm:30,heightCm:120,positionCm:{xCm:120,yCm:120},rotation:0,appearance:'oak',idempotencyKey:'pack-custom'});
  assert.equal(custom.operationSucceeded,false);assert.equal(custom.error?.code,'provider_restriction');
});

test('static provider catalogue decorates measured variants without live stock dependency', async () => {
  assert.ok(PROVIDER_PRODUCTS.length>=6);
  const store=createStore(),result=await store.execute('listCatalogue',{limit:50});
  assert.equal(result.operationSucceeded,true);
  const catalogue=result.catalogue as {id:string;providerProduct?:{productId:string}}[];
  assert.ok(catalogue.some(item=>item.providerProduct?.productId));
});

test('accessibility pack adds advisory checks without claiming certification or hard-blocking Apply', () => {
  const state=makeBedroomSingle();state.rules.accessibility={id:'test-access',enabled:true,turningCircleCm:250,routeWidthCm:120,doorApproachDepthCm:140,bedTransferCm:120,deskApproachCm:120,reachableStorageMaxCm:120,maxProjectionCm:5};
  const layout=state.proposal!.layout,report=validate(layout,state.room,state.rules,state.inventory);
  assert.ok(report.checkedRules.includes('accessibility_turning_space'));
  const accessibility=report.issues.filter(issue=>issue.code.startsWith('accessibility_'));
  assert.ok(accessibility.length>0);
  assert.ok(accessibility.every(issue=>issue.severity==='warning'&&issue.message.includes('not accessibility certification')));
});

test('drawing measurement provenance is closed and survives agent room generation', async () => {
  const measurementContext={records:[{target:'north wall',source:'labelled',confidence:1,note:'4 m label'},{target:'nook depth',source:'estimated',confidence:.55}],assumptions:['Door offset estimated from the drawing scale.']};
  const schema=TOOL_SCHEMAS.generateRoom.inputSchema;
  const args={name:'Provenance room',widthCm:500,depthCm:500,profile:{kind:'lounge'},openings:[{id:'entrance',kind:'door',wall:'south',offsetCm:20,widthCm:80,hinge:'start',swing:'in',angle:90,mechanism:'hinged',entrance:true}],measurementContext,idempotencyKey:'provenance-room'};
  assert.equal(validateSchema(args,schema),null);
  assert.match(validateSchema({...args,measurementContext:{...measurementContext,parserPrompt:'unsafe'}},schema)||'',/not an accepted property/);
  const store=createStore(),generated=await store.execute('generateRoom',args);
  assert.equal(generated.operationSucceeded,true,JSON.stringify(generated));
  assert.deepEqual(store.getState().room.measurementContext,measurementContext);
  const read=await store.execute('getRoomState',{which:'proposal'});
  assert.deepEqual(read.measurementContext,measurementContext);
});
