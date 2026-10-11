import { Icon } from './Icons';
import { LowPolyIcon } from './LowPolyIcon';

export type GameView = 'world' | 'settlement' | 'rally' | 'army' | 'chronicle';
const views = [
  { id: 'world', icon: 'map', label: 'Map' },
  { id: 'settlement', icon: 'city', label: 'City' },
  { id: 'rally', icon: 'rally', label: 'Rally Point' },
  { id: 'army', icon: 'army', label: 'Armies' },
  { id: 'chronicle', icon: 'report', label: 'Reports' },
] as const;

export function GameNavigation({ view, unreadReports = 0, onNavigate }: {
  view: GameView; rewards?: boolean; unreadReports?: number; onNavigate: (view: GameView) => void;
}) {
  return <nav className="game-navigation" aria-label="Game navigation">
    {views.map(item => <button key={item.id} className={item.id === 'chronicle' && unreadReports > 0 ? 'has-unread' : undefined} aria-label={item.id === 'chronicle' && unreadReports > 0 ? `Reports, ${unreadReports} unread` : undefined} aria-current={view === item.id ? 'page' : undefined} onClick={() => onNavigate(item.id)}>
      {item.icon !== 'report' ? <LowPolyIcon name={item.icon}/> : <Icon name={item.icon} size={17}/>}<span className="nav-label">{item.label}{item.id === 'chronicle' && unreadReports > 0 && <span className="nav-count" aria-hidden="true">{unreadReports}</span>}</span>
    </button>)}
  </nav>;
}
