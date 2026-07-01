import { useState, useEffect, useRef } from "react";

// ── Anthropic API access ─────────────────────────────────────────────────────
// Two contexts this file can run in:
//
// 1. Inside a published Claude.ai artifact: calls to api.anthropic.com are
//    proxied and authenticated automatically — no key needed from anyone.
//
// 2. Standalone (this file built with Vite, deployed to your own domain):
//    each visitor enters their OWN Anthropic API key in the Settings tab.
//    It's stored locally in their browser (and synced to their account if
//    signed in) and sent, per-request, to a serverless proxy at /api/claude
//    (see api/claude.js in this project) which forwards it to Anthropic with
//    the right headers. The key is never baked into the deployed site itself
//    — nobody's key ships to every visitor; each person supplies their own,
//    the same way Claude.ai artifact usage bills whoever is viewing, not the
//    creator. /api/claude must live at that exact path (a Vercel serverless
//    function is auto-detected only inside a top-level /api folder) — see
//    setup notes at the bottom of this file.
const isInClaudeArtifact = () => typeof window!=='undefined' && !!window.storage;
let userApiKey = ''; // in-memory cache, set by loadUserApiKey() on startup
const isAnthropicConfigured = () => isInClaudeArtifact() || !!userApiKey;
async function loadUserApiKey(){
  if(isInClaudeArtifact()) return '';
  const stored = await load('userApiKey');
  userApiKey = stored || '';
  return userApiKey;
}
function setUserApiKey(key){
  userApiKey = (key||'').trim();
  save('userApiKey', userApiKey);
}

// ── Firebase backend (REST API — no SDK import needed in this environment) ──
// Edit these once you've created your Firebase project (see setup notes at
// the bottom of this file). Leaving the placeholder makes the app run in
// local-only mode automatically — nothing breaks if you skip this.
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  projectId: "YOUR_PROJECT_ID",
};
const isFirebaseConfigured = () => firebaseConfig.apiKey && firebaseConfig.apiKey !== "YOUR_API_KEY" && firebaseConfig.projectId && firebaseConfig.projectId !== "YOUR_PROJECT_ID";

let fbTokens = null; // {idToken, refreshToken, expiresAt, uid} — in-memory for this session

async function fbSignIn(email, password){
  try{
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseConfig.apiKey}`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ email, password, returnSecureToken:true }),
    });
    const d = await r.json();
    if(d.error) throw new Error(d.error.message==='INVALID_LOGIN_CREDENTIALS' ? 'Incorrect email or password.' : (d.error.message||'Sign-in failed'));
    fbTokens = { idToken:d.idToken, refreshToken:d.refreshToken, expiresAt:Date.now()+Number(d.expiresIn)*1000, uid:d.localId };
    return fbTokens.uid;
  }catch(e){
    throw new Error(e.message.includes('Failed to fetch') ? 'Network error — check your connection.' : e.message);
  }
}
async function fbRefresh(refreshToken){
  try{
    const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${firebaseConfig.apiKey}`, {
      method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:`grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
    });
    const d = await r.json();
    if(d.error) throw new Error('Session expired');
    fbTokens = { idToken:d.id_token, refreshToken:d.refresh_token, expiresAt:Date.now()+Number(d.expires_in)*1000, uid:d.user_id };
    return fbTokens.uid;
  }catch(e){
    throw new Error(e.message.includes('Failed to fetch') ? 'Network error — check your connection.' : e.message);
  }
}
async function fbGetToken(){
  if(fbTokens && Date.now()<fbTokens.expiresAt-60000) return fbTokens.idToken;
  if(fbTokens?.refreshToken){
    try{
      await fbRefresh(fbTokens.refreshToken);
      cacheRefreshToken(fbTokens.refreshToken);
      return fbTokens.idToken;
    }catch(e){
      // If refresh fails (invalid key, session expired), clear tokens and return null
      fbTokens = null;
      cacheRefreshToken(null);
      return null;
    }
  }
  return null;
}
function fbSignOut(){ fbTokens = null; }

// Dedicated cache for the refresh token — deliberately bypasses the main
// stor/load/save layer (which routes to Firestore once signed in). This must
// always live in Claude's own per-account window.storage so it can be read
// BEFORE sign-in resolves, to enable silent re-auth on each fresh visit.
async function cacheRefreshToken(token){
  try{
    if(typeof window!=='undefined' && window.storage){ await window.storage.set('fb_refresh', token||''); return; }
  }catch{}
  try{ localStorage.setItem('fb_refresh', token||''); }catch{}
}
async function getCachedRefreshToken(){
  try{
    if(typeof window!=='undefined' && window.storage){
      const r = await window.storage.get('fb_refresh');
      if(r?.value) return r.value;
    }
  }catch{}
  try{ return localStorage.getItem('fb_refresh') || null; }catch{ return null; }
}

// Firestore REST — documents live at users/{uid}/data/{key}, one doc per storage key.
async function fsGet(uid,key){
  if(!uid || !isFirebaseConfigured()) return null;
  const token = await fbGetToken();
  if(!token) return null; // Not signed in or token refresh failed
  const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/users/${uid}/data/${encodeURIComponent(key)}`;
  try{
    const controller = new AbortController();
    const timeout = setTimeout(()=>controller.abort(), 5000);
    const r = await fetch(url, { 
      headers:{ Authorization:`Bearer ${token}` },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if(!r.ok){
      if(r.status === 401 || r.status === 403){
        fbTokens = null; // Token invalid, force re-auth next time
        cacheRefreshToken(null);
      }
      return null;
    }
    const d = await r.json();
    return d?.fields?.value?.stringValue ?? null;
  }catch{ return null; }
}
async function fsSet(uid,key,value){
  if(!uid || !isFirebaseConfigured()) return false;
  const token = await fbGetToken();
  if(!token) return false; // Not signed in or token refresh failed
  const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/users/${uid}/data/${encodeURIComponent(key)}`;
  try{
    const controller = new AbortController();
    const timeout = setTimeout(()=>controller.abort(), 5000);
    const r = await fetch(url, {
      method:'PATCH', 
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
      body: JSON.stringify({ fields:{ value:{stringValue:value}, updatedAt:{integerValue:String(Date.now())} } }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if(r.status === 401 || r.status === 403){
      fbTokens = null; // Token invalid, force re-auth next time
      cacheRefreshToken(null);
    }
    return r.ok;
  }catch{ return false; }
}

let currentUid = null;
function setSyncUser(uid){ currentUid = uid; }

// ── Themes ─────────────────────────────────────────────────────────────────
const DARK = {
  bg:'#0C1A27', surface:'#132233', lift:'#1B3048', border:'#1E3A55',
  text:'#E6F0F8', sub:'#6B9AB5', dim:'#2E4D65', muted:'#162030',
  accent:'#9B7FC0', hot:'#C9973E', warn:'#EBB030', err:'#E04848',
  openBg:'#0A2D1A', openTx:'#32C870', closeBg:'#2D0A0A', closeTx:'#E04848',
  limitBg:'#2D1D00', limitTx:'#EBB030',
};
const LIGHT = {
  bg:'#EBF1F8', surface:'#FFFFFF', lift:'#F4F8FC', border:'#D2E2EE',
  text:'#152434', sub:'#527A8E', dim:'#B0C8D8', muted:'#F0F5FA',
  accent:'#6B4C8A', hot:'#9A6B1E', warn:'#9E7010', err:'#B02020',
  openBg:'#CCFAE0', openTx:'#0A5C3A', closeBg:'#FDE0E0', closeTx:'#8A1A1A',
  limitBg:'#FEF0C4', limitTx:'#854000',
};
const F = "system-ui,-apple-system,'Segoe UI',sans-serif";

// Logo ships with a black background by design — it sits naturally on the
// dark navy app surface. For the standalone deployment, drop logo-192.png
// into your Vite project's /public folder. Falls back to a glyph in any
// context where the file can't be served (e.g. Claude.ai artifact sandbox).
function BrandMark({T,size=34}){
  const [imgFailed,setImgFailed] = useState(false);
  if(imgFailed){
    return <div style={{width:size,height:size,borderRadius:size*0.28,background:`linear-gradient(135deg,#1B1025,#2A1840)`,border:`1px solid ${T.accent}44`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:size*0.44,flexShrink:0}}>≋</div>;
  }
  return <img src="/logo-192.png" alt="Blackmouth.AI" width={size} height={size} style={{borderRadius:size*0.28,flexShrink:0,objectFit:'cover',display:'block'}} onError={()=>setImgFailed(true)}/>;
}

// ── Constants ───────────────────────────────────────────────────────────────
const TABS = ["AI Guide","Dashboard","My Waters","Log","Gear","Regs","History","Settings"];
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
  // Explicit qualifier words are the strongest signal and must win over any
  // marine-area alias overlap. Many WA rivers/creeks share a name with the
  // bay or inlet they empty into (Dosewallips, Duckabush, Skokomish, Elwha,
  // Nisqually, Quilcene all name both a river AND a Hood Canal/Sound shoreline
  // spot) — if the user typed "river"/"creek"/etc, trust that over any alias
  // list, otherwise "Dosewallips River" would incorrectly resolve to MA12.
  const hasWord = list => list.some(k=>new RegExp(`\\b${k}\\b`).test(s));
  if (hasWord(["river","creek","stream","fork","brook"])) return "River / Stream";
  if (hasWord(["lake","lk","reservoir","pond"])) return "Lake";

  if (matchMarineArea(str)) return "Saltwater";
  if (["puget sound","sound","strait","canal","saratoga","commencement","quartermaster",
    "dyes","liberty bay","port orchard","possession","juan de fuca","rosario",
    "bellingham","padilla","fidalgo","tulalip","hammersley","totten","eld","budd","henderson"
  ].some(k=>s.includes(k))) return "Saltwater";
  if (["snoqualmie","skykomish","skagit","nooksack",
    "stillaguamish","puyallup","green river","cedar","carbon","cowlitz","chehalis","hoh",
    "sol duc","quinault","dosewallips","duckabush","skokomish","dungeness","elwha","methow",
    "wenatchee","columbia","yakima","klickitat"
  ].some(k=>s.includes(k))) return "River / Stream";
  if (["sammamish","washington","union","chelan","roosevelt",
    "banks","moses","potholes","kapowsin","tapps","serene","goodwin"
  ].some(k=>s.includes(k))) return "Lake";
  return "";
}
// Water names that are genuinely ambiguous between a river and the marine
// area/bay it empties into — used to surface a disambiguation note in the UI
// rather than silently guessing. Also flags waters where regulations commonly
// differ between the tidal/mouth section and the upper freshwater section.
const AMBIGUOUS_RIVER_MARINE_NAMES = ['dosewallips','duckabush','skokomish','elwha','nisqually','quilcene','dungeness','hoh','deschutes'];
function isAmbiguousWaterName(str){
  const s=(str||'').toLowerCase();
  return AMBIGUOUS_RIVER_MARINE_NAMES.some(n=>s.includes(n));
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

// ── Storage: Firestore (signed in) > Claude's window.storage > localStorage ──
const stor = {
  async get(k){
    if(currentUid && isFirebaseConfigured()){
      try{
        const val = await fsGet(currentUid,k);
        if(val!=null){ try{localStorage.setItem(k,val);}catch{} return {value:val}; }
      }catch{}
    }
    if(typeof window!=='undefined' && window.storage){
      try{const r=await window.storage.get(k); if(r) return r;}catch{}
    }
    try{const v=localStorage.getItem(k);return v?{value:v}:null;}catch{return null;}
  },
  async set(k,v){
    try{localStorage.setItem(k,v);}catch{} // instant local cache regardless of backend
    if(currentUid && isFirebaseConfigured()){
      try{ await fsSet(currentUid,k,v); return; }catch{}
    }
    if(typeof window!=='undefined' && window.storage){
      try{await window.storage.set(k,v);}catch{}
    }
  }
};
async function load(k){try{const r=await stor.get(k);return r?JSON.parse(r.value):null;}catch{return null;}}
async function save(k,v){try{await stor.set(k,JSON.stringify(v));}catch{}}

// ── API ─────────────────────────────────────────────────────────────────────
async function askClaude(messages, system, {maxTokens=1000,webSearch=false}={}) {
  try{
    if(!isAnthropicConfigured()){
      throw new Error('No Anthropic API key set. Add your own key in the Settings tab.');
    }
    // Remove toolLabel field before sending to API — it's only for tracking which tool generated responses
    const cleanMessages = messages.map(m => {
      const {toolLabel, ...cleaned} = m;
      return cleaned;
    });
    const body={model:'claude-sonnet-4-20250514',max_tokens:maxTokens,system,messages:cleanMessages};
    if(webSearch) body.tools=[{type:'web_search_20250305',name:'web_search'}];

    const headers={'Content-Type':'application/json'};
    // Inside Claude.ai artifacts, calls are proxied+authenticated automatically,
    // hitting Anthropic directly. Standalone, route through this project's own
    // serverless proxy (/api/claude) so each visitor's key stays server-side
    // for that one request rather than being embedded in the deployed site.
    const endpoint = isInClaudeArtifact() ? 'https://api.anthropic.com/v1/messages' : '/api/claude';
    if(!isInClaudeArtifact()){
      headers['x-api-key']=userApiKey;
    }

    // Web search requests take longer — give them more time
    const timeoutMs = webSearch ? 60000 : 30000;
    const controller = new AbortController();
    const timeout = setTimeout(()=>controller.abort(), timeoutMs);
    
    let res;
    try{
      res=await fetch(endpoint,{
        method:'POST',
        headers,
        body:JSON.stringify(body),
        signal: controller.signal,
      });
    }catch(fetchErr){
      clearTimeout(timeout);
      // Network-level errors (DNS, timeout, etc)
      if(fetchErr.name==='AbortError'){
        throw new Error(`Request timed out (${timeoutMs/1000}s) — ${webSearch?'web search is slow or':'Claude is'} unavailable. Try again in a moment.`);
      }
      if(fetchErr.message.includes('network')){
        throw new Error('Network connection error — check your internet and try again.');
      }
      throw new Error(`Network error: ${fetchErr.message}`);
    }
    
    clearTimeout(timeout);
    
    if(!res.ok){
      let errMsg=`HTTP ${res.status}`;
      try{
        const errData=await res.json();
        errMsg=errData?.error?.message || errMsg;
      }catch{
        errMsg=`${res.status} ${res.statusText}`;
      }
      throw new Error(errMsg);
    }
    
    const d=await res.json();
    
    // Check for error response from API
    if(d.error){
      throw new Error(d.error.message || JSON.stringify(d.error));
    }
    
    // Check for content in response
    if(!d.content || !Array.isArray(d.content) || d.content.length===0){
      throw new Error('Empty response from Claude');
    }
    
    const text=(d.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');
    if(!text || text.trim()===''){
      throw new Error('No text in response from Claude');
    }
    return text;
  }catch(e){
    if(e.name==='AbortError'){
      const timeoutMs = webSearch ? 60000 : 30000;
      throw new Error(`Request timed out (${timeoutMs/1000}s) — ${webSearch?'web search is slow or':'Claude is'} unavailable. Try again in a moment.`);
    }
    if(e.message.includes('Failed to fetch')){
      throw new Error('Network error — check your connection and try again.');
    }
    if(e.message.includes('Network error')){
      throw e; // re-throw our own network errors as-is
    }
    if(e.message.includes('fetch')){
      throw new Error(`Network error: ${e.message}`);
    }
    throw new Error(`Claude API error: ${e.message}`);
  }
}

// ── Media analysis for Log photo/video upload (confirmatory — user approves before it fills the form) ──
async function analyzeFishPhoto(base64Data, mediaType){
  const messages=[{role:'user',content:[
    {type:'image',source:{type:'base64',media_type:mediaType,data:base64Data}},
    {type:'text',text:'This is a photo from a Washington State fishing trip. Identify the fish species if one is clearly visible — use these exact names where applicable: Chinook (King), Coho (Silver), Pink (Humpy), Chum (Dog), Sockeye, Steelhead, Sea-run Cutthroat, Trout (Resident), Largemouth Bass, Smallmouth Bass. If you cannot confidently identify a species, use "Unclear". Estimate length in inches ONLY if a size reference is visible (hand, rod, ruler, deck boards) — otherwise say "Not estimable". Respond with ONLY valid JSON, no markdown, no preamble: {"species":"...","sizeEstimateInches":"...","confidence":"high|medium|low","note":"one short honest sentence"}'}
  ]}];
  const raw = await askClaude(messages,'You are a careful fish identification assistant for a Washington State angler. Be honest about uncertainty — say "Unclear" or "Not estimable" rather than guessing confidently from a bad angle or obscured fish.',{maxTokens:300,webSearch:false});
  try{
    return JSON.parse(raw.replace(/```json|```/g,'').trim());
  }catch{
    return null;
  }
}
function extractVideoFrame(file){
  return new Promise((resolve,reject)=>{
    const video=document.createElement('video');
    video.preload='metadata'; video.muted=true; video.playsInline=true;
    const url=URL.createObjectURL(file);
    video.src=url;
    const cleanup=()=>URL.revokeObjectURL(url);
    video.onloadeddata=()=>{ video.currentTime=Math.min(1,(video.duration||2)/2); };
    video.onseeked=()=>{
      try{
        const canvas=document.createElement('canvas');
        canvas.width=video.videoWidth||640; canvas.height=video.videoHeight||480;
        canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
        const dataUrl=canvas.toDataURL('image/jpeg',0.85);
        cleanup(); resolve(dataUrl);
      }catch(e){ cleanup(); reject(e); }
    };
    video.onerror=()=>{ cleanup(); reject(new Error('Could not read that video file.')); };
  });
}
async function geocode(city){
  try{
    const r=await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`);
    if(!r.ok) throw new Error('geocoding service unavailable');
    const d=await r.json();
    const x=d.results?.[0];
    return x?{name:x.name+(x.admin1?', '+x.admin1:''),lat:x.latitude,lng:x.longitude}:null;
  }catch(e){
    throw new Error(`Location lookup failed: ${e.message || 'check your internet'}`);
  }
}
async function fetchWeather(lat,lng){
  try{
    const r=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,wind_speed_10m,wind_direction_10m,weather_code&wind_speed_unit=mph&temperature_unit=fahrenheit&timezone=America%2FLos_Angeles`);
    const d=await r.json();return d.current||null;
  }catch{return null;}
}
async function fetchTides(lat,lng){
  try{
    // Try NOAA first (more detailed predictions)
    const sta=nearestNOAA(lat,lng);
    const t=new Date(),t2=new Date(t.getTime()+86400000);
    const fmt=d=>`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    const r=await fetch(`https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?station=${sta.id}&product=predictions&datum=MLLW&time_zone=lst/ldt&interval=hilo&units=english&application=blackmouth-ai&format=json&begin_date=${fmt(t)}&end_date=${fmt(t2)}`);
    const d=await r.json();
    if(d.predictions && d.predictions.length>0) return{station:sta.name,predictions:d.predictions};
  }catch{}
  
  // Fallback: World Tides API (free tier, covers any location)
  try{
    const r=await fetch(`https://www.worldtides.info/api/v3/predictions?lat=${lat}&lng=${lng}&station=nearest&length=172800&step=3600&format=json`);
    const d=await r.json();
    if(d.heights && d.heights.length>0){
      // Convert World Tides format to match NOAA's simpler format
      const predictions=d.heights.map((h,i)=>({
        t:new Date(d.timestamps[i]*1000).toLocaleString('en-US',{timeZone:'America/Los_Angeles',hour12:false}),
        v:h.toFixed(2)
      }));
      return{station:`${d.station?.name||'Current Location'} (World Tides)`,predictions};
    }
  }catch{}
  
  return null;
}
// fetchDailyIntel removed — redundant automatic AI call duplicating what
// AI Guide already does on-demand. Weather/tides remain in doRefresh below.

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
// ToolCard removed — was only used by the three separate planning tools,
// now merged into one TripPlannerTool below.

// ══════════════════════════════════════════════════════════════════════════════
function BlackmouthApp({syncStatus,onSignOut}){
  const [dark,setDark]         = useState(true);
  const [tab,setTab]           = useState(0);
  const [outings,setOutings]   = useState([]);
  const [gear,setGear]         = useState([]);
  const [configs,setConfigs]   = useState([]); // rod+reel pairings
  const [boats,setBoats]       = useState([]);
  const [lineups,setLineups]   = useState([]); // starting lineups (species/technique/water/boat contexts)
  const [chat,setChat]         = useState([]);
  const [favWaters,setFW]      = useState([]);
  const [homePort,setHP]       = useState(null);
  const [dailyData,setDD]      = useState(null);
  const [refreshing,setRef]    = useState(false);
  const [waterDetail,setWD]    = useState(null);
  const [aiPreFill,setAPF]     = useState('');
  const [loaded,setLoaded]     = useState(false);
  const [printJob,setPrintJob] = useState(null);
  const [hasApiKey,setHasApiKey] = useState(isInClaudeArtifact());
  const T = dark ? DARK : LIGHT;

  useEffect(()=>{
    loadUserApiKey().then(k=>setHasApiKey(isInClaudeArtifact()||!!k));
  },[]);
  const saveApiKey = key => { setUserApiKey(key); setHasApiKey(isInClaudeArtifact()||!!key); };

  useEffect(()=>{
    (async()=>{
      const o=await load('outings'); if(o) setOutings(o);
      const g=await load('gear');    if(g) setGear(g);
      const cf=await load('configs'); if(cf) setConfigs(cf);
      const bt=await load('boats');   if(bt) setBoats(bt);
      const ln=await load('lineups'); if(ln) setLineups(ln);
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
  const saveConfigs = v=>{setConfigs(v);save('configs',v);};
  const saveBoats   = v=>{setBoats(v);save('boats',v);};
  const saveLineups = v=>{setLineups(v);save('lineups',v);};
  const saveChat    = v=>{setChat(v);save('chat',v);};
  const saveFW      = v=>{setFW(v);save('fw',v);};
  const toggleDark  = ()=>{const n=!dark;setDark(n);save('dark',n);};

  const handleSetHP = async portData=>{
    setHP(portData); save('hp',portData);
    doRefresh(portData,favWaters);
  };

  if(!loaded) return(
    <div style={{background:DARK.bg,height:'100vh',display:'flex',alignItems:'center',justifyContent:'center',color:DARK.sub,fontFamily:F,fontSize:15}}>Loading Blackmouth…</div>
  );

  if(waterDetail) return(
    <div style={{fontFamily:F,background:T.bg,minHeight:'100vh',color:T.text}}>
      <WaterDetailPage water={waterDetail} onBack={()=>setWD(null)} T={T}/>
    </div>
  );

  return(
    <div style={{fontFamily:F,background:T.bg,minHeight:'100vh',color:T.text}}>
      <style>{`@media print { .blackmouth-shell { display: none !important; } }`}</style>
      <div className="blackmouth-shell">
      {/* Header */}
      <div style={{background:T.surface,borderBottom:`1px solid ${T.border}`,position:'sticky',top:0,zIndex:10}}>
        <div style={{maxWidth:820,margin:'0 auto',padding:'12px 16px 0'}}>
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12}}>
            <BrandMark T={T} size={34}/>
            <div style={{flex:1}}>
              <div style={{fontSize:17,fontWeight:'700',color:T.text,letterSpacing:-.2,fontFamily:F}}>Blackmouth<span style={{color:T.hot}}>.AI</span></div>
              <div style={{fontSize:10,color:T.sub,letterSpacing:1,fontFamily:F,textTransform:'uppercase'}}>{monthName()} {thisYear()} · {currentSeason()}{homePort?` · ${homePort.name}`:''}</div>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:6}}>
              {syncStatus==='synced'&&<span title="Synced to your account" style={{fontSize:10,color:T.accent,fontFamily:F}}>☁ Synced</span>}
              {syncStatus==='local'&&<span title="Saved to this Claude account only" style={{fontSize:10,color:T.sub,fontFamily:F}}>📱 Local only</span>}
              {hasApiKey
                ? <span title="AI Guide is connected and ready" style={{fontSize:10,color:T.accent,fontFamily:F}}>🤖 AI Ready</span>
                : <span onClick={()=>setTab(7)} title="No Anthropic API key set — tap to add yours in Settings" style={{fontSize:10,color:T.err,fontFamily:F,cursor:'pointer',textDecoration:'underline'}}>⚠ No AI Key</span>
              }
              <button onClick={toggleDark} style={{...btnOf(T,'ghost'),padding:'5px 11px',fontSize:12}}>{dark?'☀️ Light':'🌑 Dark'}</button>
              {syncStatus==='synced'&&onSignOut&&<button onClick={onSignOut} style={{...btnOf(T,'ghost'),padding:'5px 9px',fontSize:11}}>Sign out</button>}
            </div>
          </div>
          <div style={{display:'flex',overflowX:'auto',gap:2,scrollbarWidth:'none'}}>
            {TABS.map((t,i)=>(
              (t==='Settings'&&isInClaudeArtifact()) ? null :
              <button key={t} onClick={()=>setTab(i)} style={{padding:'7px 13px',borderRadius:'8px 8px 0 0',border:'none',cursor:'pointer',fontSize:12,fontWeight:tab===i?'600':'400',fontFamily:F,whiteSpace:'nowrap',flexShrink:0,background:'transparent',color:tab===i?T.text:T.sub,borderBottom:tab===i?`2px solid ${T.hot}`:'2px solid transparent',transition:'all .12s'}}>{t}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{maxWidth:820,margin:'0 auto',padding:'20px 16px 80px'}}>
        {tab===0&&<AIGuideTab outings={outings} gear={gear} configs={configs} boats={boats} lineups={lineups} favWaters={favWaters} chat={chat} onSaveChat={saveChat} preFill={aiPreFill} onClearPreFill={()=>setAPF('')} onPrint={(title,body)=>setPrintJob({title,body})} T={T}/>}
        {tab===1&&<DashboardTab outings={outings} favWaters={favWaters} homePort={homePort} dailyData={dailyData} onSetHP={handleSetHP} onWaterClick={setWD} onTabChange={setTab} T={T}/>}
        {tab===2&&<MyWatersTab favWaters={favWaters} onSave={saveFW} onWaterClick={setWD} T={T}/>}
        {tab===3&&<LogOuting outings={outings} gear={gear} onSave={saveOutings} onViewHistory={()=>setTab(6)} T={T}/>}
        {tab===4&&<GearManager gear={gear} onSave={saveGear} configs={configs} onSaveConfigs={saveConfigs} boats={boats} onSaveBoats={saveBoats} lineups={lineups} onSaveLineups={saveLineups} favWaters={favWaters} T={T}/>}
        {tab===5&&<RegsAlerts T={T}/>}
        {tab===6&&<History outings={outings} onSave={saveOutings} T={T}/>}
        {tab===7&&<SettingsTab hasApiKey={hasApiKey} onSaveKey={saveApiKey} T={T}/>}
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
      <div style={{fontSize:11,letterSpacing:2,textTransform:'uppercase',color:'#A9762A',marginBottom:6}}>Blackmouth.AI</div>
      <h1 style={{fontSize:22,margin:'0 0 4px',borderBottom:'2px solid #A9762A',paddingBottom:10}}>{data.title}</h1>
      <div style={{fontSize:12,color:'#667',marginBottom:24}}>{new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})}</div>
      <div style={{whiteSpace:'pre-wrap',fontSize:14,lineHeight:1.75}}>{data.body}</div>
      <div style={{marginTop:36,fontSize:11,color:'#889',borderTop:'1px solid #ddd',paddingTop:12}}>
        Generated by Blackmouth.AI. Always verify current regulations at wdfw.wa.gov/fishing/rules or 1-800-902-2474.
      </div>
    </div>
  );
}

// ── Home Tab ────────────────────────────────────────────────────────────────
// Lightweight tide curve — no charting library needed, just an SVG path
// interpolated through the day's high/low points via a Catmull-Rom-ish curve.
function TideCurve({tides,T}){
  if(!tides||tides.length<2) return null;
  const W=280,H=56,PAD=8;
  const toMinutes=t=>{ const m=t.match(/(\d+):(\d+)\s*(AM|PM)?/i); if(!m) return null; let h=parseInt(m[1]),mi=parseInt(m[2]); if(m[3]){ if(/PM/i.test(m[3])&&h!==12) h+=12; if(/AM/i.test(m[3])&&h===12) h=0; } return h*60+mi; };
  const pts=tides.map(p=>({x:toMinutes(p.t.split(' ')[1]||p.t), y:parseFloat(p.v)})).filter(p=>p.x!=null);
  if(pts.length<2) return null;
  const minY=Math.min(...pts.map(p=>p.y)), maxY=Math.max(...pts.map(p=>p.y));
  const range=maxY-minY||1;
  const sx=x=>PAD+(x/1440)*(W-PAD*2);
  const sy=y=>H-PAD-((y-minY)/range)*(H-PAD*2);
  const d=pts.map((p,i)=>`${i===0?'M':'L'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
  const now=new Date(); const nowMin=now.getHours()*60+now.getMinutes();
  return(
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} style={{marginBottom:8,display:'block'}}>
      <path d={d} fill="none" stroke={T.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      {pts.map((p,i)=>(<circle key={i} cx={sx(p.x)} cy={sy(p.y)} r="2.5" fill={T.accent}/>))}
      {nowMin>=0&&nowMin<=1440&&<line x1={sx(nowMin)} y1={PAD-2} x2={sx(nowMin)} y2={H-PAD+2} stroke={T.hot} strokeWidth="1.5" strokeDasharray="3,3"/>}
    </svg>
  );
}

function DashboardTab({outings,favWaters,homePort,dailyData,onSetHP,onWaterClick,onTabChange,T}){
  const [portInput,setPI] = useState('');
  const [geocoding,setGeo] = useState(false);
  const [portError,setPErr] = useState('');
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
        <div style={{...cardOf(T),display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,padding:'12px 16px'}}>
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
              <TideCurve tides={todayTides} T={T}/>
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

      {/* Current Forage */}
      <div style={{...cardOf(T),borderLeft:`3px solid ${T.accent}`}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline'}}>
          <SectionHead T={T}>Current Forage</SectionHead>
          <span style={{fontSize:10,color:T.dim,fontFamily:F}}>{monthName()}</span>
        </div>
        <div style={{fontSize:14,color:T.text,fontWeight:'600',fontFamily:F,marginBottom:4}}>{FORAGE_CALENDAR[new Date().getMonth()].forage}</div>
        <div style={{fontSize:12,color:T.sub,fontFamily:F,marginBottom:8,lineHeight:1.5}}>{FORAGE_CALENDAR[new Date().getMonth()].detail}</div>
        <div style={{fontSize:12,color:T.accent,fontFamily:F,fontStyle:'italic'}}>💡 {FORAGE_CALENDAR[new Date().getMonth()].tip}</div>
        <div style={{fontSize:10,color:T.dim,marginTop:8,fontFamily:F}}>Approximate — varies year to year. Ask the AI Guide for what's locally relevant.</div>
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
    </div>
  );
}

// ── AI Guide Tab ────────────────────────────────────────────────────────────
function AIGuideTab({outings,gear,configs,boats,lineups,favWaters,chat,onSaveChat,preFill,onClearPreFill,onPrint,T}){
  const [input,setInput]     = useState('');
  const [loading,setLoading] = useState(false);
  const chatBoxRef           = useRef(null);

  useEffect(()=>{
    // Scroll only the chat box itself — never the page. scrollIntoView() was
    // scrolling every scrollable ancestor including the whole document, which
    // is what caused the jolt-to-bottom-then-back-up behavior.
    if(chatBoxRef.current) chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
  },[chat,loading]);

  useEffect(()=>{
    if(preFill){setInput(preFill);onClearPreFill();}
  },[preFill]); // eslint-disable-line

  const buildSystem = ()=>
    `You are an expert salmon fishing guide for western Washington, Puget Sound, and the Salish Sea, with deep knowledge of mooching and trolling techniques. You have comprehensive familiarity with expertise from Salmon University (Tom Nelson), Buzz Ramsey, John Martinis, Bill Herzog, and WDFW guidance. You understand:

MOOCHING: Cut-plug herring rigs, double-bevel cuts, the "jig dance" (tight, fast spin), proper hook placement (upper hook through gut cavity/gills), banana sinkers 2-6oz, mono leaders 20-30lb, depth cycles (gear/neutral rhythm), line counting ("pulls"), strike timing based on motor state. You know mooching's origin in Seattle and why die-hards prefer its feel and finesse over trolling.

TROLLING: Downrigger setup, motor mooching hybrids, diver trolling, trolling speed (1-2 mph for Chinook, faster for Coho), flasher/bait combos (Gibbs Race Racer standard), spoon selection (Little Cleo for trophy males), line stagger, current direction, thermocline hunting.

SEASONAL PATTERNS: Blackmouth Dec-Apr, spring Chinook May-June (deep, cool water), summer Coho June-Aug, fall Chinook Sept-Oct. You know spring tides push more fish than neap, that peak fishing is one hour before-to-after tide change, that sounder density and thermoclines reveal fish location.

KEY LOCATIONS IN PUGET SOUND: Shilshole Bay, Mukilteo, Richmond Beach (massive pink runs Aug), Ballard Bridge, mid-channel deep structure, Admiralty Inlet spring/fall Chinook, Haro Strait (San Juans), Hood Canal. You know tide rips, kelp beds, drop-offs, rocky structure as fish magnets.

EXPERT VOICES: You reference specific advice — Tom Nelson on herring brine/sharpness/scale integrity, Buzz Ramsey on flasher colors (chartreuse/cloudy, chrome/sunny), John Martinis on location specificity, gear choices from proven sources.

FISHFINDER EXPERTISE: The user runs a Garmin ECHOMAP UHD 73sv (UHD ClearVü 800kHz down to 200ft, UHD SideVü 1200kHz/455kHz CHIRP out to 125ft each side, traditional CHIRP 150-240kHz high-wide plus 50/77/83/200kHz, LiveScope-compatible, LakeVü g3 inland charts) and a Simrad GO9 XSE (CHIRP Active Imaging 3-in-1 transducer — Med/High 455/800kHz CHIRP, SideScan, DownScan; or basic 83/200kHz skimmer depending on bundle; C-MAP Discover charts; HALO radar-ready). You give settings advice specific to these when relevant. General sonar principles you apply: lower frequency (50-83kHz) = wider beam, deeper penetration — best for deep saltwater Chinook trolling in 100-300+ft. Higher frequency (200-800kHz+/UHD/CHIRP high) = narrower beam, sharper detail, less depth — best for shallow lakes, bass, trout, structure ID. SideScan/SideVü excels at searching wide shallow flats and lake structure; less useful in deep open-water salmon trolling. DownScan/ClearVü is best for distinguishing suspended baitfish balls from individual salmon. Live/forward-looking sonar (LiveScope, ActiveTarget, MEGA Live) is increasingly used for salmon mooching/jigging to watch the lure work near a marked fish in real time, not just bass. You're also familiar with the competitive landscape — Lowrance (HDS Live/Pro flagship with ActiveTarget, Elite Ti2 midrange, Hook2 budget), Humminbird (SOLIX flagship with MEGA Imaging+/MEGA 360/MEGA Live, HELIX midrange — excellent shallow-water clarity, less depth penetration, popular for bass), Raymarine (Axiom/Axiom+ with RealVision 3D and DownVision/SideVision, Dragonfly compact/affordable for kayak and small boats) — so you can speak to any brand the user or a friend asks about, not just their own units.

FORAGE BASE EXPERTISE (Salish Sea baitfish/squid/krill — use this to inform lure size, color, and scent, not just spot/timing advice): Herring spawn Jan-Apr (peak Feb), resident stocks stay inside year-round, migratory stocks (e.g. Cherry Point) leave and grow bigger; WDFW's bait fishery targets 1.5-year-olds as the angler-preferred size. Sand lance/candlefish spawn Nov-Feb then bury in sand until active as forage ~late April-early Nov; they're 35-75% of juvenile Chinook/coho diet in Puget Sound studies and concentrate at Possession Bar, Point No Point, Mid-Channel Bank, and eastern Strait of Juan de Fuca banks — fish bait/lures close to bottom over sand/gravel there. Surf smelt spawn timing is beach-specific (summer May-Aug, fall-winter Sept-Mar, or year-round depending on site). Northern anchovy were essentially absent before 2015, surged since, and thrive in warm water — expect more anchovy in warm years/areas (especially South Sound), less in cool ones; harbor seal data shows anchovy peak in spring. Market squid migrate through the season: Neah Bay (late May) -> Port Angeles (Jun-Aug) -> Elliott Bay/Seattle (Oct-Nov) -> Des Moines/Commencement Bay (late Nov-Dec) -> dispersed South Sound, peaking Dec-Jan; squid are real winter/early-spring Chinook forage, not just a pier-jigging curiosity, and may explain why purple/UV lures work well in that window. Coho eat far more krill/amphipods/crustacean larvae than Chinook do across every Salish Sea region studied; in the Strait of Juan de Fuca/San Juans that's krill+crustacean-larvae-dominant, in the Strait of Georgia it's amphipod-dominant. Regional summer Chinook diet differs sharply: Strait of Georgia is herring-dominant, Howe Sound splits herring/anchovy evenly, Haro Strait splits herring/sand lance evenly, Juan de Fuca runs ~70% herring. Practical translation: match lure SIZE to season (2-3in profiles when winter/early-spring bait is small, 3.5-4.25in standard in summer), match COLOR to the locally dominant forage (green/blue splatterback for candlefish, chrome/herring-pattern for herring, thicker-profile anchovy imitations, purple/UV for squid season), and default to herring SCENT unless fishing rocky structure where shrimp/krill scent outperforms. Don't force this into every answer — bring it up when it actually helps the size/color/scent question being asked.

DIET CHANGE OVER TIME (the deeper story — know this for context-aware answers): An 80-year Chinook stomach-content comparison (Greentree et al. 2026, Fisheries Oceanography, published May 2026) comparing 2017-2022 modern data against studies from 1939-1941, 1957, and 1967-1968 reveals the forage base has shifted repeatedly and dramatically. Pacific sardines were significant Chinook prey in 1940-1941, were gone by the 1950s, and remain absent today — their population collapsed from ~1.8M metric tons in 2006 to ~28,000 metric tons currently. Anchovy were essentially absent from BC salmon diets before 2014; they now show up as important prey near Howe Sound for the first time in any recorded diet study. The anchovy surge was triggered by "The Blob" — the 2013-2016 northeast Pacific marine heatwave that warmed water 2-7°F above normal, simultaneously crashed cold-water forage species (herring, sand lance, capelin hit historic lows), and created warm-water conditions anchovy thrive in. The longer climate driver is the PDO (Pacific Decadal Oscillation), a ~60-year cycle: warm PDO phases favor sardines, cool PDO phases favor anchovy — the Wikipedia article on PDO explicitly notes that the 1997-1998 shift back to a cool phase brought "substantial changes in anchovy and sardine populations." We're now in a warming trend that has pushed anchovy into unprecedented dominance. CRITICAL CONSEQUENCE: A 2025 PNAS study (Mantua et al.) documented that anchovy-dominated diets are causing thiamine (Vitamin B1) deficiency in salmon because anchovy carry thiaminase — an enzyme that actively destroys B1 in the gut of whatever eats them. This killed an estimated 26-48% of endangered Sacramento winter-run Chinook fry in 2020-2021. Washington State's own State of Salmon website now states that Chinook eating "more anchovies rather than a balanced mix of animals... appears to cause premature death and illness." The same anchovy surge is happening in Puget Sound. When a user asks why return years have been disappointing despite "okay" ocean conditions, this is worth mentioning. The practical angling implication: a diverse spread that doesn't exclusively imitate anchovy may better match what healthy, actively feeding salmon are eating — and fish tuned to diverse prey may be more strike-prone than fish gorging on a single item.

GEAR-AWARE RECOMMENDATIONS: The user catalogs rods, reels, lures, boats, and "starting lineups" (named rod+reel+tackle setups for a species/technique/water, fantasy-roster style). When relevant, reason over this data: if a logged rod/reel is heavier than the season calls for (e.g. a heavy Chinook stick set as the starter for small summer Coho), say so and suggest a lighter logged alternative if one exists in their gear. If both Chinook and Coho seasons are open at once, suggest a middle-ground rod/reel if one is logged. If line on a reel hasn't been replaced in a long time relative to how much it's used, flag it. If a boat is logged with "no ramp needed" or "electric-only" attributes, proactively mention it when the user asks about waters that match those constraints. Don't force this in — only bring it up when it's actually relevant to what's being asked.
My Lineups: ${lineups.length?JSON.stringify(lineups.map(l=>({name:l.name,boatId:l.boatId,configIds:l.configIds}))):'none set up yet'}
My Rod+Reel Configs: ${configs.length?JSON.stringify(configs):'none set up yet'}
My Boats: ${boats.length?JSON.stringify(boats):'none logged'}

The user is 35 with 15+ years serious salmon experience. Primary: salmon (saltwater), trout (freshwater). Skip basics unless asked.

Season: ${currentSeason()}. Month: ${monthName()} ${thisYear()}.
Favorite waters: ${favWaters.map(w=>w.name).join(', ')||'none listed'}.
Outings (${outings.length} logged): ${JSON.stringify(outings.slice(0,12))}
Gear: ${JSON.stringify(gear.slice(0,8))}

CRITICAL: Keep responses SHORT and DIRECT. 1-2 sentences max for answers. Bullet points, tables, or brief lists only when clarity demands it. No fluff or explanations unless asked.

If user wants more detail, they'll ask "tell me more" or "explain X" — then expand. But default to brevity. Expert to expert.

Be specific: use WDFW marine area numbers, name specific spots, flag mark-selective/hatchery/size rules. Use web search for current WDFW regulations, creel data, and conditions. Verify: wdfw.wa.gov.`;

  const send = async(msg,toolLabel)=>{
    const text=(msg||input).trim();
    if(!text||loading) return;
    const userMsg={role:'user',content:text,toolLabel};
    const newH=[...chat,userMsg];
    onSaveChat(newH);
    setInput('');setLoading(true);
    try{
      const reply=await askClaude(newH,buildSystem(),{maxTokens:1000,webSearch:true});
      onSaveChat([...newH,{role:'assistant',content:reply,toolLabel}]);
    }catch(e){
      const errorMsg = e.message || 'Connection error — check your network and try again.';
      onSaveChat([...newH,{role:'assistant',content:`Error: ${errorMsg}`,toolLabel}]);
    }
    setLoading(false);
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

      {/* Ask your guide — primary entry point for this page */}
      <div style={{...cardOf(T),background:`linear-gradient(135deg,${T.hot}14,${T.accent}0a)`,border:`1px solid ${T.hot}44`}}>
        <div style={{fontSize:13,color:T.sub,marginBottom:10,fontFamily:F}}>Ask your guide anything — spots, regulations, conditions, gear, what to do next.</div>
        <div style={{display:'flex',gap:8}}>
          <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}}} placeholder="What should I fish for right now?" autoFocus style={{...inpOf(T),flex:1,fontSize:15,padding:'12px 14px'}} disabled={loading}/>
          <button onClick={()=>send()} disabled={loading||!input.trim()} style={{...btnOf(T),paddingLeft:24,paddingRight:24,fontSize:15,opacity:loading||!input.trim()?0.5:1}}>Ask</button>
        </div>
      </div>

      {/* Chat */}
      <div ref={chatBoxRef} style={{...cardOf(T),padding:12,minHeight:220,maxHeight:440,overflowY:'auto',display:'flex',flexDirection:'column',gap:10}}>
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
      </div>
      {chat.length>0&&<button onClick={()=>onSaveChat([])} style={{background:'none',border:'none',color:T.sub,fontSize:12,cursor:'pointer',textAlign:'left',fontFamily:F}}>Clear chat</button>}

      {/* Trip Planner */}
      <div style={cardOf(T)}>
        <SectionHead T={T}>Trip Planner</SectionHead>
        <TripPlannerTool T={T} favWaters={favWaters} gear={gear} chat={chat} onSend={(p)=>send(p,'Trip Planner')}/>
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

function TripPlannerTool({T,favWaters,gear,chat,onSend}){
  const nextSat=(()=>{const d=new Date();const n=(6-d.getDay()+7)%7||7;const s=new Date(d.getTime()+n*86400000);return`${s.getFullYear()}-${String(s.getMonth()+1).padStart(2,'0')}-${String(s.getDate()).padStart(2,'0')}`;})();
  const [date,setDate]=useState(nextSat);
  const [loc,setLoc]=useState(favWaters[0]?.name||'');
  const [species,setSpecies]=useState('Coho (Silver)');
  const [technique,setTech]=useState('Trolling');
  const [archiveOpen,setArchiveOpen]=useState(false);
  const [search,setSearch]=useState('');
  const [expandedIdx,setExpandedIdx]=useState(null);

  const run=()=>onSend(`Full trip plan for:
- Date: ${date}
- Location: ${loc||'Puget Sound, WA'}
- Target: ${species}
- Technique: ${technique}

Search for current conditions and give me ONE concise, scannable trip plan covering:
1. Weather + complete tide schedule (all high/low times and heights) for that date/location
2. Best bite windows based on those tides for ${technique.toLowerCase()} — rate each ★★★/★★/★
3. Rigging, lure color, and depth for ${currentSeason()} ${species}
4. Specific starting spot(s)
5. Current regulations or closures to know before heading out
6. A short gear checklist — only items specific to this trip, not generic basics${gear.length?` (cross-check against my gear: ${gear.slice(0,8).map(g=>g.name).join(', ')})`:''}

I'm an experienced angler — skip basics, stay tight and scannable. This is one trip, one plan — don't pad it out.`);

  // Archive: pair up user/assistant messages tagged 'Trip Planner' from chat history
  const archive = (()=>{
    const items=[];
    for(let i=0;i<chat.length-1;i++){
      if(chat[i].role==='user'&&chat[i].toolLabel==='Trip Planner'&&chat[i+1]?.role==='assistant'){
        items.push({prompt:chat[i].content,reply:chat[i+1].content,idx:i});
      }
    }
    return items.reverse(); // most recent first
  })();
  const filtered = search.trim()
    ? archive.filter(a=>(a.prompt+a.reply).toLowerCase().includes(search.toLowerCase()))
    : archive;

  const summarize=(prompt)=>{
    const dateM=prompt.match(/Date:\s*([^\n]+)/);
    const locM=prompt.match(/Location:\s*([^\n]+)/);
    const targetM=prompt.match(/Target:\s*([^\n]+)/);
    return [dateM?.[1],locM?.[1],targetM?.[1]].filter(Boolean).join(' · ')||'Trip plan';
  };

  return(
    <div style={{display:'flex',flexDirection:'column',gap:10}}>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        <Field label="Date" T={T}><input type="date" value={date} onChange={e=>setDate(e.target.value)} style={inpOf(T)}/></Field>
        <Field label="Location" T={T}><input placeholder={favWaters[0]?.name||'MA 10, Skykomish R…'} value={loc} onChange={e=>setLoc(e.target.value)} style={inpOf(T)}/></Field>
      </div>
      <Field label="Target Species" T={T}>
        <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
          {['Chinook (King)','Coho (Silver)','Steelhead','Sea-run Cutthroat','Trout (Resident)'].map(s=>(
            <Chip key={s} label={s} active={species===s} T={T} color={T.hot} onClick={()=>setSpecies(s)}/>
          ))}
        </div>
      </Field>
      <Field label="Technique" T={T}>
        <div style={{display:'flex',gap:8}}>
          {['Trolling','Mooching'].map(t=><Chip key={t} label={t} active={technique===t} T={T} color={T.accent} onClick={()=>setTech(t)}/>)}
        </div>
      </Field>
      <button onClick={run} style={{...btnOf(T),width:'100%'}}>Generate Trip Plan</button>

      {archive.length>0&&(
        <div style={{marginTop:4}}>
          <button onClick={()=>setArchiveOpen(!archiveOpen)} style={{background:'none',border:'none',color:T.sub,fontSize:12,cursor:'pointer',fontFamily:F,padding:0,textAlign:'left'}}>
            {archiveOpen?'▾':'▸'} Past trip plans ({archive.length})
          </button>
          {archiveOpen&&(
            <div style={{marginTop:8,display:'flex',flexDirection:'column',gap:6}}>
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search past plans (location, species, date…)" style={{...inpOf(T),fontSize:13}}/>
              {filtered.length===0&&<div style={{fontSize:12,color:T.sub,fontFamily:F,fontStyle:'italic',padding:'6px 0'}}>No matches.</div>}
              {filtered.map(a=>(
                <div key={a.idx} style={{border:`1px solid ${T.border}`,borderRadius:8,overflow:'hidden'}}>
                  <button onClick={()=>setExpandedIdx(expandedIdx===a.idx?null:a.idx)} style={{width:'100%',textAlign:'left',background:T.muted,border:'none',padding:'8px 10px',cursor:'pointer',fontSize:12,color:T.text,fontFamily:F}}>
                    {summarize(a.prompt)}
                  </button>
                  {expandedIdx===a.idx&&(
                    <div style={{padding:'10px 12px',fontSize:13,color:T.text,lineHeight:1.6,whiteSpace:'pre-wrap',fontFamily:F,background:T.bg}}>
                      {a.reply}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── My Waters Tab ───────────────────────────────────────────────────────────
function MyWatersTab({favWaters,onSave,onWaterClick,T}){
  const [name,setName]=useState('');
  const [typeOvr,setTO]=useState('');
  const [notes,setNotes]=useState('');
  const [adding,setAdding]=useState(false);
  const [dragIdx,setDragIdx]=useState(null);
  // If the user typed an explicit freshwater qualifier ("river", "creek",
  // "lake", etc), that always wins over any marine-area alias overlap — many
  // WA rivers share a name with the bay they empty into (see AMBIGUOUS_RIVER_MARINE_NAMES).
  const hasFreshwaterWord = /\b(river|creek|stream|fork|brook|lake|lk|reservoir|pond)\b/i.test(name);
  const inferred = typeOvr || inferWaterType(name);
  const maMatch = hasFreshwaterWord ? null : matchMarineArea(name);
  const ambiguousName = !hasFreshwaterWord && isAmbiguousWaterName(name);

  const moveWater=(from,to)=>{
    if(to<0||to>=favWaters.length||from===to) return;
    const next=[...favWaters];
    const [item]=next.splice(from,1);
    next.splice(to,0,item);
    onSave(next);
  };

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
Use status values: "open","closed","limited","unknown". Only include relevant species for this water. Max 4 species. Month: ${monthName()} ${thisYear()}.${ambiguousName?` NOTE: this river shares its name with a nearby saltwater shoreline/bay area — make sure you're reporting freshwater river regulations, not the marine area's. If this river has different rules in its tidal/mouth section vs. its upper reaches, prioritize whichever section is more commonly fished, and mention the split exists.`:''}`;
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
            {ambiguousName&&<div style={{fontSize:11,color:T.hot,marginTop:6,fontFamily:F,lineHeight:1.5}}>⚠ This name is shared by both a river and a Marine Area shoreline spot. Saved as the river/freshwater body — add "River" to the name if that's not what you meant, or type the Marine Area number instead (e.g. "MA 12") if you meant the saltwater side. Regs often differ between the tidal mouth and the upper river.</div>}
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

      {favWaters.map((w,idx)=>(
        <div key={w.id}
          draggable
          onDragStart={()=>setDragIdx(idx)}
          onDragOver={e=>e.preventDefault()}
          onDrop={e=>{e.preventDefault(); if(dragIdx!==null) moveWater(dragIdx,idx); setDragIdx(null);}}
          onDragEnd={()=>setDragIdx(null)}
          style={{...cardOf(T),opacity:dragIdx===idx?0.5:1,cursor:'grab'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:10}}>
            <div style={{display:'flex',flexDirection:'column',gap:2,flexShrink:0,marginTop:1}}>
              <button onClick={()=>moveWater(idx,idx-1)} disabled={idx===0} style={{...btnOf(T,'ghost'),padding:'1px 7px',fontSize:10,opacity:idx===0?0.3:1,cursor:idx===0?'default':'pointer'}}>▲</button>
              <button onClick={()=>moveWater(idx,idx+1)} disabled={idx===favWaters.length-1} style={{...btnOf(T,'ghost'),padding:'1px 7px',fontSize:10,opacity:idx===favWaters.length-1?0.3:1,cursor:idx===favWaters.length-1?'default':'pointer'}}>▼</button>
            </div>
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
function LogOuting({outings,gear,onSave,onViewHistory,T}){
  const blank={date:new Date().toISOString().slice(0,10),location:'',waterType:'',speciesTargeted:[],speciesCaught:[],technique:'',gearUsed:'',conditions:'',tide:'',catchCount:0,kept:0,released:0,notes:''};
  const [form,setForm]=useState(blank);
  const [saved,setSaved]=useState(null);
  const [error,setError]=useState('');
  const [mediaPreview,setMediaPreview]=useState(null); // data URL shown to user, never persisted
  const [mediaError,setMediaError]=useState('');
  const [analyzing,setAnalyzing]=useState(false);
  const [aiSuggestion,setAiSuggestion]=useState(null);

  const handleMediaUpload=async(e)=>{
    const file=e.target.files?.[0];
    e.target.value=''; // allow re-selecting the same file later
    if(!file) return;
    setMediaError(''); setAiSuggestion(null);
    const isImage=file.type.startsWith('image/');
    const isVideo=file.type.startsWith('video/');
    if(!isImage&&!isVideo){
      setMediaError('Only photos and videos are supported.');
      return;
    }
    setAnalyzing(true);
    try{
      let dataUrl, base64, mediaType;
      if(isImage){
        dataUrl = await new Promise((res,rej)=>{
          const r=new FileReader();
          r.onload=()=>res(r.result);
          r.onerror=()=>rej(new Error('Could not read that image.'));
          r.readAsDataURL(file);
        });
        mediaType = file.type;
      }else{
        dataUrl = await extractVideoFrame(file); // grabs one frame to analyze; video itself isn't stored
        mediaType = 'image/jpeg';
      }
      setMediaPreview(dataUrl);
      base64 = dataUrl.split(',')[1];
      const suggestion = await analyzeFishPhoto(base64, mediaType);
      if(suggestion) setAiSuggestion(suggestion);
      else setMediaError("Couldn't analyze that media — you can still fill in the catch manually.");
    }catch(err){
      setMediaError(err.message || 'Something went wrong analyzing that file.');
    }
    setAnalyzing(false);
  };

  const acceptSuggestion=()=>{
    if(!aiSuggestion) return;
    setForm(prev=>{
      const sp=aiSuggestion.species;
      const validSpecies = SPECIES.includes(sp);
      const caught = validSpecies && !prev.speciesCaught.includes(sp) ? [...prev.speciesCaught,sp] : prev.speciesCaught;
      const sizeNote = aiSuggestion.sizeEstimateInches && aiSuggestion.sizeEstimateInches!=='Not estimable'
        ? `AI-estimated size: ~${aiSuggestion.sizeEstimateInches} in (${aiSuggestion.confidence} confidence).`
        : '';
      const notes = [prev.notes, sizeNote].filter(Boolean).join(' ');
      return {...prev, speciesCaught:caught, notes};
    });
    setAiSuggestion(null);
  };
  const dismissSuggestion=()=>setAiSuggestion(null);
  const clearMedia=()=>{ setMediaPreview(null); setAiSuggestion(null); setMediaError(''); };

  const set=(k,v)=>setForm(prev=>{
    if(saved) setSaved(null);
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
    // Never silently lose an AI photo suggestion the user uploaded but didn't
    // explicitly accept or dismiss — fold it into notes, clearly labeled as
    // unconfirmed, rather than letting it vanish when the form resets.
    let finalForm = form;
    if(aiSuggestion){
      const unconfirmedNote = `📷 AI photo suggestion (not confirmed): ${aiSuggestion.species}${aiSuggestion.sizeEstimateInches&&aiSuggestion.sizeEstimateInches!=='Not estimable'?`, ~${aiSuggestion.sizeEstimateInches} in`:''} (${aiSuggestion.confidence} confidence).`;
      finalForm = {...form, notes:[form.notes, unconfirmedNote].filter(Boolean).join(' ')};
    }
    const saved = {...finalForm,id:Date.now()};
    onSave([saved,...outings]);
    setForm(blank);setSaved(saved);setTimeout(()=>setSaved(null),8000);
    clearMedia();
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
        <Field label="Photo / Video (optional)" span2 T={T}>
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            <div style={{display:'flex',gap:10,alignItems:'center'}}>
              <label style={{...btnOf(T,'ghost'),cursor:'pointer',display:'inline-block'}}>
                📷 Upload Photo or Video
                <input type="file" accept="image/*,video/*" onChange={handleMediaUpload} style={{display:'none'}}/>
              </label>
              {mediaPreview&&<button onClick={clearMedia} style={{...btnOf(T,'ghost'),padding:'4px 10px',fontSize:11,color:T.err,borderColor:`${T.err}44`}}>Remove</button>}
            </div>
            {mediaError&&<div style={{fontSize:12,color:T.err,fontFamily:F}}>{mediaError}</div>}
            {analyzing&&<div style={{fontSize:12,color:T.sub,fontFamily:F,fontStyle:'italic'}}>Analyzing photo…</div>}
            {mediaPreview&&(
              <img src={mediaPreview} alt="Catch preview" style={{maxWidth:180,maxHeight:180,borderRadius:10,border:`1px solid ${T.border}`,objectFit:'cover'}}/>
            )}
            {aiSuggestion&&(
              <div style={{...cardOf(T),background:T.muted,padding:12}}>
                <div style={{fontSize:12,color:T.text,fontFamily:F,lineHeight:1.6}}>
                  <strong>AI guess:</strong> {aiSuggestion.species}
                  {aiSuggestion.sizeEstimateInches&&aiSuggestion.sizeEstimateInches!=='Not estimable'&&<> · ~{aiSuggestion.sizeEstimateInches} in</>}
                  {' '}<span style={{color:T.sub}}>({aiSuggestion.confidence} confidence)</span>
                </div>
                {aiSuggestion.note&&<div style={{fontSize:11,color:T.sub,marginTop:4,fontFamily:F,fontStyle:'italic'}}>{aiSuggestion.note}</div>}
                <div style={{display:'flex',gap:8,marginTop:8}}>
                  <button onClick={acceptSuggestion} style={{...btnOf(T,'green'),padding:'5px 12px',fontSize:12}}>Use This</button>
                  <button onClick={dismissSuggestion} style={{...btnOf(T,'ghost'),padding:'5px 12px',fontSize:12}}>Dismiss</button>
                </div>
              </div>
            )}
            <div style={{fontSize:10,color:T.dim,fontFamily:F}}>Photos are analyzed for this suggestion only and aren't stored — only the catch details you confirm get saved.</div>
          </div>
        </Field>
        <Field label="Notes" span2 T={T}><textarea rows={3} value={form.notes} onChange={e=>set('notes',e.target.value)} placeholder="Depth, lure color, what worked…" style={{...inpOf(T),resize:'vertical'}}/></Field>
      </div>
      {error&&<div style={{fontSize:12,color:T.err,marginTop:8,fontFamily:F}}>{error}</div>}
      <button onClick={submit} style={{...btnOf(T),marginTop:14,width:'100%',background:saved?T.accent:T.hot,fontSize:15}}>{saved?'✓ Outing Saved':'Save Outing'}</button>
      {saved&&(
        <div style={{...cardOf(T),marginTop:12,background:T.muted,border:`1px solid ${T.accent}55`}}>
          <div style={{fontSize:11,color:T.accent,letterSpacing:1,textTransform:'uppercase',fontWeight:'700',marginBottom:8,fontFamily:F}}>✓ Saved — here's exactly what was recorded</div>
          <div style={{fontSize:13,color:T.text,fontFamily:F}}>{saved.location}</div>
          <div style={{fontSize:11,color:T.sub,marginTop:2,marginBottom:6,fontFamily:F}}>{saved.date}{saved.waterType?` · ${saved.waterType}`:''}</div>
          {(saved.speciesTargeted||[]).length>0&&<div style={{fontSize:12,color:T.sub,fontFamily:F}}>Targeting: <span style={{color:T.hot}}>{saved.speciesTargeted.join(', ')}</span></div>}
          {(saved.speciesCaught||[]).length>0&&<div style={{fontSize:12,color:T.sub,fontFamily:F}}>Caught: <span style={{color:T.accent}}>{saved.speciesCaught.join(', ')}</span></div>}
          <div style={{fontSize:13,color:T.text,marginTop:4,fontFamily:F}}>
            {saved.technique?`${saved.technique} · `:''}<strong>{saved.catchCount||0}</strong> fish <span style={{color:T.sub}}>({saved.kept||0} kept · {saved.released||0} released)</span>
          </div>
          {saved.notes&&<div style={{fontSize:12,color:T.text,marginTop:6,fontStyle:'italic',lineHeight:1.5,fontFamily:F}}>{saved.notes}</div>}
          {onViewHistory&&<button onClick={onViewHistory} style={{...btnOf(T,'ghost'),marginTop:10,fontSize:12,width:'100%'}}>View in History →</button>}
        </div>
      )}
    </div>
  );
}

// ── Gear Manager ────────────────────────────────────────────────────────────
// ── Forage calendar — synthesized from WDFW Forage Fish Program, Puget Sound
// Institute, NOAA NWFSC, and UVic salmon diet studies. Approximate — forage
// timing genuinely varies year to year. See SALISH_SEA_FORAGE_GUIDE.md.
const FORAGE_CALENDAR = [
  {forage:'Herring (ramping up) + small candlefish',detail:'Winter blackmouth keying on small bait. Squid still dispersed through South Sound.',tip:'Small profile — 2-3in spoons, green/blue splatterback.'},
  {forage:'Herring (peak spawn) + squid',detail:'Herring spawn peaks this month. Squid still present, dispersing.',tip:'Try purple/UV for squid alongside herring patterns.'},
  {forage:'Herring (spawning) + sand lance larvae',detail:'Herring spawn continues. Sand lance larvae in plankton, not yet active forage.',tip:'Herring-pattern spoons and plug-cut still the default.'},
  {forage:'Herring (wrapping up) + sand lance becoming active',detail:'Cherry Point herring stock just starting (Apr-Jun). Sand lance coming out of winter burial.',tip:'Start watching for candlefish patterns as the month progresses.'},
  {forage:'Surf smelt + early squid',detail:'Summer-spawning surf smelt beaches active. First squid sightings up at Neah Bay.',tip:'Herring still solid; smelt-imitating small profiles worth a try nearshore.'},
  {forage:'Sand lance + herring (juvenile rearing)',detail:'Juvenile Chinook nearshore rearing season begins. Sand lance and herring both important.',tip:'Fish close to bottom over sand/gravel for sand lance-feeding fish.'},
  {forage:'Sand lance + warming-year anchovy',detail:'Peak nearshore rearing. Anchovy presence ramps up in warm years — check what predators are eating locally.',tip:'If anchovy are around, switch to a thicker-profile anchovy imitation.'},
  {forage:'Mixed herring/anchovy/sand lance (regional)',detail:'Migratory coho beginning to show. Forage mix is highly region-dependent by now.',tip:'Match whichever bait you see balling on the surface or sounder.'},
  {forage:'Surf smelt (fall spawn) + early squid',detail:'Fall-spawning surf smelt beaches activate. Squid starting to show in Elliott Bay/Seattle.',tip:'Coho diet skews more krill/invertebrate than Chinook — try smaller, more erratic presentations.'},
  {forage:'Squid (Elliott Bay/Seattle) + fall Chinook forage',detail:'Squid solidly present along the Seattle waterfront.',tip:'Purple/UV worth testing now as squid presence builds.'},
  {forage:'Sand lance (spawning begins) + squid (moving south)',detail:'Sand lance spawning starts again. Squid shifting toward Des Moines/Commencement Bay.',tip:'Small candlefish profiles for winter blackmouth as bait shrinks.'},
  {forage:'Squid (peak central Sound) + sand lance spawning',detail:'Squid peak in central Puget Sound this month. Sand lance spawning continues.',tip:'Purple/UV squid patterns at their most justified time of year.'},
];

const GEAR_CATEGORIES=['Rod','Reel','Lure','Terminal Tackle','Electronics','Other'];
const ROD_POWERS=['Ultra Light','Light','Medium-Light','Medium','Medium-Heavy','Heavy'];
const ROD_ACTIONS=['Slow','Moderate','Fast','Extra Fast'];
const REEL_TYPES=['Spinning','Baitcasting','Levelwind / Conventional','Spincast'];
const LINE_TYPES=['Monofilament','Fluorocarbon','Braid'];
const LURE_TYPES=['Spoon','Plug','Spinner','Flasher','Jig','Hootchie','Fly','Bait / Cut Plug','Other'];
const TT_TYPES=['Hook','Leader','Swivel','Weight / Sinker','Other'];
const BOAT_TYPES=['Drift Boat','Center Console','Bay Boat','Jon Boat','Aluminum Skiff','Pontoon','Kayak','Canoe','Inflatable','Other'];
const PROPULSION_TYPES=['Gas Outboard','Electric Outboard','Electric Trolling Motor Only','Oar / Paddle','Sail','None (Shore/Bank)'];

function GearManager({gear,onSave,configs,onSaveConfigs,boats,onSaveBoats,lineups,onSaveLineups,favWaters,T}){
  const [section,setSection]=useState('lineups'); // lineups | catalog | boats
  return(
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      <div style={{display:'flex',gap:6}}>
        {[['lineups','Lineups'],['catalog','Rods, Reels & Tackle'],['boats','Boats']].map(([k,label])=>(
          <button key={k} onClick={()=>setSection(k)} style={{flex:1,padding:'9px 8px',borderRadius:9,border:`1px solid ${section===k?T.hot:T.border}`,background:section===k?T.hot:'transparent',color:section===k?'#fff':T.sub,cursor:'pointer',fontSize:12,fontWeight:'600',fontFamily:F}}>{label}</button>
        ))}
      </div>
      {section==='lineups'&&<LineupBoard gear={gear} configs={configs} boats={boats} lineups={lineups} onSaveLineups={onSaveLineups} favWaters={favWaters} T={T}/>}
      {section==='catalog'&&<GearCatalog gear={gear} onSave={onSave} configs={configs} onSaveConfigs={onSaveConfigs} T={T}/>}
      {section==='boats'&&<BoatCatalog boats={boats} onSaveBoats={onSaveBoats} T={T}/>}
    </div>
  );
}

// ── Starter gear import — from user-provided rod/reel tables, validated where
// possible against manufacturer specs. Corrections found during validation are
// noted on each item rather than silently changed. importBatch tag prevents
// duplicate imports if the button is clicked more than once.
const STARTER_GEAR_IMPORT = [
  {category:'Rod',name:'Okuma Kokanee Black KBC-802L',brand:'Okuma',qty:1,power:'Light',action:'Moderate',length:`8'`,seatType:'Casting',lineRating:'4-8 lb',lureWeight:'1/8-3/4 oz',notes:'Role: feel/sport.'},
  {category:'Rod',name:'Okuma Kokanee Black KBC-9ML',brand:'Okuma',qty:1,power:'Light',action:'Moderate',length:`9'`,seatType:'Casting',lineRating:'4-10 lb',lureWeight:'1/4-1 oz',notes:'Role: feel + control.'},
  {category:'Rod',name:'Daiwa Metallia SSS MTLA792LRB',brand:'Daiwa',qty:2,power:'Light',action:'Moderate',length:`7'9"`,seatType:'Casting',lineRating:'',lureWeight:'',notes:'Confirmed real product (Salmon/Steelhead/Striped Bass series): 2-piece, 7\'9", Light power, manufacturer lists action as "Regular" (mapped to Moderate here). Line/lure weight not confirmed for this exact SKU — left blank rather than guessed. Role: plug/jig precision.'},
  {category:'Rod',name:'Westcoast Fishing Tackle Tyee TS88i9S',brand:'Westcoast Fishing Tackle',qty:1,power:'Medium-Heavy',action:'',length:`9'`,seatType:'Spinning',lineRating:'10-30 lb',lureWeight:'',notes:'Brand corrected from "West Coast Rods and Reels" to the manufacturer\'s actual name. Tyee Series mooching/trolling rod, IM-10 carbon fiber. Role: knuckle buster / flasher.'},
  {category:'Rod',name:'Westcoast Fishing Tackle Tyee TS88i9C',brand:'Westcoast Fishing Tackle',qty:1,power:'Medium-Heavy',action:'',length:`9'`,seatType:'Casting',lineRating:'10-30 lb',lureWeight:'',notes:'Brand corrected from "West Coast Rods and Reels". Confirmed exact match: "TS88i9C Casting Seat Trolling Rod - 9.0\'", Toray IM-10 carbon fiber. Role: go-to levelwind.'},
  {category:'Rod',name:'Shimano Talora TLA-90M-2',brand:'Shimano',qty:2,power:'Medium',action:'Moderate',length:`9'`,seatType:'Casting',lineRating:'12-25 lb',lureWeight:'',notes:'Spelling corrected from "Telora" to the actual product name, Talora — a well-known PNW mooching/trolling rod. Role: flasher, mooching, jigging.'},
  {category:'Rod',name:'KastKing Progressive Glass',brand:'KastKing',qty:1,power:'Heavy',action:'Moderate',length:`8'`,seatType:'Spinning',lineRating:'10-25 lb',lureWeight:'1/2-3 oz',notes:'Role: bendy knuckle buster (glass blank).'},
  {category:'Rod',name:'Penn Fathom-Master Graphite',brand:'Penn',qty:2,power:'',action:'Moderate',length:`8.5'`,seatType:'Casting',lineRating:'10-25 lb',lureWeight:'',notes:'Confirmed real product — well-known Great Lakes/PNW salmon-steelhead graphite rod, 8.5\'. Power rating not given in source data and not independently confirmed — left blank. Role: old reliable, confidence rod, still very bendy.'},
  {category:'Rod',name:'Okuma Celilo CE-C-802Ha',brand:'Okuma',qty:1,power:'Heavy',action:'',length:`8'`,seatType:'Casting',lineRating:'12-25 lb',lureWeight:'1/2-4 oz',notes:'Correction: source data listed "Heavy" under Action, but Okuma\'s own model code (802Ha = 8\'0", Heavy power, "a" series) confirms this is the Power rating, not Action — moved accordingly. Actual taper/action not confirmed, left blank. Role: feel/sport.'},
  {category:'Rod',name:'Okuma Guide Select Pro GSP-S-902H',brand:'Okuma',qty:1,power:'Heavy',action:'Fast',length:`9'`,seatType:'Spinning',lineRating:'15-40 lb',lureWeight:'1/2-3 oz',notes:'Validated against Okuma\'s official spec sheet for the casting sibling GSP-C-902H — line rating and lure weight matched exactly, confirming accuracy. Manufacturer taper is technically "Medium-Fast (MF)", mapped to Fast here. Role: versatile with good feel.'},
  {category:'Rod',name:'Okuma Guide Select Classic',brand:'Okuma',qty:1,power:'Heavy',action:'Moderate',length:`9.25'`,seatType:'Casting',lineRating:'15-30 lb',lureWeight:'2-8 oz',notes:'Guide Select Pro line confirmed real and widely used for PNW salmon/steelhead; the "Classic" sub-line\'s exact spec sheet wasn\'t independently found this session — figures taken as provided. Role: versatile with good feel.'},

  {category:'Reel',name:'Okuma Cold Water Stainless Low Profile',brand:'Okuma',qty:1,reelType:'Levelwind / Conventional',reelSize:'300',lineType:'Monofilament',linePound:'25 lb',notes:'Confirmed real product — Cold Water Low-Profile Line Counter, one of the most popular PNW salmon trolling reels. Stainless version.'},
  {category:'Reel',name:'Okuma Cold Water Low Profile',brand:'Okuma',qty:1,reelType:'Levelwind / Conventional',reelSize:'300',lineType:'Braid',linePound:'55 lb (50 lb mono topshot)',notes:'Confirmed real product. Currently spooled per source data: 55lb braid with 50lb mono topshot.'},
  {category:'Reel',name:'Okuma Convector Low Profile',brand:'Okuma',qty:2,reelType:'Levelwind / Conventional',reelSize:'300',lineType:'',linePound:'',notes:'Confirmed real product — Convector Low-Profile Line Counter, ~11.7oz, 5.4:1 gear ratio, ~22lb max drag. Worth knowing: several PNW anglers and Okuma\'s own warranty team note these suit lighter trolling weights better than full downrigger/diver duty — the heavier Cold Water line is generally preferred for that.'},
  {category:'Reel',name:'Okuma Convector Low Profile',brand:'Okuma',qty:2,reelType:'Levelwind / Conventional',reelSize:'150',lineType:'',linePound:'',notes:'Smaller (150) size of the Convector Low-Profile — same notes as the 300 size above re: trolling weight limits.'},
  {category:'Reel',name:'Shimano Tekota 501HG LC',brand:'Shimano',qty:1,reelType:'Levelwind / Conventional',reelSize:'500',lineType:'Braid',linePound:'55 lb (~25-30 lb mono topshot, unconfirmed exact)',notes:'Confirmed: "501" denotes the left-hand-retrieve variant of the Tekota 500HG-LC. Confirmed specs: 6.3:1 gear ratio, ~225yds of 65lb braid capacity. Widely regarded as one of the best line-counter trolling reels in the PNW.'},
  {category:'Reel',name:'Islander TR3',brand:'Islander',qty:1,reelType:'Spinning',reelSize:'',lineType:'Monofilament',linePound:'25 lb',notes:'Knucklebuster-style mooching reel (manual, no anti-reverse, for finesse mooching).'},
  {category:'Reel',name:'Shimano Moocher Plus 4000GT',brand:'Shimano',qty:1,reelType:'Spinning',reelSize:'4000',lineType:'Monofilament',linePound:'25 lb',notes:'Knucklebuster-style mooching reel.'},
  {category:'Reel',name:'Daiwa M-One Plus',brand:'Daiwa',qty:1,reelType:'Spinning',reelSize:'',lineType:'Monofilament',linePound:'25 lb',notes:'Knucklebuster-style mooching reel — frequently referenced by PNW anglers as a go-to mooching pairing.'},
  {category:'Reel',name:'KastKing Rekon 10LM',brand:'KastKing',qty:1,reelType:'Levelwind / Conventional',reelSize:'',lineType:'Monofilament',linePound:'25 lb',notes:'Conventional levelwind with line counter.'},
  {category:'Reel',name:'Okuma Convector CV 20D',brand:'Okuma',qty:1,reelType:'Levelwind / Conventional',reelSize:'20',lineType:'Monofilament',linePound:'25 lb',notes:'Round-body Convector (distinct from the low-profile Convector rows above) — conventional levelwind with line counter.'},
].map((item,i)=>({...item,id:`starter-${i}`,importBatch:'starter-v1'}));

// ── Catalog: categorized gear + compact rod/reel config table ──────────────
function GearCatalog({gear,onSave,configs,onSaveConfigs,T}){
  const blank={category:'Rod',name:'',brand:'',qty:1,power:'',action:'',length:'',seatType:'',lineRating:'',lureWeight:'',reelType:'',reelSize:'',lineType:'',linePound:'',lineDate:'',lureType:'',color:'',ttType:'',size:'',deviceType:'',notes:''};
  const [form,setForm]=useState(blank);
  const [showAdd,setShowAdd]=useState(false);
  const alreadyImported = gear.some(g=>g.importBatch==='starter-v1');
  const set=(k,v)=>setForm(prev=>({...prev,[k]:v}));
  const add=()=>{
    if(!form.name.trim())return;
    onSave([{...form,id:Date.now()},...gear]);
    setForm({...blank,category:form.category});
  };
  const del=id=>{
    onSave(gear.filter(g=>g.id!==id));
    onSaveConfigs(configs.filter(c=>String(c.rodId)!==String(id)&&String(c.reelId)!==String(id)));
  };
  const updateQty=(id,delta)=>onSave(gear.map(g=>g.id===id?{...g,qty:Math.max(1,(Number(g.qty)||1)+delta)}:g));

  const grouped = GEAR_CATEGORIES.map(cat=>({cat,items:gear.filter(g=>g.category===cat)})).filter(g=>g.items.length>0);
  const rods=gear.filter(g=>g.category==='Rod');
  const reels=gear.filter(g=>g.category==='Reel');
  const [cfgRod,setCfgRod]=useState('');
  const [cfgReel,setCfgReel]=useState('');
  const [cfgName,setCfgName]=useState('');
  const addConfig=()=>{
    if(!cfgRod||!cfgReel)return;
    const rod=rods.find(r=>String(r.id)===cfgRod), reel=reels.find(r=>String(r.id)===cfgReel);
    const name=cfgName.trim()||`${rod?.name||'Rod'} / ${reel?.name||'Reel'}`;
    onSaveConfigs([{id:Date.now(),name,rodId:cfgRod,reelId:cfgReel},...configs]);
    setCfgRod('');setCfgReel('');setCfgName('');
  };
  const delConfig=id=>onSaveConfigs(configs.filter(c=>c.id!==id));

  return(
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      {!alreadyImported&&(
        <div style={{...cardOf(T),background:`linear-gradient(135deg,${T.accent}14,${T.hot}0a)`,border:`1px solid ${T.accent}44`}}>
          <SectionHead T={T}>Import Starter Gear</SectionHead>
          <div style={{fontSize:13,color:T.text,marginBottom:6,fontFamily:F}}>11 rods and 10 reels from your uploaded data, ready to import.</div>
          <div style={{fontSize:11,color:T.sub,marginBottom:10,fontFamily:F,lineHeight:1.6}}>Validated against manufacturer specs where possible — 2 corrections found and noted (a brand name and a power/action mix-up), a few gaps left blank rather than guessed. Check each item's notes after importing. Rod+reel pairings weren't specified in the source data, so nothing gets auto-paired — use the Configurations table below once everything's in.</div>
          <button onClick={()=>onSave([...STARTER_GEAR_IMPORT,...gear])} style={btnOf(T,'green')}>Import 11 Rods + 10 Reels</button>
        </div>
      )}
      <div style={cardOf(T)}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:showAdd?12:0}}>
          <SectionHead T={T}>Add Gear</SectionHead>
          <button onClick={()=>setShowAdd(!showAdd)} style={{...btnOf(T,'ghost'),padding:'4px 10px',fontSize:11}}>{showAdd?'Cancel':'+ Add'}</button>
        </div>
        {showAdd&&(
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            <Field label="Category" T={T}>
              <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
                {GEAR_CATEGORIES.map(c=><Chip key={c} label={c} active={form.category===c} T={T} color={T.hot} onClick={()=>set('category',c)}/>)}
              </div>
            </Field>
            <div style={{display:'grid',gridTemplateColumns:'2fr 1fr',gap:10}}>
              <Field label="Name / Model" T={T}><input placeholder={form.category==='Rod'?'G. Loomis E6X 9ft':form.category==='Reel'?'Shimano Tekota 500':'Gibbs Silva Spoon'} value={form.name} onChange={e=>set('name',e.target.value)} style={inpOf(T)}/></Field>
              <Field label="Qty" T={T}><input type="number" min="1" value={form.qty} onChange={e=>set('qty',e.target.value)} style={inpOf(T)}/></Field>
            </div>
            <Field label="Brand" T={T}><input placeholder="Shimano, G. Loomis, Lamiglas…" value={form.brand} onChange={e=>set('brand',e.target.value)} style={inpOf(T)}/></Field>

            {form.category==='Rod'&&(
              <>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10}}>
                  <Field label="Power" T={T}>
                    <select value={form.power} onChange={e=>set('power',e.target.value)} style={inpOf(T)}>
                      <option value="">—</option>{ROD_POWERS.map(p=><option key={p}>{p}</option>)}
                    </select>
                  </Field>
                  <Field label="Action" T={T}>
                    <select value={form.action} onChange={e=>set('action',e.target.value)} style={inpOf(T)}>
                      <option value="">—</option>{ROD_ACTIONS.map(a=><option key={a}>{a}</option>)}
                    </select>
                  </Field>
                  <Field label="Length" T={T}><input placeholder={`9'6"`} value={form.length} onChange={e=>set('length',e.target.value)} style={inpOf(T)}/></Field>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10}}>
                  <Field label="Reel Seat" T={T}>
                    <select value={form.seatType} onChange={e=>set('seatType',e.target.value)} style={inpOf(T)}>
                      <option value="">—</option><option>Casting</option><option>Spinning</option>
                    </select>
                  </Field>
                  <Field label="Line Rating" T={T}><input placeholder="10-25 lb" value={form.lineRating} onChange={e=>set('lineRating',e.target.value)} style={inpOf(T)}/></Field>
                  <Field label="Lure Weight" T={T}><input placeholder="1/2-3 oz" value={form.lureWeight} onChange={e=>set('lureWeight',e.target.value)} style={inpOf(T)}/></Field>
                </div>
              </>
            )}
            {form.category==='Reel'&&(
              <>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10}}>
                  <Field label="Reel Type" T={T}>
                    <select value={form.reelType} onChange={e=>set('reelType',e.target.value)} style={inpOf(T)}>
                      <option value="">—</option>{REEL_TYPES.map(t=><option key={t}>{t}</option>)}
                    </select>
                  </Field>
                  <Field label="Size" T={T}><input placeholder="300, 500…" value={form.reelSize} onChange={e=>set('reelSize',e.target.value)} style={inpOf(T)}/></Field>
                  <Field label="Line Type" T={T}>
                    <select value={form.lineType} onChange={e=>set('lineType',e.target.value)} style={inpOf(T)}>
                      <option value="">—</option>{LINE_TYPES.map(t=><option key={t}>{t}</option>)}
                    </select>
                  </Field>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                  <Field label="Line Lb Test" T={T}><input placeholder="20 lb" value={form.linePound} onChange={e=>set('linePound',e.target.value)} style={inpOf(T)}/></Field>
                  <Field label="Line Last Replaced" T={T}><input type="date" value={form.lineDate} onChange={e=>set('lineDate',e.target.value)} style={inpOf(T)}/></Field>
                </div>
              </>
            )}
            {form.category==='Lure'&&(
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <Field label="Lure Type" T={T}>
                  <select value={form.lureType} onChange={e=>set('lureType',e.target.value)} style={inpOf(T)}>
                    <option value="">—</option>{LURE_TYPES.map(t=><option key={t}>{t}</option>)}
                  </select>
                </Field>
                <Field label="Color" T={T}><input placeholder="Chrome/Blue" value={form.color} onChange={e=>set('color',e.target.value)} style={inpOf(T)}/></Field>
              </div>
            )}
            {form.category==='Terminal Tackle'&&(
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <Field label="Type" T={T}>
                  <select value={form.ttType} onChange={e=>set('ttType',e.target.value)} style={inpOf(T)}>
                    <option value="">—</option>{TT_TYPES.map(t=><option key={t}>{t}</option>)}
                  </select>
                </Field>
                <Field label="Size / Spec" T={T}><input placeholder="2/0, 30lb test…" value={form.size} onChange={e=>set('size',e.target.value)} style={inpOf(T)}/></Field>
              </div>
            )}
            {form.category==='Electronics'&&(
              <Field label="Device Type" T={T}>
                <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
                  {['Fishfinder/Chartplotter','Transducer','GPS','Other'].map(d=><Chip key={d} label={d} active={form.deviceType===d} T={T} color={T.accent} onClick={()=>set('deviceType',d)}/>)}
                </div>
              </Field>
            )}
            <Field label="Notes" T={T}><input placeholder="Role, capacity, balance, anything else worth remembering…" value={form.notes} onChange={e=>set('notes',e.target.value)} style={inpOf(T)}/></Field>
            <button onClick={add} style={btnOf(T,'green')}>Add to Gear Bag</button>
          </div>
        )}
      </div>

      <div style={cardOf(T)}>
        <SectionHead T={T}>Gear Bag ({gear.length})</SectionHead>
        {gear.length===0&&<div style={{color:T.sub,fontSize:13,fontFamily:F}}>No gear logged yet — accuracy here helps the AI Guide recommend the right setup as conditions change.</div>}
        {grouped.map(({cat,items})=>(
          <div key={cat} style={{marginBottom:14}}>
            <div style={{fontSize:10,color:T.sub,letterSpacing:1.2,textTransform:'uppercase',marginBottom:7,fontWeight:'600',fontFamily:F}}>{cat} ({items.length})</div>
            {items.map(g=>(
              <div key={g.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'9px 0',borderBottom:`1px solid ${T.border}`,gap:10}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{color:T.text,fontSize:14,fontFamily:F}}>{g.name}</div>
                  <div style={{color:T.sub,fontSize:11,marginTop:2,fontFamily:F}}>
                    {[g.brand,
                      g.category==='Rod'?[g.power,g.action,g.length,g.seatType&&`${g.seatType} seat`,g.lineRating&&`line ${g.lineRating}`,g.lureWeight&&`lure ${g.lureWeight}`].filter(Boolean).join(' · '):null,
                      g.category==='Reel'?[g.reelType,g.reelSize&&`size ${g.reelSize}`,g.lineType&&`${g.lineType} ${g.linePound||''}`.trim(),g.lineDate&&`line replaced ${g.lineDate}`].filter(Boolean).join(' · '):null,
                      g.category==='Lure'?[g.lureType,g.color].filter(Boolean).join(' · '):null,
                      g.category==='Terminal Tackle'?[g.ttType,g.size].filter(Boolean).join(' · '):null,
                      g.category==='Electronics'?g.deviceType:null,
                    ].filter(Boolean).join(' · ')}
                  </div>
                  {g.notes&&<div style={{color:T.dim,fontSize:11,marginTop:2,fontFamily:F,fontStyle:'italic'}}>{g.notes}</div>}
                </div>
                <div style={{display:'flex',alignItems:'center',gap:6,flexShrink:0}}>
                  <button onClick={()=>updateQty(g.id,-1)} style={{...btnOf(T,'ghost'),padding:'2px 8px',fontSize:13}}>−</button>
                  <span style={{fontSize:13,color:T.text,fontFamily:F,minWidth:18,textAlign:'center'}}>{g.qty||1}</span>
                  <button onClick={()=>updateQty(g.id,1)} style={{...btnOf(T,'ghost'),padding:'2px 8px',fontSize:13}}>+</button>
                  <button onClick={()=>del(g.id)} style={{...btnOf(T,'ghost'),padding:'3px 9px',fontSize:11,color:T.err,borderColor:`${T.err}44`,marginLeft:4}}>Remove</button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {rods.length>0&&reels.length>0&&(
        <div style={cardOf(T)}>
          <SectionHead T={T}>Rod + Reel Configurations (optional)</SectionHead>
          <div style={{fontSize:12,color:T.sub,marginBottom:10,fontFamily:F}}>Individual rods and reels already work in lineups on their own — this is purely optional if you want to pre-pair a specific rod+reel combo as a single named unit.</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr auto',gap:8,marginBottom:10}}>
            <select value={cfgRod} onChange={e=>setCfgRod(e.target.value)} style={{...inpOf(T),fontSize:13}}>
              <option value="">Rod…</option>{rods.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <select value={cfgReel} onChange={e=>setCfgReel(e.target.value)} style={{...inpOf(T),fontSize:13}}>
              <option value="">Reel…</option>{reels.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <input placeholder="Name (optional)" value={cfgName} onChange={e=>setCfgName(e.target.value)} style={{...inpOf(T),fontSize:13}}/>
            <button onClick={addConfig} disabled={!cfgRod||!cfgReel} style={{...btnOf(T,'green'),padding:'8px 14px',fontSize:13,opacity:(!cfgRod||!cfgReel)?0.5:1}}>Add</button>
          </div>
          {configs.length===0&&<div style={{fontSize:12,color:T.sub,fontFamily:F,fontStyle:'italic'}}>No configurations yet.</div>}
          {configs.map(c=>{
            const rod=rods.find(r=>String(r.id)===String(c.rodId));
            const reel=reels.find(r=>String(r.id)===String(c.reelId));
            return(
              <div key={c.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:`1px solid ${T.border}`,fontSize:13,fontFamily:F}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{color:T.text}}>{c.name}</div>
                  <div style={{color:T.sub,fontSize:11,marginTop:1}}>{rod?.name||'(rod removed)'} + {reel?.name||'(reel removed)'}{reel?.lineDate?` · line replaced ${reel.lineDate}`:''}</div>
                </div>
                <button onClick={()=>delConfig(c.id)} style={{...btnOf(T,'ghost'),padding:'3px 9px',fontSize:11,color:T.err,borderColor:`${T.err}44`}}>Remove</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Boats — same compact-table style as Configs, so the relationship reads clearly ──
function BoatCatalog({boats,onSaveBoats,T}){
  const blank={name:'',type:'',propulsion:'',rampRequired:true,electricOnly:false,notes:''};
  const [form,setForm]=useState(blank);
  const [showAdd,setShowAdd]=useState(false);
  const set=(k,v)=>setForm(prev=>({...prev,[k]:v}));
  const add=()=>{
    if(!form.name.trim())return;
    onSaveBoats([{...form,id:Date.now()},...boats]);
    setForm(blank);setShowAdd(false);
  };
  const del=id=>onSaveBoats(boats.filter(b=>b.id!==id));

  return(
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      <div style={cardOf(T)}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:showAdd?12:0}}>
          <SectionHead T={T}>Boats</SectionHead>
          <button onClick={()=>setShowAdd(!showAdd)} style={{...btnOf(T,'ghost'),padding:'4px 10px',fontSize:11}}>{showAdd?'Cancel':'+ Add Boat'}</button>
        </div>
        {showAdd&&(
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            <Field label="Name" T={T}><input placeholder="The Net Result" value={form.name} onChange={e=>set('name',e.target.value)} style={inpOf(T)}/></Field>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              <Field label="Type" T={T}>
                <select value={form.type} onChange={e=>set('type',e.target.value)} style={inpOf(T)}>
                  <option value="">—</option>{BOAT_TYPES.map(t=><option key={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Propulsion" T={T}>
                <select value={form.propulsion} onChange={e=>set('propulsion',e.target.value)} style={inpOf(T)}>
                  <option value="">—</option>{PROPULSION_TYPES.map(p=><option key={p}>{p}</option>)}
                </select>
              </Field>
            </div>
            <div style={{display:'flex',gap:14}}>
              <label style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:T.text,fontFamily:F,cursor:'pointer'}}>
                <input type="checkbox" checked={form.rampRequired} onChange={e=>set('rampRequired',e.target.checked)}/> Needs boat ramp
              </label>
              <label style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:T.text,fontFamily:F,cursor:'pointer'}}>
                <input type="checkbox" checked={form.electricOnly} onChange={e=>set('electricOnly',e.target.checked)}/> Electric-only legal
              </label>
            </div>
            <Field label="Notes" T={T}><input placeholder="Trailer at home, 16ft, max 4 anglers…" value={form.notes} onChange={e=>set('notes',e.target.value)} style={inpOf(T)}/></Field>
            <button onClick={add} style={btnOf(T,'green')}>Add Boat</button>
          </div>
        )}
      </div>
      <div style={cardOf(T)}>
        {boats.length===0&&<div style={{color:T.sub,fontSize:13,fontFamily:F}}>No boats logged yet. Add yours so the AI Guide can recommend launches that fit it.</div>}
        {boats.map(b=>(
          <div key={b.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 0',borderBottom:`1px solid ${T.border}`}}>
            <div>
              <div style={{color:T.text,fontSize:14,fontFamily:F}}>{b.name}</div>
              <div style={{color:T.sub,fontSize:12,marginTop:2,fontFamily:F}}>{[b.type,b.propulsion,b.rampRequired===false?'no ramp needed':null,b.electricOnly?'electric-only ok':null,b.notes].filter(Boolean).join(' · ')}</div>
            </div>
            <button onClick={()=>del(b.id)} style={{...btnOf(T,'ghost'),padding:'3px 9px',fontSize:11,color:T.err,borderColor:`${T.err}44`}}>Remove</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Lineups — Sleeper-style: rod/reel starters on top, tackle starters below,
// button-press swap from bench (no drag/drop) ───────────────────────────────
function LineupBoard({gear,configs,boats,lineups,onSaveLineups,favWaters,T}){
  const [editingId,setEditingId]=useState(null);
  const [showNew,setShowNew]=useState(false);
  const [newName,setNewName]=useState('');
  // ALL gear is individually assignable to lineups — including rods and reels.
  // Configs (pre-paired rod+reel combos) are an optional secondary layer shown
  // only if the user has actually created some. Individual gear is the default.
  const allGear = gear;
  const SUGGESTED=['Saltwater Salmon — Trolling','Saltwater Salmon — Mooching','River Steelhead','Trout — Lowland Lakes','Sea-Run Cutthroat','Bass'];

  const createLineup=()=>{
    const name=newName.trim();
    if(!name)return;
    onSaveLineups([{id:Date.now(),name,configIds:[],gearIds:[],lureIds:[],boatId:''},...lineups]);
    setNewName('');setShowNew(false);
  };
  const delLineup=id=>onSaveLineups(lineups.filter(l=>l.id!==id));
  const updateLineup=(id,patch)=>onSaveLineups(lineups.map(l=>l.id===id?{...l,...patch}:l));

  return(
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      {!showNew&&<button onClick={()=>setShowNew(true)} style={{...btnOf(T,'green'),width:'100%'}}>+ New Starting Lineup</button>}
      {showNew&&(
        <div style={cardOf(T)}>
          <Field label="Lineup Name" T={T}>
            <input placeholder="Saltwater Coho Trolling, King Salmon - My Boat…" value={newName} onChange={e=>setNewName(e.target.value)} style={inpOf(T)} onKeyDown={e=>e.key==='Enter'&&createLineup()}/>
          </Field>
          <div style={{display:'flex',flexWrap:'wrap',gap:5,marginTop:8,marginBottom:10}}>
            {SUGGESTED.map(s=><Chip key={s} label={s} active={newName===s} T={T} color={T.accent} onClick={()=>setNewName(s)}/>)}
            {favWaters.map(w=><Chip key={w.id} label={w.name} active={newName===w.name} T={T} color={T.hot} onClick={()=>setNewName(w.name)}/>)}
          </div>
          <div style={{display:'flex',gap:8}}>
            <button onClick={createLineup} disabled={!newName.trim()} style={{...btnOf(T,'green'),flex:1,opacity:newName.trim()?1:0.5}}>Create</button>
            <button onClick={()=>{setShowNew(false);setNewName('');}} style={btnOf(T,'ghost')}>Cancel</button>
          </div>
        </div>
      )}
      {lineups.length===0&&!showNew&&(
        <div style={{...cardOf(T),textAlign:'center',color:T.sub,fontSize:13,fontFamily:F}}>
          No lineups yet. Create one for a species, technique, or favorite water — then pick rods, reels, and tackle from your gear bag.
        </div>
      )}
      {lineups.map(lineup=>(
        <LineupCard key={lineup.id} lineup={lineup} allGear={allGear} configs={configs} boats={boats}
          editing={editingId===lineup.id} onToggleEdit={()=>setEditingId(editingId===lineup.id?null:lineup.id)}
          onUpdate={patch=>updateLineup(lineup.id,patch)} onDelete={()=>delLineup(lineup.id)} T={T}/>
      ))}
    </div>
  );
}

function LineupCard({lineup,allGear,configs,boats,editing,onToggleEdit,onUpdate,onDelete,T}){
  // Merge gearIds (new field) and lureIds (legacy field) for backward compat.
  // New gear gets written to gearIds; old data in lureIds still reads correctly.
  const activeGearIds = new Set([...(lineup.gearIds||[]),...(lineup.lureIds||[])]);
  const starterGear = allGear.filter(g=>activeGearIds.has(g.id));
  const benchGear   = allGear.filter(g=>!activeGearIds.has(g.id));

  // Sort starters: Rods first, Reels second, everything else after
  const sortedStarters = [
    ...starterGear.filter(g=>g.category==='Rod'),
    ...starterGear.filter(g=>g.category==='Reel'),
    ...starterGear.filter(g=>g.category!=='Rod'&&g.category!=='Reel'),
  ];

  // Bench: same order — Rods, Reels, then rest grouped by category
  const benchRods   = benchGear.filter(g=>g.category==='Rod');
  const benchReels  = benchGear.filter(g=>g.category==='Reel');
  const benchByType = {};
  benchGear.filter(g=>g.category!=='Rod'&&g.category!=='Reel').forEach(g=>{
    if(!benchByType[g.category]) benchByType[g.category]=[];
    benchByType[g.category].push(g);
  });

  // Configs are optional — only shown when configs actually exist in the catalog
  const hasConfigs = configs.length>0;
  const starterConfigs = hasConfigs ? configs.filter(c=>(lineup.configIds||[]).includes(c.id)) : [];
  const benchConfigs   = hasConfigs ? configs.filter(c=>!(lineup.configIds||[]).includes(c.id)) : [];

  const startGear  = id=>onUpdate({gearIds:[...(lineup.gearIds||[]),...(lineup.lureIds||[]),id].filter((v,i,a)=>a.indexOf(v)===i)});
  const benchGearItem= id=>onUpdate({
    gearIds:(lineup.gearIds||[]).filter(x=>x!==id),
    lureIds:(lineup.lureIds||[]).filter(x=>x!==id),
  });
  const startConfig= id=>onUpdate({configIds:[...(lineup.configIds||[]),id]});
  const benchConfig= id=>onUpdate({configIds:(lineup.configIds||[]).filter(x=>x!==id)});

  const boat = boats.find(b=>String(b.id)===String(lineup.boatId));

  const GearChip=({g,benching})=>(
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'7px 10px',background:benching?T.muted:T.bg,border:`1px solid ${T.border}`,borderRadius:8,marginBottom:5}}>
      <div>
        <span style={{fontSize:13,color:T.text,fontFamily:F,fontWeight:benching?'600':'400'}}>{g.name}</span>
        <span style={{fontSize:11,color:T.sub,fontFamily:F,marginLeft:6}}>· {g.category}</span>
        {g.category==='Rod'&&g.length&&<span style={{fontSize:10,color:T.dim,fontFamily:F,marginLeft:4}}>{g.length}</span>}
        {g.category==='Reel'&&g.lineType&&<span style={{fontSize:10,color:T.dim,fontFamily:F,marginLeft:4}}>{g.linePound} {g.lineType}</span>}
      </div>
      {editing&&(
        benching
          ? <button onClick={()=>benchGearItem(g.id)} style={{...btnOf(T,'ghost'),padding:'2px 8px',fontSize:10}}>Bench</button>
          : <button onClick={()=>startGear(g.id)} style={{...btnOf(T,'green'),padding:'2px 8px',fontSize:10}}>Start</button>
      )}
    </div>
  );

  return(
    <div style={{...cardOf(T),borderLeft:`3px solid ${T.hot}`}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:10}}>
        <div>
          <div style={{fontSize:15,fontWeight:'700',color:T.text,fontFamily:F}}>{lineup.name}</div>
          {boat&&<div style={{fontSize:11,color:T.sub,fontFamily:F,marginTop:2}}>🛶 {boat.name} · {boat.propulsion}</div>}
        </div>
        <div style={{display:'flex',gap:6,flexShrink:0}}>
          <button onClick={onToggleEdit} style={{...btnOf(T,'ghost'),padding:'4px 10px',fontSize:11}}>{editing?'Done':'Edit'}</button>
          <button onClick={onDelete} style={{...btnOf(T,'ghost'),padding:'4px 10px',fontSize:11,color:T.err,borderColor:`${T.err}44`}}>Delete</button>
        </div>
      </div>

      {editing&&boats.length>0&&(
        <div style={{marginBottom:12}}>
          <Field label="Boat" T={T}>
            <select value={lineup.boatId||''} onChange={e=>onUpdate({boatId:e.target.value})} style={inpOf(T)}>
              <option value="">None</option>{boats.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
        </div>
      )}

      {/* Starters — individual gear first (rods → reels → tackle) */}
      <div style={{fontSize:10,color:T.hot,letterSpacing:1.2,textTransform:'uppercase',fontWeight:'700',marginBottom:6,fontFamily:F}}>Starting Gear</div>
      {sortedStarters.length===0&&<div style={{fontSize:12,color:T.sub,fontFamily:F,fontStyle:'italic',marginBottom:8}}>No gear in the starting lineup yet{editing?' — use the bench below to add some':' — tap Edit to set up your lineup'}.</div>}
      {sortedStarters.map(g=><GearChip key={g.id} g={g} benching={true}/>)}

      {/* Configs — only shown if user has created at least one */}
      {hasConfigs&&starterConfigs.length>0&&(
        <>
          <div style={{fontSize:10,color:T.sub,letterSpacing:1.2,textTransform:'uppercase',fontWeight:'600',marginTop:10,marginBottom:6,fontFamily:F}}>Paired Configs (optional)</div>
          {starterConfigs.map(c=>(
            <div key={c.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'7px 10px',background:T.muted,border:`1px solid ${T.border}`,borderRadius:8,marginBottom:5}}>
              <span style={{fontSize:12,color:T.text,fontFamily:F}}>{c.name}</span>
              {editing&&<button onClick={()=>benchConfig(c.id)} style={{...btnOf(T,'ghost'),padding:'2px 8px',fontSize:10}}>Bench</button>}
            </div>
          ))}
        </>
      )}

      {/* Bench (edit mode) — individual gear first, configs last and only if they exist */}
      {editing&&(
        <div style={{marginTop:14,paddingTop:12,borderTop:`1px solid ${T.border}`}}>
          <div style={{fontSize:10,color:T.sub,letterSpacing:1.2,textTransform:'uppercase',fontWeight:'700',marginBottom:8,fontFamily:F}}>Bench</div>

          {benchRods.length>0&&(
            <div style={{marginBottom:10}}>
              <div style={{fontSize:11,color:T.sub,fontFamily:F,marginBottom:4}}>Rods</div>
              {benchRods.map(g=><GearChip key={g.id} g={g} benching={false}/>)}
            </div>
          )}
          {benchReels.length>0&&(
            <div style={{marginBottom:10}}>
              <div style={{fontSize:11,color:T.sub,fontFamily:F,marginBottom:4}}>Reels</div>
              {benchReels.map(g=><GearChip key={g.id} g={g} benching={false}/>)}
            </div>
          )}
          {Object.entries(benchByType).map(([cat,items])=>(
            <div key={cat} style={{marginBottom:10}}>
              <div style={{fontSize:11,color:T.sub,fontFamily:F,marginBottom:4}}>{cat}</div>
              {items.map(g=><GearChip key={g.id} g={g} benching={false}/>)}
            </div>
          ))}

          {hasConfigs&&benchConfigs.length>0&&(
            <div style={{marginBottom:10}}>
              <div style={{fontSize:11,color:T.dim,fontFamily:F,marginBottom:4,fontStyle:'italic'}}>Optional: Paired Configs</div>
              {benchConfigs.map(c=>(
                <div key={c.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 8px',marginBottom:4}}>
                  <span style={{fontSize:12,color:T.text,fontFamily:F}}>{c.name}</span>
                  <button onClick={()=>startConfig(c.id)} style={{...btnOf(T,'ghost'),padding:'3px 10px',fontSize:11}}>Add to Lineup</button>
                </div>
              ))}
            </div>
          )}

          {benchRods.length===0&&benchReels.length===0&&Object.keys(benchByType).length===0&&benchConfigs.length===0&&(
            <div style={{fontSize:12,color:T.sub,fontFamily:F,fontStyle:'italic'}}>All gear is in the lineup — add more in the Catalog tab.</div>
          )}
        </div>
      )}
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

// ── Settings — bring-your-own Anthropic API key for standalone deployments ──
function SettingsTab({hasApiKey,onSaveKey,T}){
  const [keyInput,setKeyInput]=useState('');
  const [showKey,setShowKey]=useState(false);
  const [saved,setSaved]=useState(false);

  const handleSave=()=>{
    if(!keyInput.trim()) return;
    onSaveKey(keyInput.trim());
    setKeyInput('');
    setSaved(true);
    setTimeout(()=>setSaved(false),2500);
  };
  const handleClear=()=>{
    onSaveKey('');
    setSaved(false);
  };

  return(
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      <div style={cardOf(T)}>
        <SectionHead T={T}>Anthropic API Key</SectionHead>
        <div style={{fontSize:13,color:T.text,marginBottom:8,lineHeight:1.6,fontFamily:F}}>
          AI Guide, Trip Planner, and photo analysis need your own Anthropic API key to work on this standalone site. Your key is stored only in your browser (and synced to your account if signed in) — it's sent per-request to this site's own server proxy, never baked into the deployed code, and no one else's browser ever sees it.
        </div>
        <div style={{fontSize:12,color:T.sub,marginBottom:14,fontFamily:F}}>
          Don't have one? Get a key at <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer" style={{color:T.accent}}>console.anthropic.com</a> — set a spending limit there too, since usage on your key is billed to your Anthropic account.
        </div>

        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
          <span style={{fontSize:12,color:T.sub,fontFamily:F}}>Status:</span>
          {hasApiKey
            ? <span style={{fontSize:12,color:T.accent,fontFamily:F,fontWeight:'600'}}>🤖 Key set — AI features ready</span>
            : <span style={{fontSize:12,color:T.err,fontFamily:F,fontWeight:'600'}}>⚠ No key set yet</span>
          }
        </div>

        <div style={{display:'flex',gap:8}}>
          <input
            type={showKey?'text':'password'}
            placeholder="sk-ant-…"
            value={keyInput}
            onChange={e=>setKeyInput(e.target.value)}
            onKeyDown={e=>e.key==='Enter'&&handleSave()}
            style={{...inpOf(T),flex:1,fontFamily:'monospace'}}
          />
          <button onClick={()=>setShowKey(!showKey)} style={{...btnOf(T,'ghost'),padding:'8px 12px',fontSize:12}}>{showKey?'Hide':'Show'}</button>
        </div>
        <div style={{display:'flex',gap:8,marginTop:10}}>
          <button onClick={handleSave} disabled={!keyInput.trim()} style={{...btnOf(T,'green'),flex:1,opacity:keyInput.trim()?1:0.5}}>{saved?'✓ Saved':'Save Key'}</button>
          {hasApiKey&&<button onClick={handleClear} style={{...btnOf(T,'ghost'),color:T.err,borderColor:`${T.err}44`}}>Remove Key</button>}
        </div>
      </div>
    </div>
  );
}

// ── Sign-in screen (shown when Firebase is configured and not yet signed in) ──
function SignInScreen({onSignIn,error,busy}){
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const T=DARK;
  return(
    <div style={{background:T.bg,minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:F,padding:20}}>
      <div style={{...cardOf(T),width:'100%',maxWidth:360}}>
        <div style={{textAlign:'center',marginBottom:18}}>
          <div style={{display:'flex',justifyContent:'center',marginBottom:10}}><BrandMark T={T} size={44}/></div>
          <div style={{fontSize:18,fontWeight:'700',color:T.text}}>Blackmouth<span style={{color:T.hot}}>.AI</span></div>
          <div style={{fontSize:12,color:T.sub,marginTop:4}}>Sign in to sync your data</div>
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          <input type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} style={inpOf(T)} onKeyDown={e=>e.key==='Enter'&&onSignIn(email,password)}/>
          <input type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} style={inpOf(T)} onKeyDown={e=>e.key==='Enter'&&onSignIn(email,password)}/>
          {error&&<div style={{fontSize:12,color:T.err}}>{error}</div>}
          <button onClick={()=>onSignIn(email,password)} disabled={busy||!email||!password} style={{...btnOf(T,'green'),opacity:busy?0.7:1}}>
            {busy?'Signing in…':'Sign In'}
          </button>
        </div>
        <div style={{fontSize:11,color:T.sub,marginTop:16,textAlign:'center',lineHeight:1.6}}>
          Ask whoever set this up to create your account — there's no public sign-up here on purpose.
        </div>
      </div>
    </div>
  );
}

// ── Root: resolves sync state before anything else renders ─────────────────
export default function Root(){
  const [authState,setAuthState] = useState(isFirebaseConfigured() ? 'loading' : 'local');
  const [authError,setAuthError] = useState('');
  const [authBusy,setAuthBusy] = useState(false);

  useEffect(()=>{
    if(!isFirebaseConfigured()){ setSyncUser(null); return; }
    (async()=>{
      // Try silent re-auth using a refresh token cached via Claude's own
      // storage, so signing in once per Claude account is enough.
      try{
        const cached = await getCachedRefreshToken();
        if(cached){
          await fbRefresh(cached);
          setSyncUser(fbTokens.uid);
          await cacheRefreshToken(fbTokens.refreshToken);
          setAuthState('signedIn');
          return;
        }
      }catch{}
      setAuthState('signedOut');
    })();
  },[]);

  const handleSignIn = async (email,password)=>{
    setAuthBusy(true); setAuthError('');
    try{
      const uid = await fbSignIn(email,password);
      setSyncUser(uid);
      await cacheRefreshToken(fbTokens.refreshToken);
      setAuthState('signedIn');
    }catch(e){
      setAuthError(e.message || 'Sign-in failed — check your email and password.');
    }
    setAuthBusy(false);
  };

  const handleSignOut = ()=>{
    fbSignOut(); setSyncUser(null);
    cacheRefreshToken(null);
    setAuthState('signedOut');
  };

  if(authState==='loading'){
    return <div style={{background:DARK.bg,height:'100vh',display:'flex',alignItems:'center',justifyContent:'center',color:DARK.sub,fontFamily:F,fontSize:15}}>Loading…</div>;
  }
  if(authState==='signedOut'){
    return <SignInScreen onSignIn={handleSignIn} error={authError} busy={authBusy}/>;
  }
  return <BlackmouthApp syncStatus={authState==='signedIn'?'synced':'local'} onSignOut={authState==='signedIn'?handleSignOut:null}/>;
}

/* ────────────────────────────────────────────────────────────────────────────
SETUP NOTES — cross-device / friend sync via Firebase (optional)

1. console.firebase.google.com → Add project → name it anything.
2. Build > Authentication > Get started > enable Email/Password sign-in.
3. Authentication > Users > Add user — one per person you want to share with.
   There's no public sign-up screen in the app, so only people you add here
   can ever sign in (and use your Anthropic usage via this artifact's AI
   features, which actually bills to whichever Claude account is viewing the
   artifact, not to you, when published).
4. Build > Firestore Database > Create database (production mode).
5. Firestore > Rules tab, paste this, then Publish:

   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{userId}/data/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == userId;
       }
     }
   }

6. Project settings (gear icon) > General > scroll to "Your apps" > Web app
   (</> icon) > register an app (no Hosting needed) > copy the config shown.
7. Paste the apiKey and projectId into the firebaseConfig object near the top
   of this file, then republish the artifact.

Each person you add in step 3 gets their own completely private data —
the security rule above guarantees one person's outings/gear/waters can
never be read or written by anyone else's account.
────────────────────────────────────────────────────────────────────────────

SETUP NOTES — Anthropic API key (required for standalone deployment)

Inside a published Claude.ai artifact, no key is needed — calls are proxied
automatically. Deployed standalone, this project uses a bring-your-own-key
model instead of a single site-wide key: each visitor enters their own
Anthropic key in the Settings tab, stored only in their browser (synced to
their account if signed in). No key of any kind lives in this file or in
any build-time environment variable — nothing to inject, nothing that ships
to every visitor's browser.

What actually makes a request work, in order:
1. The visitor pastes their key into Settings — it's saved locally (and to
   their Firestore account data if signed in), never sent anywhere except
   step 3 below, per-request.
2. This file calls POST /api/claude (a same-origin path, not Anthropic's API
   directly) with that key in an x-api-key header.
3. A serverless function at api/claude.js (must live at that exact path —
   Vercel only auto-detects functions inside a top-level /api folder) reads
   that header, forwards the request to api.anthropic.com server-side with
   the correct anthropic-version header, and relays the response back.

To deploy this correctly:
1. Confirm api/claude.js exists at your project ROOT (sibling to package.json
   and src/, not inside src/) — Vercel's file-based routing requires this
   exact location to detect it as a serverless function at all. A copy
   sitting anywhere else (e.g. loose at the root, or inside src/) will not
   be deployed as a function and every AI request will fail.
2. Deploy normally — Vercel picks up /api functions automatically, no extra
   config needed for this part.
3. Each visitor (including you) opens the Settings tab and pastes their own
   key from console.anthropic.com. The header's "🤖 AI Ready" / "⚠ No AI Key"
   badge reflects that visitor's own key status, not a site-wide setting.

Real tradeoff worth knowing: usage is billed to whichever visitor's key is
in use — you are not paying for other people's usage, and they aren't
paying for yours. Each person should set a spending limit on their own
Anthropic account (console.anthropic.com > billing).
────────────────────────────────────────────────────────────────────────────

SETUP NOTES — Brand assets (logo, favicon)

logo-512.png, logo-192.png, favicon-64.png, and favicon-32.png ship alongside
this file. For the standalone deployment, drop them in your Vite project's
/public folder (referenced here as /logo-192.png) — the header and sign-in
screen logo will pick it up automatically. If the file isn't found (e.g.
inside a Claude.ai artifact, which can't host static files), the UI falls
back to a gradient glyph automatically — nothing breaks either way.
Set favicon-32.png as your favicon in index.html's <link rel="icon"> tag.
──────────────────────────────────────────────────────────────────────────── */
