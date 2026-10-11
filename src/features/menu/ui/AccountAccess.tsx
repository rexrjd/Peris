import { useEffect, useRef, useState } from 'react';
import { FACTIONS, type Faction } from '../../factions/domain/factions';
import { heroPortraitUrl } from '../../heroes/domain/portraits';
import { accountDirectory, ACCOUNT_PAGE_SIZE, type AccountDirectory, type DirectoryFilters, type PublicAccount } from '../../../platform/backend/accountDirectory';
import { rulerName, type AccountEntry } from '../../../platform/backend/accountLogin';
import { lastRulerName } from '../../../platform/backend/accountStorage';
import { Icon } from '../../../shared/ui/Icons';

const initialFilters: DirectoryFilters = { search: '', faction: '', activity: 'all', sort: 'active', page: 0 };
const races = Object.keys(FACTIONS) as Faction[];
const number = (value: number) => value.toLocaleString();
function activity(account: PublicAccount, now: string) {
    if (account.online) return 'Online now';
    if (!account.last_seen_at) return 'Not seen recently';
    const minutes = Math.max(1, Math.floor((Date.parse(now) - Date.parse(account.last_seen_at)) / 60000));
    if (minutes < 60) return `Seen ${minutes}m ago`;
    if (minutes < 1440) return `Seen ${Math.floor(minutes / 60)}h ago`;
    return `Seen ${Math.floor(minutes / 1440)}d ago`;
}
function Portrait({ account, faction, large = false }: { account?: PublicAccount; faction?: Faction; large?: boolean }) {
    return <img className={`account-portrait${large ? ' large' : ''}`} src={heroPortraitUrl(account?.hero_faction ?? account?.faction ?? faction, account?.hero_class ?? undefined, account?.hero_id ?? undefined)} alt="" loading={large ? 'eager' : 'lazy'} />;
}
function Stats({ account }: { account: PublicAccount }) {
    return <dl className="account-stats"><div><dt>Cities</dt><dd>{number(account.city_count)}</dd></div><div><dt>Armies</dt><dd>{number(account.army_count)}</dd></div><div><dt>Population</dt><dd>{number(account.population)}</dd></div><div><dt>Strongest hero</dt><dd>{account.hero_level ? `Level ${account.hero_level}` : '—'}</dd></div></dl>;
}
export function AccountAccess({ onOpen, busy, error }: { onOpen: (name: string, entry: AccountEntry) => void; busy: boolean; error: string | null }) {
    const [tab, setTab] = useState<'login' | 'create'>('login');
    const [attempt, setAttempt] = useState<'login' | 'create'>('login');
    const [manualName, setManualName] = useState(() => lastRulerName());
    const [newName, setNewName] = useState('');
    const [race, setRace] = useState<Faction>('roman');
    const [filters, setFilters] = useState<DirectoryFilters>(initialFilters);
    const [data, setData] = useState<AccountDirectory | null>(null);
    const [selected, setSelected] = useState<PublicAccount | null>(null);
    const [loading, setLoading] = useState(true);
    const [rosterError, setRosterError] = useState<string | null>(null);
    const [validation, setValidation] = useState<string | null>(null);
    const [revision, setRevision] = useState(0);
    const creation = useRef<{ key: string; id: string } | null>(null);
    const preview = useRef<HTMLElement>(null);
    const remembered = useRef(lastRulerName().toLowerCase());
    useEffect(() => {
        if (tab !== 'login') return;
        const controller = new AbortController();
        let cancelled = false;
        setLoading(true); setRosterError(null);
        const timer = window.setTimeout(() => {
            void accountDirectory(filters, controller.signal).then(result => {
                if (cancelled) return;
                if (filters.page && filters.page * ACCOUNT_PAGE_SIZE >= result.total) {
                    setFilters(previous => ({ ...previous, page: 0 })); return;
                }
                setData(result);
                setSelected(previous => result.accounts.find(account => account.player_id === previous?.player_id)
                    ?? result.accounts.find(account => account.display_name.toLowerCase() === remembered.current)
                    ?? result.accounts[0] ?? null);
            }).catch(cause => { if (!cancelled) setRosterError(cause instanceof Error ? cause.message : 'The roster could not be loaded. Please retry.'); })
                .finally(() => { if (!cancelled) setLoading(false); });
        }, filters.search ? 250 : 0);
        return () => { cancelled = true; window.clearTimeout(timer); controller.abort(); };
    }, [filters, revision, tab]);
    useEffect(() => {
        if (tab !== 'login') return;
        const timer = window.setInterval(() => setRevision(value => value + 1), 45000);
        return () => window.clearInterval(timer);
    }, [tab]);
    const changeFilter = (next: Partial<DirectoryFilters>) => setFilters(previous => ({ ...previous, ...next, page: 0 }));
    const chooseTab = (next: 'login' | 'create') => { setTab(next); setValidation(null); };
    const open = (name: string, mode: 'login' | 'create') => {
        if (busy) return;
        setAttempt(mode); setValidation(null);
        try {
            const normalized = rulerName(name);
            if (mode === 'login') onOpen(normalized, { mode });
            else {
                const key = `${normalized.toLowerCase()}:${race}`;
                if (creation.current?.key !== key) creation.current = { key, id: crypto.randomUUID() };
                onOpen(normalized, { mode, faction: race, creationId: creation.current.id });
            }
        } catch (cause) { setValidation(cause instanceof Error ? cause.message : 'Check your ruler name.'); }
    };
    const message = validation ?? (attempt === tab ? error : null);
    return <div className="account-access">
        <header className="account-heading"><div><span className="account-kicker">ONE WORLD. YOUR STORY.</span><h1>{tab === 'login' ? 'Choose your ruler.' : 'A new realm begins.'}</h1><p>{tab === 'login' ? 'Find your account and pick up where you left off.' : 'Choose a name and the people who will build your first city.'}</p></div>
            <div className="account-tabs" role="group" aria-label="Account access"><button type="button" className={tab === 'login' ? 'active' : ''} aria-pressed={tab === 'login'} disabled={busy} onClick={() => chooseTab('login')}>Log in</button><button type="button" className={tab === 'create' ? 'active' : ''} aria-pressed={tab === 'create'} disabled={busy} onClick={() => chooseTab('create')}>Create account <span aria-hidden="true">+</span></button></div>
        </header>
        {message && <div className="account-error" role="alert">{message}</div>}
        {tab === 'login' ? <div className="account-layout">
            <section className="account-roster" aria-label="Ruler roster">
                <div className="account-search"><Icon name="world" size={18}/><input aria-label="Search rulers" placeholder="Search ruler name…" value={filters.search} maxLength={40} disabled={busy} onChange={event => changeFilter({ search: event.target.value })}/><span>{data ? `${number(data.total)} rulers` : 'Shared world'}</span></div>
                <div className="account-filters"><div className="account-activity" role="group" aria-label="Activity filter">{(['all', 'online', 'recent'] as const).map(value => <button type="button" key={value} disabled={busy} aria-pressed={filters.activity === value} className={filters.activity === value ? 'active' : ''} onClick={() => changeFilter({ activity: value })}>{value === 'all' ? 'All rulers' : value === 'online' ? 'Online' : 'Last 24h'}</button>)}</div>
                    <select aria-label="Filter by race" value={filters.faction} disabled={busy} onChange={event => changeFilter({ faction: event.target.value as Faction | '' })}><option value="">All races</option>{races.map(id => <option key={id} value={id}>{FACTIONS[id].name}</option>)}</select>
                    <select aria-label="Sort rulers" value={filters.sort} disabled={busy} onChange={event => changeFilter({ sort: event.target.value as DirectoryFilters['sort'] })}><option value="active">Recent activity</option><option value="name">Name A–Z</option><option value="cities">Most cities</option><option value="hero">Hero level</option></select>
                </div>
                {rosterError ? <div className="account-empty" role="status"><Icon name="world" size={28}/><h2>World roster unavailable</h2><p>{rosterError}</p><button type="button" className="account-outline" onClick={() => setRevision(value => value + 1)}>Retry roster</button></div>
                    : loading && !data ? <div className="account-grid" aria-label="Loading rulers" role="status">{Array.from({ length: 6 }, (_, index) => <div key={index} className="account-skeleton"><i/><span/><span/></div>)}</div>
                    : <><div className={`account-grid${loading ? ' refreshing' : ''}`} aria-busy={loading}>{data?.accounts.map(account => <button type="button" key={account.player_id} className={`account-card${selected?.player_id === account.player_id ? ' selected' : ''}`} aria-pressed={selected?.player_id === account.player_id} disabled={busy || loading} aria-label={`Select ${account.display_name}`} onClick={() => setSelected(account)}>
                        <Portrait account={account}/><div className="account-card-copy"><strong>{account.display_name}</strong><span>{FACTIONS[account.faction].name}</span><small>{account.city_count} {account.city_count === 1 ? 'city' : 'cities'} <b>·</b> {account.army_count} {account.army_count === 1 ? 'army' : 'armies'} <b>·</b> Hero {account.hero_level || '—'}</small></div><span className={`account-presence${account.online ? ' online' : ''}`} title={activity(account, data!.server_now)} aria-label={activity(account, data!.server_now)}><i/></span>
                    </button>)}</div>
                    {!loading && data?.total === 0 && <div className="account-empty" role="status"><Icon name="flag" size={28}/><h2>{filters.search || filters.faction || filters.activity !== 'all' ? 'No matching rulers' : 'Be the first ruler'}</h2><p>{filters.search || filters.faction || filters.activity !== 'all' ? 'Try another name, race or activity filter.' : 'Create an account to found the first city in this world.'}</p><button type="button" className="account-outline" onClick={() => filters.search || filters.faction || filters.activity !== 'all' ? setFilters(initialFilters) : chooseTab('create')}>{filters.search || filters.faction || filters.activity !== 'all' ? 'Reset filters' : 'Create your account'}</button></div>}
                    {!!data?.total && <div className="account-pagination"><span>{loading ? 'Updating roster…' : `Showing ${filters.page * ACCOUNT_PAGE_SIZE + 1}–${Math.min((filters.page + 1) * ACCOUNT_PAGE_SIZE, data.total)} of ${number(data.total)}`}</span><div><button type="button" aria-label="Previous rulers" disabled={busy || loading || filters.page === 0} onClick={() => setFilters(previous => ({ ...previous, page: previous.page - 1 }))}>←</button><button type="button" aria-label="Next rulers" disabled={busy || loading || (filters.page + 1) * ACCOUNT_PAGE_SIZE >= data.total} onClick={() => setFilters(previous => ({ ...previous, page: previous.page + 1 }))}>→</button></div></div>}
                    </>}
                <details className="account-manual"><summary>Log in by name <span>Already know your ruler?</span></summary><form onSubmit={event => { event.preventDefault(); open(manualName, 'login'); }}><label htmlFor="existing-ruler">YOUR RULER NAME</label><div><input id="existing-ruler" value={manualName} onChange={event => setManualName(event.target.value)} minLength={2} maxLength={20} required autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={busy}/><button type="submit" className="account-outline" disabled={busy}>{busy ? 'Opening…' : 'Enter the shared world'}</button></div></form></details>
            </section>
            <aside className="account-preview" ref={preview} aria-label="Selected ruler">{selected && !rosterError ? <>
                <div className="account-preview-art"><Portrait account={selected} large/><span className="account-preview-badge">{FACTIONS[selected.faction].name}</span></div>
                <div className="account-preview-body"><span className={`account-presence${selected.online ? ' online' : ''}`}><i/>{activity(selected, data?.server_now ?? new Date().toISOString())}</span><h2>{selected.display_name}</h2><p className="account-capital"><Icon name="city" size={16}/>{selected.capital_name}</p><Stats account={selected}/><button type="button" className="account-primary" disabled={busy || loading} onClick={() => open(selected.display_name, 'login')}>{busy ? 'Opening your realm…' : `Log in as ${selected.display_name}`}<Icon name="arrow" size={17}/></button><p className="account-access-note">Name-based access. Choosing a ruler gives you control of that account.</p><small className="account-joined">Founded {new Date(selected.joined_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</small></div>
            </> : <div className="account-preview-placeholder"><Icon name="flag" size={38}/><h2>Your next chapter</h2><p>Select a ruler to see their realm, armies and strongest hero.</p><button type="button" className="account-outline" disabled={busy} onClick={() => chooseTab('create')}>Or create an account</button></div>}</aside>
            {selected && !rosterError && <div className="account-mobile-entry" role="region" aria-label="Quick account entry"><Portrait account={selected}/><div><strong>{selected.display_name}</strong><button type="button" aria-label="View ruler details" disabled={busy} onClick={() => preview.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })}>View realm <span>↓</span></button></div><button type="button" className="account-primary" aria-label={`Enter ${selected.display_name}'s realm`} disabled={busy || loading} onClick={() => open(selected.display_name, 'login')}>{busy ? 'Opening…' : 'Log in'}<Icon name="arrow" size={16}/></button></div>}
        </div> : <form className="account-layout account-create" onSubmit={event => { event.preventDefault(); open(newName, 'create'); }}>
            <section className="account-creation-fields"><div className="account-name-field"><label htmlFor="new-account-name">Name your ruler</label><input id="new-account-name" placeholder="Your name in this world" value={newName} onChange={event => setNewName(event.target.value)} minLength={2} maxLength={20} required autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={busy}/><small>2–20 letters, numbers, spaces, _ or -. Names ignore capitalization.</small></div>
                <fieldset className="account-races" disabled={busy}><legend>Choose your race <span>11 peoples. One shared world.</span></legend><div className="account-race-grid">{races.map(id => <label key={id} className={`account-race${race === id ? ' selected' : ''}`}><input type="radio" name="account-race" value={id} checked={race === id} onChange={() => setRace(id)} aria-label={FACTIONS[id].name}/><Portrait faction={id}/><span>{FACTIONS[id].name.replace('Human · ', '')}<small>{id === 'roman' || id === 'spartan' || id === 'persian' || id === 'egyptian' ? 'Human' : ' '}</small></span><b aria-hidden="true">{race === id ? '✓' : ''}</b></label>)}</div></fieldset>
            </section>
            <aside className="account-preview account-race-preview" aria-label="Selected race"><div className="account-preview-art"><Portrait faction={race} large/><span className="account-preview-badge">YOUR PEOPLE</span></div><div className="account-preview-body"><span className="account-kicker">{newName.trim() || 'YOUR NEW REALM'}</span><h2>{FACTIONS[race].name}</h2><p className="account-race-description">{FACTIONS[race].style}.</p><p className="account-race-note">Your race shapes the look of your city, troops and hero portraits.</p><div className="account-starting"><span><strong>1</strong> City</span><span><strong>1</strong> Army</span><span><strong>1</strong> Hero</span></div><button type="submit" className="account-primary" disabled={busy || newName.trim().length < 2}>{busy ? 'Founding your realm…' : 'Create account'}<Icon name="arrow" size={17}/></button><p className="account-access-note">Keep your ruler name. It is all you need to return on another device.</p></div></aside>
        </form>}
    </div>;
}
