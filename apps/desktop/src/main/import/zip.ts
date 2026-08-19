import { inflateRawSync } from 'node:zlib'

/**
 * Leitor minimo de ZIP, so o suficiente para extrair um bundle de pet.
 *
 * E ~90 linhas contra uma dependencia: `node:zlib` ja faz a parte dificil
 * (deflate), e o que sobra e navegar o diretorio central. Um pet baixado tem
 * dois arquivos pequenos, entao nao ha caso de uso para streaming, ZIP64 ou
 * criptografia — o que nao for suportado vira erro explicito em vez de leitura
 * silenciosamente errada.
 */

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
/** Sem comentario, o EOCD sao os ultimos 22 bytes; o comentario cabe em 64 KiB. */
const MAX_EOCD_SEARCH = 22 + 0xffff

export interface ZipEntry {
  readonly name: string
  readonly read: () => Uint8Array
}

export class ZipError extends Error {
  override readonly name = 'ZipError'
}

export function readZip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  const eocd = findEocd(view, bytes.length)
  const count = view.getUint16(eocd + 10, true)
  let cursor = view.getUint32(eocd + 16, true)

  const entries: ZipEntry[] = []
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) {
      throw new ZipError('Diretorio central corrompido.')
    }

    const method = view.getUint16(cursor + 10, true)
    const compressedSize = view.getUint32(cursor + 20, true)
    const nameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const localOffset = view.getUint32(cursor + 42, true)

    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength))
    cursor += 46 + nameLength + extraLength + commentLength

    if (name.endsWith('/')) continue // pasta

    entries.push({
      name,
      read: () => extract(bytes, view, localOffset, method, compressedSize, name),
    })
  }

  return entries
}

function findEocd(view: DataView, length: number): number {
  const floor = Math.max(0, length - MAX_EOCD_SEARCH)
  for (let offset = length - 22; offset >= floor; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset
  }
  throw new ZipError('Isto nao parece um arquivo ZIP.')
}

function extract(
  bytes: Uint8Array,
  view: DataView,
  localOffset: number,
  method: number,
  compressedSize: number,
  name: string,
): Uint8Array {
  if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) {
    throw new ZipError(`Cabecalho local invalido para "${name}".`)
  }

  const nameLength = view.getUint16(localOffset + 26, true)
  const extraLength = view.getUint16(localOffset + 28, true)
  const start = localOffset + 30 + nameLength + extraLength
  const payload = bytes.subarray(start, start + compressedSize)

  if (method === 0) return payload
  if (method === 8) return new Uint8Array(inflateRawSync(payload))
  throw new ZipError(
    `"${name}" usa um metodo de compressao que nao sei ler (${method}). ` +
      'Recompacte com deflate ou sem compressao.',
  )
}

export interface ZippedPet {
  readonly manifestJson: string
  readonly sheet: Uint8Array
  readonly sheetName: string
  /** Pasta de onde o pet foi extraido, usada como id de reserva. */
  readonly slug: string
}

const SHEET_PATTERN = /^spritesheet\.(webp|png|gif)$/i

/**
 * Acha o bundle dentro do ZIP.
 *
 * Um zip baixado do GitHub embrulha tudo numa pasta `repo-branch/`, e um pet
 * exportado a mao pode estar na raiz. Procuramos o `pet.json` menos profundo e
 * pegamos a spritesheet vizinha, em vez de exigir um layout especifico.
 */
export function findPetInZip(entries: readonly ZipEntry[]): ZippedPet {
  const manifests = entries
    .filter((entry) => entry.name.endsWith('pet.json'))
    .sort((a, b) => a.name.split('/').length - b.name.split('/').length)

  const manifest = manifests[0]
  if (manifest === undefined) throw new ZipError('Nao achei nenhum "pet.json" dentro do ZIP.')

  const slash = manifest.name.lastIndexOf('/')
  const dir = slash === -1 ? '' : manifest.name.slice(0, slash + 1)
  const slug = slash === -1 ? 'pet' : (manifest.name.slice(0, slash).split('/').pop() ?? 'pet')

  const sheet = entries.find(
    (entry) => entry.name.startsWith(dir) && SHEET_PATTERN.test(entry.name.slice(dir.length)),
  )
  if (sheet === undefined) {
    throw new ZipError(`Achei "${manifest.name}", mas nenhuma spritesheet ao lado dele.`)
  }

  return {
    manifestJson: new TextDecoder().decode(manifest.read()),
    sheet: sheet.read(),
    sheetName: sheet.name.slice(dir.length),
    slug,
  }
}
