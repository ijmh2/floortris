import { faces, key, opposite, rotations, type ActivityZone, type Rotation, type BriefRequirement, type Cell, type Door, type Furniture, type GridCell, type Issue, type Layout, type Opening, type Rect, type Report, type Room, type Rules, type Wall } from './model.ts';
import { cellInsideRoom, floorAreaM2, rectInsideRoom, resolveWallSegment, wallRect, wallSegments } from './floorplan.ts';
import { canSupportLamp, isFloorOccupant, LIGHT_KINDS, normalizeFixturePlacement } from './fixture-placement.ts';

export const isSolid = (o: Furniture) => isFloorOccupant(o);
export function bounds(o: Furniture, cellCm = 20): Rect {
  const turned = o.rotation === 90 || o.rotation === 270;
  return { x: o.originCell.x * cellCm, y: o.originCell.y * cellCm, w: turned ? o.sizeCm.d : o.sizeCm.w, d: turned ? o.sizeCm.w : o.sizeCm.d };
}
export function rectCells(r: Rect, cellCm = 20): Cell[] {
  const cells: Cell[] = [];
  if (r.w <= 0 || r.d <= 0) return cells;
  for (let y = Math.floor(r.y / cellCm); y < Math.ceil((r.y + r.d) / cellCm - 1e-9); y++)
    for (let x = Math.floor(r.x / cellCm); x < Math.ceil((r.x + r.w) / cellCm - 1e-9); x++) cells.push({ x, y });
  return cells;
}
export function frontBand(o: Furniture, depth: number, cellCm = 20): Rect {
  const b = bounds(o, cellCm);
  switch (faces[o.rotation]) {
    case 'north': return { x: b.x, y: b.y - depth, w: b.w, d: depth };
    case 'south': return { x: b.x, y: b.y + b.d, w: b.w, d: depth };
    case 'west': return { x: b.x - depth, y: b.y, w: depth, d: b.d };
    case 'east': return { x: b.x + b.w, y: b.y, w: depth, d: b.d };
  }
}
const WALLS: Wall[] = ['north', 'east', 'south', 'west'];
export const COFFEE_TABLE_GAP_MIN_CM = 40;
export const COFFEE_TABLE_GAP_MAX_CM = 60;
export function rotateWall(wall: Wall, rotation: Rotation): Wall { return WALLS[(WALLS.indexOf(wall) + rotation / 90) % 4]; }
export function furnitureBackWall(o: Furniture): Wall { return rotateWall(o.backEdge || 'north', o.rotation); }
export function wallGaps(o: Furniture, room: Room, cellCm = 20): Record<Wall, number> {
  const b = bounds(o, cellCm);
  const gaps: Record<Wall, number[]> = { north: [], east: [], south: [], west: [] };
  for (const segment of wallSegments(room)) {
    const overlapsAlong = segment.horizontal ? b.x < segment.x2 && b.x + b.w > segment.x1 : b.y < segment.y2 && b.y + b.d > segment.y1;
    if (!overlapsAlong) continue;
    gaps[segment.wall].push(segment.wall === 'north' ? b.y - segment.y1 : segment.wall === 'south' ? segment.y1 - (b.y + b.d) : segment.wall === 'west' ? b.x - segment.x1 : segment.x1 - (b.x + b.w));
  }
  return { north: Math.min(...gaps.north, Infinity), east: Math.min(...gaps.east, Infinity), south: Math.min(...gaps.south, Infinity), west: Math.min(...gaps.west, Infinity) };
}
export function wantsWallBacking(o: Furniture, cellCm = 20): boolean {
  if (o.tags.includes('bedside')) return false;
  if (o.tags.includes('wall-backed') || o.kind === 'bed' || o.tags.includes('wardrobe')) return true;
  const b = bounds(o, cellCm);
  return o.kind === 'storage' && b.w * b.d / 10000 >= 0.35;
}
export type SofaTableRelation = { inFront: boolean; lateralOverlap: boolean; gapCm: number; offsetCm: number; validFrontageExemption: boolean };
export function sofaTableRelation(sofa: Furniture, table: Furniture, cellCm = 20): SofaTableRelation {
  const s = bounds(sofa, cellCm), t = bounds(table, cellCm), face = faces[sofa.rotation], across = face === 'north' || face === 'south';
  const lateralOverlap = across ? t.x < s.x + s.w && t.x + t.w > s.x : t.y < s.y + s.d && t.y + t.d > s.y;
  const offsetCm = across ? Math.abs((t.x + t.w / 2) - (s.x + s.w / 2)) : Math.abs((t.y + t.d / 2) - (s.y + s.d / 2));
  const inFront = face === 'north' ? t.y + t.d <= s.y : face === 'south' ? t.y >= s.y + s.d : face === 'west' ? t.x + t.w <= s.x : t.x >= s.x + s.w;
  const gapCm = face === 'north' ? s.y - (t.y + t.d) : face === 'south' ? t.y - (s.y + s.d) : face === 'west' ? s.x - (t.x + t.w) : t.x - (s.x + s.w);
  return { inFront, lateralOverlap, gapCm, offsetCm, validFrontageExemption: inFront && lateralOverlap && gapCm >= COFFEE_TABLE_GAP_MIN_CM && gapCm <= COFFEE_TABLE_GAP_MAX_CM };
}
function overlaps(a: Rect, b: Rect): boolean { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.d && a.y + a.d > b.y; }
function openDoorLeafRect(room: Room, door: Door): Rect | null {
  if (door.mechanism !== 'hinged' || door.swing !== 'in') return null;
  const hinge = door.offsetCm + (door.hinge === 'end' ? door.widthCm : 0), t = 0.5;
  const segment = resolveWallSegment(room, door); if (!segment) return null;
  if (door.wall === 'north') return { x: segment.x1 + hinge - t, y: segment.y1, w: t * 2, d: door.widthCm };
  if (door.wall === 'south') return { x: segment.x1 + hinge - t, y: segment.y1 - door.widthCm, w: t * 2, d: door.widthCm };
  if (door.wall === 'west') return { x: segment.x1, y: segment.y1 + hinge - t, w: door.widthCm, d: t * 2 };
  return { x: segment.x1 - door.widthCm, y: segment.y1 + hinge - t, w: door.widthCm, d: t * 2 };
}
function wallAttachmentProjection(room: Room, item: Furniture): Rect | null {
  if (!item.wallAnchor) return null;
  return wallRect(room, item.wallAnchor, item.sizeCm.w, Math.max(0.5, item.sizeCm.d));
}
/**
 * `faces` describes the front/foot of an item (rotation 0 is south), so a bed
 * head is its opposite. Bed-side access follows that head-to-foot axis, not
 * whichever rendered dimension happens to be longer.
 */
export function bedAccessBands(o: Furniture, depth: number, headExclusionCm = 60, cellCm = 20): { side: 'left' | 'right'; rect: Rect; headExcluded: Rect }[] {
  const b = bounds(o, cellCm), head = opposite[faces[o.rotation]], longVertical = head === 'north' || head === 'south';
  const along = longVertical ? b.d : b.w, excluded = Math.min(headExclusionCm, Math.max(0, along - 100));
  const startsAtHead = head === 'north' || head === 'west';
  const trim = (r: Rect) => longVertical
    ? { ...r, y: r.y + (startsAtHead ? excluded : 0), d: r.d - excluded }
    : { ...r, x: r.x + (startsAtHead ? excluded : 0), w: r.w - excluded };
  const raw = longVertical
    ? [{ side: 'left' as const, rect: { x: b.x - depth, y: b.y, w: depth, d: b.d } }, { side: 'right' as const, rect: { x: b.x + b.w, y: b.y, w: depth, d: b.d } }]
    : [{ side: 'left' as const, rect: { x: b.x, y: b.y - depth, w: b.w, d: depth } }, { side: 'right' as const, rect: { x: b.x, y: b.y + b.d, w: b.w, d: depth } }];
  return raw.map(item => ({ ...item, headExcluded: longVertical ? { ...item.rect, y: startsAtHead ? item.rect.y : item.rect.y + item.rect.d - excluded, d: excluded } : { ...item.rect, x: startsAtHead ? item.rect.x : item.rect.x + item.rect.w - excluded, w: excluded }, rect: trim(item.rect) }));
}
export function wallBand(room: Room, wall: Wall, offset: number, width: number, depth: number, segmentId?: string): Rect {
  return wallRect(room, { wall, offsetCm: offset, segmentId }, width, depth) || { x: 0, y: 0, w: 0, d: 0 };
}
function cellWallRange(cell: Cell, room: Room, wall: Wall, unit: number, segmentId?: string) {
  const x = cell.x * unit, y = cell.y * unit;
  const segment = resolveWallSegment(room, { wall, segmentId }); if (!segment) return { u: Infinity, v: Infinity };
  if (wall === 'north') return { u: x - segment.x1, v: y - segment.y1 };
  if (wall === 'south') return { u: x - segment.x1, v: segment.y1 - y - unit };
  if (wall === 'west') return { u: y - segment.y1, v: x - segment.x1 };
  return { u: y - segment.y1, v: segment.x1 - x - unit };
}
export function openingMasks(room: Room, opening: Opening, rules: Rules): { reserve: Cell[]; leaf: Cell[] } {
  const unit = rules.cellCm;
  if (opening.kind === 'window') {
    // Side hinges: conservative full-depth envelope, not a claim of exact sash dynamics.
    return { reserve: opening.type === 'side_hinge' ? rectCells(wallBand(room, opening.wall, opening.offsetCm, opening.widthCm, opening.widthCm, opening.segmentId), unit) : [], leaf: [] };
  }
  if (opening.mechanism !== 'hinged') return { reserve: [], leaf: [] };
  if (opening.swing === 'out') return { reserve: rectCells(wallBand(room, opening.wall, opening.offsetCm, opening.widthCm, rules.walkHardCm, opening.segmentId), unit), leaf: [] };
  const reserve: Cell[] = [], leaf: Cell[] = [];
  const hinge = opening.offsetCm + (opening.hinge === 'end' ? opening.widthCm : 0);
  for (const cell of rectCells(wallBand(room, opening.wall, opening.offsetCm, opening.widthCm, opening.widthCm, opening.segmentId), unit)) {
    const { u, v } = cellWallRange(cell, room, opening.wall, unit, opening.segmentId);
    const nearU = opening.hinge === 'start' ? Math.max(0, u - hinge) : Math.max(0, hinge - (u + unit));
    if (nearU * nearU + Math.max(0, v) ** 2 < opening.widthCm ** 2) reserve.push(cell);
    const leafU = opening.hinge === 'start' ? hinge + 1 : hinge - 1;
    if (leafU >= u && leafU < u + unit && v < opening.widthCm && v + unit > 0) leaf.push(cell);
  }
  return { reserve, leaf };
}
export type FootprintPass = { size: number; valid: Set<string>; reached: Set<string>; covered: Set<string>; reachableCovered: Set<string>; starts: Cell[] };
export function footprintPass(columns: number, rows: number, blocked: Set<string>, size: number, room: Room, doors: Door[], unit = 20): FootprintPass {
  const valid = new Set<string>(), reached = new Set<string>(), covered = new Set<string>(), reachableCovered = new Set<string>(), starts: Cell[] = [];
  const prefix: number[][] = Array.from({ length: rows + 1 }, () => Array(columns + 1).fill(0));
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) prefix[y + 1][x + 1] = Number(blocked.has(`${x},${y}`)) + prefix[y][x + 1] + prefix[y + 1][x] - prefix[y][x];
  for (let y = 0; y <= rows - size; y++) for (let x = 0; x <= columns - size; x++) {
    if (prefix[y + size][x + size] - prefix[y][x + size] - prefix[y + size][x] + prefix[y][x]) continue;
    const cell = { x, y }; valid.add(key(cell));
    for (let yy = y; yy < y + size; yy++) for (let xx = x; xx < x + size; xx++) covered.add(`${xx},${yy}`);
    for (const door of doors.filter(d => d.entrance && d.mechanism === 'hinged')) {
      const segment = resolveWallSegment(room, door); if (!segment) continue;
      const tangential = (door.wall === 'north' || door.wall === 'south' ? x * unit - segment.x1 : y * unit - segment.y1);
      const edge = door.wall === 'north' ? y === Math.ceil(segment.y1 / unit) : door.wall === 'south' ? y + size === Math.floor(segment.y1 / unit) : door.wall === 'west' ? x === Math.ceil(segment.x1 / unit) : x + size === Math.floor(segment.x1 / unit);
      if (edge && tangential >= door.offsetCm && tangential + size * unit <= door.offsetCm + door.widthCm && !starts.some(start => start.x === x && start.y === y)) starts.push(cell);
    }
  }
  const queue = [...starts]; starts.forEach(c => reached.add(key(c)));
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i];
    for (let y = c.y; y < c.y + size; y++) for (let x = c.x; x < c.x + size; x++) reachableCovered.add(`${x},${y}`);
    for (const n of [{ x: c.x + 1, y: c.y }, { x: c.x - 1, y: c.y }, { x: c.x, y: c.y + 1 }, { x: c.x, y: c.y - 1 }]) if (valid.has(key(n)) && !reached.has(key(n))) { reached.add(key(n)); queue.push(n); }
  }
  return { size, valid, reached, covered, reachableCovered, starts };
}
function fitsWithin(anchor: Cell, size: number, r: Rect, unit: number) {
  return anchor.x * unit >= r.x - 1e-6 && anchor.y * unit >= r.y - 1e-6 && (anchor.x + size) * unit <= r.x + r.w + 1e-6 && (anchor.y + size) * unit <= r.y + r.d + 1e-6;
}
function zoneReachable(r: Rect, pass: FootprintPass, unit: number, softBand = false) {
  for (const point of pass.reached) {
    const [x, y] = point.split(',').map(Number);
    if (fitsWithin({ x, y }, pass.size, r, unit)) return true;
    // A preferred footprint can straddle an approach edge while fully occupying free cells.
    if (softBand && x * unit < r.x + r.w && (x + pass.size) * unit > r.x && y * unit < r.y + r.d && (y + pass.size) * unit > r.y) return true;
  }
  return false;
}
function largestEmptyRectangle(columns: number, rows: number, blocked: Set<string>, unit: number) {
  const heights = Array(columns).fill(0); let largest = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) heights[x] = blocked.has(`${x},${y}`) ? 0 : heights[x] + 1;
    const stack: number[] = [];
    for (let x = 0; x <= columns; x++) {
      const height = x === columns ? 0 : heights[x];
      while (stack.length && heights[stack[stack.length - 1]] > height) { const h = heights[stack.pop()!]; const start = stack.length ? stack[stack.length - 1] + 1 : 0; largest = Math.max(largest, h * (x - start)); }
      stack.push(x);
    }
  }
  return largest * unit * unit / 10000;
}
export function validate(layout: Layout, room: Room, rules: Rules, inventory: Furniture[] = [], includeFixes = true): Report {
  const unit = rules.cellCm, columns = Math.ceil(room.widthCm / unit), rows = Math.ceil(room.depthCm / unit);
  const checkedRules = ['custom_floor_boundary', 'physical_fit', 'solid_overlap', 'door_sweep', 'door_leaf_wall_attachments', 'windows', 'window_treatments', 'radiator', 'fixture_approaches', 'sofa_table_relationship', 'bed_side_access', 'desk_chair_relationship', 'storage_use_zones', 'wall_backing', 'orthogonal_hard_path', 'preferred_path', 'full_tv_strip', 'ceiling', 'ceiling_fixture_outline', 'lighting_mounts', 'lighting_zones', 'owned_locks', 'required_brief'];
  const cells: GridCell[] = Array.from({ length: rows * columns }, (_, i) => ({ x: i % columns, y: Math.floor(i / columns), heightClass: 'FREE', objectIds: [], flags: [] }));
  const lookup = new Map(cells.map(c => [key(c), c]));
  const insideKeys = new Set(cells.filter(c => cellInsideRoom(room, c.x, c.y, unit)).map(key));
  cells.filter(c => !insideKeys.has(key(c))).forEach(c => c.flags.push('outside_floorplan'));
  const issues: Issue[] = [], zones: ActivityZone[] = [];
  const all = [...room.fixtures, ...layout.furniture];
  const masks = new Map(all.map(o => [o.id, isFloorOccupant(o) ? rectCells(bounds(o, unit), unit) : []]));
  const issue = (code: string, message: string, ids: string[] = [], at: Cell[] = [], severity: Issue['severity'] = 'block', flags: string[] = [], fix?: Issue['fix']) => { issues.push({ code, message, severity, objectIds: [...new Set(ids)], cells: at, flags, ...(includeFixes && fix ? { fix } : {}) }); };
  const flag = (at: Cell[], name: string) => at.forEach(c => { const g = lookup.get(key(c)); if (g && !g.flags.includes(name)) g.flags.push(name); });
  const occupants = (at: Cell[], exempt: string[] = []) => [...new Set(at.flatMap(c => lookup.get(key(c))?.objectIds || []).filter(id => !exempt.includes(id)))];
  for (const o of all) {
    const b = bounds(o, unit), at = masks.get(o.id)!;
    if (isFloorOccupant(o) && (b.w <= 0 || b.d <= 0)) issue('footprint_invalid', `${o.label} has no measurable footprint, so no clearance or route rule can see it. Give it a positive width and depth.`, [o.id]);
    if ((isFloorOccupant(o) || o.kind === 'ceiling_light' || o.kind === 'table_lamp') && !rectInsideRoom(room, b)) issue('out_of_room', `${o.label} extends past the room outline. Move it inside the boundary.`, [o.id], rectCells(b, unit).filter(c => !insideKeys.has(key(c))));
    if (o.sizeCm.h !== null && o.elevationCm + o.sizeCm.h > rules.ceilingCm) issue('ceiling_collision', `${o.label} is above the ${rules.ceilingCm} cm ceiling. Check the measured height or mount.`, [o.id]);
    if (!isSolid(o)) continue;
    for (const c of at) { const g = lookup.get(key(c)); if (!g) continue; g.objectIds.push(o.id); g.heightClass = o.sizeCm.h === null || g.heightClass === 'UNKNOWN_HEIGHT' ? 'UNKNOWN_HEIGHT' : o.sizeCm.h > rules.H_lowCm || g.heightClass === 'TALL' ? 'TALL' : 'LOW'; }
  }
  const pairs = new Map<string, Cell[]>();
  for (const g of cells.filter(c => c.objectIds.length > 1)) for (let a = 0; a < g.objectIds.length; a++) for (let b = a + 1; b < g.objectIds.length; b++) { const p = [g.objectIds[a], g.objectIds[b]].sort().join('|'); pairs.set(p, [...(pairs.get(p) || []), { x: g.x, y: g.y }]); }
  for (const [pair, at] of pairs) { const ids = pair.split('|'); issue('solid_overlap', `${all.find(o => o.id === ids[0])?.label} and ${all.find(o => o.id === ids[1])?.label} share floor cells. Move one piece.`, ids, at); }
  const blocked = new Set(cells.filter(c => c.objectIds.length || !insideKeys.has(key(c))).map(key));
  const doors = room.openings.filter((o): o is Door => o.kind === 'door');
  if (doors.filter(o => o.entrance).length !== 1) issue('door_approach_blocked', 'Choose exactly one entrance door in room setup.');
  for (const opening of room.openings) {
    const segment = resolveWallSegment(room, opening);
    if (!segment || opening.offsetCm < 0 || opening.offsetCm + opening.widthCm > segment.lengthCm) issue('out_of_room', `${opening.id} is not contained by its wall segment. Correct the segment, offset, or width in room setup.`, [opening.id]);
    const { reserve, leaf } = openingMasks(room, opening, rules);
    if (opening.kind === 'door') {
      if (opening.mechanism !== 'hinged') issue('unsupported_opening', `${opening.id}: ${opening.mechanism} doors are not modelled. Choose a supported hinged fixture or revise this room outside V1.`, [opening.id]);
      flag(reserve, 'door_swing_reserved'); flag(leaf, 'door_leaf_blocked'); leaf.forEach(c => blocked.add(key(c)));
      const ids = occupants(reserve); if (ids.length) issue('door_swing_obstructed', 'Furniture occupies the reserved door sweep or out-swing approach. Move it clear of the hatched area.', [opening.id, ...ids], reserve.filter(c => occupants([c]).length > 0), 'block', ['door_swing_reserved']);
      // Wall-mounted pieces have no floor mask, so a 90-degree leaf can
      // otherwise finish along an adjacent wall and pass through them.
      const leafRect = openDoorLeafRect(room, opening);
      if (leafRect) for (const attachment of layout.furniture.filter(o => ['tv', 'wall_light', 'window_treatment'].includes(o.kind) && o.wallAnchor && o.wallAnchor.wall !== opening.wall)) {
        const projection = wallAttachmentProjection(room, attachment);
        const verticalOverlap = attachment.elevationCm < rules.ceilingCm && (attachment.sizeCm.h === null || attachment.elevationCm + attachment.sizeCm.h > 0);
        if (projection && verticalOverlap && overlaps(leafRect, projection)) issue('door_leaf_wall_attachment', `The open leaf of ${opening.id} reaches ${attachment.label}. Move the wall fixture or revise the confirmed door pose.`, [opening.id, attachment.id], rectCells(leafRect, unit).filter(c => lookup.has(key(c))), 'block', ['door_leaf_blocked']);
      }
    } else {
      flag(reserve, 'window_envelope');
      const envelopeIds = occupants(reserve); if (envelopeIds.length) issue('window_envelope_blocked', 'Furniture occupies the conservative side-hinge window envelope.', [opening.id, ...envelopeIds], reserve, 'block', ['window_envelope']);
      const band = rectCells(wallBand(room, opening.wall, opening.offsetCm, opening.widthCm, rules.windowFrontCm, opening.segmentId), unit);
      const ids = occupants(band).filter(id => { const o = all.find(o => o.id === id)!; return o.sizeCm.h === null || (o.elevationCm < opening.headCm && o.elevationCm + o.sizeCm.h > opening.sillCm); });
      if (ids.length) issue('window_sill_collision', `Furniture in the ${rules.windowFrontCm} cm window-front band overlaps the sill-to-head height. Move it away from this band.`, [opening.id, ...ids], band);
      if (opening.type === 'unknown') issue('window_opening_unverified', 'Window mechanism is unknown. The sill policy was checked; the opening envelope was not verified.', [opening.id], band, 'warning');
    }
  }
  const sameWallSurface = (a: { wall: Wall; segmentId?: string }, b: { wall: Wall; segmentId?: string }) => room.floorPlan ? !!a.segmentId && a.segmentId === b.segmentId : a.wall === b.wall;
  for (const treatment of layout.furniture.filter(o => o.kind === 'window_treatment')) {
    const window = room.openings.find(o => o.id === treatment.attachedOpeningId && o.kind === 'window');
    if (!window) { issue('window_treatment_unassociated', `${treatment.label} must name an existing window in attachedOpeningId.`, [treatment.id]); continue; }
    if (!['curtains', 'blind'].includes(treatment.fixtureType || '')) { issue('window_treatment_type', `${treatment.label} must declare curtains or blind as its fixtureType.`, [treatment.id]); continue; }
    const expected = normalizeFixturePlacement(treatment, room, rules, layout), anchor = treatment.wallAnchor;
    const detached = !anchor || !expected.wallAnchor || !sameWallSurface(anchor, window) || Math.abs(anchor.offsetCm - expected.wallAnchor.offsetCm) > .01
      || Math.abs(treatment.sizeCm.w - expected.sizeCm.w) > .01 || Math.abs(treatment.sizeCm.d - expected.sizeCm.d) > .01
      || Math.abs((treatment.sizeCm.h || 0) - (expected.sizeCm.h || 0)) > .01 || treatment.elevationCm !== expected.elevationCm;
    if (detached) issue('window_treatment_detached', `${treatment.label} no longer matches ${window.id}'s measured wall, width, drop and projection. Reattach it to that window.`, [treatment.id, window.id]);
    if (!anchor) continue;
    const projection = wallAttachmentProjection(room, treatment);
    if (!projection || !rectInsideRoom(room, projection)) issue('out_of_room', `${treatment.label} extends beyond its wall segment or custom floor outline.`, [treatment.id]);
    if (treatment.fixtureType === 'blind') continue; // fitted to the opening; no floor occupancy or curtain-side clearance.
    const at = rectCells(projection || { x: 0, y: 0, w: 0, d: 0 }, unit).filter(c => lookup.has(key(c)));
    flag(at, 'curtain_projection');
    const conflicts = occupants(at).filter(id => {
      const other = all.find(o => o.id === id); if (!other) return false;
      return other.sizeCm.h === null || (treatment.elevationCm < other.elevationCm + (other.sizeCm.h || rules.ceilingCm) && treatment.elevationCm + (treatment.sizeCm.h || rules.ceilingCm) > other.elevationCm);
    });
    if (conflicts.length) issue('curtain_clearance_blocked', `${treatment.label}'s measured ${treatment.sizeCm.d} cm projection conflicts with furniture or a radiator. Keep the fabric zone clear.`, [treatment.id, ...conflicts], at, 'block', ['curtain_projection']);
    for (const door of room.openings.filter((o): o is Door => o.kind === 'door' && sameWallSurface(o, anchor))) if (anchor.offsetCm < door.offsetCm + door.widthCm && anchor.offsetCm + treatment.sizeCm.w > door.offsetCm) issue('curtain_door_conflict', `${treatment.label} overlaps ${door.id} along the same wall. Narrow or remove the treatment.`, [treatment.id, door.id], at, 'block', ['curtain_projection']);
  }
  for (const light of layout.furniture.filter(o => o.kind === 'ceiling_light')) {
    const b = bounds(light, unit);
    if (!['pendant', 'flush', 'track', 'recessed'].includes(light.fixtureType || '')) issue('ceiling_light_type', `${light.label} needs a pendant, flush, track or recessed fixtureType.`, [light.id]);
    if (!rectInsideRoom(room, b)) issue('ceiling_fixture_outside', `${light.label}'s complete ceiling-plan envelope must stay inside the actual room outline, including L-shaped cut-outs.`, [light.id], rectCells(b, unit));
    const expectedBottom = rules.ceilingCm - (light.sizeCm.h || 0);
    if (Math.abs(light.elevationCm - expectedBottom) > .01) issue('ceiling_mount_detached', `${light.label} must hang from the ${rules.ceilingCm} cm ceiling; its bottom should be ${expectedBottom} cm.`, [light.id]);
    if (light.elevationCm < 200) issue('ceiling_head_clearance', `${light.label} hangs below the 200 cm Floortris planning head-clearance assumption. Raise it or choose a shallower fitting; this is not a code-compliance claim.`, [light.id], rectCells(b, unit), 'block');
  }
  for (const light of layout.furniture.filter(o => o.kind === 'wall_light')) {
    const anchor = light.wallAnchor, segment = anchor && resolveWallSegment(room, anchor);
    if (!anchor || !segment) { issue('wall_light_unassociated', `${light.label} needs an explicit wallAnchor${room.floorPlan ? ' with segmentId' : ''}.`, [light.id]); continue; }
    if (anchor.offsetCm < 0 || anchor.offsetCm + light.sizeCm.w > segment.lengthCm) issue('out_of_room', `${light.label} extends beyond ${segment.id}.`, [light.id]);
    if (light.fixtureType !== 'wall_sconce') issue('wall_light_type', `${light.label} must declare wall_sconce as its fixtureType.`, [light.id]);
    const low = light.elevationCm, high = light.elevationCm + (light.sizeCm.h || rules.ceilingCm), projection = wallAttachmentProjection(room, light);
    if (low < 0 || high > rules.ceilingCm) issue('wall_light_height', `${light.label}'s complete measured height must stay between the floor and the ${rules.ceilingCm} cm ceiling.`, [light.id], [], 'block');
    else if (low < 80) issue('wall_light_height', `${light.label} is below the 80 cm Floortris wall-light planning height. Confirm the intended low-level use; this is design guidance, not an electrical or building-code claim.`, [light.id], [], 'warning');
    for (const opening of room.openings.filter(o => sameWallSurface(o, anchor))) {
      const openingLow = opening.kind === 'window' ? opening.sillCm : 0, openingHigh = opening.kind === 'window' ? opening.headCm : rules.ceilingCm;
      if (anchor.offsetCm < opening.offsetCm + opening.widthCm && anchor.offsetCm + light.sizeCm.w > opening.offsetCm && low < openingHigh && high > openingLow) issue('wall_light_opening_overlap', `${light.label} overlaps ${opening.id} in wall position and height.`, [light.id, opening.id]);
    }
    const near = projection ? rectCells(wallBand(room, anchor.wall, anchor.offsetCm, light.sizeCm.w, Math.max(20, light.sizeCm.d), anchor.segmentId), unit) : [];
    const tall = occupants(near).filter(id => { const other = all.find(o => o.id === id); return !!other && (other.sizeCm.h === null || (other.elevationCm < high && other.elevationCm + (other.sizeCm.h || rules.ceilingCm) > low)); });
    if (tall.length) issue('wall_light_furniture_overlap', `${light.label} intersects tall furniture at its mounting height. Move the sconce, or move the furniture away from that wall section.`, [light.id, ...tall], near);
  }
  for (const lamp of layout.furniture.filter(o => o.kind === 'table_lamp')) {
    const support = layout.furniture.find(o => o.id === lamp.supportObjectId && canSupportLamp(o));
    if (!support) { issue('table_lamp_unsupported', `${lamp.label} must link supportObjectId to a table, desk or cabinet in this layout.`, [lamp.id]); continue; }
    const l = bounds(lamp, unit), s = bounds(support, unit), top = support.elevationCm + (support.sizeCm.h || 0);
    if (l.x < s.x || l.y < s.y || l.x + l.w > s.x + s.w || l.y + l.d > s.y + s.d || Math.abs(lamp.elevationCm - top) > .01) issue('table_lamp_unsupported', `${lamp.label}'s measured base must be fully on ${support.label}'s top at ${top} cm.`, [lamp.id, support.id], rectCells(l, unit));
  }
  for (const o of room.fixtures.filter(o => o.kind === 'radiator')) {
    const b = bounds(o, unit); const wall = o.wallAnchor?.wall || 'east';
    const reserve = wall === 'east' ? { x: b.x - rules.radiatorFrontCm, y: b.y, w: rules.radiatorFrontCm, d: b.d } : wall === 'west' ? { x: b.x + b.w, y: b.y, w: rules.radiatorFrontCm, d: b.d } : wall === 'north' ? { x: b.x, y: b.y + b.d, w: b.w, d: rules.radiatorFrontCm } : { x: b.x, y: b.y - rules.radiatorFrontCm, w: b.w, d: rules.radiatorFrontCm };
    const at = rectCells(reserve, unit); flag(at, 'radiator_keepout'); const ids = occupants(at, [o.id]); if (ids.length) issue('radiator_keepout', `Keep ${rules.radiatorFrontCm} cm in front of the radiator clear. This is a demo assumption, not equipment safety guidance.`, [o.id, ...ids], at, 'block', ['radiator_keepout']);
  }
  // A wall anchor is checked against the room when it is set, and the room can
  // change afterwards: widening it leaves a wall fixture standing in open floor
  // with its keep-out band measured against empty air. Re-check the invariant
  // rather than trusting the record that set it.
  for (const f of room.fixtures.filter(f => f.wallAnchor)) {
    const b = bounds(f, unit), wall = f.wallAnchor!.wall, along = wall === 'north' || wall === 'south' ? b.w : b.d, depth = wall === 'north' || wall === 'south' ? b.d : b.w;
    const expected = wallRect(room, f.wallAnchor!, along, depth), detached = !expected || Math.abs(b.x - expected.x) > 1 || Math.abs(b.y - expected.y) > 1;
    if (detached) issue('fixture_anchor_detached', `${f.label} no longer matches its ${f.wallAnchor!.segmentId || wall} wall anchor, so its clearance is measured in the wrong place. Reselect its wall in room inputs.`, [f.id], rectCells(b, unit).filter(c => lookup.has(key(c))), 'warning');
  }
  // A rule keyed to a rule constant can be switched off outright by a legal
  // setConstraints value. That remains the human's choice, but it must not be
  // silent: an empty report would otherwise read as a clean room.
  const switchedOff = (message: string, ids: string[]) => issue('rule_disabled_by_constraint', message, ids, [], 'info');
  if (rules.H_lowCm >= rules.ceilingCm && layout.furniture.some(o => o.kind === 'tv')) switchedOff(`No known-height object can count as tall while H_lowCm (${rules.H_lowCm} cm) is at or above the ${rules.ceilingCm} cm ceiling, so the TV sightline cannot report a known-height obstruction. Unknown heights still fail closed.`, layout.furniture.filter(o => o.kind === 'tv').map(o => o.id));
  if (rules.radiatorFrontCm <= 0 && room.fixtures.some(f => f.kind === 'radiator')) switchedOff('The radiator keep-out depth is 0 cm, so furniture in front of a radiator can never be reported.', room.fixtures.filter(f => f.kind === 'radiator').map(f => f.id));
  if (rules.windowFrontCm <= 0 && room.openings.some(o => o.kind === 'window')) switchedOff('The window-front depth is 0 cm, so the sill-height check can never report anything.', room.openings.filter(o => o.kind === 'window').map(o => o.id));
  const hardSize = Math.ceil(rules.walkHardCm / unit), preferredSize = Math.ceil(rules.walkPreferredCm / unit);
  const hard = footprintPass(columns, rows, blocked, hardSize, room, doors, unit);
  const preferred = preferredSize === hardSize ? hard : footprintPass(columns, rows, blocked, preferredSize, room, doors, unit);
  for (const g of cells) g.flags.push(preferred.covered.has(key(g)) ? 'walk_clear' : hard.covered.has(key(g)) ? 'walk_tight' : 'walk_blocked');
  const lights = layout.furniture.filter(o => LIGHT_KINDS.has(o.kind));
  const centre = (o: Furniture) => { const b = bounds(o, unit); return { x: b.x + b.w / 2, y: b.y + b.d / 2 }; };
  const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
  const seatingTargets = layout.furniture.filter(o => o.kind === 'sofa' || o.kind === 'chair'), readingTargets = layout.furniture.filter(o => o.kind === 'chair' || o.kind === 'desk');
  for (const light of lights) {
    const source = centre(light), zone = light.lightingZone || 'ambient';
    if (zone === 'seating' && (!seatingTargets.length || Math.min(...seatingTargets.map(o => distance(source, centre(o)))) > 260)) issue('lighting_zone_mismatch', `${light.label} is labelled for seating but is not within the 260 cm Floortris planning radius of a sofa or chair. This is placement guidance, not a lighting calculation.`, [light.id, ...seatingTargets.map(o => o.id)], [], 'warning');
    if (zone === 'reading' && (!readingTargets.length || Math.min(...readingTargets.map(o => distance(source, centre(o)))) > 180)) issue('lighting_zone_mismatch', `${light.label} is labelled for reading but is not within the 180 cm planning radius of a chair or desk.`, [light.id, ...readingTargets.map(o => o.id)], [], 'warning');
    if (zone === 'circulation') {
      const sourceCell = { x: Math.floor(source.x / unit), y: Math.floor(source.y / unit) };
      if (![...hard.reachableCovered].some(entry => { const [x, y] = entry.split(',').map(Number); return Math.hypot(x - sourceCell.x, y - sourceCell.y) <= 6; })) issue('lighting_zone_mismatch', `${light.label} is labelled for circulation but is not near the connected entrance route.`, [light.id], [], 'warning');
    }
  }
  if (lights.length) {
    if (seatingTargets.length && !lights.some(light => ['seating', 'reading'].includes(light.lightingZone || '') && seatingTargets.some(target => distance(centre(light), centre(target)) <= 260))) issue('lighting_zone_unserved', 'The room has seating, but no seating/reading fixture is near it. Consider adding or relabelling a light; this is design guidance only.', seatingTargets.map(o => o.id), [], 'info');
    if (doors.some(d => d.entrance) && !lights.some(light => ['ambient', 'circulation'].includes(light.lightingZone || 'ambient'))) issue('lighting_zone_unserved', 'No ambient or circulation fixture is assigned to the entrance route.', doors.filter(d => d.entrance).map(d => d.id), [], 'info');
  }
  const addZone = (id: string, objectId: string, label: string, rect: Rect, flexible = false, purpose?: string, blocking = true) => {
    const reachable = zoneReachable(rect, hard, unit, flexible), preferredReachable = zoneReachable(rect, preferred, unit, true), at = rectCells(rect, unit).filter(c => lookup.has(key(c)));
    const zone = { id, objectId, label, rect, reachable, preferredReachable, cells: at, purpose }; zones.push(zone); flag(at, reachable ? 'path_reachable' : 'path_unreachable');
    if (!reachable && blocking) { issue('path_broken', `${label} has no connected ${rules.walkHardCm} cm square-footprint approach from the open entrance. Move nearby furniture, then check again.`, [objectId, ...occupants(at, [objectId])], at, 'block', ['path_unreachable']); Object.assign(issues[issues.length - 1], { destinationId: id, configuredWalkHardCm: rules.walkHardCm }); }
    else if (reachable && !preferredReachable) issue('walk_tight', `${label} is reachable at the ${rules.walkHardCm} cm hard minimum, but not the ${rules.walkPreferredCm} cm preferred width.`, [objectId], at, 'warning', ['walk_tight']);
  };
  for (const fixture of room.fixtures.filter(f => f.kind !== 'radiator' && f.clearance)) {
    const rect = fixture.clearance!.rect, at = rectCells(rect, unit), ids = occupants(at, [fixture.id]);
    if (ids.length) issue('fixture_clearance_blocked', `${fixture.label} concept approach is occupied by another solid object.`, [fixture.id, ...ids], at, 'block', ['fixture_clearance_blocked']);
    // The measured concept bands may be narrower than the rasterised hard
    // footprint. Their reachable state therefore permits edge contact, but the
    // fixture itself remains solid and never becomes walk-through space.
    addZone(`fixture:${fixture.id}`, fixture.id, fixture.clearance!.label, rect, true, 'fixed_fixture_approach', false);
    if (!ids.length && !zones.at(-1)!.reachable) issue('fixture_clearance_unreachable', `${fixture.label} concept approach is not reachable from the entrance.`, [fixture.id], at, 'block', ['fixture_clearance_unreachable']);
  }
  for (const door of doors) addZone(`approach:${door.id}`, door.id, door.entrance ? 'Entrance' : 'Door approach', wallBand(room, door.wall, door.offsetCm, door.widthCm, hardSize * unit, door.segmentId), true);
  for (const o of layout.furniture) {
    if (o.linkedDeskId && !layout.furniture.some(d => d.id === o.linkedDeskId && d.kind === 'desk')) issue('link_dangling', `${o.label} is still linked to a desk that is no longer in this layout. Relink it or clear the link.`, [o.id], [], 'warning');
    if (o.kind === 'sofa') {
      const target = frontBand(o, hardSize * unit, unit), face = faces[o.rotation];
      if (face === 'south') target.y = Math.ceil(target.y / unit) * unit;
      if (face === 'east') target.x = Math.ceil(target.x / unit) * unit;
      addZone(`sofa:${o.id}`, o.id, `${o.label} front`, target);
      // The zone above only proves the seat can be REACHED. It says nothing
      // about a piece parked in the frontage itself, which is how a low cabinet
      // slipped through: it leaves a route around itself and, being under
      // H_lowCm, clears the TV strip too. A coffee table belongs in front of a
      // sofa; a cabinet does not.
      const seat = rectCells(target, unit);
      // Movable pieces only: a radiator or other fixed fixture clipping the band
      // is part of the room, and already has its own keep-out rule.
      const parked = occupants(seat, [o.id]).filter(id => { const f = layout.furniture.find(x => x.id === id); return !!f && !(f.kind === 'coffee_table' && sofaTableRelation(o, f, unit).validFrontageExemption); });
      if (parked.length) issue('sofa_front_blocked', `${o.label} needs its ${rules.walkHardCm} cm seat frontage clear. Only a coffee table placed ${COFFEE_TABLE_GAP_MIN_CM}–${COFFEE_TABLE_GAP_MAX_CM} cm in front may occupy part of it.`, [o.id, ...parked], seat);
    }
    if (o.kind === 'desk' || o.kind === 'storage') {
      const depth = o.kind === 'desk' ? rules.chairPullCm : rules.storageFrontCm, rect = frontBand(o, depth, unit), at = rectCells(rect, unit);
      const exempt = [o.id, ...(o.kind === 'desk' ? layout.furniture.filter(c => c.linkedDeskId === o.id && c.kind === 'chair').map(c => c.id) : [])];
      const ids = occupants(at, exempt); if (ids.length) issue(o.kind === 'desk' ? 'chair_pull_blocked' : 'storage_front_blocked', `${o.label} needs its ${depth} cm ${o.kind === 'desk' ? 'chair-pull' : 'opening'} zone clear of unrelated furniture.`, [o.id, ...ids], at);
      // Reach the designated outer edge of a desk pull zone; linked chair cells still block the footprint.
      let target = rect;
      if (o.kind === 'desk') {
        const face = faces[o.rotation], reach = hardSize * unit;
        target = face === 'north' ? { ...rect, y: rect.y - reach, d: reach } : face === 'south' ? { ...rect, y: rect.y + rect.d, d: reach } : face === 'west' ? { ...rect, x: rect.x - reach, w: reach } : { ...rect, x: rect.x + rect.w, w: reach };
      }
      if (faces[o.rotation] === 'south') target.y = Math.ceil(target.y / unit) * unit;
      if (faces[o.rotation] === 'east') target.x = Math.ceil(target.x / unit) * unit;
      addZone(`${o.kind}:${o.id}`, o.id, `${o.label} ${o.kind === 'desk' ? 'chair approach' : 'front'}`, target, o.kind === 'storage');
      if (o.tags.includes('bedside')) {
        const b = bounds(o, unit), beds = layout.furniture.filter(f => f.kind === 'bed');
        const nearHead = beds.some(bed => bedAccessBands(bed, Math.max(depth, b.w, b.d), 60, unit).some(({ headExcluded: h }) => b.x < h.x + h.w && b.x + b.w > h.x && b.y < h.y + h.d && b.y + b.d > h.y));
        if (!nearHead) issue('prefer_bedside_near_bed', `${o.label} is not beside a bed head. Keep the head-end table separate from the required side entry.`, [o.id], rectCells(b, unit), 'warning', ['bedside_not_at_head']);
      }
      if (o.tags.includes('bedside') && !zones.at(-1)!.reachable) issue('bedside_route_conflict', `${o.label} drawer/front approach conflicts with the entrance route.`, [o.id], at, 'warning');
      if (o.kind === 'desk' && rules.deskNearWindow) {
        const b = bounds(o, unit), cx = b.x + b.w / 2, cy = b.y + b.d / 2;
        const near = room.openings.some(w => {
          if (w.kind !== 'window') return false;
          const segment = resolveWallSegment(room, w); if (!segment) return false;
          const along = segment.horizontal ? cx - segment.x1 : cy - segment.y1;
          const inward = w.wall === 'north' ? cy - segment.y1 : w.wall === 'south' ? segment.y1 - cy : w.wall === 'west' ? cx - segment.x1 : segment.x1 - cx;
          return inward >= 0 && inward <= 160 && along >= w.offsetCm - 100 && along <= w.offsetCm + w.widthCm + 100;
        });
        if (!near) issue('prefer_desk_window', 'The desk is more than the demo near-window range from an opening. This preference does not block Apply.', [o.id], [], 'warning');
      }
    }
    if (o.kind === 'bed') {
      const depth = rules.bedLongSideAccessCm, bands = bedAccessBands(o, depth, 60, unit);
      const vertical = opposite[faces[o.rotation]] === 'north' || opposite[faces[o.rotation]] === 'south';
      const valid = bands.filter(({ rect }) => rectInsideRoom(room, rect) && (vertical ? rect.d : rect.w) >= 100 && occupants(rectCells(rect, unit)).length === 0);
      for (const band of bands) flag(rectCells(band.rect, unit).filter(c => lookup.has(key(c))), valid.some(v => v.side === band.side) ? 'bed_long_side_candidate' : 'bed_long_side_blocked');
      // Keep both candidate bands in the report. Invalid/occupied bands render
      // as red unreachable chips instead of vanishing from the room review.
      bands.forEach(({ side, rect }) => addZone(`bed:${o.id}:${side}`, o.id, `${o.label} ${side} entry`, rect, true, 'bed_side_entry', false));
      const validSides = new Set(valid.map(v => v.side));
      const reachable = zones.filter(z => z.objectId === o.id && z.purpose === 'bed_side_entry' && z.reachable && validSides.has(z.id.endsWith(':left') ? 'left' : 'right'));
      if (!valid.length) issue('bed_access_blocked', `Keep a 100 cm entry segment on one long bed side at ${depth} cm depth. A maximum 60 cm head-end bedside segment is excluded.`, [o.id], bands.flatMap(r => rectCells(r.rect, unit)), 'block', ['bed_long_side_blocked']);
      else if (!reachable.length) { flag(valid.flatMap(v => rectCells(v.rect, unit)), 'bed_long_side_unreachable'); issue('path_broken', `The bed-side entry exists, but no ${rules.walkHardCm} cm walking footprint reaches it.`, [o.id], [], 'block', ['bed_long_side_unreachable']); }
      else { flag(reachable.flatMap(z => z.cells), 'bed_long_side_clear'); if (reachable.length < 2) issue('prefer_bed_two_sides', 'A second reachable bed side is preferred when the room permits it.', [o.id], [], 'warning', ['bed_long_side_blocked']); }
    }
  }
  for (const w of room.openings) if (w.kind === 'window' && w.windowAccess) addZone(`window:${w.id}`, w.id, 'Requested window access', wallBand(room, w.wall, w.offsetCm, w.widthCm, hardSize * unit, w.segmentId));
  for (const tv of layout.furniture.filter(o => o.kind === 'tv')) {
    if (!tv.wallAnchor) { issue('tv_unassociated', 'A TV must have a wall anchor and a target sofa.', [tv.id]); continue; }
    const { wall, offsetCm, segmentId } = tv.wallAnchor, segment = resolveWallSegment(room, tv.wallAnchor);
    if (!segment || offsetCm < 0 || offsetCm + tv.sizeCm.w > segment.lengthCm) issue('out_of_room', 'The TV extends beyond its wall segment. Adjust its wall anchor.', [tv.id]);
    const sameSurface = (anchor: { wall: Wall; segmentId?: string }) => room.floorPlan ? anchor.segmentId === segmentId : anchor.wall === wall;
    const wallIntervals: { id: string; offset: number; width: number; low: number; high: number }[] = room.openings.filter(w => sameSurface(w)).map(w => ({ id: w.id, offset: w.offsetCm, width: w.widthCm, low: w.kind === 'window' ? w.sillCm : 0, high: w.kind === 'window' ? w.headCm : rules.ceilingCm }));
    for (const other of all.filter(o => o.id !== tv.id && o.wallAnchor && sameSurface(o.wallAnchor))) wallIntervals.push({ id: other.id, offset: other.wallAnchor!.offsetCm, width: other.kind === 'radiator' ? (wall === 'east' || wall === 'west' ? bounds(other).d : bounds(other).w) : other.sizeCm.w, low: other.elevationCm, high: other.sizeCm.h === null ? rules.ceilingCm : other.elevationCm + other.sizeCm.h });
    for (const interval of wallIntervals) if (offsetCm < interval.offset + interval.width && offsetCm + tv.sizeCm.w > interval.offset && tv.elevationCm < interval.high && (tv.sizeCm.h === null || tv.elevationCm + tv.sizeCm.h > interval.low)) issue('wall_attachment_overlap', 'The TV overlaps another wall attachment in both wall position and height. Move its wall anchor.', [tv.id, interval.id]);
    const sofa = layout.furniture.find(o => o.id === tv.targetSofaId && o.kind === 'sofa');
    if (!sofa) { issue('tv_unassociated', 'Select a sofa for the wall TV in the inspector.', [tv.id]); continue; }
    if (faces[sofa.rotation] !== wall) issue('tv_facing_wrong', `The sofa must face the ${wall} TV wall. Rotate it using a quarter turn.`, [tv.id, sofa.id]);
    const b = bounds(sofa, unit), face = faces[sofa.rotation];
    const seating: Rect = face === 'north' ? { ...b, d: Math.min(unit, b.d) } : face === 'south' ? { ...b, y: b.y + b.d - unit, d: unit } : face === 'west' ? { ...b, w: unit } : { ...b, x: b.x + b.w - unit, w: unit };
    const seatCells = rectCells(seating, unit), seatSet = new Set(seatCells.map(key));
    const depth = !segment ? 0 : wall === 'north' ? seating.y + seating.d - segment.y1 : wall === 'south' ? segment.y1 - seating.y : wall === 'west' ? seating.x + seating.w - segment.x1 : segment.x1 - seating.x;
    const strip = rectCells(wallBand(room, wall, offsetCm, tv.sizeCm.w, Math.max(0, depth), segmentId), unit).filter(c => insideKeys.has(key(c))), stripSet = new Set(strip.map(key));
    const blockedCells: Cell[] = [], unknown: Cell[] = [];
    for (const c of strip) {
      const g = lookup.get(key(c))!;
      if (seatSet.has(key(c))) { flag([c], 'tv_seat'); continue; }
      if (g.heightClass === 'TALL') { blockedCells.push(c); flag([c], 'tv_blocked'); }
      else if (g.heightClass === 'UNKNOWN_HEIGHT') { unknown.push(c); flag([c], 'tv_unknown'); }
      else flag([c], 'tv_clear');
    }
    const insideSeats = seatCells.filter(c => stripSet.has(key(c))); flag(seatCells.filter(c => !stripSet.has(key(c))), 'tv_seat_out');
    if (blockedCells.length) issue('tv_blocked', `A tall object interrupts the full TV-width strip. Move it out of the strip or choose a named low variant.`, [tv.id, ...occupants(blockedCells)], blockedCells, 'block', ['tv_blocked']);
    if (unknown.length) issue('tv_unknown', 'An object in the TV strip has unknown height. Verify its height; the TV check fails closed.', [tv.id, ...occupants(unknown)], unknown, 'block', ['tv_unknown']);
    if (!insideSeats.length) issue('tv_no_seat', 'No sofa seating cell is inside the TV-width strip. Align the TV or sofa.', [tv.id, sofa.id], seatCells);
  }
  const profile = room.profile || { kind: 'lounge' as const };
  const effectiveKinds = profile.kind === 'lounge' ? rules.requiredKinds : rules.requiredKinds.filter(k => k !== 'sofa' && k !== 'tv');
  const requirements: BriefRequirement[] = effectiveKinds.map(kind => ({ key: `kind:${kind}`, label: kind.replace('_', ' '), quantity: 1, met: layout.furniture.some(o => o.kind === kind) ? 1 : 0, source: 'layout', required: true }));
  if (profile.kind === 'bedroom') {
    const wantedBed = `haven-${profile.sleeping}-${profile.sleeping === 'single' ? '100' : profile.sleeping === 'double' ? '140' : '160'}`;
    requirements.push({ key: 'bed:sleep-size', label: `${profile.sleeping} bed`, quantity: 1, met: layout.furniture.some(o => o.kind === 'bed' && (o.variantId === wantedBed || o.sleepSize === profile.sleeping || o.tags.includes(profile.sleeping))) ? 1 : 0, source: 'layout', required: true });
    const bedsideQuantity = Math.max(0, Math.min(2, profile.bedsideQuantity || 0));
    if (bedsideQuantity) requirements.push({ key: 'bedside', label: 'bedside table', quantity: bedsideQuantity, met: layout.furniture.filter(o => o.variantId === 'nook-bedside-40' || o.tags.includes('bedside')).length, source: 'layout', required: false });
    if (profile.storage) requirements.push({ key: 'wardrobe', label: 'wardrobe', quantity: 1, met: layout.furniture.filter(o => o.tags.includes('wardrobe') || o.tags.includes('clothes-storage')).length, source: 'layout', required: true });
  }
  if (profile.kind === 'home_office' || (profile.kind === 'bedroom' && profile.workspace)) {
    const desks = layout.furniture.filter(o => o.kind === 'desk');
    const linked = desks.filter(d => layout.furniture.some(c => c.kind === 'chair' && c.linkedDeskId === d.id));
    const relationshipQuantity = Math.max(1, desks.length);
    requirements.push({ key: 'desk-chair-link', label: 'desk with linked chair', quantity: relationshipQuantity, met: linked.length, source: 'relationship', required: true });
    if (linked.length < relationshipQuantity) {
      const desk = desks.find(d => !linked.some(l => l.id === d.id));
      const unlinkedChair = layout.furniture.find(o => o.kind === 'chair' && !o.linkedDeskId);
      const fix = desk && unlinkedChair
        ? { tool: 'findPlacements', args: { objectId: unlinkedChair.id, linkedDeskId: desk.id, limit: 1 }, summary: 'Find a checked position that links this chair to the desk.' }
        : desk ? { tool: 'findPlacements', args: { variantId: 'nest-chair-60', linkedDeskId: desk.id, limit: 1 }, summary: 'Find a checked chair placement for this desk, then place that candidate.' }
          : undefined;
      issue('desk_chair_missing', desks.length ? 'Each desk needs its own linked work chair.' : 'This workspace needs a desk and a linked work chair.', layout.furniture.filter(o => o.kind === 'desk' || o.kind === 'chair').map(o => o.id), [], 'block', [], fix);
    }
  }
  if (profile.kind === 'home_office') {
    if (profile.seating) requirements.push({ key: 'guest-chair', label: 'guest chair', quantity: 1, met: layout.furniture.filter(o => o.kind === 'chair' && !o.linkedDeskId).length, source: 'layout', required: false });
    if (profile.storage) requirements.push({ key: 'office-storage', label: 'office storage', quantity: 1, met: layout.furniture.filter(o => o.kind === 'storage' && (o.tags.includes('office-storage') || o.variantId === 'archive-tall-80')).length, source: 'layout', required: false });
  }
  if (profile.kind === 'bathroom_concept') for (const id of profile.fixtureIds) requirements.push({ key: `fixture:${id}`, label: `fixed concept fixture ${id}`, quantity: 1, met: room.fixtures.some(f => f.id === id) ? 1 : 0, source: 'fixed_fixture', required: true });
  // ---------------------------------------------------------------------
  // Relational and orientation rules offer a repair or bounded search. Direct
  // repairs are checked against the full engine below before being exposed.
  // Everything here is a warning or information except a linked chair
  // facing away from its desk, which is incoherent in the same way an
  // associated sofa facing away from its TV is.
  // ---------------------------------------------------------------------
  const ROT_FOR: Record<Wall, Rotation> = { south: 0, west: 90, north: 180, east: 270 };
  // A metre is about the point at which a blank wall stops being an outlook and
  // starts being a mistake, and a further metre behind the sofa proves a better
  // direction was available. Literal centimetres on purpose: keying either
  // distance to a rule constant would let setConstraints turn a preference into
  // noise across every lounge.
  const SOFA_OUTLOOK_CM = 100;
  const towards = (from: Furniture, to: Furniture): Wall => {
    const a = bounds(from, unit), t = bounds(to, unit);
    const dx = (t.x + t.w / 2) - (a.x + a.w / 2), dy = (t.y + t.d / 2) - (a.y + a.d / 2);
    return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'east' : 'west') : (dy > 0 ? 'south' : 'north');
  };
  // A fix is only useful if it is safe to apply blind. Computed moves are
  // collision-tested first: a centring nudge that would push a piece into the
  // very object it is aligning to must not be handed to an agent as an answer.
  // Anything that would clash falls back to an engine-checked search.
  const moveFix = (o: Furniture, x: number, y: number, summary: string) => {
    const b = bounds(o, unit);
    const t = { x: Math.round(x / unit) * unit, y: Math.round(y / unit) * unit, w: b.w, d: b.d };
    const inRoom = rectInsideRoom(room, t);
    const clashes = isSolid(o) && all.some(f => {
      if (f.id === o.id || !isSolid(f)) return false;
      const a = bounds(f, unit);
      return a.x < t.x + t.w && a.x + a.w > t.x && a.y < t.y + t.d && a.y + a.d > t.y;
    });
    return inRoom && !clashes
      ? { tool: 'updateFurniture', args: { objectId: o.id, originCell: { x: t.x / unit, y: t.y / unit } }, summary }
      : { tool: 'findPlacements', args: { objectId: o.id }, summary: `${summary} — needs a checked placement` };
  };
  const turnFix = (o: Furniture, wall: Wall, summary: string) => ({ tool: 'updateFurniture', args: { objectId: o.id, rotation: ROT_FOR[wall] }, summary });
  const backToWallFix = (o: Furniture, wall: Wall, summary: string) => {
    const rotation = rotations.find(r => furnitureBackWall({ ...o, rotation: r }) === wall)!;
    return { tool: 'updateFurniture', args: { objectId: o.id, rotation }, summary };
  };

  for (const o of layout.furniture) {
    const b = bounds(o, unit), g = wallGaps(o, room, unit), back = furnitureBackWall(o);
    const isBedside = o.tags.includes('bedside');

    // A linked chair must face the desk it belongs to.
    if (o.kind === 'chair' && o.linkedDeskId) {
      const desk = layout.furniture.find(d => d.id === o.linkedDeskId);
      if (desk) {
        const want = towards(o, desk);
        const pull = frontBand(desk, rules.chairPullCm, unit);
        if (!overlaps(b, pull)) issue('chair_desk_distance', `${o.label} is linked to ${desk.label} but does not occupy its ${rules.chairPullCm} cm chair-pull zone. Move the chair to the desk.`, [o.id, desk.id], rectCells(pull, unit), 'block', ['chair_pull_blocked'], { tool: 'findPlacements', args: { objectId: o.id, linkedDeskId: desk.id }, summary: 'Search for a checked position in the desk pull zone' });
        if (faces[o.rotation] !== want) issue('chair_facing_wrong', `${o.label} is linked to ${desk.label} but faces ${faces[o.rotation]}. Turn it to face ${want}.`, [o.id, desk.id], [], 'block', [], turnFix(o, want, `Rotate to face ${want}`));
        const db = bounds(desk, unit), across = want === 'north' || want === 'south';
        const off = across ? Math.abs((b.x + b.w / 2) - (db.x + db.w / 2)) : Math.abs((b.y + b.d / 2) - (db.y + db.d / 2));
        const span = across ? db.w : db.d;
        if (faces[o.rotation] === want && off > span / 3) issue('chair_desk_offset', `${o.label} sits ${Math.round(off)} cm off the centre of ${desk.label}. Centre it on the desk.`, [o.id, desk.id], [], 'warning', [], moveFix(o, across ? db.x + db.w / 2 - b.w / 2 : b.x, across ? b.y : db.y + db.d / 2 - b.d / 2, 'Align with the desk centre'));
      }
    }

    // A sofa looking at a near blank wall with the room behind it is turned the
    // wrong way round. The ordinary lounge is the opposite case — backed to a
    // wall, looking across the floor at a rug — and stays quiet, as does a
    // deliberate outlook: an opening or a TV on the wall it faces. Anything
    // closer than the hard walking width already fails as path_broken.
    if (o.kind === 'sofa') {
      const front = faces[o.rotation], horizontal = front === 'north' || front === 'south';
      const start = horizontal ? b.x : b.y, end = horizontal ? b.x + b.w : b.y + b.d;
      const spans = (anchor: { wall: Wall; segmentId?: string; offsetCm: number }, width: number) => {
        const segment = resolveWallSegment(room, anchor); if (!segment) return false;
        const offset = (horizontal ? segment.x1 : segment.y1) + anchor.offsetCm;
        return offset < end && offset + width > start;
      };
      const outlook = room.openings.some(w => w.wall === front && spans(w, w.widthCm))
        || layout.furniture.some(t => t.kind === 'tv' && t.wallAnchor?.wall === front && spans(t.wallAnchor, t.sizeCm.w));
      if (!outlook && g[front] >= 0 && g[front] <= SOFA_OUTLOOK_CM && g[back] - g[front] >= SOFA_OUTLOOK_CM) issue('prefer_sofa_into_room', `${o.label} looks at a blank ${front} wall ${Math.round(g[front])} cm away, with ${Math.round(g[back])} cm of room behind it. Turn it to face into the room.`, [o.id], [], 'warning', [], turnFix(o, back, `Turn it to face the ${back} side of the room`));
    }

    // Storage, wardrobes and beds have a back that belongs against something.
    if (wantsWallBacking(o, unit)) {
      if (g[back] > 5) {
        const touching = WALLS.find(w => w !== back && g[w] <= 5);
        const label = o.kind === 'bed' && (o.backEdge || 'north') === 'north' ? 'headboard' : 'back';
        const code = o.kind === 'bed' ? 'bed_head_wall' : touching ? 'side_against_wall' : 'prefer_wall_backing';
        const message = touching ? `Only the side of ${o.label} touches the ${touching} wall; its ${label} faces ${back}. Turn its ${label} to the wall.` : `The ${label} of ${o.label} is ${Math.round(g[back])} cm from the ${back} wall, so it stands free in the room.`;
        issue(code, message, [o.id], [], 'warning', [], touching ? backToWallFix(o, touching, `Turn its ${label} to the ${touching} wall`) : { tool: 'findPlacements', args: { objectId: o.id }, summary: 'Search for a wall-backed placement' });
      }
    }

    // A near miss reads as a mistake; flush or clearly away is intentional.
    if (!isBedside && o.kind !== 'rug') {
      const near = (Object.keys(g) as Wall[]).filter(w => g[w] > 0 && g[w] <= 25).sort((a, c) => g[a] - g[c])[0];
      if (near) issue('prefer_flush_to_wall', `${o.label} sits ${Math.round(g[near])} cm from the ${near} wall — close enough to look unintended.`, [o.id], [], 'warning', [], room.floorPlan ? { tool: 'findPlacements', args: { objectId: o.id }, summary: `Find a checked flush placement on a ${near}-facing segment` } : moveFix(o, near === 'west' ? 0 : near === 'east' ? room.widthCm - b.w : b.x, near === 'north' ? 0 : near === 'south' ? room.depthCm - b.d : b.y, `Push flush to the ${near} wall`));
    }

    // A bedside table belongs beside the head of a bed, not merely near it.
    if (isBedside) {
      const bed = layout.furniture.find(f => f.kind === 'bed');
      if (bed) {
        const bb = bounds(bed, unit), head = opposite[faces[bed.rotation]];
        const vertical = head === 'north' || head === 'south';
        const alongHead = vertical ? Math.abs((b.y + b.d / 2) - (head === 'north' ? bb.y : bb.y + bb.d)) : Math.abs((b.x + b.w / 2) - (head === 'west' ? bb.x : bb.x + bb.w));
        const beside = vertical ? (b.x + b.w <= bb.x + 20 || b.x >= bb.x + bb.w - 20) : (b.y + b.d <= bb.y + 20 || b.y >= bb.y + bb.d - 20);
        if (alongHead > bb.d && !vertical ? false : alongHead > (vertical ? bb.d : bb.w) / 2 || !beside) issue('bedside_flanks_head', `${o.label} is not beside the head of ${bed.label}.`, [o.id, bed.id], [], 'warning', [], { tool: 'findPlacements', args: { objectId: o.id }, summary: 'Search for a placement beside the bed head' });
      }
    }

    // A rug that touches nothing is a floor decal.
    if (o.kind === 'rug') {
      const anchors = layout.furniture.filter(f => f.kind === 'sofa' || f.kind === 'bed');
      const overlaps = anchors.some(f => { const a = bounds(f, unit); return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.d && a.y + a.d > b.y; });
      if (anchors.length && !overlaps) issue('rug_under_group', `${o.label} does not sit under the seating or bed.`, [o.id, ...anchors.map(a => a.id)], [], 'info', [], { tool: 'findPlacements', args: { objectId: o.id }, summary: 'Search for a placement under the group' });
    }

    // A coffee table belongs centred in the sofa's facing half-plane, with a
    // usable hand/leg gap. Only this relationship earns the frontage exemption.
    if (o.kind === 'coffee_table') {
      const related = layout.furniture.filter(f => f.kind === 'sofa').map(sofa => ({ sofa, relation: sofaTableRelation(sofa, o, unit) })).sort((a, c) => Number(c.relation.inFront && c.relation.lateralOverlap) - Number(a.relation.inFront && a.relation.lateralOverlap) || Math.abs(a.relation.gapCm - 50) - Math.abs(c.relation.gapCm - 50))[0];
      const sofa = related?.sofa;
      if (sofa) {
        const sb = bounds(sofa, unit), face = faces[sofa.rotation], across = face === 'north' || face === 'south', relation = related.relation;
        if (!relation.inFront || !relation.lateralOverlap) issue('coffee_table_position', `${o.label} is not in front of ${sofa.label}. Place it in the sofa's ${face} facing half-plane.`, [o.id, sofa.id], [], 'warning', [], { tool: 'findPlacements', args: { objectId: o.id }, summary: 'Search for a checked placement in front of the sofa' });
        else if (relation.gapCm < COFFEE_TABLE_GAP_MIN_CM || relation.gapCm > COFFEE_TABLE_GAP_MAX_CM) issue('coffee_table_gap', `${o.label} is ${Math.round(relation.gapCm)} cm from ${sofa.label}; keep a ${COFFEE_TABLE_GAP_MIN_CM}–${COFFEE_TABLE_GAP_MAX_CM} cm edge gap.`, [o.id, sofa.id], [], 'warning', [], { tool: 'findPlacements', args: { objectId: o.id }, summary: 'Search for a checked sofa-table gap' });
        if (relation.offsetCm > (across ? sb.w : sb.d) / 3) issue('table_centred_on_sofa', `${o.label} is ${Math.round(relation.offsetCm)} cm off the centre of ${sofa.label}.`, [o.id, sofa.id], [], 'warning', [], moveFix(o, across ? sb.x + sb.w / 2 - b.w / 2 : b.x, across ? b.y : sb.y + sb.d / 2 - b.d / 2, 'Centre it on the sofa'));
      }
    }

    if (o.tags.includes('all-side-clearance')) {
      const depth = rules.chairPullCm, outer = { x: b.x - depth, y: b.y - depth, w: b.w + depth * 2, d: b.d + depth * 2 };
      const ring = rectCells(outer, unit).filter(c => !rectCells(b, unit).some(own => own.x === c.x && own.y === c.y));
      const ids = occupants(ring, [o.id]), clipped = !rectInsideRoom(room, outer);
      if (ids.length || clipped) issue('meeting_table_clearance', `${o.label} needs ${depth} cm of chair space on every side.`, [o.id, ...ids], ring.filter(c => lookup.has(key(c))), 'warning', ['chair_pull_blocked'], { tool: 'findPlacements', args: { objectId: o.id }, summary: 'Search for all-side meeting-table clearance' });
    }
  }

  // Furniture bunched into one end of a long room passes every hard rule and
  // still reads as wrong. Flag it when a big contiguous void survives.
  if (layout.furniture.length >= 3) {
    const voidM2 = largestEmptyRectangle(columns, rows, blocked, unit), roomM2 = floorAreaM2(room);
    if (voidM2 > roomM2 * 0.45) issue('prefer_even_distribution', `${voidM2.toFixed(1)} m² of the ${roomM2.toFixed(1)} m² floor is one empty block; the furniture is bunched into part of the room.`, layout.furniture.map(f => f.id), [], 'info', [], { tool: 'proposeLayout', args: {}, summary: 'Re-plan to spread the pieces' });
  }

  const missingRequired = [ ...requirements.filter(r => r.required && r.met < r.quantity).map(r => r.key), ...inventory.filter(o => o.requiredInRoom && !layout.furniture.some(f => f.id === o.id)).map(o => o.id) ];
  if (rules.requiredKinds.includes('tv') && layout.furniture.some(o => o.kind === 'tv') && !layout.furniture.some(o => o.kind === 'tv' && o.targetSofaId && layout.furniture.some(s => s.id === o.targetSofaId && s.kind === 'sofa'))) missingRequired.push('tv:sofa-association');
  const hardFailures = issues.filter(i => i.severity === 'block').length;
  const openFloorM2 = largestEmptyRectangle(columns, rows, blocked, unit);
  if (rules.openFloorM2 > 0 && openFloorM2 < rules.openFloorM2) issue('prefer_open_floor', `The largest empty grid rectangle is ${openFloorM2.toFixed(2)} m²; your preference is ${rules.openFloorM2} m².`, [], [], 'warning');
  const flagsSummary: Record<string, number> = {}; cells.forEach(c => c.flags.forEach(f => { flagsSummary[f] = (flagsSummary[f] || 0) + 1; }));
  const finalWarnings = issues.filter(i => i.severity === 'warning').length;
  const conceptualOnly = profile.kind === 'bathroom_concept' || all.some(o => o.conceptualOnly);
  // A repair must obey the complete engine, not just an unrotated AABB. Disable
  // repair construction in the hypothetical report to keep this non-recursive.
  if (includeFixes) {
    const signature = (i: Issue) => `${i.code}|${[...i.objectIds].sort().join(',')}|${i.cells.map(key).sort().join(';')}`;
    const existingBlocks = new Set(issues.filter(i => i.severity === 'block').map(signature));
    for (const item of issues) {
      if (item.fix?.tool !== 'updateFurniture') continue;
      const object = layout.furniture.find(o => o.id === item.fix!.args.objectId);
      if (!object) { delete item.fix; continue; }
      const source = object.ownership === 'owned' ? inventory.find(o => o.id === object.id) : object;
      const patch = item.fix.args as { originCell?: Cell; rotation?: Rotation; linkedDeskId?: string };
      if (!source || source.ownership === 'fixed'
        || (source.locked.position && patch.originCell && (patch.originCell.x !== source.originCell.x || patch.originCell.y !== source.originCell.y))
        || (source.locked.rotation && patch.rotation !== undefined && patch.rotation !== source.rotation)) { delete item.fix; continue; }
      const placed = { ...object, ...(patch.originCell ? { originCell: patch.originCell } : {}), ...(patch.rotation !== undefined ? { rotation: patch.rotation } : {}), ...(patch.linkedDeskId !== undefined ? { linkedDeskId: patch.linkedDeskId } : {}) };
      const hypothetical = validate({ ...layout, furniture: layout.furniture.map(o => o.id === object.id ? placed : o) }, room, rules, inventory, false);
      const unresolved = hypothetical.issues.some(i => i.code === item.code && i.objectIds.includes(object.id));
      const newBlock = hypothetical.issues.some(i => i.severity === 'block' && !existingBlocks.has(signature(i)));
      const missing = hypothetical.brief.missingRequired.some(id => !missingRequired.includes(id));
      if (unresolved || newBlock || missing) item.fix = { tool: 'findPlacements', args: { objectId: object.id }, summary: 'Search for a checked alternative; the direct repair is not safe or does not resolve this issue.' };
    }
  }
  return { validation: { status: hardFailures ? 'blocked' : finalWarnings ? 'warnings' : 'ok', hardFailures, warnings: finalWarnings }, brief: { status: missingRequired.length ? 'incomplete' : 'satisfied', missingRequired, requirements }, issues, cells, zones, columns, rows, flagsSummary, checkedRules, clearances: { hardRequestedCm: rules.walkHardCm, hardEffectiveCm: hardSize * unit, preferredRequestedCm: rules.walkPreferredCm, preferredEffectiveCm: preferredSize * unit }, openFloorM2, ...(conceptualOnly ? { conceptualOnly: true } : {}) };
}
