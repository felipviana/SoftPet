/**
 * Leitura e validacao do manifesto de um pet.
 *
 * O formato v2 e uma evolucao direta do `pet.json` do Orca (uma linha da
 * spritesheet por estado). Duas diferencas importam:
 *
 * - `loop: false` + `next`: no Orca toda animacao e loop infinito, o que
 *   obrigava a esconder transicoes na cabeca da linha. Aqui uma reacao pode
 *   tocar uma vez e devolver o controle.
 * - `anchors`: pontos de ancoragem do corpo, em coordenadas do frame. E o que
 *   permite encaixar roupas e acessorios como camadas, e ancorar o balao de
 *   fala na cabeca.
 *
 * A leitura tambem aceita os formatos mais antigos e mais soltos que circulam
 * por ai — ver `parsePetManifest`.
 */

import {
  CODEX_ANIMATIONS,
  CODEX_DEFAULT_ANIMATION,
  CODEX_FRAME,
} from './codex-defaults.js'

export interface FrameSize {
  readonly width: number
  readonly height: number
}

export interface AnimationDef {
  /** Linha da spritesheet, base 0. */
  readonly row: number
  /** Quantos frames dessa linha, a partir da coluna 0, compoem a animacao. */
  readonly frames: number
  /** Duracao de cada frame; o comprimento tem de bater com `frames`. */
  readonly frameDurationsMs: readonly number[]
  readonly loop: boolean
  /** Para onde ir quando `loop` e falso e a animacao termina. */
  readonly next?: string
}

export const ANCHOR_NAMES = ['head', 'eyes', 'torso', 'handL', 'handR', 'feet'] as const
export type AnchorName = (typeof ANCHOR_NAMES)[number]

/** Ponto `[x, y]` em coordenadas do frame (pixels, origem no canto superior esquerdo). */
export type AnchorPoint = readonly [x: number, y: number]
export type Anchors = Readonly<Partial<Record<AnchorName, AnchorPoint>>>

export interface PetManifest {
  readonly schema: 2
  /**
   * De onde vieram frame e animacoes. `codex-defaults` significa que o
   * `pet.json` nao declarava nada e assumimos o layout padrao do Codex — a
   * interface de importacao mostra isso, para o usuario saber que o pet foi
   * interpretado e nao lido.
   */
  readonly layoutSource: 'declared' | 'codex-defaults'
  readonly id: string
  readonly displayName: string
  readonly description?: string
  /** Credito de arte, quando o pet nao foi gerado a partir de uma foto. */
  readonly credit?: string
  /** Caminho relativo ao diretorio do bundle. */
  readonly spritesheetPath: string
  readonly frame: FrameSize
  readonly fps: number
  readonly defaultAnimation: string
  readonly anchors: Anchors
  readonly animations: Readonly<Record<string, AnimationDef>>
}

/** O motor usa `frameDurationsMs`; `fps` fica so como metadado do bundle. */
export const DEFAULT_FPS = 8

export const LIMITS = {
  maxFrameSide: 1024,
  maxFps: 60,
  minFrameDurationMs: 16,
  maxFrameDurationMs: 60_000,
} as const

/** Faixa de tamanho de exibicao, herdada do overlay do Orca. */
export const DISPLAY_SIZE = { min: 60, default: 180, max: 360 } as const

export class PetManifestError extends Error {
  override readonly name = 'PetManifestError'
}

function fail(message: string): never {
  throw new PetManifestError(message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(source: Record<string, unknown>, key: string): string {
  const value = source[key]
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`"${key}" e obrigatorio e precisa ser um texto nao vazio.`)
  }
  return value
}

function optionalString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') fail(`"${key}", se presente, precisa ser um texto.`)
  return value
}

function requireInt(
  source: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
): number {
  const value = source[key]
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    fail(`"${key}" precisa ser um inteiro entre ${min} e ${max}.`)
  }
  return value
}

/**
 * O Orca recusa caminhos absolutos ou com `..`; mantemos a mesma regra porque
 * o manifesto pode vir de um bundle importado pelo usuario.
 */
function parseSpritesheetPath(source: Record<string, unknown>): string {
  const raw = requireString(source, 'spritesheetPath')
  const normalized = raw.replace(/\\/g, '/')
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    fail('"spritesheetPath" precisa ser relativo ao diretorio do bundle.')
  }
  if (normalized.split('/').includes('..')) {
    fail('"spritesheetPath" nao pode subir de diretorio ("..").')
  }
  return normalized
}

function parseFrame(source: Record<string, unknown>): FrameSize | null {
  const frame = source['frame']
  if (frame === undefined || frame === null) return null
  if (!isRecord(frame)) fail('"frame", se presente, precisa ser um objeto {width, height}.')
  return {
    width: requireInt(frame, 'width', 1, LIMITS.maxFrameSide),
    height: requireInt(frame, 'height', 1, LIMITS.maxFrameSide),
  }
}

function parseAnchorPoint(value: unknown, label: string, frame: FrameSize): AnchorPoint {
  if (!Array.isArray(value) || value.length !== 2) {
    fail(`Ancora "${label}" precisa ser um par [x, y].`)
  }
  const [x, y] = value as unknown[]
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  ) {
    fail(`Ancora "${label}" precisa conter dois numeros.`)
  }
  if (x < 0 || x > frame.width || y < 0 || y > frame.height) {
    fail(`Ancora "${label}" (${x}, ${y}) esta fora do frame ${frame.width}x${frame.height}.`)
  }
  return [x, y]
}

function parseAnchors(source: Record<string, unknown>, frame: FrameSize): Anchors {
  const raw = source['anchors']
  if (raw === undefined || raw === null) return {}
  if (!isRecord(raw)) fail('"anchors", se presente, precisa ser um objeto.')

  const anchors: Partial<Record<AnchorName, AnchorPoint>> = {}
  for (const name of ANCHOR_NAMES) {
    const value = raw[name]
    if (value === undefined || value === null) continue
    anchors[name] = parseAnchorPoint(value, name, frame)
  }
  return anchors
}

function parseAnimation(name: string, raw: unknown): AnimationDef {
  if (!isRecord(raw)) fail(`Animacao "${name}" precisa ser um objeto.`)

  const row = requireInt(raw, 'row', 0, 4096)
  const frames = requireInt(raw, 'frames', 1, 4096)

  const durations = raw['frameDurationsMs']
  if (!Array.isArray(durations)) {
    fail(`Animacao "${name}": "frameDurationsMs" precisa ser uma lista.`)
  }
  if (durations.length !== frames) {
    fail(
      `Animacao "${name}": "frameDurationsMs" tem ${durations.length} entradas ` +
        `para ${frames} frames.`,
    )
  }
  const frameDurationsMs = durations.map((duration, index) => {
    if (
      typeof duration !== 'number' ||
      !Number.isFinite(duration) ||
      duration < LIMITS.minFrameDurationMs ||
      duration > LIMITS.maxFrameDurationMs
    ) {
      fail(
        `Animacao "${name}", frame ${index}: duracao precisa estar entre ` +
          `${LIMITS.minFrameDurationMs} e ${LIMITS.maxFrameDurationMs} ms.`,
      )
    }
    return duration
  })

  // Manifestos v1 (Orca) nao tem "loop": la tudo e loop infinito.
  const loopRaw = raw['loop']
  if (loopRaw !== undefined && typeof loopRaw !== 'boolean') {
    fail(`Animacao "${name}": "loop", se presente, precisa ser booleano.`)
  }
  const loop = loopRaw ?? true

  const next = optionalString(raw, 'next')
  if (loop && next !== undefined) {
    fail(`Animacao "${name}": "next" so faz sentido com "loop": false.`)
  }

  return { row, frames, frameDurationsMs, loop, ...(next !== undefined ? { next } : {}) }
}

export interface ParseOptions {
  /** Usado como `id` quando o manifesto nao traz um - tipicamente o nome da pasta. */
  readonly fallbackId?: string
}

/**
 * Le um manifesto e devolve a forma v2 normalizada.
 *
 * Aceita tres gerações de arquivo:
 *
 * - **v2**, o nosso, com `loop`/`next` e `anchors`;
 * - **v1**, os bundles `.codex-pet` do Orca, que declaram frame e animacoes mas
 *   nao conhecem `loop`;
 * - **minimo**, o formato do acervo publico: so `id`, `displayName`,
 *   `description` e `spritesheetPath`, deixando o layout por conta do renderer.
 *   Esse e o caso mais comum la fora, e por isso o mais importante de aceitar.
 *
 * Nao valida contra a spritesheet - para isso e preciso conhecer as dimensoes da
 * imagem; use `validateAgainstSheet` depois de ler o cabecalho dela.
 */
export function parsePetManifest(raw: unknown, options: ParseOptions = {}): PetManifest {
  if (!isRecord(raw)) fail('O manifesto precisa ser um objeto JSON.')

  const schemaRaw = raw['schema']
  if (schemaRaw !== undefined && schemaRaw !== 1 && schemaRaw !== 2) {
    fail(`Versao de schema desconhecida: ${String(schemaRaw)}. Esperado 1 ou 2.`)
  }

  const declaredFrame = parseFrame(raw)
  const animationsRaw = raw['animations']
  if (animationsRaw !== undefined && animationsRaw !== null && !isRecord(animationsRaw)) {
    fail('"animations", se presente, precisa ser um objeto.')
  }

  // Sem frame nao ha como posicionar linha nenhuma, entao um manifesto que
  // declara animacoes precisa declarar o frame junto.
  if (declaredFrame === null && isRecord(animationsRaw)) {
    fail('"animations" foi declarado sem "frame"; sem o tamanho do frame nao da para posicionar as linhas.')
  }

  const frame = declaredFrame ?? CODEX_FRAME
  const declaredAnimations = isRecord(animationsRaw) ? animationsRaw : null

  let animations: Readonly<Record<string, AnimationDef>>
  let layoutSource: PetManifest['layoutSource']

  if (declaredAnimations === null) {
    animations = CODEX_ANIMATIONS
    layoutSource = 'codex-defaults'
  } else {
    const names = Object.keys(declaredAnimations)
    if (names.length === 0) fail('"animations" nao pode estar vazio.')
    const parsed: Record<string, AnimationDef> = {}
    for (const name of names) parsed[name] = parseAnimation(name, declaredAnimations[name])
    animations = parsed
    layoutSource = 'declared'
  }

  const defaultAnimation = optionalString(raw, 'defaultAnimation') ?? CODEX_DEFAULT_ANIMATION
  if (!(defaultAnimation in animations)) {
    fail(`"defaultAnimation" aponta para "${defaultAnimation}", que nao existe em "animations".`)
  }

  for (const [name, animation] of Object.entries(animations)) {
    if (animation.next !== undefined && !(animation.next in animations)) {
      fail(`Animacao "${name}": "next" aponta para "${animation.next}", que nao existe.`)
    }
  }

  const id = optionalString(raw, 'id') ?? options.fallbackId
  if (id === undefined || id.trim() === '') {
    fail('O manifesto nao traz "id" e nao ha nome de pasta para usar no lugar.')
  }

  const description = optionalString(raw, 'description')
  const credit = optionalString(raw, 'credit')
  const fps = raw['fps'] === undefined ? DEFAULT_FPS : requireInt(raw, 'fps', 1, LIMITS.maxFps)

  return {
    schema: 2,
    layoutSource,
    id,
    displayName: optionalString(raw, 'displayName') ?? id,
    ...(description !== undefined ? { description } : {}),
    ...(credit !== undefined ? { credit } : {}),
    spritesheetPath: parseSpritesheetPath(raw),
    frame,
    fps,
    defaultAnimation,
    anchors: parseAnchors(raw, frame),
    animations,
  }
}

/**
 * Confere o manifesto contra as dimensoes reais da spritesheet.
 *
 * Sem isso, uma linha a mais no manifesto vira um frame transparente em tempo
 * de execucao - falha silenciosa e chata de diagnosticar.
 */
export function validateAgainstSheet(
  manifest: PetManifest,
  sheetWidth: number,
  sheetHeight: number,
): void {
  const { width, height } = manifest.frame

  if (sheetWidth % width !== 0 || sheetHeight % height !== 0) {
    fail(
      `A spritesheet ${sheetWidth}x${sheetHeight} nao e um multiplo exato do frame ` +
        `${width}x${height}.`,
    )
  }

  const columns = sheetWidth / width
  const rows = sheetHeight / height

  for (const [name, animation] of Object.entries(manifest.animations)) {
    if (animation.row >= rows) {
      fail(`Animacao "${name}": linha ${animation.row} nao existe (a folha tem ${rows}).`)
    }
    if (animation.frames > columns) {
      fail(
        `Animacao "${name}": pede ${animation.frames} frames, mas a folha tem ` +
          `${columns} colunas.`,
      )
    }
  }
}

/**
 * Ancoras aproximadas para pets que nao declaram as suas - o caso dos bundles
 * v1 importados do Orca. Sao derivadas do contrato geometrico do STYLE_SPEC
 * (personagem de ~3 cabecas, pes na base do frame), entao servem para o balao
 * de fala nao ficar solto no ar; nao servem para vestir roupa.
 */
export function defaultAnchors(frame: FrameSize): Anchors {
  const { width, height } = frame
  return {
    head: [width / 2, height * 0.1],
    eyes: [width / 2, height * 0.22],
    torso: [width / 2, height * 0.55],
    handL: [width * 0.2, height * 0.6],
    handR: [width * 0.8, height * 0.6],
    feet: [width / 2, height],
  }
}

/** O overlay renderiza o pet dentro de um quadrado de `displaySize` px. */
export function scaleFor(frame: FrameSize, displaySize: number): number {
  return Math.min(displaySize / frame.width, displaySize / frame.height)
}
