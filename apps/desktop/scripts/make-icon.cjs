/**
 * Gera `build/icon.png`, de onde o electron-builder deriva o .ico do Windows.
 *
 * O icone e desenhado em codigo, e nao guardado como binario, por dois motivos:
 * um PNG de 512px versionado no git e um blob opaco que ninguem sabe editar
 * depois, e o desenho aqui e literalmente uma grade de quadrados — pixel art e
 * so isso. Mexer nele e mexer nas strings abaixo.
 *
 *   node scripts/make-icon.cjs
 */

const { app, BrowserWindow } = require('electron')
const { mkdirSync, writeFileSync } = require('node:fs')
const { dirname, join } = require('node:path')

const SIZE = 512
const OUT = join(__dirname, '..', 'build', 'icon.png')

/** 16x16: um bichinho simples, com olhos vazados e a barra de baixo ondulada. */
const PET = [
  '................',
  '................',
  '.....######.....',
  '...##########...',
  '..############..',
  '.##############.',
  '.##..######..##.',
  '.##..######..##.',
  '.##############.',
  '.##############.',
  '.##############.',
  '.##############.',
  '.##############.',
  '.##.##.##.##.##.',
  '.#..#..#..#..#..',
  '................',
]

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
  await win.loadURL('data:text/html,<html><body></body></html>')

  const png = await win.webContents.executeJavaScript(`(async () => {
    const S = ${SIZE}, GRID = 16, cell = S / GRID;
    const c = new OffscreenCanvas(S, S);
    const x = c.getContext('2d');

    // fundo: quadrado arredondado no tom dos paineis do app
    const r = S * 0.22;
    x.fillStyle = '#1e2430';
    x.beginPath();
    x.roundRect(0, 0, S, S, r);
    x.fill();

    x.strokeStyle = '#39414f';
    x.lineWidth = S * 0.012;
    x.beginPath();
    x.roundRect(x.lineWidth / 2, x.lineWidth / 2, S - x.lineWidth, S - x.lineWidth, r);
    x.stroke();

    // o bichinho, em quadrados — sem antialias, como o resto do app
    const arte = ${JSON.stringify(PET)};
    x.fillStyle = '#6ea8fe';
    for (let linha = 0; linha < GRID; linha++) {
      for (let coluna = 0; coluna < GRID; coluna++) {
        if (arte[linha][coluna] !== '#') continue;
        x.fillRect(Math.round(coluna * cell), Math.round(linha * cell), Math.ceil(cell), Math.ceil(cell));
      }
    }

    const blob = await c.convertToBlob({ type: 'image/png' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return Array.from(bytes);
  })()`)

  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, Buffer.from(png))
  console.log(`icone gerado: ${OUT} (${SIZE}x${SIZE}, ${png.length} bytes)`)
  app.quit()
})
