# Compact Rankings and shared scene styling

The user rejects the light palette and remaining waste of space. Reuse the actual map/3D City faction materials and control styling, and take table density from Travian ranking screenshots. Google Images was opened and inspected for `Travian top 10 statistics` and weekly attack/defense rankings; local reference captures are under ignored `artifacts/rankings-redesign/`.

**Goal:** A compact, readable statistics panel which belongs to the current city's visual theme.

**Scope:** Root React/CSS presentation and UI tests only. No SQL, scoring, DTO, saves or gameplay changes. Use `review/rankings-scene-style`; no push or deployment.

**Design:** Add Rankings to App's existing `scene-theme` condition. Read `--scene-ink`, `--scene-panel`, `--scene-material`, `--scene-text`, `--scene-muted`, `--scene-edge` and `--scene-accent` instead of adding a palette. Combine title/scope/week buttons into one compact heading; place narrow category tabs and dates on a second line. Display three boards on desktop, two on intermediate screens and one on phones, with approximately 22px normal rows. Keep header/row padding small. Personal rows show the actual rank/score without a duplicate footer; unranked dashes retain an accessible label and tooltip. A zero-score self row makes a redundant empty-state row unnecessary. Retain all five boards, personal rank, periods, keyboard controls, expandable rules and errors.

Alternatives rejected: another isolated palette cannot meet map/city compatibility; a full-width single table hides the five-board weekly overview. References guide layout and density, while Peris supplies all colors, textures and icons.

- [x] Add a failing browser regression comparing actual map/City/Rankings faction colors and texture, then check sparse boards and normal rows fit the viewport.
- [x] Integrate the shared theme and compact presentation; preserve the existing keyboard/read lifecycle.
- [x] Verify actual pointer/keyboard interactions and screenshots on desktop/mobile/320px, including Roman/Persian/Elf themes.
- [x] Run unit/tooling/assets/build and focused Rankings/header browser checks. Get one fresh final review and resolve important findings.
- [x] Record verification and commit on the review branch. No SQL migration is required.
