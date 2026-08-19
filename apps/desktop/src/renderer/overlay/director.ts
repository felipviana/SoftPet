import type { Animator } from './animator.js'

/**
 * Camadas de prioridade. Um pedido so aparece na tela se nada acima dele estiver
 * ativo — sem isso, o comportamento ambiente sorteia um bocejo bem no instante
 * em que chega um aviso urgente.
 */
export const LEVEL = {
  /** Vida propria: o que o pet faz quando ninguem pediu nada. */
  ambient: 0,
  /** O usuario esta mexendo no pet: hover, arrasto. */
  interaction: 1,
  /** Um evento externo que merece atencao. Manda em todo o resto. */
  notification: 2,
} as const

export type Level = (typeof LEVEL)[keyof typeof LEVEL]

const LEVELS = [LEVEL.notification, LEVEL.interaction, LEVEL.ambient] as const

type Request = readonly string[] | null

/**
 * Arbitra quem manda na animacao.
 *
 * Cada camada registra o que gostaria de tocar; a mais alta ganha. Quando ela
 * se retira, o pet volta sozinho para o que a camada de baixo ainda queria — e
 * nao para um estado neutro. Isso importa: se uma notificacao interrompe uma
 * caminhada, o pet retoma a caminhada em vez de congelar em `idle`.
 *
 * Os pedidos sao **listas de candidatos**, nao nomes unicos, porque nem todo pet
 * tem todo estado. Bundles v1 importados do Orca conhecem 7 nomes; um pet gerado
 * por nos conhece os 17 de `PET_STATES`. Cada gesto declara suas alternativas em
 * ordem de preferencia.
 */
export class Director {
  readonly #animator: Animator
  readonly #fallback: string
  // Tupla, nao array: com `noUncheckedIndexedAccess`, indexar um array daria
  // `... | undefined`, e `undefined !== null` faria `level` eleger uma camada
  // vazia como vencedora.
  readonly #requests: [Request, Request, Request] = [null, null, null]
  #notificationUntil = 0

  constructor(animator: Animator, fallback: string) {
    this.#animator = animator
    this.#fallback = fallback
  }

  /** Camada que esta no controle agora. */
  get level(): Level {
    for (const level of [LEVEL.notification, LEVEL.interaction] as const) {
      if (this.#requests[level] !== null) return level
    }
    return LEVEL.ambient
  }

  /** O comportamento ambiente foi preemptado e deve abortar o que estava fazendo. */
  get preempted(): boolean {
    return this.level > LEVEL.ambient
  }

  /**
   * Registra o que uma camada quer tocar. `null` significa "me retirei".
   * Devolve `false` quando o pedido foi aceito mas nao apareceu na tela por
   * estar abaixo de outra camada ativa.
   */
  request(level: Level, candidates: readonly string[] | null): boolean {
    this.#requests[level] = candidates
    this.#resolve()
    return this.level === level
  }

  /**
   * Uma notificacao segura o controle por `holdMs` mesmo depois de a animacao
   * terminar, para o balao ter tempo de ser lido.
   */
  notify(candidates: readonly string[], holdMs: number): void {
    this.#notificationUntil = performance.now() + holdMs
    this.request(LEVEL.notification, candidates)
  }

  tick(now: number): void {
    if (this.#requests[LEVEL.notification] === null) return
    if (now < this.#notificationUntil) return
    this.request(LEVEL.notification, null)
  }

  #resolve(): void {
    for (const level of LEVELS) {
      const candidates = this.#requests[level]
      if (candidates === null) continue
      const match = candidates.find((name) => this.#animator.has(name))
      if (match !== undefined) {
        this.#animator.play(match)
        return
      }
      // Camada ativa cujos candidatos este pet nao conhece: cai para a de baixo
      // em vez de travar num estado que nao existe.
    }
    this.#animator.play(this.#fallback)
  }
}
