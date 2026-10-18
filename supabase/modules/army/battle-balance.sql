-- All server battle entry points capture home-city doctrine before formations.
create or replace function public.peris_capture_battle_doctrine()returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.balance_version=2 then
  new.attacker_faction:=coalesce(new.attacker_faction,(select s.faction from public.armies a join public.settlements s on s.id=a.home_settlement_id where a.id=new.attacker_army_id),'roman');
  new.defender_faction:=coalesce(new.defender_faction,
   (select s.faction from public.settlements s where s.id=new.raid_city_id),
   (select s.faction from public.armies a join public.settlements s on s.id=a.home_settlement_id where a.id=new.defender_army_id),'roman');
 end if;
 return new;
end $$;
revoke all on function public.peris_capture_battle_doctrine()from public,anon,authenticated;
drop trigger if exists peris_capture_battle_doctrine on public.battles;
create trigger peris_capture_battle_doctrine before insert on public.battles for each row execute function public.peris_capture_battle_doctrine();
