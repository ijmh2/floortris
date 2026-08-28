import type { AppState, Furniture, Kind, RoomProfile, Rules, Size } from './model.ts';
export type Variant = { id: string; name: string; kind: Kind; sizeCm: Size; description: string; palette: string; tags?: string[]; recommendedProfiles?: RoomProfile['kind'][] };
export type Finish = { id: string; name: string; color: string; description?: string; tags?: string[]; pack?: string; conceptOnly?: boolean; texture?: { url: string; repeatCm: [number, number]; kind: 'wallpaper' | 'flooring' } };
export const PALETTES: Record<'furniture' | 'wall' | 'floor', Finish[]> = {
  furniture: [{ id: 'moss', name: 'Moss', color: '#8d9c83' }, { id: 'oat', name: 'Oat', color: '#d7cdbd' }, { id: 'clay', name: 'Clay', color: '#bd856b' }, { id: 'graphite', name: 'Graphite', color: '#58615f' }, { id: 'oak', name: 'Oak', color: '#c3a782' }],
  wall: [
    { id: 'cream', name: 'Chalk', color: '#f4f1e8' }, { id: 'stone', name: 'Stone', color: '#e7e5dd' }, { id: 'warm', name: 'Warm white', color: '#f5eade' },
    { id: 'sage-botanical', name: 'Sage botanical', color: '#e5e8d9', description: 'Sage leaves on ivory paper; calm botanical wallpaper.', tags: ['botanical', 'sage', 'calm'], pack: 'studio-01', conceptOnly: true, texture: { url: '/textures/sage-botanical.webp', repeatCm: [60, 60], kind: 'wallpaper' } },
    { id: 'clay-arches', name: 'Clay arches', color: '#edd8c6', description: 'Terracotta geometric arches on cream; warm graphic wallpaper.', tags: ['geometric', 'terracotta', 'warm'], pack: 'studio-01', conceptOnly: true, texture: { url: '/textures/clay-arches.webp', repeatCm: [80, 80], kind: 'wallpaper' } },
    { id: 'blue-gingham', name: 'Blue gingham', color: '#d6e2e8', description: 'Soft blue and ivory checks; a cosy woven-paper look.', tags: ['check', 'blue', 'cosy'], pack: 'studio-01', conceptOnly: true, texture: { url: '/textures/blue-gingham.webp', repeatCm: [40, 40], kind: 'wallpaper' } },
    { id: 'woven-linen', name: 'Woven linen', color: '#ded4c4', description: 'Fine oatmeal linen weave; quiet neutral wallpaper.', tags: ['linen', 'neutral', 'minimal'], pack: 'studio-01', conceptOnly: true, texture: { url: '/textures/woven-linen.webp', repeatCm: [40, 40], kind: 'wallpaper' } },
  ],
  floor: [
    { id: 'oak', name: 'Light oak', color: '#e8dfce' }, { id: 'ash', name: 'Ash', color: '#e6e5df' }, { id: 'cork', name: 'Cork', color: '#dcc5a7' },
    { id: 'pale-oak', name: 'Pale oak planks', color: '#dfcbae', description: 'Pale matte oak with natural grain and straight planks.', tags: ['wood', 'oak', 'natural'], pack: 'studio-01', conceptOnly: true, texture: { url: '/textures/pale-oak.webp', repeatCm: [120, 120], kind: 'flooring' } },
    { id: 'warm-terrazzo', name: 'Warm terrazzo', color: '#ece1d4', description: 'Cream terrazzo with small clay, sage and charcoal chips.', tags: ['terrazzo', 'speckled', 'warm'], pack: 'studio-01', conceptOnly: true, texture: { url: '/textures/warm-terrazzo.webp', repeatCm: [80, 80], kind: 'flooring' } },
  ],
};
export const CATALOGUE: Variant[] = [
  { id: 'arc-sofa-200', name: 'Arc sofa · 200', kind: 'sofa', sizeCm: { w: 200, d: 80, h: 82 }, description: 'A generous three seat sofa', palette: 'moss', recommendedProfiles: ['lounge'] } ,
  { id: 'arc-sofa-160', name: 'Arc sofa · 160', kind: 'sofa', sizeCm: { w: 160, d: 80, h: 82 }, description: 'Compact two seat sofa', palette: 'oat', recommendedProfiles: ['lounge'] } ,
  { id: 'frame-tv-120', name: 'Frame TV · 120', kind: 'tv', sizeCm: { w: 120, d: 6, h: 68 }, description: 'Wall mounted · bottom at 110 cm', palette: 'graphite', recommendedProfiles: ['lounge'] } ,
  { id: 'line-desk-100', name: 'Line desk · 100', kind: 'desk', sizeCm: { w: 100, d: 60, h: 74 }, description: 'Compact work surface', palette: 'oak', recommendedProfiles: ['lounge', 'bedroom', 'home_office'] } ,
  { id: 'line-desk-140', name: 'Line desk · 140', kind: 'desk', sizeCm: { w: 140, d: 60, h: 74 }, description: 'More room for your work', palette: 'oak', recommendedProfiles: ['lounge', 'bedroom', 'home_office'] } ,
  { id: 'line-desk-180', name: 'Line desk · 180', kind: 'desk', sizeCm: { w: 180, d: 80, h: 74 }, description: 'A full width studio desk', palette: 'oak', recommendedProfiles: ['lounge', 'bedroom', 'home_office'] } ,
  { id: 'pebble-table-80', name: 'Pebble table · 80', kind: 'coffee_table', sizeCm: { w: 80, d: 40, h: 38 }, description: 'Low profile, keeps the TV strip clear', palette: 'oak', recommendedProfiles: ['lounge'] } ,
  { id: 'pebble-table-120', name: 'Pebble table · 120', kind: 'coffee_table', sizeCm: { w: 120, d: 60, h: 38 }, description: 'A larger centre table', palette: 'clay', recommendedProfiles: ['lounge'] } ,
  { id: 'folio-storage-80', name: 'Folio cabinet · 80', kind: 'storage', sizeCm: { w: 80, d: 40, h: 100 }, description: 'Closed storage · 60 cm front clearance', palette: 'oat', recommendedProfiles: ['lounge', 'bedroom', 'home_office'] } ,
  { id: 'nest-chair-60', name: 'Nest chair · 60', kind: 'chair', sizeCm: { w: 60, d: 60, h: 80 }, description: 'An occasional or desk chair', palette: 'clay', recommendedProfiles: ['lounge', 'bedroom', 'home_office'] } ,
  { id: 'weave-rug-200', name: 'Weave rug · 200', kind: 'rug', sizeCm: { w: 200, d: 160, h: 1 }, description: 'Soft floor layer · never blocks a route', palette: 'oat', recommendedProfiles: ['lounge', 'bedroom', 'home_office', 'bathroom_concept'] } ,
  { id: 'fern-40', name: 'Fern · 40', kind: 'plant', sizeCm: { w: 40, d: 40, h: 110 }, description: 'A little living green', palette: 'moss', recommendedProfiles: ['lounge', 'bedroom', 'home_office', 'bathroom_concept'] } ,
  { id: 'weave-mat-80', name: 'Weave mat · 80', kind: 'rug', sizeCm: { w: 80, d: 60, h: 1 }, description: 'Small floor layer · concept decor only', palette: 'oat', recommendedProfiles: ['bathroom_concept', 'bedroom'] },
  { id: 'haven-single-100', name: 'Haven single bed · 100', kind: 'bed', sizeCm: { w: 100, d: 200, h: 95 }, description: '90 × 190 mattress · compact bedroom anchor', palette: 'oat', tags: ['bed', 'single'], recommendedProfiles: ['bedroom'] },
  { id: 'haven-double-140', name: 'Haven double bed · 140', kind: 'bed', sizeCm: { w: 140, d: 200, h: 100 }, description: '135 × 190 mattress · double-room hero', palette: 'oat', tags: ['bed', 'double'], recommendedProfiles: ['bedroom'] },
  { id: 'haven-king-160', name: 'Haven king bed · 160', kind: 'bed', sizeCm: { w: 160, d: 220, h: 105 }, description: '150 × 200 mattress', palette: 'oat', tags: ['bed', 'king'], recommendedProfiles: ['bedroom'] },
  { id: 'nook-bedside-40', name: 'Nook bedside table · 40', kind: 'storage', sizeCm: { w: 40, d: 40, h: 52 }, description: 'Bedside storage · 40 × 40 cm', palette: 'oak', tags: ['bedside'], recommendedProfiles: ['bedroom'] },
  { id: 'tallline-wardrobe-100', name: 'Tallline wardrobe · 100', kind: 'storage', sizeCm: { w: 100, d: 60, h: 210 }, description: 'Clothes storage · 60 cm front clearance', palette: 'oat', tags: ['wardrobe', 'clothes-storage'], recommendedProfiles: ['bedroom'] },
  { id: 'tallline-wardrobe-160', name: 'Tallline wardrobe · 160', kind: 'storage', sizeCm: { w: 160, d: 60, h: 210 }, description: 'Large clothes storage · 60 cm front clearance', palette: 'oat', tags: ['wardrobe', 'clothes-storage'], recommendedProfiles: ['bedroom'] },
  { id: 'fold-bench-100', name: 'Fold bench · 100', kind: 'table', sizeCm: { w: 100, d: 40, h: 45 }, description: 'Optional foot-of-bed accent', palette: 'oak', tags: ['bedroom'], recommendedProfiles: ['bedroom'] },
  { id: 'archive-tall-80', name: 'Archive tall cabinet · 80', kind: 'storage', sizeCm: { w: 80, d: 45, h: 180 }, description: 'Optional office storage', palette: 'graphite', tags: ['office-storage'], recommendedProfiles: ['home_office'] },
];
export function fromVariant(variantId: string, id: string): Furniture {
  const v = CATALOGUE.find(v => v.id === variantId);
  if (!v) throw new Error('variant_unavailable');
  return { id, label: v.name, kind: v.kind, ownership: 'catalogue', variantId, sizeCm: { ...v.sizeCm }, originCell: { x: 0, y: 0 }, rotation: 0, elevationCm: v.kind === 'tv' ? 110 : 0, ...(v.kind === 'tv' ? { wallAnchor: { wall: 'north' as const, offsetCm: 180 } } : {}), locked: {}, appearance: v.palette, requiredInRoom: false, tags: [...(v.tags || (v.kind === 'sofa' ? ['seating'] : v.kind === 'chair' ? ['work-seating'] : []))] };
}
export const DEFAULT_RULES: Rules = { cellCm: 20, H_lowCm: 70, walkHardCm: 60, walkPreferredCm: 80, storageFrontCm: 60, chairPullCm: 60, bedLongSideAccessCm: 40, radiatorFrontCm: 20, windowFrontCm: 20, ceilingCm: 240, requiredKinds: ['sofa', 'tv'], deskNearWindow: true, openFloorM2: 2 };
export function makeDemo(): AppState {
  const sofa: Furniture = { id: 'owned-sofa', label: 'Your sofa', kind: 'sofa', ownership: 'owned', sizeCm: { w: 220, d: 90, h: 85 }, originCell: { x: 9, y: 18 }, rotation: 180, elevationCm: 0, locked: { position: true, rotation: true, size: true }, appearance: 'moss', requiredInRoom: true, tags: ['seating'] };
  const radiator: Furniture = { id: 'radiator-east', label: 'Radiator', kind: 'radiator', ownership: 'fixed', sizeCm: { w: 20, d: 100, h: 60 }, originCell: { x: 29, y: 14 }, wallAnchor: { wall: 'east', offsetCm: 280 }, rotation: 90, elevationCm: 0, locked: { position: true, size: true, rotation: true }, appearance: 'oat', requiredInRoom: true, tags: [] };
  // Fixed radiator dimensions describe its floor projection directly, without a rotated catalogue convention.
  radiator.rotation = 0;
  return { version: 2, currentRevision: 1, ruleRevision: 1, sequence: 0, proposal: null, rules: structuredClone(DEFAULT_RULES), room: { name: 'The everyday lounge', widthCm: 600, depthCm: 480, profile: { kind: 'lounge' }, openings: [
    { id: 'entrance', kind: 'door', wall: 'south', offsetCm: 20, widthCm: 100, hinge: 'start', swing: 'in', angle: 90, mechanism: 'hinged', entrance: true },
    { id: 'window-west', kind: 'window', wall: 'west', offsetCm: 80, widthCm: 180, sillCm: 95, headCm: 215, type: 'fixed', windowAccess: false },
  ], fixtures: [radiator] }, inventory: [structuredClone(sofa)], current: { furniture: [sofa], appearance: { wall: 'cream', floor: 'oak' } } };
}
