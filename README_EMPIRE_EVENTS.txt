PERIS - Empire-wide Events and Send Troops UI
===========================================

WHAT CHANGED
* In the live 3D City, Events defaults to ALL active jobs across every owned
  city, not a 5-item local preview. Jobs are sorted by deadline with concise
  event type, city/route, and time remaining.
* Filter by All / Build / Train / Moves / Other and, with multiple cities,
  All cities or one named city. A reinforcement appears for BOTH its source
  and destination cities. Rival/private orders are excluded.
* The shared Events panel on City and Map now has Activity / Send troops tabs.
  Send moves permanent garrison troops between owned cities along existing
  connected land routes. All / Clear, troop icons, sliders, exact inputs,
  1,000 per march cap, route preview, and send command all reuse the existing
  authoritative reinforceCity logic and offline tick; NO gameplay/SQL changes.
* Garrison is now only for stationing and withdrawing permanent defenders.
  The redundant Send tab and shipment list were removed from Garrison.
* Existing Map compact movement preview / All events interaction stays intact.

INSTALL
1. Assumes City Garrisons, Garrison Logistics v2, Compact Garrison UI and City
   Events updates have already been installed in C:\Peris.
2. Extract this ZIP over C:\Peris, preserving folder paths. It contains only
   11 source/test files plus this README. Review git diff before committing.
3. npm.cmd test
4. npm.cmd run build
5. npm.cmd run test:city-logistics-db
6. npm.cmd run test:e2e (requires Playwright/browser setup)

VALIDATION HERE
* 21 selected domain tests passed, including garrison, ruins, logistics, and
  empire activity privacy/filtering. The live two-city fixture also passed
  save validation before and after dispatch.
* Changed TSX/TS transpiled without syntax errors. Edited CSS parsed cleanly.
* Full React/Vite and Playwright E2E were NOT runnable here because the project
  dependencies are absent from the reconstructed working copy. Run on your PC.

NO SUPABASE MIGRATION IS NEEDED.
This change is not pushed to GitHub.
