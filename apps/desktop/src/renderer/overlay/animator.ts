import type { AnimationDef, PetManifest } from '@softpet/pet-format'

/**
 * Um quadro perdido nao deve virar uma animacao inteira consumida de uma vez.
 * Acontece sempre que a janela fica oculta e volta, ou quando a maquina sai da
 * suspensao.
 */
const MAX_STEP_MS = 250

/**
 * Toca uma animacao do manifesto: cursor de frame + relogio.
 *
 * Diferente do overlay do Orca, aqui uma animacao pode nao ser em loop. Ao
 * terminar, ela devolve o controle para `next` (ou congela no ultimo frame se
 * `next` nao existir), que e o que permite uma reacao pontual - acenar, apontar
 * para o balao - sem ficar repetindo para sempre.
 */
export class Animator {
  readonly #manifest: PetManifest
  #name: string
  #definition: AnimationDef
  #index = 0
  #elapsed = 0
  #finished = false

  constructor(manifest: PetManifest) {
    this.#manifest = manifest
    this.#name = manifest.defaultAnimation
    this.#definition = this.#require(manifest.defaultAnimation)
  }

  get current(): string {
    return this.#name
  }

  get row(): number {
    return this.#definition.row
  }

  get column(): number {
    return this.#index
  }

  /** Verdadeiro quando uma animacao sem loop chegou ao fim e nao tinha `next`. */
  get finished(): boolean {
    return this.#finished
  }

  has(name: string): boolean {
    return name in this.#manifest.animations
  }

  /** Devolve false quando o pet nao tem essa animacao - o chamador decide o plano B. */
  play(name: string): boolean {
    const definition = this.#manifest.animations[name]
    if (definition === undefined) return false
    if (name === this.#name) return true

    this.#name = name
    this.#definition = definition
    this.#index = 0
    this.#elapsed = 0
    this.#finished = false
    return true
  }

  advance(deltaMs: number): void {
    if (this.#finished) return

    this.#elapsed += Math.min(deltaMs, MAX_STEP_MS)

    for (;;) {
      const duration = this.#definition.frameDurationsMs[this.#index] ?? MAX_STEP_MS
      if (this.#elapsed < duration) return

      this.#elapsed -= duration
      this.#index += 1
      if (this.#index < this.#definition.frames) continue

      if (this.#definition.loop) {
        this.#index = 0
        continue
      }

      const next = this.#definition.next
      if (next !== undefined && this.play(next)) return

      this.#index = this.#definition.frames - 1
      this.#finished = true
      return
    }
  }

  #require(name: string): AnimationDef {
    const definition = this.#manifest.animations[name]
    if (definition === undefined) {
      throw new Error(`Manifesto sem a animacao padrao "${name}".`)
    }
    return definition
  }
}
