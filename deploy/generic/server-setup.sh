#!/usr/bin/env bash
# Chemin générique (ghcr + Caddy propre), NON utilisé sur Oracle : voir deploy/oracle/
# Préparation et durcissement d'un serveur Ubuntu 22.04/24.04 ou Debian 12 pour Zotracker.
# À lancer UNE fois, en root, sur un serveur neuf :
#   curl -fsSLO https://raw.githubusercontent.com/cobroux/zotracker/main/deploy/server-setup.sh
#   less server-setup.sh        # relis toujours un script avant de l'exécuter en root
#   sudo bash server-setup.sh
#
# Ce que fait le script :
#   - mises à jour système + mises à jour de sécurité automatiques
#   - pare-feu (SSH, HTTP, HTTPS uniquement) + fail2ban (anti force brute SSH)
#   - utilisateur « deploy » dédié, connexion SSH par clé uniquement, root interdit
#   - Docker (dépôt officiel), dossier /opt/zotracker, sauvegarde quotidienne
set -Eeuo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"
APP_DIR="/opt/zotracker"

[ "$(id -u)" -eq 0 ] || { echo "Lance ce script en root (sudo)." >&2; exit 1; }
. /etc/os-release
case "$ID" in ubuntu|debian) ;; *) echo "Distribution non prise en charge : $ID" >&2; exit 1 ;; esac

echo "==> Mises à jour du système"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get upgrade -yq
apt-get install -yq ca-certificates curl gnupg ufw fail2ban unattended-upgrades age

echo "==> Mises à jour de sécurité automatiques"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
CONF

echo "==> Utilisateur $DEPLOY_USER"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
# reprend les clés SSH autorisées de root (ou du compte sudo courant) pour ne pas perdre l'accès
for src in /root/.ssh/authorized_keys "/home/${SUDO_USER:-none}/.ssh/authorized_keys"; do
  if [ -s "$src" ]; then
    cat "$src" >> "/home/$DEPLOY_USER/.ssh/authorized_keys"
  fi
done
if [ -f "/home/$DEPLOY_USER/.ssh/authorized_keys" ]; then
  sort -u -o "/home/$DEPLOY_USER/.ssh/authorized_keys" "/home/$DEPLOY_USER/.ssh/authorized_keys"
  chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"
  chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"
fi

echo "==> Durcissement SSH"
if [ -s "/home/$DEPLOY_USER/.ssh/authorized_keys" ]; then
  cat > /etc/ssh/sshd_config.d/10-zotracker-hardening.conf <<CONF
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
AllowAgentForwarding no
AllowUsers $DEPLOY_USER
CONF
  sshd -t && (systemctl reload ssh 2>/dev/null || systemctl reload sshd)
  echo "    Connexion SSH : par clé uniquement, avec l'utilisateur $DEPLOY_USER"
else
  echo "!! Aucune clé SSH trouvée : durcissement SSH NON appliqué pour ne pas te bloquer." >&2
  echo "!! Ajoute ta clé dans /home/$DEPLOY_USER/.ssh/authorized_keys puis relance le script." >&2
fi

echo "==> Pare-feu"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

echo "==> fail2ban (bannissement après échecs SSH répétés)"
cat > /etc/fail2ban/jail.d/sshd.local <<'CONF'
[sshd]
enabled = true
maxretry = 5
findtime = 10m
bantime = 1h
CONF
systemctl enable --now fail2ban
systemctl restart fail2ban

echo "==> Docker (dépôt officiel)"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$ID $VERSION_CODENAME stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -yq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
# journaux Docker limités en taille ; les conteneurs n'obtiennent pas de nouveaux privilèges
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'CONF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" },
  "no-new-privileges": true,
  "live-restore": true
}
CONF
systemctl restart docker
# NB : le groupe docker donne des droits équivalents à root : ne l'accorde qu'à ce compte dédié.
usermod -aG docker "$DEPLOY_USER"

echo "==> Dossier de l'application et sauvegardes"
install -d -m 750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /var/backups/zotracker
touch /var/log/zotracker-backup.log && chown "$DEPLOY_USER:$DEPLOY_USER" /var/log/zotracker-backup.log
CRON="15 3 * * * $APP_DIR/backup.sh >> /var/log/zotracker-backup.log 2>&1"
( crontab -u "$DEPLOY_USER" -l 2>/dev/null | grep -v 'zotracker/backup.sh' || true; echo "$CRON" ) | crontab -u "$DEPLOY_USER" -

echo
echo "Serveur prêt. Étapes suivantes (voir docs/DEPLOIEMENT.md) :"
echo "  1. Copier deploy/* dans $APP_DIR (propriétaire $DEPLOY_USER)"
echo "  2. cp $APP_DIR/.env.example $APP_DIR/.env && chmod 600 $APP_DIR/.env, puis le remplir"
echo "  3. Pointer le DNS du domaine vers ce serveur, puis lancer le premier déploiement"
