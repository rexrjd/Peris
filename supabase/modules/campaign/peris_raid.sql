create or replace function public.peris_raid(p_camp_id integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();c public.peris_camps%rowtype;a public.armies%rowtype;
begin
 if u is null then raise exception 'Authentication required';end if;
 select * into c from public.peris_camps where id=p_camp_id;if c.id is null then raise exception 'Camp not found';end if;
 perform public.peris_settle(u);
 select * into a from public.armies where owner_id=u for update;if a.id is null or a.infantry+a.archers+a.cavalry=0 then raise exception 'Recruit soldiers before starting a raid';end if;
 if exists(select 1 from public.peris_progress where owner_id=u and camp_id=p_camp_id and available_at>now()) then raise exception 'The camp is still regrouping';end if;
 perform public.move_army(c.x,c.y);update public.armies set raid_target_id=c.id where owner_id=u;
 return jsonb_build_object('ok',true);
end $$;

