create or replace function public.move_army(p_target_x integer,p_target_y integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();a public.armies%rowtype;t numeric;x numeric;y numeric;tx integer:=greatest(45,least(1155,p_target_x));ty integer:=greatest(55,least(715,p_target_y));seconds numeric;
begin
 if u is null then raise exception 'Authentication required';end if;
 if p_target_x is null or p_target_y is null then raise exception 'Choose a destination';end if;
 perform public.peris_settle(u);
 if exists(select 1 from public.battles where status='active' and (attacker_owner_id=u or defender_owner_id=u)) then raise exception 'Finish the current battle first';end if;
 if exists(select 1 from public.peris_orders where owner_id=u and kind='recruit') then raise exception 'Let training finish before marching';end if;
 select * into a from public.armies where owner_id=u for update;if a.id is null then raise exception 'Army not found';end if;
 t:=case when a.status='moving' then greatest(0,least(1,extract(epoch from(now()-a.departure_at))/greatest(0.001,extract(epoch from(a.arrival_at-a.departure_at))))) else 1 end;
 x:=a.start_x+(a.target_x-a.start_x)*t;y:=a.start_y+(a.target_y-a.start_y)*t;seconds:=greatest(2,sqrt(power(tx-x,2)+power(ty-y,2))/22);
 update public.armies set start_x=round(x),start_y=round(y),target_x=tx,target_y=ty,departure_at=now(),arrival_at=now()+make_interval(secs=>seconds::double precision),status='moving',raid_target_id=null,updated_at=now() where id=a.id;
 return jsonb_build_object('ok',true);
end $$;

