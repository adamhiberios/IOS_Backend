#!/bin/bash
# =============================================================================
# IOS LMS — Droplet bootstrap (Part 1: install + harden, root-only step)
#
# Run AS ROOT on a fresh Ubuntu 22.04 / 24.04 Droplet:
#   scp scripts/droplet-bootstrap.sh root@<ip>:/tmp/
#   ssh root@<ip> bash /tmp/droplet-bootstrap.sh
#
# After this finishes, verify SSH as `deploy` works in a SEPARATE shell, THEN
# run scripts/droplet-lockdown.sh (disables root SSH + password auth).
# =============================================================================
set -euo pipefail

echo "==> system updates"
apt update
DEBIAN_FRONTEND=noninteractive apt upgrade -y
apt install -y ca-certificates curl gnupg ufw fail2ban

echo "==> swap (2G)"
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> Docker (official repo)"
install -m 0755 -d /etc/apt/keyrings
if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
fi
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt update
DEBIAN_FRONTEND=noninteractive apt install -y \
  docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

echo "==> deploy user"
if ! id deploy >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" deploy
fi
usermod -aG docker deploy
mkdir -p /home/deploy/.ssh
cp /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys

echo "==> app directory"
mkdir -p /opt/ios-lms
chown deploy:deploy /opt/ios-lms

echo "==> firewall"
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 3000/tcp comment 'API (temporary, until reverse proxy)'
ufw --force enable

echo
echo "================================================================"
echo "PART 1 COMPLETE. Verify:"
docker --version
docker compose version
id deploy
echo
echo "Now from a NEW PowerShell window (keep this root session open):"
echo "  ssh -i \$env:USERPROFILE\\.ssh\\ios_lms_droplet deploy@\$(hostname -I | awk '{print \$1}')"
echo
echo "If that login succeeds, run scripts/droplet-lockdown.sh as root."
echo "================================================================"
