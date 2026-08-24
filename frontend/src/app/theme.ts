import { useEffect, useState } from 'react'

export type ThemeMode = 'dark' | 'light' | 'system'

export type AppTheme = 'dark' | 'light'


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
 * The supplied product UI is authored in the light palette. Keep the runtime
 * default deterministic so an operating-system dark preference cannot make the
 * Figma light surfaces appear as a different product theme.
 */
export function initialAppTheme(_prefersDark: boolean): AppTheme {
  return 'light'
}

/**
 * Applies the fixed light product theme to the document root. Theme selection
 * never reads or writes session, auth, or CSRF storage.
 */
export function useTheme(): AppTheme {
  const [theme] = useState<AppTheme>(() => initialAppTheme(false))

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  return theme
}
