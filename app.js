/* ============================== CONFIG ============================== */
const JSONBIN_BIN_ID = '6a0fbeda6877513b27b14732';
const JSONBIN_KEY    = '$2a$10$Suhd6ugh.yjzb8tt/KynCuzQNrHQtw0xZSCQRjrpx9893YzyKheoa';
const JSONBIN_URL    = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`;
const LS_DATA_PREFIX = 'wt_data:';   // per-user cache → wt_data:<username>
const LS_DATA_LEGACY = 'wt_data';    // pre-multiuser cache, migrated on first run
const LS_USDA = 'wt_usdakey';        // optional per-device USDA key override
const USDA_DEMO = 'DEMO_KEY';        // last-resort shared demo key (rate-limited)
// Built-in keys so the app works on EVERY device with zero setup. These are free and
// instantly regenerable — if ever abused, make new ones and update these two lines.
const USDA_DEFAULT = 'r9tS5Ljq8hHc58F59Ent66sw6E3gfyiTAvkF6ybN';
const CN_DEFAULT   = 'lbc1HTZX5PZfBRFmCQVjjm9VaPbQoZmrTwx95gWu';
const usdaKey = () => (localStorage.getItem(LS_USDA)||'').trim() || USDA_DEFAULT || USDA_DEMO;
const LS_CN   = 'wt_cnkey';          // optional per-device CalorieNinjas key override
const cnKey   = () => (localStorage.getItem(LS_CN)||'').trim() || CN_DEFAULT;
// Anthropic key for in-app body-scan vision. PAID key — set a low ($1/mo) spend cap in the
// Anthropic console before embedding, since this repo is public. Blank = scanning disabled until
// a key is pasted in ⚙ Settings. ~$0.003/scan on Haiku.
const LS_AI   = 'wt_aikey';
const AI_DEFAULT = '';
const AI_MODEL   = 'claude-haiku-4-5';
const aiKey   = () => (localStorage.getItem(LS_AI)||'').trim() || AI_DEFAULT;
// Daily macro targets — defaults are the FDA Daily Values for a 2,000-calorie diet
// (https://www.fda.gov/food/nutrition-facts-label). Stored in DATA so they sync across devices.
const DEFAULT_GOALS = {cal:2000, p:50, c:275, f:78, fib:28, sod:2300};
const goals = () => ({...DEFAULT_GOALS, ...(DATA.goals||{})});

/* ============================== AUTH ============================== */
// Hardcoded baseline. Repo is public so passwords are weak by design — the gate's job is to
// scope which profile a session reads/writes, not to defend against attackers. These can never
// be removed via the UI (acts as a rescue path if dynamic users get into a bad state).
const BUILTIN_USERS = {
  MPoretz:  { password:'Baloo123', type:'personal', displayName:'Max' },
  MaxCoach: { password:'Coach123', type:'trainer',  displayName:'Max (Coach)', trainees:['MPoretz'] },
};
// Dynamically-added user accounts + per-trainer trainee links. Source of truth is the bin
// (bin._users / bin._trainees); mirrored to localStorage so the login overlay can validate
// known users without waiting for the network.
let dynUsers    = {};
let dynTrainees = {};

const LS_USER     = 'wt_currentUser';
const LS_ACTIVE   = 'wt_activeProfile';   // per-device — trainers can pick a trainee to view
const LS_DYNU     = 'wt_dynUsers';
const LS_DYNT     = 'wt_dynTrainees';
const currentUser = () => localStorage.getItem(LS_USER) || '';

function getUser(name){ return BUILTIN_USERS[name] || dynUsers[name] || null; }
function traineesOf(trainerName){
  if(Object.prototype.hasOwnProperty.call(dynTrainees, trainerName)){
    return dynTrainees[trainerName] || [];
  }
  const u = BUILTIN_USERS[trainerName];
  return (u && u.trainees) || [];
}
const userMeta = () => getUser(currentUser());

// Profiles a trainer can choose between (own + linked trainees that still resolve).
// Personal accounts get back just [self], so the dropdown collapses to nothing.
function availableProfiles(){
  const me = userMeta();
  if(!me) return [];
  if(me.type === 'trainer'){
    return [currentUser(), ...traineesOf(currentUser()).filter(t => getUser(t))];
  }
  return [currentUser()];
}
function currentProfile(){
  const me = currentUser();
  if(!me) return '';
  const stored = localStorage.getItem(LS_ACTIVE) || '';
  if(stored && availableProfiles().includes(stored)) return stored;
  if(stored) localStorage.removeItem(LS_ACTIVE);   // clean up stale selection
  return me;
}
const lsDataKey = () => LS_DATA_PREFIX + currentProfile();

function loadCachedUsers(){
  try{ dynUsers    = JSON.parse(localStorage.getItem(LS_DYNU)) || {}; }catch(e){ dynUsers = {}; }
  try{ dynTrainees = JSON.parse(localStorage.getItem(LS_DYNT)) || {}; }catch(e){ dynTrainees = {}; }
}
function saveCachedUsers(){
  localStorage.setItem(LS_DYNU, JSON.stringify(dynUsers));
  localStorage.setItem(LS_DYNT, JSON.stringify(dynTrainees));
}
// Refresh dyn users from the bin (so a trainee added on another device can log in here).
// Called on background after showing the login overlay and as a side-effect of fetchRemote.
async function fetchAndCacheUsers(){
  const raw = await fetchBin();
  if(!raw) return;
  const bin = migrateBin(raw);
  binCache = bin;
  dynUsers    = bin._users    || {};
  dynTrainees = bin._trainees || {};
  saveCachedUsers();
}

function validateAuth(u, p){
  const meta = getUser(u);
  return !!(meta && meta.password === p);
}
async function attemptLogin(u, p){
  if(validateAuth(u, p)){ localStorage.setItem(LS_USER, u); return true; }
  // User may have been added on another device since our cache loaded — refresh and retry.
  await fetchAndCacheUsers();
  if(validateAuth(u, p)){ localStorage.setItem(LS_USER, u); return true; }
  return false;
}
function doLogout(){
  localStorage.removeItem(LS_USER);
  location.reload();
}
function showLoginGate(){
  document.body.classList.add('locked');
  const form = document.getElementById('login-form');
  const err  = document.getElementById('login-err');
  form.onsubmit = async (e)=>{
    e.preventDefault();
    err.style.display = 'none';
    const u = document.getElementById('login-user').value.trim();
    const p = document.getElementById('login-pass').value;
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in…';
    const ok = await attemptLogin(u, p);
    if(ok){ location.reload(); return; }
    submitBtn.disabled = false;
    submitBtn.textContent = 'Sign in';
    err.textContent = 'Invalid username or password.';
    err.style.display = 'block';
  };
}

const GROUPS = [
  {id:'back-bicep',   name:'Back & Bicep',  kind:'lift'},
  {id:'chest-tricep', name:'Chest & Tricep',kind:'lift'},
  {id:'legs',         name:'Legs',          kind:'lift'},
  {id:'abs',          name:'Abs & Core',    kind:'lift'},
  {id:'cardio',       name:'Cardio',        kind:'cardio'},
];
const SEED = {
  'back-bicep':  ['Lat Pulldown','Seated Cable Row','Barbell Row','Pull-Up','Dumbbell Bicep Curl','Hammer Curl','Face Pull'],
  'chest-tricep':['Barbell Bench Press','Incline Dumbbell Press','Machine Chest Fly','Tricep Pushdown','Overhead Tricep Extension','Dips'],
  'legs':        ['Back Squat','Leg Press','Romanian Deadlift','Leg Extension','Seated Leg Curl','Calf Raise'],
  'abs':         ['Cable Crunch','Hanging Leg Raise','Plank','Russian Twist','Bicycle Crunch','Ab Wheel Rollout','Decline Sit-Up'],
  'cardio':      ['Treadmill','Bike','Rowing Machine','Elliptical','Stairmaster','Volleyball'],
};
const demoUrl = name => `https://www.youtube.com/results?search_query=${encodeURIComponent(name+' proper form')}`;

// Daily-total cardio metrics (one number per day, not weight×reps sets). Auto-created in the
// Cardio group and fed by the Apple Health import or manual entry. dec = decimal places shown.
const METRICS = {
  steps:    {name:'Steps',            unit:'steps', dec:0, color:'#34d399', hk:'StepCount'},
  distance: {name:'Walking Distance', unit:'mi',    dec:2, color:'#22d3ee', hk:'DistanceWalkingRunning'},
};

// Body-composition metrics from a smart-scale screenshot (Body tab). Order = display order.
// key → {label, unit, dec}. Weight is kept separately in DATA.body (existing chart/Health import).
const BODYCOMP = {
  bf:     {label:'Body Fat',        unit:'%',    dec:1, color:'#ff6b4a'},
  mm:     {label:'Muscle Mass',     unit:'lb',   dec:1, color:'#34d399'},
  water:  {label:'Body Water',      unit:'%',    dec:1, color:'#22d3ee'},
  bmi:    {label:'BMI',             unit:'',     dec:1, color:'#f5c542'},
  skm:    {label:'Skeletal Muscle', unit:'%',    dec:1, color:'#4ade80'},
  ffm:    {label:'Fat-Free Mass',   unit:'lb',   dec:1, color:'#7dd3fc'},
  subfat: {label:'Subcutaneous Fat',unit:'%',    dec:1, color:'#fb923c'},
  visc:   {label:'Visceral Fat',    unit:'',     dec:0, color:'#f87171'},
  prot:   {label:'Protein',         unit:'%',    dec:1, color:'#a78bfa'},
  bone:   {label:'Bone Mass',       unit:'lb',   dec:1, color:'#cbd5e1'},
  metage: {label:'Metabolic Age',   unit:'yr',   dec:0, color:'#facc15'},
  bmr:    {label:'BMR',             unit:'kcal', dec:0, color:'#86efac'},
};

/* ============================== STATE ============================== */
let DATA = { workouts:{}, food:{}, body:{}, comp:{}, _updated:0 };
let pendingScan = null;            // last screenshot-extracted comp values awaiting review
let bodyMetric = 'weight';         // which series the Body chart shows
let bodyLogOpen = false;           // manual log + Apple Health collapse (off by default — rarely used)
try{ bodyLogOpen = JSON.parse(localStorage.getItem('wt_bodylog'))||false; }catch(e){}
let nutDay = todayStr();          // active nutrition date
let pushTimer = null;
let collapsed = {};               // per-group collapse state (workouts tab)
try{ collapsed = JSON.parse(localStorage.getItem('wt_collapsed'))||{}; }catch(e){}

/* ============================== HELPERS ============================== */
function todayStr(){
  const d = new Date(); const p = n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}
function fmtDate(s){
  const [y,m,d] = s.split('-').map(Number);
  return new Date(y,m-1,d).toLocaleDateString('en-US',{month:'short',day:'numeric'});
}
function fmtDateLong(s){
  const [y,m,d] = s.split('-').map(Number);
  return new Date(y,m-1,d).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
}
function fmtTime(ms){ return new Date(ms).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}); }
function lastSetTime(sets){ const ts=(sets||[]).map(s=>s.t).filter(Boolean); return ts.length?Math.max(...ts):null; }
// most-recent-activity epoch ms for an exercise (set timestamp if present, else last session date) — used to sort recently-worked exercises to the top
function lastActivity(w){
  const dts=sortedDates((w||{}).sessions); if(!dts.length) return (w||{}).created||0;
  const last=dts[dts.length-1], sets=w.sessions[last];
  if(Array.isArray(sets)){ const lt=lastSetTime(sets); if(lt) return lt; }
  return new Date(last+'T00:00:00').getTime();
}
function sessionOutput(sets){ return (sets||[]).reduce((a,s)=>a + (s.w||0)*(s.r||0), 0); }
function sessionReps(sets){ return (sets||[]).reduce((a,s)=>a + (s.r||0), 0); }
// dumbbell = two separate weights → double the volume. rowing stores w=distance(km), r=time(min); pace=km/min, no output.
function dbMult(w){ return (w && w.db) ? 2 : 1; }
function isRow(w){ return !!(w && w.row); }
// bike mode: w=distance(miles), r=time(min), shown as MPH pace; no output number
function isBike(w){ return !!(w && w.bike && groupKind(w.group)==='cardio'); }
// time-only cardio (sports like volleyball/basketball): just log minutes, no speed/level
function isTimeOnly(w){ return !!(w && w.timeOnly && groupKind(w.group)==='cardio'); }
// timed-hold mode (planks etc.): store r=time(min, from min:sec), w=optional added weight (0=bodyweight)
function isHold(w){ return !!(w && w.hold); }
function sessionBestHold(sets){ return (sets||[]).reduce((a,s)=>Math.max(a, s.r||0), 0); }   // longest single hold (min)
// reps-only mode: Abs exercises (except planks/holds) just count reps — no weight field at all.
// Opt back into weight×reps per-exercise with a `weighted` flag (e.g. ab crunch machine).
function isRepsOnly(w){ return !!(w && w.group==='abs' && !isHold(w) && !w.weighted); }
function sessionBestReps(sets){ return (sets||[]).reduce((a,s)=>Math.max(a, s.r||0), 0); }    // most reps in a single set
function workoutOutput(w, sets){ return sessionOutput(sets) * dbMult(w); }
function sessionDist(sets){ return (sets||[]).reduce((a,s)=>a + (s.w||0), 0); }       // meters (rowing)
function pace(s){ return (s.r>0) ? (s.w||0)/1000/s.r : 0; }                           // km/min (from meters)
function sessionPace(sets){ const t=sessionReps(sets); return t>0 ? sessionDist(sets)/1000/t : 0; }
function fmtPace(p){ return (Math.round(p*1000)/1000).toLocaleString(undefined,{maximumFractionDigits:3}); }
// bike: w=miles, r=min → mph
function sessionMiles(sets){ return (sets||[]).reduce((a,s)=>a + (s.w||0), 0); }
function mph(s){ return (s.r>0) ? (s.w||0)*60/s.r : 0; }
function sessionMph(sets){ const t=sessionReps(sets); return t>0 ? sessionMiles(sets)*60/t : 0; }
function fmtMph(p){ return (Math.round(p*10)/10).toLocaleString(undefined,{maximumFractionDigits:1}); }
// decimal minutes → "mm:ss" for rowing time display
function fmtDur(min){ let m=Math.floor(min||0), s=Math.round(((min||0)-m)*60); if(s===60){m++;s=0;} return `${m}:${String(s).padStart(2,'0')}`; }
// "mm:ss" entered as separate fields → decimal minutes stored in r
function minSecToMin(mn, sc){ return (parseFloat(mn)||0) + (parseFloat(sc)||0)/60; }

// ============================== CARDIO MODE REGISTRY ==============================
// Adding a cardio mode = add an entry here, not patches at 10 render sites.
// Each mode supplies: how a set renders (chip + read-only desc/so), the table headline,
// the modal log form layout, the modal chart, and the prior-day summary.
// `flag` is the per-exercise bool on w (e.g. w.row, w.bike); cardioMode(w) picks the
// first matching one, default last. Toggling a mode clears the other cardio flags.
const CARDIO_MODES = {
  row: {
    flag: 'row',
    toggleLabel: 'Rowing mode — log distance &amp; time, show km/min',
    layout: 'w-time',   // log form: Distance + Min/Sec
    wLabel: 'Distance (m)', wPh: '5000', editWLabel: 'Dist (m)', minPh: '20',
    chip:    s => `${s.w}m in ${fmtDur(s.r)} · ${fmtPace(pace(s))} km/min`,
    setDesc: s => `${s.w} m in ${fmtDur(s.r)}`,
    setSo:   s => `${fmtPace(pace(s))} km/min`,
    headline: sets => fmtPace(sessionPace(sets)),
    headlineUnit: 'km/min', headlineCol: 'Pace',
    chartLabel: 'Pace (km/min)', chartColor: '#22d3ee',
    chartPt: (sets) => sessionPace(sets),
    chartFmt: v => fmtPace(v),
    summary: sets => `${sessionDist(sets)} m · ${fmtPace(sessionPace(sets))} km/min`,
  },
  bike: {
    flag: 'bike',
    toggleLabel: 'Bike mode — log distance (mi) &amp; time (min), show MPH',
    layout: 'w-time',
    wLabel: 'Distance (mi)', wPh: '10', editWLabel: 'Dist (mi)', minPh: '30',
    chip:    s => `${s.w} mi in ${fmtDur(s.r)} · ${fmtMph(mph(s))} mph`,
    setDesc: s => `${s.w} mi in ${fmtDur(s.r)}`,
    setSo:   s => `${fmtMph(mph(s))} mph`,
    headline: sets => fmtMph(sessionMph(sets)),
    headlineUnit: 'mph', headlineCol: 'Pace (mph)',
    chartLabel: 'Pace (mph)', chartColor: '#22d3ee',
    chartPt: (sets) => sessionMph(sets),
    chartFmt: v => fmtMph(v),
    summary: sets => `${sessionMiles(sets).toLocaleString(undefined,{maximumFractionDigits:2})} mi · ${fmtMph(sessionMph(sets))} mph`,
  },
  timeOnly: {
    flag: 'timeOnly',
    toggleLabel: 'Sport mode — just log minutes (volleyball, basketball, etc.)',
    layout: 'r-only',   // log form: just Minutes
    rLabel: 'Minutes', rPh: '60',
    chip:    s => `${s.r} min`,
    setDesc: s => `${s.r} min`,
    setSo:   () => '',
    headline: sets => Math.round(sessionReps(sets)),
    headlineUnit: 'min', headlineCol: 'Total Min',
    chartLabel: 'Total Min', chartColor: '#34d399',
    chartPt: (sets) => sessionReps(sets),
    chartFmt: v => v.toLocaleString(),
    summary: sets => `${sessionReps(sets)} min`,
  },
  // Default cardio = speed/level + minutes (treadmill, elliptical, stairmaster).
  default: {
    flag: null,
    layout: 'w-r',
    wLabel: 'Speed/Level', wPh: '6.0', editWLabel: 'Spd/Lvl',
    rLabel: 'Minutes', rPh: '30',
    chip:    s => `${s.r}min @ ${s.w}`,
    setDesc: s => `${s.r} min @ level ${s.w}`,
    setSo:   (s,w) => (s.w*s.r*dbMult(w)).toLocaleString(),
    headline: (sets,w) => workoutOutput(w,sets).toLocaleString(),
    headlineUnit: 'work', headlineCol: 'Work',
    chartLabel: 'Work', chartColor: '#34d399',
    chartPt: (sets,w) => workoutOutput(w,sets),
    chartFmt: v => v.toLocaleString(),
    summary: sets => `${sessionReps(sets)} min`,
  },
};
function cardioMode(w){
  for(const k in CARDIO_MODES){
    const m = CARDIO_MODES[k];
    if(m.flag && w && w[m.flag]) return m;
  }
  return CARDIO_MODES.default;
}
// All mode-toggle keys (used to render the cardio modal's mode toggles and to clear flags
// when switching modes). Excludes 'default' (which has no flag).
const CARDIO_MODE_KEYS = Object.keys(CARDIO_MODES).filter(k => CARDIO_MODES[k].flag);
// Modal log-form inputs for the active cardio mode. Layouts:
//   r-only  — one Minutes field (sport)
//   w-time  — Distance + Min/Sec (row, bike)
//   w-r     — Speed/Level + Minutes (default cardio)
function cardioLogInputsHtml(cm){
  if(cm.layout === 'r-only')
    return `<div class="field"><label>${cm.rLabel}</label><input class="num" id="in-r" type="number" inputmode="decimal" step="any" placeholder="${cm.rPh}"></div>`;
  if(cm.layout === 'w-time')
    return `<div class="field"><label>${cm.wLabel}</label><input class="num" id="in-w" type="number" inputmode="decimal" step="any" placeholder="${cm.wPh}"></div>
            <div class="field"><label>Min</label><input class="num" id="in-min" type="number" inputmode="numeric" step="any" placeholder="${cm.minPh}" style="width:70px"></div>
            <div class="field"><label>Sec</label><input class="num" id="in-sec" type="number" inputmode="numeric" step="any" placeholder="0" style="width:70px"></div>`;
  return `<div class="field"><label>${cm.wLabel}</label><input class="num" id="in-w" type="number" inputmode="decimal" step="any" placeholder="${cm.wPh}"></div>
          <div class="field"><label>${cm.rLabel}</label><input class="num" id="in-r" type="number" inputmode="decimal" step="any" placeholder="${cm.rPh}"></div>`;
}
// per-set chip text (table). Cardio defers to its mode; lifts handle dumbbell/hold/repsOnly inline.
function setText(w, s){
  if(groupKind(w.group)==='cardio') return cardioMode(w).chip(s);
  if(isHold(w)) return `${fmtDur(s.r)}${s.w?` · ${s.w} lb`:''}`;
  if(isRepsOnly(w)) return `${s.r} reps`;
  return w.db ? `${s.r}×${s.w}s` : `${s.r}×${s.w}`;
}
// read-only line for a set: {desc, so(output)} — shared by today's list + prior-day view
function setDescSo(w, s){
  if(groupKind(w.group)==='cardio'){
    const cm = cardioMode(w);
    return { desc: cm.setDesc(s), so: cm.setSo(s, w) };
  }
  if(isHold(w))      return { desc: `${fmtDur(s.r)} hold${s.w?` · ${s.w} lb`:''}`, so: '' };
  if(isRepsOnly(w))  return { desc: `${s.r} reps`, so: '' };
  return { desc: `${s.r} reps @ ${s.w}${w.db?'s':' lb'}`, so: (s.w*s.r*dbMult(w)).toLocaleString() };
}
// progression highlight for a lift's latest set vs the one before it (same day)
function setHighlight(w, sets){
  if(!sets || sets.length<2 || groupKind(w.group)==='cardio' || isMetric(w) || isHold(w) || isRepsOnly(w)) return '';
  const a=sets[sets.length-2], b=sets[sets.length-1];
  // every lift set gets a color vs the prior set: matched/beat = green, pushed heavier but fewer reps = red, otherwise = yellow (still grinding)
  if(b.w>=a.w && b.r>=a.r) return 'hl-green';
  if(b.w> a.w && b.r< a.r) return 'hl-red';
  return 'hl-yellow';
}
function sortedDates(obj){ return Object.keys(obj||{}).sort(); }      // asc
function groupKind(gid){ return (GROUPS.find(g=>g.id===gid)||{}).kind; }
function isMetric(w){ return !!(w && w.metric); }
function metricInfo(w){ return METRICS[w.metric]; }
function fmtMetricVal(w, v){ return v==null?'—':(+v).toLocaleString(undefined,{maximumFractionDigits:metricInfo(w).dec}); }

// ── Calorie burn ──────────────────────────────────────────────────────────────
// Strength: cal ≈ 0.035 × total weight moved (lb) + 0.1 × bodyweight (lb) × hours.
//   The 0.1·bw·hours term is the time-on-feet cost — applied ONCE per day over the whole
//   gym session (first→last lift timestamp), NOT per exercise, so it isn't multiplied up.
// Cardio: MET formula → cal = MET × bodyweight (kg) × hours, using the logged minutes.
const DEFAULT_BW = 182;                       // lb, fallback if no body weight logged
// Mifflin-St Jeor BMR (resting energy expenditure). Hardcoded user stats per memory:
// 6'1" (185.42 cm), male, ~28 yr. Updates the day-burn floor with whatever weight is logged.
const USER_HEIGHT_CM = 185.42, USER_AGE = 28;
function bmr(lb){ const kg = lb/2.205; return 10*kg + 6.25*USER_HEIGHT_CM - 5*USER_AGE + 5; }
// resting calories burned across a date — prorate today by elapsed hours so net cal is meaningful mid-day
function restingBurn(date){
  const full = bmr(bwOn(date));
  if(date !== todayStr()) return full;
  const now = new Date();
  const elapsedHr = (now.getHours()*60 + now.getMinutes()) / 60;
  return full * (elapsedHr/24);
}
// body weight as of a given date: most recent reading on or before it
function bwOn(date){
  const dts=sortedDates(DATA.body); if(!dts.length) return DEFAULT_BW;
  let bw=DATA.body[dts[0]];
  for(const d of dts){ if(d<=date) bw=DATA.body[d]; else break; }
  return bw;
}
// rough MET by cardio exercise name (keyword match), generic 7 if unknown
function cardioMET(name){
  const n=(name||'').toLowerCase();
  if(/jump ?rope|skipping/.test(n)) return 11;
  if(/treadmill|run|jog|sprint/.test(n)) return 9;
  if(/stair|step ?mill|stairmaster/.test(n)) return 9;
  if(/swim/.test(n)) return 8;
  if(/soccer|football(?!\s*american)/.test(n)) return 7;
  if(/basketball/.test(n)) return 6.5;
  if(/volleyball/.test(n)) return 4;          // recreational pickup; competitive ~6, beach ~8
  if(/trampoline|rebound/.test(n)) return 4.5; // recreational bouncing ~3.5, vigorous workout ~6
  if(/tennis|pickleball/.test(n)) return 7;
  if(/hike|hiking/.test(n)) return 6;
  if(/row/.test(n)) return 7;
  if(/bike|cycl|spin/.test(n)) return 7;
  if(/elliptical/.test(n)) return 5;
  if(/walk/.test(n)) return 3.8;
  if(/yoga|stretch/.test(n)) return 2.5;
  return 7;
}
// calories from a daily walking metric value (Walking Distance miles, or Steps)
function metricBurn(w, date, val){
  if(!isMetric(w) || val==null) return 0;
  const bw=bwOn(date);
  if(w.metric==='distance') return 0.53 * bw * val;          // MET 3.5 walking, ~96 cal/mi @ 182 lb
  if(w.metric==='steps')    return 0.53 * bw * (val/2000);   // fallback: ~2000 steps/mile
  return 0;
}
// calories burned for one cardio session (sets on `date`)
function sessionBurn(name, w, sets, date){
  if(groupKind(w.group)!=='cardio' || isMetric(w)) return 0;
  const min = sessionReps(sets);
  if(!(min>0)) return 0;
  return cardioMET(name) * (bwOn(date)/2.205) * (min/60);
}
// total calories burned across every workout logged on `date`
function dayBurn(date){
  const bwLb=bwOn(date), bwKg=bwLb/2.205;
  let weightMoved=0, liftSets=0, tMin=Infinity, tMax=-Infinity, nLift=0;
  let cardioCal=0, cardioMin=0, nCardio=0;
  let distV=null, stepV=null;                 // daily Apple-Health metrics
  for(const name in (DATA.workouts||{})){
    const w=DATA.workouts[name];
    if(isMetric(w)){
      const v = w.sessions && w.sessions[date];
      if(typeof v === 'number'){
        if(w.metric==='distance') distV=v;    // miles
        else if(w.metric==='steps') stepV=v;  // step count
      }
      continue;
    }
    const sets=w.sessions && w.sessions[date];
    if(!Array.isArray(sets) || !sets.length) continue;
    if(groupKind(w.group)==='cardio'){
      const min=sessionReps(sets);            // r = minutes (rowing r = decimal min)
      if(min>0){ cardioCal += cardioMET(name)*bwKg*(min/60); cardioMin+=min; nCardio++; }
    } else {
      weightMoved += workoutOutput(w, sets);
      liftSets += sets.length; nLift++;
      const ts=sets.map(s=>s.t).filter(Boolean);
      if(ts.length){ tMin=Math.min(tMin,...ts); tMax=Math.max(tMax,...ts); }
    }
  }
  // strength session duration (min): real span if ≥2 timestamps, else ~3 min/set
  let liftMin = (tMax>tMin) ? (tMax-tMin)/60000 : liftSets*3;
  const strengthCal = nLift ? (0.035*weightMoved + 0.1*bwLb*(liftMin/60)) : 0;
  // walking burn: prefer real miles; fall back to steps÷2000 only if no distance.
  // 0.53 × bw(lb) × mi ≡ MET 3.5 walking. ⚠ can overlap with treadmill cardio sessions.
  const miles = (distV!=null && distV>0) ? distV
              : (stepV!=null && stepV>0) ? stepV/2000 : 0;
  const walkCal = 0.53 * bwLb * miles;
  const restCal = restingBurn(date);
  return {total:strengthCal+cardioCal+walkCal+restCal,
          strength:strengthCal, cardio:cardioCal, walk:walkCal, rest:restCal,
          nLift, nCardio, liftMin, cardioMin, miles, steps:stepV||0,
          weightMoved, bw:bwLb};
}
function el(html){ const t=document.createElement('template'); t.innerHTML=html.trim(); return t.content.firstChild; }

/* ============================== SYNC ============================== */
function setSync(state, txt){
  const s = document.getElementById('sync');
  s.className = 'sync ' + state;
  document.getElementById('sync-txt').textContent = txt;
}
function stampUpdated(){
  document.getElementById('updated').textContent =
    'Updated ' + new Date(DATA._updated||Date.now()).toLocaleString('en-US',
      {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
}
// Bin schema v2: { _schema:2, <username>: <profile>, ... }. Pre-v2 was a single flat profile
// at the top level. binCache holds the last-known full bin so push can update OUR slice
// without clobbering others. Always refetched immediately before a PUT for safety.
let binCache = null;

function emptyProfile(){ return { workouts:{}, food:{}, body:{}, comp:{}, _updated:0 }; }

// Migrate a pre-v2 flat bin into the namespaced v2 layout. Idempotent.
function migrateBin(bin){
  if(!bin) return { _schema:2 };
  if(bin._schema === 2) return bin;
  const profile = {};
  for(const k of Object.keys(bin)){
    if(k === '_schema') continue;
    profile[k] = bin[k];
  }
  // Pre-v2 data was Max's. Park it under MPoretz so step 1 is transparent for him.
  return { _schema:2, MPoretz: profile };
}

function loadLocal(){
  // Try per-user cache first; fall back to legacy flat cache once for MPoretz (one-shot migration).
  try{
    const j = JSON.parse(localStorage.getItem(lsDataKey()));
    if(j){ DATA = j; return; }
  }catch(e){}
  if(currentUser() === 'MPoretz'){
    try{
      const j = JSON.parse(localStorage.getItem(LS_DATA_LEGACY));
      if(j){ DATA = j; localStorage.setItem(lsDataKey(), JSON.stringify(DATA)); }
    }catch(e){}
  }
}
function saveLocal(){ localStorage.setItem(lsDataKey(), JSON.stringify(DATA)); }

async function fetchBin(){
  try{
    const r = await fetch(`${JSONBIN_URL}/latest`, {headers:{'X-Master-Key':JSONBIN_KEY}});
    if(!r.ok) return null;
    const j = await r.json();
    return (j && j.record) || null;
  }catch(e){ return null; }
}
// Returns {bin, profile, migrated}. profile = bin[currentProfile()] (may be null on first login).
// Also syncs dyn users/trainees from the bin so multi-device add/remove propagates.
async function fetchRemote(){
  const raw = await fetchBin();
  if(!raw) return { bin:null, profile:null, migrated:false };
  const migrated = raw._schema !== 2;
  const bin = migrateBin(raw);
  binCache = bin;
  dynUsers    = bin._users    || {};
  dynTrainees = bin._trainees || {};
  saveCachedUsers();
  return { bin, profile: bin[currentProfile()] || null, migrated };
}
async function initSync(){
  loadLocal();
  setSync('saving','Syncing…');
  const {bin, profile, migrated} = await fetchRemote();
  if(profile && (profile._updated||0) >= (DATA._updated||0)){
    DATA = profile; saveLocal();
  } else if(DATA._updated && (!profile || DATA._updated > (profile._updated||0))){
    await pushRemote();   // local is newer — push it up (also persists migration)
  } else if(migrated){
    await pushRemote();   // persist the schema migration even if no profile changes
  }
  ensureSeed();
  ensureMetrics();
  ensureAbsSeed();
  ensurePlankHold();
  ensureVolleyball();
  ensureBikeMode();
  renderAll(); stampUpdated();
  renderProfileBar();   // dyn users may have changed elsewhere — refresh the dropdown
  if(bin) setSync('ok','Synced'); else setSync('off','Offline (using local)');
}
function save(){            // call after any mutation
  DATA._updated = Date.now();
  saveLocal(); stampUpdated();
  setSync('saving','Saving…');
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushRemote, 500);
}
// General-purpose GET-modify-PUT. `updates` is a partial bin object applied on top of
// the freshly-fetched bin (so concurrent edits to other slices aren't clobbered).
// Always writes the current in-memory dynUsers/dynTrainees, so user/trainee state stays aligned.
async function pushBin(updates){
  try{
    const fresh = migrateBin(await fetchBin());
    binCache = fresh;
    binCache._schema = 2;
    if(Object.keys(dynUsers).length)    binCache._users    = dynUsers;
    else                                delete binCache._users;
    if(Object.keys(dynTrainees).length) binCache._trainees = dynTrainees;
    else                                delete binCache._trainees;
    Object.assign(binCache, updates);
    const r = await fetch(JSONBIN_URL, {
      method:'PUT',
      headers:{'Content-Type':'application/json','X-Master-Key':JSONBIN_KEY},
      body: JSON.stringify(binCache)
    });
    setSync(r.ok?'ok':'off', r.ok?'Synced':'Offline (saved locally)');
    return r.ok;
  }catch(e){ setSync('off','Offline (saved locally)'); return false; }
}
async function pushRemote(){ return pushBin({ [currentProfile()]: DATA }); }
async function pushUsers(){  return pushBin({}); }
function ensureSeed(){
  if(Object.keys(DATA.workouts).length) return;
  for(const gid in SEED){
    for(const name of SEED[gid]){
      DATA.workouts[name] = { group:gid, demo:demoUrl(name), sessions:{} };
    }
  }
  saveLocal();
}
// Make sure the daily-total cardio metrics (Steps, Walking Distance) always exist.
function ensureMetrics(){
  let created = false;
  for(const id in METRICS){
    const nm = METRICS[id].name;
    if(!DATA.workouts[nm]){ DATA.workouts[nm] = { group:'cardio', metric:id, sessions:{} }; created = true; }
    else if(!DATA.workouts[nm].metric){ DATA.workouts[nm].metric = id; created = true; }   // backfill an old entry
  }
  if(created) saveLocal();
}
// Backfill the Abs & Core group's seed exercises on installs that predate it.
// Guarded by a SYNCED flag (DATA._absSeeded) so it runs once across all devices and
// so deletions stick (won't re-add an ab exercise you removed).
function ensureAbsSeed(){
  if(DATA._absSeeded) return;
  for(const name of SEED.abs){
    if(!DATA.workouts[name]) DATA.workouts[name] = { group:'abs', demo:demoUrl(name), sessions:{} };
  }
  DATA._absSeeded = true;
  saveLocal();
}
// One-time: put the seeded Plank into timed-hold mode (time + optional weight). Synced flag so it
// runs once across devices and respects the user later toggling it off.
function ensurePlankHold(){
  if(DATA._plankHold) return;
  const p = DATA.workouts['Plank'];
  if(p && !isHold(p)) p.hold = true;
  DATA._plankHold = true;
  saveLocal();
}
// One-time: create cardio "Bike" in bike mode (miles + min, MPH). If an old "Stationary Bike"
// exists with no logged sessions, drop it; otherwise leave it alone so historical level-based
// data isn't reinterpreted as miles. Synced flag so it runs once across devices.
function ensureBikeMode(){
  if(DATA._bikeMode) return;
  const old = DATA.workouts['Stationary Bike'];
  if(old && !Object.keys(old.sessions||{}).length) delete DATA.workouts['Stationary Bike'];
  if(!DATA.workouts['Bike'])
    DATA.workouts['Bike'] = { group:'cardio', demo:demoUrl('Bike'), sessions:{}, bike:true, created:Date.now() };
  else if(!DATA.workouts['Bike'].bike)
    DATA.workouts['Bike'].bike = true;
  DATA._bikeMode = true;
  saveLocal();
}
// One-time: add Volleyball to cardio in time-only mode for existing installs. Synced flag.
function ensureVolleyball(){
  if(DATA._volleyballSeeded) return;
  if(!DATA.workouts['Volleyball'])
    DATA.workouts['Volleyball'] = { group:'cardio', demo:demoUrl('Volleyball'), sessions:{}, timeOnly:true, created:Date.now() };
  else if(!DATA.workouts['Volleyball'].timeOnly)
    DATA.workouts['Volleyball'].timeOnly = true;          // also flag if ensureSeed just made it
  DATA._volleyballSeeded = true;
  saveLocal();
}

/* ============================== CHART ============================== */
// mini sparkline: points = array of {label, value}
function spark(points, color){
  if(!points.length) return `<svg class="spark"></svg>`;
  const W=200,H=46,pad=4;
  const vals = points.map(p=>p.value);
  let mn=Math.min(...vals), mx=Math.max(...vals);
  if(mn===mx){ mn=mn-1; mx=mx+1; }
  const n=points.length;
  const x = i => n===1 ? W/2 : pad + i*(W-2*pad)/(n-1);
  const y = v => H-pad - (v-mn)/(mx-mn)*(H-2*pad);
  let d = points.map((p,i)=>`${i?'L':'M'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  let dots = points.map((p,i)=>`<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="2.4" fill="${color}"/>`).join('');
  const area = `M${pad} ${H-pad} `+points.map((p,i)=>`L${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ')+` L${x(n-1).toFixed(1)} ${H-pad} Z`;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <path d="${area}" fill="${color}" opacity="0.12"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
    ${n<=14?dots:''}
  </svg>`;
}
// full line chart for body weight: points = [{label,value}]
function bigLine(points, color){
  if(points.length<1) return `<svg viewBox="0 0 600 240"></svg>`;
  const W=600,H=240,L=44,R=12,T=14,B=28;
  const vals=points.map(p=>p.value);
  let mn=Math.min(...vals), mx=Math.max(...vals);
  const span=(mx-mn)||1; mn-=span*0.1; mx+=span*0.1;
  const n=points.length;
  const x=i=> n===1? (L+(W-R-L)/2) : L + i*(W-R-L)/(n-1);
  const y=v=> T + (mx-v)/(mx-mn)*(H-T-B);
  const path=points.map((p,i)=>`${i?'L':'M'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  // y gridlines
  let grid='';
  for(let g=0;g<=4;g++){
    const v=mn+(mx-mn)*g/4, yy=y(v);
    grid+=`<line x1="${L}" y1="${yy.toFixed(1)}" x2="${W-R}" y2="${yy.toFixed(1)}" stroke="#2a2f3a" stroke-width="1"/>
      <text x="${L-6}" y="${(yy+3).toFixed(1)}" fill="#8b93a3" font-size="10" text-anchor="end">${v.toFixed(1)}</text>`;
  }
  // x labels (max ~6)
  let xlab=''; const step=Math.max(1,Math.ceil(n/6));
  points.forEach((p,i)=>{ if(i%step===0||i===n-1){
    xlab+=`<text x="${x(i).toFixed(1)}" y="${H-8}" fill="#8b93a3" font-size="10" text-anchor="middle">${p.label}</text>`;
  }});
  const dots = n<=40 ? points.map((p,i)=>`<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3" fill="${color}"/>`).join('') : '';
  return `<svg viewBox="0 0 ${W} ${H}">${grid}
    <path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"/>
    ${dots}${xlab}</svg>`;
}

/* ============================== RENDER: WORKOUTS ============================== */
// Most recent session date across a group's exercises (skips daily metrics like Steps so
// the header shows the last actual workout). Returns 'YYYY-MM-DD' or null.
function groupLastDate(gid){
  let best = null;
  for(const name in DATA.workouts){
    const w = DATA.workouts[name];
    if(w.group!==gid || isMetric(w)) continue;
    const dts = sortedDates(w.sessions);
    if(dts.length){ const d = dts[dts.length-1]; if(!best || d>best) best = d; }
  }
  return best;
}
// Sum of output across the group's exercises ONLY for the group's latest workout date.
// Exercises whose own latest session is older than the group's latest are excluded — so a
// back/bi workout that hit lat pulldown today but skipped palm-up pulldown won't roll the
// palm-up's last-week numbers into today's total. Cardio groups return null (no output).
function groupLastOutput(gid){
  const lastD = groupLastDate(gid);
  if(!lastD || groupKind(gid)==='cardio') return null;
  let total = 0;
  for(const name in DATA.workouts){
    const w = DATA.workouts[name];
    if(w.group!==gid || isMetric(w)) continue;
    const dts = sortedDates(w.sessions);
    if(!dts.length || dts[dts.length-1] !== lastD) continue;
    total += workoutOutput(w, w.sessions[lastD]);
  }
  return total;
}
function workoutsByGroup(gid){
  return Object.keys(DATA.workouts)
    .filter(n=>DATA.workouts[n].group===gid)
    .sort((a,b)=>{                                  // pin daily-total metrics to the top
      const wa=DATA.workouts[a], wb=DATA.workouts[b];
      const am=isMetric(wa), bm=isMetric(wb);
      if(am!==bm) return am?-1:1;
      if(am&&bm) return a.localeCompare(b);         // metrics: keep alphabetical
      const la=lastActivity(wa), lb=lastActivity(wb);
      if(la!==lb) return lb-la;                      // most recently worked first
      return a.localeCompare(b);                     // never logged: alphabetical
    });
}
// One workout's <tr> in the per-group table. Dispatches on cardio/hold/repsOnly/default-lift.
function workoutRowEl(name, w, cardio){
  const dts = sortedDates(w.sessions);
  const last = dts[dts.length-1];
  const sets = last ? w.sessions[last] : [];
  const hold = isHold(w), repsOnly = isRepsOnly(w);
  const cm = cardio ? cardioMode(w) : null;
  const hl = last ? setHighlight(w, sets) : '';
  const setsHtml = last
    ? sets.map((s,si)=>`<span class="set${(si===sets.length-1&&hl)?' '+hl:''}">${setText(w,s)}</span>`).join('')
    : '<span class="muted">—</span>';
  const burnCal = cardio && last ? Math.round(sessionBurn(name, w, sets, last)) : 0;
  const burnLine = burnCal>0 ? `<div class="out-sub">🔥 ${burnCal.toLocaleString()} cal</div>` : '';
  const outCell = !last ? '<span class="muted">—</span>'
    : cardio   ? `<span class="out-val">${cm.headline(sets,w)}</span> <span class="muted">${cm.headlineUnit}</span>${burnLine}`
    : hold     ? `<span class="out-val">${fmtDur(sessionBestHold(sets))}</span> <span class="muted">best</span>`
    : repsOnly ? `<span class="out-val">${sessionReps(sets).toLocaleString()}</span> <span class="muted">reps</span>`
               : `<span class="out-val">${workoutOutput(w,sets).toLocaleString()}</span> <span class="muted">lbs</span>`;
  const lt = last ? lastSetTime(sets) : null;
  const outLabel = cardio ? cm.headlineCol : hold ? 'Best Hold' : repsOnly ? 'Total Reps' : 'Output (lbs)';
  return el(`<tr>
    <td class="c-name"><span class="w-name" data-open="${encodeURIComponent(name)}">${name}</span>
        <span class="info-ic" data-demo="${encodeURIComponent(name)}" title="How to do it">ℹ</span></td>
    <td data-label="${outLabel}">${outCell}</td>
    <td data-label="Last">${last?fmtDate(last)+(lt?` · ${fmtTime(lt)}`:''):'<span class="muted">—</span>'}</td>
    <td class="sets-cell" data-label="Sets">${setsHtml}</td>
    <td class="c-del"><button class="del" data-del="${encodeURIComponent(name)}" title="Delete">×</button></td>
  </tr>`);
}
// Cardio-only Apple Health import block at the bottom of the cardio section.
function cardioHealthUploaderEl(){
  return el(`<div class="uploader" style="margin-top:14px">
    <div style="font-size:14px;font-weight:700">⬆ Import steps &amp; distance from Apple Health</div>
    <p>Health app → profile → <b>Export All Health Data</b> → unzip → upload <b>export.xml</b>.
       Sums your daily steps &amp; walking distance (and weight). Big files stream fine.</p>
    <div class="field" style="max-width:220px;margin:0 auto 10px"><label>Only import on/after</label><input type="date" id="c-from" value="2025-09-01"></div>
    <input type="file" id="c-file" accept=".xml">
    <div id="c-status" style="margin-top:8px;font-size:13px;color:var(--muted)"></div>
  </div>`);
}
// Section header (collapsible) for one muscle group / cardio.
function workoutSectionHeadEl(g, names){
  const lastD = groupLastDate(g.id);
  const lastOut = groupLastOutput(g.id);
  return el(`<div class="section-head" data-toggle="${g.id}">
    <span class="caret">${collapsed[g.id]?'▸':'▾'}</span>
    <h2>${g.name}</h2><span class="pill">${names.length}</span>
    <span class="sec-meta">
      <span class="sec-date${lastD?'':' none'}">${lastD?fmtDate(lastD):'no sessions'}</span>
      ${lastOut?`<span class="sec-output" title="Total output across exercises done on ${fmtDate(lastD)}">${Math.round(lastOut).toLocaleString()}</span>`:''}
    </span>
  </div>`);
}
function renderWorkouts(){
  const root = document.getElementById('view-workouts');
  root.innerHTML = '';
  root.appendChild(el(`<div class="legend">
    <span class="lg"><span class="sw hl-green"></span> Weight class completed</span>
    <span class="lg"><span class="sw hl-yellow"></span> Continue in weight class</span>
    <span class="lg"><span class="sw hl-red"></span> Lifted to failure</span>
  </div>`));
  for(const g of GROUPS){
    const names = workoutsByGroup(g.id);
    const cardio = g.kind==='cardio';
    const sec = el(`<div class="section"></div>`);
    sec.appendChild(workoutSectionHeadEl(g, names));
    if(!collapsed[g.id])
      sec.appendChild(el(`<button class="btn ghost sm add-full" data-add="${g.id}">+ Add ${cardio?'cardio':'workout'}</button>`));
    const body = el(`<div class="section-body"${collapsed[g.id]?' style="display:none"':''}></div>`);
    const wrap = el(`<div class="table-wrap"></div>`);
    if(!names.length){
      wrap.appendChild(el(`<div class="empty">No ${cardio?'cardio':'workouts'} yet — add one.</div>`));
    } else {
      const t = el(`<table><thead><tr>
        <th>${cardio?'Cardio':'Workout'}</th>
        <th>${cardio?'Last Work':'Last Output (lbs)'}</th>
        <th>Last Date</th>
        <th>Last Session Sets</th>
        <th></th></tr></thead><tbody></tbody></table>`);
      const tb = t.querySelector('tbody');
      for(const name of names){
        const w = DATA.workouts[name];
        tb.appendChild(isMetric(w) ? metricRow(name, w) : workoutRowEl(name, w, cardio));
      }
      wrap.appendChild(t);
    }
    body.appendChild(wrap);
    if(cardio) body.appendChild(cardioHealthUploaderEl());
    sec.appendChild(body);
    root.appendChild(sec);
  }
}
function toggleGroup(gid){
  collapsed[gid] = !collapsed[gid];
  try{ localStorage.setItem('wt_collapsed', JSON.stringify(collapsed)); }catch(e){}
  renderWorkouts();
}
// table row for a daily-total metric (Steps / Walking Distance)
function metricRow(name, w){
  const mi = metricInfo(w);
  const dts = sortedDates(w.sessions);
  const last = dts[dts.length-1];
  const val = last ? w.sessions[last] : null;
  const recent = dts.slice(-5).reverse()
    .map(d=>`<span class="set">${fmtDate(d)}: ${fmtMetricVal(w, w.sessions[d])}</span>`).join('')
    || '<span class="muted">—</span>';
  return el(`<tr>
    <td class="c-name"><span class="w-name" data-open="${encodeURIComponent(name)}">${name}</span>
        <span class="info-ic" data-open="${encodeURIComponent(name)}" title="View history">📈</span></td>
    <td data-label="Latest">${val==null?'<span class="muted">—</span>':`<span class="out-val">${fmtMetricVal(w,val)}</span> <span class="muted">${mi.unit}</span>${(()=>{const c=Math.round(metricBurn(w,last,+val));return c>0?`<div class="out-sub">🔥 ${c.toLocaleString()} cal</div>`:'';})()}`}</td>
    <td data-label="Last">${last?fmtDate(last):'<span class="muted">—</span>'}</td>
    <td class="sets-cell" data-label="Recent days">${recent}</td>
    <td class="c-del"></td>
  </tr>`);
}

/* ----- workout modal ----- */
let modalName = null, modalPriorDate = null, modalRange = '7d', editToday = false, editPrior = false;
let chartsOpen = (localStorage.getItem('wt_chartsOpen') !== '0');   // collapsible per-workout chart block (global toggle, default open)
// chart time-range filter
const RANGES = {'7d':7, '15d':15, '30d':30, '1y':365, 'all':null};
const RANGE_LABEL = {'7d':'7D', '15d':'15D', '30d':'30D', '1y':'1Y', 'all':'All'};
function rangeCutoff(range){
  if(!RANGES[range]) return null;
  const d = new Date(); d.setDate(d.getDate()-RANGES[range]);
  const p = n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}
function filterDates(dts){ const c = rangeCutoff(modalRange); return c ? dts.filter(d=>d>=c) : dts; }
function rangeToggle(){
  return `<div class="range-row">${Object.keys(RANGES).map(r=>
    `<button class="range-btn${modalRange===r?' active':''}" data-range="${r}">${RANGE_LABEL[r]}</button>`).join('')}</div>`;
}
function openWorkout(name){
  modalName = name; modalPriorDate = null; modalRange = '7d'; editToday = false; editPrior = false;   // default each open to 7 days, view mode
  renderModal();
  document.getElementById('w-overlay').classList.add('show');
}
function closeWorkout(){ document.getElementById('w-overlay').classList.remove('show'); modalName=null; }
// Read-only expanded view of one prior session — used to auto-show the last 3 sessions
// in the workout modal so the user doesn't have to click chips to see them.
function priorExpandedHtml(w, date){
  const gid=w.group, cardio=groupKind(gid)==='cardio', hold=isHold(w), repsOnly=isRepsOnly(w);
  const sets = w.sessions[date]||[];
  const summary = cardio   ? cardioMode(w).summary(sets)
    : hold     ? `best ${fmtDur(sessionBestHold(sets))}`
    : repsOnly ? `${sessionReps(sets)} reps`
    :            `output ${workoutOutput(w, sets).toLocaleString()}`;
  const list = sets.map((s,i)=>{
    const {desc, so} = setDescSo(w, s);
    const hl = (i===sets.length-1) ? setHighlight(w, sets) : '';
    return `<div class="set-line${hl?' '+hl:''}"><span>${desc}</span><span class="so">${so}</span></div>`;
  }).join('') || '<div class="muted" style="font-size:13px">No sets on this day.</div>';
  return `<div class="prior-expanded">
    <div class="pe-head"><b>${fmtDateLong(date)}</b> <span class="muted" style="font-size:12px">· ${summary}</span></div>
    <div class="today-sets">${list}</div>
  </div>`;
}
// ============================ WORKOUT MODAL ============================
// renderModal orchestrates; each section's HTML lives in its own helper below.

// Mode-toggle checkboxes at the top of the modal (cardio mode mutex, or lift flags).
function modalModeTogglesHtml(w, cm, hold, repsOnly){
  if(cm) return CARDIO_MODE_KEYS.map(k=>{ const cmk = CARDIO_MODES[k];
    return `<label class="opt"><input type="checkbox" data-cmode="${k}"${w[cmk.flag]?' checked':''}> ${cmk.toggleLabel}</label>`;
  }).join('');
  const isAbs = w.group==='abs';
  return `<label class="opt"><input type="checkbox" id="w-hold"${hold?' checked':''}> Timed hold (plank) — log time + optional added weight</label>
    ${(hold||isAbs)?'':`<label class="opt"><input type="checkbox" id="w-db"${w.db?' checked':''}> Dumbbell — two weights (shows &ldquo;35s&rdquo;, doubles output)</label>`}
    ${(isAbs&&!hold)?`<label class="opt"><input type="checkbox" id="w-wt"${w.weighted?' checked':''}> Track weight (weight × reps) — for machines/weighted ab work</label>`:''}`;
}
// Log-a-set field row. Lifts use Weight + Reps; cardio defers to its mode's layout.
function modalLogInputsHtml(cm, hold, repsOnly, cardio){
  if(hold) return `<div class="field"><label>Min</label><input class="num" id="in-min" type="number" inputmode="numeric" step="any" placeholder="1" style="width:70px"></div>
    <div class="field"><label>Sec</label><input class="num" id="in-sec" type="number" inputmode="numeric" step="any" placeholder="30" style="width:70px"></div>
    <div class="field"><label>Weight (lb) — optional</label><input class="num" id="in-w" type="number" inputmode="decimal" step="any" placeholder="bodyweight"></div>`;
  if(repsOnly) return `<div class="field"><label>Reps</label><input class="num" id="in-r" type="number" inputmode="numeric" step="any" placeholder="15"></div>`;
  if(cardio) return cardioLogInputsHtml(cm);
  return `<div class="field"><label>Weight</label><input class="num" id="in-w" type="number" inputmode="decimal" step="any" placeholder="135"></div>
    <div class="field"><label>Reps</label><input class="num" id="in-r" type="number" inputmode="numeric" step="any" placeholder="10"></div>`;
}
// "Today's sets" block: empty state, edit-mode editor, or read-only list with per-set delete.
function modalTodaySetsHtml(w, todaySets){
  const header = todaySets.length ? `<div class="block-title" style="display:flex;align-items:center;gap:8px;margin-top:14px">
    <span>Today's sets</span>
    <button class="btn ghost mini" id="edit-today" style="margin-left:auto">${editToday?'✓ Done':'✎ Edit'}</button>
  </div>` : '';
  let body;
  if(!todaySets.length) body = `<div class="muted" style="font-size:13px">No sets logged today yet.</div>`;
  else if(editToday)    body = editableSets(w, todayStr());
  else body = todaySets.map((s,i)=>{
    const hl = (i===todaySets.length-1) ? setHighlight(w, todaySets) : '';
    const {desc,so} = setDescSo(w, s);
    return `<div class="set-line${hl?' '+hl:''}"><span>${desc}</span><span class="so">${so}</span><button class="del" data-rm="${i}">×</button></div>`;
  }).join('');
  return `${header}<div class="today-sets" id="today-sets">${body}</div>`;
}
// Recent (top-3 expanded) + older (chip list + click-to-show detail) sessions.
function modalPriorSessionsHtml(w, dts, today, name){
  const priorAll = dts.filter(d=>d!==today).slice().reverse();   // newest first
  const top3 = priorAll.slice(0,3);
  const older = priorAll.slice(3);
  const expanded = top3.length
    ? `<div class="prior-expanded-list">${top3.map(d=>priorExpandedHtml(w,d)).join('')}</div>`
    : '<div class="muted" style="font-size:13px;margin-top:6px">No prior sessions.</div>';
  const chips = older.length
    ? `<div class="prior-list" id="prior-list">${older.map(d=>
        `<span class="prior-chip${modalPriorDate===d?' active':''}" data-prior="${d}">${fmtDate(d)}</span>`).join('')}</div>`
    : '';
  return `<div class="block-title">Recent sessions</div>${expanded}${
    older.length?`<div class="block-title" style="font-size:13px;margin-top:14px">Older sessions</div>${chips}
    <div class="prior-detail" id="prior-detail">${priorDetailHtml(name)}</div>`:''}`;
}
// Trends section (collapsible) — 3 chart cards: headline, reps/min total, sets count.
function modalChartsHtml(cardio, cm, hold, repsOnly, ptsOut, ptsRep, ptsSet, lastOut, lastRep, lastSet){
  const header = `<div class="block-title" style="display:flex;align-items:center;gap:8px;margin-top:18px">
    <span>📈 Trends</span>
    <button class="btn ghost mini" id="charts-toggle" style="margin-left:auto">${chartsOpen?'▾ Hide':'▸ Show'}</button>
  </div>`;
  if(!chartsOpen) return header;
  const card1Label = cm?cm.chartLabel:hold?'Longest Hold':repsOnly?'Best Set (reps)':'Total Output';
  const card1Val   = cm?cm.chartFmt(lastOut):hold?fmtDur(lastOut):lastOut.toLocaleString();
  const card2Label = hold?'Total Time':repsOnly?'Total Reps':(cardio?'Total Min':'Total Reps');
  const card2Val   = hold?fmtDur(lastRep):lastRep.toLocaleString();
  return `${header}${rangeToggle()}
    <div class="charts">
      <div class="chart-card"><div class="clab">${card1Label}</div>
        <div class="cval">${card1Val}<small> last</small></div>${spark(ptsOut, cm?cm.chartColor:'#34d399')}</div>
      <div class="chart-card"><div class="clab">${card2Label}</div>
        <div class="cval">${card2Val}<small> last</small></div>${spark(ptsRep,'#22d3ee')}</div>
      <div class="chart-card"><div class="clab">Sets</div>
        <div class="cval">${lastSet}<small> last</small></div>${spark(ptsSet,'#f5c542')}</div>
    </div>`;
}
// Read + validate the Log-a-set inputs. Returns {wv, rv} or null when invalid (and focuses the bad field).
function parseLoggedSet(cm, hold, repsOnly, cardio){
  const num = id => document.getElementById(id);
  const bad = (id) => { num(id).focus(); return null; };
  if(hold){                                   // time required, weight optional (blank = bodyweight = 0)
    const rv = minSecToMin(num('in-min').value, num('in-sec').value);
    let wv = parseFloat(num('in-w').value); if(isNaN(wv)) wv = 0;
    return rv>0 ? {wv, rv} : bad('in-min');
  }
  if(repsOnly){                               // abs: reps only, no weight
    const rv = parseInt(num('in-r').value,10);
    return (!isNaN(rv) && rv>0) ? {wv:0, rv} : bad('in-r');
  }
  if(cardio){                                 // dispatch on the active cardio mode's layout
    if(cm.layout === 'r-only'){
      const rv = parseFloat(num('in-r').value);
      return (!isNaN(rv) && rv>0) ? {wv:0, rv} : bad('in-r');
    }
    if(cm.layout === 'w-time'){
      const wv = parseFloat(num('in-w').value);
      const rv = minSecToMin(num('in-min').value, num('in-sec').value);
      return (!isNaN(wv) && rv>0) ? {wv, rv} : bad('in-w');
    }
    // 'w-r' — default cardio (speed/level + minutes)
    const wv = parseFloat(num('in-w').value), rv = parseFloat(num('in-r').value);
    return (!isNaN(wv) && !isNaN(rv) && rv>0) ? {wv, rv} : bad('in-w');
  }
  // lift: weight × reps
  const wv = parseFloat(num('in-w').value), rv = parseInt(num('in-r').value,10);
  return (!isNaN(wv) && !isNaN(rv) && rv>0) ? {wv, rv} : bad('in-w');
}
function renderModal(){
  if(isMetric(DATA.workouts[modalName])) return renderMetricModal();
  const name = modalName, w = DATA.workouts[name];
  const gid = w.group, cardio = groupKind(gid)==='cardio';
  const dts = sortedDates(w.sessions);
  const today = todayStr();
  const todaySets = w.sessions[today] || [];

  const cm = cardio ? cardioMode(w) : null;
  const hold = isHold(w), repsOnly = isRepsOnly(w);
  // chart points across sessions (filtered by the selected time range)
  const cdts = filterDates(dts);
  const ptsOut = cdts.map(d=>({
    label: fmtDate(d),
    value: cm       ? cm.chartPt(w.sessions[d], w)
         : hold     ? sessionBestHold(w.sessions[d])
         : repsOnly ? sessionBestReps(w.sessions[d])
         :            workoutOutput(w, w.sessions[d])
  }));
  const ptsRep = cdts.map(d=>({label:fmtDate(d), value:sessionReps(w.sessions[d])}));
  const ptsSet = cdts.map(d=>({label:fmtDate(d), value:w.sessions[d].length}));
  const lastOut = ptsOut.length?ptsOut[ptsOut.length-1].value:0;
  const lastRep = ptsRep.length?ptsRep[ptsRep.length-1].value:0;
  const lastSet = ptsSet.length?ptsSet[ptsSet.length-1].value:0;

  const m = document.getElementById('w-modal');
  m.innerHTML = `
    <div class="modal-head">
      <h3>${name}</h3>
      <button class="btn ghost sm" id="w-rename" style="margin-left:auto">✏️ Rename</button>
      <button class="x" id="w-close">×</button>
    </div>
    <div class="modal-sub">${(GROUPS.find(g=>g.id===gid)||{}).name} ·
      <a href="${w.demo}" target="_blank" rel="noopener">▶ form demo</a> ·
      ${dts.length} session${dts.length===1?'':'s'} logged</div>
    ${modalModeTogglesHtml(w, cm, hold, repsOnly)}
    <div class="block-title">Log a set you just did (${fmtDateLong(today)})</div>
    <div class="field-row">
      ${modalLogInputsHtml(cm, hold, repsOnly, cardio)}
      <button class="btn" id="add-set">+ Add set</button>
    </div>
    ${modalTodaySetsHtml(w, todaySets)}
    ${modalPriorSessionsHtml(w, dts, today, name)}
    ${modalChartsHtml(cardio, cm, hold, repsOnly, ptsOut, ptsRep, ptsSet, lastOut, lastRep, lastSet)}
  `;
  // ----- wire handlers -----
  m.querySelector('#w-close').onclick = closeWorkout;
  m.querySelector('#w-rename').onclick = ()=>renameWorkout(name);
  const rerender = ()=>{ save(); renderModal(); renderWorkouts(); };
  const dbc = m.querySelector('#w-db'); if(dbc) dbc.onchange=()=>{ w.db=dbc.checked; rerender(); };
  const hdc = m.querySelector('#w-hold'); if(hdc) hdc.onchange=()=>{ w.hold=hdc.checked; if(w.hold) delete w.db; rerender(); };
  const wtc = m.querySelector('#w-wt'); if(wtc) wtc.onchange=()=>{ w.weighted=wtc.checked; rerender(); };
  // Cardio mode toggles: mutex — checking one clears the others.
  m.querySelectorAll('[data-cmode]').forEach(cb => cb.onchange = ()=>{
    CARDIO_MODE_KEYS.forEach(k => delete w[CARDIO_MODES[k].flag]);
    if(cb.checked) w[CARDIO_MODES[cb.dataset.cmode].flag] = true;
    rerender();
  });
  m.querySelectorAll('[data-range]').forEach(b=> b.onclick=()=>{ modalRange=b.dataset.range; renderModal(); });
  m.querySelector('#add-set').onclick = ()=>{
    const r = parseLoggedSet(cm, hold, repsOnly, cardio); if(!r) return;
    if(!w.sessions[today]) w.sessions[today]=[];
    w.sessions[today].push({w:r.wv, r:r.rv, t:Date.now()});
    rerender();
  };
  const et = m.querySelector('#edit-today'); if(et) et.onclick=()=>{ editToday=!editToday; renderModal(); };
  m.querySelectorAll('[data-rm]').forEach(b=> b.onclick=()=>{
    const i = +b.dataset.rm;
    w.sessions[today].splice(i,1);
    if(!w.sessions[today].length) delete w.sessions[today];
    rerender();
  });
  m.querySelectorAll('[data-prior]').forEach(c=> c.onclick=()=>{
    modalPriorDate = (modalPriorDate===c.dataset.prior)?null:c.dataset.prior;
    editPrior = false;            // open a prior day read-only; Edit button expands it
    renderModal();
  });
  const ep = m.querySelector('#edit-prior'); if(ep) ep.onclick=()=>{ editPrior=!editPrior; renderModal(); };
  const ct = m.querySelector('#charts-toggle'); if(ct) ct.onclick=()=>{ chartsOpen=!chartsOpen; localStorage.setItem('wt_chartsOpen', chartsOpen?'1':'0'); renderModal(); };
  // editable set rows for today (edit mode) and the open prior day — both scoped by data-editdate
  wireSetEditors(m, w);
}
// modal for a daily-total metric: line chart + per-day add/edit + recent list
function renderMetricModal(){
  const name = modalName, w = DATA.workouts[name], mi = metricInfo(w);
  const dts = sortedDates(w.sessions);
  const today = todayStr();
  const cdts = filterDates(dts);
  const pts = cdts.map(d=>({label:fmtDate(d), value:+w.sessions[d]}));
  const latest = dts.length ? +w.sessions[dts[dts.length-1]] : null;
  const rangeAvg = cdts.length ? cdts.reduce((a,d)=>a+(+w.sessions[d]),0)/cdts.length : null;
  const avgLabel = modalRange==='all' ? 'All-time avg' : `${RANGE_LABEL[modalRange]} avg`;
  const todayVal = w.sessions[today];

  const m = document.getElementById('w-modal');
  m.innerHTML = `
    <div class="modal-head"><h3>${name}</h3><button class="x" id="w-close">×</button></div>
    <div class="modal-sub">Cardio · daily ${mi.unit} · ${dts.length} day${dts.length===1?'':'s'} logged</div>
    <div class="stat-strip">
      <div class="tcard"><div class="tn">Latest</div><div class="tv">${fmtMetricVal(w,latest)}<small style="font-size:11px"> ${mi.unit}</small></div></div>
      <div class="tcard"><div class="tn">${avgLabel}</div><div class="tv">${fmtMetricVal(w,rangeAvg)}</div></div>
      <div class="tcard"><div class="tn">Days</div><div class="tv">${dts.length}</div></div>
    </div>
    ${rangeToggle()}
    <div class="bigchart">${pts.length?bigLine(pts,mi.color):`<div class="empty">${dts.length?'No data in this range — try a longer one.':'No data yet. Add a day below, or import from Apple Health in the Cardio section.'}</div>`}</div>

    <div class="block-title">Set ${mi.unit} for a day</div>
    <div class="field-row">
      <div class="field"><label>Date</label><input id="m-date" type="date" value="${today}"></div>
      <div class="field"><label>${mi.name} (${mi.unit})</label><input class="num" id="m-val" type="number" inputmode="decimal" step="any" value="${todayVal!=null?todayVal:''}" placeholder="${mi.dec?'3.20':'8000'}"></div>
      <button class="btn" id="m-save">Save</button>
    </div>

    <div class="block-title">Recent days</div>
    <div class="today-sets" id="m-list">${
      dts.slice(-14).reverse().map(d=>{
        const v = w.sessions[d];
        const cal = Math.round(metricBurn(w, d, +v));
        const calHtml = cal>0 ? `<span class="so" style="color:#f59e0b">🔥 ${cal.toLocaleString()} cal</span>` : '';
        return `<div class="set-line">
          <span>${fmtDateLong(d)}</span>
          <span class="so">${fmtMetricVal(w,v)} ${mi.unit}</span>
          ${calHtml}
          <button class="del" data-mrm="${d}">×</button></div>`;
      }).join('')
      || '<div class="muted" style="font-size:13px">No days logged yet.</div>'
    }</div>`;
  m.querySelector('#w-close').onclick = closeWorkout;
  m.querySelectorAll('[data-range]').forEach(b=> b.onclick=()=>{ modalRange=b.dataset.range; renderMetricModal(); });
  m.querySelector('#m-save').onclick = ()=>{
    const d = document.getElementById('m-date').value;
    const v = parseFloat(document.getElementById('m-val').value);
    if(!d || isNaN(v) || v<0){ document.getElementById('m-val').focus(); return; }
    w.sessions[d] = mi.dec ? Math.round(v*100)/100 : Math.round(v);
    save(); renderMetricModal(); renderWorkouts();
  };
  m.querySelectorAll('[data-mrm]').forEach(b=> b.onclick=()=>{
    delete w.sessions[b.dataset.mrm];
    save(); renderMetricModal(); renderWorkouts();
  });
}
// One editable set row (weight/reps, or distance/min/sec, or hold time+weight, or reps-only)
function setEditRow(w, s, i){
  const gid=w.group, cardio=groupKind(gid)==='cardio', hold=isHold(w), repsOnly=isRepsOnly(w);
  const cm = cardio ? cardioMode(w) : null;
  // Read-only "so" column on the right of the editable row (pace, total output, etc.)
  const so = cm   ? cm.setSo(s, w)
           : (hold||repsOnly) ? ''
           :                    (s.w*s.r*dbMult(w)).toLocaleString()+(w.db?' (db)':'');
  // Inputs depend on mode:
  //   abs reps-only → single Reps field
  //   hold (plank)  → Min/Sec + optional Wt
  //   cardio w-time → Distance + Min/Sec
  //   cardio r-only → Minutes
  //   cardio w-r    → Speed/Level + Minutes
  //   lift          → Weight + Reps
  let inputs;
  if(repsOnly){
    inputs = `<div class="field"><label>Reps</label><input class="num pe-in" data-pf="r" data-pi="${i}" type="number" step="any" inputmode="numeric" value="${s.r}" style="width:74px"></div>`;
  } else if(hold){
    const mn=Math.floor(s.r||0), sc=Math.round(((s.r||0)-mn)*60);
    inputs = `<div class="field"><label>Min</label><input class="num pe-in" data-pf="min" data-pi="${i}" type="number" step="any" inputmode="numeric" value="${mn}" style="width:60px"></div>
      <div class="field"><label>Sec</label><input class="num pe-in" data-pf="sec" data-pi="${i}" type="number" step="any" inputmode="numeric" value="${sc}" style="width:60px"></div>
      <div class="field"><label>Wt (lb)</label><input class="num pe-in" data-pf="w" data-pi="${i}" type="number" step="any" inputmode="decimal" value="${s.w||''}" placeholder="—" style="width:74px"></div>`;
  } else if(cm && cm.layout === 'w-time'){
    const mn=Math.floor(s.r||0), sc=Math.round(((s.r||0)-mn)*60);
    inputs = `<div class="field"><label>${cm.editWLabel}</label><input class="num pe-in" data-pf="w" data-pi="${i}" type="number" step="any" inputmode="decimal" value="${s.w}" style="width:84px"></div>
      <div class="field"><label>Min</label><input class="num pe-in" data-pf="min" data-pi="${i}" type="number" step="any" inputmode="numeric" value="${mn}" style="width:60px"></div>
      <div class="field"><label>Sec</label><input class="num pe-in" data-pf="sec" data-pi="${i}" type="number" step="any" inputmode="numeric" value="${sc}" style="width:60px"></div>`;
  } else if(cm && cm.layout === 'r-only'){
    inputs = `<div class="field"><label>Minutes</label><input class="num pe-in" data-pf="r" data-pi="${i}" type="number" step="any" inputmode="decimal" value="${s.r}" style="width:84px"></div>`;
  } else {
    const wL = cm ? cm.editWLabel : 'Weight';
    inputs = `<div class="field"><label>${wL}</label><input class="num pe-in" data-pf="w" data-pi="${i}" type="number" step="any" inputmode="decimal" value="${s.w}" style="width:84px"></div>
      <div class="field"><label>${cardio?'Minutes':'Reps'}</label><input class="num pe-in" data-pf="r" data-pi="${i}" type="number" step="any" inputmode="${cardio?'decimal':'numeric'}" value="${s.r}" style="width:74px"></div>`;
  }
  return `<div class="pe-row" data-pi="${i}">${inputs}
    ${so?`<span class="pe-so">${so}</span>`:''}
    <button class="del" data-prm="${i}" title="Remove this set">×</button></div>`;
}
// Editable list of a day's sets + an add button. Scoped by data-editdate so today & a prior day
// can both be editable at once without their handlers colliding. Wired by wireSetEditors().
function editableSets(w, date){
  const sets = w.sessions[date]||[];
  const rowsHtml = sets.map((s,i)=>setEditRow(w,s,i)).join('');
  return `<div class="set-editor" data-editdate="${date}">
    ${rowsHtml || '<div class="muted" style="font-size:13px">No sets on this day.</div>'}
    <button class="btn ghost sm" data-padd="1" style="margin-top:4px">+ Add set</button>
  </div>`;
}
function wireSetEditors(m, w){
  m.querySelectorAll('.set-editor').forEach(box=>{
    const date = box.dataset.editdate;
    box.querySelectorAll('.pe-in').forEach(inp=> inp.onchange=()=>{
      const i=+inp.dataset.pi, f=inp.dataset.pf, sets=w.sessions[date];
      if(!sets||!sets[i]) return;
      const v=parseFloat(inp.value);
      if(f==='w'){ if(isHold(w)) sets[i].w = isNaN(v)?0:v; else if(!isNaN(v)) sets[i].w=v; }   // hold weight optional → blank=bodyweight
      else if(f==='r'){ if(!isNaN(v)&&v>0) sets[i].r=v; }
      else if(f==='min'||f==='sec'){
        const rEl=box.querySelector(`.pe-row[data-pi="${i}"]`);
        sets[i].r = minSecToMin(rEl.querySelector('[data-pf="min"]').value, rEl.querySelector('[data-pf="sec"]').value);
      }
      save(); renderModal(); renderWorkouts();
    });
    box.querySelectorAll('[data-prm]').forEach(b=> b.onclick=()=>{
      const i=+b.dataset.prm, sets=w.sessions[date]; if(!sets) return;
      sets.splice(i,1);
      if(!sets.length){ delete w.sessions[date]; if(date===modalPriorDate) modalPriorDate=null; }
      save(); renderModal(); renderWorkouts();
    });
    const padd=box.querySelector('[data-padd]'); if(padd) padd.onclick=()=>{
      if(!w.sessions[date]) w.sessions[date]=[];
      w.sessions[date].push(date===todayStr() ? {w:0, r:0, t:Date.now()} : {w:0, r:0});   // back-dated entry: no timestamp
      save(); renderModal(); renderWorkouts();
    };
  });
}
// Prior-day detail — EDITABLE: change weight/reps (or distance/min/sec) in place; the date never moves.
function priorDetailHtml(name){
  if(!modalPriorDate) return '';
  const w = DATA.workouts[name], gid=w.group, cardio=groupKind(gid)==='cardio', row=isRow(w), hold=isHold(w), repsOnly=isRepsOnly(w);
  const sets = w.sessions[modalPriorDate]||[];
  const head = row
    ? `${fmtDateLong(modalPriorDate)} · ${sessionDist(sets)} m · ${fmtPace(sessionPace(sets))} km/min`
    : hold ? `${fmtDateLong(modalPriorDate)} · best ${fmtDur(sessionBestHold(sets))}`
    : repsOnly ? `${fmtDateLong(modalPriorDate)} · ${sessionReps(sets)} reps`
    : cardio ? `${fmtDateLong(modalPriorDate)}`
    : `${fmtDateLong(modalPriorDate)} · output ${workoutOutput(w, sets).toLocaleString()}`;
  if(editPrior){
    return `<div class="prior-edit">
      <div class="block-title" style="display:flex;align-items:center;gap:8px;margin-top:4px">
        <span>${head}</span>
        <button class="btn ghost mini" id="edit-prior" style="margin-left:auto">✓ Done</button></div>
      <div class="modal-sub" style="margin:-2px 0 8px">Edit the numbers below — the date stays ${fmtDate(modalPriorDate)}.</div>
      ${editableSets(w, modalPriorDate)}
    </div>`;
  }
  // read-only by default: show reps / weight / output; Edit button expands the editor
  const list = sets.length
    ? sets.map(s=>{ const {desc,so}=setDescSo(w,s);
        return `<div class="set-line"><span>${desc}</span><span class="so">${so}</span></div>`; }).join('')
    : '<div class="muted" style="font-size:13px">No sets on this day.</div>';
  return `<div class="prior-edit">
    <div class="block-title" style="display:flex;align-items:center;gap:8px;margin-top:4px">
      <span>${head}</span>
      ${sets.length?`<button class="btn ghost mini" id="edit-prior" style="margin-left:auto">✎ Edit</button>`:''}</div>
    <div class="today-sets">${list}</div>
  </div>`;
}
function renameWorkout(name){
  const nn = prompt('Rename workout:', name);
  if(nn===null) return;
  const clean = nn.trim();
  if(!clean || clean===name) return;
  if(DATA.workouts[clean]){ alert('A workout with that name already exists.'); return; }
  DATA.workouts[clean] = DATA.workouts[name];     // carries sessions, db/row/created flags
  delete DATA.workouts[name];
  if(modalName===name) modalName = clean;
  save(); renderModal(); renderWorkouts();
}

/* ----- demo popout ----- */
function openDemo(name){
  const w = DATA.workouts[name];
  const url = w.demo || demoUrl(name);
  window.open(url, '_blank', 'noopener');
}

/* ----- add / delete workout ----- */
function addWorkout(gid){
  const cardio = groupKind(gid)==='cardio';
  const name = prompt(`Name of new ${cardio?'cardio':'workout'}:`);
  if(!name) return;
  const clean = name.trim();
  if(!clean) return;
  if(DATA.workouts[clean]){ alert('That name already exists.'); return; }
  const demo = prompt('Form demo URL (leave blank to auto-use a YouTube search, or paste a .gif link):', '') || demoUrl(clean);
  DATA.workouts[clean] = { group:gid, demo, sessions:{}, created:Date.now() };
  save(); renderWorkouts();
}
function deleteWorkout(name){
  if(!confirm(`Delete "${name}" and all its logged sessions?`)) return;
  delete DATA.workouts[name];
  save(); renderWorkouts();
}

/* ============================== RENDER: NUTRITION ============================== */
// macros for a logged row (rows store per-100g base + grams, so editing grams rescales)
function foodMacros(r){
  if(r.per100){ const k=(r.g||0)/100; return {cal:r.per100.cal*k, p:r.per100.p*k, c:r.per100.c*k, f:r.per100.f*k, fib:(r.per100.fib||0)*k, sod:(r.per100.sod||0)*k}; }
  return {cal:r.cal||0, p:r.p||0, c:r.c||0, f:r.f||0, fib:r.fib||0, sod:r.sod||0};   // legacy flat rows
}
// servings multiplier on top of the base macros (default 1 serving)
function rowMacros(r){ const m=foodMacros(r), s=r.servings||1; return {cal:m.cal*s, p:m.p*s, c:m.c*s, f:m.f*s, fib:m.fib*s, sod:m.sod*s}; }
// timestamp a food only when logging for TODAY (back-dated entries get no time)
function stampNow(){ return nutDay===todayStr() ? Date.now() : undefined; }
// ============================== NUTRITION TAB ==============================
// Six-card row of daily totals (cal/protein/carbs/fat/fiber/sodium) with goal indicators.
function nutritionTotalsHtml(tot){
  const g = goals();
  return `<div class="totals">
    <div class="tcard cal"><div class="tn">Calories</div><div class="tv">${Math.round(tot.cal)}</div>${goalLine(tot.cal, g.cal, false, '')}</div>
    <div class="tcard p"><div class="tn">Protein</div><div class="tv">${Math.round(tot.p)}<small style="font-size:11px">g</small></div>${goalLine(tot.p, g.p, true, 'g')}</div>
    <div class="tcard c"><div class="tn">Carbs</div><div class="tv">${Math.round(tot.c)}<small style="font-size:11px">g</small></div>${goalLine(tot.c, g.c, false, 'g')}</div>
    <div class="tcard f"><div class="tn">Fat</div><div class="tv">${Math.round(tot.f)}<small style="font-size:11px">g</small></div>${goalLine(tot.f, g.f, false, 'g')}</div>
    <div class="tcard"><div class="tn">Fiber</div><div class="tv">${Math.round(tot.fib)}<small style="font-size:11px">g</small></div>${goalLine(tot.fib, g.fib, true, 'g')}</div>
    <div class="tcard"><div class="tn">Sodium</div><div class="tv">${Math.round(tot.sod)}<small style="font-size:11px">mg</small></div>${goalLine(tot.sod, g.sod, false, 'mg')}</div>
  </div>`;
}
// Food input row — natural-language meal if CN key is set, else search-and-pick.
function foodInputHtml(hasCN){
  if(hasCN) return `<div class="food-input">
    <input id="food-q" placeholder="What did you eat? e.g. 2 eggs and a banana">
    <button class="btn" id="food-add">+ Add</button>
    <button class="btn ghost" id="food-manual" title="Enter macros by hand">✏️ Manual</button>
  </div>`;
  return `<div class="banner"><b>Tip:</b> add a free CalorieNinjas key in ⚙ Settings to log meals in plain words
      (“2 eggs and a banana”). Until then, search one food at a time below.</div>
     <div class="food-input">
      <input id="food-q" placeholder="Search a food — e.g. chicken breast, banana">
      <button class="btn" id="food-search">Search</button>
      <button class="btn ghost" id="food-manual" title="Enter macros by hand">✏️ Manual</button>
    </div>`;
}
// Hidden manual-entry form for foods CalorieNinjas / USDA can't resolve.
function manualEntryFormHtml(){
  return `<div id="manual-form" class="manual-form" style="display:none">
    <div class="field-row">
      <div class="field" style="flex:1;min-width:150px"><label>Food name</label><input id="man-name" placeholder="e.g. Grandma’s lasagna"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Calories</label><input class="num" id="man-cal" type="number" inputmode="numeric" placeholder="0"></div>
      <div class="field"><label>Protein (g)</label><input class="num" id="man-p" type="number" inputmode="decimal" placeholder="0"></div>
      <div class="field"><label>Carbs (g)</label><input class="num" id="man-c" type="number" inputmode="decimal" placeholder="0"></div>
      <div class="field"><label>Fat (g)</label><input class="num" id="man-f" type="number" inputmode="decimal" placeholder="0"></div>
      <div class="field"><label>Fiber (g)</label><input class="num" id="man-fib" type="number" inputmode="decimal" placeholder="0"></div>
      <div class="field"><label>Sodium (mg)</label><input class="num" id="man-sod" type="number" inputmode="numeric" placeholder="0"></div>
      <button class="btn" id="man-add">Add</button>
    </div>
  </div>`;
}
// Today's food rows (or empty-state row).
function foodTableBodyHtml(rows){
  if(!rows.length) return `<tr><td colspan="11" class="empty">Nothing logged. Search a food above to add it.</td></tr>`;
  return rows.map((r,i)=>{const m=rowMacros(r); return `<tr>
    <td>${r.desc}</td>
    <td class="muted" style="font-size:12px;white-space:nowrap">${r.t?fmtTime(r.t):'—'}</td>
    <td>${r.per100?`<input class="num gin" data-g="${i}" type="number" inputmode="decimal" value="${r.g}" style="width:66px;padding:4px 6px">`:'<span class="muted">—</span>'}</td>
    <td><input class="num sin" data-s="${i}" type="number" inputmode="decimal" step="any" min="0" value="${r.servings||1}" style="width:54px;padding:4px 6px"></td>
    <td>${Math.round(m.cal)}</td><td>${Math.round(m.p)}</td>
    <td>${Math.round(m.c)}</td><td>${Math.round(m.f)}</td>
    <td>${Math.round(m.fib)}</td><td>${Math.round(m.sod)}</td>
    <td><button class="del" data-fdel="${i}">×</button></td></tr>`;}).join('');
}
function renderNutrition(){
  const root = document.getElementById('view-nutrition');
  const day = nutDay;
  const rows = DATA.food[day] || [];
  const tot = rows.reduce((a,r)=>{const m=rowMacros(r);return {cal:a.cal+m.cal,p:a.p+m.p,c:a.c+m.c,f:a.f+m.f,fib:a.fib+m.fib,sod:a.sod+m.sod};},{cal:0,p:0,c:0,f:0,fib:0,sod:0});
  const hasCN = !!cnKey();
  root.innerHTML = `
    <div class="day-nav">
      <button class="arrow" id="d-prev">‹</button>
      <span class="date" id="d-label">${fmtDateLong(day)}${day===todayStr()?' · Today':''}</span>
      <button class="arrow" id="d-next">›</button>
    </div>
    ${burnBarHtml(dayBurn(day), tot)}
    ${nutritionTotalsHtml(tot)}
    ${foodInputHtml(hasCN)}
    ${manualEntryFormHtml()}
    <div id="food-results"></div>
    <div class="table-wrap">
      <table><thead><tr><th>Food</th><th>Time</th><th>Grams</th><th>Servings</th><th>Calories</th><th>Protein</th><th>Carbs</th><th>Fat</th><th>Fiber</th><th>Sodium</th><th></th></tr></thead>
      <tbody id="food-body">${foodTableBodyHtml(rows)}</tbody></table>
    </div>
    <div style="margin-top:10px;font-size:11.5px;color:var(--muted)">
      ${hasCN
        ? 'Type meals in plain words: CalorieNinjas reads the foods &amp; portions, USDA fills in calories &amp; protein. A USDA key (⚙ Settings) is recommended so multi-food meals don’t hit the shared demo limit.'
        : 'Food data: USDA FoodData Central (shared demo key — add your own free key in ⚙ Settings if it rate-limits).'}
    </div>`;
  root.querySelector('#d-prev').onclick = ()=>{ nutDay = shiftDay(nutDay,-1); renderNutrition(); };
  root.querySelector('#d-next').onclick = ()=>{ nutDay = shiftDay(nutDay,1); renderNutrition(); };
  const q = root.querySelector('#food-q');
  if(cnKey()){
    const ab = root.querySelector('#food-add');
    ab.onclick = ()=>addNL(q.value);
    q.onkeydown = e=>{ if(e.key==='Enter') addNL(q.value); };
  } else {
    const sb = root.querySelector('#food-search');
    sb.onclick = ()=>searchFood(q.value);
    q.onkeydown = e=>{ if(e.key==='Enter') searchFood(q.value); };
  }
  root.querySelectorAll('[data-fdel]').forEach(b=> b.onclick=()=>{
    DATA.food[day].splice(+b.dataset.fdel,1);
    if(!DATA.food[day].length) delete DATA.food[day];
    save(); renderNutrition();
  });
  root.querySelectorAll('.gin').forEach(inp=> inp.onchange=()=>{
    const g=parseFloat(inp.value); if(isNaN(g)||g<0) return;
    DATA.food[day][+inp.dataset.g].g = g; save(); renderNutrition();
  });
  root.querySelectorAll('.sin').forEach(inp=> inp.onchange=()=>{
    const s=parseFloat(inp.value); if(isNaN(s)||s<0) return;
    DATA.food[day][+inp.dataset.s].servings = s; save(); renderNutrition();
  });
  const mf = root.querySelector('#manual-form');
  root.querySelector('#food-manual').onclick = ()=>{
    mf.style.display = mf.style.display==='none' ? 'block' : 'none';
    if(mf.style.display==='block') root.querySelector('#man-name').focus();
  };
  root.querySelector('#man-add').onclick = ()=>{
    const name=root.querySelector('#man-name').value.trim();
    const cal=parseFloat(root.querySelector('#man-cal').value)||0;
    const p=parseFloat(root.querySelector('#man-p').value)||0;
    const c=parseFloat(root.querySelector('#man-c').value)||0;
    const f=parseFloat(root.querySelector('#man-f').value)||0;
    const fib=parseFloat(root.querySelector('#man-fib').value)||0;
    const sod=parseFloat(root.querySelector('#man-sod').value)||0;
    if(!name){ root.querySelector('#man-name').focus(); return; }
    if(!cal && !p && !c && !f && !fib && !sod){ alert('Enter at least one value.'); return; }
    if(!DATA.food[day]) DATA.food[day]=[];
    DATA.food[day].push({desc:name, cal, p, c, f, fib, sod, manual:true, t:stampNow()});   // flat row (no grams scaling)
    save(); renderNutrition();
  };
}
// totals goal indicator. isProtein → "to go / met" (more is good); else "left / over".
function goalLine(value, target, isProtein, unit){
  const v=Math.round(value), t=Math.round(target), u=unit||'';
  if(!t) return '';
  if(isProtein) return v>=t
    ? `<div class="goal ok">✓ ${t}${u} goal</div>`
    : `<div class="goal">${t-v}${u} to go · ${t}${u}</div>`;
  return v>t
    ? `<div class="goal over">${v-t}${u} over · ${t}${u}</div>`
    : `<div class="goal">${t-v}${u} left · ${t}${u}</div>`;
}
// daily workout-burn bar shown under the date nav in the Nutrition tab
function burnBarHtml(b, tot){
  const parts=[];
  parts.push(`${Math.round(b.rest||0)} resting`);
  if(b.nLift)   parts.push(`${b.nLift} lift${b.nLift>1?'s':''} · ${Math.round(b.liftMin)} min`);
  if(b.nCardio) parts.push(`${b.nCardio} cardio · ${Math.round(b.cardioMin)} min`);
  if(b.miles)   parts.push(`${b.miles.toFixed(1)} mi walked`);
  const net = tot.cal>0
    ? `<div class="bb-net" title="calories eaten − burned">Net ${Math.round(tot.cal - b.total)} cal</div>` : '';
  return `<div class="burn-bar"><span class="bb-fire">🔥</span>
    <div class="bb-main"><span class="bb-val">${Math.round(b.total)}</span> cal burned</div>
    <div class="bb-sub">${parts.join(' · ')}</div>${net}</div>`;
}
function shiftDay(s,delta){
  const [y,m,d]=s.split('-').map(Number);
  const dt=new Date(y,m-1,d); dt.setDate(dt.getDate()+delta);
  const p=n=>String(n).padStart(2,'0');
  return `${dt.getFullYear()}-${p(dt.getMonth()+1)}-${p(dt.getDate())}`;
}
// pull kcal/protein/carb/fat (per 100g) out of a USDA food's nutrient list
function macrosFromUSDA(fn){
  let cal=0,p=0,c=0,fat=0,fib=0,sod=0;
  for(const n of (fn||[])){
    const num=String(n.nutrientNumber||''), name=(n.nutrientName||'').toLowerCase(),
          unit=(n.unitName||'').toLowerCase(), v=n.value||0;
    if(!cal && unit==='kcal' && (num==='208'||num==='957'||num==='958'||name.startsWith('energy'))) cal=v;
    else if(num==='203'||name==='protein') p=v;
    else if(num==='204'||name.startsWith('total lipid')) fat=v;
    else if(num==='205'||name.startsWith('carbohydrate, by diff')) c=v;
    else if(num==='291'||name.startsWith('fiber')) fib=v;            // g
    else if(num==='307'||name.startsWith('sodium')) sod=v;           // mg
  }
  return {cal,p,c,f:fat,fib,sod};
}
function titleCase(s){ return (s||'').toLowerCase().replace(/\b\w/g,c=>c.toUpperCase()); }
let _foodHits = [];
async function searchFood(query){
  const q=(query||'').trim(); if(!q) return;
  const box=document.getElementById('food-results');
  box.innerHTML='<div style="padding:10px;color:var(--muted)"><span class="spin"></span> Searching…</div>';
  try{
    const url=`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(usdaKey())}`
      +`&query=${encodeURIComponent(q)}&pageSize=25`
      +`&dataType=${encodeURIComponent('Foundation,SR Legacy,Branded')}`;   // no parens: raw "(FNDDS)" trips nginx 400
    const r=await fetch(url);
    if(!r.ok) throw new Error('HTTP '+r.status+(r.status===429?' — demo key rate-limited; add your own free key in ⚙ Settings':''));
    const j=await r.json();
    _foodHits=(j.foods||[]).map(f=>({desc:titleCase(f.description), per100:macrosFromUSDA(f.foodNutrients), generic:f.dataType!=='Branded'}))
      .filter(h=>h.per100.cal>0||h.per100.p>0||h.per100.c>0||h.per100.f>0)   // drop entries missing macro data
      .sort((a,b)=>(b.generic?1:0)-(a.generic?1:0))                          // whole foods before branded (stable)
      .slice(0,8);
    if(!_foodHits.length){ box.innerHTML='<div style="padding:10px;color:var(--muted)">No matches. Try a simpler word.</div>'; return; }
    box.innerHTML=`<div class="results">${_foodHits.map((h,i)=>`<div class="res-item" data-pick="${i}">
        <div class="res-name">${h.desc}</div>
        <div class="res-mac">${Math.round(h.per100.cal)} kcal · P${Math.round(h.per100.p)} C${Math.round(h.per100.c)} F${Math.round(h.per100.f)} <span class="per">per 100g · tap to add</span></div>
      </div>`).join('')}</div>`;
    box.querySelectorAll('[data-pick]').forEach(it=> it.onclick=()=>{
      const h=_foodHits[+it.dataset.pick]; if(!h) return;
      if(!DATA.food[nutDay]) DATA.food[nutDay]=[];
      DATA.food[nutDay].push({desc:h.desc, g:100, per100:h.per100, t:stampNow()});
      save(); renderNutrition();
    });
  }catch(e){
    box.innerHTML=`<div style="padding:10px;color:var(--hot)">Couldn't search: ${e.message}`+
      `<br><span style="color:var(--muted)">If it says "Failed to fetch", tell me — I'll add a proxy.</span></div>`;
  }
}
function numOrNull(v){ const n = typeof v==='number'?v:parseFloat(v); return isFinite(n)?n:null; }
// USDA per-100g macros for a food name. cnCarb100 (carbs/100g from CalorieNinjas, free)
// disambiguates which USDA entry — e.g. cooked vs raw rice. Returns {cal,p,c,f} or null.
async function usdaPer100(name, cnCarb100){
  try{
    const url=`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(usdaKey())}`
      +`&query=${encodeURIComponent(name)}&pageSize=25`
      +`&dataType=${encodeURIComponent('Foundation,SR Legacy,Branded')}`;   // no parens: raw "(FNDDS)" trips nginx 400
    const r=await fetch(url); if(!r.ok) return null;
    const j=await r.json();
    let cands=(j.foods||[]).map(f=>({per100:macrosFromUSDA(f.foodNutrients), generic:f.dataType!=='Branded'}))
      .filter(h=>h.per100.cal>0);                       // need real calories
    if(!cands.length) return null;
    let pool=cands.filter(c=>c.generic); if(!pool.length) pool=cands;   // prefer whole foods
    if(cnCarb100!=null) pool.sort((a,b)=>Math.abs(a.per100.c-cnCarb100)-Math.abs(b.per100.c-cnCarb100));
    return pool[0].per100;
  }catch(e){ return null; }
}
// Plain-language entry: CalorieNinjas parses the sentence into foods + grams (+ free carbs/fat),
// then USDA fills in accurate calories & protein for each. "2 eggs and a banana" → two rows.
async function addNL(query){
  const q=(query||'').trim(); if(!q) return;
  const key=cnKey(); if(!key) return searchFood(q);   // no key → USDA search fallback
  const btn=document.getElementById('food-add'); const old=btn.innerHTML;
  btn.innerHTML='<span class="spin"></span> reading…'; btn.disabled=true;
  try{
    const r=await fetch('https://api.api-ninjas.com/v1/nutrition?query='+encodeURIComponent(q),
      {headers:{'X-Api-Key':key}});
    if(!r.ok) throw new Error('CalorieNinjas HTTP '+r.status+(r.status===400?' — check your key in ⚙ Settings':''));
    const j=await r.json();
    const items=Array.isArray(j)?j:(j.items||[]);
    if(!items.length){ alert('Couldn’t parse that. Try simpler wording (e.g. “2 eggs, 1 banana”).'); btn.innerHTML=old; btn.disabled=false; return; }
    if(!DATA.food[nutDay]) DATA.food[nutDay]=[];
    let misses=0;
    for(let i=0;i<items.length;i++){
      const it=items[i];
      btn.innerHTML=`<span class="spin"></span> ${i+1}/${items.length}…`;
      const g=numOrNull(it.serving_size_g)||100;
      const cnCarb100=numOrNull(it.carbohydrates_total_g)!=null ? numOrNull(it.carbohydrates_total_g)/g*100 : null;
      const cnFat100 =numOrNull(it.fat_total_g)!=null ? numOrNull(it.fat_total_g)/g*100 : null;
      const cnFib100 =numOrNull(it.fiber_g)!=null ? numOrNull(it.fiber_g)/g*100 : 0;       // free from CalorieNinjas
      const cnSod100 =numOrNull(it.sodium_mg)!=null ? numOrNull(it.sodium_mg)/g*100 : 0;
      const per100=await usdaPer100(it.name, cnCarb100);   // accurate cal+protein from USDA
      if(per100){
        if(!per100.fib && cnFib100) per100.fib = cnFib100;   // fill any gap with CalorieNinjas values
        if(!per100.sod && cnSod100) per100.sod = cnSod100;
        DATA.food[nutDay].push({desc:titleCase(it.name), g:Math.round(g), per100, t:stampNow()});
      } else {
        // USDA miss/rate-limited — keep CalorieNinjas carbs+fat+fiber+sodium, mark protein/cal as estimate
        misses++;
        DATA.food[nutDay].push({desc:titleCase(it.name)+' (est.)', g:Math.round(g),
          per100:{cal:(cnCarb100||0)*4+(cnFat100||0)*9, p:0, c:cnCarb100||0, f:cnFat100||0, fib:cnFib100, sod:cnSod100}, t:stampNow()});
      }
    }
    save(); renderNutrition();
    if(misses) setTimeout(()=>alert(`${misses} item(s) couldn’t be matched in USDA (often the shared demo key being rate-limited). Add your own free USDA key in ⚙ Settings for reliable calories/protein.`),100);
  }catch(e){
    alert('Could not look that up.\n\n'+e.message);
    btn.innerHTML=old; btn.disabled=false;
  }
}

/* ============================== RENDER: BODY ============================== */
// "weight" series lives in DATA.body; every body-comp metric lives in DATA.comp[date][key].
function compDatesFor(key){ return Object.keys(DATA.comp||{}).filter(d=>DATA.comp[d] && DATA.comp[d][key]!=null).sort(); }
function compSeries(key){ return compDatesFor(key).map(d=>({label:fmtDate(d), value:+DATA.comp[d][key]})); }
function compLatest(key){ const ds=compDatesFor(key); if(!ds.length) return null; const d=ds[ds.length-1]; return {date:d, value:+DATA.comp[d][key]}; }
function fmtComp(key, v){ return v==null?'—':(+v).toLocaleString(undefined,{minimumFractionDigits:BODYCOMP[key].dec, maximumFractionDigits:BODYCOMP[key].dec}); }
// ============================== BODY TAB ==============================
// Composition card grid (weight + every body-comp metric that has data).
function bodyCompCardsHtml(latest){
  const w = `<div class="bc-card"><div class="tn">Weight</div><div class="tv">${latest!=null?latest.toFixed(1):'—'}<small> lb</small></div></div>`;
  const comp = Object.keys(BODYCOMP).map(k=>{
    const l = compLatest(k); if(!l) return '';
    return `<div class="bc-card"><div class="tn">${BODYCOMP[k].label}</div><div class="tv">${fmtComp(k,l.value)}<small> ${BODYCOMP[k].unit}</small></div></div>`;
  }).join('');
  return `<div class="bc-grid">${w}${comp}</div>`;
}
// Screenshot scanner uploader. Shows an inline API-key field if no key is set on this device.
function bodyScannerHtml(){
  return `<div class="uploader" style="margin-top:18px">
    <div style="font-size:15px;font-weight:700">📷 Scan a body-composition screenshot</div>
    <p>Upload a screenshot of your smart-scale app and I'll read the numbers into the form below — then check &amp; Save.</p>
    ${aiKey()?'':`<div class="field" style="margin-bottom:10px"><label>Anthropic API key <span style="color:var(--muted);font-weight:400">(saves on this device — get one at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>)</span></label><input id="bc-aikey" placeholder="sk-ant-…" autocomplete="off"></div>`}
    <input type="file" id="bc-file" accept="image/*">
    <div id="bc-status" style="margin-top:8px;font-size:13px;color:var(--muted)"></div>
  </div>`;
}
// Collapsible "Manual entry + Apple Health import" section. Prefills from a pendingScan or existing values.
function bodyManualSectionHtml(today, logOpen){
  const cur = DATA.comp[today] || {};
  const pv = k => pendingScan && pendingScan[k]!=null ? pendingScan[k] : (cur[k]!=null ? cur[k] : '');
  const wv = pendingScan && pendingScan.weight!=null ? pendingScan.weight : (DATA.body[today]!=null ? DATA.body[today] : '');
  const compInputs = Object.keys(BODYCOMP).map(k=>
    `<div class="field"><label>${BODYCOMP[k].label}${BODYCOMP[k].unit?' ('+BODYCOMP[k].unit+')':''}</label>
      <input class="num bc-in" data-k="${k}" type="number" step="any" inputmode="decimal" value="${pv(k)}"></div>`).join('');
  return `<div class="block-title" id="bc-toggle" style="margin-top:18px;cursor:pointer;user-select:none;display:flex;align-items:center;gap:6px">
    <span style="font-size:11px;width:10px">${logOpen?'▾':'▸'}</span> Manual entry &amp; Apple Health import
  </div>
  <div id="bc-collapse" style="${logOpen?'':'display:none'}">
    <div class="block-title">Log body data for <input id="bc-date" type="date" value="${today}" style="padding:4px 8px;font-size:13px"></div>
    <div class="field-row">
      <div class="field"><label>Weight (lb)</label><input class="num" id="bc-weight" type="number" step="any" inputmode="decimal" value="${wv}" placeholder="182.0"></div>
      ${compInputs}
    </div>
    <button class="btn" id="bc-save" style="margin-top:6px">💾 Save body data</button>

    <div class="uploader" style="margin-top:22px">
      <div style="font-size:15px;font-weight:700">⬆ Import Apple Health data</div>
      <p>Health app → your profile → <b>Export All Health Data</b> → unzip → upload the <b>export.xml</b> here.<br>
         I'll pull weight (one per day) plus daily steps &amp; walking distance on/after the date below. Big files are fine — it streams.</p>
      <div class="field" style="max-width:220px;margin-bottom:10px"><label>Only import readings on/after</label><input type="date" id="b-from" value="2026-05-20"></div>
      <input type="file" id="b-file" accept=".xml">
      <div id="b-status" style="margin-top:8px;font-size:13px;color:var(--muted)"></div>
    </div>
  </div>`;
}
function renderBody(){
  DATA.comp = DATA.comp || {};
  const root = document.getElementById('view-body');
  const dts = sortedDates(DATA.body);
  const latest = dts.length?DATA.body[dts[dts.length-1]]:null;
  const today = todayStr();

  // chart series — weight or a chosen comp metric
  let pts, chartColor;
  if(bodyMetric==='weight'){ pts = dts.map(d=>({label:fmtDate(d), value:DATA.body[d]})); chartColor='#34d399'; }
  else { pts = compSeries(bodyMetric); chartColor=BODYCOMP[bodyMetric].color; }

  // metric selector for the chart
  const selOpts = `<option value="weight"${bodyMetric==='weight'?' selected':''}>Weight</option>` +
    Object.keys(BODYCOMP).map(k=>`<option value="${k}"${bodyMetric===k?' selected':''}>${BODYCOMP[k].label}</option>`).join('');

  const logOpen = bodyLogOpen || !!pendingScan;   // a finished scan auto-expands so the prefilled form shows

  root.innerHTML = `
    ${bodyCompCardsHtml(latest)}

    <div class="block-title" style="display:flex;align-items:center;gap:8px">
      <span>Trend</span>
      <select id="bc-metric" style="margin-left:auto;padding:4px 8px;font-size:12px">${selOpts}</select>
    </div>
    <div class="bigchart">${pts.length?bigLine(pts,chartColor):`<div class="empty">No ${bodyMetric==='weight'?'weight':BODYCOMP[bodyMetric].label} data yet.</div>`}</div>

    ${bodyScannerHtml()}
    ${bodyManualSectionHtml(today, logOpen)}`;

  root.querySelector('#bc-toggle').onclick = ()=>{
    bodyLogOpen = !bodyLogOpen;
    try{ localStorage.setItem('wt_bodylog', JSON.stringify(bodyLogOpen)); }catch(e){}
    renderBody();
  };
  root.querySelector('#bc-metric').onchange = e=>{ bodyMetric = e.target.value; renderBody(); };
  root.querySelector('#bc-file').onchange = e=>{ if(e.target.files[0]) scanBodyScreenshot(e.target.files[0], document.getElementById('bc-status')); };
  const aiIn = root.querySelector('#bc-aikey');
  if(aiIn) aiIn.onchange = e=>{
    const v = e.target.value.trim();
    if(v){ localStorage.setItem(LS_AI, v); renderBody(); }
  };
  root.querySelector('#bc-save').onclick = ()=>{
    const d = document.getElementById('bc-date').value; if(!d) return;
    const wIn = parseFloat(document.getElementById('bc-weight').value);
    if(!isNaN(wIn)) DATA.body[d] = wIn;
    const obj = DATA.comp[d] || {};
    root.querySelectorAll('.bc-in').forEach(inp=>{
      const k = inp.dataset.k, v = parseFloat(inp.value);
      if(!isNaN(v)) obj[k] = Math.round(v*100)/100; else delete obj[k];
    });
    if(Object.keys(obj).length) DATA.comp[d] = obj; else delete DATA.comp[d];
    pendingScan = null;
    save(); renderBody();
  };
  root.querySelector('#b-file').onchange = e=>{ if(e.target.files[0]) importHealth(e.target.files[0], document.getElementById('b-status'), document.getElementById('b-from').value); };
}
function fileToDataURL(file){ return new Promise((res,rej)=>{ const fr=new FileReader(); fr.onload=()=>res(fr.result); fr.onerror=rej; fr.readAsDataURL(file); }); }
function parseJsonLoose(t){ try{ return JSON.parse(t); }catch(e){} const m=t&&t.match(/\{[\s\S]*\}/); if(m){ try{ return JSON.parse(m[0]); }catch(e){} } return null; }
// send the screenshot to Claude vision, get back a JSON of metrics, prefill the form for review
async function scanBodyScreenshot(file, statusEl){
  const key = aiKey();
  if(!key){
    statusEl.innerHTML = 'Paste your Anthropic API key above first.';
    const f = document.getElementById('bc-aikey'); if(f) f.focus();
    return;
  }
  statusEl.innerHTML = '<span class="spin"></span> Reading screenshot…';
  try{
    const durl = await fileToDataURL(file);
    const media = durl.slice(5, durl.indexOf(';')) || 'image/jpeg';
    const data  = durl.slice(durl.indexOf(',')+1);
    const prompt = 'This is a screenshot from a body-composition smart-scale app. Read every metric shown and return ONLY a JSON object (no prose, no code fence). Use these keys when the value is present, omit any you cannot read, values as plain numbers: '+
      'weight (lb), bmi, ffm (fat-free mass lb), bf (body fat %), subfat (subcutaneous fat %), visc (visceral fat number), skm (skeletal muscle %), mm (muscle mass lb), prot (protein %), bone (bone mass lb), water (body water %), metage (metabolic age years), bmr (kcal).';
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{'content-type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
      body: JSON.stringify({ model:AI_MODEL, max_tokens:500, messages:[{role:'user', content:[
        {type:'image', source:{type:'base64', media_type:media, data}},
        {type:'text', text:prompt}
      ]}]})
    });
    if(!r.ok){ const t=await r.text().catch(()=> ''); statusEl.innerHTML = `Scan failed (${r.status}). ${t.slice(0,140)}`; return; }
    const j = await r.json();
    const txt = (j.content && j.content[0] && j.content[0].text) || '';
    const parsed = parseJsonLoose(txt);
    if(!parsed){ statusEl.innerHTML = 'Could not read numbers from that image — try a clearer shot or type them in.'; return; }
    pendingScan = parsed;
    renderBody();
    const n = Object.keys(parsed).length;
    document.getElementById('bc-status').innerHTML = `Read ${n} value${n===1?'':'s'} ✓ — check the form below and Save.`;
  }catch(e){ statusEl.innerHTML = 'Scan error: '+e.message; }
}
// stream-parse export.xml for weight + daily steps + walking distance (memory-safe for huge files).
// Weight = one reading/day (last wins); steps & distance = SUM of the day's readings.
// Buckets by startDate (the day the activity happened), falling back to creationDate.
async function importHealth(file, statusEl, fromDate){
  const status = statusEl || document.getElementById('b-status');
  fromDate = fromDate || '';                                   // YYYY-MM-DD; '' = no cutoff
  status.innerHTML = '<span class="spin"></span> Reading…';
  ensureMetrics();
  const recRe  = /<Record ([^>]*)>/g;                          // device attrs are &lt;&gt;-escaped, so no literal > inside
  const typeRe = /type="HKQuantityTypeIdentifier(\w+)"/;
  const valRe  = /value="([\d.]+)"/;
  const unitRe = /unit="([^"]+)"/;
  const sDateRe = /startDate="(\d{4}-\d{2}-\d{2})/, cDateRe = /creationDate="(\d{4}-\d{2}-\d{2})/;
  const weight = {}, steps = {}, dist = {};
  let scanned = 0;
  try{
    const reader = file.stream().getReader();
    const dec = new TextDecoder();
    let buf = '';
    while(true){
      const {done,value} = await reader.read();
      if(done) break;
      buf += dec.decode(value,{stream:true});
      let m, lastIdx = 0;
      recRe.lastIndex = 0;
      while((m = recRe.exec(buf))){
        lastIdx = recRe.lastIndex;
        const a = m[1];
        // cheap guard: skip the millions of heart-rate/energy/etc. records before running regexes
        if(a.indexOf('BodyMass')<0 && a.indexOf('StepCount')<0 && a.indexOf('DistanceWalkingRunning')<0) continue;
        const tm = a.match(typeRe); if(!tm) continue;
        const type = tm[1];
        if(type!=='BodyMass' && type!=='StepCount' && type!=='DistanceWalkingRunning') continue;
        const vm = a.match(valRe); if(!vm) continue;
        const dm = a.match(sDateRe) || a.match(cDateRe); if(!dm) continue;
        const date = dm[1];
        if(fromDate && date < fromDate) continue;               // skip before cutoff
        scanned++;
        let v = parseFloat(vm[1]); const um = a.match(unitRe);
        if(type==='BodyMass'){
          if(um && /kg/i.test(um[1])) v *= 2.20462;             // → lb
          weight[date] = v;                                     // last reading that day wins
        } else if(type==='StepCount'){
          steps[date] = (steps[date]||0) + v;
        } else {                                                // DistanceWalkingRunning
          if(um && /km/i.test(um[1])) v *= 0.621371;            // → mi
          dist[date] = (dist[date]||0) + v;
        }
      }
      buf = buf.slice(lastIdx);                                 // drop processed records — no re-scan, no double count
      status.innerHTML = `<span class="spin"></span> Scanned ${scanned.toLocaleString()} matching records…`;
    }
    if(Object.keys(weight).length) Object.assign(DATA.body, weight);
    const stepW = DATA.workouts[METRICS.steps.name], distW = DATA.workouts[METRICS.distance.name];
    for(const d in steps) stepW.sessions[d] = Math.round(steps[d]);
    for(const d in dist)  distW.sessions[d] = Math.round(dist[d]*100)/100;
    const wd = Object.keys(weight).length, sd = Object.keys(steps).length, dd = Object.keys(dist).length;
    if(!wd && !sd && !dd){
      status.textContent = `No matching records on/after ${fromDate||'(any date)'}. Pick an earlier date and re-upload.`;
      return;
    }
    save(); renderAll();
    const since = fromDate ? ` (on/after ${fromDate})` : '';
    status.textContent = `✓ Imported${since}: ${wd} day(s) weight · ${sd} day(s) steps · ${dd} day(s) distance.`;
  }catch(e){
    status.textContent = 'Could not read file: '+e.message;
  }
}

/* ============================== SETTINGS ============================== */
// Trainees section in Settings — only rendered for trainer accounts. List + add/edit/remove.
function traineesSectionHtml(){
  const me = userMeta();
  if(!me || me.type !== 'trainer') return '';
  const myList = traineesOf(currentUser()).filter(t => getUser(t));
  const items = myList.map(uname => {
    const u = getUser(uname);
    const isBuiltin = !!BUILTIN_USERS[uname];
    return `
      <div class="trainee-item" data-uname="${uname}">
        <div class="trainee-info">
          <div class="trainee-name">${u.displayName||uname}</div>
          <div class="trainee-sub">@${uname}${isBuiltin?' · built-in (link only)':''}</div>
        </div>
        <div class="trainee-actions">
          ${isBuiltin?'':'<button class="btn ghost sm trainee-edit">Edit</button>'}
          <button class="btn ghost sm trainee-remove">Remove</button>
        </div>
      </div>`;
  }).join('');
  return `
    <div class="block-title" style="margin-top:6px">My Trainees</div>
    <div class="modal-sub">Add a trainee to give them their own profile in this app. They can log in on their own device with the username + password you set. You'll see them in the "Viewing" dropdown at the top.</div>
    <div class="trainees-list">${items || '<div class="trainee-empty">No trainees yet — add your first one below.</div>'}</div>
    <button class="btn ghost sm" id="trainee-add-btn">+ Add Trainee</button>
    <div class="trainee-form" id="trainee-form" style="display:none">
      <input type="hidden" id="t-editing">
      <div class="field" style="margin-bottom:8px"><label>Display name</label><input id="t-display" placeholder="e.g. Jane Smith" autocapitalize="words"></div>
      <div class="field" style="margin-bottom:8px"><label>Username (login)</label><input id="t-uname" placeholder="e.g. jane" autocapitalize="none" autocorrect="off"></div>
      <div class="field" style="margin-bottom:8px"><label>Password</label><input id="t-pass" type="text" placeholder="they'll need this to log in"></div>
      <div class="trainee-err" id="t-err" style="display:none"></div>
      <div class="trainee-form-buttons">
        <button class="btn sm" id="t-save">Save</button>
        <button class="btn ghost sm" id="t-cancel">Cancel</button>
      </div>
    </div>`;
}
function wireTrainees(m){
  const me = userMeta();
  if(!me || me.type !== 'trainer') return;
  const form    = m.querySelector('#trainee-form');
  const addBtn  = m.querySelector('#trainee-add-btn');
  const err     = m.querySelector('#t-err');
  const editing = m.querySelector('#t-editing');
  const fDisp   = m.querySelector('#t-display');
  const fUname  = m.querySelector('#t-uname');
  const fPass   = m.querySelector('#t-pass');
  const saveBtn = m.querySelector('#t-save');
  const showErr = (msg) => { err.textContent = msg; err.style.display='block'; };
  const reset = () => {
    editing.value=''; fDisp.value=''; fUname.value=''; fPass.value='';
    fUname.disabled=false; fPass.placeholder = "they'll need this to log in";
    err.style.display='none';
  };
  addBtn.onclick = () => { reset(); form.style.display=''; addBtn.style.display='none'; fDisp.focus(); };
  m.querySelector('#t-cancel').onclick = () => { reset(); form.style.display='none'; addBtn.style.display=''; };
  saveBtn.onclick = async () => {
    err.style.display = 'none';
    saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
    try{
      if(editing.value) await editTrainee(editing.value, fDisp.value, fPass.value);
      else              await addTrainee(fUname.value, fPass.value, fDisp.value);
      openSettings();   // re-render with updated list
    }catch(e){
      showErr(e.message);
      saveBtn.disabled = false; saveBtn.textContent = 'Save';
    }
  };
  m.querySelectorAll('.trainee-edit').forEach(btn => {
    btn.onclick = () => {
      const uname = btn.closest('.trainee-item').dataset.uname;
      const u = getUser(uname);
      reset();
      editing.value = uname;
      fDisp.value   = u.displayName || '';
      fUname.value  = uname; fUname.disabled = true;
      fPass.placeholder = 'leave blank to keep current password';
      form.style.display=''; addBtn.style.display='none'; fDisp.focus();
    };
  });
  m.querySelectorAll('.trainee-remove').forEach(btn => {
    btn.onclick = async () => {
      const uname = btn.closest('.trainee-item').dataset.uname;
      const u = getUser(uname);
      const isBuiltin = !!BUILTIN_USERS[uname];
      const msg = isBuiltin
        ? `Unlink ${u.displayName||uname}? They'll stay logged in on their own device with their existing account — you just won't see them in your dropdown.`
        : `Remove ${u.displayName||uname}? Their account will be deleted (they won't be able to log in anymore). Their workout data stays in the cloud in case you want to recover it later.`;
      if(!confirm(msg)) return;
      try{ await removeTrainee(uname); openSettings(); }
      catch(e){ alert('Remove failed: '+e.message); }
    };
  });
}

function openSettings(){
  const key = localStorage.getItem(LS_USDA)||'';
  const ck  = localStorage.getItem(LS_CN)||'';
  const ak  = localStorage.getItem(LS_AI)||'';
  const m = document.getElementById('s-modal');
  m.innerHTML = `
    <div class="modal-head"><h3>Settings</h3><button class="x" id="s-close">×</button></div>
    ${traineesSectionHtml()}
    <div class="block-title" style="margin-top:18px">Body-scan AI key</div>
    <div class="modal-sub">Paste an <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">Anthropic API key</a>
      to enable photo-scanning of body-composition screenshots on the Body tab. <b>Set a low spend limit ($1/mo)</b>
      on the key first — scans cost ~$0.003 each. Leave blank to disable scanning (you can still type values by hand).</div>
    <div class="field" style="margin-bottom:16px"><label>Anthropic API key</label><input id="ai-key" value="${ak}" placeholder="sk-ant-… (blank = scanning off)"></div>
    <div class="block-title">Food lookup keys</div>
    <div class="modal-sub">Plain-language food entry is <b>already set up</b> — the keys are built into the app, so it
      works on every device with no setup needed. The boxes below are only if you ever want to use your <i>own</i>
      keys instead; leave them blank to keep the built-in ones.</div>
    <div class="field" style="margin-bottom:10px"><label>CalorieNinjas API key (optional override)</label><input id="cn-key" value="${ck}" placeholder="built-in key in use — paste to override"></div>
    <div class="field" style="margin-bottom:14px"><label>USDA API key (optional override)</label><input id="usda-key" value="${key}" placeholder="built-in key in use — paste to override"></div>

    <div class="block-title" style="margin-top:20px">Daily macro targets</div>
    <div class="modal-sub">The Nutrition totals show how far over/under these you are. Defaults are the
      <a href="https://www.fda.gov/food/nutrition-facts-label/daily-value-nutrition-and-supplement-facts-labels" target="_blank" rel="noopener">FDA Daily Values</a>
      for a 2,000-calorie diet — adjust to your own goals (e.g. lifters usually want more protein).</div>
    <div class="field-row" style="margin-bottom:14px">
      <div class="field"><label>Calories</label><input class="num" id="g-cal" type="number" inputmode="numeric" value="${goals().cal}"></div>
      <div class="field"><label>Protein (g)</label><input class="num" id="g-p" type="number" inputmode="numeric" value="${goals().p}"></div>
      <div class="field"><label>Carbs (g)</label><input class="num" id="g-c" type="number" inputmode="numeric" value="${goals().c}"></div>
      <div class="field"><label>Fat (g)</label><input class="num" id="g-f" type="number" inputmode="numeric" value="${goals().f}"></div>
      <div class="field"><label>Fiber (g)</label><input class="num" id="g-fib" type="number" inputmode="numeric" value="${goals().fib}"></div>
      <div class="field"><label>Sodium (mg)</label><input class="num" id="g-sod" type="number" inputmode="numeric" value="${goals().sod}"></div>
    </div>

    <button class="btn" id="usda-save">Save</button>
    <div class="block-title" style="margin-top:22px">Data</div>
    <div class="modal-sub">Synced to your private cloud bin and cached on this device. Same data on phone &amp; computer.</div>
    <button class="btn ghost sm" id="export-json">Download backup (.json)</button>
    <div class="user-chip">
      <span>Signed in as <b>${(userMeta()&&userMeta().displayName)||currentUser()}</b></span>
      <button class="logout" id="logout-btn">Log out</button>
    </div>
  `;
  m.querySelector('#s-close').onclick = ()=>document.getElementById('s-overlay').classList.remove('show');
  wireTrainees(m);
  m.querySelector('#usda-save').onclick = ()=>{
    localStorage.setItem(LS_USDA, document.getElementById('usda-key').value.trim());
    localStorage.setItem(LS_CN, document.getElementById('cn-key').value.trim());
    localStorage.setItem(LS_AI, document.getElementById('ai-key').value.trim());
    const gv = id => { const n=parseFloat(document.getElementById(id).value); return isFinite(n)&&n>=0 ? n : 0; };
    DATA.goals = {cal:gv('g-cal'), p:gv('g-p'), c:gv('g-c'), f:gv('g-f'), fib:gv('g-fib'), sod:gv('g-sod')};
    save();                                  // syncs targets across devices
    document.getElementById('s-overlay').classList.remove('show');
    renderNutrition(); renderBody();
  };
  m.querySelector('#logout-btn').onclick = doLogout;
  m.querySelector('#export-json').onclick = ()=>{
    const blob = new Blob([JSON.stringify(DATA,null,2)],{type:'application/json'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
    a.download=`workout-backup-${todayStr()}.json`; a.click();
  };
  document.getElementById('s-overlay').classList.add('show');
}

/* ============================== NURELI (hype tab) ============================== */
// Static celebratory tab: canvas fireworks + glowing banner + emoji crew. Set up once;
// the animation loop only does work while its tab is visible (saves battery elsewhere).
function setupNureli(){
  const root = document.getElementById('view-nureli');
  if(!root || root.dataset.ready) return;
  root.dataset.ready = '1';
  root.innerHTML = `
    <div class="nureli-stage">
      <canvas id="fw"></canvas>
      <div class="nureli-content">
        <div class="nureli-title">NURELI IS A BOSS</div>
        <div class="nureli-sub">👑 absolute legend · certified boss 👑</div>
      </div>
    </div>`;
  const cv = document.getElementById('fw'), ctx = cv.getContext('2d');
  const COLORS = ['#ff5e5e','#ffd24a','#5eff8f','#5ec8ff','#c98bff','#ff8bd0','#ffffff'];
  let parts = [], W = 1, H = 1;
  function fit(){ const r = cv.getBoundingClientRect(); W = cv.width = Math.max(1, r.width|0); H = cv.height = Math.max(1, r.height|0); }
  function boom(x, y){
    const n = 38 + (Math.random()*34|0), col = COLORS[Math.random()*COLORS.length|0];
    for(let i=0;i<n;i++){ const a = Math.random()*Math.PI*2, sp = 1 + Math.random()*4.5;
      parts.push({x, y, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp, life:1, col}); }
  }
  function frame(){
    requestAnimationFrame(frame);
    if(!root.classList.contains('active')) return;          // idle when not on this tab
    if((cv.getBoundingClientRect().width|0) !== W) fit();
    // fade trails by lowering existing pixels' alpha (keeps canvas transparent so the bg image shows)
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(0,0,W,H);
    ctx.globalCompositeOperation = 'source-over';
    if(Math.random() < 0.07) boom(Math.random()*W, Math.random()*H*0.62);
    for(let i=parts.length-1;i>=0;i--){ const p = parts[i];
      p.vy += 0.03; p.x += p.vx; p.y += p.vy; p.life -= 0.012;
      if(p.life <= 0){ parts.splice(i,1); continue; }
      ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.col; ctx.fillRect(p.x, p.y, 3, 3);
    }
    ctx.globalAlpha = 1;
  }
  fit(); requestAnimationFrame(frame);
  window.addEventListener('resize', ()=>{ if(root.classList.contains('active')) fit(); });
}

/* ============================== WIRING ============================== */
function renderAll(){ renderWorkouts(); renderNutrition(); renderBody(); }

// Trainer-only profile switcher in the header. Hidden entirely for personal accounts.
function renderProfileBar(){
  const bar = document.getElementById('profile-bar');
  if(!bar) return;
  const me = userMeta();
  if(!me || me.type !== 'trainer'){
    bar.style.display = 'none';
    bar.innerHTML = '';
    return;
  }
  const profiles = availableProfiles();
  const cur = currentProfile();
  const label = u => (getUser(u) && getUser(u).displayName) || u;
  const isSelf = u => u === currentUser();
  bar.style.display = '';
  bar.innerHTML = `
    <span class="profile-label">Viewing:</span>
    <select id="profile-sel">
      ${profiles.map(u => `<option value="${u}"${u===cur?' selected':''}>${label(u)}${isSelf(u)?' (you)':''}</option>`).join('')}
    </select>
    <span class="profile-tag">${isSelf(cur)?'Coach':'Trainee'}</span>
  `;
  bar.querySelector('#profile-sel').onchange = (e) => switchProfile(e.target.value);
}

// Mutations that change the trainer's roster. All persist immediately (no debounce) since
// account additions/removals are rare and the user expects them to "stick" before they walk away.
async function addTrainee(username, password, displayName){
  username = (username||'').trim();
  displayName = (displayName||'').trim();
  if(!displayName)         throw new Error('Display name required');
  if(!username)            throw new Error('Username required');
  if(!password)            throw new Error('Password required');
  if(!/^[A-Za-z0-9_-]{2,30}$/.test(username))
                           throw new Error('Username 2-30 chars: letters, numbers, dash, underscore');
  if(getUser(username))    throw new Error(`Username "${username}" is taken`);
  dynUsers[username] = { type:'personal', displayName, password };
  const me = currentUser();
  const list = (dynTrainees[me] !== undefined)
    ? dynTrainees[me].slice()
    : ((BUILTIN_USERS[me] && BUILTIN_USERS[me].trainees) || []).slice();
  if(!list.includes(username)) list.push(username);
  dynTrainees[me] = list;
  saveCachedUsers();
  await pushUsers();
  renderProfileBar();
}
async function editTrainee(username, displayName, newPassword){
  if(!dynUsers[username]) throw new Error("Built-in users can't be edited from the app");
  if(displayName) dynUsers[username].displayName = displayName.trim();
  if(newPassword) dynUsers[username].password    = newPassword;
  saveCachedUsers();
  await pushUsers();
  renderProfileBar();
}
async function removeTrainee(username){
  const me = currentUser();
  const list = (dynTrainees[me] !== undefined)
    ? dynTrainees[me].slice()
    : ((BUILTIN_USERS[me] && BUILTIN_USERS[me].trainees) || []).slice();
  const idx = list.indexOf(username);
  if(idx >= 0) list.splice(idx, 1);
  dynTrainees[me] = list;
  // Drop the auth entry too (built-in users like MPoretz survive — only the link is removed).
  if(dynUsers[username]) delete dynUsers[username];
  saveCachedUsers();
  const wasViewing = currentProfile() === username;
  if(wasViewing) localStorage.removeItem(LS_ACTIVE);
  await pushUsers();
  if(wasViewing) await switchProfile(me);
  else renderProfileBar();
}

// Swap the active profile without a page reload. Flushes any pending push first so the
// outgoing profile doesn't lose unsynced edits, then reloads DATA from cache + remote.
async function switchProfile(target){
  if(!availableProfiles().includes(target)) return;
  if(target === currentProfile()){ renderProfileBar(); return; }
  // Flush pending push for the OUTGOING profile (currentProfile() is still old here).
  if(pushTimer){
    clearTimeout(pushTimer); pushTimer = null;
    await pushRemote();
  }
  // Close any open modal so the user doesn't see stale content overlaid on the new profile.
  document.querySelectorAll('.overlay.show').forEach(o => o.classList.remove('show'));
  localStorage.setItem(LS_ACTIVE, target);
  setSync('saving', 'Loading profile…');
  DATA = emptyProfile();
  loadLocal();
  const {profile} = await fetchRemote();
  if(profile && (profile._updated||0) >= (DATA._updated||0)){
    DATA = profile; saveLocal();
  }
  ensureSeed(); ensureMetrics(); ensureAbsSeed();
  ensurePlankHold(); ensureVolleyball(); ensureBikeMode();
  renderAll(); stampUpdated();
  renderProfileBar();
  setSync('ok', 'Synced');
}

document.querySelectorAll('.tab').forEach(t=> t.onclick=()=>{
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));
  t.classList.add('active');
  document.getElementById('view-'+t.dataset.view).classList.add('active');
});
// event delegation for workout tables
document.getElementById('view-workouts').addEventListener('click', e=>{
  const open=e.target.closest('[data-open]'); if(open){ openWorkout(decodeURIComponent(open.dataset.open)); return; }
  const demo=e.target.closest('[data-demo]'); if(demo){ openDemo(decodeURIComponent(demo.dataset.demo)); return; }
  const del=e.target.closest('[data-del]'); if(del){ deleteWorkout(decodeURIComponent(del.dataset.del)); return; }
  const add=e.target.closest('[data-add]'); if(add){ addWorkout(add.dataset.add); return; }
  const tog=e.target.closest('[data-toggle]'); if(tog){ toggleGroup(tog.dataset.toggle); return; }
});
// Apple Health upload in the Cardio section
document.getElementById('view-workouts').addEventListener('change', e=>{
  if(e.target.id==='c-file' && e.target.files[0]){
    importHealth(e.target.files[0], document.getElementById('c-status'), document.getElementById('c-from').value);
  }
});
document.getElementById('w-overlay').addEventListener('click', e=>{ if(e.target.id==='w-overlay') closeWorkout(); });
document.getElementById('s-overlay').addEventListener('click', e=>{ if(e.target.id==='s-overlay') document.getElementById('s-overlay').classList.remove('show'); });
document.getElementById('gear').onclick = openSettings;

// refresh from cloud when returning to the page (e.g. computer after gym).
// Also pushes if local is newer — covers "made edits offline, then re-focused the tab".
document.addEventListener('visibilitychange', async ()=>{
  if(document.visibilityState==='visible' && userMeta()){
    const {bin, profile} = await fetchRemote();
    if(profile && (profile._updated||0) > (DATA._updated||0)){
      DATA = profile; saveLocal(); renderAll(); stampUpdated(); setSync('ok','Synced');
    } else if(bin && DATA._updated && DATA._updated > (profile && profile._updated || 0)){
      pushRemote();
    }
    renderProfileBar();
  }
});

// Push any queued local edits as soon as the network returns (gym Wi-Fi drops, etc).
window.addEventListener('online', ()=>{
  if(userMeta() && DATA && DATA._updated) pushRemote();
});

if('serviceWorker' in navigator){
  navigator.serviceWorker.register('sw.js').catch(()=>{});
}

loadCachedUsers();
if(!userMeta()){
  showLoginGate();
  fetchAndCacheUsers();   // background refresh so newly-added users can log in here too
} else {
  document.body.classList.remove('locked');
  renderProfileBar();
  setupNureli();
  initSync();
}
