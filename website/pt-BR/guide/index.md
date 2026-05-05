# Primeiros Passos com o VMark

O VMark é um editor Markdown local com modos de edição duplos, ferramentas de formatação ricas e excelente suporte para CJK (Chinês/Japonês/Coreano).

## Início Rápido

1. **Baixe e instale** o VMark na [página de download](/pt-BR/download)
2. **Inicie o aplicativo** e comece a escrever imediatamente
3. **Abra um arquivo** com `Cmd/Ctrl + O` ou arraste e solte um arquivo `.md`
4. **Abra uma pasta** com `Cmd/Ctrl + Shift + O` para o modo de área de trabalho

## Visão Geral da Interface

### Áreas Principais

- **Editor**: A área de escrita principal onde você cria seus documentos
- **Barra Lateral**: Navegação na árvore de arquivos (alternar com `Ctrl + Shift + 2`)
- **Esboço**: Visualização da estrutura do documento (alternar com `Ctrl + Shift + 1`)
- **Barra de Status**: Contagem de palavras, contagem de caracteres e status de salvamento automático (alternar com `F7`)
- **Terminal**: Painel de shell integrado (alternar com `` Ctrl + ` ``)

### Barra de Menu

- **Arquivo**: Operações de novo, abrir, salvar, exportar
- **Editar**: Desfazer/refazer, área de transferência, localizar/substituir, histórico de documentos
- **Bloco**: Títulos, listas, citações, operações de linha
- **Formatar**: Estilos de texto, links, transformações de texto
- **Visualizar**: Modos de editor, barra lateral, modos de foco/máquina de escrever
- **Ferramentas**: Limpeza de texto, formatação CJK, gerenciamento de imagens

### Modos de Edição

O VMark suporta dois modos de edição entre os quais você pode alternar:

| Modo | Descrição | Atalho |
|------|-----------|--------|
| Texto Rico | Edição WYSIWYG com formatação ao vivo | Padrão |
| Fonte | Markdown bruto com realce de sintaxe | `F6` |

### Modos de Visualização

Aprimore seu foco de escrita com estes modos de visualização:

| Modo | Descrição | Atalho |
|------|-----------|--------|
| Foco | Destacar parágrafo atual | `F8` |
| Máquina de Escrever | Manter cursor centralizado | `F9` |
| Quebra de Linha | Alternar quebra de linha | `Alt + Z` |

## Formatação Básica

### Estilos de Texto

| Estilo | Sintaxe | Atalho |
|--------|---------|--------|
| **Negrito** | `**texto**` | `Cmd/Ctrl + B` |
| *Itálico* | `*texto*` | `Cmd/Ctrl + I` |
| ~~Tachado~~ | `~~texto~~` | `Cmd/Ctrl + Shift + X` |
| `Código` | `` `código` `` | `Cmd/Ctrl + Shift + `` ` `` |

### Elementos de Bloco

- **Títulos**: Use símbolos `#` ou `Cmd/Ctrl + 1-6`
- **Listas**: Inicie linhas com `-`, `*`, `1.` ou `- [ ]` para listas de tarefas
- **Citações**: Inicie com `>` ou use `Alt/Option + Cmd + Q`
- **Blocos de código**: Use três acentos graves com linguagem opcional
- **Tabelas**: Use o menu Formatar ou `Cmd/Ctrl + Shift + T`

## Trabalhando com Arquivos

### Criando e Abrindo

- **Novo arquivo**: `Cmd/Ctrl + N`
- **Abrir arquivo**: `Cmd/Ctrl + O`
- **Abrir pasta**: `Cmd/Ctrl + Shift + O` (modo de área de trabalho)

### Salvando

- **Salvar**: `Cmd/Ctrl + S`
- **Salvar como**: `Cmd/Ctrl + Shift + S`
- **Salvamento automático**: Habilitado por padrão, configurável nas configurações

### Exportando

- **Exportar HTML**: Use **Arquivo → Exportar HTML** — inclui VMark Reader interativo
- **Exportar PDF**: Use Imprimir (`Cmd/Ctrl + P`) e salve como PDF
- **Copiar como HTML**: `Cmd/Ctrl + Shift + C`

O HTML exportado inclui o VMark Reader com sumário, painel de configurações e mais. [Saiba mais →](/pt-BR/guide/export)

## Configurações

Abra as configurações com `Cmd/Ctrl + ,` para personalizar:

- **Aparência**: Tema, fontes, tamanho da fonte, altura de linha
- **Editor**: Intervalo de salvamento automático, comportamentos padrão
- **Arquivos e Imagens**: Gerenciamento de ativos, ferramentas de documento
- **Integrações**: Provedores de IA, servidor MCP
- **Idioma**: Regras de formatação CJK
- **Markdown**: Opções de exportação, preferências de formatação
- **Atalhos**: Personalizar atalhos de teclado
- **Terminal**: Tamanho da fonte e altura de linha do terminal

## Assistência de Escrita com IA

O VMark inclui Gênios de IA integrados — selecione texto e pressione `Mod + Y` para polir, expandir, traduzir ou transformar sua escrita com IA. Configure seu provedor preferido em **Configurações > Integrações**.

[Saiba mais sobre Gênios de IA →](/pt-BR/guide/ai-genies) | [Configurar provedores →](/pt-BR/guide/ai-providers)

## Dicas para Começar

1. **Navegue com o esboço**: Clique nos itens do esboço para pular entre seções
2. **Experimente o modo foco**: `F8` esmaece tudo, exceto o parágrafo atual
3. **Valide enquanto escreve**: `Cmd + Shift + L` executa o motor de lint de markdown e a verificação de links quebrados
4. **Aprenda os atalhos**: a referência completa está no [guia de atalhos](/pt-BR/guide/shortcuts)

## Próximos Passos

- Conheça todos os [recursos](/pt-BR/guide/features)
- Domine os [atalhos de teclado](/pt-BR/guide/shortcuts)
- Explore as ferramentas de [formatação CJK](/pt-BR/guide/cjk-formatting)
