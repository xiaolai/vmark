# Baixar VMark

<script setup>
import DownloadButton from '../.vitepress/components/DownloadButton.vue'
</script>

<DownloadButton />

## Requisitos do Sistema

- macOS 13.4 (Ventura) ou posterior
- Processador Apple Silicon (M1/M2/M3) ou Intel
- 200 MB de espaço em disco

::: info Por que macOS 13.4?
O VMark desenha sua interface no motor WebKit que acompanha o macOS, então é a versão do macOS que determina quais recursos web estão disponíveis. O macOS 13.4 é a versão mais antiga cujo WebKit embutido consegue executar a compilação atual.

Esta página dizia 10.15 antes. Isso nunca foi exato: era um valor padrão que ninguém havia conferido e, em sistemas mais antigos, o VMark abria uma janela em branco em vez de se recusar a iniciar. Abaixo da 13.4, o próprio macOS agora se recusa a abrir o VMark e diz o motivo, em vez de deixar você diante de uma janela em branco.
:::

## Instalação

**Homebrew (Recomendado)**

```bash
brew install xiaolai/tap/vmark
```

Isso instala o VMark e seleciona automaticamente a versão correta para o seu Mac (Apple Silicon ou Intel).

**Atualização**

```bash
brew update && brew upgrade vmark
```

**Instalação Manual**

1. Baixe o arquivo `.dmg`
2. Abra o arquivo baixado
3. Arraste o VMark para a pasta Aplicativos
4. Na primeira execução, clique com o botão direito no app e selecione "Abrir" para contornar o Gatekeeper

## Windows e Linux

O VMark é construído com Tauri, que suporta compilação multiplataforma. No entanto, **o desenvolvimento ativo e os testes estão atualmente focados no macOS**. O suporte para Windows e Linux é limitado no futuro próximo devido a restrições de recursos.

Se você quiser executar o VMark no Windows ou Linux:

- **Binários pré-compilados** estão disponíveis no [GitHub Releases](https://github.com/xiaolai/vmark/releases) (fornecidos como estão, sem suporte garantido)
- **Compilar a partir do código-fonte** seguindo as instruções abaixo

## Verificando Downloads

Todas as versões são compiladas automaticamente via GitHub Actions. Você pode verificar a autenticidade conferindo a versão na nossa [página de Releases do GitHub](https://github.com/xiaolai/vmark/releases).

## Compilando a Partir do Código-Fonte

Para desenvolvedores que desejam compilar o VMark a partir do código-fonte:

```bash
# Clonar o repositório
git clone https://github.com/xiaolai/vmark.git
cd vmark

# Instalar dependências
pnpm install

# Compilar para produção
pnpm tauri build
```

Consulte o [README](https://github.com/xiaolai/vmark#readme) para instruções detalhadas de compilação e pré-requisitos.
