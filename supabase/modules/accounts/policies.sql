-- Rewrite the existing ownership predicates, preserving every policy name,
-- role, command and other condition. This includes the original battle policies
-- on upgraded databases, not only policies declared in this release's modules.
do $$declare p record;predicate text;check_predicate text;statement text;begin
 for p in select pol.polname,ns.nspname,t.relname,
  pg_get_expr(pol.polqual,pol.polrelid)as qual,
  pg_get_expr(pol.polwithcheck,pol.polrelid)as check_qual
  from pg_policy pol join pg_class t on t.oid=pol.polrelid
  join pg_namespace ns on ns.oid=t.relnamespace where ns.nspname='public'
  and (left(t.relname,6)='peris_' or t.relname in('players','spawn_points','settlements','buildings','armies','battles','battle_formations'))
 loop
  predicate:=replace(p.qual,'auth.uid()','public.peris_player_id()');
  check_predicate:=replace(p.check_qual,'auth.uid()','public.peris_player_id()');
  if predicate is distinct from p.qual or check_predicate is distinct from p.check_qual then
   statement:=format('alter policy %I on %I.%I',p.polname,p.nspname,p.relname);
   if predicate is not null then statement:=statement||' using ('||predicate||')';end if;
   if check_predicate is not null then statement:=statement||' with check ('||check_predicate||')';end if;
   execute statement;
  end if;
 end loop;
end $$;

