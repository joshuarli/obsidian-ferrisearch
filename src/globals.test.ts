import { describe, expect, it, mock } from 'bun:test'
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
    const obs = new Observable(10)
    const fn = mock(() => {})
    obs.subscribe(fn)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith(10)
  })

  it('calls subscriber on each set()', () => {
    const obs = new Observable(0)
    const values: number[] = []
    obs.subscribe(v => values.push(v))
    obs.set(1)
    obs.set(2)
    obs.set(3)
    expect(values).toEqual([0, 1, 2, 3])
  })

  it('returns unsubscribe function that stops notifications', () => {
    const obs = new Observable('a')
    const fn = mock(() => {})
    const unsub = obs.subscribe(fn)
    expect(fn).toHaveBeenCalledTimes(1) // initial

    obs.set('b')
    expect(fn).toHaveBeenCalledTimes(2)

    unsub()
    obs.set('c')
    expect(fn).toHaveBeenCalledTimes(2) // no more calls
  })

  it('supports multiple independent subscribers', () => {
    const obs = new Observable(0)
    const fn1 = mock(() => {})
    const fn2 = mock(() => {})

    const unsub1 = obs.subscribe(fn1)
    obs.subscribe(fn2)

    obs.set(1)
    expect(fn1).toHaveBeenCalledTimes(2) // initial + set
    expect(fn2).toHaveBeenCalledTimes(2)

    unsub1()
    obs.set(2)
    expect(fn1).toHaveBeenCalledTimes(2) // stopped
    expect(fn2).toHaveBeenCalledTimes(3) // still going
  })

  it('handles unsubscribe during set() iteration safely', () => {
    const obs = new Observable(0)
    let unsub2: (() => void) | null = null

    // First subscriber removes the second
    obs.subscribe(() => {
      if (unsub2) unsub2()
    })
    const fn2 = mock(() => {})
    unsub2 = obs.subscribe(fn2)

    // fn2 was called once (initial subscribe call)
    expect(fn2).toHaveBeenCalledTimes(1)

    // This set() triggers subscriber 1 which unsubs subscriber 2
    // Should not throw
    obs.set(1)
  })
})
