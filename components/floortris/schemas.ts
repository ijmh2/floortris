export type Schema = { type?: string; properties?: Record<string, Schema>; required?: string[]; additionalProperties?: boolean; enum?: readonly unknown[]; minimum?: number; maximum?: number; minLength?: number; maxLength?: number; items?: Schema; maxItems?: number; anyOf?: Schema[]; description?: string };
const str: Schema = { type: 'string', minLength: 1, maxLength: 100 };
const num = (minimum = 0, maximum = 1000): Schema => ({ type: 'number', minimum, maximum });
const integer = (minimum = 0, maximum = 10000): Schema => ({ type: 'integer', minimum, maximum });
const bool: Schema = { type: 'boolean' };
export const object = (properties: Record<string, Schema>, required: string[] = []): Schema => ({ type: 'object', properties, required, additionalProperties: false });
const wall = { type: 'string', enum: ['north', 'east', 'south', 'west'] };
const origin = object({ x: integer(-50, 50), y: integer(-50, 50) }, ['x', 'y']);
const anchor = object({ wall, offsetCm: num(-1000, 1000) }, ['wall', 'offsetCm']);
const rotation = { type: 'integer', enum: [0, 90, 180, 270] };
const kind = { type: 'string', enum: ['sofa', 'chair', 'table', 'coffee_table', 'desk', 'storage', 'bed', 'tv', 'rug', 'plant', 'other'] };
const profileKind = { type: 'string', enum: ['lounge', 'bedroom', 'home_office', 'bathroom_concept'] };
const generatedProfile = { anyOf: [
  object({ kind: { enum: ['lounge'] } }, ['kind']),
  object({ kind: { enum: ['bedroom'] }, sleeping: { enum: ['single', 'double', 'king'] }, workspace: bool, storage: bool, bedsideQuantity: integer(0, 2) }, ['kind', 'sleeping', 'workspace', 'storage']),
  object({ kind: { enum: ['home_office'] }, seating: bool, storage: bool }, ['kind', 'seating', 'storage']),
] };
const openingBase = { id: str, wall, offsetCm: num(), widthCm: num(20, 400) };
export const openingSchema = { anyOf: [
  object({ ...openingBase, kind: { enum: ['door'] }, hinge: { enum: ['start', 'end'] }, swing: { enum: ['in', 'out'] }, angle: { enum: [90] }, mechanism: { enum: ['hinged', 'pocket', 'bifold', 'sliding'] }, entrance: bool }, ['id', 'kind', 'wall', 'offsetCm', 'widthCm', 'hinge', 'swing', 'angle', 'mechanism', 'entrance']),
  object({ ...openingBase, kind: { enum: ['window'] }, sillCm: num(0, 500), headCm: num(1, 500), type: { enum: ['fixed', 'side_hinge', 'sash', 'unknown'] }, windowAccess: bool }, ['id', 'kind', 'wall', 'offsetCm', 'widthCm', 'sillCm', 'headCm', 'type', 'windowAccess'])
] };
const patch = { originCell: origin, rotation, variantId: str, targetSofaId: str, linkedDeskId: str, wallAnchor: anchor, elevationCm: num(0, 500) };
const mutation = { proposalId: str, revision: integer(1) };
const mutationRequired = ['proposalId', 'revision'];
const snapshot = { which: { enum: ['current', 'proposal'] }, revision: integer(1) };
export const TOOL_SCHEMAS: Record<string, { description: string; inputSchema: Schema; readOnly: boolean }> = {
  generateRoom: { readOnly: false, description: 'Start here to generate a NEW bedroom, lounge or home office in one call. Dimensions are centimetres (10 m = 1000 cm). Supply the room profile and all openings, including an entrance door. Creates and displays a separate furnished proposal; preserves the previous room, owned pieces, locks and active draft in Rooms. No Discard or setup confirmation needed for a new room. Does not apply furniture to Yours. Uses the shared bounded planner; inspect validation, brief and omitted for partial results. Retry the same request with the same idempotencyKey.', inputSchema: object({ name: str, widthCm: num(240, 1000), depthCm: num(240, 1000), profile: generatedProfile, openings: { type: 'array', items: openingSchema, maxItems: 12 }, appearance: object({ wall: str, floor: str, furniture: str }), variantIds: { type: 'array', items: str, maxItems: 8 }, quantities: { type: 'array', items: object({ variantId: str, quantity: integer(1, 4) }, ['variantId', 'quantity']), maxItems: 8 }, idempotencyKey: str }, ['name', 'widthCm', 'depthCm', 'profile', 'openings', 'idempotencyKey']) },
  getRoomState: { readOnly: true, description: 'Read accepted room, rules, authoritative ownership, revision and brief. Coordinates are centimetres, grid origin top-left; x east and y south. Never changes the selected view.', inputSchema: object(snapshot, ['which']) },
  listFurniture: { readOnly: true, description: 'List placed pieces and authoritative owned inventory with measured sizes and locks. Read only.', inputSchema: object({ ...snapshot, offset: integer(), limit: integer(1, 50) }, ['which']) },
  listCatalogue: { readOnly: true, description: 'List named available size variants and valid palette IDs. Optional profile/tag filters only narrow the list.', inputSchema: object({ kind, profile: profileKind, tag: str, offset: integer(), limit: integer(1, 50) }) },
  createProposal: { readOnly: false, description: 'Create a layout draft copied from Current, or a setup draft for human confirmation. Never overwrites an active draft. Requires accepted current/rule revisions and an idempotency key.', inputSchema: object({ kind: { enum: ['layout', 'setup'] }, expectedCurrentRevision: integer(1), expectedRuleRevision: integer(1), idempotencyKey: str }, ['kind', 'expectedCurrentRevision', 'expectedRuleRevision', 'idempotencyKey']) },
  setRoomGeometry: { readOnly: false, description: 'Stage rectangular room dimensions or name in a setup proposal. Human Confirm room inputs is required. Existing fixed fixtures remain present.', inputSchema: object({ ...mutation, widthCm: num(240, 1000), depthCm: num(240, 1000), name: str }, mutationRequired) },
  setOpening: { readOnly: false, description: 'Stage a complete door or window record in a setup proposal. Accepted openingLocks are human-only pins and cannot be overridden. Hinged doors use an open 90 degree pose; unsupported mechanisms are explicitly blocked.', inputSchema: object({ ...mutation, opening: openingSchema }, [...mutationRequired, 'opening']) },
  setConstraints: { readOnly: false, description: 'Stage rule assumptions and required kinds in a setup proposal. Cannot modify an owned requirement or accepted rules without human confirmation. Cell size remains 20 cm.', inputSchema: object({ ...mutation, constraints: object({ H_lowCm: num(0, 300), walkHardCm: num(20, 200), walkPreferredCm: num(20, 200), storageFrontCm: num(20, 200), chairPullCm: num(20, 200), bedLongSideAccessCm: num(20, 200), radiatorFrontCm: num(0, 100), windowFrontCm: num(0, 100), ceilingCm: num(100, 500), requiredKinds: { type: 'array', items: kind, maxItems: 12 }, deskNearWindow: bool, openFloorM2: num(0, 100) }) }, [...mutationRequired, 'constraints']) },
  placeFurniture: { readOnly: false, description: 'Place a named catalogue variant or an existing owned inventory instance into a layout proposal. Owned sizes and locks are authoritative. Candidate references are revalidated. Invalid geometry may be committed for visible repair.', inputSchema: object({ ...mutation, ...patch, ownedId: str, candidateId: str, idempotencyKey: str }, [...mutationRequired, 'idempotencyKey']) },
  updateFurniture: { readOnly: false, description: 'Move, quarter-turn, choose a named variant, change TV wall anchor/target sofa, or link a desk chair in a layout proposal. Cannot set size, ownership, height class, locks or required status. Candidate references must be current.', inputSchema: object({ ...mutation, ...patch, objectId: str, candidateId: str }, [...mutationRequired, 'objectId']) },
  removeFurniture: { readOnly: false, description: 'Remove an unprotected piece from a layout proposal. Fixed, locked and required owned pieces cannot be removed. Optional owned omissions are reported.', inputSchema: object({ ...mutation, objectId: str }, [...mutationRequired, 'objectId']) },
  findPlacements: { readOnly: true, description: 'Bounded deterministic checked placement search for an existing object or named variant. Does not modify the draft. Returns local placement validity separately from whole-layout status. At most 160 trial placements and 1800 ms; not a proof of infeasibility.', inputSchema: object({ ...mutation, objectId: str, variantId: str, limit: integer(1, 8), avoidFlags: { type: 'array', items: { enum: ['door_swing_reserved', 'window_envelope', 'radiator_keepout', 'tv_blocked', 'tv_unknown'] }, maxItems: 5 } }, mutationRequired) },
  proposeLayout: { readOnly: false, description: 'Run a bounded deterministic greedy planner inside an existing layout proposal. Preserves owned instances and locks; plans profile requirements and bounded repeated variants. Results can be partial.', inputSchema: object({ ...mutation, variantIds: { type: 'array', items: str, maxItems: 8 }, quantities: { type: 'array', items: object({ variantId: str, quantity: integer(1, 4) }, ['variantId', 'quantity']), maxItems: 8 }, profile: profileKind }, mutationRequired) },
  setAppearance: { readOnly: false, description: 'Change a layout proposal wall, floor or furniture palette by a valid ID. Geometry, height classes and rule flags are unaffected.', inputSchema: object({ ...mutation, target: { enum: ['wall', 'floor', 'furniture'] }, paletteId: str, objectId: str }, [...mutationRequired, 'target', 'paletteId']) },
  checkLayout: { readOnly: true, description: 'Read the shared engine report without changing draft readiness or view. Supports rule-code, object and region filters, and paginated issues or cells. Full-layout status and brief remain explicit even for focused reports.', inputSchema: object({ ...snapshot, candidateId: str, detail: { enum: ['issues', 'flags'] }, ruleCode: str, objectId: str, region: object({ x: integer(0, 50), y: integer(0, 50), w: integer(1, 50), d: integer(1, 50) }, ['x', 'y', 'w', 'd']), offset: integer(), limit: integer(1, 100) }, ['which']) },
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
    if (!Array.isArray(value) || (schema.maxItems !== undefined && value.length > schema.maxItems)) return `${path} must be a bounded array.`;
    for (const [i, item] of value.entries()) { const error = validateSchema(item, schema.items!, `${path}[${i}]`); if (error) return error; }
  } else if (schema.type === 'number' || schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (schema.type === 'integer' && !Number.isInteger(value)) || (schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum)) return `${path} must be a finite ${schema.type} in the allowed range.`;
  } else if (schema.type === 'string') {
    if (typeof value !== 'string' || value.length < (schema.minLength || 0) || value.length > (schema.maxLength || Infinity)) return `${path} must be a nonempty bounded string.`;
  } else if (schema.type === 'boolean' && typeof value !== 'boolean') return `${path} must be a boolean.`;
  return null;
}
