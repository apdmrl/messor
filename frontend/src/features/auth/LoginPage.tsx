import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { AuthApiError, login } from './authApi'
import type { UserSummary } from './types'
import './LoginPage.css'

export interface LoginPageProps {
  onAuthenticated: (user: UserSummary) => void
}

const NETWORK_FALLBACK = 'Bağlantı kurulamadı. Lütfen tekrar deneyin.'

const DEMO_EMAILS = ['admin@demo.messor.app', 'member@demo.messor.app']

export function LoginPage({ onAuthenticated }: LoginPageProps): ReactElement {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (pending) {
      return
    }

    setError(null)
    setPending(true)

    try {
      const user = await login(email, password)
      onAuthenticated(user)
    } catch (err) {
      setPassword('')
      if (err instanceof AuthApiError) {
        setError(err.message)
      } else {
        setError(NETWORK_FALLBACK)
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="login-layout">
      <section className="login-brand" aria-label="Messor markası">
        <div className="login-brand__inner">
          <div className="login-brand__mark" aria-hidden="true">
            <span className="login-brand__segment" />
            <span className="login-brand__segment" />
            <span className="login-brand__segment" />
          </div>
          <h1 className="login-brand__name">Messor</h1>
          <p className="login-brand__tagline">
            Görevlerini düzenle, ekibinle birlikte ilerle.
          </p>
        </div>
        <div
          className="login-ant-trail"
          data-testid="ant-trail"
          aria-hidden="true"
        >
          <span className="login-ant-trail__dot" />
          <span className="login-ant-trail__dot" />
          <span className="login-ant-trail__dot" />
          <span className="login-ant-trail__dot" />
          <span className="login-ant-trail__dot" />
        </div>
      </section>

      <section className="login-panel" aria-label="Oturum açma formu">
        <div className="login-card">
          <h2 className="login-card__heading">Oturum aç</h2>
          <p className="login-card__support">
            Çalışma alanına devam etmek için bilgilerini gir.
          </p>

          <form
            className="login-form"
            onSubmit={handleSubmit}
            aria-busy={pending}
            aria-label="Oturum açma formu alanı"
          >
            <div className="login-field">
              <label className="login-field__label" htmlFor="login-email">
                E-posta
              </label>
              <input
                id="login-email"
                className="login-field__input"
                type="email"
                name="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={pending}
                required
              />
            </div>

            <div className="login-field">
              <label className="login-field__label" htmlFor="login-password">
                Parola
              </label>
              <input
                id="login-password"
                className="login-field__input"
                type="password"
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={pending}
                required
              />
            </div>

            {error !== null && (
              <p className="login-form__error" role="alert">
                {error}
              </p>
            )}

            <button
              className="login-form__submit"
              type="submit"
              disabled={pending}
            >
              {pending ? 'Giriş yapılıyor…' : 'Oturum aç'}
            </button>
          </form>

          <div className="login-demo">
            <h3 className="login-demo__heading">Demo hesaplar</h3>
            <ul className="login-demo__list">
              {DEMO_EMAILS.map((demoEmail) => (
                <li key={demoEmail} className="login-demo__item">
                  {demoEmail}
                </li>
              ))}
            </ul>
            <p className="login-demo__note">
              Demo parolası çalışma ortamını kuran kişi tarafından sağlanır.
            </p>
          </div>
        </div>
      </section>
    </main>
  )
}
