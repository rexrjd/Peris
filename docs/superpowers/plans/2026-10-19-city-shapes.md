# Seeded native city shapes

Approved scope: Roman, Elf and Orc live 3D cities; two different cities per race.
Preserve building slot IDs, capacity, costs, commands, saves and painted Village.

1. Add pure `rendering/three/cityPlan.ts`: deterministic faction boundaries,
   reserved building sites, gate openings and connected walking streets. Cache
   bounded immutable plans by public geography/style. Test seeds, containment,
   separation, connected approaches and stable positions across growth first.
2. Derive optional native layout style from the existing city environment. Reuse
   the plan in layout, walls, terrain roads, resident paths, foliage clearance,
   camera and selector thumbnails. Keep legacy rendering for other factions.
   Reserve all future sites from the start so unlocking slots never moves a site.
3. Exercise six real cities through pointer/keyboard interaction, reload and city
   switching; inspect screenshots, check construction and reduced motion. Run
   unit/tooling/assets/build and affected browser suites. Record validation and
   update artwork documentation. No new model, dependency or SQL deployment.
