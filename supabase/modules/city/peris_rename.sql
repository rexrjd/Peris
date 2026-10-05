create or replace function public.peris_rename(p_name text)returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 if p_name is null or length(btrim(p_name))<2 or length(btrim(p_name))>32 then raise exception 'Use a name of 2-32 characters';end if;
 update public.settlements set name=btrim(p_name)where owner_id=auth.uid();return jsonb_build_object('ok',true);
end $$;

-- New players receive all eight structures; existing players keep their existing troops.
