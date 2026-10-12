create or replace function public.peris_add_formations(p_battle bigint,p_owner uuid,p_side text,p_inf integer,p_arc integer,p_cav integer,p_morale numeric)
returns void language plpgsql security definer set search_path='' as $$
declare unit_name text;typ text;n integer;total integer;i integer;amount integer;px numeric;py numeric;cap integer;roster jsonb;rule public.peris_unit_catalog;aid bigint;
begin
 select case when p_side='attacker' then attacker_army_id else defender_army_id end into aid from public.battles where id=p_battle;
 select public.peris_roster(to_jsonb(a))into roster from public.armies a where a.id=aid and a.owner_id=p_owner;
 roster:=coalesce(roster,public.peris_roster(jsonb_build_object('infantry',p_inf,'archers',p_arc,'cavalry',p_cav)));
 if p_side='defender'and exists(select 1 from public.battles where id=p_battle and raid_city_id is not null)then roster:=public.peris_city_defender_roster(p_battle);end if;
 foreach unit_name in array array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult']loop
 select * into rule from public.peris_unit_catalog where unit=unit_name;typ:=rule.combat_class;total:=(roster->>unit_name)::integer;
 cap:=case typ when 'infantry' then 60 when 'archers' then 40 else 24 end;
 n:=least(6,ceil(total::numeric/cap)::integer);if n<=0 then continue;end if;
 for i in 0..n-1 loop
 amount:=total/n+case when i<total%n then 1 else 0 end;
 px:=case when p_side='attacker' then case when typ='infantry'then 285 when typ='cavalry'then 205 else 175 end else case when typ='infantry'then 915 when typ='cavalry'then 995 else 1025 end end;
 px:=px+600*(sqrt(5)-1);
 py:=case when typ='cavalry' then case when i%2=0 then 75+(i/2)*65 else 625-(i/2)*65 end else round(350+(i-(n-1)/2.0)*least(105,490.0/greatest(1,n-1))) end;
 py:=py+350*(sqrt(5)-1);
 insert into public.battle_formations(battle_id,owner_id,side,unit_type,recruit_unit,unit_attack,unit_defence,unit_speed,label,initial_soldiers,soldiers,morale,x,y,target_x,target_y,facing,columns)
 values(p_battle,p_owner,p_side,typ,unit_name,rule.attack,rule.defence,rule.speed::numeric/case typ when 'infantry'then 40 when 'archers'then 34 else 76 end,unit_name||' '||(i+1),amount,amount,least(100,p_morale),px,py,px,py,case when p_side='attacker' then 0 else 180 end,case when typ='cavalry' then 6 else 10 end);
 end loop;end loop;
 -- Advanced formations share the same class lane without spawning on top of one another.
 if exists(select 1 from public.battle_formations where battle_id=p_battle and side=p_side and recruit_unit not in('infantry','archers','cavalry'))then
  with lanes as(select id,row_number()over(partition by unit_type order by id)-1 as i,count(*)over(partition by unit_type)as n from public.battle_formations where battle_id=p_battle and side=p_side)
  update public.battle_formations f set y=350*sqrt(5)+(l.i-(l.n-1)/2.0)*least(105,490.0/greatest(1,l.n-1)),target_y=350*sqrt(5)+(l.i-(l.n-1)/2.0)*least(105,490.0/greatest(1,l.n-1))from lanes l where f.id=l.id;
 end if;
 perform public.peris_apply_hero(p_battle,p_owner,p_side);
end $$;
