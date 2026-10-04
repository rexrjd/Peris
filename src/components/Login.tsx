import { FormEvent, useState } from 'react'
import { supabase } from '../lib/supabase'

function startingPosition(seed: string) {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  }

  return {
    x: 100 + (hash % 900),
    y: 100 + ((hash >>> 8) % 500),
  }
}

export function Login() {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const enterWorld = async (event: FormEvent) => {
    event.preventDefault()

    const cleanName = name.trim()
    if (cleanName.length < 2) {
      setError('Choose a name with at least 2 characters.')
      return
    }
    if (cleanName.length > 24) {
      setError('Keep your name to 24 characters or fewer.')
      return
    }

    setLoading(true)
    setError(null)

    const { data, error: authError } = await supabase.auth.signInAnonymously()

    if (authError || !data.user) {
      setError(authError?.message ?? 'Could not create your player.')
      setLoading(false)
      return
    }

    const position = startingPosition(data.user.id)
    const { error: playerError } = await supabase.from('players').insert({
      id: data.user.id,
      display_name: cleanName,
      x: position.x,
      y: position.y,
    })

    if (playerError) {
      await supabase.auth.signOut()
      setError(
        playerError.code === '23505'
          ? 'That player name is already taken.'
          : playerError.message,
      )
      setLoading(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <span className="eyebrow">PERIS</span>
        <h1>Enter the world</h1>
        <p className="login-copy">
          Choose a player name. No email and no password are required for this prototype.
        </p>

        <form onSubmit={enterWorld} className="name-form">
          <label htmlFor="player-name">Player name</label>
          <input
            id="player-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Rex"
            autoComplete="off"
            maxLength={24}
            disabled={loading}
          />
          <button className="google-button" type="submit" disabled={loading}>
            {loading ? 'Creating player…' : 'Enter World'}
          </button>
        </form>

        <p className="login-note">
          Your prototype account stays on this browser. Clearing browser data will lose access to it.
        </p>
        {error && <p className="error-message">{error}</p>}
      </section>
    </main>
  )
}
