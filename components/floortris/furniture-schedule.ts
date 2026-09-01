import type { AppState, Furniture } from './model.ts';
import { validate } from './sectional-engine.ts';
import { productForVariant } from './provider-catalogues.ts';

export type ScheduleRow={order:number;id:string;name:string;kind:string;dimensions:string;provenance:string;position:string;rotation:string;status:string;warnings:string};
const moveOrder=(item:Furniture)=>item.kind==='rug'?1:['bed','storage','sofa'].includes(item.kind)?2:['desk','table','coffee_table','chair'].includes(item.kind)?3:['window_treatment','ceiling_light','wall_light','floor_lamp','table_lamp','tv'].includes(item.kind)?4:5;
const provenance=(item:Furniture,state:AppState)=>{
  if(state.room.accommodation?.fixedFurnitureIds.includes(item.id))return`provider-supplied · ${state.room.accommodation.providerId}`;
  if(item.ownership==='custom')return'agent-authored measured one-off';
  const product=productForVariant(item.variantId);if(product)return`${product.supplier} · ${product.productId}`;
  return item.ownership==='catalogue'?'local measured catalogue':item.ownership==='owned'?'human-measured owned':'fixed room fixture';
};
export function buildFurnitureSchedule(state:AppState,which:'current'|'proposal'='current'){
  const snapshot=which==='proposal'&&state.proposal?state.proposal:{layout:state.current,room:state.room,rules:state.rules,omitted:[]};
  const report=validate(snapshot.layout,snapshot.room,snapshot.rules,state.inventory),all=[...snapshot.room.fixtures,...snapshot.layout.furniture];
  const rows:ScheduleRow[]=all.map(item=>({order:moveOrder(item),id:item.id,name:item.label,kind:item.kind,dimensions:`${item.sizeCm.w} × ${item.sizeCm.d} × ${item.sizeCm.h??'unknown'} cm`,provenance:provenance(item,state),position:item.wallAnchor?`${item.wallAnchor.segmentId||item.wallAnchor.wall} + ${item.wallAnchor.offsetCm} cm`:`${item.originCell.x*20}, ${item.originCell.y*20} cm`,rotation:`${item.rotation}°`,status:item.ownership==='fixed'?'existing fixture':item.locked.position?'position locked':'move-in item',warnings:report.issues.filter(issue=>issue.objectIds.includes(item.id)).map(issue=>issue.code).join('; ')})).sort((a,b)=>a.order-b.order||a.name.localeCompare(b.name));
  return{room:snapshot.room.name,which,rows,omitted:snapshot.omitted,issues:report.issues,generatedAt:new Date().toISOString()};
}
const csvCell=(value:unknown)=>`"${String(value??'').replaceAll('"','""')}"`;
export function scheduleToCsv(schedule:ReturnType<typeof buildFurnitureSchedule>){
  const headings=['Move order','ID','Name','Kind','Dimensions','Provenance','Position','Rotation','Status','Warnings'];
  const rows=schedule.rows.map(row=>[row.order,row.id,row.name,row.kind,row.dimensions,row.provenance,row.position,row.rotation,row.status,row.warnings]);
  for(const omission of schedule.omitted)rows.push(['',omission.objectId||'',omission.variantId||'Omitted item','omitted','', '', '', '', 'omitted',omission.reason]);
  return[headings,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n');
}
const escapeHtml=(value:unknown)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
export function scheduleToPrintableHtml(schedule:ReturnType<typeof buildFurnitureSchedule>){
  const rows=schedule.rows.map(row=>`<tr><td>${row.order}</td><td><strong>${escapeHtml(row.name)}</strong><br><small>${escapeHtml(row.id)}</small></td><td>${escapeHtml(row.dimensions)}</td><td>${escapeHtml(row.provenance)}</td><td>${escapeHtml(row.position)} · ${escapeHtml(row.rotation)}</td><td>${escapeHtml(row.warnings||'—')}</td></tr>`).join('');
  const omissions=schedule.omitted.length?`<h2>Omitted</h2><ul>${schedule.omitted.map(item=>`<li>${escapeHtml(item.variantId||item.objectId||'Item')}: ${escapeHtml(item.reason)}</li>`).join('')}</ul>`:'';
  return`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(schedule.room)} · move-in schedule</title><style>body{font:14px system-ui;margin:32px;color:#24382b}h1{margin-bottom:4px}p{color:#657268}table{width:100%;border-collapse:collapse;margin-top:24px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #dfe5dc;padding:9px}small{color:#788178}@media print{body{margin:12mm}}</style></head><body><h1>${escapeHtml(schedule.room)}</h1><p>${escapeHtml(schedule.which)} layout · generated locally ${escapeHtml(schedule.generatedAt)} · open this page and choose Print → Save as PDF.</p><table><thead><tr><th>Order</th><th>Item</th><th>Dimensions</th><th>Provenance</th><th>Placement</th><th>Warnings</th></tr></thead><tbody>${rows}</tbody></table>${omissions}<p>Move order: rugs, large furniture, work/surface pieces, mounted/lighting fixtures, then decor. Verify site conditions and all advisory warnings before moving or installing anything.</p></body></html>`;
}
