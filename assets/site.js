/* ================================================================
   NEXUS COMMAND DASHBOARD — ClearGlass Inc.
   Live feeds: Open-Meteo · USGS · NOAA SWPC · OpenSky Network
               wheretheiss.at · IESO · CoinGecko · Open ER-API
               Ontario 511
================================================================ */

const LOC = { lat: 43.3255, lon: -79.7990 };
// Live camera feeds require a same-origin/server-side integration configured at deployment.
const cameraFeedEndpoint = () => window.CLEARGLASS_CONFIG?.cameraFeedUrl || '';

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[char]));
function safeHttpsUrl(value) { try { const u = new URL(value); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; } }
async function fetchChecked(url, options = {}) {
  const signal = options.signal || (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(12000) : undefined);
  const response = await fetch(url, {...options, signal});
  if (!response.ok) { const error = new Error(`Request failed: ${response.status}`); error.status=response.status; error.retryAfter=response.headers?.get('Retry-After'); throw error; }
  return response;
}
const FEED_CLOCK_SKEW_MS = 2 * 60 * 1000;
function validSourceTime(value, {maxAgeMs=30*60*1000, allowOld=false}={}) {
  const time = typeof value === 'number' ? (value < 1e12 ? value*1000 : value) : Date.parse(value);
  if (!Number.isFinite(time) || time > Date.now()+FEED_CLOCK_SKEW_MS) return null;
  if (!allowOld && Date.now()-time > maxAgeMs) return null;
  return time;
}
function feedDiagnostic(feed, endpoint, category, error) {
  if (!window.__CLEARGLASS_FEED_DEBUG__) return;
  const safeEndpoint = String(endpoint||'').split('?')[0];
  console.warn('[feed]', {feed, endpoint:safeEndpoint, category, attemptedAt:new Date().toISOString(), status:error?.status||null});
}
const fetchJSON = url => fetchChecked(url).then(response => response.json());
const fetchText = url => fetchChecked(url).then(response => response.text());

/* ─────────── CLOCK ─────────── */
function tick() {
  const n = new Date();
  document.getElementById('nx-clock').textContent =
    [n.getHours(),n.getMinutes(),n.getSeconds()].map(v=>String(v).padStart(2,'0')).join(':');
}
setInterval(tick, 1000); tick();

/* ─────────── MAIN MAP ─────────── */
let map = null;
if (window.L) {
  map = L.map('map',{zoomControl:true,attributionControl:true}).setView([LOC.lat,LOC.lon],11);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{
    attribution:'© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> · © <a href="https://carto.com/attributions">CARTO</a>',
    subdomains:'abcd',maxZoom:19
  }).addTo(map);
  L.circleMarker([LOC.lat,LOC.lon],{
    color:'#00ff88',fillColor:'#00ff88',fillOpacity:.85,radius:7,weight:2
  }).addTo(map).bindPopup('<b>Burlington, ON</b>');
} else {
  document.getElementById('map').textContent = 'MAP UNAVAILABLE · LIVE DATA FEEDS REMAIN ACTIVE';
  document.getElementById('map').classList.add('map-fallback');
}

/* ─────────── ISS MAP ─────────── */
const issMap = window.L ? L.map('iss-map',{
  zoomControl:false,attributionControl:false,
  dragging:false,scrollWheelZoom:false,touchZoom:false
}).setView([0,0],1) : null;
if (issMap) L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{
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
    const d = await fetchJSON(url);
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
    const d = await fetchJSON(url);
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
let allAC=[], acMode='all', airspaceObservedAt=null, airspaceSuccessAt=null, airspaceAttemptAt=null, airspaceError=null, airspaceRetryAt=0;
function setAcTab(mode, el) {
  acMode = mode;
  document.querySelectorAll('.ac-tab').forEach(t=>{ t.classList.remove('on'); t.setAttribute('aria-pressed','false'); });
  if(el) { el.classList.add('on'); el.setAttribute('aria-pressed','true'); }
  renderAC();
}
function renderAC() {
  const list = document.getElementById('ac-list');
  let data = allAC;
  if(acMode==='high') data = allAC.filter(a=>a[7]!=null&&a[7]>9000);
  const stale = airspaceError || !airspaceObservedAt || Date.now()-airspaceObservedAt>5*60*1000;
  const stateLabel = stale ? 'STALE AIRCRAFT POSITIONS' : 'VALIDATED AIRCRAFT POSITIONS';
  const stateLine = '<div class="feed-state" role="status" aria-live="polite">'+stateLabel+
    (airspaceObservedAt?' · SOURCE '+new Date(airspaceObservedAt).toLocaleTimeString():' · NO SOURCE TIMESTAMP')+
    (airspaceSuccessAt?' · FETCH '+new Date(airspaceSuccessAt).toLocaleTimeString():' · NO SUCCESSFUL FETCH')+'</div>';
  if(!data.length) { list.innerHTML=stateLine+'<div style="padding:10px;font-size:8.5px;color:var(--text)">'+(stale?'AIRCRAFT DATA UNAVAILABLE':'NO AIRCRAFT IN RANGE')+'</div>'; return; }
  list.innerHTML = stateLine+data.slice(0,20).map(a=>{
    const call = (a[1]||'').trim()||'UNKNOWN';
    const alt  = a[7]!=null ? Math.round(a[7])+'m' : 'GND';
    const spd  = a[9]!=null ? Math.round(a[9]*3.6)+' km/h' : '–';
    const cty  = a[2]||'';
    return '<div class="aci" data-freshness="'+(stale?'stale':'live')+'"><span class="ac-call">✈ '+escapeHtml(call)+'</span><span class="ac-alt">'+alt+'</span><span class="ac-info">'+escapeHtml(spd)+' · '+escapeHtml(cty)+(stale?' · STALE':'')+'</span></div>';
  }).join('');
}
async function fetchAirspace() {
  if(Date.now()<airspaceRetryAt) return;
  airspaceAttemptAt=Date.now();
  const url = 'https://opensky-network.org/api/states/all?lamin=42.8&lomin=-81.0&lamax=44.2&lomax=-78.5';
  try {
    const response=await fetchChecked(url);
    const d=await response.json();
    if(!d||!Array.isArray(d.states)||!Number.isFinite(Number(d.time))) throw new Error('Invalid OpenSky response');
    const observed=validSourceTime(Number(d.time),{maxAgeMs:5*60*1000});
    if(!observed) throw new Error('OpenSky response timestamp missing, stale, or implausible');
    const positions=d.states.filter(a=>Array.isArray(a)&&a.length>=7&&
      Number.isFinite(Number(a[5]))&&Number.isFinite(Number(a[6]))&&
      Number(a[5])>=-81.0&&Number(a[5])<=-78.5&&Number(a[6])>=42.8&&Number(a[6])<=44.2&&
      validSourceTime(a[3],{maxAgeMs:10*60*1000})!==null);
    allAC=positions.sort((a,b)=>(Number(b[7])||0)-(Number(a[7])||0));
    airspaceObservedAt=observed; airspaceSuccessAt=Date.now(); airspaceError=null;
    document.getElementById('ac-sub').textContent=allAC.length+' AIRCRAFT IN SECTOR · SOUTHERN ONTARIO · SOURCE '+new Date(observed).toLocaleTimeString();
    document.getElementById('ac-sub').classList.remove('pulse');
    setBadge('ac-badge',allAC.length+' AC',allAC.length?'b-live':'b-warn');
    renderAC();
  } catch(e) {
    airspaceError=e?.status===429?'rate-limited':e?.status===401||e?.status===403?'authorization':e?.status?'http-error':e?.name==='AbortError'?'timeout':'network-or-invalid-data';
    if(e?.status===429) {
      const retry=Number(e.retryAfter);
      airspaceRetryAt=Date.now()+(Number.isFinite(retry)&&retry>0?retry*1000:2*60*1000);
    }
    feedDiagnostic('opensky',url,airspaceError,e);
    if(airspaceObservedAt&&Date.now()-airspaceObservedAt>15*60*1000) { allAC=[]; airspaceObservedAt=null; }
    setBadge('ac-badge',airspaceError==='rate-limited'?'RATE LIMITED':airspaceError==='authorization'?'AUTH ERROR':'STALE / OFFLINE','b-warn');
    document.getElementById('ac-sub').textContent='AIRCRAFT FEED '+airspaceError.toUpperCase().replaceAll('-',' ')+' · LAST ATTEMPT '+new Date(airspaceAttemptAt).toLocaleTimeString();
    renderAC();
  }
}


/* ─────────── SEISMIC ─────────── */
async function fetchSeismic() {
  try {
    const d = await fetchJSON('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson');
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
        <span class="eq-loc">${escapeHtml(q.properties.place||'Unknown')}</span>
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
      fetchChecked('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json'),
      fetchChecked('https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json')
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
    const d = await fetchJSON('https://api.wheretheiss.at/v1/satellites/25544');
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
    if (issMap && !issMarker) {
      const icon = L.divIcon({html:'<div style="font-size:18px;text-shadow:0 0 8px #fff">🛸</div>',className:'',iconSize:[22,22],iconAnchor:[11,11]});
      issMarker = L.marker(pos,{icon}).addTo(issMap).bindPopup('ISS');
    } else if (issMarker) {
      issMarker.setLatLng(pos);
    }
    issMap?.setView(pos,1);
  } catch(e) {
    setBadge('iss-badge','NO SIGNAL','b-off');
    document.getElementById('iss-coord').textContent = 'SIGNAL LOST';
  }
}

/* ─────────── ONTARIO POWER GRID ─────────── */
const FUEL_COL = {NUCLEAR:'#4466ff',HYDRO:'#00ccff',GAS:'#ffaa00',WIND:'#00ff88',SOLAR:'#ffdd00',BIOFUEL:'#aa66ff',OTHER:'#667788'};
const FUEL_ORDER = ['NUCLEAR','HYDRO','GAS','WIND','SOLAR','BIOFUEL','OTHER'];
const GRID_ESTIMATE = {NUCLEAR:9200,HYDRO:2100,GAS:1400,WIND:950,SOLAR:140,BIOFUEL:200};
let gridLastGood=null, gridLastSuccessfulFetchAt=null, gridLastAttemptAt=null, gridLastError=null;
function parseIESOXml(txt, endpoint) {
  const xml=new DOMParser().parseFromString(txt,'text/xml');
  if(xml.querySelector('parsererror')||!xml.documentElement||xml.documentElement.localName==='parsererror') throw new Error('Malformed XML');
  const nodes=[...xml.querySelectorAll('FuelTotal,FuelSum')];
  if(!nodes.length) throw new Error('Expected generation total fields are missing');
  const fuels={};
  for(const node of nodes) {
    const fuel=(node.querySelector('Fuel,FuelType')?.textContent||'').trim().toUpperCase();
    const raw=node.querySelector('EnergyMW,OutputMW')?.textContent?.trim();
    const mw=raw===''||raw==null?NaN:Number(raw);
    if(!fuel||!Number.isFinite(mw)||mw<0) throw new Error('Invalid generation measurement');
    fuels[fuel]=(fuels[fuel]||0)+mw;
  }
  const timeText=xml.querySelector('CreatedAt,PublicationTime,PublishTime,DateTime,Created,GeneratedAt')?.textContent?.trim();
  const observedAt=validSourceTime(timeText,{maxAgeMs:15*60*1000});
  if(!observedAt) throw new Error('Source observation timestamp missing, stale, or implausible');
  if(!Object.values(fuels).some(v=>Number.isFinite(v))) throw new Error('No usable generation measurements');
  return {fuels,observedAt,endpoint};
}
async function fetchPowerGrid() {
  gridLastAttemptAt=Date.now();
  const endpoints=[
    'https://reports.ieso.ca/public/RealtimeConstTotals/PUB_RealtimeConstTotals.xml',
    'https://reports.ieso.ca/public/GenOutputCapability/PUB_GenOutputCapability.xml'
  ];
  const failures=[];
  for(const endpoint of endpoints) {
    try {
      const txt=await fetchText(endpoint);
      const result=parseIESOXml(txt,endpoint);
      gridLastGood=result; gridLastSuccessfulFetchAt=Date.now(); gridLastError=null;
      renderGrid(result.fuels,{state:'live',observedAt:result.observedAt,endpoint});
      return;
    } catch(e) {
      failures.push({endpoint,category:e?.status?'http-error':e?.name==='AbortError'?'timeout':'invalid-or-unavailable-data'});
      feedDiagnostic('ontario-power-grid',endpoint,failures[failures.length-1].category,e);
    }
  }
  gridLastError=failures;
  if(gridLastGood) {
    renderGrid(gridLastGood.fuels,{state:'stale',observedAt:gridLastGood.observedAt,endpoint:gridLastGood.endpoint});
  } else {
    renderGrid(GRID_ESTIMATE,{state:'estimated',observedAt:null,endpoint:null});
  }
}
function renderGrid(fuels,meta={state:'unavailable'}) {
  const total=Object.values(fuels||{}).reduce((sum,value)=>sum+(Number.isFinite(value)&&value>=0?value:0),0);
  const rowsHost=document.getElementById('fuel-rows');
  const state=meta.state||'unavailable';
  const sourceTime=meta.observedAt?new Date(meta.observedAt).toLocaleString():'No successful observation yet';
  const fetchTime=gridLastSuccessfulFetchAt?new Date(gridLastSuccessfulFetchAt).toLocaleString():'No successful observation yet';
  if(!total||!Number.isFinite(total)) {
    document.getElementById('pg-total').textContent='UNAVAILABLE';
    setBadge('pg-badge','UNAVAILABLE','b-off');
    rowsHost.innerHTML='<div role="status">POWER GRID UNAVAILABLE · '+escapeHtml(sourceTime)+'</div>';
    return;
  }
  document.getElementById('pg-total').innerHTML=(total/1000).toFixed(2)+' <span class="pg-unit">GW</span>';
  const badge=state==='live'?(total/1000).toFixed(1)+' GW':state==='stale'?'STALE':'EST';
  setBadge('pg-badge',badge,state==='live'?'b-live':state==='estimated'?'b-est':'b-warn');
  const rows=FUEL_ORDER.filter(f=>Number(fuels[f])>0).map(f=>{
    const mw=Number(fuels[f]),pct=Math.round(mw/total*100),col=FUEL_COL[f]||FUEL_COL.OTHER;
    return '<div class="fr"><div class="fd" style="background:'+col+'"></div><span class="fn">'+f+'</span><div class="fb-w"><div class="fb" style="width:'+pct+'%;background:'+col+'"></div></div><span class="fg">'+(mw/1000).toFixed(2)+' GW</span><span class="fp">'+pct+'%</span></div>';
  });
  const label=state==='estimated'?'ESTIMATED — static fallback, not a live measurement.':state==='stale'?'STALE — last known validated observation; refresh failed.':'LIVE — validated source observation.';
  rows.push('<div class="feed-state" role="status" aria-live="polite">'+label+'<br>SOURCE OBSERVED: '+escapeHtml(sourceTime)+'<br>LAST SUCCESSFUL FETCH: '+escapeHtml(fetchTime)+'<br>LAST ATTEMPT: '+escapeHtml(gridLastAttemptAt?new Date(gridLastAttemptAt).toLocaleString():'Not attempted')+'</div>');
  rowsHost.innerHTML=rows.join('');
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
    const d = await fetchJSON(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`);
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
    const d = await fetchJSON('https://open.er-api.com/v6/latest/USD');
    if(d.result!=='success') throw new Error('fail');
    setBadge('fx-badge','LIVE','b-live');
    document.getElementById('fx-list').innerHTML = FX_PAIRS.filter(p=>d.rates[p.q]).map(p=>{
      const rate = p.inv ? (1/d.rates[p.q]) : d.rates[p.q];
      return `<div class="fxr"><span class="fxp">${p.label}</span><span class="fxv">${rate.toFixed(4)}</span></div>`;
    }).join('');
  } catch(e) { setBadge('fx-badge','ERR','b-off'); }
}

/* ─────────── CAMERAS ─────────── */
let allCams=[], camFilter='ALL', cameraRefreshPromise=null, cameraGeneration=0;
let cameraLastSuccessfulFetchAt=null, cameraLastAttemptAt=null, cameraLastError=null;
function filterCams(f, el) {
  camFilter=f;
  document.querySelectorAll('[data-camera-filter]').forEach(b=>{b.classList.remove('on');b.setAttribute('aria-pressed','false');});
  if(el){el.classList.add('on');el.setAttribute('aria-pressed','true');}
  renderCams();
}
function renderCams() {
  const grid=document.getElementById('cam-grid');
  const cams=camFilter==='ALL'?allCams:allCams.filter(c=>(c.highway||'').includes(camFilter)||(c.name||'').toUpperCase().includes(camFilter));
  if(!cams.length) {
    grid.innerHTML='<div role="status" aria-live="polite" style="grid-column:1/-1;padding:20px;text-align:center;color:var(--text);font-size:8.5px">'+
      (cameraLastError?'CAMERA FEED UNAVAILABLE — '+escapeHtml(cameraLastError):cameraFeedEndpoint()?'NO CAMERAS RETURNED BY CONFIGURED FEED':'CONFIGURATION REQUIRED — authorized server-side Ontario 511 integration is not configured')+
      (cameraLastSuccessfulFetchAt?'<br>LAST SUCCESSFUL METADATA FETCH: '+new Date(cameraLastSuccessfulFetchAt).toLocaleString():'<br>No successful metadata fetch yet')+'</div>';
    return;
  }
  grid.innerHTML=cams.slice(0,20).map(c=>{
    const name=escapeHtml(c.name||'CAMERA'),hw=escapeHtml(c.highway||''),imageUrl=safeHttpsUrl(c.url);
    return '<div class="cam"><img src="'+escapeHtml(imageUrl)+'" loading="lazy" alt="'+name+'" data-camera-id="'+escapeHtml(c.id||'')+'"/>'+
      '<div class="cam-nf" style="display:none" role="status" aria-live="polite"><div class="cam-nf-icon">⊘</div><div>IMAGE FAILED TO LOAD</div></div>'+
      '<div class="cam-top"><span class="cam-tag">'+hw+'</span><span class="cam-tag">IMAGE STATUS: LOADING</span></div>'+
      '<div class="cam-ov"><div class="cam-nm">'+name+'</div><div class="cam-st"><span class="cam-st-dot"></span> IMAGE AVAILABLE</div></div></div>';
  }).join('');
  grid.querySelectorAll('img').forEach(img=>{
    img.addEventListener('load',()=>{const card=img.closest('.cam');const status=card?.querySelector('.cam-top .cam-tag:last-child');if(status)status.textContent='IMAGE LOADED';});
    img.addEventListener('error',()=>{const card=img.closest('.cam');img.style.display='none';const failure=card?.querySelector('.cam-nf');if(failure)failure.style.display='flex';const status=card?.querySelector('.cam-top .cam-tag:last-child');if(status)status.textContent='IMAGE FAILED';});
  });
}
function normalizeCameras(data) {
  if(!Array.isArray(data)) throw new Error('Camera response is not a list');
  return data.map(c=>{
    const name=c?.Name||c?.name||c?.RoadwayName||c?.Description||'CAMERA';
    const id=String(c?.Id||c?.ID||c?.id||'');
    const raw=c?.Url||c?.url||c?.ImageUrl||c?.SnapshotUrl||'';
    const url=safeHttpsUrl(raw);
    if(!url) return null;
    let highway='';
    if(/\bQEW\b/i.test(name)) highway='QEW';
    else if(/\b400\b/.test(name)) highway='400';
    else if(/\b407\b/.test(name)) highway='407';
    else if(/\b403\b/.test(name)) highway='403';
    else if(/\b401\b/.test(name)) highway='401';
    return {name:String(name),id,url,highway};
  }).filter(Boolean).sort((a,b)=>({QEW:0,'400':1,'407':2,'403':3,'401':4}[a.highway]??9)-({QEW:0,'400':1,'407':2,'403':3,'401':4}[b.highway]??9));
}
async function fetchCameras() {
  if(cameraRefreshPromise) return cameraRefreshPromise;
  const generation=++cameraGeneration;
  cameraLastAttemptAt=Date.now();
  cameraRefreshPromise=(async()=>{
    const endpoint=cameraFeedEndpoint();
    if(!endpoint) {cameraLastError='CONFIGURATION REQUIRED';setBadge('cam-cnt-badge','CONFIG REQUIRED','b-warn');document.getElementById('cam-sub').textContent='No authorized server-side Ontario 511 feed configured';renderCams();return;}
    if(!safeHttpsUrl(endpoint)) {cameraLastError='INVALID CONFIGURATION';setBadge('cam-cnt-badge','CONFIG ERROR','b-off');renderCams();return;}
    try {
      const response=await fetchChecked(endpoint);
      const data=await response.json();
      const next=normalizeCameras(data);
      if(generation!==cameraGeneration) return;
      // A valid empty response is a successful observation, not a network failure.
      allCams=next;
      cameraLastSuccessfulFetchAt=Date.now();cameraLastError=null;
      setBadge('cam-cnt-badge',next.length+' VALID URLS',next.length?'b-live':'b-warn');
      document.getElementById('cam-sub').textContent='ONTARIO 511 · METADATA FETCH '+new Date(cameraLastSuccessfulFetchAt).toLocaleTimeString();
      renderCams();
    } catch(e) {
      if(generation!==cameraGeneration) return;
      cameraLastError=e?.status===429?'RATE LIMITED':e?.status===401||e?.status===403?'AUTHORIZATION FAILED':e?.status?'HTTP ERROR':'NETWORK OR INVALID RESPONSE';
      feedDiagnostic('ontario-cameras',endpoint,cameraLastError,e);
      setBadge('cam-cnt-badge',allCams.length?'STALE':'UNAVAILABLE','b-warn');
      document.getElementById('cam-sub').textContent='CAMERA METADATA REFRESH FAILED · LAST ATTEMPT '+new Date(cameraLastAttemptAt).toLocaleTimeString();
      renderCams();
    }
  })().finally(()=>{cameraRefreshPromise=null;});
  return cameraRefreshPromise;
}
async function refreshCams() {
  const button=document.getElementById('cam-refresh');
  if(cameraRefreshPromise) return cameraRefreshPromise;
  if(button){button.textContent='↻ REFRESHING';button.setAttribute('aria-busy','true');}
  try { await fetchCameras(); }
  finally { if(button){button.textContent='↻ REFRESH';button.removeAttribute('aria-busy');} }
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

const pollers = [];
function poll(task, delay) {
  let timer;
  let stopped = false;
  const run = async () => {
    try { if (!document.hidden) await task(); }
    finally { if (!stopped) timer = window.setTimeout(run, delay); }
  };
  timer = window.setTimeout(run, delay);
  pollers.push(() => { stopped = true; clearTimeout(timer); });
}
poll(fetchWeather,10*60*1000); poll(fetchAQ,15*60*1000);
poll(fetchSeismic,5*60*1000); poll(fetchSpaceWeather,5*60*1000);
poll(fetchAirspace,2*60*1000); poll(fetchISS,5*1000);
poll(fetchPowerGrid,5*60*1000); poll(fetchCrypto,30*1000);
poll(fetchFX,10*60*1000); poll(refreshCams,60*1000);
window.addEventListener('pagehide', () => pollers.forEach(stop => stop()), {once:true});
document.addEventListener('visibilitychange',()=>{ if(!document.hidden) { renderAC(); } });


document.querySelectorAll('[data-airspace-filter]').forEach(button => button.addEventListener('click', () => setAcTab(button.dataset.airspaceFilter, button)));
document.querySelectorAll('[data-camera-filter]').forEach(button => button.addEventListener('click', () => filterCams(button.dataset.cameraFilter, button)));
document.querySelector('[data-camera-refresh]')?.addEventListener('click', refreshCams);
document.getElementById('cam-grid')?.addEventListener('error', event => { if (event.target instanceof HTMLImageElement) { event.target.style.display='none'; const card=event.target.closest('.cam'); const failure=card?.querySelector('.cam-nf'); if(failure) failure.style.display='flex'; const status=card?.querySelector('.cam-top .cam-tag:last-child'); if(status) status.textContent='IMAGE FAILED'; } }, true);

/* ─────────── SUBTLE CONTENT PROTECTION ───────────
   Browser protections are deterrents, never guarantees. Friction is scoped to
   proprietary regions so controls, links, and the public data remain usable. */
(function initContentProtection(){
  const protectedSelector = '[data-protected]';
  const toast = document.createElement('div');
  toast.className = 'protection-toast';
  toast.setAttribute('role','status');
  toast.setAttribute('aria-live','polite');
  toast.textContent = 'PROPRIETARY CLEARGLASSINC ARTEMIS MATERIAL · SHARING BY AUTHORIZATION';
  document.body.appendChild(toast);
  let toastTimer;
  const notifyProtection = () => {
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
  };
  const isEditable = target => target instanceof Element && Boolean(target.closest('input,textarea,[contenteditable="true"]'));
  document.addEventListener('contextmenu', event => {
    if (event.target instanceof Element && event.target.closest(protectedSelector)) { event.preventDefault(); notifyProtection(); }
  });
  document.addEventListener('copy', event => {
    const selection = window.getSelection();
    const origin = selection?.anchorNode?.parentElement;
    if (origin?.closest(protectedSelector) && !isEditable(origin)) { event.preventDefault(); notifyProtection(); }
  });
  document.addEventListener('cut', event => {
    if (event.target instanceof Element && event.target.closest(protectedSelector) && !isEditable(event.target)) event.preventDefault();
  });
  document.addEventListener('dragstart', event => {
    if (event.target instanceof Element && event.target.closest(protectedSelector)) event.preventDefault();
  });

  const sensitive = document.querySelector('[data-sensitive]');
  let inactivityTimer;
  const reveal = () => {
    sensitive?.classList.remove('is-veiled');
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => sensitive?.classList.add('is-veiled'), 45000);
  };
  ['pointerdown','keydown','scroll'].forEach(type => window.addEventListener(type, reveal, {passive:true}));
  window.addEventListener('blur', () => sensitive?.classList.add('is-veiled'));
  document.addEventListener('visibilitychange', () => document.hidden ? sensitive?.classList.add('is-veiled') : reveal());
  reveal();

  const sessionMark = `${new Date().toISOString().slice(0,10)} · ${Math.random().toString(36).slice(2,8).toUpperCase()}`;
  document.querySelectorAll('[data-session-mark]').forEach(node => { node.textContent = sessionMark; });
})();
