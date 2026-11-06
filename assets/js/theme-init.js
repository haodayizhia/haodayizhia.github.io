// Apply the saved choice before styles and content paint. Night is the default
// only when the visitor has not chosen a theme.
(() => {
  'use strict';
  const key = 'bro-theme';
  const html = document.documentElement;
  const valid = value => value === 'light' || value === 'dark';
  function stored(name) {
    try {
      const value = window[name].getItem(key);
      return valid(value) ? value : null;
    } catch (_) { return null; }
  }
  function cookie() {
    try {
      const item = document.cookie.split(';').map(part => part.trim()).find(part => part.startsWith(key + '='));
      const value = item ? decodeURIComponent(item.slice(key.length + 1)) : null;
      return valid(value) ? value : null;
    } catch (_) { return null; }
  }
  function read() {
    return stored('localStorage') || cookie() || stored('sessionStorage');
  }
  function persist(value) {
    for (const name of ['localStorage', 'sessionStorage']) {
      try { window[name].setItem(key, value); }
      catch (_) {
        // A quota failure must not leave an older choice ahead of the fallback.
        try { window[name].removeItem(key); } catch (_) {}
      }
    }
    try {
      document.cookie = key + '=' + value + '; Path=/; Max-Age=31536000; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '');
    } catch (_) {}
  }
  const saved = read();
  let mode = saved || 'dark';
  function apply(value, instant = false) {
    const changed = html.dataset.theme !== value;
    const restoreTransitions = instant && html.classList.contains('theme-ready');
    if (restoreTransitions) html.classList.remove('theme-ready');
    mode = value;
    html.dataset.theme = value;
    html.style.colorScheme = value;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = value === 'dark' ? '#03070d' : '#eef3fc';
    if (changed) window.dispatchEvent(new CustomEvent('bro:themechange', {detail:{dark:value === 'dark'}}));
    if (restoreTransitions) requestAnimationFrame(() => requestAnimationFrame(() => html.classList.add('theme-ready')));
  }
  function sync(instant = false) { apply(read() || mode, instant); }
  window.BRO_THEME = {
    get: () => mode,
    set(value) { if (valid(value)) { persist(value); apply(value); } },
    sync,
  };
  // Migrate the previous tab-only preference without resetting it on reload.
  if (saved) persist(saved);
  apply(mode);
  window.addEventListener('pageshow', () => sync(true));
  window.addEventListener('storage', event => { if (event.key === key || event.key === null) sync(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(true); });
})();
