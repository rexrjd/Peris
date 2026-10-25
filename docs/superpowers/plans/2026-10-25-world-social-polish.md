# World HUD and Social Style Implementation Plan

> **For agentic workers:** Implement independent lock recovery, social styling and HUD tasks with superpowers:dispatching-parallel-agents, then perform one fresh review and integration verification.

**Goal:** Recover from the raw top-level lock error, move rotation above the minimap, integrate loyalty into the city preview and share the accepted faction style with Guilds and Messages.

**Architecture:** Preserve authoritative server rules and exact mutation receipts. Investigate the lock's actual client/RPC path and handle transient read contention with bounded recovery, leaving genuine errors visible. Reuse existing scene materials for social overlays. Keep owned-city loyalty calculation and privacy in its existing component, placing a compact form alongside Land in the city preview rather than a floating panel. Place the existing rotation controls above the actual minimap in its dock.

**Tech Stack:** Existing React, TypeScript, Three.js and Playwright; no new dependencies or art assets.

**Spec:** User's four requested changes and screenshot; match the already accepted Map/City/Rankings/Reports/management style. Preserve eleven factions, save compatibility, private social flows and Canvas fallback.

## Work and review focus

- [x] Trace/reproduce and fix transient lock errors with meaningful regression coverage. No SQL deployment and no blind re-sending of mutations.
- [x] Theme and compact Guilds/Messages, keeping permissions, forms, message history, search, focus and mobile controls intact.
- [x] Add HUD regression for rotation geometry and real camera interaction; move controls into the minimap dock.
- [x] Integrate owned-city loyalty into the city preview's Land strip, retain readable accessible details and selected-city updates; preserve hidden rival loyalty.
- [x] Run affected desktop/mobile browser scenarios and inspect screenshots, including 320px and live 3D City.
- [x] Run unit/tooling/assets/build checks and relevant lock recovery checks; separate baseline failures.
- [x] Obtain fresh review, resolve findings, document verification and commit on the review branch.
