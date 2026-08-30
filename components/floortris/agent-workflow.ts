/** Shared site guidance, not a replacement for the agent runtime's browser API. */
export const AGENT_TOOL_POLICY = 'Use native WebMCP for agent room edits. Leave Apply, Discard, Unlock and room-input confirmation to the human; do not click those controls on their behalf.';
export const AGENT_UNAVAILABLE = 'If your agent runtime cannot discover or call native WebMCP tools, report the connection blocker and stop room edits. Do not silently fall back to the manual planner or claim WebMCP was used.';

/** Documentation example only: these openings and furniture choices are assumptions. */
export const BEDROOM_TOOL_EXAMPLE = {
  name: 'Example 3 × 4.5 m bedroom', widthCm: 300, depthCm: 450,
  profile: { kind: 'bedroom', sleeping: 'double', workspace: false, storage: true, bedsideQuantity: 2 },
  openings: [{ id: 'entrance', kind: 'door', wall: 'south', offsetCm: 20, widthCm: 80, hinge: 'start', swing: 'in', angle: 90, mechanism: 'hinged', entrance: true }],
  idempotencyKey: 'replace-with-a-unique-request-key',
};

/** A dimensioned-sketch example: the lower-right 2 × 2 m corner is absent. */
export const CUSTOM_FLOORPLAN_EXAMPLE = {
  name: 'Example measured L room', widthCm: 500, depthCm: 500,
  floorPlan: { kind: 'rectilinear', points: [
    { xCm: 0, yCm: 0 }, { xCm: 500, yCm: 0 }, { xCm: 500, yCm: 300 },
    { xCm: 300, yCm: 300 }, { xCm: 300, yCm: 500 }, { xCm: 0, yCm: 500 },
  ] },
  profile: { kind: 'lounge' },
  openings: [{ id: 'entrance', kind: 'door', wall: 'south', segmentId: 'wall-5', offsetCm: 20, widthCm: 100, hinge: 'start', swing: 'in', angle: 90, mechanism: 'hinged', entrance: true }],
  idempotencyKey: 'replace-with-a-unique-request-key',
};
