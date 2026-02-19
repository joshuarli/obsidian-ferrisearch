export type EventBusCallback = (...args: unknown[]) => void

export class EventBus {
  private handlers: Map<string, EventBusCallback> = new Map()
  private disabled: string[] = []

  public on(context: string, event: string, callback: EventBusCallback): void {
    if (context.includes('@') || event.includes('@')) {
      throw new Error('Invalid context/event name - Cannot contain @')
    }
    this.handlers.set(`${context}@${event}`, callback)
  }

  public off(context: string, event?: string): void {
    if (event) {
      this.handlers.delete(`${context}@${event}`)
    } else {
      for (const [key] of this.handlers.entries()) {
        if (key.startsWith(`${context}@`)) {
          this.handlers.delete(key)
        }
      }
    }
  }

  public disable(context: string): void {
    this.enable(context)
    this.disabled.push(context)
  }

  public enable(context: string): void {
    this.disabled = this.disabled.filter(v => v !== context)
  }

  public emit(event: string, ...args: unknown[]): void {
    const entries = [...this.handlers.entries()].filter(
      ([k, _]) => !this.disabled.includes(k.split('@')[0]),
    )
    for (const [key, handler] of entries) {
      if (key.endsWith(`@${event}`)) {
        handler(...args)
      }
    }
  }
}
