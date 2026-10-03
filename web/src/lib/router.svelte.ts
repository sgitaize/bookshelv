/** Minimaler Client-Router: History-API, Pfadmuster wie "/book/:id". */

class Router {
  path = $state(location.pathname);
  query = $state(new URLSearchParams(location.search));

  constructor() {
    addEventListener('popstate', () => this.sync());
    // interne Links abfangen, damit kein Seiten-Reload passiert
    document.addEventListener('click', e => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element).closest('a');
      if (!a || a.target || a.hasAttribute('download') || a.origin !== location.origin) return;
      e.preventDefault();
      this.go(a.pathname + a.search);
    });
  }

  private sync() {
    this.path = location.pathname;
    this.query = new URLSearchParams(location.search);
  }

  go(to: string, replace = false) {
    if (to === location.pathname + location.search) return;
    history[replace ? 'replaceState' : 'pushState']({}, '', to);
    this.sync();
    scrollTo({ top: 0 });
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
