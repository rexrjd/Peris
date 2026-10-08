# Compact city header

This update targets the resource bar and the area immediately above the city shown in the 8 October screenshots.

- Four resource readouts show stock, capacity, income, and a storage bar. Full storage has an amber bar; negative food income is labeled and highlighted. Clicking a resource opens its existing supplies ledger.
- The city name, faction/plot count, City/Buildings switch, residents/staffing, Economy disclosure, and Build shortcut occupy one toolbar instead of three separate rows.
- Economy details open over the scene. Opening them does not move the city farther down the page.
- Food income is no longer repeated in the city summary.
- The city header has an explicit neutral background, overriding the green legacy heading.
- At narrower widths the toolbar wraps, resource values remain readable, and the existing mobile game menu stays accessible.

## Install

Apply this ZIP over the previous modern-UI version, preserving the paths. All modified files are complete replacements; both new files `src/shared/ui/ResourceHud.tsx` and `src/app/styles/city-hud.css` are required. The updated `src/app/styles/index.css` loads the HUD styles last.

No dependencies or database changes are required. Run `npm run build` and `npm test`.

The optional standalone HTML preview embeds the game and assets. Download it and open it in a browser, continue/start a solo campaign, then enter City.

## Checks

Production build passed. All 166 Node tests passed with `node --import tsx --test --test-concurrency=2 tests/*.test.ts`, including stock/capacity/rate rendering, storage-bar bounds, the compact economy summary, and the single-toolbar structure. Browser visual verification was unavailable in this environment.
