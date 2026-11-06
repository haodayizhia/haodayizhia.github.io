(() => {
  const html = document.documentElement;
  const button = document.querySelector('button[data-theme]');
  function apply() {
    const dark = html.dataset.theme === 'dark';
    html.style.colorScheme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]').content = dark ? '#03070d' : '#eef3fc';
    button.setAttribute('aria-label', dark ? '切换至日间模式' : '切换至夜间模式');
    button.setAttribute('aria-pressed', String(dark));
    button.title = dark ? '点击自转，切换日间' : '点击自转，切换夜间';
    window.dispatchEvent(new CustomEvent('bro:themechange', {detail:{dark}}));
  }
  button.addEventListener('click', () => {
    html.dataset.theme = html.dataset.theme === 'dark' ? 'light' : 'dark';
    try {sessionStorage.setItem('bro-theme', html.dataset.theme);} catch (_) {}
    apply();
  });
  apply();
  requestAnimationFrame(() => requestAnimationFrame(() => html.classList.add('theme-ready')));
})();
