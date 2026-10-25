// All pages share this shell. Keep page-specific data and status in <main>.
(() => {
  let flow = '';
  try { flow = localStorage.getItem('cei_flow') || ''; } catch {}
  if (!/^\?c=[A-Z]+&role=[a-z]+&q=[A-Za-z0-9%._~*+-]*$/.test(flow)) flow = '';
  const links = [
    ['/', 'Vet'],
    ['/brief.html', 'Reports', '/brief.html' + flow],
    ['/packs.html', 'Mentions'],
    ['/collection.html', 'Collection'],
    ['/results.html', 'Results']
  ];
  const path = location.pathname === '/index.html' ? '/' : location.pathname;
  const header = document.querySelector('.topbar');
  header.innerHTML = `
    <a class="wordmark" href="/" aria-label="Open home"><span>open<span class="wordmark-period">.</span></span></a>
    <nav class="main-nav" aria-label="Primary navigation">
      ${links.map(([href, label, to]) => `<a class="nav-link${path === href ? ' active' : ''}" href="${to || href}"${path === href ? ' aria-current="page"' : ''}>${label}</a>`).join('\n      ')}
    </nav>
    <div class="top-actions">
      <span class="snapshot-state">Public sources</span>
      <button type="button" class="theme-toggle" aria-label="Switch color theme" title="Switch theme">
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.8" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 2.2a5.8 5.8 0 0 1 0 11.6z" fill="currentColor"/></svg>
      </button>
    </div>`;

  const button = header.querySelector('.theme-toggle');
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const colors = document.documentElement.dataset;
    document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? (colors.darkColor || '#02205e') : (colors.lightColor || '#f5f4f4');
    button.setAttribute('aria-pressed', String(theme === 'dark'));
  }
  let theme = document.documentElement.dataset.defaultTheme || 'light';
  try {
    const saved = localStorage.getItem('cei-theme');
    if (saved === 'light' || saved === 'dark') theme = saved;
  } catch {}
  applyTheme(theme);
  button.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem('cei-theme', next); } catch {}
  });
  header.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
})();
