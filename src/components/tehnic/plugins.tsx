import type { ReactNode } from "react";
import {
  PlayCircle,
  Download,
  DatabaseBackup,
  Upload,
  Wrench,
  ArrowUpCircle,
  Tv,
  Star,
  Captions,
  Trash2,
  Radar,
  Sparkles,
} from "lucide-react";

// Catalogul Watcher-ului din Tehnic → „Plugin-uri active”: iconița și
// explicațiile. Ritmul sarcinilor vine de la server, din registru
// (src/lib/watcher/tasks.ts). Celălalt plugin de pe server, server-lifecycle
// (pornirea și oprirea procesului), nu mai apare în Tehnic: nu are nimic de
// urmărit sau de controlat.
export const WATCHER_PLUGIN = {
  label: "Watcher",
  details:
    "Un singur tact, la fiecare secundă, care pornește sarcinile de fundal când le vine rândul. Fiecare rulează ca operațiune separată, deci una lentă nu le ține pe loc pe celelalte; două sarcini din același grup (căutările pe Filelist) nu rulează niciodată deodată. Cadențele per titlu — serialul la 3 ore, subtitrarea o dată pe zi — stau în baza de date, iar sarcina decide singură ce e scadent, deci o rulare în plus nu strică nimic.",
  icon: <Radar className="h-4 w-4 text-sky-400" />,
};

// Explicația fiecărei sarcini, după id-ul din src/lib/watcher/tasks.ts. Un id
// nou fără intrare aici apare oricum în listă, doar fără explicație.
interface WatcherTaskInfo {
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
      "Începutul unei vizionări apare în cel mult 10 secunde. Oprirea, abia după două verificări la rând fără ea (10–20 de secunde): Plex „pierde” uneori o sesiune pentru o clipă, la derulare, iar o singură lipsă ar da o oprire falsă, cu două notificări.",
      "Cât Plex e oprit sau nu răspunde, sesiunile rămân cum erau — nu se închid pe baza unei erori.",
    ],
    icon: <PlayCircle className="h-3.5 w-3.5 text-amber-400" />,
  },
  downloads: {
    summary: "Urmărește descărcările până la final și le leagă la Plex.",
    points: [
      "O singură cerere către qBittorrent pentru toate descărcările neterminate pornite din aplicație.",
      "Un torrent terminat primește ID-ul IMDb în numele fișierelor, notificarea, subtitrarea română și refresh-ul Plex. Partea asta rulează separat, deci o subtitrare care durează minute nu le ține pe loc pe celelalte.",
      "Leagă titlul la Plex: în primele 30 de minute după terminare la fiecare rulare, apoi la 10 minute, până la 72h. Ce rămâne nelegat (Plex oprit, scanare întârziată) ar sta altfel blocat pe „se procesează”. Completează și calitatea filmelor la care nu s-a putut decide care versiune din Plex e a noastră.",
      "Ritmul: la 10 secunde cât se descarcă, se finalizează sau se leagă ceva; la 10 minute cât rămân doar titluri nelegate mai vechi; altfel doarme. O descărcare nouă o trezește imediat, iar o verificare din oră în oră rămâne plasă de siguranță.",
      "Urmărește o descărcare cel mult 14 zile de la adăugare.",
      "Totul se citește din baza de date, deci un restart nu întrerupe nimic. Înainte, fiecare descărcare avea propria buclă în memorie, pe care fiecare deploy o omora.",
    ],
    icon: <Download className="h-3.5 w-3.5 text-blue-400" />,
  },
  "scheduled-delete": {
    summary:
      "Șterge titlurile cerute spre ștergere în primele 48 h de la finalizarea descărcării, la împlinirea lor.",
    points: [
      "Filelist consideră hit and run un torrent șters prea repede după descărcare. Cererea se acceptă, dar ștergerea se programează la 48 h de la finalizarea descărcării. Cerută cât torrentul încă se descarcă, așteaptă finalizarea și abia atunci își primește termenul.",
      "Până atunci torrentul continuă să se descarce și să facă seed, iar titlul apare în Bibliotecă cu un timer. Oricine poate renunța la ștergere și devine astfel proprietarul titlului. Adminul poate ocoli programarea cu „Șterge acum”.",
      "Rulează exact la termenul celei mai apropiate ștergeri; fără nimic programat doarme, iar o programare nouă o trezește. Termenul stă în baza de date: o ștergere ratată cât serverul a fost oprit se face la pornirea următoare.",
      "Un torrent care tocmai s-a terminat și își primește încă subtitrarea, sau o ștergere eșuată, se reîncearcă peste un minut.",
      "Programarea, renunțarea și ștergerea efectivă apar în jurnal (filtrul Torrente), fără notificare push.",
    ],
    icon: <Trash2 className="h-3.5 w-3.5 text-red-400" />,
  },
  "show-watch": {
    summary: "Episoadele noi și filmele așteptate de pe Filelist, plus detaliile din TMDB.",
    points: [
      "Sarcina pornește la 10 minute, dar verifică doar ce e scadent: fiecare serial la 3h (la 1h în ziua lansării ±1 zi), fiecare film la 12h, detaliile fiecărui titlu la 12h.",
      "Episoade noi: compară ce s-a difuzat (TMDB, inclusiv episodul lansat azi) cu ce ai deja și aduce diferența, căutând strict după IMDb ID, fără cache.",
      "Nu ține minte ce a văzut ultima dată: întreabă de fiecare dată realitatea, deci se poate relua oricând și nu poate descărca de două ori. După fiecare descărcare, poziția de start avansează peste episoadele aduse, ca un episod văzut și șters să nu revină.",
      "Filme așteptate: înainte de data lansării nici nu se caută; urmărirea se stinge singură la prima descărcare reușită. Un film abia adăugat e căutat prima dată la un minut după adăugare — destul cât să nu repete căutarea tocmai făcută în wizard.",
      "Calitatea de rezervă se ia doar când principala lipsește la două verificări, la cel puțin 3 ore distanță.",
      "Detalii seriale și filme: status, titlurile română/original, anul, descrierea, genurile, posterul, episoadele — cerute în română, cu engleza ca rezervă. Statusul contează și la serialele neurmărite: decide dacă ți se oferă butonul de urmărire.",
      "În istoric apar descărcările pornite și actualizările de detalii. Lângă fiecare serial și film urmărit vezi ce a găsit ultima verificare.",
      "Un pas eșuat sau o eroare la un titlu (Filelist, descărcare) nu le oprește pe celelalte; rularea apare atunci ca eșuată, cu pasul sau titlul în mesaj, iar ce a apucat să pornească rămâne în istoric.",
      "Pornirea urmăririi unui serial îl verifică imediat, nu la următorul ciclu de 10 minute.",
    ],
    icon: <Tv className="h-3.5 w-3.5 text-blue-400" />,
  },
  "immich-uploads": {
    summary: "Pozele și clipurile încărcate în Immich, trecute în jurnal.",
    points: [
      "Scrie câte fotografii și videoclipuri a încărcat fiecare utilizator, cu notificare push. O încărcare întreagă devine o singură intrare: se scrie când o verificare nu mai găsește nimic nou, deci apare în jurnal la cel mult ~4 minute după ce se termină. Un Live Photo se numără o dată, ca în galerie.",
      "Punctul de plecare stă în baza de date, așa că o repornire nu pierde nimic. Varianta veche rula doar cât era deschisă pagina Immich: în septembrie 2026, 285 de încărcări într-o lună, zero intrări în jurnal.",
    ],
    icon: <Upload className="h-3.5 w-3.5 text-purple-400" />,
  },
  "db-backup": {
    summary: "Copie zilnică a bazei, cu rotație la ultimele 14.",
    points: [
      "Baza ține tot ce știe aplicația — bibliotecă, conturi, jurnal, abonamente push.",
      "Copia se face cu VACUUM INTO, nu cu o copiere de fișier: baza rulează în mod WAL, deci un `cp` poate da o copie coruptă.",
      "O copie la 23h după cea mai recentă de pe disc — Watcher-ul o programează exact atunci, iar deploy-urile nu resetează ceasul. „Rulează acum” face copia oricum; un backup eșuat se reîncearcă peste o oră.",
      "Copiile stau lângă bază, pe același disc: te apără de o stricăciune logică, nu de un disc mort.",
    ],
    icon: <DatabaseBackup className="h-3.5 w-3.5 text-teal-400" />,
  },
  "imdb-ratings": {
    summary: "Datasetul oficial IMDb cu notele și voturile, pentru Descoperă.",
    points: [
      "Sursa e title.ratings.tsv.gz (~1,7 milioane de titluri), regenerat de IMDb zilnic. O verificare la 23h după cea precedentă; „Rulează acum” verifică oricum.",
      "Stă într-o bază separată, data/imdb-ratings.db (~35 MB), ca să nu umfle backup-urile.",
      "Dacă datasetul nu s-a schimbat (același ETag), nu se descarcă nimic.",
    ],
    icon: <Star className="h-3.5 w-3.5 text-amber-400" />,
  },
  "update-check": {
    summary: "Plex (beta), Immich, pachete Ubuntu și cererea de repornire.",
    points: [
      "Aceleași verificări ca butoanele Update. Dacă găsește ceva, scrie în jurnal (filtrul Updates) și trimite o notificare push.",
      "O dată la 24h, cu ceasul în baza de date; cât timp ceva rămâne neinstalat, reamintirea vine zilnic. „Rulează acum” verifică oricum.",
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

export const FALLBACK_TASK_ICON = <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />;
