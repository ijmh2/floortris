import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { bounds, validate, wallBand } from './engine.ts';
import { wallSnap } from './interactions.ts';
import { clone, type AppState, type CommandResult, type Furniture, type Opening, type Room, type Wall } from './model.ts';
import { horizontalWall, radiatorMeasures, radiatorOnWall, roomEditStamp, validateRoomInputs, wallLength, walls } from './room-inputs.ts';
import { proposalStatus, type FloortrisStore } from './store.ts';
import './room-editor.css';

function Measurement({ label, value, onChange, min = 0, max = 1000 }: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number }) {
  return <label className="ft-field"><span>{label} <small>cm</small></span><input type="number" min={min} max={max} step={1} value={Number.isFinite(value) ? value : ''} onChange={e => onChange(e.target.valueAsNumber)} /></label>;
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
  const changeRadiator = (patch: { wall?: Wall; offset?: number; width?: number; depth?: number; height?: number }) => {
    if (!fixture || pinned) return;
    const m = radiatorMeasures(fixture);
    setRoom(r => ({ ...r, fixtures: r.fixtures.map(f => f.id === fixture.id ? radiatorOnWall(f, r, patch.wall ?? f.wallAnchor!.wall, patch.offset ?? f.wallAnchor!.offsetCm, patch.width ?? m.width, patch.depth ?? m.depth, patch.height ?? f.sizeCm.h!) : f) }));
  };
  const resizeRoom = (patch: Partial<Pick<Room, 'widthCm' | 'depthCm'>>) => setRoom(r => {
    const next = { ...r, ...patch };
    next.fixtures = r.fixtures.map(f => {
      if (f.kind !== 'radiator' || !f.wallAnchor || f.locked.position) return f;
      const m = radiatorMeasures(f); return radiatorOnWall(f, next, f.wallAnchor.wall, f.wallAnchor.offsetCm, m.width, m.depth, f.sizeCm.h!);
    });
    return next;
  });
  const pin = () => {
    if (!selected) return;
    setRoom(r => opening ? { ...r, openingLocks: pinned ? (r.openingLocks || []).filter(id => id !== selected) : [...(r.openingLocks || []), selected] } : { ...r, fixtures: r.fixtures.map(f => f.id === selected ? { ...f, locked: { ...f.locked, position: !pinned, size: !pinned, rotation: !pinned } } : f) });
  };
  const add = (kind: 'door' | 'window' | 'radiator') => {
    const id = `${kind}-${crypto.randomUUID()}`;
    if (kind === 'radiator') {
      const f: Furniture = { id, label: 'Radiator', kind, ownership: 'fixed', sizeCm: { w: 100, d: 20, h: 60 }, originCell: { x: 1, y: 0 }, rotation: 0, elevationCm: 0, locked: {}, appearance: 'chalk', requiredInRoom: true, tags: [] };
      setRoom(r => ({ ...r, fixtures: [...r.fixtures, radiatorOnWall(f, r, 'north', 20, 100, 20, 60)] }));
    } else {
      const base = { id, wall: 'north' as const, offsetCm: 20, widthCm: kind === 'door' ? 80 : 100 };
      const o: Opening = kind === 'door' ? { ...base, kind, hinge: 'start', swing: 'in', angle: 90, mechanism: 'hinged', entrance: !room.openings.some(o => o.kind === 'door' && o.entrance) } : { ...base, kind, sillCm: 95, headCm: 210, type: 'fixed', windowAccess: false };
      setRoom(r => ({ ...r, openings: [...r.openings, o] }));
    }
    setSelected(id); setMessage('New feature added to the editor. Choose its wall and measurements.');
  };
  const remove = () => {
    if (!selected || pinned) return;
    setRoom(r => ({ ...r, openings: r.openings.filter(o => o.id !== selected), fixtures: r.fixtures.filter(f => f.id !== selected), openingLocks: (r.openingLocks || []).filter(id => id !== selected) }));
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
    setRoom(r => o ? { ...r, openings: r.openings.map(item => item.id === g.id ? { ...item, ...snap } : item) } : { ...r, fixtures: r.fixtures.map(item => { if (item.id !== g.id) return item; const m = radiatorMeasures(item); return radiatorOnWall(item, r, snap.wall, snap.offsetCm, m.width, m.depth, item.sizeCm.h!); }) });
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
    <div className="ft-room-dimensions"><Measurement label="Room width" min={240} value={room.widthCm} onChange={widthCm => resizeRoom({ widthCm })} /><Measurement label="Room depth" min={240} value={room.depthCm} onChange={depthCm => resizeRoom({ depthCm })} /><Measurement label="Ceiling" min={100} max={500} value={rules.ceilingCm} onChange={ceilingCm => setRules({ ...rules, ceilingCm })} /></div>
    <div className="ft-room-workspace">
      <div className="ft-room-map-column"><div className="ft-room-map-frame"><span className="ft-wall-label ft-wall-north">NORTH · {room.widthCm} cm</span><span className="ft-wall-label ft-wall-west">WEST</span><span className="ft-wall-label ft-wall-east">EAST</span><span className="ft-wall-label ft-wall-south">SOUTH</span>
        <div ref={board} className="ft-room-map" aria-label="Wall feature editor" style={{ aspectRatio: `${Number.isFinite(room.widthCm) ? room.widthCm : 300} / ${Number.isFinite(room.depthCm) ? room.depthCm : 300}`, backgroundSize: `${20 / room.widthCm * 100}% ${20 / room.depthCm * 100}%` }}>
          {state.current.furniture.filter(f => f.kind !== 'tv').map(f => <div key={f.id} className="ft-room-context-piece" style={rectStyle(bounds(f))} aria-hidden="true">{f.kind}</div>)}
          {[...room.openings, ...room.fixtures].map((f, index) => {
            const isOpening = 'wall' in f, wall = isOpening ? f.wall : f.wallAnchor?.wall || 'north';
            const b = isOpening ? wallBand(room, wall, f.offsetCm, f.widthCm, 10) : bounds(f);
            const locked = isPinned(room, f.id), label = `${title(f.kind)} ${index + 1}`;
            return <button key={f.id} type="button" aria-label={`Select ${label}${locked ? ', pinned' : ''}`} aria-pressed={selected === f.id} title={`${label}${locked ? ' · pinned' : ' · drag along walls'}`} className={`ft-room-feature ft-feature-${f.kind} ${horizontalWall(wall) ? 'ft-feature-horizontal' : 'ft-feature-vertical'} ${selected === f.id ? 'selected' : ''} ${locked ? 'pinned' : ''}`} style={rectStyle(b)} onClick={() => setSelected(f.id)} onPointerDown={e => startDrag(e, f.id)} onPointerMove={drag} onPointerUp={e => finishDrag(e)} onPointerCancel={e => finishDrag(e, true)} onLostPointerCapture={e => finishDrag(e, true)}><span>{index + 1}{locked ? ' ▣' : ''}</span></button>;
          })}
        </div>
      </div><p className="ft-small-note">20 cm drag snap · exact inputs accept 1 cm. Faded pieces show Yours for context. Offsets run left → right on north/south; top → bottom on east/west.</p>
      <div className="ft-room-legend"><span>▰ Door</span><span>▱ Window</span><span>▥ Radiator</span><span>▣ Pinned</span></div>
      <div className="ft-inline-buttons"><button className="ft-button ft-secondary" disabled={room.openings.length >= 12} onClick={() => add('door')}>+ Door</button><button className="ft-button ft-secondary" disabled={room.openings.length >= 12} onClick={() => add('window')}>+ Window</button><button className="ft-button ft-secondary" disabled={room.fixtures.length >= 12} onClick={() => add('radiator')}>+ Radiator</button></div>
      <div className="ft-room-feature-list" aria-label="Room features">{[...room.openings, ...room.fixtures].map((f, i) => <button key={f.id} aria-pressed={selected === f.id} onClick={() => setSelected(f.id)}><b>{i + 1}</b> {title(f.kind)}<span>{'wall' in f ? f.wall : f.wallAnchor?.wall} {isPinned(room, f.id) ? '▣' : ''}</span></button>)}</div>
      </div>
      <div className="ft-room-inspector">{feature && anchor ? <>
        <div className="ft-room-inspector-title"><h3>{title(feature.kind)}</h3><button className="ft-button ft-secondary" onClick={pin}>{pinned ? 'Unpin feature' : 'Pin feature'}</button></div>
        {pinned && <p className="ft-small-note">Pinned. Unpin to move, resize or remove it. Any changes still need your confirmation.</p>}
        <fieldset disabled={pinned || (fixture && fixture.kind !== 'radiator')}>
          <label className="ft-field"><span>Wall</span><select value={anchor.wall} onChange={e => opening ? changeOpening({ wall: e.target.value as Wall }) : changeRadiator({ wall: e.target.value as Wall })}>{walls.map(w => <option key={w} value={w}>{title(w)}</option>)}</select></label>
          <Measurement label="Offset from wall start" value={anchor.offsetCm} max={wallLength(room, anchor.wall)} onChange={offsetCm => opening ? changeOpening({ offsetCm }) : changeRadiator({ offset: offsetCm })} />
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
      <div className="ft-inline-checks">{(['sofa', 'tv', 'desk', 'storage'] as const).map(kind => <label key={kind} className="ft-check"><input type="checkbox" checked={rules.requiredKinds.includes(kind)} onChange={e => setRules({ ...rules, requiredKinds: e.target.checked ? [...rules.requiredKinds, kind] : rules.requiredKinds.filter(k => k !== kind) })} />{title(kind)}</label>)}</div>
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
