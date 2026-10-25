# Reports Scene Style Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline. Request one fresh read-only code review after implementation.

**Goal:** Match Reports to the compact faction materials shared by Map, live 3D City, Rankings and the management screens.

**Architecture:** Keep the existing small Reports overlay, inbox and receipt components. Give the popup its own selected-city scene wrapper so it stays themed even over the compatible painted City, without restyling that background. Convert inbox palette constants to scene tokens with legacy fallbacks; compact the popup stylesheet and its sections.

**Tech Stack:** Existing React, TypeScript, CSS and Playwright.

**Spec:** The user requests the same accepted compact faction style for the Reports navigation tab. Preserve its existing overlay flow, filters, read state, privacy, milestones, scouting and receipt data.

## Constraints and review focus

- Root app only; no domain, server, SQL, assets, models or dependencies changed.
- Consistent selected-city materials from Map, City, Rally, Armies, Research and Rankings.
- Maintain popup dismissal and focus return, keyboard controls and bounded scrolling.
- Keep all eight inbox controls usable at 320px, including the native outcome selector over Rally.
- Preserve meaningful loss/outcome and equipment-rarity colors, private receipts and read behavior.

## Task 1: Reports presentation

- [x] Add and observe a failing browser regression for faction materials, dense rows and narrow layouts.
- [x] Pass the selected faction to `ReportsPopup` from `App`; theme the overlay locally.
- [x] Reuse scene tokens in `report-inbox.css` and compact/theme `reports-popup.css`, including scouting and milestones.
- [x] Run Reports popup, inbox, economics and unread suites and inspect desktop/mobile images.
- [x] Run unit, tooling, asset and production build checks; obtain and resolve a fresh code review.
- [x] Record verification, capture previews and commit on the small review branch.
