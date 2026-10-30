# Exportar e Imprimir

O VMark oferece várias formas de exportar e compartilhar seus documentos.

## O Que uma Exportação Produz

**Arquivo → Exportar → HTML** grava uma pasta, com o nome do seu documento, que sempre contém **os dois** arquivos abaixo — não há modo a escolher:

```text
MeuDocumento/
├── index.html          ← aponta para os arquivos em assets/
├── standalone.html     ← tudo embutido como URIs de dados (CSS, JS, imagens, fontes)
└── assets/
    ├── vmark-reader.css
    ├── vmark-reader.js
    ├── images/
    │   ├── image1.png
    │   └── ...
    └── fonts/          ← só quando o documento tem matemática ou você usa uma fonte web
```

Use o arquivo que for mais adequado ao momento:

| Arquivo | Melhor para | Contrapartida |
|---------|-------------|---------------|
| `index.html` | Hospedar em um site estático (URLs limpos como `/MeuDocumento/`), editar em outra ferramenta, manter o tamanho pequeno | Precisa da pasta `assets/` ao lado |
| `standalone.html` | Enviar por e-mail ou mensagem um único arquivo que não pode perder as imagens | Maior — todos os ativos são embutidos |

Os dois arquivos são renderizados pelo mesmo renderizador WYSIWYG e pela mesma folha de estilos que o editor usa, e ambos incluem o [VMark Reader](#vmark-reader).

## Como Exportar

### Exportar HTML

1. Use **Arquivo → Exportar → HTML**
2. Escolha onde salvar e insira um nome — ele se torna o nome da pasta (um `.html` no final é removido)
3. Abra `index.html` ou `standalone.html` na nova pasta

#### Exportando de novo para uma pasta já usada

Uma exportação HTML é tudo ou nada. Tudo é gravado primeiro em uma pasta
temporária `.vmark-export-…` dentro do destino escolhido, e só é movido para o
lugar quando todos os arquivos existem — assim, uma exportação que falha no meio
deixa a exportação anterior exatamente como estava, em vez de sobrescrevê-la
pela metade.

Duas coisas que você pode ver:

- **"Outra exportação já está gravando nesta pasta."** Apenas uma exportação
  pode gravar em uma pasta por vez, entre todas as janelas. Aguarde a outra ou —
  se nada mais estiver em execução — exclua o arquivo `.vmark-export.lock`
  indicado na mensagem e tente novamente.
- **Uma pasta `.vmark-export-…` que ficou para trás.** O VMark a remove quando
  termina. Ela só permanece se a restauração dos seus arquivos anteriores também
  falhou; nesse caso, ela guarda esses arquivos e a mensagem de erro diz
  exatamente onde eles estão. Nada é excluído enquanto essa for a única cópia.

### Imprimir / Exportar PDF

Disponível no macOS, Windows e Linux.

**Exportar PDF** (**Arquivo → Exportar → PDF**) grava um PDF diretamente, usando
o tamanho de página, a orientação, as margens e a tipografia que você escolher
no diálogo de exportação.

**Imprimir** (`Cmd/Ctrl + P`, ou **Arquivo → Imprimir**) abre o diálogo de
impressão do sistema, para que você possa enviar o documento a uma impressora ou
usar o "salvar como PDF" do próprio sistema operacional. No macOS e no Linux, o
VMark confirma um trabalho de impressão concluído com um breve aviso e não diz
nada se você cancelar o diálogo; a interface de impressão do Windows não dá
retorno, então nenhum aviso é mostrado lá.

O diálogo de exportação mostra as mesmas etapas de progresso — carregando,
gerando, finalizando, concluído — nas três plataformas.

::: info Tamanho de página no macOS
O Tamanho e a Orientação que você escolhe no diálogo definem a página exportada
em todas as plataformas. No macOS eles substituem o tamanho de papel configurado
no sistema — se o seu Mac usa Carta por padrão e você escolhe A4, o PDF sai em
A4.
:::

**Esboço na barra lateral.** Os PDFs exportados trazem um esboço dos títulos — o
sumário clicável que o seu leitor de PDF mostra na barra lateral — nas três
plataformas.

#### Números de página

A seção **Números de página** do diálogo adiciona um número a cada página. Ela
vem ativada por padrão, centralizada na parte inferior.

| Configuração | Opções |
|--------------|--------|
| Posição | Inferior centralizado, inferior direito ou nenhum |
| Formato | `7`, `7 / 12` ou `Página 7 de 12` |
| Ignorar a primeira página | Deixa a página 1 sem número, o tratamento usual para uma página de título |

O número fica dentro da margem inferior que você escolheu e acompanha o tamanho
da fonte do corpo. A numeração sempre reflete a página real, então ignorar a
primeira página dá 2, 3, 4… nas páginas seguintes, em vez de renumerá-las.

::: info Os números de página usam um alfabeto latino
O número é desenhado com uma fonte PDF padrão que nenhum leitor precisa baixar,
o que mantém as exportações rápidas e autocontidas — mas essa fonte não
consegue renderizar chinês, japonês, coreano ou cirílico. Os dois formatos
numéricos funcionam em qualquer idioma. Se o idioma da sua interface escreve
`Página 7 de 12` em um sistema de escrita que essa fonte não consegue desenhar,
o VMark imprime a forma numérica `7 / 12`, em vez de espaços em branco ou
caracteres errados.
:::

### Exportar via Pandoc

O VMark integra com o [Pandoc](https://pandoc.org/) — um conversor universal de documentos — para exportar seu markdown para formatos adicionais. Escolha um formato diretamente no menu:

**Arquivo → Exportar → Via Pandoc →**

| Item do Menu | Extensão |
|--------------|----------|
| Word (.docx) | `.docx` |
| EPUB (.epub) | `.epub` |
| LaTeX (.tex) | `.tex` |
| OpenDocument (.odt) | `.odt` |
| Texto formatado (.rtf) | `.rtf` |
| Texto simples (.txt) | `.txt` |

**Configuração:**

1. Instale o Pandoc em [pandoc.org/installing](https://pandoc.org/installing.html) ou via gerenciador de pacotes:
   - macOS: `brew install pandoc`
   - Windows: `winget install pandoc`
   - Linux: `apt install pandoc`
2. Reinicie o VMark (ou vá para **Configurações → Arquivos e Imagens → Ferramentas de documento** e clique em **Detectar**)
3. Use **Arquivo → Exportar → Via Pandoc → [formato]** para exportar

Se o Pandoc não estiver instalado, o submenu **Via Pandoc** mostra um único item — **"Instale o Pandoc para exportar para Word, EPUB, LaTeX…"** — que abre o guia de instalação do Pandoc ao ser clicado.

Você pode verificar se o Pandoc foi detectado em **Configurações → Arquivos e Imagens → Ferramentas de documento**.

### Copiar como HTML

Pressione `Cmd/Ctrl + Shift + C` para copiar o documento renderizado como **código-fonte** HTML. A marcação vai para a área de transferência como texto simples e sem estilos, então cole-a onde se espera código HTML — a visualização HTML de um CMS, um template, um editor de código; um editor de texto formatado como o Word ou o Mail mostra as tags literalmente. Imagens locais são embutidas como URIs de dados, então continuam aparecendo depois que o HTML sai do VMark.

## VMark Reader

Toda exportação HTML inclui o **VMark Reader** — uma experiência de leitura interativa com suas próprias configurações, navegação e lightbox.

### Painel de Configurações

Clique no ícone de engrenagem (canto inferior direito) para abrir o painel de configurações; `Esc` o fecha de novo. Suas escolhas são lembradas pelo navegador (`localStorage`), então valem na próxima vez que você abrir o arquivo.

| Configuração | Opções |
|-------------|--------|
| Tamanho da Fonte | 12px – 28px |
| Altura de Linha | 1.2 – 2.4 |
| Largura do Conteúdo | 30em – 80em |
| Fonte Latina | System, Athelas, Palatino, Georgia, Charter, Literata |
| Fonte CJK | System, PingFang, Songti, Kaiti, Noto Serif, Source Han |
| Tema | White, Paper (padrão), Mint, Sepia, Night |
| Espaçamento entre Letras CJK | 0.02em – 0.12em |
| Espaçamento CJK-Latino | Alternar o espaçamento automático entre caracteres CJK e latinos |
| Índice | Alternar a barra lateral do índice (o mesmo que pressionar `T`) |
| Expandir Todas as Seções | Abrir todos os blocos `<details>` recolhíveis |
| Restaurar Padrões | Voltar todas as configurações ao padrão |

### Índice

A barra lateral de índice ajuda a navegar em documentos longos:

- **Alternar**: Clique na aba na borda da página ou pressione `T`
- **Navegar**: Clique em qualquer título para ir até ele
- **Destaque**: A seção atual é destacada enquanto você rola

### Progresso de Leitura

Uma barra de progresso sutil no topo da página mostra até onde você leu no documento.

### Voltar ao Topo

Um botão flutuante aparece quando você rola para baixo. Clique nele para voltar ao topo.

### Lightbox de Imagens

Clique em qualquer imagem para vê-la em um lightbox em tela cheia:

- **Fechar**: Clique fora, pressione `Esc` ou clique no botão X
- **Zoom**: As imagens são exibidas no tamanho natural

### Blocos de Código

Cada bloco de código inclui controles interativos:

| Botão | Função |
|-------|--------|
| Alternar números de linha | Mostrar/ocultar números de linha para este bloco |
| Botão copiar | Copiar código para a área de transferência |

O botão copiar mostra uma marca de verificação quando bem-sucedido.

### Navegação de Rodapés

Os rodapés são totalmente interativos:

- Clique em uma referência de rodapé `[1]` para ir até sua definição
- Clique no `↩` de referência inversa para voltar ao ponto de leitura

### Atalhos de Teclado

| Tecla | Ação |
|-------|------|
| `Esc` | Fechar o painel de configurações ou o lightbox |
| `T` | Alternar Índice |
| `+` / `=` | Aumentar o tamanho da fonte |
| `-` | Diminuir o tamanho da fonte |

## Atalhos de Exportação

| Ação | Atalho |
|------|--------|
| Exportar HTML | _(somente no menu)_ |
| Exportar PDF | _(somente no menu)_ |
| Imprimir | `Mod + P` |
| Copiar como HTML | `Mod + Shift + C` |

## Dicas

### Servindo HTML Exportado

A estrutura de exportação de pasta funciona bem com qualquer servidor de arquivos estáticos:

```bash
# Python
cd MeuDocumento && python -m http.server 8000

# Node.js (npx)
npx serve MeuDocumento

# Abrir diretamente
open MeuDocumento/index.html
```

### Visualização Offline

Os dois arquivos abrem offline, com uma diferença para documentos que contêm matemática:

- **`standalone.html`** é totalmente autocontido — a folha de estilos e as fontes do KaTeX são embutidas no momento da exportação, então a matemática é renderizada sem conexão.
- **`index.html`** carrega a folha de estilos do KaTeX de uma CDN (jsDelivr), então sua matemática precisa de conexão com a internet quando a página é aberta; o leitor, as imagens e as fontes em `assets/` são locais.

As fontes são baixadas durante a exportação: as fontes do KaTeX quando o documento tem matemática, e as suas fontes latina e monoespaçada quando forem fontes web que o VMark conhece (Literata, JetBrains Mono, Fira Code, IBM Plex Mono). A configuração de fonte CJK nunca é embutida, e uma fonte do sistema ou uma família de fontes personalizada também não — para essas, a página exportada usa a pilha de fontes do sistema de quem a lê. Exporte em uma máquina com acesso à internet se quiser as fontes embutidas — uma exportação offline recorre às fontes do sistema.

### Quais Imagens São Embutidas

Um arquivo exportado carrega os bytes reais das imagens, e exportações são
compartilhadas — por isso o VMark limita de onde esses bytes podem vir:

| Seu documento está… | As imagens podem vir de |
|---|---|
| dentro de um espaço de trabalho aberto | qualquer lugar desse espaço de trabalho |
| aberto sozinho | a própria pasta do documento e as subpastas |
| não salvo (nunca gravado em disco) | lugar nenhum — nenhuma imagem local é embutida, mesmo com um espaço de trabalho aberto; imagens remotas não são afetadas |

No caso de um documento não salvo, salve-o primeiro e exporte de novo. Isso vale para HTML, impressão, PDF e Copiar como HTML.

Caminhos relativos são resolvidos a partir da pasta do documento, exatamente
como no editor — então `../images/photo.png` funciona sempre que o destino
permanece dentro do limite acima. Qualquer coisa fora dele (`~/.ssh/id_rsa`,
`/etc/passwd`, um caminho absoluto em outro lugar do disco) é recusada e
exportada como um espaço reservado "Image not found", contabilizado no
aviso da exportação.

Se uma imagem `../` for exportada como espaço reservado, abra a pasta dela como
espaço de trabalho e exporte novamente.

### Melhores Práticas

1. **Hospede o `index.html`** para documentos que você vai publicar — mantenha a pasta `assets/` ao lado
2. **Envie o `standalone.html`** para compartilhamento rápido por e-mail ou chat
3. **Inclua texto alternativo descritivo nas imagens** para acessibilidade
4. **Teste o HTML exportado** em diferentes navegadores
