PERIS — COMPACT MAP UI
11 October 2026

Baseline: rexrjd/Peris main, 84fe77b75332d7fdba783b52fb00b014b7509cbf.
This supersedes the previous map panel design.

Install
Copy src/ and tests/ from this ZIP into the root of the current Peris checkout,
preserving their paths. Alternatively, use git apply map-ui-minimal.patch
against the stated baseline. Choose one installation method.
Run npm run build and deploy the frontend normally.
No dependencies, SQL migrations or save conversions are required.

Design
The map keeps its full width and height when events or details are opened.
A small floating Events button replaces the permanent sidebar.
The movement preview has at most three single-line rows: type, army and timer.
All events opens the complete list with All / Armies / Cities filters.
Selecting an event opens the relevant compact action card instead of the list.
Camp strength and raid/farm actions remain visible; troop breakdown, loot and
explanations are under Details. City statistics and field building options
are also shown on demand.
Mobile uses the same small floating controls, with no large bottom sheet.
The army-switching dock remains available.

Gameplay
All existing owned activity is retained: raids, returns, marches, battles,
building/field work, recruitment and settlers. Existing cancellation tokens,
timing, save compatibility and private-data boundaries are preserved.
The coordinate search closes after Go so it does not cover the selected card.
City founding remains available through the field card's Settle action.

Reference patterns
Travian: small map movement indicators.
https://support.travian.com/en/articles/135-travian-plus-membership-map-incoming-and-outgoing-troop-movements
Total War: army and province panels opened through selection.
https://academy.totalwar.com/total-war-rome-2-campaign-controls/
These are interaction references; no game artwork has been copied.

Validation
Production build and SQL bundle consistency passed. Unit tests: 374 passed
(one existing skip); tooling: 4 passed; models: 46 passed. All 16 desktop and
Pixel 7 browser scenarios passed. They cover full map
size, bounded overlay size, filters, correct commander selection, real map
clicks, departure cancellation/reload, camp and farm actions, reinforcement
restrictions, returning-troop settlement and quiet automatic battle results.
Browser screenshots are internal QA; software graphics were used.
