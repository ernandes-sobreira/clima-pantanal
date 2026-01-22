
/* Pantanal Clima — app.js
   Tudo roda client-side (GitHub Pages). CSV em /data/pantanal_clima_utf8.csv
*/

const DATA_URL = "data/pantanal_clima_utf8.csv";

const el = (id) => document.getElementById(id);
const toast = (msg) => {
  const t = el("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 1600);
};

let RAW = [];
let META = { years: [], muns: [], vars: [] };
let SCOPE = "mun";

const VARS = [
  { key:"precip_sum_mm", label:"Precipitação (soma, mm)" },
  { key:"tmean_c", label:"Temperatura média (°C)" },
  { key:"tmin_c", label:"Temperatura mínima (°C)" },
  { key:"tmax_c", label:"Temperatura máxima (°C)" },
  { key:"rh_mean_pct", label:"Umidade relativa média (%)" },
  { key:"hi_mean_c", label:"Índice de calor médio (°C)" },
  { key:"hi_max_c", label:"Índice de calor máximo (°C)" },
];

function fmt(x, d=2){
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  const abs = Math.abs(x);
  if (abs !== 0 && (abs >= 1e6 || abs < 1e-3)) return x.toExponential(2);
  return Number(x).toFixed(d);
}

function parseNumber(v){
  if (v === null || v === undefined) return NaN;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : NaN;
}

function parseYM(ym){
  // ym = "YYYY-MM"
  const [y,m] = ym.split("-").map(x => parseInt(x,10));
  return { y, m, t: new Date(Date.UTC(y, m-1, 1)) };
}

function movingAverage(arr, k){
  if (!k || k<=1) return arr.slice();
  const out = [];
  for (let i=0;i<arr.length;i++){
    const a = Math.max(0, i-k+1);
    const slice = arr.slice(a, i+1).filter(v => Number.isFinite(v));
    out.push(slice.length ? slice.reduce((s,v)=>s+v,0)/slice.length : NaN);
  }
  return out;
}

/* ========= Robust trend: Mann–Kendall + Sen slope ========= */

function mannKendall(x){
  // Returns tau, z, p (two-sided), S, varS
  const n = x.length;
  let S = 0;
  for (let i=0;i<n-1;i++){
    for (let j=i+1;j<n;j++){
      const a=x[i], b=x[j];
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      if (b>a) S += 1;
      else if (b<a) S -= 1;
    }
  }
  // Ties correction
  const vals = x.filter(Number.isFinite).slice().sort((a,b)=>a-b);
  let ties = [];
  let run = 1;
  for (let i=1;i<vals.length;i++){
    if (vals[i] === vals[i-1]) run++;
    else { if (run>1) ties.push(run); run=1; }
  }
  if (run>1) ties.push(run);

  const nn = vals.length;
  const varS = (() => {
    if (nn < 2) return NaN;
    let v = nn*(nn-1)*(2*nn+5);
    if (ties.length){
      let tSum = 0;
      for (const t of ties){
        tSum += t*(t-1)*(2*t+5);
      }
      v -= tSum;
    }
    return v/18.0;
  })();

  let z = 0;
  if (Number.isFinite(varS) && varS>0){
    if (S > 0) z = (S - 1)/Math.sqrt(varS);
    else if (S < 0) z = (S + 1)/Math.sqrt(varS);
    else z = 0;
  } else {
    z = NaN;
  }

  const p = Number.isFinite(z) ? 2*(1 - normalCdf(Math.abs(z))) : NaN;
  const tau = (nn>1) ? S / (0.5*nn*(nn-1)) : NaN;
  return { tau, z, p, S, varS, n: nn };
}

function senSlope(t, x){
  // Median of slopes between all pairs (i<j): (xj-xi)/(tj-ti)
  const slopes = [];
  for (let i=0;i<x.length-1;i++){
    for (let j=i+1;j<x.length;j++){
      const xi=x[i], xj=x[j];
      if (!Number.isFinite(xi) || !Number.isFinite(xj)) continue;
      const dt = (t[j]-t[i]);
      if (dt===0) continue;
      slopes.push((xj-xi)/dt);
    }
  }
  slopes.sort((a,b)=>a-b);
  if (!slopes.length) return NaN;
  const mid = Math.floor(slopes.length/2);
  return slopes.length%2 ? slopes[mid] : (slopes[mid-1]+slopes[mid])/2;
}

// Normal CDF via erf approximation
function erf(x){
  // Abramowitz & Stegun approximation
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);
  const a1=0.254829592, a2=-0.284496736, a3=1.421413741, a4=-1.453152027, a5=1.061405429;
  const p=0.3275911;
  const t=1/(1+p*x);
  const y=1-((((a5*t+a4)*t+a3)*t+a2)*t+a1)*t*Math.exp(-x*x);
  return sign*y;
}
function normalCdf(z){ return 0.5*(1+erf(z/Math.SQRT2)); }

/* ========= Regression / Correlation ========= */

function linReg(x, y){
  // returns slope, intercept, r2
  const pts = [];
  for (let i=0;i<x.length;i++){
    if (Number.isFinite(x[i]) && Number.isFinite(y[i])) pts.push([x[i], y[i]]);
  }
  const n = pts.length;
  if (n < 2) return { slope: NaN, intercept: NaN, r2: NaN, n };
  const xs = pts.map(p=>p[0]), ys=pts.map(p=>p[1]);
  const mx = xs.reduce((s,v)=>s+v,0)/n;
  const my = ys.reduce((s,v)=>s+v,0)/n;
  let num=0, den=0;
  for (let i=0;i<n;i++){
    num += (xs[i]-mx)*(ys[i]-my);
    den += (xs[i]-mx)*(xs[i]-mx);
  }
  const slope = den===0 ? NaN : num/den;
  const intercept = my - slope*mx;
  // r2
  let ssTot=0, ssRes=0;
  for (let i=0;i<n;i++){
    const yhat = intercept + slope*xs[i];
    ssTot += (ys[i]-my)*(ys[i]-my);
    ssRes += (ys[i]-yhat)*(ys[i]-yhat);
  }
  const r2 = ssTot===0 ? NaN : 1 - ssRes/ssTot;
  return { slope, intercept, r2, n };
}

function pearson(x,y){
  const pts=[];
  for (let i=0;i<x.length;i++){
    if (Number.isFinite(x[i]) && Number.isFinite(y[i])) pts.push([x[i],y[i]]);
  }
  const n=pts.length;
  if (n<2) return { r: NaN, n };
  const xs=pts.map(p=>p[0]), ys=pts.map(p=>p[1]);
  const mx=xs.reduce((s,v)=>s+v,0)/n, my=ys.reduce((s,v)=>s+v,0)/n;
  let num=0, dx=0, dy=0;
  for (let i=0;i<n;i++){
    const a=xs[i]-mx, b=ys[i]-my;
    num += a*b; dx += a*a; dy += b*b;
  }
  const r = (dx===0 || dy===0) ? NaN : num/Math.sqrt(dx*dy);
  return { r, n };
}

function rank(arr){
  // average ranks for ties
  const indexed = arr.map((v,i)=>({v,i})).filter(o=>Number.isFinite(o.v));
  indexed.sort((a,b)=>a.v-b.v);
  const ranks = new Array(arr.length).fill(NaN);
  let i=0;
  while (i<indexed.length){
    let j=i;
    while (j+1<indexed.length && indexed[j+1].v===indexed[i].v) j++;
    const r = (i+j)/2 + 1;
    for (let k=i;k<=j;k++) ranks[indexed[k].i]=r;
    i=j+1;
  }
  return ranks;
}

function spearman(x,y){
  const rx=rank(x), ry=rank(y);
  return pearson(rx,ry);
}

/* ========= Data shaping ========= */

function unique(arr){ return Array.from(new Set(arr)); }

function getSelections(){
  const mun = Array.from(el("selMun").selectedOptions).map(o=>o.value);
  const loc = Array.from(el("selLoc").selectedOptions).map(o=>o.value);
  const v = el("selVar").value;
  const agg = el("selAgg").value;
  const start = parseInt(el("selStart").value,10);
  const end = parseInt(el("selEnd").value,10);
  const smooth = el("selSmooth").value;
  const bands = {
    minmax: el("chkMinMax").checked,
    std: el("chkStd").checked,
    mean: el("chkMeanLine").checked,
  };
  return { mun, loc, v, agg, start, end, smooth, bands };
}

function filterRaw(sel){
  return RAW.filter(r => {
    if (r.year < sel.start || r.year > sel.end) return false;
    if (SCOPE === "loc"){
      return sel.loc.length ? sel.loc.includes(r.LOCATION) : true;
    }
    // mun/agg scopes
    return sel.mun.length ? sel.mun.includes(r.NM_MUN) : true;
  });
}

function groupMonthly(rows, varKey){
  // group by ym (date). Each ym returns stats over selected units (mun or loc)
  const m = new Map();
  for (const r of rows){
    const key = r.ym;
    const v = r[varKey];
    if (!Number.isFinite(v)) continue;
    if (!m.has(key)) m.set(key, []);
    m.get(key).push(v);
  }
  const out = [];
  for (const [ym, vals] of m){
    vals.sort((a,b)=>a-b);
    const n=vals.length;
    const mean=vals.reduce((s,v)=>s+v,0)/n;
    const min=vals[0], max=vals[n-1];
    const med = vals[Math.floor(n/2)];
    const sd = Math.sqrt(vals.reduce((s,v)=>s+(v-mean)*(v-mean),0)/Math.max(1,n-1));
    out.push({ ym, ...parseYM(ym), n, mean, min, max, sd, med });
  }
  out.sort((a,b)=>a.t-b.t);
  return out;
}

function groupAnnual(rows, varKey){
  const m = new Map();
  for (const r of rows){
    const y = r.year;
    const v = r[varKey];
    if (!Number.isFinite(v)) continue;
    if (!m.has(y)) m.set(y, []);
    m.get(y).push(v);
  }
  const out=[];
  for (const [year, vals] of m){
    vals.sort((a,b)=>a-b);
    const n=vals.length;
    const mean=vals.reduce((s,v)=>s+v,0)/n;
    const min=vals[0], max=vals[n-1];
    const med = vals[Math.floor(n/2)];
    const sd = Math.sqrt(vals.reduce((s,v)=>s+(v-mean)*(v-mean),0)/Math.max(1,n-1));
    out.push({ year, t: new Date(Date.UTC(year,0,1)), n, mean, min, max, sd, med });
  }
  out.sort((a,b)=>a.year-b.year);
  return out;
}

function selectionSeries(rows, varKey, agg){
  if (agg === "annual") return groupAnnual(rows, varKey);
  return groupMonthly(rows, varKey);
}

function summarize(y){
  const vals = y.filter(Number.isFinite).slice().sort((a,b)=>a-b);
  const n=vals.length;
  if (!n) return null;
  const mean = vals.reduce((s,v)=>s+v,0)/n;
  const med = vals[Math.floor(n/2)];
  const sd = Math.sqrt(vals.reduce((s,v)=>s+(v-mean)*(v-mean),0)/Math.max(1,n-1));
  const q = (p) => vals[Math.floor((n-1)*p)];
  return {
    n, mean, med, sd,
    min: vals[0], max: vals[n-1],
    p05: q(0.05), p25: q(0.25), p75: q(0.75), p95: q(0.95)
  };
}

/* ========= Charts ========= */

function plotTimeSeries(series, sel, varLabel){
  const x = series.map(d=>d.t);
  let yMean = series.map(d=>d.mean);
  const k = sel.smooth === "none" ? 1 : parseInt(sel.smooth,10);
  if (k>1) yMean = movingAverage(yMean, k);

  const traces = [];
  const layout = {
    margin:{l:50,r:18,t:30,b:45},
    paper_bgcolor:"rgba(0,0,0,0)",
    plot_bgcolor:"rgba(0,0,0,0)",
    font:{color:"#e6edf7"},
    xaxis:{title:"Tempo", gridcolor:"rgba(255,255,255,.07)"},
    yaxis:{title:varLabel, gridcolor:"rgba(255,255,255,.07)"},
    legend:{orientation:"h", y:1.15},
  };

  // Bands
  if (sel.bands.minmax){
    traces.push({
      x, y: series.map(d=>d.min),
      mode:"lines",
      name:"min",
      line:{width:0},
      hoverinfo:"skip",
      showlegend:false
    });
    traces.push({
      x, y: series.map(d=>d.max),
      mode:"lines",
      name:"min–max",
      fill:"tonexty",
      fillcolor:"rgba(125,211,252,.14)",
      line:{width:0},
      hovertemplate:"max: %{y:.2f}<extra></extra>"
    });
  }
  if (sel.bands.std){
    const yUp = series.map(d=>d.mean + d.sd);
    const yLo = series.map(d=>d.mean - d.sd);
    traces.push({
      x, y: yLo,
      mode:"lines",
      name:"-1 sd",
      line:{width:0},
      hoverinfo:"skip",
      showlegend:false
    });
    traces.push({
      x, y: yUp,
      mode:"lines",
      name:"±1 sd",
      fill:"tonexty",
      fillcolor:"rgba(47,107,255,.14)",
      line:{width:0},
      hovertemplate:"+1 sd: %{y:.2f}<extra></extra>"
    });
  }

  // Mean line
  if (sel.bands.mean){
    traces.push({
      x, y: yMean,
      mode:"lines+markers",
      name: (k>1 ? `média (MM${k})` : "média"),
      line:{width:3},
      marker:{size:5},
      hovertemplate:"%{x|%Y-%m}: %{y:.2f}<extra></extra>"
    });
  } else {
    traces.push({
      x, y: yMean,
      mode:"lines",
      name:"série",
      line:{width:3},
      hovertemplate:"%{x|%Y-%m}: %{y:.2f}<extra></extra>"
    });
  }

  Plotly.newPlot("chartTS", traces, layout, {displayModeBar:true, responsive:true});
}

function plotCompare(sel, rows){
  const xKey = el("selX").value;
  const yKey = el("selY").value;
  const cmpType = el("selCmp").value;
  const corrType = el("selCorr").value;

  const sX = selectionSeries(rows, xKey, sel.agg);
  const sY = selectionSeries(rows, yKey, sel.agg);

  // align by time
  const mapY = new Map(sY.map(d => [d.t.getTime(), d.mean]));
  const xs=[], ys=[], ts=[];
  for (const d of sX){
    const k = d.t.getTime();
    if (mapY.has(k)){
      xs.push(d.mean);
      ys.push(mapY.get(k));
      ts.push(d.t);
    }
  }

  const corr = (corrType==="spearman") ? spearman(xs,ys) : pearson(xs,ys);
  const reg = linReg(xs,ys);

  if (cmpType === "corr"){
    // Correlation matrix among all VARS using aligned data
    const keys = VARS.map(v=>v.key);
    const label = (k)=> (VARS.find(v=>v.key===k)?.label || k);
    const baseSeries = {};
    // create time index via first key
    const base = selectionSeries(rows, keys[0], sel.agg);
    const time = base.map(d=>d.t.getTime());
    for (const k of keys){
      const s = selectionSeries(rows, k, sel.agg);
      const m = new Map(s.map(d => [d.t.getTime(), d.mean]));
      baseSeries[k] = time.map(ti => m.has(ti) ? m.get(ti) : NaN);
    }
    // matrix
    const z = [];
    for (const ky of keys){
      const row = [];
      for (const kx of keys){
        const c = (corrType==="spearman") ? spearman(baseSeries[kx], baseSeries[ky]) : pearson(baseSeries[kx], baseSeries[ky]);
        row.push(c.r);
      }
      z.push(row);
    }
    Plotly.newPlot("chartCMP", [{
      type:"heatmap",
      z,
      x: keys.map(label),
      y: keys.map(label),
      hovertemplate:"%{x}<br>%{y}<br>corr=%{z:.2f}<extra></extra>"
    }], {
      margin:{l:180,r:20,t:40,b:120},
      paper_bgcolor:"rgba(0,0,0,0)",
      plot_bgcolor:"rgba(0,0,0,0)",
      font:{color:"#e6edf7"},
      title:{text:`Matriz de correlação (${corrType})`, font:{size:14}},
    }, {displayModeBar:true, responsive:true});

    el("boxCmpStats").innerHTML = `n (tempo alinhado): <b>${time.length}</b>`;
    return;
  }

  // Scatter
  const xLab = VARS.find(v=>v.key===xKey)?.label || xKey;
  const yLab = VARS.find(v=>v.key===yKey)?.label || yKey;

  Plotly.newPlot("chartCMP", [{
    type:"scatter",
    mode:"markers",
    x: xs, y: ys,
    text: ts.map(d => d.toISOString().slice(0,7)),
    hovertemplate:"%{text}<br>x=%{x:.2f}<br>y=%{y:.2f}<extra></extra>",
    marker:{size:8, opacity:0.8}
  }], {
    margin:{l:55,r:18,t:30,b:55},
    paper_bgcolor:"rgba(0,0,0,0)",
    plot_bgcolor:"rgba(0,0,0,0)",
    font:{color:"#e6edf7"},
    xaxis:{title:xLab, gridcolor:"rgba(255,255,255,.07)"},
    yaxis:{title:yLab, gridcolor:"rgba(255,255,255,.07)"},
  }, {displayModeBar:true, responsive:true});

  el("boxCmpStats").innerHTML =
`Correlação (${corrType}): <b>${fmt(corr.r,3)}</b>  (n=${corr.n})<br>
Regressão: y = <b>${fmt(reg.intercept,3)}</b> + <b>${fmt(reg.slope,3)}</b>x  ·  R²=<b>${fmt(reg.r2,3)}</b>  (n=${reg.n})`;
}

/* ========= UI: state, URL sharing ========= */

function setScope(scope){
  SCOPE = scope;
  document.querySelectorAll(".segbtn").forEach(b => b.classList.toggle("active", b.dataset.scope===scope));
  // simple UI hint
  el("selMun").disabled = (scope==="loc");
  el("selLoc").disabled = (scope!=="loc");
}

function toQuery(sel){
  const q = new URLSearchParams();
  q.set("scope", SCOPE);
  if (sel.mun.length) q.set("mun", sel.mun.join("|"));
  if (sel.loc.length) q.set("loc", sel.loc.join("|"));
  q.set("v", sel.v);
  q.set("agg", sel.agg);
  q.set("start", String(sel.start));
  q.set("end", String(sel.end));
  q.set("smooth", sel.smooth);
  q.set("minmax", sel.bands.minmax ? "1":"0");
  q.set("std", sel.bands.std ? "1":"0");
  q.set("mean", sel.bands.mean ? "1":"0");
  // compare
  q.set("x", el("selX").value);
  q.set("y", el("selY").value);
  q.set("cmp", el("selCmp").value);
  q.set("corr", el("selCorr").value);
  return q.toString();
}

function applyQuery(){
  const q = new URLSearchParams(location.search);
  const scope = q.get("scope");
  if (scope) setScope(scope);

  const setMulti = (select, values) => {
    const set = new Set(values);
    Array.from(select.options).forEach(o => o.selected = set.has(o.value));
  };

  const mun = (q.get("mun")||"").split("|").filter(Boolean);
  const loc = (q.get("loc")||"").split("|").filter(Boolean);
  if (mun.length) setMulti(el("selMun"), mun);
  if (loc.length) setMulti(el("selLoc"), loc);

  const v = q.get("v"); if (v) el("selVar").value = v;
  const agg = q.get("agg"); if (agg) el("selAgg").value = agg;
  const start = q.get("start"); if (start) el("selStart").value = start;
  const end = q.get("end"); if (end) el("selEnd").value = end;
  const smooth = q.get("smooth"); if (smooth) el("selSmooth").value = smooth;

  const minmax = q.get("minmax"); if (minmax!==null) el("chkMinMax").checked = (minmax==="1");
  const std = q.get("std"); if (std!==null) el("chkStd").checked = (std==="1");
  const mean = q.get("mean"); if (mean!==null) el("chkMeanLine").checked = (mean==="1");

  const x = q.get("x"); if (x) el("selX").value = x;
  const y = q.get("y"); if (y) el("selY").value = y;
  const cmp = q.get("cmp"); if (cmp) el("selCmp").value = cmp;
  const corr = q.get("corr"); if (corr) el("selCorr").value = corr;
}

function resetUI(){
  // sensible defaults
  Array.from(el("selMun").options).forEach((o,i)=> o.selected = (i<3));
  Array.from(el("selLoc").options).forEach(o => o.selected = true);
  el("selVar").value = "precip_sum_mm";
  el("selAgg").value = "monthly";
  el("selSmooth").value = "none";
  el("chkMinMax").checked = true;
  el("chkStd").checked = false;
  el("chkMeanLine").checked = true;
  el("selX").value = "precip_sum_mm";
  el("selY").value = "tmean_c";
  el("selCmp").value = "scatter";
  el("selCorr").value = "pearson";
  el("selStart").value = String(META.years[0]);
  el("selEnd").value = String(META.years[META.years.length-1]);
  setScope("mun");
  history.replaceState({}, "", location.pathname);
  updateAll();
}

/* ========= Main update ========= */

function updateAll(){
  const sel = getSelections();
  const rows = filterRaw(sel);
  const series = selectionSeries(rows, sel.v, sel.agg);

  const varLabel = VARS.find(v=>v.key===sel.v)?.label || sel.v;
  plotTimeSeries(series, sel, varLabel);

  // summary + trend on mean series
  const y = series.map(d=>d.mean);
  const sum = summarize(y);
  if (!sum){
    el("boxSummary").textContent = "Sem dados para este recorte.";
    el("boxTrend").textContent = "—";
  } else {
    el("boxSummary").innerHTML =
`n: <b>${sum.n}</b><br>
média: <b>${fmt(sum.mean,2)}</b> · mediana: <b>${fmt(sum.med,2)}</b> · sd: <b>${fmt(sum.sd,2)}</b><br>
min: <b>${fmt(sum.min,2)}</b> · p05: <b>${fmt(sum.p05,2)}</b> · p95: <b>${fmt(sum.p95,2)}</b> · max: <b>${fmt(sum.max,2)}</b>`;
    // Trend test (time in years)
    const t = series.map(d => {
      const dt = d.t;
      // decimal year
      return dt.getUTCFullYear() + (dt.getUTCMonth()/12);
    });
    const mk = mannKendall(y);
    const slopeSen = senSlope(t, y);
    // linear regression y ~ t
    const reg = linReg(t, y);
    el("boxTrend").innerHTML =
`Mann–Kendall: tau=<b>${fmt(mk.tau,3)}</b> · z=<b>${fmt(mk.z,3)}</b> · p=<b>${fmt(mk.p,4)}</b> (n=${mk.n})<br>
Inclinação de Sen: <b>${fmt(slopeSen,4)}</b> por ano<br>
Regressão linear: slope=<b>${fmt(reg.slope,4)}</b> por ano · R²=<b>${fmt(reg.r2,3)}</b> (n=${reg.n})`;
  }

  // compare panel
  plotCompare(sel, rows);

  // update URL
  const qs = toQuery(sel);
  history.replaceState({}, "", `${location.pathname}?${qs}`);
}

function exportFiltered(){
  const sel = getSelections();
  const rows = filterRaw(sel);
  // Export raw rows filtered (not aggregated)
  const header = Object.keys(rows[0] || {});
  const lines = [header.join(",")];
  for (const r of rows){
    lines.push(header.map(k => {
      const v = r[k];
      if (typeof v === "string") return `"${v.replaceAll('"','""')}"`;
      return String(v);
    }).join(","));
  }
  const blob = new Blob([lines.join("\n")], {type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pantanal_clima_filtrado_${sel.start}-${sel.end}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function shareLink(){
  navigator.clipboard.writeText(location.href).then(()=>toast("Link copiado!"));
}

/* ========= Init ========= */

function initUI(){
  // scope buttons
  document.querySelectorAll(".segbtn").forEach(btn=>{
    btn.addEventListener("click", ()=>{ setScope(btn.dataset.scope); updateAll(); });
  });

  el("btnUpdate").addEventListener("click", updateAll);
  el("btnReset").addEventListener("click", resetUI);
  el("btnExport").addEventListener("click", exportFiltered);
  el("btnShare").addEventListener("click", shareLink);

  // reactive update for key controls (lightweight)
  ["selVar","selAgg","selStart","selEnd","selSmooth","chkMinMax","chkStd","chkMeanLine","selX","selY","selCmp","selCorr","selMun","selLoc"]
    .forEach(id => el(id).addEventListener("change", ()=> updateAll()));
}

function hydrateControls(){
  // municipalities
  const munSel = el("selMun");
  META.muns.forEach(m => {
    const o=document.createElement("option");
    o.value=m; o.textContent=m;
    munSel.appendChild(o);
  });

  // years
  const y0 = META.years[0], y1 = META.years[META.years.length-1];
  const ys = el("selStart"), ye = el("selEnd");
  for (let y=y0;y<=y1;y++){
    const o1=document.createElement("option"); o1.value=String(y); o1.textContent=String(y);
    const o2=document.createElement("option"); o2.value=String(y); o2.textContent=String(y);
    ys.appendChild(o1); ye.appendChild(o2);
  }

  // variables
  const vSel = el("selVar"), xSel = el("selX"), ySel = el("selY");
  for (const v of VARS){
    const o=document.createElement("option"); o.value=v.key; o.textContent=v.label;
    vSel.appendChild(o);
    const ox=document.createElement("option"); ox.value=v.key; ox.textContent=v.label;
    const oy=document.createElement("option"); oy.value=v.key; oy.textContent=v.label;
    xSel.appendChild(ox); ySel.appendChild(oy);
  }
}

async function loadData(){
  toast("Carregando dados…");
  return new Promise((resolve,reject)=>{
    Papa.parse(DATA_URL, {
      download:true,
      header:true,
      dynamicTyping:false,
      skipEmptyLines:true,
      complete: (res) => resolve(res.data),
      error: (err) => reject(err)
    });
  });
}

function coerceRows(rows){
  return rows.map(r => ({
    CD_MUN: r.CD_MUN,
    NM_MUN: r.NM_MUN,
    SIGLA_UF: r.SIGLA_UF,
    LOCATION: r.LOCATION,
    year: parseInt(r.year,10),
    month: parseInt(r.month,10),
    ym: r.ym,
    hi_max_c: parseNumber(r.hi_max_c),
    hi_mean_c: parseNumber(r.hi_mean_c),
    precip_sum_mm: parseNumber(r.precip_sum_mm),
    rh_mean_pct: parseNumber(r.rh_mean_pct),
    tmax_c: parseNumber(r.tmax_c),
    tmean_c: parseNumber(r.tmean_c),
    tmin_c: parseNumber(r.tmin_c),
  })).filter(r => Number.isFinite(r.year) && r.ym);
}

(async function main(){
  initUI();
  try{
    const data = await loadData();
    RAW = coerceRows(data);
    META.years = unique(RAW.map(r=>r.year)).sort((a,b)=>a-b);
    META.muns = unique(RAW.map(r=>r.NM_MUN)).sort((a,b)=>a.localeCompare(b,'pt-BR'));
    hydrateControls();

    // defaults
    resetUI();
    applyQuery();
    updateAll();
    toast("Pronto! Explore os filtros 🙂");
  } catch(e){
    console.error(e);
    toast("Erro ao carregar dados (veja o console).");
    el("boxSummary").textContent = "Erro ao carregar o CSV. Verifique /data/pantanal_clima_utf8.csv.";
  }
})();
