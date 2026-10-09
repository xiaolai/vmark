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
| `Cmd + R` / `Ctrl + R` ne fait rien | Le rechargement est bloqué à dessein | [Le rechargement est bloqué](#le-rechargement-est-bloque) |
| Double-cliquer sur un fichier l'a ouvert dans le VMark déjà lancé | Transfert vers l'instance unique sous Windows et Linux | [Une seule instance de VMark sous Windows et Linux](#une-seule-instance-de-vmark-sous-windows-et-linux) |
| Fenêtre vide sous Linux | Moteur de rendu DMABUF de WebKitGTK | [Fenêtre vide sous Linux](#fenetre-vide-sous-linux) |
| Les guillemets droits et `--` restent tels quels sur macOS | Les substitutions intelligentes du système sont désactivées pour VMark | [Guillemets et tirets intelligents sur macOS](#guillemets-et-tirets-intelligents-sur-macos) |
| VMark ne passe jamais en « App Nap » dans le Moniteur d'activité | App Nap est désactivé pour que les assistants IA continuent de fonctionner | [VMark reste actif en arrière-plan](#vmark-reste-actif-en-arriere-plan-app-nap) |
| Une boîte de dialogue de dossier s'ouvre pour un espace de travail récent, ou une erreur mentionne `forbidden path` | Le dossier est hors de ce que VMark peut lire | [Accès aux dossiers et erreurs `forbidden path`](#acces-aux-dossiers-et-erreurs-forbidden-path) |

Pour tout ce qui n'est pas listé ci-dessus, consultez [Signaler des bugs](#signaler-des-bugs).

## Fichiers journaux

VMark génère des fichiers journaux pour faciliter le diagnostic des problèmes. Les journaux incluent les avertissements et les erreurs provenant du backend Rust et du frontend.

### Emplacement des fichiers journaux

| Plateforme | Chemin |
|------------|--------|
| macOS | `~/Library/Logs/app.vmark/` |
| Windows | `%LOCALAPPDATA%\app.vmark\logs\` |
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
- **macOS : double-cliquer sur un fichier téléchargé ne fait rien pendant que VMark est ouvert.** Les fichiers enregistrés par certaines applications portent l'attribut de quarantaine de téléchargement (`com.apple.quarantine`), et macOS peut ignorer silencieusement la demande d'ouvrir un tel fichier dans une application déjà en cours d'exécution. Lorsque vous ouvrez un espace de travail, VMark retire l'attribut du dossier de l'espace de travail et des fichiers qu'il peut ouvrir situés directement à l'intérieur (les sous-dossiers ne sont pas touchés) — c'est le paramètre **Retirer la quarantaine de téléchargement à l'ouverture de l'espace de travail** sous **Paramètres → Avancé → macOS**, activé par défaut. Pour tout autre fichier, utilisez **Fichier → Ouvrir un fichier…**, ou exécutez `xattr -d com.apple.quarantine <file>` dans le Terminal.

### Accès aux dossiers et erreurs `forbidden path`

En dehors de votre dossier personnel et des volumes montés — et, sous Windows, en dehors des lecteurs `C:\` à `F:\` — VMark ne lit que ce à quoi vous lui avez donné accès ; voir [Ce que VMark peut lire sur le disque](/fr/guide/privacy#ce-que-vmark-peut-lire-sur-le-disque).

- **Une boîte de dialogue de dossier s'ouvre lorsque vous choisissez un espace de travail récent.** VMark ne peut pas confirmer que vous avez déjà choisi ce dossier, et rien d'autre ne lui permet d'y lire. La boîte de dialogue s'ouvre sur ce dossier : cliquez sur **Ouvrir** pour le confirmer, et VMark s'en souviendra désormais. Si vous annulez, rien ne s'ouvre.
- **La demande d'un assistant IA pour ouvrir un dossier nécessite une étape de plus.** Après que vous avez approuvé la demande, VMark affiche la même boîte de dialogue ; choisissez-y le dossier, puis laissez l'assistant réessayer.
- **Une erreur mentionne `forbidden path`, ou une image ne s'affiche pas.** Le fichier se trouve hors de tous les emplacements que VMark peut lire — souvent une image à côté d'un document ouvert seul. Ouvrez le dossier du document avec **Fichier → Ouvrir un espace de travail...** pour donner à VMark le dossier entier.

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

### Le rechargement est bloqué

`Cmd + R`, `Ctrl + R` et `Ctrl + Shift + R` ne font rien, et c'est voulu. Recharger la webview effacerait tous les éditeurs ouverts, leur historique d'annulation et tout état non enregistré ; VMark bloque donc ces raccourcis, le déchargement de la page et le menu contextuel propre à la webview. Deux exceptions : `Ctrl + R` atteint le shell lorsque le terminal intégré a le focus (recherche inversée dans l'historique), et `F5` n'est jamais bloqué, car c'est le raccourci de Source Peek. Les builds de développement se contentent d'avertir en cas de documents non enregistrés.

### Une seule instance de VMark sous Windows et Linux

Double-cliquer sur un fichier, ou relancer VMark depuis un lanceur, transmet le fichier au VMark déjà en cours d'exécution et met une fenêtre au premier plan au lieu de démarrer une seconde copie. Un second processus partagerait les données d'application, la session et le stockage des fenêtres du premier, et les deux écraseraient mutuellement leur état — la perte de données à l'origine de #1330. macOS s'est toujours comporté ainsi, par l'intermédiaire du système d'exploitation. Un build de développement (`tauri dev`) utilise son propre identifiant et compte donc comme une application différente.

Sous Windows, si le VMark déjà en cours d’exécution ne répond plus et ne peut plus recevoir le transfert, un nouveau lancement ne démarre pas de seconde copie à côté. Un message s’affiche à la place : ouvrez le Gestionnaire des tâches, arrêtez tous les processus `VMark`, puis relancez VMark (#1527).

Sous Linux, ce mécanisme repose sur le bus de session D-Bus. Dans une session sans `DBUS_SESSION_BUS_ADDRESS` utilisable, VMark démarre quand même, mais sans cette protection — le relancer démarre une seconde copie, avec le risque décrit ci-dessus — et le journal indique que la protection est désactivée. Lancez-le depuis une session de bureau, ou depuis un shell où cette variable est définie.

### Fenêtre vide sous Linux

Sur certaines combinaisons AMD / Mesa / WebKitGTK (le cas signalé était Arch avec KDE Plasma 6, #1058), le moteur de rendu DMABUF de WebKitGTK échoue et la zone de contenu reste vide. VMark définit `WEBKIT_DISABLE_DMABUF_RENDERER=1` avant le démarrage de la webview pour que cela ne se produise pas. Si vous souhaitez retrouver le moteur de rendu DMABUF, lancez VMark avec `WEBKIT_DISABLE_DMABUF_RENDERER=0` — VMark ne définit la variable que si vous ne l'avez pas fait.

### Un raccourci tape un caractère lorsqu'une méthode de saisie chinoise est active

Corrigé. Avec la ponctuation chinoise activée, une méthode de saisie réécrit les touches de ponctuation — la touche accent grave produit `·`, les crochets produisent `【】` — et elle valide ce caractère **avant** que l'application ne soit informée de l'appui sur la touche. Ainsi, `` Ctrl + ` `` basculait le terminal *et* laissait un `·` parasite dans le document, marquant comme modifié un fichier propre.

VMark refuse désormais l'insertion elle-même plutôt que l'appui sur la touche, de sorte qu'une combinaison de commande ne tape rien. La saisie chinoise ordinaire, les touches mortes (`Option + e`) et les caractères AltGr des claviers européens ne sont pas affectés — seules les insertions qui arrivent pendant que `Ctrl` ou `Cmd` est maintenu sont refusées, et aucune combinaison de VMark ne signifie « taper ce caractère ».

Si un raccourci produit encore un caractère parasite, cela vaut la peine de le [signaler](https://github.com/xiaolai/vmark/issues) en précisant le nom de la méthode de saisie et la combinaison exacte.

### Guillemets et tirets intelligents sur macOS

Taper `--` ou `"` dans VMark reste littéral même si votre Mac a l'option *Utiliser les guillemets et tirets intelligents* activée. Sinon, le système réécrirait le texte sous l'éditeur (`-->` dans un bloc Mermaid devenait `—>`) ; VMark désactive donc les substitutions automatiques de tirets, de guillemets et de points pour son propre processus uniquement. Les autres applications ne sont pas affectées, pas plus que les méthodes de saisie et vos propres remplacements de texte. Pour obtenir des guillemets typographiques dans VMark, utilisez les [règles de guillemets intelligents du formateur CJK](/fr/guide/cjk-formatting#styles-de-guillemets-intelligents) ou la bascule de style de guillemets (`Shift + Mod + '`).

### VMark reste actif en arrière-plan (App Nap)

Sur macOS, VMark se soustrait à App Nap pendant toute la durée de son exécution ; le Moniteur d'activité l'affiche donc comme ne passant jamais en veille, même lorsque ses fenêtres sont masquées. App Nap gèlerait la webview — et avec elle chaque requête d'assistant IA (MCP) — jusqu'à ce que vous rameniez une fenêtre au premier plan ; rester actif permet à un assistant de continuer à travailler pendant que vous êtes dans une autre application. Le système peut toujours se mettre en veille lorsqu'il est inactif ; VMark demande seulement à ne pas être mis en App Nap.
