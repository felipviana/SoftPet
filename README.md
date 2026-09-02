# Softpet

Um bichinho de estimação que vive na sua tela. Ele anda por aí, senta, cochila,
reage quando você passa o mouse, e pode ser arrastado para onde você quiser.

Importa pets prontos de acervos públicos — são mais de dois mil por aí — ou o seu
próprio, se você desenhar um.

```bash
npm install
npm run dev      # desenvolvimento
npm run dist     # gera o instalador e o portátil em release/
```

Windows, por enquanto. Electron + TypeScript, sem framework no overlay.

## Como funciona o pet

Um pet é uma pasta com dois arquivos: um `pet.json` com o nome, e uma
spritesheet com todos os quadros da animação. Cada linha da folha é um estado.

```
Director        arbitra 3 camadas de prioridade: ambiente < interação < notificação
  BehaviorLoop  sorteia gestos e caminhadas, só age na camada ambiente
  Animator      cursor de frame + relógio; entende loop:false + next
  Sprite        spritesheet + máscara de acerto (união de todos os frames)
  Balloon       DOM, dentro do palco, vira de lado conforme a metade da tela
```

O repertório é de 17 estados — `idle`, `blink`, `look-around`, `sit`, `sleep`,
`stretch`, `yawn`, `walk-left`, `walk-right`, `drag`, `fall`, `wave`, `alert`,
`point`, `celebrate`, `sad`, `coffee`.

## Formato do pet

`pet.json` + spritesheet, uma linha por animação. É o formato dos pets do Codex,
com duas adições:

- `loop: false` + `next` — lá toda animação repete para sempre, o que obrigava a
  esconder transições na cabeça da linha. Aqui uma reação pode tocar uma vez e
  devolver o controle.
- `anchors` — pontos do corpo em coordenadas do frame (cabeça, olhos, torso,
  mãos, pés). É o que sustenta o balão de fala, e o que vai sustentar roupas em
  camadas.

A leitura aceita três gerações de arquivo, e a terceira é a que mais importa:
o **formato mínimo**, que é o normal no acervo público. Um `pet.json` de lá é
literalmente isto, e nada mais:

```json
{ "id": "pikachu", "displayName": "Pikachu",
  "description": "...", "spritesheetPath": "spritesheet.webp" }
```

Sem frame, sem fps, sem animações — quem sabe o resto é o renderer. Por isso
`codex-defaults.ts` traz o layout embutido: atlas de células 192×208, 8 colunas e
9 linhas nesta ordem: `idle`, `running-right`, `running-left`, `waving`,
`jumping`, `failed`, `waiting`, `running`, `review`. As contagens de frame e as
durações vieram da skill `hatch-pet` do repositório `openai/skills`, e foram
**conferidas contra a arte real**: contando as células não transparentes de um
spritesheet de verdade, as nove linhas batem exatamente.

Um parser que exigisse os campos declarados recusaria os milhares de pets já
publicados — ou seja, todo o acervo que a importação existe para trazer.

A spritesheet pode ser **PNG, WebP ou GIF**; WebP é o formato da maioria. As
dimensões saem do cabeçalho da imagem (`image-size.ts`, que lê as três variantes
de cabeçalho WebP), sem trazer um decodificador nativo para o instalador.

## Importar pets

Clicar no ícone da bandeja abre a janela, com navegação à esquerda: **Meu pet**
(pet ativo, tamanho, biblioteca, importar do computador), **Lojinha de pets**
(acervos públicos) e **Depuração**.

Cinco caminhos, porque o acervo público se distribui de três jeitos diferentes:

| Caminho | Como |
|---|---|
| Pasta local | `pet.json` + spritesheet ao lado |
| Arquivo `.zip` | Leitor próprio (`import/zip.ts`), sem dependência |
| Repositório git | Cole `github.com/dono/repo` — **lista** os pets e você escolhe |
| petdex.dev | Cole `petdex.dev/pets/<nome>` — importa aquele pet |
| Link direto | A URL de um `.zip` ou de um `pet.json` — funciona em qualquer site |

**Repositório git** commita os bundles, então dá para listar pela API de árvore
do GitHub e baixar só o pet escolhido — importante quando o repositório tem 1.738
pets e centenas de MB. Não assumimos estrutura: qualquer pasta com `pet.json` +
spritesheet é um pet.

**petdex.dev** não guarda os pets em git: eles vivem em banco e num bucket, e a
API de listagem exige login. O que é público lá é o endpoint que a CLI deles usa,
`/api/install/<slug>`, que devolve um script com as URLs dos assets — lemos esse
script em vez de adivinhar o padrão das URLs.

**Link direto** é a válvula de escape. Várias galerias não têm API nenhuma: a
página do pet só oferece um `.zip`. Integrar cada site desses seria uma corrida
sem fim contra mudanças de layout alheias. Colar o endereço do arquivo funciona
em qualquer site, hoje e depois de qualquer redesenho, porque o que se lê é o
arquivo — não a página.

### Acervos verificados

Todos listados pelo importador, sem nenhum caso especial. A arte é fan-art de
terceiros, de uso pessoal e não comercial — por isso nada disso é embutido no
instalador.

| Repositório | Pets |
|---|---|
| `dnnyngyen/codex-pokepets` | 1.738 |
| `legeling/awesome-codex-pet` | 198 |
| `chenxin-dlut/codex-anime-pets` | 22 |
| `ChanceYu/CoPet` | 20 |
| `hellosz/dsh-pets` | 10 |
| `AwesomeHou/openpet-ai-girls` | 5 |
| `petdex.dev` | 4.500+, um a um |

### O orçamento de requisições do GitHub

Sem autenticação a API do GitHub libera **60 requisições por hora e por IP**, e só
ela conta — os downloads em `raw.githubusercontent.com` são ilimitados. Sessenta
parece bastante e acaba em minutos se cada ação gastar à toa. O que segura:

- **A listagem é cacheada** por repositório e revisão. Importar N pets de uma
  listagem custa **zero** chamadas além da que a produziu. Sem isso, cada
  importação re-listava o repositório inteiro, a 2 chamadas por pet.
- Passado o TTL, revalidamos com `If-None-Match`. Um `304` **não conta** contra o
  limite, então rever um repositório grande sai de graça.
- Um **token** opcional sobe o teto para 5.000/hora.

Medido: 1 listagem + 5 importações = **2 chamadas** (eram 12).

### Miniaturas

Nomes como `feixiao--lingxiaotian` não dizem que personagem é aquele, então cada
cartão mostra uma miniatura. O custo **varia 290×** entre repositórios: onde há
`preview.gif` publicado são ~6 KB; onde não há, a miniatura sai da spritesheet de
~2 MB.

Carregar as 198 do `awesome-codex-pet` de uma vez seriam 386 MB. Por isso elas
carregam **só quando o cartão aparece na tela**, com 220 ms de atraso, no máximo
4 por vez, e são **cacheadas em disco já reduzidas** — 96×96 PNG, ~12 KB, contra
os 2 MB do original.

Medido, abrindo uma fonte sem rolar: 22 miniaturas. Chegou a 36 antes de uma
correção — os cartões eram observados antes de o layout assentar, e nesse
instante quase todos "intersectam" o container.

## Gerar o executável

```bash
npm run dist
```

Sai em `release/`: um portátil (`.exe` único, roda sem instalar) e um instalador
NSIS. Os dois pesam ~99 MB, dos quais **o código são 152 KB** — o resto é o
runtime do Chromium.

### Atualizações automáticas

Cada push na branch `main` dispara o workflow `Publicar atualizacao` no GitHub
Actions. Ele cria uma versão crescente, publica uma GitHub Release e envia o
instalador, o portátil, o `latest.yml` e os blocos usados na atualização.

Executáveis gerados a partir da versão que inclui o atualizador consultam essa
release ao iniciar e a cada quatro horas. Quando uma versão nova termina de ser
baixada, o usuário pode reiniciar e instalar imediatamente ou deixar a
instalação acontecer ao fechar o Softpet. Executáveis distribuídos antes da
inclusão desse mecanismo precisam ser substituídos uma última vez manualmente.

A instalação é **por usuário**, sem pedir administrador. O ícone é gerado por
código (`scripts/make-icon.cjs`) em vez de versionado como binário.

O empacotamento acontece numa pasta temporária e só os artefatos finais são
copiados para `release/`: o electron-builder extrai ~200 MB de binários e depois
renomeia a pasta, e qualquer coisa que observe o diretório do projeto — indexador,
antivírus, o editor aberto — pode segurar um handle nesses segundos e derrubar o
build com `EPERM`.

## Quatro armadilhas que já custaram caro

Estão aqui para não serem reintroduzidas.

**O teste de acerto não pode olhar o frame atual.** A primeira versão testava o
alfa do frame em exibição. O pet reage ao hover mudando de pose; a pose nova tem
outra silhueta; o pixel sob o cursor vira transparente; o hover cai; o pet volta.
O click-through piscava dezenas de vezes por segundo e engolia o clique. A
máscara é a **união de todos os frames**, montada uma vez na carga.

**O renderer não pode mandar coordenadas de arrasto.** `event.screenX/screenY` é
derivado da origem da janela, e a janela está se movendo por causa desses mesmos
eventos — o pet teleportava para um canto. Quem acompanha o cursor é o processo
main, com `screen.getCursorScreenPoint()`, que fica fora do laço.

**A janela não cresce quando o balão abre.** Seria o terceiro caso do mesmo
padrão. Em vez disso a janela é um **palco de tamanho fixo** com folga reservada;
abrir o balão e virá-lo de lado são decisões só do renderer. Como o palco é maior
que o pet, toda a matemática de posição é em coordenadas **do pet**: é ele que
para na borda da tela, enquanto o palco transborda de propósito.

**O pet ativo não pode ser um caminho absoluto.** Bastou o `%APPDATA%` mudar de
lugar para o app abrir com "não foi possível carregar o pet" — e isso quebraria
também em perfil móvel corporativo, onde `AppData\Roaming` literalmente roaming.
Guardamos o **id do pet na biblioteca**.

## Licença

MIT para o código. Os pets importados de acervos públicos são fan-art de
terceiros, de uso pessoal e não comercial — nenhum deles acompanha este
repositório.
