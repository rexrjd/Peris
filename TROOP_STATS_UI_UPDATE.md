# Troop catalog and inspection — V19.3

The Armies page always shows the complete nine-role roster, including troops with zero soldiers. Each faction keeps its existing names and artwork. Cards show counts, troop roles, base attack and base defence. Research locks never prevent inspection.

Clicking a troop opens a compact stats dialog rather than recruitment. The dialog contains base and army attack/defence, tactical speed, ranged reach, carry capacity, commander morale, training building and level, the real time to train ten soldiers, costs per soldier, and research requirements. Additional combat details cover damage coefficients, stamina, routing, equipment/smithy bonuses and siege effects. Previous/next controls browse all nine roles. Recruit this troop opens the existing form with that exact unit selected; locked units link to their technology in Research.

The stats selector builds an isolated preview formation and applies the existing research and army selectors. It never changes saves, troop counts, resources or orders. Army values describe permanent bonuses; terrain, stance, target walls and temporary spells modify an actual battle. Melee reach is shown as contact because it depends on formation geometry. This combat system tracks casualties rather than separate hit points per soldier.

The dialog uses the shared focus trap, restores focus after Escape, scrolls back to the heading when changing troop type, and remains usable at 320px. Recruitment, transfer, city building panels, commands and database rules retain their existing paths.

## Compatibility

Built on `origin/main` at `61581c7121cc6c6c9650211ad19d6e563eb7bb5d`, which already contains the previous Armies redesign. This archive is an incremental patch. Copy its files into that repository preserving relative paths, then review the diff and run the normal checks. No SQL or asset installation is required.

## Verification

- `npm test`: 445 passed, one existing skip.
- `npm run test:tooling`: four passed.
- `npm run assets:check`: 46 registered models passed.
- `npm run build`: passed, including TypeScript and both artwork checks. Existing large-chunk advisories remain.
- Eight distinct affected browser checks passed across desktop and mobile: recruitment/army selection, equipment, empty-army management, and complete troop inspection. Inspection exercises all nine types, stat values, portrait paths, read-only saves, next/previous browsing, the recruitment handoff, research navigation, focus trapping and 320px overflow.
- Desktop and mobile captures were inspected locally. Browser verification uses software WebGL; it does not establish hardware frame rates.

The two new domain tests compare every inspected role against formations created by the real camp-raid flow and cover empty/locked units, legacy unlocks and minimum batch training time. Server functions were not changed or deployed.
