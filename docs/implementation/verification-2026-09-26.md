# Vérification locale — 26 septembre 2026

Résultat observé après les correctifs d’intégration et le dernier nettoyage périodique : **30 tests réussis, 0 échec, 0 ignoré**, comptage du runner Node incluant les tests parents. Durée du dernier passage : 30,871 s. TypeScript : code de sortie 0.

## Commandes exécutées

```sh
node node_modules/typescript/bin/tsc --noEmit
node --import tsx --test --test-concurrency=1 tests/*.test.ts
node --import tsx scripts/dev.ts
```

Environnement : Windows, Node v24.19.0, TypeScript 7.0.2, dépendances exactes dans `package-lock.json`, Chrome installé lancé par Playwright. Les tests utilisent PGlite 0.5.8, pas un serveur PostgreSQL natif.

| Suite | Résultat |
|---|---|
| `tests/auth.test.ts` | Comptes, passwords, adaptateur OIDC à usage unique, mapping fédéré, sujets pairwise |
| `tests/core.test.ts` | Isolation, immutabilité, idempotence, permissions, délégation, révocation, réputation, rollback et audit |
| `tests/browser.test.ts` | Vrais parcours navigateur OIDC/passkeys, SDK, fédération OIDC locale, session management et témoin |
| `tests/sdk.test.ts` | Transport SDK, CSRF, erreurs, schémas de requête OpenAPI, chiffrement et blocage de production |

Après démarrage des services, les sondes suivantes ont toutes retourné **HTTP 200** :

- `http://localhost:4100/healthz` → `core`
- `http://localhost:4101/healthz` → `auth`
- `http://localhost:4102/healthz` → `witness`
- `http://localhost:4100/openapi.json` → `openapi: 3.1.0`

Dernier dossier d’artefacts navigateur : `.local/tests/e583630b-6fc6-4beb-a661-2cbebb31057e/`. La capture `console.png` contient uniquement les comptes synthétiques de la suite. Une capture précédente du même parcours a été inspectée visuellement. Les refus 401/403 des tests négatifs et les requêtes de favicon 404 ne sont pas des échecs fonctionnels.

Le warning `in-memory adapter` provient du faux IdP amont de la fixture E2E, pas d’Auth AI ID. Les warnings Web Crypto expérimentaux proviennent du probing de capacités de SimpleWebAuthn ; les clés passkey testées utilisent les algorithmes configurés ES256/RS256, pas ML-DSA.

## Portée et réserves

Ce rapport est local, rédigé à partir des sorties réellement observées. Il ne constitue pas un artefact CI, un commit signé ou une certification. Le dossier courant n’est pas reconnu comme dépôt Git valide ; aucun commit ni push n’a été réalisé. Les critères de preuve CI/versionnement de la cible M5 ne sont donc pas satisfaits.

Le succès d’un test sous PGlite ne valide pas les races multi-processus, les rôles DB, l’isolation IAM ou une restauration PostgreSQL. Aucun compte externe réel, authentificateur physique, fournisseur de vérification documentaire, KMS ou stockage WORM n’a été utilisé. Voir `lot-01.md` pour les écarts restant à fermer avant de qualifier le MVP cible.
