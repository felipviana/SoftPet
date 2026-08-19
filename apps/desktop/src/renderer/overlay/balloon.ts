export interface BalloonAction {
  readonly label: string
  readonly run: () => void
}

export interface BalloonContent {
  /** Emoji ou simbolo curto que identifica o tipo de evento. */
  readonly icon?: string
  readonly title: string
  readonly body?: string
  readonly actions?: readonly BalloonAction[]
}

/** De que lado do pet o balao aparece. */
export type BalloonSide = 'left' | 'right'

/**
 * O balao de fala.
 *
 * E DOM, e nao desenho no canvas, por um motivo pratico: quebra de linha,
 * elipse e botoes clicaveis sao de graca no navegador e caros no canvas. Como o
 * palco tem tamanho fixo, o balao cabe inteiro dentro da janela e trocar de lado
 * e so mudar `left` — nada disso toca a janela.
 */
export class Balloon {
  readonly #element: HTMLElement
  readonly #icon: HTMLElement
  readonly #title: HTMLElement
  readonly #body: HTMLElement
  readonly #actions: HTMLElement
  #visible = false

  constructor(parent: HTMLElement) {
    this.#element = document.createElement('div')
    this.#element.className = 'balloon'
    this.#element.hidden = true

    const header = document.createElement('div')
    header.className = 'balloon-header'

    this.#icon = document.createElement('span')
    this.#icon.className = 'balloon-icon'

    this.#title = document.createElement('span')
    this.#title.className = 'balloon-title'

    header.append(this.#icon, this.#title)

    this.#body = document.createElement('p')
    this.#body.className = 'balloon-body'

    this.#actions = document.createElement('div')
    this.#actions.className = 'balloon-actions'

    this.#element.append(header, this.#body, this.#actions)
    parent.append(this.#element)
  }

  get visible(): boolean {
    return this.#visible
  }

  /** `anchor` e a cabeca do pet, em coordenadas do palco. */
  show(content: BalloonContent, anchor: { x: number; y: number }, side: BalloonSide): void {
    this.#icon.textContent = content.icon ?? ''
    this.#icon.hidden = content.icon === undefined
    this.#title.textContent = content.title

    this.#body.textContent = content.body ?? ''
    this.#body.hidden = content.body === undefined

    this.#actions.replaceChildren()
    for (const action of content.actions ?? []) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = action.label
      button.addEventListener('click', action.run)
      this.#actions.append(button)
    }
    this.#actions.hidden = (content.actions?.length ?? 0) === 0

    this.#element.dataset['side'] = side
    this.#element.hidden = false
    this.#visible = true

    // Medir so depois de visivel: um elemento com `hidden` tem altura zero, e o
    // balao ficaria ancorado no lugar errado na primeira exibicao.
    const { width, height } = this.#element.getBoundingClientRect()
    const left = side === 'right' ? anchor.x + 18 : anchor.x - width - 18
    this.#element.style.left = `${Math.round(left)}px`
    this.#element.style.top = `${Math.round(Math.max(4, anchor.y - height / 2))}px`
  }

  hide(): void {
    this.#element.hidden = true
    this.#visible = false
    this.#actions.replaceChildren()
  }

  /**
   * O ponto cai sobre o balao? Entra no mesmo teste que decide o click-through:
   * enquanto o balao esta aberto, ele tambem precisa capturar o mouse, senao os
   * botoes nao seriam clicaveis.
   */
  containsPoint(x: number, y: number): boolean {
    if (!this.#visible) return false
    const rect = this.#element.getBoundingClientRect()
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  }
}
