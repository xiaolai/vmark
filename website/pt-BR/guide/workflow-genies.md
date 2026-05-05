<script setup>
// Skip Vue template processing for the whole page so ${{ }} expressions
// in code spans and fenced YAML blocks don't get interpreted.
</script>

<div v-pre>

# Genies de Workflow

Os Genies do VMark vêm em dois formatos:

- **Genies em Markdown** (`.md`) — modelos de prompt de disparo único. O formato original de Genie. Veja [AI Genies](/pt-BR/guide/ai-genies).
- **Genies de workflow** (`.yml` / `.yaml`) — pipelines de várias etapas que encadeiam genies em Markdown com fluxo de dados explícito.

Ambos os formatos vivem no mesmo diretório global de genies e aparecem no mesmo seletor (`Cmd+Y`). Um genie de workflow é exibido como uma linha comum de Genie; ao selecioná-lo, o executor de workflow é iniciado em vez da chamada de IA de uma única etapa.

## Quando usar cada um

| Necessidade | Formato |
|------|--------|
| Transformação única (reescrever, traduzir, resumir) | Markdown |
| Pipeline de esboço → rascunho → polimento | Workflow |
| Modelos de IA diferentes para etapas diferentes | Workflow |
| Etapas que precisam de aprovação | Workflow |
| Saída de uma etapa alimenta a próxima | Workflow |

Se um único prompt for suficiente, use um genie em Markdown. Se você precisar compor estágios, fluxo de dados estruturado ou aprovação humana no meio do processo, use um workflow.

## Formato de arquivo

Um genie de workflow é um arquivo YAML. Campos de nível superior:

| Campo | Obrigatório | Função |
|-------|----------|---------|
| `name` | Sim | Rótulo legível por humanos. O seletor usa o **nome do arquivo** como nome de exibição; este campo aparece como descrição se nenhum `description:` for definido. |
| `description` | Não | Resumo de uma linha mostrado no seletor. |
| `defaults` | Não | Modelo / aprovação / limites padrão aplicados a cada etapa. |
| `env` | Não | Variáveis de ambiente disponíveis como `${VAR}` ou `${{ env.NAME }}`. |
| `steps` | Sim | Lista ordenada de etapas. |

### Estrutura de uma etapa

```yaml
- id: my-step
  uses: genie/<name>     # ou action/<name>
  with:
    input: "texto ou expressão"
  needs: prior-step      # opcional; também pode ser uma lista
  approval: ask          # opcional; "auto" (padrão) ou "ask"
  model: claude-sonnet   # opcional; sobrepõe os defaults
  limits:
    timeout: 120s        # padrão 300s
    max_tokens: 4096     # apenas provedores REST
```

### Tipos de etapa

| Prefixo `uses:` | Comportamento |
|----------------|----------|
| `genie/<name>` | Carrega o genie em Markdown correspondente, preenche seu template com o mapa `with:` da etapa e chama o provedor de IA ativo. Os marcadores `{{content}}` / `{{input}}` do genie em Markdown captam `with.input` automaticamente. |
| `action/read-file` | Lê um caminho relativo ao workspace. A saída é o conteúdo do arquivo. |
| `action/save-file` | Grava `with.input` em `with.path`. |
| `action/notify` | Registra `with.message`. |
| `action/copy` | Retorna `with.input` sem alterações (útil para encadeamento). |

### Expressões

Dentro de qualquer valor `with:`:

| Sintaxe | Resolve para |
|--------|-------------|
| `${{ steps.ID.outputs.FIELD }}` | Um campo de saída específico de uma etapa anterior. |
| `${{ steps.ID.output }}` | Açúcar sintático para `outputs.text` de uma etapa anterior. |
| `${{ env.NAME }}` | Um valor de `env:` do workflow. |
| `${VAR}` | Equivalente ao anterior, forma legada. |
| `stepId.output` (string completa) | Alias legado para `${{ steps.stepId.output }}`. |

Referências a etapas / campos desconhecidos falham a etapa no momento da resolução de parâmetros, antes de qualquer chamada de IA.

### Vinculação do template

Quando uma etapa `genie/<name>` é executada, o template do prompt do genie em Markdown é preenchido conforme estas regras:

- `{{input}}` → `with.input`
- `{{content}}` → `with.content` se presente, caso contrário `with.input` (fatal se nenhum dos dois existir)
- `{{context}}` → `with.context` se presente, caso contrário string vazia (nunca fatal)
- `{{any-other-key}}` → `with.<key>` (fatal se ausente)

Isso significa que **genies em Markdown existentes funcionam sem alterações** em workflows — chame-os com `with: { input: "..." }` e o marcador `{{content}}` o capta via cadeia de aliases.

### Portão de aprovação

Quando uma etapa tem `approval: ask` (ou `defaults.approval: ask` no workflow), o executor pausa, abre uma caixa de diálogo mostrando a pré-visualização do prompt resolvido e o modelo, e aguarda o veredito do usuário antes de chamar o provedor. Esc nega. O timeout é o menor entre `limits.timeout` da etapa e 10 minutos.

## Exemplo

O VMark inclui um workflow de exemplo em `outline-and-polish.yml` nos seus genies empacotados. Copie-o para o seu diretório de genies do usuário para personalizar:

```yaml
name: Outline and Polish
description: Generate an outline, then polish the output for clarity.

defaults:
  approval: auto

steps:
  - id: outline
    uses: genie/outline
    with:
      input: "Replace this seed with your topic."

  - id: polish
    uses: genie/polish
    needs: outline
    with:
      input: ${{ steps.outline.outputs.text }}
```

`genie/outline` produz um esboço estruturado; a etapa `polish` então reescreve essa saída para maior clareza. As duas referências `genie/*` resolvem para os genies em Markdown empacotados em `structure/outline.md` e `editing/polish.md`.

## Cancelamento, timeouts, limites

- **Cancelar** — Clique em Stop no painel lateral do workflow. O executor encerra qualquer processo filho de provedor CLI em andamento dentro de um tick e descarta requisições REST em andamento.
- **Timeout por etapa** — Envolvido em `tokio::time::timeout(step.limits.timeout)`. Quando esgotado, a etapa falha com "Timed out after Xs" e as etapas downstream são puladas.
- **Limite de saída** — A saída de uma única etapa é limitada a 5 MB. Um provedor descontrolado dispara cancelamento + "Provider output exceeded 5 MB cap".

## Veja também

- [AI Genies](/pt-BR/guide/ai-genies) — formato e autoria de genies em Markdown.
- [Visualizador de Workflows](/pt-BR/guide/workflow-viewer) — o mesmo painel lateral React Flow usado aqui, originalmente para workflows do GitHub Actions.

</div>
