/**
 * Le largura e altura direto do cabecalho da imagem, sem decodificar os pixels.
 *
 * Existe porque as dimensoes so servem para validar o manifesto contra a folha,
 * e trazer um decodificador nativo (`sharp`, ~30 MB) para o app do usuario so
 * por isso encareceria o instalador de todo mundo.
 *
 * WebP e obrigatorio, nao opcional: o acervo publico de pets e quase todo WebP
 * (`spritesheet.webp` e o valor gerado por padrao). Suportar so PNG deixaria de
 * fora justamente o que se quer importar.
 */

export type ImageFormat = 'png' | 'webp' | 'gif'

export interface ImageSize {
  readonly format: ImageFormat
  readonly width: number
  readonly height: number
}

export class ImageSizeError extends Error {
  override readonly name = 'ImageSizeError'
}

function startsWith(bytes: Uint8Array, offset: number, ascii: string): boolean {
  for (let index = 0; index < ascii.length; index += 1) {
    if (bytes[offset + index] !== ascii.charCodeAt(index)) return false
  }
  return true
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export function readImageSize(bytes: Uint8Array): ImageSize {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  if (bytes.length >= 24 && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    // IHDR e sempre o primeiro chunk: largura e altura em big-endian nos bytes 16 e 20.
    return { format: 'png', width: view.getUint32(16), height: view.getUint32(20) }
  }

  if (bytes.length >= 10 && startsWith(bytes, 0, 'GIF8')) {
    return { format: 'gif', width: view.getUint16(6, true), height: view.getUint16(8, true) }
  }

  if (bytes.length >= 30 && startsWith(bytes, 0, 'RIFF') && startsWith(bytes, 8, 'WEBP')) {
    return { format: 'webp', ...readWebpSize(bytes, view) }
  }

  throw new ImageSizeError('Formato de imagem nao reconhecido. Use PNG, WebP ou GIF.')
}

/**
 * WebP tem tres variantes de cabecalho e elas guardam o tamanho em lugares
 * diferentes. As folhas geradas pelas ferramentas da comunidade aparecem nas
 * tres, dependendo de qual encoder foi usado.
 */
function readWebpSize(
  bytes: Uint8Array,
  view: DataView,
): { width: number; height: number } {
  // VP8X (estendido): dimensoes do canvas em 24 bits little-endian, menos 1.
  if (startsWith(bytes, 12, 'VP8X')) {
    const width = 1 + (view.getUint8(24) | (view.getUint8(25) << 8) | (view.getUint8(26) << 16))
    const height = 1 + (view.getUint8(27) | (view.getUint8(28) << 8) | (view.getUint8(29) << 16))
    return { width, height }
  }

  // VP8L (sem perdas): 14 bits para cada dimensao, menos 1, empacotados apos a
  // assinatura 0x2f.
  if (startsWith(bytes, 12, 'VP8L')) {
    if (view.getUint8(20) !== 0x2f) {
      throw new ImageSizeError('WebP sem perdas com assinatura invalida.')
    }
    const packed = view.getUint32(21, true)
    return { width: 1 + (packed & 0x3fff), height: 1 + ((packed >> 14) & 0x3fff) }
  }

  // VP8 (com perdas): apos o start code 0x9d012a, 14 bits por dimensao.
  if (startsWith(bytes, 12, 'VP8 ')) {
    if (view.getUint8(23) !== 0x9d || view.getUint8(24) !== 0x01 || view.getUint8(25) !== 0x2a) {
      throw new ImageSizeError('WebP com perdas com start code invalido.')
    }
    return {
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
    }
  }

  throw new ImageSizeError('WebP com um chunk que nao sei ler (esperado VP8, VP8L ou VP8X).')
}
