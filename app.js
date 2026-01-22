/* Pantanal Clima — v3
   - Modos: Visualização | Comparação (configurável) | Agregado
   - Séries + MK/Sen + Boxplot + Dispersão + Matriz
*/
const DATA_URL = "./data/clima_pantanal.csv";

const VARS = [
  {key:"tmean_c", label:"Temperatura média (°C)", kind:"mean", unit:"°C"},
  {key:"tmax_c", label:"Temperatura máxima (°C)", kind:"mean", unit:"°C"},
  {key:"tmin_c", label:"Temperatura mínima (°C)", kind:"mean", unit:"°C"},
  {key:"precip_sum_mm", label:"Precipitação (soma, mm)", kind:"sum", unit:"mm"},
  {key:"rh_mean_pct", label:"Umidade relativa média (%)", kind:"mean", unit:"%"},
  {key:"hi_mean_c", label:"Heat Index médio (°C)", kind:"mean", unit:"°C"},
  {key:"hi_max_c", label:"Heat Index máximo (°C)", kind:"mean", unit:"°C"},
];

const $ = (id)=>document.getElementById(id);

let RAW = [];
let META = {years:[], muns:[], locs:[]};
let state = {
  mode:"view", // view | compare | aggregate
  compareBy:"mun", // mun | loc
  mun:[],
  loc:[],
  v:"tmean_c",
  agg:"monthly",
  start:2001,
  end:2024,
  smooth:3,
  show:{mean:true,min:true,max:true,minmax:true,std:false,mk:true,hmean:false,hmin:false,hmax:false},
  compareMax:5,
  cmp:{x:"precip_sum_mm", y:"tmean_c", type:"scatter", corr:"pearson"},
  font:110
};

function clamp(n,a,b){ return Math.max(a, Math.min(b,n)); }
function fmt(n, d=2){
  if (n===null || n===undefined || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  if (abs>=1000) return n.toFixed(1);
  if (abs>=100) return n.toFixed(2);
  if (abs>=10) return n.toFixed(2);
  return n.toFixed(d);
}
function parseYM(s){ // "YYYY-MM"
  const [y,m]=s.split("-").map(Number);
  return new Date(y, m-1, 1);
}
function ymKey(d){ return d.toISOString().slice(0,7); }

function movingAverage(arr, win){
  if (!win || win<=1) return arr.slice();
  const out = [];
  let sum=0;
  const q=[];
  for (let i=0;i<arr.length;i++){
    const v=arr[i];
    q.push(v); sum+=v;
    if (q.length>win) sum-=q.shift();
    out.push(sum/q.length);
  }
  return out;
}

// ---------- Robust trend: Mann-Kendall + Sen slope ----------
function mannKendall(y){
  // y array of numbers (no nulls)
  const n=y.length;
  let S=0;
  for(let i=0;i<n-1;i++){
    for(let j=i+1;j<n;j++){
      const d=y[j]-y[i];
      if (d>0) S+=1;
      else if (d<0) S-=1;
    }
  }
  // tie correction
  const ties = new Map();
  for(const v of y){
    const k = v.toFixed(6);
    ties.set(k, (ties.get(k)||0)+1);
  }
  let varS = n*(n-1)*(2*n+5);
  let tieSum=0;
  for(const c of ties.values()){
    if (c>1) tieSum += c*(c-1)*(2*c+5);
  }
  varS = (varS - tieSum) / 18;
  const sd = Math.sqrt(varS);
  let z=0;
  if (S>0) z = (S-1)/sd;
  else if (S<0) z = (S+1)/sd;
  else z=0;
  // normal approx p-value (two-sided)
  const p = 2*(1 - normCdf(Math.abs(z)));
  const tau = S / (0.5*n*(n-1));
  return {n,S,tau,z,p};
}
function normCdf(z){
  // Abramowitz-Stegun approximation
  const t = 1/(1+0.2316419*z);
  const d = 0.3989423*Math.exp(-z*z/2);
  const prob = d*t*(0.3193815 + t*(-0.3565638 + t*(1.781478 + t*(-1.821256 + t*1.330274))));
  return 1 - prob;
}
function senSlope(y, x){
  // x as numeric (e.g., year fraction). robust median slope
  const n=y.length;
  const slopes=[];
  for(let i=0;i<n-1;i++){
    for(let j=i+1;j<n;j++){
      const dx = x[j]-x[i];
      if (dx!==0) slopes.push((y[j]-y[i])/dx);
    }
  }
  slopes.sort((a,b)=>a-b);
  const mid = Math.floor(slopes.length/2);
  const slope = slopes.length%2? slopes[mid] : (slopes[mid-1]+slopes[mid])/2;
  return slope;
}

function linreg(x,y){
  const n=x.length;
  const mx=x.reduce((a,b)=>a+b,0)/n;
  const my=y.reduce((a,b)=>a+b,0)/n;
  let num=0, den=0, ssTot=0, ssRes=0;
  for(let i=0;i<n;i++){
    num += (x[i]-mx)*(y[i]-my);
    den += (x[i]-mx)*(x[i]-mx);
  }
  const slope = den===0?0:num/den;
  const intercept = my - slope*mx;
  for(let i=0;i<n;i++){
    const yhat = intercept + slope*x[i];
    ssTot += (y[i]-my)**2;
    ssRes += (y[i]-yhat)**2;
  }
  const r2 = ssTot===0?0:1-ssRes/ssTot;
  return {slope, intercept, r2};
}

// ---------- URL state ----------
function readURL(){
  const q = new URLSearchParams(location.search);
  if (q.get("mode")) state.mode=q.get("mode");
  if (q.get("mun")) state.mun=q.get("mun").split("|").filter(Boolean);
  if (q.get("loc")) state.loc=q.get("loc").split("|").filter(Boolean);
  if (q.get("v")) state.v=q.get("v");
  if (q.get("agg")) state.agg=q.get("agg");
  if (q.get("start")) { const v=+q.get("start"); if (Number.isFinite(v)) state.start=v; }
  if (q.get("end")) { const v=+q.get("end"); if (Number.isFinite(v)) state.end=v; }
  if (q.get("smooth")) { const s=+q.get("smooth"); if (Number.isFinite(s)) state.smooth=s; }
  if (q.get("cmpx")) state.cmp.x=q.get("cmpx");
  if (q.get("cmpy")) state.cmp.y=q.get("cmpy");
  if (q.get("cmpt")) state.cmp.type=q.get("cmpt");
  if (q.get("corr")) state.cmp.corr=q.get("corr");  if (q.get("mk")) state.show.mk = q.get("mk")==="1";
  if (q.get("cby")) state.compareBy = q.get("cby");
  if (q.get("hmean")) state.show.hmean = q.get("hmean")==="1";
  if (q.get("hmin")) state.show.hmin = q.get("hmin")==="1";
  if (q.get("hmax")) state.show.hmax = q.get("hmax")==="1";
  if (q.get("mean")) state.show.mean = q.get("mean")==="1";
  if (q.get("min")) state.show.min = q.get("min")==="1";
  if (q.get("max")) state.show.max = q.get("max")==="1";
  if (q.get("minmax")) state.show.minmax = q.get("minmax")==="1";
  if (q.get("std")) state.show.std = q.get("std")==="1";
  if (q.get("maxcomp")) state.compareMax=clamp(+q.get("maxcomp"),2,12);
  if (q.get("font")) state.font=clamp(+q.get("font"),100,140);
}
function writeURL(){
  const q = new URLSearchParams();
  q.set("mode", state.mode);
  if (state.mun.length) q.set("mun", state.mun.join("|"));
  if (state.loc.length) q.set("loc", state.loc.join("|"));
  q.set("v", state.v);
  q.set("agg", state.agg);
  if (Number.isFinite(state.start)) q.set("start", state.start);
  if (Number.isFinite(state.end)) q.set("end", state.end);
  if (Number.isFinite(state.smooth)) q.set("smooth", state.smooth);
  q.set("mean", state.show.mean?1:0);
  q.set("min", state.show.min?1:0);
  q.set("max", state.show.max?1:0);
  q.set("minmax", state.show.minmax?1:0);
  q.set("std", state.show.std?1:0);
  q.set("mk", state.show.mk?1:0);
  q.set("maxcomp", state.compareMax);
  q.set("cmpx", state.cmp.x);
  q.set("cmpy", state.cmp.y);
  q.set("cmpt", state.cmp.type);
  q.set("corr", state.cmp.corr);
  q.set("cby", state.compareBy||"mun");
  q.set("hmean", state.show.hmean?1:0);
  q.set("hmin", state.show.hmin?1:0);
  q.set("hmax", state.show.hmax?1:0);
  q.set("font", state.font);
  history.replaceState(null, "", "?" + q.toString());
}

// ---------- Load ----------
async function load(){
  readURL();
  setFont(state.font);

  const txt = await fetch(DATA_URL).then(r=>r.text());
  const parsed = Papa.parse(txt, {header:true, dynamicTyping:true, skipEmptyLines:true});
  RAW = parsed.data
    .filter(r => r.ym && r.year && r.NM_MUN && r.LOCATION)
    .map(r => ({
      ...r,
      ym: String(r.ym),
      date: parseYM(String(r.ym))
    }));

  META.years = Array.from(new Set(RAW.map(r=>+r.year))).sort((a,b)=>a-b);
  META.muns = Array.from(new Set(RAW.map(r=>r.NM_MUN))).sort((a,b)=>a.localeCompare(b,"pt-BR"));
  META.locs = Array.from(new Set(RAW.map(r=>r.LOCATION))).sort();

  initUI();
  update();
}

// ---------- UI ----------
function fillSelect(sel, items, selected){
  sel.innerHTML = "";
  for(const it of items){
    const opt = document.createElement("option");
    opt.value = it.value ?? it;
    opt.textContent = it.label ?? it;
    if (selected && selected.includes(opt.value)) opt.selected = true;
    sel.appendChild(opt);
  }
}
function getSelected(sel){
  return Array.from(sel.selectedOptions).map(o=>o.value);
}

function setModeButtons(){
  const modes = ["view","compare","aggregate"];
  for(const m of modes){
    const btn = document.querySelector(`.segbtn[data-mode="${m}"]`);
    btn.classList.toggle("active", state.mode===m);
  }
  const hint = $("modeHint");
  if (state.mode==="view") hint.textContent = "Veja 1+ municípios (linhas individuais + média).";
  if (state.mode==="compare") hint.textContent = "Compare municípios (2+) com boxplot, dispersão por grupo e MK por município.";
  if (state.mode==="aggregate") hint.textContent = "Agrega a seleção em uma única série (visão regional).";
}

function initUI(){
  // modes
  document.querySelectorAll(".segbtn").forEach(b=>{
    b.addEventListener("click", ()=>{
      state.mode = b.dataset.mode;
      setModeButtons();
      // enforce compare selection limit
      if (state.mode==="compare"){
        enforceCompareLimit();
      }
      update();
    });
  });
  setModeButtons();

  // selects
  fillSelect($("selMun"), META.muns, state.mun);
  fillSelect($("selLoc"), META.locs, state.loc);
  fillSelect($("selVar"), VARS.map(v=>({value:v.key,label:v.label})), [state.v]);
  fillSelect($("selX"), VARS.map(v=>({value:v.key,label:v.label})), [state.cmp.x]);
  fillSelect($("selY"), VARS.map(v=>({value:v.key,label:v.label})), [state.cmp.y]);

  fillSelect($("selStart"), META.years, [String(state.start)]);
  fillSelect($("selEnd"), META.years, [String(state.end)]);
  $("selStart").value = String(state.start);
  $("selEnd").value = String(state.end);

  $("selAgg").value = state.agg;
  $("selSmooth").value = String(state.smooth);

  $("chkMean").checked = state.show.mean;
  $("chkMin").checked = state.show.min;
  $("chkMax").checked = state.show.max;
  $("chkMinMax").checked = state.show.minmax;
  $("chkStd").checked = state.show.std;
  $("chkMK").checked = state.show.mk;
  $("chkHMean").checked = state.show.hmean;
  $("chkHMin").checked = state.show.hmin;
  $("chkHMax").checked = state.show.hmax;
  if ($("selCompareBy")) $("selCompareBy").value = state.compareBy || "mun";

  $("selType").value = state.cmp.type;
  $("selCorr").value = state.cmp.corr;
  
  $("maxCompare").value = state.compareMax;

  // font
  $("fontScale").value = String(state.font);
  $("fontScaleVal").textContent = state.font+"%";
  $("fontScale").addEventListener("input", (e)=>{
    state.font = +e.target.value;
    $("fontScaleVal").textContent = state.font+"%";
    setFont(state.font);
    writeURL();
    // re-layout plots
    Plotly.Plots.resize("tsChart");
    Plotly.Plots.resize("cmpChart");
  });

  // events
  $("selMun").addEventListener("change", ()=>{
    state.mun = getSelected($("selMun"));
    if (state.mode==="compare") enforceCompareLimit();
    writeURL();
  });
  $("selLoc").addEventListener("change", ()=>{ state.loc = getSelected($("selLoc")); writeURL(); });
  $("selVar").addEventListener("change", ()=>{ state.v = $("selVar").value; writeURL(); });
  $("selAgg").addEventListener("change", ()=>{ state.agg = $("selAgg").value; writeURL(); });
  $("selStart").addEventListener("change", ()=>{ state.start = +$("selStart").value; writeURL(); });
  $("selEnd").addEventListener("change", ()=>{ state.end = +$("selEnd").value; writeURL(); });
  $("selSmooth").addEventListener("change", ()=>{ state.smooth = +$("selSmooth").value; writeURL(); });

  const bindChk = (id,key)=>$(id).addEventListener("change", ()=>{
    state.show[key] = $(id).checked; writeURL();
  });
  bindChk("chkMean","mean"); bindChk("chkMin","min"); bindChk("chkMax","max");
  bindChk("chkMinMax","minmax"); bindChk("chkStd","std"); bindChk("chkMK","mk");

  $("maxCompare").addEventListener("change", ()=>{
    state.compareMax = clamp(+$("maxCompare").value,2,12);
    $("maxCompare").value = state.compareMax;
    if (state.mode==="compare") enforceCompareLimit();
    writeURL();
  });

  $("selX").addEventListener("change", ()=>{ state.cmp.x=$("selX").value; writeURL(); });
  $("selY").addEventListener("change", ()=>{ state.cmp.y=$("selY").value; writeURL(); });
  $("selType").addEventListener("change", ()=>{ state.cmp.type=$("selType").value; writeURL(); });
  $("selCorr").addEventListener("change", ()=>{ state.cmp.corr=$("selCorr").value; writeURL(); });
  $("chkNoOut").addEventListener("change", ()=>{ state.cmp.noOut=$("chkNoOut").checked; writeURL(); });

  $("btnUpdate").addEventListener("click", update);
  $("btnReset").addEventListener("click", ()=>{
    state = {
      mode:"view", mun:[], loc:[], v:"tmean_c", agg:"monthly", start:META.years[0], end:META.years[META.years.length-1],
      smooth:3, show:{mean:true,min:true,max:true,minmax:true,std:false,mk:true},
      compareMax:5, cmp:{x:"precip_sum_mm", y:"tmean_c", type:"scatter", corr:"pearson"}, font:110
    };
    setFont(state.font);
    initUI();
    writeURL();
    update();
  });

  $("btnShare").addEventListener("click", async ()=>{
    writeURL();
    const url = location.href;
    try{
      await navigator.clipboard.writeText(url);
      toast("Link copiado!");
    }catch(e){
      prompt("Copie o link:", url);
    }
  });

  $("btnExport").addEventListener("click", ()=>{
    const rows = filteredRows();
    if (!rows.length){ toast("Sem dados no recorte."); return; }
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pantanal_${state.mode}_${state.v}_${state.start}-${state.end}.csv`;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 2000);
  });

  writeURL();
}

function enforceCompareLimit(){
  // ensure at most compareMax are selected in selMun
  const sel = $("selMun");
  const chosen = getSelected(sel);
  const maxN = state.compareMax;
  if (chosen.length<=maxN) return;
  // keep first maxN
  const keep = new Set(chosen.slice(0, maxN));
  for(const opt of sel.options){
    opt.selected = keep.has(opt.value);
  }
  state.mun = getSelected(sel);
  toast(`Comparação: limite ${maxN} municípios.`);
}

function setFont(pct){
  document.documentElement.style.setProperty("--fontScale", String(pct/100));
}

function toast(msg){
  let t = document.querySelector(".toast");
  if (!t){
    t = document.createElement("div");
    t.className="toast";
    t.style.position="fixed";
    t.style.left="50%";
    t.style.bottom="18px";
    t.style.transform="translateX(-50%)";
    t.style.padding="10px 14px";
    t.style.borderRadius="999px";
    t.style.background="rgba(2,6,23,.85)";
    t.style.border="1px solid rgba(96,165,250,.35)";
    t.style.color="white";
    t.style.fontWeight="800";
    t.style.zIndex="9999";
    t.style.boxShadow="0 14px 40px rgba(0,0,0,.45)";
    document.body.appendChild(t);
  }
  t.textContent=msg;
  t.style.opacity="1";
  clearTimeout(t._to);
  t._to=setTimeout(()=>t.style.opacity="0", 1200);
}

// ---------- Filtering ----------
function filteredRows(){
  let rows = RAW.slice();
  // municipality filter
  const useMunFilter = !(state.mode==="compare" && (state.compareBy||"mun")==="loc");
  if (useMunFilter && state.mun.length){
    const set = new Set(state.mun);
    rows = rows.filter(r => set.has(r.NM_MUN));
  }
  // location filter
  if (state.loc.length){
    const set = new Set(state.loc);
    rows = rows.filter(r => set.has(r.LOCATION));
  }
  // years
  const a = Math.min(state.start, state.end);
  const b = Math.max(state.start, state.end);
  rows = rows.filter(r => +r.year>=a && +r.year<=b);
  return rows;
}

function aggregateRows(rows){
  // returns grouped structure based on mode:
  // view/compare: per municipality; aggregate: one series (mean across municipalities per time)
  // Also handles annual aggregation.
  const byMun = new Map();
  for(const r of rows){
    const m = r.NM_MUN;
    if (!byMun.has(m)) byMun.set(m, []);
    byMun.get(m).push(r);
  }
  const byLoc = new Map();
  for(const r of rows){
    const L = r.LOCATION;
    if (!byLoc.has(L)) byLoc.set(L, []);
    byLoc.get(L).push(r);
  }


  function groupTime(list){
    const map = new Map(); // key -> {x, sum, count}
    for(const r of list){
      const key = state.agg==="annual" ? String(r.year) : String(r.ym);
      if (!map.has(key)) map.set(key, {key, date: state.agg==="annual" ? new Date(+r.year,0,1) : r.date, vals:[]});
      map.get(key).vals.push(r[state.v]);
    }
    // compute aggregator per var kind
    const vmeta = VARS.find(v=>v.key===state.v) || VARS[0];
    const out = Array.from(map.values()).sort((a,b)=>a.date-b.date).map(g=>{
      const arr = g.vals.filter(v=>Number.isFinite(v));
      if (!arr.length) return {t:g.date, y:null};
      let y;
      if (state.agg==="annual" && vmeta.kind==="sum") y = arr.reduce((s,v)=>s+v,0);
      else y = arr.reduce((s,v)=>s+v,0)/arr.length;
      return {t:g.date, y};
    }).filter(d=>d.y!==null);
    // smoothing
    const win = state.smooth;
    const ys = out.map(o=>o.y);
    const sm = movingAverage(ys, win);
    return out.map((o,i)=>({...o, y_sm: sm[i]}));
  }

  if (state.mode==="aggregate"){
    // 1) compute per municipality series (on y_sm), then average across municipalities per time key
    const series = [];
    for(const [m,list] of byMun.entries()){
      series.push({name:m, points: groupTime(list)});
    }
    // union of times
    const timeKeys = new Map(); // ISO -> date
    for(const s of series){
      for(const p of s.points){
        timeKeys.set(p.t.toISOString(), p.t);
      }
    }
    const dates = Array.from(timeKeys.values()).sort((a,b)=>a-b);
    const points = dates.map(dt=>{
      const vals=[];
      for(const s of series){
        const found = s.points.find(p=>p.t.getTime()===dt.getTime());
        if (found) vals.push(found.y_sm);
      }
      if (!vals.length) return null;
      const mean = vals.reduce((a,b)=>a+b,0)/vals.length;
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      const sd = Math.sqrt(vals.reduce((a,v)=>a+(v-mean)*(v-mean),0)/vals.length);
      return {t:dt, mean, min, max, sd};
    }).filter(Boolean);
    const locSeries=[];
    for(const [L,list] of byLoc.entries()) locSeries.push({name:L, points: groupTime(list)});
    return {mode:"aggregate", points, perMun: series, byLoc: locSeries};
  } else {
    const series = [];
    for(const [m,list] of byMun.entries()){
      series.push({name:m, points: groupTime(list)});
    }
    const locSeries=[];
    for(const [L,list] of byLoc.entries()) locSeries.push({name:L, points: groupTime(list)});
    return {mode: state.mode, series, byLoc: locSeries};
  }
}

// ---------- Update / Render ----------
function update(){
  // Validate mode & selection
  if (state.mode==="compare"){
    const need = 2;
    if ((state.mun?.length||0) < need){
      $("modeHint").textContent = "Comparação: selecione 2+ municípios (em “Municípios”).";
    } else {
      $("modeHint").textContent = `Comparação: ${state.mun.length} municípios.`;
    }
  }

  writeURL();
  const rows = filteredRows();
  const agg = aggregateRows(rows);

  renderStats(rows, agg);
  renderTimeSeries(agg);
  renderCompare(rows, agg);
}

function renderStats(rows, agg){
  // summary stats for selected series (depends on mode)
  let values=[];
  if (agg.mode==="aggregate"){
    values = agg.points.map(p=>p.mean);
  } else {
    // concat all series values (smoothed)
    for(const s of agg.series){
      for(const p of s.points){
        values.push(p.y_sm);
      }
    }
  }
  values = values.filter(v=>Number.isFinite(v));
  values.sort((a,b)=>a-b);

  const n = values.length;
  const mean = n? values.reduce((a,b)=>a+b,0)/n : null;
  const median = n? values[Math.floor(n/2)] : null;
  const q = (p)=> n? values[Math.floor((n-1)*p)] : null;
  const sd = n? Math.sqrt(values.reduce((a,v)=>a+(v-mean)*(v-mean),0)/n) : null;
  const min = n? values[0] : null;
  const max = n? values[n-1] : null;

  $("statBox").textContent =
    `n: ${n}\n`+
    `média: ${fmt(mean)}\n`+
    `mediana: ${fmt(median)}\n`+
    `sd: ${fmt(sd)}\n`+
    `p05: ${fmt(q(0.05))}  p95: ${fmt(q(0.95))}\n`+
    `mín: ${fmt(min)}  máx: ${fmt(max)}`;

  // Trend: use aggregate mean series if aggregate; else use mean across municipalities per time
  let ts = [];
  if (agg.mode==="aggregate"){
    ts = agg.points.map(p=>({t:p.t, y:p.mean}));
  } else {
    // mean across series at each time
    const map = new Map();
    for(const s of agg.series){
      for(const p of s.points){
        const k = p.t.toISOString();
        if (!map.has(k)) map.set(k, {t:p.t, vals:[]});
        map.get(k).vals.push(p.y_sm);
      }
    }
    ts = Array.from(map.values()).sort((a,b)=>a.t-b.t).map(o=>{
      const m = o.vals.reduce((a,b)=>a+b,0)/o.vals.length;
      return {t:o.t, y:m};
    });
  }
  const y = ts.map(p=>p.y).filter(Number.isFinite);
  const x = ts.map((p,i)=>i); // index for MK, but for Sen slope use year fraction
  const xf = ts.map(p=>p.t.getFullYear() + (p.t.getMonth()/12));
  const trend = y.length>=8 ? mannKendall(y) : null;
  const sen = y.length>=8 ? senSlope(y, xf.slice(0,y.length)) : null;
  const lr = y.length>=2 ? linreg(xf.slice(0,y.length), y) : null;

  const vmeta = VARS.find(v=>v.key===state.v) || VARS[0];
  const unit = vmeta.unit || "";

  if (!trend){
    $("trendBox").textContent = "Série curta demais para MK.";
  } else {
    $("trendBox").textContent =
      `Mann–Kendall: tau=${fmt(trend.tau,3)}  z=${fmt(trend.z,2)}  p=${fmt(trend.p,4)}  (n=${trend.n})\n`+
      `Inclinação de Sen: ${fmt(sen,4)} ${unit}/ano\n`+
      `Regressão linear: slope=${fmt(lr.slope,4)} ${unit}/ano  R²=${fmt(lr.r2,3)}  (n=${y.length})`;
  }

  // quick bullets
  const qb = [];
  if (state.mode==="compare" && (state.mun?.length||0)>=2){
    qb.push(`Comparando ${state.mun.length} municípios.`);
    qb.push(`Use “Boxplot” para comparar distribuição; “Dispersão” para relação X vs Y.`);
    qb.push(`MK por município aparece no gráfico (quando ligado).`);
  } else if (state.mode==="aggregate"){
    qb.push("Agregado: uma série regional (média espacial).");
    qb.push("As faixas min–max vêm da variação entre municípios.");
  } else {
    qb.push("Visualização: linhas individuais + média.");
    qb.push("Ative/desative média, mín, máx e bandas no painel.");
  }
  $("quickBox").innerHTML = qb.map(x=>`<li>${x}</li>`).join("");
}

function plotLayout(title, ylab){
  return {
    title: {text:title, font:{size:18}},
    paper_bgcolor:"rgba(0,0,0,0)",
    plot_bgcolor:"rgba(0,0,0,0)",
    font:{color:"#e5e7eb", size: 14},
    margin:{l:70,r:25,t:50,b:55},
    xaxis:{gridcolor:"rgba(148,163,184,.12)", zeroline:false},
    yaxis:{title: ylab, gridcolor:"rgba(148,163,184,.12)", zeroline:false},
    legend:{orientation:"h", y:1.12, x:0, font:{size:12}}
  };
}

function renderTimeSeries(agg){
  const vmeta = VARS.find(v=>v.key===state.v) || VARS[0];
  const ylab = vmeta.label;

  const traces = [];
  const annotations = [];

  if (agg.mode==="aggregate"){
    const t = agg.points.map(p=>p.t);
    const mean = agg.points.map(p=>p.mean);
    const min = agg.points.map(p=>p.min);
    const max = agg.points.map(p=>p.max);
    const sd = agg.points.map(p=>p.sd);

    // bands
    if (state.show.minmax){
      traces.push({
        type:"scatter", x:t, y:min, mode:"lines", name:"mín (sel)",
        line:{width:0}, hoverinfo:"skip", showlegend:false
      });
      traces.push({
        type:"scatter", x:t, y:max, mode:"lines", name:"faixa min–max",
        fill:"tonexty", line:{width:0},
        fillcolor:"rgba(96,165,250,.12)",
        hoverinfo:"skip"
      });
    }
    if (state.show.std){
      const up = mean.map((v,i)=>v+sd[i]);
      const lo = mean.map((v,i)=>v-sd[i]);
      traces.push({type:"scatter", x:t, y:lo, mode:"lines", line:{width:0}, hoverinfo:"skip", showlegend:false});
      traces.push({type:"scatter", x:t, y:up, mode:"lines", fill:"tonexty", line:{width:0}, name:"±1 sd",
        fillcolor:"rgba(52,211,153,.10)", hoverinfo:"skip"});
    }

    if (state.show.mean){
      traces.push({
        type:"scatter", x:t, y:mean, mode:"lines", name:"média",
        line:{width:3}
      });
    }
    if (state.show.min){
      traces.push({type:"scatter", x:t, y:min, mode:"lines", name:"linha mín", line:{width:2, dash:"dot"}});
    }
    if (state.show.max){
      traces.push({type:"scatter", x:t, y:max, mode:"lines", name:"linha máx", line:{width:2, dash:"dot"}});
    }

    // MK annotation (on mean)
    if (state.show.mk && mean.length>=8){
      const yclean = mean.filter(Number.isFinite);
      const xf = t.map(d=>d.getFullYear() + d.getMonth()/12);
      const mk = mannKendall(yclean);
      const sen = senSlope(yclean, xf.slice(0,yclean.length));
      annotations.push({
        xref:"paper", yref:"paper", x:0.01, y:1.16, showarrow:false,
        text:`MK(tau=${mk.tau.toFixed(3)}, p=${mk.p.toFixed(4)}) · Sen=${sen.toFixed(3)} ${vmeta.unit}/ano`,
        font:{size:12, color:"#b6c0d1"}
      });
    }
  } else {
    // view/compare: one trace per group (município ou Planalto/Planície)
    const useLoc = (state.mode==="compare" && (state.compareBy||"mun")==="loc");
    const baseSeries = (useLoc ? (agg.byLoc||[]) : (agg.series||[]));
    const series = baseSeries.slice().sort((a,b)=>a.name.localeCompare(b.name,"pt-BR"));
    const colors = ["#60a5fa","#34d399","#fbbf24","#fb7185","#a78bfa","#22c55e","#38bdf8","#f97316","#e879f9","#f43f5e","#84cc16","#06b6d4"];

    series.forEach((s,idx)=>{
      const t = s.points.map(p=>p.t);
      const y = s.points.map(p=>p.y_sm);
      traces.push({
        type:"scatter", x:t, y, mode:"lines",
        name: s.name,
        line:{width: state.mode==="compare"? 2.6 : 1.6, color: colors[idx%colors.length]},
        opacity: state.mode==="compare"? 0.95 : 0.55
      });

      // MK per municipality (compare mode)
      if (state.mode==="compare" && state.show.mk && y.length>=8){
        const mk = mannKendall(y);
        const xf = t.map(d=>d.getFullYear()+d.getMonth()/12);
        const sen = senSlope(y, xf);
        annotations.push({
          xref:"paper", yref:"paper", x:0.01, y:1.16-idx*0.05, showarrow:false,
          text:`${s.name}: MK tau=${mk.tau.toFixed(3)} p=${mk.p.toFixed(4)} · Sen=${sen.toFixed(2)} ${vmeta.unit}/ano`,
          font:{size:12, color:"#b6c0d1"}
        });
      }
    });

    // mean across selected (optional)
    if (state.show.mean){
      const map = new Map();
      for(const s of series){
        for(const p of s.points){
          const k=p.t.toISOString();
          if (!map.has(k)) map.set(k,{t:p.t, vals:[]});
          map.get(k).vals.push(p.y_sm);
        }
      }
      const pts = Array.from(map.values()).sort((a,b)=>a.t-b.t).map(o=>{
        const m=o.vals.reduce((a,b)=>a+b,0)/o.vals.length;
        return {t:o.t, y:m};
      });
      traces.push({
        type:"scatter", x:pts.map(p=>p.t), y:pts.map(p=>p.y), mode:"lines",
        name:"média (seleção)",
        line:{width:3.6, color:"#9ca3af"},
        opacity:0.95
      });
    }
  }


  // horizontal reference lines (global over selection)
  if ((state.show.hmean || state.show.hmin || state.show.hmax) && traces.length){
    // pick reference x-range from first trace that has x
    const x0 = (traces.find(t=>Array.isArray(t.x) && t.x.length) || {}).x;
    if (x0 && x0.length){
      const xs = [x0[0], x0[x0.length-1]];
      // collect y values from visible "data" traces
      const ys = [];
      traces.forEach(tr=>{
        if (!Array.isArray(tr.y)) return;
        tr.y.forEach(v=>{ if (Number.isFinite(v)) ys.push(v); });
      });
      if (ys.length){
        const ymin = Math.min(...ys);
        const ymax = Math.max(...ys);
        const ymean = ys.reduce((a,b)=>a+b,0)/ys.length;
        const addH = (y, name)=> traces.push({type:"scatter", x:xs, y:[y,y], mode:"lines", name, line:{width:1.5, dash:"dash"}, opacity:0.6});
        if (state.show.hmean) addH(ymean, "média (série)");
        if (state.show.hmin) addH(ymin, "mín (série)");
        if (state.show.hmax) addH(ymax, "máx (série)");
      }
    }
  }

  const layout = plotLayout("Série temporal", ylab);
  layout.annotations = annotations;
  Plotly.react("tsChart", traces, layout, {displaylogo:false, responsive:true});
}

function corrPearson(x,y){
  const n=x.length;
  const mx=x.reduce((a,b)=>a+b,0)/n;
  const my=y.reduce((a,b)=>a+b,0)/n;
  let num=0, dx=0, dy=0;
  for(let i=0;i<n;i++){
    const vx=x[i]-mx, vy=y[i]-my;
    num+=vx*vy; dx+=vx*vx; dy+=vy*vy;
  }
  return num/Math.sqrt(dx*dy);
}
function corrSpearman(x,y){
  // rank then pearson
  function rank(a){
    const idx=a.map((v,i)=>[v,i]).sort((p,q)=>p[0]-q[0]);
    const r=new Array(a.length);
    for(let i=0;i<idx.length;i++){
      r[idx[i][1]] = i+1;
    }
    return r;
  }
  return corrPearson(rank(x), rank(y));
}

function renderCompare(rows, agg){
  const type = state.cmp.type;
  const xk = state.cmp.x;
  const yk = state.cmp.y;
  const corrType = state.cmp.corr;

  const xmeta = VARS.find(v=>v.key===xk) || VARS[0];
  const ymeta = VARS.find(v=>v.key===yk) || VARS[0];

  let traces=[];
  let layout = plotLayout("Comparação", ymeta.label);
  layout.xaxis.title = xmeta.label;

  const statsEl = $("cmpStats");

  if (!rows.length){
    Plotly.react("cmpChart", [], layout, {displaylogo:false, responsive:true});
    statsEl.textContent="Sem dados.";
    return;
  }

  if (type==="box"){ type="scatter"; }



  if (type==="corr"){
    // correlation matrix between selected vars
    const keys = VARS.map(v=>v.key);
    // build rows filtered & aggregated to same timestep using current mode's mean series
    // For simplicity, use raw rows at monthly resolution, merge by (mun,ym) then average across selected muns.
    const selRows = filteredRows(); // uses state filters
    const map = new Map(); // time -> values per var
    for(const r of selRows){
      const k = String(r.ym);
      if (!map.has(k)) map.set(k, {k, vals:{} , counts:{}});
      for(const v of keys){
        const val = r[v];
        if (Number.isFinite(val)){
          map.get(k).vals[v] = (map.get(k).vals[v]||0)+val;
          map.get(k).counts[v] = (map.get(k).counts[v]||0)+1;
        }
      }
    }
    const series = Array.from(map.values()).sort((a,b)=>a.k.localeCompare(b.k));
    const mat=[];
    for(let i=0;i<keys.length;i++){
      const row=[];
      for(let j=0;j<keys.length;j++){
        const xi=[], yi=[];
        for(const s of series){
          const a = (s.vals[keys[i]]||0)/(s.counts[keys[i]]||1);
          const b = (s.vals[keys[j]]||0)/(s.counts[keys[j]]||1);
          if (Number.isFinite(a) && Number.isFinite(b)){
            xi.push(a); yi.push(b);
          }
        }
        let c=0;
        if (xi.length>=3){
          c = (corrType==="spearman")? corrSpearman(xi,yi) : corrPearson(xi,yi);
        }
        row.push(c);
      }
      mat.push(row);
    }
    traces = [{
      type:"heatmap",
      z: mat,
      x: VARS.map(v=>v.label),
      y: VARS.map(v=>v.label),
      zmin:-1, zmax:1,
      colorscale:"RdBu",
      reversescale:true
    }];
    layout.title.text = `Matriz de correlação (${corrType})`;
    layout.xaxis.tickangle = -30;
    layout.margin = {l:140,r:20,t:60,b:130};
    Plotly.react("cmpChart", traces, layout, {displaylogo:false, responsive:true});
    statsEl.textContent = "Valores variam de -1 a +1.";
    return;
  }

  // scatter
  // Build scatter points using aggregated series per municipality when compare, else use aggregated mean series.
  const points = [];
  if (state.mode==="compare" && state.mun.length>=2){
    const set = new Set(state.mun);
    for(const r of rows){
      if (!set.has(r.NM_MUN)) continue;
      const x = r[xk], y = r[yk];
      if (Number.isFinite(x) && Number.isFinite(y)){
        points.push({g:r.NM_MUN, x, y});
      }
    }
    const groups = state.mun.slice();
    const colors = ["#60a5fa","#34d399","#fbbf24","#fb7185","#a78bfa","#38bdf8","#f97316","#e879f9","#84cc16","#06b6d4","#f43f5e","#22c55e"];
    groups.forEach((g,idx)=>{
      const arr = points.filter(p=>p.g===g);
      traces.push({
        type:"scatter", mode:"markers",
        name:g,
        x: arr.map(p=>p.x),
        y: arr.map(p=>p.y),
        marker:{size:7, opacity:0.78, color:colors[idx%colors.length]}
      });
    });

    // global regression + corr across all points
    const X = points.map(p=>p.x);
    const Y = points.map(p=>p.y);
    if (X.length>=3){
      const lr = linreg(X,Y);
      const xmin = Math.min(...X), xmax = Math.max(...X);
      traces.push({
        type:"scatter", mode:"lines", name:"regressão (global)",
        x:[xmin,xmax],
        y:[lr.intercept+lr.slope*xmin, lr.intercept+lr.slope*xmax],
        line:{width:3, color:"#9ca3af"},
        opacity:0.9
      });
      const c = (corrType==="spearman")? corrSpearman(X,Y) : corrPearson(X,Y);
      statsEl.textContent = `Correlação (${corrType}): ${fmt(c,3)} (n=${X.length}) · Regressão global: y = ${fmt(lr.intercept,3)} + ${fmt(lr.slope,6)}x · R²=${fmt(lr.r2,3)}`;
    } else {
      statsEl.textContent = "Poucos pontos para regressão/correlação.";
    }
    layout.title.text = "Dispersão (por município)";
    Plotly.react("cmpChart", traces, layout, {displaylogo:false, responsive:true});
    return;
  } else {
    // single scatter for selection
    const X=[], Y=[];
    for(const r of rows){
      const x=r[xk], y=r[yk];
      if (Number.isFinite(x) && Number.isFinite(y)){ X.push(x); Y.push(y); }
    }
    traces.push({
      type:"scatter", mode:"markers", name:"pontos",
      x:X, y:Y,
      marker:{size:7, opacity:0.72, color:"#60a5fa"}
    });
    if (X.length>=3){
      const lr = linreg(X,Y);
      const xmin = Math.min(...X), xmax = Math.max(...X);
      traces.push({
        type:"scatter", mode:"lines", name:"regressão",
        x:[xmin,xmax],
        y:[lr.intercept+lr.slope*xmin, lr.intercept+lr.slope*xmax],
        line:{width:3, color:"#9ca3af"},
        opacity:0.9
      });
      const c = (corrType==="spearman")? corrSpearman(X,Y) : corrPearson(X,Y);
      statsEl.textContent = `Correlação (${corrType}): ${fmt(c,3)} (n=${X.length}) · Regressão: y = ${fmt(lr.intercept,3)} + ${fmt(lr.slope,6)}x · R²=${fmt(lr.r2,3)}`;
    } else {
      statsEl.textContent = "Poucos pontos para regressão/correlação.";
    }
    layout.title.text = "Dispersão";
    Plotly.react("cmpChart", traces, layout, {displaylogo:false, responsive:true});
  }
}

load();
