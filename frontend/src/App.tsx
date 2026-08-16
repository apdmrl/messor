import type { ReactElement } from 'react'
import { RouterProvider } from 'react-router-dom'
import { AppProviders } from './app/AppProviders'
import { router } from './app/router'
import { SessionProvider } from './app/SessionProvider'
import './App.css'

function App(): ReactElement {
  return (
    <AppProviders>
      <SessionProvider>
        <RouterProvider router={router} />
      </SessionProvider>
    </AppProviders>
  )
}

export default App
