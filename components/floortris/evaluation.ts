import { BENCHMARKS } from './benchmarks.ts';
import { validate } from './sectional-engine.ts';
import { createStore } from './store.ts';

export type EvalCaseResult={id:string;briefComplete:boolean;complete:boolean;hardViolations:number;toolCalls:number;elapsedMs:number;rejections:number;humanOnlyApply:boolean;repeatValid:boolean};
export type EvalReport={suiteId:string;generatedAt:string;cases:EvalCaseResult[];summary:{briefCompletionRate:number;hardViolations:number;toolCalls:number;elapsedMs:number;rejections:number;humanOnlyApplyRate:number;repeatValidityRate:number}};
async function one(id:string){
  const benchmark=BENCHMARKS.find(item=>item.id===id)!;const initial=benchmark.makeInitial(),store=createStore(initial),before=structuredClone(store.getState().current);let proposal=store.getState().proposal!;
  const started=performance.now(),result=await store.execute('proposeLayout',{proposalId:proposal.id,revision:proposal.revision,strategy:id==='benchmark-accessible-studio'?'maximum_open_floor':'tv_focused',idempotencyKey:`eval-${id}`});
  proposal=store.getState().proposal!;const report=validate(proposal.layout,proposal.room,proposal.rules,store.getState().inventory),elapsedMs=Math.round(performance.now()-started),log=store.getToolLog();
  return{result,report,layout:JSON.stringify(proposal.layout),elapsedMs,toolCalls:log.length,rejections:log.filter(entry=>!entry.ok).length,humanOnlyApply:JSON.stringify(store.getState().current)===JSON.stringify(before)};
}
export async function runLocalEvaluation():Promise<EvalReport>{
  const cases:EvalCaseResult[]=[];
  for(const benchmark of BENCHMARKS){
    const first=await one(benchmark.id),second=await one(benchmark.id);
    cases.push({id:benchmark.id,briefComplete:first.report.brief.status==='satisfied',complete:first.result.operationSucceeded===true&&first.report.validation.hardFailures===0&&first.report.brief.status==='satisfied',hardViolations:first.report.validation.hardFailures,toolCalls:first.toolCalls,elapsedMs:first.elapsedMs,rejections:first.rejections,humanOnlyApply:first.humanOnlyApply,repeatValid:second.result.operationSucceeded===true&&second.report.validation.hardFailures===first.report.validation.hardFailures&&second.report.brief.status===first.report.brief.status&&second.layout===first.layout});
  }
  const percentage=(count:number)=>Math.round(count/cases.length*100);
  return{suiteId:'floortris-local-benchmarks-v1',generatedAt:new Date().toISOString(),cases,summary:{briefCompletionRate:percentage(cases.filter(item=>item.briefComplete).length),hardViolations:cases.reduce((sum,item)=>sum+item.hardViolations,0),toolCalls:cases.reduce((sum,item)=>sum+item.toolCalls,0),elapsedMs:cases.reduce((sum,item)=>sum+item.elapsedMs,0),rejections:cases.reduce((sum,item)=>sum+item.rejections,0),humanOnlyApplyRate:percentage(cases.filter(item=>item.humanOnlyApply).length),repeatValidityRate:percentage(cases.filter(item=>item.repeatValid).length)}};
}

/** Checked-in evidence is intentionally labelled as a snapshot; the dashboard
 * can rerun the same deterministic suite entirely in this browser. */
export const BUNDLED_EVAL_REPORT:EvalReport={suiteId:'floortris-local-benchmarks-v1',generatedAt:'2026-09-01T15:37:09.181Z',cases:[
  {id:'benchmark-l-shape',briefComplete:true,complete:true,hardViolations:0,toolCalls:1,elapsedMs:456,rejections:0,humanOnlyApply:true,repeatValid:true},
  {id:'benchmark-u-sectional',briefComplete:true,complete:true,hardViolations:0,toolCalls:1,elapsedMs:1569,rejections:0,humanOnlyApply:true,repeatValid:true},
  {id:'benchmark-tv-door',briefComplete:true,complete:true,hardViolations:0,toolCalls:1,elapsedMs:105,rejections:0,humanOnlyApply:true,repeatValid:true},
  {id:'benchmark-narrow-bedroom',briefComplete:true,complete:true,hardViolations:0,toolCalls:1,elapsedMs:234,rejections:0,humanOnlyApply:true,repeatValid:true},
  {id:'benchmark-accessible-studio',briefComplete:true,complete:true,hardViolations:0,toolCalls:1,elapsedMs:675,rejections:0,humanOnlyApply:true,repeatValid:true},
  {id:'benchmark-window-radiator',briefComplete:true,complete:false,hardViolations:2,toolCalls:1,elapsedMs:268,rejections:0,humanOnlyApply:true,repeatValid:true},
  {id:'benchmark-awkward-nook',briefComplete:true,complete:true,hardViolations:0,toolCalls:1,elapsedMs:510,rejections:0,humanOnlyApply:true,repeatValid:true},
],summary:{briefCompletionRate:100,hardViolations:2,toolCalls:7,elapsedMs:3817,rejections:0,humanOnlyApplyRate:100,repeatValidityRate:100}};
