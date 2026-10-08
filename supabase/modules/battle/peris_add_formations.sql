create or replace function public.peris_add_formations(p_battle bigint,p_owner uuid,p_side text,p_inf integer,p_arc integer,p_cav integer,p_morale numeric)
returns void language plpgsql security definer set search_path='' as $$
declare typ text;n integer;total integer;i integer;amount integer;px integer;py integer;cap integer;
begin
 foreach typ in array array['infantry','archers','cavalry'] loop
 total:=case typ when 'infantry' then p_inf when 'archers' then p_arc else p_cav end;
 cap:=case typ when 'infantry' then 60 when 'archers' then 40 else 24 end;
 n:=least(6,ceil(total::numeric/cap)::integer);if n<=0 then continue;end if;
 for i in 0..n-1 loop
 amount:=total/n+case when i<total%n then 1 else 0 end;
 px:=case when p_side='attacker' then case when typ='infantry' then 285 else 175 end else case when typ='infantry' then 915 else 1025 end end;
 py:=case when typ='cavalry' then case when i%2=0 then 110+i*15 else 590-i*15 end else round(350+(i-(n-1)/2.0)*105+case when typ='archers' then 15 else 0 end) end;
 insert into public.battle_formations(battle_id,owner_id,side,unit_type,label,initial_soldiers,soldiers,morale,x,y,target_x,target_y,facing,columns)
 values(p_battle,p_owner,p_side,typ,(case typ when 'infantry' then 'Legionaries' when 'archers' then 'Sagittarii' else 'Equites' end)||' '||(i+1),amount,amount,least(100,p_morale),px,py,px,py,case when p_side='attacker' then 0 else 180 end,case when typ='cavalry' then 6 else 10 end);
 end loop;
 end loop;
 update public.battle_formations set attack_multiplier=1+least(.6,coalesce((select sum(c.level)*.04 from public.peris_city_slots c join public.settlements s on s.id=c.settlement_id where s.owner_id=p_owner and c.building_type='smithy'),0)) where battle_id=p_battle and owner_id=p_owner;
end $$;

