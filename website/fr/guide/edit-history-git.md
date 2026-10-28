# Exporter l’historique des modifications vers Git

VMark conserve un historique des modifications pour chaque document : chaque enregistrement et chaque modification qu’un client IA effectue via MCP est consigné, avec son auteur. **Fichier → Historique du document → Exporter l’historique des modifications vers Git…** copie cet historique dans un dépôt Git, pour que vous puissiez le parcourir avec `git log`, le comparer ou le garder avec votre projet.

## Comment exporter

1. Ouvrez le document dont vous voulez l’historique.
2. Choisissez **Fichier → Historique du document → Exporter l’historique des modifications vers Git…** (ou lancez *Exporter l’historique des modifications vers Git* depuis la palette de commandes).
3. Choisissez un dossier à l’intérieur du dépôt Git. Le sélecteur s’ouvre dans le dossier du document.

VMark vous indique combien de commits il a ajoutés, ou que la branche était déjà à jour.

## Ce que contient la branche

L’historique va dans sa propre branche, `vmark-journal/<document-uuid>`. VMark ne touche jamais à votre arbre de travail, à votre index, à `HEAD` ni à aucune autre branche, et ne change pas de branche. La branche contient un fichier, nommé d’après le document.

- **Un commit par révision.** Son auteur est celui qui a fait la modification (vous ou le client IA), et sa date est le moment de la modification.
- **Un commit récapitulatif par portion d’historique élaguée.** VMark élague les anciennes révisions pour garder son historique compact. Une suite de révisions élaguées devient un seul commit nommé *Collected history*, qui cite tous ceux qui ont modifié pendant cette portion.

Chaque message de commit se termine par des trailers qui le relient à VMark :

| Trailer | Signification |
|---------|---------------|
| `VMark-Document` | L’identité du document, la même dans chaque commit |
| `VMark-Revision` | La révision que ce commit enregistre |
| `VMark-Parent` | La révision précédente |
| `VMark-Actor` | L’auteur de la modification |
| `VMark-Kind` | La façon dont elle a été consignée : `controlled` (une modification IA via VMark), `observed` (un enregistrement), `gap` (un changement fait hors de VMark), et d’autres |
| `VMark-Tool` | L’outil MCP à l’origine d’une modification IA |
| `VMark-Session`, `VMark-Client` | Le libellé de session et le nom du client IA, s’il les a fournis |
| `VMark-Collected` | Sur un commit récapitulatif : la plage de révisions élaguées qu’il couvre |
| `VMark-Actors` | Sur un commit récapitulatif : tous ceux qui ont modifié dans cette plage, triés |

## Exporter à nouveau

Exportez aussi souvent que vous voulez. Un nouvel export n’ajoute que les révisions faites depuis le précédent ; s’il n’y a rien de nouveau, il ne change rien. Le même historique produit toujours les mêmes commits.

VMark refuse, au lieu d’écraser, quand la branche n’est plus ce qu’il y a laissé :

- **La branche a changé depuis le dernier export** (quelqu’un y a commité, l’a rembobinée ou réécrite). Déplacez ou supprimez la branche, puis exportez à nouveau.
- **Une branche de ce nom existe mais n’est pas l’export VMark de ce document.**
- **La branche est extraite** dans un worktree.

## Prérequis et limites

- Git doit être installé. VMark le cherche dans le `PATH` de votre shell de connexion ; s’il manque, l’export le signale.
- Seul l’historique enregistré est exporté. Les modifications pas encore enregistrées n’en font pas partie.
- VMark crée les commits avec les commandes de bas niveau de Git, donc les hooks de commit ne s’exécutent pas. Les hooks qui surveillent les mises à jour de branches s’exécutent.
- Un gros historique prend du temps : chaque commit coûte quelques processus Git.
- Dans un clone superficiel (shallow clone), VMark ne poursuit qu’une branche qu’il a lui-même exportée depuis cet ordinateur.
- N’extrayez pas la branche d’export pendant un export. Une extraction (checkout) après la dernière vérification des worktrees peut laisser l’index et les fichiers de ce worktree en désaccord avec sa branche, qui a été déplacée.
