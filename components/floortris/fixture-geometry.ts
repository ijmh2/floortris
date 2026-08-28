import { bounds, frontBand } from './engine.ts';
import { faces, type Furniture, type Room, type Wall, type Rotation } from './model.ts';

/** Demo approach envelopes; no installation or accessibility claims. */
export function conceptClearance(f: Furniture): Furniture['clearance'] {
  if (f.kind === 'towel_rail' || f.kind === 'radiator') return undefined;
  const rect = frontBand(f, f.kind === 'toilet' ? 80 : 60);
  if (f.kind === 'toilet') {
    if (faces[f.rotation] === 'north' || faces[f.rotation] === 'south') { const extra = Math.max(0, 60 - rect.w); rect.x -= extra / 2; rect.w += extra; }
    else { const extra = Math.max(0, 60 - rect.d); rect.y -= extra / 2; rect.d += extra; }
  }
  return { label: `${f.label} ${f.kind === 'shower' ? 'external entry' : 'approach'}`, rect };
}

/** Anchor the fixture back against a wall, preserving its measured local dimensions. */
export function conceptOnWall(f: Furniture, room: Room, wall: Wall, offsetCm: number): Furniture {
  const rotation: Rotation = ({ north: 0, east: 90, south: 180, west: 270 } as const)[wall];
  const next = { ...f, rotation, wallAnchor: { wall, offsetCm } };
  const b = bounds(next);
  next.originCell = { x: (wall === 'east' ? room.widthCm - b.w : wall === 'west' ? 0 : offsetCm) / 20,
    y: (wall === 'south' ? room.depthCm - b.d : wall === 'north' ? 0 : offsetCm) / 20 };
  return { ...next, clearance: conceptClearance(next) };
}
