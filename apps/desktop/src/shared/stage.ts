import { scaleFor, type FrameSize } from '@softpet/pet-format'

/**
 * Geometria da janela do overlay, compartilhada entre o main (que dimensiona e
 * posiciona a janela) e o renderer (que desenha dentro dela).
 *
 * A janela e um **palco de tamanho fixo**: o pet ocupa o meio-baixo e sobra
 * folga em volta para o balao de fala. A alternativa - crescer a janela quando
 * o balao abre - reintroduziria exatamente o tipo de laco que ja custou caro no
 * arrasto: a janela muda de tamanho, as coordenadas do que esta dentro mudam
 * junto, e o que decidiu abrir o balao passa a ler coordenadas erradas.
 *
 * Com o palco fixo, abrir e fechar balao e virar de lado sao decisoes puramente
 * do renderer. O main so move a janela.
 */

/** Folga lateral, de cada lado, para o balao. */
export const GUTTER_X = 200
/** Folga acima do pet, para o balao e para o pulo. */
export const HEADROOM_Y = 110

export interface StageLayout {
  /** Fator aplicado ao frame do pet. */
  readonly scale: number
  /** Tamanho da janela inteira, em DIP. */
  readonly stage: { readonly width: number; readonly height: number }
  /** Canto superior esquerdo do pet dentro do palco. */
  readonly petOrigin: { readonly x: number; readonly y: number }
  /** Retangulo ocupado pelo pet dentro do palco. */
  readonly petRect: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
}

export function layoutFor(frame: FrameSize, displaySize: number): StageLayout {
  const scale = scaleFor(frame, displaySize)
  const width = Math.ceil(frame.width * scale)
  const height = Math.ceil(frame.height * scale)

  return {
    scale,
    stage: { width: width + GUTTER_X * 2, height: height + HEADROOM_Y },
    petOrigin: { x: GUTTER_X, y: HEADROOM_Y },
    petRect: { x: GUTTER_X, y: HEADROOM_Y, width, height },
  }
}
