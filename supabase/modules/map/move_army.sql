-- Compatibility RPCs and raids still use the straight route. Sample every half
-- field so all traversed cells are validated by the authoritative land marcher.
create or replace function public.move_army(p_target_x integer,p_target_y integer)returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();a public.armies%rowtype;position jsonb;route jsonb;x numeric;y numeric;
 tx integer:=greatest(-12736,least(12736,p_target_x));ty integer:=greatest(-12736,least(12736,p_target_y));steps integer;i integer;
begin
 if u is null then raise exception 'Authentication required';end if;
 if p_target_x is null or p_target_y is null then raise exception 'Choose a destination';end if;
 perform public.peris_settle(u);
 select * into a from public.armies where owner_id=u for update;
 if a.id is null then raise exception 'Army not found';end if;
 position:=public.peris_army_position(a);x:=(position->>'x')::numeric;y:=(position->>'y')::numeric;
 steps:=greatest(1,ceil(greatest(abs(tx-x),abs(ty-y))/64)::integer);
 route:=jsonb_build_array(jsonb_build_array(x,y));
 for i in 1..steps loop
  route:=route||jsonb_build_array(case when i=steps then jsonb_build_array(tx,ty)else jsonb_build_array(x+(tx-x)*i/steps,y+(ty-y)*i/steps)end);
 end loop;
 return public.peris_march(tx,ty,route);
end $$;

