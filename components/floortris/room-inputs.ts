import { clone, type AppState, type Furniture, type Room, type RoomProfile, type Rules, type Wall } from './model.ts';
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

const conceptKinds = new Set(['basin', 'toilet', 'shower', 'bath', 'towel_rail']);
const accessFixtureKinds = new Set(['basin', 'toilet', 'shower', 'bath']);
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
const positive = (value: unknown, max = 1000) => finite(value) && (value as number) > 0 && (value as number) <= max;
const intersects = (a: { x: number; y: number; w: number; d: number }, b: { x: number; y: number; w: number; d: number }) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.d && a.y + a.d > b.y;

function profileError(profile: RoomProfile | undefined, fixtures: Furniture[]) {
  if (profile === undefined) return null; // V1 documents migrate as lounge before staging.
  if (!profile || typeof profile !== 'object' || !('kind' in profile)) return 'Choose a supported room purpose.';
  if (profile.kind === 'lounge') return null;
  if (profile.kind === 'bedroom') {
    if (!['single', 'double', 'king'].includes(profile.sleeping) || typeof profile.workspace !== 'boolean' || typeof profile.storage !== 'boolean') return 'Bedroom profile needs a sleep size and workspace/storage choices.';
    if (profile.bedsideQuantity !== undefined && (!Number.isInteger(profile.bedsideQuantity) || profile.bedsideQuantity < 0 || profile.bedsideQuantity > 2)) return 'Bedroom bedside quantity must be 0, 1, or 2.';
    return null;
  }
  if (profile.kind === 'home_office') return typeof profile.seating === 'boolean' && typeof profile.storage === 'boolean' ? null : 'Home office profile needs seating and storage choices.';
  if (profile.kind === 'bathroom_concept') {
    if (profile.conceptualOnly !== true || !Array.isArray(profile.fixtureIds) || profile.fixtureIds.length > 12 || profile.fixtureIds.some(id => typeof id !== 'string' || !id || id.length > 100) || new Set(profile.fixtureIds).size !== profile.fixtureIds.length) return 'Bathroom concepts need unique fixed fixture IDs and the conceptual-only marker.';
    if (profile.fixtureIds.some(id => !fixtures.some(f => f.id === id && conceptKinds.has(f.kind) && f.conceptualOnly === true))) return 'Each bathroom fixture ID must refer to a concept fixture in this room.';
    return null;
  }
  return 'Choose a supported room purpose.';
}

function fixtureError(f: Furniture, room: Room, rules: Rules) {
  if (f.ownership !== 'fixed') return `${f.label}: room fixtures must be fixed.`;
  if (!f.label || typeof f.label !== 'string' || !f.label.trim() || !f.sizeCm || !positive(f.sizeCm.w) || !positive(f.sizeCm.d) || f.sizeCm.h === null || !positive(f.sizeCm.h, rules.ceilingCm)) return `${f.label || 'Fixture'}: enter positive measured dimensions within the room height.`;
  if (!f.originCell || !finite(f.originCell.x) || !finite(f.originCell.y) || ![0, 90, 180, 270].includes(f.rotation) || !finite(f.elevationCm) || f.elevationCm !== 0) return `${f.label}: use a finite floor position, quarter-turn rotation, and zero elevation.`;
  if (!f.locked || typeof f.locked !== 'object' || Object.keys(f.locked).some(key => !['position', 'size', 'rotation', 'appearance'].includes(key)) || Object.values(f.locked).some(value => value !== undefined && typeof value !== 'boolean')) return `${f.label}: fixed fixtures need boolean lock metadata.`;
  if (f.kind === 'radiator') return null;
  if (!conceptKinds.has(f.kind)) return `${f.label}: unsupported fixed fixture kind.`;
  if (f.conceptualOnly !== true) return `${f.label}: concept fixtures require the conceptual-only marker.`;
  const turned = f.rotation === 90 || f.rotation === 270, footprint = { x: f.originCell.x * 20, y: f.originCell.y * 20, w: turned ? f.sizeCm.d : f.sizeCm.w, d: turned ? f.sizeCm.w : f.sizeCm.d };
  if (footprint.x < 0 || footprint.y < 0 || footprint.x + footprint.w > room.widthCm || footprint.y + footprint.d > room.depthCm) return `${f.label} extends beyond the room.`;
  if (f.wallAnchor) {
    const { wall, offsetCm } = f.wallAnchor;
    if (!walls.includes(wall) || !finite(offsetCm) || offsetCm < 0) return `${f.label}: choose a wall and non-negative anchor offset.`;
    const expectedRotation = ({ north: 0, east: 90, south: 180, west: 270 } as const)[wall];
    const expected = { x: (wall === 'east' ? room.widthCm - footprint.w : wall === 'west' ? 0 : offsetCm) / 20, y: (wall === 'south' ? room.depthCm - footprint.d : wall === 'north' ? 0 : offsetCm) / 20 };
    const along = horizontalWall(wall) ? footprint.w : footprint.d;
    if (offsetCm + along > wallLength(room, wall) || f.rotation !== expectedRotation || f.originCell.x !== expected.x || f.originCell.y !== expected.y) return `${f.label} no longer matches its wall anchor. Clear the anchor for a free pose or reselect the wall.`;
  }
  if (accessFixtureKinds.has(f.kind)) {
    const c = f.clearance;
    if (!c || typeof c.label !== 'string' || !c.label.trim() || !c.rect || !positive(c.rect.w) || !positive(c.rect.d) || !finite(c.rect.x) || !finite(c.rect.y)) return `${f.label}: add a finite labelled concept approach zone.`;
    if (c.rect.x < 0 || c.rect.y < 0 || c.rect.x + c.rect.w > room.widthCm || c.rect.y + c.rect.d > room.depthCm) return `${f.label}: concept approach extends beyond the room.`;
    if (intersects(footprint, c.rect)) return `${f.label}: concept approach must stay outside its solid fixture footprint.`;
  } else if (f.clearance !== undefined) return `${f.label}: towel rails do not use an automatic concept approach zone.`;
  return null;
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
  if (ids.some(id => typeof id !== 'string' || !id || id.length > 100) || new Set(ids).size !== ids.length) return 'Room features need unique IDs.';
  if (room.openingLocks?.some(id => !room.openings.some(o => o.id === id))) return 'An opening pin refers to a removed feature.';
  const profileValidation = profileError(room.profile, room.fixtures); if (profileValidation) return profileValidation;
  if (!room.openings.some(o => o.kind === 'door' && o.entrance)) return 'Mark at least one door as an entrance for the footpath check.';
  for (const o of room.openings) {
    const error = validateSchema(o, openingSchema); if (error) return `${o.id}: ${error}`;
    if (o.offsetCm + o.widthCm > wallLength(room, o.wall)) return `${o.id} extends beyond the ${o.wall} wall.`;
    if (o.kind === 'window' && (o.headCm <= o.sillCm || o.headCm > rules.ceilingCm)) return `${o.id}: window head must be above the sill and at or below the ceiling.`;
  }
  for (const f of room.fixtures) {
    const structural = fixtureError(f, room, rules); if (structural) return structural;
    if (f.kind !== 'radiator') continue;
    if (!f.wallAnchor || !walls.includes(f.wallAnchor.wall) || !Number.isFinite(f.wallAnchor.offsetCm) || f.wallAnchor.offsetCm < 0) return `${f.label}: choose a wall and non-negative offset.`;
    const m = radiatorMeasures(f), canonical = radiatorOnWall(f, room, f.wallAnchor.wall, f.wallAnchor.offsetCm, m.width, m.depth, f.sizeCm.h!);
    if (f.wallAnchor.offsetCm + m.width > wallLength(room, f.wallAnchor.wall) || m.depth > wallLength(room, horizontalWall(f.wallAnchor.wall) ? 'east' : 'north')) return `${f.label} extends beyond the room.`;
    if (f.rotation !== 0 || f.elevationCm !== 0 || f.originCell.x !== canonical.originCell.x || f.originCell.y !== canonical.originCell.y) return `${f.label} no longer touches its wall. Unpin it and reselect its wall after resizing the room.`;
  }
  return null;
}
