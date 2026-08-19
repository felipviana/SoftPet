import { app } from 'electron'
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Cache em disco das miniaturas de repositorio.
 *
 * Guarda a **miniatura ja reduzida**, nunca o arquivo de origem. A distincao
 * vale ordens de grandeza: no `awesome-codex-pet` nao ha `preview.gif`, entao a
 * miniatura sai da spritesheet de ~2 MB — guardar essas seriam ~200 MB de disco
 * por maquina para desenhar quadradinhos de 44 px. Reduzida a 96x96 PNG, cada
 * uma cai para poucos KB.
 *
 * Quem reduz e o renderer (e ele que sabe decodificar WebP e recortar o
 * quadro); aqui so recebemos o resultado. O arquivo original e baixado uma vez,
 * usado, e descartado.
 */

/** Miniaturas de poucos KB: 20 MB comporta milhares. */
const MAX_BYTES = 20 * 1024 * 1024

function cacheDir(): string {
  return join(app.getPath('userData'), 'cache', 'previews')
}

/** Nome de arquivo inofensivo derivado da chave. */
function fileFor(key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9._@-]+/g, '-').slice(0, 120)
  return join(cacheDir(), `${safe}.png`)
}

export async function readThumb(key: string): Promise<Uint8Array | null> {
  try {
    return await readFile(fileFor(key))
  } catch {
    return null
  }
}

export async function writeThumb(key: string, bytes: Uint8Array): Promise<void> {
  try {
    await mkdir(cacheDir(), { recursive: true })
    await writeFile(fileFor(key), bytes)
  } catch (error) {
    // Cache e otimizacao: falhar em gravar nao pode quebrar a navegacao.
    console.warn('[softpet] nao consegui gravar a miniatura em cache:', error)
  }
}

/**
 * Poda o cache quando ele passa do teto, do mais antigo para o mais novo.
 *
 * Chamado uma vez na inicializacao, e nao a cada gravacao: percorrer o
 * diretorio no meio de uma rolagem de lista atrapalharia justamente o momento
 * em que as miniaturas estao sendo buscadas.
 */
export async function prunePreviewCache(): Promise<void> {
  try {
    const dir = cacheDir()
    const names = await readdir(dir)

    // Qualquer coisa que nao seja `.png` e de uma versao anterior do cache, que
    // guardava o arquivo de origem. `readThumb` nunca vai encontra-las, entao
    // sao peso morto — e justamente as maiores.
    for (const name of names.filter((name) => !name.endsWith('.png'))) {
      await unlink(join(dir, name)).catch(() => {})
    }

    const files = await Promise.all(
      names
        .filter((name) => name.endsWith('.png'))
        .map(async (name) => {
          const path = join(dir, name)
          const info = await stat(path)
          return { path, size: info.size, at: info.mtimeMs }
        }),
    )

    let total = files.reduce((sum, file) => sum + file.size, 0)
    if (total <= MAX_BYTES) return

    for (const file of files.sort((a, b) => a.at - b.at)) {
      if (total <= MAX_BYTES) break
      await unlink(file.path).catch(() => {})
      total -= file.size
    }
  } catch {
    // Diretorio ainda nao existe, ou nao da para ler: nada a podar.
  }
}
