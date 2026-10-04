import { useState } from 'react'
import { supabase } from '../lib/supabase'

export function Login() {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const signInWithGoogle = async () => {
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
      },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <span className="eyebrow">PERIS</span>
        <h1>Enter the world</h1>
        <p className="login-copy">
          Sign in to join the same persistent map as the other players.
        </p>
        <button className="google-button" onClick={signInWithGoogle} disabled={loading}>
          {loading ? 'Opening Google…' : 'Continue with Google'}
        </button>
        {error && <p className="error-message">{error}</p>}
      </section>
    </main>
  )
}
