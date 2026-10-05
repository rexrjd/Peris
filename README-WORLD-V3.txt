PERIS WORLD v3 - INSTALL

1. Extract this changed-files ZIP into the root of your canonical Peris repo.
2. Replace files when Windows asks.
3. In Supabase -> SQL Editor -> New query, run:
   supabase/upgrade-world-v3.sql
4. Test locally if desired with: npm run dev
5. Commit and push to main. Vercel will redeploy automatically.

WHAT THIS VERSION ADDS
- Permanent settlement per player
- Wood, stone, food and gold with real-time calculated production
- One starter army per player: 100 infantry, 40 archers, 10 cavalry
- Settlements do not move anymore
- Click the map to send your army
- Army movement uses departure/arrival timestamps and keeps progressing while offline
- Other players see army movement via Supabase Realtime

IMPORTANT
Run the SQL upgrade before testing the new frontend. It is designed to keep existing players and backfill a settlement + army for them.
