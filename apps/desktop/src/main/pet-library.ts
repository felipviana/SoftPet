import { app } from 'electron'
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { loadPet, PetLoadError } from './pet-loader.js'

/** Metadado nosso, gravado ao lado do bundle. Nao faz parte do formato do pet. */
const SIDECAR = 'softpet.json'

export interface InstalledPet {
  readonly id: string
  readonly displayName: string
  readonly description?: string
  readonly dir: string
  /** `codex-defaults` = o `pet.json` nao declarava layout e assumimos o padrao. */
  readonly layoutSource: 'declared' | 'codex-defaults'
  readonly animations: readonly string[]
  /** De onde este pet veio: URL do repositorio ou pasta de origem. */
  readonly origin?: string
  readonly installedAt?: string
}

export interface FetchedFiles {
  readonly manifestJson: string
  readonly sheet: Uint8Array
  readonly sheetName: string
}

export class LibraryError extends Error {
  override readonly name = 'LibraryError'
}

export function libraryDir(): string {
  return join(app.getPath('userData'), 'pets')
}

/**
 * Ids viram nome de pasta, entao precisam ser inofensivos no sistema de
 * arquivos: um `id` de um repositorio qualquer nao pode escrever fora da
 * biblioteca.
 */
function safeId(raw: string): string {
  const cleaned = raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 64)
  if (cleaned === '') throw new LibraryError(`Nao consigo derivar um nome de pasta de "${raw}".`)
  return cleaned
}

async function readSidecar(dir: string): Promise<{ origin?: string; installedAt?: string }> {
  try {
    const raw: unknown = JSON.parse(await readFile(join(dir, SIDECAR), 'utf8'))
    if (typeof raw !== 'object' || raw === null) return {}
    const { origin, installedAt } = raw as Record<string, unknown>
    return {
      ...(typeof origin === 'string' ? { origin } : {}),
      ...(typeof installedAt === 'string' ? { installedAt } : {}),
    }
  } catch {
    return {}
  }
}

async function describe(dir: string): Promise<InstalledPet> {
  const { manifest } = await loadPet(dir)
  const sidecar = await readSidecar(dir)
  return {
    id: manifest.id,
    displayName: manifest.displayName,
    ...(manifest.description !== undefined ? { description: manifest.description } : {}),
    dir,
    layoutSource: manifest.layoutSource,
    animations: Object.keys(manifest.animations),
    ...sidecar,
  }
}

/**
 * Lista os pets instalados. Uma pasta quebrada e ignorada em vez de derrubar a
 * listagem inteira — a biblioteca cresce por importacao, e uma importacao ruim
 * nao deve esconder as boas.
 */
export async function listInstalled(): Promise<InstalledPet[]> {
  const root = libraryDir()
  let entries: string[]
  try {
    entries = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
  } catch {
    return []
  }

  const pets: InstalledPet[] = []
  for (const name of entries) {
    try {
      pets.push(await describe(join(root, name)))
    } catch (error) {
      console.warn(`[softpet] ignorando "${name}" na biblioteca:`, (error as Error).message)
    }
  }

  return pets.sort((a, b) => a.displayName.localeCompare(b.displayName))
}

/**
 * Escreve os arquivos numa pasta temporaria, valida, e so entao publica no
 * lugar definitivo. Sem isso, um bundle invalido substituiria um pet que
 * funcionava e o usuario ficaria sem os dois.
 */
async function stageAndPublish(
  id: string,
  write: (stagingDir: string) => Promise<void>,
  origin: string | undefined,
): Promise<InstalledPet> {
  const root = libraryDir()
  const finalDir = join(root, id)
  const stagingDir = join(root, `.staging-${id}`)

  await rm(stagingDir, { recursive: true, force: true })
  await mkdir(stagingDir, { recursive: true })

  try {
    await write(stagingDir)

    // Valida no lugar temporario: `loadPet` faz o parse do manifesto, le o
    // cabecalho da imagem e confere as linhas contra a folha.
    await loadPet(stagingDir)

    await writeFile(
      join(stagingDir, SIDECAR),
      JSON.stringify(
        { ...(origin !== undefined ? { origin } : {}), installedAt: new Date().toISOString() },
        null,
        2,
      ),
      'utf8',
    )

    await rm(finalDir, { recursive: true, force: true })
    // `rename` entre pastas irmas e atomico o bastante aqui; ambas estao no
    // mesmo volume, dentro do userData.
    const { rename } = await import('node:fs/promises')
    await rename(stagingDir, finalDir)

    return await describe(finalDir)
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true })
    if (error instanceof PetLoadError) {
      throw new LibraryError(`O bundle nao passou na validacao: ${error.message}`)
    }
    throw error
  }
}

/** Importa uma pasta que ja contenha `pet.json` + spritesheet. */
export async function installFromDirectory(sourceDir: string): Promise<InstalledPet> {
  const { manifest } = await loadPet(sourceDir)
  const id = safeId(manifest.id || basename(sourceDir))

  return stageAndPublish(
    id,
    async (staging) => {
      await copyFile(join(sourceDir, 'pet.json'), join(staging, 'pet.json'))
      await copyFile(
        join(sourceDir, manifest.spritesheetPath),
        join(staging, basename(manifest.spritesheetPath)),
      )
      // O caminho da folha pode ter subpasta na origem; depois da copia ela fica
      // na raiz do bundle, entao o manifesto precisa acompanhar.
      if (manifest.spritesheetPath !== basename(manifest.spritesheetPath)) {
        const raw: unknown = JSON.parse(await readFile(join(staging, 'pet.json'), 'utf8'))
        const patched = {
          ...(raw as Record<string, unknown>),
          spritesheetPath: basename(manifest.spritesheetPath),
        }
        await writeFile(join(staging, 'pet.json'), JSON.stringify(patched, null, 2), 'utf8')
      }
    },
    sourceDir,
  )
}

/** Importa um pet baixado (repositorio, arquivo compactado). */
export async function installFromFiles(
  fallbackId: string,
  files: FetchedFiles,
  origin: string,
): Promise<InstalledPet> {
  let declaredId: string | undefined
  try {
    const raw: unknown = JSON.parse(files.manifestJson)
    const value = (raw as Record<string, unknown> | null)?.['id']
    if (typeof value === 'string' && value.trim() !== '') declaredId = value
  } catch {
    throw new LibraryError('O "pet.json" baixado nao e um JSON valido.')
  }

  const id = safeId(declaredId ?? fallbackId)

  return stageAndPublish(
    id,
    async (staging) => {
      await writeFile(join(staging, 'pet.json'), files.manifestJson, 'utf8')
      await writeFile(join(staging, files.sheetName), files.sheet)
    },
    origin,
  )
}

export async function removeInstalled(id: string): Promise<void> {
  await rm(join(libraryDir(), safeId(id)), { recursive: true, force: true })
}
