/* ================================================================
   NEXUS COMMAND DASHBOARD — ClearGlass Inc.
   Live feeds: Open-Meteo · USGS · NOAA SWPC · OpenSky Network
               wheretheiss.at · IESO · CoinGecko · Open ER-API
               Ontario 511
================================================================ */

const LOC = { lat: 43.3255, lon: -79.7990 };
const PROXY = 'https://corsproxy.io/?';

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[char]));
function safeHttpsUrl(value) { try { const u = new URL(value); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; } }

/* ─────────── CLOCK ─────────── */
function tick() {
  const n = new Date();
  document.getElementById('nx-clock').textContent =
    [n.getHours(),n.getMinutes(),n.getSeconds()].map(v=>String(v).padStart(2,'0')).join(':');
}
setInterval(tick, 1000); tick();

/* ─────────── MAIN MAP ─────────── */
const map = L.map('map',{zoomControl:true,attributionControl:true}).setView([LOC.lat,LOC.lon],11);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{
  attribution:'© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> · © <a href="https://carto.com/attributions">CARTO</a>',
  subdomains:'abcd',maxZoom:19
}).addTo(map);
L.circleMarker([LOC.lat,LOC.lon],{
  color:'#00ff88',fillColor:'#00ff88',fillOpacity:.85,radius:7,weight:2
}).addTo(map).bindPopup('<b>Burlington, ON</b>');

/* ─────────── ISS MAP ─────────── */
const issMap = L.map('iss-map',{
  zoomControl:false,attributionControl:false,
  dragging:false,scrollWheelZoom:false,touchZoom:false
}).setView([0,0],1);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{
  subdomains:'abcd',maxZoom:6
}).addTo(issMap);
let issMarker = null;

/* ─────────── WEATHER ─────────── */
const WX_ICON = {0:'☀️',1:'🌤',2:'⛅',3:'☁️',45:'🌫',48:'🌫',51:'🌦',53:'🌦',55:'🌧',
  61:'🌧',63:'🌧',65:'🌧',71:'🌨',73:'🌨',75:'❄️',77:'❄️',
  80:'🌦',81:'🌧',82:'⛈',85:'🌨',86:'❄️',95:'⛈',96:'⛈',99:'⛈'};
const WX_DESC = {0:'CLEAR SKY',1:'MAINLY CLEAR',2:'PARTLY CLOUDY',3:'OVERCAST',
  45:'FOG',48:'FREEZING FOG',51:'LIGHT DRIZZLE',53:'DRIZZLE',55:'HEAVY DRIZZLE',
  61:'LIGHT RAIN',63:'RAIN',65:'HEAVY RAIN',71:'LIGHT SNOW',73:'SNOW',75:'HEAVY SNOW',
  80:'SHOWERS',81:'RAIN SHOWERS',82:'VIOLENT SHOWERS',95:'THUNDERSTORM',96:'THUNDERSTORM',99:'THUNDERSTORM'};
const DIRS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
const deg2card = d => DIRS[Math.round(d/22.5)%16];

async function fetchWeather() {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${LOC.lat}&longitude=${LOC.lon}`+
      `&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,`+
      `wind_direction_10m,surface_pressure,precipitation,weather_code&wind_speed_unit=kmh`+
      `&timezone=America%2FToronto`;
    const d = await fetch(url).then(r=>r.json());
    const c = d.current;
    const temp = Math.round(c.temperature_2m);
    document.getElementById('wx-temp').textContent = temp+'°C';
    document.getElementById('wx-icon').textContent  = WX_ICON[c.weather_code]||'🌡';
    document.getElementById('wx-icon').classList.remove('pulse');
    document.getElementById('wx-desc').textContent  = WX_DESC[c.weather_code]||'';
    setBadge('wx-badge', temp+'°C', 'b-live');
    document.getElementById('wx-rows').innerHTML = [
      ['FEELS LIKE', Math.round(c.apparent_temperature)+'°C'],
      ['HUMIDITY',   c.relative_humidity_2m+'%'],
      ['WIND',       c.wind_speed_10m+' km/h '+deg2card(c.wind_direction_10m)],
      ['PRESSURE',   c.surface_pressure+' hPa'],
      ['PRECIP',     c.precipitation+' mm'],
    ].map(([l,v])=>`<div class="wr"><span class="wl">${l}</span><span class="wv">${v}</span></div>`).join('');
  } catch(e) { setBadge('wx-badge','ERR','b-off'); }
}

/* ─────────── AIR QUALITY ─────────── */
function aqiCat(n) {
  if(n<=50)  return ['GOOD','#00ff88'];
  if(n<=100) return ['FAIR','#ffaa00'];
  if(n<=150) return ['MODERATE','#ff8800'];
  if(n<=200) return ['POOR','#ff4455'];
  return              ['VERY POOR','#aa00ff'];
}
async function fetchAQ() {
  try {
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${LOC.lat}&longitude=${LOC.lon}`+
      `&current=pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,ozone,european_aqi`;
    const d = await fetch(url).then(r=>r.json());
    const c = d.current;
    const aqi = Math.round(c.european_aqi||0);
    const [cat,col] = aqiCat(aqi);
    document.getElementById('aqi-num').textContent = aqi;
    document.getElementById('aqi-num').style.color = col;
    document.getElementById('aqi-cat').textContent = 'AQI – '+cat;
    setBadge('aq-badge','AQI '+aqi,'b-live');
    document.getElementById('aq-rows').innerHTML = [
      ['PM10',  (c.pm10||0).toFixed(1)+' μg/m³'],
      ['PM2.5', (c.pm2_5||0).toFixed(1)+' μg/m³'],
      ['OZONE', (c.ozone||0).toFixed(1)+' μg/m³'],
      ['NO₂',   (c.nitrogen_dioxide||0).toFixed(1)+' μg/m³'],
    ].map(([n,v])=>`<div class="ar"><span class="an">${n}</span><span class="av">${v}</span></div>`).join('');
  } catch(e) { setBadge('aq-badge','ERR','b-off'); }
}

/* ─────────── AIRSPACE ─────────── */
let allAC=[], acMode='all';
function setAcTab(mode, el) {
  acMode = mode;
  document.querySelectorAll('.ac-tab').forEach(t=>t.classList.remove('on'));
  if(el) el.classList.add('on');
  renderAC();
}
function renderAC() {
  const list = document.getElementById('ac-list');
  let data = allAC;
  if(acMode==='high') data = allAC.filter(a=>a[7]!=null&&a[7]>9000);
  if(!data.length) { list.innerHTML='<div style="padding:10px;font-size:8.5px;color:var(--text)">NO AIRCRAFT IN RANGE</div>'; return; }
  list.innerHTML = data.slice(0,20).map(a=>{
    const call = (a[1]||'').trim()||'UNKNOWN';
    const alt  = a[7]!=null ? Math.round(a[7])+'m' : 'GND';
    const spd  = a[9]!=null ? Math.round(a[9]*3.6)+' km/h' : '–';
    const cty  = a[2]||'';
    return `<div class="aci">
      <span class="ac-call">✈ ${call}</span>
      <span class="ac-alt">${alt}</span>
      <span class="ac-info">${spd} · ${cty}</span>
    </div>`;
  }).join('');
}
async function fetchAirspace() {
  try {
    const url = `https://opensky-network.org/api/states/all?lamin=42.8&lomin=-81.0&lamax=44.2&lomax=-78.5`;
    const d = await fetch(url).then(r=>r.json());
    allAC = (d.states||[]).filter(a=>a[5]!=null&&a[6]!=null).sort((a,b)=>(b[7]||0)-(a[7]||0));
    document.getElementById('ac-sub').textContent = allAC.length+' AIRCRAFT IN SECTOR · SOUTHERN ONTARIO';
    document.getElementById('ac-sub').classList.remove('pulse');
    setBadge('ac-badge', allAC.length+' AC', allAC.length>0?'b-live':'b-warn');
    renderAC();
  } catch(e) {
    setBadge('ac-badge','LIMIT','b-warn');
    document.getElementById('ac-sub').textContent = 'RATE LIMITED – RETRY IN 2 MIN';
  }
}

/* ─────────── SEISMIC ─────────── */
async function fetchSeismic() {
  try {
    const d = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson').then(r=>r.json());
    const qs = d.features||[];
    const maxMag = qs.reduce((m,q)=>Math.max(m,q.properties.mag||0),0);
    document.getElementById('seis-cnt').textContent = qs.length;
    document.getElementById('seis-max').textContent = 'M'+maxMag.toFixed(1);
    setBadge('seis-badge', qs.length+' EVENTS','b-live');
    const latest = qs[0];
    if(latest){
      const lt = `SEISMIC — M${latest.properties.mag.toFixed(1)} ${latest.properties.place}`;
      ['t-eq','t-eq2'].forEach(id=>{ document.getElementById(id).textContent=lt; });
    }
    document.getElementById('eq-list').innerHTML = qs.slice(0,15).map(q=>{
      const mag = q.properties.mag||0;
      const cls = mag>=5?'m5':mag>=4?'m4':mag>=3?'m3':'m2';
      return `<div class="eqi">
        <span class="eq-m ${cls}">M${mag.toFixed(1)}</span>
        <span class="eq-loc">${q.properties.place||'Unknown'}</span>
        <span class="eq-t">${ago(q.properties.time)}</span>
      </div>`;
    }).join('');
  } catch(e) { setBadge('seis-badge','ERR','b-off'); }
}
function ago(ms) {
  const s = Math.floor((Date.now()-ms)/1000);
  if(s<60) return s+'s';
  if(s<3600) return Math.floor(s/60)+'m';
  return Math.floor(s/3600)+'h';
}

/* ─────────── SPACE WEATHER ─────────── */
async function fetchSpaceWeather() {
  try {
    const [kpRes, xrRes] = await Promise.all([
      fetch('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json'),
      fetch('https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json')
    ]);
    const kpData = await kpRes.json();
    const xrData = await xrRes.json();

    // kpData: first row is headers, rest is data; kp is index 1
    const lastRow = kpData[kpData.length-1];
    const kp = parseFloat(lastRow[1]||0);

    // Count kp>=3 events in last 24h
    const kpEvents = kpData.filter(r=>r!==kpData[0]&&parseFloat(r[1])>=3).length;

    // X-ray flux — filter long wavelength (0.1-0.8nm)
    const lw = xrData.filter(x=>x.energy==='0.1-0.8nm');
    const latestFlux = lw.length ? parseFloat(lw[lw.length-1].flux||0) : 0;
    const mClass = (latestFlux>=1e-5&&latestFlux<1e-4)?1:0;
    const xClass = latestFlux>=1e-4?1:0;

    document.getElementById('sw-kp').textContent = kp.toFixed(1);
    document.getElementById('sw-events').textContent = kpEvents;
    document.getElementById('sw-m').textContent = mClass;
    document.getElementById('sw-x').textContent = xClass;
    setBadge('sw-badge','Kp '+kp.toFixed(1), kp>=5?'b-warn':'b-live');

    const geo  = kp>=7?'SEVERE':kp>=5?'STORM':kp>=3?'ACTIVE':'QUIET';
    const aur  = kp>=7?'ACTIVE':kp>=5?'VISIBLE':kp>=3?'POSSIBLE':'QUIET';
    const geoCol = kp>=5?'var(--red)':kp>=3?'var(--orange)':'var(--green)';

    document.getElementById('sw-rows').innerHTML = `
      <div class="swr"><span class="swl">GEOMAGNETIC</span><span class="swv" style="color:${geoCol}">${geo}</span></div>
      <div class="swr"><span class="swl">AURORA</span><span class="swv" style="color:${geoCol}">${aur}</span></div>
      <div class="swr"><span class="swl">X-RAY FLUX</span><span class="swv">${latestFlux.toExponential(2)}</span></div>
    `;
    const kt = `NOAA SPACE WEATHER — KP-INDEX ${kp.toFixed(1)} · GEOMAGNETIC ${geo}`;
    ['t-kp','t-kp2'].forEach(id=>{ document.getElementById(id).textContent=kt; });
  } catch(e) { setBadge('sw-badge','ERR','b-off'); }
}

/* ─────────── ISS ─────────── */
async function fetchISS() {
  try {
    const d = await fetch('https://api.wheretheiss.at/v1/satellites/25544').then(r=>r.json());
    const lat = parseFloat(d.latitude), lon = parseFloat(d.longitude);
    const latS = (lat>=0?lat.toFixed(3)+'°N':Math.abs(lat).toFixed(3)+'°S');
    const lonS = (lon>=0?lon.toFixed(3)+'°E':Math.abs(lon).toFixed(3)+'°W');
    document.getElementById('iss-coord').textContent = latS+' · '+lonS;
    document.getElementById('iss-coord').style.color = 'var(--cyan)';
    setBadge('iss-badge','LOCKED','b-live');
    document.getElementById('iss-rows').innerHTML = [
      ['ALTITUDE',  parseFloat(d.altitude).toFixed(1)+' km'],
      ['VELOCITY',  Math.round(d.velocity).toLocaleString()+' km/h'],
      ['FOOTPRINT', parseFloat(d.footprint).toFixed(0)+' km'],
      ['VISIBILITY',String(d.visibility||'').toUpperCase()],
    ].map(([l,v])=>`<div class="issr"><span class="issl">${l}</span><span class="issv">${v}</span></div>`).join('');

    const pos = [lat, lon];
    if (!issMarker) {
      const icon = L.divIcon({html:'<div style="font-size:18px;text-shadow:0 0 8px #fff">🛸</div>',className:'',iconSize:[22,22],iconAnchor:[11,11]});
      issMarker = L.marker(pos,{icon}).addTo(issMap).bindPopup('ISS');
    } else {
      issMarker.setLatLng(pos);
    }
    issMap.setView(pos,1);
  } catch(e) {
    setBadge('iss-badge','NO SIGNAL','b-off');
    document.getElementById('iss-coord').textContent = 'SIGNAL LOST';
  }
}

/* ─────────── ONTARIO POWER GRID ─────────── */
const FUEL_COL = {NUCLEAR:'#4466ff',HYDRO:'#00ccff',GAS:'#ffaa00',WIND:'#00ff88',SOLAR:'#ffdd00',BIOFUEL:'#aa66ff',OTHER:'#667788'};
const FUEL_ORDER = ['NUCLEAR','HYDRO','GAS','WIND','SOLAR','BIOFUEL','OTHER'];

async function fetchPowerGrid() {
  // Try IESO realtime XML
  const ieso = 'http://reports.ieso.ca/public/RealtimeConstTotals/PUB_RealtimeConstTotals.xml';
  try {
    const txt = await fetch(PROXY + encodeURIComponent(ieso)).then(r=>r.text());
    const xml = new DOMParser().parseFromString(txt,'text/xml');
    const totals = {};
    xml.querySelectorAll('FuelTotal').forEach(ft=>{
      const fuel = ft.querySelector('Fuel')?.textContent?.trim().toUpperCase()||'OTHER';
      const mw   = parseFloat(ft.querySelector('EnergyMW')?.textContent||0);
      totals[fuel] = (totals[fuel]||0)+mw;
    });
    if(Object.keys(totals).length) { renderGrid(totals); return; }
  } catch(e){}

  // Fallback: try the 5-minute supply XML
  const ieso2 = 'http://reports.ieso.ca/public/GenOutputCapability/PUB_GenOutputCapability.xml';
  try {
    const txt = await fetch(PROXY + encodeURIComponent(ieso2)).then(r=>r.text());
    const xml = new DOMParser().parseFromString(txt,'text/xml');
    const totals = {};
    xml.querySelectorAll('FuelSum,FuelTotal').forEach(ft=>{
      const fuel = (ft.querySelector('Fuel,FuelType')?.textContent||'OTHER').trim().toUpperCase();
      const mw   = parseFloat(ft.querySelector('EnergyMW,OutputMW,Capacity')?.textContent||0);
      totals[fuel] = (totals[fuel]||0)+mw;
    });
    if(Object.keys(totals).length) { renderGrid(totals); return; }
  } catch(e){}

  // Static fallback with disclaimer
  renderGrid({NUCLEAR:9200,HYDRO:2100,GAS:1400,WIND:950,SOLAR:140,BIOFUEL:200},true);
}

function renderGrid(fuels, est=false) {
  const total = Object.values(fuels).reduce((s,v)=>s+v,0);
  if(!total) { renderGrid({NUCLEAR:9200,HYDRO:2100,GAS:1400,WIND:950,SOLAR:140,BIOFUEL:200},true); return; }
  document.getElementById('pg-total').innerHTML = (total/1000).toFixed(2)+' <span class="pg-unit">GW</span>';
  setBadge('pg-badge', est?'EST':((total/1000).toFixed(1)+' GW'), est?'b-est':'b-live');
  const rows = FUEL_ORDER.filter(f=>fuels[f]>0).map(f=>{
    const mw = fuels[f], pct = Math.round(mw/total*100), col = FUEL_COL[f]||FUEL_COL.OTHER;
    return `<div class="fr">
      <div class="fd" style="background:${col}"></div>
      <span class="fn">${f}</span>
      <div class="fb-w"><div class="fb" style="width:${pct}%;background:${col}"></div></div>
      <span class="fg">${(mw/1000).toFixed(2)} GW</span>
      <span class="fp">${pct}%</span>
    </div>`;
  });
  document.getElementById('fuel-rows').innerHTML = rows.join('');
}

/* ─────────── CRYPTO ─────────── */
const COINS = [
  {id:'bitcoin',   name:'BITCOIN',  sym:'BTC'},
  {id:'ethereum',  name:'ETHEREUM', sym:'ETH'},
  {id:'solana',    name:'SOLANA',   sym:'SOL'},
  {id:'cardano',   name:'CARDANO',  sym:'ADA'},
  {id:'ripple',    name:'XRP',      sym:'XRP'},
];
async function fetchCrypto() {
  try {
    const ids = COINS.map(c=>c.id).join(',');
    const d = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`).then(r=>r.json());
    setBadge('crypto-badge','LIVE','b-live');
    if(d.bitcoin) {
      const bt = `CRYPTO — BTC $${d.bitcoin.usd.toLocaleString()} · ETH $${(d.ethereum?.usd||0).toLocaleString()}`;
      ['t-crypto','t-crypto2'].forEach(id=>{ document.getElementById(id).textContent=bt; });
    }
    document.getElementById('crypto-list').innerHTML = COINS.map(c=>{
      const coin = d[c.id]; if(!coin) return '';
      const chg = coin.usd_24h_change||0;
      const arrow = chg>=0?'▲':'▼';
      const chgCls = chg>=0?'cg':'cr2';
      return `<div class="cr">
        <div><div class="cn">${c.name}</div><div class="cs">${c.sym}</div></div>
        <div style="text-align:right">
          <div class="cp">$${coin.usd>=1000?coin.usd.toLocaleString():coin.usd.toFixed(4)}</div>
          <div class="${chgCls}">${arrow} ${(chg>=0?'+':'')+chg.toFixed(2)}%</div>
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    setBadge('crypto-badge','OFFLINE','b-off');
    document.getElementById('crypto-list').innerHTML='<div style="padding:20px;text-align:center;color:var(--text);font-size:8.5px">FEED UNAVAILABLE</div>';
  }
}

/* ─────────── FX RATES ─────────── */
const FX_PAIRS = [
  {q:'CAD',label:'USD/CAD'},
  {q:'EUR',label:'EUR/USD',inv:true},
  {q:'GBP',label:'GBP/USD',inv:true},
  {q:'JPY',label:'USD/JPY'},
  {q:'CHF',label:'USD/CHF'},
  {q:'MXN',label:'USD/MXN'},
];
async function fetchFX() {
  try {
    const d = await fetch('https://open.er-api.com/v6/latest/USD').then(r=>r.json());
    if(d.result!=='success') throw new Error('fail');
    setBadge('fx-badge','LIVE','b-live');
    document.getElementById('fx-list').innerHTML = FX_PAIRS.filter(p=>d.rates[p.q]).map(p=>{
      const rate = p.inv ? (1/d.rates[p.q]) : d.rates[p.q];
      return `<div class="fxr"><span class="fxp">${p.label}</span><span class="fxv">${rate.toFixed(4)}</span></div>`;
    }).join('');
  } catch(e) { setBadge('fx-badge','ERR','b-off'); }
}

/* ─────────── CAMERAS ─────────── */
let allCams=[], camFilter='ALL';

function filterCams(f, el) {
  camFilter = f;
  document.querySelectorAll('.cam-flt-btn').forEach(b=>b.classList.remove('on'));
  if(el) el.classList.add('on');
  renderCams();
}

function renderCams() {
  const grid = document.getElementById('cam-grid');
  let cams = camFilter==='ALL' ? allCams : allCams.filter(c=>(c.highway||'').includes(camFilter)||(c.name||'').toUpperCase().includes(camFilter));
  if(!cams.length){
    grid.innerHTML='<div style="grid-column:1/-1;padding:20px;text-align:center;color:var(--text);font-size:8.5px">NO CAMERAS MATCH FILTER</div>';
    return;
  }
  grid.innerHTML = cams.slice(0,20).map(c=>{
    const name = escapeHtml(c.name||'CAMERA');
    const hw = escapeHtml(c.highway||'');
    const imageUrl = safeHttpsUrl(c.url);
    if(imageUrl){
      return `<div class="cam">
        <img src="${imageUrl}" loading="lazy"
          alt="${escapeHtml(name)}"/>
        <div class="cam-nf" style="display:none"><div class="cam-nf-icon">⊘</div><div>No live feed</div></div>
        <div class="cam-top">
          <span class="cam-tag">${hw}</span>
          <span class="cam-tag" style="color:var(--green)">● LIVE</span>
        </div>
        <div class="cam-ov">
          <div class="cam-nm">${name}</div>
          <div class="cam-st"><span class="cam-st-dot"></span> LIVE</div>
        </div>
      </div>`;
    }
    return `<div class="cam">
      <div class="cam-nf"><div class="cam-nf-icon">⊘</div><div>No live camera<br>feed at this time</div></div>
      <div class="cam-ov"><div class="cam-nm">${name}</div></div>
    </div>`;
  }).join('');
}

async function fetchCameras() {
  const tried511 = await try511();
  if(!tried511) renderCamsFallback();
}

async function try511() {
  try {
    const url = 'https://511on.ca/api/v2/cameras?format=json&lang=en&limit=150';
    const txt = await fetch(PROXY + encodeURIComponent(url)).then(r=>r.text());
    const data = JSON.parse(txt);
    if(!Array.isArray(data)||!data.length) return false;

    allCams = data.map(c=>{
      const name = c.Name||c.name||c.RoadwayName||c.Description||'CAMERA';
      const id   = c.Id||c.ID||c.id||'';
      const imgUrl = c.Url||c.url||c.ImageUrl||c.SnapshotUrl||
        (id?`https://511on.ca/cameras/image/${id}`:null);
      let highway = '';
      if(/\bQEW\b/i.test(name))      highway='QEW';
      else if(/\b400\b/.test(name))   highway='400';
      else if(/\b407\b/.test(name))   highway='407';
      else if(/\b403\b/.test(name))   highway='403';
      else if(/\b401\b/.test(name))   highway='401';
      return { name, id, url:imgUrl, highway };
    }).filter(c=>c.url);

    allCams.sort((a,b)=>{
      const o={'QEW':0,'400':1,'407':2,'403':3,'401':4};
      return (o[a.highway]??9)-(o[b.highway]??9);
    });

    const cnt = allCams.length;
    setBadge('cam-cnt-badge', cnt+' FOUND', cnt>0?'b-live':'b-warn');
    document.getElementById('cam-sub').textContent = 'ONTARIO 511 · QEW · HWY 400 · HWY 407';
    renderCams();
    return cnt>0;
  } catch(e){ return false; }
}

// Fallback: known public traffic camera image endpoints
const STATIC_CAMS = [
  {name:'QEW @ Brant St (Burlington)',   highway:'QEW', url:null},
  {name:'QEW @ Guelph Line',             highway:'QEW', url:null},
  {name:'QEW @ Walkers Line',            highway:'QEW', url:null},
  {name:'QEW @ Cawthra Rd',              highway:'QEW', url:null},
  {name:'QEW @ Hurontario St',           highway:'QEW', url:null},
  {name:'QEW @ Hwy 427 EB',             highway:'QEW', url:null},
  {name:'HWY 400 @ Hwy 401',            highway:'400', url:null},
  {name:'HWY 400 @ Brant St',           highway:'400', url:null},
  {name:'HWY 407 EB Approach',          highway:'407', url:null},
  {name:'QEW @ Burlington Skyway',      highway:'QEW', url:null},
];
function renderCamsFallback() {
  allCams = STATIC_CAMS;
  setBadge('cam-cnt-badge','API KEY REQ','b-warn');
  document.getElementById('cam-sub').textContent = '511on.ca API · KEY REQUIRED FOR LIVE IMAGES';
  renderCams();
}

function refreshCams() {
  document.getElementById('cam-refresh').textContent='↻ …';
  // Force-reload images with cache-buster
  document.querySelectorAll('#cam-grid img').forEach(img=>{
    const src = img.src.replace(/[?&]t=\d+/,'');
    img.src = src+(src.includes('?')?'&':'?')+'t='+Date.now();
  });
  fetchCameras().finally(()=>{ document.getElementById('cam-refresh').textContent='↻ REFRESH'; });
}

/* ─────────── BADGE HELPER ─────────── */
function setBadge(id, text, cls) {
  const el = document.getElementById(id);
  if(!el) return;
  el.textContent = text;
  el.className = 'badge '+cls;
}

/* ─────────── BOOT ─────────── */
(async function init(){
  fetchWeather();
  fetchAQ();
  fetchSeismic();
  fetchSpaceWeather();
  fetchAirspace();
  fetchISS();
  fetchPowerGrid();
  fetchCrypto();
  fetchFX();
  fetchCameras();
})();

setInterval(fetchWeather,      10*60*1000);
setInterval(fetchAQ,           15*60*1000);
setInterval(fetchSeismic,       5*60*1000);
setInterval(fetchSpaceWeather,  5*60*1000);
setInterval(fetchAirspace,      2*60*1000);
setInterval(fetchISS,              5*1000);
setInterval(fetchPowerGrid,     5*60*1000);
setInterval(fetchCrypto,           30*1000);
setInterval(fetchFX,           10*60*1000);
setInterval(refreshCams,        60*1000);


document.querySelectorAll('[data-airspace-filter]').forEach(button => button.addEventListener('click', () => setAcTab(button.dataset.airspaceFilter, button)));
document.querySelectorAll('[data-camera-filter]').forEach(button => button.addEventListener('click', () => filterCams(button.dataset.cameraFilter, button)));
document.querySelector('[data-camera-refresh]')?.addEventListener('click', refreshCams);
document.getElementById('cam-grid')?.addEventListener('error', event => { if (event.target instanceof HTMLImageElement) { event.target.style.display='none'; event.target.nextElementSibling?.style.setProperty('display','flex'); } }, true);
