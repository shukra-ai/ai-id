# Vérification du paquet destiné à publication

Date : 26 septembre 2026. Ce relevé décrit des observations locales, pas une certification.

Une copie neuve des fichiers autorisés a été créée sous un répertoire de préparation ignoré. Aucun répertoire `.local`, secret, base de données, dépendance installée, historique Git ou export de conversation n'a été copié dans ce paquet.

## Résultats observés

- Installation depuis `package-lock.json` avec `npm ci` : réussie, 226 packages installés, 227 audités ; l'audit npm a rapporté zéro vulnérabilité connue à cet instant.
- Environnement de cette reproduction : Windows, Node.js **24.18.0**, npm **11.16.0**, Chrome installé.
- `npm run typecheck` : réussi.
- `npm test` : **30 tests réussis, 0 échec, 0 ignoré** ; environ 64 secondes.
- Vérification déterministe des liens de fichiers Markdown et des motifs de secrets sélectionnés : réussie.
- Inventaire des métadonnées de licence du lockfile : Apache-2.0, MIT, BSD-3-Clause, ISC, BlueOak-1.0.0 et 0BSD ; aucune entrée sans métadonnée de licence. Cela ne remplace pas la revue des notices avant distribution de binaires ou dépendances embarquées.

L'installation signale le script `postinstall` d'esbuild comme non encore couvert par la politique `allowScripts` de npm. Les vérifications ont néanmoins réussi ; aucune autorisation globale de scripts n'a été ajoutée.

## Limites

La CI Linux/Chromium nouvellement préparée doit être évaluée sur son exécution réelle dans GitHub. Ce rapport ne lui attribue pas un résultat par anticipation. Les tests utilisent PGlite, pas PostgreSQL natif en concurrence multi-processus. L'avertissement d'adaptateur OIDC en mémoire concerne le fournisseur amont de test ; l'authentification AI ID utilise son adaptateur persistant.

La recherche de motifs et la revue du manifeste réduisent les risques de fuite ; elles ne prouvent ni l'absence absolue de secrets, ni la sécurité de l'application. Les versions et résultats d'audit sont datés, pas des garanties futures.
