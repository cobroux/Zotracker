# Sécurité et confidentialité

Zotracker manipule des données sensibles : ta **position en temps réel**, ton profil et des alertes de sécurité. Ce document explique ce qui est stocké, qui y a accès, comment c'est protégé et quoi faire en cas de problème.

## Quelles données, visibles par qui ?

| Donnée | Stockage | Visible par |
| --- | --- | --- |
| Profil (nom, photo, présentation, infos) | `state.json` | Page publique |
| Courses, parcours GPX, ravitaillements | `state.json` | Page publique (course en ligne) |
| Positions GPS (trace, heure) | `state.json`, effacées 90 jours après la course | Page publique, **pendant la course seulement** |
| Messages et alertes de course | `state.json` | Page publique |
| Batterie, alertes de sécurité, SOS | `state.json` | **Admin et contacts ntfy uniquement** |
| Mot de passe admin | `secrets.json`, **haché** (scrypt) | Personne |
| Clé du traceur, clés de session et de notification | `secrets.json` | Serveur uniquement |
| Abonnements aux notifications | `state.json` | Serveur uniquement |

- Les positions ne sont enregistrées **que lorsque la course est démarrée**. Personne ne voit où tu es avant le départ ni après l'arrivée.
- En mode **🔑 lien privé** (admin → Compte & confidentialité), seuls les détenteurs du lien voient le suivi. Le site n'est de toute façon jamais indexé par les moteurs de recherche.
- Les données restent sur **ton** serveur. Seuls ces services tiers sont utilisés :
  - OpenStreetMap, pour les fonds de carte. Il ne reçoit que l'origine du site, ce qu'exige sa politique d'utilisation, jamais le chemin ni les clés (`Referrer-Policy: strict-origin-when-cross-origin`). Le fournisseur se change avec `TILE_URL` ;
  - les services de notification des navigateurs (Google, Apple, Mozilla), pour les alertes chiffrées de bout en bout (Web Push) ;
  - ntfy.sh, pour les alertes de sécurité. Tu peux héberger ton propre serveur ntfy.

## Protections en place

### Application
- **Authentification admin** :
  - mot de passe haché avec scrypt ;
  - session dans un cookie `HttpOnly` + `Secure` + `SameSite=Strict`, signée et valable 7 jours, inaccessible au JavaScript ;
  - bouton « Déconnecter tous les appareils ».
- **Anti force brute** : 10 tentatives par 15 minutes et par IP, avec un ralentissement progressif. L'IP du client ne peut pas être falsifiée, car seul le reverse proxy local est cru.
- **Anti-CSRF** : toute modification doit venir de l'origine du site, en plus de `SameSite=Strict`.
- **En-têtes de sécurité** :
  - CSP stricte (aucun script externe ni inline) ;
  - HSTS ;
  - `X-Frame-Options: DENY` (pas d'intégration dans une autre page, donc pas de clickjacking) ;
  - `nosniff` et `Permissions-Policy` ;
  - `noindex`.
- **Anti-XSS** : tout le contenu est inséré comme du texte (`textContent`), jamais comme du HTML.
- **Anti-SSRF** : les notifications ne partent que vers les services push connus des navigateurs.
- **Limites** :
  - taille des requêtes par route (64 ko par défaut, 15 Mo seulement pour l'import GPX admin) ;
  - débit sur l'API GPS, le SOS et les abonnements ;
  - nombre de connexions temps réel par IP.
- **Minimisation** : la page publique ne reçoit ni la batterie, ni les alertes de sécurité, ni les détails internes.
- **Erreurs** : réponses génériques, sans pile d'appels ni détail technique.
- **Journaux** : aucune URL complète n'est enregistrée, car elles peuvent contenir des clés.

### Conteneur et serveur
- Image minimale :
  - dépendances de production seulement, installées sans scripts tiers (`--ignore-scripts`) ;
  - npm retiré de l'image.
- Exécution :
  - utilisateur **non-root** (uid 1000) ;
  - système de fichiers en **lecture seule** ;
  - **toutes les capacités Linux retirées** et `no-new-privileges` ;
  - limites de mémoire et de processus.
- Données dans un volume dédié, avec des fichiers `600` (lisibles par l'application seule).
- L'application n'est pas exposée directement : seul **Caddy** l'est, et il gère le HTTPS automatique.
- Serveur :
  - pare-feu (22, 80, 443) et fail2ban ;
  - SSH par clé uniquement, root interdit ;
  - mises à jour de sécurité automatiques.
- Sauvegardes quotidiennes **chiffrées avec age** : le serveur ne détient pas la clé de déchiffrement, et la copie hors site n'accepte que des fichiers chiffrés.

### Chaîne de livraison (CI/CD)
- À chaque modification :
  - tests, y compris de sécurité ;
  - `npm audit` et vérification des signatures npm ;
  - recherche de secrets (gitleaks) ;
  - analyse **CodeQL** ;
  - scan de l'image (**Trivy**).
- Scan hebdomadaire, même sans modification, pour détecter les nouvelles failles, et **Dependabot** pour les mises à jour.
- Image publiée avec attestation de **provenance** et **SBOM**.
- Déploiement :
  - par une **clé SSH limitée** à `deploy.sh` ;
  - empreinte du serveur vérifiée ;
  - environnement GitHub `production` protégé ;
  - **retour arrière automatique** si la nouvelle version ne démarre pas.

## Limites connues
- **Les clés passent dans des URL** : la clé du traceur (exigée par les applis GPS), le lien SOS et le lien privé. Ne les partage qu'avec les bonnes personnes ; elles se régénèrent en un clic.
- **Le canal ntfy est un secret partagé** : quiconque le connaît reçoit tes alertes de sécurité. Change-le si tu as un doute.
- **Les données ne sont pas chiffrées sur le disque du serveur**, en dehors des sauvegardes. Si tu veux ce niveau de protection, choisis un hébergeur qui chiffre les disques.
- **Les limites de débit sont en mémoire** et repartent à zéro au redémarrage.
- **Un seul compte admin.**

## En cas de problème

**Téléphone perdu ou volé**
1. Admin → 🔒 *Régénérer la clé du traceur*. L'ancien lien SOS et l'ancienne config Traccar deviennent inutilisables.
2. *Déconnecter tous les appareils*, puis change ton mot de passe.

**Lien privé ou canal ntfy diffusé par erreur**
- Admin → *Créer un nouveau lien* : les anciens abonnés aux notifications sont aussi révoqués.
- Ou 🛟 Sécurité → *Changer de canal*.

**Doute sur le serveur**
1. Change le mot de passe admin et régénère toutes les clés.
2. Vérifie `docker compose logs app`, notamment les lignes « échec de connexion ».
3. En cas de compromission avérée : **reconstruis un serveur neuf**, restaure la dernière sauvegarde saine, puis régénère tous les secrets. Il faut alors supprimer `secrets.json` avant le démarrage ; tes abonnés aux notifications devront se réabonner.

## Signaler une faille

Merci de **ne pas ouvrir d'issue publique**. Utilise *Security → Report a vulnerability* sur le dépôt GitHub (signalement privé).
