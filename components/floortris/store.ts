import { CATALOGUE, DEFAULT_RULES, PALETTES, fromVariant, makeDemo } from './data.ts';
import { COFFEE_TABLE_GAP_MIN_CM, bedAccessBands, bounds, frontBand, furnitureBackWall, rectCells, validate, wallGaps, wantsWallBacking } from './sectional-engine.ts';
import { clone, faces, opposite, rotations, type AppState, type ToolLogEntry, type Candidate, type CommandResult, type Furniture, type Layout, type Proposal, type Report, type Room, type Rules, type Wall } from './model.ts';
import { TOOL_SCHEMAS, validateSchema } from './schemas.ts';
import { roomEditStamp, validateRoomInputs } from './room-inputs.ts';
import { profileRules } from './samples.ts';
import { documentId } from './persistence.ts';
import { anchorForDirection, rectInsideRoom, resolveWallSegment, wallRect, wallSegments } from './floorplan.ts';
import { canSupportLamp, isFloorOccupant, LIGHT_KINDS, normalizeFixturePlacement } from './fixture-placement.ts';
import { makeCustomFurniture } from './custom-furniture.ts';
import { sectionalGeometryError } from './sectional.ts';

// All commands are checked against strict recursive schemas before this dispatcher reads dynamic keys.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Schema-validated JSON dispatch boundary; authoritative domain records remain strongly typed.
type Args = Record<string, any>;
export type HumanPatch = Partial<Pick<Furniture, 'originCell' | 'rotation' | 'variantId' | 'targetSofaId' | 'linkedDeskId' | 'attachedOpeningId' | 'supportObjectId' | 'lightingZone' | 'wallAnchor' | 'elevationCm' | 'appearance'>>;
/** V1 data is retained byte-for-byte in layout terms; V2 only adds room intent. */
export function migrateState(input: AppState): AppState {
  const next = clone(input);
  if (next.version === 1 || !next.room.profile) {
    next.version = 2;
    next.room.profile = { kind: 'lounge' };
    if (next.proposal && !next.proposal.room.profile) next.proposal.room.profile = { kind: 'lounge' };
  }
  return next;
}
export const proposalStatus = (s: AppState, p: Proposal | null = s.proposal) => {
  if (!p) return 'none';
  if (p.baseCurrentRevision !== s.currentRevision || p.baseRuleRevision !== s.ruleRevision) return 'stale';
  const report = validate(p.layout, p.room, p.rules, s.inventory, false);
  return report.validation.hardFailures ? 'blocked' : p.kind === 'setup' || report.brief.status === 'incomplete' ? 'drafting' : 'ready_for_review';
};
function frozen<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); } return value; }
class CommandError extends Error { code: string; constructor(code: string, message: string) { super(message); this.code = code; } }
function fail(code: string, message: string): never { throw new CommandError(code, message); }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const issueSignature = (i: Report['issues'][number]) => `${i.code}|${[...i.objectIds].sort().join(',')}|${i.destinationId || ''}`;
const ISSUE_COST: Record<string, number> = { side_against_wall: 240, prefer_wall_backing: 220, bed_head_wall: 220, coffee_table_position: 210, coffee_table_gap: 200, chair_desk_offset: 140, prefer_flush_to_wall: 80, meeting_table_clearance: 80, prefer_sofa_into_room: 70, walk_tight: 40, prefer_desk_window: 25, table_centred_on_sofa: 25, prefer_even_distribution: 3, prefer_open_floor: 3 };
const issueCost = (issue: Report['issues'][number]) => issue.severity === 'block' ? 10000 : ISSUE_COST[issue.code] || (issue.severity === 'warning' ? 50 : 1);
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 0));
function checkRules(r: Rules) {
  if (r.walkHardCm <= 0 || r.walkPreferredCm < r.walkHardCm) fail('invalid_constraints', 'Preferred walking width must be at least the positive hard minimum.');
}
function sanitizedPatch(a: Args): HumanPatch { const p: Args = {}; for (const k of ['originCell', 'rotation', 'variantId', 'targetSofaId', 'linkedDeskId', 'attachedOpeningId', 'supportObjectId', 'lightingZone', 'wallAnchor', 'elevationCm']) if (a[k] !== undefined) p[k] = clone(a[k]); return p; }
export function createStore(initialState: AppState = makeDemo(), options: { beforeNewDocument?: (previous: AppState, next: AppState) => void } = {}) {
  let state = frozen(migrateState(initialState));
  let generating = false;
  const documents = new Map<string, AppState>([[documentId(state), state]]);
  let toolSeq = 0;
  const listeners = new Set<() => void>(), candidates = new Map<string, Candidate>(), retries = new Map<string, { signature: string; result: CommandResult }>();
  const candidateReports = new Map<string, Report>();
  let candidateSeq = 0;
  const past: AppState[] = [], future: AppState[] = [];
  const getState = () => state;
  const getDocuments = () => [...documents.values()].map(saved => documentId(saved) === documentId(state) ? state : saved);
  const getHistory = () => ({ canUndo: past.length > 0, canRedo: future.length > 0, undoCount: past.length, redoCount: future.length });
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
  const publish = (next: AppState, record = true) => {
    if (record) { past.push(state); if (past.length > 50) past.shift(); future.length = 0; }
    state = frozen(next); candidates.clear(); candidateReports.clear(); listeners.forEach(listener => listener());
  };
  // Restore content, never old authority tokens: in-flight searches, retries and
  // captured Apply buttons must not become valid again after undo/redo/reset.
  const restored = (snapshot: AppState) => {
    const next = clone(snapshot), fresh = proposalStatus(snapshot) !== 'stale';
    next.currentRevision = Math.max(state.currentRevision, snapshot.currentRevision) + 1;
    next.ruleRevision = Math.max(state.ruleRevision, snapshot.ruleRevision) + 1;
    next.sequence = Math.max(state.sequence, snapshot.sequence) + 1;
    if (next.proposal) {
      next.proposal.id = `proposal-${next.sequence}`;
      next.proposal.revision = Math.max(state.proposal?.revision || 0, next.proposal.revision) + 1;
      next.proposal.baseCurrentRevision = next.currentRevision - (fresh ? 0 : 1);
      next.proposal.baseRuleRevision = next.ruleRevision;
    }
    retries.clear(); return next;
  };
  const rejection = (error: unknown): CommandResult => ({ operationSucceeded: false, error: { code: error instanceof CommandError ? error.code : 'invalid_command', message: error instanceof Error ? error.message : String(error) }, proposalId: state.proposal?.id, revision: state.proposal?.revision, currentRevision: state.currentRevision, ruleRevision: state.ruleRevision });
  const guard = (a: Args, kind?: Proposal['kind']) => {
    const p = state.proposal;
    if (!p || p.id !== a.proposalId) fail('proposal_not_found', 'The requested proposal is not active. Read getRoomState before editing.');
    if (p.revision !== a.revision) fail('revision_conflict', `Expected proposal revision ${a.revision}; active revision is ${p.revision}. Read it again before editing.`);
    if (p.baseCurrentRevision !== state.currentRevision || p.baseRuleRevision !== state.ruleRevision) fail('stale_proposal', 'Yours or accepted room inputs changed. The human must discard this stale draft and recreate it.');
    if (kind && p.kind !== kind) fail(kind === 'layout' ? 'unconfirmed_setup' : 'unauthorized_proposal_kind', `This command requires a ${kind} proposal. Setup inputs require separate human confirmation.`);
    return p;
  };
  const presentIssue = (issue: Report['issues'][number], p: Proposal | null, cellLimit: number) => {
    const { fix: hint, ...detail } = issue;
    const editable = p?.kind === 'layout' && p.baseCurrentRevision === state.currentRevision && p.baseRuleRevision === state.ruleRevision;
    const fix = editable && hint ? { ...hint, args: { ...hint.args, proposalId: p.id, revision: p.revision } } : undefined;
    const objectId = editable ? issue.objectIds.find(id => p.layout.furniture.some(o => o.id === id)) : undefined;
    return { ...detail, cells: issue.cells.slice(0, cellLimit), cellCount: issue.cells.length,
      ...(fix ? { fix, suggestedNextTool: fix.tool, suggestedArgs: fix.args }
        : objectId ? { suggestedNextTool: 'findPlacements', suggestedArgs: { proposalId: p!.id, revision: p!.revision, objectId } } : {}) };
  };
  const envelope = (p: Proposal, extra: Args = {}): CommandResult => {
    const r = validate(p.layout, p.room, p.rules, state.inventory);
    const issues = r.issues.slice(0, 16).map(issue => presentIssue(issue, p, 40));
    return { operationSucceeded: true, documentId: documentId(state), proposalId: p.id, revision: p.revision, status: proposalStatus(state, p), appearance: clone(p.layout.appearance), profile: p.room.profile || { kind: 'lounge' }, conceptualOnly: r.conceptualOnly || false, baseCurrentRevision: p.baseCurrentRevision, baseRuleRevision: p.baseRuleRevision, validation: r.validation, brief: r.brief, issues, issueCount: r.issues.length, hasMoreIssues: r.issues.length > issues.length, flagsSummary: r.flagsSummary, omitted: p.omitted, ...extra };
  };
  const commit = (p: Proposal, extra: Args = {}) => { p.revision++; const next = clone(state); next.proposal = p; publish(next); return envelope(p, extra); };
  const newBlockingIssueForAddition = (layout: Layout, room: Room, rules: Rules, inventory: Furniture[], object: Furniture) => {
    const before = validate(layout, room, rules, inventory, false);
    const baseline = new Set(before.issues.filter(issue => issue.severity === 'block').map(issueSignature));
    const after = validate({ ...layout, furniture: [...layout.furniture, object] }, room, rules, inventory, false);
    return after.issues.find(issue => issue.severity === 'block' && (issue.objectIds.includes(object.id) || !baseline.has(issueSignature(issue))));
  };
  const authoritative = (object: Furniture) => object.ownership === 'owned' ? state.inventory.find(o => o.id === object.id) || fail('unknown_owned_instance', 'Owned piece has no authoritative measured inventory record.') : object;
  const checkPatch = (object: Furniture, patch: HumanPatch, layout: Layout, room: Room, rules: Rules): Furniture => {
    if (object.ownership === 'fixed') fail('lock_violation', 'Fixed room fixtures cannot be changed through furniture commands.');
    const source = authoritative(object), locks = source.locked;
    if (patch.originCell && locks.position && !same(patch.originCell, source.originCell)) fail('lock_violation', `${object.label} has a locked position. Only the human can unlock it.`);
    if (patch.wallAnchor && locks.position && !same(patch.wallAnchor, source.wallAnchor)) fail('lock_violation', 'The wall anchor is locked.');
    if (patch.elevationCm !== undefined && locks.position && patch.elevationCm !== source.elevationCm) fail('lock_violation', 'The elevation is locked.');
    if (patch.rotation !== undefined && locks.rotation && patch.rotation !== source.rotation) fail('lock_violation', `${object.label} has a locked rotation.`);
    if (patch.variantId && object.ownership === 'owned') fail('owned_resize_forbidden', 'Owned dimensions cannot change through a catalogue variant.');
    if (patch.variantId && object.ownership === 'custom') fail('custom_resize_forbidden', 'Agent-authored measured dimensions and semantic kind cannot change through a catalogue variant. Remove the object and create a new measured one instead.');
    if (patch.variantId && locks.size && patch.variantId !== object.variantId) fail('lock_violation', 'This piece has a size lock.');
    if (patch.appearance && locks.appearance && patch.appearance !== object.appearance) fail('lock_violation', 'Appearance is locked.');
    if (patch.targetSofaId !== undefined && (object.kind !== 'tv' || !layout.furniture.some(o => o.id === patch.targetSofaId && o.kind === 'sofa'))) fail('invalid_id', 'A TV target must refer to a sofa in this layout.');
    if (patch.linkedDeskId !== undefined && (object.kind !== 'chair' || !layout.furniture.some(o => o.id === patch.linkedDeskId && o.kind === 'desk'))) fail('invalid_id', 'A linked desk must exist, and only a chair can link to it.');
    if (patch.attachedOpeningId !== undefined && (object.kind !== 'window_treatment' || !room.openings.some(o => o.id === patch.attachedOpeningId && o.kind === 'window'))) fail('invalid_id', 'attachedOpeningId must name an existing window, and only a window treatment can use it.');
    if (patch.supportObjectId !== undefined && (object.kind !== 'table_lamp' || !layout.furniture.some(o => o.id === patch.supportObjectId && canSupportLamp(o)))) fail('invalid_id', 'supportObjectId must name a table, desk or cabinet, and only a table lamp can use it.');
    if (patch.lightingZone !== undefined && !LIGHT_KINDS.has(object.kind)) fail('invalid_property', 'lightingZone applies only to a lighting fixture.');
    if (patch.wallAnchor && !['tv', 'wall_light'].includes(object.kind)) fail('invalid_property', 'Only TVs and wall lights accept a direct wallAnchor; window treatments derive it from attachedOpeningId.');
    if (patch.elevationCm !== undefined && !['tv', 'wall_light'].includes(object.kind)) fail('invalid_property', 'Only TVs and wall lights accept a direct elevation; ceiling and table fixtures derive it from their mount or support.');
    let next = { ...clone(object), ...clone(patch) };
    if (patch.variantId) {
      const v = CATALOGUE.find(v => v.id === patch.variantId) || fail('variant_unavailable', 'Choose an available named size variant.');
      if (v.kind !== object.kind) fail('variant_unavailable', 'A variant must keep the same furniture kind.');
      const tags = [...(v.tags || (v.kind === 'sofa' ? ['seating'] : v.kind === 'chair' ? ['work-seating'] : []))];
      const sleepSize = v.kind === 'bed' ? (tags.find(tag => tag === 'single' || tag === 'double' || tag === 'king') as Furniture['sleepSize']) : undefined;
      // A new catalogue variant is a new role as well as new dimensions. In
      // particular, replacing a wardrobe with a bedside table must not retain
      // the wardrobe tags and satisfy the bedroom brief by accident.
      next = { ...next, sizeCm: clone(v.sizeCm), label: v.name, tags, sleepSize, backEdge: v.backEdge, fixtureType: v.fixtureType, lightingZone: patch.lightingZone || v.lightingZone };
    }
    if (object.ownership === 'owned') { next.sizeCm = clone(source.sizeCm); next.requiredInRoom = source.requiredInRoom; next.locked = clone(source.locked); next.tags = clone(source.tags); next.sleepSize = source.sleepSize; }
    if (object.ownership === 'custom') { next.sizeCm = clone(source.sizeCm); next.kind = source.kind; next.label = source.label; next.requiredInRoom = false; next.locked = { ...clone(source.locked), size: true }; next.tags = []; next.customProvenance = clone(source.customProvenance); delete next.variantId; delete next.backEdge; delete next.sleepSize; }
    return normalizeFixturePlacement(next, room, rules, layout, patch.supportObjectId !== undefined);
  };
  const removeFrom = (layout: Layout, id: string, omitted: Proposal['omitted']) => {
    const object = layout.furniture.find(o => o.id === id) || fail('invalid_id', 'Furniture ID not found.'); const source = authoritative(object);
    const protectedLock = Object.entries(source.locked).some(([name, value]) => value && !(source.ownership === 'custom' && name === 'size'));
    if (source.ownership === 'fixed' || protectedLock) fail('lock_violation', 'A piece protected by a position, rotation or appearance lock cannot be removed.');
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
    return { originCell: clone(c.originCell), rotation: c.rotation, ...(c.variantId ? { variantId: c.variantId } : {}), ...(c.linkedDeskId ? { linkedDeskId: c.linkedDeskId } : {}), ...(c.attachedOpeningId ? { attachedOpeningId: c.attachedOpeningId } : {}), ...(c.supportObjectId ? { supportObjectId: c.supportObjectId } : {}), ...(c.lightingZone ? { lightingZone: c.lightingZone } : {}), ...(c.wallAnchor ? { wallAnchor: clone(c.wallAnchor) } : {}) };
  };
  async function search(p: Proposal, a: Args, signal?: AbortSignal, timeLimit = 1800): Promise<{ found: Candidate[]; trials: number; exhausted: boolean }> {
    const existing = a.objectId ? p.layout.furniture.find(o => o.id === a.objectId) || fail('invalid_id', 'Object not found in this proposal.') : undefined;
    if (!existing && !a.variantId) fail('invalid_arguments', 'Supply objectId or variantId.');
    let piece = existing ? clone(existing) : fromVariant(a.variantId, '__candidate__');
    if (existing && a.variantId) piece = checkPatch(existing, { variantId: a.variantId }, p.layout, p.room, p.rules);
    if (piece.kind === 'chair' && a.linkedDeskId) piece.linkedDeskId = a.linkedDeskId;
    if (piece.kind === 'tv' && !piece.targetSofaId) piece.targetSofaId = p.layout.furniture.find(o => o.kind === 'sofa')?.id;
    if (a.attachedOpeningId) piece.attachedOpeningId = a.attachedOpeningId;
    if (a.supportObjectId) piece.supportObjectId = a.supportObjectId;
    if (a.lightingZone) piece.lightingZone = a.lightingZone;
    piece = normalizeFixturePlacement(piece, p.room, p.rules, p.layout, !!a.supportObjectId);
    const base = validate(p.layout, p.room, p.rules, state.inventory, false), baseBlocks = new Set(base.issues.filter(i => i.severity === 'block').map(issueSignature)), baseIssues = new Set(base.issues.map(issueSignature));
    const found: Candidate[] = [], positions: HumanPatch[] = [], seen = new Set<string>(), started = Date.now(); let trials = 0;
    const unit = p.rules.cellCm, cols = Math.floor(p.room.widthCm / unit), rows = Math.floor(p.room.depthCm / unit), requestedLimit = a.limit || 5, candidatePool = Math.min(24, Math.max(12, requestedLimit * 4));
    const locks = authoritative(piece).locked;
    if (piece.kind === 'window_treatment') {
      if (!piece.attachedOpeningId) fail('invalid_arguments', 'A window treatment search requires attachedOpeningId.');
      positions.push({ originCell: piece.originCell, rotation: piece.rotation, attachedOpeningId: piece.attachedOpeningId });
    } else if (piece.kind === 'table_lamp') {
      if (!piece.supportObjectId) fail('invalid_arguments', 'A table lamp search requires supportObjectId.');
      positions.push({ originCell: piece.originCell, rotation: piece.rotation, supportObjectId: piece.supportObjectId });
    } else if (piece.kind === 'tv' || piece.kind === 'wall_light') {
      const sofa = p.layout.furniture.find(o => o.id === piece.targetSofaId);
      const walls = piece.kind === 'tv' && sofa ? [faces[sofa.rotation], ...(['north', 'west', 'east', 'south'] as const).filter(w => w !== faces[sofa.rotation])] : ['north', 'west', 'east', 'south'] as const;
      for (const wall of walls) for (const segment of wallSegments(p.room).filter(candidate => candidate.wall === wall && candidate.lengthCm >= piece.sizeCm.w)) {
        const b = sofa && bounds(sofa), centre = b ? (segment.horizontal ? b.x + b.w / 2 : b.y + b.d / 2) : segment.lengthCm / 2 + (segment.horizontal ? segment.x1 : segment.y1);
        const start = segment.horizontal ? segment.x1 : segment.y1, centered = Math.max(0, Math.min(segment.lengthCm - piece.sizeCm.w, Math.round((centre - start - piece.sizeCm.w / 2) / unit) * unit));
        const anchorBase = { wall, ...(p.room.floorPlan ? { segmentId: segment.id } : {}) };
        positions.push({ wallAnchor: { ...anchorBase, offsetCm: centered }, originCell: piece.originCell, rotation: piece.rotation });
        for (let offsetCm = 0; offsetCm <= segment.lengthCm - piece.sizeCm.w; offsetCm += unit) positions.push({ wallAnchor: { ...anchorBase, offsetCm }, originCell: piece.originCell, rotation: piece.rotation });
      }
    } else {
      const sofa = p.layout.furniture.find(o => o.kind === 'sofa'), b = sofa && bounds(sofa), bed = p.layout.furniture.find(o => o.kind === 'bed');
      if (piece.kind === 'bed') {
        // Centre the head on a wall first; try either side of a central window
        // before falling back to the general scan. Keep exact catalogue sizes.
        for (const rotation of rotations) {
          const bb = bounds({ ...piece, rotation }), w = Math.ceil(bb.w / 20), d = Math.ceil(bb.d / 20);
          for (const fraction of [0.5, 0.25, 0.75]) positions.push({ rotation, originCell: rotation === 0 || rotation === 180
            ? { x: Math.round(cols * fraction - w / 2), y: rotation === 0 ? 0 : rows - d }
            : { x: rotation === 270 ? 0 : cols - w, y: Math.round(rows * fraction - d / 2) } });
        }
      }
      if (piece.tags.includes('bedside')) for (const bed of p.layout.furniture.filter(o => o.kind === 'bed')) {
        const bb = bounds(bed);
        for (const { headExcluded: h } of bedAccessBands(bed, Math.max(piece.sizeCm.w, piece.sizeCm.d))) positions.push({ originCell: { x: Math.floor(h.x / 20), y: Math.floor(h.y / 20) }, rotation: bed.rotation === 0 || bed.rotation === 180 ? h.x < bb.x ? 90 : 270 : h.y < bb.y ? 180 : 0 });
      }
      if (piece.kind === 'chair') for (const desk of p.layout.furniture.filter(o => o.kind === 'desk' && !p.layout.furniture.some(c => c.linkedDeskId === o.id))) {
        const target = frontBand(desk, p.rules.chairPullCm), rotation = ((desk.rotation + 180) % 360) as Furniture['rotation'], bb = bounds({ ...piece, rotation });
        positions.push({ originCell: { x: Math.round((target.x + (target.w - bb.w) / 2) / 20), y: Math.round((target.y + (target.d - bb.d) / 2) / 20) }, rotation });
      }
      if (piece.kind === 'desk') {
        const headWall = bed && faces[((bed.rotation + 180) % 360) as Furniture['rotation']];
        for (const window of p.room.openings.filter(o => o.kind === 'window').sort((a, b) => Number(a.wall === headWall) - Number(b.wall === headWall))) {
          const rotation = ({ north: 0, east: 90, south: 180, west: 270 } as const)[window.wall], bb = bounds({ ...piece, rotation }, unit), horizontal = window.wall === 'north' || window.wall === 'south';
          const alongSize = horizontal ? bb.w : bb.d, depthSize = horizontal ? bb.d : bb.w, segment = resolveWallSegment(p.room, window); if (!segment || segment.lengthCm < alongSize) continue;
          const offsetCm = Math.max(0, Math.min(segment.lengthCm - alongSize, Math.round((window.offsetCm + window.widthCm / 2 - alongSize / 2) / unit) * unit));
          const rect = wallRect(p.room, { wall: window.wall, segmentId: window.segmentId, offsetCm }, alongSize, depthSize); if (rect) positions.push({ originCell: { x: rect.x / unit, y: rect.y / unit }, rotation });
        }
        positions.push({ originCell: { x: 0, y: 4 }, rotation: 270 }, { originCell: { x: cols - 3, y: 4 }, rotation: 90 });
      }
      if (bed && (piece.kind === 'rug' || piece.variantId === 'fold-bench-100')) {
        const bb = bounds(bed), rotation = bed.rotation, pb = bounds({ ...piece, rotation }), face = faces[rotation], inset = piece.kind === 'rug' ? -Math.min(pb.w, pb.d) / 2 : 40;
        const x = face === 'east' ? bb.x + bb.w + inset : face === 'west' ? bb.x - pb.w - inset : bb.x + (bb.w - pb.w) / 2;
        const y = face === 'south' ? bb.y + bb.d + inset : face === 'north' ? bb.y - pb.d - inset : bb.y + (bb.d - pb.d) / 2;
        positions.push({ originCell: { x: Math.round(x / 20), y: Math.round(y / 20) }, rotation });
      }
      if (piece.kind === 'coffee_table' && sofa && b) {
        const face = faces[sofa.rotation], rotation = (face === 'north' || face === 'south' ? 0 : 90) as Furniture['rotation'], pb = bounds({ ...piece, rotation }, unit);
        const x = face === 'east' ? b.x + b.w + COFFEE_TABLE_GAP_MIN_CM : face === 'west' ? b.x - pb.w - COFFEE_TABLE_GAP_MIN_CM : b.x + (b.w - pb.w) / 2;
        const y = face === 'south' ? b.y + b.d + COFFEE_TABLE_GAP_MIN_CM : face === 'north' ? b.y - pb.d - COFFEE_TABLE_GAP_MIN_CM : b.y + (b.d - pb.d) / 2;
        positions.push({ originCell: { x: x / unit, y: y / unit }, rotation });
      }
      if (piece.kind === 'rug' && b) positions.push({ originCell: { x: Math.floor((b.x + b.w / 2 - piece.sizeCm.w / 2) / 20), y: Math.floor((b.y - piece.sizeCm.d + 40) / 20) }, rotation: 0 });
      if (wantsWallBacking(piece, unit)) {
        const addWallPosition = (rotation: Furniture['rotation'], segment: ReturnType<typeof wallSegments>[number], along: number) => {
          const placed = { ...piece, rotation }, bb = bounds(placed, unit), back = furnitureBackWall(placed), horizontal = back === 'north' || back === 'south';
          const rect = wallRect(p.room, { wall: back, segmentId: p.room.floorPlan ? segment.id : undefined, offsetCm: along }, horizontal ? bb.w : bb.d, horizontal ? bb.d : bb.w);
          if (rect) positions.push({ rotation, originCell: { x: rect.x / unit, y: rect.y / unit } });
        };
        // Give every back-wall orientation a centred and end-aligned chance
        // before filling the bounded pool with denser samples of the first wall.
        for (const rotation of rotations) {
          const bb = bounds({ ...piece, rotation }, unit), back = furnitureBackWall({ ...piece, rotation }), horizontal = back === 'north' || back === 'south', alongSize = horizontal ? bb.w : bb.d;
          for (const segment of wallSegments(p.room).filter(candidate => candidate.wall === back && candidate.lengthCm >= alongSize)) { const max = segment.lengthCm - alongSize; for (const along of [...new Set([max / 2, 0, max])]) addWallPosition(rotation, segment, along); }
        }
        for (const rotation of rotations) {
          const bb = bounds({ ...piece, rotation }, unit), back = furnitureBackWall({ ...piece, rotation }), horizontal = back === 'north' || back === 'south', alongSize = horizontal ? bb.w : bb.d;
          for (const segment of wallSegments(p.room).filter(candidate => candidate.wall === back && candidate.lengthCm >= alongSize)) { const max = segment.lengthCm - alongSize; for (let along = unit * 2; along < max; along += unit * 2) addWallPosition(rotation, segment, along); }
        }
      }
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
      if (trials >= 160 || Date.now() - started > timeLimit || found.length >= candidatePool) break;
      const signature = JSON.stringify(patch); if (seen.has(signature)) continue; seen.add(signature);
      if (locks.position && ((patch.originCell && !same(patch.originCell, authoritative(piece).originCell)) || (patch.wallAnchor && !same(patch.wallAnchor, authoritative(piece).wallAnchor)))) continue;
      if (locks.rotation && patch.rotation !== authoritative(piece).rotation) continue;
      trials++;
      let placed: Furniture;
      try { placed = checkPatch(piece, patch, p.layout, p.room, p.rules); } catch { continue; }
      const testLayout = clone(p.layout); testLayout.furniture = [...testLayout.furniture.filter(o => o.id !== placed.id), placed];
      const report = validate(testLayout, p.room, p.rules, state.inventory, false);
      const relevant = report.issues.filter(i => i.severity === 'block' && i.code !== 'desk_chair_missing' && (i.objectIds.includes(placed.id) || !baseBlocks.has(issueSignature(i))));
      const avoid = a.avoidFlags || []; const occupiedKeys = new Set(rectCells(bounds(placed)).map(c => `${c.x},${c.y}`));
      const violatesAvoid = isFloorOccupant(placed) && report.cells.some(c => occupiedKeys.has(`${c.x},${c.y}`) && c.flags.some(f => avoid.includes(f)));
      if (!relevant.length && !violatesAvoid) {
        const candidateId = `candidate-${++candidateSeq}`, decisionIssues = report.issues.filter(i => i.objectIds.includes(placed.id) || !baseIssues.has(issueSignature(i))), qualityScore = decisionIssues.reduce((sum, i) => sum + issueCost(i), 0);
        const wallMounted = ['tv', 'wall_light', 'window_treatment'].includes(placed.kind) && placed.wallAnchor, gaps = wallMounted ? { north: Infinity, east: Infinity, south: Infinity, west: Infinity, [placed.wallAnchor!.wall]: 0 } as Record<Wall, number> : wallGaps(placed, p.room, unit);
        const backWall = wallMounted ? placed.wallAnchor!.wall : furnitureBackWall(placed), touchingWalls = (Object.keys(gaps) as Wall[]).filter(w => gaps[w] <= 0.5);
        const frontFacing = wallMounted ? opposite[placed.wallAnchor!.wall] : faces[placed.rotation];
        candidateReports.set(candidateId, report); found.push({ candidateId, proposalId: p.id, proposalRevision: p.revision, ruleRevision: state.ruleRevision, objectId: existing?.id, variantId: placed.variantId, linkedDeskId: placed.linkedDeskId, attachedOpeningId: placed.attachedOpeningId, supportObjectId: placed.supportObjectId, lightingZone: placed.lightingZone, originCell: placed.originCell, rotation: placed.rotation, wallAnchor: placed.wallAnchor, checkedRules: report.checkedRules, placementStatus: 'valid', layoutStatus: report.validation.status, qualityScore, frontFacing, backWall, backGapCm: gaps[backWall], touchingWalls, remainingIssues: report.issues.slice(0, 10).map(i => ({ ...i, cells: i.cells.slice(0, 20), cellCount: i.cells.length, hasMoreCells: i.cells.length > 20 })), remainingIssueCount: report.issues.length, hasMoreRemainingIssues: report.issues.length > 10, details: { tool: 'checkLayout', args: { which: 'proposal', revision:p.revision, candidateId, detail:'issues', offset:0, limit:100 } }, brief: report.brief });
      }
      if (trials % 8 === 0) await pause();
    }
    if (signal?.aborted) fail('cancelled', 'Search cancelled without committing.');
    found.sort((a, b) => a.qualityScore - b.qualityScore || a.remainingIssueCount - b.remainingIssueCount || a.originCell.y - b.originCell.y || a.originCell.x - b.originCell.x || a.rotation - b.rotation);
    for (const candidate of found.slice(requestedLimit)) candidateReports.delete(candidate.candidateId);
    return { found: found.slice(0, requestedLimit), trials, exhausted: trials >= 160 || Date.now() - started > timeLimit };
  }
  const snapshot = (a: Args) => {
    if (a.which === 'current') { if (a.revision !== undefined && a.revision !== state.currentRevision) fail('revision_conflict', 'Current has changed.'); return { layout: state.current, room: state.room, rules: state.rules, revision: state.currentRevision, which: 'current' }; }
    const p = state.proposal || fail('proposal_not_found', 'No proposal exists yet.'); if (a.revision !== undefined && a.revision !== p.revision) fail('revision_conflict', 'Proposal has changed.'); return { layout: p.layout, room: p.room, rules: p.rules, revision: p.revision, which: 'proposal' };
  };
  async function runTool(name: string, a: Args, signal?: AbortSignal): Promise<CommandResult> {
    try {
      const definition = TOOL_SCHEMAS[name] || fail('unknown_tool', 'Unknown Floortris tool.');
      const error = validateSchema(a, definition.inputSchema); if (error) fail('invalid_arguments', error);
      if (signal?.aborted) fail('cancelled', 'Command cancelled without mutation.');
      const retryKey = a.idempotencyKey ? `${name}:${a.idempotencyKey}` : undefined, signature = JSON.stringify(a);
      if (retryKey && retries.has(retryKey)) { const prior = retries.get(retryKey)!; if (prior.signature !== signature) fail('idempotency_conflict', 'This idempotency key was already used with different arguments.'); if (prior.result.generatedRoom && prior.result.documentId !== documentId(state)) fail('room_not_active', 'This request already created a saved room. Open it from Rooms; do not duplicate it with a new key.'); return clone({ ...prior.result, idempotentReplay: true, activeProposalRevision: state.proposal?.revision }); }
      let result: CommandResult;
      if (name === 'listCatalogue') {
        const list = CATALOGUE.filter(v => (!a.kind || v.kind === a.kind) && (!a.profile || !v.recommendedProfiles || v.recommendedProfiles.includes(a.profile)) && (!a.tag || v.tags?.includes(a.tag))), offset = a.offset || 0, limit = a.limit || 50;
        return { operationSucceeded: true, catalogue: clone(list.slice(offset, offset + limit)), total: list.length, offset, hasMore: offset + limit < list.length, palettes: clone(PALETTES) };
      }
      if (['getRoomState', 'listFurniture', 'checkLayout'].includes(name)) {
        const snap = snapshot(a); let report = validate(snap.layout, snap.room, snap.rules, state.inventory); if (a.candidateId) { const c = candidates.get(a.candidateId) || fail('revision_conflict','Candidate is stale or unavailable.'); if (a.which !== 'proposal' || c.proposalRevision !== snap.revision || c.ruleRevision !== state.ruleRevision) fail('revision_conflict','Candidate revision differs from the inspected draft.'); report = candidateReports.get(a.candidateId) || fail('revision_conflict','Candidate detail is no longer available.'); } const common = { operationSucceeded: true, documentId: documentId(state), which: snap.which, revision: snap.revision, currentRevision: state.currentRevision, ruleRevision: state.ruleRevision, proposalId: state.proposal?.id, status: proposalStatus(state), profile: snap.room.profile || { kind: 'lounge' }, conceptualOnly: report.conceptualOnly || false };
        if (name === 'getRoomState') return clone({ ...common, room: snap.room, wallSegments: wallSegments(snap.room), appearance: snap.layout.appearance, profile: snap.room.profile || { kind: 'lounge' }, profileRequirements: report.brief.requirements || [], conceptualOnly: report.conceptualOnly || false, rules: snap.rules, coordinates: { origin: 'top-left', x: 'east', y: 'south', cellCm: 20, geometryUnit: 'cm', customWallOffsets: 'from each segment’s normalized top/left endpoint' }, validation: report.validation, brief: report.brief, clearances: report.clearances, flagsSummary: report.flagsSummary, proposalKind: state.proposal?.kind, assumptions: 'Product assumptions only; bathroom concepts do not validate installation, regulations or safety.' });
        if (name === 'listFurniture') { const list = [...snap.room.fixtures, ...snap.layout.furniture], offset = a.offset || 0, limit = a.limit || 30; return clone({ ...common, furniture: list.slice(offset, offset + limit), total: list.length, offset, hasMore: offset + limit < list.length, ownedInventory: state.inventory }); }
        const inRegion = (c: { x: number; y: number }) => !a.region || (c.x >= a.region.x && c.y >= a.region.y && c.x < a.region.x + a.region.w && c.y < a.region.y + a.region.d);
        const entries = a.detail === 'flags' ? report.cells.filter(c => inRegion(c) && (!a.objectId || c.objectIds.includes(a.objectId)) && (!a.ruleCode || c.flags.includes(a.ruleCode))) : report.issues.filter(i => (!a.ruleCode || i.code === a.ruleCode) && (!a.objectId || i.objectIds.includes(a.objectId)) && (!a.region || i.cells.some(inRegion))).map(i => presentIssue(i, a.which === 'proposal' && !a.candidateId ? state.proposal : null, 60));
        const offset = a.offset || 0, limit = a.limit || 30;
        return clone({ ...common, scope: a.candidateId ? 'hypothetical_candidate' : a.region || a.objectId || a.ruleCode ? 'focused_details_with_full_layout_status' : 'full_layout', validation: report.validation, brief: report.brief, clearances: report.clearances, flagsSummary: report.flagsSummary, [a.detail === 'flags' ? 'cells' : 'issues']: entries.slice(offset, offset + limit), total: entries.length, offset, hasMore: offset + limit < entries.length, nextOffset: offset + limit < entries.length ? offset + limit : null });
      }
      if (name === 'generateRoom') {
        if (generating) fail('generation_in_progress', 'A new room is already being planned. Retry after that request completes.');
        generating = true;
        try {
          const previous = state, id = `room-${crypto.randomUUID()}`;
          const appearance = { wall: a.appearance?.wall || 'warm', floor: a.appearance?.floor || 'oak' };
          for (const [target, value] of Object.entries(a.appearance || {})) if (!PALETTES[target as keyof typeof PALETTES].some(p => p.id === value)) fail('invalid_palette', `Unknown ${target} palette. Read listCatalogue for valid IDs.`);
          const room: Room = { name: a.name, widthCm: a.widthCm, depthCm: a.depthCm, ...(a.floorPlan ? { floorPlan: clone(a.floorPlan) } : {}), profile: clone(a.profile), openings: clone(a.openings), fixtures: [] };
          const rules: Rules = { ...clone(DEFAULT_RULES), requiredKinds: [...profileRules(a.profile)] as Rules['requiredKinds'] };
          const inputError = validateRoomInputs(room, rules); if (inputError) fail('invalid_room_inputs', inputError);
          const layout: Layout = { furniture: [], appearance };
          const draft: AppState = { version: 2, documentId: id, room, rules, current: clone(layout), inventory: [], currentRevision: 1, ruleRevision: 1, sequence: 1,
            proposal: { id: `${id}-proposal-1`, kind: 'layout', revision: 1, baseCurrentRevision: 1, baseRuleRevision: 1, room: clone(room), rules: clone(rules), layout, omitted: [] } };
          // Plan with the same engine in an isolated document. Nothing is published
          // until planning, cancellation, concurrency and persistence checks pass.
          const planner = createStore(draft);
          const planned = await planner.execute('proposeLayout', { proposalId: draft.proposal!.id, revision: 1, ...(a.variantIds ? { variantIds: a.variantIds } : {}), ...(a.quantities ? { quantities: a.quantities } : {}) }, signal);
          if (!planned.operationSucceeded) fail(planned.error!.code, planned.error!.message);
          if (signal?.aborted) fail('cancelled', 'New room cancelled; your previous room and draft are unchanged.');
          if (state !== previous) fail('revision_conflict', 'The room changed while planning. Nothing was replaced; retry the new-room request.');
          const next = clone(planner.getState());
          if (a.appearance?.furniture) next.proposal!.layout.furniture.forEach(piece => { piece.appearance = a.appearance.furniture; });
          try { options.beforeNewDocument?.(previous, next); } catch { fail('save_failed', 'Could not save both rooms. Your previous room and draft are unchanged; free device storage or export them before retrying.'); }
          documents.set(documentId(previous), previous); documents.set(id, frozen(next));
          past.length = 0; future.length = 0;
          publish(next, false);
          result = envelope(next.proposal!, { documentId: id, room: clone(room), generatedRoom: true, selectedView: 'proposal', previousRoom: { documentId: documentId(previous), name: previous.room.name, preserved: true }, planner: planned.planner, review: { state: 'proposal_only', applied: false, requiresHumanApply: true, storageScope: 'this_browser', check: { tool: 'checkLayout', args: { which: 'proposal', revision: next.proposal!.revision } } }, message: 'New room proposal opened in this browser. Furniture is not applied. Verify the visible proposal, report any warnings or omissions, and leave Apply to the human. Your previous room and draft are saved in Rooms.' });
        } finally { generating = false; }
      } else if (name === 'createProposal') {
        if (state.proposal) fail('active_proposal_exists', 'A draft already exists for this room. Use generateRoom to create a separate new room without discarding it. Only the human can discard or apply this room’s draft.');
        if (state.currentRevision !== a.expectedCurrentRevision || state.ruleRevision !== a.expectedRuleRevision) fail('revision_conflict', 'Accepted current or rule revision changed. Read getRoomState again.');
        const next = clone(state); next.sequence++;
        const p: Proposal = { id: `proposal-${next.sequence}`, kind: a.kind, revision: 1, baseCurrentRevision: state.currentRevision, baseRuleRevision: state.ruleRevision, layout: clone(state.current), room: clone(state.room), rules: clone(state.rules), omitted: [] }; next.proposal = p; publish(next); result = envelope(p);
      } else {
        const p = clone(guard(a, ['setRoomGeometry', 'setOpening', 'setConstraints'].includes(name) ? 'setup' : 'layout'));
        if (name === 'findPlacements') { const searched = await search(p, a, signal); guard(a, 'layout'); searched.found.forEach(c => candidates.set(c.candidateId, c)); return { ...envelope(p), candidates: clone(searched.found), trials: searched.trials, searchBoundReached: searched.exhausted, explanation: searched.found.length ? 'Every returned placement passed relevant/new hard checks; layoutStatus includes unrelated existing issues.' : 'No candidate found within the bounded scan. This is not proof that no placement exists.' }; }
        let mutationExtra: Args = {};
        if (name === 'setRoomGeometry') { p.room = { ...p.room, ...(a.widthCm !== undefined ? {widthCm:a.widthCm} : {}), ...(a.depthCm !== undefined ? {depthCm:a.depthCm} : {}), ...(a.name !== undefined ? {name:a.name} : {}) }; if (a.floorPlan !== undefined) { if (a.floorPlan === null) delete p.room.floorPlan; else p.room.floorPlan = clone(a.floorPlan); } }
        else if (name === 'setOpening') { if (state.room.openingLocks?.includes(a.opening.id) && !same(a.opening, state.room.openings.find(o => o.id === a.opening.id))) fail('lock_violation', 'This opening is pinned. Only the human can unpin it in Room inputs.'); if (a.opening.kind === 'window' && a.opening.headCm <= a.opening.sillCm) fail('invalid_opening', 'Window head must be above its sill.'); const idx = p.room.openings.findIndex(o => o.id === a.opening.id); if (idx >= 0) p.room.openings[idx] = clone(a.opening); else { if (p.room.openings.length >= 12) fail('room_limit', 'V1 supports at most 12 openings.'); p.room.openings.push(clone(a.opening)); } }
        else if (name === 'setConstraints') { p.rules = { ...p.rules, ...clone(a.constraints) }; checkRules(p.rules); }
        else if (name === 'setAppearance') {
          const group = PALETTES[a.target as keyof typeof PALETTES]; if (!group.some(palette => palette.id === a.paletteId)) fail('invalid_palette', 'Choose an ID from listCatalogue palettes.');
          if (a.target === 'furniture') { const object = p.layout.furniture.find(o => o.id === a.objectId) || fail('invalid_id', 'Furniture ID not found.'); const updated = checkPatch(object, { appearance: a.paletteId }, p.layout, p.room, p.rules); p.layout.furniture = p.layout.furniture.map(o => o.id === object.id ? updated : o); }
          else p.layout.appearance[a.target as 'wall' | 'floor'] = a.paletteId;
        } else if (name === 'removeFurniture') removeFrom(p.layout, a.objectId, p.omitted);
        else if (name === 'updateFurniture') {
          const object = p.layout.furniture.find(o => o.id === a.objectId) || fail('invalid_id', 'Furniture ID not found. Fixed features cannot be edited here.');
          const candidatePatch = resolveCandidate(a, p); const patch = candidatePatch || sanitizedPatch(a); const updated = checkPatch(object, patch, p.layout, p.room, p.rules); p.layout.furniture = p.layout.furniture.map(o => o.id === object.id ? updated : o);
        } else if (name === 'createCustomFurniture') {
          if (!a.label.trim() || /[\u0000-\u001f\u007f]/.test(a.label)) fail('invalid_arguments', 'Use a visible human-readable label without control characters.');
          if (a.linkedDeskId !== undefined && a.kind !== 'chair') fail('invalid_property', 'Only a custom chair may use linkedDeskId. Other relationship, role and mount claims are not accepted.');
          if (a.geometry) { const geometryError = sectionalGeometryError(a.geometry, { w: a.widthCm, d: a.depthCm, h: a.heightCm }); if (a.kind !== 'sofa' || geometryError) fail('invalid_sectional_geometry', geometryError || 'Only a custom sofa may use sectional geometry.'); }
          if (p.layout.furniture.length >= 30) fail('room_limit', 'V1 supports 30 movable pieces.');
          const object = makeCustomFurniture({ label: a.label, kind: a.kind, widthCm: a.widthCm, depthCm: a.depthCm, heightCm: a.heightCm, positionCm: a.positionCm, rotation: a.rotation, appearance: a.appearance, ...(a.linkedDeskId ? { linkedDeskId: a.linkedDeskId } : {}), ...(a.geometry ? { geometry: a.geometry } : {}) }, `custom-${p.id}-${p.revision + 1}`, p.rules.cellCm);
          if (a.linkedDeskId) checkPatch(object, { linkedDeskId: a.linkedDeskId }, p.layout, p.room, p.rules);
          const blocked = newBlockingIssueForAddition(p.layout, p.room, p.rules, state.inventory, object);
          if (blocked) fail(blocked.code, `${blocked.code}: ${blocked.message} Custom furniture was not added.`);
          p.layout.furniture.push(object);
          const nextRevision = p.revision + 1;
          mutationExtra = {
            customFurniture: clone(object),
            provenance: { source: 'agent_authored_one_off', tool: 'createCustomFurniture', persistence: 'room_document_local' },
            measuredEnvelopeCm: clone(object.sizeCm),
            review: { state: 'proposal_only', applied: false, requiresHumanApply: true, check: { tool: 'checkLayout', args: { which: 'proposal', revision: nextRevision, objectId: object.id } } },
            message: 'Measured custom furniture was added only to the proposal. Its exact dimensions and semantic kind are immutable to agent edits. Review the visible object and leave Apply to the human.',
          };
        } else if (name === 'placeFurniture') {
          const candidatePatch = resolveCandidate(a, p); let object: Furniture;
          if (a.ownedId) { if (a.variantId) fail('owned_resize_forbidden', 'Owned pieces cannot use catalogue variants.'); object = clone(state.inventory.find(o => o.id === a.ownedId) || fail('invalid_id', 'Owned inventory ID not found.')); if (p.layout.furniture.some(o => o.id === object.id)) fail('duplicate_owned_instance', 'This owned piece is already in the layout. Use updateFurniture.'); }
          else { const variantId = candidatePatch?.variantId || a.variantId; if (!variantId) fail('invalid_arguments', 'Provide variantId or ownedId.'); object = fromVariant(variantId, `piece-${state.sequence + 1}-${p.revision}`); }
          if (p.layout.furniture.length >= 30) fail('room_limit', 'V1 supports 30 movable pieces.');
          if (object.kind === 'tv') object.targetSofaId = a.targetSofaId || p.layout.furniture.find(o => o.kind === 'sofa')?.id;
          if (object.kind === 'window_treatment' && !(candidatePatch?.attachedOpeningId || a.attachedOpeningId)) fail('invalid_arguments', 'A window treatment requires attachedOpeningId naming an existing window.');
          if (object.kind === 'table_lamp' && !(candidatePatch?.supportObjectId || a.supportObjectId)) fail('invalid_arguments', 'A table lamp requires supportObjectId naming a table, desk or cabinet.');
          object = checkPatch(object, candidatePatch || sanitizedPatch(a), p.layout, p.room, p.rules);
          const blocked = newBlockingIssueForAddition(p.layout, p.room, p.rules, state.inventory, object);
          if (blocked) fail(blocked.code, `${blocked.code}: ${blocked.message} Furniture was not added.`);
          p.layout.furniture.push(object);
          p.omitted = p.omitted.filter(o => o.objectId !== object.id);
        } else if (name === 'proposeLayout') {
          const profile = p.room.profile || { kind: 'lounge' as const };
          const defaults = profile.kind === 'bedroom' ? [`haven-${profile.sleeping}-${profile.sleeping === 'single' ? '100' : profile.sleeping === 'double' ? '140' : '160'}`, ...(profile.storage ? ['tallline-wardrobe-100'] : []), ...(profile.workspace ? ['line-desk-100', 'nest-chair-60'] : []), ...Array.from({ length: Math.max(0, Math.min(2, profile.bedsideQuantity || 0)) }, () => 'nook-bedside-40')]
            : profile.kind === 'home_office' ? ['line-desk-100', 'nest-chair-60', ...(profile.seating ? ['nest-chair-60'] : []), ...(profile.storage ? ['archive-tall-80'] : [])]
              : profile.kind === 'bathroom_concept' ? ['weave-mat-80'] : ['frame-tv-120', 'line-desk-100', 'pebble-table-80', 'weave-rug-200'];
          const requested: string[] = a.variantIds || defaults;
          requested.forEach(id => { if (!CATALOGUE.some(v => v.id === id)) fail('variant_unavailable', `Unknown catalogue variant: ${id}.`); });
          (a.quantities || []).forEach((q: { variantId: string }) => { if (!CATALOGUE.some(v => v.id === q.variantId)) fail('variant_unavailable', `Unknown catalogue variant: ${q.variantId}.`); });
          const priority: Record<string, number> = { sofa: 1, tv: 2, bed: 2, desk: 3, chair: 4, storage: 5, window_treatment: 5, ceiling_light: 5, wall_light: 5, floor_lamp: 6, table_lamp: 6, coffee_table: 6, table: 6, plant: 7, rug: 8 };
          // Explicit quantities are targets for their variants, not additions
          // to defaults or repeated retries. This keeps a request for two
          // nightstands at two even when the bedroom profile has that default.
          const quantityVariants = new Set((a.quantities || []).map((q: { variantId: string }) => q.variantId));
          const wanted = [...requested.filter(id => !quantityVariants.has(id)), ...(a.quantities || []).flatMap((q: { variantId: string; quantity: number }) => Array.from({ length: q.quantity }, () => q.variantId))];
          for (const kind of p.rules.requiredKinds) if (!p.layout.furniture.some(o => o.kind === kind) && !wanted.some(id => CATALOGUE.find(v => v.id === id)?.kind === kind)) { const variant = CATALOGUE.find(v => v.kind === kind); if (variant) wanted.push(variant.id); }
          const rank = (id: string) => { const variant = CATALOGUE.find(v => v.id === id)!; return variant.tags?.includes('bedside') ? 2.5 : priority[variant.kind] || 9; };
          wanted.sort((a, b) => rank(a) - rank(b));
          let trials = 0; const start = Date.now();
          for (const object of [...p.layout.furniture]) {
            const report = validate(p.layout, p.room, p.rules, state.inventory); if (!report.issues.some(i => i.severity === 'block' && i.objectIds.includes(object.id))) continue;
            if (Date.now() - start > 6500) break;
            const found = await search(p, { objectId: object.id, limit: 1 }, signal, 900); trials += found.trials;
            if (found.found[0]) { const c = found.found[0]; const patch = { originCell: c.originCell, rotation: c.rotation, ...(c.wallAnchor ? { wallAnchor: c.wallAnchor } : {}), ...(c.attachedOpeningId ? { attachedOpeningId: c.attachedOpeningId } : {}), ...(c.supportObjectId ? { supportObjectId: c.supportObjectId } : {}) }; p.layout.furniture = p.layout.furniture.map(o => o.id === object.id ? checkPatch(o, patch, p.layout, p.room, p.rules) : o); }
          }
          for (const [requestIndex, variantId] of wanted.entries()) {
            const v = CATALOGUE.find(v => v.id === variantId)!;
            // A brief item is an instance, not a kind: two bedside tables and two
            // storage pieces remain distinct. Only singular non-storage defaults
            // are skipped when already present.
            const requestedQuantity = wanted.slice(0, requestIndex + 1).filter(id => id === variantId).length;
            const singletonProfileDefault = !a.variantIds && !quantityVariants.has(variantId) && defaults.filter(id => id === variantId).length === 1;
            const semanticDefaultPresent = singletonProfileDefault && (
              profile.kind === 'bedroom' && v.kind === 'bed' && p.layout.furniture.some(o => o.kind === 'bed' && (o.sleepSize === profile.sleeping || o.tags.includes(profile.sleeping))) ||
              profile.kind === 'bedroom' && v.kind === 'storage' && v.tags?.includes('wardrobe') && p.layout.furniture.some(o => o.kind === 'storage' && (o.tags.includes('wardrobe') || o.tags.includes('clothes-storage')))
            );
            const existingQuantity = Math.max(p.layout.furniture.filter(o => o.variantId === variantId).length, semanticDefaultPresent ? 1 : 0);
            if (existingQuantity >= requestedQuantity) continue;
            if (p.layout.furniture.length >= 30) { p.omitted.push({ variantId, reason: `Instance ${requestedQuantity} omitted: the room limit is 30 movable pieces.` }); continue; }
            const linkedChairVariant = v.kind === 'desk' ? wanted.slice(requestIndex + 1).find(id => CATALOGUE.find(candidate => candidate.id === id)?.kind === 'chair') : undefined;
            if (p.layout.furniture.length + (linkedChairVariant ? 2 : 1) > 30) { p.omitted.push({ variantId, reason: `Instance ${requestedQuantity} omitted: preserving a linked desk-chair pair would exceed the 30-piece room limit.` }); continue; }
            const needsWorkstation = profile.kind === 'home_office' || (profile.kind === 'bedroom' && profile.workspace);
            if (v.kind === 'chair' && needsWorkstation && !p.layout.furniture.some(desk => desk.kind === 'desk')) { p.omitted.push({ variantId, reason: `Instance ${requestedQuantity} omitted: no desk remains for this work chair.` }); continue; }
            if (signal?.aborted) fail('cancelled', 'Planning cancelled without committing.');
            const relationArgs = v.kind === 'window_treatment' ? { attachedOpeningId: p.room.openings.filter(o => o.kind === 'window')[requestedQuantity - 1]?.id || p.room.openings.find(o => o.kind === 'window')?.id }
              : v.kind === 'table_lamp' ? { supportObjectId: p.layout.furniture.find(canSupportLamp)?.id } : {};
            if (v.kind === 'window_treatment' && !relationArgs.attachedOpeningId) { p.omitted.push({ variantId, reason: 'Window treatment omitted: this room has no window to attach it to.' }); continue; }
            if (v.kind === 'table_lamp' && !('supportObjectId' in relationArgs && relationArgs.supportObjectId)) { p.omitted.push({ variantId, reason: 'Table lamp omitted: no table, desk or cabinet is present to support it.' }); continue; }
            const found = Date.now() - start > 6500 ? { found: [] as Candidate[], trials: 0 } : await search(p, { variantId, limit: 1, ...relationArgs }, signal, 1100); trials += found.trials;
            if (found.found[0]) {
              const c = found.found[0], object = fromVariant(variantId, `planned-${p.id}-${p.revision}-${variantId}-${requestIndex + 1}`);
              Object.assign(object, { originCell: c.originCell, rotation: c.rotation, ...(c.attachedOpeningId ? {attachedOpeningId:c.attachedOpeningId} : {}), ...(c.supportObjectId ? {supportObjectId:c.supportObjectId} : {}), ...(c.lightingZone ? {lightingZone:c.lightingZone} : {}) }); if (c.wallAnchor) object.wallAnchor = c.wallAnchor;
              Object.assign(object, normalizeFixturePlacement(object, p.room, p.rules, p.layout, !!c.supportObjectId));
              if (object.kind === 'tv') object.targetSofaId = p.layout.furniture.find(o => o.kind === 'sofa')?.id;
              if (object.kind === 'chair') { const desk = [...p.layout.furniture].reverse().find(o => o.kind === 'desk' && !p.layout.furniture.some(chair => chair.kind === 'chair' && chair.linkedDeskId === o.id)); if (desk) object.linkedDeskId = desk.id; }
              p.layout.furniture.push(object);
              // Office desks are planned as an all-or-nothing work arrangement:
              // reserve the desk, then test and link its chair before retaining it.
              if (object.kind === 'desk' && linkedChairVariant && !p.layout.furniture.some(chair => chair.kind === 'chair' && chair.linkedDeskId === object.id)) {
                const chairVariant = linkedChairVariant;
                const chair = await search(p, { variantId: chairVariant, linkedDeskId: object.id, limit: 1 }, signal, 900); trials += chair.trials;
                if (chair.found[0]) { const cc = chair.found[0], linked = fromVariant(chairVariant, `planned-${p.id}-${p.revision}-${chairVariant}-linked-${requestIndex + 1}`); Object.assign(linked, { originCell: cc.originCell, rotation: cc.rotation, linkedDeskId: object.id }); p.layout.furniture.push(linked); }
                else { p.layout.furniture = p.layout.furniture.filter(o => o.id !== object.id); p.omitted.push({ variantId, reason: 'Desk omitted because no linked chair could be placed in the same bounded work arrangement.' }); }
              }
            }
            else { const relational = v.kind === 'window_treatment' || v.kind === 'table_lamp', smaller = !relational && CATALOGUE.filter(x => x.kind === v.kind && x.sizeCm.w * x.sizeCm.d < v.sizeCm.w * v.sizeCm.d).sort((a, b) => b.sizeCm.w * b.sizeCm.d - a.sizeCm.w * a.sizeCm.d)[0]; const checkedSmaller = smaller && Date.now() - start <= 6500 ? await search(p,{variantId:smaller.id,limit:1},signal,600) : undefined; trials += checkedSmaller?.trials || 0; p.omitted.push({ variantId, reason: `No placement found in this bounded greedy scan. ${p.rules.requiredKinds.includes(v.kind) ? 'This required function is still missing.' : 'Optional piece omitted.'} Not proof of infeasibility.`, ...(smaller && checkedSmaller?.found[0] ? { alternativeVariantId: smaller.id, alternativeChecked: { trials:checkedSmaller.trials, placementStatus:'valid', layoutStatus:checkedSmaller.found[0].layoutStatus, proposalRevision:p.revision, ruleRevision:state.ruleRevision } } : {}) }); }
          }
          if (signal?.aborted) fail('cancelled', 'Planning cancelled without committing.'); guard(a, 'layout'); result = commit(p, { planner: { kind: 'deterministic_bounded_greedy', trials, elapsedMs: Date.now() - start, complete: validate(p.layout, p.room, p.rules, state.inventory).validation.hardFailures === 0 && validate(p.layout, p.room, p.rules, state.inventory).brief.status === 'satisfied' } });
          return result;
        }
        if (signal?.aborted) fail('cancelled', 'Command cancelled without committing.');
        result = commit(p, mutationExtra);
      }
      if (retryKey) { retries.set(retryKey, { signature, result: clone(result) }); if (retries.size > 100) retries.delete(retries.keys().next().value!); }
      return clone(result);
    } catch (error) { return rejection(error); }
  }

  /**
   * A bounded, human-readable record of every tool call. WebMCP is invisible by
   * nature: an agent mutates the document and the furniture simply moves. This
   * is what lets a person watch the protocol work, including the refusals that
   * prove the page is the referee.
   */
  const toolLog: ToolLogEntry[] = [];
  const getToolLog = () => toolLog;
  /** Arguments are agent-supplied; keep only non-sensitive categories. */
  const summarise = (name: string, a: Args): string => {
    const parts: string[] = [];
    if (a?.which === 'current' || a?.which === 'proposal') parts.push(`view=${a.which}`);
    if (typeof a?.kind === 'string') parts.push(`kind=${a.kind}`);
    if (typeof a?.target === 'string') parts.push(`target=${a.target}`);
    if (a?.candidateId) parts.push('checked candidate');
    else if (a?.ownedId) parts.push('owned piece');
    else if (a?.variantId) parts.push('catalogue piece');
    else if (name === 'createCustomFurniture') parts.push('custom measured piece');
    else if (a?.objectId) parts.push('existing piece');
    if (Array.isArray(a?.openings)) parts.push(`${a.openings.length} openings`);
    return parts.slice(0, 3).join(' · ');
  };
  async function execute(name: string, a: Args, signal?: AbortSignal): Promise<CommandResult> {
    const startedAt = Date.now();
    const result = await runTool(name, a, signal);
    const validation = result.validation as { status?: string; hardFailures?: number } | undefined;
    toolLog.unshift({
      seq: ++toolSeq,
      at: startedAt,
      ms: Date.now() - startedAt,
      name,
      args: summarise(name, a),
      ok: result.operationSucceeded === true,
      errorCode: (result.error as { code?: string } | undefined)?.code,
      revision: typeof result.revision === 'number' ? result.revision : undefined,
      status: typeof result.status === 'string' ? result.status : undefined,
      validationStatus: validation?.status,
      hardFailures: validation?.hardFailures,
      readOnly: TOOL_SCHEMAS[name]?.readOnly === true,
    });
    if (toolLog.length > 60) toolLog.length = 60;
    listeners.forEach(listener => listener());
    return result;
  }

  const human = (fn: () => CommandResult): CommandResult => { try { return fn(); } catch (error) { return rejection(error); } };
  const undo = () => human(() => {
    const previous = past.pop() || fail('history_empty', 'Nothing to undo in this session.');
    future.push(state); publish(restored(previous), false); return { operationSucceeded: true, message: 'Undone. Review any restored proposal before applying.' };
  });
  const redo = () => human(() => {
    const next = future.pop() || fail('history_empty', 'Nothing to redo in this session.');
    past.push(state); publish(restored(next), false); return { operationSucceeded: true, message: 'Redone.' };
  });
  const guardHuman = (which: 'current' | 'proposal') => { if (which === 'proposal') guard({ proposalId: state.proposal?.id, revision: state.proposal?.revision }, 'layout'); };
  const humanUpdate = (which: 'current' | 'proposal', id: string, patch: HumanPatch) => human(() => {
    guardHuman(which);
    const inputError = validateSchema({ proposalId: 'human', revision: 1, objectId: id, ...Object.fromEntries(Object.entries(patch).filter(([k]) => k !== 'appearance')) }, TOOL_SCHEMAS.updateFurniture.inputSchema); if (inputError) fail('invalid_arguments', inputError);
    if (patch.appearance && !PALETTES.furniture.some(p => p.id === patch.appearance)) fail('invalid_palette', 'Unknown palette.');
    const next = clone(state), layout = which === 'current' ? next.current : next.proposal?.kind === 'layout' ? next.proposal.layout : fail('unconfirmed_setup', 'Choose a layout proposal to edit furniture.');
    const room = which === 'current' ? next.room : next.proposal!.room, rules = which === 'current' ? next.rules : next.proposal!.rules;
    const object = layout.furniture.find(o => o.id === id) || fail('invalid_id', 'Furniture ID not found.'); layout.furniture = layout.furniture.map(o => o.id === id ? checkPatch(object, patch, layout, room, rules) : o);
    if (which === 'current') next.currentRevision++; else next.proposal!.revision++;
    publish(next); return which === 'proposal' ? envelope(next.proposal!) : { operationSucceeded: true, currentRevision: state.currentRevision };
  });
  const humanAdd = (which: 'current' | 'proposal', variantId: string, patch?: HumanPatch, rejectInvalid = false) => human(() => {
    guardHuman(which);
    const next = clone(state), layout = which === 'current' ? next.current : next.proposal?.kind === 'layout' ? next.proposal.layout : fail('unconfirmed_setup', 'Create a layout proposal first.'), room = which === 'current' ? next.room : next.proposal!.room, rules = which === 'current' ? next.rules : next.proposal!.rules;
    if (layout.furniture.length >= 30) fail('room_limit', 'V1 supports 30 pieces.'); next.sequence++;
    const o = fromVariant(variantId, `human-${next.sequence}`), sofa = layout.furniture.find(f => f.kind === 'sofa');
    if (o.kind === 'tv') { o.targetSofaId = sofa?.id; if (sofa) { const b = bounds(sofa), wall = faces[sofa.rotation], centre = wall === 'north' || wall === 'south' ? b.x + b.w / 2 : b.y + b.d / 2; o.wallAnchor = anchorForDirection(which === 'current' ? next.room : next.proposal!.room, wall, centre, o.sizeCm.w) || undefined; } }
    else if (o.kind === 'desk') { o.originCell = { x: 0, y: 4 }; o.rotation = 270; }
    else if (o.kind === 'coffee_table' && sofa) { const b = bounds(sofa); o.originCell = { x: Math.round((b.x + b.w / 2 - o.sizeCm.w / 2) / 20), y: Math.max(0, Math.floor((b.y - state.rules.walkHardCm - o.sizeCm.d) / 20)) }; }
    else if (o.kind === 'rug' && sofa) { const b = bounds(sofa); o.originCell = { x: Math.max(0, Math.floor((b.x + b.w / 2 - o.sizeCm.w / 2) / 20)), y: Math.max(0, Math.floor((b.y - o.sizeCm.d + 40) / 20)) }; }
    else if (o.kind === 'window_treatment') { const window = room.openings.find(opening => opening.kind === 'window') || fail('window_required', 'Add a window in Room inputs before adding curtains or a blind.'); o.attachedOpeningId = window.id; }
    else if (o.kind === 'wall_light') { const segment = [...wallSegments(room)].sort((a,b)=>b.lengthCm-a.lengthCm)[0]; o.wallAnchor = { wall: segment.wall, offsetCm: Math.max(0, (segment.lengthCm-o.sizeCm.w)/2), ...(room.floorPlan ? {segmentId:segment.id} : {}) }; }
    else if (o.kind === 'table_lamp') { const support = layout.furniture.find(canSupportLamp) || fail('support_required', 'Add a table, desk or cabinet before adding a table lamp.'); o.supportObjectId = support.id; }
    else if (o.kind === 'ceiling_light') { const own = bounds(o, rules.cellCm); let found = false; for (let y=1;y<Math.ceil(room.depthCm/rules.cellCm)&&!found;y++) for(let x=1;x<Math.ceil(room.widthCm/rules.cellCm)&&!found;x++){const candidate={x:x*rules.cellCm-own.w/2,y:y*rules.cellCm-own.d/2,w:own.w,d:own.d};if(rectInsideRoom(room,candidate)){o.originCell={x:candidate.x/rules.cellCm,y:candidate.y/rules.cellCm};found=true;}} }
    else o.originCell = { x: 2, y: 2 };
    const base = normalizeFixturePlacement(o, room, rules, layout, o.kind === 'table_lamp');
    const placed = patch ? checkPatch(base, patch, layout, room, rules) : base;
    if (rejectInvalid) {
      const blocked = newBlockingIssueForAddition(layout, room, rules, next.inventory, placed);
      if (blocked) fail(blocked.code, `${blocked.code}: ${blocked.message}`);
    }
    layout.furniture.push(placed); if (which === 'current') next.currentRevision++; else next.proposal!.revision++; publish(next); return { operationSucceeded: true, objectId: o.id };
  });
  const humanRemove = (which: 'current' | 'proposal', id: string) => human(() => {
    guardHuman(which);
    const next = clone(state), layout = which === 'current' ? next.current : next.proposal?.kind === 'layout' ? next.proposal.layout : fail('unconfirmed_setup', 'Select a layout draft.'); removeFrom(layout, id, next.proposal?.omitted || []); if (which === 'current') next.currentRevision++; else next.proposal!.revision++; publish(next); return { operationSucceeded: true };
  });
  const humanRestoreOwned = (which: 'current' | 'proposal', id: string) => human(() => {
    guardHuman(which);
    const next = clone(state), layout = which === 'current' ? next.current : next.proposal?.kind === 'layout' ? next.proposal.layout : fail('unconfirmed_setup', 'Select a layout draft.');
    if (layout.furniture.some(o => o.id === id)) fail('duplicate_owned_instance', 'This owned piece is already in this layout.');
    const owned = next.inventory.find(o => o.id === id) || fail('invalid_id', 'Owned inventory piece not found.');
    if (layout.furniture.length >= 30) fail('room_limit', 'V1 supports 30 pieces.');
    layout.furniture.push(clone(owned));
    if (which === 'proposal') next.proposal!.omitted = next.proposal!.omitted.filter(o => o.objectId !== id);
    if (which === 'current') next.currentRevision++; else next.proposal!.revision++;
    publish(next);
    return which === 'proposal' ? envelope(next.proposal!) : { operationSucceeded: true, currentRevision: state.currentRevision };
  });
  const humanSetLocks = (id: string, locks: Furniture['locked'], which: 'current' | 'proposal' = 'current') => human(() => {
    if (which === 'proposal') {
      const p = state.proposal || fail('proposal_not_found', 'No active proposal.');
      guard({ proposalId: p.id, revision: p.revision }, 'layout');
      const next = clone(state), o = next.proposal!.layout.furniture.find(f => f.id === id) || fail('invalid_id', 'Piece not found.');
      if (o.ownership !== 'catalogue' && o.ownership !== 'custom') fail('lock_violation', 'Change owned locks in Yours. The draft will become stale.');
      o.locked = o.ownership === 'custom' ? { ...clone(locks), size: true } : clone(locks); next.proposal!.revision++; publish(next); return envelope(next.proposal!);
    }
    const next = clone(state), o = next.current.furniture.find(o => o.id === id) || fail('invalid_id', 'Select a piece in Yours to change its locks.');
    o.locked = o.ownership === 'custom' ? { ...clone(locks), size: true } : clone(locks); const inventory = next.inventory.find(i => i.id === id); if (inventory) { inventory.locked = clone(locks); inventory.originCell = clone(o.originCell); inventory.rotation = o.rotation; inventory.wallAnchor = clone(o.wallAnchor); inventory.elevationCm = o.elevationCm; }
    next.currentRevision++; publish(next); return { operationSucceeded: true };
  });
  const humanSetRequired = (id: string, required: boolean) => human(() => { const next = clone(state), inventory = next.inventory.find(o => o.id === id) || fail('invalid_id', 'Owned inventory piece not found.'); inventory.requiredInRoom = required; const o = next.current.furniture.find(o => o.id === id); if (o) o.requiredInRoom = required; next.currentRevision++; publish(next); return { operationSucceeded: true }; });
  const humanAddOwned = (input: { label: string; kind: Furniture['kind']; sizeCm: Furniture['sizeCm']; sleepSize?: Furniture['sleepSize']; storageRole?: 'wardrobe' | 'bedside' | 'general' }) => human(() => {
    if (!input.label.trim() || input.label.length > 100 || !['sofa','chair','desk','coffee_table','storage','plant','bed','rug','other','table'].includes(input.kind)) fail('invalid_arguments', 'Choose a supported floor furniture type and name.');
    const size = input.sizeCm;
    if (![size.w,size.d].every(n => Number.isFinite(n) && n > 0 && n <= 600) || (size.h !== null && (!Number.isFinite(size.h) || size.h < 0 || size.h > 500))) fail('invalid_measurement', 'Use finite positive dimensions, and a measured height or unknown.');
    const next = clone(state); if (next.current.furniture.length >= 30) fail('room_limit', 'V1 supports 30 pieces.'); next.sequence++;
    if (input.kind === 'bed' && !input.sleepSize) fail('invalid_arguments', 'Classify an owned bed as single, double, or king; its measured frame is preserved.');
    if (input.sleepSize !== undefined && (input.kind !== 'bed' || !['single', 'double', 'king'].includes(input.sleepSize))) fail('invalid_arguments', 'Sleep size must be single, double, or king and applies only to beds.');
    if (input.storageRole !== undefined && (input.kind !== 'storage' || !['wardrobe', 'bedside', 'general'].includes(input.storageRole))) fail('invalid_arguments', 'Storage role must be wardrobe, bedside, or general and applies only to storage.');
    const storageTags = input.storageRole === 'wardrobe' ? ['wardrobe', 'clothes-storage'] : input.storageRole === 'bedside' ? ['bedside'] : [];
    const object: Furniture = { id: `owned-${next.sequence}`, label: input.label.trim(), kind: input.kind, ownership: 'owned', sizeCm: clone(size), originCell: {x:2,y:2}, rotation:0, elevationCm:0, locked:{size:true}, appearance:'oat', requiredInRoom:true, tags: input.kind === 'sofa' ? ['seating'] : storageTags, ...(input.kind === 'bed' ? { sleepSize: input.sleepSize } : {}) };
    next.inventory.push(clone(object)); next.current.furniture.push(object); next.currentRevision++; publish(next); return { operationSucceeded:true, objectId:object.id };
  });
  const humanMeasureOwned = (id: string, size: Furniture['sizeCm']) => human(() => {
    if (![size.w, size.d].every(n => Number.isFinite(n) && n > 0 && n <= 600) || (size.h !== null && (!Number.isFinite(size.h) || size.h < 0 || size.h > 500))) fail('invalid_measurement', 'Use finite positive width/depth up to 600 cm, and a height up to 500 cm or unknown.');
    const next = clone(state), inventory = next.inventory.find(o => o.id === id) || fail('invalid_id', 'Owned piece not found.'); inventory.sizeCm = clone(size); const object = next.current.furniture.find(o => o.id === id); if (object) object.sizeCm = clone(size); next.currentRevision++; publish(next); return { operationSucceeded: true };
  });
  const humanClassifyOwned = (id: string, classification: { sleepSize?: Furniture['sleepSize']; storageRole?: 'wardrobe' | 'bedside' | 'general' }) => human(() => {
    if ((classification.sleepSize === undefined && classification.storageRole === undefined) || (classification.sleepSize !== undefined && classification.storageRole !== undefined)) fail('invalid_arguments', 'Classify an owned bed sleep size or an owned storage role.');
    if (classification.sleepSize !== undefined && !['single', 'double', 'king'].includes(classification.sleepSize)) fail('invalid_arguments', 'Sleep size must be single, double, or king.');
    if (classification.storageRole !== undefined && !['wardrobe', 'bedside', 'general'].includes(classification.storageRole)) fail('invalid_arguments', 'Storage role must be wardrobe, bedside, or general.');
    const next = clone(state), inventory = next.inventory.find(o => o.id === id) || fail('invalid_id', 'Owned inventory piece not found.');
    if (classification.sleepSize !== undefined) {
      if (inventory.kind !== 'bed') fail('invalid_arguments', 'Only beds have a sleep-size classification.');
      inventory.sleepSize = classification.sleepSize;
      inventory.tags = [...inventory.tags.filter(tag => !['single', 'double', 'king'].includes(tag)), classification.sleepSize];
    } else {
      if (inventory.kind !== 'storage') fail('invalid_arguments', 'Only storage has a wardrobe, bedside, or general classification.');
      const role = classification.storageRole!;
      inventory.tags = inventory.tags.filter(tag => !['wardrobe', 'clothes-storage', 'bedside'].includes(tag));
      if (role === 'wardrobe') inventory.tags.push('wardrobe', 'clothes-storage');
      if (role === 'bedside') inventory.tags.push('bedside');
    }
    const object = next.current.furniture.find(o => o.id === id);
    if (object) { object.tags = clone(inventory.tags); object.sleepSize = inventory.sleepSize; }
    next.currentRevision++; publish(next); return { operationSucceeded: true, currentRevision: state.currentRevision };
  });
  const humanSetRoomFinish = (which: 'current' | 'proposal', target: 'wall' | 'floor', paletteId: string) => human(() => {
    guardHuman(which);
    if (!PALETTES[target].some(p => p.id === paletteId)) fail('invalid_palette', 'Choose an ID from listCatalogue palettes.');
    const next = clone(state), layout = which === 'current' ? next.current : next.proposal?.kind === 'layout' ? next.proposal.layout : fail('unconfirmed_setup', 'Choose a layout proposal to change its finish.');
    // Appearance never changes geometry, height classes or rule flags, so this
    // still bumps the revision a reviewer must have seen before Apply.
    layout.appearance[target] = paletteId;
    if (which === 'current') next.currentRevision++; else next.proposal!.revision++;
    publish(next); return which === 'proposal' ? envelope(next.proposal!) : { operationSucceeded: true, currentRevision: state.currentRevision };
  });
  const applyProposal = (proposalId: string, revision: number) => human(() => { const p = guard({ proposalId, revision }, 'layout'), report = validate(p.layout, p.room, p.rules, state.inventory); if (report.validation.hardFailures || report.brief.status !== 'satisfied') fail('blocked_apply', 'Resolve hard failures and complete the active room brief before Apply.'); const next = clone(state); next.current = clone(p.layout); next.currentRevision++; next.proposal = null; publish(next); return { operationSucceeded: true, currentRevision: state.currentRevision, ...(report.conceptualOnly ? { conceptualOnly: true } : {}) }; });
  const confirmSetup = (proposalId: string, revision: number) => human(() => { const p = guard({ proposalId, revision }, 'setup'); const inputError = validateRoomInputs(p.room, p.rules); if (inputError) fail('invalid_room_inputs', inputError); checkRules(p.rules); const next = clone(state); next.room = clone(p.room); next.rules = clone(p.rules); next.ruleRevision++; next.proposal = null; publish(next); return { operationSucceeded: true, ruleRevision: state.ruleRevision, validation: validate(next.current, next.room, next.rules, next.inventory).validation }; });
  const discardProposal = () => { const next = clone(state); next.proposal = null; publish(next); return { operationSucceeded: true }; };
  const humanStageRoom = (room: Room, rules: Rules, expectedStamp: string, replaceProposal = false) => human(() => {
    if (expectedStamp !== roomEditStamp(state)) fail('revision_conflict', 'The room or proposal changed while this editor was open. Close and reopen it before staging.');
    const error = validateRoomInputs(room, rules); if (error) fail('invalid_room_inputs', error);
    const active = state.proposal;
    const canUpdate = active?.kind === 'setup' && proposalStatus(state) !== 'stale';
    if (active && !canUpdate && !replaceProposal) fail('active_proposal_exists', 'Explicitly replace the active proposal before staging these room inputs.');
    const next = clone(state); next.sequence++;
    const p: Proposal = canUpdate ? clone(active) : { id: `proposal-${next.sequence}`, kind: 'setup', revision: 0, baseCurrentRevision: state.currentRevision, baseRuleRevision: state.ruleRevision, layout: clone(state.current), room: clone(room), rules: clone(rules), omitted: [] };
    p.room = clone(room); p.rules = clone(rules); p.revision++; next.proposal = p; publish(next);
    return envelope(p, { message: 'Room inputs staged. Review and confirm to update Yours.' });
  });
  const resetDemo = (initial: AppState = makeDemo()) => { publish(restored({ ...initial, documentId: state.documentId })); };
  // Human-only room switch. The active document changes in place, exactly the way
  // generateRoom switches it, so opening a saved room never needs a page load. The
  // outgoing document is retained here (and by the caller's persistence) and session
  // history is cleared, because undo must not travel between documents.
  const humanOpenRoom = (next: AppState) => human(() => {
    const loaded = migrateState(next), id = documentId(loaded);
    try { validate(loaded.current, loaded.room, loaded.rules, loaded.inventory); }
    catch { fail('invalid_room', 'That saved room could not be read. Export it before continuing.'); }
    // Saved samples can share both IDs and revision numbers. Refresh authority
    // on every entry (including A → B → A) and clear retries before publishing.
    // Content and stale-draft status survive; queued commands and Apply do not.
    const target = restored(loaded);
    // Sample libraries each keep their own storage key, so two documents can share
    // the id 'original'. Only retain the outgoing one when it is genuinely distinct.
    if (documentId(state) !== id) documents.set(documentId(state), state);
    documents.set(id, target);
    past.length = 0; future.length = 0;
    publish(target, false);
    return { operationSucceeded: true, documentId: id, message: `Opened ${target.room.name}. Your previous room and its draft are saved.` };
  });
  return { getState, getDocuments, getHistory, getToolLog, subscribe, execute, undo, redo, humanStageRoom, humanUpdate, humanAdd, humanRemove, humanRestoreOwned, humanSetLocks, humanSetRequired, humanAddOwned, humanMeasureOwned, humanClassifyOwned, humanSetRoomFinish, humanOpenRoom, applyProposal, confirmSetup, discardProposal, resetDemo };
}
export type FloortrisStore = ReturnType<typeof createStore>;
