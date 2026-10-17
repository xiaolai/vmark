# Fichiers volumineux

VMark ouvre la plupart des fichiers markdown instantanément, mais les fichiers très volumineux nécessitent une attention particulière pour rester réactifs. Cette page décrit comment VMark les gère et comment vous pouvez ajuster son comportement.

## Ce qui compte comme «&nbsp;volumineux&nbsp;»

VMark classe un fichier selon sa taille avant de l'ouvrir&nbsp;:

| Taille | Catégorie | Comportement |
|--------|-----------|--------------|
| < 1 Mo | Petit | S'ouvre instantanément en mode WYSIWYG (texte enrichi). |
| 1 Mo – 5 Mo | Volumineux | S'ouvre en **mode Source** par défaut — sous la seconde. La barre d'état propose «&nbsp;Basculer en WYSIWYG&nbsp;». |
| 5 Mo – 50 Mo | Énorme | Une boîte de dialogue de confirmation apparaît d'abord. S'ouvre uniquement en mode Source. |
| ≥ 50 Mo | Refusé | VMark refuse d'ouvrir le fichier. Utilisez `less`, `bat` ou un outil similaire à la place. |

La taille est vérifiée via le système d'exploitation sans lire le fichier&nbsp;; la décision est donc rapide et ne précharge aucune donnée.

## Pourquoi le mode Source pour les fichiers volumineux

Le mode Source utilise CodeMirror avec virtualisation du viewport — seule la portion visible du document est rendue. Le mode WYSIWYG utilise Tiptap/ProseMirror, qui doit construire un nœud DOM pour chaque bloc du document. Sur un fichier markdown de 1,4 Mo / ~2&nbsp;250 blocs, cela prend environ 15 secondes à la première ouverture&nbsp;; le mode Source ouvre le même fichier en moins d'une seconde.

L'essentiel de ce temps sert à construire et à mettre en page la vue, pas à l'analyse. Sur un long document CJK mesuré sur une machine lente, l'analyse représentait entre un quart et deux cinquièmes du coût d'ouverture de l'éditeur.

## Pendant l'ouverture d'un document

Une fenêtre répond à ses menus, à ses raccourcis et à son bouton de fermeture avant que VMark ne construise la vue en texte enrichi du document, qui apparaît juste après. Auparavant, un long document était construit en premier, et sur une machine lente cela pouvait empêcher la fenêtre d'être prête&nbsp;: les menus répondaient en retard, et le journal indiquait *menu commands did not mount within 5000ms*.

Ce que fait le WYSIWYG à l'ouverture reste aussi proportionné au document&nbsp;:

- Les images se chargent à l'approche de la zone visible.
- **Espacement des lettres CJK** (**Paramètres → Éditeur → Typographie**) ne fait aucun travail tant qu'il est désactivé, sa valeur par défaut, et parcourt le document une seule fois lorsqu'il est activé.
- Les décorations, comme la coloration du code, l'espacement CJK et les marques de lint, coûtent à peu près linéairement selon la longueur du document. Les très longs documents coûtaient auparavant de façon quadratique.

## Indications dans la barre d'état

- **Ouverture d'un fichier volumineux en WYSIWYG&nbsp;:** un indicateur indéterminé avec le libellé *«&nbsp;Ouverture du fichier volumineux (N Mo)…&nbsp;»* apparaît à gauche de la barre d'état pendant le montage de l'éditeur. Il disparaît dès que l'éditeur devient interactif.
- **Fichier ouvert automatiquement en mode Source&nbsp;:** la barre d'état affiche *«&nbsp;Ouvert en mode Source (fichier volumineux).&nbsp;»* avec un lien **Basculer en WYSIWYG**. Cliquer sur le lien fait passer l'onglet actif en WYSIWYG. Fermer puis rouvrir le fichier rétablit le mode Source — le contournement est limité à la session.
- **Document que le WYSIWYG ne peut pas afficher&nbsp;:** un document dont les citations ou les listes sont imbriquées sur plus de 1000 niveaux ne peut pas être analysé en texte enrichi, quelle que soit sa taille. Il s'ouvre en mode Source avec un message indiquant la profondeur, et la barre d'état affiche *«&nbsp;Ouvert en mode Source (impossible à afficher en WYSIWYG).&nbsp;»* Réduisez l'imbrication, puis utilisez **Basculer en WYSIWYG**.

## Paramètres

Ouvrez **Paramètres → Éditeur → Fichiers volumineux**&nbsp;:

- **Ouvrir automatiquement les fichiers de plus de 1 Mo en mode Source** *(activé par défaut)* — désactivez-le si vous préférez le mode WYSIWYG pour les fichiers jusqu'à 5 Mo, en acceptant un temps d'ouverture plus long.
- **Avertir avant d'ouvrir des fichiers de plus de 5 Mo** *(activé par défaut)* — désactivez-le pour ignorer la boîte de dialogue de confirmation pour les fichiers entre 5 Mo et 50 Mo. Ils s'ouvriront tout de même en mode Source.

Le refus strict à 50 Mo n'est pas modifiable par l'utilisateur. La webview ne peut pas conserver en toute sécurité des chaînes arbitrairement grandes sans risque de plantage par épuisement mémoire.

## Conseils

- Si vous devez continuer à éditer un fichier très volumineux en WYSIWYG, envisagez de le diviser en fichiers plus petits liés depuis un document d'index. Le markdown fonctionne bien comme un ensemble de petits chapitres.
- Si vous avez seulement besoin de lire ou de rechercher dans un fichier volumineux, le mode Source avec la règle de numéros de ligne et `Find` (`Mod + F`) est généralement le flux de travail le plus rapide.
- **Format → CJK → Mettre en forme le fichier entier** et les autres commandes appliquées à l'ensemble du document fonctionnent toujours correctement sur les documents en mode Source.

## Cas particuliers

- **Le fichier grossit pendant qu'il est ouvert.** VMark décide de la catégorie selon la taille au moment de l'ouverture. Un fichier qui passe à 2 Mo pendant que vous l'éditez reste dans le mode que vous avez choisi.
- **Liens symboliques.** Les tailles reflètent celles du fichier cible&nbsp;; un lien symbolique vers un fichier de 10 Mo est donc traité comme énorme.
- **Fichiers vides.** Les fichiers de zéro octet sont considérés comme petits et s'ouvrent en WYSIWYG.
- **Le fichier disparaît entre la vérification de taille et la lecture.** L'erreur classique «&nbsp;fichier introuvable&nbsp;» apparaît — aucun avertissement supplémentaire n'est émis.

## Limitations connues

- Les seuils sont des tailles en octets, qui sont un proxy pour le coût réel (nombre de blocs). Un fichier de 600 Ko avec des milliers de petits blocs peut être plus lent qu'un fichier de 1,2 Mo composé de longs paragraphes. Les valeurs par défaut sont conservatrices.
- Le WYSIWYG construit toujours chaque bloc du document à l'ouverture — seules les images et les formules mathématiques en ligne attendent l'approche de la zone visible —, donc passer un fichier volumineux en WYSIWYG coûte tout le temps d'ouverture décrit ci-dessus.
