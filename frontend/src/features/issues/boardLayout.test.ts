import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const stylesheetPath = join(dirname(fileURLToPath(import.meta.url)), 'ProjectBoard.css')
const stylesheet = readFileSync(stylesheetPath, 'utf8')

describe('board card layout contract', () => {
  it('stacks card content and status controls so card text keeps column width', () => {
    expect(stylesheet).toMatch(/\.kanban-card__main\s*\{[^}]*flex-direction:\s*column/s)
    expect(stylesheet).toMatch(/\.kanban-card__status\s*\{[^}]*width:\s*100%/s)
  })
})
