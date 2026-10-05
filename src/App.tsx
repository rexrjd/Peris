import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Login } from './components/Login'
import { GameCanvas } from './game/GameCanvas'
import { armyPosition } from './game/scenes/WorldScene'
import { supabase } from './lib/supabase'
import type { Army, Player, Settlement } from './types/game'

const ARMY_SPEED = 55 // world pixels per second for the prototype

function liveResources(settlement: Settlement | null) {
  if (!settlement) return null

  const elapsedMinutes = Math.max(
    0,
    (Date.now() - new Date(settlement.resources_updated_at).getTime()) / 60000,
  )

  return {
    wood: Math.floor(settlement.wood + settlement.wood_rate * elapsedMinutes),
    stone: Math.floor(settlement.stone + settlement.stone_rate * elapsedMinutes),
    food: Math.floor(settlement.food + settlement.food_rate * elapsedMinutes),
    gold: Math.floor(settlement.gold + settlement.gold_rate * elapsedMinutes),
  }
}

function formatEta(army: Army | null) {
  if (!army || army.status !== 'moving') return 'Idle'
  const remaining = Math.max(0, new Date(army.arrival_at).getTime() - Date.now())
  if (remaining <= 0) return 'Arrived'

  const seconds = Math.ceil(remaining / 1000)
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${minutes}:${rest.toString().padStart(2, '0')}`
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [players, setPlayers] = useState<Player[]>([])
  const [settlements, setSettlements] = useState<Settlement[]>([])
  const [armies, setArmies] = useState<Army[]>([])
  const [gameError, setGameError] = useState<string | null>(null)
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

  const resources = liveResources(currentSettlement)

  const loadWorld = useCallback(async () => {
    const [playersResult, settlementsResult, armiesResult] = await Promise.all([
      supabase.from('players').select('*').order('updated_at'),
      supabase.from('settlements').select('*').order('id'),
      supabase.from('armies').select('*').order('id'),
    ])

    const firstError = playersResult.error ?? settlementsResult.error ?? armiesResult.error
    if (firstError) {
      setGameError(firstError.message)
      return
    }

    setPlayers((playersResult.data ?? []) as Player[])
    setSettlements((settlementsResult.data ?? []) as Settlement[])
    setArmies((armiesResult.data ?? []) as Army[])
    setGameError(null)
  }, [])

  useEffect(() => {
    if (!session) {
      setPlayers([])
      setSettlements([])
      setArmies([])
      return
    }

    void loadWorld()

    const channel = supabase
      .channel('peris-world')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, () => void loadWorld())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settlements' }, () => void loadWorld())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'armies' }, () => void loadWorld())
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [session, loadWorld])

  const moveArmy = useCallback(
    async (targetX: number, targetY: number) => {
      if (!session || !currentArmy) return

      const current = armyPosition(currentArmy)
      const distance = Math.hypot(targetX - current.x, targetY - current.y)
      const travelSeconds = Math.max(2, distance / ARMY_SPEED)
      const departure = new Date()
      const arrival = new Date(departure.getTime() + travelSeconds * 1000)

      const update = {
        start_x: Math.round(current.x),
        start_y: Math.round(current.y),
        target_x: targetX,
        target_y: targetY,
        departure_at: departure.toISOString(),
        arrival_at: arrival.toISOString(),
        status: 'moving' as const,
        updated_at: departure.toISOString(),
      }

      setArmies((all) =>
        all.map((army) => (army.id === currentArmy.id ? { ...army, ...update } : army)),
      )

      const { error } = await supabase
        .from('armies')
        .update(update)
        .eq('id', currentArmy.id)
        .eq('owner_id', session.user.id)

      if (error) setGameError(error.message)
    },
    [session, currentArmy],
  )

  if (authLoading) {
    return <main className="loading-page">Loading Peris…</main>
  }

  if (!session) return <Login />

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">PERIS</span>
          <h1>World Prototype</h1>
        </div>

        <div className="resource-strip">
          <span>Wood <strong>{resources?.wood ?? '—'}</strong> <small>+{currentSettlement?.wood_rate ?? 0}/m</small></span>
          <span>Stone <strong>{resources?.stone ?? '—'}</strong> <small>+{currentSettlement?.stone_rate ?? 0}/m</small></span>
          <span>Food <strong>{resources?.food ?? '—'}</strong> <small>+{currentSettlement?.food_rate ?? 0}/m</small></span>
          <span>Gold <strong>{resources?.gold ?? '—'}</strong> <small>+{currentSettlement?.gold_rate ?? 0}/m</small></span>
        </div>

        <div className="topbar-right">
          <div className="online-pill">{players.length} player{players.length === 1 ? '' : 's'} on map</div>
          <div className="profile-block">
            <div>
              <strong>{currentPlayer?.display_name ?? 'Player'}</strong>
              <small>Anonymous prototype account</small>
            </div>
          </div>
        </div>
      </header>

      {gameError && (
        <div className="setup-warning">
          <strong>Supabase world upgrade needed.</strong>
          <span>{gameError}</span>
          <span>Run <code>supabase/upgrade-world-v3.sql</code> once in Supabase SQL Editor.</span>
        </div>
      )}

      <section className="game-layout">
        <aside className="panel">
          <h2>Settlement</h2>
          <p className="settlement-title">{currentSettlement?.name ?? 'Creating settlement…'}</p>
          <dl>
            <div><dt>Wood</dt><dd>{resources?.wood ?? '—'}</dd></div>
            <div><dt>Stone</dt><dd>{resources?.stone ?? '—'}</dd></div>
            <div><dt>Food</dt><dd>{resources?.food ?? '—'}</dd></div>
            <div><dt>Gold</dt><dd>{resources?.gold ?? '—'}</dd></div>
          </dl>
          <button type="button" disabled>Buildings — next</button>
          <button type="button" disabled>Research — next</button>
        </aside>

        <div className="game-panel">
          <GameCanvas
            players={players}
            settlements={settlements}
            armies={armies}
            currentPlayerId={session.user.id}
            onMoveArmy={moveArmy}
          />
        </div>

        <aside className="panel">
          <h2>{currentArmy?.name ?? 'Army'}</h2>
          <p className="hint">Click anywhere on the world map to send your army there.</p>
          <dl>
            <div><dt>Infantry</dt><dd>{currentArmy?.infantry ?? '—'}</dd></div>
            <div><dt>Archers</dt><dd>{currentArmy?.archers ?? '—'}</dd></div>
            <div><dt>Cavalry</dt><dd>{currentArmy?.cavalry ?? '—'}</dd></div>
            <div><dt>Status</dt><dd>{currentArmy?.status ?? '—'}</dd></div>
            <div><dt>ETA</dt><dd>{formatEta(currentArmy)}</dd></div>
          </dl>
          <p className="hint">Settlements are fixed. Only armies move. Movement continues based on real timestamps even if the browser is closed.</p>
        </aside>
      </section>
    </main>
  )
}
