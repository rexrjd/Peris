import { useState } from 'react';
import { FACTIONS, type Faction } from '../../factions/domain/factions';
import { RESOURCES } from '../../../shared/model/resources';
import { Crest, Icon } from '../../../shared/ui/Icons';
import { useFrontier } from './useFrontier';
import { Recruitment } from './Recruitment';
import { Camps } from './Camps';
import { Marches, Reports } from './Reports';
import { number } from './format';
import '../styles/frontier.css';

export default function FrontierApp() {
    const game = useFrontier();
    const [name, setName] = useState('');
    const [faction, setFaction] = useState<Faction>('persian');
    const state = game.snapshot;
    return <main className="fw-shell">
        <a className="fw-skip" href="#fw-content">Skip to village</a>
        <header className="fw-header"><a href="/" className="fw-brand"><Crest small /><span>PERIS<small>FRONTIER WARS</small></span></a><nav aria-label="Game navigation"><a href="#fw-recruit-title">Village</a><a href="#fw-camps-title">Camps</a><a href="#fw-reports-title">Reports</a><a href="/" className="fw-back">Back to Peris <Icon name="exit" size={16} /></a></nav></header>
        <div className={`fw-hero ${state ? '' : 'fw-hero-welcome'}`}><div className="fw-hero-inner"><span className="fw-eyebrow">A SHARED FRONTIER. A FORTUNE TO EARN.</span><h1>{state ? state.village.name : 'The frontier is calling.'}</h1><p>{state ? <>{FACTIONS[state.village.faction].name} · Village ({state.village.col}, {state.village.row})<span className="fw-hero-separator">/</span>Build your army. Choose your moment.</> : 'Raise a village, muster an army, and compete for the riches of mercenary camps.'}</p></div></div>
        <div className="fw-content" id="fw-content">
            {game.connectionError && <div className="fw-notice fw-notice-error" role="alert"><Icon name="world" /><div><strong>Frontier server unavailable</strong><p>{game.connectionError} Start the local game with <code>npm run dev:frontier</code>. This page will reconnect automatically.</p>{state && <small>Showing the last received state. Orders are unavailable until the connection returns.</small>}</div></div>}
            {game.actionError && <div className="fw-notice fw-notice-error" role="alert"><Icon name="flag" /><div><strong>{game.pending ? 'Order status unconfirmed' : 'Order could not be completed'}</strong><p>{game.actionError}</p>{game.pending && <><p>The response was interrupted. Retry this same order safely to confirm its result.</p><button className="fw-button fw-button-secondary" disabled={game.busy} onClick={game.retry}>{game.busy ? 'Confirming…' : 'Retry same order'}</button></>}</div></div>}
            <div className="fw-status" role="status" aria-live="polite">{game.notice}</div>
            {!state && game.authenticated === null && !game.connectionError && <div className="fw-loading"><Crest /><p>Opening the frontier…</p></div>}
            {!state && game.authenticated === true && !game.connectionError && <div className="fw-loading"><p>Loading your village…</p></div>}
            {!state && game.authenticated === false && <section className="fw-welcome fw-panel" aria-labelledby="fw-found-title">
                <div><span className="fw-eyebrow">YOUR FIRST FOOTHOLD</span><h2 id="fw-found-title">Found your frontier village</h2><p>Your village produces wood, stone, food, and gold. Recruit a small army, find a promising camp, and bring its supplies home.</p><ol className="fw-welcome-steps"><li><Icon name="town" /><span><strong>Build your garrison</strong><small>Spend village resources to recruit real troops.</small></span></li><li><Icon name="flag" /><span><strong>Choose a camp</strong><small>Balance defender strength, stock, and travel time.</small></span></li><li><Icon name="transfer" /><span><strong>Bring the survivors home</strong><small>Loot arrives with your returning troops.</small></span></li></ol></div>
                <form onSubmit={event => { event.preventDefault(); if (name.trim().length >= 2 && !game.busy) void game.join(name.trim(), faction); }}>
                    <label className="fw-label">Village name<input value={name} onChange={event => setName(event.target.value)} placeholder="Your frontier village" minLength={2} maxLength={24} required autoComplete="off" disabled={game.busy} /></label>
                    <label className="fw-label">Faction<select value={faction} onChange={event => setFaction(event.target.value as Faction)} disabled={game.busy}>{Object.entries(FACTIONS).map(([id, profile]) => <option key={id} value={id}>{profile.name}</option>)}</select></label>
                    <p className="fw-faction-description">{FACTIONS[faction].style}</p>
                    <button className="fw-button fw-button-primary" disabled={game.busy || name.trim().length < 2 || !!game.connectionError}>{game.busy ? 'Founding your village…' : 'Raise your standard'}<Icon name="arrow" size={18} /></button>
                    <p className="fw-small-note">This browser returns to your village. The shared world keeps running while the server is on, even when you close the game.</p>
                </form>
            </section>}
            {state && <>
                <section className="fw-resources" aria-label="Village resources">{RESOURCES.map(key => <div className={`fw-resource fw-resource-${key}`} key={key}><span className="fw-resource-icon"><Icon name={key} size={26} /></span><div><span className="fw-resource-label">{key}</span><strong>{number(state.village.resources[key])}<small> / {number(state.config.villageCapacity[key])}</small></strong><span className="fw-income">+{state.config.villageRates[key]} per minute</span></div><div className="fw-resource-meter"><i style={{ width: `${Math.min(100, state.village.resources[key] / state.config.villageCapacity[key] * 100)}%` }} /></div></div>)}</section>
                <Recruitment state={state} now={game.now} locked={game.locked || !!game.connectionError} run={game.run} />
                <Camps state={state} now={game.now} locked={game.locked || !!game.connectionError} run={game.run} />
                <div className="fw-ledger-layout"><Marches raids={state.raids} now={game.now} /><Reports reports={state.reports} total={state.reportCount} /></div>
                <footer className="fw-footer"><span>PERIS · FRONTIER WARS</span><p>{state.config.fixture === 'development' ? 'A small frontier to explore.' : 'The full frontier.'} Camp stocks are shared. Your village and raids persist on the server.</p><a href="/">Return to the Peris launcher</a></footer>
            </>}
        </div>
    </main>;
}
