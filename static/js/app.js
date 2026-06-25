const API = '';
let portfolio=[], metas={}, aportes=[], charts={}, editIndex=-1, editAporteIndex=-1, saveTimer=null;
let aporteFilterType='', aporteSearchText='';
const CLASSES=['Ações','FII','Renda Fixa','Cripto','Internacional','Outros'];
const PALETTE=['#c9a84c','#5b8dee','#00c9b1','#e05c5c','#9b7fe8','#4caf82','#f0a050','#22d3ee'];
const CLS_COLOR={Ações:'#5b8dee',FII:'#c9a84c','Renda Fixa':'#00c9b1',Cripto:'#e05c5c',Internacional:'#9b7fe8',Outros:'#5a5650'};
const DEFAULT_METAS={Ações:40,FII:20,'Renda Fixa':25,Cripto:5,Internacional:5,Outros:5};
const PAGE_TITLES={dashboard:'Dashboard',ativos:'Meus Ativos',adicionar:'Adicionar Ativo',compra:'Lançar Compra',metas:'Metas de Alocação',aportes:'Aportes & Resgates',evolucao:'Evolução Patrimonial',analise:'Análise & Sugestões',ir:'Declaração de IR',proventos:'Proventos Futuros',fcd:'Análise & Valuation — Preço Justo'};

// ── Web API helpers ───────────────────────────────────────────────
const CFG = window.__PORTFEX__ || {};
function getToken(){ return localStorage.getItem('pf_token')||''; }
async function apiFetch(url, opts={}){
  const r = await fetch(url, {
    ...opts, credentials:'include',
    headers:{...(opts.headers||{}),'Authorization':'Bearer '+getToken()}
  });
  if(r.status===401){ localStorage.removeItem('pf_token'); window.location.href='/login'; return null; }
  return r;
}

async function init(){
  // Verifica auth
  const me = await apiFetch('/api/auth/me');
  if(!me) return;
  const user = await me.json();
  if(!user.ok){ window.location.href='/login'; return; }

  // Atualiza UI
  _renderUserBadge(user);

  const r = await apiFetch('/api/data');
  if(!r) return;
  const data = await r.json();
  if(Array.isArray(data)){portfolio=data;metas={...DEFAULT_METAS};aportes=[];}
  else{portfolio=data.portfolio||[];metas=data.metas||{...DEFAULT_METAS};aportes=data.aportes||[];}

  if(!user.pro && data._limite){
    _renderUpgradeBanner(data._total_ativos||portfolio.length, data._limite);
  }

  renderDashboard();
}

function _renderUserBadge(user){
  const el = document.getElementById('userBadge');
  const bar = document.getElementById('upgradePillBar');
  const btnSair = document.getElementById('btnSairDesktop');
  if(el){
    var nome = (user.nome||user.email||'').split(' ')[0];
    var pill = user.pro ? 'pro' : 'gratis';
    var label = user.pro ? 'PRO' : 'GRÁTIS';
    el.innerHTML = '<span>' + nome + '</span> <span class="plano-pill ' + pill + '">' + label + '</span>';
  }
  if(bar){
    if(user.pro){
      bar.innerHTML='<div style="font-size:.68rem;color:var(--green)">✓ Plano Pro ativo</div>';
    } else {
      bar.innerHTML='<button class="btn-upgrade" onclick="irParaUpgrade()" style="width:100%">⭐ Upgrade</button>';
    }
  }
  const liveBadge = document.getElementById('liveBadge');
  if(liveBadge) liveBadge.style.display='flex';
  // Mostra botão Sair no desktop (topbar)
  if(btnSair) btnSair.style.display='flex';
}

function _renderUpgradeBanner(total, limite){
  const page = document.getElementById('page-dashboard');
  if(!page) return;
  const old = document.getElementById('upgradeBanner');
  if(old) old.remove();
  const div = document.createElement('div');
  div.id='upgradeBanner'; div.className='upgrade-banner';
  var limiteMsg = total>=limite ? ' <strong style="color:var(--red)">Limite atingido.</strong>' : '';
  div.innerHTML = '<p><strong>' + total + '/' + limite + ' ativos</strong> usados no plano gratuito.' + limiteMsg + '</p><button class="btn-upgrade" onclick="irParaUpgrade()">⭐ Fazer upgrade</button>';
  page.insertBefore(div, page.firstChild);
}

function irParaUpgrade(){
  window.location.href='/planos';
}

async function fazerLogout(){
  if(!confirm('Sair da conta?')) return;
  await apiFetch('/api/auth/logout',{method:'POST'});
  localStorage.removeItem('pf_token');
  window.location.href='/';
}

function save(){
  const dot=document.getElementById('saveDot'),lbl=document.getElementById('saveLabel');
  dot.style.background='var(--gold)';lbl.textContent='Salvando…';
  clearTimeout(saveTimer);
  saveTimer=setTimeout(async()=>{
    try{
      const r=await apiFetch('/api/data',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({portfolio,metas,aportes})});
      if(!r) return;
      const d=await r.json();
      if(d.upgrade){showToast('Limite do plano gratuito atingido. Faça upgrade!','gold');dot.style.background='var(--gold)';lbl.textContent='Limite atingido';return;}
      dot.style.background=d.ok?'var(--green)':'var(--red)';
      lbl.textContent=d.ok?'Dados salvos':'Erro ao salvar!';
    }catch(e){dot.style.background='var(--red)';lbl.textContent='Erro!';}
  },600);
}

function showPage(id,el){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.getElementById('page-'+id).classList.add('active');
  if(el)el.classList.add('active');
  document.getElementById('pageTitle').textContent=PAGE_TITLES[id]||id;
  const renders={dashboard:renderDashboard,ativos:()=>{populateSetorFilter();renderTable();},compra:()=>initCompraPage(),metas:renderMetas,aportes:()=>renderAportes(),evolucao:renderEvolucao,analise:renderAnalysis,ir:renderIR,proventos:renderProventos,fcd:renderFCD};
  if(renders[id])renders[id]();
}

const fmtBRL=v=>v.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const fmtPct=v=>(v>=0?'+':'')+v.toFixed(2)+'%';
const fmtDate=s=>s?new Date(s+'T12:00:00').toLocaleDateString('pt-BR'):'—';
const getTotalInv=()=>portfolio.reduce((s,a)=>s+a.qtd*a.preco,0);
const getTotalCur=()=>portfolio.reduce((s,a)=>s+a.qtd*a.cotacao,0);
const TD='#5a5650',GD='rgba(255,255,255,0.04)';
// Register datalabels plugin globally but disable by default
if (typeof ChartDataLabels !== 'undefined') {
  Chart.register(ChartDataLabels);
  Chart.defaults.plugins.datalabels = { display: false };
}

function renderDashboard(){
  const inv=getTotalInv(),cur=getTotalCur(),ganho=cur-inv,pct=inv>0?(ganho/inv)*100:0;
  const totA=aportes.filter(a=>a.tipo==='Aporte').reduce((s,a)=>s+a.valor,0);
  const totD=aportes.filter(a=>a.tipo==='Dividendo'||a.tipo==='Rendimento').reduce((s,a)=>s+a.valor,0);
  let bEl='—',wEl='—';
  if(portfolio.length){
    const s=[...portfolio].sort((a,b)=>((b.cotacao/b.preco)-(a.cotacao/a.preco)));
    const b=s[0],w=s[s.length-1];
    bEl=`<span style="color:var(--green);font-weight:600">${b.ticker} <small>${fmtPct(((b.cotacao/b.preco)-1)*100)}</small></span>`;
    wEl=`<span style="color:var(--red);font-weight:600">${w.ticker} <small>${fmtPct(((w.cotacao/w.preco)-1)*100)}</small></span>`;
  }
  document.getElementById('summaryCards').innerHTML=`
    <div class="stat-card"><div class="stat-label">Total Investido</div><div class="stat-value">${fmtBRL(inv)}</div><div class="stat-sub">${portfolio.length} ativos · ${new Set(portfolio.map(a=>a.classe)).size} classes</div><div class="stat-accent">◈</div></div>
    <div class="stat-card"><div class="stat-label">Valor Atual</div><div class="stat-value gold">${fmtBRL(cur)}</div><div class="stat-sub">Cotações atualizadas</div><div class="stat-accent">⟋</div></div>
    <div class="stat-card"><div class="stat-label">Ganho / Perda</div><div class="stat-value ${ganho>=0?'pos':'neg'}">${fmtBRL(ganho)}</div><div class="stat-sub">${fmtPct(pct)}</div><div class="stat-accent">✦</div></div>
    <div class="stat-card"><div class="stat-label">Total Aportado</div><div class="stat-value">${fmtBRL(totA)}</div><div class="stat-sub">${aportes.filter(a=>a.tipo==='Aporte').length} aportes</div><div class="stat-accent">⊕</div></div>
    <div class="stat-card"><div class="stat-label">Renda Passiva</div><div class="stat-value pos">${fmtBRL(totD)}</div><div class="stat-sub">Dividendos + rendimentos</div><div class="stat-accent">⊞</div></div>
    <div class="stat-card"><div class="stat-label">Melhor / Pior</div><div style="margin-top:.4rem;display:flex;flex-direction:column;gap:.3rem;font-size:.88rem">${bEl}${wEl}</div></div>`;
  renderChartsDash();renderAllocBars(inv);
  renderSetorBars(inv);
  renderAtivoRVChart(inv);
  renderConcentracaoGrid(inv);
}
function renderAllocBars(total){
  const bC={};portfolio.forEach(a=>{bC[a.classe]=(bC[a.classe]||0)+a.qtd*a.preco;});
  document.getElementById('allocBars').innerHTML=Object.entries(bC).sort((a,b)=>b[1]-a[1]).map(([k,v])=>{
    const p=total>0?(v/total)*100:0;
    return `<div class="alloc-item"><div class="alloc-name">${k}</div><div class="alloc-track"><div class="alloc-bar" style="width:${p}%;background:${CLS_COLOR[k]||'#5a5650'}"></div></div><div class="alloc-pct">${p.toFixed(1)}%</div></div>`;
  }).join('');
}
function mkDonut(id,labels,data,colors){if(charts[id])charts[id].destroy();charts[id]=new Chart(document.getElementById(id),{type:'doughnut',data:{labels,datasets:[{data,backgroundColor:colors||PALETTE,borderWidth:2,borderColor:'#080b10'}]},options:{plugins:{legend:{position:'bottom',labels:{color:TD,font:{size:10,family:'Outfit'},boxWidth:8,padding:12}}},cutout:'68%',responsive:true,maintainAspectRatio:false}});}
function renderChartsDash(){
  ['chartClasse','chartSetor','chartRent','chartDividendos'].forEach(id=>{if(charts[id]){charts[id].destroy();delete charts[id];}});
  if(!portfolio.length)return;
  const total=getTotalInv(),cM={},sM={};
  portfolio.forEach(a=>{const v=a.qtd*a.preco;cM[a.classe]=(cM[a.classe]||0)+v;sM[a.setor]=(sM[a.setor]||0)+v;});
  mkDonut('chartClasse',Object.keys(cM),Object.values(cM),Object.keys(cM).map(k=>CLS_COLOR[k]||'#5a5650'));
  const sk=Object.keys(sM).slice(0,8);mkDonut('chartSetor',sk,sk.map(k=>sM[k]));
  const top10=[...portfolio].sort((a,b)=>(b.qtd*b.preco)-(a.qtd*a.preco)).slice(0,10);
  const rents=top10.map(a=>parseFloat((((a.cotacao/a.preco)-1)*100).toFixed(2)));
  charts.chartRent=new Chart(document.getElementById('chartRent'),{type:'bar',data:{labels:top10.map(a=>a.ticker),datasets:[{data:rents,backgroundColor:rents.map(r=>r>=0?'rgba(76,175,130,.7)':'rgba(224,92,92,.7)'),borderRadius:4,borderSkipped:false}]},options:{plugins:{legend:{display:false}},scales:{x:{ticks:{color:TD,font:{size:9}},grid:{color:GD}},y:{ticks:{color:TD,font:{size:9},callback:v=>v+'%'},grid:{color:GD}}},responsive:true,maintainAspectRatio:false}});
  // Gráfico de dividendos e JCP por mês
  (function(){
    const divAportes = aportes.filter(a => a.tipo === 'Dividendo' || a.tipo === 'Rendimento');
    if (!divAportes.length) {
      // Sem dados — mostra placeholder
      const el = document.getElementById('chartDividendos');
      if(el) { const ctx=el.getContext('2d'); ctx.fillStyle='rgba(255,255,255,0.04)'; ctx.fillRect(0,0,el.width,el.height); }
      return;
    }
    // Agrupa por mês
    const byMes = {};
    divAportes.forEach(a => {
      const mes = (a.data||'').slice(0,7);
      if (!mes) return;
      if (!byMes[mes]) byMes[mes] = { div: 0, jcp: 0 };
      if (a.tipo === 'Dividendo') byMes[mes].div += a.valor;
      else                        byMes[mes].jcp += a.valor;
    });
    const meses = Object.keys(byMes).sort();
    const labels = meses.map(m => { const[y,mo]=m.split('-'); return mo+'/'+y.slice(2); });
    const divData = meses.map(m => parseFloat(byMes[m].div.toFixed(2)));
    const jcpData = meses.map(m => parseFloat(byMes[m].jcp.toFixed(2)));
    // Linha de acumulado
    let acc = 0;
    const accData = meses.map(m => { acc += byMes[m].div + byMes[m].jcp; return parseFloat(acc.toFixed(2)); });

    if (charts.chartDividendos) { charts.chartDividendos.destroy(); }
    charts.chartDividendos = new Chart(document.getElementById('chartDividendos'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Dividendos', data: divData, backgroundColor: 'rgba(76,175,130,.75)', borderRadius: 3, borderSkipped: false, order: 2 },
          { label: 'JCP/Rend.',  data: jcpData, backgroundColor: 'rgba(91,141,238,.75)', borderRadius: 3, borderSkipped: false, order: 2 },
          { label: 'Acumulado',  data: accData,  type: 'line', borderColor: 'rgba(201,168,76,.9)',
            backgroundColor: 'rgba(201,168,76,.06)', borderWidth: 2, pointRadius: 3,
            pointBackgroundColor: 'rgba(201,168,76,1)', fill: true, tension: .35, order: 1, yAxisID: 'y2' },
          // Dataset invisível só para mostrar total do mês acima das barras
          { label: 'Total mês', data: meses.map(m=>byMes[m].div+byMes[m].jcp),
            type: 'bar', backgroundColor: 'transparent', borderColor: 'transparent',
            borderWidth: 0, order: 0,
            datalabels: {
              display: true,
              anchor: 'end', align: 'end',
              color: 'rgba(240,236,228,0.85)',
              font: { size: 9, family: 'Outfit', weight: '600' },
              formatter: v => v > 0 ? fmtBRL(v) : ''
            }
          }
        ]
      },
      options: {
        plugins: {
          legend: { labels: { color: TD, font: { size: 10, family:'Outfit' }, boxWidth: 10, padding: 12 },
            filter: item => item.datasetIndex < 3 },
          datalabels: { display: false }
        },
        scales: {
          x:  { ticks: { color:TD, font:{size:9} }, grid: { color:GD } },
          y:  { ticks: { color:TD, font:{size:9}, callback: v => fmtBRL(v) }, grid: { color:GD }, title: { display:true, text:'Por mês', color:TD, font:{size:8} } },
          y2: { position:'right', ticks: { color:'rgba(201,168,76,.7)', font:{size:9}, callback: v => fmtBRL(v) }, grid: { display:false }, title: { display:true, text:'Acumulado', color:'rgba(201,168,76,.7)', font:{size:8} } }
        },
        responsive: true, maintainAspectRatio: false
      }
    });
  })();
}
const BC={Ações:'b-acoes',FII:'b-fii','Renda Fixa':'b-rf',Cripto:'b-cripto',Internacional:'b-intl'};
function renderTable(filter='',classeFilter='',setorFilter='',sort='ticker'){
  const tbody=document.getElementById('ativosTable'),empty=document.getElementById('ativosEmpty'),total=getTotalInv();
  let rows=portfolio.filter(a=>{const matchTxt=!filter||a.ticker.includes(filter)||a.setor.toLowerCase().includes(filter.toLowerCase());const matchClasse=!classeFilter||a.classe===classeFilter;const matchSetor=!setorFilter||a.setor===setorFilter;return matchTxt&&matchClasse&&matchSetor;});
  // Ordenação
  rows=[...rows].sort((a,b)=>{
    switch(sort){
      case 'qtd_desc':   return b.qtd - a.qtd;
      case 'qtd_asc':    return a.qtd - b.qtd;
      case 'investido_desc': return (b.qtd*b.preco) - (a.qtd*a.preco);
      case 'investido_asc':  return (a.qtd*a.preco) - (b.qtd*b.preco);
      case 'atual_desc': return (b.qtd*b.cotacao) - (a.qtd*a.cotacao);
      case 'pl_desc':    return ((b.cotacao/b.preco)-1) - ((a.cotacao/a.preco)-1);
      case 'pl_asc':     return ((a.cotacao/a.preco)-1) - ((b.cotacao/b.preco)-1);
      case 'pct_desc':   return (b.qtd*b.preco) - (a.qtd*a.preco);
      default:           return a.ticker.localeCompare(b.ticker);
    }
  });
  if(!rows.length){tbody.innerHTML='';empty.style.display='block';return;}
  empty.style.display='none';
  tbody.innerHTML=rows.map(a=>{
    const ri=portfolio.indexOf(a),inv=a.qtd*a.preco,cur=a.qtd*a.cotacao,rent=((a.cotacao/a.preco)-1)*100,pct=total>0?(inv/total)*100:0;
    return `<tr><td><strong>${a.ticker}</strong>${a.obs?`<div style="font-size:.7rem;color:var(--text3)">${a.obs}</div>`:''}</td><td><span class="badge ${BC[a.classe]||'b-outros'}">${a.classe}</span></td><td style="font-size:.78rem">${a.setor}</td><td>${a.qtd.toLocaleString('pt-BR')}</td><td>${fmtBRL(a.preco)}</td><td style="color:var(--text)">${fmtBRL(a.cotacao)}</td><td>${fmtBRL(inv)}</td><td style="color:var(--text)">${fmtBRL(cur)}</td><td style="color:${rent>=0?'var(--green)':'var(--red)'};font-weight:600">${fmtPct(rent)}</td><td><div class="pnl-mini"><div class="pnl-line" style="width:${Math.min(pct*1.8,52)}px;background:${CLS_COLOR[a.classe]||'#5a5650'}"></div><span style="font-size:.76rem;color:var(--text3)">${pct.toFixed(1)}%</span></div></td><td><button class="icon-btn e" onclick="openEdit(${ri})">✎</button><button class="icon-btn d" onclick="deleteAtivo(${ri})">✕</button></td></tr>`;
  }).join('');
}
function populateSetorFilter(){
  const sel=document.getElementById('filterSetor');
  if(!sel)return;
  const setores=[...new Set(portfolio.map(a=>a.setor))].filter(Boolean).sort();
  const current=sel.value;
  sel.innerHTML='<option value="">Todos os setores</option>'+setores.map(s=>`<option value="${s}"${s===current?' selected':''}>${s}</option>`).join('');
}
function applyFilters(){
  const texto=(document.getElementById('filterTexto')?.value||'').toUpperCase();
  const classe=(document.getElementById('filterClasse')?.value||'');
  const setor=(document.getElementById('filterSetor')?.value||'');
  const sort=(document.getElementById('sortAtivos')?.value||'ticker');
  filterTable(texto,classe,setor,sort);
}
function filterTable(v,classeFilter='',setorFilter='',sort='ticker'){
  renderTable(v,classeFilter,setorFilter,sort);
}
function deleteAtivo(i){if(!confirm('Remover '+portfolio[i].ticker+'?'))return;portfolio.splice(i,1);save();renderTable();showToast('Ativo removido','red');}
function openEdit(i){editIndex=i;const a=portfolio[i];document.getElementById('editTicker').value=a.ticker;document.getElementById('editClasse').value=a.classe;document.getElementById('editSetor').value=a.setor;document.getElementById('editQtd').value=a.qtd;document.getElementById('editPreco').value=a.preco;document.getElementById('editCotacao').value=a.cotacao;document.getElementById('editModal').classList.add('open');}
function closeModal(id){document.getElementById(id).classList.remove('open');editIndex=-1;editAporteIndex=-1;}
function saveEdit(){if(editIndex<0)return;const a=portfolio[editIndex];a.ticker=document.getElementById('editTicker').value.trim().toUpperCase();a.classe=document.getElementById('editClasse').value;a.setor=document.getElementById('editSetor').value.trim();a.qtd=parseFloat(document.getElementById('editQtd').value);a.preco=parseFloat(document.getElementById('editPreco').value);a.cotacao=parseFloat(document.getElementById('editCotacao').value);a.updatedAt=Date.now();save();closeModal('editModal');renderTable();showToast('Ativo atualizado');}
function addAtivo(){
  const ticker=document.getElementById('fTicker').value.trim().toUpperCase(),
        classe=document.getElementById('fClasse').value,
        setor=document.getElementById('fSetor').value.trim()||'Não informado',
        qtd=parseFloat(document.getElementById('fQtd').value),
        preco=parseFloat(document.getElementById('fPreco').value),
        cotacao=parseFloat(document.getElementById('fCotacao').value)||preco,
        data=document.getElementById('fData').value,
        obs=document.getElementById('fObs').value.trim();
  if(!ticker||!qtd||!preco){showToast('Preencha ticker, quantidade e preço','red');return;}
  // Verifica limite do plano gratuito ANTES de adicionar
  const cfg = window.__PORTFEX__ || {};
  if(!cfg.pro && cfg.limite){
    const jaExiste = portfolio.some(a => a.ticker === ticker);
    if(!jaExiste && portfolio.length >= cfg.limite){
      showToast('Limite de '+cfg.limite+' ativos do plano gratuito atingido. Faça upgrade!','gold');
      // Mostra banner de upgrade
      _renderUpgradeBanner(portfolio.length, cfg.limite);
      return;
    }
  }
  portfolio.push({ticker,classe,setor,qtd,preco,cotacao,data,obs,updatedAt:Date.now()});
  save();clearForm();showToast(ticker+' adicionado');
}
function clearForm(){['fTicker','fSetor','fQtd','fPreco','fCotacao','fData','fObs'].forEach(id=>document.getElementById(id).value='');document.getElementById('fClasse').value='Ações';}
function renderMetas(){
  const total=getTotalInv(),bC={};portfolio.forEach(a=>{bC[a.classe]=(bC[a.classe]||0)+a.qtd*a.preco;});
  document.getElementById('metasForm').innerHTML=CLASSES.map(cls=>{const val=metas[cls]||0,key=cls.replace(/ /g,'_');return `<div class="meta-slider-row"><label style="font-size:.82rem;color:var(--text2)">${cls}</label><input type="range" min="0" max="100" value="${val}" oninput="updateMeta('${cls}',this.value)" id="ms_${key}"><input class="num-input" type="number" min="0" max="100" value="${val}" oninput="updateMeta('${cls}',this.value)" id="mi_${key}"></div>`;}).join('');
  updateSomaBar();
  const hdrs=`<div class="meta-compare-row" style="padding-bottom:.4rem;border-bottom:1px solid var(--border)"><span style="font-size:.65rem;letter-spacing:.1em;text-transform:uppercase;color:var(--text3)">Classe</span><span style="font-size:.65rem;letter-spacing:.1em;text-transform:uppercase;color:var(--text3)">Barra</span><span style="font-size:.65rem;text-transform:uppercase;color:var(--text3)">Atual</span><span style="font-size:.65rem;text-transform:uppercase;color:var(--text3)">Meta</span><span style="font-size:.65rem;text-transform:uppercase;color:var(--text3)">Gap</span></div>`;
  document.getElementById('metasCompare').innerHTML=hdrs+CLASSES.map(cls=>{const at=total>0?((bC[cls]||0)/total)*100:0,tg=metas[cls]||0,gap=at-tg,cc=Math.abs(gap)<1?'chip-ok':gap>0?'chip-hi':'chip-lo',ct=Math.abs(gap)<1?'✓ Meta':gap>0?`▲ +${gap.toFixed(1)}%`:`▼ ${gap.toFixed(1)}%`;return `<div class="meta-compare-row"><span style="font-size:.82rem;color:var(--text2)">${cls}</span><div class="meta-track"><div class="meta-fill" style="width:${Math.min(at,100)}%;background:${CLS_COLOR[cls]||'#5a5650'}"></div><div class="meta-line" style="left:${Math.min(tg,100)}%"></div></div><span style="font-size:.78rem;color:var(--text3)">${at.toFixed(1)}%</span><span style="font-size:.78rem;color:var(--gold)">${tg}%</span><span class="gap-chip ${cc}">${ct}</span></div>`;}).join('');
  if(charts.chartMetas){charts.chartMetas.destroy();delete charts.chartMetas;}
  const aD=CLASSES.map(cls=>total>0?((bC[cls]||0)/total*100):0),mD=CLASSES.map(cls=>metas[cls]||0);
  charts.chartMetas=new Chart(document.getElementById('chartMetas'),{type:'bar',data:{labels:CLASSES,datasets:[{label:'Atual %',data:aD.map(v=>parseFloat(v.toFixed(1))),backgroundColor:CLASSES.map(k=>CLS_COLOR[k]||'#5a5650'),borderRadius:4,borderSkipped:false},{label:'Meta %',data:mD,backgroundColor:'rgba(255,255,255,0.05)',borderColor:'rgba(255,255,255,0.15)',borderWidth:1,borderRadius:4,borderSkipped:false}]},options:{plugins:{legend:{labels:{color:TD,font:{size:10,family:'Outfit'}}}},scales:{x:{ticks:{color:TD,font:{size:10}},grid:{color:GD}},y:{ticks:{color:TD,font:{size:10},callback:v=>v+'%'},grid:{color:GD}}},responsive:true,maintainAspectRatio:false}});
}
function updateMeta(cls,val){metas[cls]=parseInt(val)||0;const key=cls.replace(/ /g,'_');document.getElementById('ms_'+key).value=metas[cls];document.getElementById('mi_'+key).value=metas[cls];updateSomaBar();}
function updateSomaBar(){const soma=CLASSES.reduce((s,cls)=>s+(metas[cls]||0),0),ok=soma===100;document.getElementById('somaBar').innerHTML=`<div class="soma-bar ${ok?'soma-ok':'soma-warn'}">${ok?'✅':'⚠'} Soma: ${soma}% ${ok?'— perfeito!':'— deve somar 100%'}</div>`;}
function saveMetas(){save();renderMetas();showToast('Metas salvas');}
function resetMetas(){metas={...DEFAULT_METAS};save();renderMetas();showToast('Metas restauradas');}
function openAporteModal(idx=-1){editAporteIndex=idx;const sel=document.getElementById('aAtivo');sel.innerHTML='<option value="">— Geral —</option>'+portfolio.map(a=>`<option value="${a.ticker}">${a.ticker}</option>`).join('');if(idx>=0){const ap=aportes[idx];document.getElementById('aData').value=ap.data;document.getElementById('aTipo').value=ap.tipo;document.getElementById('aValor').value=ap.valor;document.getElementById('aAtivo').value=ap.ativo||'';document.getElementById('aObs').value=ap.obs||'';document.getElementById('aporteModalTitle').textContent='Editar Lançamento';}else{['aData','aValor','aObs'].forEach(id=>document.getElementById(id).value='');document.getElementById('aTipo').value='Aporte';document.getElementById('aAtivo').value='';document.getElementById('aporteModalTitle').textContent='Registrar Lançamento';document.getElementById('aData').value=new Date().toISOString().slice(0,10);}document.getElementById('aporteModal').classList.add('open');}
function saveAporte(){const data=document.getElementById('aData').value,tipo=document.getElementById('aTipo').value,valor=parseFloat(document.getElementById('aValor').value),ativo=document.getElementById('aAtivo').value,obs=document.getElementById('aObs').value.trim();if(!data||!valor){showToast('Preencha data e valor','red');return;}const obj={id:Date.now(),data,tipo,valor,ativo,obs};if(editAporteIndex>=0)aportes[editAporteIndex]=obj;else aportes.push(obj);aportes.sort((a,b)=>b.data.localeCompare(a.data));save();closeModal('aporteModal');renderAportes();showToast('Lançamento salvo');}
function deleteAporte(i){if(!confirm('Remover?'))return;aportes.splice(i,1);save();renderAportes();showToast('Removido','red');}
function filterAportes(v){aporteFilterType=v;renderAportes();}
function searchAportes(v){aporteSearchText=v.toLowerCase();renderAportes();}
function renderAportes(){
  const tA=aportes.filter(a=>a.tipo==='Aporte').reduce((s,a)=>s+a.valor,0),tR=aportes.filter(a=>a.tipo==='Resgate').reduce((s,a)=>s+a.valor,0),tD=aportes.filter(a=>a.tipo==='Dividendo').reduce((s,a)=>s+a.valor,0),tRe=aportes.filter(a=>a.tipo==='Rendimento').reduce((s,a)=>s+a.valor,0);
  document.getElementById('aportesSummary').innerHTML=`<div class="stat-card"><div class="stat-label">Total Aportado</div><div class="stat-value pos">${fmtBRL(tA)}</div><div class="stat-sub">${aportes.filter(a=>a.tipo==='Aporte').length} lançamentos</div></div><div class="stat-card"><div class="stat-label">Total Resgatado</div><div class="stat-value neg">${fmtBRL(tR)}</div></div><div class="stat-card"><div class="stat-label">Dividendos / JCP</div><div class="stat-value pos">${fmtBRL(tD)}</div></div><div class="stat-card"><div class="stat-label">Rendimentos</div><div class="stat-value pos">${fmtBRL(tRe)}</div></div><div class="stat-card"><div class="stat-label">Líquido Aportado</div><div class="stat-value gold">${fmtBRL(tA-tR)}</div></div>`;
  const tbody=document.getElementById('aportesTable'),empty=document.getElementById('aportesEmpty');
  let rows=aportes;if(aporteFilterType)rows=rows.filter(a=>a.tipo===aporteFilterType);if(aporteSearchText)rows=rows.filter(a=>(a.ativo||'').toLowerCase().includes(aporteSearchText)||(a.obs||'').toLowerCase().includes(aporteSearchText));
  if(!rows.length){tbody.innerHTML='';empty.style.display='block';return;}empty.style.display='none';
  const tC={Aporte:'var(--green)',Resgate:'var(--red)',Dividendo:'var(--gold)',Rendimento:'var(--blue)'};
  tbody.innerHTML=rows.map(ap=>{const ri=aportes.indexOf(ap);return `<tr><td>${fmtDate(ap.data)}</td><td><span class="aporte-dot" style="background:${tC[ap.tipo]||'var(--text3)'}"></span><span style="font-size:.8rem;font-weight:500;color:${tC[ap.tipo]||'var(--text2)'}">${ap.tipo}</span></td><td>${ap.ativo||'—'}</td><td style="font-weight:600;color:${ap.tipo==='Resgate'?'var(--red)':'var(--green)'}">${ap.tipo==='Resgate'?'-':''}${fmtBRL(ap.valor)}</td><td style="font-size:.78rem">${ap.obs||'—'}</td><td><button class="icon-btn e" onclick="openAporteModal(${ri})">✎</button><button class="icon-btn d" onclick="deleteAporte(${ri})">✕</button></td></tr>`;}).join('');
}
function renderEvolucao(){
  ['chartEvolucao','chartAportesMes','chartRendimentos','chartAportesClasse'].forEach(id=>{if(charts[id]){charts[id].destroy();delete charts[id];}});
  const sEl=document.getElementById('evolStats');if(!aportes.length){sEl.innerHTML='<div style="color:var(--text3);font-size:.84rem;grid-column:span 5">Registre aportes para ver a evolução.</div>';return;}
  const sorted=[...aportes].sort((a,b)=>a.data.localeCompare(b.data)),byMonth={};
  sorted.forEach(ap=>{const m=ap.data.slice(0,7);if(!byMonth[m])byMonth[m]={a:0,r:0,d:0,rend:0};if(ap.tipo==='Aporte')byMonth[m].a+=ap.valor;if(ap.tipo==='Resgate')byMonth[m].r+=ap.valor;if(ap.tipo==='Dividendo')byMonth[m].d+=ap.valor;if(ap.tipo==='Rendimento')byMonth[m].rend+=ap.valor;});
  const months=Object.keys(byMonth).sort();let cumul=0;
  const evolData=months.map(m=>{cumul+=byMonth[m].a-byMonth[m].r;return parseFloat(cumul.toFixed(2));});
  const mL=months.map(m=>{const[y,mo]=m.split('-');return mo+'/'+y.slice(2);});
  const tA=aportes.filter(a=>a.tipo==='Aporte').reduce((s,a)=>s+a.valor,0),tR=aportes.filter(a=>a.tipo==='Resgate').reduce((s,a)=>s+a.valor,0),tRend=aportes.filter(a=>a.tipo==='Dividendo'||a.tipo==='Rendimento').reduce((s,a)=>s+a.valor,0),liq=tA-tR,atual=getTotalCur(),rent=liq>0?((atual-liq)/liq)*100:0;
  sEl.innerHTML=`<div class="evol-stat"><div class="evol-stat-lbl">Líquido Aportado</div><div class="evol-stat-val">${fmtBRL(liq)}</div></div><div class="evol-stat"><div class="evol-stat-lbl">Valor Atual</div><div class="evol-stat-val" style="color:var(--gold)">${fmtBRL(atual)}</div></div><div class="evol-stat"><div class="evol-stat-lbl">Rentabilidade Total</div><div class="evol-stat-val" style="color:${rent>=0?'var(--green)':'var(--red)'}">${fmtPct(rent)}</div></div><div class="evol-stat"><div class="evol-stat-lbl">Renda Passiva</div><div class="evol-stat-val" style="color:var(--green)">${fmtBRL(tRend)}</div></div><div class="evol-stat"><div class="evol-stat-lbl">Meses Registrados</div><div class="evol-stat-val">${months.length}</div></div>`;
  charts.chartEvolucao=new Chart(document.getElementById('chartEvolucao'),{type:'line',data:{labels:mL,datasets:[{label:'Patrimônio Líquido',data:evolData,borderColor:'#c9a84c',backgroundColor:'rgba(201,168,76,0.06)',borderWidth:2,pointRadius:3,pointBackgroundColor:'#c9a84c',fill:true,tension:.35}]},options:{plugins:{legend:{labels:{color:TD,font:{size:10}}}},scales:{x:{ticks:{color:TD,font:{size:9}},grid:{color:GD}},y:{ticks:{color:TD,font:{size:9},callback:v=>fmtBRL(v)},grid:{color:GD}}},responsive:true,maintainAspectRatio:false}});
  charts.chartAportesMes=new Chart(document.getElementById('chartAportesMes'),{type:'bar',data:{labels:mL,datasets:[{label:'Aportes',data:months.map(m=>byMonth[m].a),backgroundColor:'rgba(76,175,130,.7)',borderRadius:3,borderSkipped:false},{label:'Resgates',data:months.map(m=>byMonth[m].r),backgroundColor:'rgba(224,92,92,.7)',borderRadius:3,borderSkipped:false}]},options:{plugins:{legend:{labels:{color:TD,font:{size:10}}}},scales:{x:{ticks:{color:TD,font:{size:9}},grid:{color:GD}},y:{ticks:{color:TD,font:{size:9},callback:v=>fmtBRL(v)},grid:{color:GD}}},responsive:true,maintainAspectRatio:false}});
  charts.chartRendimentos=new Chart(document.getElementById('chartRendimentos'),{type:'bar',data:{labels:mL,datasets:[{label:'Dividendos',data:months.map(m=>byMonth[m].d),backgroundColor:'rgba(201,168,76,.7)',borderRadius:3,borderSkipped:false},{label:'Rendimentos',data:months.map(m=>byMonth[m].rend),backgroundColor:'rgba(91,141,238,.7)',borderRadius:3,borderSkipped:false}]},options:{plugins:{legend:{labels:{color:TD,font:{size:10}}}},scales:{x:{ticks:{color:TD,font:{size:9}},grid:{color:GD}},y:{ticks:{color:TD,font:{size:9},callback:v=>fmtBRL(v)},grid:{color:GD}}},responsive:true,maintainAspectRatio:false}});
  const bC={};aportes.filter(a=>a.tipo==='Aporte'&&a.ativo).forEach(ap=>{const atv=portfolio.find(a=>a.ticker===ap.ativo),cls=atv?atv.classe:'Outros';bC[cls]=(bC[cls]||0)+ap.valor;});
  if(Object.keys(bC).length)mkDonut('chartAportesClasse',Object.keys(bC),Object.values(bC),Object.keys(bC).map(k=>CLS_COLOR[k]||'#5a5650'));
}
function renderAnalysis(){
  const c=document.getElementById('suggestionsContainer');if(!portfolio.length){c.innerHTML='<div class="empty-state"><div class="ei">✦</div><p>Adicione ativos para ver a análise.</p></div>';return;}
  const total=getTotalInv(),bC={};portfolio.forEach(a=>{bC[a.classe]=(bC[a.classe]||0)+a.qtd*a.preco;});
  const pct=k=>total>0?(bC[k]||0)/total*100:0;
  const [ac,fi,rf,cr,it]=['Ações','FII','Renda Fixa','Cripto','Internacional'].map(pct),n=portfolio.length,mx=Math.max(...portfolio.map(a=>(a.qtd*a.preco/total)*100));
  let cards=[];
  if(mx>20)cards.push({t:'bad',icon:'⚠',title:'Concentração elevada',text:`Um único ativo representa ${mx.toFixed(1)}% da carteira. Recomendado: máx 10-15% por posição.`,chip:'Risco Alto',cc:'chip-red'});
  if(rf<10)cards.push({t:'warn',icon:'🏦',title:'Pouca Renda Fixa',text:`Apenas ${rf.toFixed(1)}% em Renda Fixa. Tesouro Selic, CDB e LCI/LCA oferecem segurança com juros altos. Recomendado: 15-20%.`,chip:'Sugestão',cc:'chip-gold'});
  else if(rf>60)cards.push({t:'warn',icon:'🏦',title:'Excesso em Renda Fixa',text:`${rf.toFixed(1)}% pode limitar o crescimento real. Diversifique em Ações e FIIs.`,chip:'Otimizar',cc:'chip-gold'});
  else cards.push({t:'ok',icon:'✓',title:'Renda Fixa equilibrada',text:`${rf.toFixed(1)}% — ótima faixa. Avalie Tesouro IPCA+, CDB acima de 100% CDI e LCIs.`,chip:'Bem Alocado',cc:'chip-green'});
  if(ac<15)cards.push({t:'warn',icon:'📈',title:'Baixa exposição em Ações',text:`${ac.toFixed(1)}% em Ações. Para horizontes longos, ações superam a inflação. ETFs BOVA11 e IVVB11 facilitam a entrada.`,chip:'Sugestão',cc:'chip-gold'});
  else if(ac>70)cards.push({t:'bad',icon:'📉',title:'Concentração em Ações',text:`${ac.toFixed(1)}% é posição agressiva. Avalie se seu perfil suporta alta volatilidade.`,chip:'Atenção',cc:'chip-red'});
  else cards.push({t:'ok',icon:'📈',title:'Ações equilibradas',text:`${ac.toFixed(1)}% — proporção saudável. Garanta diversificação setorial.`,chip:'Bem Alocado',cc:'chip-green'});
  if(fi<5&&ac>0)cards.push({t:'warn',icon:'🏢',title:'Considere FIIs',text:`FIIs pagam rendimentos mensais isentos de IR. 10-20% entre Logística, Shoppings e FII de Papel pode aumentar a renda passiva.`,chip:'Sugestão',cc:'chip-gold'});
  else if(fi>0)cards.push({t:'ok',icon:'🏢',title:`FIIs: ${fi.toFixed(1)}%`,text:`Boa exposição. Diversifique entre segmentos e monitore P/VP e dividend yield.`,chip:'Monitorar',cc:'chip-green'});
  if(cr>10)cards.push({t:'bad',icon:'₿',title:'Cripto acima do recomendado',text:`${cr.toFixed(1)}% — volatilidade extrema. Recomenda-se máx 5%.`,chip:'Risco Muito Alto',cc:'chip-red'});
  else if(cr>0)cards.push({t:'ok',icon:'₿',title:`Cripto: ${cr.toFixed(1)}%`,text:`Exposição moderada. BTC e ETH como base, evite altcoins especulativas.`,chip:'Monitorar',cc:'chip-green'});
  if(it<5)cards.push({t:'warn',icon:'🌎',title:'Diversifique internacionalmente',text:`${it.toFixed(1)}% no exterior. ETFs IVVB11 e NASD11 protegem da desvalorização do Real.`,chip:'Sugestão',cc:'chip-gold'});
  if(n<5)cards.push({t:'warn',icon:'◈',title:'Poucos ativos',text:`Apenas ${n} ativo(s). Carteiras bem estruturadas têm 10-20 ativos.`,chip:'Diversificar',cc:'chip-gold'});
  else cards.push({t:'ok',icon:'◎',title:`${n} ativos cadastrados`,text:`Boa quantidade. Revise a tese de cada investimento periodicamente.`,chip:'Bem Diversificado',cc:'chip-green'});
  const gp=CLASSES.filter(cls=>{const at=total>0?((bC[cls]||0)/total)*100:0;return Math.abs(at-(metas[cls]||0))>5;});
  if(gp.length)cards.push({t:'warn',icon:'◎',title:'Metas desviadas',text:`${gp.join(', ')} com desvio acima de 5%. Acesse Metas de Alocação para rebalancear.`,chip:'Rebalancear',cc:'chip-gold'});
  c.innerHTML=`<div class="suggest-grid">${cards.map(card=>`<div class="suggest-card ${card.t}"><div class="suggest-icon">${card.icon}</div><div class="suggest-title">${card.title}</div><div class="suggest-text">${card.text}</div><span class="suggest-chip ${card.cc}">${card.chip}</span></div>`).join('')}</div>`;
}
async function updateQuotes(){
  const btn=document.getElementById('updateBtn');btn.disabled=true;btn.textContent='↻ Buscando…';
  const tickers=portfolio.filter(a=>a.classe==='Ações'||a.classe==='FII').map(a=>a.ticker);
  if(!tickers.length){showToast('Nenhuma ação/FII para atualizar');btn.disabled=false;btn.textContent='↻ Atualizar';return;}
  let updated=0;
  for(const ticker of tickers){
    try{const r=await apiFetch('/api/quote/'+ticker); if(!r) continue;const d=await r.json();if(d.results?.[0]?.regularMarketPrice){const idx=portfolio.findIndex(a=>a.ticker===ticker);if(idx>=0){portfolio[idx].cotacao=d.results[0].regularMarketPrice;portfolio[idx].updatedAt=Date.now();updated++;}}}catch(e){}
  }
  if(updated>0){save();showToast(`${updated} cotação(ões) atualizada(s)`);}else showToast('Cotações indisponíveis agora','gold');
  btn.disabled=false;btn.textContent='↻ Atualizar';
  if(document.getElementById('page-dashboard').classList.contains('active'))renderDashboard();
  if(document.getElementById('page-ativos').classList.contains('active'))renderTable();
}
setInterval(()=>{if(portfolio.some(a=>a.classe==='Ações'||a.classe==='FII'))updateQuotes();},60000);
function exportCSV(){
  if(!portfolio.length){showToast('Nenhum ativo','gold');return;}
  const h='Ticker,Classe,Setor,Qtd,PrecoMedio,Cotacao,Data,Obs',rows=portfolio.map(a=>`${a.ticker},${a.classe},${a.setor},${a.qtd},${a.preco},${a.cotacao},${a.data||''},${a.obs||''}`);
  const blob=new Blob([[h,...rows].join('\n')],{type:'text/csv'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='carteira.csv';a.click();URL.revokeObjectURL(a.href);
  showToast('CSV exportado');
}
function importJSON(){
  try{const arr=JSON.parse(document.getElementById('jsonInput').value.trim());if(!Array.isArray(arr))throw new Error();arr.forEach(a=>{if(!a.ticker||!a.qtd||!a.preco)return;portfolio.push({ticker:String(a.ticker).toUpperCase(),classe:a.classe||'Outros',setor:a.setor||'Não informado',qtd:parseFloat(a.qtd),preco:parseFloat(a.preco),cotacao:parseFloat(a.cotacao||a.preco),data:a.data||'',obs:a.obs||'',updatedAt:Date.now()});});save();document.getElementById('jsonInput').value='';showToast(`${arr.length} ativos importados`);}catch(e){showToast('JSON inválido','red');}
}





// ══════════════════════════════════════════════
// LANÇAR COMPRA
// ══════════════════════════════════════════════
let compraConfirmData = null;

function initCompraPage() {
  // Popula select de ativos
  const sel = document.getElementById('cAtivo');
  if (!sel) return;
  const sorted = [...portfolio].sort((a,b) => a.ticker.localeCompare(b.ticker));
  sel.innerHTML = '<option value="">— Selecione o ativo —</option>' +
    sorted.map(a => `<option value="${a.ticker}">${a.ticker} — ${a.setor}</option>`).join('');
  // Data padrão = hoje
  const today = new Date().toISOString().slice(0,10);
  document.getElementById('cData').value = today;
  // Limpa campos
  ['cQtd','cPreco','cCorretagem','cObs'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  document.getElementById('compraPreviewPanel').style.display = 'none';
  renderHistoricoCompras();
}

function onAtivoChange() {
  calcPreview();
}

function calcPreview() {
  const ticker  = document.getElementById('cAtivo').value;
  const qtdNova = parseFloat(document.getElementById('cQtd').value) || 0;
  const precoNovo = parseFloat(document.getElementById('cPreco').value) || 0;
  const corretagem = parseFloat(document.getElementById('cCorretagem').value) || 0;

  const panel = document.getElementById('compraPreviewPanel');
  const preview = document.getElementById('compraPreview');

  if (!ticker || !qtdNova || !precoNovo) { panel.style.display='none'; return; }

  const ativo = portfolio.find(a => a.ticker === ticker);
  if (!ativo) { panel.style.display='none'; return; }

  // Cálculos
  const qtdAtual   = ativo.qtd;
  const pmAtual    = ativo.preco;
  const totalAtual = qtdAtual * pmAtual;
  const totalNovo  = qtdNova * precoNovo + corretagem;
  const qtdTotal   = qtdAtual + qtdNova;
  const pmNovo     = (totalAtual + totalNovo) / qtdTotal;
  const totalInvest = qtdTotal * pmNovo;
  const varPM      = pmNovo - pmAtual;
  const varPMPct   = (varPM / pmAtual) * 100;

  panel.style.display = 'block';
  preview.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:1rem;margin-bottom:1rem">
      <div style="background:rgba(255,255,255,0.02);border:1px solid var(--border);border-radius:8px;padding:.9rem 1rem">
        <div style="font-size:.65rem;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.35rem">Qtd. Atual</div>
        <div style="font-size:1.1rem;font-weight:600;color:var(--text2)">${qtdAtual.toLocaleString('pt-BR')}</div>
      </div>
      <div style="background:rgba(201,168,76,0.06);border:1px solid rgba(201,168,76,0.2);border-radius:8px;padding:.9rem 1rem">
        <div style="font-size:.65rem;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.35rem">＋ Qtd. Comprada</div>
        <div style="font-size:1.1rem;font-weight:600;color:var(--gold)">${qtdNova.toLocaleString('pt-BR')}</div>
      </div>
      <div style="background:rgba(76,175,130,0.06);border:1px solid rgba(76,175,130,0.2);border-radius:8px;padding:.9rem 1rem">
        <div style="font-size:.65rem;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.35rem">= Qtd. Total</div>
        <div style="font-size:1.1rem;font-weight:600;color:var(--green)">${qtdTotal.toLocaleString('pt-BR')}</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:1rem">
      <div style="background:rgba(255,255,255,0.02);border:1px solid var(--border);border-radius:8px;padding:.9rem 1rem">
        <div style="font-size:.65rem;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.35rem">PM Atual</div>
        <div style="font-size:1.1rem;font-weight:600;color:var(--text2)">${fmtBRL(pmAtual)}</div>
      </div>
      <div style="background:rgba(201,168,76,0.06);border:1px solid rgba(201,168,76,0.2);border-radius:8px;padding:.9rem 1rem">
        <div style="font-size:.65rem;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.35rem">Preço Pago</div>
        <div style="font-size:1.1rem;font-weight:600;color:var(--gold)">${fmtBRL(precoNovo)}</div>
      </div>
      <div style="background:rgba(76,175,130,0.06);border:1px solid rgba(76,175,130,0.2);border-radius:8px;padding:.9rem 1rem">
        <div style="font-size:.65rem;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.35rem">Novo PM</div>
        <div style="font-size:1.1rem;font-weight:600;color:var(--green)">${fmtBRL(pmNovo)}</div>
        <div style="font-size:.72rem;margin-top:.2rem;color:${varPM<=0?'var(--green)':'var(--red)'}">${varPM<=0?'▼':'▲'} ${fmtBRL(Math.abs(varPM))} (${Math.abs(varPMPct).toFixed(2)}%)</div>
      </div>
      <div style="background:rgba(255,255,255,0.02);border:1px solid var(--border);border-radius:8px;padding:.9rem 1rem">
        <div style="font-size:.65rem;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.35rem">Total Investido</div>
        <div style="font-size:1.1rem;font-weight:600;color:var(--text)">${fmtBRL(totalInvest)}</div>
        <div style="font-size:.72rem;color:var(--text3);margin-top:.2rem">+${fmtBRL(totalNovo)} nesta compra</div>
      </div>
      ${corretagem>0?`<div style="background:rgba(255,255,255,0.02);border:1px solid var(--border);border-radius:8px;padding:.9rem 1rem">
        <div style="font-size:.65rem;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.35rem">Corretagem</div>
        <div style="font-size:1.1rem;font-weight:600;color:var(--red)">${fmtBRL(corretagem)}</div>
        <div style="font-size:.72rem;color:var(--text3);margin-top:.2rem">Inclusa no PM</div>
      </div>`:''}
    </div>`;
}

function lancarCompra() {
  const ticker    = document.getElementById('cAtivo').value;
  const qtdNova   = parseFloat(document.getElementById('cQtd').value);
  const precoNovo = parseFloat(document.getElementById('cPreco').value);
  const corretagem = parseFloat(document.getElementById('cCorretagem').value) || 0;
  const data      = document.getElementById('cData').value;
  const obs       = document.getElementById('cObs').value.trim();

  if (!ticker) { showToast('Selecione um ativo','red'); return; }
  if (!qtdNova || qtdNova <= 0) { showToast('Informe a quantidade comprada','red'); return; }
  if (!precoNovo || precoNovo <= 0) { showToast('Informe o preço pago','red'); return; }

  const ativo = portfolio.find(a => a.ticker === ticker);
  if (!ativo) { showToast('Ativo não encontrado','red'); return; }

  const qtdAtual   = ativo.qtd;
  const pmAtual    = ativo.preco;
  const totalAtual = qtdAtual * pmAtual;
  const totalNovo  = qtdNova * precoNovo + corretagem;
  const qtdTotal   = qtdAtual + qtdNova;
  const pmNovo     = (totalAtual + totalNovo) / qtdTotal;

  // Guarda dados para confirmação
  compraConfirmData = { ticker, qtdNova, precoNovo, corretagem, data, obs,
    qtdAtual, pmAtual, qtdTotal, pmNovo, totalNovo };

  // Mostra modal de confirmação
  document.getElementById('compraConfirmBody').innerHTML = `
    <div style="background:rgba(255,255,255,0.02);border:1px solid var(--border);border-radius:10px;padding:1.1rem;margin-bottom:1rem">
      <div style="font-size:.75rem;color:var(--text3);margin-bottom:.75rem;text-transform:uppercase;letter-spacing:.08em">Resumo da operação — ${ticker}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem;font-size:.83rem">
        <div style="color:var(--text2)">Qtd. atual</div><div style="color:var(--text);text-align:right">${qtdAtual.toLocaleString('pt-BR')} ações</div>
        <div style="color:var(--text2)">Qtd. comprada</div><div style="color:var(--gold);text-align:right;font-weight:600">+ ${qtdNova.toLocaleString('pt-BR')} ações</div>
        <div style="color:var(--text2)">Qtd. total</div><div style="color:var(--green);text-align:right;font-weight:700">${qtdTotal.toLocaleString('pt-BR')} ações</div>
        <div style="height:1px;background:var(--border);grid-column:span 2;margin:.2rem 0"></div>
        <div style="color:var(--text2)">PM atual</div><div style="color:var(--text2);text-align:right">${fmtBRL(pmAtual)}</div>
        <div style="color:var(--text2)">Preço pago</div><div style="color:var(--gold);text-align:right">${fmtBRL(precoNovo)}${corretagem>0?' + '+fmtBRL(corretagem)+' corret.':''}</div>
        <div style="color:var(--text2);font-weight:600">Novo PM</div><div style="color:var(--green);text-align:right;font-weight:700">${fmtBRL(pmNovo)}</div>
        <div style="height:1px;background:var(--border);grid-column:span 2;margin:.2rem 0"></div>
        <div style="color:var(--text2)">Total desta compra</div><div style="color:var(--text);text-align:right">${fmtBRL(totalNovo)}</div>
        ${data?`<div style="color:var(--text2)">Data</div><div style="color:var(--text3);text-align:right">${fmtDate(data)}</div>`:''}
        ${obs?`<div style="color:var(--text2)">Obs.</div><div style="color:var(--text3);text-align:right;font-size:.78rem">${obs}</div>`:''}
      </div>
    </div>
    <p style="font-size:.78rem;color:var(--text3);line-height:1.6">A carteira será atualizada com o novo preço médio ponderado e a quantidade total.</p>`;

  document.getElementById('compraConfirmModal').classList.add('open');
}

function confirmarCompra() {
  if (!compraConfirmData) return;
  const { ticker, qtdNova, precoNovo, corretagem, data, obs,
          qtdAtual, pmAtual, qtdTotal, pmNovo, totalNovo } = compraConfirmData;

  const idx = portfolio.findIndex(a => a.ticker === ticker);
  if (idx < 0) return;

  // Salva histórico antes de atualizar
  if (!portfolio[idx].historicoCompras) portfolio[idx].historicoCompras = [];
  portfolio[idx].historicoCompras.push({
    id: Date.now(),
    data, obs, qtdComprada: qtdNova, precoCompra: precoNovo,
    corretagem, pmAnterior: pmAtual, pmNovo: pmNovo, totalPago: totalNovo
  });

  // Atualiza ativo
  portfolio[idx].qtd   = qtdTotal;
  portfolio[idx].preco = pmNovo;
  portfolio[idx].updatedAt = Date.now();

  // Registra também em aportes para histórico financeiro
  aportes.push({
    id: Date.now(), data, tipo: 'Aporte',
    valor: totalNovo,
    ativo: ticker,
    obs: `Compra de ${qtdNova} ações a ${fmtBRL(precoNovo)}${obs ? ' — ' + obs : ''}`
  });
  aportes.sort((a,b) => b.data.localeCompare(a.data));

  save();
  closeModal('compraConfirmModal');
  compraConfirmData = null;
  limparCompra();
  renderHistoricoCompras();
  showToast(`✅ Compra de ${ticker} lançada! Novo PM: ${fmtBRL(pmNovo)}`);
}

function limparCompra() {
  document.getElementById('cAtivo').value = '';
  ['cQtd','cPreco','cCorretagem','cObs'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('cData').value = new Date().toISOString().slice(0,10);
  document.getElementById('compraPreviewPanel').style.display = 'none';
  compraConfirmData = null;
}

function renderHistoricoCompras(filter='') {
  // Coleta todas as compras de todos os ativos
  const todas = [];
  portfolio.forEach(a => {
    (a.historicoCompras || []).forEach(c => {
      todas.push({ ...c, ticker: a.ticker });
    });
  });
  todas.sort((a,b) => b.data.localeCompare(a.data));

  const filtered = filter
    ? todas.filter(c => c.ticker.includes(filter.toUpperCase()))
    : todas;

  const tbody = document.getElementById('historicoComprasTable');
  const empty = document.getElementById('historicoComprasEmpty');
  if (!tbody) return;

  if (!filtered.length) {
    tbody.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  tbody.innerHTML = filtered.map(c => `
    <tr>
      <td>${fmtDate(c.data)}</td>
      <td><strong>${c.ticker}</strong></td>
      <td style="color:var(--gold);font-weight:600">+ ${c.qtdComprada.toLocaleString('pt-BR')}</td>
      <td>${fmtBRL(c.precoCompra)}</td>
      <td style="color:var(--text)">${fmtBRL(c.totalPago)}</td>
      <td style="color:var(--text3)">${c.corretagem > 0 ? fmtBRL(c.corretagem) : '—'}</td>
      <td style="color:var(--text3)">${fmtBRL(c.pmAnterior)}</td>
      <td style="color:var(--green);font-weight:600">${fmtBRL(c.pmNovo)}</td>
      <td style="font-size:.76rem;color:var(--text3)">${c.obs || '—'}${c.notaId?' <span style=\"color:var(--gold);font-size:.65rem\">(nota IR)</span>':''}</td>
      <td><button class="icon-btn d" onclick="excluirCompraHistorico('${c.ticker}',${c.id})" title="Excluir">✕</button></td>
    </tr>`).join('');
}

async function excluirCompraHistorico(ticker, id) {
  if (!confirm(`Excluir esta compra de ${ticker} do histórico? A quantidade e o preço médio do ativo serão recalculados.`)) return;
  const r = await apiFetch('/api/excluir-compra', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ ticker, id })
  });
  const j = await r.json();
  if (j.ok) {
    showToast('🗑 Compra excluída — posição recalculada');
    const rd = await apiFetch('/api/data');
    const fresh = await rd.json();
    portfolio = fresh.portfolio || [];
    renderHistoricoCompras();
  } else {
    showToast('❌ Erro: ' + j.error, 'red');
  }
}

function filtrarHistoricoCompras(v) {
  renderHistoricoCompras(v);
}


// ══════════════════════════════════════════════
// DECLARAÇÃO DE IR
// ══════════════════════════════════════════════
let irNotaAtual = null;
let irEditandoId = null;

async function renderIR() {
  const c = document.getElementById('irContainer');
  const chk = await apiFetch('/api/ir-check').then(r=>r.json()).catch(()=>({pdf_support:false,pdf_gen_support:false}));
  const irData = await apiFetch('/api/ir-data').then(r=>r.json()).catch(()=>({notas:[],posicoes:{}}));
  const notas = irData.notas||[];
  const anos = [...new Set(notas.map(n=>n.data_pregao?.slice(-4)).filter(Boolean))].sort().reverse();
  const anoSel = anos[0]||new Date().getFullYear().toString();

  c.innerHTML = `
  <div class="form-panel" style="margin-bottom:1.5rem">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:1rem">
      <div>
        <div class="form-panel-title" style="margin-bottom:.5rem">📋 Importar Nota de Corretagem (Rico)</div>
        <p style="font-size:.8rem;color:var(--text2);line-height:1.6;max-width:520px">
          Selecione o PDF da nota. Linhas do mesmo ativo são consolidadas automaticamente. O PDF é descartado após leitura.
        </p>
        ${!chk.pdf_support?'<div style="margin-top:.75rem;padding:.6rem .9rem;background:rgba(224,92,92,.08);border:1px solid rgba(224,92,92,.2);border-radius:7px;font-size:.78rem;color:var(--red)">⚠ Execute: <code>pip install pdfplumber</code> e reinicie o Portfex.</div>':''}
        ${!chk.pdf_gen_support?'<div style="margin-top:.5rem;padding:.6rem .9rem;background:rgba(247,201,79,.08);border:1px solid rgba(247,201,79,.2);border-radius:7px;font-size:.78rem;color:var(--gold)">⚠ Para gerar PDF execute: <code>pip install reportlab</code> e reinicie o Portfex.</div>':''}
      </div>
      <label class="btn-gold" style="cursor:pointer;display:inline-flex;align-items:center;gap:.5rem;${!chk.pdf_support?'opacity:.4;pointer-events:none':''}">
        📄 Selecionar PDF
        <input type="file" accept=".pdf" onchange="processarNota(this)" style="display:none" ${!chk.pdf_support?'disabled':''}>
      </label>
    </div>
    <div id="notaPreview" style="margin-top:1rem"></div>
  </div>

  <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.5rem;flex-wrap:wrap">
    <div class="section-title">Ano Fiscal</div>
    <select class="search-field" style="width:90px" id="irAnoSel" onchange="renderIRBody(this.value)">
      ${anos.length?anos.map(a=>`<option value="${a}" ${a===anoSel?'selected':''}>${a}</option>`).join(''):`<option value="${anoSel}">${anoSel}</option>`}
    </select>
    <button class="btn-gold" style="padding:.35rem 1rem;font-size:.78rem" onclick="gerarPDF()" id="btnPDF">⬇ Gerar PDF</button>
    <button class="btn-ghost" style="padding:.35rem 1rem;font-size:.78rem" onclick="gerarRelatorio()">⬇ Gerar .txt</button>
  </div>
  <div id="irBody"></div>`;

  renderIRBody(anoSel, irData.posicoes||{}, notas);
}

async function renderIRBody(ano, posicoes, notas) {
  if(!posicoes||!notas) {
    const d = await apiFetch('/api/ir-data').then(r=>r.json());
    posicoes=d.posicoes||{}; notas=d.notas||[];
  }
  const el = document.getElementById('irBody');
  if(!el) return;
  const posAno = Object.values(posicoes).filter(p=>p.ano===ano);
  const notasAno = notas.filter(n=>n.data_pregao?.endsWith(ano));
  const todasVendas = posAno.flatMap(p=>p.vendas||[]);
  const vendasMes = {};
  todasVendas.forEach(v=>{
    const mes=v.data?.slice(3,10); if(!mes) return;
    if(!vendasMes[mes]) vendasMes[mes]={lucro:0,total:0};
    vendasMes[mes].total+=v.valor_venda; vendasMes[mes].lucro+=v.lucro;
  });

  el.innerHTML = `
  ${posAno.filter(p=>p.qtd>0).length?`
  <div class="section-header"><div class="section-title">Bens e Direitos · ${ano}</div></div>
  <div class="glass-table" style="margin-bottom:1.5rem">
    <div class="glass-table-header"><div class="glass-table-title">Posição em 31/12/${ano} — Código 31 (Ações) / 73 (FIIs)</div></div>
    <div style="overflow-x:auto"><table>
      <thead><tr><th>Ticker</th><th>Qtd. Final</th><th>Custo Total</th><th>PM</th><th>Como declarar</th></tr></thead>
      <tbody>${posAno.filter(p=>p.qtd>0).map(p=>`<tr>
        <td><strong>${p.ticker}</strong></td>
        <td>${p.qtd.toLocaleString('pt-BR')}</td>
        <td style="color:var(--text)">${fmtBRL(p.custo_total)}</td>
        <td style="color:var(--gold)">${fmtBRL(p.pm)}</td>
        <td style="font-size:.75rem;color:var(--text2)">Qtd: <b>${p.qtd}</b> · Custo: <b>${fmtBRL(p.custo_total)}</b></td>
      </tr>`).join('')}</tbody>
    </table></div>
  </div>`:''}

  ${Object.keys(vendasMes).length?`
  <div class="section-header"><div class="section-title">Renda Variável · Apuração Mensal · ${ano}</div></div>
  <div class="glass-table" style="margin-bottom:1.5rem">
    <div class="glass-table-header"><div class="glass-table-title">Resultado por mês — base para DARF</div></div>
    <div style="overflow-x:auto"><table>
      <thead><tr><th>Mês/Ano</th><th>Total Vendido</th><th>Resultado</th><th>Situação</th></tr></thead>
      <tbody>${Object.entries(vendasMes).sort().map(([mes,v])=>{
        const is=v.total<=20000&&v.lucro>0;
        return `<tr>
          <td style="font-weight:600">${mes}</td>
          <td>${fmtBRL(v.total)}</td>
          <td style="color:${v.lucro>=0?'var(--green)':'var(--red)'};font-weight:600">${fmtBRL(v.lucro)}</td>
          <td style="font-size:.75rem">${is?'<span style="color:var(--green)">✓ Isento — Rendimentos Isentos</span>':v.lucro>0?'<span style="color:var(--gold)">⚠ Tributável — DARF</span>':'<span style="color:var(--text3)">Prejuízo — compensar</span>'}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
  </div>`:''}

  <div style="margin-bottom:1.5rem;padding:.9rem 1.1rem;background:rgba(201,168,76,.06);border:1px solid rgba(201,168,76,.15);border-radius:9px;font-size:.8rem;color:var(--text2);line-height:1.8">
    <strong style="color:var(--gold)">💡 IRPF:</strong>
    Bens e Direitos → Código 31/73 · CNPJ · qtd · custo |
    Renda Variável → resultado mensal |
    Isentos (vendas ≤ R$20k com lucro) → código 20
  </div>

  <div class="section-header"><div class="section-title">Notas Importadas · ${ano}</div></div>
  ${notasAno.length?`
  <div class="glass-table">
    <div class="glass-table-header"><div class="glass-table-title">${notasAno.length} nota(s) importada(s)</div></div>
    <div style="overflow-x:auto"><table>
      <thead><tr><th>Nota</th><th>Data</th><th>Negócios</th><th>Compras</th><th>Vendas</th><th>Líquido</th><th>Ações</th></tr></thead>
      <tbody>${notasAno.map(n=>{
        const cv=n.negocios_confirmados||[];
        const c=cv.filter(x=>x.cv==='C').reduce((s,x)=>s+x.valor_operacao,0);
        const v=cv.filter(x=>x.cv==='V').reduce((s,x)=>s+x.valor_operacao,0);
        return `<tr>
          <td><strong>${n.nr_nota}</strong></td>
          <td>${n.data_pregao}</td>
          <td>${cv.length} (${cv.map(x=>x.ticker||x.titulo.split(' ')[0]).join(', ')})</td>
          <td style="color:var(--green)">${c>0?fmtBRL(c):'—'}</td>
          <td style="color:var(--red)">${v>0?fmtBRL(v):'—'}</td>
          <td style="font-weight:600">${fmtBRL(n.liquido)}</td>
          <td style="white-space:nowrap">
            <button class="icon-btn e" onclick="editarNota('${n.id||''}')" title="Editar">✎</button>
            <button class="icon-btn d" onclick="excluirNota('${n.id||''}')" title="Excluir">✕</button>
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
  </div>`:'<div style="color:var(--text3);font-size:.84rem">Nenhuma nota importada para '+ano+'.</div>'}`;
}

async function processarNota(input) {
  const file = input.files[0]; if(!file) return;
  const preview = document.getElementById('notaPreview');
  preview.innerHTML = '<div style="color:var(--gold);font-size:.82rem">⏳ Lendo PDF e consolidando negócios...</div>';
  input.value = '';
  const buf = await file.arrayBuffer();
  const nota = await apiFetch('/api/nota-pdf',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:new Uint8Array(buf)}).then(r=>r.json());
  irNotaAtual = nota;
  if(nota.erros?.length){preview.innerHTML=`<div style="color:var(--red);font-size:.82rem">❌ ${nota.erros.join(' | ')}</div>`;return;}
  if(!nota.negocios?.length){preview.innerHTML='<div style="color:var(--gold);font-size:.82rem">⚠ Nenhum negócio encontrado.</div>';return;}
  mostrarFormularioNota(nota, preview);
}

function mostrarFormularioNota(nota, container) {
  container.innerHTML = `
  <div style="background:rgba(255,255,255,.02);border:1px solid var(--border);border-radius:10px;padding:1.1rem;margin-top:.5rem">
    <div style="display:flex;justify-content:space-between;margin-bottom:.9rem;flex-wrap:wrap;gap:.5rem">
      <div>
        <div style="font-size:.72rem;color:var(--text3)">Nota ${nota.nr_nota} · ${nota.data_pregao}</div>
        <div style="font-size:.85rem;color:var(--text);margin-top:.2rem">${nota.cliente}</div>
      </div>
      <div style="font-size:.82rem;color:var(--text3)">Líquido: <strong style="color:var(--text)">${fmtBRL(nota.liquido)}</strong></div>
    </div>
    <div style="overflow-x:auto"><table>
      <thead><tr><th>C/V</th><th>Título</th><th>Ticker</th><th>Qtd Total</th><th>Preço</th><th>Valor Op.</th><th>Taxas</th><th>PM Real</th></tr></thead>
      <tbody>${nota.negocios.map((n,i)=>`<tr>
        <td><span style="color:${n.cv==='C'?'var(--green)':'var(--red)'};font-weight:700">${n.cv==='C'?'COMPRA':'VENDA'}</span></td>
        <td style="font-size:.75rem">${n.titulo}${n.fracionario?' <span style="color:var(--text3);font-size:.65rem">FRAC</span>':''}</td>
        <td><input style="width:80px;padding:.2rem .4rem;border-radius:4px;border:1px solid var(--border);background:rgba(255,255,255,.04);color:var(--gold);font-size:.78rem;font-weight:600;text-align:center" value="${n.ticker}" onchange="irNotaAtual.negocios[${i}].ticker=this.value.toUpperCase()" placeholder="TICKER"></td>
        <td style="font-weight:700;color:var(--text)">${n.qtd.toLocaleString('pt-BR')}</td>
        <td>${fmtBRL(n.preco)}</td>
        <td>${fmtBRL(n.valor_operacao)}</td>
        <td style="color:var(--text3);font-size:.78rem">${fmtBRL(n.taxas_prop)}</td>
        <td style="color:var(--gold)">${fmtBRL(n.pm_real)}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    <div style="font-size:.74rem;color:var(--text3);margin-top:.6rem">
      ✓ Linhas do mesmo ativo foram consolidadas automaticamente. Ajuste os tickers se necessário.
    </div>
    <div style="display:flex;gap:.75rem;margin-top:.9rem">
      <button class="btn-gold" onclick="confirmarNota()">✓ Confirmar e Salvar</button>
      <button class="btn-ghost" onclick="document.getElementById('notaPreview').innerHTML='';irNotaAtual=null;irEditandoId=null">Cancelar</button>
    </div>
  </div>`;
}

async function confirmarNota() {
  if(!irNotaAtual) return;
  const negs = irNotaAtual.negocios.map(n => ({
    ...n,
    custo_total: n.custo_total || (n.valor_operacao + (n.taxas_prop||0)),
    pm_real: n.pm_real || n.preco,
    ticker: n.ticker || '',
  }));
  const payload = {...irNotaAtual, negocios_confirmados: negs};
  if(irEditandoId) payload.id = irEditandoId;
  try {
    const resp = await apiFetch('/api/ir-salvar',{
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)
    });
    const j = await resp.json();
    if(j.ok){
      showToast('✅ Nota salva! Posição de Meus Ativos atualizada.');
      irNotaAtual=null;irEditandoId=null;
      // Recarrega portfolio (atualizado automaticamente pelo backend) — aportes não são alterados
      const rd = await apiFetch('/api/data');
      const fresh = await rd.json();
      portfolio = fresh.portfolio||[];
      renderIR();
    } else {
      showToast('❌ Erro: '+(j.error||'desconhecido'),'red');
    }
  } catch(e) {
    showToast('❌ Erro de conexão: '+e.message,'red');
  }
}

async function editarNota(id) {
  const irData = await apiFetch('/api/ir-data').then(r=>r.json());
  const nota = irData.notas?.find(n=>n.id===id);
  if(!nota){showToast('Nota não encontrada','red');return;}
  // Reconstrói formato para edição
  irNotaAtual = {...nota, negocios: nota.negocios_confirmados||[]};
  irEditandoId = id;
  const preview = document.getElementById('notaPreview');
  if(preview) mostrarFormularioNota(irNotaAtual, preview);
  preview?.scrollIntoView({behavior:'smooth'});
}

async function excluirNota(id) {
  if(!confirm('Excluir esta nota? As posições do ano serão recalculadas.')) return;
  const j = await apiFetch('/api/ir-excluir',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})}).then(r=>r.json());
  if(j.ok){showToast('🗑 Nota excluída','red');renderIR();}
  else showToast('❌ Erro: '+j.error,'red');
}

async function gerarPDF() {
  const ano = document.getElementById('irAnoSel')?.value || new Date().getFullYear().toString();
  const btn = document.getElementById('btnPDF');
  btn.disabled = true;
  btn.textContent = '⏳ Gerando PDF...';
  try {
    const resp = await apiFetch(`/api/ir-pdf/${ano}`);
    if (!resp.ok) {
      const err = await resp.text();
      showToast('❌ Erro: ' + err, 'red');
      return;
    }
    const blob = await resp.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Portfex_IR_${ano}.pdf`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('✅ PDF gerado com sucesso!');
  } catch(e) {
    showToast('❌ Erro ao gerar PDF: ' + e.message, 'red');
  } finally {
    btn.disabled = false;
    btn.textContent = '⬇ Gerar PDF';
  }
}

async function gerarRelatorio() {
  const ano = document.getElementById('irAnoSel')?.value||new Date().getFullYear().toString();
  const d = await apiFetch('/api/ir-data').then(r=>r.json());
  const pos = Object.values(d.posicoes||{}).filter(p=>p.ano===ano);
  const notas = (d.notas||[]).filter(n=>n.data_pregao?.endsWith(ano));
  if(!pos.length&&!notas.length){showToast('Nenhum dado para '+ano,'gold');return;}
  const vendas = pos.flatMap(p=>p.vendas||[]);
  const vMes = {};
  vendas.forEach(v=>{const m=v.data?.slice(3,10);if(!m)return;if(!vMes[m])vMes[m]={l:0,t:0};vMes[m].t+=v.valor_venda;vMes[m].l+=v.lucro;});
  let txt = `PORTFEX — RELATÓRIO IR ${ano}\nGerado: ${new Date().toLocaleString('pt-BR')}\n${'='.repeat(55)}\n\n`;
  txt += `1. BENS E DIREITOS (31/12/${ano})\n${'-'.repeat(40)}\n`;
  pos.filter(p=>p.qtd>0).forEach(p=>{txt+=`${p.ticker}\n  Qtd: ${p.qtd} | Custo: ${fmtBRL(p.custo_total)} | PM: ${fmtBRL(p.pm)}\n\n`;});
  txt += `\n2. RENDA VARIÁVEL — MENSAL\n${'-'.repeat(40)}\n`;
  Object.entries(vMes).sort().forEach(([m,v])=>{txt+=`${m}: Vendido=${fmtBRL(v.t)} | Resultado=${fmtBRL(v.l)}${v.t<=20000&&v.l>0?' | ISENTO':v.l>0?' | TRIBUTÁVEL — DARF':''}\n`;});
  txt += `\n3. NOTAS IMPORTADAS\n${'-'.repeat(40)}\n`;
  notas.forEach(n=>{
    txt+=`Nota ${n.nr_nota} — ${n.data_pregao} — Líq: ${fmtBRL(n.liquido)}\n`;
    n.negocios_confirmados?.forEach(neg=>{txt+=`  ${neg.cv==='C'?'C':'V'} ${neg.qtd}x ${neg.ticker||neg.titulo.split(' ')[0]} @ ${fmtBRL(neg.preco)} = ${fmtBRL(neg.valor_operacao)} (PM: ${fmtBRL(neg.pm_real)})\n`;});
  });
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([txt],{type:'text/plain;charset=utf-8'}));
  a.download=`Portfex_IR_${ano}.txt`; a.click(); URL.revokeObjectURL(a.href);
  showToast('✅ Relatório gerado!');
}

function encerrarApp(){
  if(!confirm('Encerrar o Portfex?\n\nO app será fechado corretamente.')) return;
  fetch('/api/shutdown').finally(()=>{
    setTimeout(()=>window.close(), 600);
  });
}


// ══════════════════════════════════════════════
// CONCENTRAÇÃO — SETOR, ATIVO, RADAR
// ══════════════════════════════════════════════
const MAX_CONC = 5; // % máximo recomendado por setor/ativo

function concColor(pct) {
  if (pct <= MAX_CONC)   return 'var(--green)';
  if (pct <= MAX_CONC*1.6) return 'var(--gold)';
  return 'var(--red)';
}
function concClass(pct) {
  if (pct <= MAX_CONC)     return 'ok';
  if (pct <= MAX_CONC*1.6) return 'warn';
  return 'bad';
}
function concBadge(pct) {
  const cls = concClass(pct);
  const lbl = pct <= MAX_CONC ? '✓ OK' : pct <= MAX_CONC*1.6 ? '⚠ Atenção' : '✕ Excesso';
  return `<span class="conc-badge cb-${cls}">${lbl}</span>`;
}

// ── Barras por Setor ────────────────────────────────────────────
function renderSetorBars(total) {
  const el = document.getElementById('setorBars');
  if (!el) return;
  const bySetor = {};
  portfolio.forEach(a => {
    const v = a.qtd * a.preco;
    bySetor[a.setor] = (bySetor[a.setor]||0) + v;
  });
  const sorted = Object.entries(bySetor).sort((a,b)=>b[1]-a[1]);
  if (!sorted.length) { el.innerHTML = '<div style="color:var(--text3);font-size:.8rem">Nenhum ativo cadastrado.</div>'; return; }

  // Limit line at 5%
  const limitW = Math.min(MAX_CONC, 100);

  el.innerHTML = sorted.map(([setor, val]) => {
    const pct = total > 0 ? (val/total)*100 : 0;
    const color = concColor(pct);
    const barW = Math.min(pct, 100);
    return `<div class="conc-row">
      <div style="font-size:.78rem;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${setor}">${setor}</div>
      <div class="conc-bar-track">
        <div class="conc-bar-fill" style="width:${barW}%;background:${color}"></div>
        <div class="conc-limit" style="left:${limitW}%"></div>
      </div>
      <div class="conc-pct" style="color:${color}">${pct.toFixed(1)}%</div>
      ${concBadge(pct)}
    </div>`;
  }).join('');
}

// ── Gráfico por Ativo — Renda Variável ─────────────────────────
function renderAtivoRVChart(total) {
  if (charts.chartAtivoRV) { charts.chartAtivoRV.destroy(); delete charts.chartAtivoRV; }
  const el = document.getElementById('chartAtivoRV');
  if (!el) return;

  // Apenas ativos de renda variável (Ações, FII, Internacional, Cripto)
  const rv = portfolio
    .filter(a => ['Ações','FII','Internacional','Cripto'].includes(a.classe))
    .sort((a,b) => (b.qtd*b.preco) - (a.qtd*a.preco));

  if (!rv.length) {
    el.parentElement.innerHTML = '<div style="color:var(--text3);font-size:.8rem;padding:1rem">Nenhum ativo de renda variável.</div>';
    return;
  }

  const pcts  = rv.map(a => parseFloat(((a.qtd*a.preco/total)*100).toFixed(2)));
  const colors = pcts.map(p => concColor(p));

  charts.chartAtivoRV = new Chart(el, {
    type: 'bar',
    data: {
      labels: rv.map(a => a.ticker),
      datasets: [{
        data: pcts,
        backgroundColor: colors.map(c =>
          c === 'var(--green)' ? 'rgba(76,175,130,.75)' :
          c === 'var(--gold)'  ? 'rgba(201,168,76,.75)' :
                                 'rgba(224,92,92,.75)'
        ),
        borderRadius: 4, borderSkipped: false,
      }]
    },
    options: {
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const a = rv[ctx.dataIndex];
              return ` ${ctx.parsed.x.toFixed(2)}% — ${fmtBRL(a.qtd*a.preco)}`;
            }
          }
        },
        // Linha de referência em 5%
        annotation: undefined
      },
      scales: {
        x: {
          ticks: { color:'#5a5650', font:{size:9}, callback: v => v+'%' },
          grid: { color:'rgba(255,255,255,.04)' },
          max: Math.max(...pcts, MAX_CONC*2),
        },
        y: { ticks: { color:'#9a9488', font:{size:10} }, grid: { display:false } }
      },
      responsive: true, maintainAspectRatio: false
    }
  });

  // Draw 5% limit line manually after render
  el.addEventListener('animationend', () => {}, {once:true});
}

// ── Radar de Concentração (grid de cards) ───────────────────────
function renderConcentracaoGrid(total) {
  const el = document.getElementById('concentracaoGrid');
  if (!el) return;

  // Top ativos por peso
  const topAtivos = [...portfolio]
    .sort((a,b) => (b.qtd*b.preco)-(a.qtd*a.preco))
    .slice(0, 12)
    .map(a => ({ ticker: a.ticker, classe: a.classe, setor: a.setor, pct: (a.qtd*a.preco/total)*100 }));

  // Setores
  const bySetor = {};
  portfolio.forEach(a => { bySetor[a.setor]=(bySetor[a.setor]||0)+a.qtd*a.preco; });
  const topSetores = Object.entries(bySetor)
    .sort((a,b)=>b[1]-a[1]).slice(0,6)
    .map(([s,v]) => ({ setor:s, pct:(v/total)*100 }));

  const overAtivos  = topAtivos.filter(a => a.pct > MAX_CONC).length;
  const overSetores = topSetores.filter(s => s.pct > MAX_CONC).length;

  // Summary row
  const summaryColor = (overAtivos + overSetores) === 0 ? 'var(--green)' : overAtivos + overSetores <= 2 ? 'var(--gold)' : 'var(--red)';
  const summaryTxt   = (overAtivos + overSetores) === 0
    ? '✓ Carteira dentro dos limites de concentração'
    : `⚠ ${overAtivos} ativo(s) e ${overSetores} setor(es) acima de ${MAX_CONC}%`;

  el.innerHTML = `
    <div style="padding:.6rem .9rem;border-radius:7px;margin-bottom:.9rem;background:rgba(255,255,255,.02);border:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.5rem">
      <div style="font-size:.82rem;color:${summaryColor};font-weight:600">${summaryTxt}</div>
      <div style="font-size:.75rem;color:var(--text3)">Limite recomendado: ${MAX_CONC}% por ativo e por setor</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
      <div>
        <div style="font-size:.68rem;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.6rem">Top Ativos — Concentração</div>
        ${topAtivos.map(a => `
          <div class="conc-card ${concClass(a.pct)}" style="margin-bottom:.4rem;display:flex;justify-content:space-between;align-items:center">
            <div>
              <div style="font-size:.82rem;font-weight:600;color:var(--text)">${a.ticker}</div>
              <div style="font-size:.68rem;color:var(--text3)">${a.setor}</div>
            </div>
            <div style="text-align:right">
              <div style="font-size:1rem;font-weight:700;color:${concColor(a.pct)}">${a.pct.toFixed(1)}%</div>
              ${concBadge(a.pct)}
            </div>
          </div>`).join('')}
      </div>
      <div>
        <div style="font-size:.68rem;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.6rem">Top Setores — Concentração</div>
        ${topSetores.map(s => `
          <div class="conc-card ${concClass(s.pct)}" style="margin-bottom:.4rem;display:flex;justify-content:space-between;align-items:center">
            <div style="font-size:.82rem;font-weight:600;color:var(--text)">${s.setor}</div>
            <div style="text-align:right">
              <div style="font-size:1rem;font-weight:700;color:${concColor(s.pct)}">${s.pct.toFixed(1)}%</div>
              ${concBadge(s.pct)}
            </div>
          </div>`).join('')}
      </div>
    </div>`;
}


// ══════════════════════════════════════════════
// PROVENTOS FUTUROS — busca automática via yfinance
// ══════════════════════════════════════════════
async function renderProventos() {
  const c = document.getElementById('proventosContainer');
  c.innerHTML = `<div style="color:var(--gold);font-size:.85rem;padding:1rem">⏳ Buscando proventos anunciados...</div>`;

  const resp = await apiFetch('/api/proventos').then(r=>r.json()).catch(()=>({ok:false,proventos:[]}));

  if (!resp.ok && !resp.proventos) {
    c.innerHTML = '<div class="form-panel" style="text-align:center;padding:2rem"><div style="font-size:2rem">💰</div><p style="color:var(--text2);margin-top:1rem">Nenhum provento encontrado para sua carteira no momento.</p></div>';
    return;
  }

  const itens = resp.proventos || [];

  if (!itens.length) {
    c.innerHTML = `
    <div class="form-panel" style="margin-bottom:1rem">
      <div class="form-panel-title" style="margin-bottom:.5rem">💰 Proventos Futuros — Dados da Carteira</div>
      <p style="font-size:.82rem;color:var(--text2)">Nenhum provento anunciado encontrado para os ativos da sua carteira no momento.</p>
      <button class="btn-gold" onclick="renderProventos()" style="margin-top:.75rem">↻ Atualizar</button>
    </div>`;
    return;
  }

  const total = itens.reduce((s,p) => s + (p.totalReceber||0), 0);

  // Agrupa por mês
  const porMes = {};
  itens.forEach(p => {
    const partes = (p.dataPagamento||'').split('/');
    const mes = partes.length===3 ? `${partes[1]}/${partes[2]}` : 'Sem data';
    if (!porMes[mes]) porMes[mes] = { total: 0, itens: [] };
    porMes[mes].total += p.totalReceber||0;
    porMes[mes].itens.push(p);
  });

  c.innerHTML = `
  <div class="form-panel" style="margin-bottom:1.5rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.75rem">
    <div>
      <div class="form-panel-title" style="margin-bottom:.25rem">💰 Proventos Futuros — Sua Carteira</div>
      <div style="font-size:.78rem;color:var(--text3)">Dados via Yahoo Finance · Próximos proventos anunciados</div>
    </div>
    <button class="btn-ghost" onclick="renderProventos()" style="padding:.45rem 1rem;font-size:.8rem">↻ Atualizar</button>
  </div>

  <div class="stats-row" style="margin-bottom:1.5rem">
    <div class="stat-card">
      <div class="stat-label">Total a Receber</div>
      <div class="stat-value" style="color:var(--green)">${fmtBRL(total)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Ativos com Proventos</div>
      <div class="stat-value">${itens.length}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Meses com Pagamentos</div>
      <div class="stat-value">${Object.keys(porMes).length}</div>
    </div>
  </div>

  ${Object.entries(porMes).sort().map(([mes, dados]) => `
    <div class="glass-table" style="margin-bottom:1.25rem">
      <div class="glass-table-header">
        <div class="glass-table-title">${mes}</div>
        <div style="font-size:.9rem;color:var(--green);font-weight:700">${fmtBRL(dados.total)}</div>
      </div>
      <div style="overflow-x:auto"><table>
        <thead><tr><th>Ticker</th><th>Tipo</th><th>Qtd.</th><th>Valor/Ação</th><th>Data Com</th><th>Data Pag.</th><th>DY 12M</th><th>Você Recebe</th></tr></thead>
        <tbody>${dados.itens.map(p => `<tr>
          <td><strong>${p.ticker}</strong></td>
          <td><span style="font-size:.72rem;color:${p.tipo==='JCP'?'var(--gold)':p.tipo==='Rendimento'?'var(--blue,#4f8ef7)':'var(--green)'}">${p.tipo}</span></td>
          <td>${(p.qtd||0).toLocaleString('pt-BR')}</td>
          <td>${fmtBRL(p.valor||0)}</td>
          <td style="color:var(--text3)">${p.dataCom||'—'}</td>
          <td style="color:var(--text3)">${p.dataPagamento||'—'}</td>
          <td style="color:var(--text3)">${p.dy12m?p.dy12m+'%':'—'}</td>
          <td style="color:var(--green);font-weight:700">${fmtBRL(p.totalReceber||0)}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>`).join('')}

  <div style="font-size:.72rem;color:var(--text3);padding:.5rem;text-align:center">
    ⚠ Valores estimados com base nos dados do Yahoo Finance. Confirme sempre no site da empresa ou corretora.
  </div>`;
}

// ══════════════════════════════════════════════
// ANÁLISE & VALUATION — 3 MÉTODOS COMBINADOS
// ══════════════════════════════════════════════
// Cache persistente em memória (dura até fechar o app)
let fcdResultados = {};
let fcdAnalisado = false;
let fcdTodosAtivos = [];

async function renderFCD() {
  const c = document.getElementById('fcdContainer');

  // Monta estrutura base sempre (mesmo com cache)
  const meta = await apiFetch('/api/analisar-carteira').then(r=>r.json()).catch(()=>({ok:false,yf_support:false}));

  // brapi.dev is always available - no local install needed

  const carteira = meta.carteira || [];
  const top30    = meta.top30 || [];
  fcdTodosAtivos = [...new Set([...carteira, ...top30])];

  c.innerHTML = `
  <div class="form-panel" style="margin-bottom:1.5rem">
    <div class="form-panel-title" style="margin-bottom:.5rem">🔬 Análise & Valuation — 3 Métodos Combinados</div>
    <p style="font-size:.82rem;color:var(--text2);line-height:1.7;margin-bottom:1rem">
      Calcula o Preço Justo combinando <b>FCD</b> (Fluxo de Caixa Descontado, WACC 12%),
      <b>Graham Number</b> (√22,5 × LPA × VPA) e <b>EV/EBITDA</b> (múltiplo do setor).
      Resultados ficam em memória enquanto o app estiver aberto.
    </p>
    <div style="display:flex;gap:.75rem;flex-wrap:wrap;align-items:center">
      <button class="btn-gold" onclick="analisarTodos(true)" id="btnAnalisarTodos">
        🔄 Reanalisar Todos (${fcdTodosAtivos.length} ativos)
      </button>
      <div style="display:flex;gap:.5rem;align-items:center;flex:1;min-width:200px">
        <input class="form-input" id="fcdTickerInput" placeholder="ex: WEGE3" style="flex:1"
               onkeydown="if(event.key==='Enter')analisarUm()">
        <button class="btn-ghost" onclick="analisarUm()" style="padding:.5rem 1rem;white-space:nowrap">Analisar</button>
      </div>
    </div>
    <div id="fcdProgress" style="margin-top:.75rem;display:none">
      <div style="font-size:.8rem;color:var(--text2);margin-bottom:.4rem" id="fcdProgressTxt">Analisando...</div>
      <div style="height:4px;background:rgba(255,255,255,.06);border-radius:2px;overflow:hidden">
        <div id="fcdProgressBar" style="height:100%;background:var(--gold);width:0%;transition:width .3s;border-radius:2px"></div>
      </div>
    </div>
    ${fcdAnalisado ? '<div style="font-size:.72rem;color:var(--green);margin-top:.5rem">✓ Análise carregada do cache — clique em Reanalisar para atualizar</div>' : ''}
  </div>
  <div id="fcdResultsArea"></div>`;

  // Se já tem resultados em cache, mostra imediatamente
  if (fcdAnalisado && Object.keys(fcdResultados).length > 0) {
    renderFCDResultados();
  } else {
    // Primeira vez: inicia análise automática
    analisarTodos(false);
  }
}

async function analisarUm() {
  const ticker = document.getElementById('fcdTickerInput')?.value.trim().toUpperCase();
  if (!ticker) return;
  const el = document.getElementById('fcdResultsArea');
  el.innerHTML = `<div style="color:var(--gold);font-size:.85rem;padding:1rem">⏳ Analisando ${ticker}...</div>`;
  const r = await apiFetch(`/api/analisar-fcd?ticker=${ticker}`).then(r=>r.json()).catch(e=>({ok:false,erro:e.message}));
  if (!r.ticker) r.ticker = ticker;
  fcdResultados[ticker] = r;
  renderFCDResultados();
}

async function analisarTodos(forceRefresh=false) {
  const btn = document.getElementById('btnAnalisarTodos');
  const prog = document.getElementById('fcdProgress');
  const progTxt = document.getElementById('fcdProgressTxt');
  const progBar = document.getElementById('fcdProgressBar');

  // Usa fcdTodosAtivos global (carteira + top30) definido em renderFCD
  const todos = fcdTodosAtivos.length > 0 ? fcdTodosAtivos :
    await apiFetch('/api/analisar-carteira').then(r=>r.json()).then(m=>[...new Set([...(m.carteira||[]),...(m.top30||[])])]);

  if (!todos.length) return;

  if (btn) btn.disabled = true;
  if (prog) prog.style.display = 'block';
  if (forceRefresh) fcdResultados = {};  // limpa cache só se forçar

  for (let i=0; i<todos.length; i++) {
    const ticker = todos[i];
    // Pula se já tem no cache e não é refresh forçado
    if (!forceRefresh && fcdResultados[ticker]) continue;
    if (progTxt) progTxt.textContent = `Analisando ${ticker} (${i+1}/${todos.length})...`;
    if (progBar) progBar.style.width = ((i+1)/todos.length*100)+'%';
    const r = await apiFetch(`/api/analisar-fcd?ticker=${ticker}`).then(r=>r.json()).catch(e=>({ok:false,erro:e.message,ticker}));
    if (!r.ticker) r.ticker = ticker;
    fcdResultados[ticker] = r;
    renderFCDResultados();
    await new Promise(res => setTimeout(res, 400));
  }

  fcdAnalisado = true;
  if (btn) { btn.disabled = false; btn.textContent = `🔄 Reanalisar Todos (${todos.length} ativos)`; }
  if (prog) prog.style.display = 'none';
}

function renderFCDResultados() {
  const el = document.getElementById('fcdResultsArea');
  if (!el) return;
  const resultados = Object.values(fcdResultados);
  if (!resultados.length) return;

  const comDados = resultados.filter(r => r.ok && r.consenso && r.consenso.metodos_validos > 0);
  const semDados = resultados.filter(r => !r.ok || !r.consenso || !r.consenso.metodos_validos);
  const meusTick = new Set(portfolio.map(a=>a.ticker));

  comDados.sort((a,b) => (b.consenso.desconto||0) - (a.consenso.desconto||0));

  function corDesc(d){ return d>=20?'var(--green)':d>=5?'var(--gold)':d>=-10?'var(--text2)':'var(--red)'; }
  function fmtM(v){ return Math.abs(v)>=1e9?'R$ '+(v/1e9).toFixed(1)+'B':Math.abs(v)>=1e6?'R$ '+(v/1e6).toFixed(0)+'M':fmtBRL(v); }
  function badgeVal(v){ return v>0 ? '<span style="font-size:.72rem;font-weight:700;color:var(--gold)">'+fmtBRL(v)+'</span>' : '<span style="font-size:.7rem;color:var(--text3)">—</span>'; }
  function warnSpan(msg){ return '<span style="font-size:.7rem;color:var(--text3)" title="'+(msg||'')+'">⚠</span>'; }

  var html = '';

  if (comDados.length) {
    html += '<div class="section-header"><div class="section-title">Ranking — Preço Justo vs Preço Atual</div>';
    html += '<div style="font-size:.72rem;color:var(--text3)">'+comDados.length+' ativos com pelo menos 1 método válido</div></div>';
    html += '<div style="overflow-x:auto;margin-bottom:1.5rem"><table><thead><tr>';
    html += '<th>Ativo</th><th>Cart.?</th><th>Atual</th><th>FCD</th><th>Graham</th><th>EV/EBITDA</th><th>Faixa Justa</th><th>Desconto</th><th>P/L</th><th>DY</th><th>Parecer</th>';
    html += '</tr></thead><tbody>';

    comDados.forEach(function(r) {
      var d = r.dados||{}, c = r.consenso||{}, f = r.fcd||{}, g = r.graham||{}, e = r.ev_ebitda||{}, p = r.parecer||{};
      var naCar = meusTick.has(r.ticker);
      var desc = c.desconto||0;
      var faixaHtml = c.metodos_validos>0
        ? '<span style="font-size:.76rem;color:var(--text3)">'+fmtBRL(c.preco_min||0)+'</span> – <span style="font-size:.76rem;color:var(--gold);font-weight:700">'+fmtBRL(c.preco_max||0)+'</span>'
        : '—';
      var corPar = {green:'var(--green)',gold:'var(--gold)',red:'var(--red)',text2:'var(--text2)'};
      html += '<tr style="cursor:pointer" data-ticker="'+r.ticker+'" onclick="mostrarDetalhe(this.dataset.ticker)">';
      html += '<td><strong style="color:var(--gold)">'+r.ticker+'</strong><div style="font-size:.65rem;color:var(--text3)">'+(d.nome||'').slice(0,22)+'</div></td>';
      html += '<td style="text-align:center">'+(naCar?'<span style="color:var(--green)">✓</span>':'<span style="color:var(--text3)">—</span>')+'</td>';
      html += '<td style="font-weight:600">'+fmtBRL(d.preco_atual||0)+'</td>';
      html += '<td>'+(f.valido?badgeVal(f.preco_justo):warnSpan(f.motivo_invalido))+'</td>';
      html += '<td>'+(g.valido?badgeVal(g.preco_justo):warnSpan(g.motivo_invalido))+'</td>';
      html += '<td>'+(e.valido?badgeVal(e.preco_justo):warnSpan(e.motivo_invalido))+'</td>';
      html += '<td>'+faixaHtml+'</td>';
      html += '<td style="font-weight:700;color:'+corDesc(desc)+'">'+(desc>=0?'+':'')+desc.toFixed(1)+'%</td>';
      html += '<td style="color:var(--text2);font-size:.8rem">'+(d.pl||'—')+'</td>';
      html += '<td style="color:var(--text2);font-size:.8rem">'+(d.dy?d.dy+'%':'—')+'</td>';
      html += '<td style="font-size:.72rem;color:'+(corPar[p.cor]||'var(--text2)')+'">'+((p.texto||'').split('—')[0]||'—').trim()+'</td>';
      html += '</tr>';
    });
    html += '</tbody></table></div>';
  }

  if (semDados.length) {
    html += '<div style="font-size:.75rem;color:var(--text3);padding:.6rem;background:rgba(255,255,255,.02);border-radius:8px;margin-bottom:1rem">';
    html += '⚠ '+semDados.length+' ativo(s) sem dados: '+semDados.map(function(r){ return r.ticker+(r.erro?' ('+r.erro.slice(0,40)+')':''); }).join(' · ');
    html += '</div>';
  }

  html += '<div id="fcdDetalheArea"></div>';
  el.innerHTML = html;
}

function mostrarDetalhe(ticker) {
  var r = fcdResultados[ticker];
  if (!r) return;
  var d = r.dados||{}, c = r.consenso||{}, f = r.fcd||{}, g = r.graham||{}, e = r.ev_ebitda||{}, p = r.parecer||{};

  function fmtM(v) {
    v = v||0;
    return Math.abs(v)>=1e9 ? 'R$ '+(v/1e9).toFixed(2)+'B' :
           Math.abs(v)>=1e6 ? 'R$ '+(v/1e6).toFixed(0)+'M' : fmtBRL(v);
  }
  var corP = {green:'var(--green)',gold:'var(--gold)',red:'var(--red)',text2:'var(--text2)'};
  var desconto = c.desconto||0;
  var faixaStr = c.metodos_validos>0 ? fmtBRL(c.preco_min||0)+' – '+fmtBRL(c.preco_max||0) : '—';

  var el = document.getElementById('fcdDetalheArea');
  if (!el) return;

  // Build HTML using array join to avoid quote issues
  var h = [];

  // Header
  h.push('<div class="section-header">');
  h.push('<div class="section-title">Detalhe — '+ticker+' <span style="font-size:.85rem;font-weight:400;color:var(--text2)">'+( d.nome||'')+'</span></div>');
  h.push('<div style="display:flex;align-items:center;gap:.75rem">');
  h.push('<span style="font-size:.68rem;color:var(--text3)">Fonte: '+(r.fonte||'—')+'</span>');
  h.push('<button class="btn-ghost" id="btnFecharDetalhe" style="padding:.3rem .7rem;font-size:.75rem">✕</button>');
  h.push('</div></div>');

  // Consenso
  h.push('<div class="form-panel" style="margin-bottom:1.25rem;border-color:rgba(201,168,76,.3)">');
  h.push('<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1rem">');
  h.push('<div>');
  h.push('<div style="font-size:.7rem;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.25rem">Faixa de Preço Justo</div>');
  h.push('<div style="font-size:1.6rem;font-weight:700">'+faixaStr+'</div>');
  h.push('<div style="font-size:.78rem;color:var(--text2);margin-top:.25rem">');
  h.push('Médio: <b>'+fmtBRL(c.preco_medio||0)+'</b> · Atual: <b>'+fmtBRL(d.preco_atual||0)+'</b> · ');
  h.push('<span style="color:'+(desconto>=0?'var(--green)':'var(--red)')+'">');
  h.push((desconto>=0?'+':'')+desconto.toFixed(1)+'% desconto</span> · '+(c.metodos_validos||0)+' método(s)');
  h.push('</div></div>');
  h.push('<div style="font-size:.85rem;color:'+(corP[p.cor]||'var(--text2)')+'"><b>'+(p.texto||'—')+'</b></div>');
  h.push('</div></div>');

  // 3 Métodos
  h.push('<div class="charts-grid" style="margin-bottom:1.25rem">');

  // FCD
  h.push('<div class="chart-panel" style="border-left:3px solid '+(f.valido?'var(--green)':'var(--text3)')+'">');
  h.push('<div class="chart-label">Método 1 — FCD</div>');
  if (f.valido) {
    h.push('<div style="font-size:1.4rem;font-weight:700;color:var(--gold);margin:.4rem 0">'+fmtBRL(f.preco_justo||0)+'</div>');
    h.push('<div style="font-size:.75rem;color:var(--text2);line-height:1.7">');
    h.push('FC Base: '+fmtM(f.fc_base||0)+' · WACC: '+f.wacc+'%<br>');
    h.push('Cresc.: '+f.g_crescimento+'% → '+f.g_terminal+'%<br>');
    h.push('VP Fluxos: '+fmtM(f.vp_fluxos||0)+' · VP Terminal: '+fmtM(f.vp_terminal||0)+'<br>');
    h.push('Dívida: '+fmtM(f.divida_liquida||0));
    h.push('</div>');
  } else {
    h.push('<div style="color:var(--text3);font-size:.8rem;margin-top:.5rem">⚠ '+(f.motivo_invalido||'Dados insuficientes')+'</div>');
  }
  h.push('</div>');

  // Graham
  h.push('<div class="chart-panel" style="border-left:3px solid '+(g.valido?'var(--gold)':'var(--text3)')+'">');
  h.push('<div class="chart-label">Método 2 — Graham Number</div>');
  if (g.valido) {
    h.push('<div style="font-size:1.4rem;font-weight:700;color:var(--gold);margin:.4rem 0">'+fmtBRL(g.preco_justo||0)+'</div>');
    h.push('<div style="font-size:.75rem;color:var(--text2);line-height:1.7">');
    h.push((g.formula||'')+'<br>LPA: '+fmtBRL(g.lpa||0)+' · VPA: '+fmtBRL(g.vpa||0));
    h.push('</div>');
  } else {
    h.push('<div style="color:var(--text3);font-size:.8rem;margin-top:.5rem">⚠ '+(g.motivo_invalido||'Dados insuficientes')+'</div>');
  }
  h.push('</div>');

  // EV/EBITDA
  h.push('<div class="chart-panel" style="border-left:3px solid '+(e.valido?'var(--gold)':'var(--text3)')+'">');
  h.push('<div class="chart-label">Método 3 — EV/EBITDA</div>');
  if (e.valido) {
    h.push('<div style="font-size:1.4rem;font-weight:700;color:var(--gold);margin:.4rem 0">'+fmtBRL(e.preco_justo||0)+'</div>');
    h.push('<div style="font-size:.75rem;color:var(--text2);line-height:1.7">');
    h.push('EBITDA: '+fmtM(e.ebitda||0)+'<br>');
    h.push('Múltiplo ('+( e.setor_ref||'Geral')+'): '+e.multiplo_setor+'x<br>');
    h.push('EV Justo: '+fmtM(e.ev_justo||0));
    h.push('</div>');
  } else {
    h.push('<div style="color:var(--text3);font-size:.8rem;margin-top:.5rem">⚠ '+(e.motivo_invalido||'Dados insuficientes')+'</div>');
  }
  h.push('</div></div>');

  // Dados financeiros
  h.push('<div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.5rem">');
  h.push('<div class="chart-panel"><div class="chart-label">Dados Financeiros</div>');
  var dadosFin = [
    ['Receita', fmtM(d.receita||0)], ['EBIT', fmtM(d.ebit||0)],
    ['EBITDA', fmtM(d.ebitda||0)], ['Lucro Líquido', fmtM(d.lucro_liquido||0)],
    ['FCO', fmtM(d.fco||0)], ['FCL', fmtM(d.fcl||0)],
    ['Dívida Líquida', fmtM(d.divida_liquida||0)],
    ['LPA', fmtBRL(d.lpa||0)], ['VPA', fmtBRL(d.vpa||0)]
  ];
  dadosFin.forEach(function(row) {
    h.push('<div style="display:flex;justify-content:space-between;padding:.4rem 0;border-bottom:1px solid var(--border);font-size:.8rem">');
    h.push('<span style="color:var(--text2)">'+row[0]+'</span><b>'+row[1]+'</b></div>');
  });
  h.push('</div>');

  h.push('<div class="chart-panel"><div class="chart-label">Indicadores de Mercado</div>');
  var indicadores = [
    ['P/L', d.pl||'—'], ['P/VP', d.pvp||'—'],
    ['DY', d.dy?(d.dy+'%'):'—'], ['ROE', d.roe?(d.roe+'%'):'—'],
    ['Margem EBIT', d.margem_ebit?(d.margem_ebit+'%'):'—'],
    ['Market Cap', fmtM(d.market_cap||0)]
  ];
  indicadores.forEach(function(row) {
    h.push('<div style="display:flex;justify-content:space-between;padding:.4rem 0;border-bottom:1px solid var(--border);font-size:.8rem">');
    h.push('<span style="color:var(--text2)">'+row[0]+'</span><b>'+row[1]+'</b></div>');
  });
  h.push('<div style="margin-top:.75rem;padding:.5rem;background:rgba(201,168,76,.06);border-radius:6px;font-size:.72rem;color:var(--text3)">');
  h.push('⚠ Estimativas teóricas. Não é recomendação de investimento.</div>');
  h.push('</div></div>');

  // Fluxos FCD
  if (f.fluxos && f.fluxos.length) {
    h.push('<div class="chart-panel" style="margin-bottom:1.5rem">');
    h.push('<div class="chart-label">Projeção FCD — Fluxos por Ano</div>');
    h.push('<div style="overflow-x:auto"><table><thead><tr>');
    h.push('<th>Ano</th><th>Cresc.</th><th>FC Projetado</th><th>VP Descontado</th>');
    h.push('</tr></thead><tbody>');
    f.fluxos.forEach(function(fl) {
      h.push('<tr><td>Ano '+fl.ano+'</td><td style="color:var(--text3)">'+fl.g+'%</td>');
      h.push('<td>'+fmtM(fl.fc)+'</td><td style="color:var(--gold);font-weight:600">'+fmtM(fl.vp)+'</td></tr>');
    });
    h.push('</tbody></table></div></div>');
  }

  el.innerHTML = h.join('');

  // Add close button event after rendering
  var btnFechar = document.getElementById('btnFecharDetalhe');
  if (btnFechar) btnFechar.onclick = function() { el.innerHTML = ''; };

  el.scrollIntoView({behavior:'smooth', block:'start'});
}

function toggleSidebar(){
  const s=document.querySelector('.sidebar');
  const h=document.getElementById('hamburger');
  const o=document.getElementById('sidebarOverlay');
  s.classList.toggle('open');
  h.classList.toggle('active');
  o.classList.toggle('show');
}
function closeSidebar(){
  document.querySelector('.sidebar')?.classList.remove('open');
  document.getElementById('hamburger')?.classList.remove('active');
  document.getElementById('sidebarOverlay')?.classList.remove('show');
}
document.querySelectorAll('.nav-item').forEach(el=>{
  el.addEventListener('click',()=>{ if(window.innerWidth<=768) closeSidebar(); });
});

// ── PWA ───────────────────────────────────────────────────────────
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('/static/sw.js').catch(()=>{});
}

// ── Checkout success ─────────────────────────────────────────────
const _qs = new URLSearchParams(location.search);
if(_qs.get('ativado')==='1'){
  showToast('🎉 Plano Pro ativado! Bem-vindo ao Portfex Pro!');
  history.replaceState({},'','/app');
}

init();
