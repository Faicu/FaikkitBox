#!/usr/bin/env bash
# Readuce serviciul pe root, dacă ceva nu merge după apply.sh.
# Grupul `media` și drepturile pe /media/ssd2tb rămân — sunt inofensive.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Trebuie rulat ca root." >&2; exit 1; }
rm -f /etc/systemd/system/faikkitbox.service.d/service-user.conf
rm -f /etc/sudoers.d/faikkitbox
chown -R root:root /opt/faikkitbox
chmod 600 /opt/faikkitbox/.env
systemctl daemon-reload
systemctl restart faikkitbox
sleep 3
systemctl is-active faikkitbox
