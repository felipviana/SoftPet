/**
 * Importacao do petdex.dev — a maior galeria publica de pets (4.500+).
 *
 * Diferente das colecoes do GitHub, o petdex nao guarda os pets em git: eles
 * ficam em banco e num bucket, e a API de listagem exige login (`/api/pets/<slug>`
 * responde 401). Nao da, portanto, para navegar o acervo daqui.
 *
 * O que **e** publico e o endpoint que a CLI deles usa: `/api/install/<slug>`
 * devolve um script de shell com as duas URLs de asset. Em vez de adivinhar o
 * padrao dessas URLs e quebrar quando eles mudarem de convencao, lemos o script
 * e extraimos os enderecos — a mesma fonte que a ferramenta oficial usa.
 *
 * Consequencia para a interface: aqui a importacao e por **slug**, um pet por
 * vez. Navegar continua sendo no site deles.
 */

const REFERER = 'https://petdex.dev/'
const MANIFEST_PATTERN = /'(https:\/\/assets\.petdex\.dev\/[^']+\.json)'/
const SHEET_PATTERN = /'(https:\/\/assets\.petdex\.dev\/[^']+\.(webp|png|gif))'/

export class PetdexImportError extends Error {
  override readonly name = 'PetdexImportError'
}

/** Reconhece `petdex.dev/pets/<slug>`, `petdex:<slug>` e o slug puro. */
export function parsePetdexSlug(input: string): string | null {
  const trimmed = input.trim().replace(/\/+$/, '')

  const prefixed = /^petdex:([\w.-]+)$/i.exec(trimmed)
  if (prefixed) return prefixed[1]!

  if (!/petdex\.dev/i.test(trimmed)) return null

  const fromUrl = /petdex\.dev\/pets\/([\w.-]+)/i.exec(trimmed)
  if (fromUrl) return fromUrl[1]!

  throw new PetdexImportError(
    'Reconheci o petdex, mas nao o pet. Use o link de um pet especifico, ' +
      'algo como petdex.dev/pets/boba.',
  )
}

export interface PetdexFiles {
  readonly manifestJson: string
  readonly sheet: Uint8Array
  readonly sheetName: string
}

async function get(url: string): Promise<Response> {
  const response = await fetch(url, {
    headers: { referer: REFERER, 'user-agent': 'softpet' },
  })
  if (!response.ok) {
    throw new PetdexImportError(`O petdex respondeu ${response.status} para ${url}.`)
  }
  return response
}

export async function fetchPetdexPet(slug: string): Promise<PetdexFiles> {
  const script = await (await get(`https://petdex.dev/api/install/${encodeURIComponent(slug)}`)).text()

  const manifestUrl = MANIFEST_PATTERN.exec(script)?.[1]
  const sheetUrl = SHEET_PATTERN.exec(script)?.[1]
  if (manifestUrl === undefined || sheetUrl === undefined) {
    throw new PetdexImportError(
      `Nao achei os arquivos de "${slug}" no instalador do petdex. ` +
        'Confira o slug, ou eles mudaram o formato do script.',
    )
  }

  const [manifest, sheet] = await Promise.all([get(manifestUrl), get(sheetUrl)])
  const extension = sheetUrl.slice(sheetUrl.lastIndexOf('.') + 1).toLowerCase()

  return {
    manifestJson: await manifest.text(),
    sheet: new Uint8Array(await sheet.arrayBuffer()),
    sheetName: `spritesheet.${extension}`,
  }
}
