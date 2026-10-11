-- Gameplay mutations keep a private receipt so a lost response can be retried.
create table if not exists public.peris_command_receipts(
 owner_id uuid not null references public.players(id) on delete cascade,
 request_id uuid not null, function_name text not null, arguments jsonb not null,
 response jsonb, created_at timestamptz not null default now(),
 primary key(owner_id,request_id)
);
alter table public.peris_command_receipts enable row level security;
revoke all on public.peris_command_receipts from public,anon,authenticated;

create or replace function public.peris_submit_command(p_request_id uuid,p_function text,p_args jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();previous public.peris_command_receipts%rowtype;answer jsonb;
begin
 if u is null or not exists(select 1 from public.players where id=u)then raise exception 'Authentication required';end if;
 if p_request_id is null or p_function is null or p_args is null or jsonb_typeof(p_args)<>'object' or octet_length(p_args::text)>100000 then raise exception 'Choose a valid command';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(u::text||':'||p_request_id::text,0));
 select * into previous from public.peris_command_receipts where owner_id=u and request_id=p_request_id;
 if previous.request_id is not null then
  if previous.function_name is distinct from p_function or previous.arguments is distinct from p_args then raise exception 'This request belongs to a different command';end if;
  return previous.response;
 end if;
 -- A fixed whitelist keeps the receipt endpoint from invoking private helpers.
 case p_function
 when 'peris_empire_command' then answer:=public.peris_empire_command(p_args->'p_command');
 when 'peris_campaign_farm_command' then answer:=public.peris_campaign_farm_command(p_args->'p_command');
 when 'peris_research_unit' then answer:=public.peris_research_unit((p_args->>'p_city')::bigint,p_args->>'p_unit');
 when 'peris_collect_garrison' then answer:=public.peris_collect_garrison((p_args->>'p_army')::bigint,nullif(p_args->'p_troops','null'::jsonb));
 when 'peris_claim_field' then answer:=public.peris_claim_field((p_args->>'p_col')::integer,(p_args->>'p_row')::integer);
 when 'peris_queue_field' then answer:=public.peris_queue_field((p_args->>'p_col')::integer,(p_args->>'p_row')::integer,p_args->>'p_type');
 when 'peris_set_faction' then perform public.peris_set_faction(p_args->>'p_faction');answer:='{}'::jsonb;
 when 'peris_debug_city' then perform public.peris_debug_city(p_args->>'p_action',p_args->>'p_target',(p_args->>'p_value')::integer);answer:='{}'::jsonb;
 when 'peris_research_spell' then answer:=public.peris_research_spell(p_args->>'p_spell');
 when 'peris_queue_slot' then answer:=public.peris_queue_slot((p_args->>'p_slot')::integer,p_args->>'p_type');
 when 'peris_queue_upgrade' then answer:=public.peris_queue_upgrade(p_args->>'p_type');
 when 'peris_queue_recruit' then answer:=public.peris_queue_recruit(p_args->>'p_type',(p_args->>'p_quantity')::integer);
 when 'peris_march' then answer:=public.peris_march((p_args->>'p_target_x')::integer,(p_args->>'p_target_y')::integer,p_args->'p_path');
 when 'move_army' then answer:=public.move_army((p_args->>'p_target_x')::integer,(p_args->>'p_target_y')::integer);
 when 'peris_raid' then answer:=public.peris_raid((p_args->>'p_camp_id')::integer);
 when 'peris_ready' then answer:=public.peris_ready((p_args->>'p_battle_id')::bigint);
 when 'retreat_from_battle' then answer:=public.retreat_from_battle((p_args->>'p_battle_id')::bigint);
 when 'peris_claim' then answer:=public.peris_claim(p_args->>'p_quest_id');
 when 'peris_rename' then answer:=public.peris_rename(p_args->>'p_name');
 when 'peris_challenge' then answer:=public.peris_challenge((p_args->>'p_defender')::uuid);
 when 'peris_respond' then answer:=public.peris_respond((p_args->>'p_id')::bigint,(p_args->>'p_accept')::boolean);
 else raise exception 'This command is not available';
 end case;
 insert into public.peris_command_receipts(owner_id,request_id,function_name,arguments,response)values(u,p_request_id,p_function,p_args,coalesce(answer,'{}'::jsonb));
 return coalesce(answer,'{}'::jsonb);
end $$;
