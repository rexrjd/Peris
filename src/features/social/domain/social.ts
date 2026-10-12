export const GUILD_LIMIT = 60;
export const PERMISSIONS = ['invite', 'recruitment', 'kick', 'roles', 'edit', 'diplomacy', 'announce', 'treasury'] as const;
export type Permission = typeof PERMISSIONS[number];
export const PERMISSION_LABELS: Record<Permission, string> = {invite:'Invite players', recruitment:'Review applications', kick:'Remove members', roles:'Manage ranks', edit:'Edit guild', diplomacy:'Manage diplomacy', announce:'Post announcements', treasury:'Withdraw gold'};
export const CREST_COLORS = ['#637da3', '#b58b5f', '#ab646d', '#8274aa', '#708d92', '#b7a46b'] as const;
export const CREST_SIGILS = ['sun', 'moon', 'swords', 'mountain', 'star', 'tower'] as const;
export type Crest = {color:string; sigil:typeof CREST_SIGILS[number]};
export type Recruitment = 'open' | 'application' | 'invite';
export type Focus = 'balanced' | 'warfare' | 'economy' | 'adventure';
export type Guild = {id:string; name:string; tag:string; description:string; motd?:string; recruitment:Recruitment; focus:Focus; crest:Crest; leader_id:string; created_at:string; members:number; population:number; cities:number; online:number; treasury?:number};
export type GuildRole = {id:string; guild_id:string; name:string; key:string; rank:number; permissions:Permission[]};
export type SocialPlayer = {id:string; name:string; faction:string; cities:number; population:number; online:boolean; guild_id?:string|null; guild_tag?:string|null; last_seen_at?:string|null};
export type GuildMember = SocialPlayer & {role_id:string; role_name:string; rank:number; joined_at:string; specialization:'balanced'|'offense'|'defense'|'economy'};
export type GuildInvite = {id:string; guild_id:string; player_id:string; player_name:string; guild_name:string; guild_tag:string; crest:Crest; expires_at:string; created_at:string};
export type GuildApplication = {id:string; guild_id:string; player_id:string; player_name:string; body:string; created_at:string};
export type GuildRelation = {id:string; left_id:string; right_id:string; proposer_id:string; kind:'alliance'|'nap'|'war'; status:'pending'|'active'; other_id:string; other_name:string; other_tag:string; crest:Crest};
export type GuildDetail = {guild:Guild; members:GuildMember[]; roles:GuildRole[]; permissions:Permission[]; relations:GuildRelation[]; invitations:GuildInvite[]; applications:GuildApplication[]; log:{id:number; text:string; created_at:string}[]; ledger:{id:number; player_name:string; amount:number; created_at:string}[]};
export type ThreadKind = 'direct'|'guild';
export type Message = {id:number; sender_id:string; sender_name:string; body:string; kind:'message'|'announcement'; created_at:string};
export type Thread = {id:string; kind:ThreadKind; name:string; player_id?:string; guild_tag?:string; crest?:Crest; last_body:string|null; last_at:string|null; unread:number; archived:boolean; blocked:boolean};
export type MessagePage = {messages:Message[]; before:number|null; server_now:string};
export type SocialSnapshot = {server_now:string; guild_id:string|null; guild_tag:string|null; threads:Thread[]; invitations:GuildInvite[]; applications:GuildApplication[]; attention:number; unread:number; blocked:SocialPlayer[]};
export type SocialCommand = {type:string; [key:string]:unknown};
export const emptySocial = ():SocialSnapshot => ({server_now:new Date(0).toISOString(), guild_id:null, guild_tag:null, threads:[], invitations:[], applications:[], attention:0, unread:0, blocked:[]});
export function hasPermission(detail:GuildDetail|null, permission:Permission):boolean {return !!detail?.permissions.includes(permission);}
export function validateGuild(name:string, tag:string):string|null {
  if(name.trim().length<3 || name.trim().length>32) return 'Use 3–32 characters for the guild name.';
  if(!/^[A-Za-z0-9]{2,5}$/.test(tag.trim())) return 'Use 2–5 letters or numbers for the tag.';
  return null;
}
export function canManageMember(actor:GuildMember, target:GuildMember, permission:boolean):boolean {return permission && actor.id!==target.id && actor.rank>target.rank;}
export function mergeMessages(previous:Message[], incoming:Message[]):Message[] {
  const records=new Map(previous.map(message=>[message.id,message]));
  for(const message of incoming) records.set(message.id,message);
  return [...records.values()].sort((a,b)=>a.id-b.id);
}
export function relativeTime(iso:string|null, now=Date.now()):string {
  if(!iso) return '';
  const seconds=Math.max(0,(now-Date.parse(iso))/1000);
  return seconds<60?'now':seconds<3600?`${Math.floor(seconds/60)}m`:seconds<86400?`${Math.floor(seconds/3600)}h`:`${Math.floor(seconds/86400)}d`;
}
