# Édition multi-curseur

VMark prend en charge l'édition multi-curseur puissante en modes WYSIWYG et Source, vous permettant de modifier plusieurs emplacements simultanément.

## Démarrage rapide

| Action | Raccourci |
|--------|----------|
| Ajouter un curseur à la prochaine correspondance | `Mod + D` |
| Ignorer la correspondance, passer à la suivante | `Mod + Shift + D` |
| Ajouter des curseurs à toutes les correspondances | `Mod + Shift + L` |
| Annuler le dernier ajout de curseur | `Alt + Mod + Z` |
| Ajouter un curseur au-dessus | `Mod + Alt + Haut` |
| Ajouter un curseur en-dessous | `Mod + Alt + Bas` |
| Ajouter/supprimer un curseur au clic | `Alt + Clic` |
| Réduire à un seul curseur | `Échap` |

::: tip
**Mod** = Cmd sur macOS, Ctrl sur Windows/Linux
**Alt** = Option sur macOS
:::

## Ajouter des curseurs

### Sélectionner l'occurrence suivante (`Mod + D`)

1. Sélectionnez un mot ou placez le curseur sur un mot
2. Appuyez sur `Mod + D` pour ajouter un curseur à l'occurrence suivante
3. Appuyez à nouveau pour ajouter d'autres curseurs
4. Tapez pour modifier tous les emplacements à la fois

<div class="feature-box">
<strong>Exemple :</strong> Pour renommer une variable <code>count</code> en <code>total</code> :
<ol>
<li>Double-cliquez sur <code>count</code> pour le sélectionner</li>
<li>Appuyez sur <code>Mod + D</code> de façon répétée pour sélectionner chaque occurrence</li>
<li>Tapez <code>total</code> — toutes les occurrences se mettent à jour simultanément</li>
</ol>
</div>

### Sélectionner toutes les occurrences (`Mod + Shift + L`)

Sélectionnez toutes les occurrences du mot ou de la sélection actuelle en une fois :

1. Sélectionnez un mot ou du texte
2. Appuyez sur `Mod + Shift + L`
3. Toutes les occurrences correspondantes dans le bloc actuel sont sélectionnées
4. Tapez pour remplacer toutes les occurrences en même temps

### Alt + Clic

Maintenez `Alt` (Option sur macOS) et cliquez pour :
- **Ajouter** un curseur à cette position
- **Supprimer** un curseur s'il en existe déjà un là

C'est utile pour placer des curseurs à des positions arbitraires qui ne correspondent pas à du texte.

### Ignorer l'occurrence (`Mod + Shift + D`)

Lorsque `Mod + D` sélectionne une correspondance que vous ne souhaitez pas, ignorez-la :

1. Appuyez sur `Mod + D` pour commencer à ajouter des correspondances
2. Si la dernière correspondance n'est pas souhaitée, appuyez sur `Mod + Shift + D` pour l'ignorer
3. La correspondance ignorée est supprimée et la suivante est sélectionnée à la place

C'est l'équivalent multi-curseur de « Trouver le suivant » — cela vous permet de choisir quelles occurrences modifier.

### Annulation douce (`Alt + Mod + Z`)

Annulez le dernier ajout de curseur sans perdre tous vos curseurs :

1. Appuyez sur `Mod + D` plusieurs fois pour accumuler des curseurs
2. Si vous en avez ajouté un de trop, appuyez sur `Alt + Mod + Z`
3. Le dernier curseur ajouté est supprimé, restaurant l'état précédent

Contrairement à `Échap` (qui réduit tout), l'annulation douce recule d'un curseur à la fois.

### Ajouter un curseur au-dessus / en-dessous (`Mod + Alt + Haut/Bas`)

Ajoutez des curseurs verticalement, une ligne à la fois :

1. Placez votre curseur sur une ligne
2. Appuyez sur `Mod + Alt + Bas` pour ajouter un curseur sur la ligne suivante
3. Appuyez à nouveau pour continuer à ajouter des curseurs vers le bas
4. Utilisez `Mod + Alt + Haut` pour ajouter des curseurs vers le haut

C'est idéal pour modifier du texte aligné en colonnes ou faire la même modification sur des lignes consécutives.

## Édition avec plusieurs curseurs

Une fois que vous avez plusieurs curseurs, toutes les opérations d'édition standard fonctionnent à chaque curseur :

### Saisie
- Les caractères sont insérés à toutes les positions du curseur
- Les sélections sont remplacées à toutes les positions

### Suppression
- **Retour arrière** — supprime le caractère avant chaque curseur
- **Supprimer** — supprime le caractère après chaque curseur

### Navigation
- **Touches fléchées** — déplacent tous les curseurs ensemble
- **Shift + Flèche** — étend la sélection à chaque curseur
- **Mod + Flèche** — saute par mot/ligne à chaque curseur

### Échappement Tab

L'échappement Tab fonctionne indépendamment pour chaque curseur :

- Les curseurs à l'intérieur de **gras**, *italique*, `code` ou ~~barré~~ sautent à la fin de ce formatage
- Les curseurs à l'intérieur des liens s'échappent du lien
- Les curseurs avant les crochets fermants `)` `]` `}` sautent par-dessus
- Les curseurs dans le texte brut restent en place

Cela vous permet de vous échapper de plusieurs régions formatées simultanément. Voir [Navigation intelligente par Tab](./tab-navigation.md#prise-en-charge-multi-curseur) pour les détails.

### Presse-papiers

**Copier** (`Mod + C`) :
- Copie le texte de toutes les sélections, joint par des retours à la ligne

**Coller** (`Mod + V`) :
- Si le presse-papiers a le même nombre de lignes que de curseurs, chaque ligne va à chaque curseur
- Sinon, le contenu complet du presse-papiers est collé à tous les curseurs

## Portée par bloc

Les opérations multi-curseur sont **limitées au bloc actuel** pour éviter les modifications non intentionnelles dans des sections non liées.

### En mode WYSIWYG
- Les curseurs ne peuvent pas traverser les frontières de blocs de code
- Si votre curseur principal est à l'intérieur d'un bloc de code, les nouveaux curseurs restent dans ce bloc

### En mode Source
- Les lignes vides agissent comme frontières de blocs
- `Mod + D` et `Mod + Shift + L` correspondent uniquement dans le paragraphe actuel

<div class="feature-box">
<strong>Pourquoi la portée par bloc ?</strong>
<p>Cela évite de modifier accidentellement un nom de variable dans des sections de code non liées ou de changer du texte dans des paragraphes différents qui correspondent par hasard.</p>
</div>

## Réduire les curseurs

Appuyez sur `Échap` pour réduire à un seul curseur à la position principale.

::: tip Stabilité du curseur
Les curseurs réduits restent stables lorsque du texte est inséré à la position du curseur. Ils ne s'étendront pas de façon inattendue en sélections après des insertions mappées (corrigé en v0.6.x).
:::

## Retour visuel

- **Curseur principal** — curseur clignotant standard
- **Curseurs secondaires** — curseurs clignotants supplémentaires avec un style distinct
- **Sélections** — la sélection de chaque curseur est mise en évidence

En mode sombre, les couleurs de curseur et de sélection s'ajustent automatiquement pour la visibilité.

## Comparaison des modes

| Fonctionnalité | WYSIWYG | Source |
|---------------|---------|--------|
| `Mod + D` | ✓ | ✓ |
| `Mod + Shift + D` (Ignorer) | ✓ | ✓ |
| `Mod + Shift + L` | ✓ | ✓ |
| `Alt + Mod + Z` (Annulation douce) | ✓ | ✓ |
| `Mod + Alt + Haut/Bas` | ✓ | ✓ |
| `Alt + Clic` | ✓ | ✓ |
| Portée par bloc | Délimiteurs de code | Lignes vides |
| Recherche avec retour à la ligne | ✓ | ✓ |

## Conseils et bonnes pratiques

### Renommer des variables
1. Double-cliquez sur le nom de la variable
2. `Mod + Shift + L` pour sélectionner toutes les occurrences dans le bloc
3. Tapez le nouveau nom

### Ajouter des préfixes/suffixes
1. Placez le curseur avant/après le texte répété
2. `Mod + D` pour ajouter des curseurs à chaque occurrence
3. Tapez le préfixe ou le suffixe

### Modifier des éléments de liste
1. Sélectionnez le motif commun (comme `- ` au début des lignes)
2. `Mod + Shift + L` pour tout sélectionner
3. Modifiez tous les éléments de la liste en même temps

### Quand utiliser chaque raccourci

| Scénario | Meilleur raccourci |
|----------|-------------------|
| Sélection prudente et progressive | `Mod + D` |
| Ignorer une correspondance non souhaitée | `Mod + Shift + D` |
| Remplacer tout dans le bloc | `Mod + Shift + L` |
| Annuler la dernière étape de curseur | `Alt + Mod + Z` |
| Modifier des lignes consécutives | `Mod + Alt + Haut/Bas` |
| Positions arbitraires | `Alt + Clic` |
| Sortie rapide | `Échap` |

## Limitations

- **Nœuds atomiques** : Impossible de placer des curseurs à l'intérieur des images, du contenu intégré ou des blocs mathématiques en mode WYSIWYG
- **Saisie IME** : Lors de l'utilisation de méthodes de saisie (chinois, japonais, etc.), la composition n'affecte que le curseur principal
- **Portée dans le document** : Les sélections sont limitées aux blocs, pas à l'intégralité du document

## Référence des raccourcis clavier

| Action | Raccourci |
|--------|----------|
| Sélectionner l'occurrence suivante | `Mod + D` |
| Ignorer l'occurrence | `Mod + Shift + D` |
| Sélectionner toutes les occurrences | `Mod + Shift + L` |
| Annulation douce du curseur | `Alt + Mod + Z` |
| Ajouter un curseur au-dessus | `Mod + Alt + Haut` |
| Ajouter un curseur en-dessous | `Mod + Alt + Bas` |
| Ajouter/supprimer un curseur | `Alt + Clic` |
| Réduire à un seul curseur | `Échap` |
| Déplacer tous les curseurs | Touches fléchées |
| Étendre toutes les sélections | `Shift + Flèche` |
| Sauter par mot | `Alt + Flèche` |
| Sauter par ligne | `Mod + Flèche` |

<!-- Styles in style.css -->
