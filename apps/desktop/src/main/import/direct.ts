import { findPetInZip, readZip } from './zip.js'

/**
 * Importacao por link direto para um arquivo.
 *
 * E a valvula de escape do sistema de importacao. Boa parte das galerias de pet
 * nao tem API nenhuma: a pagina do pet simplesmente oferece um `.zip` para
 * baixar. Integrar cada site desses, um a um, seria uma corrida sem fim contra
 * mudancas de layout alheias — e cada uma quebraria sozinha.
 *
 * Aqui o contrato e outro: o usuario baixa nada, so copia o endereco do arquivo.
 * Funciona em qualquer site, hoje e depois de qualquer redesenho, porque o que
 * se le e o arquivo — nao a pagina.
 */

const SHEET_PATTERN = /^spritesheet\.(webp|png|gif)$/i

export class DirectImportError extends Error {
  override readonly name = 'DirectImportError'
}

export interface DirectFiles {
  readonly manifestJson: string
  readonly sheet: Uint8Array
  readonly sheetName: string
  /** Nome derivado da URL, usado como id quando o manifesto nao traz um. */
  readonly slug: string
}

/** Reconhece links que apontam para um arquivo, e nao para uma pagina. */
export function isDirectFileUrl(input: string): boolean {
  try {
    const { pathname } = new URL(input.trim().includes('://') ? input.trim() : `https://${input.trim()}`)
    return /\.zip$/i.test(pathname) || /\/pet\.json$/i.test(pathname)
  } catch {
    return false
  }
}

async function download(url: string): Promise<Response> {
  let response: Response
  try {
    response = await fetch(url, { headers: { 'user-agent': 'softpet' } })
  } catch (error) {
    throw new DirectImportError(`Nao consegui baixar o link: ${(error as Error).message}`)
  }
  if (!response.ok) throw new DirectImportError(`O servidor respondeu ${response.status}.`)
  return response
}

function slugFromUrl(url: URL): string {
  const parts = url.pathname.split('/').filter((part) => part !== '')
  const last = parts.at(-1) ?? 'pet'

  // .../<slug>/pet.json — o nome util e a pasta, nao o arquivo.
  if (/^pet\.json$/i.test(last)) return parts.at(-2) ?? 'pet'
  return last.replace(/\.zip$/i, '').replace(/-codex-pet$/i, '')
}

export async function fetchDirectPet(input: string): Promise<DirectFiles> {
  const trimmed = input.trim()
  const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)

  if (/\.zip$/i.test(url.pathname)) {
    const bytes = new Uint8Array(await (await download(url.href)).arrayBuffer())
    const found = findPetInZip(readZip(bytes))
    return {
      manifestJson: found.manifestJson,
      sheet: found.sheet,
      sheetName: found.sheetName,
      // O nome da pasta dentro do zip costuma dizer mais que o do arquivo.
      slug: found.slug === 'pet' ? slugFromUrl(url) : found.slug,
    }
  }

  if (!/\/pet\.json$/i.test(url.pathname)) {
    throw new DirectImportError(
      'O link precisa apontar para um arquivo: um ".zip" do pet ou um "pet.json".',
    )
  }

  const manifestJson = await (await download(url.href)).text()

  let spritesheetPath: unknown
  try {
    spritesheetPath = (JSON.parse(manifestJson) as Record<string, unknown>)['spritesheetPath']
  } catch {
    throw new DirectImportError('O "pet.json" baixado nao e um JSON valido.')
  }
  if (typeof spritesheetPath !== 'string' || spritesheetPath === '') {
    throw new DirectImportError('O "pet.json" nao diz qual e a spritesheet.')
  }

  // A folha mora ao lado do manifesto; resolver relativo cobre tanto
  // "spritesheet.webp" quanto um caminho com subpasta.
  const sheetUrl = new URL(spritesheetPath, url.href)
  const sheetName = sheetUrl.pathname.split('/').at(-1) ?? 'spritesheet.webp'
  if (!SHEET_PATTERN.test(sheetName)) {
    throw new DirectImportError(
      `O manifesto aponta para "${sheetName}", que nao e uma spritesheet PNG, WebP ou GIF.`,
    )
  }

  const sheet = new Uint8Array(await (await download(sheetUrl.href)).arrayBuffer())
  return { manifestJson, sheet, sheetName, slug: slugFromUrl(url) }
}
