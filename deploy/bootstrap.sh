#!/usr/bin/env bash
# Prepares a fresh Oracle Cloud (or any Ubuntu) VM to run the platform.
#
#   curl -fsSL https://raw.githubusercontent.com/Khalid6212/SME-Advisor/main/deploy/bootstrap.sh | bash
#
# Installs Docker, opens the firewall, clones the repo. Idempotent — safe to
# re-run.

set -euo pipefail

REPO="${REPO:-https://github.com/Khalid6212/SME-Advisor.git}"
DIR="${DIR:-$HOME/sme-advisor}"

echo "==> Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
  echo "    added $USER to the docker group — log out and back in for it to apply"
fi

# Oracle images ship with a restrictive iptables policy that silently drops
# inbound 80/443 even when the cloud security list allows them. This is the
# step people miss, and it presents as an unreachable site with a healthy
# container.
echo "==> firewall"
if command -v firewall-cmd >/dev/null 2>&1; then
  sudo firewall-cmd --permanent --add-port=80/tcp
  sudo firewall-cmd --permanent --add-port=443/tcp
  sudo firewall-cmd --reload
else
  sudo iptables -I INPUT 5 -p tcp --dport 80 -j ACCEPT || true
  sudo iptables -I INPUT 6 -p tcp --dport 443 -j ACCEPT || true
  sudo netfilter-persistent save 2>/dev/null || true
fi

echo "==> repository"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only
else
  git clone "$REPO" "$DIR"
fi

cd "$DIR"
[ -f deploy/.env ] || cp deploy/.env.example deploy/.env

cat <<EOF

Next (from $DIR):

  1. Edit deploy/.env
       openssl rand -base64 32    # SESSION_SECRET and POSTGRES_PASSWORD

  2. alias dc='docker compose -f deploy/docker-compose.yml --env-file deploy/.env'

  3. dc up -d --build

  4. dc run --rm api node api/scripts/migrate.mjs
       (the api service already carries DATABASE_URL, so nothing to pass)

  5. curl -s localhost/api/health

Remember: the cloud security list must also allow 80/443, separately from the
host firewall above.
EOF
