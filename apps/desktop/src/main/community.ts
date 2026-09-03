import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { parsePetManifest } from '@softpet/pet-format'

import type { CommunityPetInfo, PetPreview } from '../shared/settings-ipc.js'
import type { FetchedFiles } from './pet-library.js'
import { loadPet } from './pet-loader.js'

const SUPABASE_URL = 'https://xhjeutrxmvplkasdxmcx.supabase.co'
const SUPABASE_KEY = 'sb_publishable_e8rFev1ifMbjkwzbeR4jBg_aJAgfLTc'
const BUCKET_URL = `${SUPABASE_URL}/storage/v1/object/public/community-pets`

interface CommunityRow {
  id: string
  slug: string
  display_name: string
  description: string | null
  author_name: string
  manifest_path: string
  sheet_path: string
  downloads: number
  created_at: string
}

export class CommunityError extends Error {
  override readonly name = 'CommunityError'
}

async function api(path: string, init?: RequestInit): Promise<Response> {
  let response: Response
  try {
    response = await fetch(`${SUPABASE_URL}${path}`, {
      ...init,
      headers: { apikey: SUPABASE_KEY, ...init?.headers },
    })
  } catch (error) {
    throw new CommunityError(`Não consegui acessar a comunidade: ${(error as Error).message}`)
  }
  if (!response.ok) {
    let detail = `O servidor respondeu ${response.status}.`
    try {
      const body = (await response.json()) as { error?: string; message?: string }
      detail = body.error ?? body.message ?? detail
    } catch {}
    throw new CommunityError(detail)
  }
  return response
}

const publicUrl = (path: string): string => `${BUCKET_URL}/${path.split('/').map(encodeURIComponent).join('/')}`

export async function listCommunityPets(): Promise<CommunityPetInfo[]> {
  const select = 'id,slug,display_name,description,author_name,manifest_path,sheet_path,downloads,created_at'
  const rows = (await (
    await api(`/rest/v1/community_pets?select=${select}&order=created_at.desc`)
  ).json()) as CommunityRow[]
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    ...(row.description === null ? {} : { description: row.description }),
    authorName: row.author_name,
    downloads: row.downloads,
    createdAt: row.created_at,
  }))
}

export async function isCommunityPetNameAvailable(name: string): Promise<boolean> {
  const normalized = name.trim()
  if (normalized === '') return false
  const result = (await (
    await api(`/functions/v1/submit-pet?name=${encodeURIComponent(normalized)}`)
  ).json()) as { available: boolean }
  return result.available
}

async function rowOf(id: string): Promise<CommunityRow> {
  const select = 'id,slug,display_name,description,author_name,manifest_path,sheet_path,downloads,created_at'
  const rows = (await (
    await api(`/rest/v1/community_pets?id=eq.${encodeURIComponent(id)}&select=${select}&limit=1`)
  ).json()) as CommunityRow[]
  const row = rows[0]
  if (row === undefined) throw new CommunityError('Esse pet não está mais disponível.')
  return row
}

async function filesOf(row: CommunityRow): Promise<FetchedFiles> {
  const [manifestResponse, sheetResponse] = await Promise.all([
    api(`/storage/v1/object/public/community-pets/${row.manifest_path}`),
    api(`/storage/v1/object/public/community-pets/${row.sheet_path}`),
  ])
  return {
    manifestJson: await manifestResponse.text(),
    sheet: new Uint8Array(await sheetResponse.arrayBuffer()),
    sheetName: basename(row.sheet_path),
  }
}

export async function communityFiles(id: string): Promise<{ row: CommunityRow; files: FetchedFiles }> {
  const row = await rowOf(id)
  return { row, files: await filesOf(row) }
}

export async function communityPreview(id: string): Promise<PetPreview> {
  const { row, files } = await communityFiles(id)
  const manifest = parsePetManifest(JSON.parse(files.manifestJson), { fallbackId: row.slug })
  const extension = files.sheetName.split('.').at(-1)?.toLowerCase()
  if (extension !== 'png' && extension !== 'webp' && extension !== 'gif') {
    throw new CommunityError('Formato de imagem desconhecido.')
  }
  return { sheet: files.sheet, sheetFormat: extension, frame: manifest.frame }
}

export async function submitCommunityPet(
  dir: string,
  petName: string,
  authorName: string,
  installationId: string,
): Promise<void> {
  const loaded = await loadPet(dir)
  const manifestJson = await readFile(join(dir, 'pet.json'), 'utf8')
  const mime = `image/${loaded.sheetFormat}`
  const form = new FormData()
  form.set('manifest', new Blob([manifestJson], { type: 'application/json' }), 'pet.json')
  form.set(
    'sheet',
    new Blob([loaded.sheet as BlobPart], { type: mime }),
    `spritesheet.${loaded.sheetFormat}`,
  )
  form.set('authorName', authorName.trim())
  form.set('petName', petName.trim())
  form.set('installationId', installationId)
  await api('/functions/v1/submit-pet', { method: 'POST', body: form })
}
