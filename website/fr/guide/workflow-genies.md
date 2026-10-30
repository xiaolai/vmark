# Genies de workflow

Un **Genie de workflow** est un [workflow de Genies](/fr/guide/workflows) — un pipeline YAML à plusieurs étapes — enregistré dans votre dossier de Genies sous forme de fichier `.yml` ou `.yaml`. Il apparaît dans le sélecteur de Genies (`Mod + Y`) et dans **Édition → Génies** exactement comme un Genie Markdown ; le choisir exécute tout le pipeline via le moteur de workflow au lieu d’envoyer une seule invite.

## Prérequis

| Prérequis | Pourquoi |
|-----------|----------|
| **Paramètres → Avancé → Outils de développement**, puis **Moteur de workflow** activé | Le moteur est désactivé par défaut. Le sélecteur liste toujours un Genie de workflow quand le moteur est désactivé, mais son exécution échoue avec « Le moteur de workflow est désactivé dans les préférences » |
| Un espace de travail ouvert | Les étapes d’action comme `action/save-file` résolvent les chemins par rapport à la racine de l’espace de travail ; sans espace de travail, VMark affiche une notification et ne lance pas l’exécution |
| Un [fournisseur d’IA](/fr/guide/ai-providers) configuré | Les étapes Genie appellent le fournisseur actif, le même que celui utilisé par les Genies Markdown |

## En écrire un

Placez le fichier YAML n’importe où sous le dossier de Genies (**Édition → Génies → Ouvrir le dossier des génies**) ; les sous-dossiers deviennent des catégories, comme pour les Genies Markdown. Le sélecteur affiche le nom de fichier comme nom du Genie, et la `description` du YAML (ou, à défaut, son `name`) comme ligne secondaire. La portée d’un Genie de workflow est le document entier — l’exécution n’a aucune sélection sur laquelle travailler — donc chaque étape fournit son propre `with: { input: … }`, et les Genies Markdown qu’elle appelle le lient tel quel à leur substitut `{{content}}`.

L’exemple fourni `triage-and-translate.yml` est un point de départ prêt à l’emploi : copiez-le dans le dossier et remplacez le texte d’amorce. Son emplacement, le schéma YAML complet, les expressions, les approbations, les modèles par étape et les délais sont tous documentés dans [Workflows de Genies](/fr/guide/workflows) ; l’exécution d’un génie de workflow a bien lieu et ses boîtes de dialogue d’approbation s’affichent comme d’habitude, mais elle n’affiche pas le graphe des étapes en direct, ne peut pas être annulée depuis le panneau Workflow (le bouton d’exécution du panneau signale que le moteur est occupé pendant qu’elle tourne), et le panneau ne propose pas **Restaurer les fichiers** pour elle.

Voir aussi [AI Genies](/fr/guide/ai-genies) pour le format des Genies Markdown à invite unique.
