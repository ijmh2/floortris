import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { bounds, validate, wallBand } from './engine.ts';
import { wallSnap } from './interactions.ts';
import { clone, type AppState, type CommandResult, type Furniture, type Opening, type Room, type Rules, type Wall } from './model.ts';
import { horizontalWall, radiatorMeasures, radiatorOnWall, roomEditStamp, validateRoomInputs, wallLength, walls } from './room-inputs.ts';
import { proposalStatus, type FloortrisStore } from './store.ts';
import { profileRules } from './samples.ts';
import { conceptClearance, conceptOnWall } from './fixture-geometry.ts';
import { planClipPath, wallSegments } from './floorplan.ts';
import './room-editor.css';

function Measurement({ label, value, onChange, min = 0, max = 1000, disabled = false }: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; disabled?: boolean }) {
  return <label className="ft-field"><span>{label} <small>cm</small></span><input type="number" min={min} max={max} step={1} value={Number.isFinite(value) ? value : ''} disabled={disabled} onChange={e => onChange(e.target.valueAsNumber)} /></label>;
}
const isPinned = (room: Room, id: string) => room.openingLocks?.includes(id) || !!room.fixtures.find(f => f.id === id)?.locked.position;
const title = (kind: string) => kind[0].toUpperCase() + kind.slice(1);

export default function RoomEditor({ state, store, onResult, close }: { state: AppState; store: FloortrisStore; onResult: (r: CommandResult) => void; close: () => void }) {
  const [room, setRoom] = useState(() => clone(state.proposal?.kind === 'setup' ? state.proposal.room : state.room));
  const [rules, setRules] = useState(() => clone(state.proposal?.kind === 'setup' ? state.proposal.rules : state.rules));
  const [stamp, setStamp] = useState(() => roomEditStamp(state));
  const [selected, setSelected] = useState<string | null>(room.openings[0]?.id || room.fixtures[0]?.id || null);
  const [replace, setReplace] = useState(false);
  const [message, setMessage] = useState('');
  const board = useRef<HTMLDivElement>(null), modal = useRef<HTMLElement>(null);
  const gesture = useRef<{ id: string; before: Room; pointerId: number } | null>(null);
  const opening = room.openings.find(o => o.id === selected), fixture = room.fixtures.find(f => f.id === selected);
  const feature = opening || fixture, anchor = opening || fixture?.wallAnchor;
  const segments = wallSegments(room);
  const pinned = !!(selected && isPinned(room, selected));
  const inputError = useMemo(() => validateRoomInputs(room, rules), [room, rules]);
  const conflict = stamp !== roomEditStamp(state);
  const p = state.proposal?.kind === 'setup' ? state.proposal : null;
  const needsReplace = !!state.proposal && (!p || proposalStatus(state) === 'stale');
  const stagedMatches = !!p && !conflict && JSON.stringify(p.room) === JSON.stringify(room) && JSON.stringify(p.rules) === JSON.stringify(rules);
  const report = useMemo(() => p ? validate(p.layout, p.room, p.rules, state.inventory) : null, [p, state.inventory]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    modal.current?.focus();
    return () => previous?.focus();
  }, []);

  const changeOpening = (patch: Partial<Opening>) => {
    if (!opening || pinned) return;
    setRoom(r => ({ ...r, openings: r.openings.map(o => o.id === opening.id ? { ...o, ...patch } as Opening : o) }));
  };
  const changeRadiator = (patch: { wall?: Wall; segmentId?: string; offset?: number; width?: number; depth?: number; height?: number }) => {
    if (!fixture || pinned) return;
    const m = radiatorMeasures(fixture);
    setRoom(r => ({ ...r, fixtures: r.fixtures.map(f => {
      if (f.id !== fixture.id) return f;
      const segmentId = patch.segmentId ?? f.wallAnchor!.segmentId, segment = segmentId ? wallSegments(r).find(s => s.id === segmentId) : undefined;
      return radiatorOnWall(f, r, patch.wall ?? segment?.wall ?? f.wallAnchor!.wall, patch.offset ?? f.wallAnchor!.offsetCm, patch.width ?? m.width, patch.depth ?? m.depth, patch.height ?? f.sizeCm.h!, segmentId);
    }) }));
  };
  const resizeRoom = (patch: Partial<Pick<Room, 'widthCm' | 'depthCm'>>) => setRoom(r => {
    const next = { ...r, ...patch };
    next.fixtures = r.fixtures.map(f => {
      if (f.kind !== 'radiator' || !f.wallAnchor || f.locked.position) return f;
      const m = radiatorMeasures(f); return radiatorOnWall(f, next, f.wallAnchor.wall, f.wallAnchor.offsetCm, m.width, m.depth, f.sizeCm.h!, f.wallAnchor.segmentId);
    });
    return next;
  });
  const pin = () => {
    if (!selected) return;
    setRoom(r => opening ? { ...r, openingLocks: pinned ? (r.openingLocks || []).filter(id => id !== selected) : [...(r.openingLocks || []), selected] } : { ...r, fixtures: r.fixtures.map(f => f.id === selected ? { ...f, locked: { ...f.locked, position: !pinned, size: !pinned, rotation: !pinned } } : f) });
  };
  const add = (kind: 'door' | 'window' | 'radiator') => {
    const id = `${kind}-${crypto.randomUUID()}`;
    const first = segments[0], segmentAnchor = room.floorPlan ? { segmentId: first.id } : {};
    if (kind === 'radiator') {
      const f: Furniture = { id, label: 'Radiator', kind, ownership: 'fixed', sizeCm: { w: 100, d: 20, h: 60 }, originCell: { x: 1, y: 0 }, rotation: 0, elevationCm: 0, locked: {}, appearance: 'chalk', requiredInRoom: true, tags: [] };
      setRoom(r => ({ ...r, fixtures: [...r.fixtures, radiatorOnWall(f, r, first.wall, 20, 100, 20, 60, room.floorPlan ? first.id : undefined)] }));
    } else {
      const base = { id, wall: first.wall, ...segmentAnchor, offsetCm: 20, widthCm: kind === 'door' ? 80 : 100 };
      const o: Opening = kind === 'door' ? { ...base, kind, hinge: 'start', swing: 'in', angle: 90, mechanism: 'hinged', entrance: !room.openings.some(o => o.kind === 'door' && o.entrance) } : { ...base, kind, sillCm: 95, headCm: 210, type: 'fixed', windowAccess: false };
      setRoom(r => ({ ...r, openings: [...r.openings, o] }));
    }
    setSelected(id); setMessage('New feature added to the editor. Choose its wall and measurements.');
  };
  const addConceptFixture = (kind: 'basin' | 'toilet' | 'shower' | 'bath' | 'towel_rail', vanity = false) => {
    const specs = { basin: ['Wall basin 60', 60, 45, 85, 60, 60], toilet: ['Compact WC', 40, 65, 80, 60, 80], shower: ['Shower tray 90', 90, 90, 5, 90, 60], bath: ['Compact bath', 170, 75, 55, 170, 60], towel_rail: ['Towel rail', 50, 10, 100, 0, 0] } as const;
    const selected = vanity ? ['Vanity basin 80', 80, 50, 85, 80, 60] as const : specs[kind];
    const [label, w, d, h] = selected, id = `${vanity ? 'vanity-basin' : kind}-${crypto.randomUUID()}`;
    const first = segments[0]; let f: Furniture = { id, label, kind, ownership: 'fixed', sizeCm: { w, d, h }, originCell: { x: 1, y: 0 }, rotation: 0, elevationCm: 0, wallAnchor: {wall:first.wall,offsetCm:20,...(room.floorPlan ? { segmentId:first.id } : {})}, locked: { position: true, size: true, rotation: true }, appearance: 'oat', requiredInRoom: true, tags: ['concept-fixture'], conceptualOnly: true };
    f = conceptOnWall(f, room, first.wall, 20, room.floorPlan ? first.id : undefined);
    setRoom(r => ({ ...r, fixtures: [...r.fixtures, f], profile: r.profile?.kind === 'bathroom_concept' ? { ...r.profile, fixtureIds: [...r.profile.fixtureIds, id] } : r.profile }));
    setSelected(id); setMessage('Concept fixture staged as fixed and pinned. It is not movable by an agent.');
  };
  const remove = () => {
    if (!selected || pinned) return;
    setRoom(r => ({ ...r, openings: r.openings.filter(o => o.id !== selected), fixtures: r.fixtures.filter(f => f.id !== selected), openingLocks: (r.openingLocks || []).filter(id => id !== selected), profile:r.profile?.kind==='bathroom_concept'?{...r.profile,fixtureIds:r.profile.fixtureIds.filter(id=>id!==selected)}:r.profile }));
    setSelected(null);
  };
  const startDrag = (e: PointerEvent<HTMLButtonElement>, id: string) => {
    setSelected(id);
    if (e.button !== 0 || isPinned(room, id) || room.fixtures.some(f => f.id === id && f.kind !== 'radiator')) return;
    e.preventDefault(); e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = { id, before: room, pointerId: e.pointerId };
  };
  const drag = (e: PointerEvent<HTMLButtonElement>) => {
    const g = gesture.current, rect = board.current?.getBoundingClientRect(); if (!g || !rect || g.pointerId !== e.pointerId) return;
    const o = g.before.openings.find(o => o.id === g.id), f = g.before.fixtures.find(f => f.id === g.id);
    const width = o?.widthCm ?? (f ? radiatorMeasures(f).width : 0);
    const snap = wallSnap(g.before, width, (e.clientX - rect.left) / rect.width * g.before.widthCm, (e.clientY - rect.top) / rect.height * g.before.depthCm)!;
    setRoom(r => o ? { ...r, openings: r.openings.map(item => item.id === g.id ? { ...item, ...snap } : item) } : { ...r, fixtures: r.fixtures.map(item => { if (item.id !== g.id) return item; const m = radiatorMeasures(item); return radiatorOnWall(item, r, snap.wall, snap.offsetCm, m.width, m.depth, item.sizeCm.h!, snap.segmentId); }) });
  };
  const finishDrag = (e: PointerEvent<HTMLButtonElement>, cancel = false) => {
    if (!gesture.current || gesture.current.pointerId !== e.pointerId) return;
    if (cancel) setRoom(gesture.current.before);
    gesture.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const stage = () => {
    const result = store.humanStageRoom(room, rules, stamp, replace); onResult(result);
    if (result.operationSucceeded) { setStamp(roomEditStamp(store.getState())); setReplace(false); setMessage('Staged. Review the changes below, then confirm.'); }
    else setMessage(result.error?.message || 'Could not stage inputs.');
  };
  const setProfile = (kind: 'lounge' | 'bedroom' | 'home_office' | 'bathroom_concept') => setRoom(r => {
    const profile = kind === 'bedroom' ? { kind, sleeping: 'single' as const, workspace: false, storage: false, bedsideQuantity: 0 } : kind === 'home_office' ? { kind, seating: false, storage: false } : kind === 'bathroom_concept' ? { kind, fixtureIds: r.fixtures.filter(f => f.kind !== 'radiator').map(f => f.id), conceptualOnly: true as const } : { kind: 'lounge' as const };
    setRules(old => ({ ...old, requiredKinds: [...profileRules(profile)] as Rules['requiredKinds'] }));
    return { ...r, profile };
  });
  const changeProfile = (patch: Record<string, unknown>) => setRoom(r => {
    const profile = r.profile || { kind: 'lounge' as const };
    const next = { ...r, profile: { ...profile, ...patch } } as Room;
    setRules(old => ({ ...old, requiredKinds: [...profileRules(next.profile!)] as Rules['requiredKinds'] }));
    return next;
  });
  const updateConceptFixture = (patch: Partial<Pick<Furniture, 'originCell' | 'rotation' | 'sizeCm'>>) => {
    if (!fixture || fixture.kind === 'radiator' || pinned) return;
    setRoom(r => ({ ...r, fixtures: r.fixtures.map(f => {
      if (f.id !== fixture.id) return f;
      const next = { ...f, ...patch, ...(patch.sizeCm ? { sizeCm: patch.sizeCm } : {}) };
      if (patch.originCell || patch.rotation !== undefined) delete next.wallAnchor;
      if (next.wallAnchor) return conceptOnWall(next,r,next.wallAnchor.wall,next.wallAnchor.offsetCm,next.wallAnchor.segmentId);
      return { ...next, clearance: conceptClearance(next) };
    }) }));
  };
  const anchorConcept = (wall:Wall,offsetCm:number,segmentId?:string) => { if (!fixture || pinned) return; setRoom(r=>({...r,fixtures:r.fixtures.map(f=>f.id===fixture.id?conceptOnWall(f,r,wall,offsetCm,segmentId):f)})); };
  const rectStyle = (r: { x: number; y: number; w: number; d: number }): CSSProperties => ({ left: `${r.x / room.widthCm * 100}%`, top: `${r.y / room.depthCm * 100}%`, width: `${r.w / room.widthCm * 100}%`, height: `${r.d / room.depthCm * 100}%` });

  return <div className="ft-modal-backdrop"><section ref={modal} tabIndex={-1} className="ft-modal ft-room-editor" role="dialog" aria-modal="true" aria-labelledby="room-editor-title" onKeyDown={e => {
    if (e.key === 'Escape') { e.stopPropagation(); if (gesture.current) { setRoom(gesture.current.before); gesture.current = null; } else close(); }
    if (e.key === 'Tab') {
      const elements = [...(modal.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary,[tabindex="0"]') || [])].filter(el => el.getClientRects().length);
      const first = elements[0], last = elements.at(-1);
      if (e.shiftKey && (document.activeElement === first || document.activeElement === modal.current)) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  }}>
    <div className="ft-modal-head"><div><p className="ft-eyebrow">THE PHYSICAL ROOM</p><h2 id="room-editor-title">Make it your room</h2></div><button className="ft-icon-button" onClick={close} aria-label="Close room inputs">×</button></div>
    <p className="ft-muted">Drag features along the walls, or enter exact measurements. Pins protect them from agent edits. Nothing changes in Yours until you confirm.</p>
    {conflict && <p role="alert" className="ft-room-error">The room or proposal changed while you were editing. Close and reopen this editor to load the latest version.</p>}
    <label className="ft-field"><span>Room name</span><input maxLength={100} value={room.name} onChange={e => setRoom({ ...room, name: e.target.value })} /></label>
    <label className="ft-field"><span>Room purpose · staged by you</span><select value={(room.profile || { kind: 'lounge' }).kind} onChange={e => setProfile(e.target.value as 'lounge' | 'bedroom' | 'home_office' | 'bathroom_concept')}><option value="lounge">Lounge</option><option value="bedroom">Bedroom</option><option value="home_office">Home office</option><option value="bathroom_concept">Bathroom concept</option></select></label>
    {room.profile?.kind === 'bedroom' && <div className="ft-inline-checks"><label className="ft-field"><span>Sleep size</span><select value={room.profile.sleeping} onChange={e => changeProfile({ sleeping: e.target.value as 'single' | 'double' | 'king' })}><option value="single">Single</option><option value="double">Double</option><option value="king">King</option></select></label><label className="ft-check"><input type="checkbox" checked={room.profile.workspace} onChange={e => changeProfile({ workspace: e.target.checked })}/>Workspace</label><label className="ft-check"><input type="checkbox" checked={room.profile.storage} onChange={e => changeProfile({ storage: e.target.checked })}/>Wardrobe</label><label className="ft-field"><span>Bedside tables</span><select value={room.profile.bedsideQuantity || 0} onChange={e => changeProfile({ bedsideQuantity: Number(e.target.value) })}><option value="0">0</option><option value="1">1</option><option value="2">2</option></select></label></div>}
    {room.profile?.kind === 'home_office' && <div className="ft-inline-checks"><label className="ft-check"><input type="checkbox" checked={room.profile.seating} onChange={e => changeProfile({ seating: e.target.checked })}/>Guest seating</label><label className="ft-check"><input type="checkbox" checked={room.profile.storage} onChange={e => changeProfile({ storage: e.target.checked })}/>Storage</label></div>}
    {room.profile?.kind === 'bathroom_concept' && <p className="ft-room-error">Bathroom concepts show fixed spatial fixtures only. They do not assess installation, regulations, safety, plumbing or accessibility.</p>}
    <div className="ft-room-dimensions"><Measurement label="Bounding width" min={240} value={room.widthCm} disabled={!!room.floorPlan} onChange={widthCm => resizeRoom({ widthCm })} /><Measurement label="Bounding depth" min={240} value={room.depthCm} disabled={!!room.floorPlan} onChange={depthCm => resizeRoom({ depthCm })} /><Measurement label="Ceiling" min={100} max={500} value={rules.ceilingCm} onChange={ceilingCm => setRules({ ...rules, ceilingCm })} /></div>
    {room.floorPlan && <p className="ft-small-note"><strong>Agent-authored custom outline.</strong> The bounding dimensions follow its points and cannot be resized independently here. Ask an agent to update the measured corner list; you still review and confirm every staged change.</p>}
    <div className="ft-room-workspace">
      <div className="ft-room-map-column"><div className="ft-room-map-frame"><span className="ft-wall-label ft-wall-north">NORTH · {room.widthCm} cm</span><span className="ft-wall-label ft-wall-west">WEST</span><span className="ft-wall-label ft-wall-east">EAST</span><span className="ft-wall-label ft-wall-south">SOUTH</span>
        <div ref={board} className={`ft-room-map ${room.floorPlan ? 'ft-custom-floorplan' : ''}`} aria-label="Wall feature editor" style={{ aspectRatio: `${Number.isFinite(room.widthCm) ? room.widthCm : 300} / ${Number.isFinite(room.depthCm) ? room.depthCm : 300}`, backgroundSize: `${20 / room.widthCm * 100}% ${20 / room.depthCm * 100}%`, clipPath: planClipPath(room) }}>
          {state.current.furniture.filter(f => f.kind !== 'tv').map(f => <div key={f.id} className="ft-room-context-piece" style={rectStyle(bounds(f))} aria-hidden="true">{f.kind}</div>)}
          {[...room.openings, ...room.fixtures].map((f, index) => {
            const isOpening = 'wall' in f, wall = isOpening ? f.wall : f.wallAnchor?.wall || 'north';
            const b = isOpening ? wallBand(room, wall, f.offsetCm, f.widthCm, 10, f.segmentId) : bounds(f);
            const locked = isPinned(room, f.id), label = `${title(f.kind)} ${index + 1}`;
            return <button key={f.id} type="button" aria-label={`Select ${label}${locked ? ', pinned' : ''}`} aria-pressed={selected === f.id} title={`${label}${locked ? ' · pinned' : ' · drag along walls'}`} className={`ft-room-feature ft-feature-${f.kind} ${horizontalWall(wall) ? 'ft-feature-horizontal' : 'ft-feature-vertical'} ${selected === f.id ? 'selected' : ''} ${locked ? 'pinned' : ''}`} style={rectStyle(b)} onClick={() => setSelected(f.id)} onPointerDown={e => startDrag(e, f.id)} onPointerMove={drag} onPointerUp={e => finishDrag(e)} onPointerCancel={e => finishDrag(e, true)} onLostPointerCapture={e => finishDrag(e, true)}><span>{index + 1}{locked ? ' ▣' : ''}</span></button>;
          })}
        </div>
      </div><p className="ft-small-note">20 cm drag snap · exact inputs accept 1 cm. Faded pieces show Yours for context. Custom-wall offsets run from each named segment’s top/left endpoint.</p>
      <div className="ft-room-legend"><span>▰ Door</span><span>▱ Window</span><span>▥ Radiator</span><span>▣ Pinned</span></div>
      <div className="ft-inline-buttons"><button className="ft-button ft-secondary" disabled={room.openings.length >= 12} onClick={() => add('door')}>+ Door</button><button className="ft-button ft-secondary" disabled={room.openings.length >= 12} onClick={() => add('window')}>+ Window</button><button className="ft-button ft-secondary" disabled={room.fixtures.length >= 12} onClick={() => add('radiator')}>+ Radiator</button></div>
      {room.profile?.kind === 'bathroom_concept' && <div className="ft-inline-buttons"><button className="ft-button ft-secondary" disabled={room.fixtures.length>=12} onClick={() => addConceptFixture('basin')}>+ Basin</button><button className="ft-button ft-secondary" disabled={room.fixtures.length>=12} onClick={() => addConceptFixture('basin', true)}>+ Vanity</button><button className="ft-button ft-secondary" disabled={room.fixtures.length>=12} onClick={() => addConceptFixture('toilet')}>+ WC</button><button className="ft-button ft-secondary" disabled={room.fixtures.length>=12} onClick={() => addConceptFixture('shower')}>+ Shower tray</button><button className="ft-button ft-secondary" disabled={room.fixtures.length>=12} onClick={() => addConceptFixture('bath')}>+ Bath</button><button className="ft-button ft-secondary" disabled={room.fixtures.length>=12} onClick={() => addConceptFixture('towel_rail')}>+ Towel rail</button></div>}
      <div className="ft-room-feature-list" aria-label="Room features">{[...room.openings, ...room.fixtures].map((f, i) => <button key={f.id} aria-pressed={selected === f.id} onClick={() => setSelected(f.id)}><b>{i + 1}</b> {title(f.kind)}<span>{('wall' in f ? f.segmentId : f.wallAnchor?.segmentId) || ('wall' in f ? f.wall : f.wallAnchor?.wall)} {isPinned(room, f.id) ? '▣' : ''}</span></button>)}</div>
      </div>
      <div className="ft-room-inspector">{fixture && fixture.kind !== 'radiator' ? <><div className="ft-room-inspector-title"><h3>Concept fixture · {title(fixture.kind)}</h3><button className="ft-button ft-secondary" onClick={pin}>{pinned ? 'Unpin fixture' : 'Pin fixture'}</button></div><p className="ft-small-note">Fixed for agents. Human changes remain staged until Confirm; this is a spatial concept only.</p><fieldset disabled={pinned}><label className="ft-field"><span>Back wall anchor</span><select value={room.floorPlan ? fixture.wallAnchor?.segmentId||'' : fixture.wallAnchor?.wall||''} onChange={e=>{if(!e.target.value)return updateConceptFixture({originCell:fixture.originCell});if(room.floorPlan){const segment=segments.find(s=>s.id===e.target.value)!;anchorConcept(segment.wall,fixture.wallAnchor?.offsetCm||20,segment.id);}else anchorConcept(e.target.value as Wall,fixture.wallAnchor?.offsetCm||20);}}><option value="">Free floor position</option>{room.floorPlan ? segments.map(segment=><option key={segment.id} value={segment.id}>{segment.id} · {title(segment.wall)} · {segment.lengthCm} cm</option>) : walls.map(w=><option key={w} value={w}>{title(w)}</option>)}</select></label>{fixture.wallAnchor && <Measurement label="Wall offset" value={fixture.wallAnchor.offsetCm} max={wallLength(room,fixture.wallAnchor.wall,fixture.wallAnchor.segmentId)} onChange={n=>anchorConcept(fixture.wallAnchor!.wall,n,fixture.wallAnchor!.segmentId)}/>}<div className="ft-room-dimensions"><Measurement label="X position" value={fixture.originCell.x * 20} onChange={x => updateConceptFixture({ originCell: { ...fixture.originCell, x: x / 20 } })}/><Measurement label="Y position" value={fixture.originCell.y * 20} onChange={y => updateConceptFixture({ originCell: { ...fixture.originCell, y: y / 20 } })}/><Measurement label="Width" min={1} value={fixture.sizeCm.w} onChange={w => updateConceptFixture({ sizeCm: { ...fixture.sizeCm, w } })}/><Measurement label="Depth" min={1} value={fixture.sizeCm.d} onChange={d => updateConceptFixture({ sizeCm: { ...fixture.sizeCm, d } })}/><Measurement label="Height" min={1} value={fixture.sizeCm.h || 1} onChange={h => updateConceptFixture({ sizeCm: { ...fixture.sizeCm, h } })}/></div><label className="ft-field"><span>Rotation</span><select value={fixture.rotation} onChange={e => updateConceptFixture({ rotation: Number(e.target.value) as 0 | 90 | 180 | 270 })}>{[0,90,180,270].map(n => <option key={n} value={n}>{n}°</option>)}</select></label><button className="ft-text-button ft-room-remove" onClick={remove}>Remove concept fixture</button></fieldset></> : feature && anchor ? <>
        <div className="ft-room-inspector-title"><h3>{title(feature.kind)}</h3><button className="ft-button ft-secondary" onClick={pin}>{pinned ? 'Unpin feature' : 'Pin feature'}</button></div>
        {pinned && <p className="ft-small-note">Pinned. Unpin to move, resize or remove it. Any changes still need your confirmation.</p>}
        <fieldset disabled={pinned || (fixture && fixture.kind !== 'radiator')}>
          <label className="ft-field"><span>{room.floorPlan ? 'Wall segment' : 'Wall'}</span><select value={room.floorPlan ? anchor.segmentId : anchor.wall} onChange={e => { if (room.floorPlan) { const segment=segments.find(s=>s.id===e.target.value)!; if (opening) changeOpening({ wall:segment.wall,segmentId:segment.id,offsetCm:0 }); else changeRadiator({ wall:segment.wall,segmentId:segment.id,offset:0 }); } else if (opening) changeOpening({ wall: e.target.value as Wall }); else changeRadiator({ wall: e.target.value as Wall }); }}>{room.floorPlan ? segments.map(segment=><option key={segment.id} value={segment.id}>{segment.id} · {title(segment.wall)} · {segment.lengthCm} cm</option>) : walls.map(w => <option key={w} value={w}>{title(w)}</option>)}</select></label>
          <Measurement label="Offset from segment start" value={anchor.offsetCm} max={wallLength(room, anchor.wall, anchor.segmentId)} onChange={offsetCm => opening ? changeOpening({ offsetCm }) : changeRadiator({ offset: offsetCm })} />
          <Measurement label={opening ? 'Opening width' : 'Width along wall'} min={opening ? 20 : 1} max={opening ? 400 : 1000} value={opening?.widthCm ?? radiatorMeasures(fixture!).width} onChange={width => opening ? changeOpening({ widthCm: width }) : changeRadiator({ width })} />
          {opening?.kind === 'door' && <>
            <label className="ft-field"><span>Hinge</span><select value={opening.hinge} onChange={e => changeOpening({ hinge: e.target.value as 'start' | 'end' })}><option value="start">Start of opening</option><option value="end">End of opening</option></select></label>
            <label className="ft-field"><span>Swing · checked at 90°</span><select value={opening.swing} onChange={e => changeOpening({ swing: e.target.value as 'in' | 'out' })}><option value="in">Inward</option><option value="out">Outward</option></select></label>
            <label className="ft-field"><span>Door mechanism</span><select value={opening.mechanism} onChange={e => changeOpening({ mechanism: e.target.value as 'hinged' | 'sliding' | 'bifold' | 'pocket' })}>{['hinged', 'sliding', 'pocket', 'bifold'].map(m => <option key={m} value={m}>{m === 'hinged' ? 'Hinged' : `${title(m)} · not modelled`}</option>)}</select></label>
            <label className="ft-check"><input type="checkbox" checked={opening.entrance} onChange={e => changeOpening({ entrance: e.target.checked })} />Entrance · start of footpath</label>
            {opening.mechanism !== 'hinged' && <p className="ft-room-error">This mechanism is not modelled. Layout approval remains blocked.</p>}
          </>}
          {opening?.kind === 'window' && <>
            <Measurement label="Sill height" max={500} value={opening.sillCm} onChange={sillCm => changeOpening({ sillCm })} />
            <Measurement label="Head height" min={1} max={500} value={opening.headCm} onChange={headCm => changeOpening({ headCm })} />
            <label className="ft-field"><span>Window mechanism</span><select value={opening.type} onChange={e => changeOpening({ type: e.target.value as 'fixed' | 'sash' | 'side_hinge' | 'unknown' })}>{['fixed', 'side_hinge', 'sash', 'unknown'].map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}</select></label>
            <label className="ft-check"><input type="checkbox" checked={opening.windowAccess} onChange={e => changeOpening({ windowAccess: e.target.checked })} />Require a clear approach</label>
            <p className="ft-small-note">Leave off if you can comfortably reach the window behind a sofa. Opening-height checks still apply.</p>
          </>}
          {fixture?.kind === 'radiator' && <><Measurement label="Projection into room" min={1} value={radiatorMeasures(fixture).depth} onChange={depth => changeRadiator({ depth })} /><Measurement label="Radiator height" min={1} max={500} value={fixture.sizeCm.h || 0} onChange={height => changeRadiator({ height })} /><p className="ft-small-note">Fixed to this wall for the agent, even when unpinned in your editor.</p></>}
          <button className="ft-text-button ft-room-remove" onClick={remove}>Remove {feature.kind}</button>
        </fieldset>
      </> : <p>Select a feature on the room or add one below the board.</p>}</div>
    </div>
    <details className="ft-exact"><summary>Walking, clearances & required furniture</summary>
      <div className="ft-room-dimensions">{([
        ['walkHardCm', 'Hard walking width', 20, 200], ['walkPreferredCm', 'Preferred walking width', 20, 200], ['H_lowCm', 'Low-object cutoff', 0, 300],
        ['radiatorFrontCm', 'Radiator front clearance', 0, 100], ['windowFrontCm', 'Window front clearance', 0, 100], ['chairPullCm', 'Desk chair pull zone', 20, 200],
      ] as const).map(([key, label, min, max]) => <Measurement key={key} label={label} value={rules[key]} min={min} max={max} onChange={n => setRules({ ...rules, [key]: n })} />)}</div>
      <div className="ft-inline-checks">{(room.profile?.kind==='bedroom'?['bed','desk','chair','storage'] as const:room.profile?.kind==='home_office'?['desk','chair','storage'] as const:room.profile?.kind==='bathroom_concept'?[]:['sofa','tv','desk','storage'] as const).map(kind => <label key={kind} className="ft-check"><input type="checkbox" checked={rules.requiredKinds.includes(kind)} onChange={e => setRules({ ...rules, requiredKinds: e.target.checked ? [...rules.requiredKinds, kind] : rules.requiredKinds.filter(k => k !== kind) })} />{title(kind)}</label>)}</div>
    </details>
    <p className="ft-small-note">Measurements are assumptions until you replace them. These checks are not building regulations, accessibility certification or heating safety advice. Resizing does not move pinned radiators.</p>
    {inputError && <p className="ft-room-error" role="alert">{inputError}</p>}
    {needsReplace && <label className="ft-check ft-room-replace"><input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} />Replace the existing {state.proposal?.kind} proposal with these room inputs. Yours stays unchanged; Undo can restore the old proposal.</label>}
    {message && <p role="status">{message}</p>}
    <div className="ft-modal-actions"><button className="ft-button ft-secondary" onClick={close}>Close editor</button><button className="ft-button ft-primary" disabled={!!inputError || conflict || (needsReplace && !replace)} onClick={stage}>{needsReplace ? 'Replace proposal & stage room' : p ? 'Update staged inputs' : 'Stage room inputs'}</button></div>
    {p && <div className="ft-setup-review"><h3>Review room inputs · revision {p.revision}</h3>
      <div className="ft-room-review-grid"><span>Room</span><strong>{state.room.widthCm} × {state.room.depthCm} → {p.room.widthCm} × {p.room.depthCm} cm</strong><span>Openings</span><strong>{state.room.openings.length} → {p.room.openings.length}</strong><span>Fixed fixtures</span><strong>{state.room.fixtures.length} → {p.room.fixtures.length}</strong><span>Walking</span><strong>{p.rules.walkHardCm} cm hard / {p.rules.walkPreferredCm} cm preferred</strong></div>
      <details><summary>All staged measurements and pins</summary><pre>{JSON.stringify({ room: p.room, rules: p.rules }, null, 2)}</pre></details>
      <p>{report?.validation.hardFailures || 0} layout conflicts · {report?.validation.warnings || 0} warnings with these inputs. Confirming measurements can reveal furniture that needs rearranging.</p>
      {!stagedMatches && <p className="ft-room-error">Stage your latest edits before confirming. An older draft cannot confirm unseen changes.</p>}
      <button className="ft-button ft-primary" disabled={!stagedMatches || proposalStatus(state) === 'stale' || !!inputError} onClick={() => { const result = store.confirmSetup(p.id, p.revision); onResult(result); if (result.operationSucceeded) close(); }}>Confirm room inputs · revision {p.revision}</button>
    </div>}
  </section></div>;
}
