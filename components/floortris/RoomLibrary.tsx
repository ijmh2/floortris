import { fromVariant, type Variant } from './data.ts';
import { bedAccessBands, bounds, frontBand } from './engine.ts';
import type { RoomProfile, Rules } from './model.ts';

export const ROOM_PRESETS = [
  { id: 'local', label: 'Original lounge', href: '/' },
  { id: '3m', label: '3 × 3 m lounge', href: '/?sample=3m' },
  { id: 'bedroom-single', label: 'Single bedroom', href: '/?sample=bedroom-single' },
  { id: 'bedroom-double', label: 'Double bedroom', href: '/?sample=bedroom-double' },
  { id: 'office', label: 'Home office', href: '/?sample=office' },
  { id: 'bathroom', label: 'Bathroom concept', href: '/?sample=bathroom' },
];
export function dockVariants(profile: RoomProfile): string[] {
  if (profile.kind === 'bedroom') return [profile.sleeping === 'king' ? 'haven-king-160' : profile.sleeping === 'double' ? 'haven-double-140' : 'haven-single-100', 'nook-bedside-40', 'tallline-wardrobe-100', 'fern-40'];
  if (profile.kind === 'home_office') return ['line-desk-100', 'nest-chair-60', 'archive-tall-80', 'fern-40'];
  if (profile.kind === 'bathroom_concept') return ['weave-mat-80', 'fern-40'];
  return ['frame-tv-120', 'line-desk-100', 'pebble-table-80', 'fern-40'];
}
export function VariantPreview({ variant, rules }: { variant: Variant; rules: Rules }) {
  const item = fromVariant(variant.id, 'preview-only'), piece = bounds(item);
  const zones = item.kind === 'bed' ? bedAccessBands(item, rules.bedLongSideAccessCm).map(z => z.rect)
    : item.kind === 'desk' ? [frontBand(item, rules.chairPullCm)]
    : item.kind === 'storage' ? [frontBand(item, rules.storageFrontCm)] : [];
  const all = [piece, ...zones], x = Math.min(...all.map(r => r.x)), y = Math.min(...all.map(r => r.y));
  const w = Math.max(...all.map(r => r.x + r.w)) - x, d = Math.max(...all.map(r => r.y + r.d)) - y;
  const style = (r: typeof piece) => ({ left: `${(r.x - x) / w * 100}%`, top: `${(r.y - y) / d * 100}%`, width: `${r.w / w * 100}%`, height: `${r.d / d * 100}%` });
  return <section className="ft-size-preview" aria-label="Measured footprint preview">
    <strong>{variant.name}</strong><span>{variant.sizeCm.w} × {variant.sizeCm.d} × {variant.sizeCm.h} cm · measured envelope</span>
    <div className="ft-size-diagram" style={{ aspectRatio: `${w}/${d}` }}>
      {zones.map((r, i) => <i key={i} className="ft-size-clearance" style={style(r)} />)}
      <div className="ft-size-footprint" style={style(piece)}>{item.kind === 'tv' ? 'Wall TV' : 'Footprint'}</div>
    </div>
    <p>{item.kind === 'bed' ? `${rules.bedLongSideAccessCm} cm side entry · 60 cm head segment excluded · at least 100 cm entry length.` : zones.length ? `${item.kind === 'desk' ? rules.chairPullCm : rules.storageFrontCm} cm front reservation.` : item.kind === 'rug' ? 'Floor layer · does not block walking.' : 'Solid footprint; room routes are checked on placement.'}</p>
    <small>Size preview only. Drag onto the room for a checked placement.</small>
  </section>;
}
