import type { Resources } from '../types/game'
import { RESOURCES } from '../game/rules'
import { Icon } from './Icons'
export function Cost({cost,resources,compact=false}:{cost:Resources;resources?:Resources;compact?:boolean}){
 return <div className={`cost ${compact?'compact':''}`}>{RESOURCES.filter(k=>cost[k]>0).map(k=><span key={k} className={resources&&resources[k]<cost[k]?'short':''} title={`${k}: ${cost[k]}`}><Icon name={k} size={compact?13:17}/><b>{cost[k].toLocaleString()}</b></span>)}</div>
}
export function Modal({title,children,onClose}:{title:string;children:React.ReactNode;onClose:()=>void}){return <div className="modal-backdrop" onClick={e=>{if(e.target===e.currentTarget)onClose()}}><section className="modal" role="dialog" aria-modal="true" aria-label={title}><button className="modal-close" aria-label="Close" onClick={onClose}>×</button><h2>{title}</h2>{children}</section></div>}
