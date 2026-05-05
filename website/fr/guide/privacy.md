# Confidentialité

VMark respecte votre vie privée. Voici exactement ce qui se passe — et ce qui ne se passe pas.

## Ce que VMark envoie

VMark inclut un **vérificateur de mises à jour automatique** qui contacte périodiquement notre serveur pour voir si une nouvelle version est disponible. Il s'agit de la **seule** requête réseau que VMark effectue.

Chaque vérification envoie exactement ces champs — rien de plus :

| Données | Exemple | Objectif |
|---------|---------|---------|
| Adresse IP | `203.0.113.42` | Inhérent à toute requête HTTP — nous ne pouvons pas ne pas la recevoir |
| OS | `darwin`, `windows`, `linux` | Pour fournir le bon paquet de mise à jour |
| Architecture | `aarch64`, `x86_64` | Pour fournir le bon paquet de mise à jour |
| Version de l'app | `0.5.10` | Pour déterminer si une mise à jour est disponible |
| Hash de machine | `a3f8c2...` (hex de 64 caractères) | Compteur d'appareils anonyme — SHA-256 du nom d'hôte + OS + arch ; non réversible |

L'URL complète ressemble à :

```text
GET https://log.vmark.app/update/latest.json?target=darwin&arch=aarch64&version=0.5.10
X-Machine-Id: a3f8c2b1d4e5f6078a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1
```

Vous pouvez vérifier cela vous-même — l'endpoint est dans [`tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json) (cherchez `"endpoints"`), et le hash est dans [`lib.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/lib.rs) (cherchez `machine_id_hash`).

## Ce que VMark N'envoie PAS

- Vos documents ou leur contenu
- Noms de fichiers ou chemins
- Modèles d'utilisation ou analyses de fonctionnalités
- Informations personnelles de quelque nature que ce soit
- Rapports de plantage
- Données de frappe ou d'édition
- Identifiants matériels réversibles ou empreintes digitales
- Le hash de machine est un condensé SHA-256 à sens unique — il ne peut pas être inversé pour récupérer votre nom d'hôte ou toute autre entrée

## Comment nous utilisons les données

Nous agrégeons les journaux de vérification des mises à jour pour produire les statistiques en direct affichées sur notre [page d'accueil](/) :

| Métrique | Comment elle est calculée |
|----------|--------------------------|
| **Appareils uniques** | Nombre de hashes de machine distincts par jour/semaine/mois |
| **IPs uniques** | Nombre d'adresses IP distinctes par jour/semaine/mois |
| **Pings** | Nombre total de requêtes de vérification des mises à jour |
| **Plateformes** | Nombre de pings par combinaison OS + architecture |
| **Versions** | Nombre de pings par version de l'application |

Ces chiffres sont publiés ouvertement sur [`log.vmark.app/api/stats`](https://log.vmark.app/api/stats). Rien n'est caché.

**Mises en garde importantes :**
- Les IPs uniques sous-comptent les vrais utilisateurs — plusieurs personnes derrière le même routeur/VPN comptent comme une
- Les appareils uniques fournissent des comptes plus précis, mais un changement de nom d'hôte ou une nouvelle installation OS génère un nouveau hash
- Les pings sur-comptent les vrais utilisateurs — une même personne peut vérifier plusieurs fois par jour

## Conservation des données

- Les journaux sont stockés sur notre serveur au format de journal d'accès standard
- Les fichiers journaux sont renouvelés à 1 Mo et seuls les 3 fichiers les plus récents sont conservés
- Les journaux ne sont pas partagés avec qui que ce soit
- Il n'y a pas de système de compte — VMark ne sait pas qui vous êtes
- Le hash de machine n'est lié à aucun compte, e-mail ou adresse IP — c'est uniquement un compteur d'appareils pseudonyme
- Nous n'utilisons pas de cookies de suivi, de prise d'empreintes digitales ou de SDK d'analyse

## Transparence open source

VMark est entièrement open source. Vous pouvez vérifier tout ce qui est décrit ici :

- Configuration de l'endpoint de mise à jour : [`src-tauri/tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json)
- Génération du hash de machine : [`src-tauri/src/lib.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/lib.rs) — cherchez `machine_id_hash`
- Agrégation des statistiques côté serveur : [`scripts/vmark-stats-json`](https://github.com/xiaolai/vmark/blob/main/scripts/vmark-stats-json) — le script exact qui s'exécute sur notre serveur pour produire les [statistiques publiques](https://log.vmark.app/api/stats)
- Aucun autre appel réseau n'existe dans la base de code — cherchez `fetch`, `http` ou `reqwest` vous-même

## Désactiver les vérifications de mises à jour

Si vous préférez désactiver entièrement les vérifications automatiques de mises à jour, vous pouvez bloquer `log.vmark.app` au niveau réseau (pare-feu, `/etc/hosts` ou DNS). VMark continuera à fonctionner normalement sans cela — vous ne recevrez simplement pas les notifications de mise à jour.
