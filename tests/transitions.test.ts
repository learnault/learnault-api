import { describe, it, expect } from 'vitest'
import { canTransition } from '../src/utils/transitions'

type Status = 'a' | 'b' | 'c'

const map = {
  a: ['b'],
  b: ['c'],
  c: [],
} as const

describe('canTransition', () => {
  it('allows a transition present in the map', () => {
    expect(canTransition(map, 'a', 'b')).toBe(true)
  })

  it('rejects a transition not present in the map', () => {
    expect(canTransition(map, 'a', 'c')).toBe(false)
  })

  it('rejects any transition out of a terminal state', () => {
    expect(canTransition(map, 'c', 'a' as Status)).toBe(false)
  })

  it('rejects a no-op transition unless explicitly listed', () => {
    expect(canTransition(map, 'a', 'a')).toBe(false)
  })
})
