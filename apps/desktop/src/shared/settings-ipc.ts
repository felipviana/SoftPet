import type { FrameSize, ImageFormat } from '@softpet/pet-format'

export interface InstalledPetInfo {
  readonly id: string
  readonly displayName: string
  readonly description?: string
  /** `codex-defaults` = o `pet.json` nao declarava layout e assumimos o padrao do Codex. */
  readonly layoutSource: 'declared' | 'codex-defaults'
  readonly animations: readonly string[]
  readonly origin?: string
  readonly active: boolean
}

/** O bastante para desenhar o primeiro quadro do pet numa miniatura. */
export interface PetPreview {
  readonly sheet: Uint8Array
  readonly sheetFormat: ImageFormat
  readonly frame: FrameSize
}

/** Bytes de uma miniatura de repositorio, ja resolvida entre preview e folha. */
export interface RepoPreviewInfo {
  readonly bytes: Uint8Array
  readonly extension: string
  /** Veio da spritesheet: o renderer precisa recortar o primeiro quadro. */
  readonly isSheet: boolean
}

export interface RepoPetInfo {
  readonly slug: string
  readonly dir: string
}

export interface RepoListingInfo {
  readonly owner: string
  readonly repo: string
  readonly ref: string
  readonly description: string | null
  readonly pets: readonly RepoPetInfo[]
  /** A arvore veio truncada: o repositorio passou do limite da API do GitHub. */
  readonly truncated: boolean
}

/**
 * O que um link colado acabou sendo.
 *
 * Sao tres mundos, porque o acervo publico se distribui de tres jeitos:
 *
 * - **repo**: colecoes em git commitam os bundles, entao da para listar e
 *   escolher;
 * - **petdex**: a API de listagem exige login, entao e um pet por vez;
 * - **file**: galerias sem API nenhuma, que so oferecem um `.zip` para baixar
 *   na pagina do pet. Aqui o usuario cola o endereco do arquivo, e isso
 *   funciona em qualquer site sem precisarmos conhece-lo.
 */
export type UrlProbe =
  | { readonly kind: 'file'; readonly url: string; readonly label: string }
  | { readonly kind: 'repo'; readonly listing: RepoListingInfo }
  | { readonly kind: 'petdex'; readonly slug: string }

/** Orcamento da API do GitHub, para a interface avisar antes de acabar. */
export interface RateLimitInfo {
  readonly remaining: number
  readonly limit: number
  readonly resetAt: number
  readonly authenticated: boolean
}

/** Uma fonte da Lojinha de pets. */
export interface PetSourceInfo {
  readonly label: string
  readonly url: string
  /** Embutida no app: nao pode ser removida. */
  readonly builtin: boolean
}

export interface DebugNotificationInfo {
  readonly id: string
  readonly label: string
}

export interface CommunityPetInfo {
  readonly id: string
  readonly slug: string
  readonly displayName: string
  readonly description?: string
  readonly authorName: string
  readonly downloads: number
  readonly createdAt: string
}

export type ManualUpdateResult =
  | { readonly status: 'development'; readonly currentVersion: string }
  | { readonly status: 'up-to-date'; readonly currentVersion: string }
  | {
      readonly status: 'available'
      readonly currentVersion: string
      readonly availableVersion: string
    }

export interface SettingsState {
  readonly activePetId: string | null
  readonly displaySize: number
  readonly displaySizeRange: { readonly min: number; readonly max: number }
  readonly freeRoam: boolean
  readonly overlayVisible: boolean
  /** Animacoes que o pet ativo conhece, para o painel de depuracao. */
  readonly animations: readonly string[]
  readonly debugNotifications: readonly DebugNotificationInfo[]
  readonly githubTokenSet: boolean
  readonly rateLimit: RateLimitInfo | null
}

/** Exposto como `window.softpetSettings` na janela de configuracoes. */
export interface SettingsApi {
  getState(): Promise<SettingsState>
  listPets(): Promise<InstalledPetInfo[]>
  getPreview(id: string): Promise<PetPreview>
  activate(id: string): Promise<void>
  remove(id: string): Promise<void>

  /** Abre o seletor de pasta. `null` quando o usuario desiste. */
  importFolder(): Promise<InstalledPetInfo | null>
  /** Abre o seletor de arquivo `.zip`. `null` quando o usuario desiste. */
  importZip(): Promise<InstalledPetInfo | null>
  listSources(): Promise<PetSourceInfo[]>
  /** Acrescenta uma fonte a Lojinha. Devolve a lista atualizada. */
  addSource(url: string): Promise<PetSourceInfo[]>
  removeSource(url: string): Promise<PetSourceInfo[]>
  /** Descobre o que o link e: colecao em git ou um pet do petdex. */
  probeUrl(url: string): Promise<UrlProbe>
  /** Miniatura de um pet do repositorio, carregada sob demanda. */
  getRepoPreview(url: string, slug: string): Promise<RepoPreviewInfo>
  /** Devolve a miniatura reduzida para o cache em disco. */
  cacheRepoThumb(url: string, slug: string, png: Uint8Array): Promise<void>
  importFromRepo(url: string, slug: string): Promise<InstalledPetInfo>
  importFromPetdex(slug: string): Promise<InstalledPetInfo>
  /** Link direto para um .zip ou um pet.json, de qualquer site. */
  importFromUrl(url: string): Promise<InstalledPetInfo>

  listCommunityPets(): Promise<CommunityPetInfo[]>
  getCommunityPreview(id: string): Promise<PetPreview>
  installCommunityPet(id: string): Promise<InstalledPetInfo>
  checkCommunityPetName(name: string): Promise<boolean>
  /** Seleciona, valida e envia uma pasta. `false` quando o usuario cancela. */
  submitCommunityPet(petName: string, authorName: string): Promise<boolean>

  setDisplaySize(size: number): void
  toggleFreeRoam(): Promise<boolean>
  toggleOverlay(): Promise<boolean>
  /** Recarrega os arquivos e recria a janela do pet ativo. */
  restartPet(): Promise<boolean>
  checkForUpdates(): Promise<ManualUpdateResult>
  playAnimation(name: string): void
  fireNotification(id: string): void
  /** Token pessoal do GitHub; vazio remove. */
  setGitHubToken(token: string): Promise<void>
  /** Abre a pasta da biblioteca no explorador de arquivos. */
  openLibraryFolder(): void
  quit(): void
}

declare global {
  interface Window {
    softpetSettings: SettingsApi
    /** Avisa que a biblioteca ou o pet ativo mudaram; a janela recarrega. */
    softpetOnChanged: (handler: () => void) => void
  }
}

