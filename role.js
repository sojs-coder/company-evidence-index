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
    if (window.CEI_ROLE.get()) { bar(); return; }
    const ov = document.createElement('div');
    ov.id = 'role-ask';
    ov.innerHTML = '<div class="role-card"><h1>Who are you?</h1>' +
      Object.entries(ROLES).map(([k, r]) =>
        '<button type="button" class="role-opt" data-role="' + k + '"><strong>' + r.label + '</strong><span>' + r.line + '</span></button>'
      ).join('') +
      '<p class="role-note">Your choice only changes how the evidence is organized. Same posts, same sources, same standards.</p></div>';
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
