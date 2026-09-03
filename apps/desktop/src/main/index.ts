import { app, dialog, ipcMain, shell, type Tray } from 'electron'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { DISPLAY_SIZE } from '@softpet/pet-format'

import type {
  InstalledPetInfo,
  PetPreview,
  RepoListingInfo,
  RepoPreviewInfo,
  SettingsState,
  UrlProbe,
} from '../shared/settings-ipc.js'
import { DEBUG_NOTIFICATIONS } from './debug-notifications.js'
import {
  clearGitHubCache,
  fetchRepoPet,
  getRateLimit,
  listRepoPets,
  fetchRepoPreview,
  parseRepoUrl,
  setGitHubToken,
} from './import/github.js'
import { fetchDirectPet, isDirectFileUrl } from './import/direct.js'
import { fetchPetdexPet, parsePetdexSlug } from './import/petdex.js'
import { prunePreviewCache, readThumb, writeThumb } from './import/preview-cache.js'
import { findPetInZip, readZip } from './import/zip.js'
import { OverlayWindow } from './overlay-window.js'
import {
  installFromDirectory,
  libraryDir,
  installFromFiles,
  listInstalled,
  removeInstalled,
  type InstalledPet,
} from './pet-library.js'
import { labelForUrl, mergeSources, sourceKey } from './pet-sources.js'
import { loadPet, type LoadedPet } from './pet-loader.js'
import { SettingsWindow } from './settings-window.js'
import { SettingsStore } from './store.js'
import { createTray } from './tray.js'
import { checkForUpdatesManually, startAutoUpdate } from './auto-update.js'
import {
  CommunityError,
  communityFiles,
  communityPreview,
  isCommunityPetNameAvailable,
  listCommunityPets,
  submitCommunityPet,
} from './community.js'

// Uma segunda instancia significaria dois pets na tela disputando a mesma
// posicao salva.
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

app.setAppUserModelId('dev.softpet.app')

let store: SettingsStore
let pet: LoadedPet | null = null
let overlay: OverlayWindow | null = null
let tray: Tray | null = null
const settingsWindow = new SettingsWindow()

/** `--pet=<dir>` permite apontar um bundle sem mexer nas preferencias. */
function petPathFromArgv(): string | null {
  const flag = process.argv.find((argument) => argument.startsWith('--pet='))
  return flag ? flag.slice('--pet='.length) : null
}

async function askForPetDirectory(): Promise<string | null> {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Escolha a pasta do bundle do pet',
    message: 'Selecione a pasta que contem o pet.json e a spritesheet.',
    properties: ['openDirectory'],
  })
  return canceled ? null : (filePaths[0] ?? null)
}

/**
 * Resolve o pet inicial: linha de comando, preferencias ou primeiro da
 * biblioteca. Uma biblioteca vazia e um estado valido: nesse caso o menu abre
 * sem overlay para o usuario escolher um pet na lojinha ou importa-lo depois.
 */
async function resolveInitialPet(): Promise<LoadedPet | null> {
  const installed = await listInstalled()
  const salvo = store.get("activePetId")
  const candidate =
    petPathFromArgv() ??
    installed.find((entry) => entry.id === salvo)?.dir ??
    installed[0]?.dir ??
    null

  if (candidate === null) return null

  try {
    return await loadPet(candidate)
  } catch (error) {
    await dialog.showMessageBox({
      type: 'error',
      title: 'Nao foi possivel carregar o pet',
      message: (error as Error).message,
      detail: 'O Softpet sera aberto sem um pet ativo para voce escolher outro no menu.',
      buttons: ['Abrir o menu'],
    })
    return null
  }
}

/**
 * Traz para a biblioteca um pet que veio de fora dela.
 *
 * A biblioteca precisa ser a fonte unica: um pet aberto de uma pasta qualquer
 * (por `--pet`, ou pelo seletor de pasta) apareceria na tela mas nao na lista, e
 * o usuario veria "pet ativo: nenhum" com o bicho andando na frente dele. Alem
 * disso, a pasta de origem pode sumir; a copia na biblioteca, nao.
 */
async function ensureInLibrary(loaded: LoadedPet): Promise<LoadedPet> {
  const root = libraryDir()
  if (resolve(loaded.dir).startsWith(resolve(root))) return loaded

  try {
    const installed = await installFromDirectory(loaded.dir)
    store.set("activePetId", installed.id)
    return await loadPet(installed.dir)
  } catch (error) {
    // Nao conseguir copiar nao pode impedir o pet de aparecer; ele so nao
    // constara da biblioteca ate ser importado de novo.
    console.warn('[softpet] nao consegui trazer o pet para a biblioteca:', error)
    return loaded
  }
}

/**
 * Troca o pet ativo. A janela do overlay e recriada porque o tamanho do palco
 * deriva do frame do pet, e o frame muda entre pets — 156x180 num bundle do
 * Orca, 192x208 num do acervo do Codex.
 */
async function setActivePet(dir: string): Promise<void> {
  const loaded = await loadPet(dir)
  pet = loaded
  store.set("activePetId", loaded.manifest.id)

  overlay?.destroy()
  overlay = new OverlayWindow(store, loaded.manifest.frame)

  tray?.destroy()
  tray = createTray(loaded, () => settingsWindow.open())

  settingsWindow.notifyChanged()
}

/** Rele os arquivos do pet e substitui apenas a janela transparente. */
async function restartActivePet(): Promise<boolean> {
  if (pet === null) return false

  const reloaded = await loadPet(pet.dir)
  overlay?.destroy()
  pet = reloaded
  overlay = new OverlayWindow(store, reloaded.manifest.frame)
  return true
}

function toInfo(entry: InstalledPet, activeId: string | null): InstalledPetInfo {
  return {
    id: entry.id,
    displayName: entry.displayName,
    ...(entry.description !== undefined ? { description: entry.description } : {}),
    layoutSource: entry.layoutSource,
    animations: entry.animations,
    ...(entry.origin !== undefined ? { origin: entry.origin } : {}),
    active: entry.id === activeId,
  }
}

/** Chave do cache de miniatura: repositorio + revisao + pet. */
function thumbKey(ref: { owner: string; repo: string; ref: string }, slug: string): string {
  return `${ref.owner}-${ref.repo}-${ref.ref}-${slug}`
}

async function dirOf(id: string): Promise<string> {
  const found = (await listInstalled()).find((entry) => entry.id === id)
  if (found === undefined) throw new Error(`O pet "${id}" nao esta na biblioteca.`)
  return found.dir
}

function registerOverlayIpc(): void {
  ipcMain.handle('pet:load', () => {
    if (pet === null) throw new Error('Nenhum pet carregado.')
    return {
      manifest: pet.manifest,
      sheet: pet.sheet,
      sheetFormat: pet.sheetFormat,
      sheetWidth: pet.sheetWidth,
      sheetHeight: pet.sheetHeight,
      displaySize: overlay?.displaySize ?? store.get('displaySize'),
    }
  })

  ipcMain.on('overlay:interactive', (_event, interactive: unknown) => {
    overlay?.setInteractive(interactive === true)
  })

  ipcMain.on('overlay:drag-start', (_event, offset: unknown) => {
    if (isPoint(offset)) overlay?.dragStart(offset)
  })

  ipcMain.on('overlay:drag-end', () => overlay?.dragEnd())

  ipcMain.on('overlay:move-by', (_event, deltaX: unknown) => {
    if (typeof deltaX === 'number' && Number.isFinite(deltaX)) {
      overlay?.moveAutonomouslyBy(deltaX)
    }
  })

  ipcMain.on('overlay:action', (_event, notificationId: unknown, actionId: unknown) => {
    // Por ora, registrar basta para confirmar que o clique no balao chega ate
    // aqui; quem consumir o evento decide o que fazer com ele.
    console.log('[softpet] acao do balao:', notificationId, actionId)
  })
}

function registerSettingsIpc(): void {
  ipcMain.handle(
    'settings:state',
    (): SettingsState => ({
      activePetId: pet?.manifest.id ?? null,
      displaySize: store.get('displaySize'),
      displaySizeRange: { min: DISPLAY_SIZE.min, max: DISPLAY_SIZE.max },
      freeRoam: store.get('freeRoam'),
      overlayVisible: overlay?.isVisible ?? false,
      animations: pet === null ? [] : Object.keys(pet.manifest.animations).sort(),
      debugNotifications: DEBUG_NOTIFICATIONS.map((entry) => ({
        id: entry.id,
        label: entry.menuLabel,
      })),
      githubTokenSet: store.get('githubToken') !== null,
      rateLimit: getRateLimit(),
    }),
  )

  ipcMain.handle('settings:set-github-token', (_event, value: unknown) => {
    const trimmed = typeof value === 'string' ? value.trim() : ''
    store.set('githubToken', trimmed === '' ? null : trimmed)
    setGitHubToken(trimmed === '' ? null : trimmed)
    // O cache guarda respostas obtidas com o teto antigo; comecar limpo evita
    // servir uma listagem velha como se fosse do token novo.
    clearGitHubCache()
  })

  ipcMain.handle('settings:list-pets', async () => {
    const activeId = store.get("activePetId")
    return (await listInstalled()).map((entry) => toInfo(entry, activeId))
  })

  ipcMain.handle('settings:preview', async (_event, id: string): Promise<PetPreview> => {
    const loaded = await loadPet(await dirOf(id))
    return { sheet: loaded.sheet, sheetFormat: loaded.sheetFormat, frame: loaded.manifest.frame }
  })

  ipcMain.handle('settings:activate', async (_event, id: string) => {
    await setActivePet(await dirOf(id))
  })

  ipcMain.handle('settings:remove', async (_event, id: string) => {
    await removeInstalled(id)
    settingsWindow.notifyChanged()
  })

  ipcMain.handle('settings:import-folder', async (): Promise<InstalledPetInfo | null> => {
    const dir = await askForPetDirectory()
    if (dir === null) return null
    const installed = await installFromDirectory(dir)
    settingsWindow.notifyChanged()
    return toInfo(installed, store.get("activePetId"))
  })

  ipcMain.handle('settings:import-zip', async (): Promise<InstalledPetInfo | null> => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Escolha o arquivo do pet',
      filters: [{ name: 'Pet compactado', extensions: ['zip', 'codex-pet'] }],
      properties: ['openFile'],
    })
    const file = canceled ? null : (filePaths[0] ?? null)
    if (file === null) return null

    const found = findPetInZip(readZip(await readFile(file)))
    const installed = await installFromFiles(
      found.slug,
      { manifestJson: found.manifestJson, sheet: found.sheet, sheetName: found.sheetName },
      file,
    )
    settingsWindow.notifyChanged()
    return toInfo(installed, store.get("activePetId"))
  })

  ipcMain.handle('settings:list-sources', () => mergeSources(store.get('petSources')))

  ipcMain.handle('settings:add-source', (_event, url: string) => {
    const trimmed = url.trim()
    if (trimmed === '') throw new Error('Informe o link da fonte.')

    const key = sourceKey(trimmed)
    const current = store.get('petSources')
    // Ja embutida ou ja salva: nao duplica, so devolve a lista como esta.
    if (!mergeSources(current).some((source) => sourceKey(source.url) === key)) {
      store.set('petSources', [...current, { label: labelForUrl(trimmed), url: trimmed }])
    }
    return mergeSources(store.get('petSources'))
  })

  ipcMain.handle('settings:remove-source', (_event, url: string) => {
    const key = sourceKey(url)
    store.set(
      'petSources',
      store.get('petSources').filter((source) => sourceKey(source.url) !== key),
    )
    return mergeSources(store.get('petSources'))
  })

  ipcMain.handle('settings:probe-url', async (_event, url: string): Promise<UrlProbe> => {
    const slug = parsePetdexSlug(url)
    if (slug !== null) return { kind: 'petdex', slug }
    // Antes do ramo de repositorio: um link do GitHub pode apontar para um
    // arquivo solto (um zip de release, um pet.json cru) em vez do repositorio.
    if (isDirectFileUrl(url)) {
      return { kind: 'file', url: url.trim(), label: url.trim().split('/').at(-1) ?? 'arquivo' }
    }
    return { kind: 'repo', listing: await listRepo(url) }
  })

  ipcMain.handle('settings:import-url', async (_event, url: string) => {
    const files = await fetchDirectPet(url)
    const installed = await installFromFiles(files.slug, files, url.trim())
    settingsWindow.notifyChanged()
    return toInfo(installed, store.get("activePetId"))
  })

  ipcMain.handle('settings:import-petdex', async (_event, slug: string) => {
    const files = await fetchPetdexPet(slug)
    const installed = await installFromFiles(slug, files, `https://petdex.dev/pets/${slug}`)
    settingsWindow.notifyChanged()
    return toInfo(installed, store.get("activePetId"))
  })

  ipcMain.handle(
    'settings:repo-preview',
    async (_event, url: string, slug: string): Promise<RepoPreviewInfo> => {
      // Do cache da listagem: nao gasta orcamento da API.
      const listing = await listRepoPets(parseRepoUrl(url))
      const entry = listing.pets.find((candidate) => candidate.slug === slug)
      if (entry === undefined) throw new Error(`"${slug}" nao esta neste repositorio.`)

      // Miniatura ja reduzida em cache: 96x96 em PNG, pronta para desenhar
      // inteira. O arquivo de origem nao volta a ser baixado.
      const cached = await readThumb(thumbKey(listing.ref, slug))
      if (cached !== null) return { bytes: cached, extension: 'png', isSheet: false }

      const fetched = await fetchRepoPreview(listing.ref, entry)
      return { bytes: fetched.bytes, extension: fetched.extension, isSheet: fetched.isSheet }
    },
  )

  // O renderer devolve a miniatura que acabou de desenhar; e ele que sabe
  // decodificar WebP e recortar o quadro, entao a reducao acontece la.
  ipcMain.handle(
    'settings:cache-thumb',
    async (_event, url: string, slug: string, bytes: Uint8Array) => {
      const listing = await listRepoPets(parseRepoUrl(url))
      await writeThumb(thumbKey(listing.ref, slug), bytes)
    },
  )

  ipcMain.handle('settings:import-repo', async (_event, url: string, slug: string) => {
    // Serve do cache da listagem que o usuario acabou de ver: importar N pets
    // nao custa nenhuma chamada de API alem da que produziu a lista.
    const listing = await listRepoPets(parseRepoUrl(url))
    const entry = listing.pets.find((candidate) => candidate.slug === slug)
    if (entry === undefined) throw new Error(`"${slug}" nao esta neste repositorio.`)

    const files = await fetchRepoPet(listing.ref, entry)
    const { owner, repo, ref } = listing.ref
    const origin = `https://github.com/${owner}/${repo}/tree/${ref}/${entry.dir}`
    const installed = await installFromFiles(entry.slug, files, origin)
    settingsWindow.notifyChanged()
    return toInfo(installed, store.get("activePetId"))
  })

  ipcMain.on('settings:display-size', (_event, size: unknown) => {
    if (typeof size === 'number' && Number.isFinite(size)) overlay?.setDisplaySize(size)
  })

  ipcMain.handle('settings:community-list', () => listCommunityPets())

  ipcMain.handle('settings:community-preview', (_event, id: string) => communityPreview(id))

  ipcMain.handle('settings:community-install', async (_event, id: string) => {
    const { row, files } = await communityFiles(id)
    const installed = await installFromFiles(
      row.slug,
      files,
      `Comunidade Soft — ${row.author_name}`,
    )
    settingsWindow.notifyChanged()
    return toInfo(installed, store.get('activePetId'))
  })

  ipcMain.handle('settings:community-name-available', (_event, name: unknown) =>
    isCommunityPetNameAvailable(typeof name === 'string' ? name : ''),
  )

  ipcMain.handle('settings:community-submit', async (_event, petName: unknown, authorName: unknown) => {
    const normalizedName = typeof petName === 'string' ? petName.trim() : ''
    if (normalizedName === '') throw new CommunityError('Informe o nome do seu pet.')
    const dir = await askForPetDirectory()
    if (dir === null) return false
    await submitCommunityPet(
      dir,
      normalizedName,
      typeof authorName === 'string' ? authorName : '',
      store.get('installationId'),
    )
    return true
  })

  ipcMain.handle('settings:toggle-free-roam', () => {
    const enabled = !store.get('freeRoam')
    store.set('freeRoam', enabled)
    return enabled
  })

  ipcMain.handle('settings:toggle-overlay', () => overlay?.toggleVisibility() ?? false)

  ipcMain.handle('settings:restart-pet', () => restartActivePet())

  ipcMain.handle('settings:check-updates', () => checkForUpdatesManually())

  ipcMain.on('settings:play', (_event, name: unknown) => {
    if (typeof name === 'string') overlay?.play(name)
  })

  ipcMain.on('settings:notify', (_event, id: unknown) => {
    const found = DEBUG_NOTIFICATIONS.find((entry) => entry.id === id)
    if (found === undefined) return
    const { menuLabel: _label, ...notification } = found
    overlay?.notify(notification)
  })

  ipcMain.on('settings:open-library', () => {
    // A dica "copie um pet que voce ja tem" so e util se der para chegar na
    // pasta; achar o %APPDATA% a mao nao e algo que se peca a um leigo.
    void shell.openPath(libraryDir())
  })

  ipcMain.on('settings:quit', () => app.quit())
}

async function listRepo(url: string): Promise<RepoListingInfo> {
  const listing = await listRepoPets(parseRepoUrl(url))
  return {
    owner: listing.ref.owner,
    repo: listing.ref.repo,
    ref: listing.ref.ref,
    description: listing.description,
    pets: listing.pets.map((entry) => ({ slug: entry.slug, dir: entry.dir })),
    truncated: listing.truncated,
  }
}

function isPoint(value: unknown): value is { x: number; y: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    Number.isFinite((value as { x: unknown }).x) &&
    Number.isFinite((value as { y: unknown }).y)
  )
}

app.whenReady().then(async () => {
  store = new SettingsStore()

  registerOverlayIpc()
  registerSettingsIpc()

  setGitHubToken(store.get('githubToken'))
  void prunePreviewCache()

  const initial = await resolveInitialPet()
  if (initial !== null) {
    const active = await ensureInLibrary(initial)
    pet = active
    overlay = new OverlayWindow(store, active.manifest.frame)
  }

  tray = createTray(pet, () => settingsWindow.open())
  settingsWindow.open()
  startAutoUpdate()

  if (process.argv.includes('--demo')) startDemo()
})

/**
 * `--demo` dispara as notificacoes de mentira em sequencia, sem depender de
 * alguem abrir as configuracoes. Serve para conferir o balao e a maquina de
 * prioridade, e para mostrar o pet funcionando a quem nunca o viu.
 */
function startDemo(): void {
  let next = 0
  const fire = (): void => {
    const { menuLabel: _label, ...notification } = DEBUG_NOTIFICATIONS[next]!
    next = (next + 1) % DEBUG_NOTIFICATIONS.length
    overlay?.notify(notification)
  }
  setTimeout(fire, 6_000)
  setInterval(fire, 20_000)
}

// O pet vive na bandeja: fechar a janela de configuracoes nao encerra o app.
app.on('window-all-closed', () => {})

app.on('before-quit', () => {
  store?.flush()
  overlay?.destroy()
  settingsWindow.close()
  tray?.destroy()
})
