# Usuários como Desenvolvedores

Na era das ferramentas de codificação com IA, a linha entre "usuário" e "desenvolvedor" está desaparecendo. Se você pode descrever um bug, pode corrigi-lo. Se você pode imaginar um recurso, pode construí-lo — com um assistente de IA que já entende a base de código.

O VMark abraça essa filosofia. O repositório é enviado com regras de projeto, documentos de arquitetura e convenções pré-carregadas para ferramentas de codificação com IA. Clone o repositório, abra seu assistente de IA e comece a contribuir — a IA já sabe como o VMark funciona.

## Primeiros Passos

1. **Clone o repositório** — A configuração de IA já está no lugar.
2. **Instale sua ferramenta de IA** — [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex CLI](https://github.com/openai/codex) ou [Gemini CLI](https://github.com/google-gemini/gemini-cli).
3. **Abra uma sessão** — A ferramenta lê `AGENTS.md` e as regras automaticamente.
4. **Comece a programar** — A IA conhece as convenções do projeto, requisitos de teste e padrões de arquitetura.

Não é necessária configuração extra. Basta começar a pedir à sua IA para ajudar.

## Guia de Leitura

Novo no desenvolvimento assistido por IA? Estas páginas se complementam:

1. **[Por que Construí o VMark](/pt-BR/guide/users-as-developers/why-i-built-vmark)** — A jornada de um não-programador de scripts a um aplicativo desktop
2. **[Cinco Habilidades Humanas Básicas que Potencializam a IA](/pt-BR/guide/users-as-developers/what-are-indispensable)** — Git, TDD, alfabetização em terminal, inglês e bom gosto — as fundações sobre as quais tudo o mais se constrói
3. **[Por que Modelos Caros São Mais Baratos](/pt-BR/guide/users-as-developers/why-expensive-models-are-cheaper)** — O preço por token é uma métrica de vaidade; o custo por tarefa é o que importa
4. **[Assinatura vs Preços de API](/pt-BR/guide/users-as-developers/subscription-vs-api)** — Por que assinaturas de taxa fixa superam o pagamento por token para sessões de codificação
5. **[Prompts em Inglês Funcionam Melhor](/pt-BR/guide/users-as-developers/prompt-refinement)** — Tradução, refinamento e o gancho `::`
6. **[Verificação entre Modelos](/pt-BR/guide/users-as-developers/cross-model-verification)** — Usando Claude + Codex para auditarem uns aos outros para um código melhor
7. **[Por que Issues, Não PRs](/pt-BR/guide/users-as-developers/why-issues-not-prs)** — Por que aceitamos issues mas não pull requests em uma base de código mantida por IA
8. **[Avaliação de custo e esforço](/pt-BR/guide/users-as-developers/cost-evaluation)** — Quanto custaria construir o VMark com uma equipe humana vs. a realidade do desenvolvimento assistido por IA

Já familiarizado com o básico? Vá para [Verificação entre Modelos](/pt-BR/guide/users-as-developers/cross-model-verification) para o fluxo de trabalho avançado, ou leia como a configuração de IA do VMark funciona internamente.

## Um Arquivo, Cada Ferramenta

Ferramentas de codificação com IA leem cada uma seu próprio arquivo de configuração:

| Ferramenta | Arquivo de configuração |
|-----------|------------------------|
| Claude Code | `CLAUDE.md` |
| Codex CLI | `AGENTS.md` |
| Gemini CLI | `GEMINI.md` |

Manter as mesmas instruções em três lugares é propenso a erros. O VMark resolve isso com uma única fonte de verdade:

- **`AGENTS.md`** — Contém todas as regras do projeto, convenções e notas de arquitetura.
- **`CLAUDE.md`** — Apenas uma linha: `@AGENTS.md` (uma diretiva Claude Code que internaliza o arquivo).
- **Codex CLI** — Lê `AGENTS.md` diretamente.
- **Gemini CLI** — Usa `@AGENTS.md` em `GEMINI.md` para internalizar o mesmo arquivo.

Atualize `AGENTS.md` uma vez, cada ferramenta detecta a mudança.

::: tip O que é `@AGENTS.md`?
O prefixo `@` é uma diretiva Claude Code que internaliza o conteúdo de outro arquivo. É semelhante ao `#include` em C — o conteúdo de `AGENTS.md` é inserido no `CLAUDE.md` nessa posição. Saiba mais em [agents.md](https://agents.md/).
:::

## Usando Codex como Segunda Opinião

O VMark usa verificação entre modelos — Claude escreve o código, então o Codex (um modelo de IA diferente da OpenAI) o audita independentemente. Isso detecta pontos cegos que um único modelo pode perder. Para detalhes completos e instruções de configuração, veja [Verificação entre Modelos](/pt-BR/guide/users-as-developers/cross-model-verification).

## O que a IA Sabe

Quando uma ferramenta de codificação com IA abre o repositório VMark, ela automaticamente recebe:

### Regras do Projeto (`.claude/rules/`)

Esses arquivos são carregados automaticamente em cada sessão Claude Code. Eles cobrem:

| Regra | O que ela impõe |
|-------|-----------------|
| Fluxo de Trabalho TDD | Test-first é obrigatório; limiares de cobertura bloqueiam o build |
| Tokens de Design | Nunca codifique cores — referência completa de tokens CSS incluída |
| Padrões de Componentes | Padrões de popup, barra de ferramentas, menu de contexto com exemplos de código |
| Indicadores de Foco | Acessibilidade: o foco do teclado deve sempre ser visível |
| Tema Escuro | Regras do seletor `.dark-theme`, requisitos de paridade de tokens |
| Atalhos de Teclado | Procedimento de sincronização de três arquivos (Rust, TypeScript, documentos) |
| Incrementos de Versão | Procedimento de atualização de cinco arquivos |
| Convenções da Base de Código | Padrões de store, hook, plugin, teste e importação |

### Skills Personalizadas

Comandos slash dão capacidades especializadas à IA:

| Comando | O que faz |
|---------|-----------|
| `/fix` | Corrigir problemas adequadamente — análise de causa raiz, TDD, sem patches |
| `/fix-issue` | Resolvedor de issues GitHub de ponta a ponta (buscar, ramificar, corrigir, auditar, PR) |
| `/codex-audit` | Auditoria completa de código em 9 dimensões (segurança, correção, conformidade, ...) |
| `/codex-audit-mini` | Verificação rápida em 5 dimensões para pequenas alterações |
| `/codex-verify` | Verificar correções de uma auditoria anterior |
| `/codex-commit` | Mensagens de commit inteligentes a partir da análise de mudanças |
| `/audit-fix` | Auditar, corrigir todos os achados, verificar — repetir até estar limpo |
| `/feature-workflow` | Fluxo de trabalho de ponta a ponta com agentes especializados |
| `/merge-prs` | Revisar e mesclar PRs abertos sequencialmente |
| `/bump` | Incremento de versão em todos os 5 arquivos, commit, tag, push |

### Agentes Especializados

Para tarefas complexas, o Claude Code pode delegar a subagentes focados:

| Agente | Função |
|--------|--------|
| Planejador | Pesquisa melhores práticas, faz brainstorming de casos extremos, produz planos modulares |
| Implementador | Implementação orientada por TDD com investigação prévia |
| Auditor | Revisa diffs para correção e violações de regras |
| Executor de Testes | Executa portões, coordena testes E2E via Tauri MCP |
| Verificador | Lista de verificação final antes do lançamento |

## Substituições Privadas

Nem tudo pertence à configuração compartilhada. Para preferências pessoais:

| Arquivo | Compartilhado? | Finalidade |
|---------|---------------|-----------|
| `AGENTS.md` | Sim | Regras do projeto para todas as ferramentas de IA |
| `CLAUDE.md` | Sim | Ponto de entrada do Claude Code |
| `.claude/settings.json` | Sim | Permissões compartilhadas pela equipe |
| `CLAUDE.local.md` | **Não** | Suas instruções pessoais (no gitignore) |
| `.claude/settings.local.json` | **Não** | Suas configurações pessoais (no gitignore) |

Crie `CLAUDE.local.md` na raiz do projeto para instruções que se aplicam apenas a você — idioma preferido, hábitos de fluxo de trabalho, preferências de ferramentas.
