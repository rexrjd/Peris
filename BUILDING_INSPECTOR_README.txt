PERIS V19.8 - COMPACT BUILDING INSPECTOR
Base: rexrjd/Peris main 1d36a786da4f5c5ed6ab4e47a601d6d742af565b
Verified against origin/main on 2026-10-17. No database migration required.

INSTALL
Copy the src/ and tests/ folders into the project, keeping the same paths.
The archive contains only seven changed/new files, not a complete checkout.
Alternatively, from the matching base checkout run:
  git apply --check compact-building-inspector.patch
  git apply compact-building-inspector.patch
Use either copying or the patch, not both. Review overlaps if main advances.
Then run npm ci, npm run build and the project's normal checks.

WHAT CHANGED
- Narrow floating building inspector on desktop; no full-screen backdrop or blur.
- Compact mobile bottom sheet with minimize/expand controls.
- Small building thumbnail, level, concise description and current/next benefits.
- Upgrade/build cost, duration and main action stay in the footer.
- Training and spells use separate tabs. Training quantity survives tab switches.
- Training action remains visible; existing queue can be expanded on demand.
- City remains selectable behind the inspector; click another building directly.
- Settings/debug tools are behind the small gear button.
- Existing spellbook, research navigation, construction and recruitment commands preserved.
- Both native 3D and painted city views use the same compact inspector.

VALIDATION
- TypeScript and production build passed.
- Full unit suite: 462 passed, 1 skipped, no failures.
- Browser suite: 17 passed, 1 existing mobile skip, no failures or flaky tests.
  Includes new inspector cases and existing city scene/camera regressions on
  desktop Chromium and mobile Chromium, plus 320x640 and 1280x600 layouts.
- Tooling: 5 tests passed.
- Asset checks passed: 46 registered GLBs and 33 Rally Point paintings.
- Artifact/research artwork checks passed as part of the production build.
- Git whitespace check and patch reverse-application check passed.

No live deployment or database changes have been performed.
