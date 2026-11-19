try {
  var saved = JSON.parse(localStorage.getItem('agent-hq.state') || '{}');
  document.documentElement.setAttribute('data-theme', (saved.state && saved.state.themeMode) || 'dark');
} catch (e) {}
