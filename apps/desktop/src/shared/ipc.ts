import type { ImageFormat, PetManifest } from '@softpet/pet-format'

export interface Point {
  x: number
  y: number
}

export interface PetPayload {
  manifest: PetManifest
  /** Bytes crus da spritesheet. Vao por IPC para o canvas nao ser "tainted". */
  sheet: Uint8Array
  /** PNG, WebP ou GIF: vira o MIME do Blob que o renderer decodifica. */
  sheetFormat: ImageFormat
  sheetWidth: number
  sheetHeight: number
  displaySize: number
}

export type DragDirection = 'left' | 'right'

export interface NotificationAction {
  readonly id: string
  readonly label: string
}

/**
 * Um evento que merece a atencao do usuario.
 *
 * `states` e uma lista de candidatos, e nao um nome unico, porque nem todo pet
 * conhece os mesmos estados — um bundle v1 importado do Orca tem 7 nomes; um pet
 * gerado por nos tem os 17 de `PET_STATES`. Quem emite a notificacao declara sua
 * ordem de preferencia e o renderer usa o primeiro que existir.
 */
export interface PetNotification {
  readonly id: string
  readonly icon?: string
  readonly title: string
  readonly body?: string
  readonly states: readonly string[]
  /** Por quanto tempo a notificacao segura o controle da animacao. */
  readonly holdMs: number
  readonly actions?: readonly NotificationAction[]
}

/**
 * Superficie exposta ao renderer pelo preload (`window.softpet`).
 *
 * O renderer nao envia coordenadas absolutas: ele avisa quando o arrasto comeca
 * e termina, e pede deslocamentos relativos para caminhar. Quem conhece a tela e
 * o processo main — ver o comentario em `OverlayWindow`.
 */
export interface SoftpetApi {
  loadPet(): Promise<PetPayload>
  /** Liga/desliga o click-through da janela conforme o cursor entra na area util. */
  setInteractive(interactive: boolean): void
  /** `offset` = onde dentro do palco o usuario agarrou o pet. */
  dragStart(offset: Point): void
  dragEnd(): void
  /** Passo da caminhada autonoma, em pixels de tela. */
  moveBy(deltaX: number): void
  /** O usuario acionou um botao do balao. */
  runAction(notificationId: string, actionId: string): void

  onPlay(handler: (animation: string) => void): void
  onNotify(handler: (notification: PetNotification) => void): void
  onDisplaySize(handler: (displaySize: number) => void): void
  onDragDirection(handler: (direction: DragDirection) => void): void
  /** O pet encostou na borda da area de trabalho. */
  onEdge(handler: () => void): void
}

declare global {
  interface Window {
    softpet: SoftpetApi
  }
}
