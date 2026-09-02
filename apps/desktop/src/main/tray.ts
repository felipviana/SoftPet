import { app, Menu, Tray, nativeImage, type NativeImage } from 'electron'

import type { LoadedPet } from './pet-loader.js'

/**
 * Icone da bandeja recortado do proprio pet.
 *
 * Evita carregar um asset so para isso e, de quebra, o icone identifica qual
 * pet esta ativo — util quando houver um por funcionario, e util agora que da
 * para trocar de pet sem reiniciar.
 */
function trayIcon(pet: LoadedPet): NativeImage {
  const { width, height } = pet.manifest.frame
  const side = Math.round(Math.min(width, height) * 0.55)

  try {
    return nativeImage
      .createFromBuffer(Buffer.from(pet.sheet))
      .crop({
        x: Math.round((width - side) / 2),
        y: Math.round(height * 0.04),
        width: side,
        height: side,
      })
      .resize({ width: 16, height: 16, quality: 'best' })
  } catch {
    // `createFromBuffer` so entende PNG e JPEG; um pet com folha WebP cai aqui,
    // e a maioria do acervo publico e WebP. Um icone vazio ainda produz uma
    // entrada clicavel — sem ela nao haveria como abrir as configuracoes nem
    // fechar o app.
    return nativeImage.createEmpty()
  }
}

/**
 * A bandeja e so um atalho: clicar abre as configuracoes, onde fica tudo.
 *
 * O menu de contexto ficou com o minimo indispensavel. Um menu de bandeja nao
 * da conta de escolher entre milhares de pets de um repositorio — isso pede
 * lista, busca e miniatura, e por isso virou janela.
 */
export function createTray(pet: LoadedPet | null, openSettings: () => void): Tray {
  const tray = new Tray(pet === null ? nativeImage.createEmpty() : trayIcon(pet))
  tray.setToolTip(pet === null ? 'Softpet — escolha seu pet' : `${pet.manifest.displayName} — Softpet`)

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: pet?.manifest.displayName ?? 'Nenhum pet selecionado', enabled: false },
      { type: 'separator' },
      { label: 'Configuracoes do pet', click: openSettings },
      { type: 'separator' },
      { label: 'Sair', click: () => app.quit() },
    ]),
  )

  tray.on('click', openSettings)
  tray.on('double-click', openSettings)

  return tray
}
