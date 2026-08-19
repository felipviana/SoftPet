import { Director, LEVEL } from './director.js'

/** Velocidade da caminhada, em pixels de tela por segundo. */
const WALK_SPEED = 42
/** Sem interacao por este tempo, o pet cochila. */
const SLEEP_AFTER_MS = 5 * 60_000

interface Action {
  readonly states: readonly string[]
  /** Peso no sorteio, relativo aos demais. */
  readonly weight: number
  readonly minMs: number
  readonly maxMs: number
  readonly walk?: -1 | 1
}

/**
 * O repertorio ocioso. Os pesos sao o que separa "vivo" de "epiletico": ficar
 * parado precisa ser bem mais provavel que qualquer gesto, senao o pet vira uma
 * distracao no canto da tela em vez de companhia.
 */
const ACTIONS: readonly Action[] = [
  { states: ['idle'], weight: 10, minMs: 3_000, maxMs: 9_000 },
  { states: ['blink', 'idle'], weight: 4, minMs: 200, maxMs: 400 },
  { states: ['look-around', 'idle'], weight: 3, minMs: 1_500, maxMs: 3_000 },
  { states: ['sit', 'idle'], weight: 3, minMs: 6_000, maxMs: 16_000 },
  { states: ['stretch', 'idle'], weight: 1, minMs: 1_500, maxMs: 3_000 },
  { states: ['yawn', 'idle'], weight: 1, minMs: 1_500, maxMs: 2_500 },
  {
    states: ['walk-left', 'running-left', 'running'],
    weight: 3,
    minMs: 1_200,
    maxMs: 3_500,
    walk: -1,
  },
  {
    states: ['walk-right', 'running-right', 'running'],
    weight: 3,
    minMs: 1_200,
    maxMs: 3_500,
    walk: 1,
  },
]

const TOTAL_WEIGHT = ACTIONS.reduce((sum, action) => sum + action.weight, 0)
const SLEEP_STATES = ['sleep', 'waiting', 'idle'] as const

/**
 * A vida propria do pet: sorteia gestos e caminhadas enquanto ninguem pede nada.
 *
 * Roda sempre, mas so **age** quando o Director esta na camada ambiente. Ao ser
 * preemptado por hover ou notificacao, aborta a acao em curso; quando a camada
 * de cima se retira, sorteia de novo em vez de retomar pela metade.
 */
export class BehaviorLoop {
  readonly #director: Director
  readonly #moveBy: (deltaX: number) => void

  #remainingMs = 0
  #walk: -1 | 1 | 0 = 0
  /** Sobra fracionaria: a 42 px/s, um quadro de 16 ms anda 0,67 px. */
  #pending = 0
  #idleMs = 0
  #asleep = false

  constructor(director: Director, moveBy: (deltaX: number) => void) {
    this.#director = director
    this.#moveBy = moveBy
  }

  /** O usuario mexeu no pet: acorda e reinicia a contagem para o cochilo. */
  noteInteraction(): void {
    this.#idleMs = 0
    if (this.#asleep) {
      this.#asleep = false
      this.#remainingMs = 0
    }
  }

  /** A janela bateu na borda da area de trabalho: vira e segue andando. */
  onEdge(): void {
    if (this.#walk === 0) return
    this.#walk = this.#walk === 1 ? -1 : 1
    this.#pending = 0
    this.#director.request(LEVEL.ambient, this.#walk === 1 ? WALK_RIGHT : WALK_LEFT)
  }

  tick(deltaMs: number): void {
    this.#idleMs += deltaMs

    if (this.#director.preempted) {
      // Uma camada de cima assumiu. Descarta a acao em curso para nao retomar
      // uma caminhada pela metade quando ela se retirar.
      this.#remainingMs = 0
      this.#walk = 0
      this.#pending = 0
      return
    }

    if (this.#idleMs >= SLEEP_AFTER_MS) {
      if (!this.#asleep) {
        this.#asleep = true
        this.#walk = 0
        this.#director.request(LEVEL.ambient, SLEEP_STATES)
      }
      return
    }

    if (this.#walk !== 0) this.#step(deltaMs)

    this.#remainingMs -= deltaMs
    if (this.#remainingMs > 0) return

    this.#pick()
  }

  #step(deltaMs: number): void {
    this.#pending += (WALK_SPEED * deltaMs) / 1000
    const whole = Math.trunc(this.#pending)
    if (whole === 0) return
    this.#pending -= whole
    this.#moveBy(whole * this.#walk)
  }

  #pick(): void {
    let roll = Math.random() * TOTAL_WEIGHT
    const action = ACTIONS.find((candidate) => (roll -= candidate.weight) < 0) ?? ACTIONS[0]!

    this.#walk = action.walk ?? 0
    this.#pending = 0
    this.#remainingMs = action.minMs + Math.random() * (action.maxMs - action.minMs)
    this.#director.request(LEVEL.ambient, action.states)
  }
}

const WALK_LEFT = ACTIONS.find((a) => a.walk === -1)!.states
const WALK_RIGHT = ACTIONS.find((a) => a.walk === 1)!.states
