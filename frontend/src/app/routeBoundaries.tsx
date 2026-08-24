import type { ReactElement } from 'react'
import { Link } from 'react-router-dom'

/**
 * Shared, neutral route-state boundaries for the product flow.
 *
 * These boundaries deliberately fail closed and never expose authorization
 * details: no project keys, member ids, roles, backend policy names, or
 * internal error text. They present the same neutral content whether a
 * resource is missing, forbidden, or simply unavailable, and each offers one
 * safe recovery action.
 */

const RECOVERY_TO = '/projects'
const RECOVERY_LABEL = 'Projelere dön'

interface RouteStateProps {
  heading: string
  message: string
  status?: 'status' | 'alert'
  recovery?: boolean
}

function RouteState({
  heading,
  message,
  status,
  recovery = true,
}: RouteStateProps): ReactElement {
  return (
    <div className="route-state" role={status}>
      <h2 className="route-state__heading">{heading}</h2>
      <p className="route-state__message">{message}</p>
      {recovery && (
        <Link className="route-state__recovery" to={RECOVERY_TO}>
          {RECOVERY_LABEL}
        </Link>
      )}
    </div>
  )
}

/**
 * Neutral not-found boundary for invalid/unknown routes. Used only when
 * routing itself fails before authorization is relevant.
 */
export function NotFoundPage(): ReactElement {
  return (
    <RouteState
      heading="Sayfa bulunamadı"
      message="Aradığın sayfa bulunamadı ya da taşınmış olabilir."
    />
  )
}

/**
 * Neutral restricted boundary for direct visits to resources that are
 * unavailable, missing, or not authorized. Intentionally indistinguishable
 * from an inaccessible/deleted resource; never reveals existence or policy.
 */
export function RestrictedPage(): ReactElement {
  return (
    <RouteState
      heading="Erişim kısıtlı"
      message="Bu içeriğe erişimin yok ya da kullanılamıyor."
    />
  )
}

/**
 * Neutral route-level error boundary. Rendered only when a route cannot render
 * its data; never shows stack traces, session, or database details.
 */
export function RouteErrorFallback(): ReactElement {
  return (
    <RouteState
      heading="Bir şeyler ters gitti"
      message="Sayfa yüklenemedi. Lütfen tekrar deneyin."
      status="alert"
    />
  )
}

/**
 * Neutral loading boundary shown while the session or a protected route is
 * being resolved. Structural, not decorative.
 */
export function RouteLoading(): ReactElement {
  return (
    <RouteState
      heading="Yükleniyor…"
      message="Sayfa hazırlanıyor."
      status="status"
      recovery={false}
    />
  )
}
/**
 * Neutral session-expired boundary. Shown after a confirmed session expiry so
 * the user is not silently bounced; offers a safe sign-in recovery. It never
 * reveals session internals.
 */
export function SessionExpiredPage(): ReactElement {
  return (
    <div className="route-state">
      <h2 className="route-state__heading">Oturum sona erdi</h2>
      <p className="route-state__message">
        Oturumun sona erdi. Devam etmek için tekrar giriş yap.
      </p>
      <Link className="route-state__recovery" to="/login">
        Tekrar giriş yap
      </Link>
    </div>
  )
}
