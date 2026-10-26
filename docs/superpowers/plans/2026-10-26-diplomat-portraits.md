# Diplomat Portraits Implementation Plan

> **For agentic workers:** Use superpowers:dispatching-parallel-agents for independent portrait production and UI integration, then verify and review the finished result.

**Goal:** Replace the mismatched flat Senator/diplomat previews for all eleven factions with original portraits matching the shipped unit atlases.

**Architecture:** Retain faction names, the shared `TroopIcon` entry point, gameplay and battle models. Generate one distinct framed raster portrait per faction using the existing faction roster as style reference. Keep editable source PNGs and a prompt/provenance manifest; export small runtime WebPs to `public/art/battle/diplomats-v2/`. The shared diplomat portrait component consumes literal runtime URLs so all UI flows and standalone packaging use the same image.

**Art direction:** Match the roster's detailed painted fantasy treatment, tactile clothing, warm directional lighting, dark olive vignette and fine aged-gold square frame. Show faction-appropriate civic clothing and scroll/seal, recognizable species anatomy and clear silhouettes at small sizes. No text, flat vector figures, reused combat roles or faction recolors.

**Constraints:** Root app only; original existing eleven factions; no rules, costs, names, saves, SQL or battle model changes; no external art/dependencies.

- [x] Inspect references; generate and visually inspect all eleven original portraits with the built-in image tool.
- [x] Record sources, prompts, ownership and export hashes; verify the complete runtime set.
- [x] Add meaningful browser/asset regressions, observe the old SVG mismatch fail, then integrate shared raster portraits.
- [x] Inspect an all-faction contact sheet plus actual Army, Rally and troop-detail screenshots on desktop/mobile.
- [x] Run unit, tooling, assets and build checks and affected browser suites; obtain a fresh code review.
- [x] Record final evidence and commit the finished work on the review branch.
