#!/usr/bin/env bash
# FlowGuardian always-on worker for an Ubuntu server (Oracle Always Free ARM or any VPS).
# Run once on the server:  curl -fsSL https://raw.githubusercontent.com/danut99/FlowGuardian/master/deploy/server-setup.sh | sudo bash
# Re-running is safe: it updates the code and keeps the existing keys.
set -euo pipefail

REPO=https://github.com/danut99/FlowGuardian.git
BRANCH=master
DIR=/opt/flowguardian
ENV_FILE=/etc/flowguardian.env
SVC=flowguardian-worker

[[ $EUID -eq 0 ]] || { echo "Rulează cu sudo."; exit 1; }

echo "==> Pachete de sistem + Node 22"
apt-get update -qq
apt-get install -y -qq git curl ca-certificates >/dev/null
if ! node --version 2>/dev/null | grep -q '^v22'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi

id flowguardian &>/dev/null || useradd --system --create-home --shell /usr/sbin/nologin flowguardian

echo "==> Cod din GitHub"
if [[ -d $DIR/.git ]]; then
  git -C "$DIR" fetch -q origin "$BRANCH" && git -C "$DIR" reset -q --hard "origin/$BRANCH"
else
  git clone -q --branch "$BRANCH" "$REPO" "$DIR"
fi
chown -R flowguardian:flowguardian "$DIR"

echo "==> Dependențe + Chromium"
cd "$DIR/backend/worker"
sudo -u flowguardian npm ci --silent
npx --yes playwright install-deps chromium >/dev/null
sudo -u flowguardian npx playwright install chromium >/dev/null

if [[ ! -f $ENV_FILE ]]; then
  echo "==> Chei (se salvează doar pe server, în $ENV_FILE)"
  # Read from the terminal even when the script itself comes through a pipe
  read -rp  "SUPABASE_URL: " SUPABASE_URL < /dev/tty
  read -rsp "SUPABASE_SERVICE_ROLE_KEY (nu se afișează): " SUPABASE_SERVICE_ROLE_KEY < /dev/tty; echo
  read -rsp "GEMINI_API_KEY (opțional, Enter pentru a sări): " GEMINI_API_KEY < /dev/tty; echo
  umask 077
  cat > "$ENV_FILE" <<EOF
SUPABASE_URL=$SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY
GEMINI_API_KEY=$GEMINI_API_KEY
WORKER_MODE=daemon
WORKER_SLOTS=3
EOF
  chown root:flowguardian "$ENV_FILE"
  chmod 640 "$ENV_FILE"
fi

echo "==> Serviciu (pornește singur la boot, repornește la eroare)"
cat > /etc/systemd/system/$SVC.service <<EOF
[Unit]
Description=FlowGuardian worker
After=network-online.target
Wants=network-online.target

[Service]
User=flowguardian
WorkingDirectory=$DIR/backend/worker
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/node src/index.mjs
Restart=always
RestartSec=5
# Let running jobs finish on restart/update
TimeoutStopSec=600
KillSignal=SIGTERM

[Install]
WantedBy=multi-user.target
EOF

echo "==> Actualizare automată din GitHub la 5 minute"
cat > /usr/local/bin/flowguardian-update <<EOF
#!/usr/bin/env bash
set -euo pipefail
cd $DIR
git fetch -q origin $BRANCH
[[ \$(git rev-parse HEAD) == \$(git rev-parse origin/$BRANCH) ]] && exit 0
git reset -q --hard origin/$BRANCH
chown -R flowguardian:flowguardian $DIR
cd backend/worker && sudo -u flowguardian npm ci --silent
systemctl restart $SVC
echo "Updated to \$(git rev-parse --short HEAD)"
EOF
chmod 755 /usr/local/bin/flowguardian-update

cat > /etc/systemd/system/flowguardian-update.service <<EOF
[Unit]
Description=Update FlowGuardian from GitHub
[Service]
Type=oneshot
ExecStart=/usr/local/bin/flowguardian-update
EOF
cat > /etc/systemd/system/flowguardian-update.timer <<EOF
[Unit]
Description=Check GitHub for FlowGuardian updates
[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now $SVC flowguardian-update.timer >/dev/null
systemctl restart $SVC

sleep 5
echo
systemctl --no-pager --lines=5 status $SVC || true
echo
echo "Gata. Loguri live:  sudo journalctl -u $SVC -f"
