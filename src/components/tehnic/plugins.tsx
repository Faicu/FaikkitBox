import type { ReactNode } from "react";
import {
  PlayCircle,
  Link2,
  RotateCcw,
  Power,
  PlugZap,
  DatabaseBackup,
  Upload,
  Wrench,
  ArrowUpCircle,
  Bug,
  Tv,
  RefreshCw,
  Clapperboard,
  Film,
  Star,
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
    details:
      "Face patru lucruri la fiecare tic, fiecare cu ritmul lui, în ordinea de mai jos: întâi descărcările, apoi detaliile. Un pas care eșuează nu-i oprește pe ceilalți.",
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
    id: "download-recovery",
    label: "Continuitate Descărcări",
    description: "Reia descărcările și legarea la Plex întrerupte de un restart",
    cadence: "la pornire (după 15s și 45s), apoi la 10 min",
    details:
      "O descărcare e urmărită de o buclă care trăiește în proces, iar după terminare tot ea o leagă la Plex, timp de 30 de minute. Un restart le omoară pe amândouă — și fiecare deploy repornește serviciul. Două plase de siguranță, pentru cele două momente în care te poate prinde restartul.",
    steps: [
      {
        title: "Reluare descărcări",
        cadence: "la pornire (după 15s)",
        summary: "Repornește urmărirea descărcărilor încă neterminate.",
        points: [
          "Fără ea, torrentul se termină în qBittorrent, dar aplicația nu află niciodată: fără subtitrare RO, fără completed_at, fără notificare, fără legare la Plex.",
          "A existat cândva ca efect secundar de modul și a încetat silențios să mai ruleze când modulul a devenit import leneș — de-aia e plugin explicit acum.",
        ],
        icon: <RotateCcw className="h-3.5 w-3.5 text-blue-400" />,
      },
      {
        title: "Reconciliere Plex",
        cadence: "după 45s, apoi la 10 min",
        summary: "Leagă la Plex titlurile descărcate, dar rămase nelegate.",
        points: [
          "Un titlu terminat, dar prins de un restart înainte ca Plex să-l indexeze, rămâne fără plex_rating_key — adică blocat pe „se procesează” la nesfârșit.",
          "Reîncearcă pentru tot ce s-a terminat în ultimele 72h și n-are încă legătură. Nu atinge Plex decât dacă chiar există ceva nelegat.",
          "Completează și calitatea filmelor legate corect, dar la care nu s-a putut decide care versiune din Plex e a noastră.",
          "Pornește la 30s după reluare: fiecare parte lucrează pe alte rânduri (neterminate vs. terminate), iar distanța le ține separate și la pornire.",
        ],
        icon: <Link2 className="h-3.5 w-3.5 text-emerald-400" />,
      },
    ],
    icon: <Link2 className="h-4 w-4 text-emerald-400" />,
    activityType: null,
  },
  {
    id: "maintenance",
    label: "Întreținere",
    description:
      "Backup zilnic al bazei, verificarea actualizărilor, rating-uri IMDb, deblocarea acțiunilor",
    cadence: "la pornire, apoi zilnic",
    details:
      "Patru treburi de întreținere, fiecare cu ritmul ei. Una care eșuează nu le oprește pe celelalte.",
    steps: [
      {
        title: "Deblocare acțiuni",
        cadence: "la pornire",
        summary: "Închide acțiunile Restart/Update rămase „în curs” după o repornire.",
        points: [
          "Dacă aplicația repornește în timpul unei acțiuni, acțiunea moare odată cu ea, dar în baza de date ar rămâne „în curs” și ar bloca toate butoanele pe veci, cu „rulează deja”.",
          "O marchează „întreruptă” și scrie asta în jurnal.",
        ],
        icon: <Wrench className="h-3.5 w-3.5 text-orange-400" />,
      },
      {
        title: "Backup bază de date",
        cadence: "zilnic (verificat din oră în oră)",
        summary: "Copie a bazei, cu rotație la ultimele 14.",
        points: [
          "Baza ține tot ce știe aplicația — bibliotecă, conturi, jurnal, abonamente push. Înainte nu exista niciun backup: un disc mort sau o migrare greșită însemna pierdere totală.",
          "Copia se face cu VACUUM INTO, nu cu o copiere de fișier: baza rulează în mod WAL, deci un `cp` poate prinde un .db fără tranzacțiile încă necheckpoint-ate și poate da o copie coruptă.",
          "O copie se face doar dacă cea mai recentă e mai veche de 23h — altfel o zi cu cinci deploy-uri ar face cinci copii identice și ar împinge afară din rotație istoricul chiar util.",
          "Ceasul e data ultimei copii de pe disc, verificată din oră în oră, deci deploy-urile nu-l resetează. Înainte, un interval de 24h pornit la fiecare repornire lăsa uneori până la 41h între copii.",
          "Copiile stau lângă bază, pe același disc: te apără de o stricăciune logică, nu de un disc mort.",
        ],
        icon: <DatabaseBackup className="h-3.5 w-3.5 text-teal-400" />,
      },
      {
        title: "Actualizări disponibile",
        cadence: "la 24h (verificat din oră în oră)",
        summary: "Plex (beta), Immich, pachete Ubuntu și cererea de repornire.",
        points: [
          "Aceleași verificări ca butoanele Update. Dacă găsește ceva, scrie o intrare în jurnal (filtrul Updates) și trimite o notificare push cu tot ce e disponibil.",
          "Reamintirea e zilnică: cât timp ceva rămâne neinstalat, apare din nou a doua zi.",
          "Momentul ultimei verificări stă în baza de date, așa că deploy-urile dese nu resetează ceasul; dacă nicio verificare nu reușește (fără rețea), se reîncearcă peste o oră.",
        ],
        icon: <ArrowUpCircle className="h-3.5 w-3.5 text-sky-400" />,
      },
      {
        title: "Rating-uri IMDb",
        cadence: "zilnic (verificat din oră în oră)",
        summary: "Descarcă datasetul oficial IMDb cu notele și numărul de voturi.",
        points: [
          "Grilele din Descoperă afișau nota TMDB, care diferă vizibil de cea de pe IMDb. Acum afișează nota și voturile IMDb.",
          "Sursa e title.ratings.tsv.gz de la IMDb (~1,7 milioane de titluri), regenerat de IMDb zilnic — cifrele au cel mult o zi întârziere.",
          "Stă într-o bază separată, data/imdb-ratings.db (~35 MB), ca să nu umfle backup-urile: se poate reface oricând din dataset.",
          "Importul scrie un fișier nou și îl mută peste cel vechi abia la final; dacă datasetul nu s-a schimbat (același ETag), nu se descarcă nimic.",
        ],
        icon: <Star className="h-3.5 w-3.5 text-amber-400" />,
      },
    ],
    icon: <Wrench className="h-4 w-4 text-orange-400" />,
    // Rândul arată ultimul backup sau ultima actualizare anunțată, care e mai
    // recentă — vezi PluginStatusSection.
    activityType: "update_available",
  },
  {
    id: "server-lifecycle",
    label: "Pornire și Oprire",
    description: "Jurnalul pornirilor/opririlor, oprire curată, captura erorilor",
    cadence: "la pornire și la oprire",
    details: "Tot ce ține de procesul serverului în sine, nu de vreun serviciu.",
    steps: [
      {
        title: "Jurnal pornire/oprire",
        cadence: "la pornire",
        summary: "Scrie în jurnal fiecare pornire și oprire, cu cauza ei.",
        points: [
          "Rula ca efect secundar de modul, deci se executa abia la prima cerere HTTP: după un restart, jurnalul rămânea gol până deschidea cineva aplicația, iar atunci „Serverul a pornit” se scria cu ora greșită și cu cauza greșită.",
          "Dacă serviciul era oprit înainte de vreo cerere, oprirea nu se loga deloc.",
        ],
        icon: <PlugZap className="h-3.5 w-3.5 text-sky-400" />,
      },
      {
        title: "Oprire controlată",
        cadence: "la oprire",
        summary: "Închide curat la SIGTERM, înainte ca systemd să dea SIGKILL.",
        points: [
          "Fără ea, oprirea aștepta drenarea tuturor conexiunilor HTTP — inclusiv SSE-ul de auto-reload, deschis cât timp orice tab are dashboard-ul deschis.",
          "Asta depășea mereu TimeoutStopSec=5, iar systemd termina procesul cu SIGKILL, fără nicio șansă pentru logarea opririi. Acum logarea are o fereastră scurtă, apoi procesul iese controlat.",
        ],
        icon: <Power className="h-3.5 w-3.5 text-rose-400" />,
      },
      {
        title: "Captura erorilor",
        cadence: "la pornire",
        summary: "Trimite erorile și avertismentele din consolă în „Erori aplicație”.",
        points: [
          "Prinde tot ce ajunge în console.error/console.warn pe server — server functions și plugin-uri de fundal — nu doar ce e logat explicit.",
        ],
        icon: <Bug className="h-3.5 w-3.5 text-amber-400" />,
      },
    ],
    icon: <PlugZap className="h-4 w-4 text-sky-400" />,
    activityType: "server_start",
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
