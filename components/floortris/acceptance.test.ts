import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDemo, fromVariant } from './data.ts';
import { validate, footprintPass, openingMasks, rectCells } from './engine.ts';
import { key, type Door } from './model.ts';

function furnished() {
  const s = makeDemo();
  const tv = fromVariant('frame-tv-120', 'tv');
  tv.wallAnchor = { wall: 'north', offsetCm: 220 }; tv.targetSofaId = 'owned-sofa';
  s.current.furniture.push(tv);
  return s;
}

test('TV has no floor occupancy; all six strip columns are checked; low differs from walkable', () => {
  const s = furnished();
  const table = fromVariant('pebble-table-80', 'table'); table.originCell = { x: 11, y: 6 };
  s.current.furniture.push(table);
  const r = validate(s.current, s.room, s.rules, s.inventory);
  assert.equal(r.validation.hardFailures, 0, JSON.stringify(r.issues));
  assert.equal(r.brief.status, 'satisfied');
  assert.ok(r.cells.every(c => !c.objectIds.includes('tv')));
  const tableCell = r.cells.find(c => c.x === 11 && c.y === 6)!;
  assert.equal(tableCell.heightClass, 'LOW');
  assert.ok(tableCell.flags.includes('tv_clear'));
  assert.ok(tableCell.flags.includes('walk_blocked'));
  const columns = new Set(r.cells.filter(c => c.flags.includes('tv_clear') || c.flags.includes('tv_seat')).map(c => c.x));
  assert.deepEqual([...columns].sort((a,b)=>a-b), [11,12,13,14,15,16]);
  assert.ok(r.flagsSummary.tv_seat > 0);
  assert.ok(r.flagsSummary.tv_seat_out > 0);
  table.sizeCm.h = 100;
  assert.ok(validate(s.current, s.room, s.rules, s.inventory).issues.some(i => i.code === 'tv_blocked'));
  table.sizeCm.h = null;
  assert.ok(validate(s.current, s.room, s.rules, s.inventory).issues.some(i => i.code === 'tv_unknown'));
});

test('rug overlapping sofa does not collide or change the height layer', () => {
  const s = furnished(); const before = validate(s.current, s.room, s.rules, s.inventory);
  const rug = fromVariant('weave-rug-200', 'rug'); rug.originCell={x:9,y:15}; s.current.furniture.push(rug);
  const after = validate(s.current, s.room, s.rules, s.inventory);
  assert.equal(after.validation.hardFailures, before.validation.hardFailures);
  assert.deepEqual(after.cells.map(c=>[c.heightClass,c.objectIds]), before.cells.map(c=>[c.heightClass,c.objectIds]));
});

test('60 cm continuous throat passes the hard footprint and rejects an 80 cm one', () => {
  const s = makeDemo(); s.room.widthCm=180; s.room.depthCm=180;
  const entrance: Door = { id:'e',kind:'door',wall:'south',offsetCm:0,widthCm:180,hinge:'start',swing:'out',angle:90,mechanism:'hinged',entrance:true };
  const blocked = new Set(Array.from({length:9},(_,x)=>x).filter(x=>x<3||x>=6).map(x=>`${x},4`));
  assert.ok(footprintPass(9,9,blocked,3,s.room,[entrance]).reached.has('3,0'));
  assert.ok(!footprintPass(9,9,blocked,4,s.room,[entrance]).reached.has('3,0'));
});

test('diagonally adjacent free squares do not connect', () => {
  const s=makeDemo(); s.room.widthCm=60;s.room.depthCm=60;
  const e:Door={id:'e',kind:'door',wall:'south',offsetCm:0,widthCm:20,hinge:'start',swing:'out',angle:90,mechanism:'hinged',entrance:true};
  const blocked=new Set<string>(); for(let y=0;y<3;y++)for(let x=0;x<3;x++)if(x+y!==2)blocked.add(`${x},${y}`);
  const p=footprintPass(3,3,blocked,1,s.room,[e]);
  assert.ok(p.reached.has('0,2')); assert.ok(!p.reached.has('1,1')); assert.ok(!p.reached.has('2,0'));
});

test('swing reservation and open leaf produce distinct walking flags',()=>{
  const s=furnished();const door=s.room.openings.find(o=>o.kind==='door')!;
  const masks=openingMasks(s.room,door,s.rules);const leaf=new Set(masks.leaf.map(key));
  const r=validate(s.current,s.room,s.rules,s.inventory);
  assert.ok(masks.leaf.length>0);
  assert.ok(masks.leaf.every(c=>r.cells.find(g=>key(g)===key(c))?.flags.includes('walk_blocked')));
  assert.ok(masks.reserve.some(c=>!leaf.has(key(c)) && r.cells.find(g=>key(g)===key(c))?.flags.includes('walk_clear')));
  const plant=fromVariant('fern-40','plant');plant.originCell={x:2,y:20};s.current.furniture.push(plant);
  assert.ok(validate(s.current,s.room,s.rules,s.inventory).issues.some(i=>i.code==='door_swing_obstructed'));
});

test('window height checks are local; unknown opening remains disclosed',()=>{
  const s=furnished(); const plant=fromVariant('fern-40','plant');plant.originCell={x:22,y:6};s.current.furniture.push(plant);
  const w=s.room.openings.find(o=>o.kind==='window')!;assert.equal(w.kind,'window');if(w.kind!=='window')return;w.type='unknown';
  const r=validate(s.current,s.room,s.rules,s.inventory);
  assert.ok(!r.issues.some(i=>i.code==='window_sill_collision'));
  assert.ok(r.issues.some(i=>i.code==='window_opening_unverified'&&i.severity==='warning'));
  plant.originCell={x:0,y:6};
  assert.ok(validate(s.current,s.room,s.rules,s.inventory).issues.some(i=>i.code==='window_sill_collision'));
});

test('clear empty board does not satisfy the lounge or owned brief',()=>{
  const s=makeDemo();s.current.furniture=[];
  const r=validate(s.current,s.room,s.rules,s.inventory);
  assert.equal(r.brief.status,'incomplete');assert.ok(r.brief.missingRequired.includes('owned-sofa'));
  assert.ok(r.brief.missingRequired.includes('kind:sofa'));assert.ok(r.brief.missingRequired.includes('kind:tv'));
});

test('validation is pure and conservative raster excludes boundary-only contact',()=>{
  const s=furnished();const before=JSON.stringify(s);validate(s.current,s.room,s.rules,s.inventory);assert.equal(JSON.stringify(s),before);
  assert.deepEqual(rectCells({x:20,y:20,w:20,d:20}),[{x:1,y:1}]);
  assert.deepEqual(rectCells({x:20,y:20,w:21,d:20}),[{x:1,y:1},{x:2,y:1}]);
});
