import { BattleCanvas } from '../game/BattleCanvas'
import type { Battle, BattleFormation, FormationType, Player } from '../types/game'

const UNIT_META: Record<FormationType, { label: string; icon: string; role: string }> = {
  infantry: { label: 'Infantry', icon: '⚔', role: 'Line holders · strong into archers' },
  archers: { label: 'Archers', icon: '➶', role: 'Long range · vulnerable to cavalry' },
  cavalry: { label: 'Cavalry', icon: '♞', role: 'Fast shock troops · devastating flanks' },
}

type Props = {
  battle: Battle
  formations: BattleFormation[]
  players: Player[]
  currentPlayerId: string
  selectedFormationId: number | null
  action: string | null
  onSelectFormation: (formationId: number) => void
  onMoveFormation: (formationId: number, x: number, y: number) => void
  onAttackFormation: (formationId: number, targetFormationId: number) => void
  onRetreat: () => void
}

function nameFor(players: Player[], id: string) {
  return players.find((player) => player.id === id)?.display_name ?? 'Unknown ruler'
}

function totalSoldiers(formations: BattleFormation[]) {
  return formations.reduce((sum, formation) => sum + formation.soldiers, 0)
}

function casualties(formations: BattleFormation[]) {
  return formations.reduce((sum, formation) => sum + Math.max(0, formation.initial_soldiers - formation.soldiers), 0)
}

function FormationCard({
  formation,
  selected,
  mine,
  onSelect,
}: {
  formation: BattleFormation
  selected: boolean
  mine: boolean
  onSelect?: () => void
}) {
  const meta = UNIT_META[formation.unit_type]
  const morale = Math.max(0, Math.min(100, Number(formation.morale)))
  return (
    <button
      type="button"
      className={`formation-card ${selected ? 'selected' : ''} ${formation.status === 'routed' ? 'routed' : ''} ${mine ? 'mine' : 'enemy'}`}
      onClick={onSelect}
      disabled={!mine || formation.status === 'routed' || formation.soldiers <= 0}
    >
      <div className="formation-card-top">
        <span className="formation-icon">{meta.icon}</span>
        <div>
          <strong>{meta.label}</strong>
          <small>{meta.role}</small>
        </div>
        <b>{formation.soldiers}</b>
      </div>
      <div className="formation-stats">
        <span>Kills <strong>{formation.kills}</strong></span>
        <span>Status <strong>{formation.charge_ready ? 'charging' : formation.status}</strong></span>
      </div>
      <div className="morale-track" title={`Morale ${Math.round(morale)}%`}>
        <i style={{ width: `${morale}%` }} />
      </div>
    </button>
  )
}

export function BattleView({
  battle,
  formations,
  players,
  currentPlayerId,
  selectedFormationId,
  action,
  onSelectFormation,
  onMoveFormation,
  onAttackFormation,
  onRetreat,
}: Props) {
  const mine = formations.filter((formation) => formation.owner_id === currentPlayerId)
  const enemy = formations.filter((formation) => formation.owner_id !== currentPlayerId)
  const opponentId = battle.attacker_owner_id === currentPlayerId ? battle.defender_owner_id : battle.attacker_owner_id
  const myName = nameFor(players, currentPlayerId)
  const enemyName = nameFor(players, opponentId)
  const isAttacker = battle.attacker_owner_id === currentPlayerId

  return (
    <main className="battle-shell">
      <header className="battle-topbar">
        <div className="battle-title-block">
          <span className="eyebrow">PERIS · FIELD BATTLE #{battle.id}</span>
          <h1>{myName} <i>vs</i> {enemyName}</h1>
          <small>{isAttacker ? 'You are attacking' : 'You are defending'} · server-authoritative tactical simulation</small>
        </div>

        <div className="battle-score">
          <div className="battle-score-side friendly">
            <small>YOUR FORCE</small>
            <strong>{totalSoldiers(mine)}</strong>
            <span>{casualties(mine)} casualties</span>
          </div>
          <div className="battle-score-center">⚔</div>
          <div className="battle-score-side hostile">
            <small>{enemyName.toUpperCase()}</small>
            <strong>{totalSoldiers(enemy)}</strong>
            <span>{casualties(enemy)} casualties</span>
          </div>
        </div>
      </header>

      <section className="battle-layout">
        <aside className="battle-roster battle-roster-left">
          <div className="battle-roster-heading">
            <span>YOUR FORMATIONS</span>
            <small>Select one, then issue orders on the field.</small>
          </div>
          <div className="formation-list">
            {mine.map((formation) => (
              <FormationCard
                key={formation.id}
                formation={formation}
                selected={formation.id === selectedFormationId}
                mine
                onSelect={() => onSelectFormation(formation.id)}
              />
            ))}
          </div>

          <div className="battle-controls-card">
            <strong>Controls</strong>
            <p><b>Left click</b> one of your formations.</p>
            <p><b>Right click ground</b> to move.</p>
            <p><b>Right click enemy</b> to attack it.</p>
            <p>Cavalry is fast. Archers fire at range. Long attack runs trigger charges, and flank/rear hits deal extra damage and morale shock.</p>
          </div>
        </aside>

        <section className="battlefield-column">
          <div className="battlefield-toolbar">
            <div>
              <strong>Tactical Battlefield</strong>
              <span>Orders and casualties are synchronized through Supabase.</span>
            </div>
            <div className="battle-live-pill"><i /> LIVE</div>
          </div>
          <div className="battlefield-panel">
            <BattleCanvas
              formations={formations}
              players={players}
              currentPlayerId={currentPlayerId}
              selectedFormationId={selectedFormationId}
              onSelectFormation={onSelectFormation}
              onMoveFormation={onMoveFormation}
              onAttackFormation={onAttackFormation}
            />
          </div>
        </section>

        <aside className="battle-roster battle-roster-right">
          <div className="battle-roster-heading enemy-heading">
            <span>ENEMY FORMATIONS</span>
            <small>Right-click these on the battlefield to focus an attack.</small>
          </div>
          <div className="formation-list">
            {enemy.map((formation) => (
              <FormationCard
                key={formation.id}
                formation={formation}
                selected={false}
                mine={false}
              />
            ))}
          </div>

          <div className="battle-doctrine">
            <strong>Prototype doctrine</strong>
            <span>Infantry → Archers</span>
            <span>Cavalry → Archers</span>
            <span>Infantry resists Cavalry</span>
            <span>Rear attacks crush morale</span>
            <span>Long cavalry approaches trigger charge shock</span>
            <span>Archers have 215px range</span>
          </div>

          <button className="retreat-button" onClick={onRetreat} disabled={action !== null}>
            {action === 'retreat' ? 'RETREATING…' : 'RETREAT FROM BATTLE'}
          </button>
          <p className="retreat-note">Retreat preserves surviving soldiers but concedes the battle.</p>
        </aside>
      </section>

      <footer className="prototype-footer battle-footer">
        <span>PERIS v0.5 · Tactical formations + morale + live PvP battle</span>
        <span>Battle simulation advances on the database, not in the browser.</span>
      </footer>
    </main>
  )
}
