/**
 * Descoberta de pets em um repositorio do GitHub.
 *
 * A estrategia e listar pela **API de arvore** e baixar so o pet escolhido, em
 * vez de clonar. O `codex-pokepets` tem 1.738 pets (~5.200 arquivos, centenas de
 * MB com os GIFs de preview); clonar para o usuario escolher um Pikachu seria
 * absurdo.
 *
 * ## O orcamento de requisicoes
 *
 * Sem autenticacao, a API do GitHub libera **60 requisicoes por hora e por IP** —
 * e so ela conta: os downloads em `raw.githubusercontent.com` sao ilimitados.
 * Sessenta parece bastante e acaba rapido se cada acao gastar chamadas a toa,
 * entao aqui:
 *
 * - a listagem e **cacheada** por repositorio e revisao; importar N pets de uma
 *   listagem custa **zero** chamadas alem da que a produziu;
 * - passado o TTL, revalidamos com `If-None-Match`. Um `304` nao conta contra o
 *   limite, entao rever um repositorio grande e de graca;
 * - com a revisao na URL (`/tree/<ref>`), pulamos a consulta de metadados;
 * - um **token** opcional troca o teto de 60 por 5.000 por hora.
 */

const SHEET_PATTERN = /^spritesheet\.(webp|png|gif)$/i

/**
 * Miniatura pronta, quando o repositorio publica uma.
 *
 * A diferenca de custo e enorme e decide o comportamento da interface: no
 * `codex-pokepets` o `preview.gif` tem ~6 KB contra ~18 KB da folha, mas no
 * `awesome-codex-pet` nao ha preview nenhum e cada folha pesa ~2 MB. Baixar 198
 * miniaturas de la seriam ~386 MB — por isso a interface carrega sob demanda, e
 * nunca em lote.
 */
const PREVIEW_PATTERN = /^preview\.(gif|webp|png|apng)$/i
/** Abaixo disto servimos do cache sem tocar na rede. */
const CACHE_TTL_MS = 10 * 60_000

export interface RepoRef {
  readonly owner: string
  readonly repo: string
  /** Branch ou tag. Resolvido pela API quando a URL nao traz um. */
  readonly ref?: string
}

export interface RepoPetEntry {
  /** Nome da pasta do pet, usado como rotulo e como id de reserva. */
  readonly slug: string
  /** Caminho da pasta dentro do repositorio. */
  readonly dir: string
  readonly manifestPath: string
  readonly sheetPath: string
  readonly sheetName: string
  /**
   * Miniatura publicada pelo repositorio, se houver. Quando falta, a interface
   * cai para a spritesheet — bem mais cara, e por isso so sob demanda.
   */
  readonly previewPath?: string
}

/** O que sobrou do orcamento horario, para a interface poder avisar antes de acabar. */
export interface RateLimit {
  readonly remaining: number
  readonly limit: number
  /** Momento em que o orcamento renova, em ms desde a epoca. */
  readonly resetAt: number
  readonly authenticated: boolean
}

export interface RepoListing {
  readonly ref: RepoRef & { ref: string }
  readonly description: string | null
  readonly pets: readonly RepoPetEntry[]
  /** A arvore veio truncada: o repositorio passou do limite da API. */
  readonly truncated: boolean
  readonly rateLimit: RateLimit | null
}

export class GitHubImportError extends Error {
  override readonly name = 'GitHubImportError'
}

let token: string | null = null
let lastRateLimit: RateLimit | null = null

/** Um token pessoal do GitHub sobe o teto de 60 para 5.000 requisicoes por hora. */
export function setGitHubToken(value: string | null): void {
  const trimmed = value?.trim() ?? ''
  token = trimmed === '' ? null : trimmed
}

export function getRateLimit(): RateLimit | null {
  return lastRateLimit
}

interface CacheEntry {
  listing: RepoListing
  etag: string | null
  at: number
}

const listingCache = new Map<string, CacheEntry>()
/** Revisao padrao por repositorio, para nao reconsultar metadados. */
const defaultBranchCache = new Map<string, string>()

/** Invalida o cache; usado quando o usuario troca o token. */
export function clearGitHubCache(): void {
  listingCache.clear()
  defaultBranchCache.clear()
}

/**
 * Aceita `owner/repo`, a URL do repositorio, e URLs de `tree/<ref>` — que e o
 * que se copia da barra de enderecos ao navegar por um branch.
 */
export function parseRepoUrl(input: string): RepoRef {
  const trimmed = input.trim().replace(/\.git$/, '').replace(/\/+$/, '')

  const shorthand = /^([\w.-]+)\/([\w.-]+)$/.exec(trimmed)
  if (shorthand) return { owner: shorthand[1]!, repo: shorthand[2]! }

  let url: URL
  try {
    url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
  } catch {
    throw new GitHubImportError(`Nao entendi "${input}" como repositorio.`)
  }

  if (!/(^|\.)github\.com$/i.test(url.hostname)) {
    throw new GitHubImportError(
      `Por ora so sei importar do GitHub, e "${url.hostname}" nao e um endereco dele.`,
    )
  }

  const [owner, repo, kind, ...rest] = url.pathname.replace(/^\//, '').split('/')
  if (!owner || !repo) {
    throw new GitHubImportError('A URL precisa apontar para um repositorio: github.com/dono/repo')
  }

  // .../tree/<ref>/... — o ref pode ter barras (feature/x), mas ai nao da para
  // separa-lo do caminho sem consultar a API. O primeiro segmento cobre o caso
  // normal, e um ref invalido devolve 404 com mensagem clara.
  const ref = kind === 'tree' && rest.length > 0 ? rest[0] : undefined
  return { owner, repo, ...(ref !== undefined ? { ref } : {}) }
}

function readRateLimit(response: Response): void {
  const remaining = Number(response.headers.get('x-ratelimit-remaining'))
  const limit = Number(response.headers.get('x-ratelimit-limit'))
  const reset = Number(response.headers.get('x-ratelimit-reset'))
  if (!Number.isFinite(remaining) || !Number.isFinite(limit)) return
  lastRateLimit = {
    remaining,
    limit,
    resetAt: Number.isFinite(reset) ? reset * 1000 : Date.now() + 3_600_000,
    authenticated: token !== null,
  }
}

function rateLimitMessage(): string {
  const info = lastRateLimit
  if (info === null) {
    return 'O GitHub recusou por limite de requisicoes. Sem login ele libera 60 por hora.'
  }
  const minutes = Math.max(1, Math.ceil((info.resetAt - Date.now()) / 60_000))
  const base =
    `O GitHub recusou por limite de requisicoes (${info.limit} por hora). ` +
    `O orcamento renova em ~${minutes} min.`
  return info.authenticated
    ? base
    : `${base} Um token do GitHub nas configuracoes sobe o teto para 5.000 por hora.`
}

async function githubFetch(url: string, etag: string | null): Promise<Response> {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': 'softpet',
  }
  if (token !== null) headers['authorization'] = `Bearer ${token}`
  if (etag !== null) headers['if-none-match'] = etag

  let response: Response
  try {
    response = await fetch(url, { headers })
  } catch (error) {
    throw new GitHubImportError(`Nao consegui falar com o GitHub: ${(error as Error).message}`)
  }

  readRateLimit(response)

  if (response.status === 304) return response
  if (response.status === 401) {
    throw new GitHubImportError('O token do GitHub foi recusado. Confira-o nas configuracoes.')
  }
  if (response.status === 404) {
    throw new GitHubImportError('Repositorio ou branch nao encontrado (404).')
  }
  if (response.status === 403 || response.status === 429) {
    throw new GitHubImportError(rateLimitMessage())
  }
  if (!response.ok) throw new GitHubImportError(`O GitHub respondeu ${response.status}.`)

  return response
}

async function resolveRef(reference: RepoRef): Promise<{ ref: string; description: string | null }> {
  if (reference.ref !== undefined) return { ref: reference.ref, description: null }

  const key = `${reference.owner}/${reference.repo}`
  const cached = defaultBranchCache.get(key)
  if (cached !== undefined) return { ref: cached, description: null }

  const meta = (await (
    await githubFetch(`https://api.github.com/repos/${key}`, null)
  ).json()) as { default_branch?: string; description?: string | null }

  const ref = meta.default_branch ?? 'main'
  defaultBranchCache.set(key, ref)
  return { ref, description: meta.description ?? null }
}

/**
 * Lista os pets do repositorio: toda pasta que contenha `pet.json` junto de uma
 * spritesheet. Nao assume estrutura nenhuma (`pets/<slug>/`, raiz, aninhado) -
 * cada colecao la fora organiza do seu jeito.
 */
export async function listRepoPets(reference: RepoRef): Promise<RepoListing> {
  const { ref, description } = await resolveRef(reference)
  const { owner, repo } = reference
  const key = `${owner}/${repo}@${ref}`

  const cached = listingCache.get(key)
  if (cached !== undefined && Date.now() - cached.at < CACHE_TTL_MS) return cached.listing

  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`
  const response = await githubFetch(url, cached?.etag ?? null)

  // 304: nada mudou desde a ultima vez, e esta resposta nao consumiu orcamento.
  if (response.status === 304 && cached !== undefined) {
    cached.at = Date.now()
    return cached.listing
  }

  const tree = (await response.json()) as {
    tree?: { path?: string; type?: string }[]
    truncated?: boolean
  }

  const blobs = (tree.tree ?? []).filter((node) => node.type === 'blob' && node.path)
  const sheetsByDir = new Map<string, string>()
  const previewsByDir = new Map<string, string>()
  const manifests: string[] = []

  for (const node of blobs) {
    const path = node.path!
    const slash = path.lastIndexOf('/')
    const dir = slash === -1 ? '' : path.slice(0, slash)
    const name = path.slice(slash + 1)

    if (name === 'pet.json') manifests.push(path)
    else if (SHEET_PATTERN.test(name) && !sheetsByDir.has(dir)) sheetsByDir.set(dir, name)
    else if (PREVIEW_PATTERN.test(name) && !previewsByDir.has(dir)) previewsByDir.set(dir, name)
  }

  const join = (dir: string, name: string): string => (dir === '' ? name : `${dir}/${name}`)

  const pets: RepoPetEntry[] = []
  for (const manifestPath of manifests) {
    const slash = manifestPath.lastIndexOf('/')
    const dir = slash === -1 ? '' : manifestPath.slice(0, slash)
    const sheetName = sheetsByDir.get(dir)
    // Sem spritesheet ao lado nao ha pet - normalmente e um `pet.json` de
    // exemplo ou de schema solto no repositorio.
    if (sheetName === undefined) continue

    const previewName = previewsByDir.get(dir)

    pets.push({
      slug: dir === '' ? repo : dir.slice(dir.lastIndexOf('/') + 1),
      dir,
      manifestPath,
      sheetPath: join(dir, sheetName),
      sheetName,
      ...(previewName !== undefined ? { previewPath: join(dir, previewName) } : {}),
    })
  }

  pets.sort((a, b) => a.slug.localeCompare(b.slug))

  const listing: RepoListing = {
    ref: { owner, repo, ref },
    description: description ?? cached?.listing.description ?? null,
    pets,
    truncated: tree.truncated === true,
    rateLimit: lastRateLimit,
  }

  listingCache.set(key, { listing, etag: response.headers.get('etag'), at: Date.now() })
  return listing
}

async function download(url: string): Promise<Uint8Array> {
  // Sem `authorization` de proposito: `raw.githubusercontent.com` nao participa
  // do orcamento da API, e mandar o token aqui so o exporia a mais um host.
  const response = await fetch(url, { headers: { 'user-agent': 'softpet' } })
  if (!response.ok) {
    throw new GitHubImportError(`Nao consegui baixar ${url} (${response.status}).`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

export interface FetchedPet {
  readonly manifestJson: string
  readonly sheet: Uint8Array
  readonly sheetName: string
}

export interface FetchedPreview {
  readonly bytes: Uint8Array
  /** Extensao do arquivo, para o renderer montar o MIME. */
  readonly extension: string
  /**
   * Verdadeiro quando nao havia miniatura e caimos na spritesheet — ai o
   * renderer precisa recortar o primeiro quadro em vez de desenhar a imagem
   * inteira.
   */
  readonly isSheet: boolean
}

/**
 * Baixa a miniatura de um pet do repositorio.
 *
 * Nao consome o orcamento da API: vai por `raw.githubusercontent.com`. O custo e
 * de banda, e varia muito — 6 KB quando o repositorio publica `preview.gif`,
 * ~2 MB quando so ha a spritesheet. Por isso quem chama decide **quando**.
 */
export async function fetchRepoPreview(
  ref: RepoRef & { ref: string },
  entry: RepoPetEntry,
): Promise<FetchedPreview> {
  const path = entry.previewPath ?? entry.sheetPath
  const base = `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${ref.ref}`
  const bytes = await download(`${base}/${path}`)
  return {
    bytes,
    extension: (path.slice(path.lastIndexOf('.') + 1) || 'webp').toLowerCase(),
    isSheet: entry.previewPath === undefined,
  }
}

export async function fetchRepoPet(
  ref: RepoRef & { ref: string },
  entry: RepoPetEntry,
): Promise<FetchedPet> {
  const base = `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${ref.ref}`
  const [manifest, sheet] = await Promise.all([
    download(`${base}/${entry.manifestPath}`),
    download(`${base}/${entry.sheetPath}`),
  ])

  return {
    manifestJson: new TextDecoder().decode(manifest),
    sheet,
    sheetName: entry.sheetName,
  }
}
