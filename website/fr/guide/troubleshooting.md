# Dépannage

## Recherche rapide

Problèmes courants et où chercher la solution&nbsp;:

| Symptôme | Cause probable | Où regarder |
|---|---|---|
| Le client MCP ne se connecte pas | Fichier de port obsolète ou VMark non lancé | [Problèmes de connexion du serveur MCP](#problemes-de-connexion-du-serveur-mcp) |
| Le fichier ne s'ouvre pas ou affiche du texte illisible | Encodage non UTF-8 ou attribut de quarantaine | [Le fichier ne s'ouvre pas](#le-fichier-ne-s-ouvre-pas) |
| Le Génie IA se bloque ou ne renvoie rien | Fournisseur mal configuré ou CLI absent du PATH | [Le Génie IA ne répond pas](#le-genie-ia-ne-repond-pas) |
| Le raccourci clavier ne fait rien | Réassigné dans les paramètres ou neutralisé par le système | [Le raccourci clavier ne fonctionne pas](#le-raccourci-clavier-ne-fonctionne-pas) |
| Éditeur lent sur les fichiers volumineux | Mémoire par onglet + latence de saisie au-delà de 10 000 lignes | [Performance de l'éditeur](#performance-de-l-editeur) |
| Le menu reste en anglais après changement de langue | Le menu se reconstruit au lancement | [La barre de menus reste en anglais](#la-barre-de-menus-reste-en-anglais-apres-un-changement-de-langue) |
| Export PDF incomplet | Chemins d'images ou permissions d'écriture | [Problèmes d'export/impression](#problemes-d-export-impression) |
| Démarrage lent sous Windows | WebView2 + analyse antivirus | [L'application démarre lentement sous Windows](#l-application-demarre-lentement-sous-windows) |

Pour tout ce qui n'est pas listé ci-dessus, consultez [Signaler des bugs](#signaler-des-bugs).

## Fichiers journaux

VMark génère des fichiers journaux pour faciliter le diagnostic des problèmes. Les journaux incluent les avertissements et les erreurs provenant du backend Rust et du frontend.

### Emplacement des fichiers journaux

| Plateforme | Chemin |
|------------|--------|
| macOS | `~/Library/Logs/app.vmark/` |
| Windows | `%APPDATA%\app.vmark\logs\` |
| Linux | `~/.local/share/app.vmark/logs/` |

### Niveaux de journalisation

| Niveau | Contenu enregistré | Production | Développement |
|--------|--------------------|------------|---------------|
| Error | Échecs, plantages | Oui | Oui |
| Warn | Problèmes récupérables, solutions de repli | Oui | Oui |
| Info | Jalons, changements d'état | Oui | Oui |
| Debug | Traçage détaillé | Non | Oui |

### Rotation des journaux

- Taille maximale du fichier : 5 Mo
- Rotation : conserve un fichier journal précédent
- Les anciens journaux sont automatiquement remplacés

## Signaler des bugs

Lorsque vous signalez un bug, incluez :

1. **Version de VMark** — affichée dans le badge de la barre de navigation ou dans la boîte de dialogue À propos
2. **Système d'exploitation** — version de macOS, build de Windows ou distribution Linux
3. **Étapes de reproduction** — ce que vous avez fait avant que le problème ne survienne
4. **Fichier journal** — joignez ou collez les entrées de journal pertinentes

Les entrées de journal sont horodatées et identifiées par module (par exemple, `[HotExit]`, `[MCP Bridge]`, `[Export]`), ce qui permet de trouver facilement les sections pertinentes.

### Trouver les journaux pertinents

1. Ouvrez le répertoire des journaux indiqué dans le tableau ci-dessus
2. Ouvrez le fichier `.log` le plus récent
3. Recherchez les entrées `ERROR` ou `WARN` proches du moment où le problème s'est produit
4. Copiez les lignes pertinentes et incluez-les dans votre rapport de bug

## Problèmes courants

### L'application démarre lentement sous Windows

VMark est optimisé pour macOS. Sous Windows, le démarrage peut être plus lent en raison de l'initialisation de WebView2. Vérifiez que :

- WebView2 Runtime est à jour
- Le logiciel antivirus n'analyse pas le répertoire de données de l'application en temps réel

### La barre de menus reste en anglais après un changement de langue

Si la barre de menus reste en anglais après avoir changé la langue dans les Paramètres, redémarrez VMark. Le menu est reconstruit au prochain lancement avec la langue enregistrée.

### Le terminal n'accepte pas la ponctuation CJK

Corrigé dans la version v0.6.5+. Mettez à jour vers la dernière version.

### Problèmes de connexion du serveur MCP

Le serveur MCP peut échouer au démarrage ou les clients peuvent ne pas se connecter.

- Assurez-vous que VMark est en cours d'exécution — le serveur MCP ne démarre que lorsque l'application est ouverte.
- Vérifiez qu'aucun autre processus n'utilise le même port. Le serveur MCP écrit un fichier de port pour la découverte des clients ; des fichiers de port obsolètes d'une session précédente peuvent causer des conflits. Redémarrez VMark pour le régénérer.
- Consultez le fichier journal pour les entrées `[MCP Bridge]` afin d'identifier les erreurs de connexion.

### Le raccourci clavier ne fonctionne pas

Un raccourci peut sembler ne pas répondre s'il entre en conflit avec une autre association ou a été personnalisé.

- Ouvrez les Paramètres (`Mod + ,`) et naviguez vers l'onglet **Raccourcis** pour vérifier si le raccourci a été réaffecté.
- Recherchez les associations en double — si deux actions partagent la même combinaison de touches, seule l'une d'elles se déclenchera.
- Sur macOS, certains raccourcis peuvent entrer en conflit avec les associations au niveau du système (par exemple, Mission Control, Spotlight). Vérifiez dans **Réglages Système > Clavier > Raccourcis clavier**.

### Problèmes d'export/impression

L'export PDF peut se bloquer ou produire une sortie incomplète.

- Si des images manquent dans l'export, vérifiez que les chemins des images sont relatifs au document et que les fichiers existent sur le disque. Les URL absolues et les images distantes doivent être accessibles.
- Vérifiez les permissions de fichier sur le répertoire de sortie — VMark a besoin d'un accès en écriture pour enregistrer le fichier exporté.
- Pour les documents volumineux, l'export peut prendre plus de temps. Consultez le fichier journal pour les entrées `[Export]` s'il semble bloqué.

### Le fichier ne s'ouvre pas

VMark peut refuser d'ouvrir un fichier ou afficher un contenu illisible.

- Vérifiez que le fichier dispose des permissions de lecture pour votre compte utilisateur.
- VMark s'attend à du Markdown encodé en UTF-8. Les fichiers dans d'autres encodages (par exemple GB2312, Shift-JIS) peuvent ne pas s'afficher correctement — convertissez-les d'abord en UTF-8.
- Si le fichier est verrouillé par un autre processus (par exemple un client de synchronisation ou un outil de sauvegarde), fermez ce processus et réessayez.

### Performance de l'éditeur

L'éditeur peut ralentir avec des fichiers très volumineux ou de nombreux onglets ouverts.

- Fermez les onglets inutilisés pour libérer de la mémoire — chaque onglet ouvert maintient son propre état d'éditeur.
- Les documents très volumineux (plus de 10 000 lignes) peuvent provoquer un délai de saisie. Envisagez de les diviser en fichiers plus petits.
- Désactivez le Mode Focus et le Mode Machine à écrire si vous n'en avez pas besoin, car ils ajoutent une charge de rendu supplémentaire.

### Le Génie IA ne répond pas

Les Génies IA nécessitent un fournisseur d'IA configuré pour fonctionner.

- Ouvrez les Paramètres et vérifiez qu'un fournisseur d'IA (par exemple Ollama, OpenAI, Anthropic) est configuré avec un nom de modèle valide.
- Le CLI du fournisseur doit être disponible dans votre PATH. Sur macOS, les applications GUI ont un PATH minimal — si le CLI a été installé via Homebrew, assurez-vous que votre profil shell exporte le chemin correct.
- Vérifiez le nom du modèle pour les fautes de frappe. Un nom de modèle incorrect échouera silencieusement ou renverra une erreur.
