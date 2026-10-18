-- Focused unit balance upgrade for an existing V19 world. No scheduler or reset.
begin;
do $$begin
 if to_regprocedure('public.peris_social_snapshot()')is null or to_regclass('public.peris_unit_catalog')is null then
  raise exception 'Install V19 first, or use the complete V19 upgrade.';
 end if;
end $$;
