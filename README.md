# Peris v0.4 — Realm Alpha

Browser-based persistent strategy prototype built with React, Phaser, Supabase and Vercel.

## What this prototype does

- Name-only anonymous accounts
- Server-assigned non-overlapping spawn positions
- One permanent settlement per ruler
- Offline resource production
- Four upgradeable production buildings
- One persistent army per ruler
- Server-authoritative recruitment costs
- Server-authoritative army movement and travel time
- Shared realtime world for multiple players

## IMPORTANT: reset the prototype database

This version intentionally replaces the previous prototype schema.

In Supabase:

1. Open **SQL Editor**.
2. Open `supabase/RESET_AND_CREATE_V4.sql` from this repository.
3. Paste the whole file into a new query.
4. Run it once.

This removes all existing **public Peris game data** and recreates the world. It does **not** delete Supabase Auth users. Existing anonymous browser sessions will simply be asked to choose a ruler name again.

Do not run the old `schema.sql` or `upgrade-world-v3.sql` after the v4 reset.

## Local development

```bash
npm install
npm run dev
```

## Deployment

Push to `main` in `rexrjd/Peris`. Vercel is connected to that repository and will redeploy automatically.

## Current game loop

1. Found a realm.
2. Accumulate resources over real time.
3. Upgrade production buildings.
4. Recruit units.
5. Issue army movement orders on the shared map.
6. Close the browser and return later — production and travel are based on timestamps.

Next milestone: raids, combat resolution, battle reports and territory control.
