import type { CustomFurnitureKind, Furniture, Rotation } from './model.ts';

export const CUSTOM_FURNITURE_KINDS: readonly CustomFurnitureKind[] = [
  'sofa', 'chair', 'table', 'coffee_table', 'desk', 'storage', 'bed', 'plant',
] as const;
export const CUSTOM_FURNITURE_PALETTES = ['moss', 'oat', 'clay', 'graphite', 'oak'] as const;

export type CustomFurnitureInput = {
  label: string;
  kind: CustomFurnitureKind;
  widthCm: number;
  depthCm: number;
  heightCm: number;
  positionCm: { xCm: number; yCm: number };
  rotation: Rotation;
  appearance: typeof CUSTOM_FURNITURE_PALETTES[number];
  linkedDeskId?: string;
};

export function makeCustomFurniture(input: CustomFurnitureInput, id: string, cellCm = 20): Furniture {
  return {
    id,
    label: input.label.trim(),
    kind: input.kind,
    ownership: 'custom',
    customProvenance: { source: 'agent_authored_one_off', tool: 'createCustomFurniture' },
    sizeCm: { w: input.widthCm, d: input.depthCm, h: input.heightCm },
    originCell: { x: input.positionCm.xCm / cellCm, y: input.positionCm.yCm / cellCm },
    rotation: input.rotation,
    elevationCm: 0,
    locked: { size: true },
    appearance: input.appearance,
    requiredInRoom: false,
    tags: [],
    ...(input.linkedDeskId ? { linkedDeskId: input.linkedDeskId } : {}),
  };
}

/** Imported/local records are untrusted JSON. Keep the same closed contract the
 * native tool creates so imported tags or role claims cannot satisfy a brief. */
export function invalidCustomFurnitureRecord(item: Furniture): string | null {
  if (item.ownership !== 'custom') return null;
  const allowed = new Set(['id', 'label', 'kind', 'ownership', 'customProvenance', 'sizeCm', 'originCell', 'rotation', 'elevationCm', 'locked', 'appearance', 'requiredInRoom', 'tags', 'linkedDeskId']);
  if (Object.keys(item).some(key => !allowed.has(key))) return 'Custom furniture contains unsupported data.';
  if (!item.customProvenance || item.customProvenance.source !== 'agent_authored_one_off' || item.customProvenance.tool !== 'createCustomFurniture') return 'Custom furniture provenance is missing or unsupported.';
  if (Object.keys(item.customProvenance).some(key => !['source', 'tool'].includes(key))) return 'Custom furniture provenance contains unsupported data.';
  if (!CUSTOM_FURNITURE_KINDS.includes(item.kind as CustomFurnitureKind)) return 'Custom furniture kind is unsupported.';
  if (!item.label || item.label !== item.label.trim() || item.label.length > 80) return 'Custom furniture label is invalid.';
  if (![item.sizeCm.w, item.sizeCm.d].every(n => Number.isFinite(n) && n >= 1 && n <= 600) || item.sizeCm.h === null || !Number.isFinite(item.sizeCm.h) || item.sizeCm.h < 1 || item.sizeCm.h > 500) return 'Custom furniture dimensions are invalid.';
  if (Object.keys(item.sizeCm).some(key => !['w', 'd', 'h'].includes(key)) || Object.keys(item.originCell).some(key => !['x', 'y'].includes(key)) || Object.keys(item.locked).some(key => !['position', 'size', 'rotation', 'appearance'].includes(key)) || Object.values(item.locked).some(value => typeof value !== 'boolean')) return 'Custom furniture authority data is invalid.';
  if (![item.originCell.x, item.originCell.y].every(n => Number.isFinite(n)) || ![0, 90, 180, 270].includes(item.rotation)) return 'Custom furniture placement is invalid.';
  if (!CUSTOM_FURNITURE_PALETTES.includes(item.appearance as typeof CUSTOM_FURNITURE_PALETTES[number])) return 'Custom furniture appearance is unsupported.';
  if (item.elevationCm !== 0 || item.variantId || item.backEdge || item.wallAnchor || item.fixtureType || item.lightingZone || item.attachedOpeningId || item.supportObjectId || item.targetSofaId || item.sleepSize || item.conceptualOnly || item.clearance) return 'Custom furniture contains an unsupported role, mount or variant claim.';
  if (item.tags.length !== 0 || item.requiredInRoom || item.locked.size !== true) return 'Custom furniture authority fields are invalid.';
  if (item.linkedDeskId !== undefined && (item.kind !== 'chair' || typeof item.linkedDeskId !== 'string' || !item.linkedDeskId)) return 'Only a custom chair may name a linked desk.';
  return null;
}
