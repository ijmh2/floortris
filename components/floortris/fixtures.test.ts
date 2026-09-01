import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOGUE, fromVariant, makeDemo } from './data.ts';
import { validate } from './engine.ts';
import { isFloorOccupant, normalizeFixturePlacement } from './fixture-placement.ts';
import { createStore } from './store.ts';
import { clone, type Furniture } from './model.ts';
import { TOOL_SCHEMAS } from './schemas.ts';

const quiet = () => { const state=makeDemo(); state.rules.requiredKinds=[]; state.inventory=[]; state.current.furniture=[]; return state; };
const issueCodes = (layout: {furniture:Furniture[];appearance:{wall:string;floor:string}}, room=makeDemo().room, rules=makeDemo().rules) => new Set(validate(layout,room,rules,[]).issues.map(i=>i.code));

test('catalogue exposes typed window treatments and every lighting mount', () => {
  const types=new Set(CATALOGUE.map(v=>v.fixtureType).filter(Boolean));
  for(const type of ['curtains','blind','pendant','flush','track','recessed','wall_sconce','floor_lamp','table_lamp']) assert.ok(types.has(type as Furniture['fixtureType']),type);
  const kinds=TOOL_SCHEMAS.listCatalogue.inputSchema.properties!.kind.enum as string[];
  for(const kind of ['window_treatment','ceiling_light','wall_light','floor_lamp','table_lamp']) assert.ok(kinds.includes(kind),kind);
});

test('curtains and blinds derive measured wall geometry from their named window without floor occupancy', () => {
  const state=quiet(), window=state.room.openings.find(o=>o.kind==='window')!;
  const curtain=fromVariant('soft-curtains-160','curtain');curtain.attachedOpeningId=window.id;
  const fitted=normalizeFixturePlacement(curtain,state.room,state.rules,{furniture:[] ,appearance:state.current.appearance});
  assert.deepEqual(fitted.wallAnchor,{wall:'west',offsetCm:60});
  assert.deepEqual(fitted.sizeCm,{w:220,d:15,h:215});assert.equal(fitted.elevationCm,0);assert.equal(isFloorOccupant(fitted),false);
  let report=validate({furniture:[fitted],appearance:state.current.appearance},state.room,state.rules,[]);
  assert.ok(!report.issues.some(i=>i.code.startsWith('window_treatment_')));assert.ok(report.cells.every(c=>!c.objectIds.includes(fitted.id)));
  const blind=fromVariant('line-blind-160','blind');blind.attachedOpeningId=window.id;
  const exact=normalizeFixturePlacement(blind,state.room,state.rules,{furniture:[],appearance:state.current.appearance});
  assert.deepEqual(exact.wallAnchor,{wall:'west',offsetCm:80});assert.deepEqual(exact.sizeCm,{w:180,d:2,h:120});assert.equal(exact.elevationCm,95);
  report=validate({furniture:[exact],appearance:state.current.appearance},state.room,state.rules,[]);
  assert.ok(!report.issues.some(i=>i.code==='curtain_clearance_blocked'||i.code==='window_treatment_detached'));
});

test('curtain projection catches furniture/radiators and same-wall doors, while a blind stays floor-free', () => {
  const state=quiet(), window=state.room.openings.find(o=>o.kind==='window')!;
  const curtain=fromVariant('soft-curtains-160','curtain');curtain.attachedOpeningId=window.id;
  const fitted=normalizeFixturePlacement(curtain,state.room,state.rules,state.current);
  const lamp=fromVariant('stem-floor-lamp-45','lamp');lamp.originCell={x:0,y:6};
  const room=clone(state.room);room.openings.push({id:'west-door',kind:'door',wall:'west',offsetCm:140,widthCm:80,hinge:'start',swing:'out',angle:90,mechanism:'hinged',entrance:false});
  const codes=issueCodes({furniture:[fitted,lamp],appearance:state.current.appearance},room,state.rules);
  assert.ok(codes.has('curtain_clearance_blocked'));assert.ok(codes.has('curtain_door_conflict'));
});

test('ceiling fixtures obey an L-shaped ceiling and disclose the planning head-clearance assumption', () => {
  const state=quiet();state.room={...state.room,widthCm:500,depthCm:500,floorPlan:{kind:'rectilinear',points:[{xCm:0,yCm:0},{xCm:500,yCm:0},{xCm:500,yCm:300},{xCm:300,yCm:300},{xCm:300,yCm:500},{xCm:0,yCm:500}]},openings:[{id:'entry',kind:'door',wall:'south',segmentId:'wall-5',offsetCm:20,widthCm:80,hinge:'start',swing:'in',angle:90,mechanism:'hinged',entrance:true}]};
  const pendant=fromVariant('halo-pendant-45','pendant');pendant.originCell={x:20,y:20};
  const placed=normalizeFixturePlacement(pendant,state.room,state.rules,state.current);
  let codes=issueCodes({furniture:[placed],appearance:state.current.appearance},state.room,state.rules);
  assert.ok(codes.has('ceiling_fixture_outside'));assert.ok(codes.has('ceiling_head_clearance'));assert.equal(placed.elevationCm,185);
  const flush=fromVariant('halo-flush-35','flush');flush.originCell={x:5,y:5};
  const safe=normalizeFixturePlacement(flush,state.room,state.rules,state.current);codes=issueCodes({furniture:[safe],appearance:state.current.appearance},state.room,state.rules);
  assert.ok(!codes.has('ceiling_fixture_outside'));assert.ok(!codes.has('ceiling_head_clearance'));assert.equal(safe.elevationCm,228);
});

test('wall lights require a real segment and reject openings or tall furniture at the mount height', () => {
  const state=quiet(), light=fromVariant('arc-wall-light-24','sconce');light.wallAnchor={wall:'west',offsetCm:80};light.elevationCm=120;
  let codes=issueCodes({furniture:[light],appearance:state.current.appearance},state.room,state.rules);assert.ok(codes.has('wall_light_opening_overlap'));
  light.wallAnchor={wall:'west',offsetCm:300};light.elevationCm=120;
  const cabinet=fromVariant('folio-bookcase-100','cabinet');cabinet.originCell={x:0,y:15};cabinet.rotation=90;
  codes=issueCodes({furniture:[light,cabinet],appearance:state.current.appearance},state.room,state.rules);assert.ok(codes.has('wall_light_furniture_overlap'));
  const detached=clone(light);delete detached.wallAnchor;codes=issueCodes({furniture:[detached],appearance:state.current.appearance},state.room,state.rules);assert.ok(codes.has('wall_light_unassociated'));
  const defaulted=normalizeFixturePlacement({...detached,wallAnchor:{wall:'north',offsetCm:300},elevationCm:0},state.room,state.rules,state.current);assert.equal(defaulted.elevationCm,160);
  const tooHigh={...defaulted,elevationCm:230};codes=issueCodes({furniture:[tooHigh],appearance:state.current.appearance},state.room,state.rules);assert.ok(codes.has('wall_light_height'));
});

test('floor lamps are ordinary solid obstacles and table lamps require full measured support', () => {
  const state=quiet(), floor=fromVariant('stem-floor-lamp-45','floor'), chair=fromVariant('nest-armchair-80','chair');floor.originCell=chair.originCell={x:5,y:5};
  let codes=issueCodes({furniture:[floor,chair],appearance:state.current.appearance},state.room,state.rules);assert.ok(codes.has('solid_overlap'));assert.equal(isFloorOccupant(floor),true);
  const table=fromVariant('pebble-side-45','table');table.originCell={x:8,y:0};
  const lamp=fromVariant('nook-table-lamp-28','table-lamp');lamp.supportObjectId=table.id;
  const supported=normalizeFixturePlacement(lamp,state.room,state.rules,{furniture:[table],appearance:state.current.appearance},true);
  const supportedReport=validate({furniture:[table,supported],appearance:state.current.appearance},state.room,state.rules,[]);
  codes=new Set(supportedReport.issues.map(issue=>issue.code));assert.ok(!codes.has('table_lamp_unsupported'));assert.equal(supported.elevationCm,50);
  assert.ok(!supportedReport.issues.some(issue=>issue.code==='prefer_flush_to_wall'&&issue.objectIds.includes(supported.id)),'a lamp fixed to its support must not receive an independent wall-position warning');
  const moved={...supported,originCell:{x:0,y:0}};codes=issueCodes({furniture:[table,moved],appearance:state.current.appearance},state.room,state.rules);assert.ok(codes.has('table_lamp_unsupported'));
});

test('native fixture placement stays revisioned in Proposal and preserves human Apply authority', async () => {
  const store=createStore(quiet()), initial=clone(store.getState().current), state=store.getState();
  let result=await store.execute('createProposal',{kind:'layout',expectedCurrentRevision:state.currentRevision,expectedRuleRevision:state.ruleRevision,idempotencyKey:'fixtures-draft'});assert.equal(result.operationSucceeded,true);
  let proposal=store.getState().proposal!;
  result=await store.execute('placeFurniture',{proposalId:proposal.id,revision:proposal.revision,variantId:'soft-curtains-160',idempotencyKey:'curtain-without-window-link'});assert.equal(result.operationSucceeded,false);assert.equal(result.error?.code,'invalid_arguments');
  proposal=store.getState().proposal!;
  result=await store.execute('placeFurniture',{proposalId:proposal.id,revision:proposal.revision,variantId:'soft-curtains-160',attachedOpeningId:'window-west',idempotencyKey:'curtain-linked'});assert.equal(result.operationSucceeded,true);
  proposal=store.getState().proposal!;
  const curtain=proposal.layout.furniture.find(o=>o.fixtureType==='curtains')!;assert.equal(curtain.attachedOpeningId,'window-west');assert.deepEqual(curtain.sizeCm,{w:220,d:15,h:215});
  assert.deepEqual(store.getState().current,initial);assert.equal(store.getState().proposal?.kind,'layout');assert.equal('applyProposal' in TOOL_SCHEMAS,false);
});

test('lighting-zone guidance covers seating, reading and circulation without code claims', () => {
  const state=quiet(), sofa=fromVariant('arc-sofa-160','sofa');sofa.originCell={x:12,y:12};
  const floor=fromVariant('stem-floor-lamp-45','reading');floor.lightingZone='seating';floor.originCell={x:0,y:0};
  let report=validate({furniture:[sofa,floor],appearance:state.current.appearance},state.room,state.rules,[]);
  assert.ok(report.checkedRules.includes('lighting_zones'));assert.ok(report.issues.some(i=>i.code==='lighting_zone_mismatch'&&i.message.includes('planning radius')));
  floor.originCell={x:10,y:12};report=validate({furniture:[sofa,floor],appearance:state.current.appearance},state.room,state.rules,[]);
  assert.ok(!report.issues.some(i=>i.code==='lighting_zone_mismatch'&&i.objectIds.includes(floor.id)));
});
