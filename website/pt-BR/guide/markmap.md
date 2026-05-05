# Mapas Mentais Markmap

O VMark suporta [Markmap](https://markmap.js.org/) para criar árvores de mapas mentais interativos diretamente nos seus documentos Markdown. Ao contrário do tipo de diagrama mindmap estático do Mermaid, o Markmap usa títulos Markdown simples como entrada e oferece pan/zoom/colapso interativos.

## Inserindo um Mapa Mental

### Usando o Menu

**Menu:** Inserir > Mapa Mental

**Atalho de teclado:** `Alt + Shift + Cmd + K` (macOS) / `Alt + Shift + Ctrl + K` (Windows/Linux)

### Usando um Bloco de Código

Digite um bloco de código delimitado com o identificador de linguagem `markmap`:

````markdown
```markmap
# Mapa Mental

## Ramo A
### Tópico 1
### Tópico 2

## Ramo B
### Tópico 3
### Tópico 4
```text
````

### Usando a Ferramenta MCP

Use a ferramenta MCP `media` com `action: "markmap"` e o parâmetro `code` contendo títulos Markdown.

## Modos de Edição

### Modo Texto Rico (WYSIWYG)

No modo WYSIWYG, os mapas mentais Markmap são renderizados como árvores SVG interativas. Você pode:

- **Pan** rolando ou clicando e arrastando
- **Zoom** segurando `Cmd`/`Ctrl` e rolando
- **Colapsar/expandir** nós clicando no círculo em cada ramo
- **Ajustar** a visualização usando o botão de ajuste (canto superior direito ao passar o mouse)
- **Duplo clique** no mapa mental para editar o código-fonte

### Modo Fonte com Prévia ao Vivo

No modo Fonte, um painel de prévia flutuante aparece quando o cursor estiver dentro de um bloco de código markmap, atualizando conforme você digita.

## Formato de Entrada

O Markmap usa Markdown padrão como entrada. Os títulos definem a hierarquia da árvore:

| Markdown | Função |
|----------|--------|
| `# Título 1` | Nó raiz |
| `## Título 2` | Ramo de primeiro nível |
| `### Título 3` | Ramo de segundo nível |
| `#### Título 4+` | Ramos mais profundos |

### Conteúdo Rico nos Nós

Os nós podem conter Markdown inline:

````markdown
```markmap
# Plano do Projeto

## Pesquisa
### Ler artigos **importantes**
### Revisar [ferramentas existentes](https://example.com)

## Implementação
### Escrever módulo `core`
### Adicionar testes
- Testes unitários
- Testes de integração

## Documentação
### Referência de API
### Guia do usuário
```text
````

Itens de lista sob um título se tornam nós filhos desse título.

### Demonstração ao vivo

Aqui está um markmap interativo renderizado diretamente nesta página — experimente fazer panorâmica, zoom e recolher nós:

```markmap
# VMark Features

## Editor
### WYSIWYG Mode
### Source Mode
### Focus Mode
### Typewriter Mode

## AI Integration
### MCP Server
### AI Genies
### Smart Paste

## Markdown
### Mermaid Diagrams
### Markmap Mindmaps
### LaTeX Math
### Code Blocks
- Syntax highlighting
- Line numbers

## Platform
### macOS
### Windows
### Linux
```

## Recursos Interativos

| Ação | Como |
|------|------|
| **Pan** | Role ou clique e arraste |
| **Zoom** | `Cmd`/`Ctrl` + scroll |
| **Colapsar nó** | Clique no círculo em um ponto de ramo |
| **Expandir nó** | Clique no círculo novamente |
| **Ajustar à visualização** | Clique no botão de ajuste (canto superior direito ao passar o mouse) |

## Integração de Tema

Os mapas mentais Markmap se adaptam automaticamente ao tema atual do VMark (White, Paper, Mint, Sepia ou Night). As cores dos ramos se ajustam para legibilidade em todos os temas.

## Exportar como PNG

Passe o mouse sobre um mapa mental renderizado no modo WYSIWYG para revelar um botão de **exportação**. Clique nele para escolher um tema:

| Tema | Fundo |
|------|-------|
| **Claro** | Fundo branco |
| **Escuro** | Fundo escuro |

O mapa mental é exportado como um PNG de resolução 2x via diálogo de salvamento do sistema.

## Dicas

### Markmap vs Mermaid Mindmap

O VMark suporta tanto o Markmap quanto o tipo de diagrama `mindmap` do Mermaid:

| Recurso | Markmap | Mermaid Mindmap |
|---------|---------|-----------------|
| Formato de entrada | Markdown padrão | DSL Mermaid |
| Interatividade | Pan, zoom, colapso | Imagem estática |
| Conteúdo rico | Links, negrito, código, listas | Somente texto |
| Melhor para | Árvores grandes e interativas | Diagramas estáticos simples |

Use o **Markmap** quando quiser interatividade ou já tiver conteúdo Markdown. Use o **Mermaid mindmap** quando precisar junto com outros diagramas Mermaid.

### Aprendendo Mais

- **[Documentação do Markmap](https://markmap.js.org/)** — Referência oficial
- **[Playground do Markmap](https://markmap.js.org/repl)** — Playground interativo para testar mapas mentais
