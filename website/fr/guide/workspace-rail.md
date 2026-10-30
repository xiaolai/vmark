# Barre des espaces de travail

::: warning Expérimental
La barre des espaces de travail est expérimentale et **désactivée par défaut**. Activez-la dans **Paramètres → Fichiers et images → Espace de travail → Barre d'espaces de travail**. Barre désactivée, VMark se comporte exactement comme avant — un espace de travail par fenêtre.
:::

La barre des espaces de travail permet à une seule fenêtre de contenir **plusieurs espaces de travail à la fois**, présentés sous forme d'une bande verticale de pastilles colorées sur le bord gauche. Cliquer sur un espace de travail effectue un **changement de contexte complet**&nbsp;: les onglets de l'éditeur, l'arborescence de fichiers de la barre latérale, la disposition des volets divisés et l'état de la barre latérale et du plan basculent tous vers l'ensemble propre à cet espace de travail — comme changer d'espace (Spaces) dans un navigateur, et pas seulement changer de filtre.

## Ce qui change, ce qui reste

| Surface | Lors d'un changement dans la barre |
|---------|------------------------------------|
| Barre d'onglets de l'éditeur | N'affiche que les onglets de l'espace de travail actif (plus les pages du navigateur) |
| Arborescence de fichiers de la barre latérale | Se réancre sur l'espace de travail actif, avec son propre état de dossiers ouverts et de défilement |
| Volets divisés | Chaque espace de travail mémorise sa propre disposition divisée |
| Plan | L'état de repli, de filtre et de défilement de chaque onglet suit l'espace de travail |
| Onglet suivant/précédent, menu contextuel des onglets, « onglets ouverts » de l'Ouverture rapide | Limités à l'espace de travail actif |
| Rouvrir l'onglet fermé | Les onglets fermés sont consignés par espace de travail (plus une portée partagée pour le navigateur) et rouverts du plus récent au plus ancien depuis **Fichier → Rouvrir l'onglet fermé**, la palette de commandes ou un raccourci que vous attribuez dans Paramètres → Raccourcis (il est livré sans raccourci&nbsp;: les combinaisons voisines sont déjà prises). Un document rouvert est relu depuis le disque et montre donc le fichier tel qu'il est maintenant&nbsp;; si le fichier a été déplacé ou supprimé, l'onglet n'est pas restauré et un avis en indique la raison. Un onglet sans titre se rouvre vide. Les modifications non enregistrées ne sont pas récupérées — la fermeture d'un onglet modifié a déjà demandé s'il fallait enregistrer |
| **Pages du navigateur** | **Globales à la fenêtre** — accessibles depuis chaque espace de travail |
| Menus Fichiers récents / Espaces de travail récents | Globaux |
| Enregistrement automatique, invites d'enregistrement, surveillance des fichiers | Couvrent **tous** les onglets, masqués ou non |

Changer d'espace de travail ne ferme jamais rien&nbsp;: les onglets d'un espace de travail masqué restent ouverts en arrière-plan, continuent d'être enregistrés automatiquement et déclenchent toujours une invite d'enregistrement si vous fermez la fenêtre avec des modifications non enregistrées.

## Fichiers indépendants

Les fichiers ouverts depuis l'extérieur de toutes les racines d'espace de travail sont regroupés dans une entrée synthétique **Fichiers indépendants** (l'icône de fichiers empilés). Y basculer affiche ces onglets&nbsp;; elle apparaît automatiquement quand c'est nécessaire.

## Déplacer des fichiers entre espaces de travail

L'appartenance suit le chemin du fichier&nbsp;:

- **Enregistrer sous** dans le dossier d'un autre espace de travail y déplace l'onglet — et, s'il s'agit de l'onglet que vous regardez, l'espace de travail visible le suit.
- Les renommages ou déplacements sur le disque (y compris depuis le Finder) rattachent l'onglet de la même manière.
- Ouvrir un fichier qui appartient à un espace de travail *masqué* (via l'Ouverture rapide, les fichiers récents ou une boîte de dialogue de fichier) bascule d'abord vers cet espace de travail, afin que l'onglet demandé soit bien celui que vous voyez.

## Sessions et redémarrage

La configuration de chaque espace de travail ne mémorise **que ses propres onglets** et sa disposition divisée. Les pages du navigateur ouvertes par une personne sont conservées par fenêtre. La sortie à chaud (hot exit) restaure chaque espace de travail de la fenêtre — y compris l'état de la barre latérale propre à chaque espace de travail et l'historique consigné des onglets fermés — et réactive l'espace de travail dans lequel vous étiez.

## Comportement de l'IA (MCP)

Les clients d'IA qui ouvrent des documents via MCP ne vous arrachent jamais votre espace de travail visible&nbsp;: `workspace.open` crée un **onglet en arrière-plan** et renvoie son `tabId` pour les appels de document suivants. Seule l'action explicite `workspace.switch_tab` modifie ce que vous voyez, et sa réponse indique `workspaceSwitched: true` pour que l'IA puisse vous signaler que cela s'est produit. Voir la [Référence des outils MCP](/fr/guide/mcp-tools).

## Actions de la barre

| Action | Comment |
|--------|---------|
| Changer d'espace de travail | Cliquez sur sa pastille |
| Ajouter un espace de travail | **Fichier > Ouvrir un espace de travail** (un dossier déjà présent dans la barre y bascule au lieu d'être dupliqué) |
| Réordonner | Faites glisser une pastille sur une autre |
| Déplacer dans sa propre fenêtre | Faites glisser une pastille hors de la fenêtre |
| Dupliquer dans une nouvelle fenêtre | Le bouton **⧉** au survol |
| Fermer un espace de travail | Clic droit → Fermer. Tous ses onglets se ferment avec lui, y compris les onglets épinglés ; chaque onglet modifié demande d'abord, et annuler conserve l'espace de travail |

## Sessions de terminal

Chaque espace de travail de la barre possède ses propres sessions de terminal. Un changement dans la barre permute les onglets de terminal visibles&nbsp;; les shells des espaces de travail masqués continuent de tourner sans être touchés — aucun `cd` n'y est tapé, qu'ils soient occupés ou inactifs — et revenir en arrière réaffiche les mêmes shells, la session que vous regardiez étant mémorisée pour chaque espace de travail. Les nouvelles sessions (le bouton **+**, « Ouvrir un terminal ici », « Exécuter dans le terminal ») sont créées dans l'espace de travail actif et démarrent à sa racine&nbsp;; fermer un espace de travail ou le déplacer dans sa propre fenêtre ferme ses sessions avec lui. Détails dans le [guide du terminal](/fr/guide/terminal#sessions-de-terminal-et-barre-des-espaces-de-travail).

## Limitation connue

Sur macOS, deux graphies d'un même dossier qui ne diffèrent que par la casse (possible sur les volumes insensibles à la casse) sont traitées comme des espaces de travail **différents**. C'est délibéré&nbsp;: l'identité d'un espace de travail est exacte à l'octet près sur macOS et Linux, et insensible à la casse sous Windows.
