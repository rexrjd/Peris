-- Review/install V17 first; enable pg_cron through Supabase Database / Extensions.
select cron.schedule('peris-world-worker','10 seconds','select public.peris_game_tick(40)');
-- Verify: select * from cron.job where jobname='peris-world-worker';
-- Pause: select cron.unschedule(jobid) from cron.job where jobname='peris-world-worker';
