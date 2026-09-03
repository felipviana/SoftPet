import { contextBridge, ipcRenderer } from 'electron'

import type {
  DragDirection,
  PetNotification,
  PetPayload,
  Point,
  SoftpetApi,
} from '../shared/ipc.js'
import type {
  InstalledPetInfo,
  CommunityPetInfo,
  PetPreview,
  PetSourceInfo,
  RepoPreviewInfo,
  UrlProbe,
  SettingsApi,
  SettingsState,
  ManualUpdateResult,
} from '../shared/settings-ipc.js'

const api: SoftpetApi = {
  loadPet: () => ipcRenderer.invoke('pet:load') as Promise<PetPayload>,
  setInteractive: (interactive) => ipcRenderer.send('overlay:interactive', interactive),
  dragStart: (offset: Point) => ipcRenderer.send('overlay:drag-start', offset),
  dragEnd: () => ipcRenderer.send('overlay:drag-end'),
  moveBy: (deltaX) => ipcRenderer.send('overlay:move-by', deltaX),
  runAction: (notificationId, actionId) =>
    ipcRenderer.send('overlay:action', notificationId, actionId),

  onPlay: (handler) => {
    ipcRenderer.on('overlay:play', (_event, animation: string) => handler(animation))
  },
  onNotify: (handler) => {
    ipcRenderer.on('overlay:notify', (_event, notification: PetNotification) =>
      handler(notification),
    )
  },
  onDisplaySize: (handler) => {
    ipcRenderer.on('overlay:display-size', (_event, displaySize: number) => handler(displaySize))
  },
  onDragDirection: (handler) => {
    ipcRenderer.on('overlay:drag-direction', (_event, direction: DragDirection) =>
      handler(direction),
    )
  },
  onEdge: (handler) => {
    ipcRenderer.on('overlay:edge', () => handler())
  },
}

contextBridge.exposeInMainWorld('softpet', api)

// A janela de configuracoes usa o mesmo preload, mas outra superficie: o
// overlay nao deve conseguir mexer na biblioteca, nem a de configuracoes se
// passar pelo pet.
const settings: SettingsApi = {
  getState: () => ipcRenderer.invoke('settings:state') as Promise<SettingsState>,
  listPets: () => ipcRenderer.invoke('settings:list-pets') as Promise<InstalledPetInfo[]>,
  getPreview: (id) => ipcRenderer.invoke('settings:preview', id) as Promise<PetPreview>,
  activate: (id) => ipcRenderer.invoke('settings:activate', id) as Promise<void>,
  remove: (id) => ipcRenderer.invoke('settings:remove', id) as Promise<void>,

  importFolder: () =>
    ipcRenderer.invoke('settings:import-folder') as Promise<InstalledPetInfo | null>,
  importZip: () => ipcRenderer.invoke('settings:import-zip') as Promise<InstalledPetInfo | null>,
  probeUrl: (url) => ipcRenderer.invoke('settings:probe-url', url) as Promise<UrlProbe>,
  getRepoPreview: (url, slug) =>
    ipcRenderer.invoke('settings:repo-preview', url, slug) as Promise<RepoPreviewInfo>,
  cacheRepoThumb: (url, slug, png) =>
    ipcRenderer.invoke('settings:cache-thumb', url, slug, png) as Promise<void>,
  listSources: () => ipcRenderer.invoke('settings:list-sources') as Promise<PetSourceInfo[]>,
  addSource: (url) => ipcRenderer.invoke('settings:add-source', url) as Promise<PetSourceInfo[]>,
  removeSource: (url) =>
    ipcRenderer.invoke('settings:remove-source', url) as Promise<PetSourceInfo[]>,
  importFromRepo: (url, slug) =>
    ipcRenderer.invoke('settings:import-repo', url, slug) as Promise<InstalledPetInfo>,
  importFromPetdex: (slug) =>
    ipcRenderer.invoke('settings:import-petdex', slug) as Promise<InstalledPetInfo>,
  importFromUrl: (url) =>
    ipcRenderer.invoke('settings:import-url', url) as Promise<InstalledPetInfo>,
  listCommunityPets: () =>
    ipcRenderer.invoke('settings:community-list') as Promise<CommunityPetInfo[]>,
  getCommunityPreview: (id) =>
    ipcRenderer.invoke('settings:community-preview', id) as Promise<PetPreview>,
  installCommunityPet: (id) =>
    ipcRenderer.invoke('settings:community-install', id) as Promise<InstalledPetInfo>,
  checkCommunityPetName: (name) =>
    ipcRenderer.invoke('settings:community-name-available', name) as Promise<boolean>,
  submitCommunityPet: (petName, authorName) =>
    ipcRenderer.invoke('settings:community-submit', petName, authorName) as Promise<boolean>,

  setDisplaySize: (size) => ipcRenderer.send('settings:display-size', size),
  toggleFreeRoam: () => ipcRenderer.invoke('settings:toggle-free-roam') as Promise<boolean>,
  toggleOverlay: () => ipcRenderer.invoke('settings:toggle-overlay') as Promise<boolean>,
  restartPet: () => ipcRenderer.invoke('settings:restart-pet') as Promise<boolean>,
  checkForUpdates: () =>
    ipcRenderer.invoke('settings:check-updates') as Promise<ManualUpdateResult>,
  playAnimation: (name) => ipcRenderer.send('settings:play', name),
  fireNotification: (id) => ipcRenderer.send('settings:notify', id),
  setGitHubToken: (value) =>
    ipcRenderer.invoke('settings:set-github-token', value) as Promise<void>,
  openLibraryFolder: () => ipcRenderer.send('settings:open-library'),
  quit: () => ipcRenderer.send('settings:quit'),
}

contextBridge.exposeInMainWorld('softpetSettings', settings)

// A lista muda por importacao, remocao e troca de pet ativo; a janela recarrega
// em vez de tentar adivinhar o que mudou.
contextBridge.exposeInMainWorld('softpetOnChanged', (handler: () => void) => {
  ipcRenderer.on('settings:changed', () => handler())
})
