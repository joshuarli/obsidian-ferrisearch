import { Platform } from 'obsidian'
import { toggleInputComposition } from '../globals'
import { wait } from '../tools/utils'

export function createSearchInput(
  container: HTMLElement,
  placeholder: string,
  previousQuery: string,
  onInput: (value: string) => void,
): HTMLInputElement {
  const inputContainer = document.createElement('div')
  inputContainer.className = 'ferrisearch-input-container'
  const inputField = document.createElement('div')
  inputField.className = 'ferrisearch-input-field'
  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'prompt-input'
  input.placeholder = placeholder
  input.spellcheck = false
  inputField.append(input)
  inputContainer.append(inputField)
  container.append(inputContainer)

  if (previousQuery) input.value = previousQuery
  ;(async () => {
    if (Platform.isMobileApp) await wait(200)
    input.focus()
    if (Platform.isMobileApp) await wait(200)
    input.select()
  })()

  input.addEventListener('input', () => onInput(input.value))
  input.addEventListener('compositionstart', () => toggleInputComposition(true))
  input.addEventListener('compositionend', () => toggleInputComposition(false))

  return input
}

const longPressTimers = new WeakMap<HTMLElement, number>(),
  longPressFired = new WeakSet<HTMLElement>(),
  longPressInstrumented = new WeakSet<HTMLElement>()

export function addLongPress(
  el: HTMLElement,
  onLongPress: () => void,
  delay = 500,
): void {
  cancelLongPress(el)
  if (longPressInstrumented.has(el)) return
  longPressInstrumented.add(el)
  const start = () => {
    longPressFired.delete(el)
    cancelLongPress(el)
    longPressTimers.set(
      el,
      window.setTimeout(() => {
        longPressTimers.delete(el)
        longPressFired.add(el)
        onLongPress()
      }, delay),
    )
  }
  el.addEventListener('touchstart', start, { passive: true })
  el.addEventListener('touchmove', () => cancelLongPress(el), { passive: true })
  el.addEventListener('touchend', () => cancelLongPress(el))
  el.addEventListener('touchcancel', () => cancelLongPress(el))
}

export function cancelLongPress(el: HTMLElement): void {
  const timer = longPressTimers.get(el)
  if (timer !== undefined) {
    clearTimeout(timer)
    longPressTimers.delete(el)
  }
}

export function consumeLongPress(el: HTMLElement): boolean {
  cancelLongPress(el)
  if (longPressFired.has(el)) {
    longPressFired.delete(el)
    return true
  }
  return false
}

export function createResultsContainer(container: HTMLElement): HTMLElement {
  const resultsDiv = document.createElement('div')
  resultsDiv.className = 'prompt-results'
  resultsDiv.addEventListener('mousedown', e => e.preventDefault())
  container.append(resultsDiv)
  return resultsDiv
}

export function createInstructions(
  container: HTMLElement,
  items: readonly (readonly [string, string])[],
): void {
  const instructions = document.createElement('div')
  instructions.className = 'prompt-instructions'
  for (const [cmd, desc] of items) {
    const inst = document.createElement('div')
    inst.className = 'prompt-instruction'
    const cmdSpan = document.createElement('span')
    cmdSpan.className = 'prompt-instruction-command'
    cmdSpan.textContent = cmd
    const descSpan = document.createElement('span')
    descSpan.textContent = desc
    inst.append(cmdSpan)
    inst.append(descSpan)
    instructions.append(inst)
  }
  container.append(instructions)
}
