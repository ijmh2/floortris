import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from './store.ts';
import { registerFloortrisTools, type WebMCPState } from './webmcp.ts';
import { AGENT_TOOL_POLICY, AGENT_UNAVAILABLE, BEDROOM_TOOL_EXAMPLE } from './agent-workflow.ts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AgentGuide from './AgentGuide.tsx';
import type { CommandResult } from './model.ts';
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));

test('unsupported browser is reported honestly and manual store remains usable',()=>{
  const store=createStore();let status:WebMCPState|undefined;
  const dispose=registerFloortrisTools(store,s=>{status=s;},{} as Document);
  assert.equal(status?.state,'unsupported');assert.equal(status?.count,0);
  assert.ok(status?.message.includes(AGENT_UNAVAILABLE));
  assert.equal(store.humanAdd('current','pebble-table-80').operationSucceeded,true);dispose();
});

test('adapter awaits registration and its handlers share the real command store (test double, not native proof)',async()=>{
  const store=createStore();const tools=new Map<string,{execute:(args:Record<string,unknown>,options?:{signal?:AbortSignal})=>Promise<unknown>}>();
  const signals:AbortSignal[]=[];const statuses:WebMCPState[]=[];
  const host={modelContext:{registerTool:async(tool:{name:string;execute:(args:Record<string,unknown>,options?:{signal?:AbortSignal})=>Promise<unknown>},options:{signal:AbortSignal})=>{await Promise.resolve();tools.set(tool.name,tool);signals.push(options.signal);}}};
  const observations:unknown[]=[];
  const dispose=registerFloortrisTools(store,s=>statuses.push(s),host as unknown as Document,r=>{observations.push(r);throw new Error('broken optional UI observer');});
  assert.equal(statuses.at(-1)?.state,'checking');await tick();assert.equal(statuses.at(-1)?.state,'registered');assert.equal(tools.size,15);
  const current=store.getState();const result=await tools.get('createProposal')!.execute({kind:'layout',expectedCurrentRevision:current.currentRevision,expectedRuleRevision:current.ruleRevision,idempotencyKey:'adapter-create'}) as {operationSucceeded:boolean};
  assert.equal(result.operationSucceeded,true);assert.ok(store.getState().proposal);assert.deepEqual(observations,[result]);
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
  assert.ok(statuses.at(-1)?.message.includes(AGENT_UNAVAILABLE));
});

test('the optional agent guide explains native discovery and same-browser visibility without hydration',()=>{
  const guide=renderToStaticMarkup(createElement(AgentGuide));
  assert.match(guide,/not a remote MCP endpoint/);
  assert.match(guide,/does not transfer a room to another browser/);
});

test('the documented bedroom request executes through registered tools and leaves a checkable proposal (adapter test)',async()=>{
  const store=createStore(), original=structuredClone(store.getState());
  type NativeTool={name:string;description:string;execute:(args:Record<string,unknown>)=>Promise<CommandResult>};
  const tools=new Map<string,NativeTool>(), observed:CommandResult[]=[];
  const host={modelContext:{registerTool:(tool:NativeTool)=>{tools.set(tool.name,tool);}}};
  const dispose=registerFloortrisTools(store,()=>{},host as unknown as Document,r=>observed.push(r));
  await tick();
  assert.ok([...tools.values()].every(t=>t.description.includes(AGENT_TOOL_POLICY)));
  assert.ok(!tools.has('applyProposal') && !tools.has('discardProposal'));
  const result=await tools.get('generateRoom')!.execute(BEDROOM_TOOL_EXAMPLE);
  assert.equal(result.operationSucceeded,true,JSON.stringify(result));
  const proposal=store.getState().proposal!;
  assert.equal(proposal.room.widthCm,300);assert.equal(proposal.room.depthCm,450);
  assert.equal(proposal.room.profile?.kind,'bedroom');
  assert.ok(proposal.layout.furniture.some(o=>o.kind==='bed'));
  assert.equal(store.getState().current.furniture.length,0);
  assert.deepEqual(store.getDocuments()[0],original);
  const review=result.review as {state:string;applied:boolean;requiresHumanApply:boolean;storageScope:string;check:{tool:string;args:Record<string,unknown>}};
  assert.equal(review.state,'proposal_only');assert.equal(review.applied,false);assert.equal(review.requiresHumanApply,true);
  const checked=await tools.get(review.check.tool)!.execute(review.check.args);
  assert.equal(checked.operationSucceeded,true);assert.equal(checked.revision,proposal.revision);
  assert.deepEqual(checked.validation,result.validation);
  assert.equal(observed[0].selectedView,'proposal');assert.equal(store.getState().current.furniture.length,0);
  dispose();
});
