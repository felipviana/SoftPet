import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import {
  parsePetManifest,
  readImageSize,
  validateAgainstSheet,
  type ImageFormat,
  type PetManifest,
} from '@softpet/pet-format'

export interface LoadedPet {
  readonly dir: string
  readonly manifest: PetManifest
  readonly sheet: Uint8Array
  readonly sheetFormat: ImageFormat
  readonly sheetWidth: number
  readonly sheetHeight: number
}

export class PetLoadError extends Error {
  override readonly name = 'PetLoadError'
}

/**
 * Carrega um bundle a partir de um diretorio com `pet.json` e a spritesheet que
 * ele aponta.
 *
 * Aceita o nosso formato v2, os bundles `.codex-pet` do Orca e o manifesto
 * minimo do acervo publico (que omite frame e animacoes e conta com os defaults
 * do Codex). A spritesheet pode ser PNG, WebP ou GIF — WebP e o formato da
 * maioria dos pets publicados.
 */
export async function loadPet(dir: string): Promise<LoadedPet> {
  let manifestJson: string
  try {
    manifestJson = await readFile(join(dir, 'pet.json'), 'utf8')
  } catch {
    throw new PetLoadError(`Nao encontrei "pet.json" em ${dir}.`)
  }

  let raw: unknown
  try {
    raw = JSON.parse(manifestJson)
  } catch (error) {
    throw new PetLoadError(`"pet.json" nao e um JSON valido: ${(error as Error).message}`)
  }

  const manifest = parsePetManifest(raw, { fallbackId: basename(dir) })

  const sheetPath = join(dir, manifest.spritesheetPath)
  let sheet: Uint8Array
  try {
    sheet = await readFile(sheetPath)
  } catch {
    throw new PetLoadError(`Nao encontrei a spritesheet em ${sheetPath}.`)
  }

  const { format, width, height } = readImageSize(sheet)
  validateAgainstSheet(manifest, width, height)

  return { dir, manifest, sheet, sheetFormat: format, sheetWidth: width, sheetHeight: height }
}
