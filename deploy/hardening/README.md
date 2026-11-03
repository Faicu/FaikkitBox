# Restrângerea privilegiilor serviciului

Totul de aici e aplicat pe server; fișierele stau în git ca sursă pentru
copiile instalate și ca să fie revizuite ca orice altceva.

- `service-user.conf` — drop-in în `/etc/systemd/system/faikkitbox.service.d/`:
  serviciul rulează ca `faikkitbox:media`, cu `HOME=/var/lib/faikkitbox`.
- `hardening.conf` — drop-in în același loc: `PrivateTmp`, `ProtectClock`,
  `ProtectControlGroups`, `ProtectKernelLogs`, `ProtectHostname`,
  `LockPersonality`, `RestrictRealtime` și familii de socket-uri limitate.
- `faikkitbox.sudoers` — copiat în `/etc/sudoers.d/faikkitbox`: comenzile
  exacte permise contului de serviciu. O comandă nouă din aplicație trebuie
  adăugată aici și copiată din nou, altfel eșuează cu „not allowed”.
- Grupul `media`, cu `/media/ssd2tb` setgid și scriibil de grup, iar
  qBittorrent pornit cu `Group=media` + `UMask=0002` — fișierele descărcate ies
  `root:media`, scriibile de grup. E condiția ca aplicația să poată pune
  subtitrări și șterge titluri fără să fie root.

Dacă ceva nu merge după o schimbare aici: `sudo bash deploy/hardening/revert.sh`
readuce serviciul pe root. Scriptul care a făcut trecerea pe contul dedicat
(`apply.sh`) a fost scos după aplicare; e în istoricul git.

## Ce NU rezolvă

`apt-get upgrade` rămâne disponibil în pagina Tehnic, iar prin sudo e
echivalent cu root deplin: un pachet poate rula orice la instalare. Contul
dedicat limitează greșelile și accesul la fișiere, dar nu blochează un atacator
care ajunge să execute cod în aplicație. Din același motiv nu pot fi activate
`NoNewPrivileges` (sudo e setuid) și `ProtectSystem` (apt scrie în /usr și
/var). Dacă la un moment dat muți actualizările de sistem pe SSH, scoate
`FKB_APT` din `faikkitbox.sudoers` și adaugă `ProtectSystem=strict` cu
`ReadWritePaths` pe /opt/faikkitbox și /media/ssd2tb — abia atunci separarea
devine etanșă.
