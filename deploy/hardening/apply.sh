#!/usr/bin/env bash
# Trece serviciul FaikkitBox de pe root pe contul dedicat `faikkitbox`.
#
# Rulează ca root: sudo bash deploy/hardening/apply.sh
#
# Idempotent — se poate rula de mai multe ori. Pentru revenire, vezi revert.sh.
set -euo pipefail

REPO=/opt/faikkitbox
HOME_DIR=/var/lib/faikkitbox
USER_NAME=faikkitbox

[[ $EUID -eq 0 ]] || { echo "Trebuie rulat ca root." >&2; exit 1; }

echo "== 1/6 cont și grup =="
getent group media >/dev/null || groupadd media
getent passwd "$USER_NAME" >/dev/null ||
  useradd --system --no-create-home --shell /usr/sbin/nologin --gid media "$USER_NAME"
usermod -d "$HOME_DIR" "$USER_NAME"
id -nG faicu | tr ' ' '\n' | grep -qx media || usermod -aG media faicu

echo "== 2/6 home + cheia SSH pentru git =="
# Butonul "Push pe GitHub" și deploy_app folosesc remote-ul SSH al repo-ului.
# Contul de serviciu are nevoie de o cheie proprie; recomandarea e o cheie de
# deploy NOUĂ, adăugată în GitHub → Settings → Deploy keys (cu drept de scriere),
# nu o copie a cheii personale din /root/.ssh.
install -d -m 750 -o "$USER_NAME" -g media "$HOME_DIR"
install -d -m 700 -o "$USER_NAME" -g media "$HOME_DIR/.ssh"
if [[ ! -f "$HOME_DIR/.ssh/id_ed25519" ]]; then
  sudo -u "$USER_NAME" ssh-keygen -t ed25519 -N "" -C "faikkitbox@$(hostname)" \
    -f "$HOME_DIR/.ssh/id_ed25519"
  echo
  echo ">>> Adaugă cheia asta în GitHub ca Deploy key cu acces de scriere:"
  cat "$HOME_DIR/.ssh/id_ed25519.pub"
  echo
fi
ssh-keyscan -t ed25519 github.com 2>/dev/null >> "$HOME_DIR/.ssh/known_hosts"
sort -u -o "$HOME_DIR/.ssh/known_hosts" "$HOME_DIR/.ssh/known_hosts"
chown -R "$USER_NAME":media "$HOME_DIR/.ssh"
chmod 600 "$HOME_DIR/.ssh/id_ed25519"
chmod 644 "$HOME_DIR/.ssh/known_hosts"

echo "== 3/6 drepturi pe repo, bază de date și .env =="
chown -R "$USER_NAME":media "$REPO"
chmod -R g+w "$REPO"
chown "$USER_NAME":media "$REPO/.env"
chmod 600 "$REPO/.env"
# faicu (și root) lucrează în continuare în repo prin grupul `media`; fără asta
# git refuză cu "dubious ownership".
git config --system --add safe.directory "$REPO" || true

echo "== 4/6 sudoers =="
install -m 0440 -o root -g root "$REPO/deploy/hardening/faikkitbox.sudoers" /etc/sudoers.d/faikkitbox
visudo -c -q || { rm -f /etc/sudoers.d/faikkitbox; echo "sudoers invalid, anulat" >&2; exit 1; }

echo "== 5/6 unit systemd =="
install -d /etc/systemd/system/faikkitbox.service.d
install -m 0644 "$REPO/deploy/hardening/service-user.conf" \
  /etc/systemd/system/faikkitbox.service.d/service-user.conf
systemctl daemon-reload
systemctl restart faikkitbox

echo "== 6/6 verificare =="
sleep 4
systemctl is-active faikkitbox
ps -o user=,group= -p "$(systemctl show -p MainPID --value faikkitbox)"
curl -sf -o /dev/null -w "HTTP %{http_code}\n" "http://127.0.0.1:${PORT:-3000}/"
echo
echo "Testează manual din pagina Tehnic: Uptime, Repornire qBittorrent, Flush DNS,"
echo "Repornire Plex/Immich, Deploy, Push pe GitHub — plus o corectare de subtitrare"
echo "din Bibliotecă (verifică scrierea în /media/ssd2tb ca membru al grupului media)."
