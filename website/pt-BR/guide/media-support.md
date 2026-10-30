# Suporte a Mídia

O VMark suporta embeds de vídeo, áudio e YouTube em seus documentos Markdown usando tags HTML5 padrão.

## Formatos Suportados

### Vídeo

| Formato | Extensão |
|---------|----------|
| MP4 | `.mp4` |
| WebM | `.webm` |
| MOV | `.mov` |
| AVI | `.avi` |
| MKV | `.mkv` |
| M4V | `.m4v` |
| OGV | `.ogv` |

### Áudio

| Formato | Extensão |
|---------|----------|
| MP3 | `.mp3` |
| M4A | `.m4a` |
| OGG | `.ogg` |
| WAV | `.wav` |
| FLAC | `.flac` |
| AAC | `.aac` |
| Opus | `.opus` |

## Sintaxe

### Vídeo

Use tags de vídeo HTML5 padrão:

```html
<video src="path/to/video.mp4" controls></video>
```

Com atributos opcionais:

```html
<video src="video.mp4" title="Demo" poster="thumbnail.jpg" controls></video>
```

### Áudio

Use tags de áudio HTML5 padrão:

```html
<audio src="path/to/audio.mp3" controls></audio>
```

### Embeds do YouTube

Use iframes do YouTube com privacidade aprimorada:

```html
<iframe src="https://www.youtube-nocookie.com/embed/VIDEO_ID" width="560" height="315" frameborder="0" allowfullscreen></iframe>
```

### Embeds do Vimeo

Use iframes do player Vimeo:

```html
<iframe src="https://player.vimeo.com/video/VIDEO_ID" width="560" height="315" frameborder="0" allowfullscreen></iframe>
```

Você também pode colar uma URL do Vimeo diretamente (por exemplo, `https://vimeo.com/123456789`) e o VMark a converterá automaticamente em um embed.

Vídeos não listados do Vimeo também são suportados: cole o link de compartilhamento não listado (`https://vimeo.com/123456789/abcdef1234` ou uma URL com `?h=…`) e o VMark preserva o hash de privacidade de que o embed precisa para ser reproduzido.

### Embeds do Bilibili

Use o iframe do player Bilibili com um BV ID:

```html
<iframe src="https://player.bilibili.com/player.html?bvid=BV1xxxxxxxxx" width="560" height="350" frameborder="0" allowfullscreen></iframe>
```

Cole uma URL de vídeo do Bilibili (por exemplo, `https://bilibili.com/video/BV1xxxxxxxxx`) e o VMark a converterá em um embed automaticamente. Observe que URLs curtas (`b23.tv`) não são suportadas, pois requerem resolução de redirecionamento.

### Fallback de Sintaxe de Imagem

Você também pode usar a sintaxe de imagem com extensões de arquivo de mídia — o VMark as promove automaticamente para o tipo de mídia correto:

```markdown
![](video.mp4)
![](audio.mp3)
```

## Inserindo Mídia

### Barra de Ferramentas

Use o menu Inserir na barra de ferramentas:

- **Vídeo** — abre um seletor de arquivo para arquivos de vídeo, copia para `.assets/`, insere uma tag `<video>`
- **Áudio** — abre um seletor de arquivo para arquivos de áudio, copia para `.assets/`, insere uma tag `<audio>`
- **YouTube** — lê uma URL do YouTube da área de transferência e insere um embed com privacidade aprimorada
- **Vimeo** e **Bilibili** — cole uma URL de vídeo diretamente no editor e o VMark detecta automaticamente o provedor

### Arrastar e Soltar

Arraste arquivos de vídeo ou áudio do seu sistema de arquivos diretamente para o editor. O VMark irá:

1. Copiar o arquivo para a pasta `.assets/` do documento
2. Inserir o nó de mídia apropriado com um caminho relativo

### Modo Fonte

No modo Fonte, digite as tags HTML diretamente. As tags de mídia são destacadas com bordas coloridas à esquerda:

- **Vídeo** — borda verde-azulada
- **Áudio** — borda índigo
- **YouTube** — borda vermelha
- **Vimeo** — borda azul
- **Bilibili** — borda rosa

### Colagem Inteligente no Modo Fonte

Colar no modo Fonte faz o que é correto em Markdown em vez de despejar texto bruto:

- **Um caminho de imagem** — ou vários, de uma cópia de vários arquivos no Finder ou no Explorador de Arquivos — é validado, copiado para a pasta de ativos do documento e inserido como `![](relative-path)`. Quando uma colagem é ambígua, um pequeno aviso de confirmação pergunta antes
- **Uma captura de tela ou imagem copiada** (dados binários de imagem na área de transferência) é salva na pasta de ativos e inserida da mesma forma
- **Uma URL colada sobre um texto selecionado** vira um link: `[selected text](https://…)`
- **HTML ou Markdown copiado de outro app** é convertido e limpo antes de entrar — exceto dentro de um bloco de código delimitado, onde o texto colado permanece literal
- **Arquivos de imagem arrastados do Finder ou do Explorador de Arquivos** para o editor de código-fonte também são copiados e inseridos

A conversão segue **Configurações → Markdown → Tratamento de colagem da área de transferência** (`Smart` é o padrão; os outros modos desativam a conversão), e os arquivos são copiados para a pasta de ativos enquanto **Configurações → Arquivos e imagens → Copiar para a pasta de ativos** estiver ativado (o padrão).

## Editando Mídia

Dê um duplo clique em qualquer elemento de mídia no modo WYSIWYG para abrir o popup de mídia:

- **Caminho da fonte** — editar o caminho do arquivo ou URL
- **Título** — atributo de título opcional
- **Pôster** (somente vídeo) — caminho da imagem em miniatura
- **Remover** — excluir o elemento de mídia

Pressione `Escape` para fechar o popup e voltar ao editor.

## Resolução de Caminho

O VMark suporta três tipos de caminhos de mídia:

| Tipo de Caminho | Exemplo | Comportamento |
|----------------|---------|---------------|
| Relativo | `./assets/video.mp4` | Resolvido em relação ao diretório do documento |
| Relativo ao diretório pai | `../images/photo.png` | Resolvido em relação ao diretório do documento, subindo quantos níveis o caminho pedir |
| Absoluto | `/Users/me/video.mp4` | Usado diretamente via protocolo de ativos Tauri |
| URL externa | `https://example.com/video.mp4` | Carregado diretamente da web |

Caminhos relativos são recomendados — eles mantêm seus documentos portáteis entre máquinas.

Uma pasta de ativos compartilhada ao lado das suas notas funciona como escrito — `notes/report.md`
pode referenciar `../images/photo.png`. (Antes da versão 0.9.79, esses caminhos eram renderizados como
espaços reservados quebrados.)

## Segurança

- Um caminho de mídia não pode conter um esquema de URI (`javascript:`, `file:` ou um personalizado); essas fontes são recusadas em vez de carregadas
- Um caminho relativo que aponta para um diretório (`.`, `..`, `assets/`) não é carregado. Os blocos de vídeo/áudio o recusam de imediato. Imagens inline o devolvem inalterado, e a webview o resolve em relação à origem do aplicativo, então ele nunca chega ao disco. Um caminho relativo à pasta pessoal (`~/…`) é tratado da mesma forma
- Caminhos absolutos não são restringidos pelas regras de caminho. Qualquer caminho absoluto dentro do escopo de assets é exibido: sua pasta pessoal, `/Volumes`, `/mnt` e `/media` (mais as unidades `C:`–`F:` no Windows) e pastas concedidas em tempo de execução. Por isso, um documento pode mostrar qualquer imagem legível nesses lugares escrevendo o caminho completo. Colar uma imagem com **Copiar para a pasta de ativos** desligado grava um caminho absoluto assim. É também por isso que um caminho relativo pode usar `..`: ele não alcança nada que um caminho absoluto já não alcançasse
- Embeds de vídeo são carregados somente de três hosts: `www.youtube-nocookie.com` (o player com privacidade aprimorada do YouTube), `player.vimeo.com` e `player.bilibili.com`. Um link do YouTube, ou um iframe escrito com `youtube.com`, é incorporado pelo host com privacidade aprimorada. A política de segurança de conteúdo do VMark permite carregar frames desses hosts e de nenhum outro site
- Outras fontes de iframe são removidas pelo sanitizador
