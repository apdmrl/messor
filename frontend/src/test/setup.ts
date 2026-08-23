import { afterEach } from 'vitest'
import { cleanup, configure } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// Async UI assertions (findBy*, waitFor) default to a 1000ms budget. Under
// full-suite parallel load the event loop is congested enough that legitimate
// async flows (bootstrap -> authenticated -> queries) can exceed 1s even though
// they pass instantly in isolation. Raise the bounded wait budget to 5s so the
// suite is deterministic under load without changing what is asserted.
configure({ asyncUtilTimeout: 5000 })

afterEach(() => {
  cleanup()
})
