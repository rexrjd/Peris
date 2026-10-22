-- City ruins columns must exist before SQL-language helpers such as
-- peris_station_owned() are defined. The later city/ruins.sql repeats these
-- idempotent additions so UPGRADE_CITY_RUINS.sql remains self-contained.
-- Preserve existing settlements and players; no backfill or data rewrite.
alter table public.settlements add column if not exists ruined_at timestamptz;
alter table public.players add column if not exists defeated_at timestamptz;
