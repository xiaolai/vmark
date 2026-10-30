# Privacidade

O VMark é um editor local em primeiro lugar: seus documentos são arquivos no seu disco, a renderização acontece na sua máquina, e não há conta, telemetria nem relatórios de falhas. Esta página lista todas as formas pelas quais o VMark acessa a rede, o que cada uma envia e como desativá-la — e o que o VMark pode ler no seu disco.

## Todas as conexões de rede que o VMark faz

| Quando | Para onde vai | O que é enviado | Como impedir |
|--------|---------------|-----------------|--------------|
| Verificação de atualização — na inicialização, por padrão | `log.vmark.app` e, como alternativa, o GitHub Releases | Plataforma, arquitetura, versão do app e um hash anônimo da máquina — [detalhes abaixo](#a-verificacao-de-atualizacao-em-detalhe) | **Configurações → Sobre → Frequência de verificação → Apenas manual**, ou bloqueie `log.vmark.app` |
| Executar um genie de IA com um **provedor REST** | O endpoint que você configurou — Anthropic, OpenAI, um host compatível com OpenAI, Google AI ou seu host Ollama | O prompt preenchido: o texto, bloco ou documento selecionado, mais qualquer contexto ao redor que o genie pediu, e sua chave de API. Os botões **Testar** e de atualização de modelos também contatam o endpoint | Não configure nenhum provedor, ou use um Ollama local |
| Executar um genie de IA com um **provedor CLI** | Nada vindo do próprio VMark — a CLI `claude`, `codex` ou `gemini` que você instalou fala com o próprio fornecedor, sob a própria conta | O VMark encaminha o prompt para a CLI na sua máquina | Igual ao anterior |
| Exportar HTML | jsDelivr (cdnjs como alternativa) e Google Fonts | Nada — apenas downloads: as fontes matemáticas do KaTeX quando o documento tem matemática, e qualquer fonte web que você escolheu nas Configurações, para que possam ser incorporadas | Exporte sem conexão; a exportação recorre às fontes do sistema |
| Abrir um `index.html` exportado | jsDelivr | Nada — baixa a folha de estilos do KaTeX para documentos com matemática | Use `standalone.html`, que a incorpora |
| Editar um workflow do GitHub Actions | `raw.githubusercontent.com` | O `owner/repo@ref` de cada etapa `uses:`, para buscar seu `action.yml` (cache de 24 h) | Desative **Configurações → Avançado → Buscar metadados de actions** |
| O navegador incorporado | Qualquer site que você — ou, com a sua aprovação, um assistente de IA — abrir | É um navegador web; veja o [guia do navegador](/pt-BR/guide/browser) para a postura da IA, as sessões isoladas e a política de destinos | Desative **Configurações → Avançado → Navegador incorporado** |
| Documentos que referenciam a web | Os hosts citados no seu documento | Imagens remotas e incorporações do YouTube / Vimeo / Bilibili carregam de seus hosts quando renderizadas no editor ou no HTML exportado | Mantenha as imagens locais |

Duas coisas que parecem serviços de rede funcionam apenas em loopback e nunca saem da sua máquina:

- **O servidor MCP** — assistentes de IA se conectam por uma ponte WebSocket vinculada a `127.0.0.1`, autenticada com um token que o VMark guarda no seu diretório de dados do app. O próprio assistente (Claude Desktop, Claude Code, Codex CLI…) fala com o próprio fornecedor; o VMark apenas responde às chamadas de ferramentas dele. Veja [Integração com IA](/pt-BR/guide/mcp-setup).
- **A base de conhecimento e a pré-visualização Slidev** — um servidor local vinculado a `127.0.0.1` com um token por sessão; o [guia da Base de Conhecimento](/pt-BR/guide/knowledge-base#privacidade-e-seguranca) descreve seu isolamento.

O terminal integrado executa o seu próprio shell — qualquer coisa a que ele se conecte é comando seu, não do VMark.

## O que o VMark NÃO Envia

- Seus documentos ou seus conteúdos (exceto para um provedor de IA que você configurou, quando você executa um genie)
- Nomes ou caminhos de arquivo
- Padrões de uso ou análises de recursos
- Informações pessoais de qualquer tipo
- Relatórios de falhas
- Dados de teclas pressionadas ou edição
- Identificadores de hardware reversíveis ou impressões digitais

## A verificação de atualização em detalhe

O **verificador de atualizações automático** do VMark contata nosso servidor para ver se uma nova versão está disponível. Cada verificação envia exatamente estes campos — nada mais:

| Dado | Exemplo | Finalidade |
|------|---------|-----------|
| Endereço IP | `203.0.113.42` | Inerente a qualquer solicitação HTTP — não podemos não recebê-lo |
| SO | `darwin`, `windows`, `linux` | Para servir o pacote de atualização correto |
| Arquitetura | `aarch64`, `x86_64` | Para servir o pacote de atualização correto |
| Versão do app | `0.5.10` | Para determinar se há uma atualização disponível |
| Hash da máquina | `a3f8c2...` (hex de 64 caracteres) | Contador anônimo de dispositivos — SHA-256 do hostname + SO + arch; não reversível |

A URL completa fica assim:

```text
GET https://log.vmark.app/update/latest.json?target=darwin&arch=aarch64&version=0.5.10
X-Machine-Id: a3f8c2b1d4e5f6078a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1
```

Se esse servidor não puder ser alcançado, o atualizador tenta o mesmo manifesto no GitHub Releases (`github.com/xiaolai/vmark/releases/latest/download/latest.json`). As próprias atualizações são verificadas com uma assinatura minisign antes de serem instaladas.

Você pode verificar isso por conta própria — os endpoints estão em [`tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json) (pesquise por `"endpoints"`), e o hash está em [`app_setup.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/app_setup.rs) (pesquise por `machine_id_hash`).

### Como Usamos os Dados

Agregamos os logs de verificação de atualização para produzir as estatísticas ao vivo mostradas em nossa [página inicial](/pt-BR/):

| Métrica | Como é calculada |
|---------|-----------------|
| **Dispositivos únicos** | Contagem de hashes de máquina distintos por dia/semana/mês |
| **IPs únicos** | Contagem de endereços IP distintos por dia/semana/mês |
| **Pings** | Número total de solicitações de verificação de atualização |
| **Plataformas** | Contagem de pings por combinação de SO + arquitetura |
| **Versões** | Contagem de pings por versão do app |

Esses números são publicados abertamente em [`log.vmark.app/api/stats`](https://log.vmark.app/api/stats). Nada está oculto.

**Ressalvas importantes:**
- IPs únicos subestimam os usuários reais — várias pessoas atrás do mesmo roteador/VPN contam como uma
- Dispositivos únicos fornecem contagens mais precisas, mas uma mudança de hostname ou instalação nova do SO gera um novo hash
- Pings superestimam os usuários reais — uma pessoa pode verificar várias vezes por dia

### Retenção de Dados

- Os logs são armazenados no nosso servidor no formato de log de acesso padrão
- Os arquivos de log rotacionam em 1 MB e apenas os 3 arquivos mais recentes são mantidos
- Os logs não são compartilhados com ninguém
- Não há sistema de conta — o VMark não sabe quem você é
- O hash da máquina não está vinculado a nenhuma conta, e-mail ou endereço IP — é apenas um contador pseudônimo de dispositivos
- Não usamos cookies de rastreamento, impressão digital ou qualquer SDK de análise

### Desabilitando Verificações de Atualização

Defina **Configurações → Sobre → Frequência de verificação** como **Apenas manual** e o VMark nunca contatará o servidor de atualização por conta própria; **Verificar agora** continua funcionando quando você quiser. Para ter certeza no nível da rede, bloqueie `log.vmark.app` (firewall, `/etc/hosts` ou DNS) — o VMark continua funcionando normalmente sem isso; você apenas não receberá notificações de atualização.

## Onde as chaves de API são armazenadas

As chaves de API dos provedores de IA REST ficam no repositório de credenciais do sistema operacional — Keychain do macOS, Gerenciador de Credenciais do Windows ou Secret Service do Linux — sob o nome de serviço `app.vmark.secrets`. Elas nunca são gravadas nos arquivos de configuração do VMark nem no `localStorage`, e as configurações de provedor persistidas pelo app são salvas sem a chave. As chaves são enviadas apenas ao endpoint do provedor que você configurou, quando você executa um genie ou pressiona **Testar**. Detalhes em [Provedores de IA](/pt-BR/guide/ai-providers#onde-ficam-as-chaves-de-api).

## O que um assistente de IA pode alcançar

Um assistente conectado via MCP age apenas dentro do que você já abriu: suas operações de arquivo ficam restritas à raiz da área de trabalho aberta e às pastas dos documentos abertos no VMark, e um pedido fora desse limite é recusado. Salvar um documento em um caminho **novo** exige a configuração **Aprovar automaticamente salvamentos em um novo local e resultados de gênios** (desativada por padrão) — caso contrário, a chamada é recusada e o VMark mostra um aviso com o nome do arquivo; mesmo com ela ativada, um assistente nunca pode sobrescrever dessa forma um outro arquivo já existente. Abrir uma área de trabalho que ele indique pede a sua confirmação primeiro. Toda escrita da IA em um documento é registrada antes no histórico de edições, para que você possa restaurar o que havia antes ([pontos de verificação de edição](/pt-BR/guide/mcp-setup#pontos-de-verificacao-de-edicao)). O navegador incorporado tem seu próprio modelo de aprovação, descrito no [guia do navegador](/pt-BR/guide/browser).

## O Que o VMark Pode Ler no Disco

O acesso do VMark a arquivos é um escopo de permissões restrito, não o disco inteiro:

- **Escopo estático**: sua pasta pessoal (`$HOME/**`) mais os volumes montados — `/Volumes/**` no macOS, `/mnt/**` e `/media/**` no Linux. No Windows ele também cobre as unidades de `C:\` a `F:\`, então só `G:\` e as unidades seguintes, além de compartilhamentos de rede, precisam de uma permissão em tempo de execução. No macOS e no Linux, tudo o que está dentro de uma pasta oculta (cujo nome começa com `.`) fica fora do escopo estático.
- **Permissões em tempo de execução**: um arquivo que você abre explicitamente — pelo Finder ou pelo Explorador de Arquivos, pela linha de comando `vmark` ou por uma caixa de diálogo de arquivos — recebe uma permissão apenas para esse arquivo. Uma **pasta** só recebe permissão quando o VMark consegue saber que foi você quem a escolheu: você a selecionou na caixa de diálogo de pastas do VMark ou a abriu pelo Finder. O VMark mantém uma lista dessas pastas (`workspace-grants.json` na pasta de dados do app) e concede a permissão de novo a cada inicialização, para que sua sessão restaurada e **Abrir recente** continuem funcionando. Um espaço de trabalho recente que não está nessa lista, e que o escopo estático não cobre, abre a caixa de diálogo de pastas nessa pasta — escolha-a para confirmar. Quando um assistente de IA pede para abrir uma pasta assim, o VMark faz o mesmo depois que você aprova o pedido.
- **Imagens e mídia**: imagens, vídeos e áudios locais são exibidos pelo protocolo de recursos do VMark, que alcança os mesmos lugares — o escopo estático mais as permissões em tempo de execução acima. O visualizador de mídia adiciona uma permissão para o único arquivo que exibe, e somente para um arquivo com extensão de mídia; um pedido para qualquer outro caminho é recusado em vez de ampliar o escopo. Uma imagem fora desses lugares, como uma ao lado de um documento que você abriu sozinho de fora do escopo estático, não é exibida até que você abra a pasta dela como espaço de trabalho.

Nada disso é enviado a lugar algum; o escopo decide o que o próprio app pode ler.

## Transparência de Código Aberto

O VMark é totalmente de código aberto. Você pode verificar tudo descrito aqui:

- Configuração do endpoint de atualização: [`src-tauri/tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json)
- Geração do hash da máquina: [`src-tauri/src/app_setup.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/app_setup.rs) — pesquise por `machine_id_hash`
- Escopo do sistema de arquivos e de recursos: [`src-tauri/capabilities/default.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/capabilities/default.json), a entrada `assetProtocol` em [`src-tauri/tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json), [`src-tauri/src/fs_scope.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/fs_scope.rs) e [`src-tauri/src/workspace/grants/`](https://github.com/xiaolai/vmark/tree/main/src-tauri/src/workspace/grants)
- Armazenamento no Keychain: [`src-tauri/src/secure_store.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/secure_store.rs)
- Agregação de estatísticas no lado do servidor: [`scripts/vmark-stats-json`](https://github.com/xiaolai/vmark/blob/main/scripts/vmark-stats-json) — o script exato que roda no nosso servidor para produzir as [estatísticas públicas](https://log.vmark.app/api/stats)
- Os pontos do código que fazem chamadas de rede são os listados acima — pesquise no repositório por `reqwest` (Rust) e `fetch(` (TypeScript) para conferir você mesmo

## Relatar um problema de segurança

Se você encontrar uma vulnerabilidade no VMark, por exemplo na ponte MCP, no navegador incorporado, no atualizador ou no tratamento de arquivos, relate-a em particular pelo [relato privado de vulnerabilidades do GitHub](https://github.com/xiaolai/vmark/security/advisories/new) em vez de abrir uma issue pública. A [política de segurança](https://github.com/xiaolai/vmark/blob/main/SECURITY.md) informa o que está no escopo e o que esperar.
