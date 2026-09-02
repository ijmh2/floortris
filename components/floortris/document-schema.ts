import { CATALOGUE, PALETTES } from './data.ts';
import { invalidCustomFurnitureRecord } from './custom-furniture.ts';
import { validate } from './sectional-engine.ts';
import type { AppState, Furniture, Layout, Room } from './model.ts';
import { validateRoomInputs } from './room-inputs.ts';
import { accessibilitySchema, measurementContextSchema, object, openingSchema, validateSchema, type Schema } from './schemas.ts';

/** The persisted JSON contract is closed and versioned. TypeScript types alone
 * do not validate untrusted local-storage/import data. */
export const FLOORTRIS_DOCUMENT_SCHEMA_VERSION = 2;
const str = (maxLength = 100): Schema => ({ type: 'string', minLength: 1, maxLength });
const num = (minimum: number, maximum: number): Schema => ({ type: 'number', minimum, maximum });
const integer = (minimum = 0, maximum = Number.MAX_SAFE_INTEGER): Schema => ({ type: 'integer', minimum, maximum });
const bool: Schema = { type: 'boolean' };
const wall: Schema = { enum: ['north','east','south','west'] };
const kind: Schema = { enum: ['sofa','chair','table','coffee_table','desk','storage','bed','tv','rug','plant','window_treatment','ceiling_light','wall_light','floor_lamp','table_lamp','radiator','basin','toilet','shower','bath','towel_rail','other'] };
const id = str(100);
const cell = object({ x: num(-50, 50), y: num(-50, 50) }, ['x','y']);
const size = object({ w: num(.01, 1000), d: num(.01, 1000), h: { anyOf: [num(0, 500), { enum: [null] }] } }, ['w','d','h']);
const anchor = object({ wall, offsetCm: num(0, 1000), segmentId: id }, ['wall','offsetCm']);
const rect = object({ x: num(-1000, 1000), y: num(-1000, 1000), w: num(.01, 1000), d: num(.01, 1000) }, ['x','y','w','d']);
const locks = object({ position: bool, size: bool, rotation: bool, appearance: bool });
const provenance = object({ source: { enum: ['agent_authored_one_off'] }, tool: { enum: ['createCustomFurniture'] } }, ['source','tool']);
const moduleSchema = object({ id, type: { enum: ['seat','corner','chaise'] }, xCm: num(0,600), yCm: num(0,600), widthCm: num(20,300), depthCm: num(20,300), heightCm: num(20,150), facing: wall }, ['id','type','xCm','yCm','widthCm','depthCm','heightCm','facing']);
const geometry = object({ type: { enum: ['sectional'] }, primaryFacing: wall, chaiseSide: { enum: ['left','right'] }, modules: { type: 'array', items: moduleSchema, minItems: 2, maxItems: 12 } }, ['type','primaryFacing','modules']);
const furniture = object({
  id, label: str(100), kind, ownership: { enum: ['owned','catalogue','custom','fixed'] }, sizeCm: size,
  rotation: { enum: [0,90,180,270] }, originCell: cell, variantId: id, backEdge: wall,
  elevationCm: num(0,500), wallAnchor: anchor, locked: locks, appearance: str(50),
  requiredInRoom: bool, targetSofaId: id, linkedDeskId: id, attachedOpeningId: id,
  supportObjectId: id, fixtureType: { enum: ['curtains','blind','pendant','flush','track','recessed','wall_sconce','floor_lamp','table_lamp'] },
  lightingZone: { enum: ['ambient','seating','reading','circulation'] }, customProvenance: provenance,
  geometry, tags: { type: 'array', items: str(50), maxItems: 20 }, sleepSize: { enum: ['single','double','king'] },
  conceptualOnly: bool, clearance: object({ label: str(100), rect }, ['label','rect']),
}, ['id','label','kind','ownership','sizeCm','rotation','originCell','elevationCm','locked','appearance','requiredInRoom','tags']);
const appearance = object({ wall: str(50), floor: str(50) }, ['wall','floor']);
const layout = object({ furniture: { type: 'array', items: furniture, maxItems: 60 }, appearance }, ['furniture','appearance']);
const floorPoint = object({ xCm: num(0,1000), yCm: num(0,1000) }, ['xCm','yCm']);
const floorPlan = object({ kind: { enum: ['rectilinear'] }, points: { type: 'array', items: floorPoint, minItems: 4, maxItems: 24 } }, ['kind','points']);
const profile: Schema = { anyOf: [
  object({ kind: { enum: ['lounge'] } }, ['kind']),
  object({ kind: { enum: ['bedroom'] }, sleeping: { enum: ['single','double','king'] }, workspace: bool, storage: bool, bedsideQuantity: integer(0,2) }, ['kind','sleeping','workspace','storage']),
  object({ kind: { enum: ['home_office'] }, seating: bool, storage: bool }, ['kind','seating','storage']),
  object({ kind: { enum: ['bathroom_concept'] }, fixtureIds: { type: 'array', items: id, maxItems: 12 }, conceptualOnly: { enum: [true] } }, ['kind','fixtureIds','conceptualOnly']),
] };
const accommodation = object({ packId:id,providerId:id,buildingId:id,roomId:id,approvedVariantIds:{type:'array',items:id,maxItems:100},fixedFurnitureIds:{type:'array',items:id,maxItems:30},restrictions:{type:'array',items:str(300),maxItems:30} }, ['packId','providerId','buildingId','roomId','approvedVariantIds','fixedFurnitureIds','restrictions']);
const room = object({ name: str(100), widthCm: num(240,1000), depthCm: num(240,1000), floorPlan, openings: { type: 'array', items: openingSchema, maxItems: 12 }, fixtures: { type: 'array', items: furniture, maxItems: 12 }, openingLocks: { type: 'array', items: id, maxItems: 12 }, profile, measurementContext:measurementContextSchema, accommodation }, ['name','widthCm','depthCm','openings','fixtures']);
const rules = object({ cellCm: { enum: [20] }, H_lowCm: num(0,300), walkHardCm: num(20,200), walkPreferredCm: num(20,200), storageFrontCm: num(20,200), chairPullCm: num(20,200), bedLongSideAccessCm: num(20,200), radiatorFrontCm: num(0,100), windowFrontCm: num(0,100), ceilingCm: num(100,500), requiredKinds: { type: 'array', items: kind, maxItems: 12 }, deskNearWindow: bool, openFloorM2: num(0,100), accessibility:accessibilitySchema }, ['cellCm','H_lowCm','walkHardCm','walkPreferredCm','storageFrontCm','chairPullCm','bedLongSideAccessCm','radiatorFrontCm','windowFrontCm','ceilingCm','requiredKinds','deskNearWindow','openFloorM2']);
const checkedAlternative = object({ trials: integer(), placementStatus: str(50), layoutStatus: str(50), proposalRevision: integer(1), ruleRevision: integer(1) }, ['trials','placementStatus','layoutStatus','proposalRevision','ruleRevision']);
const omission = object({ objectId: id, variantId: id, reason: str(500), alternativeVariantId: id, alternativeChecked: checkedAlternative }, ['reason']);
const proposal = object({ id, kind: { enum: ['layout','setup'] }, revision: integer(1), baseCurrentRevision: integer(1), baseRuleRevision: integer(1), baseLayout: layout, layout, room, rules, omitted: { type: 'array', items: omission, maxItems: 60 } }, ['id','kind','revision','baseCurrentRevision','baseRuleRevision','layout','room','rules','omitted']);
export const persistedDocumentSchema = object({ version: { enum: [1,FLOORTRIS_DOCUMENT_SCHEMA_VERSION] }, documentId: id, currentRevision: integer(1), ruleRevision: integer(1), current: layout, room, rules, inventory: { type: 'array', items: furniture, maxItems: 60 }, proposal: { anyOf: [proposal,{ enum: [null] }] }, sequence: integer() }, ['version','currentRevision','ruleRevision','current','room','rules','inventory','proposal','sequence']);

const safeIdentifier = (value: string) => !/[\u0000-\u001f\u007f<>]/.test(value) && !['__proto__','prototype','constructor'].includes(value);
const unique = (values: string[]) => new Set(values).size === values.length;
const knownFurniturePalette = new Set(PALETTES.furniture.map(p => p.id));
const knownWallPalette = new Set(PALETTES.wall.map(p => p.id));
const knownFloorPalette = new Set(PALETTES.floor.map(p => p.id));
const ownedTags = new Set(['seating','single','double','king','wardrobe','clothes-storage','bedside']);

function itemError(item: Furniture, context: 'layout'|'inventory'|'fixture'): string | null {
  if (!safeIdentifier(item.id) || !unique(item.tags)) return `${item.id || 'Furniture'} has invalid identity/tag authority.`;
  if (item.ownership === 'custom') return context === 'layout' ? invalidCustomFurnitureRecord(item) : 'Custom furniture is only valid in a layout.';
  if (item.customProvenance || (item.geometry && item.ownership !== 'catalogue')) return `${item.id} forges custom provenance/geometry.`;
  if ((item.targetSofaId && item.kind !== 'tv') || (item.linkedDeskId && item.kind !== 'chair') || (item.attachedOpeningId && item.kind !== 'window_treatment') || (item.supportObjectId && item.kind !== 'table_lamp')) return `${item.id} contains a relationship for the wrong furniture kind.`;
  if (item.wallAnchor && !['tv','wall_light','window_treatment','radiator','basin','toilet','shower','bath','towel_rail'].includes(item.kind)) return `${item.id} contains an unsupported wall mount.`;
  if (item.lightingZone && !['ceiling_light','wall_light','floor_lamp','table_lamp'].includes(item.kind)) return `${item.id} contains a forged lighting role.`;
  if (context === 'inventory' && item.ownership !== 'owned') return `${item.id} is not owned inventory.`;
  if (context === 'fixture' && item.ownership !== 'fixed') return `${item.id} is not a fixed room fixture.`;
  if (context === 'layout' && item.ownership === 'fixed') return `${item.id} embeds a fixed fixture in layout furniture.`;
  if (item.ownership === 'catalogue') {
    const variant = CATALOGUE.find(entry => entry.id === item.variantId);
    const canonicalTags = variant?.tags || (variant?.kind === 'sofa' ? ['seating'] : variant?.kind === 'chair' ? ['work-seating'] : []);
    const allowedTags = variant?.tags?.includes('bedside') ? [...canonicalTags, 'bedside-left', 'bedside-right'] : canonicalTags;
    if (!variant || variant.name !== item.label || variant.kind !== item.kind || variant.fixtureType !== item.fixtureType || variant.backEdge !== item.backEdge || JSON.stringify(variant.geometry) !== JSON.stringify(item.geometry) || item.requiredInRoom || item.tags.some(tag => !allowedTags.includes(tag)) || item.tags.filter(tag => tag === 'bedside-left' || tag === 'bedside-right').length > 1 || canonicalTags.some(tag => !item.tags.includes(tag))) return `${item.id} alters catalogue identity or semantic tags.`;
    if (item.kind !== 'window_treatment' && JSON.stringify(item.sizeCm) !== JSON.stringify(variant.sizeCm)) return `${item.id} alters catalogue measurements.`;
    if (!knownFurniturePalette.has(item.appearance)) return `${item.id} uses an unknown furniture palette.`;
  }
  if (item.ownership === 'owned') {
    if (item.variantId || item.fixtureType || item.wallAnchor || item.attachedOpeningId || item.supportObjectId || item.targetSofaId || item.conceptualOnly || item.clearance) return `${item.id} gives owned furniture an unsupported catalogue/fixed role.`;
    if (item.tags.some(tag => !ownedTags.has(tag))) return `${item.id} has an unsupported owned semantic tag.`;
    if (item.kind === 'bed' ? !item.sleepSize || !item.tags.includes(item.sleepSize) : item.sleepSize !== undefined) return `${item.id} has inconsistent bed authority.`;
  }
  if (item.ownership === 'fixed' && (!['radiator','basin','toilet','shower','bath','towel_rail'].includes(item.kind) || item.variantId || item.fixtureType || item.targetSofaId || item.linkedDeskId || item.attachedOpeningId || item.supportObjectId || item.sleepSize)) return `${item.id} is not a supported fixed fixture.`;
  if (item.ownership === 'fixed' && item.tags.some(tag => tag !== 'concept-fixture')) return `${item.id} has an unsupported fixed-fixture semantic tag.`;
  if (!knownFurniturePalette.has(item.appearance)) return `${item.id} uses an unknown furniture palette.`;
  return null;
}

function layoutError(value: Layout, roomValue: Room, inventory: Furniture[], path: string): string | null {
  if (!knownWallPalette.has(value.appearance.wall) || !knownFloorPalette.has(value.appearance.floor)) return `${path} uses an unknown room palette.`;
  if (!unique(value.furniture.map(item => item.id))) return `${path} contains duplicate furniture IDs.`;
  const byId = new Map(value.furniture.map(item => [item.id,item]));
  if (value.furniture.some(item => roomValue.fixtures.some(fixture => fixture.id === item.id))) return `${path} reuses a fixed-fixture ID.`;
  for (const item of value.furniture) {
    const error = itemError(item,'layout'); if (error) return `${path}: ${error}`;
    if (item.targetSofaId && byId.get(item.targetSofaId)?.kind !== 'sofa') return `${item.id} targets a missing/non-sofa object.`;
    if (item.linkedDeskId && byId.get(item.linkedDeskId)?.kind !== 'desk') return `${item.id} links to a missing/non-desk object.`;
    if (item.supportObjectId && !['table','coffee_table','desk','storage'].includes(byId.get(item.supportObjectId)?.kind || '')) return `${item.id} names an invalid support.`;
    if (item.attachedOpeningId && !roomValue.openings.some(opening => opening.kind === 'window' && opening.id === item.attachedOpeningId)) return `${item.id} names a missing window.`;
    if (item.ownership === 'owned') {
      const source = inventory.find(entry => entry.id === item.id);
      if (!source || source.kind !== item.kind || JSON.stringify(source.sizeCm) !== JSON.stringify(item.sizeCm) || JSON.stringify(source.tags) !== JSON.stringify(item.tags) || source.requiredInRoom !== item.requiredInRoom || source.sleepSize !== item.sleepSize) return `${item.id} does not match authoritative owned inventory.`;
    }
  }
  return null;
}

export function validatePersistedDocument(value: unknown): string | null {
  const structural = validateSchema(value, persistedDocumentSchema, 'document'); if (structural) return structural;
  const state = value as AppState;
  if (state.documentId && !safeIdentifier(state.documentId)) return 'document.documentId is unsafe.';
  if (!unique(state.rules.requiredKinds) || !unique(state.inventory.map(item => item.id))) return 'Rules/inventory identifiers must be unique.';
  const roomIds = [...state.room.openings,...state.room.fixtures].map(feature => feature.id);
  if (!unique(roomIds) || roomIds.some(identifier => !safeIdentifier(identifier))) return 'Room feature identifiers must be unique and safe.';
  for (const item of state.inventory) { const error = itemError(item,'inventory'); if (error) return error; }
  for (const item of state.room.fixtures) { const error = itemError(item,'fixture'); if (error) return error; }
  const inputs = validateRoomInputs(state.room,state.rules); if (inputs) return inputs;
  if (state.room.accommodation && state.room.accommodation.fixedFurnitureIds.some(id => !state.current.furniture.some(item=>item.id===id&&item.locked.position&&item.locked.rotation&&item.locked.size))) return 'Accommodation fixed furniture must name locked pieces in Current.';
  const current = layoutError(state.current,state.room,state.inventory,'current'); if (current) return current;
  if (state.inventory.some(item => item.requiredInRoom && !state.current.furniture.some(placed => placed.id === item.id))) return 'Required owned inventory is missing from Current.';
  if (state.proposal) {
    if (!safeIdentifier(state.proposal.id) || state.proposal.baseCurrentRevision > state.currentRevision || state.proposal.baseRuleRevision > state.ruleRevision) return 'Proposal authority revisions are invalid.';
    const proposalInputs = validateRoomInputs(state.proposal.room,state.proposal.rules); if (proposalInputs) return `Proposal: ${proposalInputs}`;
    if (state.proposal.baseLayout) { const base = layoutError(state.proposal.baseLayout,state.room,state.inventory,'proposal.baseLayout'); if (base) return base; }
    const draft = layoutError(state.proposal.layout,state.proposal.room,state.inventory,'proposal.layout'); if (draft) return draft;
    if (state.proposal.omitted.some(entry => (entry.objectId && !safeIdentifier(entry.objectId)) || (entry.variantId && !CATALOGUE.some(variant => variant.id === entry.variantId)) || (entry.alternativeVariantId && !CATALOGUE.some(variant => variant.id === entry.alternativeVariantId)))) return 'Proposal omission references are invalid.';
  }
  try { validate(state.current,state.room,state.rules,state.inventory); } catch { return 'Current room cannot be validated.'; }
  return null;
}
