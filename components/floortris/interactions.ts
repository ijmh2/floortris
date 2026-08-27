import { CATALOGUE, fromVariant } from './data.ts';
import { bounds, validate } from './engine.ts';
import { clone, type AppState, type Furniture, type GridCell, type Issue, type Layout, type Room, type Rules, type Wall } from './model.ts';
export type OverlayMode = 'furniture' | 'height' | 'walk' | 'tv' | 'doors';
export type PlacementPatch = Partial<Pick<Furniture, 'originCell' | 'rotation' | 'variantId' | 'wallAnchor'>>;
export const editStamp = (s: AppState, which: 'current' | 'proposal') => `${s.currentRevision}:${s.ruleRevision}:${which === 'proposal' ? `${s.proposal?.id}:${s.proposal?.revision}` : 'current'}`;
export function wallSnap(room: Room, width: number, xCm: number, yCm: number): Furniture['wallAnchor'] {
  const walls: [Wall, number][] = [['north', Math.abs(yCm)], ['east', Math.abs(room.widthCm-xCm)], ['south', Math.abs(room.depthCm-yCm)], ['west', Math.abs(xCm)]];
  const wall = walls.sort((a,b)=>a[1]-b[1])[0][0];
  const horizontal = wall === 'north' || wall === 'south';
  const length = horizontal ? room.widthCm : room.depthCm;
  const offset = Math.round(((horizontal ? xCm : yCm)-width/2)/20)*20;
  return { wall, offsetCm: Math.max(0,Math.min(Math.floor((length-width)/20)*20,offset)) };
}
export function dropPiece(variantId: string, room: Room, layout: Layout, xCm: number, yCm: number): Furniture {
  const piece = fromVariant(variantId,'__drop__');
  if(piece.kind === 'tv') { piece.wallAnchor=wallSnap(room,piece.sizeCm.w,xCm,yCm);piece.targetSofaId=layout.furniture.find(f=>f.kind==='sofa')?.id; }
  else piece.originCell={x:Math.round((xCm-piece.sizeCm.w/2)/20),y:Math.round((yCm-piece.sizeCm.d/2)/20)};
  return piece;
}
export function resizedVariant(piece: Furniture, width: number, depth: number): Furniture {
  if(piece.ownership !== 'catalogue' || piece.locked.size) return piece;
  const variants=CATALOGUE.filter(v=>v.kind===piece.kind);
  const score=(v:typeof variants[number])=>{const b=bounds({...piece,sizeCm:v.sizeCm});return (b.w-width)**2+(b.d-depth)**2;};
  const v=variants.sort((a,b)=>score(a)-score(b))[0];
  return v?{...piece,variantId:v.id,label:v.name,sizeCm:clone(v.sizeCm)}:piece;
}
const signature=(i:Issue)=>`${i.code}|${[...i.objectIds].sort().join(',')}|${i.destinationId||''}`;
/** A hypothetical drag uses the real engine, without mutating either document. */
export function placementPreview(layout:Layout,room:Room,rules:Rules,inventory:Furniture[],piece:Furniture) {
  const next={...layout,furniture:[...layout.furniture.filter(f=>f.id!==piece.id),piece]};
  const before=validate(layout,room,rules,inventory),report=validate(next,room,rules,inventory);
  const existing=new Set(before.issues.filter(i=>i.severity==='block').map(signature));
  return {report,blocking:report.issues.filter(i=>i.severity==='block'&&(i.objectIds.includes(piece.id)||!existing.has(signature(i))))};
}
export function overlayCell(c:GridCell,mode:OverlayMode):{tone:string;label:string}|null {
  const f=c.flags;
  if(mode==='height') return {tone:c.heightClass==='FREE'?'free':c.heightClass==='LOW'?'low':c.heightClass==='TALL'?'tall':'unknown',label:c.heightClass==='UNKNOWN_HEIGHT'?'?':c.heightClass==='FREE'?'·':c.heightClass==='LOW'?'L':'T'};
  if(mode==='tv') return f.includes('tv_unknown')?{tone:'unknown',label:'?'}:f.includes('tv_blocked')?{tone:'blocked',label:'×'}:f.includes('tv_seat')?{tone:'seat',label:'S'}:f.includes('tv_clear')?{tone:'free',label:'·'}:null;
  if(mode==='doors') return f.includes('door_leaf_blocked')?{tone:'blocked',label:'×'}:f.includes('door_swing_reserved')?{tone:'low',label:'/'}:null;
  if(mode==='walk') return f.includes('path_unreachable')?{tone:'blocked',label:'!'}:f.includes('walk_blocked')?{tone:'blocked',label:'×'}:f.includes('path_reachable')?{tone:'seat',label:'↗'}:f.includes('walk_tight')?{tone:'low',label:'!'}:f.includes('walk_clear')?{tone:'free',label:'·'}:null;
  return null;
}
