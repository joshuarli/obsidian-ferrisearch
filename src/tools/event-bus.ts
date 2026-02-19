export type EventBusCallback = (...args: unknown[]) => void

export class EventBus {
  private handlers = new Map<string, EventBusCallback>()
  private disabled = new Set<string>()

  public on(context: string, event: string, callback: EventBusCallback): void {
    this.handlers.set(`${context}@${event}`, callback)
  }

  public off(context: string, event?: string): void {
    if (event) {
      this.handlers.delete(`${context}@${event}`)
    } else {
      const prefix = `${context}@`
      for (const key of this.handlers.keys()) {
        if (key.startsWith(prefix)) this.handlers.delete(key)
      }
    }
  }

  public disable(context: string): void {
    this.disabled.add(context)
  }

  public enable(context: string): void {
    this.disabled.delete(context)
  }

  public emit(event: string, ...args: unknown[]): void {
    const suffix = `@${event}`
    for (const [key, handler] of this.handlers) {
      if (key.endsWith(suffix) && !this.disabled.has(key.slice(0, key.indexOf('@')))) {
        handler(...args)
      }
    }
  }
}
