import {Icon} from '../../../shared/ui/Icons';
import type {SocialController} from './useSocial';
export function SocialStatus({social}:{social:SocialController}) {
  return <>{social.error&&<div className="social-alert" role="alert"><span>{social.error}</span><button title="Refresh" aria-label="Retry connection" onClick={()=>void social.refresh()}><Icon name="refresh" size={15}/></button></div>}{social.pending&&<div className="social-alert" role="status"><span>Action awaiting confirmation.</span><button disabled={social.busy} onClick={()=>void social.retry().catch(()=>{})}>Retry same action</button></div>}</>;
}
export function SharedWorldOnly({kind}:{kind:'guilds'|'messages'}) {
  return <div className="social-empty social-world-only"><Icon name={kind==='guilds'?'shield':'mail'} size={44}/><h3>{kind==='guilds'?'Find your people':'Talk to other rulers'}</h3><p>{kind==='guilds'?'Create a guild, forge alliances, and build a realm together.':'Private conversations and guild channels stay with your ruler account.'}</p><small>Enter the shared world from the main menu to get started.</small></div>;
}
export function Empty({title,children}:{title:string;children?:React.ReactNode}){return <div className="social-empty"><h3>{title}</h3>{children&&<p>{children}</p>}</div>;}
