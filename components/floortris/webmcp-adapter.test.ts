import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from './store.ts';
import { registerFloortrisTools, type WebMCPState } from './webmcp.ts';
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));

test('unsupported browser is reported honestly and manual store remains usable',()=>{
  const store=createStore();let status:WebMCPState|undefined;
  const dispose=registerFloortrisTools(store,s=>{status=s;},{} as Document);
  assert.equal(status?.state,'unsupported');assert.equal(status?.count,0);
  assert.equal(store.humanAdd('current','pebble-table-80').operationSucceeded,true);dispose();
});

test('adapter awaits registration and its handlers share the real command store (test double, not native proof)',async()=>{
  const store=createStore();const tools=new Map<string,{execute:(args:Record<string,unknown>,options?:{signal?:AbortSignal})=>Promise<unknown>}>();
  const signals:AbortSignal[]=[];const statuses:WebMCPState[]=[];
  const host={modelContext:{registerTool:async(tool:{name:string;execute:(args:Record<string,unknown>,options?:{signal?:AbortSignal})=>Promise<unknown>},options:{signal:AbortSignal})=>{await Promise.resolve();tools.set(tool.name,tool);signals.push(options.signal);}}};
  const dispose=registerFloortrisTools(store,s=>statuses.push(s),host as unknown as Document);
  assert.equal(statuses.at(-1)?.state,'checking');await tick();assert.equal(statuses.at(-1)?.state,'registered');assert.equal(tools.size,14);
  const current=store.getState();const result=await tools.get('createProposal')!.execute({kind:'layout',expectedCurrentRevision:current.currentRevision,expectedRuleRevision:current.ruleRevision,idempotencyKey:'adapter-create'}) as {operationSucceeded:boolean};
  assert.equal(result.operationSucceeded,true);assert.ok(store.getState().proposal);
  const before=JSON.stringify(store.getState());const ac=new AbortController();ac.abort();
  const cancelled=await tools.get('proposeLayout')!.execute({proposalId:store.getState().proposal!.id,revision:store.getState().proposal!.revision},{signal:ac.signal}) as {operationSucceeded:boolean};
  assert.equal(cancelled.operationSucceeded,false);assert.equal(JSON.stringify(store.getState()),before);
  dispose();assert.ok(signals.every(s=>s.aborted));
});

test('partial asynchronous registration failure cancels this mount and never claims success',async()=>{
  let count=0;let signal:AbortSignal|undefined;const statuses:WebMCPState[]=[];
  const host={modelContext:{registerTool:async(_tool:unknown,options:{signal:AbortSignal})=>{signal=options.signal;if(++count===3)throw new Error('Permission denied');}}};
  const dispose=registerFloortrisTools(createStore(),s=>statuses.push(s),host as unknown as Document);await tick();
  assert.equal(statuses.at(-1)?.state,'error');assert.equal(statuses.at(-1)?.count,0);assert.ok(signal?.aborted);assert.ok(!statuses.some(s=>s.state==='registered'));dispose();
});
