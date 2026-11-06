// Night is the default. Keep a manual choice during navigation in this tab;
// reloading starts in night mode again. Never consult the device theme.
(() => {
  let mode = null;
  try {
    if (performance.getEntriesByType('navigation')[0]?.type === 'reload') sessionStorage.removeItem('bro-theme');
    mode = sessionStorage.getItem('bro-theme');
  } catch (_) {}
  const dark = mode !== 'light';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]').content = dark ? '#03070d' : '#eef3fc';
})();
