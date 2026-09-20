# Restrângerea privilegiilor serviciului

Aplicat deja pe server (nu necesită nimic din partea ta):

- `hardening.conf` — drop-in systemd activ în
  `/etc/systemd/system/faikkitbox.service.d/`. Serviciul rulează în continuare
  ca root, dar cu `PrivateTmp`, `ProtectClock`, `ProtectControlGroups`,
  `ProtectKernelLogs`, `ProtectHostname`, `LockPersonality`, `RestrictRealtime`
  și familii de socket-uri limitate.
- Grupul `media`, cu `/media/ssd2tb` setgid și scriibil de grup, iar
  qBittorrent pornit cu `Group=media` + `UMask=0002` — fișierele descărcate ies
  `root:media`, scriibile de grup. E condiția ca aplicația să poată pune
  subtitrări și șterge titluri fără să fie root.

De aplicat manual, când vrei (trecerea pe cont dedicat):

```sh
sudo bash deploy/hardening/apply.sh
```

Scriptul creează contul `faikkitbox`, îi generează o cheie de deploy pentru
GitHub (o afișează — trebuie adăugată în repo, cu drept de scriere), mută
drepturile pe repo/DB/.env, instalează lista sudoers și comută unitul. Dacă
ceva nu merge: `sudo bash deploy/hardening/revert.sh`.

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
