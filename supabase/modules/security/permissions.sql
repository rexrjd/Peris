-- Retire v4/v5 bypasses: clients cannot use instant upgrades, instant recruitment,
-- unaccepted challenges, or the old tactical simulation to circumvent v6 rules.
revoke all on function public.upgrade_building(text) from public,anon,authenticated;
revoke all on function public.recruit_units(integer,integer,integer)from public,anon,authenticated;
revoke all on function public.create_battle(uuid)from public,anon,authenticated;
revoke all on function public.issue_battle_move(bigint,bigint,integer,integer)from public,anon,authenticated;
revoke all on function public.issue_battle_attack(bigint,bigint,bigint)from public,anon,authenticated;
revoke all on function public.advance_battle(bigint)from public,anon,authenticated;
-- Restrict helpers even when Supabase defaults grant function execution to clients.
do $$declare r record;signature text;begin
 for r in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname like 'peris_%' loop
 signature:=r.oid::regprocedure::text;execute 'revoke all on function '||signature||' from public, anon, authenticated';
 end loop;
end $$;
revoke all on function public.create_player(text),public.sync_my_state(),public.move_army(integer,integer),public.retreat_from_battle(bigint)from public,anon;
grant execute on function public.create_player(text),public.sync_my_state(),public.move_army(integer,integer),public.retreat_from_battle(bigint)to authenticated;
grant execute on function public.peris_snapshot(),public.peris_map_snapshot(integer,integer,integer,integer),public.peris_march(integer,integer,jsonb),public.peris_queue_upgrade(text),public.peris_queue_slot(integer,text),public.peris_research_spell(text),public.peris_cast_spell(bigint,text,bigint),public.peris_queue_recruit(text,integer),public.peris_raid(integer),public.peris_ready(bigint),
 public.peris_order(bigint,jsonb),public.peris_tick(bigint),public.peris_rally(bigint),public.peris_challenge(uuid),public.peris_respond(bigint,boolean),public.peris_claim(text),public.peris_rename(text)to authenticated;

do $$declare t text;begin
 foreach t in array array['peris_orders','peris_reports','peris_challenges']loop
 begin execute format('alter publication supabase_realtime add table public.%I',t);exception when duplicate_object then null;end;
 end loop;
end $$;
commit;
