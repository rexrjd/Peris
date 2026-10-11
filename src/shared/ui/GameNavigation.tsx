import { Icon } from './Icons';

export type GameView = 'world' | 'settlement' | 'army' | 'chronicle';
const views = [
  { id: 'world', icon: 'world', label: 'Map' },
  { id: 'settlement', icon: 'town', label: 'City' },
  { id: 'army', icon: 'army', label: 'Armies' },
  { id: 'chronicle', icon: 'report', label: 'Reports' },
] as const;

export function GameNavigation({ view, rewards, unreadReports = 0, onNavigate }: {
  view: GameView; rewards: boolean; unreadReports?: number; onNavigate: (view: GameView) => void;
}) {
  return <nav className="game-navigation" aria-label="Game navigation">
    {views.map(item => <button key={item.id} className={item.id === 'chronicle' && unreadReports > 0 ? 'has-unread' : undefined} aria-label={item.id === 'chronicle' && unreadReports > 0 ? `Reports, ${unreadReports} unread` : undefined} aria-current={view === item.id ? 'page' : undefined} onClick={() => onNavigate(item.id)}>
      <Icon name={item.icon} size={17}/><span className="nav-label">{item.label}{item.id === 'chronicle' && unreadReports > 0 && <span className="nav-count" aria-hidden="true">{unreadReports}</span>}</span>
      {item.id === 'chronicle' && rewards && <i className="nav-dot" aria-label="Rewards available"/>}
    </button>)}
  </nav>;
}
