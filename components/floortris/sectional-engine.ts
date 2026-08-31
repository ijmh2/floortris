/** Production validation facade for declarative sectional furniture.
 *
 * The legacy engine remains the single rule implementation. A persisted
 * sectional is expanded transiently into non-overlapping module rectangles,
 * validated, then collapsed back to its one authoritative parent ID. Nothing
 * module-shaped is ever stored, exposed as inventory, or independently edited.
 */
export * from './engine.ts';
import { bounds as baseBounds, validate as baseValidate } from './engine.ts';
import { exposedFrontSpans, transformedModuleFacing, transformedModuleRect } from './sectional.ts';
import { clone, key, type ActivityZone, type Furniture, type Issue, type Layout, type Rect, type Report, type Room, type Rules, type Rotation, type SectionalModule, type Wall } from './model.ts';

const ROTATION_FOR: Record<Wall, Rotation> = { south: 0, west: 90, north: 180, east: 270 };
const INTERNAL = '::sectional-module::';

function proxyForRect(parent: Furniture, rect: Rect, id: string, kind: Furniture['kind'], facing: Wall, module: SectionalModule): Furniture {
  const rotation = ROTATION_FOR[facing], turned = rotation === 90 || rotation === 270;
  return {
    id, label: `${parent.label} · ${module.id}`, kind, ownership: 'catalogue',
    sizeCm: { w: turned ? rect.d : rect.w, d: turned ? rect.w : rect.d, h: module.heightCm },
    originCell: { x: rect.x / 20, y: rect.y / 20 }, rotation, elevationCm: parent.elevationCm,
    locked: {}, appearance: parent.appearance, requiredInRoom: false, tags: [],
  };
}

function primaryModule(item: Furniture): SectionalModule {
  const matching = item.geometry!.modules.filter(module => module.facing === item.geometry!.primaryFacing);
  return [...matching].sort((a, b) => Math.max(b.widthCm, b.depthCm) - Math.max(a.widthCm, a.depthCm))[0];
}

function expandItem(item: Furniture, cellCm: number, primaryAsSofa = true): { pieces: Furniture[]; childIds: string[] } {
  if (!item.geometry) return { pieces: [item], childIds: [] };
  const primary = primaryModule(item), pieces: Furniture[] = [], childIds: string[] = [];
  for (const section of item.geometry.modules) {
    const id = section === primary && primaryAsSofa ? item.id : `${item.id}${INTERNAL}${section.id}`;
    const proxy = proxyForRect(item, transformedModuleRect(item, section, cellCm), id, section === primary && primaryAsSofa ? 'sofa' : 'other', transformedModuleFacing(item, section), section);
    pieces.push(proxy); if (id !== item.id) childIds.push(id);
  }
  return { pieces, childIds };
}

function expandLayout(layout: Layout, cellCm: number): { layout: Layout; childToParent: Map<string, string> } {
  const furniture: Furniture[] = [], childToParent = new Map<string, string>();
  for (const item of layout.furniture) {
    const expanded = expandItem(item, cellCm);
    furniture.push(...expanded.pieces); expanded.childIds.forEach(id => childToParent.set(id, item.id));
  }
  return { layout: { ...layout, furniture }, childToParent };
}

const remapIds = (ids: string[], mapping: Map<string, string>) => [...new Set(ids.map(id => mapping.get(id) || id))];
function collapseReport(report: Report, mapping: Map<string, string>): Report {
  const issues = report.issues.map(issue => ({ ...issue, objectIds: remapIds(issue.objectIds, mapping), ...(issue.fix?.args.objectId && mapping.has(issue.fix.args.objectId as string) ? { fix: { ...issue.fix, args: { ...issue.fix.args, objectId: mapping.get(issue.fix.args.objectId as string)! } } } : {}) }))
    .filter(issue => !(issue.code === 'solid_overlap' && issue.objectIds.length < 2));
  const uniqueIssues: Issue[] = [];
  for (const issue of issues) {
    const signature = `${issue.code}|${issue.severity}|${[...issue.objectIds].sort().join(',')}|${issue.cells.map(key).sort().join(';')}`;
    if (!uniqueIssues.some(existing => `${existing.code}|${existing.severity}|${[...existing.objectIds].sort().join(',')}|${existing.cells.map(key).sort().join(';')}` === signature)) uniqueIssues.push(issue);
  }
  const zones = report.zones.map(zone => ({ ...zone, objectId: mapping.get(zone.objectId) || zone.objectId, id: [...mapping].reduce((id, [child, parent]) => id.replace(child, parent), zone.id) }));
  const cells = report.cells.map(cell => ({ ...cell, objectIds: remapIds(cell.objectIds, mapping) }));
  const hardFailures = uniqueIssues.filter(issue => issue.severity === 'block').length, warnings = uniqueIssues.filter(issue => issue.severity === 'warning').length;
  return { ...report, issues: uniqueIssues, zones, cells, validation: { status: hardFailures ? 'blocked' : warnings ? 'warnings' : 'ok', hardFailures, warnings } };
}

function probeRect(item: Furniture, module: SectionalModule, start: number, end: number, cellCm: number): Rect {
  const local = { ...module };
  if (module.facing === 'north' || module.facing === 'south') { local.xCm = start; local.widthCm = end - start; }
  else { local.yCm = start; local.depthCm = end - start; }
  return transformedModuleRect(item, local, cellCm);
}

function frontageProbe(layout: Layout, item: Furniture, module: SectionalModule, span: { start: number; end: number }, room: Room, rules: Rules, inventory: Furniture[]): { zones: ActivityZone[]; issues: Issue[] } {
  const target = probeRect(item, module, span.start, span.end, rules.cellCm), facing = transformedModuleFacing(item, module);
  const replacement: Furniture[] = [], mapping = new Map<string, string>();
  for (const candidate of layout.furniture) {
    if (candidate.id !== item.id) {
      const expanded = expandItem(candidate, rules.cellCm);
      replacement.push(...expanded.pieces.map(clone)); expanded.childIds.forEach(id => mapping.set(id, candidate.id));
      continue;
    }
    for (const own of candidate.geometry!.modules) {
      if (own !== module) replacement.push(proxyForRect(candidate, transformedModuleRect(candidate, own, rules.cellCm), `${candidate.id}${INTERNAL}${own.id}`, 'other', transformedModuleFacing(candidate, own), own));
    }
    const horizontal = module.facing === 'north' || module.facing === 'south', before = horizontal ? span.start - module.xCm : span.start - module.yCm, after = horizontal ? module.xCm + module.widthCm - span.end : module.yCm + module.depthCm - span.end;
    if (before > 1e-6) {
      const local = { ...module, ...(horizontal ? { widthCm: before } : { depthCm: before }) };
      replacement.push(proxyForRect(candidate, transformedModuleRect(candidate, local, rules.cellCm), `${candidate.id}${INTERNAL}${module.id}-before`, 'other', facing, local));
    }
    replacement.push(proxyForRect(candidate, target, candidate.id, 'sofa', facing, { ...module, widthCm: horizontal ? span.end - span.start : module.widthCm, depthCm: horizontal ? module.depthCm : span.end - span.start }));
    if (after > 1e-6) {
      const local = { ...module, ...(horizontal ? { xCm: span.end, widthCm: after } : { yCm: span.end, depthCm: after }) };
      replacement.push(proxyForRect(candidate, transformedModuleRect(candidate, local, rules.cellCm), `${candidate.id}${INTERNAL}${module.id}-after`, 'other', facing, local));
    }
  }
  // Only the primary-facing front may treat a coffee table as a semantic
  // frontage exemption. On return fronts it remains an ordinary solid object.
  const primaryGlobal = transformedModuleFacing(item, { ...module, facing: item.geometry!.primaryFacing });
  if (facing !== primaryGlobal) replacement.forEach(piece => { if (piece.kind === 'coffee_table') piece.kind = 'other'; });
  const probe = baseValidate({ ...layout, furniture: replacement }, room, rules, inventory, false);
  const zone = probe.zones.find(candidate => candidate.id === `sofa:${item.id}`);
  const relevant = probe.issues.filter(issue => issue.objectIds.includes(item.id) && (issue.code === 'sofa_front_blocked' || (issue.code === 'path_broken' && issue.destinationId === `sofa:${item.id}`) || issue.code === 'walk_tight'));
  const suffix = `${module.id}:${span.start}-${span.end}`;
  replacement.filter(piece => piece.id.includes(INTERNAL) && piece.id.startsWith(item.id)).forEach(piece => mapping.set(piece.id, item.id));
  return { zones: zone ? [{ ...zone, id: `sofa:${item.id}:${suffix}`, label: `${item.label} ${module.id} exposed front` }] : [], issues: relevant.map(issue => ({ ...issue, objectIds: remapIds(issue.objectIds, mapping), ...(issue.destinationId ? { destinationId: `sofa:${item.id}:${suffix}` } : {}) })) };
}

export function validate(layout: Layout, room: Room, rules: Rules, inventory: Furniture[] = [], includeFixes = true): Report {
  const sectionals = layout.furniture.filter(item => item.geometry?.type === 'sectional');
  if (!sectionals.length) return baseValidate(layout, room, rules, inventory, includeFixes);
  const expanded = expandLayout(layout, rules.cellCm);
  const report = collapseReport(baseValidate(expanded.layout, room, rules, inventory, includeFixes), expanded.childToParent);
  const ids = new Set(sectionals.map(item => item.id));
  report.zones = report.zones.filter(zone => !(ids.has(zone.objectId) && zone.id.startsWith('sofa:')));
  report.issues = report.issues.filter(issue => !((issue.code === 'sofa_front_blocked' || issue.code === 'walk_tight' || (issue.code === 'path_broken' && issue.destinationId?.startsWith('sofa:'))) && issue.objectIds.some(id => ids.has(id))));
  for (const item of sectionals) for (const section of item.geometry!.modules) for (const span of exposedFrontSpans(item.geometry!, section)) {
    const probe = frontageProbe(layout, item, section, span, room, rules, inventory);
    report.zones.push(...probe.zones); report.issues.push(...probe.issues);
  }
  const hardFailures = report.issues.filter(issue => issue.severity === 'block').length, warnings = report.issues.filter(issue => issue.severity === 'warning').length;
  report.validation = { status: hardFailures ? 'blocked' : warnings ? 'warnings' : 'ok', hardFailures, warnings };
  report.checkedRules = [...new Set([...report.checkedRules, 'sectional_exact_union', 'sectional_exposed_fronts'])];
  return clone(report);
}

export const bounds = baseBounds;
