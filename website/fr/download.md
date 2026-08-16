# Télécharger VMark

<script setup>
import DownloadButton from '../.vitepress/components/DownloadButton.vue'
</script>

<DownloadButton />

## Configuration requise

- macOS 13.4 (Ventura) ou version ultérieure
- Processeur Apple Silicon (M1/M2/M3) ou Intel
- 200 Mo d'espace disque

::: info Pourquoi macOS 13.4 ?
VMark affiche son interface dans le moteur WebKit fourni avec macOS : la version de macOS détermine donc les fonctionnalités web disponibles. macOS 13.4 est la plus ancienne version dont le WebKit intégré peut exécuter la version actuelle.

Cette page indiquait auparavant 10.15. Cela n'a jamais été exact — c'était une valeur par défaut que personne n'avait vérifiée, et sur les systèmes plus anciens VMark ouvrait une fenêtre vide au lieu de refuser de démarrer. En dessous de 13.4, c'est désormais macOS lui-même qui refuse d'ouvrir VMark en indiquant pourquoi, plutôt que de vous laisser devant une fenêtre vide.
:::

## Installation

**Homebrew (Recommandé)**

```bash
brew install xiaolai/tap/vmark
```

Cette commande installe VMark et sélectionne automatiquement la bonne version pour votre Mac (Apple Silicon ou Intel).

**Mise à jour**

```bash
brew update && brew upgrade vmark
```

**Installation manuelle**

1. Téléchargez le fichier `.dmg`
2. Ouvrez le fichier téléchargé
3. Faites glisser VMark dans votre dossier Applications
4. Au premier lancement, faites un clic droit sur l'application et sélectionnez « Ouvrir » pour contourner Gatekeeper

## Windows et Linux

VMark est construit avec Tauri, qui prend en charge la compilation multiplateforme. Cependant, **le développement actif et les tests sont actuellement concentrés sur macOS**. La prise en charge de Windows et Linux est limitée pour le moment en raison de contraintes de ressources.

Si vous souhaitez exécuter VMark sur Windows ou Linux :

- Des **binaires pré-compilés** sont disponibles sur [GitHub Releases](https://github.com/xiaolai/vmark/releases) (fournis tels quels, sans garantie de support)
- **Compilez depuis les sources** en suivant les instructions ci-dessous

## Vérification des téléchargements

Toutes les versions sont compilées automatiquement via GitHub Actions. Vous pouvez vérifier l'authenticité en consultant la version sur notre [page GitHub Releases](https://github.com/xiaolai/vmark/releases).

## Compilation depuis les sources

Pour les développeurs qui souhaitent compiler VMark depuis les sources :

```bash
# Cloner le dépôt
git clone https://github.com/xiaolai/vmark.git
cd vmark

# Installer les dépendances
pnpm install

# Compiler pour la production
pnpm tauri build
```

Consultez le [README](https://github.com/xiaolai/vmark#readme) pour les instructions de compilation détaillées et les prérequis.
