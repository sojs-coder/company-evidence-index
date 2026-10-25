// "Who are you?" role conditioning (owner direction 2026-10-25 05:30-05:36):
// the role guides HOW findings are evaluated and ordered. Same evidence,
// same sources, same truth standards - different decision lens. No
// registration; the choice lives in sessionStorage only.
(function(){
  const ROLES = {
    customer: { label: 'A customer', line: 'See reported problems and what to check before buying.' },
    vendor:   { label: 'A vendor',   line: 'See what people praise and where a conversation could open.' },
    investor: { label: 'An investor',line: 'See claims, counterclaims, and what deserves diligence.' },
    scout:    { label: 'A scout',    line: 'Compare companies by coverage and conversation themes.' }
  };
  const ICONS = {
    customer: '<path d="M6 7h12l1 13H5L6 7Z"/><path d="M9 7V6a3 3 0 0 1 6 0v1"/>',
    vendor: '<path d="M3 10h18l-2-6H5l-2 6Z"/><path d="M3 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M5 13v7h14v-7M10 20v-5h4v5"/>',
    investor: '<path d="M4 4v16h16M8 15l4-5 4 2 4-6M16 6h4v4"/>',
    scout: '<circle cx="12" cy="12" r="9"/><path d="m16 8-2 6-6 2 2-6 6-2Z"/>'
  };
  const KEY = 'cei_role';
  window.CEI_ROLE = {
    get: () => { try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; } },
    set: (r) => { try { sessionStorage.setItem(KEY, r); } catch {} },
    roles: ROLES
  };
  function bar(){
    const cur = window.CEI_ROLE.get();
    const el = document.createElement('div');
    el.id = 'role-bar';
    el.innerHTML = cur
      ? '<span class="role-chip">Lens: ' + (ROLES[cur] ? ROLES[cur].label.replace(/^A[n]? /,'') : cur) + '</span> <button type="button" class="role-change">change</button>'
      : '';
    if (cur) el.querySelector('.role-change').addEventListener('click', () => { window.CEI_ROLE.set(''); location.reload(); });
    document.body.prepend(el);
  }
  function ask(){
    if (window.CEI_ROLE.get() || document.body.hasAttribute('data-no-role-gate')) { if (window.CEI_ROLE.get()) bar(); return; }
    const ov = document.createElement('div');
    ov.id = 'role-ask';
    ov.innerHTML = '<div class="role-card"><h1>Who are you?</h1><div class="role-options">' +
      Object.entries(ROLES).map(([k, r]) =>
        '<button type="button" class="role-opt" data-role="' + k + '">' +
        '<svg class="role-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + ICONS[k] + '</svg>' +
        '<strong>' + r.label + '</strong><span>' + r.line + '</span></button>'
      ).join('') +
      '</div><p class="role-note">Your choice only changes how the evidence is organized. Same posts, same sources, same standards.</p></div>';
    ov.addEventListener('click', (e) => {
      const b = e.target.closest('.role-opt');
      if (!b) return;
      window.CEI_ROLE.set(b.dataset.role);
      ov.remove();
      bar();
      document.dispatchEvent(new CustomEvent('cei-role', { detail: b.dataset.role }));
    });
    document.body.appendChild(ov);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ask); else ask();
})();
