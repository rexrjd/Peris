# Compact header and persistent report reads

Based on `origin/main` at `d239ffc`.
The ZIP contains changed files with their project-relative paths. Merge these
into the current root application; keep unrelated files from the repository.
The latest Rally Point navigation, report economics, farm controls and nine-role
troop operations are preserved. Report read receipts use a separate idempotent
RPC, so opening a report cannot replace a pending troop-order retry.

## Install on an existing V17 world

1. Run `supabase/UPDATE_REPORT_READ_STATUS.sql` in the Supabase SQL editor.
2. Deploy the updated frontend, including `public/art/ui/low-poly-v1/`.

The focused SQL adds nullable `peris_reports.read_at` and the authenticated
`peris_read_reports(bigint[])` RPC. It preserves existing reports and account
bindings. It can be run again safely. Fresh installs and full V17 upgrades also
include the same module in the regenerated SQL bundles.

If the new Rally Point server update has not been installed yet, run
`supabase/UPGRADE_TO_V17.sql` from this ZIP instead. It includes both the new
command retry system and report read tracking.

## Behaviour

- The brand/name is removed from the header. Desktop uses a 44px charcoal strip
  with compact navigation and a clear centre; mobile uses a compact supply strip
  and bottom navigation.
- Seven original transparent low-poly pictures depict map, city, armies, timber,
  stone, food and gold. Sources, full prompts and runtime files are included.
- Resource buttons show a picture and abbreviated stock. Hover exposes exact
  amounts, capacity and income; opening supplies shows the full details.
- Reports are yellow only while unread. Opening an individual report stores its
  first read timestamp. Opening the Reports tab alone does not mark everything
  read, and available milestone rewards do not highlight the tab.
- Shared-world status belongs to the ruler in PostgreSQL and follows name-only
  logins across devices. Old browser receipts migrate into that state. Solo
  campaigns preserve read timestamps in saves and exports. Migration batches
  preserve previously read receipts even when there are more than 50.
- Legacy camps with null faction metadata use the existing Roman display fallback
  when showing troops. This fixes an observed online display crash.

## Development checks

`npm test`, `npm run test:tooling`, `npm run assets:check`, `npm run build`,
`npm run check:ui-icons`, `npm run check:sql`, `npm run check:report-reads`,
`npm run check:camp-artifact-upgrade`, `npm run test:report-reads-db`,
`npm run test:command-receipts-db`, `npm run test:farm-parity-db`,
`npm run test:army-parity-db`, `npm run test:integration-db`, and
`npm run test:fresh` cover the affected changes.
Browser coverage includes header controls on desktop/mobile, a 320px layout,
solo read persistence, PostgreSQL-backed read persistence after browser receipts
are cleared, existing artifact equipment, quick access, Rally Point saved reports
and report delivery economics.

Validation against `d239ffc`: production build passed, 424 unit tests passed
(one existing skip), 19 browser checks passed, and all six database suites above
passed. SQL generators and all seven UI picture exports matched their sources.

Regenerate UI exports with `npm run build:ui-icons`. For SQL source changes, run
`npm run build:report-reads` and `npm run build:sql`.
