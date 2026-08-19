import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { DISPLAY_SIZE } from '@softpet/pet-format'

export interface Point {
  x: number
  y: number
}

export interface Settings {
  /**
   * Id do pet ativo dentro da biblioteca — **nao** um caminho.
   *
   * Guardar o caminho absoluto parece mais direto e quebra em silencio: basta o
   * %APPDATA% mudar de lugar (perfil movel corporativo, renomeacao, outra
   * maquina) para o app abrir com "nao foi possivel carregar o pet". A
   * biblioteca ja e a fonte unica; o id basta para achar a pasta.
   */
  activePetId: string | null
  /** Lado do quadrado em que o pet e desenhado, em DIP. */
  displaySize: number
  /**
   * Canto superior esquerdo **do pet**, nao da janela. Nulo = posicao inicial.
   *
   * O nome carrega o "pet" de proposito: ate a v0.1.0 este campo guardava o
   * canto da janela, e a janela virou um palco maior que o pet. Um arquivo
   * antigo seria lido com a semantica nova e o pet nasceria deslocado, entao o
   * campo trocou de nome para que o valor velho seja simplesmente ignorado.
   */
  petPosition: Point | null
  /**
   * Token pessoal do GitHub, opcional. Sobe o teto da API de 60 para 5.000
   * requisicoes por hora. Fica em texto claro no userData — para a empresa
   * inteira, o caminho certo e um servidor intermediar com um token so.
   */
  githubToken: string | null
  /** Fontes que o usuario acrescentou a Lojinha. As embutidas nao ficam aqui. */
  petSources: { label: string; url: string }[]
}

const DEFAULTS: Settings = {
  activePetId: null,
  displaySize: DISPLAY_SIZE.default,
  petPosition: null,
  githubToken: null,
  petSources: [],
}

/**
 * Preferencias em um JSON no userData.
 *
 * Preferimos ~40 linhas proprias a uma dependencia: `electron-store` hoje e
 * ESM-only e briga com o bundle CJS do processo main, e o que precisamos
 * guardar cabe em tres campos.
 *
 * A escrita e adiada porque arrastar o pet gera dezenas de atualizacoes de
 * posicao por segundo, e e atomica (tmp + rename) para que um crash no meio
 * nao deixe um JSON pela metade.
 */
export class SettingsStore {
  readonly #file: string
  #settings: Settings
  #flushTimer: NodeJS.Timeout | null = null

  constructor(file = join(app.getPath('userData'), 'settings.json')) {
    this.#file = file
    this.#settings = this.#read()
  }

  get all(): Readonly<Settings> {
    return this.#settings
  }

  get<K extends keyof Settings>(key: K): Settings[K] {
    return this.#settings[key]
  }

  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    if (this.#settings[key] === value) return
    this.#settings = { ...this.#settings, [key]: value }
    this.#scheduleFlush()
  }

  setPosition(position: Point): void {
    const current = this.#settings.petPosition
    if (current !== null && current.x === position.x && current.y === position.y) return
    this.#settings = { ...this.#settings, petPosition: position }
    this.#scheduleFlush()
  }

  #read(): Settings {
    try {
      const raw: unknown = JSON.parse(readFileSync(this.#file, 'utf8'))
      if (typeof raw !== 'object' || raw === null) return { ...DEFAULTS }
      const stored = raw as Partial<Settings>
      return {
        activePetId: readActivePetId(stored),
        displaySize: clampDisplaySize(stored.displaySize),
        petPosition: isPoint(stored.petPosition) ? stored.petPosition : DEFAULTS.petPosition,
        githubToken: typeof stored.githubToken === 'string' ? stored.githubToken : null,
        petSources: Array.isArray(stored.petSources) ? stored.petSources.filter(isSource) : [],
      }
    } catch {
      // Arquivo ausente na primeira execucao, ou ilegivel: seguimos com o padrao.
      return { ...DEFAULTS }
    }
  }

  #scheduleFlush(): void {
    if (this.#flushTimer !== null) return
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = null
      this.flush()
    }, 400)
  }

  flush(): void {
    if (this.#flushTimer !== null) {
      clearTimeout(this.#flushTimer)
      this.#flushTimer = null
    }
    try {
      mkdirSync(dirname(this.#file), { recursive: true })
      const temporary = `${this.#file}.tmp`
      writeFileSync(temporary, JSON.stringify(this.#settings, null, 2), 'utf8')
      renameSync(temporary, this.#file)
    } catch (error) {
      console.error('[softpet] nao foi possivel gravar as preferencias:', error)
    }
  }
}

function clampDisplaySize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULTS.displaySize
  return Math.min(DISPLAY_SIZE.max, Math.max(DISPLAY_SIZE.min, Math.round(value)))
}

function isPoint(value: unknown): value is Point {
  return (
    typeof value === 'object' &&
    value !== null &&
    Number.isFinite((value as Point).x) &&
    Number.isFinite((value as Point).y)
  )
}

function isSource(value: unknown): value is { label: string; url: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { label: unknown }).label === 'string' &&
    typeof (value as { url: unknown }).url === 'string'
  )
}

/**
 * Le o pet ativo, aceitando o formato antigo.
 *
 * Ate a v0.1.0 guardavamos o caminho absoluto em `petPath`. O nome da pasta na
 * biblioteca sempre foi o id, entao a ultima parte do caminho antigo serve de
 * migracao — sem isso, quem ja usava o app abriria sem pet.
 */
function readActivePetId(stored: Partial<Settings> & { petPath?: unknown }): string | null {
  if (typeof stored.activePetId === 'string') return stored.activePetId
  if (typeof stored.petPath !== 'string') return null
  const partes = stored.petPath.replace(/[\\/]+$/, '').split(/[\\/]/)
  return partes.at(-1) ?? null
}
