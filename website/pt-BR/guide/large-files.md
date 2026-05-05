# Arquivos grandes

O VMark abre a maioria dos arquivos markdown instantaneamente, mas arquivos muito grandes precisam de cuidados extras para manter a responsividade. Esta página descreve como o VMark os trata e como você pode ajustar o comportamento.

## O que conta como "grande"

O VMark classifica um arquivo pelo tamanho antes de abri-lo:

| Tamanho | Categoria | O que acontece |
|---------|-----------|----------------|
| < 1 MB | Pequeno | Abre em modo WYSIWYG (rich-text) instantaneamente. |
| 1 MB – 5 MB | Grande | Abre em **modo Fonte** por padrão — em menos de um segundo. A barra de status oferece "Mudar para WYSIWYG". |
| 5 MB – 50 MB | Enorme | Aparece primeiro um diálogo de confirmação. Abre apenas em modo Fonte. |
| ≥ 50 MB | Recusado | O VMark se recusa a abrir o arquivo. Use `less`, `bat` ou ferramenta similar. |

O tamanho é verificado pelo sistema operacional sem ler o arquivo, então a decisão é rápida e não pré-carrega dados.

## Por que modo Fonte para arquivos grandes

O modo Fonte usa o CodeMirror com virtualização de viewport — apenas a porção visível do documento é renderizada. O modo WYSIWYG usa Tiptap/ProseMirror, que precisa construir um nó DOM para cada bloco do documento. Em um arquivo markdown de 1,4 MB / ~2.250 blocos isso leva cerca de 15 segundos na primeira abertura; o modo Fonte abre o mesmo arquivo em menos de um segundo.

O parsing não é o gargalo — é a construção da view do ProseMirror. Mover o parse para fora da thread principal não melhoraria perceptivelmente a espera.

## Indicadores na barra de status

- **Abrir um arquivo grande em WYSIWYG:** um spinner indeterminado com o rótulo *"Abrindo arquivo grande (N MB)…"* aparece à esquerda da barra de status enquanto o editor é montado. Ele desaparece assim que o editor fica interativo.
- **Arquivo aberto automaticamente em modo Fonte:** a barra de status mostra *"Aberto em modo Fonte (arquivo grande)."* com um link **Mudar para WYSIWYG**. Clicar no link alterna a aba ativa para WYSIWYG. Fechar e reabrir o arquivo retorna ao modo Fonte — o override é por sessão.

## Configurações

Abra **Configurações → Editor → Arquivos grandes**:

- **Abrir arquivos acima de 1 MB em modo Fonte automaticamente** *(ligado por padrão)* — desligue se preferir WYSIWYG para arquivos de até 5 MB, aceitando o tempo de abertura mais longo.
- **Avisar antes de abrir arquivos acima de 5 MB** *(ligado por padrão)* — desligue para pular o diálogo de confirmação para arquivos entre 5 MB e 50 MB. Eles ainda abrirão em modo Fonte.

A recusa fixa em 50 MB não é ajustável pelo usuário. A webview não consegue manter strings arbitrariamente grandes com segurança sem risco de falhas por falta de memória.

## Dicas

- Se você precisa continuar editando um arquivo muito grande em WYSIWYG, considere dividi-lo em arquivos menores ligados por um documento índice. O Markdown funciona bem como um conjunto de capítulos menores.
- Se você só precisa ler ou pesquisar em um arquivo grande, modo Fonte com a régua de números de linha e `Find` (`Mod + F`) costuma ser o fluxo mais rápido.
- `Formatar > Formatar texto CJK` e outros comandos para o documento inteiro continuam funcionando corretamente em documentos no modo Fonte.

## Casos de borda

- **O arquivo cresce enquanto está aberto.** O VMark decide a categoria com base no tamanho no momento da abertura. Um arquivo que cresce para 2 MB enquanto você o edita permanece no modo que você escolheu.
- **Symlinks.** Os tamanhos refletem o arquivo de destino, então um symlink para um arquivo de 10 MB é tratado como enorme.
- **Arquivos vazios.** Arquivos de zero bytes contam como pequenos e abrem em WYSIWYG.
- **Arquivo desaparece entre a verificação de tamanho e a leitura.** O erro normal de "arquivo não encontrado" é exibido — nenhum aviso adicional é levantado.

## Limitações conhecidas

- Os limiares são tamanhos em bytes, que são uma aproximação para o custo real (contagem de blocos). Um arquivo de 600 KB com milhares de blocos curtos pode ser mais lento que um arquivo de 1,2 MB com parágrafos longos. Os padrões são conservadores.
- A Fase C da iniciativa de arquivos grandes (renderização WYSIWYG diferida) ainda não foi entregue — veja `dev-docs/plans/20260422-large-file-open-ux.md` para o status.
