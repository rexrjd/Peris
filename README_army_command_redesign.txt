PERIS — ARMY COMMAND REDESIGN

Apply the source files in this ZIP over the latest Peris checkout, preserving the same paths.
Then run npm run build. No dependencies or new SQL migrations are required for this redesign.
Existing online installations should already have the V10 empire/hero migration applied.

The standalone HTML is a separate complete offline playable build. Open it in your browser,
start or resume a solo campaign, and choose Armies in the navigation.

WHAT CHANGED
- A compact military command room with a horizontal roster for all owned armies.
- Faction-aware native commander portraits and separate Army / Commander / Equipment / Logistics views.
- Recruitment shows one troop type at a time, explicit city supplies, real capacity including queued troops,
  a resource-limited Max quantity, training duration, queue-inclusive arrival time and actionable blockers.
- Commander progression explains XP, skill points, class/training/equipment contributions, combat effects,
  and the empire-wide researched spellbook and battle mana.
- A five-slot artifact loadout and shared backpack with replacement comparisons, equip/unequip actions,
  and links to the hero carrying unavailable equipment.
- Troop transfers preview both armies after the transfer and block movement, distance, training and overflow.
  A rendezvous action sends the selected army to meet an idle receiver.
- Home-city changes preview the new smithy bonus before rebasing.
- A focused hiring dialog lets you pick class, name and city; the new army is selected after creation succeeds.
- The map has a commander picker with portraits, levels, troop counts and status; map handoffs focus the real army.
- Army/city IDs are explicit on recruitment, transfer, rebase and hero actions. Existing saves and V10 mechanics remain compatible.
- Modern slate/copper palette, responsive layouts, sticky section navigation and keyboard-accessible controls.

DESIGN REFERENCES
Total War: WARHAMMER II — army recruitment, character details and movement workflows:
https://academy.totalwar.com/warhammer2/
Heroes of Might and Magic — hero progression, artifacts and army synergies:
https://news.ubisoft.com/en-us/article/62HpoWQkAIVogVkoVk8JuJ/heroes-of-might-and-magic-olden-era-unveiled-at-gamescom
These references informed the structure; artwork is original native SVG.

VALIDATION
Production TypeScript/Vite build passed.
Full suite: 206 tests passed. Final focused army, gameplay and navigation checks: 27 passed.
Changed-files whitespace check passed; ZIP contents verified against the working source.
Browser visual and touch QA was unavailable and remains pending.

CHANGED SOURCE FILES (17)
src/app/App.tsx
src/app/styles/index.css
src/features/army/domain/commandRoom.ts
src/features/army/styles/command-room.css
src/features/army/ui/ArmyLogistics.tsx
src/features/army/ui/ArmyMapPicker.tsx
src/features/army/ui/ArmyView.tsx
src/features/army/ui/RecruitmentPanel.tsx
src/features/heroes/ui/EquipmentPanel.tsx
src/features/heroes/ui/HeroPanel.tsx
src/features/heroes/ui/HeroPortrait.tsx
src/features/heroes/ui/HireArmyDialog.tsx
src/features/map/ui/WorldView.tsx
src/shared/ui/GameNavigation.tsx
src/shared/ui/Icons.tsx
tests/army-command-room.test.ts
tests/game-navigation.test.ts
