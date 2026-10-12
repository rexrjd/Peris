import { LowPolyIcon } from './LowPolyIcon';

export type GameView = 'research' | 'world' | 'settlement' | 'rally' | 'army' | 'chronicle';
const views = [
  { id: 'world', icon: 'map', label: 'Map' },
  { id: 'settlement', icon: 'city', label: 'City' },
  { id: 'rally', icon: 'rally', label: 'Rally Point' },
  { id: 'army', icon: 'army', label: 'Armies' },
  { id:'research',icon:'research',label:'Research' },
  { id: 'chronicle', icon: 'reports', label: 'Reports' },
] as const;

export function GameNavigation({ view, unreadReports = 0, reportsOpen = false, research, onNavigate }: {
  view: GameView; research?:{id:string;name:string;progress:number}; reportsOpen?: boolean; rewards?: boolean; unreadReports?: number; onNavigate: (view: GameView) => void;
}) {
  return <nav className="game-navigation" aria-label="Game navigation">
    {views.map(item => <button key={item.id} title={item.id==='research'&&research?`Researching ${research.name} · ${Math.floor(research.progress*100)}%`:undefined} className={item.id === 'chronicle' && unreadReports > 0 ? 'has-unread' : undefined} aria-label={item.id === 'chronicle' && unreadReports > 0 ? `Reports, ${unreadReports} unread` : undefined} aria-haspopup={item.id==='chronicle'?'dialog':undefined} aria-expanded={item.id==='chronicle'?reportsOpen:undefined} aria-current={view === item.id ? 'page' : undefined} onClick={() => onNavigate(item.id)}>
      {item.id==='research'&&research?<><img className="hud-picture" src={`/art/research/v1/${research.id}.webp`} alt="" width={24} height={24}/><span className="nav-research-progress" aria-label={`${research.name} ${Math.floor(research.progress*100)}% complete`}><i style={{width:`${Math.min(100,research.progress*100)}%`}}/></span></>:<LowPolyIcon name={item.icon}/>}<span className="nav-label">{item.label}{item.id === 'chronicle' && unreadReports > 0 && <span className="nav-count" aria-hidden="true">{unreadReports}</span>}</span>
    </button>)}
  </nav>;
}
