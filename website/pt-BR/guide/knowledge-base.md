# Base de conhecimento e Slidev

O VMark pode servir todo o seu espaço de trabalho como uma base de conhecimento
navegável e com links cruzados, além de visualizar e exportar apresentações do
[Slidev](https://sli.dev) — ambos movidos por um único servidor de conteúdo
local que o VMark inicia sob demanda.

::: warning Status
Este recurso está sendo lançado em fases, e **nenhuma versão de lançamento, em
nenhuma plataforma, inclui o runtime do servidor de conteúdo** do qual ele
depende — veja [Requisitos](#requisitos). Por isso ele fica **oculto a menos que
o Modo de desenvolvedor esteja ativado**: o item do menu Visualizar, a entrada
da paleta de comandos e o atalho `Ctrl + Shift + 4` só aparecem depois que você
ativa **Configurações → Avançado → Ferramentas de desenvolvedor**. Ative essa
opção e abra o painel **Base de conhecimento** para ver o que sua máquina tem e
o que está faltando.
:::

## Requisitos

A base de conhecimento, seu grafo de relações, a pesquisa, o recarregamento ao
vivo e a prévia do Slidev rodam todos em um único servidor de conteúdo local —
um programa Node.js separado que o VMark inicia sob demanda. Duas coisas
precisam estar presentes antes que ele possa iniciar:

- **Node.js.** O VMark resolve `node` pelo `PATH` do seu shell de login, como um
  terminal faria, então um Node.js visível apenas para uma ferramenta local de
  um projeto não conta. Instale-o de modo que `node` esteja no `PATH` do seu
  shell de login.
- **O próprio servidor de conteúdo** (`server/content` no repositório do VMark,
  compilado para um `cli.js`). **Nenhuma versão empacotada do VMark o inclui
  ainda — em nenhuma plataforma.** Não é uma lacuna do Linux ou do Windows: o
  DMG do macOS também não traz o runtime do servidor de conteúdo, e as
  verificações de lançamento do VMark confirmam isso em cada versão. Até que
  exista uma solução para as versões de lançamento, o recurso exige um ambiente
  de desenvolvimento — um checkout do VMark com o servidor de conteúdo
  compilado, disponibilizado pela variável de ambiente
  `VMARK_CONTENT_SERVER_CLI` (ou um runtime `base-kb` que você coloca à mão nos dados de
  aplicativo do VMark; o VMark nunca baixa um).

O painel verifica os dois ao abrir. Quando algum deles está faltando, ele diz
qual é e o que o forneceria, em vez de tentar um início que não pode dar certo.

## Abrindo o painel

A Base de conhecimento fica **oculta por padrão**, porque uma versão de
lançamento não consegue iniciá-la. Para mostrá-la, ative **Configurações →
Avançado → Ferramentas de desenvolvedor**. O item de menu **Visualizar → Base de
conhecimento**, a entrada da paleta de comandos ("Alternar base de
conhecimento") e o atalho `Ctrl + Shift + 4` aparecem junto com ela, e todos
desaparecem de novo quando você a desativa.

Com as Ferramentas de desenvolvedor ativadas, abra o painel por **Visualizar →
Base de conhecimento**, pela paleta de comandos ou com `Ctrl + Shift + 4`. O
painel fica acoplado à direita; alterne-o de novo para ocultá-lo.

Desativar as Ferramentas de desenvolvedor oculta os pontos de entrada outra vez
e fecha o painel junto com eles: o painel não tem botão de fechar próprio, então
deixá-lo aberto deixaria um painel acoplado que nada conseguiria dispensar. Um
servidor que já está **em execução** não é afetado — reative as Ferramentas de
desenvolvedor para chegar ao botão Parar dele; de qualquer forma, o VMark para
seus servidores de conteúdo ao sair.

## Base de conhecimento

Abra um espaço de trabalho e inicie o painel **Base de conhecimento**. O VMark
inicia um servidor local vinculado a `127.0.0.1` (somente loopback) e renderiza
cada arquivo markdown como HTML usando a mesma semântica de markdown do editor —
wiki-links, alertas, matemática, tabelas, listas de tarefas e detalhes são todos
renderizados de forma idêntica.

Recursos:

- **Navegação por wiki-links** — `[[Page]]`, `[[dir/Page]]`, `[[Page#Heading]]`
  e `[[Page|Alias]]` são resolvidos em todo o espaço de trabalho. Links não
  resolvidos aparecem como "ausentes", para que as lacunas fiquem visíveis.
- **Grafo de relações** — notas, tags (`#tag` e `tags:` no frontmatter) e
  relações tipadas do frontmatter (`up`, `related`, `links`, …) formam um grafo
  interativo com backlinks.
- **Pesquisa de texto completo** em todo o espaço de trabalho.
- **Recarregamento ao vivo** — edições salvas atualizam as páginas servidas
  automaticamente.

Você pode ver a base de conhecimento dentro do VMark (painel incorporado) ou
**abri-la no seu navegador** — a ação "Abrir no navegador" faz uma troca de
autenticação única para que o navegador receba um cookie de sessão. O servidor é
somente loopback e protegido por cookie; ele nunca expõe seu espaço de trabalho
para além da sua máquina.

## Apresentações Slidev

Quando você abre um arquivo markdown cujo frontmatter o marca como um deck do
Slidev (por exemplo, `theme:`, `layout:` + slides, ou um `format: slidev`
explícito), o VMark pode executar o conjunto de ferramentas real do Slidev para
visualizá-lo ao vivo — o mesmo renderizador que o Slidev usa, então layouts,
animações de clique e componentes são totalmente fiéis.

Com o deck aberto e o painel Base de conhecimento em execução, use **Visualizar
slides** para abrir o deck ao vivo no seu navegador e **Exportar slides** para
renderizá-lo. O Slidev observa o deck no disco, então salvar edições no VMark
recarrega na hora a prévia aberta.

### Exportação

Decks do Slidev são exportados para **PDF**, **PNG** ou **PPTX**. O servidor de
conteúdo executa o próprio comando `slidev export` do Slidev, que renderiza os
slides no Chromium por meio do pacote `playwright-chromium`. O VMark não baixa
nem localiza um navegador para isso: se `playwright-chromium` não estiver
instalado ao lado do Slidev no runtime do servidor de conteúdo, a exportação
falha e mostra a mensagem de erro do Slidev. Uma exportação que dure mais de
três minutos é interrompida.

**Exportar slides** pergunta onde salvar com o painel de salvamento nativo do VMark,
e a exportação grava somente no caminho escolhido ali; a extensão do arquivo precisa
corresponder ao formato (`.pdf`, `.png`, `.pptx`).

## Privacidade e segurança

- O servidor se vincula apenas a `127.0.0.1` e exige um token por sessão
  (entregue como um cookie HttpOnly, SameSite=Strict).
- O acesso a arquivos fica restrito à raiz do espaço de trabalho; travessia de
  caminho é rejeitada e links simbólicos não são seguidos.
- O HTML renderizado é sanitizado e servido sob uma política de segurança de
  conteúdo. **A confiança no espaço de trabalho muda exatamente uma coisa aqui:
  se imagens remotas são renderizadas.** O VMark repassa a confiança do espaço
  de trabalho ao servidor quando o inicia; para um espaço de trabalho confiável,
  a política relaxa `img-src` para que imagens `https:` carreguem; para um
  espaço de trabalho não confiável, apenas imagens locais e embutidas são
  renderizadas. A confiança não decide se um espaço de trabalho é servido —
  qualquer espaço de trabalho aberto pode ser. Alterar a confiança de um espaço
  de trabalho enquanto sua base de conhecimento está em execução reinicia o
  servidor, para que a política acompanhe a mudança.
