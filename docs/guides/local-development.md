# AI ID — guide du pilote local

Infrastructure d’identité, de délégation et de confiance contextuelle. **Premier lot local exécutable**, issu des ADR-001 à ADR-008 acceptées. Il ne constitue pas encore le MVP d’assurance complet prévu par l’architecture.

> Données fictives uniquement. Aucun déploiement public. Le démarrage avec `NODE_ENV=production` est refusé. Les clés de développement sont sur disque ; l’isolation IAM/Typed Signer prévue par ADR-005 reste à construire.

## Démarrer

Prérequis : Node.js 24 et npm. Depuis la racine du projet :

```sh
npm ci
npm run dev
```

Les dépendances sont déjà installées dans cet espace de travail. Si `npm` n’est pas dans le PATH, le lancement direct fonctionne :

```sh
node --import tsx scripts/dev.ts
```

Ouvrir **http://localhost:4100** — utiliser `localhost`, pas l’IP. Le premier démarrage initialise les bases et les clés et peut prendre quelques secondes. Attendre les trois services :

| Service | Adresse | Rôle |
|---|---|---|
| Core + console | `http://localhost:4100` | BFF, API publique, permissions, délégations, preuves, événements |
| Hosted Auth | `http://localhost:4101` | OIDC, interactions, passkeys, fédération |
| Witness | `http://localhost:4102` | Chaînage indépendant et checkpoints signés |

Les serveurs écoutent uniquement sur `127.0.0.1`. `Ctrl+C` arrête les services. Ne pas lancer deux instances sur le même répertoire de données. La distribution est locale ; des ports différents sur `localhost` ne sont **pas** une isolation de cookies ou de privilèges système.

Les comptes, secrets et bases PGlite sont persistés dans `.local/`, ignoré par Git. Ne pas partager ce répertoire. Conserver ses clés avec ses bases pour retrouver les sessions/identifiants ; ne pas les régénérer à chaque lancement. Sous Windows, `mode: 0600` ne remplace pas une politique ACL.

## Parcours de démonstration

1. Cliquer sur **Créer un domaine** ou **Se connecter**, puis créer un nouveau domaine dans Hosted Auth. Chaque inscription crée un domaine distinct ; l’email ne fusionne jamais des comptes.
2. Autoriser la console. Conserver l’identifiant du domaine affiché dans les données de session pour la connexion par mot de passe. L’inscription n’effectue pas de vérification email.
3. Dans les dix minutes suivant une authentification par mot de passe, **Enregistrer une passkey**. Le navigateur et l’authentificateur doivent prendre en charge une credential découvrable et la vérification utilisateur.
4. Dans **Identités**, créer une entité `Agent IA`, puis son principal `workload-custodial`.
5. Dans **Accès & délégations**, accorder séparément `tool:demo / execute` au principal humain **et** au principal agent. L’administrateur ne possède pas ce droit implicitement.
6. Créer une délégation vers l’agent (30–900 s), puis une clé API de cet agent (60–3 600 s). La clé ne confère jamais les droits administrateur.
7. Exécuter l’exemple ci-dessous. L’outil transforme une chaîne en majuscules, sans action externe ni persistance métier. Une observation `resource-observed` est enregistrée.
8. Révoquer la délégation : l’appel distinct suivant est refusé. Retirer une permission ou désactiver l’entité produit également un refus.
9. Consulter **Preuves & réputation**, puis **Événements & audit**. Une évaluation avec moins de cinq observations reste `unknown`. Les déclarations manuelles ne comptent pas comme observations indépendantes.

Exemple PowerShell, dans un autre terminal :

```powershell
$env:AIID_API_KEY = 'aiid_CLE_OBTENUE_DANS_LA_CONSOLE'
$env:AIID_DELEGATION_ID = 'UUID_DE_LA_DELEGATION'
node --import tsx scripts/demo-agent.ts
Remove-Item Env:AIID_API_KEY
Remove-Item Env:AIID_DELEGATION_ID
```

Utiliser uniquement des secrets de test. Ne pas coller de clé dans le code, un ticket ou un dépôt.

## API et SDK

Le contrat est servi sur `/openapi.json`. Les schémas de requêtes sont générés depuis les validateurs Zod réellement utilisés par les routes. Les schémas de sortie restent partiels ; la génération complète du SDK et une suite de contrats exhaustive sont des travaux suivants.

Le SDK TypeScript est dans `src/sdk/index.ts`, **pas encore publié sur npm**. Exécution des exemples TS via `tsx` :

```ts
import { createAIIDClient } from './src/sdk/index.js';

const aiid = createAIIDClient({
  baseUrl: 'http://localhost:4100',
  token: process.env.AIID_API_KEY!,
});
const me = await aiid.getMe();
const result = await aiid.executeTool({
  delegation_id: process.env.AIID_DELEGATION_ID!,
  input: 'Hello',
}, { idempotencyKey: crypto.randomUUID() });
```

Une clé workload permet son identité, ses propres décisions/assessments et les appels délégués. Les créations administratives exigent une **session navigateur**. Le SDK prend également en charge `csrfToken` à la place de `token`, avec les cookies `same-origin` ; `/api/me` fournit ce jeton CSRF. Ne pas exposer une clé serveur au navigateur.

- Écritures métier : `Idempotency-Key` de 8 à 128 caractères. Même clé + même requête = même réponse ; contenu différent = `409`. Fenêtre de reprise 24 h, réponse chiffrée côté serveur. Une reprise réussie ne réexécute pas l’outil.
- Cookies : HttpOnly, SameSite=Lax. Écritures de session : Origin exact + `X-CSRF-Token`. OAuth access/refresh tokens restent dans le BFF, chiffrés au repos.
- Sessions : 8 h maximum, 30 min d’inactivité. Introspection en ligne et rotation de refresh. `/v1/sessions` liste des identifiants opaques ; `DELETE /v1/sessions/{id}` révoque la session Core, pas le SSO de l’IdP. `/auth/logout` révoque la session courante et renvoie l’URL de confirmation de déconnexion SSO.
- Collections : `{data,next_cursor}` ; transmettre `cursor` tel que renvoyé, `limit` au plus 100. Les UUID de collection ne sont pas un ordre chronologique. Audit/événements utilisent une séquence monotone.
- Erreurs métier : `application/problem+json`, `request_id`. L’endpoint `/v1/authorize` utilise actuellement `{error,message}` pour les erreurs, et `{decision,context}` pour une décision. Ce profil local n’est pas une certification AuthZEN.
- Pas de CORS générique, d’enregistrement dynamique de clients OIDC, de grant password, ni de tokens administrateur distribués aux agents.

## Fédération OIDC entrante

Configurer explicitement les fournisseurs autorisés **avant** le démarrage. Aucun issuer n’est accepté depuis une saisie utilisateur libre :

```powershell
$env:AIID_FEDERATED_OIDC_PROVIDERS = '[{"id":"company","label":"Company SSO","issuer":"https://id.example.com","clientId":"CLIENT_ID","clientSecret":"DEV_SECRET","scopes":"openid profile email"}]'
node --import tsx scripts/dev.ts
```

Enregistrer chez le fournisseur la callback exacte : `http://localhost:4101/federation/company/callback`. HTTPS est requis pour l’issuer, sauf `http://localhost` en test. Le fournisseur doit accepter Authorization Code + PKCE S256 et l’authentification client `client_secret_basic`.

La résolution repose sur le tuple exact `(issuer, sub)` ; première visite = nouveau domaine. Aucun rapprochement par email ni rattachement automatique à un domaine existant. Les comptes d’un domaine ne sont pas encore gérables en équipe. Les métadonnées `name`/`email` du broker proviennent de l’ID token ; un fournisseur ne les incluant pas utilisera un libellé de repli. La fédération vers un IdP externe de votre organisation n’a pas été configurée : le test E2E utilise un second vrai moteur OIDC local.

## Vérifier

```sh
npm run typecheck
npm test
```

`npm test` inclut les tests navigateur avec **Chrome installé**, lancé sans interface. `AIID_BROWSER_CHANNEL=msedge` permet d’utiliser Edge. La suite réserve les ports locaux 4410–4413 et ne dépend d’aucun compte externe. Les fichiers de test restent sous `.local/tests/<uuid>` ; les données sont synthétiques, la capture `console.png` est conservée pour inspection. La fixture IdP amont utilise un adaptateur mémoire **uniquement dans les tests** ; Auth AI ID utilise son adaptateur persistant.

Dernier passage documenté : **30 tests réussis, TypeScript sans erreur**. Voir le [rapport local](../implementation/verification-2026-09-26.md). Ce n’est pas une certification ni un rapport CI.

Les tests rapides et E2E utilisent PGlite. Ils ne démontrent **pas** la sûreté concurrente multi-processus de PostgreSQL natif. `DATABASE_URL` active l’adaptateur `pg` pour expérimentation locale, pas pour déclarer la production prête.

## Modules et suite

### Reproduction avant publication

Le [contrôle de préparation du dépôt](../implementation/publication-verification-2026-09-26.md) documente une installation neuve distincte. La CI utilise Chromium installé avec `npx --no-install playwright install --with-deps chromium`, puis `AIID_BROWSER_CHANNEL=chromium`. Les résultats locaux ne préjugent pas de ceux de GitHub Actions.

`src/core` : API/BFF, modèle, autorisation, délégation, preuves, audit/outbox. `src/auth` : protocoles et authenticators. `src/witness` : stockage et signature des checkpoints. `src/sdk` : client public. `src/shared` : ports DB, configuration et primitives. `public` : console utilisant les mêmes APIs. `scripts` : lancement et agent de test.

Lire le [plan M0–M5](../architecture/phase-2-contrats-et-plan.md) et le [bilan du lot 01](../implementation/lot-01.md) avant toute extension. Les priorités sont :

1. Spike Typed Signer/KMS et identités workload réellement distinctes, puis tests PostgreSQL natifs de concurrence/rollback/revocation.
2. Profil Delegation Grant, Token Exchange et preuve de possession ; remplacer les clés bearer du simulateur d’agent.
3. Controllers qualifiés, équipes/invitations, récupération et révocation des authenticators, migrations versionnées.
4. Contrats de sortie complets, SDK généré, droits et audit des tentatives refusées, export/portabilité, métriques et exploitation.
5. Suite officielle applicable, audit indépendant, sauvegarde/restauration, déploiement isolé et pilote encadré.

**Non livrés :** multi-cellules, signing distant, preuve de possession, credentials VC/DID, WORM, clés hardware, conformité/certification, observabilité opérée, webhooks, récupération de compte et service de vérification documentaire. Une réputation informative ne garantit ni l’identité juridique, ni l’honnêteté, ni l’absence de risque d’un agent.
