// Single entry: company + role + question open one brief. Stored evidence only.
(()=>{
  const form=document.querySelector('#pick-form');if(!form)return;
  const Q={
    customer:'What should I check before buying from them?',
    vendor:'Is this company worth pursuing, and what is the opening?',
    investor:'What deserves diligence, and what challenges their story?',
    scout:'How does this company compare to peers?'
  };
  const ta=form.question;let touched=false;
  ta.addEventListener('input',()=>{touched=true});
  const saved=window.CEI_ROLE&&window.CEI_ROLE.get();
  if(saved&&Object.prototype.hasOwnProperty.call(Q,saved)){form.querySelector(`input[name=role][value="${saved}"]`).checked=true}
  const sync=()=>{if(!touched)ta.value=Q[form.role.value]};
  form.addEventListener('change',e=>{if(e.target.name==='role')sync()});
  sync();
  form.addEventListener('submit',e=>{
    e.preventDefault();
    const role=form.role.value;
    if(window.CEI_ROLE)window.CEI_ROLE.set(role);
    const p=new URLSearchParams({c:form.company.value,role,q:ta.value.trim()||Q[role]});
    try{localStorage.setItem('cei_flow','?'+p)}catch{}
    location.href='/brief.html?'+p;
  });
})();
