import { faces, opposite, type Furniture, type Rect, type Rotation, type SectionalGeometry, type SectionalModule, type Wall } from './model.ts';

export const SECTIONAL_MODULE_TYPES = ['seat', 'corner', 'chaise'] as const;
export const SECTIONAL_MAX_MODULES = 12;
const EPS = 1e-6;
const finite = (n: number) => Number.isFinite(n);
const positiveOverlap = (a1: number, a2: number, b1: number, b2: number) => Math.min(a2, b2) - Math.max(a1, b1) > EPS;

export function moduleRect(module: SectionalModule): Rect {
  return { x: module.xCm, y: module.yCm, w: module.widthCm, d: module.depthCm };
}
export function sectionalEnvelope(geometry: SectionalGeometry): { w: number; d: number; h: number } {
  return {
    w: Math.max(...geometry.modules.map(module => module.xCm + module.widthCm)),
    d: Math.max(...geometry.modules.map(module => module.yCm + module.depthCm)),
    h: Math.max(...geometry.modules.map(module => module.heightCm)),
  };
}
export function modulesShareEdge(a: SectionalModule, b: SectionalModule): boolean {
  const ar = moduleRect(a), br = moduleRect(b);
  const vertical = (Math.abs(ar.x + ar.w - br.x) <= EPS || Math.abs(br.x + br.w - ar.x) <= EPS) && positiveOverlap(ar.y, ar.y + ar.d, br.y, br.y + br.d);
  const horizontal = (Math.abs(ar.y + ar.d - br.y) <= EPS || Math.abs(br.y + br.d - ar.y) <= EPS) && positiveOverlap(ar.x, ar.x + ar.w, br.x, br.x + br.w);
  return vertical || horizontal;
}
export function moduleEdgeJoined(geometry: SectionalGeometry, module: SectionalModule, wall: Wall): boolean {
  const r = moduleRect(module), edge = wall === 'north' ? r.y : wall === 'south' ? r.y + r.d : wall === 'west' ? r.x : r.x + r.w;
  return geometry.modules.some(other => {
    if (other === module) return false;
    const o = moduleRect(other);
    if (wall === 'north') return Math.abs(o.y + o.d - edge) <= EPS && positiveOverlap(r.x, r.x + r.w, o.x, o.x + o.w);
    if (wall === 'south') return Math.abs(o.y - edge) <= EPS && positiveOverlap(r.x, r.x + r.w, o.x, o.x + o.w);
    if (wall === 'west') return Math.abs(o.x + o.w - edge) <= EPS && positiveOverlap(r.y, r.y + r.d, o.y, o.y + o.d);
    return Math.abs(o.x - edge) <= EPS && positiveOverlap(r.y, r.y + r.d, o.y, o.y + o.d);
  });
}

export type SectionalEdgeRole = 'front' | 'back' | 'connector-back' | 'arm';
export type SectionalEdgeSegment = { moduleId: string; edge: Wall; start: number; end: number; role: SectionalEdgeRole };
export type SectionalJoin = { aId: string; bId: string; orientation: 'horizontal' | 'vertical'; coordinate: number; start: number; end: number };
export type SectionalVisualPlan = { edges: SectionalEdgeSegment[]; joins: SectionalJoin[] };

const edgeSpan = (r: Rect, edge: Wall) => edge === 'north' || edge === 'south'
  ? { start: r.x, end: r.x + r.w }
  : { start: r.y, end: r.y + r.d };

/** Exact exposed spans for an edge. A boolean "joined" is insufficient here:
 * U returns commonly join another module across only part of their front. */
export function exposedEdgeSpans(geometry: SectionalGeometry, module: SectionalModule, edge: Wall): { start: number; end: number }[] {
  const r = moduleRect(module), full = edgeSpan(r, edge);
  const coordinate = edge === 'north' ? r.y : edge === 'south' ? r.y + r.d : edge === 'west' ? r.x : r.x + r.w;
  const cuts = geometry.modules.filter(other => other !== module).flatMap(other => {
    const o = moduleRect(other);
    const touches = edge === 'north' ? Math.abs(o.y + o.d - coordinate) <= EPS
      : edge === 'south' ? Math.abs(o.y - coordinate) <= EPS
      : edge === 'west' ? Math.abs(o.x + o.w - coordinate) <= EPS
      : Math.abs(o.x - coordinate) <= EPS;
    if (!touches) return [];
    const otherSpan = edgeSpan(o, edge), start = Math.max(full.start, otherSpan.start), end = Math.min(full.end, otherSpan.end);
    return end - start > EPS ? [{ start, end }] : [];
  }).sort((a, b) => a.start - b.start);
  const spans: { start: number; end: number }[] = []; let cursor = full.start;
  for (const cut of cuts) { if (cut.start > cursor + EPS) spans.push({ start: cursor, end: cut.start }); cursor = Math.max(cursor, cut.end); }
  if (cursor < full.end - EPS) spans.push({ start: cursor, end: full.end });
  return spans;
}

const frontTouchesSide = (geometry: SectionalGeometry, module: SectionalModule, side: Wall) => {
  const r = moduleRect(module), horizontalFront = module.facing === 'north' || module.facing === 'south';
  const sample = horizontalFront
    ? (side === 'west' ? r.x + EPS * 10 : r.x + r.w - EPS * 10)
    : (side === 'north' ? r.y + EPS * 10 : r.y + r.d - EPS * 10);
  return exposedEdgeSpans(geometry, module, module.facing).some(span => sample >= span.start - EPS && sample <= span.end + EPS);
};

/** Build an assembly-level upholstery plan. Side rails are arms only at a
 * genuinely exposed seat-front endpoint. The other exposed side rails bridge
 * neighbouring back runs around an L/U corner, so the result reads as one
 * continuous sectional rather than several generic sofas pushed together. */
export function sectionalVisualPlan(geometry: SectionalGeometry): SectionalVisualPlan {
  const walls: Wall[] = ['north', 'east', 'south', 'west'], edges: SectionalEdgeSegment[] = [], joins: SectionalJoin[] = [];
  for (const section of geometry.modules) for (const edge of walls) {
    const role: SectionalEdgeRole = edge === section.facing ? 'front'
      : edge === opposite[section.facing] ? 'back'
      : frontTouchesSide(geometry, section, edge) ? 'arm' : 'connector-back';
    exposedEdgeSpans(geometry, section, edge).forEach(span => edges.push({ moduleId: section.id, edge, ...span, role }));
  }
  for (let i = 0; i < geometry.modules.length; i++) for (let j = i + 1; j < geometry.modules.length; j++) {
    const a = moduleRect(geometry.modules[i]), b = moduleRect(geometry.modules[j]);
    if (Math.abs(a.x + a.w - b.x) <= EPS || Math.abs(b.x + b.w - a.x) <= EPS) {
      const start = Math.max(a.y, b.y), end = Math.min(a.y + a.d, b.y + b.d);
      if (end - start > EPS) joins.push({ aId: geometry.modules[i].id, bId: geometry.modules[j].id, orientation: 'vertical', coordinate: Math.abs(a.x + a.w - b.x) <= EPS ? b.x : a.x, start, end });
    } else if (Math.abs(a.y + a.d - b.y) <= EPS || Math.abs(b.y + b.d - a.y) <= EPS) {
      const start = Math.max(a.x, b.x), end = Math.min(a.x + a.w, b.x + b.w);
      if (end - start > EPS) joins.push({ aId: geometry.modules[i].id, bId: geometry.modules[j].id, orientation: 'horizontal', coordinate: Math.abs(a.y + a.d - b.y) <= EPS ? b.y : a.y, start, end });
    }
  }
  return { edges, joins };
}

export function edgeSegmentRect(module: SectionalModule, segment: Pick<SectionalEdgeSegment, 'edge' | 'start' | 'end'>, thicknessCm: number): Rect {
  const r = moduleRect(module), thickness = Math.min(thicknessCm, segment.edge === 'north' || segment.edge === 'south' ? r.d : r.w);
  if (segment.edge === 'north') return { x: segment.start, y: r.y, w: segment.end - segment.start, d: thickness };
  if (segment.edge === 'south') return { x: segment.start, y: r.y + r.d - thickness, w: segment.end - segment.start, d: thickness };
  if (segment.edge === 'west') return { x: r.x, y: segment.start, w: thickness, d: segment.end - segment.start };
  return { x: r.x + r.w - thickness, y: segment.start, w: thickness, d: segment.end - segment.start };
}

export function joinPatchRect(join: SectionalJoin, thicknessCm: number): Rect {
  const half = thicknessCm / 2;
  return join.orientation === 'vertical'
    ? { x: join.coordinate - half, y: join.start, w: thicknessCm, d: join.end - join.start }
    : { x: join.start, y: join.coordinate - half, w: join.end - join.start, d: thicknessCm };
}
export function modulesOverlap(a: SectionalModule, b: SectionalModule): boolean {
  const ar = moduleRect(a), br = moduleRect(b);
  return positiveOverlap(ar.x, ar.x + ar.w, br.x, br.x + br.w) && positiveOverlap(ar.y, ar.y + ar.d, br.y, br.y + br.d);
}

export function sectionalGeometryError(geometry: SectionalGeometry, expected?: { w: number; d: number; h: number | null }): string | null {
  if (!geometry || geometry.type !== 'sectional' || !['north', 'east', 'south', 'west'].includes(geometry.primaryFacing) || !Array.isArray(geometry.modules)) return 'Sectional geometry is unsupported.';
  if (Object.keys(geometry).some(key => !['type', 'primaryFacing', 'chaiseSide', 'modules'].includes(key))) return 'Sectional geometry contains unsupported data.';
  if (geometry.chaiseSide && !['left', 'right'].includes(geometry.chaiseSide)) return 'Sectional chaise side is unsupported.';
  if (geometry.modules.length < 2 || geometry.modules.length > SECTIONAL_MAX_MODULES) return `A sectional needs 2–${SECTIONAL_MAX_MODULES} modules.`;
  const ids = new Set<string>();
  for (const section of geometry.modules) {
    if (Object.keys(section).some(key => !['id', 'type', 'xCm', 'yCm', 'widthCm', 'depthCm', 'heightCm', 'facing'].includes(key))) return 'A sectional module contains unsupported data.';
    if (!/^[a-z0-9][a-z0-9_-]{0,31}$/i.test(section.id) || ids.has(section.id)) return 'Sectional module IDs must be unique safe local identifiers.';
    ids.add(section.id);
    if (!SECTIONAL_MODULE_TYPES.includes(section.type) || !['north', 'east', 'south', 'west'].includes(section.facing)) return 'A sectional module type or facing is unsupported.';
    if (![section.xCm, section.yCm, section.widthCm, section.depthCm, section.heightCm].every(finite)
      || section.xCm < 0 || section.yCm < 0 || section.xCm > 600 || section.yCm > 600
      || section.widthCm < 20 || section.widthCm > 300 || section.depthCm < 20 || section.depthCm > 300 || section.heightCm < 20 || section.heightCm > 150) return 'Sectional module measurements are outside the supported finite bounds.';
  }
  if (Math.min(...geometry.modules.map(module => module.xCm)) !== 0 || Math.min(...geometry.modules.map(module => module.yCm)) !== 0) return 'Sectional module coordinates must be normalized to x=0 and y=0.';
  for (let i = 0; i < geometry.modules.length; i++) for (let j = i + 1; j < geometry.modules.length; j++) if (modulesOverlap(geometry.modules[i], geometry.modules[j])) return 'Sectional modules may share edges but cannot overlap positive area.';
  const reached = new Set([0]), queue = [0];
  while (queue.length) {
    const index = queue.shift()!;
    geometry.modules.forEach((module, candidate) => { if (!reached.has(candidate) && modulesShareEdge(geometry.modules[index], module)) { reached.add(candidate); queue.push(candidate); } });
  }
  if (reached.size !== geometry.modules.length) return 'Sectional modules must form one connected edge-sharing assembly.';
  const envelope = sectionalEnvelope(geometry);
  if (envelope.w > 600 || envelope.d > 600 || !geometry.modules.some(module => module.facing === geometry.primaryFacing)) return 'Sectional envelope or primary facing is invalid.';
  if (expected && (Math.abs(envelope.w - expected.w) > EPS || Math.abs(envelope.d - expected.d) > EPS || expected.h === null || Math.abs(envelope.h - expected.h) > EPS)) return 'Parent width, depth and height must exactly match the sectional module envelope.';
  return null;
}

const turnWall = (wall: Wall, rotation: Rotation): Wall => {
  const order: Wall[] = ['north', 'east', 'south', 'west'];
  return order[(order.indexOf(wall) + rotation / 90) % 4];
};
export function transformedLocalRect(item: Furniture, local: Rect, cellCm = 20): Rect {
  const x = item.originCell.x * cellCm, y = item.originCell.y * cellCm, w = item.sizeCm.w, d = item.sizeCm.d;
  if (item.rotation === 0) return { x: x + local.x, y: y + local.y, w: local.w, d: local.d };
  if (item.rotation === 90) return { x: x + d - local.y - local.d, y: y + local.x, w: local.d, d: local.w };
  if (item.rotation === 180) return { x: x + w - local.x - local.w, y: y + d - local.y - local.d, w: local.w, d: local.d };
  return { x: x + local.y, y: y + w - local.x - local.w, w: local.d, d: local.w };
}
export function transformedModuleRect(item: Furniture, module: SectionalModule, cellCm = 20): Rect {
  return transformedLocalRect(item, moduleRect(module), cellCm);
}
export const transformedModuleFacing = (item: Furniture, module: SectionalModule): Wall => turnWall(module.facing, item.rotation);
export const transformedPrimaryFacing = (item: Furniture): Wall => item.geometry ? turnWall(item.geometry.primaryFacing, item.rotation) : faces[item.rotation];

/** Return the exposed one-dimensional spans of a module's seating front after
 * subtracting every edge-sharing join. */
export function exposedFrontSpans(geometry: SectionalGeometry, module: SectionalModule): { start: number; end: number }[] {
  return exposedEdgeSpans(geometry, module, module.facing);
}
