import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Modal} from '../../../shared/ui/Shared';
import {Icon} from '../../../shared/ui/Icons';
import {mergeMessages,relativeTime,type Message,type SocialPlayer,type Thread} from '../domain/social';
import {threadPage} from '../platform/client';
import {Crest} from './Crest';
import {PlayerFinder} from './GuildsPanel';
import {Empty,SharedWorldOnly,SocialStatus} from './SocialShared';
import type {SocialController} from './useSocial';
import {PollBackoff} from '../../../platform/backend/polling';
import '../styles/scene-social.css';
export type MessageTarget={player?:SocialPlayer;guild?:boolean;request:number};
export function MessagesPanel({social,target,onClose}:{social:SocialController;target?:MessageTarget;onClose:()=>void}) {
  const [selected,setSelected]=useState<{id:string;kind:'direct'|'guild'}|null>(null),[draft,setDraft]=useState<SocialPlayer|null>(null),[compose,setCompose]=useState(false),[filter,setFilter]=useState<'all'|'unread'|'archived'>('all'),[query,setQuery]=useState(''),[blocks,setBlocks]=useState(false);
  const pickPlayer=(player:SocialPlayer)=>{
    const existing=social.snapshot.threads.find(t=>t.kind==='direct'&&t.player_id===player.id);
    if(existing){setSelected({id:existing.id,kind:'direct'});setDraft(null);}else{setSelected(null);setDraft(player);}setCompose(false);
  };
  useEffect(()=>{if(target?.player)pickPlayer(target.player);else if(target?.guild&&social.snapshot.guild_id){setSelected({id:social.snapshot.guild_id,kind:'guild'});setDraft(null);setCompose(false);}},[target?.request]);
  useEffect(()=>{if(selected?.kind==='guild'&&selected.id!==social.snapshot.guild_id)setSelected(null);},[social.snapshot.guild_id,selected?.id]);
  const thread=social.snapshot.threads.find(t=>t.id===selected?.id&&t.kind===selected?.kind)??null;
  const items=social.snapshot.threads.filter(t=>(filter==='archived'?t.archived:!t.archived)&&(filter!=='unread'||t.unread>0)&&t.name.toLowerCase().includes(query.toLowerCase()));
  const closeConversation=()=>{setSelected(null);setDraft(null);setCompose(false);};
  const active=compose||!!selected||!!draft;
  return <Modal title="Messages" heading={false} className={`social-panel messages-panel ${active?'has-conversation':''}`} backdropClassName="social-backdrop" onClose={onClose}>
    <header className="social-heading"><div><span className="social-eyebrow">YOUR CONVERSATIONS</span><h2>Messages{social.snapshot.unread>0&&<small>{social.snapshot.unread} unread</small>}</h2></div><div className="social-heading-actions"><button title="Mark all messages read" aria-label="Mark all messages read" disabled={!social.snapshot.unread||social.busy} onClick={()=>void social.acknowledge({type:'read_all'})}><Icon name="check" size={17}/></button><button title="Blocked players" aria-label="Blocked players" onClick={()=>{setBlocks(v=>!v);closeConversation();}}><Icon name="settings" size={17}/></button><button className="social-primary" title="New message" aria-label="New message" disabled={!social.online} onClick={()=>{closeConversation();setCompose(true);setBlocks(false);}}><Icon name="plus" size={18}/></button></div></header>
    <SocialStatus social={social}/>{!social.online?<SharedWorldOnly kind="messages"/>:<div className="message-workspace">
      <aside className="message-inbox" aria-label="Conversations"><label className="social-search"><Icon name="search" size={15}/><input type="search" aria-label="Search conversations" value={query} placeholder="Find a conversation…" onChange={e=>setQuery(e.target.value)}/></label><div className="message-filters">{(['all','unread','archived'] as const).map(f=><button key={f} aria-pressed={filter===f} title={f==='all'?'All conversations':f==='unread'?'Unread conversations':'Archived conversations'} aria-label={f==='all'?'All conversations':f==='unread'?'Unread conversations':'Archived conversations'} onClick={()=>setFilter(f)}><Icon name={f==='all'?'mail':f==='unread'?'time':'reports'} size={16}/><span>{f==='all'?'All':f==='unread'?'Unread':'Archive'}</span></button>)}</div>
      <div className="message-thread-list">{items.map(t=><button key={`${t.kind}:${t.id}`} className={`message-thread ${t.unread?'is-unread':''} ${selected?.id===t.id?'is-selected':''}`} onClick={()=>{setSelected({id:t.id,kind:t.kind});setDraft(null);setCompose(false);setBlocks(false);}}>{t.crest?<Crest crest={t.crest} size={36}/>:<span className="message-avatar">{t.name.slice(0,2).toUpperCase()}</span>}<span className="message-thread-content"><strong>{t.kind==='guild'?`[${t.guild_tag}] Guild chat`:t.name}<small>{relativeTime(t.last_at)}</small></strong><span>{t.last_body||'Start the conversation.'}</span></span>{t.unread>0&&<b className="message-unread-count">{t.unread>99?'99+':t.unread}</b>}</button>)}{!items.length&&<Empty title={filter==='unread'?'All caught up':filter==='archived'?'No archived conversations':'No conversations yet'}>{filter==='all'?'Write to a ruler or join your guild’s channel.':undefined}</Empty>}</div>
      </aside><section className="message-main">{blocks?<div className="message-blocked-list"><button className="message-back" onClick={()=>setBlocks(false)}>← Back</button><h3>Blocked players</h3><p className="social-muted">Blocked players can still see old conversations. New private messages are prevented in both directions.</p>{social.snapshot.blocked.map(p=><div key={p.id}><strong>{p.name}</strong><button disabled={social.busy} onClick={()=>void social.send({type:'unblock',player_id:p.id}).catch(()=>{})}>Unblock</button></div>)}{!social.snapshot.blocked.length&&<Empty title="No blocked players"/>}</div>:compose?<div className="message-compose-picker"><button className="message-back" onClick={closeConversation}>← Conversations</button><h3>Write to a ruler</h3><PlayerFinder label="Message" onSelect={pickPlayer}/></div>:thread||draft?<Conversation key={thread?`${thread.kind}:${thread.id}`:`draft:${draft!.id}`} social={social} thread={thread} player={draft} onBack={closeConversation} onSent={(id,kind)=>{setSelected({id,kind});setDraft(null);}}/>:<div className="message-welcome"><Icon name="mail" size={48}/><h3>A quieter way to coordinate</h3><p>Plan with your guild. Make a deal.<br/>Say hello to the ruler next door.</p><button className="social-primary" onClick={()=>setCompose(true)}>New message</button></div>}</section>
    </div>}
  </Modal>;
}

function Conversation({social,thread,player,onBack,onSent}:{social:SocialController;thread:Thread|null;player:SocialPlayer|null;onBack:()=>void;onSent:(id:string,kind:'direct'|'guild')=>void}) {
  const [messages,setMessages]=useState<Message[]>([]),[before,setBefore]=useState<number|null>(null),[text,setText]=useState(''),[loading,setLoading]=useState(!!thread),[olderBusy,setOlderBusy]=useState(false),[error,setError]=useState('');
  const list=useRef<HTMLDivElement>(null),sticky=useRef(true),lastRead=useRef(0),priorHeight=useRef<number|null>(null),firstLoad=useRef(true),alive=useRef(true),sending=useRef(false);
  const kind=thread?.kind??'direct',name=thread?.kind==='guild'?thread.name:thread?.name??player?.name??'Ruler',recipient=thread?.player_id??player?.id;
  const acknowledge=()=>{
    const last=messages.at(-1)?.id;
    if(!thread||!last||last<=lastRead.current||!sticky.current||document.visibilityState!=='visible'||!document.hasFocus())return;
    if(Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).at(-1)!==list.current?.closest('[role="dialog"]'))return;
    lastRead.current=last;void social.acknowledge({type:'read',kind:thread.kind,id:thread.id,up_to:last}).then(success=>{if(!success)lastRead.current=0;});
  };
  useEffect(()=>{
    alive.current=true;
    if(!thread)return;
    const controller=new AbortController(),backoff=new PollBackoff();let fetching=false;
    const fetchPage=async()=>{if(fetching||document.visibilityState!=='visible'||!backoff.ready(Date.now()))return;fetching=true;try{const result=await threadPage(thread.kind,thread.id,null,controller.signal);if(!controller.signal.aborted){backoff.reset();setMessages(previous=>mergeMessages(previous,result.messages));if(firstLoad.current){setBefore(result.before);firstLoad.current=false;}setLoading(false);setError('');}}catch(e){if(!controller.signal.aborted){backoff.fail(Date.now());setError(e instanceof Error?e.message:'Could not load conversation.');setLoading(false);}}finally{fetching=false;}};
    void fetchPage();const timer=window.setInterval(()=>void fetchPage(),2000);window.addEventListener('focus',fetchPage);
    return()=>{alive.current=false;controller.abort();window.clearInterval(timer);window.removeEventListener('focus',fetchPage);};
  },[thread?.id,thread?.kind]);
  useLayoutEffect(()=>{
    const element=list.current;if(!element)return;
    if(priorHeight.current!==null){element.scrollTop+=element.scrollHeight-priorHeight.current;priorHeight.current=null;}
    else if(sticky.current)element.scrollTop=element.scrollHeight;
  },[messages]);
  useEffect(()=>{acknowledge();const focus=()=>acknowledge();window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);return()=>{window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);};},[messages,thread?.id,social.acknowledge]);
  const loadOlder=async()=>{
    if(!thread||!before||olderBusy)return;setOlderBusy(true);
    try{const result=await threadPage(thread.kind,thread.id,before);if(!alive.current)return;priorHeight.current=list.current?.scrollHeight??null;sticky.current=false;setMessages(prev=>mergeMessages(prev,result.messages));setBefore(result.before);}
    catch(e){setError(e instanceof Error?e.message:'Could not load older messages.');}finally{if(alive.current)setOlderBusy(false);}
  };
  const send=async()=>{
    if(!text.trim()||sending.current||social.busy||social.pending)return;sending.current=true;setError('');
    try{const result=await social.send({type:'send',kind,player_id:recipient,body:text});setText('');sticky.current=true;
      if(!thread&&result.thread_id&&result.kind)onSent(result.thread_id,result.kind);
      else if(thread){const result=await threadPage(thread.kind,thread.id);if(alive.current)setMessages(prev=>mergeMessages(prev,result.messages));}
    }catch(e){setError(e instanceof Error?e.message:'Could not send your message.');}finally{sending.current=false;}
  };
  const control=async(type:'archive'|'block'|'unblock')=>{
    try{await social.send(type==='archive'?{type,id:thread!.id,kind:'direct',archived:!thread!.archived}:{type,player_id:recipient});if(type==='archive')onBack();}catch(e){setError(e instanceof Error?e.message:'The action could not be completed.');}
  };
  return <div className="message-conversation"><header className="message-conversation-heading"><button className="message-back" aria-label="Back to conversations" title="Back to conversations" onClick={onBack}>←</button>{thread?.crest?<Crest crest={thread.crest} size={34}/>:<span className="message-avatar">{name.slice(0,2).toUpperCase()}</span>}<div><h3>{name}</h3><small>{kind==='guild'?'Guild channel · members only':'Private conversation'}</small></div>{kind==='direct'&&thread&&<details className="message-options"><summary aria-label="Conversation options" title="Conversation options">⋯</summary><div><button disabled={social.busy} onClick={()=>void control('archive')}>{thread.archived?'Restore conversation':'Archive conversation'}</button><button className={thread.blocked?'':'social-danger'} disabled={social.busy} onClick={()=>void control(thread.blocked?'unblock':'block')}>{thread.blocked?'Unblock player':'Block player'}</button></div></details>}</header>
    {error&&<div className="social-alert" role="alert">{error}</div>}
    <div className="message-history" ref={list} role="log" aria-label="Message history" aria-live="polite" aria-relevant="additions text" onScroll={()=>{const el=list.current!;sticky.current=el.scrollHeight-el.scrollTop-el.clientHeight<70;acknowledge();}}>
      {before&&<button className="message-load-older" disabled={olderBusy} onClick={()=>void loadOlder()}>{olderBusy?'Loading…':'Earlier messages'}</button>}
      {loading&&<p className="social-muted">Opening conversation…</p>}{!loading&&!messages.length&&<Empty title={kind==='guild'?'Your guild’s campfire':'Start a conversation'}>{kind==='guild'?'Share plans, ask for help, or welcome a new member.':'Your message will be waiting when they next log in.'}</Empty>}
      {messages.map((message,index)=>{const date=new Date(message.created_at).toLocaleDateString(undefined,{month:'short',day:'numeric'}),previous=index?new Date(messages[index-1].created_at).toLocaleDateString(undefined,{month:'short',day:'numeric'}):null;return <div key={message.id}>{date!==previous&&<div className="message-day"><span>{date}</span></div>}<article className={`message-bubble ${message.sender_id===social.owner?'is-own':''} ${message.kind==='announcement'?'is-announcement':''}`}>{(kind==='guild'||message.kind==='announcement')&&<strong>{message.kind==='announcement'&&<Icon name="flag" size={13}/>} {message.kind==='announcement'?'Announcement · ':''}{message.sender_name}</strong>}<p>{message.body}</p><time dateTime={message.created_at}>{new Date(message.created_at).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}</time></article></div>;})}
    </div>
    <form className="message-reply" onSubmit={e=>{e.preventDefault();void send();}}>{thread?.blocked?<div className="message-blocked-notice"><span>You blocked this player.</span><button type="button" onClick={()=>void control('unblock')}>Unblock</button></div>:<><textarea aria-label={thread?'Write a reply':'Write a message'} placeholder={kind==='guild'?'Message your guild…':'Write a message…'} maxLength={2000} rows={2} value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send();}}}/><div><small>{text.length>1800?`${text.length}/2000`:'Enter to send · Shift + Enter for a new line'}</small><button className="social-primary" type="submit" aria-label="Send message" title="Send message" disabled={social.busy||!!social.pending||!text.trim()}><Icon name="arrow" size={18}/></button></div></>}</form>
  </div>;
}
