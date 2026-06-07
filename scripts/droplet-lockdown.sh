#!/bin/bash
# =============================================================================
# IOS LMS — Droplet bootstrap (Part 2: SSH hardening)
#
# Run ONLY after you've verified `ssh deploy@<ip>` works in a separate shell.
# This disables root SSH login and password authentication entirely.
#
# Run AS ROOT:
#   ssh root@<ip> bash /tmp/droplet-lockdown.sh
# =============================================================================
set -euo pipefail

echo "==> disabling root SSH login + password auth"
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config

# Ubuntu 22.04+ may also load drop-in files under /etc/ssh/sshd_config.d/*.conf
# that override the main file. Force them too.
for f in /etc/ssh/sshd_config.d/*.conf; do
  [ -f "$f" ] || continue
  sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' "$f"
  sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' "$f"
done

systemctl reload ssh

echo
echo "=== effective sshd settings ==="
sshd -T 2>/dev/null | grep -E '^(permitrootlogin|passwordauthentication|pubkeyauthentication)'
echo
echo "Lockdown complete. Future logins must use SSH key as 'deploy'."
