export type Schema = { type?: string; properties?: Record<string, Schema>; required?: string[]; additionalProperties?: boolean; enum?: readonly unknown[]; minimum?: number; maximum?: number; minLength?: number; maxLength?: number; items?: Schema; minItems?: number; maxItems?: number; anyOf?: Schema[]; description?: string };
const str: Schema = { type: 'string', minLength: 1, maxLength: 100 };
const num = (minimum = 0, maximum = 1000): Schema => ({ type: 'number', minimum, maximum });
const integer = (minimum = 0, maximum = 10000): Schema => ({ type: 'integer', minimum, maximum });
const bool: Schema = { type: 'boolean' };
export const object = (properties: Record<string, Schema>, required: string[] = []): Schema => ({ type: 'object', properties, required, additionalProperties: false });
const wall = { type: 'string', enum: ['north', 'east', 'south', 'west'] };
const floorPoint = object({ xCm: num(0, 1000), yCm: num(0, 1000) }, ['xCm', 'yCm']);
export const floorPlanSchema = object({ kind: { enum: ['rectilinear'] }, points: { type: 'array', items: floorPoint, minItems: 4, maxItems: 24 } }, ['kind', 'points']);
// Checked wall-backed candidates may use a fractional cell so measured
// 25/32/35/45 cm depths can sit flush rather than inherit a grid-only gap.
const origin = object({ x: num(-50, 50), y: num(-50, 50) }, ['x', 'y']);
const anchor = object({ wall, segmentId: str, offsetCm: num(-1000, 1000) }, ['wall', 'offsetCm']);
const rotation = { type: 'integer', enum: [0, 90, 180, 270] };
const kind = { type: 'string', enum: ['sofa', 'chair', 'table', 'coffee_table', 'desk', 'storage', 'bed', 'tv', 'rug', 'plant', 'other'] };
const profileKind = { type: 'string', enum: ['lounge', 'bedroom', 'home_office', 'bathroom_concept'] };
const generatedProfile = { anyOf: [
  object({ kind: { enum: ['lounge'] } }, ['kind']),
  object({ kind: { enum: ['bedroom'] }, sleeping: { enum: ['single', 'double', 'king'] }, workspace: bool, storage: bool, bedsideQuantity: integer(0, 2) }, ['kind', 'sleeping', 'workspace', 'storage']),
  object({ kind: { enum: ['home_office'] }, seating: bool, storage: bool }, ['kind', 'seating', 'storage']),
] };
const openingBase = { id: str, wall, segmentId: str, offsetCm: num(), widthCm: num(20, 400) };
export const openingSchema = { anyOf: [
  object({ ...openingBase, kind: { enum: ['door'] }, hinge: { enum: ['start', 'end'] }, swing: { enum: ['in', 'out'] }, angle: { enum: [90] }, mechanism: { enum: ['hinged', 'pocket', 'bifold', 'sliding'] }, entrance: bool }, ['id', 'kind', 'wall', 'offsetCm', 'widthCm', 'hinge', 'swing', 'angle', 'mechanism', 'entrance']),
  object({ ...openingBase, kind: { enum: ['window'] }, sillCm: num(0, 500), headCm: num(1, 500), type: { enum: ['fixed', 'side_hinge', 'sash', 'unknown'] }, windowAccess: bool }, ['id', 'kind', 'wall', 'offsetCm', 'widthCm', 'sillCm', 'headCm', 'type', 'windowAccess'])
] };
const patch = { originCell: origin, rotation, variantId: str, targetSofaId: str, linkedDeskId: str, wallAnchor: anchor, elevationCm: num(0, 500) };
const placementPatch = { originCell: origin, rotation, targetSofaId: str, linkedDeskId: str, wallAnchor: anchor, elevationCm: num(0, 500) };
const mutation = { proposalId: str, revision: integer(1) };
const mutationRequired = ['proposalId', 'revision'];
const snapshot = { which: { enum: ['current', 'proposal'] }, revision: integer(1) };
const candidatePlacement = object({ ...mutation, candidateId: str, idempotencyKey: str }, [...mutationRequired, 'candidateId', 'idempotencyKey']);
const cataloguePlacement = object({ ...mutation, variantId: str, ...placementPatch, idempotencyKey: str }, [...mutationRequired, 'variantId', 'idempotencyKey']);
const ownedPlacement = object({ ...mutation, ownedId: str, ...placementPatch, idempotencyKey: str }, [...mutationRequired, 'ownedId', 'idempotencyKey']);
export const TOOL_SCHEMAS: Record<string, { title: string; description: string; inputSchema: Schema; readOnly: boolean }> = {
  generateRoom: { title: 'Generate a room proposal', readOnly: false, description: 'Create a separate furnished room proposal in centimetres. For an L-shape or nook, pass floorPlan as 4–24 ordered rectilinear corner points; width/depth are its bounding box. Points define wall-1, wall-2, etc. in order, and openings on a custom plan name segmentId plus its outward wall direction. Include a profile and entrance. The human alone applies it. Check the returned validation, brief and omissions.', inputSchema: object({ name: str, widthCm: num(240, 1000), depthCm: num(240, 1000), floorPlan: floorPlanSchema, profile: generatedProfile, openings: { type: 'array', items: openingSchema, maxItems: 12 }, appearance: object({ wall: str, floor: str, furniture: str }), variantIds: { type: 'array', items: str, maxItems: 8 }, quantities: { type: 'array', items: object({ variantId: str, quantity: integer(1, 4) }, ['variantId', 'quantity']), maxItems: 8 }, idempotencyKey: str }, ['name', 'widthCm', 'depthCm', 'profile', 'openings', 'idempotencyKey']) },
  getRoomState: { title: 'Read the room', readOnly: true, description: 'Read accepted room, rules, authoritative ownership, revision and brief. Coordinates are centimetres, grid origin top-left; x east and y south. Never changes the selected view.', inputSchema: object(snapshot, ['which']) },
  listFurniture: { title: 'List furniture', readOnly: true, description: 'List placed pieces and authoritative owned inventory with measured sizes and locks. Read only.', inputSchema: object({ ...snapshot, offset: integer(), limit: integer(1, 50) }, ['which']) },
  listCatalogue: { title: 'Browse the catalogue', readOnly: true, description: 'List named furniture variants and local wall/floor palettes. Optional filters narrow furniture only. Results page via offset/limit; check hasMore rather than assuming one page holds the whole catalogue. Read only.', inputSchema: object({ kind, profile: profileKind, tag: str, offset: integer(), limit: integer(1, 50) }) },
  createProposal: { title: 'Start a draft', readOnly: false, description: 'Create a layout draft copied from Current, or a setup draft for human confirmation. Never overwrites an active draft. Requires accepted current/rule revisions and an idempotency key.', inputSchema: object({ kind: { enum: ['layout', 'setup'] }, expectedCurrentRevision: integer(1), expectedRuleRevision: integer(1), idempotencyKey: str }, ['kind', 'expectedCurrentRevision', 'expectedRuleRevision', 'idempotencyKey']) },
  setRoomGeometry: { title: 'Set room outline', readOnly: false, description: 'Stage room bounding dimensions, name, or a measured rectilinear floorPlan. Custom points define wall-1, wall-2, etc. in order; pass null to return to the rectangular bounding box. Human Confirm room inputs is required. Existing fixed fixtures and openings are revalidated against the new outline.', inputSchema: object({ ...mutation, widthCm: num(240, 1000), depthCm: num(240, 1000), floorPlan: { anyOf: [floorPlanSchema, { enum: [null] }] }, name: str }, mutationRequired) },
  setOpening: { title: 'Set a door or window', readOnly: false, description: 'Stage a complete door or window record in a setup proposal. On custom plans, segmentId names wall-1, wall-2, etc.; offset runs from that segment’s top/left endpoint and wall is its outward direction. Accepted openingLocks are human-only pins and cannot be overridden. Hinged doors use an open 90 degree pose; unsupported mechanisms are explicitly blocked.', inputSchema: object({ ...mutation, opening: openingSchema }, [...mutationRequired, 'opening']) },
  setConstraints: { title: 'Set planning rules', readOnly: false, description: 'Stage rule assumptions and required kinds in a setup proposal. Cannot modify an owned requirement or accepted rules without human confirmation. Cell size remains 20 cm.', inputSchema: object({ ...mutation, constraints: object({ H_lowCm: num(0, 300), walkHardCm: num(20, 200), walkPreferredCm: num(20, 200), storageFrontCm: num(20, 200), chairPullCm: num(20, 200), bedLongSideAccessCm: num(20, 200), radiatorFrontCm: num(0, 100), windowFrontCm: num(0, 100), ceilingCm: num(100, 500), requiredKinds: { type: 'array', items: kind, maxItems: 12 }, deskNearWindow: bool, openFloorM2: num(0, 100) }) }, [...mutationRequired, 'constraints']) },
  placeFurniture: { title: 'Place a piece', readOnly: false, description: 'Place one catalogue variant, one owned instance, or one checked candidate in a layout proposal. Owned sizes and locks remain authoritative.', inputSchema: { anyOf: [candidatePlacement, cataloguePlacement, ownedPlacement] } },
  updateFurniture: { title: 'Move or change a piece', readOnly: false, description: 'Move, quarter-turn, choose a named variant, change TV wall anchor/target sofa, or link a desk chair in a layout proposal. Cannot set size, ownership, height class, locks or required status. Candidate references must be current.', inputSchema: object({ ...mutation, ...patch, objectId: str, candidateId: str }, [...mutationRequired, 'objectId']) },
  removeFurniture: { title: 'Remove a piece', readOnly: false, description: 'Remove an unprotected piece from a layout proposal. Fixed, locked and required owned pieces cannot be removed. Optional owned omissions are reported.', inputSchema: object({ ...mutation, objectId: str }, [...mutationRequired, 'objectId']) },
  findPlacements: { title: 'Find checked placements', readOnly: true, description: 'Search checked placements for an object or variant without changing the draft. Results are ranked by furniture-function rules before decorative preferences and include the checked rule set plus facing/back-wall diagnostics. A chair search may name its desk. Bounded results are not proof of infeasibility.', inputSchema: object({ ...mutation, objectId: str, variantId: str, linkedDeskId: str, limit: integer(1, 8), avoidFlags: { type: 'array', items: { enum: ['door_swing_reserved', 'window_envelope', 'radiator_keepout', 'tv_blocked', 'tv_unknown'] }, maxItems: 5 } }, mutationRequired) },
  proposeLayout: { title: 'Plan a layout', readOnly: false, description: 'Run the bounded local planner in an existing layout proposal. It preserves owned locks and may return partial results. Supply an idempotency key to safely replay a completed request.', inputSchema: object({ ...mutation, variantIds: { type: 'array', items: str, maxItems: 8 }, quantities: { type: 'array', items: object({ variantId: str, quantity: integer(1, 4) }, ['variantId', 'quantity']), maxItems: 8 }, idempotencyKey: str }, mutationRequired) },
  setAppearance: { title: 'Change a finish', readOnly: false, description: 'Change a proposal wall, floor, or furniture finish from listCatalogue. Geometry and rule flags stay unchanged; Apply remains human-only.', inputSchema: { anyOf: [object({ ...mutation, target: { enum: ['wall', 'floor'] }, paletteId: str }, [...mutationRequired, 'target', 'paletteId']), object({ ...mutation, target: { enum: ['furniture'] }, paletteId: str, objectId: str }, [...mutationRequired, 'target', 'paletteId', 'objectId'])] } },
  checkLayout: { title: 'Check the layout', readOnly: true, description: 'Read the shared engine report without changing draft readiness or view. Supports rule-code, object and region filters, and paginated issues or cells. Full-layout status and brief remain explicit even for focused reports.', inputSchema: object({ ...snapshot, candidateId: str, detail: { enum: ['issues', 'flags'] }, ruleCode: str, objectId: str, region: object({ x: integer(0, 50), y: integer(0, 50), w: integer(1, 50), d: integer(1, 50) }, ['x', 'y', 'w', 'd']), offset: integer(), limit: integer(1, 100) }, ['which']) },
};
export function validateSchema(value: unknown, schema: Schema, path = 'arguments'): string | null {
  if (schema.anyOf) return schema.anyOf.some(s => !validateSchema(value, s, path)) ? null : `${path} does not match a supported record.`;
  if (schema.enum && !schema.enum.includes(value)) return `${path} must be one of ${schema.enum.join(', ')}.`;
  if (schema.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return `${path} must be an object.`;
    const v = value as Record<string, unknown>;
    for (const k of Object.keys(v)) { if (!Object.hasOwn(schema.properties || {}, k)) return `${path}.${k} is not an accepted property.`; const error = validateSchema(v[k], schema.properties![k], `${path}.${k}`); if (error) return error; }
    for (const k of schema.required || []) if (!Object.hasOwn(v, k)) return `${path}.${k} is required.`;
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || (schema.minItems !== undefined && value.length < schema.minItems) || (schema.maxItems !== undefined && value.length > schema.maxItems)) return `${path} must be a bounded array.`;
    for (const [i, item] of value.entries()) { const error = validateSchema(item, schema.items!, `${path}[${i}]`); if (error) return error; }
  } else if (schema.type === 'number' || schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (schema.type === 'integer' && !Number.isInteger(value)) || (schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum)) return `${path} must be a finite ${schema.type} in the allowed range.`;
  } else if (schema.type === 'string') {
    if (typeof value !== 'string' || value.length < (schema.minLength || 0) || value.length > (schema.maxLength || Infinity)) return `${path} must be a nonempty bounded string.`;
  } else if (schema.type === 'boolean' && typeof value !== 'boolean') return `${path} must be a boolean.`;
  return null;
}
