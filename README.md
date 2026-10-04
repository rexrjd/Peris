# Peris

Browser strategy game prototype built with React, TypeScript, Vite, Phaser and Supabase.

## What this version adds

- Google authentication through Supabase
- One persistent player record per Google account
- Shared multiplayer map
- Realtime player movement
- Blue marker = you, red marker = another player
- Click anywhere on the map to move

## Required Supabase setup

### 1. Database

Open Supabase > SQL Editor, create a new query, paste everything from:

`supabase/schema.sql`

Run it once.

### 2. Google login

Open Supabase > Authentication > Providers > Google and enable it.

In Google Cloud create an OAuth Web application and use the callback URL shown by Supabase. It will look like:

`https://YOUR_PROJECT.supabase.co/auth/v1/callback`

Paste the Google Client ID and Client Secret back into Supabase.

### 3. Redirect URLs

In Supabase > Authentication > URL Configuration set the production Site URL to your Vercel URL and allow both:

- `http://localhost:5173/**`
- your Vercel production URL followed by `/**`

## Local development

```bash
npm install
npm run dev
```

## Deploy

Push the files to GitHub. Vercel will redeploy automatically.

The current Supabase publishable URL/key are included as temporary client-side fallbacks in `src/lib/supabase.ts`. They can later be replaced with Vercel environment variables named `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
