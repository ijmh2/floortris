import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDemo } from './data.ts';
import { encodeShareFragment, decodeShareFragment } from './share-links.ts';
import { buildFurnitureSchedule, scheduleToCsv, scheduleToPrintableHtml } from './furniture-schedule.ts';
import { runLocalEvaluation } from './evaluation.ts';

test('server-free share fragments round-trip validated rooms and reject tampering',async()=>{
  const state=makeDemo();state.room.measurementContext={records:[{target:'room',source:'human_confirmed',confidence:1}],assumptions:[]};
  const encoded=await encodeShareFragment(state);assert.ok(encoded.fragment);assert.ok(encoded.compressed);
  const decoded=await decodeShareFragment(`#${encoded.fragment}`);assert.ok(decoded);assert.equal(decoded.room.name,state.room.name);assert.notEqual(decoded.documentId,state.documentId);
  assert.equal(await decodeShareFragment(`#${encoded.fragment!.slice(0,-4)}xxxx`),null);
  assert.equal(await decodeShareFragment('#share=unknown.abc'),null);
});

test('share links use the documented JSON fallback when the safe bound is exceeded',async()=>{
  const state=makeDemo();state.room.measurementContext={records:[],assumptions:Array.from({length:2000},(_,index)=>`${index}-${'x'.repeat(300)}`)};
  const encoded=await encodeShareFragment(state);assert.equal(encoded.fragment,null);assert.match(encoded.reason||'',/JSON export/);
});

test('CSV and printable schedule include measurements, provenance, placement and warnings',()=>{
  const state=makeDemo(),schedule=buildFurnitureSchedule(state);
  const csv=scheduleToCsv(schedule),html=scheduleToPrintableHtml(schedule);
  assert.match(csv,/Dimensions,?"?/);assert.match(csv,/Your sofa/);assert.match(csv,/human-measured owned/);assert.match(csv,/180°/);
  assert.match(html,/move-in schedule/);assert.match(html,/Save as PDF/);assert.match(html,/Your sofa/);assert.doesNotMatch(html,/<script>/);
});

test('local evaluation runs all seven briefs twice and proves human-only Apply',async()=>{
  const report=await runLocalEvaluation();assert.equal(report.cases.length,7);
  assert.equal(report.summary.humanOnlyApplyRate,100);
  assert.ok(report.summary.repeatValidityRate>=85);
  assert.ok(report.summary.toolCalls>=7);
  assert.ok(report.cases.every(item=>item.toolCalls>=1&&item.elapsedMs>=0));
});
