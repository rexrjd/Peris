PERIS GUILD REINFORCEMENTS - SOURCE PATCH

Apply these files to your *current* C:\Peris working tree, after the previous city logistics/UI updates and the V19 Guilds feature.

IMPORTANT: This release includes a NEW migration: supabase/UPGRADE_GUILD_REINFORCEMENTS.sql
Its SQL is not executed automatically by git push. Apply it BEFORE client deployment.

1. Backup your repository and database.
2. Extract the ZIP to C:\Peris, keeping its directories. Review git diff before staging.
3. Run npm.cmd run build:sql && npm.cmd run check:sql.
4. Run npm.cmd test and npm.cmd run build.
5. Run your PGlite database suites and validate UPGRADE_GUILD_REINFORCEMENTS.sql in a PostgreSQL transaction BEFORE applying in Production.
6. After DB migration applies, deploy client. Ensure peris_game_tick is scheduled.

Design:
- Events / Send troops offers My cities and Guild members.
- Guild source is own city's permanent garrison; destination is a living city of a guild member.
- Soldiers remain sender-owned and stationed under sender identity; no hero/legion minted.
- Guild troops join a city autobattle and lose their own proportional casualties.
- Sender can recall stationed reinforcements (not during an active raid at the city).
- Offline worker processes outgoing and returning shipments; changes in membership or ruined city trigger return.

Limitations in this environment:
- SQL module code and standalone focused migration created and checked by source contract tests.
- No actual PGlite/PostgreSQL execution; local archive lacks some current-repo modules.
- No full TS/Vite/browser verification. Run locally before production deployment.
