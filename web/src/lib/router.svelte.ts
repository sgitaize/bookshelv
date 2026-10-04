/** Minimaler Client-Router: History-API, Pfadmuster wie "/book/:id". */

class Router {
  path = $state(location.pathname);
  query = $state(new URLSearchParams(location.search));

  constructor() {
    // Scrollposition je Verlaufseintrag selbst merken: Seiten laden ihre Daten erst nach dem Wechsel,
    // die automatische Wiederherstellung des Browsers käme zu früh (Seite noch zu kurz)
    history.scrollRestoration = 'manual';
    addEventListener('popstate', e => { this.sync(); this.restore(e.state?.y ?? 0); });
    // interne Links abfangen, damit kein Seiten-Reload passiert
    document.addEventListener('click', e => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element).closest('a');
      if (!a || a.target || a.hasAttribute('download') || a.origin !== location.origin) return;
      e.preventDefault();
      this.go(a.pathname + a.search + a.hash);
    });
  }

  private sync() {
    this.path = location.pathname;
    this.query = new URLSearchParams(location.search);
  }

  go(to: string, replace = false) {
    const [target, hash] = to.split('#');
    // gleiche Seite, nur andere Sprungmarke → nur scrollen
    if (target === location.pathname + location.search) {
      if (hash) { history.replaceState({}, '', to); document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth' }); }
      return;
    }
    if (!replace) history.replaceState({ ...history.state, y: scrollY }, '');
    history[replace ? 'replaceState' : 'pushState']({}, '', to);
    this.sync();
    scrollTo({ top: 0 });
  }

  /** Scrollt zurück, sobald die Seite hoch genug ist (max. 4 s); eigenes Scrollen bricht ab. */
  private restore(y: number) {
    const stop = () => { done = true; };
    let done = false;
    const opts = { once: true, passive: true } as const;
    addEventListener('wheel', stop, opts); addEventListener('touchstart', stop, opts); addEventListener('keydown', stop, opts);
    const t0 = performance.now();
    const tick = () => {
      if (done) return;
      const max = document.documentElement.scrollHeight - innerHeight;
      scrollTo({ top: Math.min(y, Math.max(0, max)) });
      if (max >= y || performance.now() - t0 > 4000) done = true;
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  back(fallback = '/') {
    if (history.length > 1) history.back();
    else this.go(fallback, true);
  }

  match(pattern: string): Record<string, string> | null {
    const p = pattern.split('/'), a = this.path.split('/');
    if (p.length !== a.length) return null;
    const params: Record<string, string> = {};
    for (let i = 0; i < p.length; i++) {
      if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(a[i]);
      else if (p[i] !== a[i]) return null;
    }
    return params;
  }
}

export const router = new Router();
