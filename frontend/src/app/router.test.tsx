import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ProjectBoardPlaceholder } from '../features/projects/ProjectBoardPlaceholder'
import { MyWorkPlaceholder } from '../features/my-work/MyWorkPlaceholder'

describe('named future-package placeholder routes', () => {
  it('renders the board placeholder with the project key', () => {
    render(
      <MemoryRouter initialEntries={['/projects/MES/board']}>
        <Routes>
          <Route
            path="/projects/:projectKey/board"
            element={<ProjectBoardPlaceholder />}
          />
        </Routes>
      </MemoryRouter>,
    )

    expect(
      screen.getByRole('heading', { name: 'Board', level: 2 }),
    ).toBeInTheDocument()
    expect(
      screen.getByText("MES projesinin board'u sonraki pakette tamamlanacak."),
    ).toBeInTheDocument()
  })

  it('renders the My Work placeholder with a named future-package message', () => {
    render(
      <MemoryRouter initialEntries={['/my-work']}>
        <Routes>
          <Route path="/my-work" element={<MyWorkPlaceholder />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(
      screen.getByRole('heading', { name: 'Görevlerim', level: 2 }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Görevlerim ekranı sonraki pakette tamamlanacak.'),
    ).toBeInTheDocument()
  })
})
