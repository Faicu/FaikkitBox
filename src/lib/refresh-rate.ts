// Ritmul statisticilor live: 1s pentru toți. Sub 1s nu: si.currentLoad()
// măsoară delta față de apelul anterior, deci ar fi zgomot. Costul pe server
// e mic (~55 ms/s, partajat între tab-uri). Ce curge la secundă (uptime,
// poziția de redare) e interpolat local.
export const REFRESH_MS = 1000;
