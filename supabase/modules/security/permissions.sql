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
grant execute on function public.peris_empire_command(jsonb),public.peris_scout_command(jsonb)to authenticated;
grant execute on function public.peris_submit_command(uuid,text,jsonb)to authenticated;
grant execute on function public.peris_campaign_farm_command(jsonb)to authenticated;
grant execute on function public.peris_research_unit(bigint,text)to authenticated;
grant execute on function public.peris_read_reports(bigint[])to authenticated;
grant execute on function public.peris_read_all_reports(),public.peris_report_page(bigint)to authenticated;
grant execute on function public.peris_collect_garrison(bigint,jsonb)to authenticated;
-- The argument-free identity helper is required by RLS; it exposes only the
-- caller's current ruler UUID. Session bindings themselves remain inaccessible.
grant execute on function public.peris_player_id(),public.peris_login(text)to authenticated;
grant execute on function public.peris_enter_account(text,text,text,uuid)to authenticated;
grant execute on function public.peris_account_directory(text,text,text,text,integer,integer)to anon,authenticated;
grant execute on function public.peris_claim_field(integer,integer),public.peris_queue_field(integer,integer,text),public.peris_set_faction(text),public.peris_debug_city(text,text,integer),public.peris_snapshot(),public.peris_map_snapshot(integer,integer,integer,integer),public.peris_march(integer,integer,jsonb),public.peris_queue_upgrade(text),public.peris_queue_slot(integer,text),public.peris_research_spell(text),public.peris_cast_spell(bigint,text,bigint),public.peris_queue_recruit(text,integer),public.peris_raid(integer),public.peris_ready(bigint),
 public.peris_order(bigint,jsonb),public.peris_tick(bigint),public.peris_rally(bigint),public.peris_challenge(uuid),public.peris_respond(bigint,boolean),public.peris_claim(text),public.peris_rename(text)to authenticated;

do $$declare t text;begin
 foreach t in array array['peris_account_science','peris_research_progress','peris_map_plots','peris_orders','peris_reports','peris_challenges','peris_campaign_farm_lists','peris_campaign_farms','peris_garrisons']loop
 begin execute format('alter publication supabase_realtime add table public.%I',t);exception when duplicate_object then null;end;
 end loop;
end $$;
grant execute on function public.peris_game_tick(integer)to service_role;
grant execute on function public.peris_social_snapshot(),public.peris_social_directory(text,text,text,integer),public.peris_social_guild(uuid),public.peris_social_thread(text,uuid,bigint),public.peris_social_command(uuid,jsonb)to authenticated;
grant execute on function public.peris_guild_reinforcement_targets(),public.peris_guild_reinforcement_status()to authenticated;
grant execute on function public.peris_trade_targets(),public.peris_trade_status()to authenticated;
grant execute on function public.peris_rankings(text)to authenticated;
notify pgrst,'reload schema';
commit;
