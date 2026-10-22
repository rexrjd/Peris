PERIS - Compact inherited-theme Garrison UI

Change summary:
- Reuses the same card, dropdown and tab styling as CitySelector.
- Inherits faction palettes and materials from scene-theme.css; removes Garrison-specific slate/blue palette.
- Shrinks the collapsed card's decorative icon and removes duplicated metric tiles.
- A small dropdown displays permanent troop chips, Station/Withdraw, legion choice,
  a one-row quantity input + Max control per available troop type, and one action.
- Fast shortcuts: Select max across types or Max for a single troop type.
- Click outside/Escape to close; no old Defence button or full-screen modal.
- Keeps the existing city garrison commands, player ownership, troop conservation,
  server authority, offline autobattles, and the wall +50% maximum unchanged.

Extract ZIP directly into C:\Peris, preserving relative paths.
This patch replaces only:
  src/features/city/ui/CityGarrisonPanel.tsx
  src/features/city/styles/city-garrison.css
  tests/city-selector.test.ts

Local verification requested:
  npm.cmd test
  npm.cmd run build

No Supabase migration necessary.
