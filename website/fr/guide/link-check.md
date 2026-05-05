# Vérification des liens

VMark vérifie que les cibles locales de liens et d'images dans votre markdown existent réellement sur le disque. S'exécute aux côtés du [moteur de lint markdown](/fr/guide/lint) sur `Cmd-Shift-L` ou **Outils → Vérifier le Markdown**.

## Ce qui est vérifié

Pour chaque lien et image local dans le document&nbsp;:

- `[texte](./other.md)` — le fichier `./other.md` se résout et existe
- `![alt](./image.png)` — le fichier image existe
- `[texte](./other.md#section)` — le fichier existe (la vérification d'ancre est gérée par la [règle `linkFragments`](/fr/guide/lint#r%C3%A9f%C3%A9rence-des-r%C3%A8gles))

Lorsqu'une cible est manquante, le texte du lien est souligné par un trait rouge et une entrée apparaît dans le badge de lint / la navigation F2.

## Ce qui est ignoré

- **Liens fragments uniquement** (`#ancre`) — gérés par la règle `linkFragments` qui vérifie par rapport aux titres du document actuel
- **URL externes** — `http://`, `https://`, `ftp://`, `mailto:`, `tel:`, `data:`, `file:`
- **Documents sans titre** — sans chemin de fichier enregistré, les URL relatives ne peuvent pas être résolues par rapport à un répertoire

## Comment fonctionne la résolution

La vérification des liens résout les chemins par rapport au répertoire du fichier source&nbsp;:

| Lien dans `/repo/docs/intro.md` | Se résout en |
|---|---|
| `[a](./other.md)` | `/repo/docs/other.md` |
| `[a](../shared.md)` | `/repo/shared.md` |
| `[a](images/logo.png)` | `/repo/docs/images/logo.png` |
| `[a](/docs/intro.md)` | `/repo/docs/docs/intro.md` (enraciné comme relatif dans le répertoire du fichier) |

Les fragments sont supprimés avant la recherche du fichier — `[a](./other.md#section)` vérifie uniquement `./other.md`.

## Performance

- **Asynchrone** — s'exécute en parallèle avec les règles synchrones&nbsp;; les résultats fusionnent dès qu'ils sont prêts
- **Dédupliqué** — chaque chemin résolu unique est vérifié une fois par exécution, même s'il est lié plusieurs fois
- **Pas de déclenchement à la frappe** — un `fs.exists` à chaque frappe encombrerait&nbsp;; ne s'exécute que sur le déclencheur de lint explicite
- **Tolérance aux erreurs opérationnelles** — si `fs.exists` lève une exception (permission refusée, problème de portée de capacité), le résultat est `error` (ignoré), pas `missing`. Mieux vaut silencieux que faux.

## Codes de diagnostic

| Code | Gravité | Déclencheur |
|---|---|---|
| **M001** | Erreur | Fichier image introuvable au chemin local résolu |
| **M002** | Erreur | Fichier lié introuvable au chemin local résolu |

## Voir aussi

- [Lint Markdown](/fr/guide/lint) — référence complète des règles
- [Paramètres → Markdown → Lint](/fr/guide/settings#lint)
