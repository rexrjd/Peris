create or replace function public.peris_raid(p_camp_id integer) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 return public.peris_prepare_raid(p_camp_id);
end $$;

