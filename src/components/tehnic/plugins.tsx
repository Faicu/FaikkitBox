import type { ReactNode } from "react";
import {
  GitCommitHorizontal,
  PlayCircle,
  Link2,
  RotateCcw,
  Power,
  PlugZap,
  DatabaseBackup,
  Upload,
  Tv,
  RefreshCw,
  Clapperboard,
  Film,
} from "lucide-react";
import { Orb } from "@/components/ui/orb";

// Catalogul plugin-urilor de fundal — sursă unică pentru lista din Tehnic și
// pentru drawer-ul de detalii. Reflectă exact fișierele din server/plugins/:
// un rând per proces care rulează, nu per funcționalitate. Excepție de loc,
// nu de regulă: un plugin legat de un singur serviciu stă pe pagina acelui
// serviciu, nu în lista din Tehnic (IMMICH_UPLOAD_PLUGIN, pe pagina Immich). Completarea
// numelor de episoade, de exemplu, n-are intrare proprie — e un pas dintr-un
// tic al lui show-watcher, iar o intrare separată ar putea arăta "activ"
// chiar dacă plugin-ul e mort.
export interface PluginInfo {
  // Identic cu numele fișierului din server/plugins/, fără extensie.
  id: string;
  label: string;
  description: string;
  cadence: string;
  // De ce există plugin-ul, pe scurt — aproape toate au apărut ca reacție la
  // un bug concret, iar contextul ăla e cel mai util lucru de citit când te
  // întrebi peste un an de ce e acolo.
  details: string;
  // Pentru plugin-urile care fac mai multe lucruri distincte: fiecare parte
  // cu ritmul și explicația ei, afișate pliat în drawer — un singur bloc de
  // text lung nu se mai citea.
  steps?: PluginStep[];
  icon: ReactNode;
  // Tipul de intrare din jurnal care dovedește că a făcut ceva. Null pentru
  // cele care lucrează doar la pornire sau care nu loghează când n-au găsit
  // nimic de făcut — atunci rândul rămâne fără timestamp, ceea ce e onest.
  activityType: string | null;
}

export interface PluginStep {
  title: string;
  cadence: string;
  // O frază, vizibilă mereu; `points` apar doar la deschidere.
  summary: string;
  points: string[];
  icon: ReactNode;
}

export const PLUGINS: PluginInfo[] = [
  {
    id: "show-watcher",
    label: "Urmărire Seriale și Filme",
    description: "Descărcare automată episoade noi și filme așteptate",
    cadence: "verificat din 10 în 10 min",
    details: "Face patru lucruri la fiecare tic, fiecare cu ritmul lui.",
    steps: [
      {
        title: "Episoade noi",
        cadence: "la 3h / serial",
        summary: "Aduce de pe Filelist episoadele difuzate care lipsesc din bibliotecă.",
        points: [
          "Compară ce s-a difuzat (TMDB, inclusiv episodul lansat azi) cu ce ai deja în bibliotecă și aduce diferența.",
          "Caută strict după IMDb ID, întrebând mereu Filelist direct, fără cache.",
          "Nu ține minte ce a văzut ultima dată: întreabă de fiecare dată realitatea, deci se poate relua oricând, se repară singur după un restart și nu poate descărca de două ori.",
          "După fiecare descărcare, poziția de start avansează peste episoadele aduse (fără să sară vreunul lipsă), ca un episod văzut și șters din Bibliotecă să nu revină.",
          "Dacă ai ales o calitate de rezervă, ea se ia doar când principala lipsește la două verificări, la cel puțin 3 ore distanță.",
        ],
        icon: <Tv className="h-3.5 w-3.5 text-blue-400" />,
      },
      {
        title: "Detalii seriale",
        cadence: "la 12h",
        summary: "Împrospătează din TMDB toate serialele, inclusiv pe cele neurmărite.",
        points: [
          "Serialul: status (încheiat / în producție), titlul românesc și cel original, anul, descrierea, genurile, posterul și următorul episod anunțat.",
          "Odată cu serialul, și toate episoadele lui: numele, descrierea, data difuzării, cadrul din episod și posterul sezonului.",
          "Totul e cerut în română la fiecare trecere; ce TMDB n-are încă în română rămâne în engleză până apare traducerea.",
          "Statusul contează și la serialele neurmărite: decide dacă ți se oferă butonul de urmărire.",
        ],
        icon: <RefreshCw className="h-3.5 w-3.5 text-emerald-400" />,
      },
      {
        title: "Detalii filme",
        cadence: "la 12h",
        summary: "Titlul românesc și cel original, anul, descrierea, genurile și posterul.",
        points: [
          "După aceeași regulă ca la seriale: cerute în română, cu engleza ca rezervă până apare traducerea.",
        ],
        icon: <Clapperboard className="h-3.5 w-3.5 text-purple-400" />,
      },
      {
        title: "Filme așteptate",
        cadence: "la 12h / film",
        summary: "Filme cerute care încă nu existau pe Filelist la calitatea vrută.",
        points: [
          "Cadență mai lentă decât la seriale, fiindcă un film poate întârzia luni de zile.",
          "Înainte de data lansării nici nu se caută — n-ar avea ce găsi.",
          "Prima verificare face excepție: vine la un minut după adăugare, pe o buclă proprie de 30s.",
          "Calitatea de rezervă funcționează ca la seriale.",
          "Spre deosebire de seriale, urmărirea unui film se stinge singură la prima descărcare reușită.",
        ],
        icon: <Film className="h-3.5 w-3.5 text-amber-400" />,
      },
    ],
    icon: <Orb state="searching" />,
    activityType: null,
  },
  {
    id: "plex-session-tracker",
    label: "Plex Session Tracker",
    description: "Urmărire sesiuni & vizionări",
    cadence: "la 30s",
    details:
      "Întreabă Plex ce se redă chiar acum și scrie în jurnal începutul și sfârșitul fiecărei vizionări. De aici vin secțiunea „Se vizionează acum” de pe Acasă și istoricul „cine a văzut” din Bibliotecă.",
    icon: <PlayCircle className="h-4 w-4 text-amber-400" />,
    activityType: "plex_watch_start",
  },
  {
    id: "plex-link-reconciler",
    label: "Reconciliere Plex",
    description: "Leagă descărcările rămase fără Plex",
    cadence: "la 10 min",
    details:
      "Un titlu descărcat complet, dar prins de un restart înainte ca Plex să-l indexeze, rămâne fără plex_rating_key — adică blocat pe „se procesează” la nesfârșit. Plugin-ul reia legarea pentru toate rândurile rămase așa. Nu atinge Plex decât dacă chiar există ceva nelegat.",
    icon: <Link2 className="h-4 w-4 text-emerald-400" />,
    activityType: null,
  },
  {
    id: "filelist-resume",
    label: "Reluare Descărcări",
    description: "Repornește polling-ul întrerupt de un restart",
    cadence: "la pornire (după 15s)",
    details:
      "Fiecare descărcare are o buclă de urmărire care trăiește în proces; un restart o omoară. Fără reluare, torrentul se termină în qBittorrent, dar aplicația nu află niciodată: fără subtitrare RO, fără completed_at, fără notificare, fără legare la Plex. A existat cândva ca efect secundar de modul și a încetat silențios să mai ruleze când modulul a devenit import leneș — de-aia e plugin explicit acum.",
    icon: <RotateCcw className="h-4 w-4 text-blue-400" />,
    activityType: null,
  },
  {
    id: "github-commit-tracker",
    label: "GitHub Commit Tracker",
    description: "Sincronizare commit-uri din GitHub",
    cadence: "la pornire (după 6s)",
    details:
      "Aduce ultimele commit-uri din GitHub și trimite notificare pentru cele noi față de ce e în DB. Acoperă cazul în care webhook-ul a picat exact în timpul unui restart.",
    icon: <GitCommitHorizontal className="h-4 w-4 text-purple-400" />,
    activityType: null,
  },
  {
    id: "db-backup",
    label: "Backup Bază de Date",
    description: "Copie zilnică a bazei, cu rotație",
    cadence: "la pornire (după 90s), apoi la 24h",
    details:
      "Baza ține tot ce știe aplicația — bibliotecă, conturi, jurnal, abonamente push — și până acum nu exista niciun backup: nici script, nici cron. Un disc mort sau o migrare greșită însemna pierdere totală.\n\nCopierea se face cu VACUUM INTO, nu cu o copiere de fișier: baza rulează în mod WAL, deci un `cp` poate prinde un .db fără tranzacțiile încă necheckpoint-ate și poate da o copie coruptă. Se păstrează ultimele 14 copii.\n\nO copie se face doar dacă cea mai recentă e mai veche de 20h — altfel o zi cu cinci deploy-uri ar face cinci copii identice și ar împinge afară din rotație istoricul chiar util. Copiile stau lângă bază, pe același disc: te apără de o stricăciune logică, nu de un disc mort.",
    icon: <DatabaseBackup className="h-4 w-4 text-teal-400" />,
    activityType: null,
  },
  {
    id: "activity-boot",
    label: "Jurnal Pornire/Oprire",
    description: "Înregistrează ciclul de viață al serverului",
    cadence: "la pornire",
    details:
      "Logarea pornirii/opririi rula ca efect secundar de modul, deci se executa abia la prima cerere HTTP: după un restart, jurnalul rămânea gol până deschidea cineva aplicația, iar atunci „Serverul a pornit” se scria cu ora greșită și cu cauza greșită. Dacă serviciul era oprit înainte de vreo cerere, oprirea nu se loga deloc.",
    icon: <PlugZap className="h-4 w-4 text-sky-400" />,
    activityType: "server_start",
  },
  {
    id: "fast-shutdown",
    label: "Oprire Controlată",
    description: "Închide curat la SIGTERM, înainte de SIGKILL",
    cadence: "la oprire",
    details:
      "Fără el, oprirea aștepta drenarea tuturor conexiunilor HTTP — inclusiv SSE-ul de auto-reload, deschis cât timp orice tab are dashboard-ul deschis. Asta depășea mereu TimeoutStopSec=5, iar systemd termina procesul cu SIGKILL, fără nicio șansă pentru logarea opririi. Aici dăm celorlalte listenere o fereastră scurtă, apoi ieșim controlat.",
    icon: <Power className="h-4 w-4 text-rose-400" />,
    activityType: "server_stop",
  },
];

// Pe pagina Immich, nu în lista din Tehnic — vezi nota de la începutul
// fișierului.
export const IMMICH_UPLOAD_PLUGIN: PluginInfo = {
  id: "immich-upload-tracker",
  label: "Urmărire Încărcări",
  description: "Trece în jurnal pozele și clipurile încărcate",
  cadence: "la 5 min (prima, la 1 min după pornire)",
  details:
    "Întreabă Immich ce s-a încărcat de la ultima verificare și scrie în Jurnalul de activitate câte fotografii și videoclipuri a încărcat fiecare utilizator, cu notificare push. O încărcare întreagă devine o singură intrare: se scrie când o verificare nu mai găsește nimic nou, deci apare în jurnal la cel mult ~10 minute după ce se termină. Un Live Photo se numără o dată, ca în galerie.\n\nPunctul de plecare stă în baza de date, așa că o repornire a serverului nu pierde nimic — verificarea următoare continuă de unde a rămas. Varianta veche rula doar cât era deschisă pagina Immich și pornea de la zero la fiecare repornire: în septembrie 2026, 285 de încărcări într-o lună, zero intrări în jurnal.",
  icon: <Upload className="h-4 w-4 text-purple-400" />,
  activityType: "immich_upload",
};
