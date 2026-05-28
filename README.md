# My Favorite Places

Application full-stack de démonstration utilisée comme support pour la pratique de Docker, Docker Compose et CI/CD.

Elle est composée :

- d'un **client** React + TypeScript + Vite, servi par Nginx en production (`./client`)
- d'un **serveur** Express + TypeORM en TypeScript (`./server`)
- d'une base **PostgreSQL 17**
- d'un **Portainer** (en local uniquement) pour visualiser les conteneurs

Le client appelle le serveur via Nginx, qui proxyfie `/api` vers `http://server:3000`.

---

## Sommaire

1. [Travailler en local et reproduire la production](#1-travailler-en-local-et-reproduire-la-production)
2. [Workflows CI/CD : déclencheurs et rôle](#2-workflows-cicd--déclencheurs-et-rôle)
3. [Effets de bord des workflows](#3-effets-de-bord-des-workflows)
4. [Environnements d'exécution](#4-environnements-dexécution)
5. [Comment le ou la dev intervient dans le processus](#5-comment-le-ou-la-dev-intervient-dans-le-processus)

---

## 1. Travailler en local et reproduire la production

### Prérequis

- Docker Desktop (ou Docker Engine + Docker Compose v2)
- Git
- Optionnel pour développer hors conteneur : Node.js 22 + Yarn

### Lancer la stack de développement

Le fichier `compose.yaml` est le point d'entrée du dev. Il **build les images localement** depuis les sources (`./client` et `./server`), démarre la base et expose Portainer.

```bash
docker compose up --build
```

Services exposés :

| Service     | URL                     | Rôle                                 |
| ----------- | ----------------------- | ------------------------------------ |
| `client`    | http://localhost        | Front React servi par Nginx (port 80) |
| `server`    | http://localhost:3000   | API Express (`GET /api/bonjour`, `/api/users`, `/api/addresses`) |
| `db`        | (interne)               | PostgreSQL 17                        |
| `portainer` | http://localhost:9000   | UI de supervision des conteneurs     |

Quelques commandes utiles :

```bash
# voir les logs d'un service
docker compose logs -f server

# rebuilder uniquement le client
docker compose build client

# stopper et nettoyer (sans toucher au volume de données)
docker compose down

# tout nettoyer, y compris le volume Postgres
docker compose down -v
```

### Développer en dehors de Docker (optionnel, plus rapide)

Le serveur et le client peuvent tourner en hors conteneur, en gardant Postgres dans Docker :

```bash
# Postgres uniquement
docker compose up -d db

# Serveur (hot-reload)
cd server && yarn install && yarn dev

# Client (HMR Vite)
cd client && yarn install && yarn dev
```

Les variables `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` ont des valeurs par défaut côté serveur (`localhost` / `postgres` / `supersecret` / `postgres`), il n'y a donc pas besoin de `.env` pour démarrer.

### Reproduire la production en local

Le fichier `compose.prod.yml` reproduit fidèlement la prod : il **ne build rien**, il **pull les images publiées sur GHCR** par le workflow `build.yml` et n'embarque pas Portainer.

```bash
docker compose -f compose.prod.yml pull
docker compose -f compose.prod.yml up -d
```

Les images sont publiques sur `ghcr.io/lerourou/my-favorite-places-{client,server}:latest`. C'est le moyen le plus proche d'une exécution réelle : on consomme les artefacts produits par la CI au lieu de builder depuis ses sources locales.

### Lancer les tests serveur en local

```bash
cd server
npm ci      # ou yarn install --frozen-lockfile
npm test    # exécute Jest, comme la CI
```

---

## 2. Workflows CI/CD : déclencheurs et rôle

Le pipeline est composé de **deux workflows GitHub Actions** dans `.github/workflows/`.

### `ci.yml` — Pull Request → main

| Déclencheur | Évènement                                |
| ----------- | ---------------------------------------- |
| `pull_request` sur la branche `main` | Ouverture, mise à jour, réouverture d'une PR ciblant `main` |

**Ce qu'il fait :** check-out du repo → installation Node 22 avec cache npm → `npm ci` puis `npm test` dans `./server`. Aucun build, aucune publication. Son rôle est de **bloquer le merge** si les tests cassent.

### `build.yml` — Build & push des images

| Déclencheur          | Évènement                                                                |
| -------------------- | ------------------------------------------------------------------------ |
| `push` sur `main`    | Tout commit qui atterrit sur `main` (typiquement un merge de PR)         |
| `workflow_dispatch`  | Déclenchement manuel depuis l'onglet **Actions** de GitHub               |

**Ce qu'il fait, en deux jobs séquentiels :**

1. `test` — rejoue les tests Jest du serveur (filet de sécurité avant publication).
2. `build-and-push` *(dépend de `test`)* — login sur `ghcr.io`, puis build et push :
   - `ghcr.io/<owner>/my-favorite-places-client:latest`
   - `ghcr.io/<owner>/my-favorite-places-server:latest`

Le nom du propriétaire (`IMAGE_OWNER`) est forcé en minuscules pour respecter la nomenclature OCI.

---

## 3. Effets de bord des workflows

### `ci.yml`

- Aucune mutation : pas de publication, pas d'artefact, pas de déploiement.
- Renvoie un statut `success`/`failure` à GitHub, qui peut être utilisé comme **status check obligatoire** sur la branche `main`.

### `build.yml`

- **Artefacts** : pousse deux images Docker `:latest` sur **GitHub Container Registry** (`ghcr.io`). Les tags `latest` sont **écrasés à chaque push sur `main`** — il n'y a pas d'historique versionné des images.
- **Permissions** : utilise le `GITHUB_TOKEN` automatique avec `packages: write` pour publier. Aucun secret tiers à provisionner.
- **CD** : **aucun déploiement automatique** n'est branché. Pour mettre à jour un environnement, il faut tirer manuellement les nouvelles images avec `compose.prod.yml` (`docker compose -f compose.prod.yml pull && up -d`).
- **Notifications** : pas de Slack/email/webhook configuré. Les retours passent uniquement par l'UI GitHub (badges PR, onglet Actions, emails GitHub par défaut).

> ⚠️ Les images ne sont pas signées et le tag flottant `:latest` rend les rollbacks compliqués : prévoir une stratégie de tag par SHA ou par version sémantique si l'on veut industrialiser.

---

## 4. Environnements d'exécution

| Environnement       | Où                                   | Définition           | Source des images          | À quoi il sert                                                                 |
| ------------------- | ------------------------------------ | -------------------- | -------------------------- | ------------------------------------------------------------------------------ |
| **Local / dev**     | Poste développeur                    | `compose.yaml`       | Build local depuis les sources | Itérer rapidement sur le code, debug, exécution de Postgres + Portainer.   |
| **CI**              | Runner `ubuntu-latest` GitHub Actions | `ci.yml`, `build.yml` | N/A (Node natif + Buildx)  | Vérifier les tests (PR) et produire les artefacts Docker (push `main`).        |
| **Registry**        | `ghcr.io/<owner>/my-favorite-places-*` | Workflow `build.yml` | —                          | Stocker et distribuer les images applicatives utilisées en aval.               |
| **Prod (cible)**    | Hôte Docker quelconque               | `compose.prod.yml`   | Pull depuis GHCR (`:latest`) | Faire tourner l'application avec les artefacts officiels, sans Portainer. |

Caractéristiques notables :

- **Dev** embarque Portainer ; **prod** ne l'embarque pas.
- **Dev** build les images à la volée ; **prod** consomme uniquement des images publiées.
- Les credentials Postgres sont **les mêmes** dans les deux compose à ce stade — à durcir avant tout vrai déploiement (voir section suivante).
- `synchronize: true` est activé dans `datasource.ts` : TypeORM met à jour le schéma automatiquement, ce qui est pratique en dev mais **dangereux en prod**.

---

## 5. Comment le ou la dev intervient dans le processus

### Cycle de travail recommandé

1. **Brancher** : créer une branche depuis `main` (`feat/...`, `fix/...`).
2. **Coder** en local avec `docker compose up --build` (ou en hot-reload, cf. section 1).
3. **Tester** localement : `npm test` dans `./server` avant de pousser, pour éviter les allers-retours avec la CI.
4. **Ouvrir une PR vers `main`** : le workflow `ci.yml` se déclenche automatiquement. Attendre le check vert.
5. **Faire relire** la PR, puis **merger**. Le merge déclenche `build.yml`, qui republie les images `:latest` sur GHCR.
6. Pour propager la nouvelle version sur un hôte prod : `docker compose -f compose.prod.yml pull && docker compose -f compose.prod.yml up -d`.

### Points d'attention

- **Tests obligatoires** : `ci.yml` ne couvre que `./server`. Toute évolution du serveur doit s'accompagner de tests Jest pour préserver la couverture. Le client n'est pas testé en CI à ce jour — à ajouter si nécessaire.
- **Pas de versionning d'image** : un push sur `main` écrase `latest`. Si vous devez assurer un rollback, taguez d'abord l'image (par commit SHA ou tag git) avant de la promouvoir.
- **Variables sensibles** : `compose.yaml` et `compose.prod.yml` embarquent un mot de passe Postgres en clair (`supersecret`). En prod réelle, passer par un `.env` non commité ou un secret manager.
- **`synchronize: true`** : modifier une entité TypeORM impacte directement le schéma. À désactiver et remplacer par des migrations avant une mise en prod sérieuse.
- **Tag `latest` côté `compose.prod.yml`** : penser à `docker compose pull` avant `up -d`, sinon Docker garde l'image locale en cache et n'applique pas le nouveau build.
- **Permissions du registry** : le workflow utilise `GITHUB_TOKEN` avec `packages: write`. Si le repo est forké ou renommé, vérifier que la visibilité du package GHCR autorise toujours le `pull` côté `compose.prod.yml`.
- **Déclenchement manuel** : `build.yml` accepte `workflow_dispatch` — utile pour republier sans nouveau commit (par exemple après une rotation d'un secret).
- **Statut requis** : pour vraiment protéger `main`, configurer `ci.yml` comme **required status check** dans les règles de branche GitHub.

### Que faire quand un workflow casse ?

- **CI rouge sur la PR** : ouvrir l'onglet Actions → job `test` → reproduire en local avec `cd server && npm ci && npm test`.
- **Build/push rouge après merge** : la PR est déjà mergée, donc `main` n'a pas l'artefact à jour. Corriger sur une nouvelle PR ; en attendant, la prod reste sur l'image précédente (puisque `latest` n'est pas remplacée tant que le push n'a pas réussi).
- **Pull qui ne récupère rien de neuf en prod** : forcer `docker compose -f compose.prod.yml pull` puis `up -d --force-recreate`.
