import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Login } from './components/Login'
import { GameCanvas } from './game/GameCanvas'
import { armyPosition } from './game/scenes/WorldScene'
import { supabase } from './lib/supabase'
import type { Army, Building, BuildingType, Player, Settlement } from './types/game'

type ResourceBag = { wood: number; stone: number; food: number; gold: number }

const BUILDING_META: Record<BuildingType, { name: string; icon: string; description: string }> = {
  lumber: { name: 'Lumber Camp', icon: '♣', description: 'Raises wood production.' },
  quarry: { name: 'Quarry', icon: '◆', description: 'Raises stone production.' },
  farm: { name: 'Farmstead', icon: '✦', description: 'Raises food production.' },
  market: { name: 'Market', icon: '¤', description: 'Raises gold production.' },
}

function liveResources(settlement: Settlement | null): ResourceBag | null {
  if (!settlement) return null
  const elapsedMinutes = Math.max(0, (Date.now() - new Date(settlement.resources_updated_at).getTime()) / 60000)
  return {
    wood: Math.floor(settlement.wood + settlement.wood_rate * elapsedMinutes),
    stone: Math.floor(settlement.stone + settlement.stone_rate * elapsedMinutes),
    food: Math.floor(settlement.food + settlement.food_rate * elapsedMinutes),
    gold: Math.floor(settlement.gold + settlement.gold_rate * elapsedMinutes),
  }
}

function buildingCost(type: BuildingType, level: number): ResourceBag {
  const factor = Math.pow(1.65, Math.max(0, level - 1))
  const base: Record<BuildingType, ResourceBag> = {
    lumber: { wood: 150, stone: 90, food: 70, gold: 10 },
    quarry: { wood: 110, stone: 150, food: 70, gold: 10 },
    farm: { wood: 100, stone: 80, food: 150, gold: 8 },
    market: { wood: 140, stone: 130, food: 80, gold: 25 },
  }
  return {
    wood: Math.ceil(base[type].wood * factor),
    stone: Math.ceil(base[type].stone * factor),
    food: Math.ceil(base[type].food * factor),
    gold: Math.ceil(base[type].gold * factor),
  }
}

function canAfford(resources: ResourceBag | null, cost: ResourceBag) {
  if (!resources) return false
  return resources.wood >= cost.wood && resources.stone >= cost.stone && resources.food >= cost.food && resources.gold >= cost.gold
}

function formatEta(army: Army | null) {
  if (!army) return '—'
  const position = armyPosition(army)
  if (!position.moving) return 'Ready'
  const remaining = Math.max(0, new Date(army.arrival_at).getTime() - Date.now())
  const seconds = Math.ceil(remaining / 1000)
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${minutes}:${rest.toString().padStart(2, '0')}`
}

function compactCost(cost: ResourceBag) {
  return `W ${cost.wood} · S ${cost.stone} · F ${cost.food} · G ${cost.gold}`
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [worldLoading, setWorldLoading] = useState(true)
  const [players, setPlayers] = useState<Player[]>([])
  const [settlements, setSettlements] = useState<Settlement[]>([])
  const [buildings, setBuildings] = useState<Building[]>([])
  const [armies, setArmies] = useState<Army[]>([])
  const [gameError, setGameError] = useState<string | null>(null)
  const [action, setAction] = useState<string | null>(null)
  const [moveMode, setMoveMode] = useState(false)
  const [, setClock] = useState(0)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setAuthLoading(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setAuthLoading(false)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setClock((value) => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const currentPlayer = useMemo(
    () => players.find((player) => player.id === session?.user.id) ?? null,
    [players, session?.user.id],
  )
  const currentSettlement = useMemo(
    () => settlements.find((settlement) => settlement.owner_id === session?.user.id) ?? null,
    [settlements, session?.user.id],
  )
  const currentArmy = useMemo(
    () => armies.find((army) => army.owner_id === session?.user.id) ?? null,
    [armies, session?.user.id],
  )
  const currentBuildings = useMemo(
    () => buildings.filter((building) => building.settlement_id === currentSettlement?.id),
    [buildings, currentSettlement?.id],
  )
  const resources = liveResources(currentSettlement)

  const buildingByType = useCallback(
    (type: BuildingType) => currentBuildings.find((building) => building.building_type === type) ?? null,
    [currentBuildings],
  )

  const loadWorld = useCallback(async (sync = false) => {
    if (!session) {
      setWorldLoading(false)
      return
    }

    setWorldLoading(true)
    if (sync) {
      const syncResult = await supabase.rpc('sync_my_state')
      if (syncResult.error && !syncResult.error.message.toLowerCase().includes('function')) {
        setGameError(syncResult.error.message)
      }
    }

    const [playersResult, settlementsResult, buildingsResult, armiesResult] = await Promise.all([
      supabase.from('players').select('*').order('created_at'),
      supabase.from('settlements').select('*').order('id'),
      supabase.from('buildings').select('*').order('id'),
      supabase.from('armies').select('*').order('id'),
    ])

    const firstError = playersResult.error ?? settlementsResult.error ?? buildingsResult.error ?? armiesResult.error
    if (firstError) {
      setGameError(firstError.message)
      setWorldLoading(false)
      return
    }

    setPlayers((playersResult.data ?? []) as Player[])
    setSettlements((settlementsResult.data ?? []) as Settlement[])
    setBuildings((buildingsResult.data ?? []) as Building[])
    setArmies((armiesResult.data ?? []) as Army[])
    setGameError(null)
    setWorldLoading(false)
  }, [session])

  useEffect(() => {
    if (!session) {
      setPlayers([])
      setSettlements([])
      setBuildings([])
      setArmies([])
      setWorldLoading(false)
      return
    }

    void loadWorld(true)

    const channel = supabase
      .channel('peris-realm-alpha')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, () => void loadWorld(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settlements' }, () => void loadWorld(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'buildings' }, () => void loadWorld(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'armies' }, () => void loadWorld(false))
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [session, loadWorld])

  const runAction = useCallback(async (label: string, task: () => Promise<{ error: { message: string } | null }>) => {
    setAction(label)
    setGameError(null)
    const result = await task()
    if (result.error) setGameError(result.error.message)
    await loadWorld(false)
    setAction(null)
  }, [loadWorld])

  const upgradeBuilding = useCallback((type: BuildingType) => {
    void runAction(`upgrade-${type}`, async () => {
      const { error } = await supabase.rpc('upgrade_building', { p_building_type: type })
      return { error }
    })
  }, [runAction])

  const recruit = useCallback((type: 'infantry' | 'archers' | 'cavalry') => {
    const batch = type === 'infantry' ? 10 : type === 'archers' ? 5 : 2
    void runAction(`recruit-${type}`, async () => {
      const { error } = await supabase.rpc('recruit_units', {
        p_infantry: type === 'infantry' ? batch : 0,
        p_archers: type === 'archers' ? batch : 0,
        p_cavalry: type === 'cavalry' ? batch : 0,
      })
      return { error }
    })
  }, [runAction])

  const moveArmy = useCallback(async (targetX: number, targetY: number) => {
    if (!currentArmy || !moveMode) return
    setMoveMode(false)
    setAction('move-army')
    setGameError(null)
    const { error } = await supabase.rpc('move_army', {
      p_target_x: targetX,
      p_target_y: targetY,
    })
    if (error) setGameError(error.message)
    await loadWorld(false)
    setAction(null)
  }, [currentArmy, moveMode, loadWorld])

  if (authLoading) return <main className="loading-page">Loading Peris…</main>
  if (!session) return <Login hasSession={false} onCreated={() => void loadWorld(false)} />
  if (worldLoading && players.length === 0 && !gameError) return <main className="loading-page">Entering Realm Alpha…</main>

  // This also handles a database reset while an anonymous browser session still exists.
  if (!currentPlayer && !gameError) {
    return <Login hasSession onCreated={() => void loadWorld(false)} />
  }

  const armyPositionNow = currentArmy ? armyPosition(currentArmy) : null
  const armyMoving = armyPositionNow?.moving ?? false

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <span className="eyebrow">PERIS</span>
          <h1>Realm Alpha</h1>
          <small>Persistent strategy prototype</small>
        </div>

        <div className="resource-strip">
          <span><i>W</i> Wood <strong>{resources?.wood ?? '—'}</strong><small>+{currentSettlement?.wood_rate ?? 0}/m</small></span>
          <span><i>S</i> Stone <strong>{resources?.stone ?? '—'}</strong><small>+{currentSettlement?.stone_rate ?? 0}/m</small></span>
          <span><i>F</i> Food <strong>{resources?.food ?? '—'}</strong><small>+{currentSettlement?.food_rate ?? 0}/m</small></span>
          <span><i>G</i> Gold <strong>{resources?.gold ?? '—'}</strong><small>+{currentSettlement?.gold_rate ?? 0}/m</small></span>
        </div>

        <div className="topbar-right">
          <div className="online-pill"><b>{players.length}</b> ruler{players.length === 1 ? '' : 's'} in realm</div>
          <div className="profile-block">
            <strong>{currentPlayer?.display_name ?? 'Ruler'}</strong>
            <small>{currentSettlement?.name ?? 'Founding realm…'}</small>
          </div>
        </div>
      </header>

      {gameError && (
        <div className="setup-warning">
          <strong>{gameError.includes('does not exist') || gameError.includes('column') ? 'Database reset required.' : 'Command failed.'}</strong>
          <span>{gameError}</span>
          {(gameError.includes('does not exist') || gameError.includes('column')) && (
            <span>Run <code>supabase/RESET_AND_CREATE_V4.sql</code> once in Supabase SQL Editor.</span>
          )}
        </div>
      )}

      <section className="game-layout">
        <aside className="panel settlement-panel">
          <div className="panel-heading">
            <span className="panel-kicker">YOUR SETTLEMENT</span>
            <h2>{currentSettlement?.name ?? '—'}</h2>
          </div>

          <div className="settlement-summary">
            <div><span>Population</span><strong>{currentArmy ? currentArmy.infantry + currentArmy.archers + currentArmy.cavalry : 0}</strong></div>
            <div><span>Position</span><strong>{currentSettlement ? `${currentSettlement.x}, ${currentSettlement.y}` : '—'}</strong></div>
          </div>

          <h3>Production</h3>
          <div className="building-list">
            {(Object.keys(BUILDING_META) as BuildingType[]).map((type) => {
              const building = buildingByType(type)
              const level = building?.level ?? 1
              const cost = buildingCost(type, level)
              const affordable = canAfford(resources, cost)
              return (
                <article className="building-card" key={type}>
                  <div className="building-icon">{BUILDING_META[type].icon}</div>
                  <div className="building-info">
                    <div className="building-title"><strong>{BUILDING_META[type].name}</strong><span>Lv {level}</span></div>
                    <p>{BUILDING_META[type].description}</p>
                    <small>{compactCost(cost)}</small>
                  </div>
                  <button
                    className="small-action"
                    disabled={!affordable || action !== null}
                    onClick={() => upgradeBuilding(type)}
                    title={!affordable ? 'Not enough resources' : `Upgrade ${BUILDING_META[type].name}`}
                  >
                    {action === `upgrade-${type}` ? '…' : '↑'}
                  </button>
                </article>
              )
            })}
          </div>
        </aside>

        <section className="world-column">
          <div className="world-toolbar">
            <div>
              <strong>World Map</strong>
              <span>Real-time shared realm · movement persists while offline</span>
            </div>
            <div className="map-legend">
              <span><b className="legend-dot gold" />Your keep</span>
              <span><b className="legend-dot blue" />Your army</span>
              <span><b className="legend-dot red" />Other rulers</span>
            </div>
          </div>
          <div className={`game-panel ${moveMode ? 'commanding' : ''}`}>
            <GameCanvas
              players={players}
              settlements={settlements}
              armies={armies}
              currentPlayerId={session.user.id}
              moveMode={moveMode}
              onMoveArmy={moveArmy}
            />
          </div>
        </section>

        <aside className="panel army-panel">
          <div className="panel-heading">
            <span className="panel-kicker">FIELD ARMY</span>
            <h2>{currentArmy?.name ?? '—'}</h2>
          </div>

          <div className={`army-status ${armyMoving ? 'moving' : 'ready'}`}>
            <span>{armyMoving ? 'MARCHING' : 'READY'}</span>
            <strong>{formatEta(currentArmy)}</strong>
          </div>

          <div className="unit-list">
            <div className="unit-row"><span><i>⚔</i> Infantry</span><strong>{currentArmy?.infantry ?? 0}</strong><button disabled={action !== null} onClick={() => recruit('infantry')}>+10</button></div>
            <div className="unit-row"><span><i>➶</i> Archers</span><strong>{currentArmy?.archers ?? 0}</strong><button disabled={action !== null} onClick={() => recruit('archers')}>+5</button></div>
            <div className="unit-row"><span><i>♞</i> Cavalry</span><strong>{currentArmy?.cavalry ?? 0}</strong><button disabled={action !== null} onClick={() => recruit('cavalry')}>+2</button></div>
          </div>

          <div className="recruit-note">
            Recruitment is instant in this prototype and spends settlement resources on the server.
          </div>

          <button
            className={`move-button ${moveMode ? 'active' : ''}`}
            disabled={!currentArmy || action !== null}
            onClick={() => setMoveMode((value) => !value)}
          >
            {moveMode ? 'CANCEL ORDER' : armyMoving ? 'REDIRECT ARMY' : 'MOVE ARMY'}
          </button>
          <p className="command-help">
            {moveMode ? 'Click a destination on the map. Travel time is calculated by the database.' : 'Movement cannot be teleported or edited directly by the browser.'}
          </p>
        </aside>
      </section>

      <footer className="prototype-footer">
        <span>PERIS v0.4 · Economy + recruitment + persistent army movement</span>
        <span>Next milestone: raids, battle reports and territory.</span>
      </footer>
    </main>
  )
}
