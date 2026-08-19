import type { FrameSize, ImageFormat } from '@softpet/pet-format'

/** Abaixo disso o pixel conta como fundo, e o clique atravessa a janela. */
const OPAQUE_THRESHOLD = 24
/** Folga em pixels de frame no teste de acerto, para partes finas nao escaparem. */
const HIT_TOLERANCE = 2

/**
 * A spritesheet carregada, com a mascara de acerto ao lado.
 *
 * A mascara e a **uniao de todos os frames**, e nao o frame que esta na tela.
 * Testar o frame atual parece mais preciso e e uma armadilha: o pet reage ao
 * hover mudando de pose, a pose nova tem outra silhueta, o pixel sob o cursor
 * vira transparente, o hover cai, o pet volta a pose anterior - e o
 * click-through fica piscando dezenas de vezes por segundo, engolindo o clique.
 * Uma area de acerto estavel custa alguns pixels de folga e resolve o laco.
 */
export class Sprite {
  readonly #bitmap: ImageBitmap
  readonly #hitMask: Uint8Array
  readonly frame: FrameSize
  readonly columns: number
  readonly rows: number

  private constructor(bitmap: ImageBitmap, hitMask: Uint8Array, frame: FrameSize) {
    this.#bitmap = bitmap
    this.#hitMask = hitMask
    this.frame = frame
    this.columns = Math.floor(bitmap.width / frame.width)
    this.rows = Math.floor(bitmap.height / frame.height)
  }

  static async load(bytes: Uint8Array, format: ImageFormat, frame: FrameSize): Promise<Sprite> {
    // Blob -> ImageBitmap mantem o canvas limpo de "taint", o que e o que nos
    // permite ler os pixels para montar a mascara.
    const bitmap = await createImageBitmap(
      new Blob([bytes as BlobPart], { type: `image/${format}` }),
    )

    const scratch = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = scratch.getContext('2d', { willReadFrequently: true })
    if (context === null) throw new Error('Nao foi possivel criar o contexto 2D de leitura.')
    context.drawImage(bitmap, 0, 0)

    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height)
    const mask = unionMask(data, bitmap.width, bitmap.height, frame)

    return new Sprite(bitmap, dilate(mask, frame, HIT_TOLERANCE), frame)
  }

  get width(): number {
    return this.#bitmap.width
  }

  get height(): number {
    return this.#bitmap.height
  }

  /** `origin` e onde o frame e desenhado dentro do palco. */
  draw(
    context: CanvasRenderingContext2D,
    row: number,
    column: number,
    scale: number,
    origin: { x: number; y: number },
  ): void {
    const { width, height } = this.frame
    context.drawImage(
      this.#bitmap,
      column * width,
      row * height,
      width,
      height,
      origin.x,
      origin.y,
      width * scale,
      height * scale,
    )
  }

  /**
   * O ponto (`x`, `y`), em coordenadas do frame, cai sobre o pet?
   *
   * E o que decide se a janela deixa o clique passar para o que esta atras.
   */
  isOpaqueAt(x: number, y: number): boolean {
    const { width, height } = this.frame
    if (x < 0 || y < 0 || x >= width || y >= height) return false
    return this.#hitMask[y * width + x] === 1
  }
}

/** Projeta todos os frames da folha sobre um unico frame, marcando o que e opaco. */
function unionMask(
  data: Uint8ClampedArray,
  sheetWidth: number,
  sheetHeight: number,
  frame: FrameSize,
): Uint8Array {
  const mask = new Uint8Array(frame.width * frame.height)

  for (let y = 0; y < sheetHeight; y += 1) {
    const localY = y % frame.height
    for (let x = 0; x < sheetWidth; x += 1) {
      if ((data[(y * sheetWidth + x) * 4 + 3] ?? 0) < OPAQUE_THRESHOLD) continue
      mask[localY * frame.width + (x % frame.width)] = 1
    }
  }

  return mask
}

/**
 * Engorda a mascara em `radius` pixels. Acertar um braco de tres pixels com o
 * mouse e frustrante; vale mais errar para o lado de "o pet reagiu".
 *
 * Dilatacao separavel: uma passada horizontal e uma vertical, em vez de varrer
 * uma janela (2r+1)^2 por pixel.
 */
function dilate(mask: Uint8Array, frame: FrameSize, radius: number): Uint8Array {
  if (radius <= 0) return mask
  const { width, height } = frame

  const horizontal = new Uint8Array(mask.length)
  for (let y = 0; y < height; y += 1) {
    const row = y * width
    for (let x = 0; x < width; x += 1) {
      const from = Math.max(0, x - radius)
      const to = Math.min(width - 1, x + radius)
      for (let sample = from; sample <= to; sample += 1) {
        if (mask[row + sample] === 1) {
          horizontal[row + x] = 1
          break
        }
      }
    }
  }

  const result = new Uint8Array(mask.length)
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      const from = Math.max(0, y - radius)
      const to = Math.min(height - 1, y + radius)
      for (let sample = from; sample <= to; sample += 1) {
        if (horizontal[sample * width + x] === 1) {
          result[y * width + x] = 1
          break
        }
      }
    }
  }

  return result
}
