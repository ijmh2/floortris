import React from 'react';
import { PALETTES } from './data.ts';

export default function FinishPicker({ target, value, disabled, onChange }: {
  target: 'wall' | 'floor'; value: string; disabled: boolean; onChange: (id: string) => void;
}) {
  const finishes = PALETTES[target];
  return <div className="ft-finish-picker">
    <div className="ft-swatches" aria-label={`Plain ${target} finishes`}>
      {finishes.filter(f => !f.texture).map(f => <button key={f.id} type="button" disabled={disabled}
        title={f.name} aria-label={`Set ${f.name} ${target} finish`} aria-pressed={value === f.id}
        className={value === f.id ? 'active' : ''} style={{ background: f.color }} onClick={() => onChange(f.id)}>
        {value === f.id ? '✓' : ''}
      </button>)}
    </div>
    <div className="ft-finish-grid" aria-label={`${target === 'wall' ? 'Wallpaper' : 'Flooring'} texture pack`}>
      {finishes.filter(f => f.texture).map(f => <button key={f.id} type="button" disabled={disabled}
        title={f.description} aria-label={`Set ${f.name} ${target} finish`} aria-pressed={value === f.id}
        className={`ft-finish-card ${value === f.id ? 'active' : ''}`} onClick={() => onChange(f.id)}>
        <span className="ft-finish-preview" style={{ backgroundColor: f.color, backgroundImage: `url("${f.texture!.url}")` }} />
        <span className="ft-finish-label">{f.name}{value === f.id && <b aria-hidden="true">✓</b>}</span>
      </button>)}
    </div>
    {target === 'wall' && <p className="ft-muted">Wallpaper previews in 3D. Floor textures also show on the 2D furniture view.</p>}
  </div>;
}
