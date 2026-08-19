import { defaultAnchors } from '@softpet/pet-format'

import type { PetNotification } from '../../shared/ipc.js'
import { layoutFor, type StageLayout } from '../../shared/stage.js'
import { Animator } from './animator.js'
import { Balloon, type BalloonSide } from './balloon.js'
import { BehaviorLoop } from './behavior.js'
import { Director, LEVEL } from './director.js'
import { Sprite } from './sprite.js'

/**
 * Candidatos por gesto, em ordem de preferencia. Um bundle v1 importado do Orca
 * so conhece os 7 nomes de la; um pet gerado por nos conhece os 17 de
 * `PET_STATES`. Traduzir os nomes na carga mentiria sobre o que o pet sabe
 * fazer — cada gesto declara suas alternativas e o Director usa a primeira que
 * existir.
 */
const ON_HOVER = ['wave', 'waving', 'jumping']
const ON_DRAG_RIGHT = ['drag', 'walk-right', 'running-right', 'running']
const ON_DRAG_LEFT = ['drag', 'walk-left', 'running-left', 'running']

/** Quanto tempo uma animacao forcada pelo menu de depuracao segura o controle. */
const DEBUG_HOLD_MS = 8_000

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#pet')
  if (canvas === null) throw new Error('Canvas do overlay nao encontrado.')

  const context = canvas.getContext('2d')
  if (context === null) throw new Error('Contexto 2D indisponivel.')

  const pet = await window.softpet.loadPet()
  const sprite = await Sprite.load(pet.sheet, pet.sheetFormat, pet.manifest.frame)
  const animator = new Animator(pet.manifest)
  const director = new Director(animator, pet.manifest.defaultAnimation)
  const balloon = new Balloon(document.body)
  const behavior = new BehaviorLoop(director, (deltaX) => window.softpet.moveBy(deltaX))

  let layout: StageLayout = layoutFor(pet.manifest.frame, pet.displaySize)
  let hovering = false
  let dragging = false
  let balloonTimer: number | undefined

  const headAnchor = (): { x: number; y: number } => {
    const anchors = pet.manifest.anchors.head
      ? pet.manifest.anchors
      : defaultAnchors(pet.manifest.frame)
    const [x, y] = anchors.head ?? [pet.manifest.frame.width / 2, 0]
    return {
      x: layout.petOrigin.x + x * layout.scale,
      y: layout.petOrigin.y + y * layout.scale,
    }
  }

  const resize = (): void => {
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.round(window.innerWidth * ratio)
    canvas.height = Math.round(window.innerHeight * ratio)
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.imageSmoothingEnabled = false
  }

  const render = (): void => {
    context.clearRect(0, 0, window.innerWidth, window.innerHeight)
    sprite.draw(context, animator.row, animator.column, layout.scale, layout.petOrigin)
  }

  let previous = performance.now()
  const tick = (now: number): void => {
    const delta = now - previous
    previous = now

    director.tick(now)
    behavior.tick(delta)
    animator.advance(delta)
    render()
    requestAnimationFrame(tick)
  }

  // --- click-through -------------------------------------------------------
  // A janela ignora o mouse por padrao. O Electron so encaminha eventos de
  // *movimento* enquanto isso vale, entao o teste de acerto precisa mesmo ouvir
  // 'mousemove' - 'pointermove' nao chega nesse estado.
  const setHovering = (next: boolean): void => {
    if (hovering === next) return
    hovering = next
    canvas.classList.toggle('interactive', next)
    behavior.noteInteraction()
    if (!dragging) director.request(LEVEL.interaction, next ? ON_HOVER : null)
  }

  /** O palco captura o mouse sobre o desenho do pet ou sobre o balao aberto. */
  const isLive = (clientX: number, clientY: number): boolean => {
    if (balloon.containsPoint(clientX, clientY)) return true
    const x = Math.floor((clientX - layout.petOrigin.x) / layout.scale)
    const y = Math.floor((clientY - layout.petOrigin.y) / layout.scale)
    return sprite.isOpaqueAt(x, y)
  }

  window.addEventListener('mousemove', (event) => {
    if (dragging) return
    const live = isLive(event.clientX, event.clientY)
    window.softpet.setInteractive(live)
    setHovering(live && !balloon.containsPoint(event.clientX, event.clientY))
  })

  // Sair da janela por um canto pode nao gerar um ultimo 'mousemove' sobre o
  // fundo; sem isto o pet ficaria capturando cliques indefinidamente.
  document.addEventListener('mouseleave', () => {
    if (dragging) return
    window.softpet.setInteractive(false)
    setHovering(false)
  })

  // --- arrastar ------------------------------------------------------------
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    if (!isLive(event.clientX, event.clientY)) return
    dragging = true
    // A captura garante o 'pointerup' mesmo que o cursor saia da janela - o que
    // acontece o tempo todo, ja que a janela persegue o cursor com um quadro de
    // atraso.
    canvas.setPointerCapture(event.pointerId)
    canvas.classList.add('dragging')
    behavior.noteInteraction()
    window.softpet.dragStart({ x: event.clientX, y: event.clientY })
  })

  const endDrag = (event: PointerEvent): void => {
    if (!dragging) return
    dragging = false
    canvas.releasePointerCapture(event.pointerId)
    canvas.classList.remove('dragging')
    window.softpet.dragEnd()
    director.request(LEVEL.interaction, hovering ? ON_HOVER : null)
  }

  canvas.addEventListener('pointerup', endDrag)
  canvas.addEventListener('pointercancel', endDrag)

  // --- balao ---------------------------------------------------------------
  const hideBalloon = (): void => {
    window.clearTimeout(balloonTimer)
    balloon.hide()
  }

  const showBalloon = (notification: PetNotification): void => {
    window.clearTimeout(balloonTimer)

    // De que lado sobra tela. `window.screenX` e a origem do palco; o pet esta
    // um `petOrigin.x` a direita dela.
    const petCenter = window.screenX + layout.petOrigin.x + layout.petRect.width / 2
    const side: BalloonSide = petCenter > window.screen.width / 2 ? 'left' : 'right'

    balloon.show(
      {
        ...(notification.icon !== undefined ? { icon: notification.icon } : {}),
        title: notification.title,
        ...(notification.body !== undefined ? { body: notification.body } : {}),
        actions: (notification.actions ?? []).map((action) => ({
          label: action.label,
          run: () => {
            window.softpet.runAction(notification.id, action.id)
            hideBalloon()
          },
        })),
      },
      headAnchor(),
      side,
    )

    balloonTimer = window.setTimeout(hideBalloon, notification.holdMs)
  }

  // --- comandos vindos do processo main ------------------------------------
  window.softpet.onNotify((notification) => {
    director.notify(notification.states, notification.holdMs)
    showBalloon(notification)
  })

  window.softpet.onPlay((animation) => {
    if (!animator.has(animation)) {
      console.warn(`[softpet] o pet nao tem a animacao "${animation}".`)
      return
    }
    director.notify([animation], DEBUG_HOLD_MS)
  })

  window.softpet.onDisplaySize((size) => {
    layout = layoutFor(pet.manifest.frame, size)
    resize()
  })

  window.softpet.onDragDirection((direction) => {
    if (dragging) {
      director.request(LEVEL.interaction, direction === 'right' ? ON_DRAG_RIGHT : ON_DRAG_LEFT)
    }
  })

  window.softpet.onEdge(() => behavior.onEdge())

  window.addEventListener('resize', resize)

  resize()
  requestAnimationFrame(tick)
}

void main().catch((error: unknown) => {
  console.error('[softpet] falha ao iniciar o overlay:', error)
})
