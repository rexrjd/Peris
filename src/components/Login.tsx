import { FormEvent, useState } from 'react'
import { supabase } from '../lib/supabase'

type Props = {
  hasSession: boolean
  onCreated: () => void
}

export function Login({ hasSession, onCreated }: Props) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const enterWorld = async (event: FormEvent) => {
    event.preventDefault()
    const cleanName = name.trim()

    if (!/^[A-Za-z0-9 _-]{2,20}$/.test(cleanName)) {
      setError('Use 2–20 letters, numbers, spaces, _ or -.')
      return
    }

    setLoading(true)
    setError(null)

    let userId: string | undefined

    if (hasSession) {
      const { data } = await supabase.auth.getUser()
      userId = data.user?.id
    } else {
      const { data, error: authError } = await supabase.auth.signInAnonymously()
      if (authError || !data.user) {
        setError(authError?.message ?? 'Could not create your prototype account.')
        setLoading(false)
        return
      }
      userId = data.user.id
    }

    if (!userId) {
      setError('No authenticated player session was found.')
      setLoading(false)
      return
    }

    const { error: createError } = await supabase.rpc('create_player', {
      p_display_name: cleanName,
    })

    if (createError) {
      const message = createError.message.toLowerCase()
      setError(
        message.includes('taken') || message.includes('unique')
          ? 'That ruler name is already taken.'
          : createError.message,
      )
      setLoading(false)
      return
    }

    onCreated()
    setLoading(false)
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="crest">P</div>
        <span className="eyebrow">PERIS · REALM ALPHA</span>
        <h1>Found your realm</h1>
        <p className="login-copy">
          Pick a ruler name. The prototype creates a settlement and starter army for you automatically.
        </p>

        <form onSubmit={enterWorld} className="name-form">
          <label htmlFor="player-name">Ruler name</label>
          <input
            id="player-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Rex"
            autoComplete="off"
            maxLength={20}
            disabled={loading}
            autoFocus
          />
          <button className="primary-button" type="submit" disabled={loading}>
            {loading ? 'Founding realm…' : 'Enter Realm'}
          </button>
        </form>

        <p className="login-note">
          No email or password. This anonymous prototype account is tied to this browser.
        </p>
        {error && <p className="error-message">{error}</p>}
      </section>
    </main>
  )
}
