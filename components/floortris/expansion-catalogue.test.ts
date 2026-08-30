import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOGUE, PALETTES } from './data.ts';
import type { RoomProfile } from './model.ts';
import { FORM_PARTS, FORM_LABEL, type Form } from './forms.ts';

test('every catalogue entry is unique, well formed and self-describing', () => {
  const seen = new Set<string>();
  for (const v of CATALOGUE) {
    assert.ok(!seen.has(v.id), `${v.id}: duplicate id`); seen.add(v.id);
    assert.ok(PALETTES.furniture.some(p => p.id === v.palette), `${v.id}: palette "${v.palette}" is not in PALETTES.furniture`);
    assert.ok(v.sizeCm.w > 0 && v.sizeCm.d > 0, `${v.id}: sizeCm.w/d must be positive`);
    assert.ok(v.sizeCm.h === null || v.sizeCm.h > 0, `${v.id}: sizeCm.h must be positive or unknown`);
    const suffix = v.id.match(/-(\d+)$/);
    assert.ok(suffix, `${v.id}: id must end with a numeric suffix`);
    assert.equal(Number(suffix![1]), v.sizeCm.w, `${v.id}: numeric id suffix must equal sizeCm.w`);
    assert.ok(v.recommendedProfiles && v.recommendedProfiles.length > 0, `${v.id}: needs a non-empty recommendedProfiles`);
  }
});

test('every sofa/chair variant with any declared tags also declares its seating role', () => {
  // fromVariant() only fills in an implicit seating/work-seating tag when a
  // variant has no tags at all. A variant that declares any other tags (e.g.
  // 'corner') must list its role tag itself or it silently loses seating
  // semantics (data.ts:42).
  for (const v of CATALOGUE.filter(v => v.kind === 'sofa' || v.kind === 'chair')) {
    if (!v.tags) continue;
    assert.ok(v.tags.includes('seating') || v.tags.includes('work-seating'), `${v.id}: declares tags but omits 'seating'/'work-seating'`);
  }
});

test('each profile offers at least one variant of every kind its brief can require', () => {
  const forProfile = (kind: RoomProfile['kind']) => CATALOGUE.filter(v => v.recommendedProfiles?.includes(kind));
  const lounge = forProfile('lounge');
  assert.ok(lounge.some(v => v.kind === 'sofa'));
  assert.ok(lounge.some(v => v.kind === 'tv'));
  const bedroom = forProfile('bedroom');
  assert.ok(bedroom.some(v => v.kind === 'bed'));
  assert.ok(bedroom.some(v => v.tags?.includes('wardrobe') || v.tags?.includes('clothes-storage')));
  assert.ok(bedroom.some(v => v.kind === 'desk'));
  assert.ok(bedroom.some(v => v.kind === 'chair'));
  const office = forProfile('home_office');
  assert.ok(office.some(v => v.kind === 'desk'));
  assert.ok(office.some(v => v.kind === 'chair'));
  assert.ok(office.some(v => v.tags?.includes('office-storage')));
  const bathroom = forProfile('bathroom_concept');
  assert.ok(bathroom.some(v => v.kind === 'rug'));
  assert.ok(bathroom.some(v => v.kind === 'storage'));
});

test('the bed catalogue grew with a fourth sleep variant', () => {
  // expansion-visuals.test.ts already puts every bed through the full 3D
  // envelope check; this only confirms the day bed actually joined the set.
  const beds = CATALOGUE.filter(v => v.kind === 'bed');
  assert.ok(beds.length >= 4, 'single, double, king and day bed variants must be present');
  assert.ok(beds.some(v => v.id === 'haven-day-90'));
});

test('every form has a board label, and every variant briefs the agent that picks it', () => {
  // The 2D label is what stops eighteen storage variants all reading "STORAGE",
  // and `description` is the only prose listCatalogue hands an agent, so it has
  // to say what the piece is FOR, not just what it is.
  for (const form of Object.keys(FORM_PARTS) as Form[]) {
    const label = FORM_LABEL[form];
    assert.ok(label && label === label.toUpperCase(), `${form}: needs an uppercase board label`);
    assert.ok(label.length <= 9, `${form}: "${label}" is too long for the 5-11px board label`);
  }
  for (const v of CATALOGUE) {
    assert.ok(v.description.length >= 20, `${v.id}: description is too thin to guide a choice`);
    assert.ok(!/\d+\s*cm\b/.test(v.description.replace(/·.*$/, '')), `${v.id}: do not hard-code a clearance in cm — the rules are agent-configurable`);
    if (v.form) assert.ok(FORM_LABEL[v.form], `${v.id}: form "${v.form}" has no board label`);
  }
});
