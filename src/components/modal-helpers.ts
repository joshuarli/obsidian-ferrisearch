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
  inputField.appendChild(input)
  inputContainer.appendChild(inputField)
  container.appendChild(inputContainer)

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

export function createResultsContainer(container: HTMLElement): HTMLElement {
  const resultsDiv = document.createElement('div')
  resultsDiv.className = 'prompt-results'
  resultsDiv.addEventListener('mousedown', e => e.preventDefault())
  container.appendChild(resultsDiv)
  return resultsDiv
}

export function createInstructions(
  container: HTMLElement,
  items: ReadonlyArray<readonly [string, string]>,
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
    inst.appendChild(cmdSpan)
    inst.appendChild(descSpan)
    instructions.appendChild(inst)
  }
  container.appendChild(instructions)
}
