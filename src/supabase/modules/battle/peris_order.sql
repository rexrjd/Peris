create or replace function public.peris_order(p_battle_id bigint,p_order jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();b public.battles%rowtype;f public.battle_formations%rowtype;t public.battle_formations%rowtype;k text:=p_order->>'kind';px numeric;py numeric;n integer;i integer:=0;col integer;face numeric;cx numeric;cy numeric;spacing numeric;ang numeric;
begin
 select * into b from public.battles where id=p_battle_id for update;
 if u is null or b.id is null or (u is distinct from b.attacker_owner_id and u is distinct from b.defender_owner_id) then raise exception 'Not your battle';end if;
 if b.status<>'active' then raise exception 'Battle has ended';end if;
 if p_order is null or k is null or k not in ('move','attack','halt','stance','run','fire','width') then raise exception 'Invalid order';end if;
 if jsonb_typeof(p_order->'ids') is distinct from 'array' then raise exception 'Select a formation';end if;
 select count(*) into n from public.battle_formations where battle_id=b.id and owner_id=u and soldiers>0 and status<>'routed'
 and id in(select value::bigint from jsonb_array_elements_text(p_order->'ids'));
 if n<1 then raise exception 'Select a formation that can receive orders';end if;
 select avg(x),avg(y) into cx,cy from public.battle_formations where battle_id=b.id and owner_id=u and soldiers>0 and status<>'routed' and id in(select value::bigint from jsonb_array_elements_text(p_order->'ids'));
 spacing:=least(620.0/greatest(1,n-1),coalesce((p_order->>'columns')::integer,10)*8+24);
 ang:=coalesce((p_order->>'facing')::numeric,0)*pi()/180;
 if k='attack' then
 if b.phase<>'combat' then raise exception 'Begin the battle before attacking';end if;
 select * into t from public.battle_formations where id=(p_order->>'target')::bigint and battle_id=b.id;
 if t.id is null or t.owner_id=u or t.soldiers<=0 or t.status='routed' then raise exception 'Choose an enemy formation';end if;
 end if;
 if k='stance' and coalesce(p_order->>'stance','') not in ('balanced','guard','aggressive') then raise exception 'Invalid stance';end if;
 for f in select * from public.battle_formations where battle_id=b.id and owner_id=u and soldiers>0 and status<>'routed'
 and id in(select value::bigint from jsonb_array_elements_text(p_order->'ids')) order by id for update loop
 if k='move' then
 if p_order->>'x' is null or p_order->>'y' is null then raise exception 'Choose a destination';end if;
 px:=greatest(35,least(1165,(p_order->>'x')::numeric+case when p_order->>'facing' is null then f.x-cx else -sin(ang)*(i-(n-1)/2.0)*spacing end));
 py:=greatest(40,least(660,(p_order->>'y')::numeric+case when p_order->>'facing' is null then f.y-cy else cos(ang)*(i-(n-1)/2.0)*spacing end));
 if b.phase='deployment' and ((f.side='attacker' and px>365)or(f.side='defender' and px<835)) then raise exception 'Deploy inside your shaded zone';end if;
 face:=(p_order->>'facing')::numeric;col:=greatest(4,least(20,coalesce((p_order->>'columns')::integer,f.columns)));
 update public.battle_formations set target_x=px,target_y=py,target_facing=face,target_formation_id=null,charge_ready=false,columns=col,
 x=case when b.phase='deployment' then px else battle_formations.x end,y=case when b.phase='deployment' then py else battle_formations.y end,
 facing=case when b.phase='deployment' then coalesce(face,facing) else facing end,status=case when b.phase='deployment' then 'idle' else 'moving' end,updated_at=now() where id=f.id;
 elsif k='attack' then
 update public.battle_formations set target_formation_id=t.id,target_x=t.x,target_y=t.y,status='moving',target_facing=null,
 charge_ready=unit_type='cavalry' and stamina>35 and sqrt(power(t.x-x,2)+power(t.y-y,2))>140,updated_at=now() where id=f.id;
 elsif k='halt' then update public.battle_formations set target_formation_id=null,target_x=x,target_y=y,status='idle',charge_ready=false where id=f.id;
 elsif k='stance' then update public.battle_formations set stance=p_order->>'stance' where id=f.id;
 elsif k='run' then update public.battle_formations set running=coalesce((p_order->>'enabled')::boolean,not running) where id=f.id;
 elsif k='fire' then update public.battle_formations set fire_at_will=coalesce((p_order->>'enabled')::boolean,not fire_at_will) where id=f.id;
 elsif k='width' then update public.battle_formations set columns=greatest(4,least(20,(p_order->>'columns')::integer)) where id=f.id;
 end if;i:=i+1;
 end loop;
 return jsonb_build_object('ok',true);
end $$;

