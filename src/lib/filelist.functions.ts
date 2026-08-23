// Barrel — vezi src/lib/filelist/* pentru implementare, organizată pe:
// types (interfețe), categories (mapare categorii Filelist.io), log (persistență
// SQLite a descărcărilor), qbit-client (autentificare qBittorrent pentru
// download), filelist-client (SINGURUL loc care vorbește cu api.php/
// download.php de la Filelist.io), download (orchestrare descărcare: upload
// qBittorrent + scriere media + notificări + polling, consumă filelist-client).
export * from "./filelist/types";
export * from "./filelist/categories";
export * from "./filelist/log";
export * from "./qbit-client";
export * from "./filelist/filelist-client";
export * from "./filelist/download";
