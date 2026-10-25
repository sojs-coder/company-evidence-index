// All pages share this shell. Keep page-specific data and status in <main>.
(() => {
  const links = [
    ['/', 'Vet'],
    ['/companies.html', 'Apple demo'],
    ['/collection.html', 'Collection'],
    ['/packs.html', 'Mentions'],
    ['/results.html', 'Results'],
    ['/report.html', 'Apple example'],
    ['/supplier.html', 'Supplier example']
  ];
  const path = location.pathname === '/index.html' ? '/' : location.pathname;
  const header = document.querySelector('.topbar');
  header.innerHTML = `
    <a class="wordmark" href="/" aria-label="Open home"><span>open<span class="wordmark-period">.</span></span></a>
    <nav class="main-nav" aria-label="Primary navigation">
      ${links.map(([href, label]) => `<a class="nav-link${path === href ? ' active' : ''}" href="${href}"${path === href ? ' aria-current="page"' : ''}>${label}</a>`).join('\n      ')}
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
    document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#02205e' : '#f5f4f4';
    button.setAttribute('aria-pressed', String(theme === 'dark'));
  }
  let theme = 'light';
  try { theme = localStorage.getItem('cei-theme') === 'dark' ? 'dark' : 'light'; } catch {}
  applyTheme(theme);
  button.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem('cei-theme', next); } catch {}
  });
  header.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
})();
