import { BrowserWindow } from 'electron'
import { join } from 'node:path'

const isDev = !!process.env['ELECTRON_RENDERER_URL']

/**
 * A janela de configuracoes: pet ativo, biblioteca, importacao e depuracao.
 *
 * Substituiu o menu da bandeja como superficie principal. Um menu de bandeja da
 * conta de "mostrar/ocultar" e "sair", mas nao de escolher entre milhares de
 * pets de um repositorio — isso pede lista, busca e miniatura.
 *
 * Diferente do overlay, esta e uma janela comum: com moldura, focavel e
 * clicavel. So existe uma; pedir de novo traz a que ja esta aberta para a
 * frente em vez de abrir outra.
 */
export class SettingsWindow {
  #window: BrowserWindow | null = null

  open(): void {
    if (this.#window !== null && !this.#window.isDestroyed()) {
      if (this.#window.isMinimized()) this.#window.restore()
      this.#window.focus()
      return
    }

    const window = new BrowserWindow({
      width: 960,
      height: 680,
      minWidth: 720,
      minHeight: 520,
      title: 'Configuracoes do pet',
      backgroundColor: '#151a22',
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })

    window.once('ready-to-show', () => window.show())
    window.on('closed', () => {
      this.#window = null
    })

    if (isDev) {
      void window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/settings/index.html`)
    } else {
      void window.loadFile(join(__dirname, '../renderer/settings/index.html'))
    }

    this.#window = window
  }

  /** Avisa a janela para recarregar a lista depois de uma importacao ou troca. */
  notifyChanged(): void {
    if (this.#window === null || this.#window.isDestroyed()) return
    this.#window.webContents.send('settings:changed')
  }

  close(): void {
    if (this.#window !== null && !this.#window.isDestroyed()) this.#window.destroy()
    this.#window = null
  }
}
