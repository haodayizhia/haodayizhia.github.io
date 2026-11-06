(() => {
  'use strict';
  const html = document.documentElement;
  const button = document.querySelector('button[data-theme]');
  if (!button) return;
  function updateButton() {
    const dark = html.dataset.theme === 'dark';
    button.setAttribute('aria-label', dark ? '切换至日间模式' : '切换至夜间模式');
    button.setAttribute('aria-pressed', String(dark));
    button.title = dark ? '点击自转，切换日间' : '点击自转，切换夜间';
  }
  button.addEventListener('click', () => {
    const value = html.dataset.theme === 'dark' ? 'light' : 'dark';
    if (window.BRO_THEME) window.BRO_THEME.set(value);
    else {
      // Keep the control usable if a cached page still loaded the older head script.
      html.dataset.theme = value;
      html.style.colorScheme = value;
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.content = value === 'dark' ? '#03070d' : '#eef3fc';
      for (const name of ['localStorage', 'sessionStorage']) {
        try { window[name].setItem('bro-theme', value); } catch (_) {}
      }
      window.dispatchEvent(new CustomEvent('bro:themechange', {detail:{dark:value === 'dark'}}));
    }
    updateButton();
  });
  window.addEventListener('bro:themechange', updateButton);
  updateButton();
  requestAnimationFrame(() => requestAnimationFrame(() => html.classList.add('theme-ready')));
})();
