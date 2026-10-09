# Peris — floating map controls

Replaces the two full-width map/territory rows below the global HUD. The map begins directly beneath the global header.

- Top left: one Land control with the claimed/available field count and a + affordance. Selecting it starts choosing land and focuses home; selecting Done finishes. Expansion score and allowance guidance are in its tooltip. Claim instructions appear only while choosing land.
- Top right: compact Campaign, Layers, and March controls. Campaign rewards, map layer switches, world overview, region exploration, and coordinate search remain available.
- Coordinate search opens a small floating panel instead of inserting another row.
- Home, Army, and camera rotation share a compact bottom-center dock on wide maps. They move below the land control when the map becomes narrow, including when a campaign or field panel is open.
- Choosing land and giving marching orders are mutually exclusive. Existing training/order restrictions still apply.
- Neutral charcoal surfaces and restrained ivory/brass accents match the scene-first HUD.

## Apply

Extract `Peris_floating_map_controls_changed_files.zip` over the current scene-first HUD version, preserving paths. It contains `WorldView.tsx`, the new map `hud.css`, the updated stylesheet imports, and this note. Existing modern UI and scene-first HUD files must already be present. No dependencies or database changes are required.

The standalone HTML embeds the game and assets. Download and open it, start/continue a solo campaign, and choose Map.

## Validation

Production TypeScript/Vite build passed. All 170 existing Node tests passed with `node --import tsx --test --test-concurrency=2 tests/*.test.ts`. Whitespace checks passed.

Browser visual and pointer/touch verification remain outstanding because the required browser-control capability is unavailable. Review the floating controls, narrow layouts with both side panels, land selection, march cancellation, map layers, and coordinate search in a browser before deploying.
