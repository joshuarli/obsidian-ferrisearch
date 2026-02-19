import { describe, it, expect, mock } from 'bun:test'
import { EventBus } from './event-bus'

describe('EventBus', () => {
  it('calls handler on matching event', () => {
    const bus = new EventBus()
    const fn = mock(() => {})
    bus.on('ctx', 'click', fn)
    bus.emit('click')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('passes arguments to handler', () => {
    const bus = new EventBus()
    const fn = mock(() => {})
    bus.on('ctx', 'click', fn)
    bus.emit('click', 'a', 42)
    expect(fn).toHaveBeenCalledWith('a', 42)
  })

  it('does not call handler for different event', () => {
    const bus = new EventBus()
    const fn = mock(() => {})
    bus.on('ctx', 'click', fn)
    bus.emit('hover')
    expect(fn).toHaveBeenCalledTimes(0)
  })

  it('supports multiple handlers in different contexts', () => {
    const bus = new EventBus()
    const fn1 = mock(() => {})
    const fn2 = mock(() => {})
    bus.on('ctx1', 'click', fn1)
    bus.on('ctx2', 'click', fn2)
    bus.emit('click')
    expect(fn1).toHaveBeenCalledTimes(1)
    expect(fn2).toHaveBeenCalledTimes(1)
  })

  it('disable() suppresses context from firing', () => {
    const bus = new EventBus()
    const fn = mock(() => {})
    bus.on('ctx', 'click', fn)
    bus.disable('ctx')
    bus.emit('click')
    expect(fn).toHaveBeenCalledTimes(0)
  })

  it('enable() re-enables a disabled context', () => {
    const bus = new EventBus()
    const fn = mock(() => {})
    bus.on('ctx', 'click', fn)
    bus.disable('ctx')
    bus.enable('ctx')
    bus.emit('click')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('off(context) removes all handlers for context', () => {
    const bus = new EventBus()
    const fn1 = mock(() => {})
    const fn2 = mock(() => {})
    bus.on('ctx', 'click', fn1)
    bus.on('ctx', 'hover', fn2)
    bus.off('ctx')
    bus.emit('click')
    bus.emit('hover')
    expect(fn1).toHaveBeenCalledTimes(0)
    expect(fn2).toHaveBeenCalledTimes(0)
  })

  it('off(context, event) removes only the specific handler', () => {
    const bus = new EventBus()
    const fnClick = mock(() => {})
    const fnHover = mock(() => {})
    bus.on('ctx', 'click', fnClick)
    bus.on('ctx', 'hover', fnHover)
    bus.off('ctx', 'click')
    bus.emit('click')
    bus.emit('hover')
    expect(fnClick).toHaveBeenCalledTimes(0)
    expect(fnHover).toHaveBeenCalledTimes(1)
  })

  it('throws if context contains @', () => {
    const bus = new EventBus()
    expect(() => bus.on('c@x', 'ev', () => {})).toThrow()
  })

  it('throws if event contains @', () => {
    const bus = new EventBus()
    expect(() => bus.on('ctx', 'e@v', () => {})).toThrow()
  })
})
