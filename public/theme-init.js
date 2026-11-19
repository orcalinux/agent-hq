try {
  var saved = JSON.parse(localStorage.getItem('agent-hq.state') || '{}');
  var pref = (saved.state && saved.state.themePreference) || 'system';
  var mode = pref === 'system' ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : pref;
  document.documentElement.setAttribute('data-theme', mode);
} catch (e) {}
