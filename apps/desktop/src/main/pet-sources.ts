/**
 * As fontes da Lojinha de pets: de onde o app oferece pets para navegar.
 *
 * Vem em duas camadas. As **embutidas** sao os acervos publicos que ja
 * verificamos funcionar com o importador, e nao podem ser removidas — servem de
 * ponto de partida para quem abre a Lojinha pela primeira vez. As **do usuario**
 * sao links que ele mesmo acrescenta, e essas ele governa.
 *
 * Nao embutimos nenhum pet no instalador: a arte desses acervos e fan-art de
 * terceiros, de uso pessoal e nao comercial. O que embutimos e o endereco.
 */

export interface PetSource {
  readonly label: string
  readonly url: string
  /** Embutida no app: aparece para todos e nao pode ser removida. */
  readonly builtin: boolean
}

const BUILTIN: readonly { label: string; url: string }[] = [
  { label: 'Galeria da comunidade', url: 'github.com/legeling/awesome-codex-pet' },
  { label: 'Pokemon', url: 'github.com/dnnyngyen/codex-pokepets' },
  { label: 'Anime', url: 'github.com/chenxin-dlut/codex-anime-pets' },
  { label: 'CoPet', url: 'github.com/ChanceYu/CoPet' },
]

/** Normaliza para comparar fontes iguais escritas de formas diferentes. */
export function sourceKey(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
}

/** Rotulo legivel a partir do link, quando o usuario nao informa um. */
export function labelForUrl(url: string): string {
  const key = sourceKey(url)
  const match = /^github\.com\/([^/]+)\/([^/]+)/.exec(key)
  if (match) return match[2]!
  const petdex = /^petdex\.dev\/pets\/([^/]+)/.exec(key)
  if (petdex) return `petdex: ${petdex[1]}`
  return key.slice(0, 40)
}

export function mergeSources(custom: readonly { label: string; url: string }[]): PetSource[] {
  const seen = new Set(BUILTIN.map((source) => sourceKey(source.url)))
  const merged: PetSource[] = BUILTIN.map((source) => ({ ...source, builtin: true }))

  for (const source of custom) {
    const key = sourceKey(source.url)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push({ label: source.label, url: source.url, builtin: false })
  }

  return merged
}
