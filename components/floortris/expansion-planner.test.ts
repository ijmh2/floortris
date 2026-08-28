import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from './store.ts';
import { makeBedroomDouble, makeHomeOffice } from './samples.ts';

test('planner retains repeated requested instances with stable unique identifiers', async () => {
  const state = makeBedroomDouble(), store = createStore(state), p = store.getState().proposal!;
  const first = await store.execute('proposeLayout', { proposalId: p.id, revision: p.revision, quantities: [{ variantId: 'nook-bedside-40', quantity: 2 }] });
  assert.equal(first.operationSucceeded, true);
  const after = store.getState().proposal!, bedsides = after.layout.furniture.filter(f => f.variantId === 'nook-bedside-40');
  assert.ok(bedsides.length >= 2); assert.equal(new Set(after.layout.furniture.map(f => f.id)).size, after.layout.furniture.length);
  const second = await store.execute('proposeLayout', { proposalId: after.id, revision: after.revision, quantities: [{ variantId: 'nook-bedside-40', quantity: 2 }] });
  assert.equal(second.operationSucceeded, true);
  assert.equal(new Set(store.getState().proposal!.layout.furniture.map(f => f.id)).size, store.getState().proposal!.layout.furniture.length);
});

test('empty office is planned as a linked desk-chair arrangement before optional storage', async () => {
  const state = makeHomeOffice(); state.proposal!.layout.furniture = [];
  const store = createStore(state), p = store.getState().proposal!;
  const result = await store.execute('proposeLayout', { proposalId: p.id, revision: p.revision });
  assert.equal(result.operationSucceeded, true);
  const objects = store.getState().proposal!.layout.furniture, desk = objects.find(f => f.kind === 'desk'), chair = objects.find(f => f.kind === 'chair');
  assert.ok(desk); assert.equal(chair?.linkedDeskId, desk.id);
  const archive = objects.findIndex(f => f.variantId === 'archive-tall-80');
  assert.ok(archive < 0 || objects.findIndex(f => f.id === desk!.id) < archive);
});
