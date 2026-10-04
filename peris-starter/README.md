# Peris

Browser strategy game prototype built with React, TypeScript, Vite and Phaser.

## Local development

```bash
npm install
npm run dev
```

Then open the local URL shown by Vite.

## Production build

```bash
npm run build
```

The built site is written to `dist/`.

## Deploy to Vercel

### Recommended: GitHub integration
1. Push this project to the `rexrjd/Peris` GitHub repository.
2. In Vercel, choose **Add New > Project**.
3. Import the GitHub repository.
4. Vercel should detect **Vite** automatically.
5. Build command: `npm run build`
6. Output directory: `dist`
7. Deploy.

### ZIP/manual route
You can also unpack this ZIP locally, push the files to GitHub, and then import the repository into Vercel.

## Current prototype

- React shell/UI
- Phaser 4 game canvas
- Placeholder strategic map
- Two settlements
- One movable army marker
- Responsive layout

Click anywhere on the map to move the blue army marker.

## Next milestones

1. Real tile/world data
2. Settlement selection
3. Resource state
4. Unit definitions
5. Army movement orders
6. Supabase authentication + PostgreSQL
7. Authoritative backend logic

Do not put secret API keys directly in source files. Use `.env` locally and Vercel Environment Variables for deployment.
