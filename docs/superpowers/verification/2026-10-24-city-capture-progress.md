# City capture progress

Plan: `docs/superpowers/plans/2026-10-24-city-capture.md`

- User confirmed attackers can defeat defenders and then persuade with surviving diplomats.
- Ruling: reuse existing Diplomacy technology to unlock the tenth role, keeping all 210 research nodes and artwork intact.
- Ruling: preserve developed city/fields/faction and evacuate former-owner soldiers rather than convert their ownership. One diplomat establishes government on capture. Occupying army retains its existing home and commander.
- Pre-flight: root owns domain/catalog/types/save; SQL and UI have independent file scopes and consume this contract.
- Implemented domain loyalty, culture checks, ownership transfer, occupation, evacuation and receipt replay protection.
- Implemented authoritative SQL, tenth-role recruitment/combat/crop handling, private loyalty, focused upgrade and compatibility restores for older focused installers.
- Implemented live 3D Main-building recruitment, capture review, owned loyalty, result receipts and original diplomat portraits/instanced geometry for all eleven factions; Canvas retains its identity.
- Final review fixed research heritage switching when an older foreign city is acquired. TypeScript and SQL regressions cover both rulers.
- Desktop/mobile browser flow passed all eight cases. Screenshot review found the new unit's internal label in battle presentation; corrected to its faction title and covered by a presentation regression.
- Verification results and deployment limits: `2026-10-24-city-capture-results.md`.
