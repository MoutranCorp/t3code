#!/usr/bin/env bash
# Dedicated 24/7 Ubuntu Server 24.04 LTS compute-node bootstrap for Facio.
#
# Run as your normal sudo-capable user (NOT root):
#   curl -fsSL https://raw.githubusercontent.com/MoutranCorp/t3code/fork/facio/scripts/setup-compute-node-ubuntu.sh | bash
# Or from a local checkout:
#   bash scripts/setup-compute-node-ubuntu.sh
#
# Optional environment overrides:
#   FACIO_REPO_URL            Git repo to clone (default: https://github.com/MoutranCorp/t3code.git)
#   FACIO_BRANCH              Branch to track   (default: fork/facio)
#   FACIO_DIR                 Checkout path     (default: $HOME/facio)
#   FACIO_PORT                HTTP/WS port      (default: 3773)
#   FACIO_SKIP_NVIDIA=1       Skip NVIDIA headless driver installation
#   FACIO_SKIP_UFW=1          Skip UFW firewall rules
#   FACIO_SKIP_GAME_TOOLS=1   Skip Godot 4.7 / Rust 1.94.1 / anim2d / CUDA audio venvs
set -euo pipefail

if [[ "${EUID}" -eq 0 ]]; then
  echo "Run this script as your normal user (with sudo access), not as root." >&2
  exit 1
fi

FACIO_REPO_URL="${FACIO_REPO_URL:-https://github.com/MoutranCorp/t3code.git}"
FACIO_BRANCH="${FACIO_BRANCH:-fork/facio}"
FACIO_DIR="${FACIO_DIR:-$HOME/facio}"
FACIO_PORT="${FACIO_PORT:-3773}"
T3_HOME="${T3CODE_HOME:-$HOME/.t3}"
NODE_VERSION="26.13.1"
PNPM_VERSION="12.14.0"
RUST_TOOLCHAIN="1.95.0"
GAME_RUST_TOOLCHAIN="1.94.1"
GODOT_VERSION="4.7-stable"
TOOL_ROOT="$HOME/.local/share/facio-tooling"
BIN_DIR="$HOME/.local/bin"

log() {
  printf '\n\033[1;34m[facio-node]\033[0m %s\n' "$1"
}

mkdir -p "$TOOL_ROOT" "$BIN_DIR" "$T3_HOME" "$HOME/projects"

log "Requesting sudo access once for OS hardening and system packages..."
sudo -v

# 1. Strip Ubuntu telemetry, crash reporting, MOTD ads, and unnecessary desktop/laptop services
log "Removing Ubuntu telemetry, crash reporters, and unused services..."
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -y
sudo apt-get purge -y \
  ubuntu-report \
  popularity-contest \
  apport \
  apport-symptoms \
  whoopsie \
  2>/dev/null || true

# Disable Ubuntu Pro / ESM / MOTD news noise
sudo systemctl disable --now apt-news.service esm-cache.service 2>/dev/null || true
sudo systemctl mask apt-news.service esm-cache.service 2>/dev/null || true
if [[ -f /etc/default/motd-news ]]; then
  sudo sed -i 's/^ENABLED=.*/ENABLED=0/' /etc/default/motd-news
fi
sudo chmod -x /etc/update-motd.d/10-help-text /etc/update-motd.d/50-motd-news /etc/update-motd.d/88-esm-announce /etc/update-motd.d/91-contract-ua-esm-status 2>/dev/null || true

# Disable unneeded laptop/peripheral daemons if installed
for svc in cups cups-browsed avahi-daemon bluetooth ModemManager; do
  sudo systemctl disable --now "${svc}.service" 2>/dev/null || true
done

sudo apt-get autoremove -y --purge

# 2. Configure 24/7 headless laptop power behavior (ignore lid close, never sleep)
log "Configuring 24/7 headless laptop power management (lid-close ignored, sleep disabled)..."
sudo mkdir -p /etc/systemd/logind.conf.d
sudo tee /etc/systemd/logind.conf.d/90-facio-headless.conf >/dev/null <<'EOF'
[Login]
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
HandleLidSwitchDocked=ignore
HandleSuspendKey=ignore
HandleHibernateKey=ignore
IdleAction=ignore
EOF
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
sudo systemctl restart systemd-logind

# 3. Install core build, agent, and monitoring packages
log "Installing base developer packages, zram, firewall, and security updates..."
sudo apt-get install -y \
  build-essential \
  ca-certificates \
  curl \
  fd-find \
  ffmpeg \
  git \
  gnupg \
  htop \
  jq \
  libasound2t64 \
  libgl1 \
  libssl-dev \
  libvulkan1 \
  libxcursor1 \
  libxi6 \
  libxinerama1 \
  libxrandr2 \
  lsof \
  openssh-server \
  pciutils \
  pkg-config \
  python3 \
  python3-pip \
  python3-venv \
  ripgrep \
  rsync \
  systemd-oomd \
  systemd-zram-generator \
  tmux \
  ufw \
  unattended-upgrades \
  unzip \
  vulkan-tools \
  wget \
  xvfb

# GitHub CLI (gh)
if ! command -v gh >/dev/null 2>&1; then
  log "Installing GitHub CLI (gh)..."
  sudo mkdir -p -m 755 /etc/apt/keyrings
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null
  sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y gh
fi

# 4. Tune memory (zram compressed swap), file watchers, and unattended security updates
log "Configuring zram swap, inotify limits, and safe unattended security updates..."
sudo tee /etc/systemd/zram-generator.conf >/dev/null <<'EOF'
[zram0]
zram-size = min(ram / 2, 8192)
compression-algorithm = zstd
swap-priority = 100
EOF
sudo systemctl daemon-reload
sudo systemctl start systemd-zram-setup@zram0.service 2>/dev/null || true

sudo tee /etc/sysctl.d/90-facio-compute.conf >/dev/null <<'EOF'
# Favor compressed zram swap before invoking OOM under heavy parallel builds/agents.
vm.swappiness = 180
vm.watermark_boost_factor = 0
vm.watermark_scale_factor = 125
vm.page-cluster = 0
# High watch limits for TypeScript, Vite, and multiple concurrent agent worktrees.
fs.inotify.max_user_watches = 1048576
fs.inotify.max_user_instances = 1024
EOF
sudo sysctl --system >/dev/null

# Security updates without surprise auto-reboots during active agent runs
sudo tee /etc/apt/apt.conf.d/51facio-unattended-upgrades >/dev/null <<'EOF'
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
EOF

# 5. NVIDIA driver for RTX GPUs (full X11/Vulkan+CUDA driver on desktop, headless --gpgpu on server)
if [[ "${FACIO_SKIP_NVIDIA:-0}" != "1" ]] && lspci | grep -qi nvidia; then
  if ! command -v nvidia-smi >/dev/null 2>&1; then
    sudo apt-get install -y ubuntu-drivers-common
    if command -v Xorg >/dev/null 2>&1; then
      log "NVIDIA GPU + X11 desktop detected — installing full NVIDIA driver (Vulkan + CUDA + X11)..."
      sudo ubuntu-drivers install || sudo apt-get install -y nvidia-driver-550
    else
      log "NVIDIA GPU (headless) detected — installing headless NVIDIA server driver..."
      sudo ubuntu-drivers install --gpgpu || sudo apt-get install -y nvidia-driver-550-server
    fi
  else
    log "NVIDIA driver already installed ($(nvidia-smi --query-gpu=name,driver_version --format=csv,noheader | head -n 1))."
  fi
fi

# 5b. On Xubuntu Minimal / desktop installs: install Google Chrome (native .deb, no Snap) and set 24/7 XFCE power defaults
if command -v Xorg >/dev/null 2>&1; then
  if ! command -v google-chrome-stable >/dev/null 2>&1 && [[ "$(dpkg --print-architecture)" == "amd64" ]]; then
    log "Installing Google Chrome (.deb) for fast non-Snap browsing..."
    curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | sudo gpg --dearmor --yes -o /etc/apt/keyrings/google-chrome.gpg
    echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list >/dev/null
    sudo apt-get update -y
    sudo apt-get install -y google-chrome-stable || true
  fi
  if command -v xfconf-query >/dev/null 2>&1 && [[ -n "${DISPLAY:-}" ]]; then
    log "Configuring XFCE Power Manager (blank display after 10 min, never sleep/suspend)..."
    xfconf-query -c xfce4-power-manager -p /xfce4-power-manager/inactivity-on-ac -n -t uint -s 0 2>/dev/null || true
    xfconf-query -c xfce4-power-manager -p /xfce4-power-manager/inactivity-on-battery -n -t uint -s 0 2>/dev/null || true
    xfconf-query -c xfce4-power-manager -p /xfce4-power-manager/lid-action-on-ac -n -t uint -s 0 2>/dev/null || true
    xfconf-query -c xfce4-power-manager -p /xfce4-power-manager/lid-action-on-battery -n -t uint -s 0 2>/dev/null || true
    xfconf-query -c xfce4-power-manager -p /xfce4-power-manager/dpms-on-ac-off -n -t uint -s 10 2>/dev/null || true
    xfconf-query -c xfce4-power-manager -p /xfce4-power-manager/dpms-on-ac-sleep -n -t uint -s 5 2>/dev/null || true
  fi
fi

# 6. Install Tailscale and lock down firewall to SSH + LAN + Tailscale
if ! command -v tailscale >/dev/null 2>&1; then
  log "Installing Tailscale..."
  curl -fsSL https://tailscale.com/install.sh | sh
fi
sudo systemctl enable --now tailscaled ssh

if [[ "${FACIO_SKIP_UFW:-0}" != "1" ]]; then
  log "Configuring UFW firewall (SSH + Tailscale + private LAN access to Facio port ${FACIO_PORT})..."
  sudo ufw default deny incoming
  sudo ufw default allow outgoing
  sudo ufw allow OpenSSH
  sudo ufw allow in on tailscale0
  sudo ufw allow from 10.0.0.0/8 to any port "$FACIO_PORT" proto tcp
  sudo ufw allow from 172.16.0.0/12 to any port "$FACIO_PORT" proto tcp
  sudo ufw allow from 192.168.0.0/16 to any port "$FACIO_PORT" proto tcp
  sudo ufw --force enable
fi

# 7. Install pinned Node, pnpm, Rust, and uv for the user
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64) NODE_ARCH="x64" ;;
  aarch64 | arm64) NODE_ARCH="arm64" ;;
  *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

NODE_DIR="$TOOL_ROOT/node-v${NODE_VERSION}-linux-${NODE_ARCH}"
if [[ ! -x "$NODE_DIR/bin/node" ]]; then
  log "Installing Node.js v${NODE_VERSION}..."
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" \
    | tar -xJ -C "$TOOL_ROOT"
fi
export PATH="$NODE_DIR/bin:$HOME/.cargo/bin:$BIN_DIR:$PATH"

if [[ "$(pnpm --version 2>/dev/null || true)" != "$PNPM_VERSION" ]]; then
  log "Installing pnpm@${PNPM_VERSION}..."
  "$NODE_DIR/bin/npm" install -g "pnpm@${PNPM_VERSION}" --no-audit --no-fund
fi

log "Pre-installing Claude Code and Codex CLIs globally..."
"$NODE_DIR/bin/npm" install -g @anthropic-ai/claude-code @openai/codex --no-audit --no-fund || true

if ! command -v rustup >/dev/null 2>&1; then
  log "Installing Rust ${RUST_TOOLCHAIN} via rustup..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --profile minimal --default-toolchain "$RUST_TOOLCHAIN"
  export PATH="$HOME/.cargo/bin:$PATH"
else
  rustup toolchain install "$RUST_TOOLCHAIN" --profile minimal
fi

if ! command -v uv >/dev/null 2>&1; then
  log "Installing uv (for Python/ACP tools)..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi
export PATH="$HOME/.local/bin:$PATH"

# 7b. Game compute-node toolchains (Godot 4.7-stable, Rust 1.94.1, anim2d & CUDA audio venvs)
if [[ "${FACIO_SKIP_GAME_TOOLS:-0}" != "1" ]]; then
  log "Installing game Rust toolchain (${GAME_RUST_TOOLCHAIN} with rustfmt & clippy)..."
  rustup toolchain install "$GAME_RUST_TOOLCHAIN" --profile minimal --component rustfmt --component clippy

  GODOT_DIR="$TOOL_ROOT/godot-${GODOT_VERSION}"
  GODOT_BIN="$GODOT_DIR/Godot_v${GODOT_VERSION}_linux.${ARCH}"
  if [[ "$ARCH" == "x86_64" && ! -x "$GODOT_BIN" ]]; then
    log "Installing Godot ${GODOT_VERSION} (Linux x86_64)..."
    mkdir -p "$GODOT_DIR"
    curl -fsSL "https://github.com/godotengine/godot/releases/download/${GODOT_VERSION}/Godot_v${GODOT_VERSION}_linux.x86_64.zip" -o /tmp/godot.zip
    unzip -o /tmp/godot.zip -d "$GODOT_DIR" >/dev/null
    rm -f /tmp/godot.zip
    chmod +x "$GODOT_BIN"
  fi
  if [[ -x "$GODOT_BIN" ]]; then
    ln -sf "$GODOT_BIN" "$BIN_DIR/godot"
    ln -sf "$GODOT_BIN" "$BIN_DIR/godot_console"
  fi

  log "Provisioning Python 3.11 virtual environments via uv (~/.venvs/anim2d and ~/.venvs/audio-cuda)..."
  mkdir -p "$HOME/.venvs"
  if [[ ! -x "$HOME/.venvs/anim2d/bin/python" ]]; then
    uv venv --python 3.11 "$HOME/.venvs/anim2d"
  fi
  uv pip install --python "$HOME/.venvs/anim2d/bin/python" \
    numpy opencv-python-headless pillow scipy psutil potracer

  if [[ ! -x "$HOME/.venvs/audio-cuda/bin/python" ]]; then
    uv venv --python 3.11 "$HOME/.venvs/audio-cuda"
  fi
  if lspci | grep -qi nvidia; then
    uv pip install --python "$HOME/.venvs/audio-cuda/bin/python" \
      --index-url https://download.pytorch.org/whl/cu124 \
      torch torchaudio
  else
    uv pip install --python "$HOME/.venvs/audio-cuda/bin/python" torch torchaudio
  fi
  uv pip install --python "$HOME/.venvs/audio-cuda/bin/python" \
    demucs faster-whisper ctranslate2 librosa soundfile pyloudnorm numpy scipy
fi

# Ensure login and interactive shells see Node, Cargo, and ~/.local/bin (needed for non-interactive SSH & agents)
PROFILE_MARKER="# facio-compute-node-path"
for rc in "$HOME/.profile" "$HOME/.bashrc"; do
  touch "$rc"
  if ! grep -q "$PROFILE_MARKER" "$rc"; then
    cat >>"$rc" <<EOF

$PROFILE_MARKER
export PATH="$NODE_DIR/bin:\$HOME/.cargo/bin:\$HOME/.local/bin:\$PATH"
export T3CODE_HOME="$T3_HOME"
export T3CODE_TELEMETRY_ENABLED=0
export CARGO_BUILD_JOBS=4
export PTP_ROOT="\$HOME/projects/project-tag-platfighter"
export PTP_GAMEDATA="\$HOME/projects/project-tag-platfighter-gamedata"
EOF
  fi
done

# 8. Clone or update the Facio fork and build it
if [[ -d "$FACIO_DIR/.git" ]]; then
  log "Updating existing Facio checkout in $FACIO_DIR..."
  git -C "$FACIO_DIR" fetch origin "$FACIO_BRANCH"
  git -C "$FACIO_DIR" checkout "$FACIO_BRANCH"
  git -C "$FACIO_DIR" pull --ff-only origin "$FACIO_BRANCH"
else
  log "Cloning Facio (${FACIO_BRANCH}) into $FACIO_DIR..."
  git clone --branch "$FACIO_BRANCH" --single-branch "$FACIO_REPO_URL" "$FACIO_DIR"
fi

log "Installing dependencies and building Facio (web, server, and native resource-monitor)..."
cd "$FACIO_DIR"
pnpm install --frozen-lockfile
rustup run "$RUST_TOOLCHAIN" cargo build --locked --release --manifest-path native/resource-monitor/Cargo.toml
pnpm --filter @t3tools/web run build
pnpm --dir apps/server exec node scripts/cli.ts build

# Install ~/.local/bin/t3, ~/.local/bin/facio, and ~/.local/bin/facio-update
cat >"$BIN_DIR/t3" <<EOF
#!/usr/bin/env bash
export PATH="$NODE_DIR/bin:\$HOME/.cargo/bin:$BIN_DIR:\$PATH"
export T3CODE_HOME="\${T3CODE_HOME:-$T3_HOME}"
export T3CODE_TELEMETRY_ENABLED="\${T3CODE_TELEMETRY_ENABLED:-0}"
exec "$NODE_DIR/bin/node" "$FACIO_DIR/apps/server/dist/bin.mjs" "\$@"
EOF
chmod +x "$BIN_DIR/t3"
ln -sf "$BIN_DIR/t3" "$BIN_DIR/facio"

cat >"$BIN_DIR/facio-update" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export PATH="$NODE_DIR/bin:\$HOME/.cargo/bin:$BIN_DIR:\$PATH"
cd "$FACIO_DIR"
git fetch origin "$FACIO_BRANCH"
git checkout "$FACIO_BRANCH"
git pull --ff-only origin "$FACIO_BRANCH"
pnpm install --frozen-lockfile
rustup run "$RUST_TOOLCHAIN" cargo build --locked --release --manifest-path native/resource-monitor/Cargo.toml
pnpm --filter @t3tools/web run build
pnpm --dir apps/server exec node scripts/cli.ts build
systemctl --user restart t3code.service
systemctl --user status t3code.service --no-pager
EOF
chmod +x "$BIN_DIR/facio-update"

# 9. Set up Chrome sandbox AppArmor profile + fonts for remote headless browser tabs
log "Configuring headless Chrome sandbox & fonts (t3 browser setup)..."
sudo env "PATH=$NODE_DIR/bin:$PATH" "$BIN_DIR/t3" browser setup

# 10. Configure systemd user lingering + Facio background service + OOM protection
log "Enabling systemd user lingering and installing t3code.service..."
sudo loginctl enable-linger "$USER"

cat >"$T3_HOME/service.env" <<EOF
T3CODE_LAN=true
T3CODE_PORT=${FACIO_PORT}
T3CODE_TELEMETRY_ENABLED=0
CARGO_BUILD_JOBS=4
PTP_ROOT=${HOME}/projects/project-tag-platfighter
PTP_GAMEDATA=${HOME}/projects/project-tag-platfighter-gamedata
EOF
chmod 600 "$T3_HOME/service.env"

mkdir -p "$HOME/.config/systemd/user"
cat >"$HOME/.config/systemd/user/t3code.service" <<EOF
[Unit]
Description=Facio compute-node server
After=network-online.target
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=simple
WorkingDirectory=%h
Environment=PATH=${NODE_DIR}/bin:${HOME}/.cargo/bin:${BIN_DIR}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=T3CODE_HOME=${T3_HOME}
Environment=T3CODE_TELEMETRY_ENABLED=0
EnvironmentFile=-${T3_HOME}/service.env
ExecStart=${NODE_DIR}/bin/node ${FACIO_DIR}/apps/server/dist/bin.mjs serve --lan --no-browser
Restart=always
RestartSec=3
KillMode=mixed
TimeoutStopSec=30

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now t3code.service

log "Applying kernel memory & OOM protection for Facio, SSH, and Tailscale..."
"$BIN_DIR/t3" service protect --yes 2>/dev/null || "$BIN_DIR/t3" service protect || true
systemctl --user restart t3code.service

log "Done! Facio compute node is installed and running."
cat <<EOF

Next steps on this MSI laptop:
  1. Join Tailscale (if not yet connected):
       sudo tailscale up
  2. Expose Facio over Tailscale HTTPS and get a pairing link:
       t3 pair --tailscale
     (Or LAN-only pairing link:  t3 pair)
  3. Install & sign in to the provider CLIs you want agents to use here, e.g.:
       npm install -g @anthropic-ai/claude-code @openai/codex
       claude auth login
       codex login
     (Antigravity, Kiro, OpenCode, etc. can also be enabled/installed right from Facio Settings → Providers!)
  4. On BOTH computers, enable Settings → Labs → Linked environments,
     then link this laptop under Settings → Environments → Linked environments,
     and set its Load balancing preference to "Prefer".

Useful checks:
  systemctl --user status t3code.service
  journalctl --user -u t3code.service -f
  t3 service status
  free -h && swapon --show
EOF
