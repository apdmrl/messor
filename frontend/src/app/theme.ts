import { useEffect, useState } from 'react'

export type ThemeMode = 'dark' | 'light' | 'system'

export type AppTheme = 'dark' | 'light'

const COLOR_SCHEME_QUERY = '(prefers-color-scheme: dark)'

/**
 * Resolves a requested theme mode to an applied theme. `'system'` follows the
 * operating-system preference reported by the caller (typically
 * `prefers-color-scheme`). Theme selection never reads or writes session,
 * auth, or CSRF storage.
 */
export function resolveTheme(mode: ThemeMode, prefersDark: boolean): AppTheme {
  if (mode === 'dark') {
    return 'dark'
  }
  if (mode === 'light') {
    return 'light'
  }
  return prefersDark ? 'dark' : 'light'
}

/**
 * Whether the OS prefers a dark color scheme. Guarded because jsdom and
 * older browsers do not implement `matchMedia`; those environments default
 * to the light theme.
 */
function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(COLOR_SCHEME_QUERY).matches
  )
}

/**
 * Applies the current theme to the document root as `data-theme` and keeps it
 * in sync with OS color-scheme changes. The theme is resolved from the system
 * preference (no persistence) so it never touches session, auth, or CSRF
 * storage.
 */
export function useTheme(): AppTheme {
  const [theme, setTheme] = useState<AppTheme>(() =>
    resolveTheme('system', systemPrefersDark()),
  )

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }
    const media = window.matchMedia(COLOR_SCHEME_QUERY)
    const onChange = (event: MediaQueryListEvent): void => {
      setTheme(resolveTheme('system', event.matches))
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  return theme
}
