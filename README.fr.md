# AI ID · All Intelligences ID

## Une identité pour chaque intelligence. Des permissions pour chaque action.

[English](README.md) · [La vision](VISION.md) · [Essayer en local](docs/guides/local-development.md) · [Participer](CONTRIBUTING.md)

**All, pas seulement Artificial.** Un Internet partagé par plusieurs formes d'intelligence a besoin de les reconnaître sans leur faire aveuglément confiance. [L'origine de l'idée](docs/community/origin.md#français--être-reconnu-sans-tout-révéler).

Un assistant ne devrait pas repartir de zéro chaque fois qu'il change de plateforme. Et vous ne devriez pas lui donner les clés de toute votre vie numérique pour qu'il puisse vous aider.

AI ID explore une idée simple : **humains, agents, organisations et objets connectés ont besoin d'identités durables, de relations compréhensibles et de permissions révocables.**

Nous construisons cette infrastructure en open source. Ce n'est ni un gestionnaire de mots de passe, ni un score universel des personnes. C'est une expérimentation autour de l'identité et de la confiance contextuelle, fondée sur les standards existants.

> **Version expérimentale pour développeurs — usage local uniquement.** Utilisez des identités inventées et des données de test. Ce dépôt n'est pas une bêta hébergée, un fournisseur d'identité de production ou une certification de sécurité. N'exposez pas les services locaux sur Internet, même avec un tunnel.

## Une histoire avant la technique

Imaginez un assistant qui prépare vos vacances. Vous voudriez le reconnaître demain, même en changeant d'application. Vous pourriez l'autoriser à comparer des vols, sans l'autoriser à acheter. Puis lui confier une permission précise, limitée dans le temps, et la retirer.

- **Qui interagit avec moi ?** Une identité n'est ni un modèle, ni un compte de connexion, ni une clé API.
- **Pour qui agit-il, et dans quelles limites ?** Avoir une identité ne donne pas automatiquement des droits.
- **Qu'est-il réellement arrivé ?** Une preuve doit avoir une source, un contexte et une durée de validité.

Ce voyage illustre la vision : **aucune intégration de voyage ou de paiement n'est livrée**. La démonstration actuelle transforme simplement du texte en majuscules.

## Ce qui fonctionne aujourd'hui

Le prototype local permet de créer un domaine de test, de se connecter, d'enregistrer un agent, de lui déléguer temporairement une action, puis de révoquer cette délégation. L'appel suivant est refusé. Les événements et les observations peuvent ensuite être consultés.

Sont présents : identités locales au domaine, authentification OIDC, sessions, passkeys, fédération entrante avec fournisseurs autorisés, permissions, API HTTP, SDK TypeScript local, console développeur, première évaluation contextuelle privée et journal d'audit avec témoin local séparé.

**Ne sont pas encore livrés :** portabilité entre plateformes, récupération de compte, SDK publié sur npm, credentials VC/DID, preuve de possession des clés d'agent, signature isolée en production, témoins indépendants, audit externe et service public d'inscription. Le témoin local partage la frontière de sécurité de la machine. La réputation n'accorde jamais de permission.

### Essayer

Avec **Node.js 24 et npm**, depuis une copie du dépôt :

```sh
npm ci
npm run dev
```

Ouvrez **http://localhost:4100** après le démarrage des trois services. Aucune clé d'API payante et aucun modèle d'IA externe ne sont nécessaires. Le [guide pas à pas](docs/guides/local-development.md) détaille le scénario, le SDK et les tests.

Le [rapport local](docs/implementation/verification-2026-09-26.md) documente 30 tests réussis ; ce n'est ni une certification, ni une preuve du résultat de la CI actuelle.

## Une ambition large, une première étape limitée

**All Intelligences ID** : les agents sont notre premier démonstrateur, pas la limite du projet. La vision inclut les humains, organisations, services, robots et objets connectés.

Universel ne veut pas dire un identifiant obligatoire pour tout le monde. Persistant ne veut pas dire traçable partout. Open source ne veut pas dire données personnelles publiques. Une connexion réussie ne prouve ni l'identité civile, ni l'honnêteté.

Nous séparons identité, authentification, autorisation et réputation. Le service qui reçoit une action reste maître de sa décision. Nous publions les choix, les tests et les limites, sans inventer de certification, de partenariat ou de communauté déjà acquise.

Pour approfondir : [vision](VISION.md), [périmètre](SCOPE.md), [feuille de route](ROADMAP.md), [décisions d'architecture](docs/architecture/decisions-acceptees.md) et [écarts connus](docs/implementation/lot-01.md).

## Participez, même sans coder

Racontez une situation concrète. Signalez une explication incompréhensible. Questionnez nos choix de confidentialité. Traduisez un document. Testez le prototype avec des données fictives.

[Commencer ici](docs/community/start-here.md) ou [proposer un scénario](../../issues/new?template=scenario.yml). Vos contributions sur GitHub sont publiques et liées à votre compte ; elles ne sont pas anonymes. Ne publiez ni document d'identité, ni secret, ni données d'incident réel.

Il n'y a **pas de service hébergé d'inscription ni de réservation d'identité** dans cette version. Suivre le dépôt ne vous inscrit pas à une bêta. Les futurs pilotes encadrés auront un périmètre et des conditions explicites avant toute collecte de données personnelles. Participer tôt ne promet ni jetons, ni parts, ni récompense financière, ni identifiant réservé, ni meilleur score de confiance.

Une étoile peut aider à faire découvrir le projet. Une question, un test reproductible ou une contribution nous aide à le construire. Rien de cela ne conditionnera un accès futur.

## Un projet ouvert et responsable

Le code et la documentation originaux sont sous [Apache-2.0](LICENSE), sauf mention contraire. Les dépendances conservent leurs licences. Le compte mainteneur initial est [shukra-ai](https://github.com/shukra-ai). Nous sommes un projet expérimental, pas un organisme de standardisation établi.

[Gouvernance](GOVERNANCE.md) · [Contribuer](CONTRIBUTING.md) · [Code de conduite](CODE_OF_CONDUCT.md) · [Sécurité](SECURITY.md)

Le développement de cet aperçu a bénéficié d'une assistance IA sous direction humaine. Il n'est pas maintenu par une équipe autonome vérifiée. Nous proposons une [expérience d'ambassadeur supervisé](docs/community/ambassadors.md), sans la présenter comme déjà active.

**Construisons un Internet où reconnaître une intelligence ne signifie pas lui faire aveuglément confiance.**
