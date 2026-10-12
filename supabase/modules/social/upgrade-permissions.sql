-- Social-only migration permissions. Campaign helper grants remain untouched.
do $$declare r record;begin
 for r in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public'and(p.proname like 'peris_social_%'or p.proname like 'peris_guild_%')loop
  execute 'revoke all on function '||r.oid::regprocedure::text||' from public,anon,authenticated';
 end loop;
end $$;
grant execute on function public.peris_social_snapshot(),public.peris_social_directory(text,text,text,integer),public.peris_social_guild(uuid),public.peris_social_thread(text,uuid,bigint),public.peris_social_command(uuid,jsonb)to authenticated;
notify pgrst,'reload schema';
