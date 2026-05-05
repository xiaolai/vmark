# Lint de Markdown

O VMark traz um motor de lint integrado que detecta **problemas de correção**, não preferências de estilo. O lint é executado sob demanda (Cmd-Shift-L ou **Ferramentas → Verificar Markdown**) e exibe os resultados inline como sublinhados ondulados na medianiz, com um indicador na barra de status e navegação por F2 entre as ocorrências.

## O que o lint é e o que não é

O lint do VMark é um verificador de **correção**:

- Referências cruzadas quebradas
- Referências indefinidas de links / notas de rodapé
- Cercas de código não fechadas
- Tabelas com contagem de colunas inconsistente
- Níveis de cabeçalho que pulam (h1 → h3)
- Imagens sem texto alternativo
- Texto de link vazio ou `href` vazio

O lint do VMark **não** é um verificador de estilo. Ele não sinalizará:

- Comprimento de linha
- Estilo de marcador de lista (`-` vs `*`)
- Estilo de marcador de ênfase (`_` vs `*`)
- Estilo de cabeçalho (`#` vs sublinhado)
- Espaços em branco no final

Para verificação de estilo, use uma ferramenta separada como `prettier --check` fora do VMark.

## Referência de regras

| ID da regra | Severidade | Descrição |
|-------------|------------|-----------|
| **E01** | Erro | Referência indefinida: `[link][missing]` aponta para uma definição que não existe |
| **E02** | Erro | Linha de tabela com contagem de colunas errada (incompatível com a linha de cabeçalho) |
| **E03** | Erro | Link invertido — parece `(texto)[url]` em vez de `[texto](url)` |
| **E04** | Erro | Cabeçalho ATX sem espaço após `#` (ex.: `##Cabeçalho` deveria ser `## Cabeçalho`) |
| **E05** | Erro | Espaço dentro dos marcadores de ênfase — `* palavra *` não será renderizado em itálico |
| **E06** | Erro | Bloco de código cercado não fechado — o arquivo termina com uma cerca ```` ``` ```` aberta |
| **E07** | Erro | Definição de referência de link duplicada (o mesmo `[rótulo]:` aparece duas vezes) |
| **E08** | Erro | `href` de link vazio — `[texto]()` |
| **W01** | Aviso | Nível de cabeçalho pulado (esperava-se h2, encontrou-se h3) |
| **W02** | Aviso | Imagem sem texto alternativo — acessibilidade |
| **W03** | Aviso | Definição de referência de link não usada (definida, mas nunca referenciada) |
| **W04** | Aviso | Fragmento âncora não corresponde a nenhum cabeçalho — `#secao` para uma seção que não existe |
| **W05** | Aviso | Texto de link vazio — `[](url)` |
| **M001** | Erro | Arquivo de imagem não encontrado no caminho local |
| **M002** | Erro | Arquivo vinculado não encontrado no caminho local |
| **Y001** | Erro | Erro de análise YAML (para arquivos YAML) |
| **Y002** | Aviso | Aviso de análise YAML (para arquivos YAML) |

## Como acionar o lint

| Acionador | Ação |
|-----------|------|
| `Cmd + Shift + L` (macOS) / `Ctrl + Shift + L` (Win/Linux) | Executa o lint no documento ativo |
| **Ferramentas → Verificar Markdown** | Igual ao atalho |
| `F2` | Pula para o próximo diagnóstico |
| `Shift + F2` | Pula para o diagnóstico anterior |

Para arquivos markdown com caminhos de arquivo, a verificação de existência de links roda automaticamente junto com as regras síncronas — veja [Verificação de Links](/pt-BR/guide/link-check).

Para arquivos YAML, erros de análise aparecem ao vivo na medianiz conforme você digita, e o mesmo atalho `Cmd-Shift-L` preenche o indicador + a navegação por F2.

## Configurações

O motor de lint tem um único interruptor visível para o usuário:

- **Configurações → Markdown → Habilitar lint de markdown** — liga ou desliga o motor por completo

Quando desabilitado, o atalho vira um no-op e nenhum diagnóstico aparece na medianiz.

## Veja também

- [Verificação de Links](/pt-BR/guide/link-check) — detecção de imagens / links locais quebrados
- [Configurações → Markdown → Lint](/pt-BR/guide/settings#lint)
