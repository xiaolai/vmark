# Navegador integrado

O VMark pode hospedar um navegador web real **dentro** de uma janela de documento — uma página da web se torna uma aba de primeira classe ao lado dos seus documentos markdown. É uma webview nativa genuína (o `WKWebView` do macOS), não uma janela externa do Chrome nem um frame incorporado.

::: warning Experimental
O navegador integrado é um recurso em estágio inicial e está disponível **apenas no macOS** nesta versão. O suporte a Windows e Linux virá mais tarde — nessas plataformas, as configurações abaixo não aparecem.
:::


::: info Barra de espaços de trabalho
Com a [barra de espaços de trabalho](/guide/workspace-rail) experimental ativada, as páginas do navegador são **globais na janela**: elas permanecem acessíveis a partir de todos os espaços de trabalho da janela e nunca ficam vinculadas às abas de um único espaço de trabalho.
:::

## Como desativá-lo

O navegador vem **ativado por padrão** no macOS. **Nova aba do navegador** está no menu
**Arquivo** (`Alt + Mod + Shift + B`) e na paleta de comandos — nada precisa ser
ativado antes.

Para desativá-lo, vá em **Configurações → Avançado → macOS** e desative
**Navegador integrado**. Isso também fecha quaisquer abas de navegador abertas e retira a
superfície de automação por IA descrita abaixo.

Duas configurações de postura da IA ficam logo abaixo da chave e aparecem somente enquanto
ela está ativada. Ambas vêm com valores conservadores e não são alteradas pelo fato de o
navegador estar ativado:

| Configuração | Padrão | Significado |
|---|---|---|
| **Sessão da IA** | Sandbox | Páginas controladas pela IA recebem uma sessão isolada em vez de compartilhar a sua sessão com login |
| **Permitir loopback** | Desativado | A navegação da IA para `localhost` / endereços de rede privada é recusada |

As permissões de site não ficam em Configurações — elas ficam na barra lateral do
navegador, na janela que as detém.

## Como usá-lo

Uma aba do navegador abre na área do editor, ao lado dos seus documentos — a barra lateral, a faixa de abas, o terminal e a barra de status permanecem todos onde estão. Seus controles ficam **acima da página**: no macOS, eles compartilham a barra de título da janela, já que o próprio VMark a desenha. Onde é o sistema que desenha a barra de título (Windows, Linux), eles ficam dentro da janela, acima da página, do jeito que todo outro navegador de desktop os organiza.

| Controle | Ação |
|---------|--------|
| ‹ / › | Voltar / avançar. Ficam esmaecidos quando não há para onde ir |
| ⟳ / ✕ | Recarregar ou parar um carregamento em andamento |
| Barra de endereços | Uma **omnibox**: digite uma URL para ir até ela, ou qualquer outra coisa para pesquisar |
| ☆ / ★ | Adicionar esta página aos favoritos |

A barra de endereços acompanha a página automaticamente: se um site redireciona, ou um link leva você para outro lugar, a barra é atualizada para mostrar onde você realmente está.

## A barra lateral acompanha a aba

Quando uma aba do navegador está ativa, a barra lateral mostra o **histórico de navegação** e os **favoritos**. Quando você volta para um documento, ela mostra novamente o explorador de arquivos, o sumário e o histórico de arquivos — automaticamente. Não há um segundo modo para manter sincronizado, e cada lado lembra o que você tinha aberto por último, então uma espiada em uma aba do navegador não custa a árvore de arquivos que você estava usando.

O **histórico** é por janela e existe apenas durante a sessão: nunca é gravado em disco. (Ainda há um botão **Limpar** — "some quando você sai" não é o mesmo que "você pode se livrar dele agora".) Um recarregamento não adiciona uma entrada duplicada, e um site que redireciona você registra a página que você *pretendia* visitar, em vez de cada salto pelo caminho.

Os **favoritos** persistem. Eles são armazenados sob a URL exata que você marcou — a mesma página em seções diferentes (`#install` vs `#usage`) são dois favoritos, e o VMark não vai "arrumar" silenciosamente os parâmetros de consulta de uma URL, porque uma URL reescrita pode não levar você de volta ao que você viu.

## A janela fica neutra ao redor de uma página

Os temas do VMark são intencionalmente tingidos — Paper é um cinza quente, e Mint e Sepia ainda mais. Isso é agradável para escrever, mas errado para envolver a página da web de outra pessoa: uma moldura colorida altera como você percebe cada cor dentro dela, e é por isso que nenhum navegador de verdade tinge sua própria interface.

Assim, quando uma aba do navegador está em foco, a janela ao redor muda para um neutro simples — **branco em um tema claro, escuro em um tema escuro** — e volta ao normal no momento em que você retorna a um documento. Seu tema permanece inalterado; apenas o que envolve uma página da web muda.

**O terminal segue a mesma regra.** Se você tem um terminal aberto ao lado de uma aba do navegador, ele assume o neutro correspondente em vez de manter a cor do seu tema, para que as duas metades da janela combinem, em vez de se encontrarem em uma emenda visível. Um tema escuro recebe um terminal escuro, não um branco — as cores em um terminal são ajustadas em relação ao seu fundo, e forçar o branco tornaria a saída de um tema escuro difícil de ler.

### Se uma página travar

Se o processo de conteúdo web de uma página morrer, a aba mostra uma sobreposição **"Esta página travou."** com um botão **Recarregar** em vez de uma visualização em branco ou congelada. O VMark recarrega automaticamente algumas vezes em travamentos transitórios; se uma página continua travando ao carregar, ele para e espera que você recarregue manualmente, para que você nunca fique preso em um laço de recarregamento.

## Como ele é construído (e por que é privado por design)

O VMark cria a própria webview da plataforma e a adiciona como um filho nativo da janela — ele **não** pede uma ao framework do aplicativo. Isso importa para a privacidade: uma webview criada pelo framework injetaria uma ponte de mensagens interna em cada página, entregando a qualquer site um canal para dentro do aplicativo. Como o VMark possui uma webview recém-construída sem essa ponte, **uma página navegada não tem canal para dentro do VMark**. A página é controlada estritamente em uma única direção (o aplicativo pode ler e agir sobre a página; a página não pode responder de volta).

As sessões (logins, cookies) persistem por perfil no próprio armazenamento de dados da webview do sistema operacional, então você faz login em cada site apenas uma vez. O próprio VMark não armazena credenciais.

## Controlando o navegador com IA

Um assistente de IA conectado por [MCP](./mcp-tools) pode operar a aba do navegador:

- **Ler** — obtém um instantâneo de acessibilidade estruturado da página (cada elemento interativo ou estrutural como papel + nome acessível, mais um identificador **ref** estável como `e5`).
- **Agir** — clica ou digita em um alvo, seja pelo seu **ref** preciso de uma leitura anterior, seja pelo **papel + nome acessível** do ARIA (por exemplo, clicar no link chamado "Learn more"). Um ref só é aceito para uma ação já concedida; qualquer coisa que precise da sua aprovação usa papel + nome, para que o prompt possa mostrar um elemento legível. Um clique **verifica que ele de fato aconteceu**: ele rola o alvo até a visão, exige que ele esteja renderizado visivelmente — um botão duplicado dentro de uma seção recolhida é ignorado, não clicado — e faz um teste de acerto no ponto do clique, de modo que um alvo coberto por uma sobreposição é reportado como "coberto por …" em vez de ser clicado por baixo. A IA é informada sobre o que *aconteceu*, não apenas que tentou, então ela não pode agir silenciosamente na coisa errada e relatar sucesso.
- **Rolar** — traz um elemento (por ref) até a visão, ou rola por uma quantidade de pixels. Classe Agir (exige aprovação, como Clicar).
- **Tecla** — envia um pressionamento de tecla (`Enter`, `Escape`, `Tab`, setas, com Ctrl/Shift/Alt/Meta opcionais) para um elemento em foco ou um ref — por exemplo, enviar um formulário ou dispensar uma caixa de diálogo. Classe Agir. Observação: teclas e rolagens são eventos **sintéticos** do DOM, então um site que só confia em entrada real de hardware pode ignorá-los.
- **Consultar** — detecção estruturada do DOM que o instantâneo de acessibilidade não consegue nomear (tabelas, valores computados, atributos) por seletor CSS. Classe Ler.
- **Extrair** — a página como Markdown em modo de leitura (título, autoria, texto do artigo, com o conteúdo repetitivo removido), para páginas que a IA quer *ler* em vez de operar. Plugins de site refinam a extração por origem — o plugin embutido da Wikipédia remove a interface do wiki pelo nome — com um leitor genérico como alternativa. A página apenas exporta bytes; a extração é executada no VMark. Classe Ler.
- **Estilo** — manipulação de CSS (dispensar uma sobreposição que bloqueia, destacar um alvo) definindo estilos inline, alternando classes ou injetando um bloco `<style>` (para toda a página, não restrito a um seletor). Classe Agir, e a aprovação vincula a estilização exata — ela não pode ser trocada por outro CSS depois que você permite.
- **Executar JS** — a saída de emergência: executa um script para o que os verbos estruturados não conseguem expressar. Ele roda no **mundo de conteúdo isolado** (DOM + CSS, **nunca** o JavaScript da própria página), é aprovado **a cada chamada** (nunca lembrado — não existe "Permitir neste site" para ele), e seu resultado é tratado como **não confiável**. O prompt de aprovação mostra o **script exato**, e é esse script que roda — a IA não consegue fazer você aprovar um script e então executar outro. Prefira Consultar/Estilo; recorra a isto apenas quando eles não bastarem.
- **Salvar / carregar sessão** — salva a sessão atual da aba sob um **handle** (um nome que você aprova), e mais tarde a restaura para que um fluxo comece já autenticado — *sem que a IA jamais veja seus cookies ou tokens*. Os valores são armazenados no **keychain do sistema operacional** (criptografados em repouso), e a IA recebe apenas o handle e um resumo de contagem. Tanto salvar quanto carregar são **aprovados a cada chamada**, e uma aprovação para um handle não pode ser usada em outro. Uma restauração só se aplica a uma página na **mesma origem** de onde foi salva. Isto é credencial **por referência**: a IA nomeia uma sessão, o VMark guarda o segredo.
- **Console** — lê a saída `console.*` capturada da página (log/warn/error…), **além de erros não capturados e rejeições de promessa não tratadas** — o sinal que uma página emite quando seu próprio script quebra, que o registro `console` comum nunca mostra — para que a IA possa depurar uma página que está controlando. Somente leitura, e a saída é tratada como dados **não confiáveis** da página. Isto foi construído para preservar a garantia de privacidade por design: a captura escreve no próprio DOM da página e o VMark a lê de lá, então nenhum canal de mensagens é aberto de volta para o aplicativo.

::: tip Salvar/carregar sessão — escopo
Uma sessão salva cobre o **`localStorage` e os cookies**, ambos restritos à origem à qual a
página estava vinculada quando você a salvou. Os cookies são lidos e reproduzidos através do
armazenamento de cookies nativo e têm **escopo de domínio nos dois sentidos** — salvar nunca
copia todo o seu pote de cookies, e restaurar nunca planta um cookie sob um site não relacionado.
:::
- **Abrir** — cria uma aba de propriedade da IA e carrega uma URL HTTP(S).
- **Navegar** — navega em uma aba de propriedade da IA e aguarda seu ticket de navegação. Quando a página que carrega se apresenta como uma **barreira** em vez do conteúdo solicitado — um muro de login, um interstício de consentimento, um desafio de verificação humana (reCAPTCHA/Turnstile) ou um aviso de limite de taxa — o resultado diz isso, e a IA é instruída a **envolver você** em vez de tentar contornar. A detecção prioriza a precisão: um preço que menciona "$429" ou um rodapé que diz "Cloudflare" não a aciona.
- **Aguardar** — aguarda um ticket de navegação específico sem iniciar outro carregamento.
- **Aguardar por** — consulta repetidamente até que uma condição se mantenha (um elemento por ref ou papel + nome, um trecho de texto visível, ou a **URL da aba contendo** uma substring — este último confirma que uma navegação disparada por clique aconteceu) ou até que um tempo limite se esgote, relatando se houve correspondência. Torna um fluxo de várias etapas determinístico — agir, então aguardar pelo resultado, então ler — em vez de adivinhar.
- **Captura de tela** — obtém uma imagem JPEG da renderização atual da página, para que a IA possa ver o layout e o estado renderizado que o instantâneo de acessibilidade não nomeia. Assim como *Ler*, não é mutante: permitida em uma aba de propriedade da IA e em uma aba humana apenas enquanto você a tiver anexado.
- **Executar um fluxo de trabalho** — reproduz uma sequência curta e salva de etapas (clicar / digitar / navegar / extrair, escrita em uma pequena gramática de texto e passada como `source`) como uma única **execução assíncrona**: ela retorna um id de execução imediatamente e você consulta seu status, porque uma execução de várias etapas dura mais que uma única requisição. Cada etapa dentro dela é **individualmente sujeita a aprovação**, exatamente como uma ação emitida manualmente — um fluxo de trabalho não é uma forma de contornar os prompts — e etapas que a IA não consegue realizar de forma determinística (um "objetivo" em prosa livre, uma "confirmação") pausam a execução para que você as trate manualmente. Uma reexecução pula etapas que já tiveram sucesso, então reexecutar após uma pausa nunca envia duas vezes. As execuções são limitadas e ocorrem uma por vez por aba, e podem ser canceladas — cancelar é sempre permitido, e assumir o navegador você mesmo interrompe a execução.
- **Gravar um fluxo de trabalho** — em vez de escrever a gramática à mão, você pode **gravar** um: com a sua aprovação (pedida a cada vez — a gravação nunca é uma permissão permanente), o VMark captura os **cliques e edições de campos** que você realiza na aba e devolve um texto de fluxo de trabalho pronto para executar. É **livre de valores por construção**: nada do que você digita é salvo — cada campo vira um `{input}` nomeado que você preenche na reprodução, um campo de senha vira um passo `confirm:` manual, e as URLs são reduzidas a origem + caminho. Ele grava *quais* controles você tocou, nunca *o que* você digitou.

A postura do navegador da IA é configurada em **Configurações → Avançado → Navegador integrado**:

- **Sandbox** (recomendado) usa um único armazenamento de webview da IA, compartilhado e não
  persistente. Ele compartilha cookies com outras abas em sandbox, mas não com abas humanas.
- **Perfil compartilhado** usa o armazenamento de webview humano e pede aprovação de destino
  antes de cada navegação da IA, a menos que essa origem tenha uma permissão de `navigate` correspondente.

As abas criadas pela IA são transitórias e não são restauradas após a reinicialização. Suas URLs, modo, título,
geração e estado de carregamento aparecem em `session.get_state`; as credenciais são omitidas das
respostas do MCP.

As ações **exigem aprovação**: uma operação que você não autorizou não é executada — a IA é informada de que a aprovação é necessária e aguarda. Uploads de arquivos **nunca** são permitidos para a IA (um upload de arquivo escolhido pela IA seria um caminho de exfiltração de dados); esses permanecem estritamente conduzidos por humanos.

### Aprovando uma ação

Quando a IA pede para agir, o VMark exibe um prompt e pausa a página. Ele informa exatamente três coisas — o **site**, a **ação** e o **elemento** (seu papel e seu nome acessível, por exemplo `button "Publish"`):

- **Permitir uma vez** — autoriza exatamente aquela única ação, naquele elemento, naquela página. É consumida imediatamente e não se torna uma permissão permanente.
- **Permitir neste site** — a IA pode realizar *aquela operação* naquele *site* sem perguntar novamente. Isso não se estende a outras operações ou a outros sites.
- **Negar** — nada acontece. Pressionar `Escape`, ou simplesmente apertar `Enter`, também nega: o prompt é deliberadamente tendencioso a recusar.

O prompt mostra uma **descrição da ação, não uma imagem da página** — e isso é proposital. Uma página da web controla seus próprios pixels, então uma página hostil poderia estilizar um botão "Delete everything" para parecer "Publish". O que o VMark mostra é exatamente aquilo que a barreira de segurança impõe, obtido do mecanismo do navegador em vez das próprias afirmações da página sobre si mesma.

A permissão também **expira quando a página navega**. Um prompt descreve uma ação em uma página *específica*; se a página muda enquanto você está decidindo, a requisição é descartada em vez de ser aplicada a qualquer coisa que tenha carregado no lugar. Um "Permitir uma vez" não consumido é descartado da mesma forma.

Isso inclui a navegação *dentro* de uma página. A maioria dos sites modernos se move entre visualizações sem nunca carregar uma página nova — o endereço muda, o conteúdo é reescrito, mas o site nunca sai. Isso importa aqui, porque o site e a origem permanecem os mesmos, enquanto o `button "Publish"` que você aprovou pode não ser mais o botão com aquele nome. Então o VMark trata uma navegação dentro da página exatamente como qualquer outra: a autorização expira junto com a **visualização** para a qual foi concedida, não apenas com a página.

O que sustenta o peso, porém, é o próprio descritor. Um site pode reescrever seu próprio conteúdo a qualquer momento sem navegar de forma alguma, e nenhum mecanismo de navegador relata isso. Então o que um "Permitir uma vez" autoriza é precisamente uma operação, em um elemento identificado por seu papel e nome acessível, em um site — e é consumido imediatamente. "Permitir neste site" é a opção sobre a qual pensar duas vezes: é uma permissão permanente para aquela operação naquele site, e um site ao qual você a concede é um site em que você está confiando com ela.

### Revisando e revogando permissões

**Configurações → Avançado → Permissões de site** lista todos os sites aos quais você concedeu permissão e o que cada um pode fazer. **Revogar** a retira imediatamente — a próxima ação da IA naquele site pergunta novamente.

As permissões de site são mantidas apenas na memória: **nunca são gravadas em disco** e expiram quando o VMark é encerrado. Deixar uma IA manter a capacidade de clicar em um site entre reinicializações é uma promessa maior do que parece, então o VMark não a faz silenciosamente.

Quando uma IA mira uma aba criada por humano, o VMark primeiro pergunta se deve anexar o acesso da IA
àquela aba. A anexação é vinculada à geração de navegação atual. **Permitir uma vez** é
consumido após uma leitura ou ação bem-sucedida; **Permitir até a navegação** expira na próxima
navegação completa ou dentro da página, ao fechar, desativar ou reiniciar.

A navegação da IA rejeita por padrão alvos de loopback, LAN privada, link-local, metadados,
malformados e de esquema não suportado. O DNS rebinding permanece uma limitação de responsabilidade
do WebKit; o VMark não afirma eliminá-la.

## Codirigindo: assista a uma IA controlar o navegador a partir do terminal

O navegador é um painel, não um modo. Isso torna possível um fluxo de trabalho específico: abra um **terminal** (`Ctrl + \``) ao lado de uma aba do navegador, execute um agente de IA nele e observe a página responder enquanto ele trabalha.

O terminal e o navegador ficam **lado a lado** — o navegador se redimensiona para abrir espaço em vez de ser coberto. Assim, você vê a página o tempo todo em que o agente opera nela, e cada ação que ele executa ainda tem que passar por você (veja *Aprovando uma ação* acima).

Esta é a forma pretendida de uso do navegador por IA no VMark: o agente propõe, a página fica visível e você aprova. Não é o agente trabalhando em uma janela que você não pode ver.

**Retomar o controle é um único gesto.** Enquanto uma execução de fluxo de trabalho da IA está controlando uma aba, sua interface mostra um indicador **"A IA está no controle — clique para assumir"**. Clicar nele — ou simplesmente interagir você mesmo com a página ou com sua barra de endereços — retoma a aba imediatamente e interrompe a execução. Você nunca precisa encontrar um botão de parar no terminal do agente; tocar no navegador é o botão de parar.

## Quando uma página não carrega

Uma rede off-line, um nome de host inválido, um certificado rejeitado ou uma conexão recusada — todos
produzem uma mensagem no painel do navegador dizendo o que deu errado, com um botão **Tentar novamente**.
Versões anteriores mostravam um painel em branco no lugar, o que era indistinguível de uma
página que estava apenas lenta.

## Limitações atuais

- Apenas macOS nesta versão.
- As caixas de diálogo `confirm()` / `prompt()` do JavaScript estão suprimidas por enquanto (apenas `alert()` é exibida); pop-ups (`window.open`) são bloqueados em vez de abertos como novas abas.
- Downloads, impressão e política de rede por requisição ainda não foram implementados.

Esses recursos estão sendo adicionados de forma incremental; a página acima descreve o que funciona hoje.
