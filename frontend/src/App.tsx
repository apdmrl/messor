import type { ReactElement } from 'react'
import { RouterProvider } from 'react-router-dom'
import { AppProviders } from './app/AppProviders'
import { router } from './app/router'
import { SessionProvider } from './app/SessionProvider'
import { useTheme } from './app/theme'
import './App.css'

function App(): ReactElement {
  useTheme()
  return (
    <AppProviders>
      <SessionProvider>
        <RouterProvider router={router} />
      </SessionProvider>
    </AppProviders>
  )
}

export default App
