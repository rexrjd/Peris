# Rankings UI Redesign Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline, with one fresh final review. Steps use checkbox syntax for tracking.

**Goal:** Replace the dark ranking cards with a compact Travian-inspired statistics sheet.

**Architecture:** Preserve engine reads and all scoring; refactor only RankingsContent and feature-scoped CSS. Keep all server data authoritative.

**Tech Stack:** Existing React 19.1.1, TypeScript, CSS and Playwright. No dependencies or new art assets.

**Spec:** `docs/superpowers/specs/2026-10-25-rankings-ui-redesign-design.md`

## Global constraints

- Root application only, on `review/rankings-ui-redesign`; preserve all existing gameplay and navigation.
- Presentation only. No SQL, DTO, scoring, save or engine mutation changes.
- Original CSS/markup; reference screenshots remain ignored local research assets.
- Accessible tabs, own standings outside Top 10, previous week, errors and 320px layouts remain usable.

## Review focus

- Category changes preserve the selected week and accurate own row.
- Arrow/Home/End keyboard behavior and active-panel labels agree.
- Sparse boards, long names and large scores do not overflow at 320px.
- Expanded help explains partial weeks without dominating the default screen.
- Existing Reports and game navigation retain their behavior and styles.

### Task 1: Compact statistics presentation

**Files:** `src/features/rankings/ui/RankingsView.tsx`, `src/features/rankings/styles/rankings.css`, `tests/rankings-ui.test.ts`, `tests/e2e/rankings.spec.ts`.

- [x] Add failing UI tests for accessible category navigation and a separate Guild column. Run `node --import tsx --test tests/rankings-ui.test.ts`; expect the new behavior to fail.
- [x] Rebuild the compact sheet, five tables, category tabs, week bar, own rows and expandable scoring/tracking help. Preserve existing reader lifecycle and errors.
- [x] Extend browser tests to select one category, use keyboard navigation, retain period/self rank and inspect 320px names/scores. Keep existing online/local/retry coverage.
- [x] Run UI tests and the focused Rankings/compact-header desktop/mobile suite; inspect screenshots and iterate only on demonstrated layout issues.

### Task 2: Verification and review branch

- [x] Run `npm test`, `npm run test:tooling`, `npm run assets:check`, `npm run build` and the focused `npm run test:e2e` suite. Record existing warnings/skips separately.
- [x] Request one fresh whole-change review, resolve important findings and document reference sources and exact verification evidence.
- [x] Commit the verified presentation change on the review branch; no push, merge or SQL deployment.
