import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'

import { DISPLAY_SIZE, type FrameSize } from '@softpet/pet-format'

import type { PetNotification } from '../shared/ipc.js'
import { layoutFor, type StageLayout } from '../shared/stage.js'
import type { SettingsStore } from './store.js'

/** Margem entre o pet e a borda da area de trabalho na primeira execucao. */
const INITIAL_MARGIN = 24
/** Quanto do pet precisa continuar visivel para ainda dar para pega-lo. */
const MIN_VISIBLE = 24
/** ~60 Hz: o pet precisa colar no cursor, senao o arrasto parece emborrachado. */
const DRAG_INTERVAL_MS = 16
/** Deslocamento minimo, em px, para trocar o sentido da caminhada ao arrastar. */
const DIRECTION_DEADZONE = 3

const isDev = !!process.env['ELECTRON_RENDERER_URL']

export type DragDirection = 'left' | 'right'

interface Point {
  x: number
  y: number
}

/**
 * A janela do pet.
 *
 * Duas escolhas moldam esta classe, e as duas vieram de bug:
 *
 * 1. **Janela pequena que acompanha o pet**, nao um overlay em tela cheia
 *    transparente — tela cheia consome GPU o tempo todo e da artefato em alguns
 *    drivers Windows.
 * 2. **Palco de tamanho fixo** (ver `shared/stage.ts`): a janela e maior que o
 *    pet, com folga reservada para o balao, e nunca muda de tamanho durante o
 *    uso. Redimensionar sob demanda mudaria as coordenadas do conteudo bem no
 *    instante em que alguem as esta lendo.
 *
 * Como o palco e maior que o pet, toda a matematica de posicao aqui e feita em
 * **coordenadas do pet**, nao da janela: e o pet que precisa parar na borda da
 * tela, enquanto o palco pode (e deve) transbordar para fora dela.
 */
export class OverlayWindow {
  readonly #store: SettingsStore
  readonly #frame: FrameSize
  readonly #window: BrowserWindow
  #layout: StageLayout
  #interactive = false
  #dragOffset: Point | null = null
  #dragTimer: NodeJS.Timeout | null = null
  #dragDirection: DragDirection | null = null
  #lastCursorX = 0

  constructor(store: SettingsStore, frame: FrameSize) {
    this.#store = store
    this.#frame = frame
    this.#layout = layoutFor(frame, store.get('displaySize'))

    const pet = store.get('petPosition') ?? this.#initialPetPosition()
    const origin = this.#stageFor(pet)

    this.#window = new BrowserWindow({
      width: this.#layout.stage.width,
      height: this.#layout.stage.height,
      x: origin.x,
      y: origin.y,
      transparent: true,
      backgroundColor: '#00000000',
      frame: false,
      resizable: false,
      movable: false, // quem move e este objeto, com clamp na area de trabalho
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      // Um overlay nunca deve tirar o foco do que o usuario esta fazendo.
      focusable: false,
      alwaysOnTop: true,
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })

    // 'floating' mantem o pet acima das janelas comuns sem competir com
    // notificacoes do sistema.
    this.#window.setAlwaysOnTop(true, 'floating')
    this.#window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false })
    this.setInteractive(false)

    this.#window.once('ready-to-show', () => this.#window.showInactive())

    if (isDev) {
      void this.#window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/overlay/index.html`)
      this.#window.webContents.openDevTools({ mode: 'detach' })
    } else {
      void this.#window.loadFile(join(__dirname, '../renderer/overlay/index.html'))
    }
  }

  get webContents() {
    return this.#window.webContents
  }

  get displaySize(): number {
    return this.#store.get('displaySize')
  }

  get layout(): StageLayout {
    return this.#layout
  }

  /**
   * Liga e desliga o click-through. O renderer chama isso a cada entrada e
   * saida do cursor da area util, entao filtramos repeticoes: cada chamada
   * atravessa a ponte IPC e mexe em estilo de janela no Windows.
   */
  setInteractive(interactive: boolean): void {
    if (this.#interactive === interactive || this.#window.isDestroyed()) return
    this.#interactive = interactive
    this.#window.setIgnoreMouseEvents(!interactive, { forward: true })
  }

  /**
   * Passo da caminhada autonoma. Avisa o renderer quando o pet encosta na borda
   * para ele virar — o renderer nao tem como saber onde acaba a area de
   * trabalho.
   */
  moveBy(deltaX: number): void {
    if (this.#dragOffset !== null || this.#window.isDestroyed()) return
    const pet = this.#petPosition()
    const blocked = this.#setPetPosition({ x: pet.x + deltaX, y: pet.y })
    // Onde o pet parou de caminhar tambem e "onde o usuario o deixou": sem isto,
    // reabrir o app o teleportaria de volta ao ultimo ponto arrastado. A escrita
    // em disco e adiada pelo proprio store, entao caminhar nao vira I/O.
    this.#store.setPosition(this.#petPosition())
    if (blocked) this.#window.webContents.send('overlay:edge')
  }

  /**
   * `offset` e onde, dentro do palco, o usuario agarrou o pet.
   *
   * Daqui em diante quem manda na posicao e o proprio main, lendo o cursor a
   * cada quadro. O caminho obvio - o renderer mandar `event.screenX/screenY` -
   * nao funciona: o Chromium deriva essas coordenadas da origem da janela, e a
   * janela esta se movendo justamente por causa desses eventos. O pet acaba
   * teleportando para um canto. `screen.getCursorScreenPoint()` nao participa
   * desse laco.
   */
  dragStart(offset: Point): void {
    if (this.#dragTimer !== null) this.dragEnd()
    this.#dragOffset = offset
    this.#dragDirection = null
    this.#lastCursorX = screen.getCursorScreenPoint().x
    this.#dragTimer = setInterval(() => this.#followCursor(), DRAG_INTERVAL_MS)
  }

  dragEnd(): void {
    if (this.#dragTimer !== null) {
      clearInterval(this.#dragTimer)
      this.#dragTimer = null
    }
    if (this.#dragOffset === null) return
    this.#dragOffset = null
    if (this.#window.isDestroyed()) return
    this.#store.setPosition(this.#petPosition())
  }

  /**
   * Troca o tamanho de exibicao mantendo a base do pet no lugar - crescer a
   * partir do canto superior esquerdo faria o pet "afundar" no rodape da tela.
   */
  setDisplaySize(size: number): void {
    const next = Math.min(DISPLAY_SIZE.max, Math.max(DISPLAY_SIZE.min, Math.round(size)))
    if (next === this.displaySize || this.#window.isDestroyed()) return

    const before = this.#layout
    const pet = this.#petPosition()

    this.#layout = layoutFor(this.#frame, next)
    this.#store.set('displaySize', next)

    const anchored = {
      x: Math.round(pet.x + (before.petRect.width - this.#layout.petRect.width) / 2),
      y: Math.round(pet.y + (before.petRect.height - this.#layout.petRect.height)),
    }

    const clamped = this.#clampPet(anchored)
    this.#window.setBounds({ ...this.#stageFor(clamped), ...this.#layout.stage })
    this.#store.setPosition(clamped)
    this.#window.webContents.send('overlay:display-size', next)
  }

  /** Pede ao renderer que toque uma animacao especifica. */
  play(animation: string): void {
    if (this.#window.isDestroyed()) return
    this.#window.webContents.send('overlay:play', animation)
  }

  notify(notification: PetNotification): void {
    if (this.#window.isDestroyed()) return
    this.#window.webContents.send('overlay:notify', notification)
  }

  get isVisible(): boolean {
    return !this.#window.isDestroyed() && this.#window.isVisible()
  }

  /** Devolve o estado resultante, para quem pediu refletir na interface. */
  toggleVisibility(): boolean {
    if (this.#window.isDestroyed()) return false
    if (this.#window.isVisible()) {
      this.#window.hide()
      return false
    }
    this.#window.showInactive()
    return true
  }

  destroy(): void {
    if (this.#dragTimer !== null) clearInterval(this.#dragTimer)
    if (!this.#window.isDestroyed()) this.#window.destroy()
  }

  // --- posicionamento -------------------------------------------------------

  #followCursor(): void {
    if (this.#dragOffset === null || this.#window.isDestroyed()) {
      this.dragEnd()
      return
    }

    const cursor = screen.getCursorScreenPoint()
    this.#setPetPosition({
      x: Math.round(cursor.x - this.#dragOffset.x + this.#layout.petOrigin.x),
      y: Math.round(cursor.y - this.#dragOffset.y + this.#layout.petOrigin.y),
    })

    const deltaX = cursor.x - this.#lastCursorX
    if (Math.abs(deltaX) < DIRECTION_DEADZONE) return
    this.#lastCursorX = cursor.x

    const direction = deltaX > 0 ? 'right' : 'left'
    if (direction === this.#dragDirection) return
    this.#dragDirection = direction
    this.#window.webContents.send('overlay:drag-direction', direction)
  }

  /** Canto superior esquerdo do pet, em coordenadas de tela. */
  #petPosition(): Point {
    const [x = 0, y = 0] = this.#window.getPosition()
    return { x: x + this.#layout.petOrigin.x, y: y + this.#layout.petOrigin.y }
  }

  /** Origem da janela (palco) que coloca o pet em `pet`. */
  #stageFor(pet: Point): Point {
    return { x: pet.x - this.#layout.petOrigin.x, y: pet.y - this.#layout.petOrigin.y }
  }

  /** Move o pet; devolve `true` se o clamp barrou o movimento pedido. */
  #setPetPosition(pet: Point): boolean {
    const clamped = this.#clampPet(pet)
    const origin = this.#stageFor(clamped)
    this.#window.setPosition(origin.x, origin.y)
    return clamped.x !== pet.x || clamped.y !== pet.y
  }

  /**
   * Impede que o pet seja levado para fora da tela a ponto de nao dar mais para
   * pega-lo de volta. O clamp e sobre o pet, nao sobre a janela: o palco e maior
   * que o pet e transbordar da tela e o comportamento correto para ele.
   */
  #clampPet(pet: Point): Point {
    const { width, height } = this.#layout.petRect
    const { workArea } = screen.getDisplayNearestPoint(pet)
    return {
      x: Math.min(
        Math.max(pet.x, workArea.x - width + MIN_VISIBLE),
        workArea.x + workArea.width - MIN_VISIBLE,
      ),
      y: Math.min(
        Math.max(pet.y, workArea.y),
        workArea.y + workArea.height - MIN_VISIBLE,
      ),
    }
  }

  #initialPetPosition(): Point {
    const { workArea } = screen.getPrimaryDisplay()
    const { width, height } = this.#layout.petRect
    return {
      x: workArea.x + workArea.width - width - INITIAL_MARGIN,
      y: workArea.y + workArea.height - height - INITIAL_MARGIN,
    }
  }
}
