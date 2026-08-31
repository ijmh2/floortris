import { faces, type Furniture, type Rect, type Rotation, type SectionalGeometry, type SectionalModule, type Wall } from './model.ts';

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
export function modulesOverlap(a: SectionalModule, b: SectionalModule): boolean {
  const ar = moduleRect(a), br = moduleRect(b);
  return positiveOverlap(ar.x, ar.x + ar.w, br.x, br.x + br.w) && positiveOverlap(ar.y, ar.y + ar.d, br.y, br.y + br.d);
}

export function sectionalGeometryError(geometry: SectionalGeometry, expected?: { w: number; d: number; h: number | null }): string | null {
  if (!geometry || geometry.type !== 'sectional' || !['north', 'east', 'south', 'west'].includes(geometry.primaryFacing) || !Array.isArray(geometry.modules)) return 'Sectional geometry is unsupported.';
  if (Object.keys(geometry).some(key => !['type', 'primaryFacing', 'modules'].includes(key))) return 'Sectional geometry contains unsupported data.';
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
export function transformedModuleRect(item: Furniture, module: SectionalModule, cellCm = 20): Rect {
  const x = item.originCell.x * cellCm, y = item.originCell.y * cellCm, w = item.sizeCm.w, d = item.sizeCm.d;
  if (item.rotation === 0) return { x: x + module.xCm, y: y + module.yCm, w: module.widthCm, d: module.depthCm };
  if (item.rotation === 90) return { x: x + d - module.yCm - module.depthCm, y: y + module.xCm, w: module.depthCm, d: module.widthCm };
  if (item.rotation === 180) return { x: x + w - module.xCm - module.widthCm, y: y + d - module.yCm - module.depthCm, w: module.widthCm, d: module.depthCm };
  return { x: x + module.yCm, y: y + w - module.xCm - module.widthCm, w: module.depthCm, d: module.widthCm };
}
export const transformedModuleFacing = (item: Furniture, module: SectionalModule): Wall => turnWall(module.facing, item.rotation);
export const transformedPrimaryFacing = (item: Furniture): Wall => item.geometry ? turnWall(item.geometry.primaryFacing, item.rotation) : faces[item.rotation];

/** Return the exposed one-dimensional spans of a module's seating front after
 * subtracting every edge-sharing join. */
export function exposedFrontSpans(geometry: SectionalGeometry, module: SectionalModule): { start: number; end: number }[] {
  const r = moduleRect(module), horizontal = module.facing === 'north' || module.facing === 'south';
  const edge = module.facing === 'north' ? r.y : module.facing === 'south' ? r.y + r.d : module.facing === 'west' ? r.x : r.x + r.w;
  const full = horizontal ? { start: r.x, end: r.x + r.w } : { start: r.y, end: r.y + r.d };
  const cuts = geometry.modules.filter(other => other !== module).flatMap(other => {
    const o = moduleRect(other);
    const touches = module.facing === 'north' ? Math.abs(o.y + o.d - edge) <= EPS : module.facing === 'south' ? Math.abs(o.y - edge) <= EPS : module.facing === 'west' ? Math.abs(o.x + o.w - edge) <= EPS : Math.abs(o.x - edge) <= EPS;
    if (!touches) return [];
    const start = Math.max(full.start, horizontal ? o.x : o.y), end = Math.min(full.end, horizontal ? o.x + o.w : o.y + o.d);
    return end - start > EPS ? [{ start, end }] : [];
  }).sort((a, b) => a.start - b.start);
  const spans: { start: number; end: number }[] = []; let cursor = full.start;
  for (const cut of cuts) { if (cut.start > cursor + EPS) spans.push({ start: cursor, end: cut.start }); cursor = Math.max(cursor, cut.end); }
  if (cursor < full.end - EPS) spans.push({ start: cursor, end: full.end });
  return spans;
}
