#!/bin/bash
# =============================================================================
# IOS LMS — Migrate Droplet to multi-env layout (prod/ + dev/)
#
# Before this script:
#   /opt/ios-lms/.env
#   /opt/ios-lms/docker-compose.yml
#   running container: ios-lms-api (port 3000)
#
# After this script:
#   /opt/ios-lms/prod/.env       (existing prod env, with APP_ENV=prod + HOST_PORT=3000 added)
#   /opt/ios-lms/prod/docker-compose.yml (placeholder; CI overwrites it on next deploy)
#   /opt/ios-lms/dev/.env.example (template you fill in by hand)
#   running container: ios-lms-api-prod (still port 3000)
#
# Run as `deploy` from /opt/ios-lms.
# =============================================================================
set -euo pipefail

cd /opt/ios-lms

echo "==> sanity check"
test -f .env || { echo "ERROR: /opt/ios-lms/.env not found"; exit 1; }
test -f docker-compose.yml || { echo "ERROR: /opt/ios-lms/docker-compose.yml not found"; exit 1; }

echo "==> stopping existing stack"
# The old project name is whatever docker compose auto-derived (ios-lms by default).
# We bring it down so port 3000 frees up, then re-up under the new prod project name.
docker compose down

echo "==> creating prod/ and dev/ directories"
mkdir -p prod dev

echo "==> moving existing env + compose into prod/"
mv .env prod/.env
mv docker-compose.yml prod/docker-compose.yml

echo "==> patching prod/.env with APP_ENV + HOST_PORT (if not already present)"
cd prod
grep -q '^APP_ENV=' .env || echo 'APP_ENV=prod' >> .env
grep -q '^HOST_PORT=' .env || echo 'HOST_PORT=3000' >> .env
# Strip any old/stale STORAGE_KEY_PREFIX (prod should have no prefix)
sed -i '/^STORAGE_KEY_PREFIX=/d' .env

echo "==> restarting prod stack under new project name"
docker compose -p ios-lms-prod up -d

echo "==> waiting for prod to come back up"
sleep 10
docker compose -p ios-lms-prod ps

cd /opt/ios-lms

echo "==> generating dev JWT secrets"
DEV_JWT_SECRET=$(openssl rand -hex 48)
DEV_JWT_REFRESH_SECRET=$(openssl rand -hex 48)

echo "==> creating dev/.env.example template"
cat > dev/.env.example <<EOF
# Fill in the <PASTE_*> placeholders, then rename to .env and chmod 600.

# --- runtime image (deploy workflow will update this) ---
API_IMAGE=ghcr.io/adamhiberios/ios_backend:dev

# --- env identification (drives container_name + host port via compose) ---
APP_ENV=dev
HOST_PORT=3001

# --- enable Swagger on dev only (prod leaves this unset) ---
ENABLE_SWAGGER=true

# --- app ---
NODE_ENV=production
PORT=3000
APP_BASE_URL=http://159.203.7.46:3001

# --- database (same Postgres cluster, separate database) ---
DATABASE_URL=postgresql://doadmin:<PASTE_POSTGRES_PASSWORD>@private-db-pgsql-tor1-62678-do-user-38165705-0.j.db.ondigitalocean.com:25060/ios_lms_dev?sslmode=no-verify

# --- valkey (same cluster, logical DB index 1) ---
REDIS_URL=rediss://default:<PASTE_VALKEY_PASSWORD>@private-db-vk-tor1-52645-do-user-38165705-0.j.db.ondigitalocean.com:25061/1

# --- jwt (freshly generated for dev — different from prod) ---
JWT_SECRET=${DEV_JWT_SECRET}
JWT_REFRESH_SECRET=${DEV_JWT_REFRESH_SECRET}
JWT_ACCESS_TTL=900
JWT_REFRESH_TTL=604800

# --- DigitalOcean Spaces (same buckets, dev/ prefix isolates objects) ---
DO_SPACES_ENDPOINT=https://tor1.digitaloceanspaces.com
DO_SPACES_PUBLIC_URL=https://tor1.digitaloceanspaces.com
DO_SPACES_REGION=us-east-1
DO_SPACES_KEY=<PASTE_SAME_SPACES_KEY_AS_PROD>
DO_SPACES_SECRET=<PASTE_SAME_SPACES_SECRET_AS_PROD>
DO_SPACES_BUCKET_CERTIFICATES=ios-lms-certificates
DO_SPACES_BUCKET_MEDIA=ios-storage
DO_SPACES_BUCKET_VIDEOS=ios-storage
STORAGE_KEY_PREFIX=dev

# --- third-party (placeholders — same as prod for now) ---
STRIPE_SECRET_KEY=sk_test_placeholder_replace_with_real_stripe_test_key
STRIPE_WEBHOOK_SECRET=whsec_placeholder_replace_with_real_stripe_webhook_secret
SENDGRID_API_KEY=SG.placeholder_replace_with_real_sendgrid_key

# --- i18n ---
DEFAULT_LOCALE=en
SUPPORTED_LOCALES=en,tr,fr,es,ar,de

# --- super_admin bootstrap (use a dev-specific email + password) ---
BOOTSTRAP_SUPER_ADMIN=true
BOOTSTRAP_SUPER_ADMIN_EMAIL=<PASTE_DEV_ADMIN_EMAIL>
BOOTSTRAP_SUPER_ADMIN_PASSWORD=<PASTE_DEV_ADMIN_PASSWORD>
BOOTSTRAP_SUPER_ADMIN_FIRST_NAME=IOS
BOOTSTRAP_SUPER_ADMIN_LAST_NAME=Dev
EOF

chmod 600 dev/.env.example

echo
echo "================================================================"
echo "MIGRATION COMPLETE"
echo
echo "Prod stack is back up under new project name:"
docker compose -p ios-lms-prod ps
echo
echo "Next steps you do manually:"
echo "  1. From the DO web console (as root), open UFW for dev:"
echo "       ufw allow 3001/tcp comment 'API dev'"
echo "  2. In DO Console, create database 'ios_lms_dev' in the Postgres cluster."
echo "  3. cp /opt/ios-lms/dev/.env.example /opt/ios-lms/dev/.env"
echo "  4. nano /opt/ios-lms/dev/.env  (fill in <PASTE_*> placeholders)"
echo "  5. chmod 600 /opt/ios-lms/dev/.env"
echo "  6. Trigger GitHub Actions workflow 'Deploy' with environment=dev."
echo "================================================================"
