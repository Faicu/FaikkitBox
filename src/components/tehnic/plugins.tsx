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
  Film,
  Star,
  Captions,
  Trash2,
  Radar,
  Sparkles,
} from "lucide-react";

// Catalogul din Tehnic → „Plugin-uri active”. Pe server mai sunt doar două
// plugin-uri: Watcher-ul (toate sarcinile de fundal, sub un singur tact — vezi
// src/lib/watcher/) și server-lifecycle, care nu e o sarcină periodică, ci
// pornirea și oprirea procesului. Ritmul sarcinilor vine de la server, din
// registru; aici stă doar ce nu ține de rulare: iconița și explicația.
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
  // Tipul de intrare din jurnal care dovedește că a făcut ceva.
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

export const WATCHER_PLUGIN = {
  id: "watcher",
  label: "Watcher",
  details:
    "Un singur tact, la fiecare secundă, care pornește sarcinile de fundal când le vine rândul. Fiecare rulează ca operațiune separată, deci una lentă nu le ține pe loc pe celelalte; două sarcini din același grup (căutările pe Filelist) nu rulează niciodată deodată. Cadențele per titlu — serialul la 3 ore, subtitrarea o dată pe zi — stau în baza de date, iar sarcina decide singură ce e scadent, deci o rulare în plus nu strică nimic.",
  icon: <Radar className="h-4 w-4 text-sky-400" />,
};

// Explicația fiecărei sarcini, după id-ul din src/lib/watcher/tasks.ts. Un id
// nou fără intrare aici apare oricum în listă, doar fără explicație.
export interface WatcherTaskInfo {
  summary: string;
  points: string[];
  icon: ReactNode;
}

export const WATCHER_TASK_INFO: Record<string, WatcherTaskInfo> = {
  "interrupted-jobs": {
    summary: "Închide acțiunile Restart/Update rămase „în curs” după o repornire.",
    points: [
      "Dacă aplicația repornește în timpul unei acțiuni, acțiunea moare odată cu ea, dar în baza de date ar rămâne „în curs” și ar bloca toate butoanele pe veci, cu „rulează deja”.",
      "O marchează „întreruptă” și scrie asta în jurnal.",
      "Rulează doar la pornire: pornită manual, ar marca drept întreruptă o acțiune care chiar rulează acum.",
    ],
    icon: <Wrench className="h-3.5 w-3.5 text-orange-400" />,
  },
  "plex-sessions": {
    summary: "Ce se redă acum în Plex: începutul și sfârșitul fiecărei vizionări, în jurnal.",
    points: [
      "De aici vin secțiunea „Se vizionează acum” de pe Acasă și istoricul „cine a văzut” din Bibliotecă.",
      "Tot de aici se adună dovezile despre HDR-ul dispozitivelor (redare directă a unui fișier HDR).",
      "Cât Plex e oprit sau nu răspunde, sesiunile rămân cum erau — nu se închid pe baza unei erori.",
    ],
    icon: <PlayCircle className="h-3.5 w-3.5 text-amber-400" />,
  },
  "download-resume": {
    summary: "Repornește urmărirea descărcărilor încă neterminate după un restart.",
    points: [
      "O descărcare e urmărită de o buclă care trăiește în proces; un restart o omoară — și fiecare deploy repornește serviciul.",
      "Fără reluare, torrentul se termină în qBittorrent, dar aplicația nu află niciodată: fără subtitrare RO, fără completed_at, fără notificare, fără legare la Plex.",
      "A existat cândva ca efect secundar de modul și a încetat silențios să mai ruleze când modulul a devenit import leneș.",
    ],
    icon: <RotateCcw className="h-3.5 w-3.5 text-blue-400" />,
  },
  "scheduled-delete": {
    summary: "Șterge titlurile cerute spre ștergere în primele 24 h, la împlinirea lor.",
    points: [
      "Filelist consideră hit and run un torrent șters în primele 24 de ore de la descărcare. Cererea se acceptă, dar ștergerea se programează pentru împlinirea celor 24 h.",
      "Până atunci torrentul continuă să se descarce și să facă seed, iar titlul apare în Bibliotecă cu un timer. Oricine poate renunța la ștergere și devine astfel proprietarul titlului. Adminul poate ocoli programarea cu „Șterge acum”.",
      "Termenul stă în baza de date: o ștergere ratată cât serverul a fost oprit se face la pornirea următoare.",
      "Programarea, renunțarea și ștergerea efectivă apar în jurnal (filtrul Torrente), fără notificare push.",
    ],
    icon: <Trash2 className="h-3.5 w-3.5 text-red-400" />,
  },
  "show-watch": {
    summary: "Episoadele noi și filmele așteptate de pe Filelist, plus detaliile din TMDB.",
    points: [
      "Episoade noi, la 3h / serial (la 1h în ziua lansării ±1 zi): compară ce s-a difuzat (TMDB, inclusiv episodul lansat azi) cu ce ai deja și aduce diferența, căutând strict după IMDb ID, fără cache.",
      "Nu ține minte ce a văzut ultima dată: întreabă de fiecare dată realitatea, deci se poate relua oricând și nu poate descărca de două ori. După fiecare descărcare, poziția de start avansează peste episoadele aduse, ca un episod văzut și șters să nu revină.",
      "Filme așteptate, la 12h / film: înainte de data lansării nici nu se caută; urmărirea se stinge singură la prima descărcare reușită.",
      "Calitatea de rezervă se ia doar când principala lipsește la două verificări, la cel puțin 3 ore distanță.",
      "Detalii seriale și filme, la 12h: status, titlurile română/original, anul, descrierea, genurile, posterul, episoadele — cerute în română, cu engleza ca rezervă. Statusul contează și la serialele neurmărite: decide dacă ți se oferă butonul de urmărire.",
      "Un pas eșuat nu-i oprește pe ceilalți; rularea apare atunci ca eșuată, cu numele pasului.",
    ],
    icon: <Tv className="h-3.5 w-3.5 text-blue-400" />,
  },
  "new-movies": {
    summary: "Prima verificare a unui film abia adăugat, la un minut după adăugare.",
    points: [
      "Un singur SELECT care, în marea majoritate a cazurilor, nu întoarce nimic — de-aia poate rula des.",
      "Cât rulează „Seriale și filme”, așteaptă: ambele caută pe Filelist, iar căutările de fundal nu se fac niciodată deodată.",
    ],
    icon: <Film className="h-3.5 w-3.5 text-amber-400" />,
  },
  "plex-link": {
    summary: "Leagă la Plex titlurile descărcate, dar rămase nelegate.",
    points: [
      "Un titlu terminat, dar prins de un restart înainte ca Plex să-l indexeze, rămâne fără plex_rating_key — adică blocat pe „se procesează” la nesfârșit.",
      "Reîncearcă pentru tot ce s-a terminat în ultimele 72h și n-are încă legătură. Nu atinge Plex decât dacă chiar există ceva nelegat.",
      "Completează și calitatea filmelor legate corect, dar la care nu s-a putut decide care versiune din Plex e a noastră.",
    ],
    icon: <Link2 className="h-3.5 w-3.5 text-emerald-400" />,
  },
  "immich-uploads": {
    summary: "Pozele și clipurile încărcate în Immich, trecute în jurnal.",
    points: [
      "Scrie câte fotografii și videoclipuri a încărcat fiecare utilizator, cu notificare push. O încărcare întreagă devine o singură intrare: se scrie când o verificare nu mai găsește nimic nou, deci apare în jurnal la cel mult ~10 minute după ce se termină. Un Live Photo se numără o dată, ca în galerie.",
      "Punctul de plecare stă în baza de date, așa că o repornire nu pierde nimic. Varianta veche rula doar cât era deschisă pagina Immich: în septembrie 2026, 285 de încărcări într-o lună, zero intrări în jurnal.",
    ],
    icon: <Upload className="h-3.5 w-3.5 text-purple-400" />,
  },
  "db-backup": {
    summary: "Copie zilnică a bazei, cu rotație la ultimele 14.",
    points: [
      "Baza ține tot ce știe aplicația — bibliotecă, conturi, jurnal, abonamente push.",
      "Copia se face cu VACUUM INTO, nu cu o copiere de fișier: baza rulează în mod WAL, deci un `cp` poate da o copie coruptă.",
      "O copie se face doar dacă cea mai recentă e mai veche de 23h; ceasul e data ultimei copii de pe disc, deci deploy-urile nu-l resetează. „Rulează acum” face copia oricum.",
      "Copiile stau lângă bază, pe același disc: te apără de o stricăciune logică, nu de un disc mort.",
    ],
    icon: <DatabaseBackup className="h-3.5 w-3.5 text-teal-400" />,
  },
  "imdb-ratings": {
    summary: "Datasetul oficial IMDb cu notele și voturile, pentru Descoperă.",
    points: [
      "Sursa e title.ratings.tsv.gz (~1,7 milioane de titluri), regenerat de IMDb zilnic. Efectiv o dată la 23h; „Rulează acum” verifică oricum.",
      "Stă într-o bază separată, data/imdb-ratings.db (~35 MB), ca să nu umfle backup-urile.",
      "Dacă datasetul nu s-a schimbat (același ETag), nu se descarcă nimic.",
    ],
    icon: <Star className="h-3.5 w-3.5 text-amber-400" />,
  },
  "update-check": {
    summary: "Plex (beta), Immich, pachete Ubuntu și cererea de repornire.",
    points: [
      "Aceleași verificări ca butoanele Update. Dacă găsește ceva, scrie în jurnal (filtrul Updates) și trimite o notificare push.",
      "Efectiv o dată la 24h, cu ceasul în baza de date; cât timp ceva rămâne neinstalat, reamintirea vine zilnic. „Rulează acum” verifică oricum.",
      "Dacă nicio sursă nu răspunde (fără rețea), rularea apare eșuată și se reia peste o oră.",
    ],
    icon: <ArrowUpCircle className="h-3.5 w-3.5 text-sky-400" />,
  },
  "subtitle-retry": {
    summary: "Caută zilnic subtitrările care lipsesc, 14 zile de la descărcare.",
    points: [
      "Prima căutare, la finalul descărcării, vine exact când e cel mai puțin probabil să existe ceva: traducerile românești apar abia peste una-trei zile.",
      "Doar traduceri făcute de om, pe subs.ro și OpenSubtitles, pentru episodul exact (verificat după nume și după conținut), alese după sincronizare.",
      "O subtitrare aproximativă e înlocuită doar cu una sigur mai bună.",
      "Ceasul fiecărui titlu stă în baza de date, deci „Rulează acum” caută doar ce e scadent — OpenSubtitles are o limită de 20 de descărcări pe zi.",
      "Jurnal și push doar când pune o subtitrare.",
    ],
    icon: <Captions className="h-3.5 w-3.5 text-teal-400" />,
  },
};

export const SERVER_LIFECYCLE_PLUGIN: PluginInfo = {
  id: "server-lifecycle",
  label: "Pornire și Oprire",
  description: "Jurnalul pornirilor/opririlor, oprire curată, captura erorilor",
  cadence: "la pornire și la oprire",
  details:
    "Tot ce ține de procesul serverului în sine, nu de vreun serviciu — de-aia nu e o sarcină a Watcher-ului.",
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
        "Prinde tot ce ajunge în console.error/console.warn pe server — server functions și sarcinile Watcher-ului — nu doar ce e logat explicit.",
      ],
      icon: <Bug className="h-3.5 w-3.5 text-amber-400" />,
    },
  ],
  icon: <PlugZap className="h-4 w-4 text-sky-400" />,
  activityType: "server_start",
};

export const FALLBACK_TASK_ICON = <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />;
