# Studio 01 finishes

Generated colour textures live in public/textures. PALETTES in data.ts is the shared catalogue for human controls and native tools; existing colour IDs remain valid. Each new entry has a stable ID, description, tags, conceptOnly flag, local texture URL and physical repeat size.

Humans: Room → Walls / Floor. Named thumbnails support keyboard focus, selected state and disabled editing. Wallpaper previews in 3D; floors also show in the 2D furniture view. Rule overlays never use textured backgrounds.

Agents: listCatalogue returns palettes even when furniture filters or pagination are used. Pass the chosen ID to setAppearance(target, paletteId, proposalId, revision), or generateRoom.appearance for a new room. Command results and getRoomState include appearance. Existing proposal authority and human-only Apply are unchanged.

The 3D renderer uses one image per selected finish per scene, sRGB colour, metre-based UVs, catalogue repeat dimensions and mirrored wrapping. Wall segments around doors/windows share scale and phase. Texture loads trigger rendering; failures leave the base colour and show a notice. Retired scene callbacks are ignored and GPU textures disposed. Generated floors omit synthetic plank seams.

No dimensions, physical clearances, cell flags or engine rules depend on finishes. Existing saved rooms are not migrated to textures. These are concept colour maps, not real product SKUs, verified seamless scans or a full PBR material pack.

Verification: texture-finishes.test.ts covers six local assets, shared catalogue metadata, human/native parity, full engine-report invariance, state readback, persistence, stale/invalid writes, generated-room appearance, accessible controls, UV mapping and texture lifecycle.
