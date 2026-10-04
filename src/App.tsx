import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Login } from './components/Login'
import { GameCanvas } from './game/GameCanvas'
import { supabase } from './lib/supabase'
import type { Player } from './types/game'

function startingPosition(seed: string) {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  return {
    x: 100 + (hash % 900),
    y: 100 + ((hash >>> 8) % 500),
  }
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [players, setPlayers] = useState<Player[]>([])
  const [gameError, setGameError] = useState<string | null>(null)

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

  const currentPlayer = useMemo(
    () => players.find((player) => player.id === session?.user.id) ?? null,
    [players, session?.user.id],
  )

  const loadPlayers = useCallback(async () => {
    const { data, error } = await supabase.from('players').select('*').order('updated_at')
    if (error) {
      setGameError(error.message)
      return
    }
    setPlayers((data ?? []) as Player[])
    setGameError(null)
  }, [])

  useEffect(() => {
    if (!session) {
      setPlayers([])
      return
    }

    let cancelled = false

    const initialize = async () => {
      const user = session.user
      const displayName =
        user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'Player'
      const avatarUrl = user.user_metadata?.avatar_url ?? null

      const { data: existing, error: selectError } = await supabase
        .from('players')
        .select('id')
        .eq('id', user.id)
        .maybeSingle()

      if (selectError) {
        if (!cancelled) setGameError(selectError.message)
        return
      }

      if (!existing) {
        const position = startingPosition(user.id)
        const { error: insertError } = await supabase.from('players').insert({
          id: user.id,
          email: user.email ?? null,
          display_name: displayName,
          avatar_url: avatarUrl,
          x: position.x,
          y: position.y,
        })

        if (insertError) {
          if (!cancelled) setGameError(insertError.message)
          return
        }
      } else {
        await supabase
          .from('players')
          .update({
            email: user.email ?? null,
            display_name: displayName,
            avatar_url: avatarUrl,
          })
          .eq('id', user.id)
      }

      if (!cancelled) await loadPlayers()
    }

    void initialize()

    const channel = supabase
      .channel('peris-players')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'players' },
        () => void loadPlayers(),
      )
      .subscribe()

    return () => {
      cancelled = true
      void supabase.removeChannel(channel)
    }
  }, [session, loadPlayers])

  const movePlayer = useCallback(
    async (x: number, y: number) => {
      if (!session) return

      setPlayers((current) =>
        current.map((player) =>
          player.id === session.user.id
            ? { ...player, x, y, updated_at: new Date().toISOString() }
            : player,
        ),
      )

      const { error } = await supabase
        .from('players')
        .update({ x, y, updated_at: new Date().toISOString() })
        .eq('id', session.user.id)

      if (error) setGameError(error.message)
    },
    [session],
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
          <h1>Shared World Prototype</h1>
        </div>

        <div className="topbar-right">
          <div className="online-pill">{players.length} player{players.length === 1 ? '' : 's'} on map</div>
          <div className="profile-block">
            {session.user.user_metadata?.avatar_url && (
              <img src={session.user.user_metadata.avatar_url} alt="" className="avatar" />
            )}
            <div>
              <strong>{currentPlayer?.display_name ?? session.user.email}</strong>
              <small>{session.user.email}</small>
            </div>
            <button className="signout-button" onClick={() => void supabase.auth.signOut()}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      {gameError && (
        <div className="setup-warning">
          <strong>Supabase database setup needed.</strong>
          <span>{gameError}</span>
          <span>Run the included <code>supabase/schema.sql</code> once in the Supabase SQL Editor.</span>
        </div>
      )}

      <section className="game-layout">
        <aside className="panel">
          <h2>Settlement</h2>
          <p>Greywatch</p>
          <button type="button">Buildings</button>
          <button type="button">Army</button>
          <button type="button">Research</button>
        </aside>

        <div className="game-panel">
          <GameCanvas
            players={players}
            currentPlayerId={session.user.id}
            onMove={movePlayer}
          />
        </div>

        <aside className="panel">
          <h2>Shared world</h2>
          <p className="hint">Blue is you. Red markers are other signed-in players.</p>
          <dl>
            <div><dt>Players</dt><dd>{players.length}</dd></div>
            <div><dt>Your X</dt><dd>{currentPlayer?.x ?? '—'}</dd></div>
            <div><dt>Your Y</dt><dd>{currentPlayer?.y ?? '—'}</dd></div>
          </dl>
          <p className="hint">Open Peris with a second Google account to test multiplayer.</p>
        </aside>
      </section>
    </main>
  )
}
