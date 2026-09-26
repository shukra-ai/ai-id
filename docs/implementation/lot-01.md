# Lot 01 — intégration locale et limites

Date : 26 septembre 2026. Ce bilan décrit le code, pas une acceptation de nouveaux ADR. Le registre `docs/architecture/decisions-acceptees.md` reste la référence de validation.

## Résultat

Premier chemin vertical exécutable : création d’un domaine, OIDC Authorization Code + PKCE, session BFF, inscription/login passkey, identité d’agent, principal, permissions explicites, délégation bornée, clé de développement, exécution sans effet externe, preuve, assessment, événements et audit témoin. La console et le SDK utilisent ces APIs ; aucun jeu de données ne simule une réussite côté UI.

Le code est réparti en trois services et des modules internes. Le choix Fastify/Express est volontaire : Express accueille les interactions du moteur OIDC, Fastify sert les APIs Core et Witness. Réécrire OAuth ou WebAuthn aurait ajouté une surface critique sans avantage produit.

## Ce que les tests démontrent

Le [rapport de vérification du 26 septembre 2026](verification-2026-09-26.md) consigne les commandes, l’environnement et le dernier résultat : 30 tests réussis, TypeScript sans erreur.

- Isolation des lectures/écritures Core entre deux domaines ; impossibilité de réaffecter un Principal à une autre Entity par SQL.
- Écritures idempotentes, conflit de payload et atomicité mutation/audit/outbox en cas d’exception avant commit.
- Autorisation par défaut négative ; délégation seulement si grantor **et** delegate ont les droits ; absence de sous-délégation ; révocation observée sur le prochain appel distinct.
- Clés réservées aux workloads, sans privilèges admin ; révocation effectivement contrôlée par l’authentification et recontrôlée sous le verrou de mutation.
- Email non vérifié signalé comme tel ; même email ne fusionnant ni comptes locaux, ni identités fédérées ; sujet pairwise stable par secteur.
- Code/objet OIDC à consommation unique dans l’adaptateur, révocation par grant, refresh en concurrence locale, CSRF et Host refusés quand invalides.
- Parcours navigateur OIDC, consentement, session, formulaire dashboard, passkey avec vérification utilisateur, non-rejeu de l’enrollment, logout et reconnexion passkey.
- Fédération E2E avec un second moteur `oidc-provider`, vrai code, PKCE, nonce et échange serveur à serveur.
- SDK avec vraie clé API ; idempotence transport, erreurs structurées, absence de credentials dans l’URL, refus de redirections et HTTP public.
- Altération d’une entrée détectée ; checkpoint cohérent ; troncature d’une fin déjà témoin détectée. Les checkpoints sont signés Ed25519 après vérification de continuité, sans API générique de signature.

Les tests utilisent des données synthétiques et PGlite, plus Chrome et un authentificateur virtuel. Ils ne démontrent ni la conformité protocolaire complète ni l’isolation de production. Les avertissements du moteur OIDC mémoire concernent exclusivement la fixture IdP de test.

## Écarts explicites avec le MVP cible

| Sujet | Lot actuel | Condition de clôture |
|---|---|---|
| ADR-005, Typed Signer/IAM | Clé RSA de développement dans Auth ; processus séparés mais même compte OS et mêmes secrets locaux | Service de signature typé distant, clés non extractibles, identités/credentials/IAM distincts, tests négatifs de compromission |
| ADR-006, Delegation Grant | Simulateur local : clé bearer courte + ID de délégation + vérification en ligne | Token Exchange profilé, audiences, PoP, replay cache et suite négative du profil |
| PostgreSQL opéré | Adaptateur `pg` présent ; tests réalisés sur PGlite | Tests multi-connexions PostgreSQL, pool, deadlocks, crash, restauration et rôles DB restreints |
| Modèle d’identité | Humain, agent, service, organisation ; principal immuable ; un propriétaire par domaine | Controllers qualifiés, membres invités et règles de garde/récupération complètes |
| Signature/audit | Hash chain et checkpoints signés locaux ; clé publique lue auprès du même témoin | Témoin indépendant, ancrage de clé vérifié hors bande, WORM et rotation/rétention opérées |
| Contrats | Requêtes OpenAPI issues de Zod ; types SDK explicites | Schémas exhaustifs de sortie, tests consumer-driven, génération et publication versionnée |
| Historique | Mutations métier et création/révocation de sessions auditées | Échecs et événements Auth complets, gestion de rétention et export de preuves |
| Conformité | Tests d’intégration ciblés | Suites applicables et audit indépendant de cette configuration exacte |

Le découpage de ce lot est un outil de validation fonctionnelle ; **il ne remplace pas les invariants acceptés**. Le plan décrivant une API de notes avec rollback reste une cible future. Le lot utilise une transformation de texte sans état métier, moins riche mais suffisante pour tester le trajet de délégation sans effets externes. La transformation en majuscules n’est pas qualifiée de réversible : elle ne modifie aucune ressource utilisateur.

## Limites de sécurité et d’exploitation

Le lancement de production est bloqué dans la configuration et les factories de services. Le mode local ne possède pas de frontière contre une compromission du compte OS : un attaquant ayant accès à `.local` pourrait lire les clés, données et secrets. Les ports localhost ne constituent pas des domaines de sécurité distincts. Aucune identité réelle ne doit y être importée.

Le chaînage permet de détecter une modification mais ne rend pas SQL append-only. Le témoin peut détecter une divergence déjà ancrée seulement s’il reste digne de confiance. Un statut `pending`/`unavailable` n’est pas une preuve d’intégrité distante. Les nouvelles écritures continuent avec une outbox persistante lorsque le témoin est indisponible ; le modèle d’indisponibilité en production reste à définir/tester.

La réputation est privée au domaine, informative, versionnée et contestable. Les attestations saisies par l’admin sont `tenant-asserted`, exclues de l’échantillon observé. Une exécution réussie de l’outil local ne prouve ni bonne intention ni indépendance des participants. Le label `resource-observed` décrit le chemin d’ingestion interne, pas une vérification par un tiers indépendant. Aucun score n’augmente automatiquement des droits.

Les API keys sont hachées ; leurs réponses de création idempotentes sont chiffrées pendant la fenêtre de reprise. Les sorties de l’outil restent dans la réponse idempotente chiffrée, même si les entrées/sorties sont absentes des preuves et de l’audit. Un nettoyage périodique supprime les réponses expirées et sessions expirées ; il ne remplace pas une politique de suppression des fichiers/WAL/sauvegardes.

Le broker accepte seulement une liste d’issuers configurée par l’opérateur. Les redirects/endpoints issus de leurs métadonnées demandent encore une politique egress/SSRF et des tests hostiles avant une configuration multi-tenant réelle.

## Prochain incrément recommandé

Faire d’abord un spike de signature distante et une suite PostgreSQL multi-connexions. Critère de décision : Auth et Core ne peuvent ni extraire la clé ni demander une signature libre ; une intention complète, un client, une audience et une autorisation vérifiables sont nécessaires. Si l’intégration du moteur OIDC ne permet pas ce contrat sans fork fragile, proposer l’alternative et documenter l’ADR avant de poursuivre. Ne pas élargir la réputation ou le nombre d’entités avant cette fermeture de la frontière de confiance.

Référence navigateur utile au correctif CSRF : [MDN — Origin](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Origin) documente les origines opaques de certains formulaires selon Referrer-Policy. Les pages Auth utilisent `same-origin` et un `form-action` limité à Auth et à la callback Core configurée ; elles ne relâchent pas le contrôle Origin.
