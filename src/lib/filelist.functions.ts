// Barrel — vezi src/lib/filelist/* pentru implementare, organizată pe:
// types (interfețe), categories (mapare categorii Filelist.io), log (persistență
// SQLite a descărcărilor), qbit-client (autentificare qBittorrent pentru
// download), download (căutare Filelist + orchestrare descărcare + polling).
export * from "./filelist/types";
export * from "./filelist/categories";
export * from "./filelist/log";
export * from "./filelist/qbit-client";
export * from "./filelist/download";
