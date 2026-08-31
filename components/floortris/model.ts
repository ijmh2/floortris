export type Cell = { x: number; y: number };
export type FloorPoint = { xCm: number; yCm: number };
export type FloorPlan = { kind: 'rectilinear'; points: FloorPoint[] };
export type Wall = 'north' | 'east' | 'south' | 'west';
export type WallAnchor = { wall: Wall; offsetCm: number; segmentId?: string };
export type Kind = 'sofa' | 'chair' | 'table' | 'coffee_table' | 'desk' | 'storage' | 'bed' | 'tv' | 'rug' | 'plant'
  | 'window_treatment' | 'ceiling_light' | 'wall_light' | 'floor_lamp' | 'table_lamp'
  | 'radiator' | 'basin' | 'toilet' | 'shower' | 'bath' | 'towel_rail' | 'other';
export type FixtureType = 'curtains' | 'blind' | 'pendant' | 'flush' | 'track' | 'recessed' | 'wall_sconce' | 'floor_lamp' | 'table_lamp';
export type LightingZone = 'ambient' | 'seating' | 'reading' | 'circulation';
/** Agent-authored furniture is deliberately limited to movable floor objects.
 * Fixed, wall and ceiling roles need canonical room/mount records and therefore
 * remain catalogue or human room-input concerns. */
export type CustomFurnitureKind = 'sofa' | 'chair' | 'table' | 'coffee_table' | 'desk' | 'storage' | 'bed' | 'plant';
export type CustomFurnitureProvenance = { source: 'agent_authored_one_off'; tool: 'createCustomFurniture' };
export type SectionalModuleType = 'seat' | 'corner' | 'chaise';
export type SectionalModule = { id: string; type: SectionalModuleType; xCm: number; yCm: number; widthCm: number; depthCm: number; heightCm: number; facing: Wall };
/** Local module coordinates are normalized to the unrotated measured envelope.
 * Parent rotation moves the complete union; primaryFacing alone controls the
 * TV and coffee-table relationship. */
export type SectionalGeometry = { type: 'sectional'; primaryFacing: Wall; modules: SectionalModule[] };
export type RoomProfile =
  | { kind: 'lounge' }
  | { kind: 'bedroom'; sleeping: 'single' | 'double' | 'king'; workspace: boolean; storage: boolean; bedsideQuantity?: number }
  | { kind: 'home_office'; seating: boolean; storage: boolean }
  | { kind: 'bathroom_concept'; fixtureIds: string[]; conceptualOnly: true };
export type FixedFixtureKind = 'radiator' | 'basin' | 'toilet' | 'shower' | 'bath' | 'towel_rail';
export type Rotation = 0 | 90 | 180 | 270;
export type Size = { w: number; d: number; h: number | null };
export type Furniture = {
  id: string; label: string; kind: Kind; ownership: 'owned' | 'catalogue' | 'custom' | 'fixed';
  sizeCm: Size; rotation: Rotation; originCell: Cell; variantId?: string;
  /** Catalogue-local back edge before rotation. Defaults to north. */
  backEdge?: Wall;
  elevationCm: number; wallAnchor?: WallAnchor;
  locked: { position?: boolean; size?: boolean; rotation?: boolean; appearance?: boolean };
  appearance: string; requiredInRoom: boolean; targetSofaId?: string; linkedDeskId?: string;
  /** A window treatment must name the window it was measured for. */
  attachedOpeningId?: string;
  /** A table lamp must name the table, desk or cabinet carrying its weight. */
  supportObjectId?: string;
  /** Explicit semantic subtype; unlike a visual form this participates in validation. */
  fixtureType?: FixtureType;
  /** Intended design role only; this is not a lux or electrical calculation. */
  lightingZone?: LightingZone;
  /** Closed provenance marker. Custom records never accept agent tags, rule
   * overrides, code, markup or remote assets. */
  customProvenance?: CustomFurnitureProvenance;
  /** Closed declarative geometry. V1 only supports connected custom sofas. */
  geometry?: SectionalGeometry;
  tags: string[]; sleepSize?: 'single' | 'double' | 'king'; conceptualOnly?: boolean; clearance?: { label: string; rect: Rect };
};
export type Door = { id: string; kind: 'door'; wall: Wall; segmentId?: string; offsetCm: number; widthCm: number; hinge: 'start' | 'end'; swing: 'in' | 'out'; angle: 90; mechanism: 'hinged' | 'pocket' | 'bifold' | 'sliding'; entrance: boolean };
export type WindowOpening = { id: string; kind: 'window'; wall: Wall; segmentId?: string; offsetCm: number; widthCm: number; sillCm: number; headCm: number; type: 'fixed' | 'side_hinge' | 'sash' | 'unknown'; windowAccess: boolean };
export type Opening = Door | WindowOpening;
export type FixedFixture = Furniture & { ownership: 'fixed'; kind: FixedFixtureKind; conceptualOnly?: boolean; clearance?: { label: string; rect: Rect } };
export type Room = { name: string; widthCm: number; depthCm: number; floorPlan?: FloorPlan; openings: Opening[]; fixtures: Furniture[]; openingLocks?: string[]; profile?: RoomProfile };
export type Rules = { cellCm: 20; H_lowCm: number; walkHardCm: number; walkPreferredCm: number; storageFrontCm: number; chairPullCm: number; bedLongSideAccessCm: number; radiatorFrontCm: number; windowFrontCm: number; ceilingCm: number; requiredKinds: Kind[]; deskNearWindow: boolean; openFloorM2: number };
export type Layout = { furniture: Furniture[]; appearance: { wall: string; floor: string } };
export type Omission = { objectId?: string; variantId?: string; reason: string; alternativeVariantId?: string; alternativeChecked?: { trials: number; placementStatus: string; layoutStatus: string; proposalRevision: number; ruleRevision: number } };
export type Proposal = { id: string; kind: 'layout' | 'setup'; revision: number; baseCurrentRevision: number; baseRuleRevision: number; layout: Layout; room: Room; rules: Rules; omitted: Omission[] };
export type AppState = { version: 1 | 2; documentId?: string; currentRevision: number; ruleRevision: number; current: Layout; room: Room; rules: Rules; inventory: Furniture[]; proposal: Proposal | null; sequence: number };
export type HeightClass = 'FREE' | 'LOW' | 'TALL' | 'UNKNOWN_HEIGHT';
/** Checked repair or bounded-search suggestion. The store binds active proposal
 *  authority before exposing it as an executable native tool call. */
export type IssueFix = { tool: string; args: Record<string, unknown>; summary: string };
export type Issue = { code: string; severity: 'block' | 'warning' | 'info'; message: string; objectIds: string[]; cells: Cell[]; flags: string[]; destinationId?: string; configuredWalkHardCm?: number; fix?: IssueFix };
export type GridCell = Cell & { heightClass: HeightClass; objectIds: string[]; flags: string[] };
export type Rect = { x: number; y: number; w: number; d: number };
export type ActivityZone = { id: string; objectId: string; label: string; rect: Rect; reachable: boolean; preferredReachable: boolean; cells: Cell[]; purpose?: string };
export type BriefRequirement = { key: string; label: string; quantity: number; met: number; source: 'layout' | 'fixed_fixture' | 'relationship'; required: boolean };
export type Report = { validation: { status: 'ok' | 'warnings' | 'blocked'; hardFailures: number; warnings: number }; brief: { status: 'satisfied' | 'incomplete'; missingRequired: string[]; requirements?: BriefRequirement[] }; issues: Issue[]; cells: GridCell[]; zones: ActivityZone[]; columns: number; rows: number; flagsSummary: Record<string, number>; checkedRules: string[]; clearances: { hardRequestedCm: number; hardEffectiveCm: number; preferredRequestedCm: number; preferredEffectiveCm: number }; openFloorM2: number; conceptualOnly?: boolean };
export type Candidate = { candidateId: string; proposalId: string; proposalRevision: number; ruleRevision: number; objectId?: string; variantId?: string; linkedDeskId?: string; attachedOpeningId?: string; supportObjectId?: string; lightingZone?: LightingZone; originCell: Cell; rotation: Rotation; wallAnchor?: Furniture['wallAnchor']; checkedRules: string[]; placementStatus: 'valid'; layoutStatus: Report['validation']['status']; qualityScore: number; frontFacing: Wall; backWall: Wall; backGapCm: number; touchingWalls: Wall[]; remainingIssues: Issue[]; remainingIssueCount: number; hasMoreRemainingIssues: boolean; details: { tool: string; args: Record<string, unknown> }; brief: Report['brief'] };
export type ToolLogEntry = { seq: number; at: number; ms: number; name: string; args: string; ok: boolean; errorCode?: string; revision?: number; status?: string; validationStatus?: string; hardFailures?: number; readOnly: boolean };
export type CommandResult = { operationSucceeded: boolean; error?: { code: string; message: string }; [key: string]: unknown };
export const clone = <T,>(value: T): T => structuredClone(value);
export const key = (c: Cell) => `${c.x},${c.y}`;
export const rotations: Rotation[] = [0, 90, 180, 270];
export const faces: Record<Rotation, Wall> = { 0: 'south', 90: 'west', 180: 'north', 270: 'east' };
export const opposite: Record<Wall, Wall> = { north: 'south', south: 'north', east: 'west', west: 'east' };
