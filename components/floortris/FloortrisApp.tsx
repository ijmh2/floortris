import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { CATALOGUE, PALETTES } from './data.ts';
import { roomSession } from './samples.ts';
import { documentId, loadWorkspaceRoom, readWorkspace, saveWorkspaceRoom } from './persistence.ts';
import { bounds, validate, wallBand } from './engine.ts';
import { faces, type AppState, type Candidate, type CommandResult, type Furniture, type Issue, type Layout, type Report, type Room, type Rules, type Wall, type Rotation, type Cell } from './model.ts';
import { createStore, proposalStatus, type FloortrisStore } from './store.ts';
import { registerFloortrisTools, type WebMCPState } from './webmcp.ts';
import './floortris.css';
import './room3d.css';
import './finishes.css';
import RoomEditor from './RoomEditor.tsx';
import FinishPicker from './FinishPicker.tsx';
import RoomPicker from './RoomPicker.tsx';
import { ROOM_PRESETS, dockVariants, VariantPreview } from './RoomLibrary.tsx';
const Room3D = lazy(() => import('./Room3D.tsx'));
class ThreeViewBoundary extends React.Component<{ children: React.ReactNode; onReturn: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <div className="ft-3d-loading" role="alert"><p>3D could not load. Your room is preserved.</p><button className="ft-button ft-secondary" onClick={this.props.onReturn}>Back to 2D</button></div> : this.props.children; }
}

import { dropPiece, editStamp, overlayCell, placementPreview, resizedVariant, wallSnap, type OverlayMode, type PlacementPatch } from './interactions.ts';
type View = 'current' | 'proposal' | 'compare';

const uid = () => typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `human-${Date.now()}-${Math.random()}`;
const fmt = (n: number) => Number.isInteger(n) ? String(n) : n.toFixed(1);
const nice = (s: string) => s.replaceAll('_', ' ').replace('kind:', '');
const issueNames: Record<string, string> = {
  out_of_room: 'Outside the room', ceiling_collision: 'Above the ceiling', solid_overlap: 'Furniture overlaps',
  door_approach_blocked: 'Entrance needs attention', unsupported_opening: 'Opening needs attention', door_swing_obstructed: 'Door swing blocked',
  window_envelope_blocked: 'Window opening blocked', window_sill_collision: 'Window clearance blocked', window_opening_unverified: 'Window opening unverified',
  radiator_keepout: 'Radiator clearance blocked', path_broken: 'Route blocked', walk_tight: 'Route is tight',
  fixture_clearance_blocked: 'Fixture clearance blocked', fixture_clearance_unreachable: 'Fixture is unreachable',
  prefer_bedside_near_bed: 'Bedside table is misplaced', bedside_route_conflict: 'Bedside route is tight', prefer_desk_window: 'Desk is away from the window',
  bed_access_blocked: 'Bed access blocked', prefer_bed_two_sides: 'Second bed side preferred', tv_unassociated: 'TV setup incomplete',
  tv_facing_wrong: 'Sofa faces away from the TV', wall_attachment_overlap: 'Wall items overlap', tv_blocked: 'TV view blocked',
  tv_unknown: 'TV view needs a height', tv_no_seat: 'Sofa is outside the TV view', desk_chair_missing: 'Desk needs a chair',
  chair_facing_wrong: 'Chair faces away from the desk', chair_desk_offset: 'Chair is off-centre', prefer_flush_to_wall: 'Small wall gap',
  bedside_flanks_head: 'Bedside table is misplaced', rug_under_group: 'Rug is outside the furniture group', table_centred_on_sofa: 'Table is off-centre',
  prefer_even_distribution: 'Furniture is unevenly distributed', prefer_open_floor: 'Open floor preference not met',
};
const issueName = (issue: Pick<Issue, 'code'>) => issueNames[issue.code] || nice(issue.code).replace(/^./, letter => letter.toUpperCase());
const palette = (id: string) => PALETTES.furniture.find(p => p.id === id)?.color || '#c9c5b9';
function Chevron({ open = false }: { open?: boolean }) { return <svg className={`ft-menu-chevron${open ? ' is-open' : ''}`} viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>; }
function HistoryIcon({ forward = false }: { forward?: boolean }) { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={forward ? 'm15 7 5 5-5 5M20 12H9a5 5 0 0 0-5 5' : 'm9 7-5 5 5 5M4 12h11a5 5 0 0 1 5 5'} /></svg>; }
function loadState(session: ReturnType<typeof roomSession>): AppState {
  try { const saved = loadWorkspaceRoom(localStorage, session.storageKey, new URLSearchParams(window.location.search).get('room')); if (saved) return saved; } catch { /* Storage may be unavailable in private browsing. */ }
  return session.makeInitial();
}
/** The URL mirrors the open sample library and room; it never drives navigation. */
function syncSampleUrl(sample: string, roomId?: string) {
  const url = new URL(window.location.href);
  if (roomId) url.searchParams.set('room', roomId);
  if (sample === 'local') url.searchParams.delete('sample'); else url.searchParams.set('sample', sample);
  window.history.replaceState(null, '', url);
}
function Brand() { return <div className="ft-brand"><span className="ft-brandmark"><i /><i /><i /><i /><i /></span><span>floortris<span className="ft-brand-dot">.</span></span></div>; }
function Shape({ item, small = false }: { item: Furniture | { kind: string; appearance?: string; rotation?: number }; small?: boolean }) {
  return <div className={`ft-shape ft-shape-${item.kind} ft-face-${faces[(item.rotation || 0) as Rotation]} ${small ? 'ft-shape-small' : ''}`} style={{ '--piece-color': palette(item.appearance || 'oak') } as React.CSSProperties}>
    {item.kind === 'sofa' && <><i className="ft-sofa-back" /><i className="ft-sofa-arm ft-arm-a" /><i className="ft-sofa-arm ft-arm-b" /><div className="ft-cushions"><i /><i /><i /></div></>}
    {item.kind === 'desk' && <><i className="ft-desk-book" /><i className="ft-desk-pad" /><i className="ft-desk-cup" /></>}
    {item.kind === 'coffee_table' && <><i className="ft-table-book" /><i className="ft-table-bowl" /></>}
    {item.kind === 'chair' && <><i className="ft-chair-back" /><i className="ft-chair-seat" /></>}
    {item.kind === 'storage' && <><i /><i /></>}
    {item.kind === 'plant' && <><i /><i /><i /></>}
    {['bed','basin','toilet','shower','bath','towel_rail'].includes(item.kind) && <div className="ft-measured-glyph" style={{ transform: `translate(-50%, -50%) rotate(${item.rotation || 0}deg)`, ...('sizeCm' in item && (item.rotation === 90 || item.rotation === 270) ? { width: `${item.sizeCm.w/item.sizeCm.d*100}%`, height: `${item.sizeCm.d/item.sizeCm.w*100}%` } : {}) }}><i className="ft-glyph-back"/><i className="ft-glyph-body"/><i className="ft-glyph-detail"/>{item.kind==='bed' && <i className="ft-glyph-pillow"/>}</div>}
  </div>;
}
function Board({ layout, room, rules, inventory, report, title, revision, compact, selected, onSelect, onEdit, onPin, onNotice, mode, editable, stamp, suggestions, onAccept, draggedVariant, onDropVariant, focusCells, onEditRoom }: {
  layout:Layout;room:Room;rules:Rules;inventory:Furniture[];report:Report;title:string;revision:number;compact?:boolean;selected:string|null;
  onSelect:(id:string|null)=>void;onEdit:(id:string,patch:PlacementPatch,stamp:string)=>void;onPin:(id:string)=>void;onNotice:(text:string)=>void;
  mode:OverlayMode;editable:boolean;stamp:string;suggestions:Candidate[];onAccept:(c:Candidate)=>void;draggedVariant:string|null;onDropVariant:(piece:Furniture,stamp:string)=>void;focusCells:Cell[];onEditRoom:()=>void;
}) {
  const [zonesOpen, setZonesOpen] = useState(false);
  const board=useRef<HTMLDivElement>(null);
  const [zoneId,setZoneId]=useState<string|null>(null);
  const focused=new Set(focusCells.map(c=>`${c.x},${c.y}`));
  const activeZone=report.zones.find(z=>z.id===zoneId);
  const zoneTone=(z:Report['zones'][number])=>!z.reachable||report.issues.some(i=>i.severity==='block'&&['fixture_clearance_blocked','storage_front_blocked','chair_pull_blocked'].includes(i.code)&&i.objectIds[0]===z.objectId)?'blocked':z.preferredReachable?'clear':'tight';
  type Drag={piece:Furniture;startX:number;startY:number;cellX:number;cellY:number;stamp:string;resize:boolean};
  const drag=useRef<Drag|null>(null);
  const [ghost,setGhost]=useState<Furniture|null>(null),[dockPoint,setDockPoint]=useState<{x:number;y:number}|null>(null);
  const position=(r:{x:number;y:number;w:number;d:number})=>({left:`${r.x/room.widthCm*100}%`,top:`${r.y/room.depthCm*100}%`,width:`${r.w/room.widthCm*100}%`,height:`${r.d/room.depthCm*100}%`});
  const displayBounds=(p:Furniture)=>p.kind==='tv' && p.wallAnchor?wallBand(room,p.wallAnchor.wall,p.wallAnchor.offsetCm,p.sizeCm.w,14):bounds(p);
  const point=(clientX:number,clientY:number)=>{const r=board.current!.getBoundingClientRect();return{x:(clientX-r.left-board.current!.clientLeft)/board.current!.clientWidth*room.widthCm,y:(clientY-r.top-board.current!.clientTop)/board.current!.clientHeight*room.depthCm};};
  const down=(e:React.PointerEvent<HTMLButtonElement>,p:Furniture,resize=false)=>{
    e.stopPropagation();onSelect(p.id);
    if(!editable)return;
    if(resize?p.locked.size:p.locked.position){onNotice('Unlock first. Use the pin on the piece.');return;}
    if(!board.current)return;e.currentTarget.setPointerCapture(e.pointerId);
    drag.current={piece:p,startX:e.clientX,startY:e.clientY,cellX:board.current.clientWidth/room.widthCm,cellY:board.current.clientHeight/room.depthCm,stamp,resize};
  };
  const dragPiece=(clientX:number,clientY:number)=>{
    const d=drag.current;if(!d)return null;
    const dx=(clientX-d.startX)/d.cellX,dy=(clientY-d.startY)/d.cellY;
    if(d.resize){const b=bounds(d.piece);return resizedVariant(d.piece,b.w+dx,b.d+dy);}
    if(d.piece.kind==='tv'){const pt=point(clientX,clientY);return{...d.piece,wallAnchor:wallSnap(room,d.piece.sizeCm.w,pt.x,pt.y)};}
    return{...d.piece,originCell:{x:d.piece.originCell.x+Math.round(dx/20),y:d.piece.originCell.y+Math.round(dy/20)}};
  };
  const up=(e:React.PointerEvent<HTMLButtonElement>)=>{
    const d=drag.current,p=dragPiece(e.clientX,e.clientY);drag.current=null;setGhost(null);
    if(d && p && (Math.abs(e.clientX-d.startX)>2 || Math.abs(e.clientY-d.startY)>2)) onEdit(p.id,d.resize?{variantId:p.variantId}:p.kind==='tv'?{wallAnchor:p.wallAnchor}:{originCell:p.originCell},d.stamp);
  };
  const keyDown=(e:React.KeyboardEvent<HTMLButtonElement>,p:Furniture)=>{
    if(!editable)return;
    if(e.key==='Escape'){drag.current=null;setGhost(null);onSelect(null);return;}
    if(e.key.toLowerCase()==='r' && p.kind!=='tv'){e.preventDefault();onEdit(p.id,{rotation:((p.rotation+90)%360) as Rotation},stamp);return;}
    const delta=({ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]} as Record<string,number[]>)[e.key];
    if(!delta)return;
    e.preventDefault();const n=e.shiftKey?5:1;
    if(p.kind==='tv' && p.wallAnchor){const horizontal=p.wallAnchor.wall==='north'||p.wallAnchor.wall==='south';onEdit(p.id,{wallAnchor:{...p.wallAnchor,offsetCm:p.wallAnchor.offsetCm+(horizontal?delta[0]:delta[1])*20*n}},stamp);}
    else onEdit(p.id,{originCell:{x:p.originCell.x+delta[0]*n,y:p.originCell.y+delta[1]*n}},stamp);
  };
  const dockPiece=draggedVariant && dockPoint?dropPiece(draggedVariant,room,layout,dockPoint.x,dockPoint.y):null;
  const previewPiece=ghost||dockPiece;
  const preview=useMemo(()=>previewPiece?placementPreview(layout,room,rules,inventory,previewPiece):null,[layout,room,rules,inventory,previewPiece]);
  const liveReport=preview?.report||report;
  const illegalCells=new Set(preview?.blocking.flatMap(i=>i.cells.map(c=>`${c.x},${c.y}`))||[]);
  const selectedPiece=layout.furniture.find(p=>p.id===selected);
  const selectedShown=ghost?.id===selected?ghost:selectedPiece;
  const floorFinish=PALETTES.floor.find(p=>p.id===layout.appearance.floor);
  return <section className={`ft-board-shell ${compact?'ft-compact':''}`} aria-label={`${title} board`} style={{'--aspect':room.widthCm/room.depthCm} as React.CSSProperties}>
    <div className="ft-board-caption"><span>{title} <em>rev. {revision}</em></span><span>{(room.widthCm*room.depthCm/10000).toFixed(1)} m²</span></div>
    <div className="ft-ruler-top"><span/><span>{fmt(room.widthCm/100)} m</span><span/></div>
    <div className="ft-board-wrap"><div className="ft-ruler-side">{fmt(room.depthCm/100)} m</div>
      <div ref={board} className={`ft-board ft-mode-${mode}`} aria-label={`${title} grid`} style={{aspectRatio:`${room.widthCm}/${room.depthCm}`,'--grid-x':`${20/room.widthCm*100}%`,'--grid-y':`${20/room.depthCm*100}%`,'--floor':floorFinish?.color,'--wall':PALETTES.wall.find(p=>p.id===layout.appearance.wall)?.color,...(mode==='furniture'&&floorFinish?.texture?{backgroundImage:`url("${floorFinish.texture.url}")`,backgroundSize:`${floorFinish.texture.repeatCm[0]/room.widthCm*100}% ${floorFinish.texture.repeatCm[1]/room.depthCm*100}%`}:{})} as React.CSSProperties}
        onPointerDown={e=>{if(!(e.target as HTMLElement).closest('button'))onSelect(null);}}
        onDragOver={e=>{if(!editable||!draggedVariant)return;e.preventDefault();e.dataTransfer.dropEffect='copy';setDockPoint(point(e.clientX,e.clientY));}}
        onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setDockPoint(null);}}
        onDrop={e=>{e.preventDefault();setDockPoint(null);if(!editable||!draggedVariant)return;const p=point(e.clientX,e.clientY);onDropVariant(dropPiece(draggedVariant,room,layout,p.x,p.y),stamp);}}>
        <div className="ft-board-grid"/>
        {room.openings.map(o=>{const horizontal=o.wall==='north'||o.wall==='south';const style:React.CSSProperties=horizontal?{left:`${o.offsetCm/room.widthCm*100}%`,width:`${o.widthCm/room.widthCm*100}%`,[o.wall==='north'?'top':'bottom']:'-5px'}:{top:`${o.offsetCm/room.depthCm*100}%`,height:`${o.widthCm/room.depthCm*100}%`,[o.wall==='west'?'left':'right']:'-5px'};return <div key={o.id} className={`ft-opening ft-opening-${o.kind} ft-wall-${o.wall}`} style={style}><span>{o.kind==='window'?'WINDOW':o.entrance?'ENTRANCE':'DOOR'}</span></div>;})}
        {room.fixtures.map(p=><button key={p.id} type="button" className={`ft-fixed ft-fixed-${p.kind}`} style={position(bounds(p))} title={`${p.label} · fixed${p.conceptualOnly ? " concept fixture" : ""} · edit room inputs`} aria-label={`Edit fixed ${p.label}`} onClick={onEditRoom}>{p.kind!=="radiator" && <Shape item={p}/>}<span>{p.kind==="toilet"?"WC":nice(p.kind).toUpperCase()} ▣</span></button>)}
        {layout.furniture.map(p=>{const shown=ghost?.id===p.id?ghost:p;return <button key={p.id} className={`${p.kind==='tv'?'ft-wall-tv':'ft-furniture'} ${p.kind==='rug'?'ft-rug':''} ${p.wallAnchor?`ft-wall-${p.wallAnchor.wall}`:''} ${selected===p.id?'selected':''} ${p.locked.position?'ft-locked':''}`} style={position(displayBounds(shown))} title={`${p.label} · ${p.sizeCm.w} × ${p.sizeCm.d} × ${p.sizeCm.h??'?'} cm${p.locked.position?' · pinned':''}`} aria-label={`${p.label}, ${p.sizeCm.w} by ${p.sizeCm.d} centimetres${p.locked.position?', position locked':''}`}
          onPointerDown={e=>down(e,p)} onPointerMove={e=>{if(drag.current)setGhost(dragPiece(e.clientX,e.clientY));}} onPointerUp={up} onPointerCancel={()=>{drag.current=null;setGhost(null);}} onKeyDown={e=>keyDown(e,p)} onFocus={()=>{if(editable)onSelect(p.id);}} onClick={()=>onSelect(p.id)}>
          {p.kind==='tv'?<span>TV · {p.sizeCm.w} cm</span>:<><Shape item={shown}/><span className="ft-item-label">{p.ownership==='owned'?'YOUR ':''}{p.tags.includes('bedside')?'BEDSIDE':p.tags.includes('wardrobe')?'WARDROBE':p.kind==='coffee_table'?'TABLE':p.kind.toUpperCase()}</span><span className="ft-item-dim">{shown.sizeCm.w} × {shown.sizeCm.d} cm</span></>}{p.locked.position && <span className="ft-pin-badge" title="Pinned">▣</span>}
        </button>;})}
        {liveReport.cells.map(c=>{const overlay=overlayCell(c,mode);const invalid=illegalCells.has(`${c.x},${c.y}`);if(!overlay&&!invalid)return null;return <span key={`${c.x},${c.y}`} className={`ft-map-cell ft-map-${invalid?'blocked':overlay!.tone} ${invalid?'ft-illegal-cell':''}`} style={position({x:c.x*20,y:c.y*20,w:20,d:20})} title={`${c.heightClass} · ${c.flags.join(', ')}`} aria-hidden="true">{invalid?'×':overlay!.label}</span>;})}
        {activeZone && <div className={`ft-zone-overlay ft-zone-${zoneTone(activeZone)}`} style={position(activeZone.rect)}><span>{activeZone.label}</span></div>}
        {liveReport.cells.filter(c=>focused.has(`${c.x},${c.y}`)).map(c=><span key={`focus-${c.x},${c.y}`} className="ft-focus-cell" style={position({x:c.x*20,y:c.y*20,w:20,d:20})}/>)}
        {previewPiece && <div className={`ft-drag-outline ${preview?.blocking.length?'ft-drag-invalid':''}`} style={position(displayBounds(previewPiece))}><span className="ft-drag-chip">{preview?.blocking[0] ? issueName(preview.blocking[0]) : `${previewPiece.label} · snap 20 cm`}{preview?.blocking.length ? dockPiece ? ' · cannot place here' : ' · release to keep editing' : ''}</span></div>}
        {dockPiece && <div className="ft-dock-ghost" style={position(displayBounds(dockPiece))}><Shape item={dockPiece}/></div>}
        {editable && suggestions.map((c,i)=>{const p=layout.furniture.find(f=>f.id===c.objectId);if(!p)return null;return <button key={c.candidateId} className="ft-candidate-ghost" style={position(displayBounds({...p,originCell:c.originCell,rotation:c.rotation,wallAnchor:c.wallAnchor||p.wallAnchor}))} aria-label={`Accept placement ${i+1}`} title={`Placement ${i+1}: whole layout ${c.layoutStatus}`} onClick={()=>onAccept(c)}><strong>{i+1}</strong><span>{c.layoutStatus}</span></button>;})}
        {editable && selectedShown && <div className="ft-piece-handles" style={position(displayBounds(selectedShown))}><div className="ft-onpiece-actions"><button aria-label={`${selectedShown.locked.position?'Unpin':'Pin'} ${selectedShown.label}`} title="Pin position and rotation" onClick={()=>onPin(selectedShown.id)}>{selectedShown.locked.position?'▣':'♧'}</button>{selectedShown.kind!=='tv' && <button aria-label={`Rotate ${selectedShown.label} 90 degrees`} title="Rotate · R" disabled={selectedShown.locked.rotation} onClick={()=>onEdit(selectedShown.id,{rotation:((selectedShown.rotation+90)%360) as Rotation},stamp)}>↻</button>}</div>{selectedShown.ownership==='catalogue' && !selectedShown.locked.size && CATALOGUE.filter(v=>v.kind===selectedShown.kind).length>1 && <button className="ft-resize-handle" aria-label={`Resize ${selectedShown.label} using named variants`} title="Drag to choose a named size variant" onPointerDown={e=>down(e,selectedShown,true)} onPointerMove={e=>{if(drag.current)setGhost(dragPiece(e.clientX,e.clientY));}} onPointerUp={up} onPointerCancel={()=>{drag.current=null;setGhost(null);}}>⌟</button>}</div>}
        <span className="ft-north">N ↑</span>
      </div>
    </div>
    <div className={`ft-zone-chips${zonesOpen ? '' : ' ft-zone-collapsed'}`} role="group" aria-label={`${title} clearance zones`}>{report.zones.length>0 && <button type="button" className="ft-zone-summary" aria-expanded={zonesOpen} onClick={()=>setZonesOpen(!zonesOpen)}>{(() => { const t=report.zones.map(zoneTone); const bad=t.filter(x=>x==='blocked').length, tight=t.filter(x=>x!=='blocked'&&x!=='clear').length; return `${report.zones.length} zone${report.zones.length===1?'':'s'} · ${bad?`${bad} blocked`:tight?`${tight} tight`:'all reachable'}`; })()} {zonesOpen?'▾':'▸'}</button>}{zonesOpen && report.zones.map(z=><button key={z.id} aria-pressed={zoneId===z.id} className={`ft-zone-${zoneTone(z)}`} onClick={()=>setZoneId(zoneId===z.id?null:z.id)}>{zoneTone(z)==='blocked'?'×':zoneTone(z)==='clear'?'✓':'!'} {z.label}</button>)}</div>
    {report.zones.length>0 && zonesOpen && <p className="ft-zone-legend">✓ Teal: reachable · ! Amber: preferred tight · × Red hatch: blocked</p>}
    <div className="ft-overlay-legend">{mode==='height'?'· FREE   / L LOW   × T TALL   ? UNKNOWN':mode==='walk'?'· clear   / ! tight   × blocked   ↗ reachable':mode==='tv'?'· strip clear   S seat   × blocked   ? unknown':mode==='doors'?'/ reserved sweep   × open leaf':''}</div>
  </section>;
}
function NumberField({ label, value, onChange, min = 0, max = 1000, step = 20 }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) { return <label className="ft-field"><span>{label}</span><div><input type="number" value={value} min={min} max={max} step={step} onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n)) onChange(n); }} /><span>cm</span></div></label>; }
function FloortrisWorkspace({ store: suppliedStore }: { store?: FloortrisStore }) {
  const [session, setSession] = useState(() => roomSession(typeof window === 'undefined' ? '' : window.location.search));
  // Each sample library owns its storage key, and the URL mirrors which one is open.
  // Reading it back here lets a single store — and a single set of native tool
  // registrations — serve every room, with no page load when the human switches.
  const [store] = useState(() => suppliedStore || createStore(typeof window === 'undefined' ? session.makeInitial() : loadState(session), { beforeNewDocument: (previous, next) => { saveWorkspaceRoom(localStorage, roomSession(window.location.search).storageKey, next, previous); } }));
  const [state, setState] = useState(store.getState());
  const [view, setView] = useState<View>(() => (store.getState().documentId || !['local','3m'].includes(session.sample)) && store.getState().proposal ? 'proposal' : 'current');
  const [savedRooms, setSavedRooms] = useState<{id:string;name:string}[]>([]);
  const [saveFailed, setSaveFailed] = useState(false);
  const [dimension, setDimension] = useState<'2d' | '3d'>('2d');
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<'pieces' | 'room' | 'tools' | 'check' | null>(null);
  const [mode, setMode] = useState<OverlayMode>('furniture');
  const [focusCells,setFocusCells]=useState<Cell[]>([]);
  const [previewVariant,setPreviewVariant]=useState<string|null>(null);
  const [draggedVariant, setDraggedVariant] = useState<string | null>(null);
  const [tvFlash, setTvFlash] = useState(0), [tvBadge, setTvBadge] = useState(false);
  const [showSetup, setShowSetup] = useState(false), [showOwned, setShowOwned] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false), [suggestions, setSuggestions] = useState<Candidate[]>([]);
  const [review, setReview] = useState<{ id: string; revision: number } | null>(null);
  const [webmcp, setWebmcp] = useState<WebMCPState>({ state: 'checking', count: 0, message: 'Checking native tools…' });
  const [ownedForm, setOwnedForm] = useState({ label: 'My armchair', kind: 'chair', w: 80, d: 80, h: 85, sleepSize: 'single' as 'single' | 'double' | 'king', storageRole:'general' as 'wardrobe'|'bedside'|'general' });
  const abort = useRef<AbortController | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  const [toolTick, setToolTick] = useState(0);
  useEffect(() => store.subscribe(() => { setState(store.getState()); setSuggestions([]); setToolTick(t => t + 1); }), [store]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- toolTick is the deliberate re-read trigger for the store's mutable tool log.
  const toolLog = useMemo(() => store.getToolLog().slice(0, 12), [store, toolTick]);
  useEffect(() => {
    try {
      const workspace = saveWorkspaceRoom(localStorage, session.storageKey, state);
      queueMicrotask(() => { setSavedRooms(workspace.documents.map(d => ({ id: d.id, name: d.state.room.name }))); setSaveFailed(false); });
      syncSampleUrl(session.sample, documentId(state));
    } catch { queueMicrotask(() => { setSaveFailed(true); setNotice({ text: 'Local saving unavailable. Export your room before closing.', error: true }); }); }
  }, [state, session]);
  useEffect(() => registerFloortrisTools(store, setWebmcp, document, result => {
    if (result.operationSucceeded && result.generatedRoom) { setView('proposal'); setSelected(null); setPanel(null); setReview(null); setShowSetup(false); setFocusCells([]); setMode('furniture'); setNotice({ text: String(result.message), error: false }); }
    if ((result.issues as {code:string}[] | undefined)?.some(i => i.code === 'tv_blocked' || i.code === 'tv_unknown')) { setTvFlash(Date.now()); setTvBadge(true); }
  }), [store]);
  useEffect(() => { if (!tvFlash) return; const timer = setTimeout(() => setTvFlash(0), 2000); return () => clearTimeout(timer); }, [tvFlash]);
  useEffect(() => () => abort.current?.abort(), []);
  const { current: currentLayout, room: currentRoom, rules: currentRules, inventory: currentInventory } = state;
  const currentReport = useMemo(() => validate(currentLayout, currentRoom, currentRules, currentInventory), [currentLayout, currentRoom, currentRules, currentInventory]);
  const proposalReport = useMemo(() => state.proposal ? validate(state.proposal.layout, state.proposal.room, state.proposal.rules, state.inventory) : null, [state]);
  const active = state.proposal, status = proposalStatus(state);
  const which = view === 'proposal' && active ? 'proposal' : 'current';
  const layout = which === 'proposal' ? active!.layout : state.current;
  const rules = which === 'proposal' ? active!.rules : state.rules;
  const room = which === 'proposal' ? active!.room : state.room;
  const report = which === 'proposal' ? proposalReport! : currentReport;
  const profile = room.profile || {kind:'lounge' as const};
  const showTv = profile.kind === 'lounge' || layout.furniture.some(f=>f.kind==='tv');
  const item = view !== 'compare' ? layout.furniture.find(o => o.id === selected) : undefined;
  const editable = view !== 'compare' && !(which === 'proposal' && (active?.kind !== 'layout' || status === 'stale'));
  const onResult = (r: CommandResult) => { if (!r.operationSucceeded) setNotice({ text: r.error?.message || 'Edit refused.', error: true }); else if (r.message) setNotice({ text: String(r.message), error: false }); };
  const restoreHistory = useCallback((forward: boolean) => {
    if (forward ? !store.getHistory().canRedo : !store.getHistory().canUndo) return;
    abort.current?.abort(); setReview(null); setSelected(null); setPanel(null); setSuggestions([]); setDraggedVariant(null);
    const result = forward ? store.redo() : store.undo();
    setNotice({ text: forward ? 'Redone.' : 'Undone.', error: !result.operationSucceeded });
    if (!store.getState().proposal) setView('current');
  }, [store]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (showSetup || review || !(e.metaKey || e.ctrlKey) || e.altKey || target?.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]')) return;
      const key = e.key.toLowerCase(), forward = (key === 'z' && e.shiftKey) || key === 'y';
      if (key !== 'z' && key !== 'y') return;
      e.preventDefault();
      if (forward ? !store.getHistory().canRedo : !store.getHistory().canUndo) return;
      restoreHistory(forward);
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [store, showSetup, review, restoreHistory]);
  const select = (id: string | null) => { setSelected(id); setPanel(null); };
  const togglePanel = (p: typeof panel) => { setPanel(panel === p ? null : p); setSelected(null); };
  const changeView = (v: View) => { setView(v); setFocusCells([]); setPreviewVariant(null); setSelected(null); setPanel(null); setSuggestions([]); };
  // Rooms switch in place. No navigation, no reload, and the native tools stay
  // registered; the URL follows the state so a link still opens the same room.
  const enterRoom = (next: AppState) => {
    abort.current?.abort(); abort.current = null;
    const r = store.humanOpenRoom(next); onResult(r);
    if (!r.operationSucceeded) return;
    const opened = store.getState();
    setView(opened.proposal && !opened.current.furniture.length ? 'proposal' : 'current');
    setFocusCells([]); setPreviewVariant(null); setSelected(null); setPanel(null); setSuggestions([]); setDraggedVariant(null);
    setReview(null); setShowSetup(false); setShowOwned(false); setMode('furniture'); setTvFlash(0); setTvBadge(false); setBusy(false);
  };
  const openSavedRoom = (id: string) => {
    if (id === documentId(state)) return;
    let target: AppState | undefined;
    try { target = readWorkspace(localStorage, session.storageKey)?.documents.find(d => d.id === id)?.state; } catch { target = undefined; }
    target = target || store.getDocuments().find(d => documentId(d) === id);
    if (!target) { setNotice({ text: 'That saved room could not be read on this device.', error: true }); return; }
    enterRoom(target);
  };
  const openSample = (id: string) => {
    const next = roomSession(`?sample=${id}`);
    if (next.storageKey === session.storageKey && documentId(state) === 'original') return;
    let target: AppState | null = null;
    try { target = loadWorkspaceRoom(localStorage, next.storageKey, 'original'); } catch { target = null; }
    syncSampleUrl(next.sample); setSession(next);
    enterRoom(target || next.makeInitial());
  };
  const update = (patch: Parameters<FloortrisStore['humanUpdate']>[2]) => { if (item && editable) onResult(store.humanUpdate(which, item.id, patch)); };
  const add = (variantId: string) => { if (!editable) return; setDimension('2d'); const r = store.humanAdd(which, variantId); onResult(r); if (r.operationSucceeded) { select(r.objectId as string); setNotice({ text: 'Added. Drag to place; any conflicts stay visible.', error: false }); } };
  const pin = (id: string) => {
    const o = layout.furniture.find(f => f.id === id); if (!o || !editable) return;
    const locked = !!(o.locked.position || o.locked.rotation);
    onResult(store.humanSetLocks(id, { ...o.locked, position: !locked, rotation: !locked }, which));
  };
  const canEditSnapshot = (w: 'current' | 'proposal', base: string) => {
    const s = store.getState();
    if (editStamp(s,w) !== base || (w === 'proposal' && proposalStatus(s) === 'stale')) { setNotice({text:'The room changed during that gesture. Try again on the latest version.',error:true}); return false; }
    return true;
  };
  const editIn = (w:'current'|'proposal', id:string, patch:PlacementPatch, base:string) => {
    if (!canEditSnapshot(w,base)) return;
    const r=store.humanUpdate(w,id,patch);onResult(r);
    if (r.operationSucceeded) { const s=store.getState(),p=w==='current'?{layout:s.current,room:s.room,rules:s.rules}:s.proposal!; const issues=validate(p.layout,p.room,p.rules,s.inventory).issues;const blocked=issues.find(i=>i.severity==='block' && i.objectIds.includes(id));if(blocked)setNotice({text:`${blocked.message} Your move was saved.`,error:true}); }
  };
  const dropIn = (w:'current'|'proposal',piece:Furniture,base:string) => {
    setDraggedVariant(null);if(!piece.variantId || !canEditSnapshot(w,base))return;
    const r=store.humanAdd(w,piece.variantId,{originCell:piece.originCell,rotation:piece.rotation,...(piece.wallAnchor?{wallAnchor:piece.wallAnchor}:{}),...(piece.targetSofaId?{targetSofaId:piece.targetSofaId}:{})},true);
    onResult(r);if(r.operationSucceeded)select(r.objectId as string);
  };
  const dockProps = (id:string) => ({onMouseEnter:()=>setPreviewVariant(id),onMouseLeave:()=>setPreviewVariant(null),onFocus:()=>setPreviewVariant(id),onBlur:()=>setPreviewVariant(null),draggable:editable,onDragStart:(e:React.DragEvent<HTMLButtonElement>)=>{e.dataTransfer.setData('text/plain',id);e.dataTransfer.effectAllowed='copy';setDraggedVariant(id);},onDragEnd:()=>setDraggedVariant(null)});
  const plan = async () => {
    setBusy(true); abort.current = new AbortController();
    try {
      if (!store.getState().proposal) { const s = store.getState(); const r = await store.execute('createProposal', { kind: 'layout', expectedCurrentRevision: s.currentRevision, expectedRuleRevision: s.ruleRevision, idempotencyKey: uid() }); if (!r.operationSucceeded) { onResult(r); return; } }
      const p = store.getState().proposal!;
      onResult(await store.execute('proposeLayout', { proposalId: p.id, revision: p.revision }, abort.current.signal));
    } finally { setBusy(false); abort.current = null; }
  };
  const find = async (id: string) => {
    if (!active || active.kind !== 'layout' || status === 'stale') return;
    setDimension('2d'); changeView('proposal'); select(id); setBusy(true); abort.current = new AbortController();
    try { const r = await store.execute('findPlacements', { proposalId: active.id, revision: active.revision, objectId: id, limit: 4 }, abort.current.signal); onResult(r); setSuggestions((r.candidates as Candidate[]) || []); if (r.operationSucceeded && !(r.candidates as Candidate[])?.length) setNotice({ text: String(r.explanation), error: false }); }
    finally { setBusy(false); abort.current = null; }
  };
  const accept = async (c: Candidate) => onResult(await store.execute('updateFurniture', { proposalId: c.proposalId, revision: c.proposalRevision, objectId: c.objectId, candidateId: c.candidateId }));
  const discard = () => { if (window.confirm('Discard this proposal? Yours stays unchanged.')) { abort.current?.abort(); store.discardProposal(); changeView('current'); setReview(null); } };
  const exportRoom = () => { const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })), link = document.createElement('a'); link.href = url; link.download = 'floortris-room.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  const blocking = proposalReport?.issues.find(i => i.severity === 'block');
  const repairItem = blocking?.objectIds.map(id => active?.layout.furniture.find(f => f.id === id)).find(f => f && !f.locked.position);

  const flagState = (type: 'path' | 'tv' | 'door') => {
    if (type === 'tv' && !layout.furniture.some(f => f.kind === 'tv')) return 'missing';
    const prefixes = type === 'path' ? ['path_', 'chair_pull', 'storage_front'] : type === 'tv' ? ['tv_'] : ['door_', 'unsupported_opening'];
    return report.issues.some(i => i.severity === 'block' && prefixes.some(p => i.code.startsWith(p))) ? 'blocked' : 'clear';
  };
  const profileName = nice(profile.kind), profileLabel = profileName[0].toUpperCase() + profileName.slice(1);
  const roomMeta = `${room.name.toLowerCase().includes(profileName) ? '' : `${profileLabel} · `}${fmt(room.widthCm * room.depthCm / 10000)} m²`;
  return <div className="ft-app ft-overhaul">
    <header className="ft-header">
      <Brand />
      <RoomPicker currentId={documentId(state)} currentName={room.name} savedRooms={savedRooms.length ? savedRooms : [{ id: documentId(state), name: state.room.name }]} samples={ROOM_PRESETS} onOpenSaved={openSavedRoom} onOpenSample={openSample} />
      <h1>{room.name}<small className="ft-room-summary">{roomMeta}</small></h1>
      <div className="ft-header-actions">
        {saveFailed ? <button className="ft-save-label ft-save-error" onClick={exportRoom}>Not saved · Export</button> : <span className="ft-save-label">Saved locally</span>}
        <div className="ft-history" role="group" aria-label="Edit history"><button type="button" onClick={() => restoreHistory(false)} disabled={!store.getHistory().canUndo} aria-label="Undo" title="Undo · ⌘/Ctrl Z"><HistoryIcon /></button><button type="button" onClick={() => restoreHistory(true)} disabled={!store.getHistory().canRedo} aria-label="Redo" title="Redo · ⇧⌘Z/Ctrl Y"><HistoryIcon forward /></button></div>
        <button className="ft-button ft-secondary ft-menu-button" aria-expanded={panel === 'room'} onClick={() => togglePanel('room')}><span>Edit room</span><Chevron open={panel === 'room'} /></button>
      </div>
    </header>
    <main className="ft-stage">
      <nav className={`ft-dock${railOpen ? ' ft-dock-expanded' : ''}`} aria-label="Furniture dock"><span className="ft-dock-title">Pieces</span><button className="ft-dock-open" aria-expanded={railOpen} onClick={() => setRailOpen(!railOpen)}><span aria-hidden="true">{railOpen ? '−' : '＋'}</span>{railOpen ? 'Show fewer' : 'Browse all'}</button><button className="ft-owned-entry" onClick={() => { setPanel('pieces'); setSelected(null); setShowOwned(false); }}>Owned furniture</button>{(railOpen ? CATALOGUE.filter(v => !v.recommendedProfiles || v.recommendedProfiles.includes(profile.kind)).map(v => v.id) : dockVariants(profile)).map(id => { const v = CATALOGUE.find(v => v.id === id)!; return <button key={id} className="ft-dock-piece" {...dockProps(id)} disabled={!editable} onClick={() => add(id)} title={`Add ${v.name}`}><span className="ft-dock-shape"><Shape item={{kind:v.kind, appearance:v.palette}} small /></span><span>{railOpen ? v.name : v.kind === 'tv' ? 'TV' : v.kind === 'coffee_table' ? 'Table' : v.tags?.includes('bedside') ? 'Bedside' : v.tags?.includes('wardrobe') ? 'Wardrobe' : nice(v.kind)}</span>{railOpen && <small className="ft-dock-size">{v.sizeCm.w} × {v.sizeCm.d} cm</small>}</button>; })}<span className="ft-dock-hint">{dimension==='3d'?'Add a piece to place it in 2D':'Drag a piece onto the grid'}</span>{profile.kind==='bathroom_concept' && <button className="ft-button ft-secondary" onClick={()=>setShowSetup(true)}>Edit fixtures ↗</button>}</nav>
      {previewVariant && dimension==='2d' && panel!=='pieces' && <VariantPreview variant={CATALOGUE.find(v=>v.id===previewVariant)!} rules={rules}/>}
      <section className="ft-canvas-panel" aria-label="Room planning workspace">
        <div className="ft-board-chrome"><div className="ft-view-tabs" role="group" aria-label="Layout view">{(['current', 'proposal', 'compare'] as View[]).map(v => <button key={v} aria-pressed={view === v} className={view === v ? 'active' : ''} onClick={() => changeView(v)} disabled={v !== 'current' && !active}>{v === 'current' ? 'Yours' : v === 'proposal' ? 'Proposal' : 'Compare'}</button>)}</div><div className="ft-chrome-right"><div className="ft-dimension-tabs" role="group" aria-label="Room dimension view">{(['2d','3d'] as const).map(d=><button key={d} aria-pressed={dimension===d} onClick={()=>{setDimension(d);setDraggedVariant(null);}}>{d==='2d'?'2D':'3D'}</button>)}</div><button className={`ft-tools-chip ${webmcp.state === 'registered' ? 'ft-tools-ready' : ''}`} onClick={() => togglePanel('tools')}><span aria-hidden="true">●</span> {webmcp.state === 'registered' ? `WebMCP · ${webmcp.count} registered` : webmcp.state === 'checking' ? 'WebMCP · checking…' : 'WebMCP unavailable'}</button></div></div>
        <div className={`ft-proposal-row ft-status-${status}`} aria-live="polite"><div className="ft-proposal-message"><strong>{active ? active.kind === 'setup' ? 'Room inputs · awaiting confirmation' : `Proposal · ${status === 'ready_for_review' ? 'ready' : status}` : 'Your room. Another possibility.'}</strong><span>{status === 'stale' ? 'Yours changed. Discard this draft to start again.' : blocking ? `${repairItem?.label || 'Layout'} · ${issueName(blocking)}` : active ? `Revision ${active.revision} · Yours stays unchanged until Apply` : 'Let the planner arrange pieces around your locks.'}</span></div><div className="ft-proposal-actions">{busy ? <button className="ft-button ft-secondary" onClick={() => abort.current?.abort()}>Cancel search</button> : <button className="ft-button ft-secondary" onClick={plan} disabled={status === 'stale' || active?.kind === 'setup'}>{active ? 'Try again' : 'Try a proposal'}</button>}{active && <><button className="ft-button ft-secondary" onClick={() => active.kind === 'setup' ? (setPanel(null), setSelected(null), setShowSetup(true)) : changeView('proposal')}>View</button><button className="ft-button ft-primary" disabled={status !== 'ready_for_review' || active.kind !== 'layout'} onClick={() => setReview({ id: active.id, revision: active.revision })}>Apply</button><button className="ft-button ft-secondary" onClick={discard}>Discard</button></>}{status === 'blocked' && repairItem && <button className="ft-button ft-primary" disabled={busy} onClick={() => find(repairItem.id)}>Find placements</button>}</div></div>
        <div className="ft-overlay-toolbar">{dimension === '3d' ? <div className="ft-3d-guidance"><span><strong>3D preview</strong><small>Drag to orbit · scroll or pinch to zoom. Checks use the measured 2D plan.</small></span><button type="button" onClick={() => setDimension('2d')}>Edit in 2D</button></div> : <div role="group" aria-label="Board overlay" className="ft-mode-tabs">{(['furniture','height','walk','tv','doors'] as OverlayMode[]).filter(m=>m!=='tv'||showTv).map(m => <button key={m} aria-pressed={mode === m} onClick={() => { setMode(m); setTvFlash(0); if(m==='tv')setTvBadge(false); }} className={(tvFlash?'tv':mode) === m ? 'active' : ''}>{m === 'tv' ? `TV${tvBadge?' !':''}` : m[0].toUpperCase() + m.slice(1)}</button>)}</div>}<div className="ft-health-flags" role="group" aria-label="Room checks"><span className="ft-health-title">Room checks</span>{(['path','tv','door'] as const).filter(f=>f!=='tv'||showTv).map(f => { const health = flagState(f); return <button key={f} className={`ft-health-${health}`} onClick={() => { setDimension('2d'); setMode(f === 'path' ? 'walk' : f === 'door' ? 'doors' : 'tv'); setPanel('check'); setSelected(null); }}><span aria-hidden="true">{health === 'clear' ? '✓' : health === 'missing' ? '○' : '!'}</span><span>{f === 'tv' ? 'TV' : f[0].toUpperCase() + f.slice(1)}</span><small>{health}</small></button>; })}</div></div>
        {report.conceptualOnly && <p className="ft-concept-banner"><strong>Bathroom concept · fixed fixtures</strong> Spatial layout only. No plumbing, electrics, waterproofing, ventilation, installation or safety assessment.</p>}
        <div className={`ft-boards ${view === 'compare' ? 'ft-comparison' : ''}`}>
          {(['current','proposal'] as const).filter(w=>w==='current'?(view!=='proposal'||!active):(view!=='current'&&!!active)).map(w=>{
            const l=w==='current'?state.current:active!.layout,r=w==='current'?state.room:active!.room,ru=w==='current'?state.rules:active!.rules,rep=w==='current'?currentReport:proposalReport!;
            if(dimension==='3d') return <ThreeViewBoundary key={w} onReturn={()=>setDimension('2d')}><Suspense fallback={<div className="ft-3d-loading" role="status">Opening your room in 3D…</div>}><Room3D room={r} layout={l} rules={ru} title={w==='current'?'Yours':'Proposal'} revision={w==='current'?state.currentRevision:active!.revision} selected={view==='compare'?null:selected} onSelect={select} onReturn2D={()=>setDimension('2d')} onEditRoom={()=>{setPanel(null);setSelected(null);setShowSetup(true);}} compact={view==='compare'} selectable={view!=='compare'}/></Suspense></ThreeViewBoundary>;
            return <Board key={w} layout={l} room={r} rules={ru} inventory={state.inventory} report={rep} title={w==='current'?'Yours':'Proposal'} revision={w==='current'?state.currentRevision:active!.revision} compact={view==='compare'} selected={view==='compare'?null:selected} onSelect={select} onEdit={(id,patch,base)=>editIn(w,id,patch,base)} onPin={pin} onNotice={text=>setNotice({text,error:true})} mode={tvFlash?'tv':mode} editable={view!=='compare'&&(w==='current'||(active?.kind==='layout'&&status!=='stale'))} stamp={editStamp(state,w)} suggestions={w==='proposal'?suggestions:[]} onAccept={accept} draggedVariant={draggedVariant} onDropVariant={(p,base)=>dropIn(w,p,base)} focusCells={focusCells} onEditRoom={()=>{setPanel(null);setSelected(null);setShowSetup(true);}}/>;
          })}
        </div>
        {dimension === '2d' && <div className="ft-board-bottom"><span>20 cm grid · drag to move · R rotate · arrows nudge</span><button className={`ft-room-check ft-room-check-${report.validation.hardFailures ? 'blocked' : report.validation.warnings || report.brief.status === 'incomplete' ? 'warning' : 'clear'}`} onClick={() => togglePanel('check')}><span>Room check</span><strong>{report.validation.hardFailures ? `${report.validation.hardFailures} blocking` : report.brief.status === 'incomplete' ? 'Brief incomplete' : report.validation.warnings ? `${report.validation.warnings} warnings` : 'Clear'}</strong><span aria-hidden="true">›</span></button></div>}
      </section>
      {(panel || item) && <aside className={`ft-drawer ${panel === 'pieces' ? 'ft-pieces-drawer' : ''}`} aria-label={panel ? `${panel} panel` : 'Selected piece'}><div className="ft-drawer-head"><h2>{panel === 'pieces' ? 'Pieces' : panel === 'room' ? 'Room' : panel === 'tools' ? 'Agent tools' : panel === 'check' ? `${view === 'compare' ? 'Yours' : which === 'proposal' ? 'Proposal' : 'Yours'} · room check` : item?.label}</h2><button className="ft-icon-button" aria-label="Close panel" onClick={() => { setPanel(null); setSelected(null); }}>×</button></div>
        {panel === 'pieces' && <><div className="ft-brief-icons" aria-label="Required room brief">{(report.brief.requirements || rules.requiredKinds.map(k=>({key:k,label:k,met:layout.furniture.some(f=>f.kind===k)?1:0,quantity:1,required:true}))).map(r => <span key={r.key}>{r.met >= r.quantity ? '✓' : '○'} {nice(r.label)} {r.quantity>1?`${Math.min(r.met,r.quantity)}/${r.quantity}`:''}{!r.required?' · optional':''}</span>)}</div><h3>Yours</h3>{state.inventory.map(o => <button key={o.id} className="ft-owned-card" onClick={() => { if (!layout.furniture.some(f => f.id === o.id)) setView('current'); select(o.id); }}><strong>{o.label}</strong><span>{o.sizeCm.w} × {o.sizeCm.d} cm · measured</span></button>)}<button className="ft-text-button" onClick={() => setShowOwned(!showOwned)}>+ Add measured piece</button>{showOwned && <form onSubmit={e => { e.preventDefault(); const r = store.humanAddOwned({label:ownedForm.label,kind:ownedForm.kind as Furniture['kind'],sizeCm:{w:ownedForm.w,d:ownedForm.d,h:ownedForm.h},...(ownedForm.kind==='bed'?{sleepSize:ownedForm.sleepSize}:ownedForm.kind==='storage'?{storageRole:ownedForm.storageRole}:{})}); onResult(r); if(r.operationSucceeded){setView('current'); select(r.objectId as string);setShowOwned(false);} }}><label className="ft-field"><span>Piece name</span><input required maxLength={80} value={ownedForm.label} onChange={e => setOwnedForm({...ownedForm,label:e.target.value})}/></label><label className="ft-field"><span>Type</span><select value={ownedForm.kind} onChange={e=>setOwnedForm({...ownedForm,kind:e.target.value})}>{['sofa','chair','desk','coffee_table','storage','plant','bed','rug'].map(k=><option key={k} value={k}>{nice(k)}</option>)}</select></label>{ownedForm.kind==='bed'&&<label className="ft-field"><span>Sleep size classification</span><select value={ownedForm.sleepSize} onChange={e=>setOwnedForm({...ownedForm,sleepSize:e.target.value as 'single'|'double'|'king'})}>{['single','double','king'].map(k=><option key={k} value={k}>{nice(k)}</option>)}</select></label>}{ownedForm.kind==='storage' && <label className="ft-field"><span>Storage role</span><select value={ownedForm.storageRole} onChange={e=>setOwnedForm({...ownedForm,storageRole:e.target.value as 'wardrobe'|'bedside'|'general'})}>{['general','wardrobe','bedside'].map(k=><option key={k} value={k}>{nice(k)}</option>)}</select></label>}<div className="ft-form-grid">{(['w','d','h'] as const).map(k=><NumberField key={k} label={`${k.toUpperCase()} measured`} value={ownedForm[k]} min={1} max={500} step={1} onChange={n=>setOwnedForm({...ownedForm,[k]:n})}/>)}</div><button className="ft-button ft-primary">Add to Yours</button></form>}<h3>Named variants · {nice((room.profile || {kind:'lounge'}).kind)}</h3><div className="ft-variant-list">{CATALOGUE.filter(v=>!v.recommendedProfiles || v.recommendedProfiles.includes((room.profile || {kind:'lounge'}).kind)).map(v=><button key={v.id} {...dockProps(v.id)} disabled={!editable} onClick={()=>add(v.id)}><span className="ft-dock-shape"><Shape item={{kind:v.kind,appearance:v.palette}} small/></span><span><strong>{v.name}</strong><small>{v.sizeCm.w} × {v.sizeCm.d} cm</small></span><span>+</span></button>)}</div><p className="ft-muted">Hover or focus a variant for its measured envelope and clearance. Demo catalogue; no purchasing or real SKUs.</p>{previewVariant && <VariantPreview variant={CATALOGUE.find(v=>v.id===previewVariant)!} rules={rules}/>}</>}
        {panel === 'room' && <><p className="ft-muted">Use Rooms above to return to saved rooms or open samples. Each room keeps its own proposal.</p><button className="ft-button ft-secondary ft-full" onClick={()=>{setPanel(null);setSelected(null);setShowSetup(true);}}>Room inputs & fixed fixtures ↗</button><p className="ft-muted">{room.widthCm} × {room.depthCm} cm · edit your measurements and fixed features. Changes need your confirmation.</p>{(['wall','floor'] as const).map(target=><div key={target} className="ft-palette-section"><h3>{target === 'wall' ? 'Walls' : 'Floor'} · {which === 'current' ? 'Yours' : 'Proposal'}</h3><FinishPicker target={target} value={layout.appearance[target]} disabled={!editable} onChange={id=>onResult(store.humanSetRoomFinish(which,target,id))}/></div>)}<p className="ft-muted">Concept finishes. Check permission before changing rented walls or floors.</p><button className="ft-button ft-secondary ft-full" onClick={exportRoom}>Export room JSON</button><button className="ft-text-button" onClick={()=>{if(window.confirm('Reset this room to its starting sample? Export first to keep a copy.')){store.resetDemo(session.makeInitial());changeView('current');}}}>Reset demo</button></>}
        {panel === 'tools' && <><strong>{webmcp.state === 'registered' ? `${webmcp.count} native WebMCP tools registered` : webmcp.state === 'checking' ? 'Checking native WebMCP…' : 'Native WebMCP unavailable'}</strong><p>{webmcp.message}</p><p><a href="/agent-guide" target="_blank" rel="noopener">Read the WebMCP agent guide ↗</a>. Agent edits use native tools and stay in Proposal; Apply is your decision.</p><h3>Live tool calls</h3>{toolLog.length === 0 ? <p className="ft-muted">Nothing yet. Every WebMCP call an agent makes appears here as it happens — including the ones this page refuses.</p> : <ol className="ft-tool-feed">{toolLog.map(e => <li key={e.seq} className={e.ok ? '' : 'ft-tool-refused'}><span className="ft-tool-line"><code>{e.name}</code>{e.readOnly && <em>read</em>}<b>{e.ok ? [e.revision != null ? `rev ${e.revision}` : null, e.validationStatus ? e.validationStatus : null, e.hardFailures ? `${e.hardFailures} blocking` : null].filter(Boolean).join(' · ') || 'ok' : `refused · ${e.errorCode || 'error'}`}</b></span>{e.args && <span className="ft-tool-args">{e.args}</span>}</li>)}</ol>}<p>Ask an agent to generateRoom with dimensions, room type and openings. It opens a new furnished proposal and saves your previous room in Rooms. Apply, Discard and Unlock stay with you.</p><p>Try a proposal runs a bounded, deterministic local planner—not a chatbot.</p><h3>Board assumptions</h3><p>{rules.walkHardCm} cm hard / {rules.walkPreferredCm} cm preferred walking width. {showTv ? `TV checks a full-width height strip at ${rules.H_lowCm} cm, not optical visibility.` : profile.kind==='bedroom' ? `Beds need a connected ${rules.bedLongSideAccessCm} cm side-entry zone of at least 100 cm, excluding up to 60 cm at the head.` : 'Approach zones connect each required activity to the entrance.'}</p><p>No safety or accessibility certification. Your room stays in this browser.</p></>}
        {panel === 'check' && <><p>{report.brief.status === 'satisfied' ? 'Required brief complete.' : `Missing: ${report.brief.missingRequired.map(nice).join(', ')}`}</p>{report.issues.map((issue,i)=><button key={i} className={`ft-issue ft-issue-${issue.severity}`} onClick={()=>{setFocusCells(issue.cells.length?issue.cells:report.zones.filter(z=>issue.objectIds.includes(z.objectId)).flatMap(z=>z.cells));setDimension('2d');setMode(issue.code.startsWith('tv_')?'tv':issue.code.startsWith('door_')?'doors':'walk');}}><strong>{issueName(issue)}</strong><p>{issue.message}</p></button>)}{!report.issues.length && <p>✓ No rule issues.</p>}{active?.omitted.map((o,i)=><p key={i}>{o.variantId || o.objectId}: {o.reason}</p>)}<p className="ft-muted">{showTv ? "TV flags are a height rule, not proof of real-world visibility." : profile.kind === "bedroom" ? `Bed entry: ${rules.bedLongSideAccessCm} cm depth, at least 100 cm length; at most 60 cm excluded at the head for bedside tables.` : "Clearance zones are demo assumptions, not installation or accessibility advice."}</p></>}
        {!panel && item && <><p className="ft-piece-meta">{item.ownership === 'owned' ? '▣ Owned · measured' : 'Catalogue variant'} · {item.sizeCm.w} × {item.sizeCm.d} cm</p><div className="ft-piece-actions"><button className="ft-button ft-secondary" disabled={!editable || item.locked.rotation || item.kind==='tv'} onClick={()=>update({rotation:((item.rotation+90)%360) as Rotation})}>↻ Rotate</button><button className="ft-button ft-secondary" onClick={()=>pin(item.id)}>{item.locked.position?'Unpin':'Pin'}</button><button className="ft-button ft-secondary" disabled={!editable} onClick={()=>{const r=store.humanRemove(which,item.id);onResult(r);if(r.operationSucceeded)select(null);}}>Remove</button></div>{which === 'proposal' && <button className="ft-text-button" disabled={!editable||busy} onClick={()=>find(item.id)}>Find placements ↗</button>}
          {item.ownership==='catalogue' && <label className="ft-field"><span>Size variant</span><select disabled={!editable || item.locked.size} value={item.variantId} onChange={e=>update({variantId:e.target.value})}>{CATALOGUE.filter(v=>v.kind===item.kind).map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></label>}
          <div className="ft-swatches">{PALETTES.furniture.map(p=><button key={p.id} disabled={!editable} title={p.name} aria-label={`Set ${p.name} finish`} aria-pressed={item.appearance===p.id} className={item.appearance===p.id?'active':''} style={{background:p.color}} onClick={()=>update({appearance:p.id})}>{item.appearance===p.id?'✓':''}</button>)}</div>
          <details className="ft-exact"><summary>Exact</summary><fieldset disabled={!editable}>{item.kind==='tv'?<><label className="ft-field"><span>Wall</span><select value={item.wallAnchor?.wall} onChange={e=>update({wallAnchor:{wall:e.target.value as Wall,offsetCm:item.wallAnchor?.offsetCm||0}})}>{['north','east','south','west'].map(w=><option key={w}>{w}</option>)}</select></label><NumberField label="Wall offset" value={item.wallAnchor?.offsetCm||0} onChange={offsetCm=>update({wallAnchor:{wall:item.wallAnchor?.wall||'north',offsetCm}})}/><NumberField label="Mount bottom" value={item.elevationCm} max={500} onChange={elevationCm=>update({elevationCm})}/><label className="ft-field"><span>Target sofa</span><select value={item.targetSofaId||''} onChange={e=>update({targetSofaId:e.target.value})}><option value="">Choose sofa</option>{layout.furniture.filter(f=>f.kind==='sofa').map(f=><option key={f.id} value={f.id}>{f.label}</option>)}</select></label></>:<div className="ft-form-grid"><NumberField label="Position X" value={item.originCell.x*20} min={-1000} onChange={x=>update({originCell:{...item.originCell,x:Math.round(x/20)}})}/><NumberField label="Position Y" value={item.originCell.y*20} min={-1000} onChange={y=>update({originCell:{...item.originCell,y:Math.round(y/20)}})}/></div>}{item.kind==='chair' && <label className="ft-field"><span>Linked desk</span><select value={item.linkedDeskId||''} onChange={e=>e.target.value&&update({linkedDeskId:e.target.value})}><option value="">No desk</option>{layout.furniture.filter(f=>f.kind==='desk').map(f=><option key={f.id} value={f.id}>{f.label}</option>)}</select></label>}</fieldset></details>
          {which==='current' && item.ownership==='owned' && <details className="ft-exact"><summary>Measurements & requirement</summary>{item.kind==='bed' && <label className="ft-field"><span>Sleep size classification</span><select value={item.sleepSize||''} onChange={e=>onResult(store.humanClassifyOwned(item.id,{sleepSize:e.target.value as 'single'|'double'|'king'}))}><option value="" disabled>Choose sleep size</option>{['single','double','king'].map(k=><option key={k} value={k}>{nice(k)}</option>)}</select></label>}{item.kind==='storage' && <label className="ft-field"><span>Storage role</span><select value={item.tags.includes('wardrobe')?'wardrobe':item.tags.includes('bedside')?'bedside':'general'} onChange={e=>onResult(store.humanClassifyOwned(item.id,{storageRole:e.target.value as 'wardrobe'|'bedside'|'general'}))}>{['general','wardrobe','bedside'].map(k=><option key={k} value={k}>{nice(k)}</option>)}</select></label>}{(['w','d','h'] as const).map(k=><NumberField key={k} label={`${k.toUpperCase()} measured`} value={item.sizeCm[k]||0} min={1} max={500} step={1} onChange={n=>onResult(store.humanMeasureOwned(item.id,{...item.sizeCm,[k]:n}))}/>)}<label className="ft-check"><input type="checkbox" checked={item.requiredInRoom} onChange={e=>onResult(store.humanSetRequired(item.id,e.target.checked))}/>Must stay in this room</label>{!item.requiredInRoom && <button className="ft-text-button" onClick={()=>onResult(store.humanSetLocks(item.id,{}))}>Allow removal · clear locks</button>}<p>Owned sizes cannot be changed by agent tools.</p></details>}
          {suggestions.length>0 && <div className="ft-candidates">{suggestions.map((c,i)=><button key={c.candidateId} onClick={()=>accept(c)}>Placement {i+1} · {c.layoutStatus}</button>)}</div>}
        </>}
      </aside>}
    </main>
    {notice && <div className={`ft-toast ${notice.error?'ft-toast-error':''}`} role={notice.error?'alert':'status'}><span className="ft-toast-icon" aria-hidden="true">{notice.error?'!':'✓'}</span><p>{notice.text}</p><button onClick={()=>setNotice(null)} aria-label="Dismiss notice"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" /></svg></button></div>}
    {showSetup && <RoomEditor state={state} store={store} onResult={onResult} close={()=>setShowSetup(false)}/>}
    {review && <div className="ft-modal-backdrop"><section className="ft-modal" role="dialog" aria-modal="true" aria-labelledby="review-title"><h2 id="review-title">Make this arrangement yours?</h2><p>Human confirmation only. Agents should leave this proposal for you to review. Apply proposal revision {review.revision}. Yours will be replaced. The exact revision and all hard rules are checked again.</p><div className="ft-modal-actions"><button className="ft-button ft-secondary" onClick={()=>{setReview(null);changeView('compare');}}>Compare first</button><button className="ft-button ft-primary" onClick={()=>{const r=store.applyProposal(review.id,review.revision);onResult(r);if(r.operationSucceeded){setReview(null);changeView('current');}}}>Apply revision {review.revision}</button></div><button className="ft-text-button" onClick={()=>setReview(null)}>Cancel</button></section></div>}
  </div>;
}

const subscribeClientMount = () => () => {};
/** Client mount avoids hydrating local persisted data against a different server demo. */
export default function FloortrisApp(props: { store?: FloortrisStore }) {
  const mounted = useSyncExternalStore(subscribeClientMount, () => true, () => false);
  return mounted ? <FloortrisWorkspace {...props} /> : <div className="ft-app ft-loading"><Brand /><p>Opening your room…</p></div>;
}
