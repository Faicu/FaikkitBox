# Faikkitbox Agent

Mic serviciu HTTP care rulează pe mini-PC-ul Ubuntu și execută comenzi permise cerute de dashboard.

## 1. Instalare

```bash
sudo apt-get install -y python3 python3-venv
sudo mkdir -p /opt/faikkitbox-agent
sudo cp agent.py /opt/faikkitbox-agent/
cd /opt/faikkitbox-agent
sudo python3 -m venv .venv
sudo .venv/bin/pip install fastapi "uvicorn[standard]"
```

## 2. Token

Folosește exact tokenul din secretul `AGENT_TOKEN` din aplicație.

```bash
sudo tee /etc/faikkitbox-agent.env >/dev/null <<'EOF'
AGENT_TOKEN=PUNE_AICI_TOKENUL
EOF
sudo chmod 600 /etc/faikkitbox-agent.env
```

## 3. Sudo fără parolă pentru comenzile permise

```bash
sudo tee /etc/sudoers.d/faikkitbox-agent >/dev/null <<'EOF'
faicu ALL=(root) NOPASSWD: /usr/bin/apt-get update, /usr/bin/apt-get -y upgrade, /usr/bin/resolvectl flush-caches, /bin/systemctl restart plexmediaserver, /bin/systemctl restart qbittorrent-nox, /usr/bin/docker compose -f /opt/immich/docker-compose.yml restart
EOF
sudo chmod 440 /etc/sudoers.d/faikkitbox-agent
```

> Adaptează calea `/opt/immich/docker-compose.yml` la instalarea ta.

## 4. Serviciu systemd

```bash
sudo tee /etc/systemd/system/faikkitbox-agent.service >/dev/null <<'EOF'
[Unit]
Description=Faikkitbox Agent
After=network-online.target

[Service]
User=faicu
EnvironmentFile=/etc/faikkitbox-agent.env
WorkingDirectory=/opt/faikkitbox-agent
ExecStart=/opt/faikkitbox-agent/.venv/bin/uvicorn agent:app --host 127.0.0.1 --port 8765
Restart=always

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now faikkitbox-agent
```

## 5. Cloudflare Tunnel

Adaugă o rută publică către `http://127.0.0.1:8765` și pune URL-ul în secretul `AGENT_URL` (ex: `https://agent.faicu.ro`).