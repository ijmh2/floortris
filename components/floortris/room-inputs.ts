import { clone, type AppState, type Furniture, type Room, type Rules, type Wall } from './model.ts';
import { openingSchema, TOOL_SCHEMAS, validateSchema } from './schemas.ts';

export const walls: Wall[] = ['north', 'east', 'south', 'west'];
export const horizontalWall = (wall: Wall) => wall === 'north' || wall === 'south';
export const wallLength = (room: Room, wall: Wall) => horizontalWall(wall) ? room.widthCm : room.depthCm;
export const roomEditStamp = (s: AppState) => `${s.currentRevision}:${s.ruleRevision}:${s.proposal?.id || ''}:${s.proposal?.revision || 0}`;
export const radiatorMeasures = (f: Furniture) => ({ width: horizontalWall(f.wallAnchor?.wall || 'east') ? f.sizeCm.w : f.sizeCm.d, depth: horizontalWall(f.wallAnchor?.wall || 'east') ? f.sizeCm.d : f.sizeCm.w });

/** A fixed fixture keeps its exact measured floor projection, even between grid lines. */
export function radiatorOnWall(f: Furniture, room: Room, wall: Wall, offsetCm: number, width: number, depth: number, height: number): Furniture {
  const horizontal = horizontalWall(wall);
  return { ...clone(f), ownership: 'fixed', kind: 'radiator', rotation: 0, elevationCm: 0,
    sizeCm: { w: horizontal ? width : depth, d: horizontal ? depth : width, h: height },
    originCell: { x: (horizontal ? offsetCm : wall === 'east' ? room.widthCm - depth : 0) / 20, y: (horizontal ? wall === 'south' ? room.depthCm - depth : 0 : offsetCm) / 20 },
    wallAnchor: { wall, offsetCm } };
}

/** Structural input checks only. Furniture conflicts remain visible engine issues. */
export function validateRoomInputs(room: Room, rules: Rules): string | null {
  const geometry = validateSchema({ proposalId: 'human', revision: 1, name: room.name, widthCm: room.widthCm, depthCm: room.depthCm }, TOOL_SCHEMAS.setRoomGeometry.inputSchema);
  if (geometry) return `Room: ${geometry}`;
  if (!room.name.trim()) return 'Give the room a name.';
  const { cellCm, ...constraints } = rules;
  if (cellCm !== 20) return 'The grid must remain 20 cm.';
  const ruleError = validateSchema({ proposalId: 'human', revision: 1, constraints }, TOOL_SCHEMAS.setConstraints.inputSchema);
  if (ruleError) return `Assumptions: ${ruleError}`;
  if (rules.walkPreferredCm < rules.walkHardCm) return 'Preferred walking width must be at least the hard minimum.';
  if (room.openings.length > 12 || room.fixtures.length > 12) return 'Use at most 12 openings and 12 fixed fixtures.';
  const ids = [...room.openings, ...room.fixtures].map(o => o.id);
  if (ids.some(id => !id || id.length > 100) || new Set(ids).size !== ids.length) return 'Room features need unique IDs.';
  if (room.openingLocks?.some(id => !room.openings.some(o => o.id === id))) return 'An opening pin refers to a removed feature.';
  if (!room.openings.some(o => o.kind === 'door' && o.entrance)) return 'Mark at least one door as an entrance for the footpath check.';
  for (const o of room.openings) {
    const error = validateSchema(o, openingSchema); if (error) return `${o.id}: ${error}`;
    if (o.offsetCm + o.widthCm > wallLength(room, o.wall)) return `${o.id} extends beyond the ${o.wall} wall.`;
    if (o.kind === 'window' && (o.headCm <= o.sillCm || o.headCm > rules.ceilingCm)) return `${o.id}: window head must be above the sill and at or below the ceiling.`;
  }
  for (const f of room.fixtures) {
    if (f.ownership !== 'fixed') return `${f.label}: room fixtures must be fixed.`;
    if (!f.label.trim() || ![f.sizeCm.w, f.sizeCm.d].every(n => Number.isFinite(n) && n > 0 && n <= 1000) || f.sizeCm.h === null || !Number.isFinite(f.sizeCm.h) || f.sizeCm.h <= 0 || f.sizeCm.h > rules.ceilingCm) return `${f.label}: enter positive measured dimensions within the room height.`;
    if (f.kind !== 'radiator') continue;
    if (!f.wallAnchor || !walls.includes(f.wallAnchor.wall) || !Number.isFinite(f.wallAnchor.offsetCm) || f.wallAnchor.offsetCm < 0) return `${f.label}: choose a wall and non-negative offset.`;
    const m = radiatorMeasures(f), canonical = radiatorOnWall(f, room, f.wallAnchor.wall, f.wallAnchor.offsetCm, m.width, m.depth, f.sizeCm.h);
    if (f.wallAnchor.offsetCm + m.width > wallLength(room, f.wallAnchor.wall) || m.depth > wallLength(room, horizontalWall(f.wallAnchor.wall) ? 'east' : 'north')) return `${f.label} extends beyond the room.`;
    if (f.rotation !== 0 || f.elevationCm !== 0 || f.originCell.x !== canonical.originCell.x || f.originCell.y !== canonical.originCell.y) return `${f.label} no longer touches its wall. Unpin it and reselect its wall after resizing the room.`;
  }
  return null;
}
