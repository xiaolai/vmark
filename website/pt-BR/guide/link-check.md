# Verificação de Links

O VMark verifica se os destinos de links e imagens locais no seu markdown realmente existem no disco. A verificação roda em conjunto com o [motor de lint de markdown](/pt-BR/guide/lint) ao usar `Cmd-Shift-L` ou **Ferramentas → Verificar Markdown**.

## O que é verificado

Para cada link e imagem locais no documento:

- `[texto](./outro.md)` — o arquivo `./outro.md` é resolvido e existe
- `![alt](./imagem.png)` — o arquivo de imagem existe
- `[texto](./outro.md#secao)` — o arquivo existe (a verificação da âncora é feita pela [regra `linkFragments`](/pt-BR/guide/lint#referencia-de-regras))

Quando um destino está ausente, o texto do link é sublinhado com um traçado ondulado vermelho e uma entrada aparece no indicador de lint / navegação por F2.

## O que é ignorado

- **Links somente de fragmento** (`#ancora`) — tratados pela regra `linkFragments`, que verifica em relação aos cabeçalhos do documento atual
- **URLs externas** — `http://`, `https://`, `ftp://`, `mailto:`, `tel:`, `data:`, `file:`
- **Documentos sem título** — sem um caminho de arquivo salvo, URLs relativas não podem ser resolvidas em relação a nenhum diretório

## Como funciona a resolução

A Verificação de Links resolve caminhos relativos ao diretório do arquivo de origem:

| Link em `/repo/docs/intro.md` | Resolve para |
|-------------------------------|--------------|
| `[a](./outro.md)` | `/repo/docs/outro.md` |
| `[a](../compartilhado.md)` | `/repo/compartilhado.md` |
| `[a](images/logo.png)` | `/repo/docs/images/logo.png` |
| `[a](/docs/intro.md)` | `/repo/docs/docs/intro.md` (tratado como relativo dentro do diretório do arquivo) |

Os fragmentos são removidos antes da consulta ao arquivo — `[a](./outro.md#secao)` verifica apenas `./outro.md`.

## Desempenho

- **Assíncrono** — roda em paralelo com as regras síncronas; os resultados se incorporam quando ficam prontos
- **Deduplicado** — cada caminho resolvido único é verificado uma vez por execução, mesmo que esteja vinculado várias vezes
- **Sem disparo a cada tecla** — `fs.exists` a cada tecla causaria estresse no sistema; só roda no acionamento explícito do lint
- **Tolerância a erros operacionais** — se `fs.exists` lançar (permissão negada, problema de escopo de capability), o resultado é `error` (ignorado), não `missing`. Melhor silencioso do que errado.

## Códigos de diagnóstico

| Código | Severidade | Acionador |
|--------|------------|-----------|
| **M001** | Erro | Arquivo de imagem não encontrado no caminho local resolvido |
| **M002** | Erro | Arquivo vinculado não encontrado no caminho local resolvido |

## Veja também

- [Lint de Markdown](/pt-BR/guide/lint) — referência completa de regras
- [Configurações → Markdown → Lint](/pt-BR/guide/settings#lint)
