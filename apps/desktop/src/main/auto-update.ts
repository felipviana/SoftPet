import { app, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'

import type { ManualUpdateResult } from '../shared/settings-ipc.js'

const CHECK_INTERVAL = 4 * 60 * 60 * 1_000

/** Verificacao iniciada pelo usuario no menu do aplicativo. */
export async function checkForUpdatesManually(): Promise<ManualUpdateResult> {
  const currentVersion = app.getVersion()
  if (!app.isPackaged) return { status: 'development', currentVersion }

  const result = await autoUpdater.checkForUpdates()
  if (result === null || !result.isUpdateAvailable) {
    return { status: 'up-to-date', currentVersion }
  }

  return {
    status: 'available',
    currentVersion,
    availableVersion: result.updateInfo.version,
  }
}

/**
 * Mantem o executavel sincronizado com a release publica mais recente.
 *
 * O electron-updater usa o `latest.yml` publicado junto do instalador pelo
 * electron-builder. Em desenvolvimento nao ha esse arquivo nem um app
 * empacotado, portanto a verificacao so existe na versao distribuida.
 */
export function startAutoUpdate(): void {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-downloaded', (info) => {
    void dialog
      .showMessageBox({
        type: 'info',
        title: 'Atualizacao pronta',
        message: `A versao ${info.version} do Softpet ja foi baixada.`,
        detail: 'Reinicie agora para instalar. Se preferir continuar, a atualizacao sera instalada ao fechar o aplicativo.',
        buttons: ['Reiniciar e instalar', 'Depois'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall(false, true)
      })
  })

  autoUpdater.on('error', (error) => {
    // Falha de rede ou GitHub indisponivel nao deve interromper o pet. Uma nova
    // tentativa acontece no proximo intervalo ou na proxima inicializacao.
    console.warn('[softpet] nao foi possivel verificar atualizacoes:', error.message)
  })

  const check = (): void => {
    void autoUpdater.checkForUpdates().catch(() => {
      // O evento `error` acima registra o diagnostico sem incomodar o usuario.
    })
  }

  // Da tempo para a janela principal aparecer antes de iniciar a requisicao.
  setTimeout(check, 3_000)
  setInterval(check, CHECK_INTERVAL)
}
