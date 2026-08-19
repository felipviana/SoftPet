/**
 * Empacota o app e deposita os artefatos em `release/`.
 *
 * O empacotamento acontece numa pasta temporaria, e nao direto no destino, por
 * um motivo concreto: o electron-builder extrai o Electron inteiro (~200 MB de
 * binarios) e depois **renomeia** a pasta. Qualquer coisa que observe o diretorio
 * do projeto — indexador, antivirus, o editor aberto — pode segurar um handle
 * durante esses segundos e derrubar o build com EPERM. Nesta maquina isso
 * acontece de forma reproduzivel.
 *
 * Extrair no temp e copiar so os arquivos finais evita a corrida inteira, e nao
 * custa nada: os artefatos sao dois executaveis.
 */

const { spawnSync } = require('node:child_process')
const { copyFileSync, mkdirSync, readdirSync, statSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const raiz = join(__dirname, '..')
const temporario = join(tmpdir(), 'softpet-build')
const destino = join(raiz, '..', '..', 'release')

// Chamamos o JS do electron-builder direto com o Node, e nao o atalho `.cmd`
// pelo shell: no Windows isso exigiria `shell: true`, que concatena argumentos
// sem escapar — desnecessario aqui, e o Node avisa a respeito.
const cli = require.resolve('electron-builder/out/cli/cli.js', {
  paths: [join(raiz, '..', '..')],
})

const resultado = spawnSync(
  process.execPath,
  [cli, '--win', `-c.directories.output=${temporario}`],
  { cwd: raiz, stdio: 'inherit' },
)

if (resultado.status !== 0) process.exit(resultado.status ?? 1)

mkdirSync(destino, { recursive: true })

let copiados = 0
for (const nome of readdirSync(temporario)) {
  const origem = join(temporario, nome)
  // Só os artefatos: `win-unpacked/` é intermediário e não interessa a ninguém.
  if (statSync(origem).isDirectory()) continue
  copyFileSync(origem, join(destino, nome))
  console.log(`  ${nome}  ${(statSync(origem).size / 1048576).toFixed(0)} MB`)
  copiados += 1
}

console.log(`\n${copiados} artefato(s) em ${destino}`)
