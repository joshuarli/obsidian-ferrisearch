import { describe, expect, it, vi } from 'vitest'
import { Observable } from './globals'

describe('Observable', () => {
  it('returns initial value via get()', () => {
    const obs = new Observable(42)
    expect(obs.get()).toBe(42)
  })

  it('updates value via set()', () => {
    const obs = new Observable('hello')
    obs.set('world')
    expect(obs.get()).toBe('world')
  })

  it('calls subscriber immediately with current value', () => {
    const obs = new Observable(10),
      spy = vi.fn(() => {}) as (v: number) => void
    obs.subscribe(spy)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(10)
  })

  it('calls subscriber on each set()', () => {
    const obs = new Observable(0),
      values: number[] = []
    obs.subscribe((v: number) => values.push(v))
    obs.set(1)
    obs.set(2)
    obs.set(3)
    expect(values).toEqual([0, 1, 2, 3])
  })

  it('returns unsubscribe function that stops notifications', () => {
    const obs = new Observable('a'),
      spy = vi.fn(() => {}) as (v: string) => void,
      unsub = obs.subscribe(spy)
    expect(spy).toHaveBeenCalledTimes(1) // Initial

    obs.set('b')
    expect(spy).toHaveBeenCalledTimes(2)

    unsub()
    obs.set('c')
    expect(spy).toHaveBeenCalledTimes(2) // No more calls
  })

  it('supports multiple independent subscribers', () => {
    const obs = new Observable(0),
      spy1 = vi.fn(() => {}) as (v: number) => void,
      spy2 = vi.fn(() => {}) as (v: number) => void,
      unsub1 = obs.subscribe(spy1)
    obs.subscribe(spy2)

    obs.set(1)
    expect(spy1).toHaveBeenCalledTimes(2) // Initial + set
    expect(spy2).toHaveBeenCalledTimes(2)

    unsub1()
    obs.set(2)
    expect(spy1).toHaveBeenCalledTimes(2) // Stopped
    expect(spy2).toHaveBeenCalledTimes(3) // Still going
  })

  it('handles unsubscribe during set() iteration safely', () => {
    const obs = new Observable(0)
    let unsub2: (() => void) | null = null

    // First subscriber removes the second
    obs.subscribe(() => {
      if (unsub2) unsub2()
    })
    const spy2 = vi.fn(() => {}) as (v: number) => void
    unsub2 = obs.subscribe(spy2)

    // Spy2 was called once (initial subscribe call)
    expect(spy2).toHaveBeenCalledTimes(1)

    // This set() triggers subscriber 1 which unsubs subscriber 2
    // Should not throw
    obs.set(1)
  })
})
