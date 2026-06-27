import { useState, useEffect, useRef } from "react";

// ── Themes ─────────────────────────────────────────────────────────────────
const DARK = {
  bg:'#0C1A27', surface:'#132233', lift:'#1B3048', border:'#1E3A55',
  text:'#E6F0F8', sub:'#6B9AB5', dim:'#2E4D65', muted:'#162030',
  accent:'#32C870', hot:'#F07040', warn:'#EBB030', err:'#E04848',
  openBg:'#0A2D1A', openTx:'#32C870', closeBg:'#2D0A0A', closeTx:'#E04848',
  limitBg:'#2D1D00', limitTx:'#EBB030',
};
const LIGHT = {
  bg:'#EBF1F8', surface:'#FFFFFF', lift:'#F4F8FC', border:'#D2E2EE',
  text:'#152434', sub:'#527A8E', dim:'#B0C8D8', muted:'#F0F5FA',
  accent:'#187A4C', hot:'#BD5420', warn:'#9E7010', err:'#B02020',
  openBg:'#CCFAE0', openTx:'#0A5C3A', closeBg:'#FDE0E0', closeTx:'#8A1A1A',
  limitBg:'#FEF0C4', limitTx:'#854000',
};
const F = "system-ui,-apple-system,'Segoe UI',sans-serif";

// ── Constants ───────────────────────────────────────────────────────────────
const TABS = ["Home","AI Guide","My Waters","Log","Gear","Regs","History"];
const SPECIES = ["Chinook (King)","Coho (Silver)","Pink (Humpy)","Chum (Dog)","Sockeye (Red)",
  "Kokanee","Steelhead","Sea-run Cutthroat","Trout (Resident)","Largemouth Bass","Smallmouth Bass","Other"];
const TECHNIQUES = ["Trolling","Mooching","Jigging","Drift Fishing","Casting – Spoon",
  "Casting – Plug","Casting – Jig","Fly Fishing","Bobber / Float","Bottom Fishing","Other"];
const NOAA_STA = [
  {id:'9447130',name:'Seattle',lat:47.602,lng:-122.339},
  {id:'9446484',name:'Tacoma',lat:47.269,lng:-122.416},
  {id:'9447214',name:'Bremerton',lat:47.563,lng:-122.627},
  {id:'9445958',name:'Port Townsend',lat:48.113,lng:-122.760},
  {id:'9444090',name:'Port Angeles',lat:48.125,lng:-123.445},
  {id:'9443090',name:'Neah Bay',lat:48.368,lng:-124.616},
  {id:'9448559',name:'Anacortes',lat:48.507,lng:-122.612},
  {id:'9449424',name:'Bellingham',lat:48.736,lng:-122.496},
];
// Curated WA fishing ports — instant match, no network dependency.
const WA_PORTS = [
  {name:'Seattle, WA',lat:47.6062,lng:-122.3321},
  {name:'Edmonds, WA',lat:47.8107,lng:-122.3774},
  {name:'Everett, WA',lat:47.9790,lng:-122.2021},
  {name:'Mukilteo, WA',lat:47.9446,lng:-122.3045},
  {name:'Tacoma, WA',lat:47.2529,lng:-122.4443},
  {name:'Olympia, WA',lat:47.0379,lng:-122.9007},
  {name:'Shelton, WA',lat:47.2154,lng:-123.1003},
  {name:'Bremerton, WA',lat:47.5673,lng:-122.6329},
  {name:'Port Orchard, WA',lat:47.5401,lng:-122.6359},
  {name:'Poulsbo, WA',lat:47.7359,lng:-122.6468},
  {name:'Gig Harbor, WA',lat:47.3309,lng:-122.5801},
  {name:'Port Townsend, WA',lat:48.1173,lng:-122.7604},
  {name:'Sequim, WA',lat:48.0818,lng:-123.1095},
  {name:'Port Angeles, WA',lat:48.1181,lng:-123.4307},
  {name:'Neah Bay, WA',lat:48.3681,lng:-124.6159},
  {name:'Forks, WA',lat:47.9504,lng:-124.3853},
  {name:'La Push, WA',lat:47.9128,lng:-124.6357},
  {name:'Anacortes, WA',lat:48.5126,lng:-122.6127},
  {name:'La Conner, WA',lat:48.3929,lng:-122.4965},
  {name:'Bellingham, WA',lat:48.7519,lng:-122.4787},
  {name:'Blaine, WA',lat:48.9966,lng:-122.7459},
  {name:'Friday Harbor, WA',lat:48.5345,lng:-123.0167},
  {name:'Coupeville, WA',lat:48.2202,lng:-122.6859},
  {name:'Oak Harbor, WA',lat:48.2932,lng:-122.6431},
  {name:'Westport, WA',lat:46.8762,lng:-124.1041},
  {name:'Ilwaco, WA',lat:46.3046,lng:-124.0335},
  {name:'Sekiu, WA',lat:48.2723,lng:-124.3434},
  {name:'Bellevue, WA',lat:47.6101,lng:-122.2015},
  {name:'Renton, WA',lat:47.4829,lng:-122.2171},
  {name:'Des Moines, WA',lat:47.4018,lng:-122.3315},
  {name:'Steilacoom, WA',lat:47.1717,lng:-122.6018},
];
function matchWaPort(input){
  const s = input.trim().toLowerCase().replace(/,?\s*(wa|washington)\.?$/,'').trim();
  if(!s) return null;
  const exact = WA_PORTS.find(p=>p.name.toLowerCase().startsWith(s));
  if(exact) return exact;
  return WA_PORTS.find(p=>p.name.toLowerCase().includes(s)) || null;
}
const WX = {
  0:['☀️','Clear'],1:['🌤','Mostly Clear'],2:['⛅','Partly Cloudy'],3:['☁️','Overcast'],
  45:['🌫','Fog'],48:['🌫','Icy Fog'],51:['🌦','Lt Drizzle'],53:['🌦','Drizzle'],
  55:['🌧','Drizzle'],61:['🌧','Lt Rain'],63:['🌧','Rain'],65:['⛈','Heavy Rain'],
  71:['🌨','Lt Snow'],73:['❄️','Snow'],80:['🌦','Showers'],81:['🌧','Showers'],95:['⛈','Storms'],
};

// ── Washington Marine Areas — verified against wdfw.wa.gov/fishing/locations/marine-areas
// and WDFW's own "major fishing areas" listings + salmon fishing preview blog. Spot-level
// aliases (bays/points/heads) are sourced from those pages, not guessed from general geography.
const MARINE_AREAS = [
  {num:'1',   title:'Marine Area 1 - Ilwaco',                                    slug:'ilwaco',          lat:46.305, lng:-124.034, aliases:['ilwaco']},
  {num:'2',   title:'Marine Area 2 - Westport-Ocean Shores',                     slug:'westport-ocean-shores', lat:46.876, lng:-124.114, aliases:['westport','ocean shores']},
  {num:'2-1', title:'Marine Area 2-1 - Willapa Bay',                             slug:'willapa-bay',     lat:46.650, lng:-123.850, aliases:['willapa bay','willapa']},
  {num:'2-2', title:'Marine Area 2-2 - Grays Harbor',                            slug:'grays-harbor',    lat:46.950, lng:-124.050, aliases:['grays harbor']},
  {num:'3',   title:'Marine Area 3 - La Push',                                   slug:'lapush',          lat:47.913, lng:-124.636, aliases:['la push','lapush']},
  {num:'4',   title:'Marine Area 4 - Neah Bay',                                  slug:'neah-bay',        lat:48.368, lng:-124.616, aliases:['neah bay']},
  {num:'5',   title:'Marine Area 5 - Sekiu and Pillar Point',                    slug:'sekiu-pillar-point', lat:48.272, lng:-124.343, aliases:['sekiu','pillar point']},
  {num:'6',   title:'Marine Area 6 - East Juan de Fuca Strait',                  slug:'east-juan-de-fuca-strait', lat:48.170, lng:-123.550, aliases:['east juan de fuca','freshwater bay']},
  {num:'7',   title:'Marine Area 7 - San Juan Islands',                         slug:'san-juan-islands', lat:48.638, lng:-122.857,
    aliases:['san juan islands','san juans','friday harbor','hein bank','bellingham bay','haro strait',
      'lopez island','orcas island','shaw island','stuart island','sucia island','waldron island',
      'blaine','drayton harbor','point roberts','lummi island','cypress island','anacortes']},
  {num:'8-1', title:'Marine Area 8-1 - Deception Pass, Hope Island, and Skagit Bay', slug:'deception-pass-hope-island-skagit-bay', lat:48.234, lng:-122.543,
    aliases:['deception pass','hope island','skagit bay','swinomish slough','swinomish channel',
      'coupeville','oak harbor','penn cove','la conner']},
  {num:'8-2', title:'Marine Area 8-2 - Ports Susan and Gardner',                 slug:'ports-susan-gardner', lat:48.068, lng:-122.331,
    aliases:['port susan','ports susan','gardner bay','hat island','camano head','tulalip','mukilteo',
      'everett','kayak point','clinton','langley']},
  {num:'9',   title:'Marine Area 9 - Admiralty Inlet',                           slug:'admiralty-inlet', lat:48.012, lng:-122.559,
    aliases:['admiralty inlet','port townsend','point no point','pilot point','possession bar',
      'skunk bay','craven rock','mid-channel bank','marrowstone point']},
  {num:'10',  title:'Marine Area 10 - Seattle-Bremerton Area',                   slug:'seattle-bremerton-area', lat:47.628, lng:-122.547,
    aliases:['seattle','bremerton','elliott bay','elliot bay','alki','shilshole','sinclair inlet',
      'brace point','jefferson head','jeff head','lincoln park','west point','southworth','blake island',
      'allen bank','murden cove','yeomalt point','point monroe','skiff point','richmond beach','kingston']},
  {num:'11',  title:'Marine Area 11 - Tacoma-Vashon Island',                     slug:'tacoma-vashon-island', lat:47.368, lng:-122.442,
    aliases:['tacoma','vashon island','vashon','point defiance','dalco passage','gig harbor','browns point',
      'dash point','des moines','maury island','quartermaster','point robinson','clay banks','owen beach',
      'colvos passage']},
  {num:'12',  title:'Marine Area 12 - Hood Canal',                               slug:'hood-canal',      lat:47.620, lng:-122.950,
    aliases:['hood canal','quilcene','dabob bay','belfair','dosewallips','duckabush','hoodsport',
      'pleasant harbor','twanoh','potlatch','ayock point']},
  {num:'13',  title:'Marine Area 13 - South Puget Sound',                        slug:'south-puget-sound', lat:47.240, lng:-122.831,
    aliases:['south puget sound','south sound','olympia','budd inlet','case inlet','carr inlet',
      'nisqually reach','steilacoom','shelton','fish trap','joemma beach','penrose point','kopachuck',
      'tolmie','anderson island','fox island','allyn','key peninsula','harstine island','squaxin']},
];
function marineAreaUrl(a){ return `https://wdfw.wa.gov/fishing/locations/marine-areas/${a.slug}`; }
// Approximate straight-line distance in miles — for "which marine area is closest" suggestions only.
// These are centroid estimates, not legal boundaries. Always confirm with WDFW.
function milesBetween(lat1,lng1,lat2,lng2){
  const R=3958.8, toRad=d=>d*Math.PI/180;
  const dLat=toRad(lat2-lat1), dLng=toRad(lng2-lng1);
  const a=Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function nearestMarineAreas(lat,lng,count=5){
  return MARINE_AREAS
    .filter(a=>a.lat!=null)
    .map(a=>({...a, dist: milesBetween(lat,lng,a.lat,a.lng)}))
    .sort((x,y)=>x.dist-y.dist)
    .slice(0,count);
}
function matchMarineArea(input){
  if(!input) return null;
  const raw = input.toLowerCase().trim();
  // "Marine Area 10", "MA 10", "MA-10", "Puget Sound Marine Area 10", "area 10", "#10"
  let m = raw.match(/(?:marine\s*area|puget\s*sound\s*marine\s*area|\bma\b|\barea\b|#)\s*[-_]?\s*(\d{1,2})(?:\s*[-_.\/]\s*(\d{1,2}))?/i);
  // "MA10", "MA8-1" glued with no boundary before the digit
  if(!m) m = raw.match(/\bma[-_]?(\d{1,2})(?:[-_.\/](\d{1,2}))?\b/i);
  if(m){
    const num = m[2] ? `${m[1]}-${m[2]}` : m[1];
    const found = MARINE_AREAS.find(a=>a.num===num) || MARINE_AREAS.find(a=>a.num===m[1]);
    if(found) return found;
  }
  // bare number, only if that's the whole input (avoid false positives elsewhere)
  if(/^\d{1,2}([-_.\/]\d{1,2})?$/.test(raw)){
    const parts = raw.split(/[-_.\/]/);
    const num = parts.length>1 ? parts.join('-') : parts[0];
    const found = MARINE_AREAS.find(a=>a.num===num) || MARINE_AREAS.find(a=>a.num===parts[0]);
    if(found) return found;
  }
  // name / alias substring match — "Hood Canal", "Seattle", "San Juan Islands", etc.
  for(const a of MARINE_AREAS){
    if(a.aliases.some(al=>raw.includes(al))) return a;
  }
  return null;
}

// ── Utilities ───────────────────────────────────────────────────────────────
function inferWaterType(str) {
  const s = str.toLowerCase();
  if (matchMarineArea(str)) return "Saltwater";
  if (["puget sound","sound","strait","canal","saratoga","commencement","quartermaster",
    "dyes","liberty bay","port orchard","possession","juan de fuca","rosario",
    "bellingham","padilla","fidalgo","tulalip","hammersley","totten","eld","budd","henderson"
  ].some(k=>s.includes(k))) return "Saltwater";
  if (["river","creek","stream","fork","r.","snoqualmie","skykomish","skagit","nooksack",
    "stillaguamish","puyallup","green river","cedar","carbon","cowlitz","chehalis","hoh",
    "sol duc","quinault","dosewallips","duckabush","skokomish","dungeness","elwha","methow",
    "wenatchee","columbia","yakima","klickitat"
  ].some(k=>s.includes(k))) return "River / Stream";
  if (["lake","lk","reservoir","pond","sammamish","washington","union","chelan","roosevelt",
    "banks","moses","potholes","kapowsin","tapps","serene","goodwin"
  ].some(k=>s.includes(k))) return "Lake";
  return "";
}
function nearestNOAA(lat,lng) {
  return NOAA_STA.reduce((b,s)=>{const d=Math.hypot(s.lat-lat,s.lng-lng);return d<b.d?{s,d}:b},{s:NOAA_STA[0],d:Infinity}).s;
}
function wxInfo(code) {
  const f=WX[code]||WX[Math.floor(code/10)*10]||['🌡','Unknown'];
  return {icon:f[0],label:f[1]};
}
function windDir(deg){return['N','NE','E','SE','S','SW','W','NW'][Math.round(deg/45)%8];}
function currentSeason(){const m=new Date().getMonth()+1;return m<=2||m===12?'Winter':m<=5?'Spring':m<=8?'Summer':'Fall';}
function monthName(){return new Date().toLocaleString('default',{month:'long'});}
function thisYear(){return new Date().getFullYear();}
function todayStr(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function getTargeted(o){
  if(Array.isArray(o.speciesTargeted)&&o.speciesTargeted.length) return o.speciesTargeted;
  if(o.species) return [o.species];
  return [];
}

// ── Storage (works in Claude artifacts + standalone) ────────────────────────
const stor = {
  async get(k){
    if(window.storage) try{return await window.storage.get(k);}catch{}
    try{const v=localStorage.getItem(k);return v?{value:v}:null;}catch{return null;}
  },
  async set(k,v){
    if(window.storage) try{await window.storage.set(k,v);return;}catch{}
    try{localStorage.setItem(k,v);}catch{}
  }
};
async function load(k){try{const r=await stor.get(k);return r?JSON.parse(r.value):null;}catch{return null;}}
async function save(k,v){try{await stor.set(k,JSON.stringify(v));}catch{}}

// ── API ─────────────────────────────────────────────────────────────────────
async function askClaude(messages, system, {maxTokens=1000,webSearch=false}={}) {
  const body={model:'claude-sonnet-4-20250514',max_tokens:maxTokens,system,messages};
  if(webSearch) body.tools=[{type:'web_search_20250305',name:'web_search'}];
  const res=await fetch('https://api.anthropic.com/v1/messages',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
  });
  const d=await res.json();
  if(d.error) throw new Error(d.error.message);
  return (d.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n')||'';
}
async function geocode(city){
  const r=await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`);
  if(!r.ok) throw new Error('geocoding service unavailable');
  const d=await r.json();const x=d.results?.[0];
  return x?{name:x.name+(x.admin1?', '+x.admin1:''),lat:x.latitude,lng:x.longitude}:null;
}
// Reverse geocode coordinates to a human-readable place label — used to anchor
// freshwater "Fish Here Now" lookups since there's no fixed list of WA lakes/rivers.
async function reverseGeocode(lat,lng){
  try{
    const r=await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=13&addressdetails=1`);
    if(!r.ok) return null;
    const d=await r.json();
    const a=d.address||{};
    const parts=[a.water,a.natural,a.hamlet,a.village,a.town,a.city,a.county].filter(Boolean);
    return parts.length>0 ? parts.join(', ') : (d.display_name||null);
  }catch{return null;}
}
async function fetchWeather(lat,lng){
  try{
    const r=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,wind_speed_10m,wind_direction_10m,weather_code&wind_speed_unit=mph&temperature_unit=fahrenheit&timezone=America%2FLos_Angeles`);
    const d=await r.json();return d.current||null;
  }catch{return null;}
}
async function fetchTides(lat,lng){
  try{
    const sta=nearestNOAA(lat,lng);
    const t=new Date(),t2=new Date(t.getTime()+86400000);
    const fmt=d=>`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    const r=await fetch(`https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?station=${sta.id}&product=predictions&datum=MLLW&time_zone=lst/ldt&interval=hilo&units=english&application=cascadia&format=json&begin_date=${fmt(t)}&end_date=${fmt(t2)}`);
    const d=await r.json();return{station:sta.name,predictions:d.predictions||[]};
  }catch{return null;}
}
async function fetchDailyIntel(season,month,year,fw,hp){
  const favList=fw.map(w=>w.name).join(', ')||'Puget Sound area';
  const area=hp?hp.name:'Western Washington';
  return askClaude(
    [{role:'user',content:`Search wdfw.wa.gov/fishing/reports/creel and wdfw.wa.gov/fishing/rules for ${area} fishing intel in ${month} ${year}. Find: 1) Salmonid creel report data with specific fish-per-rod-hour numbers. 2) Emergency closures or rule changes in last 2 weeks. 3) What species are actively running or biting. Respond with three sections — DAILY TIP: (2-3 sentence tip), CREEL: (numbers if found), ALERTS: (closures or "None found"). Prioritize: ${favList}. Keep concise. Always verify: wdfw.wa.gov.`}],
    `Western WA fishing guide. Season: ${season}. Search WDFW for current creel and regulation data.`,
    {maxTokens:600,webSearch:true}
  );
}

// ── Style helpers ───────────────────────────────────────────────────────────
const cardOf=(T,extra={})=>({background:T.surface,borderRadius:14,padding:16,border:`1px solid ${T.border}`,...extra});
const inpOf=T=>({padding:'10px 12px',background:T.bg,border:`1px solid ${T.border}`,borderRadius:9,color:T.text,fontFamily:F,fontSize:14,boxSizing:'border-box',outline:'none',width:'100%'});
const btnOf=(T,v='primary')=>{
  const b={padding:'10px 20px',border:'none',borderRadius:9,cursor:'pointer',fontFamily:F,fontSize:14,fontWeight:'500',transition:'opacity .12s'};
  if(v==='green') return{...b,background:T.accent,color:'#fff'};
  if(v==='ghost') return{...b,background:'transparent',color:T.sub,border:`1px solid ${T.border}`};
  return{...b,background:T.hot,color:'#fff'};
};

// ── Shared UI ───────────────────────────────────────────────────────────────
function Field({label,children,span2,T}){
  return(
    <div style={{gridColumn:span2?'1/-1':undefined,marginBottom:4}}>
      <div style={{fontSize:10,color:T.sub,marginBottom:5,letterSpacing:1.2,textTransform:'uppercase',fontFamily:F}}>{label}</div>
      {children}
    </div>
  );
}
function SectionHead({children,T}){
  return(
    <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14}}>
      <span style={{fontSize:11,letterSpacing:1.8,textTransform:'uppercase',color:T.hot,fontFamily:F,fontWeight:'600'}}>{children}</span>
      <div style={{flex:1,height:1,background:T.border}}/>
    </div>
  );
}
function Chip({label,active,color,T,onClick}){
  const c=color||T.hot;
  return(
    <button onClick={onClick} style={{padding:'5px 12px',borderRadius:20,border:`1.5px solid ${active?c:T.border}`,background:active?c:'transparent',color:active?'#fff':T.sub,cursor:'pointer',fontSize:12,fontFamily:F,transition:'all .12s',lineHeight:1.4}}>
      {label}
    </button>
  );
}
function StatusPill({status,T}){
  const m={open:{bg:T.openBg,tx:T.openTx,l:'Open'},closed:{bg:T.closeBg,tx:T.closeTx,l:'Closed'},limited:{bg:T.limitBg,tx:T.limitTx,l:'Limited'},unknown:{bg:T.lift,tx:T.sub,l:'Check'}};
  const s=m[status]||m.unknown;
  return <span style={{fontSize:10,background:s.bg,color:s.tx,borderRadius:5,padding:'2px 8px',fontFamily:F,fontWeight:'600',letterSpacing:.3,whiteSpace:'nowrap'}}>{s.l}</span>;
}
function ToolCard({title,desc,icon,active,onToggle,children,T}){
  return(
    <div style={{border:`1px solid ${active?T.hot:T.border}`,borderRadius:10,overflow:'hidden',transition:'border-color .15s'}}>
      <div onClick={onToggle} style={{display:'flex',alignItems:'center',gap:10,padding:'12px 14px',cursor:'pointer',background:active?T.muted:'transparent',userSelect:'none'}}>
        <span style={{fontSize:20,flexShrink:0}}>{icon}</span>
        <div style={{flex:1}}>
          <div style={{fontSize:14,fontWeight:'500',color:T.text,fontFamily:F}}>{title}</div>
          <div style={{fontSize:12,color:T.sub,fontFamily:F}}>{desc}</div>
        </div>
        <span style={{color:T.sub,fontSize:11,fontFamily:F}}>{active?'▲':'▼'}</span>
      </div>
      {active&&<div style={{padding:'12px 14px',borderTop:`1px solid ${T.border}`,background:T.surface}}>{children}</div>}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
export default function App(){
  const [dark,setDark]         = useState(true);
  const [tab,setTab]           = useState(0);
  const [outings,setOutings]   = useState([]);
  const [gear,setGear]         = useState([]);
  const [chat,setChat]         = useState([]);
  const [favWaters,setFW]      = useState([]);
  const [homePort,setHP]       = useState(null);
  const [dailyData,setDD]      = useState(null);
  const [refreshing,setRef]    = useState(false);
  const [waterDetail,setWD]    = useState(null);
  const [aiPreFill,setAPF]     = useState('');
  const [loaded,setLoaded]     = useState(false);
  const [printJob,setPrintJob] = useState(null);
  const T = dark ? DARK : LIGHT;

  useEffect(()=>{
    (async()=>{
      const o=await load('outings'); if(o) setOutings(o);
      const g=await load('gear');    if(g) setGear(g);
      const c=await load('chat');    if(c) setChat(c);
      const f=await load('fw');      if(f) setFW(f);
      const h=await load('hp');      if(h) setHP(h);
      const d=await load('dd');      if(d) setDD(d);
      const dm=await load('dark');   if(dm!==null) setDark(dm);
      setLoaded(true);
    })();
  },[]);

  const doRefresh = async (hp,fw) => {
    setRef(true);
    const fresh = {date:todayStr()};
    if(hp){
      try{
        const [wx,td] = await Promise.all([fetchWeather(hp.lat,hp.lng),fetchTides(hp.lat,hp.lng)]);
        if(wx) fresh.weather=wx;
        if(td) fresh.tides=td;
      }catch{}
    }
    try{ fresh.intel = await fetchDailyIntel(currentSeason(),monthName(),thisYear(),fw,hp); }catch{}
    setDD(prev=>{const n={...(prev||{}),...fresh};save('dd',n);return n;});
    setRef(false);
  };

  useEffect(()=>{
    if(!loaded) return;
    if(dailyData && dailyData.date===todayStr()) return;
    doRefresh(homePort,favWaters);
  },[loaded]); // eslint-disable-line

  const saveOutings = v=>{setOutings(v);save('outings',v);};
  const saveGear    = v=>{setGear(v);save('gear',v);};
  const saveChat    = v=>{setChat(v);save('chat',v);};
  const saveFW      = v=>{setFW(v);save('fw',v);};
  const toggleDark  = ()=>{const n=!dark;setDark(n);save('dark',n);};

  const handleSetHP = async portData=>{
    setHP(portData); save('hp',portData);
    doRefresh(portData,favWaters);
  };

  if(!loaded) return(
    <div style={{background:DARK.bg,height:'100vh',display:'flex',alignItems:'center',justifyContent:'center',color:DARK.sub,fontFamily:F,fontSize:15}}>Loading Cascadia…</div>
  );

  if(waterDetail) return(
    <div style={{fontFamily:F,background:T.bg,minHeight:'100vh',color:T.text}}>
      <WaterDetailPage water={waterDetail} onBack={()=>setWD(null)} T={T}/>
    </div>
  );

  return(
    <div style={{fontFamily:F,background:T.bg,minHeight:'100vh',color:T.text}}>
      <style>{`@media print { .cascadia-shell { display: none !important; } }`}</style>
      <div className="cascadia-shell">
      {/* Header */}
      <div style={{background:T.surface,borderBottom:`1px solid ${T.border}`,position:'sticky',top:0,zIndex:10}}>
        <div style={{maxWidth:820,margin:'0 auto',padding:'12px 16px 0'}}>
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12}}>
            <div style={{width:34,height:34,borderRadius:10,background:`linear-gradient(135deg,${T.accent},${T.hot})`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:15,flexShrink:0}}>≋</div>
            <div style={{flex:1}}>
              <div style={{fontSize:17,fontWeight:'700',color:T.text,letterSpacing:-.2,fontFamily:F}}>Cascadia Fishing</div>
              <div style={{fontSize:10,color:T.sub,letterSpacing:1,fontFamily:F,textTransform:'uppercase'}}>{monthName()} {thisYear()} · {currentSeason()}{homePort?` · ${homePort.name}`:''}</div>
            </div>
            <button onClick={toggleDark} style={{...btnOf(T,'ghost'),padding:'5px 11px',fontSize:12}}>{dark?'☀️ Light':'🌑 Dark'}</button>
          </div>
          <div style={{display:'flex',overflowX:'auto',gap:2,scrollbarWidth:'none'}}>
            {TABS.map((t,i)=>(
              <button key={t} onClick={()=>setTab(i)} style={{padding:'7px 13px',borderRadius:'8px 8px 0 0',border:'none',cursor:'pointer',fontSize:12,fontWeight:tab===i?'600':'400',fontFamily:F,whiteSpace:'nowrap',flexShrink:0,background:'transparent',color:tab===i?T.text:T.sub,borderBottom:tab===i?`2px solid ${T.hot}`:'2px solid transparent',transition:'all .12s'}}>{t}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{maxWidth:820,margin:'0 auto',padding:'20px 16px 80px'}}>
        {tab===0&&<HomeTab outings={outings} favWaters={favWaters} homePort={homePort} dailyData={dailyData} refreshing={refreshing} onSetHP={handleSetHP} onWaterClick={setWD} onMiniSend={msg=>{setAPF(msg);setTab(1);}} onTabChange={setTab} T={T}/>}
        {tab===1&&<AIGuideTab outings={outings} gear={gear} favWaters={favWaters} chat={chat} onSaveChat={saveChat} preFill={aiPreFill} onClearPreFill={()=>setAPF('')} onPrint={(title,body)=>setPrintJob({title,body})} T={T}/>}
        {tab===2&&<MyWatersTab favWaters={favWaters} onSave={saveFW} onWaterClick={setWD} T={T}/>}
        {tab===3&&<LogOuting outings={outings} gear={gear} onSave={saveOutings} T={T}/>}
        {tab===4&&<GearManager gear={gear} onSave={saveGear} T={T}/>}
        {tab===5&&<RegsAlerts T={T}/>}
        {tab===6&&<History outings={outings} onSave={saveOutings} T={T}/>}
      </div>
      </div>
      <PrintOverlay data={printJob} onDone={()=>setPrintJob(null)}/>
    </div>
  );
}

// ── Print Overlay (drives browser "Save as PDF" via native print) ───────────
function PrintOverlay({data,onDone}){
  useEffect(()=>{
    if(!data) return;
    const handle = ()=>onDone();
    window.addEventListener('afterprint', handle);
    const t = setTimeout(()=>{ try{ window.print(); }catch{ onDone(); } }, 100);
    return ()=>{ window.removeEventListener('afterprint', handle); clearTimeout(t); };
  },[data]);

  if(!data) return null;
  return (
    <div className="print-only" style={{position:'fixed',top:0,left:0,right:0,minHeight:'100vh',background:'#fff',color:'#16212c',padding:'48px 56px',zIndex:9999,fontFamily:'Georgia,serif'}}>
      <div style={{fontSize:11,letterSpacing:2,textTransform:'uppercase',color:'#C2682B',marginBottom:6}}>Cascadia Fishing Assistant</div>
      <h1 style={{fontSize:22,margin:'0 0 4px',borderBottom:'2px solid #C2682B',paddingBottom:10}}>{data.title}</h1>
      <div style={{fontSize:12,color:'#667',marginBottom:24}}>{new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})}</div>
      <div style={{whiteSpace:'pre-wrap',fontSize:14,lineHeight:1.75}}>{data.body}</div>
      <div style={{marginTop:36,fontSize:11,color:'#889',borderTop:'1px solid #ddd',paddingTop:12}}>
        Generated by Cascadia Fishing Assistant. Always verify current regulations at wdfw.wa.gov/fishing/rules or 1-800-902-2474.
      </div>
    </div>
  );
}

// ── Home Tab ────────────────────────────────────────────────────────────────
function HomeTab({outings,favWaters,homePort,dailyData,refreshing,onSetHP,onWaterClick,onMiniSend,onTabChange,T}){
  const [portInput,setPI] = useState('');
  const [geocoding,setGeo] = useState(false);
  const [portError,setPErr] = useState('');
  const [miniMsg,setMM] = useState('');
  const season = currentSeason();
  const yr = thisYear();
  const isPinkYear = yr%2!==0;

  const handleSetPort = async()=>{
    if(!portInput.trim()) return;
    setPErr('');
    setGeo(true);
    // 1. Try curated local list first — instant, no network needed.
    const local = matchWaPort(portInput);
    if(local){
      onSetHP(local);
      setGeo(false); setPI('');
      return;
    }
    // 2. Fall back to live geocoding for anything not in the table.
    try{
      const r = await geocode(portInput.trim());
      if(r){ onSetHP(r); setPI(''); }
      else{ setPErr(`Couldn't find "${portInput}". Try a nearby town, e.g. "Everett" or "Port Townsend".`); }
    }catch{
      setPErr('Network error looking up that location. Check your connection and try again.');
    }
    setGeo(false);
  };

  const wx = dailyData?.weather;
  const todayTides = (dailyData?.tides?.predictions||[]).filter(p=>{
    const d=new Date(p.t),now=new Date();
    return d.getDate()===now.getDate()&&d.getMonth()===now.getMonth();
  }).slice(0,4);

  const tipMap={
    Spring:[
      {tag:'Chinook',text:'Spring kings entering lower rivers — check MA 10/11 for spring retention windows.'},
      {tag:'Cutthroat',text:'Sea-run cutthroat showing in tidal estuaries as baitfish move shallow.'},
      {tag:'Trout',text:'Lowland lake opener late April — rainbows stacked near surface as temps rise.'},
    ],
    Summer:[
      {tag:'Sockeye',text:'Fraser sockeye peak Jul–Aug pushing through the Strait into the northern Sound.'},
      {tag:'Coho',text:'Feeder silvers through summer. Resident Coho show MA 7/8 by late August.'},
      ...(isPinkYear?[{tag:'Pink',text:`${yr} is a pink year — pinks flood the Sound Jul–Sep. Small spoons near river mouths.`}]:[]),
      {tag:'Trout',text:'Alpine lakes open late June. Kokanee peak in Chelan, Roosevelt, and Banks.'},
    ],
    Fall:[
      {tag:'Coho',text:'Prime Coho season Sep–Nov — river mouths, marine bays, shallow flats.'},
      {tag:'Chum',text:'Chum run Oct–Nov. Wide-open bites — egg patterns and pink jigs.'},
      {tag:'Cutthroat',text:'Sea-run cutthroat aggressive in rivers as Coho carcasses prime the system.'},
    ],
    Winter:[
      {tag:'Blackmouth',text:'Resident Chinook MA 9/10 — confirm winter retention rules before fishing.'},
      {tag:'Steelhead',text:'Winter steelhead on Skykomish, Skagit, Hoh, Sol Duc. Wild fish C&R on most rivers.'},
      {tag:'Cutthroat',text:'Winter sea-run cutthroat in tidal estuaries: underrated and productive.'},
    ],
  };
  const tagCol={Chinook:T.hot,Coho:'#7B9E3E',Pink:'#B06090',Chum:'#7A6830',Sockeye:'#A03030',Cutthroat:T.accent,Trout:T.accent,Steelhead:'#5B8DB8',Blackmouth:T.hot};
  const tips=(tipMap[season]||[]).slice(0,3);

  const totalCatch = outings.reduce((s,o)=>s+(Number(o.catchCount)||0),0);
  const topSpot=(()=>{const c={};outings.forEach(o=>{if(o.location)c[o.location]=(c[o.location]||0)+(Number(o.catchCount)||0);});return Object.entries(c).sort((a,b)=>b[1]-a[1])[0]?.[0]||'—';})();
  const recentOutings=[...outings].reverse().slice(0,3);

  return(
    <div style={{display:'flex',flexDirection:'column',gap:16}}>
      {/* Stats */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10}}>
        {[{l:'Outings',v:outings.length,big:true},{l:'Fish Caught',v:totalCatch,big:true},{l:'Top Spot',v:topSpot}].map(s=>(
          <div key={s.l} style={{...cardOf(T),textAlign:'center',padding:'12px 8px'}}>
            <div style={{fontSize:s.big?26:13,fontWeight:'700',color:T.hot,wordBreak:'break-word',lineHeight:1.2,fontFamily:F}}>{s.v}</div>
            <div style={{fontSize:10,color:T.sub,marginTop:4,letterSpacing:.8,textTransform:'uppercase',fontFamily:F}}>{s.l}</div>
          </div>
        ))}
      </div>

      {/* Daily Intel */}
      {(dailyData?.intel||refreshing)&&(
        <div style={{...cardOf(T),borderLeft:`3px solid ${T.hot}`}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
            <span style={{fontSize:11,letterSpacing:1.5,textTransform:'uppercase',color:T.hot,fontWeight:'600',fontFamily:F}}>Today's Intel</span>
            {refreshing&&<span style={{fontSize:11,color:T.sub,fontFamily:F,fontStyle:'italic'}}>Updating…</span>}
          </div>
          {dailyData?.intel&&<div style={{fontSize:13,color:T.text,lineHeight:1.75,fontFamily:F,whiteSpace:'pre-wrap'}}>{dailyData.intel}</div>}
          {!dailyData?.intel&&refreshing&&<div style={{fontSize:13,color:T.sub,fontFamily:F,fontStyle:'italic'}}>Fetching WDFW creel data and conditions…</div>}
        </div>
      )}

      {/* Home port setup */}
      {!homePort&&(
        <div style={cardOf(T)}>
          <SectionHead T={T}>Set Your Home Port</SectionHead>
          <div style={{fontSize:13,color:T.sub,marginBottom:12,fontFamily:F}}>Enter your home port for live weather, tides, and local intel.</div>
          <div style={{fontSize:11,color:T.dim,marginBottom:10,fontFamily:F}}>Your data saves privately to your own Claude account — sign in for it to stick between visits.</div>
          <div style={{display:'flex',gap:8}}>
            <input value={portInput} onChange={e=>setPI(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleSetPort()} placeholder="e.g. Everett, Port Townsend, Anacortes" style={{...inpOf(T),flex:1}}/>
            <button onClick={handleSetPort} disabled={geocoding||!portInput.trim()} style={{...btnOf(T),opacity:geocoding?0.6:1,whiteSpace:'nowrap'}}>{geocoding?'Finding…':'Set Port'}</button>
          </div>
          {portError&&<div style={{fontSize:12,color:T.err,marginTop:9,fontFamily:F}}>{portError}</div>}
        </div>
      )}
      {homePort&&(
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10}}>
          <span style={{fontSize:11,color:T.sub,fontFamily:F}}>Home port: <strong style={{color:T.text}}>{homePort.name}</strong></span>
          <button onClick={()=>{setPI('');setPErr('');onSetHP(null);}} style={{...btnOf(T,'ghost'),padding:'4px 10px',fontSize:11}}>Change</button>
        </div>
      )}

      {/* Weather + Tides */}
      {(wx||todayTides.length>0)&&(
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
          {wx&&(
            <div style={cardOf(T)}>
              <div style={{fontSize:10,color:T.sub,letterSpacing:1,textTransform:'uppercase',marginBottom:8,fontFamily:F}}>Weather · {homePort?.name}</div>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <span style={{fontSize:28}}>{wxInfo(wx.weather_code).icon}</span>
                <div>
                  <div style={{fontSize:22,fontWeight:'700',color:T.text,fontFamily:F}}>{Math.round(wx.temperature_2m)}°F</div>
                  <div style={{fontSize:12,color:T.sub,fontFamily:F}}>{wxInfo(wx.weather_code).label}</div>
                  <div style={{fontSize:11,color:T.sub,fontFamily:F}}>{windDir(wx.wind_direction_10m)} {Math.round(wx.wind_speed_10m)} mph</div>
                </div>
              </div>
            </div>
          )}
          {todayTides.length>0&&(
            <div style={cardOf(T)}>
              <div style={{fontSize:10,color:T.sub,letterSpacing:1,textTransform:'uppercase',marginBottom:8,fontFamily:F}}>Tides · {dailyData?.tides?.station}</div>
              {todayTides.map((p,i)=>(
                <div key={i} style={{display:'flex',justifyContent:'space-between',fontSize:13,fontFamily:F,padding:'3px 0',borderBottom:i<todayTides.length-1?`1px solid ${T.border}`:'none'}}>
                  <span style={{color:p.type==='H'?T.accent:T.sub,fontWeight:'600'}}>{p.type==='H'?'High':'Low'}</span>
                  <span style={{color:T.text}}>{p.t.split(' ')[1]}</span>
                  <span style={{color:T.sub}}>{parseFloat(p.v).toFixed(1)} ft</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* My Waters compact */}
      {favWaters.length>0&&(
        <div style={cardOf(T)}>
          <SectionHead T={T}>My Waters</SectionHead>
          {favWaters.map((w,i)=>(
            <div key={w.id} onClick={()=>onWaterClick(w)} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'9px 0',borderBottom:i<favWaters.length-1?`1px solid ${T.border}`:'none',cursor:'pointer',gap:10}}>
              <div>
                <div style={{fontSize:13,color:T.text,fontFamily:F}}>{w.name}</div>
                <div style={{fontSize:11,color:T.sub,fontFamily:F}}>{w.type}</div>
              </div>
              <div style={{display:'flex',gap:5,flexWrap:'wrap',justifyContent:'flex-end',flexShrink:0}}>
                {(w.quickStatus||[]).length>0
                  ?w.quickStatus.map((s,j)=>(
                    <div key={j} style={{display:'flex',alignItems:'center',gap:4}}>
                      <span style={{fontSize:10,color:T.sub,fontFamily:F}}>{s.species}</span>
                      <StatusPill status={s.status} T={T}/>
                    </div>
                  ))
                  :<span style={{fontSize:11,color:T.sub,fontFamily:F,fontStyle:'italic'}}>Tap for rules →</span>
                }
              </div>
            </div>
          ))}
          <div style={{fontSize:10,color:T.dim,marginTop:10,fontFamily:F,fontStyle:'italic'}}>AI-estimated. Tap any water for full regulations. Verify: wdfw.wa.gov</div>
        </div>
      )}
      {favWaters.length===0&&(
        <div onClick={()=>onTabChange(2)} style={{...cardOf(T),border:`1px dashed ${T.border}`,display:'flex',alignItems:'center',gap:12,cursor:'pointer'}}>
          <span style={{fontSize:22,opacity:.4}}>♡</span>
          <div>
            <div style={{fontSize:14,color:T.text,fontFamily:F}}>Add your favorite waters</div>
            <div style={{fontSize:12,color:T.sub,marginTop:2,fontFamily:F}}>Get regulation status and alerts right here.</div>
          </div>
        </div>
      )}

      {/* Season Intel */}
      <div style={cardOf(T)}>
        <SectionHead T={T}>{season} Intel</SectionHead>
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          {tips.map((t,i)=>(
            <div key={i} style={{display:'flex',gap:10,alignItems:'flex-start'}}>
              <span style={{fontSize:10,background:tagCol[t.tag]||T.sub,color:'#fff',borderRadius:4,padding:'2px 7px',whiteSpace:'nowrap',marginTop:2,flexShrink:0,fontFamily:F}}>{t.tag}</span>
              <span style={{fontSize:13,color:T.text,lineHeight:1.55,fontFamily:F}}>{t.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Recent outings */}
      {recentOutings.length>0&&(
        <div style={cardOf(T)}>
          <SectionHead T={T}>Recent Outings</SectionHead>
          {recentOutings.map((o,i)=>{
            const targeted=getTargeted(o);
            return(
              <div key={o.id||i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'9px 0',borderBottom:i<recentOutings.length-1?`1px solid ${T.border}`:'none'}}>
                <div>
                  <div style={{fontSize:13,color:T.text,fontFamily:F}}>{o.location||'Unknown'}</div>
                  <div style={{fontSize:11,color:T.sub,marginTop:2,fontFamily:F}}>
                    {targeted.length>0&&<span style={{color:T.hot}}>{targeted.join(', ')}</span>}
                    {(o.speciesCaught||[]).length>0&&targeted.join(',')!==(o.speciesCaught||[]).join(',')&&<span style={{color:T.accent}}> → {o.speciesCaught.join(', ')}</span>}
                    {Number(o.catchCount)>0&&<span> · {o.catchCount} fish</span>}
                  </div>
                </div>
                <div style={{fontSize:11,color:T.sub,flexShrink:0,marginLeft:10,fontFamily:F}}>{o.date}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Mini chat */}
      <div style={cardOf(T)}>
        <div style={{fontSize:12,color:T.sub,marginBottom:10,fontFamily:F}}>Ask your guide anything…</div>
        <div style={{display:'flex',gap:8}}>
          <input value={miniMsg} onChange={e=>setMM(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&miniMsg.trim()){onMiniSend(miniMsg);setMM('');}}} placeholder="What should I fish today?" style={{...inpOf(T),flex:1}}/>
          <button onClick={()=>{if(miniMsg.trim()){onMiniSend(miniMsg);setMM('');}}} disabled={!miniMsg.trim()} style={{...btnOf(T),opacity:miniMsg.trim()?1:0.5}}>Ask</button>
        </div>
      </div>
    </div>
  );
}

// ── AI Guide Tab ────────────────────────────────────────────────────────────
function AIGuideTab({outings,gear,favWaters,chat,onSaveChat,preFill,onClearPreFill,onPrint,T}){
  const [input,setInput]     = useState('');
  const [loading,setLoading] = useState(false);
  const [activeTool,setTool] = useState(null);
  const [fhnState,setFhnState] = useState('idle'); // idle | locating | checking | picking
  const [fhnError,setFhnError] = useState('');
  const [nearbyAreas,setNearbyAreas] = useState([]);
  const bottomRef            = useRef(null);

  useEffect(()=>{bottomRef.current?.scrollIntoView({behavior:'smooth'});},[chat,loading]);

  useEffect(()=>{
    if(preFill){setInput(preFill);onClearPreFill();}
  },[preFill]); // eslint-disable-line

  const buildSystem = ()=>
    `You are an expert fishing guide for western Washington, Puget Sound, and the Salish Sea. The user is 35 with 15+ years of serious experience. Primary: salmon (saltwater), trout/cutthroat/kokanee/steelhead (freshwater). Bass distant third. Skip basics unless asked.
Season: ${currentSeason()}. Month: ${monthName()} ${thisYear()}.
Favorite waters: ${favWaters.map(w=>w.name).join(', ')||'none listed'}.
Outings (${outings.length} logged): ${JSON.stringify(outings.slice(0,12))}
Gear: ${JSON.stringify(gear.slice(0,8))}
Be concise, specific, actionable. Use WDFW marine area numbers. Name specific spots. Flag mark-selective/hatchery/size rules. Use web search for current WDFW regulations, creel data, and conditions. Verify: wdfw.wa.gov.`;

  const send = async(msg,toolLabel)=>{
    const text=(msg||input).trim();
    if(!text||loading) return;
    const userMsg={role:'user',content:text,toolLabel};
    const newH=[...chat,userMsg];
    onSaveChat(newH);
    setInput('');setTool(null);setLoading(true);
    try{
      const reply=await askClaude(newH,buildSystem(),{maxTokens:1000,webSearch:true});
      onSaveChat([...newH,{role:'assistant',content:reply,toolLabel}]);
    }catch{
      onSaveChat([...newH,{role:'assistant',content:'Connection error — check your network and try again.',toolLabel}]);
    }
    setLoading(false);
  };

  // ── FISH HERE NOW ──────────────────────────────────────────────────────────
  const FISH_HERE_RADIUS_MI = 10;

  const runFishHereSuggestion = (locationName)=>{
    setFhnState('idle'); setNearbyAreas([]); setFhnError('');
    send(`I'm fishing right now at ${locationName}. Search WDFW for what's currently open here. Give me a tight, actionable on-the-water answer: what species I can target right now, the best technique for this spot today, and any immediate regulation notes (mark-selective, size/bag limits, active closures). I'm an experienced angler, standing at the water — keep it short and practical.`);
  };

  const handleFishHereNow = ()=>{
    setFhnError(''); setNearbyAreas([]);
    if(!navigator.geolocation){
      setFhnError("Location isn't available in this browser.");
      setFhnState('picking');
      return;
    }
    setFhnState('locating');
    navigator.geolocation.getCurrentPosition(
      async (pos)=>{
        const {latitude,longitude}=pos.coords;
        const ranked = nearestMarineAreas(latitude,longitude,5);
        const nearest = ranked[0];
        if(nearest && nearest.dist<=FISH_HERE_RADIUS_MI){
          runFishHereSuggestion(nearest.title);
          return;
        }
        // Not close to a recognized marine area — check freshwater.
        // No fixed list of WA lakes/rivers exists in-app (there are hundreds,
        // often with duplicate names), so identify it via reverse geocoding
        // + AI web search instead, and stay honest if it can't be confident.
        setFhnState('checking');
        try{
          const place = await reverseGeocode(latitude,longitude);
          const locContext = place || `coordinates ${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;
          const probe = await askClaude(
            [{role:'user',content:`I'm at this location in Washington State: ${locContext} (lat ${latitude.toFixed(4)}, lng ${longitude.toFixed(4)}). Search to determine if I'm at or very near (walking distance or a short drive) a named freshwater fishing lake or river in WA. If you can identify one with reasonable confidence, respond with ONLY its name, nothing else (e.g. "Lake Sammamish" or "Skykomish River"). If you cannot confidently identify a specific named fishing water this close to these coordinates, respond with exactly: NONE`}],
            'Washington State fishing guide. Be honest about uncertainty — only name a specific water if reasonably confident from the location given. No preamble, no explanation, just the name or NONE.',
            {maxTokens:60, webSearch:true}
          );
          const guess = probe.trim();
          if(!guess || guess.toUpperCase().includes('NONE')){
            setNearbyAreas(ranked);
            setFhnState('picking');
          }else{
            runFishHereSuggestion(guess);
          }
        }catch{
          setFhnError("Couldn't check this location — pick a water below instead.");
          setNearbyAreas(ranked);
          setFhnState('picking');
        }
      },
      ()=>{
        setFhnError('Location access denied or unavailable.');
        setFhnState('picking');
      },
      {timeout:10000, maximumAge:60000}
    );
  };

  const PROMPT_CATS=[
    {cat:'Right Now',prompts:[
      'What should I target right now given the season and conditions?',
      "What's actively biting in Puget Sound this week?",
      'Any WDFW emergency closures or alerts I should know about?',
    ]},
    {cat:'Salmon',prompts:[
      'Best Coho trolling setup for Puget Sound — depth, speed, flasher, and lure?',
      'Best mooching setup, depth, and bait for Chinook right now?',
      'Explain the incoming tide advantage for salmon trolling in Puget Sound.',
      'Best Coho lure colors by light condition and water clarity?',
    ]},
    {cat:'Trout & Other',prompts:[
      'Sea-run cutthroat timing and tactics for tidal rivers this time of year?',
      'Best kokanee setup — depth, speed, and gear for Lake Chelan?',
      'Which steelhead rivers are fishing well this time of year and why?',
      'Best resident trout lake within an hour of Seattle right now?',
    ]},
    {cat:'My Log',prompts:[
      'Analyze patterns in my last 10 outings — success by tide stage, conditions, and gear.',
      'Which of my gear has the best catch rate based on my outing log?',
      'Compare my Coho results this fall vs last fall.',
      'Based on my outing history, what are my most productive tide stages for salmon?',
    ]},
    {cat:'Regulations',prompts:[
      favWaters.length>0?`Any recent emergency closures or alerts on ${favWaters[0].name}?`:'Any recent Puget Sound emergency closures?',
      'Blackmouth (resident Chinook) retention rules for MA 9 and MA 10 right now?',
      'What hatchery vs wild ratio should I expect on the Skykomish this month?',
      'Walk me through mark-selective rules for Puget Sound salmon fishing.',
    ]},
    {cat:'Fish ID',prompts:[
      'Visual ID: how to tell Coho from Chinook in the water — key differences.',
      'How to identify a hatchery Coho vs a wild one at the boat.',
      'Sea-run cutthroat vs resident cutthroat — key visual differences.',
      'How to identify sea-run cutthroat vs small steelhead.',
    ]},
  ];

  return(
    <div style={{display:'flex',flexDirection:'column',gap:14}}>

      {/* Fish Here Now */}
      <div style={{...cardOf(T),background:`linear-gradient(135deg,${T.hot}22,${T.accent}11)`,border:`1px solid ${T.hot}55`}}>
        <button onClick={handleFishHereNow} disabled={fhnState==='locating'||fhnState==='checking'} style={{
          width:'100%',padding:'14px',background:T.hot,color:'#fff',border:'none',borderRadius:10,
          cursor:(fhnState==='locating'||fhnState==='checking')?'wait':'pointer',fontFamily:F,fontSize:16,fontWeight:'700',
          letterSpacing:.5,opacity:(fhnState==='locating'||fhnState==='checking')?0.7:1,
        }}>
          {fhnState==='locating' ? 'Finding your location…' : fhnState==='checking' ? 'Checking nearby waters…' : '📍 FISH HERE NOW'}
        </button>
        <div style={{fontSize:11,color:T.sub,marginTop:8,textAlign:'center',fontFamily:F}}>
          Uses your location to check what's open right now — marine areas or freshwater lakes and rivers.
        </div>

        {fhnState==='picking'&&(
          <div style={{marginTop:14,paddingTop:14,borderTop:`1px solid ${T.border}`}}>
            <div style={{fontSize:13,color:T.text,fontFamily:F,marginBottom:4}}>
              {fhnError || "You don't appear to be at a recognized marine fishing spot right now."}
            </div>
            <div style={{fontSize:11,color:T.sub,marginBottom:10,fontFamily:F}}>Pick a water to get a suggestion for it instead:</div>

            {nearbyAreas.length>0&&(
              <div style={{marginBottom:10}}>
                <div style={{fontSize:10,color:T.sub,letterSpacing:1,textTransform:'uppercase',marginBottom:6,fontFamily:F}}>Nearest Marine Areas</div>
                <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                  {nearbyAreas.map(a=>(
                    <button key={a.num} onClick={()=>runFishHereSuggestion(a.title)} style={{background:T.muted,border:`1px solid ${T.border}`,color:T.text,padding:'6px 11px',borderRadius:8,cursor:'pointer',fontSize:12,fontFamily:F}}>
                      {a.title.replace('Marine Area ','MA ')} &middot; ~{Math.round(a.dist)} mi
                    </button>
                  ))}
                </div>
              </div>
            )}

            {favWaters.length>0&&(
              <div>
                <div style={{fontSize:10,color:T.sub,letterSpacing:1,textTransform:'uppercase',marginBottom:6,fontFamily:F}}>My Waters</div>
                <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                  {favWaters.map(w=>(
                    <button key={w.id} onClick={()=>runFishHereSuggestion(w.name)} style={{background:T.muted,border:`1px solid ${T.border}`,color:T.text,padding:'6px 11px',borderRadius:8,cursor:'pointer',fontSize:12,fontFamily:F}}>
                      {w.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {nearbyAreas.length===0&&favWaters.length===0&&(
              <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                {MARINE_AREAS.map(a=>(
                  <button key={a.num} onClick={()=>runFishHereSuggestion(a.title)} style={{background:T.muted,border:`1px solid ${T.border}`,color:T.text,padding:'5px 10px',borderRadius:8,cursor:'pointer',fontSize:11,fontFamily:F}}>
                    {a.title.replace('Marine Area ','MA ')}
                  </button>
                ))}
              </div>
            )}

            <button onClick={()=>{setFhnState('idle');setFhnError('');setNearbyAreas([]);}} style={{marginTop:10,background:'none',border:'none',color:T.sub,fontSize:11,cursor:'pointer',fontFamily:F}}>Cancel</button>
          </div>
        )}
      </div>

      {/* Chat */}
      <div style={{...cardOf(T),padding:12,minHeight:220,maxHeight:440,overflowY:'auto',display:'flex',flexDirection:'column',gap:10}}>
        {chat.length===0&&!loading&&(
          <div style={{color:T.sub,fontSize:13,textAlign:'center',margin:'auto',fontFamily:F}}>Your expert western Washington fishing guide — ask anything.</div>
        )}
        {chat.map((m,i)=>(
          <div key={i} style={{alignSelf:m.role==='user'?'flex-end':'flex-start',maxWidth:'88%'}}>
            <div style={{background:m.role==='user'?T.hot:T.lift,color:m.role==='user'?'#fff':T.text,borderRadius:m.role==='user'?'14px 14px 4px 14px':'14px 14px 14px 4px',padding:'10px 14px',fontSize:14,lineHeight:1.65,whiteSpace:'pre-wrap',fontFamily:F}}>
              {m.content}
            </div>
            {m.role==='assistant'&&m.toolLabel&&(
              <button onClick={()=>onPrint(m.toolLabel,m.content)} style={{marginTop:6,background:'transparent',border:`1px solid ${T.border}`,color:T.sub,borderRadius:7,padding:'4px 10px',fontSize:11,cursor:'pointer',fontFamily:F}}>
                ⬇ Export as PDF
              </button>
            )}
          </div>
        ))}
        {loading&&<div style={{color:T.sub,fontSize:13,fontStyle:'italic',fontFamily:F}}>Searching current conditions and regulations…</div>}
        <div ref={bottomRef}/>
      </div>

      {/* Input */}
      <div style={{display:'flex',gap:8}}>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}}} placeholder="Ask about spots, regulations, conditions, gear…" style={{...inpOf(T),flex:1}} disabled={loading}/>
        <button onClick={()=>send()} disabled={loading||!input.trim()} style={{...btnOf(T),paddingLeft:22,paddingRight:22,opacity:loading||!input.trim()?0.5:1}}>Ask</button>
      </div>
      {chat.length>0&&<button onClick={()=>onSaveChat([])} style={{background:'none',border:'none',color:T.sub,fontSize:12,cursor:'pointer',textAlign:'left',fontFamily:F}}>Clear chat</button>}

      {/* Planning Tools */}
      <div style={cardOf(T)}>
        <SectionHead T={T}>Planning Tools</SectionHead>
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          <ToolCard T={T} title="Pre-Trip Brief" desc="Weather, tides, rigging, and where to start" icon="📋" active={activeTool==='brief'} onToggle={()=>setTool(activeTool==='brief'?null:'brief')}>
            <PreTripTool T={T} favWaters={favWaters} onSend={(p)=>send(p,'Pre-Trip Brief')}/>
          </ToolCard>
          <ToolCard T={T} title="Bite Window Predictor" desc="Trolling and mooching windows based on tides" icon="🎯" active={activeTool==='bite'} onToggle={()=>setTool(activeTool==='bite'?null:'bite')}>
            <BitePredictorTool T={T} favWaters={favWaters} onSend={(p)=>send(p,'Bite Window Predictor')}/>
          </ToolCard>
          <ToolCard T={T} title="Trip Checklist" desc="Personalized gear and prep checklist" icon="✓" active={activeTool==='list'} onToggle={()=>setTool(activeTool==='list'?null:'list')}>
            <ChecklistTool T={T} gear={gear} onSend={(p)=>send(p,'Trip Checklist')}/>
          </ToolCard>
        </div>
      </div>

      {/* Quick Prompts */}
      <div style={cardOf(T)}>
        <SectionHead T={T}>Quick Prompts</SectionHead>
        {PROMPT_CATS.map(cat=>(
          <div key={cat.cat} style={{marginBottom:14}}>
            <div style={{fontSize:10,color:T.sub,letterSpacing:1.2,textTransform:'uppercase',marginBottom:7,fontWeight:'600',fontFamily:F}}>{cat.cat}</div>
            <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
              {cat.prompts.map(p=>(
                <button key={p} onClick={()=>send(p)} style={{background:T.muted,border:`1px solid ${T.border}`,color:T.text,padding:'6px 11px',borderRadius:8,cursor:'pointer',fontSize:12,fontFamily:F,textAlign:'left',lineHeight:1.4}}>{p}</button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PreTripTool({T,favWaters,onSend}){
  const nextSat=(()=>{const d=new Date();const n=(6-d.getDay()+7)%7||7;const s=new Date(d.getTime()+n*86400000);return`${s.getFullYear()}-${String(s.getMonth()+1).padStart(2,'0')}-${String(s.getDate()).padStart(2,'0')}`;})();
  const [date,setDate]=useState(nextSat);
  const [loc,setLoc]=useState(favWaters[0]?.name||'');
  const [species,setSpecies]=useState('Coho (Silver)');
  const run=()=>onSend(`Full pre-trip fishing brief for:
- Date: ${date}
- Location: ${loc||'Puget Sound, WA'}
- Target: ${species}

Search for and include:
1. Weather forecast for that date and location
2. Complete tide schedule (all high/low times and heights)
3. Best fishing windows based on tides with specific times
4. Recommended rigging, lure color, and depth for ${currentSeason()} ${species}
5. Specific starting spots or areas
6. Any current regulations or closures to be aware of

Format as a concise scannable brief. I'm an experienced angler — no basics needed.`);
  return(
    <div style={{display:'flex',flexDirection:'column',gap:10}}>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        <Field label="Date" T={T}><input type="date" value={date} onChange={e=>setDate(e.target.value)} style={inpOf(T)}/></Field>
        <Field label="Location" T={T}><input placeholder={favWaters[0]?.name||'MA 10, Skykomish R…'} value={loc} onChange={e=>setLoc(e.target.value)} style={inpOf(T)}/></Field>
        <Field label="Target Species" span2 T={T}>
          <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
            {['Chinook (King)','Coho (Silver)','Steelhead','Sea-run Cutthroat','Trout (Resident)'].map(s=>(
              <Chip key={s} label={s} active={species===s} T={T} color={T.hot} onClick={()=>setSpecies(s)}/>
            ))}
          </div>
        </Field>
      </div>
      <button onClick={run} style={{...btnOf(T),width:'100%'}}>Generate Pre-Trip Brief</button>
    </div>
  );
}

function BitePredictorTool({T,favWaters,onSend}){
  const [date,setDate]=useState(new Date().toISOString().slice(0,10));
  const [loc,setLoc]=useState(favWaters.filter(w=>w.type==='Saltwater')[0]?.name||'');
  const [tech,setTech]=useState('Trolling');
  const run=()=>onSend(`Salmon bite window prediction for ${tech.toLowerCase()} on:
- Date: ${date}
- Location: ${loc||'Puget Sound, WA'}

Search for tide predictions for this date and location. Then provide:

TIDE SCHEDULE:
List all high/low tides with exact times and heights.

BITE WINDOWS — ${tech.toUpperCase()}:
${tech==='Trolling'
  ?'For trolling salmon: best periods are when current is building 1-3 hrs after slack (approx 0.5-1.5 knots). Incoming tide typically better for salmon. Rate each window: ★★★ Best / ★★ Good / ★ Fair'
  :'For mooching: best periods are around slack water (±45 min around each high/low). Give exact window times and depth adjustments as current picks up.'}

Format: [TIME RANGE] — [RATING] — [TIDE STAGE] — [Brief tactical note]

ADJUSTMENTS:
Any specific notes for these conditions.`);
  return(
    <div style={{display:'flex',flexDirection:'column',gap:10}}>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        <Field label="Date" T={T}><input type="date" value={date} onChange={e=>setDate(e.target.value)} style={inpOf(T)}/></Field>
        <Field label="Location" T={T}><input placeholder="MA 10, Hood Canal…" value={loc} onChange={e=>setLoc(e.target.value)} style={inpOf(T)}/></Field>
      </div>
      <Field label="Technique" T={T}>
        <div style={{display:'flex',gap:8}}>
          {['Trolling','Mooching'].map(t=><Chip key={t} label={t} active={tech===t} T={T} color={T.accent} onClick={()=>setTech(t)}/>)}
        </div>
      </Field>
      <button onClick={run} style={{...btnOf(T,'green'),width:'100%'}}>Get Bite Windows</button>
    </div>
  );
}

function ChecklistTool({T,gear,onSend}){
  const [species,setSpecies]=useState('Coho (Silver)');
  const [waterType,setWT]=useState('Saltwater');
  const [technique,setTech]=useState('Trolling');
  const run=()=>{
    const myGear=gear.slice(0,5).map(g=>g.name).join(', ');
    onSend(`Pre-trip checklist for:
- Target: ${species}
- Water: ${waterType}
- Technique: ${technique}
- Season: ${currentSeason()}, ${monthName()} ${thisYear()}
${myGear?`- My gear includes: ${myGear}`:''}

Format with checkboxes (□). Include:
□ Rod, reel, and line setup specifics for ${technique} ${species}
□ Terminal tackle and lure recommendations (with specific colors for ${currentSeason()})
□ Bait or scent if applicable
□ Safety gear
□ WA licensing: punchcard, mark-selective rules reminder
□ Electronics and navigation
□ Food, water, comfort
□ Species-specific tips for ${species}

Experienced angler — skip basics.`);
  };
  return(
    <div style={{display:'flex',flexDirection:'column',gap:10}}>
      <Field label="Target Species" T={T}>
        <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
          {SPECIES.slice(0,7).map(s=><Chip key={s} label={s} active={species===s} T={T} color={T.hot} onClick={()=>setSpecies(s)}/>)}
        </div>
      </Field>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        <Field label="Water Type" T={T}>
          <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
            {['Saltwater','Lake','River / Stream'].map(w=><Chip key={w} label={w} active={waterType===w} T={T} color={T.accent} onClick={()=>setWT(w)}/>)}
          </div>
        </Field>
        <Field label="Technique" T={T}>
          <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
            {TECHNIQUES.slice(0,4).map(t=><Chip key={t} label={t} active={technique===t} T={T} color={T.accent} onClick={()=>setTech(t)}/>)}
          </div>
        </Field>
      </div>
      <button onClick={run} style={{...btnOf(T),width:'100%'}}>Generate Checklist</button>
    </div>
  );
}

// ── My Waters Tab ───────────────────────────────────────────────────────────
function MyWatersTab({favWaters,onSave,onWaterClick,T}){
  const [name,setName]=useState('');
  const [typeOvr,setTO]=useState('');
  const [notes,setNotes]=useState('');
  const [adding,setAdding]=useState(false);
  const inferred = typeOvr || inferWaterType(name);
  const maMatch = matchMarineArea(name);

  const add=async()=>{
    if(!name.trim()) return;
    setAdding(true);
    const wType=inferred||'Unknown';
    const ma=maMatch;
    const prompt=ma
      ? `Search wdfw.wa.gov for current fishing status of ${ma.title} (official WDFW marine area page: ${marineAreaUrl(ma)}). This is a Washington State saltwater marine area. Search the WDFW regulations and emergency rules pages for current season status for this specific marine area, then respond ONLY with valid JSON — no markdown, no explanation:
{"quickStatus":[{"species":"Chinook","status":"open"},{"species":"Coho","status":"limited"},{"species":"Steelhead","status":"closed"}]}
Use status values: "open","closed","limited","unknown". Only include species relevant to ${ma.title} (typically Chinook, Coho, and one or two others). Max 4 species. Month: ${monthName()} ${thisYear()}. Be precise to ${ma.title} specifically — do not confuse it with a neighboring marine area.`
      : `For "${name.trim()}" (${wType}) in Washington State, search WDFW for current status and respond ONLY with valid JSON — no markdown, no explanation:
{"quickStatus":[{"species":"Chinook","status":"open"},{"species":"Coho","status":"limited"},{"species":"Steelhead","status":"closed"}]}
Use status values: "open","closed","limited","unknown". Only include relevant species for this water. Max 4 species. Month: ${monthName()} ${thisYear()}.`;
    let quickStatus=[];
    try{
      const raw=await askClaude([{role:'user',content:prompt}],'Respond only with valid JSON, no markdown, no preamble.',{maxTokens:300,webSearch:true});
      quickStatus=JSON.parse(raw.replace(/```json|```/g,'').trim()).quickStatus||[];
    }catch{}
    const water={id:Date.now(),name:ma?ma.title:name.trim(),type:wType,notes:notes.trim(),quickStatus};
    if(ma){ water.maNum=ma.num; water.maSlug=ma.slug; }
    onSave([...favWaters,water]);
    setName('');setTO('');setNotes('');setAdding(false);
  };

  const remove=id=>onSave(favWaters.filter(w=>w.id!==id));

  const refreshStatus=async w=>{
    const ma = w.maSlug ? MARINE_AREAS.find(a=>a.slug===w.maSlug) : matchMarineArea(w.name);
    const prompt=ma
      ? `Search wdfw.wa.gov for current fishing status of ${ma.title} (official WDFW marine area page: ${marineAreaUrl(ma)}). Search WDFW regulations and emergency rules pages for current season status, then respond ONLY with valid JSON:
{"quickStatus":[{"species":"Chinook","status":"open"},{"species":"Steelhead","status":"closed"}]}
Use: "open","closed","limited","unknown". Max 4 relevant species. Month: ${monthName()} ${thisYear()}. Be precise to ${ma.title} — don't confuse it with a neighboring marine area.`
      : `For "${w.name}" (${w.type}) in Washington State, search WDFW for current status and respond ONLY with valid JSON:
{"quickStatus":[{"species":"Chinook","status":"open"},{"species":"Steelhead","status":"closed"}]}
Use: "open","closed","limited","unknown". Max 4 relevant species. Month: ${monthName()} ${thisYear()}.`;
    try{
      const raw=await askClaude([{role:'user',content:prompt}],'Respond only with valid JSON.',{maxTokens:300,webSearch:true});
      const parsed=JSON.parse(raw.replace(/```json|```/g,'').trim());
      onSave(favWaters.map(fw=>fw.id===w.id?{...fw,quickStatus:parsed.quickStatus||[]}:fw));
    }catch{}
  };

  return(
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      <div style={cardOf(T)}>
        <SectionHead T={T}>Add a Favorite Water</SectionHead>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px 14px'}}>
          <Field label="Name" span2 T={T}>
            <input placeholder="e.g. Skykomish River, MA 10, Hood Canal, Lake Sammamish" value={name} onChange={e=>setName(e.target.value)} style={inpOf(T)} onKeyDown={e=>e.key==='Enter'&&add()}/>
            {maMatch&&<div style={{fontSize:11,color:T.accent,marginTop:6,fontFamily:F}}>✓ Matched: {maMatch.title}</div>}
          </Field>
          <Field label="Water Type (auto-detected)" T={T}>
            <div style={{marginBottom:6}}>
              <div style={{display:'inline-block',padding:'5px 12px',borderRadius:7,fontSize:13,background:inferred?T.accent:T.lift,color:inferred?'#fff':T.sub,fontFamily:F}}>{inferred||'Enter name to detect'}</div>
            </div>
            <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
              {['Saltwater','Lake','River / Stream'].map(t=><Chip key={t} label={t} active={typeOvr===t} T={T} color={T.accent} onClick={()=>setTO(typeOvr===t?'':t)}/>)}
            </div>
          </Field>
          <Field label="Notes (optional)" T={T}>
            <input placeholder="Launch, access point…" value={notes} onChange={e=>setNotes(e.target.value)} style={inpOf(T)}/>
          </Field>
        </div>
        <button onClick={add} disabled={adding||!name.trim()} style={{...btnOf(T,'green'),marginTop:12,opacity:adding?0.7:1}}>{adding?'Looking up current status…':'Add Water'}</button>
        <div style={{fontSize:11,color:T.sub,marginTop:8,fontFamily:F}}>Fetches live regulation status via WDFW. Always verify at wdfw.wa.gov.</div>
      </div>

      {favWaters.length===0&&<div style={{...cardOf(T),color:T.sub,fontSize:13,textAlign:'center',padding:32,fontFamily:F}}>No favorite waters saved yet.</div>}

      {favWaters.map(w=>(
        <div key={w.id} style={cardOf(T)}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:10}}>
            <div style={{flex:1,minWidth:0}}>
              <div onClick={()=>onWaterClick(w)} style={{fontSize:15,color:T.text,cursor:'pointer',textDecoration:'underline',textDecorationColor:T.border,fontFamily:F}}>{w.name}</div>
              <div style={{fontSize:11,color:T.sub,marginTop:2,fontFamily:F}}>{w.type}{w.notes?` · ${w.notes}`:''}</div>
              <div style={{display:'flex',gap:8,marginTop:8,flexWrap:'wrap',alignItems:'center'}}>
                {(w.quickStatus||[]).map((s,i)=>(
                  <div key={i} style={{display:'flex',alignItems:'center',gap:5}}>
                    <span style={{fontSize:11,color:T.sub,fontFamily:F}}>{s.species}</span>
                    <StatusPill status={s.status} T={T}/>
                  </div>
                ))}
                {(w.quickStatus||[]).length===0&&<span style={{fontSize:11,color:T.sub,fontFamily:F,fontStyle:'italic'}}>No status yet — click Refresh</span>}
              </div>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:5,flexShrink:0}}>
              <button onClick={()=>onWaterClick(w)} style={{...btnOf(T,'ghost'),padding:'4px 10px',fontSize:11}}>Full Regs</button>
              <button onClick={()=>refreshStatus(w)} style={{...btnOf(T,'ghost'),padding:'4px 10px',fontSize:11}}>Refresh</button>
              <button onClick={()=>remove(w.id)} style={{...btnOf(T,'ghost'),padding:'4px 10px',fontSize:11,color:T.err,borderColor:`${T.err}44`}}>Remove</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Water Detail Page ───────────────────────────────────────────────────────
function WaterDetailPage({water,onBack,T}){
  const [regs,setRegs]=useState(null);
  const [loading,setLoading]=useState(true);
  const ma = water.maSlug ? MARINE_AREAS.find(a=>a.slug===water.maSlug) : matchMarineArea(water.name);
  const wdfw_link = ma
    ? marineAreaUrl(ma)
    : water.type==='Saltwater'
    ?'https://wdfw.wa.gov/fishing/locations/marine-areas'
    :water.type==='River / Stream'
    ?'https://wdfw.wa.gov/fishing/regulations/freshwater-regulations'
    :'https://wdfw.wa.gov/fishing/rules';

  useEffect(()=>{
    let active=true;
    (async()=>{
      const prompt=ma
        ? `Search wdfw.wa.gov for current fishing regulations for ${ma.title} (official WDFW page: ${marineAreaUrl(ma)}), ${monthName()} ${thisYear()}.

This is a specific numbered Washington marine area — be precise and do not confuse it with a neighboring marine area. Check wdfw.wa.gov/fishing/regulations, wdfw.wa.gov/fishing/regulations/emergency-rules, and the page above.

Provide a structured response with these exact headers on their own lines:
OVERVIEW
SALMON & STEELHEAD
TROUT & OTHER SPECIES
GEAR RESTRICTIONS
SEASON DATES
ALERTS & NOTES

Include: bag limits, size limits, mark-selective rules, wild fish rules, gear restrictions, any emergency closures specific to ${ma.title}. Experienced angler — skip basics.

End with: Verify all rules at wdfw.wa.gov/fishing/rules or call 1-800-902-2474.`
        : `Search wdfw.wa.gov for current fishing regulations for "${water.name}" (${water.type}) in Washington State, ${monthName()} ${thisYear()}.

Check: ${water.type==='Saltwater'?'wdfw.wa.gov/fishing/locations/marine-areas':'wdfw.wa.gov/fishing/regulations/freshwater-regulations'} and wdfw.wa.gov/fishing/rules

Provide a structured response with these exact headers on their own lines:
OVERVIEW
SALMON & STEELHEAD
TROUT & OTHER SPECIES
GEAR RESTRICTIONS
SEASON DATES
ALERTS & NOTES

Include: bag limits, size limits, mark-selective rules, wild fish rules, gear restrictions, any emergency closures. Be specific to ${water.name}. Experienced angler — skip basics.

End with: Verify all rules at wdfw.wa.gov/fishing/rules or call 1-800-902-2474.`;
      try{
        const r=await askClaude([{role:'user',content:prompt}],'WDFW regulation expert for Washington State. Search WDFW website for current, specific rules.',{maxTokens:1200,webSearch:true});
        if(active) setRegs(r);
      }catch{if(active) setRegs('Could not load — check your connection and try again.');}
      if(active) setLoading(false);
    })();
    return()=>{active=false;};
  },[water.name,water.type]);

  const HEADERS=['OVERVIEW','SALMON & STEELHEAD','TROUT & OTHER SPECIES','GEAR RESTRICTIONS','SEASON DATES','ALERTS & NOTES'];
  const HICONS={'OVERVIEW':'◈','SALMON & STEELHEAD':'〜','TROUT & OTHER SPECIES':'◎','GEAR RESTRICTIONS':'⊕','SEASON DATES':'▦','ALERTS & NOTES':'⚑'};
  const sections=[];
  if(regs){
    HEADERS.forEach((h,i)=>{
      const idx=regs.indexOf(h);
      if(idx===-1) return;
      const after=regs.slice(idx+h.length);
      const nexts=HEADERS.slice(i+1).map(nh=>after.indexOf(nh)).filter(x=>x>-1);
      const end=nexts.length>0?Math.min(...nexts):after.length;
      const body=after.slice(0,end).trim();
      if(body) sections.push({title:h,body});
    });
    if(sections.length===0) sections.push({title:'Regulations',body:regs});
  }

  return(
    <div style={{maxWidth:820,margin:'0 auto',padding:'0 0 60px'}}>
      <div style={{background:T.surface,borderBottom:`1px solid ${T.border}`,padding:'14px 16px'}}>
        <button onClick={onBack} style={{background:'none',border:'none',color:T.sub,cursor:'pointer',fontFamily:F,fontSize:13,padding:0,marginBottom:10}}>← Back</button>
        <div style={{fontSize:20,fontWeight:'700',color:T.text,fontFamily:F}}>{water.name}</div>
        <div style={{fontSize:11,color:T.sub,marginTop:3,letterSpacing:1,textTransform:'uppercase',fontFamily:F}}>{water.type} · Full Regulations</div>
        {(water.quickStatus||[]).length>0&&(
          <div style={{display:'flex',gap:8,marginTop:10,flexWrap:'wrap'}}>
            {water.quickStatus.map((s,i)=>(
              <div key={i} style={{display:'flex',alignItems:'center',gap:5}}>
                <span style={{fontSize:11,color:T.sub,fontFamily:F}}>{s.species}</span>
                <StatusPill status={s.status} T={T}/>
              </div>
            ))}
          </div>
        )}
        <a href={wdfw_link} target="_blank" rel="noopener noreferrer" style={{display:'inline-block',marginTop:10,fontSize:12,color:T.accent,fontFamily:F,textDecoration:'none'}}>→ Open on WDFW Website ↗</a>
      </div>
      <div style={{padding:16}}>
        {loading&&<div style={{...cardOf(T),color:T.sub,fontSize:13,fontStyle:'italic',textAlign:'center',padding:40,fontFamily:F}}>Searching WDFW for current regulations on {water.name}…</div>}
        {!loading&&sections.length===0&&(
          <div style={{...cardOf(T),color:T.sub,fontSize:13,textAlign:'center',padding:32,fontFamily:F}}>
            No regulation details came back. <a href={wdfw_link} target="_blank" rel="noopener noreferrer" style={{color:T.accent}}>Check WDFW directly</a>, or go back and try again.
          </div>
        )}
        {!loading&&sections.length>0&&(
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            {sections.map((s,i)=>(
              <div key={i} style={cardOf(T)}>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
                  <span style={{color:T.hot,fontSize:14}}>{HICONS[s.title]||'▸'}</span>
                  <span style={{fontSize:11,letterSpacing:1.8,textTransform:'uppercase',color:T.hot,fontFamily:F,fontWeight:'600'}}>{s.title}</span>
                  <div style={{flex:1,height:1,background:T.border}}/>
                </div>
                <div style={{fontSize:13,color:T.text,lineHeight:1.75,whiteSpace:'pre-wrap',fontFamily:F}}>{s.body}</div>
              </div>
            ))}
            <div style={{fontSize:11,color:T.sub,textAlign:'center',padding:'8px 0',fontFamily:F}}>
              AI-generated from live WDFW data. Always verify at{' '}
              <a href="https://wdfw.wa.gov/fishing/rules" target="_blank" rel="noopener noreferrer" style={{color:T.accent}}>wdfw.wa.gov/fishing/rules</a>
              {' '}or call 1-800-902-2474.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Log Outing ──────────────────────────────────────────────────────────────
function LogOuting({outings,gear,onSave,T}){
  const blank={date:new Date().toISOString().slice(0,10),location:'',waterType:'',speciesTargeted:[],speciesCaught:[],technique:'',gearUsed:'',conditions:'',tide:'',catchCount:0,kept:0,released:0,notes:''};
  const [form,setForm]=useState(blank);
  const [saved,setSaved]=useState(false);
  const [error,setError]=useState('');

  const set=(k,v)=>setForm(prev=>{
    const u={...prev,[k]:v};
    if(k==='location'){const inf=inferWaterType(v);if(inf)u.waterType=inf;}
    return u;
  });
  const toggleSp=(field,sp)=>setForm(prev=>{
    const curr=prev[field]||[];
    return{...prev,[field]:curr.includes(sp)?curr.filter(s=>s!==sp):[...curr,sp]};
  });
  const submit=()=>{
    if(!form.location){setError('Location is required.');return;}
    if(!(form.speciesTargeted||[]).length&&!(form.speciesCaught||[]).length){setError('Select at least one species.');return;}
    setError('');
    onSave([{...form,id:Date.now()},...outings]);
    setForm(blank);setSaved(true);setTimeout(()=>setSaved(false),2500);
  };
  const gearNames=gear.map(g=>g.name).filter(Boolean);
  const missedTargets=(form.speciesTargeted||[]).filter(s=>!(form.speciesCaught||[]).includes(s));

  return(
    <div style={cardOf(T)}>
      <SectionHead T={T}>New Outing</SectionHead>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px 14px'}}>
        <Field label="Date" T={T}><input type="date" value={form.date} onChange={e=>set('date',e.target.value)} style={inpOf(T)}/></Field>
        <Field label="Location" T={T}>
          <input placeholder="Lake, river, or marine area…" value={form.location} onChange={e=>set('location',e.target.value)} style={inpOf(T)}/>
          {matchMarineArea(form.location)&&<div style={{fontSize:11,color:T.accent,marginTop:6,fontFamily:F}}>✓ {matchMarineArea(form.location).title}</div>}
        </Field>
        <Field label="Water Type (auto-detected)" span2 T={T}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <div style={{padding:'7px 13px',borderRadius:8,fontSize:13,background:form.waterType?T.accent:T.lift,color:form.waterType?'#fff':T.sub,fontFamily:F,minWidth:130,flexShrink:0}}>{form.waterType||'Enter location…'}</div>
            <select value={form.waterType} onChange={e=>setForm(prev=>({...prev,waterType:e.target.value}))} style={{...inpOf(T),width:'auto',flex:1,fontSize:12}}>
              <option value="">Override…</option>
              {['Saltwater','Lake','River / Stream'].map(t=><option key={t}>{t}</option>)}
            </select>
          </div>
        </Field>
        <Field label="Species Targeted" span2 T={T}>
          <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
            {SPECIES.map(s=><Chip key={s} label={s} active={(form.speciesTargeted||[]).includes(s)} T={T} color={T.hot} onClick={()=>toggleSp('speciesTargeted',s)}/>)}
          </div>
        </Field>
        <Field label="Species Actually Caught" span2 T={T}>
          <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
            {SPECIES.map(s=><Chip key={s} label={s} active={(form.speciesCaught||[]).includes(s)} T={T} color={T.accent} onClick={()=>toggleSp('speciesCaught',s)}/>)}
          </div>
          {(form.speciesCaught||[]).length>0&&missedTargets.length>0&&(
            <div style={{fontSize:11,color:T.warn,marginTop:6,fontFamily:F}}>{missedTargets.join(', ')} targeted but not in caught — intentional?</div>
          )}
        </Field>
        <Field label="Technique" span2 T={T}>
          <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
            {TECHNIQUES.map(t=><Chip key={t} label={t} active={form.technique===t} T={T} color={T.accent} onClick={()=>set('technique',form.technique===t?'':t)}/>)}
          </div>
        </Field>
        <Field label="Gear Used" T={T}>
          {gearNames.length>0
            ?<select value={form.gearUsed} onChange={e=>set('gearUsed',e.target.value)} style={inpOf(T)}><option value="">Select…</option>{gearNames.map(g=><option key={g}>{g}</option>)}</select>
            :<input placeholder='e.g. 4" chartreuse spoon' value={form.gearUsed} onChange={e=>set('gearUsed',e.target.value)} style={inpOf(T)}/>
          }
        </Field>
        <Field label="Conditions" T={T}><input placeholder="overcast, chop, 52°F" value={form.conditions} onChange={e=>set('conditions',e.target.value)} style={inpOf(T)}/></Field>
        <Field label="Tide / Flow" T={T}><input placeholder="incoming -2ft, high slack…" value={form.tide} onChange={e=>set('tide',e.target.value)} style={inpOf(T)}/></Field>
        <Field label="Fish Caught" T={T}><input type="number" min={0} value={form.catchCount} onChange={e=>set('catchCount',e.target.value)} style={inpOf(T)}/></Field>
        <Field label="Kept" T={T}><input type="number" min={0} value={form.kept} onChange={e=>set('kept',e.target.value)} style={inpOf(T)}/></Field>
        <Field label="Released" T={T}><input type="number" min={0} value={form.released} onChange={e=>set('released',e.target.value)} style={inpOf(T)}/></Field>
        <Field label="Notes" span2 T={T}><textarea rows={3} value={form.notes} onChange={e=>set('notes',e.target.value)} placeholder="Depth, lure color, what worked…" style={{...inpOf(T),resize:'vertical'}}/></Field>
      </div>
      {error&&<div style={{fontSize:12,color:T.err,marginTop:8,fontFamily:F}}>{error}</div>}
      <button onClick={submit} style={{...btnOf(T),marginTop:14,width:'100%',background:saved?T.accent:T.hot,fontSize:15}}>{saved?'✓ Outing Saved':'Save Outing'}</button>
    </div>
  );
}

// ── Gear Manager ────────────────────────────────────────────────────────────
function GearManager({gear,onSave,T}){
  const blank={name:'',type:'',species:'',detail:'',rating:''};
  const [form,setForm]=useState(blank);
  const TYPES=['Rod','Reel','Lure – Spoon','Lure – Plug','Lure – Jig','Fly','Leader / Line','Terminal Tackle','Net / Other'];
  const set=(k,v)=>setForm(prev=>({...prev,[k]:v}));
  const add=()=>{if(!form.name)return;onSave([{...form,id:Date.now()},...gear]);setForm(blank);};
  const del=id=>onSave(gear.filter(g=>g.id!==id));
  return(
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      <div style={cardOf(T)}>
        <SectionHead T={T}>Add Gear</SectionHead>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px 14px'}}>
          <Field label="Name / Model" T={T}><input placeholder="Gibbs Silva Spoon 4in" value={form.name} onChange={e=>set('name',e.target.value)} style={inpOf(T)}/></Field>
          <Field label="Type" T={T}>
            <select value={form.type} onChange={e=>set('type',e.target.value)} style={inpOf(T)}>
              <option value="">Select…</option>{TYPES.map(t=><option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Best For" span2 T={T}>
            <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
              {SPECIES.map(s=><Chip key={s} label={s} active={form.species===s} T={T} color={T.hot} onClick={()=>set('species',form.species===s?'':s)}/>)}
            </div>
          </Field>
          <Field label="Detail / Color / Weight" T={T}><input placeholder="chrome/blue, 1oz" value={form.detail} onChange={e=>set('detail',e.target.value)} style={inpOf(T)}/></Field>
          <Field label="Rating" T={T}>
            <div style={{display:'flex',gap:5}}>
              {[1,2,3,4,5].map(n=>(
                <button key={n} onClick={()=>set('rating',String(n))} style={{width:32,height:32,borderRadius:6,border:`1px solid ${Number(form.rating)>=n?T.warn:T.border}`,background:Number(form.rating)>=n?T.muted:'transparent',color:Number(form.rating)>=n?T.warn:T.sub,cursor:'pointer',fontSize:15}}>★</button>
              ))}
            </div>
          </Field>
        </div>
        <button onClick={add} style={{...btnOf(T,'green'),marginTop:12}}>Add to Gear Bag</button>
      </div>
      <div style={cardOf(T)}>
        <SectionHead T={T}>Gear Bag ({gear.length})</SectionHead>
        {gear.length===0&&<div style={{color:T.sub,fontSize:13,fontFamily:F}}>No gear logged yet.</div>}
        {gear.map(g=>(
          <div key={g.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 0',borderBottom:`1px solid ${T.border}`}}>
            <div>
              <div style={{color:T.text,fontSize:14,fontFamily:F}}>{g.name}{g.rating?<span style={{color:T.warn,marginLeft:6}}>{'★'.repeat(Math.min(5,Number(g.rating)))}</span>:null}</div>
              <div style={{color:T.sub,fontSize:12,marginTop:2,fontFamily:F}}>{[g.type,g.species,g.detail].filter(Boolean).join(' · ')}</div>
            </div>
            <button onClick={()=>del(g.id)} style={{...btnOf(T,'ghost'),padding:'3px 9px',fontSize:11,color:T.err,borderColor:`${T.err}44`}}>Remove</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Regs & Alerts ───────────────────────────────────────────────────────────
function RegsAlerts({T}){
  const [alerts,setAlerts]=useState(null);
  const [loading,setLoading]=useState(false);
  const [fetched,setFetched]=useState(false);
  const fetchAlerts=async()=>{
    setLoading(true);
    const prompt=`Search wdfw.wa.gov/fishing/rules and wdfw.wa.gov/fishing/regulations for western Washington fishing updates in ${monthName()} ${thisYear()}.

Find and report:
1. EMERGENCY RULE CHANGES or in-season closures for salmon, steelhead, or trout in western WA
2. KEY SEASON OPENINGS or CLOSINGS this month or next for Puget Sound marine areas and steelhead rivers
3. MARK-SELECTIVE or hatchery-only rules currently in effect for ${currentSeason()}
4. Best verification sources

Be specific to western WA. Note that regulations change frequently — always verify before fishing.`;
    try{
      const r=await askClaude([{role:'user',content:prompt}],'WDFW regulation expert. Search WDFW website for current western WA rules.',{maxTokens:1000,webSearch:true});
      setAlerts(r);setFetched(true);
    }catch{setAlerts('Could not fetch — check your connection.');}
    setLoading(false);
  };
  const pinned=[
    {l:'WDFW Rules',t:'wdfw.wa.gov/fishing/rules — authoritative source for all regulations.',c:T.accent},
    {l:'WDFW Hotline',t:'1-800-902-2474 — emergency closures and in-season changes.',c:T.accent},
    {l:'Mark-Selective',t:'Most Puget Sound salmon fisheries require an adipose-clipped (hatchery) fish. Verify before each outing.',c:T.warn},
    {l:'Wild Steelhead',t:'Wild (unclipped) steelhead must be released on virtually all western WA rivers.',c:T.warn},
    {l:'License + Punchcard',t:'Salmon and steelhead require a fishing license plus a current punchcard. Renew annually.',c:T.sub},
  ];
  return(
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      <div style={cardOf(T)}>
        <SectionHead T={T}>Standing Rules & Resources</SectionHead>
        {pinned.map((p,i)=>(
          <div key={i} style={{display:'flex',gap:10,alignItems:'flex-start',padding:'8px 0',borderBottom:i<pinned.length-1?`1px solid ${T.border}`:'none'}}>
            <div style={{width:3,borderRadius:2,background:p.c,flexShrink:0,alignSelf:'stretch',minHeight:14}}/>
            <div>
              <div style={{fontSize:11,color:p.c,letterSpacing:.5,marginBottom:2,fontFamily:F}}>{p.l}</div>
              <div style={{fontSize:13,color:T.text,lineHeight:1.5,fontFamily:F}}>{p.t}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={cardOf(T)}>
        <SectionHead T={T}>Live WDFW Briefing — {monthName()} {thisYear()}</SectionHead>
        {!fetched&&!loading&&(
          <div>
            <div style={{fontSize:13,color:T.sub,lineHeight:1.6,marginBottom:12,fontFamily:F}}>Searches wdfw.wa.gov for current emergency closures, season changes, and regulation updates for western Washington.</div>
            <button onClick={fetchAlerts} style={btnOf(T)}>Fetch Live Briefing</button>
          </div>
        )}
        {loading&&<div style={{color:T.sub,fontSize:13,fontStyle:'italic',fontFamily:F}}>Searching WDFW for current regulations…</div>}
        {alerts&&(
          <div>
            <div style={{fontSize:13,color:T.text,lineHeight:1.75,whiteSpace:'pre-wrap',fontFamily:F}}>{alerts}</div>
            <button onClick={fetchAlerts} style={{...btnOf(T,'ghost'),marginTop:14}}>Refresh</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── History ─────────────────────────────────────────────────────────────────
function History({outings,onSave,T}){
  const [filterSp,setFS]=useState('');
  const [filterW,setFW]=useState('');
  const del=id=>onSave(outings.filter(o=>o.id!==id));
  const filtered=[...outings].reverse().filter(o=>{
    const targeted=getTargeted(o);
    return(!filterSp||targeted.includes(filterSp)||(o.speciesCaught||[]).includes(filterSp))&&
           (!filterW||o.waterType===filterW);
  });
  return(
    <div>
      <div style={{display:'flex',gap:10,marginBottom:14}}>
        <select value={filterSp} onChange={e=>setFS(e.target.value)} style={{...inpOf(T),flex:1}}>
          <option value="">All species</option>{SPECIES.map(s=><option key={s}>{s}</option>)}
        </select>
        <select value={filterW} onChange={e=>setFW(e.target.value)} style={{...inpOf(T),flex:1}}>
          <option value="">All water</option>{['Saltwater','Lake','River / Stream'].map(t=><option key={t}>{t}</option>)}
        </select>
      </div>
      {filtered.length===0
        ?<div style={{color:T.sub,fontSize:13,textAlign:'center',padding:40,fontFamily:F}}>No outings match.</div>
        :filtered.map(o=>{
          const targeted=getTargeted(o);
          return(
            <div key={o.id} style={{...cardOf(T),marginBottom:10}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{color:T.text,fontSize:15,fontFamily:F}}>{o.location}</div>
                  <div style={{color:T.sub,fontSize:11,marginTop:2,marginBottom:6,fontFamily:F}}>{o.date}{o.waterType?` · ${o.waterType}`:''}</div>
                  {targeted.length>0&&<div style={{fontSize:12,color:T.sub,fontFamily:F}}>Targeting: <span style={{color:T.hot}}>{targeted.join(', ')}</span></div>}
                  {(o.speciesCaught||[]).length>0&&<div style={{fontSize:12,color:T.sub,fontFamily:F}}>Caught: <span style={{color:T.accent}}>{o.speciesCaught.join(', ')}</span></div>}
                  <div style={{fontSize:13,color:T.text,marginTop:4,fontFamily:F}}>
                    {o.technique?`${o.technique} · `:''}<strong>{o.catchCount||0}</strong> fish{' '}
                    <span style={{color:T.sub}}>({o.kept||0} kept · {o.released||0} released)</span>
                  </div>
                  {o.gearUsed&&<div style={{fontSize:12,color:T.sub,marginTop:4,fontFamily:F}}>Gear: {o.gearUsed}</div>}
                  {o.conditions&&<div style={{fontSize:12,color:T.sub,fontFamily:F}}>Conditions: {o.conditions}</div>}
                  {o.tide&&<div style={{fontSize:12,color:T.sub,fontFamily:F}}>Tide / Flow: {o.tide}</div>}
                  {o.notes&&<div style={{fontSize:13,color:T.text,marginTop:6,fontStyle:'italic',lineHeight:1.5,fontFamily:F}}>{o.notes}</div>}
                </div>
                <button onClick={()=>del(o.id)} style={{...btnOf(T,'ghost'),padding:'3px 9px',fontSize:11,color:T.err,borderColor:`${T.err}44`,flexShrink:0,marginLeft:12}}>Delete</button>
              </div>
            </div>
          );
        })
      }
    </div>
  );
}
