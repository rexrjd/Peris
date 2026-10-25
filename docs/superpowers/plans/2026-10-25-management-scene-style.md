# Management Scene Style Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan inline, with a fresh final code review.

**Goal:** Make Armies, Rally Point and Research use the compact faction materials already shared by Map, live 3D City and Rankings.

**Architecture:** Reuse `scene-theme.css` tokens. Retain each screen's functional components and responsive scrolling; replace legacy palette constants at their feature styles. Theme body portals explicitly so recruitment and troop inspection follow their originating city.

**Tech Stack:** Existing React, TypeScript, CSS, Playwright.

**Spec:** User requests matching the accepted Rankings/Map/City style, compact spacing, and all working flows preserved.

## Constraints

- Root application only; no gameplay, SQL, models, dependencies or legacy copies changed.
- Preserve faction identity and status meaning, technology geometry, all orders and research actions.
- Keep desktop and mobile controls reachable, including 320px width and portal dialogs.

## Review Focus

- Selected-city faction persists across navigation; army selection may legitimately choose its home city.
- Recruitment, stats and order dialogs retain themed surfaces and bounded scrolling.
- Dense Rally content scrolls inside the panel without hiding the section tabs.
- Research connections and nodes remain aligned when zooming and filtering.
- Shared header, Rankings and live 3D City retain their accepted appearance.

## Task 1: Share materials and compact presentation

- [x] Add browser regression comparing actual Map materials to Army, Rally and Research surfaces, with desktop/mobile screenshots and 320px coverage.
- [x] Observe the new material regression fail on the previous implementation.
- [x] Extend the app's scene theme to these screens. Convert feature palettes to shared variables, tighten spacing and remove redundant Rally banner/header styling.
- [x] Keep body portals within a faction theme and update Rally's presentation assertions to the new authorized style.
- [x] Run affected browser suites, inspect screenshots and correct any layout defects.
- [x] Run unit, tooling, assets and production build checks.
- [x] Request one fresh read-only code review, address findings, record evidence and commit on the review branch.
