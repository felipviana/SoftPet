import type {
  InstalledPetInfo,
  PetSourceInfo,
  RepoListingInfo,
  SettingsState,
} from '../../shared/settings-ipc.js'

/** Acima disto a lista fica pesada de renderizar e impossivel de ler. */
const MAX_LISTED = 200

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id)
  if (element === null) throw new Error(`Elemento "${id}" não existe.`)
  return element as T
}

function setError(id: string, message: string | null): void {
  const element = $(id)
  element.hidden = message === null
  element.textContent = message ?? ''
}

// ---------------------------------------------------------------- navegacao

/**
 * Painéis com navegacao a esquerda.
 *
 * A separacao nao e so arrumacao: importar do computador e explorar acervos da
 * internet sao tarefas diferentes, com ritmos diferentes, e estavam competindo
 * pela mesma tela. Cada aba nova entra na barra da esquerda.
 */
function setupTabs(): void {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('nav button[data-pane]')]
  for (const button of buttons) {
    button.addEventListener('click', () => {
      const target = button.dataset['pane']!
      for (const other of buttons) {
        const name = other.dataset['pane']!
        other.setAttribute('aria-current', String(name === target))
        $(`pane-${name}`).hidden = name !== target
      }
    })
  }
}

// ------------------------------------------------------------- miniaturas

/** Cache de miniatura: trocar de aba nao deve rebaixar a mesma folha de novo. */
const previews = new Map<string, ImageBitmap>()

async function bitmapFor(id: string): Promise<ImageBitmap | null> {
  const cached = previews.get(id)
  if (cached !== undefined) return cached
  try {
    const { sheet, sheetFormat } = await window.softpetSettings.getPreview(id)
    const bitmap = await createImageBitmap(
      new Blob([sheet as BlobPart], { type: `image/${sheetFormat}` }),
    )
    previews.set(id, bitmap)
    return bitmap
  } catch {
    return null
  }
}

/** Desenha o primeiro quadro de um pet instalado, encaixado sem distorcer. */
async function drawPreview(canvas: HTMLCanvasElement, id: string): Promise<void> {
  const context = canvas.getContext('2d')
  if (context === null) return

  const [bitmap, meta] = await Promise.all([
    bitmapFor(id),
    window.softpetSettings.getPreview(id).catch(() => null),
  ])
  if (bitmap === null || meta === null) return

  const { width, height } = meta.frame
  const scale = Math.min(canvas.width / width, canvas.height / height)
  context.imageSmoothingEnabled = false
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.drawImage(
    bitmap,
    0,
    0,
    width,
    height,
    (canvas.width - width * scale) / 2,
    (canvas.height - height * scale) / 2,
    width * scale,
    height * scale,
  )
}

// ------------------------------------------------------------------ estado

async function renderState(): Promise<void> {
  const state = await window.softpetSettings.getState()

  const size = $<HTMLInputElement>('size')
  size.min = String(state.displaySizeRange.min)
  size.max = String(state.displaySizeRange.max)
  size.value = String(state.displaySize)
  $('size-value').textContent = `${state.displaySize} px`
  $('toggle').textContent = state.overlayVisible ? 'Ocultar' : 'Mostrar'

  const animations = $('animations')
  animations.replaceChildren(
    ...state.animations.map((name) => {
      const button = document.createElement('button')
      button.textContent = name
      button.addEventListener('click', () => window.softpetSettings.playAnimation(name))
      return button
    }),
  )

  const notifications = $('notifications')
  notifications.replaceChildren(
    ...state.debugNotifications.map((entry) => {
      const button = document.createElement('button')
      button.textContent = entry.label
      button.addEventListener('click', () => window.softpetSettings.fireNotification(entry.id))
      return button
    }),
  )

  const token = $<HTMLInputElement>('gh-token')
  if (state.githubTokenSet && token.value === '') token.placeholder = 'Token salvo — ✓'

  renderQuota(state.rateLimit, state.githubTokenSet)
}

/**
 * Mostra quanto sobrou do orcamento da API do GitHub.
 *
 * Sem isto, "limite de requisicoes" chega como surpresa. Com o numero a vista,
 * da para ver acabando antes de ser barrado.
 */
function renderQuota(limit: SettingsState['rateLimit'], tokenSet: boolean): void {
  const element = $('quota')

  // Antes da primeira consulta desta sessao nao ha numero para mostrar; o texto
  // ainda precisa refletir se ha token, senao contradiz o campo ao lado.
  if (limit === null) {
    element.textContent = tokenSet
      ? 'Com token: 5.000 consultas por hora. Baixar os pets não consome esse orçamento — ' +
        'só listar fontes consome.'
      : 'Sem token, o GitHub libera 60 consultas por hora. Baixar os pets não consome esse ' +
        'orçamento — só listar fontes consome.'
    return
  }

  const minutes = Math.max(0, Math.ceil((limit.resetAt - Date.now()) / 60_000))
  const origem = limit.authenticated ? 'com token' : 'sem token'
  element.textContent =
    `GitHub ${origem}: ${limit.remaining} de ${limit.limit} consultas restantes, ` +
    `renova em ~${minutes} min. Baixar os pets não consome esse orçamento.`
}

// -------------------------------------------------------------- biblioteca

function petCard(pet: InstalledPetInfo, onChange: () => void): HTMLElement {
  const card = document.createElement('div')
  card.className = 'card'
  card.dataset['active'] = String(pet.active)

  const canvas = document.createElement('canvas')
  canvas.width = 72
  canvas.height = 72
  void drawPreview(canvas, pet.id)

  const name = document.createElement('div')
  name.className = 'name'
  name.textContent = pet.displayName
  name.title = pet.description ?? pet.displayName

  const meta = document.createElement('div')
  meta.className = 'meta'
  meta.textContent = `${pet.animations.length} animações`
  if (pet.layoutSource === 'codex-defaults') {
    const badge = document.createElement('span')
    badge.className = 'badge'
    badge.textContent = 'layout padrão'
    badge.title =
      'O pet.json não declarava frame nem animações; assumimos o layout padrão do Codex.'
    meta.append(' ', badge)
  }

  const use = document.createElement('button')
  use.textContent = pet.active ? 'Em uso' : 'Usar'
  use.disabled = pet.active
  use.className = pet.active ? '' : 'primary'
  use.addEventListener('click', async () => {
    use.disabled = true
    await window.softpetSettings.activate(pet.id)
    onChange()
  })

  const remove = document.createElement('button')
  remove.className = 'link'
  remove.textContent = 'remover'
  remove.disabled = pet.active
  remove.title = pet.active ? 'Escolha outro pet antes de remover este.' : (pet.origin ?? '')
  remove.addEventListener('click', async () => {
    remove.disabled = true
    previews.delete(pet.id)
    await window.softpetSettings.remove(pet.id)
    onChange()
  })

  card.append(canvas, name, meta, use, remove)
  return card
}

async function renderLibrary(): Promise<void> {
  const pets = await window.softpetSettings.listPets()
  $('library').replaceChildren(...pets.map((pet) => petCard(pet, () => void refresh())))

  $('library-note').textContent =
    pets.length === 0
      ? 'Nenhum pet ainda. Traga um do computador abaixo, ou da Lojinha de pets.'
      : `${pets.length} pet(s) na biblioteca.`

  const active = pets.find((pet) => pet.active)
  $('active-name').textContent = active?.displayName ?? 'Nenhum'
  $('active-meta').textContent = active?.description ?? ''
  if (active !== undefined) void drawPreview($<HTMLCanvasElement>('active-preview'), active.id)
}

async function refresh(): Promise<void> {
  await Promise.all([renderState(), renderLibrary(), renderSources()])
}

// ----------------------------------------------------------------- fontes

/** Fonte aberta agora; o filtro e as miniaturas se referem a ela. */
let openUrl = ''
let listing: RepoListingInfo | null = null

async function renderSources(): Promise<void> {
  const sources = await window.softpetSettings.listSources()
  const container = $('sources')

  container.replaceChildren(
    ...sources.map((source) => {
      const chip = document.createElement('div')
      chip.className = 'source'
      chip.setAttribute('aria-current', String(source.url === openUrl))

      const open = document.createElement('button')
      open.textContent = source.label
      open.title = source.url
      open.addEventListener('click', () => void openSource(source.url))
      chip.append(open)

      if (!source.builtin) {
        const drop = document.createElement('button')
        drop.className = 'drop'
        drop.textContent = '×'
        drop.title = 'Remover esta fonte'
        drop.addEventListener('click', async () => {
          await window.softpetSettings.removeSource(source.url)
          await renderSources()
        })
        chip.append(drop)
      }

      return chip
    }),
  )

  if (sources.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'note'
    empty.textContent = 'Nenhuma fonte. Acrescente uma abaixo.'
    container.append(empty)
  }
}

// --------------------------------------------- miniaturas do repositorio

/**
 * Fila das miniaturas do repositorio.
 *
 * Tres regras, e cada uma existe por um motivo concreto:
 *
 * - **so o que esta visivel**: no `awesome-codex-pet` nao ha `preview.gif`, e
 *   cada miniatura sai da spritesheet de ~2 MB. Carregar as 198 seriam ~386 MB;
 * - **com atraso**: rolar a lista rapido atravessa dezenas de linhas que ninguem
 *   chegou a olhar. Esperar um instante antes de buscar evita baixar tudo isso;
 * - **poucas de cada vez**: uma rajada de downloads de 2 MB derrubaria a
 *   responsividade da propria janela.
 */
const PREVIEW_DELAY_MS = 220
const PREVIEW_CONCURRENCY = 4
const THUMB_SIZE = 96
/** Recorte do primeiro quadro quando a miniatura veio da folha inteira. */
const CODEX_FRAME = { width: 192, height: 208 }

const previewQueue: (() => Promise<void>)[] = []
let previewRunning = 0

function pumpPreviews(): void {
  while (previewRunning < PREVIEW_CONCURRENCY && previewQueue.length > 0) {
    const task = previewQueue.shift()!
    previewRunning += 1
    void task().finally(() => {
      previewRunning -= 1
      pumpPreviews()
    })
  }
}

async function drawRepoPreview(canvas: HTMLCanvasElement, url: string, slug: string): Promise<void> {
  const context = canvas.getContext('2d')
  if (context === null) return

  const { bytes, extension, isSheet } = await window.softpetSettings.getRepoPreview(url, slug)
  const bitmap = await createImageBitmap(
    new Blob([bytes as BlobPart], { type: `image/${extension === 'apng' ? 'png' : extension}` }),
  )

  // A folha e uma grade; a miniatura util e a celula de cima a esquerda. Um
  // preview publicado ja e a imagem inteira.
  const source = isSheet
    ? {
        x: 0,
        y: 0,
        width: Math.min(CODEX_FRAME.width, bitmap.width),
        height: Math.min(CODEX_FRAME.height, bitmap.height),
      }
    : { x: 0, y: 0, width: bitmap.width, height: bitmap.height }

  const scale = Math.min(canvas.width / source.width, canvas.height / source.height)
  context.imageSmoothingEnabled = false
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.drawImage(
    bitmap,
    source.x,
    source.y,
    source.width,
    source.height,
    (canvas.width - source.width * scale) / 2,
    (canvas.height - source.height * scale) / 2,
    source.width * scale,
    source.height * scale,
  )
  canvas.dataset['loaded'] = 'true'

  // Ja veio reduzida do cache: nao ha o que gravar de volta.
  if (!isSheet && extension === 'png') return
  void cacheThumb(url, slug, bitmap, source)
}

/**
 * Devolve ao main a miniatura reduzida.
 *
 * Guardar o arquivo de origem seria guardar 2 MB para desenhar 44 px; 96x96 em
 * PNG resolve em ~12 KB. E o renderer que faz isso porque e ele que sabe
 * decodificar WebP e recortar o quadro.
 */
async function cacheThumb(
  url: string,
  slug: string,
  bitmap: ImageBitmap,
  source: { x: number; y: number; width: number; height: number },
): Promise<void> {
  try {
    const off = document.createElement('canvas')
    off.width = THUMB_SIZE
    off.height = THUMB_SIZE
    const context = off.getContext('2d')
    if (context === null) return

    const scale = Math.min(THUMB_SIZE / source.width, THUMB_SIZE / source.height)
    context.imageSmoothingEnabled = false
    context.drawImage(
      bitmap,
      source.x,
      source.y,
      source.width,
      source.height,
      (THUMB_SIZE - source.width * scale) / 2,
      (THUMB_SIZE - source.height * scale) / 2,
      source.width * scale,
      source.height * scale,
    )

    const blob = await new Promise<Blob | null>((done) => off.toBlob(done, 'image/png'))
    if (blob === null) return
    await window.softpetSettings.cacheRepoThumb(url, slug, new Uint8Array(await blob.arrayBuffer()))
  } catch {
    // Cache e otimizacao; falhar aqui nao afeta o que ja esta na tela.
  }
}

// ------------------------------------------------------ listagem da fonte

/**
 * Um unico pet, vindo de um lugar que nao da para listar: o petdex (API com
 * login) ou um link direto para arquivo (galerias sem API).
 */
function renderSingle(
  headline: string,
  buttonLabel: string,
  note: string,
  install: () => Promise<InstalledPetInfo>,
): void {
  const container = $('repo-result')

  const header = document.createElement('p')
  header.className = 'note'
  header.textContent = headline

  const button = document.createElement('button')
  button.className = 'primary'
  button.textContent = buttonLabel
  button.addEventListener('click', async () => {
    button.disabled = true
    button.textContent = 'Importando…'
    setError('import-error', null)
    try {
      const imported = await install()
      previews.delete(imported.id)
      button.textContent = 'Importado'
      await refresh()
    } catch (error) {
      button.disabled = false
      button.textContent = buttonLabel
      setError('import-error', (error as Error).message)
    }
  })

  const row = document.createElement('div')
  row.className = 'row'
  row.style.marginTop = '10px'
  row.append(button)

  const footer = document.createElement('p')
  footer.className = 'note'
  footer.textContent = note

  container.replaceChildren(header, row, footer)
}

/**
 * Observador da listagem em exibicao.
 *
 * Guardado fora da funcao porque cada tecla no filtro redesenha a lista: sem
 * descartar o anterior, os temporizadores dele continuariam disparando
 * downloads de linhas que ja sairam da tela — exatamente a banda que o
 * carregamento sob demanda existe para poupar.
 */
let repoObserver: { disconnect: () => void } | null = null

function renderRepo(filter: string): void {
  const container = $('repo-result')
  repoObserver?.disconnect()
  repoObserver = null

  if (listing === null) {
    container.replaceChildren()
    return
  }

  const needle = filter.trim().toLowerCase()
  const matches = listing.pets.filter((pet) => pet.slug.toLowerCase().includes(needle))

  const header = document.createElement('p')
  header.className = 'note'
  header.textContent =
    `${listing.owner}/${listing.repo} @ ${listing.ref} — ${listing.pets.length} pet(s)` +
    (needle === '' ? '' : `, ${matches.length} com "${filter.trim()}"`) +
    (listing.truncated ? ' (o GitHub truncou a listagem deste repositório)' : '')

  if (listing.pets.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'note'
    empty.textContent =
      'Nenhuma pasta com pet.json + folha de desenhos aqui. Nem toda galeria guarda os pets no git: ' +
      'algumas mantêm só o site e servem os arquivos de outro lugar.'
    container.replaceChildren(header, empty)
    return
  }

  const search = document.createElement('input')
  search.type = 'text'
  search.placeholder = 'Filtrar por nome…'
  search.value = filter
  search.addEventListener('input', () => renderRepo(search.value))

  const searchRow = document.createElement('div')
  searchRow.className = 'row'
  searchRow.append(search)

  const list = document.createElement('div')
  list.className = 'repo-list'

  // Um observador por listagem, descartado junto com ela quando o filtro muda.
  const pending = new Map<Element, number>()
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const canvas = entry.target as HTMLCanvasElement
        if (!entry.isIntersecting) {
          const timer = pending.get(canvas)
          if (timer !== undefined) {
            window.clearTimeout(timer)
            pending.delete(canvas)
          }
          continue
        }
        if (canvas.dataset['loaded'] === 'true' || pending.has(canvas)) continue

        pending.set(
          canvas,
          window.setTimeout(() => {
            pending.delete(canvas)
            const slug = canvas.dataset['slug']!
            previewQueue.push(async () => {
              try {
                await drawRepoPreview(canvas, openUrl, slug)
                observer.unobserve(canvas)
              } catch {
                // Miniatura e enfeite: se falhar, a linha continua utilizavel.
              }
            })
            pumpPreviews()
          }, PREVIEW_DELAY_MS),
        )
      }
    },
    // Margem curta de proposito: em grade cabem ~15 cartoes por tela contra ~6
    // numa lista, entao uma margem generosa puxaria uma fileira inteira a mais.
    // Onde a miniatura sai da folha de 2 MB, cada fileira extra sao ~10 MB.
    { root: list, rootMargin: '60px' },
  )

  repoObserver = {
    disconnect: () => {
      observer.disconnect()
      for (const timer of pending.values()) window.clearTimeout(timer)
      pending.clear()
    },
  }

  const thumbs: HTMLCanvasElement[] = []

  for (const pet of matches.slice(0, MAX_LISTED)) {
    const item = document.createElement('div')
    item.className = 'repo-item'

    const thumb = document.createElement('canvas')
    thumb.className = 'repo-thumb'
    // Mesmo tamanho em que a miniatura e guardada: desenha 1:1, sem interpolar.
    thumb.width = THUMB_SIZE
    thumb.height = THUMB_SIZE
    thumb.dataset['slug'] = pet.slug
    thumbs.push(thumb)

    // Nos acervos curados o slug e "<pet>--<autor>". Separar deixa o nome do
    // personagem legivel; sem isso "acheron--lingxiaotian" so mostra ruido.
    const [name = pet.slug, ...rest] = pet.slug.split('--')

    const label = document.createElement('div')
    label.className = 'repo-name'
    label.textContent = name
    label.title = pet.dir

    const install = document.createElement('button')
    install.textContent = 'Importar'
    install.addEventListener('click', async () => {
      install.disabled = true
      install.textContent = 'Importando…'
      setError('import-error', null)
      try {
        const imported = await window.softpetSettings.importFromRepo(openUrl, pet.slug)
        install.textContent = 'Importado'
        previews.delete(imported.id)
        await refresh()
      } catch (error) {
        install.disabled = false
        install.textContent = 'Importar'
        setError('import-error', `Não consegui importar "${pet.slug}": ${(error as Error).message}`)
      }
    })

    item.append(thumb, label)

    if (rest.length > 0) {
      const author = document.createElement('div')
      author.className = 'repo-author'
      author.textContent = `por ${rest.join('--')}`
      item.append(author)
    }

    item.append(install)
    list.append(item)
  }

  const footer = document.createElement('p')
  footer.className = 'note'
  footer.textContent =
    matches.length > MAX_LISTED
      ? `Mostrando ${MAX_LISTED} de ${matches.length}. Refine o filtro para ver o resto.`
      : 'A arte destes acervos é fan-art de terceiros, de uso pessoal e não comercial.'

  container.replaceChildren(header, searchRow, list, footer)

  // Observar so depois do layout assentar. Antes disso a grade ainda nao esta
  // limitada pela altura do container, entao praticamente todos os cartoes
  // "intersectam" e disparam download — medido: 36 miniaturas em vez das ~12
  // realmente visiveis. Onde a miniatura sai da folha de 2 MB, essa diferenca
  // sao dezenas de MB a toa na primeira abertura.
  requestAnimationFrame(() => {
    for (const thumb of thumbs) observer.observe(thumb)
  })
}

async function openSource(url: string): Promise<void> {
  const trimmed = url.trim()
  if (trimmed === '') return

  openUrl = trimmed
  $<HTMLInputElement>('source-url').value = trimmed
  setError('import-error', null)
  $('repo-result').textContent = 'Consultando…'
  await renderSources()

  try {
    const probe = await window.softpetSettings.probeUrl(trimmed)
    if (probe.kind === 'petdex') {
      listing = null
      renderSingle(
        `petdex.dev — pet "${probe.slug}".`,
        `Importar ${probe.slug}`,
        'O petdex guarda os pets em banco, e a API de listagem exige login — por isso aqui a ' +
          'importação é um por vez. Navegue o acervo em petdex.dev e cole o link do pet.',
        () => window.softpetSettings.importFromPetdex(probe.slug),
      )
    } else if (probe.kind === 'file') {
      listing = null
      renderSingle(
        `Arquivo — "${probe.label}".`,
        'Importar deste link',
        'Muitas galerias não têm API: a página do pet só oferece um .zip. Colar o endereço do ' +
          'arquivo funciona em qualquer site, sem depender do layout da página.',
        () => window.softpetSettings.importFromUrl(probe.url),
      )
    } else {
      listing = probe.listing
      renderRepo('')
    }
  } catch (error) {
    listing = null
    $('repo-result').textContent = ''
    setError('import-error', (error as Error).message)
  }

  await renderState()
}

// ------------------------------------------------------------------ ligacao

function wire(): void {
  setupTabs()

  $<HTMLInputElement>('size').addEventListener('input', (event) => {
    const value = Number((event.target as HTMLInputElement).value)
    $('size-value').textContent = `${value} px`
    window.softpetSettings.setDisplaySize(value)
  })

  $('toggle').addEventListener('click', async () => {
    const visible = await window.softpetSettings.toggleOverlay()
    $('toggle').textContent = visible ? 'Ocultar' : 'Mostrar'
  })

  $('import-folder').addEventListener('click', async () => {
    setError('local-error', null)
    try {
      if ((await window.softpetSettings.importFolder()) !== null) await refresh()
    } catch (error) {
      setError('local-error', (error as Error).message)
    }
  })

  $('import-zip').addEventListener('click', async () => {
    setError('local-error', null)
    try {
      if ((await window.softpetSettings.importZip()) !== null) await refresh()
    } catch (error) {
      setError('local-error', (error as Error).message)
    }
  })

  $('source-open').addEventListener('click', () => {
    void openSource($<HTMLInputElement>('source-url').value)
  })

  $<HTMLInputElement>('source-url').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void openSource($<HTMLInputElement>('source-url').value)
  })

  $('source-add').addEventListener('click', async () => {
    const url = $<HTMLInputElement>('source-url').value.trim()
    if (url === '') return
    setError('import-error', null)
    try {
      await window.softpetSettings.addSource(url)
      await renderSources()
      await openSource(url)
    } catch (error) {
      setError('import-error', (error as Error).message)
    }
  })

  $('gh-save').addEventListener('click', async () => {
    const field = $<HTMLInputElement>('gh-token')
    setError('import-error', null)
    try {
      await window.softpetSettings.setGitHubToken(field.value)
      field.value = ''
      listing = null
      $('repo-result').replaceChildren()
      await refresh()
    } catch (error) {
      setError('import-error', (error as Error).message)
    }
  })

  $('open-library').addEventListener('click', () => window.softpetSettings.openLibraryFolder())

  $('quit').addEventListener('click', () => window.softpetSettings.quit())

  window.softpetOnChanged(() => void refresh())
}

wire()
void refresh()
