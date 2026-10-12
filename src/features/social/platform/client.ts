import {supabase} from '../../../platform/backend/supabase';
import type {Guild, GuildDetail, MessagePage, SocialCommand, SocialPlayer, SocialSnapshot, ThreadKind} from '../domain/social';
export type Directory<T=Guild|SocialPlayer> = {items:T[]; total:number; server_now:string};
export class SocialError extends Error {
  constructor(message:string, public code?:string) {super(message);}
}
export async function socialRpc<T>(fn:string, args:Record<string,unknown>={}, signal?:AbortSignal):Promise<T> {
  const query=supabase.rpc(fn,args);
  const response=await (signal?query.abortSignal(signal):query);
  if(response.error) {
    const error=response.error;
    throw new SocialError(error.code==='PGRST202'||error.code==='42883'?'Guilds and messages are not available in this world yet. Please try again after the world update.':error.message,error.code);
  }
  return response.data as T;
}
export const socialSnapshot=(signal?:AbortSignal)=>socialRpc<SocialSnapshot>('peris_social_snapshot',{},signal);
export const guildDetail=(id:string,signal?:AbortSignal)=>socialRpc<GuildDetail>('peris_social_guild',{p_id:id},signal);
export const socialDirectory=<T=Guild|SocialPlayer>(kind:'guilds'|'players',search='',focus='all',offset=0,signal?:AbortSignal)=>socialRpc<Directory<T>>('peris_social_directory',{p_kind:kind,p_search:search,p_focus:focus,p_offset:offset},signal);
export const threadPage=(kind:ThreadKind,id:string,before:number|null=null,signal?:AbortSignal)=>socialRpc<MessagePage>('peris_social_thread',{p_kind:kind,p_id:id,p_before:before},signal);
export const socialCommand=(id:string,command:SocialCommand)=>socialRpc<{ok:boolean; guild_id?:string; thread_id?:string; kind?:ThreadKind; message_id?:number}>('peris_social_command',{p_request_id:id,p_command:command});
