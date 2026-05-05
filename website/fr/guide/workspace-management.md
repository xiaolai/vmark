# Gestion de l'espace de travail

Un espace de travail dans VMark est un dossier ouvert comme racine de votre projet. Lorsque vous ouvrez un espace de travail, la barre latérale affiche une arborescence de fichiers, l'Ouverture rapide indexe chaque fichier markdown, le terminal démarre dans la racine du projet et vos onglets ouverts sont mémorisés pour la prochaine fois.

Sans espace de travail, vous pouvez quand même ouvrir des fichiers individuels, mais vous perdez l'explorateur de fichiers, la recherche dans le projet et la restauration de session.

## Ouvrir un espace de travail

| Méthode | Comment |
|---------|---------|
| Menu | **Fichier > Ouvrir l'espace de travail** |
| Ouverture rapide | `Mod + O`, puis sélectionnez **Parcourir...** en bas |
| Glisser-déposer | Glissez un fichier markdown depuis le Finder dans la fenêtre — VMark détecte sa racine de projet et ouvre l'espace de travail automatiquement |
| Espaces de travail récents | **Fichier > Espaces de travail récents** et choisissez un projet précédent |

Lorsque vous ouvrez un espace de travail, VMark affiche la barre latérale avec l'explorateur de fichiers. Si l'espace de travail a déjà été ouvert, les onglets précédemment ouverts sont restaurés.

::: tip
Si la fenêtre actuelle a des modifications non enregistrées, VMark propose d'ouvrir l'espace de travail dans une nouvelle fenêtre au lieu de remplacer votre travail.
:::

## Explorateur de fichiers

L'explorateur de fichiers apparaît dans la barre latérale chaque fois qu'un espace de travail est ouvert. Il affiche une arborescence de fichiers markdown enracinée dans le dossier de l'espace de travail.

### Navigation

- **Clic simple** sur un dossier pour le développer ou le réduire
- **Double-clic** ou **Entrée** sur un fichier pour l'ouvrir dans un onglet
- Les fichiers non-markdown s'ouvrent avec l'application par défaut de votre système
- Les dossiers démarrent réduits lors de la première ouverture d'un espace de travail&nbsp;; leur état d'ouverture est préservé lorsque vous basculez entre les vues Fichiers, Plan et Historique

### Tout développer / Tout réduire

Deux boutons dans l'en-tête de la vue Fichiers basculent toute l'arborescence d'un seul coup&nbsp;:

- **Tout développer** — ouvre chaque dossier de l'arborescence
- **Tout réduire** — ferme chaque dossier jusqu'à la racine

### Opérations sur les fichiers

Cliquez avec le bouton droit sur n'importe quel fichier ou dossier pour accéder au menu contextuel :

| Action | Description |
|--------|-------------|
| Ouvrir | Ouvrir le fichier dans un nouvel onglet |
| Renommer | Modifier le nom du fichier ou dossier en ligne (aussi `F2`) |
| Dupliquer | Créer une copie du fichier |
| Déplacer vers... | Déplacer le fichier vers un autre dossier via une boîte de dialogue |
| Supprimer | Déplacer le fichier ou dossier vers la corbeille système |
| Copier le chemin | Copier le chemin de fichier absolu dans le presse-papiers |
| Révéler dans le Finder | Afficher le fichier dans le Finder (macOS) |
| Nouveau fichier | Créer un nouveau fichier markdown à cet emplacement |
| Nouveau dossier | Créer un nouveau dossier à cet emplacement |

Vous pouvez également **glisser-déposer** des fichiers entre des dossiers directement dans l'arborescence.

### Bascules de visibilité

Par défaut, l'explorateur affiche uniquement les fichiers markdown et masque les fichiers points. Deux bascules modifient cela :

| Bascule | Raccourci | Ce qu'elle fait |
|---------|-----------|----------------|
| Afficher les fichiers cachés | `Mod + Shift + .` (macOS) / `Ctrl + H` (Win/Linux) | Révèle les fichiers points et dossiers cachés |
| Afficher tous les fichiers | *(Paramètres ou menu contextuel)* | Affiche les fichiers non-markdown aux côtés de vos documents |

Les deux paramètres sont sauvegardés par espace de travail et persistent entre les sessions.

### Dossiers exclus

Certains dossiers sont exclus de l'arborescence par défaut :

- `.git`
- `node_modules`

Ces valeurs par défaut sont appliquées lors de la première ouverture d'un espace de travail.

## Ouverture rapide

Appuyez sur `Mod + O` pour ouvrir l'overlay d'Ouverture rapide. Il fournit une recherche floue sur trois sources :

1. **Fichiers récents** que vous avez ouverts auparavant
2. **Onglets ouverts** dans la fenêtre actuelle (marqués d'un indicateur point)
3. **Tous les fichiers markdown** dans l'espace de travail

Tapez quelques caractères pour filtrer — la correspondance est floue, donc `rme` trouve `README.md`. Utilisez les touches fléchées pour naviguer et **Entrée** pour ouvrir. Une ligne **Parcourir...** épinglée en bas ouvre une boîte de dialogue de fichier.

| Action | Raccourci |
|--------|----------|
| Ouvrir l'Ouverture rapide | `Mod + O` |
| Naviguer dans les résultats | `Haut / Bas` |
| Ouvrir le fichier sélectionné | `Entrée` |
| Fermer | `Échap` |

::: tip
Sans espace de travail, l'Ouverture rapide fonctionne quand même — elle affiche les fichiers récents et les onglets ouverts mais ne peut pas rechercher dans l'arborescence de fichiers.
:::

## Recherche dans le contenu de l'espace de travail

Lorsqu'un espace de travail est ouvert, VMark peut rechercher dans le **contenu des fichiers** (et pas seulement dans les noms de fichiers) les correspondances dans les fichiers markdown et texte.

| Action | Raccourci |
|---|---|
| Ouvrir le panneau de recherche dans le contenu | `Mod + Shift + F` |
| Aller au résultat suivant | `Entrée` (ou touches fléchées pour naviguer) |
| Ouvrir le résultat dans un nouvel onglet | Cliquer sur l'aperçu de la correspondance |

Chaque résultat affiche le chemin du fichier, le numéro de ligne et un extrait avec le texte correspondant mis en évidence. Les correspondances sont classées par&nbsp;:

1. Pertinence du nom de fichier (les fichiers contenant le terme dans leur nom en premier)
2. Proximité du titre (les correspondances dans les titres avant le corps du texte)
3. Récence (les fichiers récemment modifiés apparaissent en premier)

**Exclus par défaut**&nbsp;: `node_modules/`, `.git/`, `dist/`, `target/`, `coverage/`, ainsi que tous les répertoires que vous avez ajoutés dans **Dossiers exclus** des Paramètres de l'espace de travail.

**Fichiers cachés**&nbsp;: ignorés sauf si **Afficher les fichiers cachés** est activé dans l'explorateur de fichiers.

Cela se distingue de l'[Ouverture rapide](#ouverture-rapide) qui recherche uniquement dans les *noms de fichiers* — la recherche dans le contenu ouvre le fichier correspondant avec le curseur placé sur la ligne correspondante.

## Espaces de travail récents

VMark mémorise jusqu'à 10 espaces de travail récemment ouverts. Accédez-y depuis **Fichier > Espaces de travail récents** dans la barre de menus.

- Les espaces de travail sont triés par heure de dernière ouverture (les plus récents en premier)
- La liste se synchronise avec le menu natif à chaque changement
- Choisissez **Effacer les espaces de travail récents** pour réinitialiser la liste

## Paramètres de l'espace de travail

Chaque espace de travail a sa propre configuration qui persiste entre les sessions. Les paramètres sont stockés dans le répertoire de données de l'application VMark — pas dans le dossier du projet — afin que votre espace de travail reste propre.

Les paramètres suivants sont sauvegardés par espace de travail :

| Paramètre | Description |
|-----------|-------------|
| Dossiers exclus | Dossiers masqués de l'explorateur de fichiers |
| Afficher les fichiers cachés | Si les fichiers points sont visibles |
| Afficher tous les fichiers | Si les fichiers non-markdown sont visibles |
| Derniers onglets ouverts | Chemins de fichiers pour la restauration de session à la prochaine ouverture |

::: tip
La configuration de l'espace de travail est liée au chemin du dossier. Ouvrir le même dossier sur la même machine restaure toujours vos paramètres, même depuis une fenêtre différente.
:::

## Restauration de session

Lorsque vous fermez une fenêtre qui a un espace de travail ouvert, VMark sauvegarde la liste des onglets ouverts dans la configuration de l'espace de travail. La prochaine fois que vous ouvrez le même espace de travail, ces onglets sont restaurés automatiquement.

- Seuls les onglets avec un chemin de fichier sauvegardé sont restaurés (les onglets sans titre ne sont pas persistés)
- Si un fichier a été déplacé ou supprimé depuis la dernière session, il est ignoré silencieusement
- Les données de session sont sauvegardées à la fermeture de la fenêtre et à la fermeture de l'espace de travail (`Fichier > Fermer l'espace de travail`)

## Multi-fenêtres

Chaque fenêtre VMark peut avoir son propre espace de travail indépendant. Cela vous permet de travailler sur plusieurs projets simultanément.

- **Fichier > Nouvelle fenêtre** ouvre une nouvelle fenêtre
- Ouvrir un espace de travail dans une nouvelle fenêtre n'affecte pas les autres fenêtres
- La taille et la position des fenêtres sont mémorisées par fenêtre

Lorsque vous glissez un fichier markdown depuis le Finder et que la fenêtre actuelle a déjà du travail non enregistré, VMark ouvre automatiquement le projet du fichier dans une nouvelle fenêtre.

### Détacher des onglets dans de nouvelles fenêtres

Vous pouvez extraire un onglet de sa fenêtre pour en créer une nouvelle :

- **Glissez un onglet vers le bas** au-delà de la barre d'onglets (environ 40 px) pour le détacher dans une nouvelle fenêtre à la position du curseur
- **Glissez un onglet horizontalement** dans la barre d'onglets pour le réordonner parmi les autres onglets
- Les onglets épinglés ne peuvent pas être glissés

Le geste est verrouillé par direction : le mouvement horizontal lance un réordonnancement, tandis que le mouvement vertical déclenche un détachement. Vous pouvez passer du réordonnancement au détachement en cours de glissement en déplaçant le pointeur en dehors de la barre d'onglets.

## Modifications externes

VMark surveille votre espace de travail pour les modifications effectuées par d'autres programmes (Git, éditeurs externes, outils de build, etc.) et maintient les documents ouverts synchronisés.

- **Les fichiers non modifiés** sont rechargés automatiquement lorsque leur contenu change sur le disque. Une brève notification toast confirme le rechargement.
- **Les fichiers avec des modifications non enregistrées** déclenchent une boîte de dialogue avec trois options : **Enregistrer sous** (enregistrer votre version à un nouvel emplacement), **Recharger** (abandonner vos modifications et charger depuis le disque) ou **Conserver** (préserver vos modifications et marquer le fichier comme divergent).
- **Les fichiers supprimés** sont marqués comme manquants dans leur onglet mais ne sont pas fermés — vous pouvez toujours enregistrer le contenu à un nouvel emplacement.
- Lorsque plusieurs fichiers modifiés changent en même temps (par exemple après un `git checkout`), VMark les regroupe dans une seule boîte de dialogue pour que vous puissiez tout recharger, tout conserver ou examiner chaque fichier individuellement.
- Si le contenu sur disque d'un fichier divergent correspond par la suite à ce que vous avez dans l'éditeur (par exemple un `git checkout` restaure le même texte), VMark efface automatiquement l'état divergent pour que la sauvegarde automatique reprenne.

VMark filtre ses propres sauvegardes pour que vous ne soyez jamais sollicité par des modifications que vous avez faites dans l'application.

## Documents récents du Dock macOS

Les documents que vous ouvrez dans VMark sont enregistrés auprès de macOS, ils apparaissent donc dans le sous-menu **Ouvrir les éléments récents** lorsque vous faites un clic droit sur l'icône VMark dans le Dock.

## Intégration du terminal

Le terminal intégré utilise automatiquement la racine de l'espace de travail comme répertoire de travail. Lorsque vous ouvrez ou changez d'espace de travail, toutes les sessions du terminal effectuent `cd` vers la nouvelle racine.

La variable d'environnement `VMARK_WORKSPACE` est définie sur le chemin de l'espace de travail dans chaque session de terminal, de sorte que vos scripts peuvent référencer la racine du projet.

[En savoir plus sur le terminal →](/fr/guide/terminal)

## Commande CLI Shell

VMark peut installer une commande shell `vmark` pour que vous puissiez ouvrir des fichiers et des dossiers depuis le terminal.

### Installation

Allez dans **Aide > Installer la commande 'vmark'**. VMark écrit un petit script lanceur dans `/usr/local/bin/vmark` et demande votre mot de passe administrateur (la même approche que VS Code utilise pour sa commande `code`).

### Utilisation

```bash
# Ouvrir un fichier
vmark README.md

# Ouvrir un dossier comme espace de travail
vmark ~/projects/my-blog

# Ouvrir plusieurs fichiers
vmark chapter1.md chapter2.md
```

La commande délègue à `open -b app.vmark`, donc macOS gère le comportement d'instance unique — les fichiers s'ouvrent dans votre fenêtre VMark existante au lieu de lancer un nouveau processus.

### Désinstallation

Allez dans **Aide > Désinstaller la commande 'vmark'** pour supprimer `/usr/local/bin/vmark`. Si le fichier à ce chemin n'a pas été installé par VMark, l'opération est bloquée et vous êtes invité à le supprimer manuellement.
