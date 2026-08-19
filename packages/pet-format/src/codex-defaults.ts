import type { AnimationDef, FrameSize } from './manifest.js'

/**
 * O layout que o app do Codex assume quando o `pet.json` nao declara nada.
 *
 * Isto nao e um detalhe de compatibilidade: praticamente **todo** pet da
 * comunidade e so isto —
 *
 * ```json
 * { "id": "pikachu", "displayName": "Pikachu",
 *   "description": "...", "spritesheetPath": "spritesheet.webp" }
 * ```
 *
 * Sem `frame`, sem `fps`, sem `animations`, sem `defaultAnimation`. Quem sabe o
 * resto e o renderer. Um parser que exigisse esses campos recusaria os milhares
 * de pets ja publicados, que sao justamente o acervo que queremos importar.
 *
 * Valores conferidos com a skill `hatch-pet` do repositorio `openai/skills`, que
 * e a especificacao de origem: atlas 1536x1872, celulas de 192x208, 8 colunas e
 * 9 linhas nesta ordem. Existe tambem um atlas v2 de 11 linhas; as duas linhas
 * extras guardam direcoes de olhar que nem o Codex nem o Orca disparam, entao
 * ficam sem uso aqui tambem.
 */
export const CODEX_FRAME: FrameSize = { width: 192, height: 208 }
export const CODEX_COLUMNS = 8

/** `n` frames a `each` ms, com o ultimo segurando `last` ms. */
function timing(count: number, each: number, last: number): number[] {
  return Array.from({ length: count }, (_, index) => (index === count - 1 ? last : each))
}

export const CODEX_ANIMATIONS: Readonly<Record<string, AnimationDef>> = {
  idle: { row: 0, frames: 6, frameDurationsMs: [280, 110, 110, 140, 140, 320], loop: true },
  'running-right': { row: 1, frames: 8, frameDurationsMs: timing(8, 120, 220), loop: true },
  'running-left': { row: 2, frames: 8, frameDurationsMs: timing(8, 120, 220), loop: true },
  waving: { row: 3, frames: 4, frameDurationsMs: timing(4, 140, 280), loop: true },
  jumping: { row: 4, frames: 5, frameDurationsMs: timing(5, 140, 280), loop: true },
  failed: { row: 5, frames: 8, frameDurationsMs: timing(8, 140, 240), loop: true },
  waiting: { row: 6, frames: 6, frameDurationsMs: timing(6, 150, 260), loop: true },
  running: { row: 7, frames: 6, frameDurationsMs: timing(6, 120, 220), loop: true },
  review: { row: 8, frames: 6, frameDurationsMs: timing(6, 150, 280), loop: true },
}

export const CODEX_DEFAULT_ANIMATION = 'idle'
