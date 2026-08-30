import { resolveWallSegment, wallRect } from './floorplan.ts';
import type { Furniture, Layout, Room, Rules, WindowOpening } from './model.ts';

export const NON_FLOOR_KINDS = new Set<Furniture['kind']>(['window_treatment', 'ceiling_light', 'wall_light', 'table_lamp', 'tv', 'rug']);
export const LIGHT_KINDS = new Set<Furniture['kind']>(['ceiling_light', 'wall_light', 'floor_lamp', 'table_lamp']);
export const isFloorOccupant = (item: Furniture) => !NON_FLOOR_KINDS.has(item.kind);
export const isWallMounted = (item: Furniture) => item.kind === 'tv' || item.kind === 'wall_light' || item.kind === 'window_treatment';
export const canSupportLamp = (item: Furniture) => item.kind === 'table' || item.kind === 'coffee_table' || item.kind === 'desk' || item.kind === 'storage';
const bounds = (item: Furniture, unit = 20) => { const turned = item.rotation === 90 || item.rotation === 270; return { x: item.originCell.x * unit, y: item.originCell.y * unit, w: turned ? item.sizeCm.d : item.sizeCm.w, d: turned ? item.sizeCm.w : item.sizeCm.d }; };

/** Keep semantic fixtures attached to the measured object/surface they name.
 * This is document geometry only: no electrical, installation or fabric claim. */
export function normalizeFixturePlacement(item: Furniture, room: Room, rules: Rules, layout: Layout, recenterSupport = false): Furniture {
  const next = structuredClone(item);
  if (next.kind === 'window_treatment' && next.attachedOpeningId) {
    const opening = room.openings.find((o): o is WindowOpening => o.id === next.attachedOpeningId && o.kind === 'window');
    if (opening) {
      const segment = resolveWallSegment(room, opening);
      if (segment) {
        const curtains = next.fixtureType === 'curtains', desired = opening.widthCm + (curtains ? 40 : 0);
        const width = Math.min(segment.lengthCm, desired), offsetCm = Math.max(0, Math.min(segment.lengthCm - width, opening.offsetCm - (width - opening.widthCm) / 2));
        next.wallAnchor = { wall: opening.wall, offsetCm, ...(opening.segmentId ? { segmentId: opening.segmentId } : {}) };
        next.sizeCm = { w: width, d: curtains ? 15 : 2, h: curtains ? opening.headCm : opening.headCm - opening.sillCm };
        next.elevationCm = curtains ? 0 : opening.sillCm;
      }
    }
  }
  if (next.kind === 'ceiling_light') next.elevationCm = Math.max(0, rules.ceilingCm - (next.sizeCm.h || 0));
  // A new sconce has a usable, visible design default. An explicitly measured
  // non-zero height remains authoritative and is checked by the engine.
  if (next.kind === 'wall_light' && next.elevationCm === 0) next.elevationCm = 160;
  if (next.kind === 'table_lamp' && next.supportObjectId && recenterSupport) {
    const support = layout.furniture.find(o => o.id === next.supportObjectId && canSupportLamp(o));
    if (support) {
      const b = bounds(support, rules.cellCm), own = bounds(next, rules.cellCm);
      next.originCell = { x: (b.x + b.w / 2 - own.w / 2) / rules.cellCm, y: (b.y + b.d / 2 - own.d / 2) / rules.cellCm };
      next.rotation = 0;
      next.elevationCm = support.elevationCm + (support.sizeCm.h || 0);
    }
  }
  if (isWallMounted(next) && next.wallAnchor) {
    const projection = wallRect(room, next.wallAnchor, next.sizeCm.w, Math.max(.5, next.sizeCm.d));
    if (projection) next.originCell = { x: projection.x / rules.cellCm, y: projection.y / rules.cellCm };
  }
  return next;
}
