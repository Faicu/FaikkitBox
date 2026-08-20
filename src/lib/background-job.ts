// ---------------------------------------------------------------------------
// Stare la nivel de modul pentru un job de fundal (backfill media, backfill
// subtitrări etc.) — un singur job rulează odată, urmărit prin polling din UI
// (running/progress/lastResult), nu printr-un request HTTP ținut deschis
// minute întregi (tăiat în practică de reverse-proxy/browser pe rulări lungi).
// Extras dintr-o duplicare aproape identică între media-backfill.ts și
// filelist/download.ts — un singur loc pentru pornire/idle-check/progres.
// ---------------------------------------------------------------------------

export interface BackgroundJobState<TProgress, TResult> {
  running: boolean;
  progress: TProgress | null;
  lastResult: TResult | null;
}

export class BackgroundJob<TProgress, TResult> {
  private running = false;
  private progress: TProgress | null = null;
  private lastResult: TResult | null = null;

  isRunning(): boolean {
    return this.running;
  }

  // `lastResult` se ascunde cât timp rulează — un client care face polling
  // nu trebuie să distingă "rezultatul rulării anterioare" de "rulare curentă
  // încă neterminată".
  getState(): BackgroundJobState<TProgress, TResult> {
    return {
      running: this.running,
      progress: this.progress,
      lastResult: this.running ? null : this.lastResult,
    };
  }

  setProgress(progress: TProgress | null): void {
    this.progress = progress;
  }

  // Pornește `work` în fundal fără await — apelantul (server function)
  // răspunde imediat, rezultatul se urmărește separat prin getState().
  // Întoarce false fără să pornească nimic dacă deja rulează un job.
  start(work: () => Promise<TResult>): boolean {
    if (this.running) return false;
    this.running = true;
    this.progress = null;
    this.lastResult = null;
    void this.run(work);
    return true;
  }

  // Echivalentul de mai sus, dar așteaptă finalizarea și întoarce rezultatul
  // — pentru cod care rulează deja în fundal (ex. plugin periodic), nu din
  // spatele unui server function apelat direct din UI. Întoarce null fără
  // să pornească nimic dacă deja rulează un job.
  async runIfIdle(work: () => Promise<TResult>): Promise<TResult | null> {
    if (this.running) return null;
    this.running = true;
    this.progress = null;
    this.lastResult = null;
    await this.run(work);
    return this.lastResult;
  }

  private async run(work: () => Promise<TResult>): Promise<void> {
    try {
      this.lastResult = await work();
    } finally {
      this.progress = null;
      this.running = false;
    }
  }
}
