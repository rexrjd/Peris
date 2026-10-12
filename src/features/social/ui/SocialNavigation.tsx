import {LowPolyIcon} from '../../../shared/ui/LowPolyIcon';
export function SocialNavigation({active,unread,attention,onOpen}:{active:'guilds'|'messages'|null;unread:number;attention:number;onOpen:(panel:'guilds'|'messages')=>void}) {
  return <nav className="social-navigation" aria-label="Community navigation">{(['guilds','messages'] as const).map(id=>{
    const count=id==='messages'?unread:attention,label=id==='guilds'?'Guilds':'Messages';
    return <button key={id} data-panel={id} title={`${label}${count?` · ${count} ${id==='messages'?'unread':'pending'}`:''}`} aria-label={count?`${label}, ${count} ${id==='messages'?'unread':'pending'}`:label} aria-haspopup="dialog" aria-expanded={active===id} className={active===id?'is-active':''} onClick={()=>onOpen(id)}><LowPolyIcon name={id}/><span className="social-nav-label">{label}</span>{count>0&&<b className="social-nav-count" aria-hidden="true">{count>99?'99+':count}</b>}</button>;
  })}</nav>;
}
