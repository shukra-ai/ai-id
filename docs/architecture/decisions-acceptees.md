# Décisions acceptées

Le 26 septembre 2026, le porteur du projet a explicitement validé **ADR-001 à ADR-008**, telles que définies à la section 22 de l’étude de phase 1.

Le document de juillet est conservé comme étude historique. Sa demande de validation est satisfaite par ce registre ; aucune nouvelle approbation n’est nécessaire pour établir les contrats, le plan incrémental et commencer les tranches du MVP prévues.

La validation porte sur le modèle et les invariants : entités locales à un domaine de confiance ; liaison Principal → Entity immuable ; décisions détenues par l’autorité de ressource ; délégation sans sous-délégation dans le MVP ; réputation contextuelle ; processus de signature et d’audit séparés. Elle n’accorde aucune certification, qualification réglementaire ou autorisation de déploiement public.

Premier scénario : une organisation délègue l’exécution d’un outil réversible à un agent. Le contexte de preuve initial est `tool.execution.v1`. Le plan détaillé et les limites vérifiées sont consignés dans `phase-2-contrats-et-plan.md` et le README d’exécution.
