# IOS LMS — Production Deployment Guide (DigitalOcean)

Target architecture for **v1**:

```
GitHub Actions  ──build──▶  ghcr.io/<owner>/ios-lms-api:sha-xxxxx
       │
       └──ssh──▶  Droplet (Ubuntu 22.04, Docker)
                    │
                    └─ api container :3000
                          │
                          ├─ Managed Postgres   (private VPC)
                          ├─ Managed Valkey     (private VPC)
                          └─ Spaces             (public S3 endpoint, IAM-keyed)
```

No domain, no TLS yet — API is reachable at `http://<droplet-ip>:3000`.

---

## 1. Generate an SSH key on Windows

Open **PowerShell** (not CMD):

```powershell
ssh-keygen -t ed25519 -C "ios-lms-deploy" -f $env:USERPROFILE\.ssh\ios_lms_droplet
```

- Press Enter twice to accept the default empty passphrase (or set one — you'll have to use ssh-agent if you do).
- This creates two files:
  - `C:\Users\<you>\.ssh\ios_lms_droplet` — private key (NEVER share)
  - `C:\Users\<you>\.ssh\ios_lms_droplet.pub` — public key (safe to share)

Show the public key:

```powershell
Get-Content $env:USERPROFILE\.ssh\ios_lms_droplet.pub
```

Copy that single line — it's what goes onto the Droplet.

---

## 2. Add the SSH key to the Droplet

The Droplet already exists but has no key, so you'll reset the root password first:

1. DO Console → **Droplets** → your Droplet → **Access** tab → **Reset root password**.
   DO emails you a one-time root password.
2. Click **Launch Droplet Console** in the same Access tab (browser-based console).
3. Log in as `root` with the emailed password. You'll be forced to change it on first login.
4. Paste your public key into the authorised keys file:

   ```bash
   mkdir -p /root/.ssh
   chmod 700 /root/.ssh
   cat >> /root/.ssh/authorized_keys <<'EOF'
   ssh-ed25519 AAAA...your-public-key-here... ios-lms-deploy
   EOF
   chmod 600 /root/.ssh/authorized_keys
   ```

5. From your Windows PowerShell, test the connection:

   ```powershell
   ssh -i $env:USERPROFILE\.ssh\ios_lms_droplet root@<droplet-ip>
   ```

   You should get a shell prompt without being asked for a password.

---

## 3. Bootstrap the Droplet (Docker, user, firewall)

SSH in as `root` and run:

```bash
# --- system updates ---
apt update && apt upgrade -y
apt install -y ca-certificates curl gnupg ufw fail2ban

# --- swap (recommended for 1-2 GB Droplets) ---
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# --- Docker (official repo) ---
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# --- non-root deploy user ---
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
mkdir -p /home/deploy/.ssh
cp /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys

# --- app directory owned by deploy ---
mkdir -p /opt/ios-lms
chown deploy:deploy /opt/ios-lms

# --- firewall ---
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 3000/tcp comment 'API (temporary, until reverse proxy)'
ufw --force enable

# --- disable root SSH + password auth ---
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl reload ssh
```

From now on, SSH in as `deploy`:

```powershell
ssh -i $env:USERPROFILE\.ssh\ios_lms_droplet deploy@<droplet-ip>
```

---

## 4. Verify VPC and configure managed services

### 4a. Check VPC

DO Console → **Networking** → **VPC**. You should see all three resources (Droplet, Postgres, Valkey) under the same VPC in the same region. If any one isn't, move it (or you can use public endpoints with SSL, see fallback below).

### 4b. Postgres trusted source

DO Console → **Databases** → your Postgres → **Settings** → **Trusted sources** → **Edit** → add the Droplet by name.

Then on the same page, copy the **Private network** connection string. It looks like:

```
postgresql://doadmin:<password>@private-db-postgresql-xxx.b.db.ondigitalocean.com:25060/defaultdb?sslmode=require
```

Create the application database (the cluster ships with `defaultdb` only):

```bash
# from anywhere with psql installed and trusted-source access (your laptop works
# if you temporarily add your IP, or run this from the Droplet via apt install postgresql-client):
psql "postgresql://doadmin:<password>@private-db-...:25060/defaultdb?sslmode=require" \
  -c "CREATE DATABASE ios_lms;"
```

The final URL the app uses is the same connection string but with `/ios_lms` instead of `/defaultdb`.

### 4c. Valkey trusted source

DO Console → **Databases** → your Valkey → **Settings** → **Trusted sources** → add the Droplet.

Copy the **Private network** connection string. Looks like:

```
rediss://default:<password>@private-valkey-xxx.b.db.ondigitalocean.com:25061
```

(Note: `rediss://` with double-s for TLS — DO Valkey requires TLS.)

> `ioredis` (the client this project uses) handles `rediss://` URLs natively. No code change needed.

### Fallback if VPC isn't ready

Use the public connection strings instead — they end with `.ondigitalocean.com` (no `private-` prefix). Make sure the Droplet IP is added as a trusted source for both. TLS is mandatory in both cases.

---

## 5. Create Spaces buckets + access key

DO Console → **Spaces Object Storage**.

1. Create three buckets in your region (e.g. `nyc3`):
   - `ios-lms-certificates`
   - `ios-lms-media`
   - `ios-lms-videos`
2. **API** → **Spaces Keys** → **Generate New Key** → name it `ios-lms-api`. Save the key + secret somewhere safe — the secret is shown once.
3. Endpoint URL for `nyc3`: `https://nyc3.digitaloceanspaces.com`.
   For other regions swap the `nyc3` prefix.

---

## 6. Create `/opt/ios-lms/.env` on the Droplet

SSH in as `deploy`, then:

```bash
cd /opt/ios-lms

# Generate strong JWT secrets:
JWT_SECRET=$(openssl rand -hex 48)
JWT_REFRESH_SECRET=$(openssl rand -hex 48)
echo "JWT_SECRET=$JWT_SECRET"
echo "JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET"
# (copy those values into the file below)

nano .env
```

Paste this template, filling in the bracketed values:

```ini
# --- runtime image (set automatically by the GitHub Actions deploy job) ---
API_IMAGE=ghcr.io/<owner>/ios-lms-api:latest

# --- app ---
NODE_ENV=production
PORT=3000
APP_BASE_URL=http://<droplet-ip>:3000

# --- database (paste the private VPC URL, with /ios_lms not /defaultdb) ---
DATABASE_URL=postgresql://doadmin:<pw>@private-db-postgresql-xxx.b.db.ondigitalocean.com:25060/ios_lms?sslmode=require

# --- redis / valkey (paste private URL, rediss://) ---
REDIS_URL=rediss://default:<pw>@private-valkey-xxx.b.db.ondigitalocean.com:25061

# --- jwt (use the generated values above) ---
JWT_SECRET=<paste 96-hex-char value>
JWT_REFRESH_SECRET=<paste 96-hex-char value>
JWT_ACCESS_TTL=900
JWT_REFRESH_TTL=604800

# --- DigitalOcean Spaces ---
DO_SPACES_ENDPOINT=https://nyc3.digitaloceanspaces.com
DO_SPACES_PUBLIC_URL=https://nyc3.digitaloceanspaces.com
DO_SPACES_REGION=us-east-1
DO_SPACES_KEY=<spaces key>
DO_SPACES_SECRET=<spaces secret>
DO_SPACES_BUCKET_CERTIFICATES=ios-lms-certificates
DO_SPACES_BUCKET_MEDIA=ios-lms-media
DO_SPACES_BUCKET_VIDEOS=ios-lms-videos

# --- third-party services (use test keys until you go live) ---
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
SENDGRID_API_KEY=SG.xxx

# --- i18n ---
DEFAULT_LOCALE=en
SUPPORTED_LOCALES=en,tr,fr,es,ar,de

# --- super_admin bootstrap (first run only) ---
BOOTSTRAP_SUPER_ADMIN=true
BOOTSTRAP_SUPER_ADMIN_EMAIL=<your real admin email>
BOOTSTRAP_SUPER_ADMIN_PASSWORD=<strong password>
BOOTSTRAP_SUPER_ADMIN_FIRST_NAME=IOS
BOOTSTRAP_SUPER_ADMIN_LAST_NAME=Admin
```

Lock it down:

```bash
chmod 600 .env
```

After the first successful deploy + super_admin creation, set `BOOTSTRAP_SUPER_ADMIN=false` and redeploy. The seeder is a no-op once a row exists, but flipping the flag is good hygiene.

---

## 7. Configure GitHub repository secrets

GitHub → your repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.

Add these three:

| Name              | Value                                                                |
| ----------------- | -------------------------------------------------------------------- |
| `DROPLET_HOST`    | the Droplet's public IP                                              |
| `DROPLET_USER`    | `deploy`                                                             |
| `DROPLET_SSH_KEY` | the **private** key contents (`ios_lms_droplet`, full text incl. headers) |

To get the private key contents on Windows:

```powershell
Get-Content $env:USERPROFILE\.ssh\ios_lms_droplet
```

Copy the entire output starting with `-----BEGIN OPENSSH PRIVATE KEY-----` and ending with `-----END OPENSSH PRIVATE KEY-----`, paste as the secret value.

GHCR auth uses the built-in `GITHUB_TOKEN` — no extra secret needed.

---

## 8. First deploy

```bash
# from your local clone
git add Dockerfile docker/entrypoint.sh docker-compose.droplet.yml .github/workflows/deploy.yml docs/DEPLOYMENT.md
git commit -m "ci: add GHCR build + Droplet deploy workflow"
git push origin main
```

Watch it in GitHub → **Actions** tab. The workflow has two jobs:

1. **build-push** — should finish in 2–5 minutes the first time. Subsequent runs are faster (cache).
2. **deploy** — SSHs in, pulls the image, restarts the container, hits `/health`.

If `deploy` fails on the health check, the workflow tails the last 200 lines of container logs at the end of the job for you to read.

---

## 9. Verify

```powershell
# from your laptop
curl http://<droplet-ip>:3000/health
```

On the Droplet, useful commands:

```bash
cd /opt/ios-lms
docker compose ps               # is the container up?
docker compose logs -f api      # tail logs
docker compose exec api node -e "console.log(process.env.NODE_ENV)"
```

---

## What's next (not in v1)

- Add a domain + Caddy reverse proxy → free Let's Encrypt TLS in ~5 min.
- Switch the host port mapping from `3000:3000` to `127.0.0.1:3000` once Caddy is in front, so the API isn't exposed publicly.
- Turn on automatic Postgres backups in the DO console if not already.
- Replace `sslmode=require` with `sslmode=verify-full` once you've pinned the CA bundle.
