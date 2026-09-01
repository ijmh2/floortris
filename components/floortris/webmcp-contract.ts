import { TOOL_SCHEMAS, type Schema } from './schemas.ts';

export const WEBMCP_CONTRACT_RELEASE = '2026-08-31';
export const WEBMCP_TOOL_NAMES = [
  'checkLayout', 'createCustomFurniture', 'createProposal', 'findPlacements',
  'generateRoom', 'getRoomState', 'listCatalogue', 'listFurniture',
  'placeFurniture', 'proposeLayout', 'removeFurniture', 'setAppearance',
  'setConstraints', 'setOpening', 'setRoomGeometry', 'updateFurniture',
] as const;
export const WEBMCP_READ_ONLY_TOOLS = new Set<string>([
  'checkLayout', 'findPlacements', 'getRoomState', 'listCatalogue', 'listFurniture',
]);
export const HUMAN_ONLY_ACTIONS = ['applyProposal', 'confirmSetup', 'discardProposal', 'humanSetLocks'] as const;

function schemaClosureErrors(schema: Schema, path: string): string[] {
  const errors: string[] = [];
  if (schema.type === 'object' && schema.additionalProperties !== false) errors.push(`${path} must set additionalProperties:false`);
  if (schema.properties) for (const [key, child] of Object.entries(schema.properties)) errors.push(...schemaClosureErrors(child, `${path}.properties.${key}`));
  if (schema.items) errors.push(...schemaClosureErrors(schema.items, `${path}.items`));
  if (schema.anyOf) schema.anyOf.forEach((child, index) => errors.push(...schemaClosureErrors(child, `${path}.anyOf[${index}]`)));
  return errors;
}

/** Shared by production registration and tests so schema/annotation drift fails
 * before a partial tool surface can be announced. */
export function webMcpContractErrors(): string[] {
  const names = Object.keys(TOOL_SCHEMAS).sort(), expected = [...WEBMCP_TOOL_NAMES].sort();
  const errors = names.length === expected.length && names.every((name, index) => name === expected[index]) ? [] : [`Expected exactly ${expected.join(', ')}, received ${names.join(', ')}`];
  for (const [name, spec] of Object.entries(TOOL_SCHEMAS)) {
    if (spec.readOnly !== WEBMCP_READ_ONLY_TOOLS.has(name)) errors.push(`${name}.readOnly is incorrect`);
    errors.push(...schemaClosureErrors(spec.inputSchema, `${name}.inputSchema`));
  }
  return errors;
}
