import { CATALOGUE, PALETTES, fromVariant, makeDemo } from './data.ts';
import { bounds, rectCells, validate } from './engine.ts';
import { clone, faces, rotations, type AppState, type Candidate, type CommandResult, type Furniture, type Layout, type Proposal, type Report, type Rules } from './model.ts';
import { TOOL_SCHEMAS, validateSchema } from './schemas.ts';

// All commands are checked against strict recursive schemas before this dispatcher reads dynamic keys.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Schema-validated JSON dispatch boundary; authoritative domain records remain strongly typed.
type Args = Record<string, any>;
export type HumanPatch = Partial<Pick<Furniture, 'originCell' | 'rotation' | 'variantId' | 'targetSofaId' | 'linkedDeskId' | 'wallAnchor' | 'elevationCm' | 'appearance'>>;
export const proposalStatus = (s: AppState, p: Proposal | null = s.proposal) => {
  if (!p) return 'none';
  if (p.baseCurrentRevision !== s.currentRevision || p.baseRuleRevision !== s.ruleRevision) return 'stale';
  const report = validate(p.layout, p.room, p.rules, s.inventory);
  return report.validation.hardFailures ? 'blocked' : p.kind === 'setup' || report.brief.status === 'incomplete' ? 'drafting' : 'ready_for_review';
};
function frozen<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); } return value; }
class CommandError extends Error { code: string; constructor(code: string, message: string) { super(message); this.code = code; } }
function fail(code: string, message: string): never { throw new CommandError(code, message); }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const issueSignature = (i: Report['issues'][number]) => `${i.code}|${[...i.objectIds].sort().join(',')}|${i.destinationId || ''}`;
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 0));
function checkRules(r: Rules) {
  if (r.walkHardCm <= 0 || r.walkPreferredCm < r.walkHardCm) fail('invalid_constraints', 'Preferred walking width must be at least the positive hard minimum.');
}
function sanitizedPatch(a: Args): HumanPatch { const p: Args = {}; for (const k of ['originCell', 'rotation', 'variantId', 'targetSofaId', 'linkedDeskId', 'wallAnchor', 'elevationCm']) if (a[k] !== undefined) p[k] = clone(a[k]); return p; }
export function createStore(initialState: AppState = makeDemo()) {
  let state = frozen(clone(initialState));
  const listeners = new Set<() => void>(), candidates = new Map<string, Candidate>(), retries = new Map<string, { signature: string; result: CommandResult }>();
  const candidateReports = new Map<string, Report>();
  let candidateSeq = 0;
  const getState = () => state;
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
  const publish = (next: AppState) => { state = frozen(next); candidates.clear(); candidateReports.clear(); listeners.forEach(listener => listener()); };
  const rejection = (error: unknown): CommandResult => ({ operationSucceeded: false, error: { code: error instanceof CommandError ? error.code : 'invalid_command', message: error instanceof Error ? error.message : String(error) }, proposalId: state.proposal?.id, revision: state.proposal?.revision, currentRevision: state.currentRevision, ruleRevision: state.ruleRevision });
  const guard = (a: Args, kind?: Proposal['kind']) => {
    const p = state.proposal;
    if (!p || p.id !== a.proposalId) fail('proposal_not_found', 'The requested proposal is not active. Read getRoomState before editing.');
    if (p.revision !== a.revision) fail('revision_conflict', `Expected proposal revision ${a.revision}; active revision is ${p.revision}. Read it again before editing.`);
    if (p.baseCurrentRevision !== state.currentRevision || p.baseRuleRevision !== state.ruleRevision) fail('stale_proposal', 'Yours or accepted room inputs changed. The human must discard this stale draft and recreate it.');
    if (kind && p.kind !== kind) fail(kind === 'layout' ? 'unconfirmed_setup' : 'unauthorized_proposal_kind', `This command requires a ${kind} proposal. Setup inputs require separate human confirmation.`);
    return p;
  };
  const envelope = (p: Proposal, extra: Args = {}): CommandResult => {
    const r = validate(p.layout, p.room, p.rules, state.inventory);
    const issues = r.issues.slice(0, 16).map(issue => ({ ...issue, cells: issue.cells.slice(0, 40), cellCount: issue.cells.length, ...(issue.objectIds.some(id => p.layout.furniture.some(o => o.id === id)) ? { suggestedNextTool: 'findPlacements', suggestedArgs: { proposalId: p.id, revision: p.revision, objectId: issue.objectIds.find(id => p.layout.furniture.some(o => o.id === id)) } } : {}) }));
    return { operationSucceeded: true, proposalId: p.id, revision: p.revision, status: proposalStatus(state, p), baseCurrentRevision: p.baseCurrentRevision, baseRuleRevision: p.baseRuleRevision, validation: r.validation, brief: r.brief, issues, issueCount: r.issues.length, hasMoreIssues: r.issues.length > issues.length, flagsSummary: r.flagsSummary, omitted: p.omitted, ...extra };
  };
  const commit = (p: Proposal, extra: Args = {}) => { p.revision++; const next = clone(state); next.proposal = p; publish(next); return envelope(p, extra); };
  const authoritative = (object: Furniture) => object.ownership === 'owned' ? state.inventory.find(o => o.id === object.id) || fail('unknown_owned_instance', 'Owned piece has no authoritative measured inventory record.') : object;
  const checkPatch = (object: Furniture, patch: HumanPatch, layout: Layout): Furniture => {
    if (object.ownership === 'fixed') fail('lock_violation', 'Fixed room fixtures cannot be changed through furniture commands.');
    const source = authoritative(object), locks = source.locked;
    if (patch.originCell && locks.position && !same(patch.originCell, source.originCell)) fail('lock_violation', `${object.label} has a locked position. Only the human can unlock it.`);
    if (patch.wallAnchor && locks.position && !same(patch.wallAnchor, source.wallAnchor)) fail('lock_violation', 'The wall anchor is locked.');
    if (patch.elevationCm !== undefined && locks.position && patch.elevationCm !== source.elevationCm) fail('lock_violation', 'The elevation is locked.');
    if (patch.rotation !== undefined && locks.rotation && patch.rotation !== source.rotation) fail('lock_violation', `${object.label} has a locked rotation.`);
    if (patch.variantId && object.ownership === 'owned') fail('owned_resize_forbidden', 'Owned dimensions cannot change through a catalogue variant.');
    if (patch.variantId && locks.size && patch.variantId !== object.variantId) fail('lock_violation', 'This piece has a size lock.');
    if (patch.appearance && locks.appearance && patch.appearance !== object.appearance) fail('lock_violation', 'Appearance is locked.');
    if (patch.targetSofaId !== undefined && (object.kind !== 'tv' || !layout.furniture.some(o => o.id === patch.targetSofaId && o.kind === 'sofa'))) fail('invalid_id', 'A TV target must refer to a sofa in this layout.');
    if (patch.linkedDeskId !== undefined && (object.kind !== 'chair' || !layout.furniture.some(o => o.id === patch.linkedDeskId && o.kind === 'desk'))) fail('invalid_id', 'A linked desk must exist, and only a chair can link to it.');
    if ((patch.wallAnchor || patch.elevationCm !== undefined) && object.kind !== 'tv') fail('invalid_property', 'Wall anchors and elevation are editable only for wall TVs in V1.');
    let next = { ...clone(object), ...clone(patch) };
    if (patch.variantId) { const v = CATALOGUE.find(v => v.id === patch.variantId) || fail('variant_unavailable', 'Choose an available named size variant.'); if (v.kind !== object.kind) fail('variant_unavailable', 'A variant must keep the same furniture kind.'); next = { ...next, sizeCm: clone(v.sizeCm), label: v.name }; }
    if (object.ownership === 'owned') { next.sizeCm = clone(source.sizeCm); next.requiredInRoom = source.requiredInRoom; next.locked = clone(source.locked); }
    return next;
  };
  const removeFrom = (layout: Layout, id: string, omitted: Proposal['omitted']) => {
    const object = layout.furniture.find(o => o.id === id) || fail('invalid_id', 'Furniture ID not found.'); const source = authoritative(object);
    if (source.ownership === 'fixed' || Object.values(source.locked).some(Boolean)) fail('lock_violation', 'A piece protected by any lock cannot be removed.');
    if (source.ownership === 'owned' && source.requiredInRoom) fail('required_item_missing', 'The human must explicitly permit excluding this owned piece before it can be removed.');
    layout.furniture = layout.furniture.filter(o => o.id !== id);
    if (source.ownership === 'owned') omitted.push({ objectId: id, reason: 'Excluded with the human’s explicit optional-owned permission. Its measured inventory record is retained.' });
  };
  const resolveCandidate = (a: Args, p: Proposal): HumanPatch | undefined => {
    if (!a.candidateId) return undefined;
    const c = candidates.get(a.candidateId) || fail('revision_conflict', 'Candidate is missing or stale. Run findPlacements again.');
    if (c.proposalId !== p.id || c.proposalRevision !== p.revision || c.ruleRevision !== state.ruleRevision) fail('revision_conflict', 'Candidate was checked against a different proposal or rule revision.');
    if ((a.objectId && c.objectId !== a.objectId) || (a.variantId && a.variantId !== c.variantId)) fail('invalid_candidate', 'Candidate does not match the requested object or variant.');
    for (const property of ['originCell', 'rotation', 'wallAnchor']) if (a[property] !== undefined && !same(a[property], (c as unknown as Record<string, unknown>)[property])) fail('invalid_candidate', 'Do not override a checked candidate placement.');
    return { originCell: clone(c.originCell), rotation: c.rotation, ...(c.variantId ? { variantId: c.variantId } : {}), ...(c.wallAnchor ? { wallAnchor: clone(c.wallAnchor) } : {}) };
  };
  async function search(p: Proposal, a: Args, signal?: AbortSignal, timeLimit = 1800): Promise<{ found: Candidate[]; trials: number; exhausted: boolean }> {
    const existing = a.objectId ? p.layout.furniture.find(o => o.id === a.objectId) || fail('invalid_id', 'Object not found in this proposal.') : undefined;
    if (!existing && !a.variantId) fail('invalid_arguments', 'Supply objectId or variantId.');
    let piece = existing ? clone(existing) : fromVariant(a.variantId, '__candidate__');
    if (existing && a.variantId) piece = checkPatch(existing, { variantId: a.variantId }, p.layout);
    if (piece.kind === 'tv' && !piece.targetSofaId) piece.targetSofaId = p.layout.furniture.find(o => o.kind === 'sofa')?.id;
    const base = validate(p.layout, p.room, p.rules, state.inventory), baseBlocks = new Set(base.issues.filter(i => i.severity === 'block').map(issueSignature));
    const found: Candidate[] = [], positions: HumanPatch[] = [], seen = new Set<string>(), started = Date.now(); let trials = 0;
    const cols = Math.floor(p.room.widthCm / 20), rows = Math.floor(p.room.depthCm / 20);
    const locks = authoritative(piece).locked;
    if (piece.kind === 'tv') {
      const sofa = p.layout.furniture.find(o => o.id === piece.targetSofaId);
      const walls = sofa ? [faces[sofa.rotation], ...(['north', 'west', 'east', 'south'] as const).filter(w => w !== faces[sofa.rotation])] : ['north', 'west', 'east', 'south'] as const;
      for (const wall of walls) { const length = wall === 'north' || wall === 'south' ? p.room.widthCm : p.room.depthCm; const b = sofa && bounds(sofa); const centered = b ? Math.round(((wall === 'north' || wall === 'south' ? b.x + b.w / 2 : b.y + b.d / 2) - piece.sizeCm.w / 2) / 20) * 20 : 0; positions.push({ wallAnchor: { wall, offsetCm: Math.max(0, centered) }, originCell: piece.originCell, rotation: piece.rotation }); for (let offsetCm = 0; offsetCm <= length - piece.sizeCm.w; offsetCm += 20) positions.push({ wallAnchor: { wall, offsetCm }, originCell: piece.originCell, rotation: piece.rotation }); }
    } else {
      const sofa = p.layout.furniture.find(o => o.kind === 'sofa'), b = sofa && bounds(sofa);
      if (piece.kind === 'desk') positions.push({ originCell: { x: 0, y: 4 }, rotation: 270 }, { originCell: { x: cols - 3, y: 4 }, rotation: 90 });
      if (piece.kind === 'coffee_table' && b) positions.push({ originCell: { x: Math.round((b.x + b.w / 2 - piece.sizeCm.w / 2) / 20), y: Math.floor((b.y - p.rules.walkHardCm - piece.sizeCm.d) / 20) }, rotation: 0 });
      if (piece.kind === 'rug' && b) positions.push({ originCell: { x: Math.floor((b.x + b.w / 2 - piece.sizeCm.w / 2) / 20), y: Math.floor((b.y - piece.sizeCm.d + 40) / 20) }, rotation: 0 });
      positions.push({ originCell: piece.originCell, rotation: piece.rotation });
      // Prioritise walls, then sample the interior. Search is bounded and deterministic.
      for (const rotation of rotations) for (let t = 0; t < Math.max(cols, rows); t += 2) {
        const bb = bounds({ ...piece, rotation }); const w = Math.ceil(bb.w / 20), d = Math.ceil(bb.d / 20);
        for (const originCell of [{ x: t, y: 0 }, { x: 0, y: t }, { x: cols - w, y: t }, { x: t, y: rows - d }]) positions.push({ originCell, rotation });
      }
      for (let y = 1; y < rows; y += 2) for (let x = 1; x < cols; x += 2) for (const rotation of rotations) positions.push({ originCell: { x, y }, rotation });
    }
    for (const patch of positions) {
      if (signal?.aborted) fail('cancelled', 'Search cancelled without committing.');
      if (trials >= 160 || Date.now() - started > timeLimit || found.length >= (a.limit || 5)) break;
      const signature = JSON.stringify(patch); if (seen.has(signature)) continue; seen.add(signature);
      if (locks.position && ((patch.originCell && !same(patch.originCell, authoritative(piece).originCell)) || (patch.wallAnchor && !same(patch.wallAnchor, authoritative(piece).wallAnchor)))) continue;
      if (locks.rotation && patch.rotation !== authoritative(piece).rotation) continue;
      trials++;
      let placed: Furniture;
      try { placed = checkPatch(piece, patch, p.layout); } catch { continue; }
      const testLayout = clone(p.layout); testLayout.furniture = [...testLayout.furniture.filter(o => o.id !== placed.id), placed];
      const report = validate(testLayout, p.room, p.rules, state.inventory);
      const relevant = report.issues.filter(i => i.severity === 'block' && (i.objectIds.includes(placed.id) || !baseBlocks.has(issueSignature(i))));
      const avoid = a.avoidFlags || []; const occupiedKeys = new Set(rectCells(bounds(placed)).map(c => `${c.x},${c.y}`));
      const violatesAvoid = placed.kind !== 'tv' && report.cells.some(c => occupiedKeys.has(`${c.x},${c.y}`) && c.flags.some(f => avoid.includes(f)));
      if (!relevant.length && !violatesAvoid) { const candidateId = `candidate-${++candidateSeq}`; candidateReports.set(candidateId, report); found.push({ candidateId, proposalId: p.id, proposalRevision: p.revision, ruleRevision: state.ruleRevision, objectId: existing?.id, variantId: placed.variantId, originCell: placed.originCell, rotation: placed.rotation, wallAnchor: placed.wallAnchor, checkedRules: ['physical_fit', 'solid_overlap', 'doors', 'windows', 'radiator', 'use_zones', 'orthogonal_hard_path', 'preferred_path', 'full_tv_strip', 'ceiling', 'owned_locks', 'required_brief'], placementStatus: 'valid', layoutStatus: report.validation.status, remainingIssues: report.issues.slice(0, 10).map(i => ({ ...i, cells: i.cells.slice(0, 20), cellCount: i.cells.length, hasMoreCells: i.cells.length > 20 })), remainingIssueCount: report.issues.length, hasMoreRemainingIssues: report.issues.length > 10, details: { tool: 'checkLayout', args: { which: 'proposal', revision:p.revision, candidateId, detail:'issues', offset:0, limit:100 } }, brief: report.brief }); }
      if (trials % 8 === 0) await pause();
    }
    if (signal?.aborted) fail('cancelled', 'Search cancelled without committing.');
    return { found, trials, exhausted: trials >= 160 || Date.now() - started > timeLimit };
  }
  const snapshot = (a: Args) => {
    if (a.which === 'current') { if (a.revision !== undefined && a.revision !== state.currentRevision) fail('revision_conflict', 'Current has changed.'); return { layout: state.current, room: state.room, rules: state.rules, revision: state.currentRevision, which: 'current' }; }
    const p = state.proposal || fail('proposal_not_found', 'No proposal exists yet.'); if (a.revision !== undefined && a.revision !== p.revision) fail('revision_conflict', 'Proposal has changed.'); return { layout: p.layout, room: p.room, rules: p.rules, revision: p.revision, which: 'proposal' };
  };
  async function execute(name: string, a: Args, signal?: AbortSignal): Promise<CommandResult> {
    try {
      const definition = TOOL_SCHEMAS[name] || fail('unknown_tool', 'Unknown Floortris tool.');
      const error = validateSchema(a, definition.inputSchema); if (error) fail('invalid_arguments', error);
      if (signal?.aborted) fail('cancelled', 'Command cancelled without mutation.');
      const retryKey = a.idempotencyKey ? `${name}:${a.idempotencyKey}` : undefined, signature = JSON.stringify(a);
      if (retryKey && retries.has(retryKey)) { const prior = retries.get(retryKey)!; if (prior.signature !== signature) fail('idempotency_conflict', 'This idempotency key was already used with different arguments.'); return clone({ ...prior.result, idempotentReplay: true, activeProposalRevision: state.proposal?.revision }); }
      let result: CommandResult;
      if (name === 'listCatalogue') {
        const list = CATALOGUE.filter(v => !a.kind || v.kind === a.kind), offset = a.offset || 0, limit = a.limit || 30;
        return { operationSucceeded: true, catalogue: clone(list.slice(offset, offset + limit)), total: list.length, offset, hasMore: offset + limit < list.length, palettes: clone(PALETTES) };
      }
      if (['getRoomState', 'listFurniture', 'checkLayout'].includes(name)) {
        const snap = snapshot(a); let report = validate(snap.layout, snap.room, snap.rules, state.inventory); if (a.candidateId) { const c = candidates.get(a.candidateId) || fail('revision_conflict','Candidate is stale or unavailable.'); if (a.which !== 'proposal' || c.proposalRevision !== snap.revision || c.ruleRevision !== state.ruleRevision) fail('revision_conflict','Candidate revision differs from the inspected draft.'); report = candidateReports.get(a.candidateId) || fail('revision_conflict','Candidate detail is no longer available.'); } const common = { operationSucceeded: true, which: snap.which, revision: snap.revision, currentRevision: state.currentRevision, ruleRevision: state.ruleRevision, proposalId: state.proposal?.id, status: proposalStatus(state) };
        if (name === 'getRoomState') return clone({ ...common, room: snap.room, rules: snap.rules, coordinates: { origin: 'top-left', x: 'east', y: 'south', cellCm: 20, geometryUnit: 'cm' }, validation: report.validation, brief: report.brief, clearances: report.clearances, flagsSummary: report.flagsSummary, proposalKind: state.proposal?.kind, assumptions: 'Product assumptions, not building regulations or accessibility certification. TV is a height strip check, not optical visibility.' });
        if (name === 'listFurniture') { const list = [...snap.room.fixtures, ...snap.layout.furniture], offset = a.offset || 0, limit = a.limit || 30; return clone({ ...common, furniture: list.slice(offset, offset + limit), total: list.length, offset, hasMore: offset + limit < list.length, ownedInventory: state.inventory }); }
        const inRegion = (c: { x: number; y: number }) => !a.region || (c.x >= a.region.x && c.y >= a.region.y && c.x < a.region.x + a.region.w && c.y < a.region.y + a.region.d);
        const entries = a.detail === 'flags' ? report.cells.filter(c => inRegion(c) && (!a.objectId || c.objectIds.includes(a.objectId)) && (!a.ruleCode || c.flags.includes(a.ruleCode))) : report.issues.filter(i => (!a.ruleCode || i.code === a.ruleCode) && (!a.objectId || i.objectIds.includes(a.objectId)) && (!a.region || i.cells.some(inRegion))).map(i => ({ ...i, cells: i.cells.slice(0, 60), cellCount: i.cells.length }));
        const offset = a.offset || 0, limit = a.limit || 30;
        return clone({ ...common, scope: a.candidateId ? 'hypothetical_candidate' : a.region || a.objectId || a.ruleCode ? 'focused_details_with_full_layout_status' : 'full_layout', validation: report.validation, brief: report.brief, clearances: report.clearances, flagsSummary: report.flagsSummary, [a.detail === 'flags' ? 'cells' : 'issues']: entries.slice(offset, offset + limit), total: entries.length, offset, hasMore: offset + limit < entries.length, nextOffset: offset + limit < entries.length ? offset + limit : null });
      }
      if (name === 'createProposal') {
        if (state.proposal) fail('active_proposal_exists', 'A draft already exists. Only the human can discard or apply it before starting another.');
        if (state.currentRevision !== a.expectedCurrentRevision || state.ruleRevision !== a.expectedRuleRevision) fail('revision_conflict', 'Accepted current or rule revision changed. Read getRoomState again.');
        const next = clone(state); next.sequence++;
        const p: Proposal = { id: `proposal-${next.sequence}`, kind: a.kind, revision: 1, baseCurrentRevision: state.currentRevision, baseRuleRevision: state.ruleRevision, layout: clone(state.current), room: clone(state.room), rules: clone(state.rules), omitted: [] }; next.proposal = p; publish(next); result = envelope(p);
      } else {
        const p = clone(guard(a, ['setRoomGeometry', 'setOpening', 'setConstraints'].includes(name) ? 'setup' : 'layout'));
        if (name === 'findPlacements') { const searched = await search(p, a, signal); guard(a, 'layout'); searched.found.forEach(c => candidates.set(c.candidateId, c)); return { ...envelope(p), candidates: clone(searched.found), trials: searched.trials, searchBoundReached: searched.exhausted, explanation: searched.found.length ? 'Every returned placement passed relevant/new hard checks; layoutStatus includes unrelated existing issues.' : 'No candidate found within the bounded scan. This is not proof that no placement exists.' }; }
        if (name === 'setRoomGeometry') { p.room = { ...p.room, ...(a.widthCm !== undefined ? {widthCm:a.widthCm} : {}), ...(a.depthCm !== undefined ? {depthCm:a.depthCm} : {}), ...(a.name !== undefined ? {name:a.name} : {}) }; }
        else if (name === 'setOpening') { if (a.opening.kind === 'window' && a.opening.headCm <= a.opening.sillCm) fail('invalid_opening', 'Window head must be above its sill.'); const idx = p.room.openings.findIndex(o => o.id === a.opening.id); if (idx >= 0) p.room.openings[idx] = clone(a.opening); else { if (p.room.openings.length >= 12) fail('room_limit', 'V1 supports at most 12 openings.'); p.room.openings.push(clone(a.opening)); } }
        else if (name === 'setConstraints') { p.rules = { ...p.rules, ...clone(a.constraints) }; checkRules(p.rules); }
        else if (name === 'setAppearance') {
          const group = PALETTES[a.target as keyof typeof PALETTES]; if (!group.some(palette => palette.id === a.paletteId)) fail('invalid_palette', 'Choose an ID from listCatalogue palettes.');
          if (a.target === 'furniture') { const object = p.layout.furniture.find(o => o.id === a.objectId) || fail('invalid_id', 'Furniture ID not found.'); const updated = checkPatch(object, { appearance: a.paletteId }, p.layout); p.layout.furniture = p.layout.furniture.map(o => o.id === object.id ? updated : o); }
          else p.layout.appearance[a.target as 'wall' | 'floor'] = a.paletteId;
        } else if (name === 'removeFurniture') removeFrom(p.layout, a.objectId, p.omitted);
        else if (name === 'updateFurniture') {
          const object = p.layout.furniture.find(o => o.id === a.objectId) || fail('invalid_id', 'Furniture ID not found. Fixed features cannot be edited here.');
          const candidatePatch = resolveCandidate(a, p); const patch = candidatePatch || sanitizedPatch(a); const updated = checkPatch(object, patch, p.layout); p.layout.furniture = p.layout.furniture.map(o => o.id === object.id ? updated : o);
        } else if (name === 'placeFurniture') {
          const candidatePatch = resolveCandidate(a, p); let object: Furniture;
          if (a.ownedId) { if (a.variantId) fail('owned_resize_forbidden', 'Owned pieces cannot use catalogue variants.'); object = clone(state.inventory.find(o => o.id === a.ownedId) || fail('invalid_id', 'Owned inventory ID not found.')); if (p.layout.furniture.some(o => o.id === object.id)) fail('duplicate_owned_instance', 'This owned piece is already in the layout. Use updateFurniture.'); }
          else { const variantId = candidatePatch?.variantId || a.variantId; if (!variantId) fail('invalid_arguments', 'Provide variantId or ownedId.'); object = fromVariant(variantId, `piece-${state.sequence + 1}-${p.revision}`); }
          if (p.layout.furniture.length >= 30) fail('room_limit', 'V1 supports 30 movable pieces.');
          if (object.kind === 'tv') object.targetSofaId = a.targetSofaId || p.layout.furniture.find(o => o.kind === 'sofa')?.id;
          object = checkPatch(object, candidatePatch || sanitizedPatch(a), p.layout); p.layout.furniture.push(object);
          p.omitted = p.omitted.filter(o => o.objectId !== object.id);
        } else if (name === 'proposeLayout') {
          const requested: string[] = a.variantIds || ['frame-tv-120', 'line-desk-100', 'pebble-table-80', 'weave-rug-200'];
          requested.forEach(id => { if (!CATALOGUE.some(v => v.id === id)) fail('variant_unavailable', `Unknown catalogue variant: ${id}.`); });
          const priority: Record<string, number> = { sofa: 1, tv: 2, desk: 3, storage: 4, coffee_table: 5, table: 5, chair: 6, plant: 7, rug: 8 };
          const wanted = [...requested];
          for (const kind of p.rules.requiredKinds) if (!p.layout.furniture.some(o => o.kind === kind) && !wanted.some(id => CATALOGUE.find(v => v.id === id)?.kind === kind)) { const variant = CATALOGUE.find(v => v.kind === kind); if (variant) wanted.push(variant.id); }
          wanted.sort((a, b) => (priority[CATALOGUE.find(v => v.id === a)!.kind] || 9) - (priority[CATALOGUE.find(v => v.id === b)!.kind] || 9));
          let trials = 0; const start = Date.now();
          for (const object of [...p.layout.furniture]) {
            const report = validate(p.layout, p.room, p.rules, state.inventory); if (!report.issues.some(i => i.severity === 'block' && i.objectIds.includes(object.id))) continue;
            if (Date.now() - start > 6500) break;
            const found = await search(p, { objectId: object.id, limit: 1 }, signal, 900); trials += found.trials;
            if (found.found[0]) { const c = found.found[0]; const patch = { originCell: c.originCell, rotation: c.rotation, ...(c.wallAnchor ? { wallAnchor: c.wallAnchor } : {}) }; p.layout.furniture = p.layout.furniture.map(o => o.id === object.id ? checkPatch(o, patch, p.layout) : o); }
          }
          for (const variantId of [...new Set(wanted)]) {
            const v = CATALOGUE.find(v => v.id === variantId)!; if (p.layout.furniture.some(o => o.kind === v.kind)) continue;
            if (signal?.aborted) fail('cancelled', 'Planning cancelled without committing.');
            const found = Date.now() - start > 6500 ? { found: [] as Candidate[], trials: 0 } : await search(p, { variantId, limit: 1 }, signal, 1100); trials += found.trials;
            if (found.found[0]) { const c = found.found[0], object = fromVariant(variantId, `planned-${v.kind}-${p.revision}`); Object.assign(object, { originCell: c.originCell, rotation: c.rotation }); if (c.wallAnchor) object.wallAnchor = c.wallAnchor; if (object.kind === 'tv') object.targetSofaId = p.layout.furniture.find(o => o.kind === 'sofa')?.id; p.layout.furniture.push(object); }
            else { const smaller = CATALOGUE.filter(x => x.kind === v.kind && x.sizeCm.w * x.sizeCm.d < v.sizeCm.w * v.sizeCm.d).sort((a, b) => b.sizeCm.w * b.sizeCm.d - a.sizeCm.w * a.sizeCm.d)[0]; const checkedSmaller = smaller && Date.now() - start <= 6500 ? await search(p,{variantId:smaller.id,limit:1},signal,600) : undefined; trials += checkedSmaller?.trials || 0; p.omitted.push({ variantId, reason: `No placement found in this bounded greedy scan. ${p.rules.requiredKinds.includes(v.kind) ? 'This required function is still missing.' : 'Optional piece omitted.'} Not proof of infeasibility.`, ...(smaller && checkedSmaller?.found[0] ? { alternativeVariantId: smaller.id, alternativeChecked: { trials:checkedSmaller.trials, placementStatus:'valid', layoutStatus:checkedSmaller.found[0].layoutStatus, proposalRevision:p.revision, ruleRevision:state.ruleRevision } } : {}) }); }
          }
          if (signal?.aborted) fail('cancelled', 'Planning cancelled without committing.'); guard(a, 'layout'); result = commit(p, { planner: { kind: 'deterministic_bounded_greedy', trials, elapsedMs: Date.now() - start, complete: validate(p.layout, p.room, p.rules, state.inventory).validation.hardFailures === 0 && validate(p.layout, p.room, p.rules, state.inventory).brief.status === 'satisfied' } });
          return result;
        }
        if (signal?.aborted) fail('cancelled', 'Command cancelled without committing.');
        result = commit(p);
      }
      if (retryKey) { retries.set(retryKey, { signature, result: clone(result) }); if (retries.size > 100) retries.delete(retries.keys().next().value!); }
      return clone(result);
    } catch (error) { return rejection(error); }
  }
  const human = (fn: () => CommandResult): CommandResult => { try { return fn(); } catch (error) { return rejection(error); } };
  const humanUpdate = (which: 'current' | 'proposal', id: string, patch: HumanPatch) => human(() => {
    const inputError = validateSchema({ proposalId: 'human', revision: 1, objectId: id, ...Object.fromEntries(Object.entries(patch).filter(([k]) => k !== 'appearance')) }, TOOL_SCHEMAS.updateFurniture.inputSchema); if (inputError) fail('invalid_arguments', inputError);
    if (patch.appearance && !PALETTES.furniture.some(p => p.id === patch.appearance)) fail('invalid_palette', 'Unknown palette.');
    const next = clone(state), layout = which === 'current' ? next.current : next.proposal?.kind === 'layout' ? next.proposal.layout : fail('unconfirmed_setup', 'Choose a layout proposal to edit furniture.');
    const object = layout.furniture.find(o => o.id === id) || fail('invalid_id', 'Furniture ID not found.'); layout.furniture = layout.furniture.map(o => o.id === id ? checkPatch(object, patch, layout) : o);
    if (which === 'current') next.currentRevision++; else next.proposal!.revision++;
    publish(next); return which === 'proposal' ? envelope(next.proposal!) : { operationSucceeded: true, currentRevision: state.currentRevision };
  });
  const humanAdd = (which: 'current' | 'proposal', variantId: string) => human(() => {
    const next = clone(state), layout = which === 'current' ? next.current : next.proposal?.kind === 'layout' ? next.proposal.layout : fail('unconfirmed_setup', 'Create a layout proposal first.');
    if (layout.furniture.length >= 30) fail('room_limit', 'V1 supports 30 pieces.'); next.sequence++;
    const o = fromVariant(variantId, `human-${next.sequence}`), sofa = layout.furniture.find(f => f.kind === 'sofa');
    if (o.kind === 'tv') { o.targetSofaId = sofa?.id; if (sofa) { const b = bounds(sofa), wall = faces[sofa.rotation]; o.wallAnchor = { wall, offsetCm: Math.max(0, Math.round(((wall === 'north' || wall === 'south' ? b.x + b.w / 2 : b.y + b.d / 2) - o.sizeCm.w / 2) / 20) * 20) }; } }
    else if (o.kind === 'desk') { o.originCell = { x: 0, y: 4 }; o.rotation = 270; }
    else if (o.kind === 'coffee_table' && sofa) { const b = bounds(sofa); o.originCell = { x: Math.round((b.x + b.w / 2 - o.sizeCm.w / 2) / 20), y: Math.max(0, Math.floor((b.y - state.rules.walkHardCm - o.sizeCm.d) / 20)) }; }
    else if (o.kind === 'rug' && sofa) { const b = bounds(sofa); o.originCell = { x: Math.max(0, Math.floor((b.x + b.w / 2 - o.sizeCm.w / 2) / 20)), y: Math.max(0, Math.floor((b.y - o.sizeCm.d + 40) / 20)) }; }
    else o.originCell = { x: 2, y: 2 };
    layout.furniture.push(o); if (which === 'current') next.currentRevision++; else next.proposal!.revision++; publish(next); return { operationSucceeded: true, objectId: o.id };
  });
  const humanRemove = (which: 'current' | 'proposal', id: string) => human(() => {
    const next = clone(state), layout = which === 'current' ? next.current : next.proposal?.kind === 'layout' ? next.proposal.layout : fail('unconfirmed_setup', 'Select a layout draft.'); removeFrom(layout, id, next.proposal?.omitted || []); if (which === 'current') next.currentRevision++; else next.proposal!.revision++; publish(next); return { operationSucceeded: true };
  });
  const humanSetLocks = (id: string, locks: Furniture['locked']) => human(() => {
    const next = clone(state), o = next.current.furniture.find(o => o.id === id) || fail('invalid_id', 'Select a piece in Yours to change its locks.');
    o.locked = clone(locks); const inventory = next.inventory.find(i => i.id === id); if (inventory) { inventory.locked = clone(locks); inventory.originCell = clone(o.originCell); inventory.rotation = o.rotation; inventory.wallAnchor = clone(o.wallAnchor); inventory.elevationCm = o.elevationCm; }
    next.currentRevision++; publish(next); return { operationSucceeded: true };
  });
  const humanSetRequired = (id: string, required: boolean) => human(() => { const next = clone(state), inventory = next.inventory.find(o => o.id === id) || fail('invalid_id', 'Owned inventory piece not found.'); inventory.requiredInRoom = required; const o = next.current.furniture.find(o => o.id === id); if (o) o.requiredInRoom = required; next.currentRevision++; publish(next); return { operationSucceeded: true }; });
  const humanAddOwned = (input: { label: string; kind: Furniture['kind']; sizeCm: Furniture['sizeCm'] }) => human(() => {
    if (!input.label.trim() || input.label.length > 100 || !['sofa','chair','desk','coffee_table','storage','plant','bed','rug','other','table'].includes(input.kind)) fail('invalid_arguments', 'Choose a supported floor furniture type and name.');
    const size = input.sizeCm;
    if (![size.w,size.d].every(n => Number.isFinite(n) && n > 0 && n <= 600) || (size.h !== null && (!Number.isFinite(size.h) || size.h < 0 || size.h > 500))) fail('invalid_measurement', 'Use finite positive dimensions, and a measured height or unknown.');
    const next = clone(state); if (next.current.furniture.length >= 30) fail('room_limit', 'V1 supports 30 pieces.'); next.sequence++;
    const object: Furniture = { id: `owned-${next.sequence}`, label: input.label.trim(), kind: input.kind, ownership: 'owned', sizeCm: clone(size), originCell: {x:2,y:2}, rotation:0, elevationCm:0, locked:{size:true}, appearance:'oat', requiredInRoom:true, tags: input.kind === 'sofa' ? ['seating'] : [] };
    next.inventory.push(clone(object)); next.current.furniture.push(object); next.currentRevision++; publish(next); return { operationSucceeded:true, objectId:object.id };
  });
  const humanMeasureOwned = (id: string, size: Furniture['sizeCm']) => human(() => {
    if (![size.w, size.d].every(n => Number.isFinite(n) && n > 0 && n <= 600) || (size.h !== null && (!Number.isFinite(size.h) || size.h < 0 || size.h > 500))) fail('invalid_measurement', 'Use finite positive width/depth up to 600 cm, and a height up to 500 cm or unknown.');
    const next = clone(state), inventory = next.inventory.find(o => o.id === id) || fail('invalid_id', 'Owned piece not found.'); inventory.sizeCm = clone(size); const object = next.current.furniture.find(o => o.id === id); if (object) object.sizeCm = clone(size); next.currentRevision++; publish(next); return { operationSucceeded: true };
  });
  const applyProposal = (proposalId: string, revision: number) => human(() => { const p = guard({ proposalId, revision }, 'layout'), report = validate(p.layout, p.room, p.rules, state.inventory); if (report.validation.hardFailures || report.brief.status !== 'satisfied') fail('blocked_apply', 'Resolve hard failures and complete the required lounge brief before Apply.'); const next = clone(state); next.current = clone(p.layout); next.currentRevision++; next.proposal = null; publish(next); return { operationSucceeded: true, currentRevision: state.currentRevision }; });
  const confirmSetup = (proposalId: string, revision: number) => human(() => { const p = guard({ proposalId, revision }, 'setup'); checkRules(p.rules); const next = clone(state); next.room = clone(p.room); next.rules = clone(p.rules); next.ruleRevision++; next.proposal = null; publish(next); return { operationSucceeded: true, ruleRevision: state.ruleRevision, validation: validate(next.current, next.room, next.rules, next.inventory).validation }; });
  const discardProposal = () => { const next = clone(state); next.proposal = null; publish(next); return { operationSucceeded: true }; };
  const resetDemo = () => { retries.clear(); publish(makeDemo()); };
  return { getState, subscribe, execute, humanUpdate, humanAdd, humanRemove, humanSetLocks, humanSetRequired, humanAddOwned, humanMeasureOwned, applyProposal, confirmSetup, discardProposal, resetDemo };
}
export type FloortrisStore = ReturnType<typeof createStore>;
