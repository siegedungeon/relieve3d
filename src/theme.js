(() => {
  const key = 'relieve3d.theme';
  const normalize = value => value === 'dark' ? 'dark' : 'light';
  const apply = (value, persist = false) => {
    const theme = normalize(value);
    document.documentElement.dataset.theme = theme;
    const select = document.getElementById('themeSelect');
    if (select) select.value = theme;
    if (persist) {
      try { localStorage.setItem(key, theme); } catch { /* The current session still keeps its theme. */ }
    }
    window.dispatchEvent(new Event('r3d-theme-change'));
  };
  let saved;
  try { saved = localStorage.getItem(key); } catch { /* Storage can be unavailable in a browser. */ }
  apply(saved);
  document.addEventListener('DOMContentLoaded', () => {
    const select = document.getElementById('themeSelect');
    select.value = document.documentElement.dataset.theme;
    select.addEventListener('change', () => apply(select.value, true));
  });
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) apply(event.newValue);
  });
})();
