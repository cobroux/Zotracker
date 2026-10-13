# Mise en ligne de Zotracker

Ce guide met Zotracker en ligne sur un petit serveur (VPS), en HTTPS. Une fois en place, chaque modification poussée sur `main` est déployée automatiquement, à condition que tous les contrôles de sécurité passent.

```
 GitHub (push sur main)
   │  CI : tests · audit npm · recherche de secrets · CodeQL · scan Trivy de l'image
   ▼
 GitHub Container Registry (image avec attestation de provenance + SBOM)
   │  SSH (clé dédiée, limitée à deploy.sh)
   ▼
 Serveur : pare-feu ─▶ Caddy (HTTPS auto) ─▶ Zotracker (conteneur durci) ─▶ volume de données
                                                        └─▶ sauvegarde chiffrée quotidienne
```

**Budget** : environ 4 à 6 €/mois pour un VPS de 1 vCPU / 1 Go de RAM (Hetzner, OVH, Scaleway…), plus un nom de domaine (environ 10 €/an). C'est largement suffisant pour des milliers de supporters.

---

## 1. Le serveur

1. Commande un VPS sous **Ubuntu 24.04**. À la création, ajoute ta **clé SSH**. Si tu n'en as pas encore, crée-la sur ton ordinateur avec `ssh-keygen -t ed25519`.
2. Chez ton registrar, crée un enregistrement DNS **A** (et **AAAA** si tu as une IPv6), par exemple `suivi.mondomaine.fr`, qui pointe vers l'IP du serveur.
3. Connecte-toi au serveur, puis lance le script de durcissement **après l'avoir relu** :

   ```bash
   ssh root@IP_DU_SERVEUR
   curl -fsSLO https://raw.githubusercontent.com/cobroux/zotracker/main/deploy/server-setup.sh
   less server-setup.sh
   bash server-setup.sh
   ```

   Ce script :
   - installe les mises à jour système et active les mises à jour de sécurité automatiques ;
   - configure le pare-feu pour n'ouvrir que les ports 22, 80 et 443 ;
   - installe fail2ban ;
   - limite SSH aux connexions par clé, avec l'utilisateur `deploy` uniquement (root interdit) ;
   - installe Docker ;
   - planifie une sauvegarde quotidienne.

4. À partir de maintenant, connecte-toi avec `ssh deploy@IP_DU_SERVEUR` : root ne peut plus se connecter.

## 2. Installer l'application

Depuis ton ordinateur, dans le dossier du projet :

```bash
scp deploy/{docker-compose.yml,Caddyfile,.env.example,deploy.sh,backup.sh,restore.sh} deploy@IP_DU_SERVEUR:/opt/zotracker/
```

Sur le serveur :

```bash
cd /opt/zotracker
cp .env.example .env && chmod 600 .env
nano .env        # DOMAIN, ACME_EMAIL, VAPID_SUBJECT… (voir les commentaires)
```

### Chiffrement des sauvegardes (fortement recommandé)

Sur **ton ordinateur**, pas sur le serveur :

```bash
age-keygen -o zotracker-backup.key     # garde ce fichier précieusement (gestionnaire de mots de passe, clé USB…)
age-keygen -y zotracker-backup.key     # affiche la clé publique « age1… »
```

Mets ensuite la clé publique dans `BACKUP_AGE_RECIPIENT` du `.env` du serveur. Le serveur pourra chiffrer les sauvegardes, mais **jamais les déchiffrer** : même un attaquant qui prendrait le contrôle du serveur ne pourrait pas lire les anciennes sauvegardes.

### Accès à l'image Docker

L'image est publiée sur GitHub Container Registry, en privé par défaut. Pour que le serveur puisse la télécharger, crée un jeton GitHub : *Settings → Developer settings → Fine-grained tokens*, avec uniquement la permission **read:packages**. Ensuite, sur le serveur :

```bash
docker login ghcr.io -u TON_PSEUDO_GITHUB     # colle le jeton comme mot de passe
```

## 3. Déploiement automatique depuis GitHub

### Clé SSH dédiée à la CI (limitée au déploiement)

Sur ton ordinateur :

```bash
ssh-keygen -t ed25519 -N "" -C github-deploy -f zotracker-deploy
```

Sur le serveur, ajoute la clé publique en la **limitant** à la commande de déploiement :

```bash
echo "command=\"/opt/zotracker/deploy.sh\",restrict $(cat zotracker-deploy.pub)" >> ~/.ssh/authorized_keys
```

Même si cette clé fuitait, elle ne permettrait que de déployer une image publiée par ton dépôt. Elle ne donne ni shell, ni accès aux fichiers, ni redirection de port.

### Secrets et variables GitHub

Dans le dépôt GitHub, va dans *Settings → Environments* et crée l'environnement **production**. Tu peux exiger ton approbation avant chaque déploiement avec *Required reviewers*. Ajoute-y ces secrets :

| Secret | Valeur |
| --- | --- |
| `DEPLOY_HOST` | IP ou nom du serveur |
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_SSH_KEY` | contenu de `zotracker-deploy` (clé **privée**) |
| `DEPLOY_KNOWN_HOSTS` | résultat de `ssh-keyscan -t ed25519 IP_DU_SERVEUR`, à vérifier contre l'empreinte affichée par ton hébergeur |

Puis dans *Settings → Secrets and variables → Actions → Variables* :

| Variable | Valeur |
| --- | --- |
| `DOMAIN` | `suivi.mondomaine.fr` |
| `DEPLOY_ENABLED` | `true`, une fois le serveur prêt |

Supprime ensuite la clé privée `zotracker-deploy` de ton ordinateur : elle ne sert plus qu'à GitHub.

### Premier déploiement

Pousse sur `main`, ou lance *Actions → Déploiement → Run workflow*. Le workflow :

1. relance toute la CI : tests, audit des dépendances, recherche de secrets, scan de l'image ;
2. publie l'image `ghcr.io/cobroux/zotracker:sha-xxxxxxxxxxxx`, avec provenance et SBOM ;
3. se connecte au serveur, **sauvegarde les données**, met à jour, puis attend que l'application soit en bonne santé ;
4. **revient automatiquement à la version précédente** si la nouvelle ne démarre pas.

Au premier lancement sans `ADMIN_PASSWORD`, le mot de passe admin généré s'affiche une seule fois :

```bash
docker compose logs app | grep "Mot de passe"
```

Connecte-toi sur `https://suivi.mondomaine.fr/admin` et **change-le** tout de suite (section 🔒 Compte & confidentialité, 12 caractères minimum).

### Protection de la branche main (recommandé)

Dans *Settings → Branches → Add rule* pour `main` :
- exige une pull request avant de fusionner ;
- exige que les vérifications **CI** et **CodeQL** passent ;
- interdis les force-push.

Active aussi *Settings → Code security* : Dependabot alerts, Secret scanning et Push protection.

## 4. Au quotidien

| Action | Commande (sur le serveur, dans `/opt/zotracker`) |
| --- | --- |
| Voir l'état | `docker compose ps` |
| Voir les journaux | `docker compose logs -f app` |
| Déployer une version précise | `./deploy.sh sha-xxxxxxxxxxxx` |
| Revenir à la version précédente | `./deploy.sh <tag précédent>` (voir `.current-tag` et l'historique GitHub) |
| Sauvegarder maintenant | `./backup.sh` |
| Restaurer | `./restore.sh /var/backups/zotracker/zotracker-….tar.gz.age ~/zotracker-backup.key` |

Pour restaurer une sauvegarde chiffrée, copie **temporairement** la clé `age` sur le serveur, puis efface-la après usage.

**Teste une restauration au moins une fois** avant ta première course : une sauvegarde jamais testée n'est pas une sauvegarde.

### Copie hors du serveur

Si le serveur disparaît, les sauvegardes locales disparaissent avec lui. Configure [rclone](https://rclone.org) vers un stockage externe (Backblaze B2, S3, Google Drive…), puis renseigne `BACKUP_RCLONE_REMOTE`. Seules les sauvegardes **chiffrées** sont envoyées hors site.

### Surveillance

L'application expose `https://suivi.mondomaine.fr/healthz`. Branche-la sur un service gratuit comme UptimeRobot ou Better Stack, qui t'alertera si le site tombe, surtout la veille d'une course.

## 5. Avant chaque course

- [ ] Le site répond en HTTPS et `/healthz` renvoie `{"ok":true}`.
- [ ] Il y a une sauvegarde de moins de 24 h : `ls -lt /var/backups/zotracker | head`.
- [ ] Traccar Client est configuré avec la clé actuelle, et un test de 5 minutes a été fait.
- [ ] Le lien SOS est sur l'écran d'accueil du téléphone, et le « test aux contacts » ntfy a été reçu.
- [ ] La confidentialité est choisie : suivi public ou lien privé.
