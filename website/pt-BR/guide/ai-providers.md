# Provedores de IA

Os [Gênios de IA](/pt-BR/guide/ai-genies) do VMark precisam de um provedor de IA para gerar sugestões. Você pode usar uma ferramenta CLI instalada localmente ou conectar diretamente a uma API REST.

## Configuração Rápida

A maneira mais rápida de começar:

1. Abra **Configurações > Integrações**
2. Clique em **Detectar** para verificar as ferramentas CLI instaladas
3. Se um CLI for encontrado (por exemplo, Claude, Gemini), selecione-o — pronto
4. Se nenhum CLI estiver disponível, escolha um provedor REST, insira sua chave de API e selecione um modelo

Apenas um provedor pode estar ativo por vez.

## Provedores CLI

Os provedores CLI usam ferramentas de IA instaladas localmente. O VMark as executa como subprocessos e transmite a saída de volta ao editor.

| Provedor | Comando CLI | Instalação |
|----------|-------------|------------|
| Claude | `claude` | [Claude Code](https://docs.anthropic.com/en/docs/claude-code) |
| Codex | `codex` | [OpenAI Codex CLI](https://github.com/openai/codex) |
| Gemini | `gemini` | [Google Gemini CLI](https://github.com/google-gemini/gemini-cli) |
### Como Funciona a Detecção de CLI

Clique em **Detectar** em Configurações > Integrações. O VMark pesquisa seu `$PATH` para cada comando CLI e informa a disponibilidade. Se um CLI for encontrado, seu botão de rádio fica selecionável. **Detectar** faz uma nova varredura a cada clique; a detecção automática (ao iniciar o app, ao abrir as Configurações e no seletor de provedor do seletor de gênios) reaproveita a última varredura. A varredura usa o `$PATH` que o VMark leu do seu shell de login ao iniciar, então um CLI instalado em um diretório recém-adicionado ao `$PATH` exige reiniciar o VMark antes que **Detectar** consiga encontrá-lo.

### Vantagens

- **Sem necessidade de chave de API** — o CLI gerencia a autenticação usando seu login existente
- **Dramaticamente mais barato** — as ferramentas CLI usam seu plano de assinatura (por exemplo, Claude Max, ChatGPT Plus/Pro, Google One AI Premium), que tem uma taxa mensal fixa. Os provedores de API REST cobram por token e podem custar 10–30x mais para uso intensivo
- **Usa sua configuração de CLI** — preferências de modelo, prompts de sistema e faturamento são gerenciados pelo próprio CLI
::: tip Assinatura vs API para Desenvolvedores
Se você também usa essas ferramentas para programação com IA (Claude Code, Codex CLI, Gemini CLI), a mesma assinatura cobre tanto os Gênios de IA do VMark quanto suas sessões de programação — sem custo extra.
:::

### Configuração: Claude CLI

1. Instale o Claude Code: `npm install -g @anthropic-ai/claude-code`
2. Execute `claude` uma vez no seu terminal para autenticar
3. No VMark, clique em **Detectar** e selecione **Claude**

### Configuração: Gemini CLI

1. Instale o Gemini CLI: `npm install -g @google/gemini-cli` (ou via o [repositório oficial](https://github.com/google-gemini/gemini-cli))
2. Execute `gemini` uma vez para autenticar com sua conta Google
3. No VMark, clique em **Detectar** e selecione **Gemini**

## Provedores de API REST

Os provedores REST se conectam diretamente a APIs de nuvem (ou locais). Cada um requer um endpoint, chave de API e nome de modelo. As respostas chegam de uma só vez quando a solicitação termina — provedores REST não transmitem tokens em streaming; provedores CLI sim.

| Provedor | Endpoint Padrão | Variável de Ambiente |
|----------|----------------|---------------------|
| Anthropic | `https://api.anthropic.com` | `ANTHROPIC_API_KEY` |
| OpenAI | `https://api.openai.com` | `OPENAI_API_KEY` |
| Compatível com OpenAI | *(você define)* | — |
| Google AI | *(integrado)* | `GOOGLE_API_KEY` ou `GEMINI_API_KEY` |
| Ollama (API) | `http://localhost:11434` | — |

### Campos de Configuração

Quando você seleciona um provedor REST, três campos aparecem:

- **Endpoint da API** — A URL base (oculta para Google AI, que usa um endpoint fixo). Um `/v1` no final não tem problema — o VMark o normaliza para que o caminho não fique duplicado (por exemplo, `https://host/v1` e `https://host` funcionam)
- **Chave de API** — Sua chave secreta. Ela fica no repositório de credenciais do seu sistema operacional, nunca no `localStorage` nem em um arquivo de configurações em texto simples — veja [Onde ficam as chaves de API](#onde-ficam-as-chaves-de-api)
- **Modelo** — O identificador do modelo (por exemplo, `claude-sonnet-4-5-20250929`, `gpt-4o`, `gemini-2.0-flash`)

### Preenchimento Automático de Variáveis de Ambiente

O VMark lê variáveis de ambiente padrão do ambiente do próprio processo. Se `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` ou `GOOGLE_API_KEY` / `GEMINI_API_KEY` (verificadas nessa ordem) estiver definida, o campo de chave de API é preenchido automaticamente ao selecionar esse provedor.

Quais variáveis o VMark enxerga depende de como ele foi iniciado. Uma chave exportada em um perfil de shell como `~/.zshrc` ou `~/.bashrc`:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

só chega ao VMark quando você abre o aplicativo a partir desse shell. Iniciado pelo Dock, pelo Finder, pelo Spotlight ou por um lançador da área de trabalho, o VMark não lê seu perfil de shell, então o campo fica vazio — cole a chave. No Windows, uma variável de ambiente de usuário ou de sistema funciona independentemente de como o VMark é iniciado.

### Configuração: Anthropic (REST)

1. Obtenha uma chave de API em [console.anthropic.com](https://console.anthropic.com)
2. Em Configurações > Integrações do VMark, selecione **Anthropic**
3. Cole sua chave de API
4. Escolha um modelo (padrão: `claude-sonnet-4-5-20250929`)

### Configuração: OpenAI (REST)

1. Obtenha uma chave de API em [platform.openai.com](https://platform.openai.com)
2. Em Configurações > Integrações do VMark, selecione **OpenAI**
3. Cole sua chave de API
4. Escolha um modelo (padrão: `gpt-4o`)

### Configuração: Compatível com OpenAI (DeepSeek, Groq, OpenRouter, …)

Muitos provedores falam o mesmo protocolo que a OpenAI (`/v1/chat/completions`, autenticação `Bearer`). O slot **Compatível com OpenAI** se conecta a qualquer um deles — DeepSeek, Groq, OpenRouter, Together, Moonshot, um gateway auto-hospedado e assim por diante — sem precisar de uma entrada por fornecedor.

Ele acrescenta um campo extra em relação aos outros provedores REST: um **Nome do provedor** editável, para que a linha mostre "DeepSeek" (ou o que você definir) em vez do rótulo genérico.

Exemplo — DeepSeek:

1. Obtenha uma chave de API em [platform.deepseek.com](https://platform.deepseek.com)
2. Em Configurações > Integrações do VMark, selecione **Compatível com OpenAI**
3. Defina **Nome do provedor** como `DeepSeek` (opcional, apenas visual)
4. Defina **Endpoint da API** como `https://api.deepseek.com` (um `/v1` no final não tem problema — o VMark o normaliza)
5. Cole sua chave de API
6. Defina **Modelo** como `deepseek-chat` (ou `deepseek-reasoner`). Digite-o diretamente ou clique em atualizar para buscar a lista de modelos do endpoint

O endpoint é obrigatório — não há host padrão para este slot. Use os botões **Testar chave de API** (⚡) e **Testar modelo** (🧪) para confirmar a conectividade antes de executar um gênio.

### Configuração: Google AI (REST)

1. Obtenha uma chave de API em [aistudio.google.com](https://aistudio.google.com)
2. Em Configurações > Integrações do VMark, selecione **Google AI**
3. Cole sua chave de API
4. Escolha um modelo (padrão: `gemini-2.0-flash`)

### Configuração: Ollama API (REST)

Use isso quando quiser acesso no estilo REST a uma instância local do Ollama, ou quando o Ollama estiver rodando em outra máquina na sua rede.

1. Certifique-se de que o Ollama está em execução: `ollama serve`
2. Em Configurações > Integrações do VMark, selecione **Ollama (API)**
3. Defina o endpoint como `http://localhost:11434` (ou seu host Ollama)
4. Deixe a chave de API vazia
5. Defina o modelo para o nome do seu modelo baixado (por exemplo, `llama3.2`)

## Escolhendo um Provedor

| Situação | Recomendação |
|----------|-------------|
| Já tem o Claude Code instalado | **Claude (CLI)** — zero configuração, usa sua assinatura |
| Já tem Codex ou Gemini instalado | **Codex / Gemini (CLI)** — usa sua assinatura |
| Precisa de privacidade / offline | Instale o Ollama → **Ollama (API)** em `http://localhost:11434` |
| Modelo personalizado ou auto-hospedado | **Ollama (API)** com seu endpoint |
| DeepSeek / Groq / OpenRouter / qualquer API compatível com OpenAI | **Compatível com OpenAI** — defina o endpoint, a chave e o modelo |
| Quer a opção de nuvem mais barata | **Qualquer provedor CLI** — assinatura é dramaticamente mais barata que API |
| Sem assinatura, uso leve apenas | Defina a variável de ambiente da chave de API → **provedor REST** (pague por token) |
| Precisa da maior qualidade de saída | **Claude (CLI)** ou **Anthropic (REST)** com `claude-sonnet-4-5-20250929` |

## Substituição de Modelo por Gênio

Gênios individuais podem substituir o modelo padrão do provedor usando o campo `model` no frontmatter:

```markdown
---
name: quick-fix
description: Correção rápida de gramática
scope: selection
model: claude-haiku-4-5-20251001
---
```

Isso é útil para encaminhar tarefas simples para modelos mais rápidos/baratos enquanto mantém um padrão poderoso.

## Confiabilidade e timeouts

O VMark protege cada chamada de provedor para que um CLI travado ou uma resposta de API malformada nunca bloqueie o editor:

- **Timeout de subprocesso CLI**: toda invocação de provedor CLI é executada sob um timeout de execução. Se o CLI não responder, o VMark cancela a chamada, retorna o erro ao gênio e libera o worker — o pool de threads não pode ser bloqueado por um subprocesso descontrolado.
- **Segurança no parse de JSON REST**: se um provedor REST retornar um formato de resposta inesperado (página de erro HTML, JSON truncado, deriva de esquema após uma mudança upstream), o VMark exibe um erro tipado no frontend em vez de deixar o listener de IA esperando indefinidamente. Você verá o erro no banner de status do gênio com a opção de tentar novamente.
- **Tokens de cancelamento**: etapas longas de gênio ou workflow podem ser canceladas a qualquer momento — clique em Cancelar no seletor de gênio ou feche o painel e a requisição em andamento é abortada de forma limpa.
- **Cliente HTTP compartilhado**: provedores REST compartilham um único cliente `reqwest` com pool de conexões, então execuções consecutivas de gênio não pagam o custo do handshake TCP/TLS a cada vez.
- **Descoberta de caminho no Windows**: no Windows, o VMark lê o `PATH` completo do usuário (incluindo entradas exclusivas do PowerShell) ao detectar CLIs, então ferramentas instaladas pelo usuário que funcionam em um terminal também funcionam dentro do VMark.

## Onde ficam as chaves de API

As chaves de API ficam no repositório de credenciais do sistema operacional — Keychain do macOS, Gerenciador de Credenciais do Windows ou Secret Service do Linux — sob o nome de serviço `app.vmark.secrets`, uma entrada por provedor. O VMark mantém uma cópia na memória apenas durante a sessão em execução; as configurações de provedor persistidas nunca contêm uma chave, e nada é gravado no `localStorage`. Uma chave salva por uma versão mais antiga do VMark em um arquivo de configurações em texto simples é movida para o chaveiro na primeira vez que a versão mais nova a carrega, e a cópia em texto simples só é descartada depois que a gravação no chaveiro foi lida de volta com sucesso.

Se o chaveiro recusar uma gravação, o VMark mostra um aviso de erro em vez de manter a chave silenciosamente na memória. No macOS, uma build de desenvolvimento com assinatura ad hoc pode pedir acesso ao chaveiro de novo após cada nova assinatura; uma build de lançamento pede uma única vez.

## Notas de Segurança

- **As chaves de API ficam no chaveiro do sistema** — veja acima; elas nunca são gravadas nos arquivos de configuração do VMark nem no `localStorage`
- **Variáveis de ambiente** são lidas quando você seleciona um provedor e só preenchem um campo de chave vazio
- **Provedores CLI** usam sua autenticação CLI existente — o VMark nunca vê suas credenciais
- **Todas as solicitações vão diretamente** da sua máquina para o provedor — sem servidores VMark no caminho

## Solução de Problemas

**"Nenhum provedor de IA disponível"** — Clique em **Detectar** para verificar CLIs, ou configure um provedor REST com uma chave de API.

**CLI mostra "Não encontrado"** — O CLI não está no seu `$PATH`. Instale-o ou verifique seu perfil de shell. No macOS, aplicativos GUI podem não herdar o `$PATH` do terminal — tente adicionar o caminho a `/etc/paths.d/`.

**CLI trava / sem resposta** — O timeout de execução do VMark cancelará a chamada automaticamente; você verá um erro no banner de status do gênio. Se um CLI específico atinge consistentemente o timeout, execute-o uma vez no terminal para confirmar que funciona lá e verifique se ele requer autenticação interativa.

**Provedor REST retorna 401** — Sua chave de API é inválida ou expirou. Gere uma nova no console do provedor.

**Provedor REST retorna 429** — Você atingiu um limite de taxa. Aguarde um momento e tente novamente, ou mude para um provedor diferente.

**Provedor REST retorna JSON inválido / inesperado** — O VMark exibe um erro de parse tipado (ex.: "list_models returned an unexpected response shape"). Verifique a URL do endpoint e se o contrato da API corresponde ao tipo de provedor selecionado; alguns gateways auto-hospedados anunciam URLs compatíveis com OpenAI mas retornam um esquema diferente.

**Respostas lentas** — Provedores CLI adicionam overhead de subprocesso. Para respostas mais rápidas, use provedores REST que se conectam diretamente. Para a opção local mais rápida, use o Ollama com um modelo pequeno.

**Erro de modelo não encontrado** — O identificador do modelo não corresponde ao que o provedor oferece. Verifique os documentos do provedor para nomes de modelos válidos.

## Veja Também

- [Gênios de IA](/pt-BR/guide/ai-genies) — Como usar a assistência de escrita com IA
- [Configuração MCP](/pt-BR/guide/mcp-setup) — Integração de IA externa via Model Context Protocol
