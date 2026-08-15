import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

describe('test environment smoke test', () => {
  it('renders an accessible button and finds it by role and name', () => {
    render(<button type="button">Messor test environment</button>)

    const button = screen.getByRole('button', {
      name: 'Messor test environment',
    })

    expect(button).toBeInTheDocument()
  })
})
