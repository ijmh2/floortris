import type { FloorPlan, FloorPoint, Rect, Room, Wall, WallAnchor } from './model.ts';

const EPS = 1e-6;
export type WallSegment = { id: string; wall: Wall; x1: number; y1: number; x2: number; y2: number; lengthCm: number; horizontal: boolean };

export const rectanglePoints = (widthCm: number, depthCm: number): FloorPoint[] => [
  { xCm: 0, yCm: 0 }, { xCm: widthCm, yCm: 0 }, { xCm: widthCm, yCm: depthCm }, { xCm: 0, yCm: depthCm },
];
export const floorPoints = (room: Pick<Room, 'widthCm' | 'depthCm' | 'floorPlan'>) => room.floorPlan?.points || rectanglePoints(room.widthCm, room.depthCm);
const onSegment = (p: FloorPoint, a: FloorPoint, b: FloorPoint) => Math.abs((b.xCm - a.xCm) * (p.yCm - a.yCm) - (b.yCm - a.yCm) * (p.xCm - a.xCm)) < EPS && p.xCm >= Math.min(a.xCm, b.xCm) - EPS && p.xCm <= Math.max(a.xCm, b.xCm) + EPS && p.yCm >= Math.min(a.yCm, b.yCm) - EPS && p.yCm <= Math.max(a.yCm, b.yCm) + EPS;

export function pointInFloorPlan(points: FloorPoint[], xCm: number, yCm: number, boundary = true): boolean {
  const point = { xCm, yCm };
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j], b = points[i];
    if (boundary && onSegment(point, a, b)) return true;
    if ((a.yCm > yCm) !== (b.yCm > yCm) && xCm < (b.xCm - a.xCm) * (yCm - a.yCm) / (b.yCm - a.yCm) + a.xCm) inside = !inside;
  }
  return inside;
}
export const pointInRoom = (room: Room, xCm: number, yCm: number, boundary = true) => pointInFloorPlan(floorPoints(room), xCm, yCm, boundary);

/** Exact for an axis-aligned rectangle inside an orthogonal polygon: polygon
 * vertices partition the candidate into regions whose midpoint has one state. */
export function rectInsideRoom(room: Room, rect: Rect): boolean {
  if (rect.w <= 0 || rect.d <= 0 || rect.x < -EPS || rect.y < -EPS || rect.x + rect.w > room.widthCm + EPS || rect.y + rect.d > room.depthCm + EPS) return false;
  const points = floorPoints(room);
  const xs = [...new Set([rect.x, rect.x + rect.w, ...points.map(p => p.xCm).filter(x => x > rect.x && x < rect.x + rect.w)])].sort((a, b) => a - b);
  const ys = [...new Set([rect.y, rect.y + rect.d, ...points.map(p => p.yCm).filter(y => y > rect.y && y < rect.y + rect.d)])].sort((a, b) => a - b);
  for (let ix = 0; ix < xs.length - 1; ix++) for (let iy = 0; iy < ys.length - 1; iy++) if (!pointInFloorPlan(points, (xs[ix] + xs[ix + 1]) / 2, (ys[iy] + ys[iy + 1]) / 2, false)) return false;
  return true;
}
export const cellInsideRoom = (room: Room, x: number, y: number, unit = 20) => rectInsideRoom(room, { x: x * unit, y: y * unit, w: unit, d: unit });
export const floorAreaM2 = (room: Room) => Math.abs(floorPoints(room).reduce((sum, point, index, points) => { const next = points[(index + 1) % points.length]; return sum + point.xCm * next.yCm - next.xCm * point.yCm; }, 0)) / 20000;

function segmentsIntersect(a: FloorPoint, b: FloorPoint, c: FloorPoint, d: FloorPoint): boolean {
  if (a.xCm === b.xCm && c.xCm === d.xCm) return a.xCm === c.xCm && Math.max(Math.min(a.yCm, b.yCm), Math.min(c.yCm, d.yCm)) <= Math.min(Math.max(a.yCm, b.yCm), Math.max(c.yCm, d.yCm));
  if (a.yCm === b.yCm && c.yCm === d.yCm) return a.yCm === c.yCm && Math.max(Math.min(a.xCm, b.xCm), Math.min(c.xCm, d.xCm)) <= Math.min(Math.max(a.xCm, b.xCm), Math.max(c.xCm, d.xCm));
  const verticalA = a.xCm === b.xCm, v1 = verticalA ? [a, b] : [c, d], h1 = verticalA ? [c, d] : [a, b];
  return v1[0].xCm >= Math.min(h1[0].xCm, h1[1].xCm) && v1[0].xCm <= Math.max(h1[0].xCm, h1[1].xCm) && h1[0].yCm >= Math.min(v1[0].yCm, v1[1].yCm) && h1[0].yCm <= Math.max(v1[0].yCm, v1[1].yCm);
}

export function floorPlanError(plan: FloorPlan | undefined, widthCm: number, depthCm: number): string | null {
  if (!plan) return null;
  if (plan.kind !== 'rectilinear' || !Array.isArray(plan.points) || plan.points.length < 4 || plan.points.length > 24) return 'Custom floor plans need 4–24 ordered corner points.';
  const points = plan.points;
  if (points.some(p => !p || !Number.isFinite(p.xCm) || !Number.isFinite(p.yCm) || p.xCm < 0 || p.yCm < 0 || p.xCm > 1000 || p.yCm > 1000)) return 'Every floor-plan corner needs finite centimetre coordinates from 0 to 1000.';
  if (Math.min(...points.map(p => p.xCm)) !== 0 || Math.min(...points.map(p => p.yCm)) !== 0 || Math.max(...points.map(p => p.xCm)) !== widthCm || Math.max(...points.map(p => p.yCm)) !== depthCm) return 'Room width and depth must match the custom plan bounding box, whose top and left start at 0 cm.';
  if (new Set(points.map(p => `${p.xCm},${p.yCm}`)).size !== points.length) return 'Custom floor-plan corners must be unique.';
  for (let i = 0; i < points.length; i++) {
    const previous = points[(i - 1 + points.length) % points.length], current = points[i], next = points[(i + 1) % points.length];
    if (current.xCm !== next.xCm && current.yCm !== next.yCm) return 'Custom floor-plan edges must be horizontal or vertical.';
    if (Math.abs(current.xCm - next.xCm) + Math.abs(current.yCm - next.yCm) < 20) return 'Every custom wall segment must be at least 20 cm long.';
    if ((previous.xCm === current.xCm && current.xCm === next.xCm) || (previous.yCm === current.yCm && current.yCm === next.yCm)) return 'Remove redundant corners that do not turn the wall.';
  }
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    const adjacent = j === i + 1 || (i === 0 && j === points.length - 1); if (adjacent) continue;
    if (segmentsIntersect(points[i], points[(i + 1) % points.length], points[j], points[(j + 1) % points.length])) return 'Custom floor-plan walls cannot cross or touch another non-adjacent wall.';
  }
  if (floorAreaM2({ widthCm, depthCm, floorPlan: plan } as Room) < 3) return 'Custom floor-plan area must be at least 3 m².';
  return null;
}

function derivedWall(points: FloorPoint[], a: FloorPoint, b: FloorPoint): Wall {
  const x = (a.xCm + b.xCm) / 2, y = (a.yCm + b.yCm) / 2, horizontal = a.yCm === b.yCm;
  if (horizontal) return pointInFloorPlan(points, x, y + .1, false) ? 'north' : 'south';
  return pointInFloorPlan(points, x + .1, y, false) ? 'west' : 'east';
}
export function wallSegments(room: Room): WallSegment[] {
  if (!room.floorPlan) return [
    { id: 'north', wall: 'north', x1: 0, y1: 0, x2: room.widthCm, y2: 0, lengthCm: room.widthCm, horizontal: true },
    { id: 'east', wall: 'east', x1: room.widthCm, y1: 0, x2: room.widthCm, y2: room.depthCm, lengthCm: room.depthCm, horizontal: false },
    { id: 'south', wall: 'south', x1: 0, y1: room.depthCm, x2: room.widthCm, y2: room.depthCm, lengthCm: room.widthCm, horizontal: true },
    { id: 'west', wall: 'west', x1: 0, y1: 0, x2: 0, y2: room.depthCm, lengthCm: room.depthCm, horizontal: false },
  ];
  const points = floorPoints(room);
  return points.map((a, i) => { const b = points[(i + 1) % points.length], horizontal = a.yCm === b.yCm; return { id: `wall-${i + 1}`, wall: derivedWall(points, a, b), x1: horizontal ? Math.min(a.xCm, b.xCm) : a.xCm, y1: horizontal ? a.yCm : Math.min(a.yCm, b.yCm), x2: horizontal ? Math.max(a.xCm, b.xCm) : b.xCm, y2: horizontal ? b.yCm : Math.max(a.yCm, b.yCm), lengthCm: Math.abs(a.xCm - b.xCm) + Math.abs(a.yCm - b.yCm), horizontal }; });
}
export function resolveWallSegment(room: Room, anchor: Pick<WallAnchor, 'wall' | 'segmentId'>): WallSegment | null {
  const segments = wallSegments(room);
  if (anchor.segmentId) return segments.find(segment => segment.id === anchor.segmentId && segment.wall === anchor.wall) || null;
  const matches = segments.filter(segment => segment.wall === anchor.wall);
  return !room.floorPlan || matches.length === 1 ? matches[0] || null : null;
}
export function wallRect(room: Room, anchor: WallAnchor, widthCm: number, depthCm: number): Rect | null {
  const segment = resolveWallSegment(room, anchor); if (!segment) return null;
  const along = anchor.offsetCm;
  if (segment.wall === 'north') return { x: segment.x1 + along, y: segment.y1, w: widthCm, d: depthCm };
  if (segment.wall === 'south') return { x: segment.x1 + along, y: segment.y1 - depthCm, w: widthCm, d: depthCm };
  if (segment.wall === 'west') return { x: segment.x1, y: segment.y1 + along, w: depthCm, d: widthCm };
  return { x: segment.x1 - depthCm, y: segment.y1 + along, w: depthCm, d: widthCm };
}
export function wallPointCm(room: Room, anchor: WallAnchor, alongCm: number, inwardCm = 0): [number, number] | null {
  const segment = resolveWallSegment(room, anchor); if (!segment) return null;
  const u = anchor.offsetCm + alongCm;
  if (segment.wall === 'north') return [segment.x1 + u, segment.y1 + inwardCm];
  if (segment.wall === 'south') return [segment.x1 + u, segment.y1 - inwardCm];
  if (segment.wall === 'west') return [segment.x1 + inwardCm, segment.y1 + u];
  return [segment.x1 - inwardCm, segment.y1 + u];
}
export function planClipPath(room: Room): string | undefined {
  if (!room.floorPlan) return undefined;
  return `polygon(${floorPoints(room).map(point => `${point.xCm / room.widthCm * 100}% ${point.yCm / room.depthCm * 100}%`).join(',')})`;
}
export function nearestWallAnchor(room: Room, widthCm: number, xCm: number, yCm: number): WallAnchor {
  const nearest = wallSegments(room).map(segment => {
    const along = segment.horizontal ? Math.max(segment.x1, Math.min(segment.x2, xCm)) : Math.max(segment.y1, Math.min(segment.y2, yCm));
    const distance = segment.horizontal ? Math.hypot(xCm - along, yCm - segment.y1) : Math.hypot(xCm - segment.x1, yCm - along);
    return { segment, along: segment.horizontal ? along - segment.x1 : along - segment.y1, distance };
  }).sort((a, b) => a.distance - b.distance)[0];
  const max = Math.max(0, nearest.segment.lengthCm - widthCm), offsetCm = Math.max(0, Math.min(max, Math.round((nearest.along - widthCm / 2) / 20) * 20));
  return { wall: nearest.segment.wall, segmentId: room.floorPlan ? nearest.segment.id : undefined, offsetCm };
}
export function anchorForDirection(room: Room, wall: Wall, centreCm: number, widthCm: number): WallAnchor | null {
  const options = wallSegments(room).filter(segment => segment.wall === wall && segment.lengthCm >= widthCm);
  if (!options.length) return null;
  const best = options.map(segment => { const start = segment.horizontal ? segment.x1 : segment.y1, end = start + segment.lengthCm, clamped = Math.max(start + widthCm / 2, Math.min(end - widthCm / 2, centreCm)); return { segment, offsetCm: clamped - start - widthCm / 2, distance: Math.abs(clamped - centreCm) }; }).sort((a, b) => a.distance - b.distance || b.segment.lengthCm - a.segment.lengthCm)[0];
  return { wall, segmentId: room.floorPlan ? best.segment.id : undefined, offsetCm: best.offsetCm };
}
