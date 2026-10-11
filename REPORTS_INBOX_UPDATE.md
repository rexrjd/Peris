# Report inbox and floating header

Changed files for the root Peris application, based on `origin/main` at
`06a1a6d215748b270965d2c9c7ee9ddafa4a1bd4`. Merge paths into the repository;
keep unrelated files. The Rally Point, farms, nine-role troops and pending-order
retry system are preserved, along with the latest Windows generator fix.

## Install

1. On an existing V17 world, run the updated
   `supabase/UPDATE_REPORT_READ_STATUS.sql` in the Supabase SQL editor.
   Run it again even if you installed the previous report-read patch: this
   revision adds Read all, older-history pages and a full-history unread count.
2. If V17 is not installed yet, run the included `supabase/UPGRADE_TO_V17.sql`
   instead. Do not use a fresh installer to update an existing world.
3. Deploy the frontend, including `public/art/ui/low-poly-v1/rally.webp`.

No live database changes or deployment were performed when preparing this ZIP.

## Interface

- Navigation and resources occupy two small floating groups. The middle is
  transparent, showing the map and allowing map pointer input through it.
- Rally Point has an original low-poly blue pennant, matching the other UI art.
  Its untouched PNG, complete prompt and runtime WebP are recorded in
  `assets/ui-low-poly-v1.json`; rebuild with `npm run build:ui-icons`.
- Reports opens directly into the battle inbox. Milestones have a separate tab.
- Search by camp, battle or hero; filter unread reports, losses or equipment,
  choose an outcome, and sort by date. Search covers the loaded history;
  shared worlds offer Load older reports for earlier receipts.
- Desktop pairs a compact list with one readable detail pane. Mobile opens a
  focused receipt with Back to reports. Nothing becomes read just by opening
  the Reports page.
- Receipts show losses, delivered or travelling spoils, hero XP and artifact
  pictures. Net resources retain the actual delivery and casualty-cost rules.
  Older PvP receipts without a known side show labelled attacking/defending
  forces, rather than guessing the player's losses.

## Read status and privacy

Read all marks the ruler's entire history, including receipts outside the first
50-row snapshot and quiet farm receipts. First-read timestamps are preserved;
reports created afterward remain unread. Online state is shared across devices,
and solo state is saved in the campaign. Failed writes keep reports unread and
can be retried. Read metadata never overwrites a pending gameplay order.

`peris_report_page(bigint)` returns at most 50 older, visible, private receipts.
`peris_read_all_reports()` has no client-supplied owner. Both use the current
name-account binding and reject anonymous access. Snapshot counts respect the
existing losses-only farm preferences.

## Development verification

Run `npm test`, `npm run test:tooling`, `npm run assets:check`, `npm run build`,
`npm run check:ui-icons`, `npm run check:sql`, `npm run check:report-reads`,
`npm run check:camp-artifact-upgrade`, `npm run test:report-reads-db`,
`npm run test:command-receipts-db`, `npm run test:farm-parity-db`, and
`npm run test:fresh`. Browser coverage exercises desktop, mobile, a 320px header,
report search and filters, reward art, pruned receipts, solo persistence,
PostgreSQL-backed history and read failures, Rally Point, shortcuts and map input.

## Design references

The compact chronological inbox, category filters and readable individual
receipts draw on the official [Travian Kingdoms report guide](https://support.kingdoms.com/en/articles/19-reports)
and [Travian Legends report guide](https://support.travian.com/en/articles/58-reports).
The map-first placement of controls also follows the principle illustrated in
[Grepolis's interface guide](https://support.innogames.com/kb/Grepolis/en_DK/3581/Interface).
The layout and pictures shipped here are original; no external game art is used.

Verified on this revision: production build passed; 427 unit tests passed
(one existing skip); all 23 distinct desktop/mobile browser checks passed,
including the six affected cases rerun after final spacing and portrait fixes.
The read-status, command-receipt, farm-parity and fresh-world database suites
passed. Modular SQL, focused migration, eight UI exports and 46 registered
models passed their checks.
