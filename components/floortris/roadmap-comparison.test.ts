import test from 'node:test';
import assert from 'node:assert/strict';
import { BENCHMARKS } from './benchmarks.ts';
import { makeDemo } from './data.ts';
import { validatePersistedDocument } from './document-schema.ts';
import { createStore } from './store.ts';

test('strategy comparison checks three isolated alternatives and never applies one', async () => {
  const store=createStore(makeDemo()), before=structuredClone(store.getState());
  const alternatives=await store.generateStrategyAlternatives();
  assert.deepEqual(alternatives.map(item=>item.strategy),['maximum_open_floor','social_conversation','tv_focused']);
  assert.deepEqual(store.getState(),before,'comparison is read-only');
  for(const alternative of alternatives){
    assert.ok(alternative.report.checkedRules.length>10);
    assert.equal(alternative.baseCurrentRevision,before.currentRevision);
    assert.equal(alternative.baseRuleRevision,before.ruleRevision);
    assert.ok(alternative.score>=0&&alternative.score<=100);
    assert.equal(alternative.tradeoffs.length,4);
  }
  const safe=alternatives.find(item=>item.report.validation.hardFailures===0);
  assert.ok(safe,'at least one checked demo strategy should be selectable');
  const selected=store.selectStrategyAlternative(safe.id);
  assert.equal(selected.operationSucceeded,true,JSON.stringify(selected));
  assert.deepEqual(store.getState().current,before.current,'selection still does not Apply');
  assert.equal(store.getState().proposal?.layout.furniture.length,safe.layout.furniture.length);
});

test('strategy results expire when Current changes', async () => {
  const store=createStore(makeDemo()), alternatives=await store.generateStrategyAlternatives();
  const changed=store.humanSetRoomFinish('current','wall','cream');
  assert.equal(changed.operationSucceeded,true);
  const stale=store.selectStrategyAlternative(alternatives[0].id);
  assert.equal(stale.operationSucceeded,false);
  assert.equal(stale.error?.code,'revision_conflict');
});

test('benchmark gallery ships seven closed, locally valid challenge documents', () => {
  assert.deepEqual(BENCHMARKS.map(item=>item.id),[
    'benchmark-l-shape','benchmark-u-sectional','benchmark-tv-door','benchmark-narrow-bedroom',
    'benchmark-accessible-studio','benchmark-window-radiator','benchmark-awkward-nook',
  ]);
  for(const benchmark of BENCHMARKS){
    assert.ok(benchmark.suggestedPrompt.length>30);
    const state=benchmark.makeInitial();
    assert.equal(validatePersistedDocument(state),null,benchmark.id);
    assert.ok(state.proposal,'benchmarks open visibly as proposals');
  }
});
