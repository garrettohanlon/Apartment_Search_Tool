/* ============================================================================
   NYC Apartment Watch, Live Inventory terminal.

   Design contract: the nightly agent produces a JSON dataset. This app is a
   stable renderer over that dataset. The agent never writes UI code, and the
   app never invents listing facts. Everything scored here is computed from
   agent-supplied component sub-scores, so moving a weight slider re-ranks
   instantly with no round trip.
   ========================================================================= */
'use strict';

/* ---------------------------------------------------------------- geography */
/* Ranked geography. `tier` seeds the location score when the agent has not
   supplied a block-level location score; the agent's own value always wins.
   Per the search brief: do NOT treat all neighborhoods equally. */
const HOODS = [
  // --- West Side / downtown core (the strongest preference) ---
  {id:'west-village',   name:'West Village',        region:'West downtown', lat:40.7358, lon:-74.0036, on:true,  tier:1.00},
  {id:'greenwich',      name:'Greenwich Village',   region:'West downtown', lat:40.7336, lon:-73.9995, on:true,  tier:0.97},
  {id:'meatpacking',    name:'Meatpacking District',region:'West downtown', lat:40.7404, lon:-74.0071, on:true,  tier:0.95},
  {id:'chelsea',        name:'Chelsea',             region:'West downtown', lat:40.7465, lon:-74.0014, on:true,  tier:0.95},
  {id:'west-chelsea',   name:'West Chelsea',        region:'West downtown', lat:40.7480, lon:-74.0060, on:true,  tier:0.96},
  {id:'hudson-square',  name:'Hudson Square',       region:'West downtown', lat:40.7261, lon:-74.0075, on:true,  tier:0.94},
  {id:'tribeca',        name:'Tribeca',             region:'West downtown', lat:40.7163, lon:-74.0086, on:true,  tier:0.98},
  {id:'soho',           name:'SoHo',                region:'West downtown', lat:40.7233, lon:-74.0030, on:true,  tier:0.93},
  {id:'hudson-yards',   name:'Hudson Yards / far West (below 38th)', region:'West midtown', lat:40.7540, lon:-74.0020, on:true, tier:0.84},
  {id:'bpc',            name:'Battery Park City North', region:'West downtown', lat:40.7175, lon:-74.0165, on:true, tier:0.86},
  {id:'fidi',           name:'Financial District',  region:'West downtown', lat:40.7085, lon:-74.0110, on:false, tier:0.72},
  // --- Midtown south / east of the avenues ---
  {id:'flatiron',       name:'Flatiron',            region:'Midtown south', lat:40.7410, lon:-73.9896, on:true,  tier:0.90},
  {id:'nomad',          name:'NoMad',               region:'Midtown south', lat:40.7449, lon:-73.9877, on:true,  tier:0.88},
  {id:'union-square',   name:'Union Square',        region:'Midtown south', lat:40.7359, lon:-73.9911, on:true,  tier:0.87},
  {id:'gramercy',       name:'Gramercy',            region:'Midtown south', lat:40.7368, lon:-73.9845, on:true,  tier:0.86},
  {id:'east-village',   name:'East Village',        region:'East downtown', lat:40.7265, lon:-73.9815, on:true,  tier:0.84},
  {id:'murray-hill',    name:'Murray Hill',         region:'Midtown east',  lat:40.7479, lon:-73.9757, on:true,  tier:0.72, caveat:'compelling buildings only'},
  {id:'kips-bay',       name:'Kips Bay',            region:'Midtown east',  lat:40.7409, lon:-73.9781, on:true,  tier:0.68, caveat:'compelling buildings only'},
  // --- Upper East Side ---
  {id:'lenox-hill',     name:'Lenox Hill (UES)',    region:'Upper East Side', lat:40.7663, lon:-73.9634, on:true, tier:0.83},
  {id:'ues-carnegie',   name:'Carnegie Hill (UES)', region:'Upper East Side', lat:40.7834, lon:-73.9550, on:true, tier:0.80},
  {id:'yorkville',      name:'Yorkville (UES)',     region:'Upper East Side', lat:40.7760, lon:-73.9490, on:true, tier:0.72},
  {id:'ues',            name:'Upper East Side (other)', region:'Upper East Side', lat:40.7736, lon:-73.9566, on:true, tier:0.78},
];
const HOOD_BY_ID = Object.fromEntries(HOODS.map(h=>[h.id,h]));
/* West Side hard ceiling. Used by the "West Side Only" mode and the 38th St rule. */
const WEST_SIDE_IDS = HOODS.filter(h=>/West/.test(h.region)).map(h=>h.id);
const NORTH_LIMIT_LAT = 40.7555; // ~W 38th St

/* ------------------------------------------------------------ filter schema */
/* Every entry gets an importance: req | strong | nice | off.
   req excludes. strong and nice only penalise the Fit Score. This is the whole
   point: one missed minor preference must never delete an exceptional unit. */
const FILTERS = [
  {k:'beds', primary:true,      g:'Price & size', label:'Bedrooms (min)',        type:'num',  def:2,    imp:'req',    min:0, max:5, step:1},
  {k:'baths',     g:'Price & size', label:'Bathrooms (min)',       type:'num',  def:1,    imp:'nice',   min:0, max:4, step:0.5},
  {k:'sf', primary:true,        g:'Price & size', label:'Square feet (min)',     type:'num',  def:1200, imp:'strong', min:500, max:3000, step:50},
  {k:'rent', primary:true,      g:'Price & size', label:'Monthly rent',          type:'range',def:[4500,9000], imp:'req', min:2000, max:20000, step:250},

  {k:'stab', primary:true, g:'Regulation & value', label:'Rent stabilized', type:'enum', imp:'strong',
   def:'preferred', opts:[['only','Required'],['preferred','Preferred'],['irrelevant',"Doesn't matter"]]},
  {k:'valueMin',  g:'Regulation & value', label:'Min Value Score',   type:'num', def:0, imp:'off', min:0, max:100, step:5},
  {k:'discount',  g:'Regulation & value', label:'Min discount to market %', type:'num', def:0, imp:'off', min:0, max:40, step:2},
  {k:'noFee',     g:'Regulation & value', label:'No broker fee',     type:'bool', def:false, imp:'nice'},

  {k:'construction', primary:true, g:'Building', label:'Condition', type:'enum', imp:'strong', def:'reno',
   opts:[['reno','New or renovated'],['any','Any']]},
  {k:'bq', primary:true, g:'Building', label:'Building quality', type:'enum', imp:'strong',
   def:'nice', opts:[['luxury','Luxury'],['nice','Nice'],['any','Any']],
   thresholds:{luxury:82, nice:60, any:0}},
  {k:'doorman',   g:'Building', label:'Doorman',       type:'bool', def:true,  imp:'strong'},
  {k:'concierge', g:'Building', label:'Concierge',     type:'bool', def:false, imp:'nice'},
  {k:'elevator',  g:'Building', label:'Elevator',      type:'bool', def:true,  imp:'req'},
  {k:'gym',       g:'Building', label:'Gym',           type:'bool', def:false, imp:'nice'},
  {k:'roof_deck', g:'Building', label:'Roof deck',     type:'bool', def:false, imp:'nice'},
  {k:'package_room',g:'Building',label:'Package room', type:'bool', def:false, imp:'nice'},
  {k:'parking',   g:'Building', label:'Parking',       type:'bool', def:false, imp:'off'},
  {k:'pets',      g:'Building', label:'Pets allowed',  type:'bool', def:false, imp:'off'},

  {k:'aq',        g:'Apartment', label:'Min apartment condition', type:'num', def:60, imp:'strong', min:0, max:100, step:5},
  {k:'laundry_in_unit',g:'Apartment', label:'Laundry in unit', type:'bool', def:true,  imp:'strong'},
  {k:'central_air',g:'Apartment', label:'Central air',    type:'bool', def:false, imp:'nice'},
  {k:'outdoor_space',g:'Apartment',label:'Outdoor space',  type:'bool', def:false, imp:'nice'},
  {k:'floor',     g:'Apartment', label:'Min floor',       type:'num', def:0,  imp:'off', min:0, max:50, step:1},
  {k:'light',     g:'Apartment', label:'Min natural light',type:'num', def:0,  imp:'nice', min:0, max:100, step:10},
  {k:'views',     g:'Apartment', label:'Min views',       type:'num', def:0,  imp:'off', min:0, max:100, step:10},
  {k:'ceiling',   g:'Apartment', label:'Min ceiling (ft)', type:'num', def:0,  imp:'off', min:0, max:16, step:0.5},
  {k:'kitchen',   g:'Apartment', label:'Min kitchen quality', type:'num', def:0, imp:'nice', min:0, max:100, step:10},
  {k:'bath_q',    g:'Apartment', label:'Min bathroom quality',type:'num', def:0, imp:'nice', min:0, max:100, step:10},
  {k:'furnished', g:'Apartment', label:'Furnished', type:'enum', imp:'off', def:'any',
   opts:[['any','Either'],['yes','Furnished'],['no','Unfurnished']]},

  {k:'moveIn', primary:true,    g:'Terms', label:'Available by', type:'date', def:'', imp:'nice'},
  {k:'lease',     g:'Terms', label:'Lease length', type:'enum', imp:'off', def:'any',
   opts:[['any','Any'],['12','12 months'],['24','24 months'],['flex','Flexible']]},
  {k:'freshness', g:'Terms', label:'Listing freshness', type:'enum', imp:'off', def:'any',
   opts:[['today','Listed today'],['h24','Last 24 hours'],['d3','Last 3 days'],['any','Any']]},
];
const FILTER_BY_K = Object.fromEntries(FILTERS.map(f=>[f.k,f]));
const IMP_PENALTY = {req:0, strong:18, nice:6, off:0};

/* ------------------------------------------------------------------ weights */
const WEIGHT_KEYS = [
  ['location','Location'],['size','Size'],['price','Price'],
  ['building_quality','Building quality'],['apartment_quality','Apartment quality'],
  ['stabilization','Rent stabilization'],['amenities','Amenities'],['value','Value'],
];
const MODES = {
  best:     {label:'Best Overall',    w:{location:18,size:16,price:14,building_quality:14,apartment_quality:12,stabilization:14,amenities:6,value:16}},
  value:    {label:'Best Value',      w:{location:12,size:14,price:18,building_quality:10,apartment_quality:8,stabilization:10,amenities:4,value:34}},
  stab:     {label:'Rent Stabilized', w:{location:12,size:12,price:10,building_quality:10,apartment_quality:8,stabilization:38,amenities:4,value:12}},
  space:    {label:'Most Space',      w:{location:12,size:40,price:14,building_quality:10,apartment_quality:8,stabilization:8,amenities:4,value:10}},
  building: {label:'Best Buildings',  w:{location:16,size:10,price:8,building_quality:34,apartment_quality:20,stabilization:6,amenities:12,value:8}},
  newest:   {label:'Newest Listings', w:{location:16,size:14,price:12,building_quality:12,apartment_quality:10,stabilization:14,amenities:4,value:18}, byFresh:true},
};

/* -------------------------------------------------------------------- state */
const LS = 'aw.v1.';
const load = (k,d)=>{ try{ const v=localStorage.getItem(LS+k); return v?JSON.parse(v):d; }catch(e){ return d; } };
const save = (k,v)=>{ try{ localStorage.setItem(LS+k,JSON.stringify(v)); }catch(e){} };

const S = {
  data:null, demo:false, tab:'search', view:'list', mode:'best', sub:'apts', showMore:false, mapOpen:false,
  vals:  load('vals',  Object.fromEntries(FILTERS.map(f=>[f.k,f.def]))),
  imps:  load('imps',  Object.fromEntries(FILTERS.map(f=>[f.k,f.imp]))),
  weights:load('weights', {...MODES.best.w}),
  hoodsOn:load('hoodsOn', Object.fromEntries(HOODS.map(h=>[h.id,h.on]))),
  hoodsEx:load('hoodsEx', {}),
  exStreets:load('exStreets', []),
  exBuildings:load('exBuildings', []),
  onlyBuildings:load('onlyBuildings', []),
  saved:load('saved',{}), hidden:load('hidden',{}), followed:load('followed',{}),
  notes:load('notes',{}), status:load('status',{}), signals:load('signals',[]),
  compare:[], poly:null, viewportOnly:false, drawing:false,
  lastVisit:load('lastVisit',null), snapshot:load('snapshot',{}),
  selHoodIds:null, // Neighborhood Explorer selection
};
FILTERS.forEach(f=>{ if(S.vals[f.k]===undefined) S.vals[f.k]=f.def; if(!S.imps[f.k]) S.imps[f.k]=f.imp; });
WEIGHT_KEYS.forEach(([k])=>{ if(S.weights[k]===undefined) S.weights[k]=MODES.best.w[k]; });

function persist(){ save('vals',S.vals); save('imps',S.imps); save('weights',S.weights);
  save('hoodsOn',S.hoodsOn); save('hoodsEx',S.hoodsEx); save('exStreets',S.exStreets);
  save('exBuildings',S.exBuildings); save('onlyBuildings',S.onlyBuildings); }
function signal(type,id,extra){ S.signals.push({t:Date.now(),type,id,...(extra||{})});
  if(S.signals.length>4000) S.signals=S.signals.slice(-3000); save('signals',S.signals); }

/* ------------------------------------------------------------------ helpers */
const $  = s=>document.querySelector(s);
const el = (t,c,h)=>{ const n=document.createElement(t); if(c)n.className=c; if(h!==undefined)n.innerHTML=h; return n; };
const money = n=>n==null?'-':'$'+Math.round(n).toLocaleString();
const num   = (n,d=0)=>n==null?'-':Number(n).toFixed(d);
const esc   = s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const median= a=>{ const v=a.filter(x=>x!=null).sort((x,y)=>x-y); if(!v.length)return null;
  const m=v.length>>1; return v.length%2?v[m]:(v[m-1]+v[m])/2; };
const daysAgo = iso=>{ if(!iso)return null; const d=(Date.now()-new Date(iso).getTime())/864e5; return d<0?0:d; };
const STAB_ORDER = {confirmed:4, highly_likely:3, possible:2, market:1, unknown:0};
const STAB_LABEL = {confirmed:'CONFIRMED STABILIZED', highly_likely:'HIGHLY LIKELY STABILIZED',
  possible:'POSSIBLY STABILIZED', market:'MARKET RATE', unknown:'STATUS UNKNOWN'};

/* Availability gate. The feed must contain only genuinely live inventory. */
function isLive(L){
  if(L.availability_status && !/^(available|active)$/i.test(L.availability_status)) return false;
  if(L.cross_check && L.cross_check.status==='gone') return false;
  const dv = daysAgo(L.last_verified);
  if(dv!=null && dv>7) return false;             // stale verification
  return true;
}
function freshnessOf(L){
  const d = daysAgo(L.listed_date);
  if(L.freshness) return L.freshness;
  if(d==null) return 'older';
  if(d<1) return 'today'; if(d<2) return 'h24'; if(d<=3) return 'd3'; return 'older';
}
function effRent(L){
  if(L.effective_rent!=null) return L.effective_rent;
  let r=L.rent; if(r==null) return null;
  const mf=L.months_free||0, term=L.lease_months||12;
  if(mf) r = r*(term-mf)/term;
  if(L.fee_pct) r = r*(1+L.fee_pct/100/ (term/12) /12*12)/1; // fee amortised over term
  return Math.round(r);
}
function hoodOf(L){
  if(L.hood_id && HOOD_BY_ID[L.hood_id]) return HOOD_BY_ID[L.hood_id];
  const n=(L.neighborhood||'').toLowerCase();
  return HOODS.find(h=>h.name.toLowerCase().split(' (')[0]===n)
      || HOODS.find(h=>n && h.name.toLowerCase().includes(n))
      || null;
}
function bldgOf(L){ return (S.data&&S.data.buildings||[]).find(b=>b.id===L.building_id)||null; }

/* -------------------------------------------------------------- amenity map */
const AMEN_KEYS = ['doorman','concierge','elevator','gym','roof_deck','package_room','parking','pets',
                   'laundry_in_unit','central_air','outdoor_space'];
/* Tri-state on purpose. `null` means the data is silent, which is NOT the same
   as absent. Treating silence as absence would delete good apartments over
   missing listing metadata, the same failure mode as the square footage floor. */
function amenState(L,k){
  const a=L.amenities||{}, b=(bldgOf(L)||{}).amenities||{};
  const v = a[k]!==undefined ? a[k] : b[k];
  if(v===undefined||v===null||v==='') return null;
  return v===true||v==='yes'||v===1;
}
function hasAmen(L,k){ return amenState(L,k)===true; }

/* --------------------------------------------------------------- components */
/* The agent supplies 0-100 sub-scores. Where it did not, derive something
   defensible rather than inventing precision. */
function components(L){
  const c = Object.assign({}, L.components||{});
  const h = hoodOf(L);
  if(c.location==null)  c.location = h ? Math.round(h.tier*100) : 50;
  if(c.size==null){
    const target=S.vals.sf||1200;
    c.size = L.sf==null ? 50 : Math.max(0,Math.min(100, Math.round(100*L.sf/ (target*1.25))));
  }
  if(c.price==null){
    const [lo,hi]=S.vals.rent; const r=effRent(L);
    c.price = r==null?50 : Math.max(0,Math.min(100,Math.round(100*(hi-r)/Math.max(1,hi-lo))));
  }
  if(c.building_quality==null) c.building_quality = (bldgOf(L)||{}).quality_score ?? 55;
  if(c.apartment_quality==null) c.apartment_quality = L.condition_score ?? 55;
  if(c.stabilization==null) c.stabilization = {confirmed:100,highly_likely:82,possible:55,market:18,unknown:32}[L.stabilization?.class||'unknown'];
  if(c.amenities==null){
    const want = AMEN_KEYS.filter(k=>S.imps[k]&&S.imps[k]!=='off'&&(S.vals[k]===true||['req','strong'].includes(S.imps[k])));
    c.amenities = want.length? Math.round(100*want.filter(k=>hasAmen(L,k)).length/want.length) : 60;
  }
  if(c.value==null) c.value = L.value_score ?? 50;
  return c;
}

/* --------------------------------------------------- filter satisfaction */
/* Returns {ok, misses:[{k,label}]}. `ok` false only when a REQUIRED filter fails. */
function evaluate(L){
  const misses=[], unverified=[]; let ok=true;
  const fail=(k)=>{ const imp=S.imps[k]; if(imp==='off')return; if(imp==='req'){ok=false;} misses.push({k,label:FILTER_BY_K[k].label,imp}); };
  const unknown=(k)=>{ if(S.imps[k]==='off')return; unverified.push({k,label:FILTER_BY_K[k].label,imp:S.imps[k]}); };
  const V=S.vals;

  if(L.beds!=null && L.beds < V.beds) fail('beds');
  if(L.baths!=null && L.baths < V.baths) fail('baths');
  // Unknown sf is never treated as a failure. It is surfaced as size-unconfirmed.
  if(L.sf!=null && L.sf < V.sf) fail('sf');
  const r=effRent(L);
  if(r!=null && (r < V.rent[0] || r > V.rent[1])) fail('rent');

  const sc=L.stabilization?.class||'unknown';
  if(V.stab==='only' && STAB_ORDER[sc]<3) fail('stab');
  else if(V.stab==='preferred' && STAB_ORDER[sc]<2) fail('stab');

  if(V.valueMin>0 && (L.value_score??0) < V.valueMin) fail('valueMin');
  if(V.discount>0 && (L.discount_pct??0) < V.discount) fail('discount');
  if(V.noFee && !(L.fee==='none'||L.fee_paid_by==='landlord')) fail('noFee');

  const b=bldgOf(L)||{}, yr=b.year_renovated||b.year_built||L.year_built;
  if(V.construction!=='any'){
    const cond=(L.condition||'').toLowerCase();
    const newC = cond.includes('new construction') || (yr&&yr>=2020);
    const recent= newC || (yr&&yr>=2010);
    const reno  = recent || cond.includes('renovat');
    if(V.construction==='reno'&&!reno) fail('construction');
  }
  const bqMin = (FILTER_BY_K.bq.thresholds||{})[V.bq] ?? 0;
  if(bqMin>0 && (b.quality_score??55) < bqMin) fail('bq');
  if(V.aq>0 && (L.condition_score??55) < V.aq) fail('aq');

  AMEN_KEYS.forEach(k=>{
    if(V[k]!==true) return;
    const st=amenState(L,k);
    if(st===false) fail(k); else if(st===null) unknown(k);
  });

  if(V.floor>0 && L.floor!=null && L.floor<V.floor) fail('floor');
  [['light','light_score'],['views','views_score'],['kitchen','kitchen_score'],['bath_q','bathroom_score']]
    .forEach(([k,f])=>{ if(V[k]>0 && L[f]!=null && L[f]<V[k]) fail(k); });
  if(V.ceiling>0 && L.ceiling_ft!=null && L.ceiling_ft<V.ceiling) fail('ceiling');
  if(V.furnished!=='any' && L.furnished!=null){
    const isF = L.furnished===true||L.furnished==='yes';
    if((V.furnished==='yes')!==isF) fail('furnished');
  }
  if(V.moveIn && L.available_date && new Date(L.available_date) > new Date(V.moveIn)) fail('moveIn');
  if(V.lease!=='any' && L.lease_terms && !String(L.lease_terms).includes(V.lease)) fail('lease');
  if(V.freshness!=='any'){
    const order={today:3,h24:2,d3:1,older:0}, need={today:3,h24:2,d3:1}[V.freshness];
    if(order[freshnessOf(L)] < need) fail('freshness');
  }
  return {ok, misses, unverified};
}

/* ------------------------------------------------------------ geo filtering */
function pointInPoly(pt, poly){
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const [xi,yi]=poly[i], [xj,yj]=poly[j];
    if(((yi>pt[1])!==(yj>pt[1])) && (pt[0] < (xj-xi)*(pt[1]-yi)/(yj-yi)+xi)) inside=!inside;
  }
  return inside;
}
function geoOk(L){
  if(S.onlyBuildings.length) return S.onlyBuildings.includes(L.building_id);
  const h=hoodOf(L);
  if(h){ if(S.hoodsEx[h.id]) return false; if(!S.hoodsOn[h.id]) return false; }
  if(MODES[S.mode].westOnly){
    if(!h || !WEST_SIDE_IDS.includes(h.id)) return false;
    if(L.lat!=null && L.lat>NORTH_LIMIT_LAT) return false;
  }
  const addr=(L.address||'').toLowerCase();
  if(S.exStreets.some(s=>s&&addr.includes(s.toLowerCase()))) return false;
  if(S.exBuildings.includes(L.building_id)) return false;
  if(S.poly && L.lat!=null && !pointInPoly([L.lon,L.lat], S.poly)) return false;
  if(S.viewportOnly && window.MAP && L.lat!=null && !MAP.getBounds().contains([L.lat,L.lon])) return false;
  if(S.selHoodIds && S.tab==='hood'){ if(!h||!S.selHoodIds.includes(h.id)) return false; }
  return true;
}

/* ------------------------------------------------------------------ scoring */
function fitOf(L, ev, comp){
  const W=S.weights, tw=WEIGHT_KEYS.reduce((s,[k])=>s+(W[k]||0),0)||1;
  let f = WEIGHT_KEYS.reduce((s,[k])=>s+(W[k]||0)*(comp[k]??50),0)/tw;
  ev.misses.forEach(m=>{ if(m.imp!=='req') f -= IMP_PENALTY[m.imp]; });
  // Unknowns cost a little: a confirmed match should outrank an unconfirmed one.
  (ev.unverified||[]).forEach(u=>{ f -= (u.imp==='req'?3:u.imp==='strong'?2:1); });
  // Learned bias: buildings the user saved or followed nudge up, hidden nudge down.
  const b=L.building_id;
  const savedHere = Object.values(S.saved).filter(x=>x.building_id===b).length;
  const hidHere   = Object.values(S.hidden).filter(x=>x===b).length;
  f += Math.min(6, savedHere*3) + (S.followed[b]?3:0) - Math.min(6, hidHere*2);
  if(L.sf==null) f -= 4;                       // unverified size is a real unknown
  if(MODES[S.mode].gems) f += gemBonus(L);
  return Math.max(0, Math.min(100, Math.round(f)));
}
function gemBonus(L){
  let g=0;
  if((L.discount_pct??0) >= 8) g+=10;
  if(freshnessOf(L)==='today'||freshnessOf(L)==='h24') g+=5;
  if(!L.photos||!L.photos.length) g+=4;              // poorly marketed
  if((L.days_on_market??99) <= 2) g+=3;
  if(L.comps_count!=null && L.comps_count<=3) g+=4;  // scarce comparable set
  return g;
}

/* ------------------------------------------------------------- near misses */
/* A rigid filter that silently deletes an exceptional apartment is the failure
   mode this whole tool exists to avoid. Anything blocked by geography alone, or
   by exactly one Required filter, is surfaced separately with the reason. */
function nearMisses(){
  const all=(S.data&&S.data.listings||[]), out=[];
  for(const L of all){
    if(S.hidden[L.id]||!isLive(L)) continue;
    const geo=geoOk(L), ev=evaluate(L);
    const hardMisses=ev.misses.filter(m=>m.imp==='req');
    if(geo && ev.ok) continue;                       // already in the main feed
    let reason=null;
    if(!geo && ev.ok){
      const h=hoodOf(L);
      reason = S.onlyBuildings.length ? 'outside the building lock'
        : (h && S.hoodsEx[h.id]) ? `${h.name} is excluded`
        : (h && !S.hoodsOn[h.id]) ? `${h.name} is switched off`
        : S.poly ? 'outside your drawn area'
        : MODES[S.mode].westOnly ? 'outside West Side Only'
        : 'outside your geographic filters';
      reason = 'Clears every other filter, but '+reason+'.';
    } else if(geo && hardMisses.length===1){
      reason = `Clears everything except one Required filter: ${hardMisses[0].label}.`;
    } else continue;
    const comp=components(L);
    out.push({L,ev,comp,fit:fitOf(L,ev,comp),value:L.value_score??comp.value,eff:effRent(L),
              fresh:freshnessOf(L),sizeUnknown:L.sf==null,nearReason:reason});
  }
  return out.sort((a,b)=>b.fit-a.fit);
}

/* ------------------------------------------------------- plain-language labels */
/* The simple card shows words, not numbers. Numbers live in the detail view. */
const VALUE_LABEL = v => v>=75?'Excellent' : v>=58?'Good' : 'Fair';
function buildingLabel(L){
  const b=bldgOf(L)||{}, yr=b.year_renovated||b.year_built, q=b.quality_score??55;
  const cond=(L.condition||b.condition||'').toLowerCase();
  if(cond.includes('new construction')||(yr&&yr>=2020)) return 'New';
  if(q>=82) return 'Luxury';
  if(cond.includes('renovat')||(b.year_renovated&&b.year_renovated>=2010)) return 'Renovated';
  return 'Standard';
}
const STAB_SHORT = {confirmed:'Confirmed',highly_likely:'Likely',possible:'Possible',
                    market:'No',unknown:'Unknown'};
/* Availability confidence. Only a specific verified unit earns High. */
function availability(L){
  const dv=daysAgo(L.last_verified), cc=L.cross_check||{};
  const nSrc=(cc.sources_confirming||[]).length;
  if(cc.status==='conflict'||L.listing_grade==='building_indicated')
    return {level:'Low', why:'No specific unit was resolved, or sources disagree. Treat as a lead to confirm by phone.'};
  if(dv!=null&&dv<=1&&(nSrc>=2||cc.status==='confirmed'))
    return {level:'High', why:`Specific unit verified within 24 hours${nSrc>=2?` and corroborated by ${nSrc} sources`:''}.`};
  if(dv!=null&&dv<=3) return {level:'Medium', why:'Specific unit, verified in the last three days, single source.'};
  return {level:'Low', why:'Verification is older than three days. Re-confirm before acting.'};
}

/* --------------------------------------------------------------- the result */
function results(){
  const all=(S.data&&S.data.listings||[]);
  const rows=[];
  for(const L of all){
    if(S.hidden[L.id]) continue;
    if(!isLive(L)) continue;
    if(!geoOk(L)) continue;
    const ev=evaluate(L); if(!ev.ok) continue;
    const comp=components(L);
    rows.push({L, ev, comp, fit:fitOf(L,ev,comp), value:L.value_score??comp.value, eff:effRent(L),
               fresh:freshnessOf(L), sizeUnknown:L.sf==null});
  }
  if(MODES[S.mode].byFresh){
    const ord={today:3,h24:2,d3:1,older:0};
    rows.sort((a,b)=> (ord[b.fresh]-ord[a.fresh]) || ((a.L.days_on_market??99)-(b.L.days_on_market??99)) || (b.fit-a.fit));
  } else {
    const key = S.mode==='value' ? 'value' : 'fit';
    rows.sort((a,b)=> (b[key]-a[key]) || (b.fit-a.fit) || ((b.L.sf||0)-(a.L.sf||0)));
  }
  return rows;
}


/* ============================== VIEWS =====================================
   One goal per screen. Search is primary; the map is a panel, not the centre.
   Cards show words, not metrics. Numbers live in the detail view.
   ========================================================================= */
function renderAll(){ renderNav(); renderBody(); }

const NAV = [['search','Search'],['stab','Rent-Stabilized'],['saved','Saved'],['compare','Compare']];
function renderNav(){
  const n=$('#nav'); n.innerHTML='';
  NAV.forEach(([k,label])=>{
    const b=el('button',S.tab===k?'on':'',esc(label));
    if(k==='saved'){ const c=Object.keys(S.saved).length+Object.keys(S.followed).length;
      if(c) b.innerHTML+=` <i>${c}</i>`; }
    if(k==='compare'&&S.compare.length) b.innerHTML+=` <i>${S.compare.length}</i>`;
    b.onclick=()=>{ S.tab=k; signal('tab',k); renderAll(); };
    n.append(b);
  });
  $('#stamp').innerHTML = S.data
    ? `${esc(S.data.date||'')} &middot; ${(S.data.listings||[]).filter(isLive).length} available`
    : 'no data';
  $('#stamp').className = 'stamp'+(S.demo?' demo':'');
  if(S.demo) $('#stamp').innerHTML = 'DEMO DATA, nothing here is real';
}

function renderBody(){
  const m=$('#main'); m.innerHTML='';
  if(S.tab==='search')  return viewSearch(m);
  if(S.tab==='stab')    return viewStabilized(m);
  if(S.tab==='saved')   return viewSaved(m);
  if(S.tab==='compare') return viewCompare(m);
}

/* ------------------------------------------------------------------- search */
function searchBar(host, placeholder){
  const w=el('div','hero');
  w.append(el('h1','','What are you looking for?'));
  const box=el('div','sbox');
  const i=el('input'); i.type='text'; i.id='bigAsk'; i.value=S.lastQuery||'';
  i.placeholder = placeholder || 'Find me a nice renovated 2BR over 1,200 sq ft under $6,000 in Chelsea, West Village, East Village, UES, or the West Side below 38th. Prioritize rent stabilized and good value.';
  i.onkeydown=e=>{ if(e.key==='Enter'){ S.lastQuery=i.value; save('lastQuery',i.value); runAsk(i.value); } };
  const go=el('button','','Search');
  go.onclick=()=>{ S.lastQuery=i.value; save('lastQuery',i.value); runAsk(i.value); };
  box.append(i,go); w.append(box);
  w.append(el('p','herohint','Type it however you like. Everything below updates to match, and the interface tells you exactly what it changed.'));
  host.append(w);
}

function viewSearch(m){
  searchBar(m);
  primaryControls(m);
  moreFilters(m);
  if(!S.data){ m.append(emptyState()); return; }
  rankBar(m);
  discoveries(m);
  subTabs(m,[['apts','Available Apartments'],['watch','Buildings to Watch']]);
  if(S.sub==='apts') resultsList(m, results());
  else               buildingsToWatch(m);
  mapPanel(m);
}

/* The eight controls that matter. Everything else is behind More Filters. */
function primaryControls(m){
  const g=el('div','pcontrols');
  const cell=(label,node,note)=>{ const c=el('div','pc');
    c.append(el('div','pclabel',esc(label))); c.append(node);
    if(note) c.append(el('div','pcnote',esc(note))); g.append(c); return c; };

  const rent=el('div','inline');
  const r=el('input'); r.type='number'; r.step=250; r.value=S.vals.rent[1];
  r.onchange=()=>{ S.vals.rent=[S.vals.rent[0],+r.value]; persist(); renderBody(); };
  rent.append(el('span','pre','$'),r,el('span','suf','/mo'));
  cell('Max monthly rent',rent);

  const sfw=el('div','inline');
  const sf=el('input'); sf.type='number'; sf.step=50; sf.value=S.vals.sf;
  sf.onchange=()=>{ S.vals.sf=+sf.value; persist(); renderBody(); };
  sfw.append(sf,el('span','suf','sq ft min'));
  cell('Minimum size',sfw,'Unpublished sizes are shown, not filtered out');

  const bd=el('div','segsm');
  [1,2,3].forEach(v=>{ const b=el('button',S.vals.beds===v?'on':'',v+(v===3?'+':''));
    b.onclick=()=>{ S.vals.beds=v; persist(); renderBody(); }; bd.append(b); });
  cell('Bedrooms',bd);

  const hoodBtn=el('button','pcbtn');
  const onCount=HOODS.filter(h=>S.hoodsOn[h.id]&&!S.hoodsEx[h.id]).length;
  hoodBtn.textContent=`${onCount} selected`;
  hoodBtn.onclick=()=>openHoodPicker();
  cell('Neighborhoods',hoodBtn);

  cell('Rent stabilized', enumSeg('stab'));
  cell('Building quality', enumSeg('bq'));
  cell('Condition', enumSeg('construction'));

  const av=el('div','inline');
  const d=el('input'); d.type='date'; d.value=S.vals.moveIn||'';
  d.onchange=()=>{ S.vals.moveIn=d.value; persist(); renderBody(); };
  const now=el('button', S.vals.moveIn?'pcbtn':'pcbtn on','Available now');
  now.onclick=()=>{ S.vals.moveIn=''; persist(); renderBody(); };
  av.append(now,d); cell('Move in',av);

  m.append(g);
}
function enumSeg(k){
  const f=FILTER_BY_K[k], w=el('div','segsm');
  // Guard: a value persisted under an older schema (bq was once a 0-100 slider)
  // must fall back to the default rather than crashing the control.
  if(!f.opts) return w;
  if(!f.opts.some(([v])=>v===S.vals[k])) S.vals[k]=f.def;
  f.opts.forEach(([v,l])=>{ const b=el('button',S.vals[k]===v?'on':'',esc(l));
    b.onclick=()=>{ S.vals[k]=v; persist(); renderBody(); }; w.append(b); });
  return w;
}

function moreFilters(m){
  const wrap=el('div','more');
  const h=el('button','morebtn',(S.showMore?'Hide':'More')+' filters'+(S.showMore?'':' · amenities, floor, light, views, fees, lease, freshness, streets, weights'));
  h.onclick=()=>{ S.showMore=!S.showMore; renderBody(); };
  wrap.append(h);
  if(S.showMore){
    const inner=el('div','moreinner');
    // advanced filters, grouped
    const adv=FILTERS.filter(f=>!f.primary);
    [...new Set(adv.map(f=>f.g))].forEach(gname=>{
      const col=el('div','mcol'); col.append(el('h6','',esc(gname)));
      adv.filter(f=>f.g===gname).forEach(f=>col.append(filterRow(f)));
      inner.append(col);
    });
    // weights
    const wcol=el('div','mcol'); wcol.append(el('h6','','Ranking weights'));
    WEIGHT_KEYS.forEach(([k,label])=>{
      const row=el('div','row'); row.append(el('label','',esc(label)));
      const r=el('input'); r.type='range'; r.min=0; r.max=40; r.value=S.weights[k];
      const v=el('span','num',String(S.weights[k]));
      r.oninput=()=>{ v.textContent=r.value; };
      r.onchange=()=>{ S.weights[k]=+r.value; persist(); renderBody(); };
      row.append(r,v); wcol.append(row);
    });
    // exclusions
    const xcol=el('div','mcol'); xcol.append(el('h6','','Exclude'));
    [['Streets or blocks','exStreets','e.g. 8th Ave'],['Buildings','exBuildings','building id']].forEach(([lab,key,ph])=>{
      xcol.append(el('div','row','<label>'+esc(lab)+'</label>'));
      const i=el('input'); i.type='text'; i.placeholder=ph+'  (Enter)';
      i.onkeydown=e=>{ if(e.key==='Enter'&&i.value.trim()){ S[key].push(i.value.trim()); persist(); renderBody(); } };
      xcol.append(i);
      const t=el('div','tagin');
      S[key].forEach((s,ix)=>{ const x=el('span','t',esc(s)+' <b>&times;</b>');
        x.querySelector('b').onclick=()=>{ S[key].splice(ix,1); persist(); renderBody(); }; t.append(x); });
      xcol.append(t);
    });
    const rs=el('button','linkbtn','Reset everything to my defaults');
    rs.onclick=()=>{ if(!confirm('Reset filters and weights? Saved apartments are kept.')) return;
      S.vals=Object.fromEntries(FILTERS.map(f=>[f.k,f.def])); S.imps=Object.fromEntries(FILTERS.map(f=>[f.k,f.imp]));
      S.weights={...MODES.best.w}; S.hoodsOn=Object.fromEntries(HOODS.map(h=>[h.id,h.on])); S.hoodsEx={};
      S.exStreets=[]; S.exBuildings=[]; S.onlyBuildings=[]; S.poly=null; persist(); renderBody(); };
    xcol.append(rs);
    inner.append(wcol,xcol); wrap.append(inner);
  }
  m.append(wrap);
}
function filterRow(f){
  const row=el('div','row'); row.append(el('label','',esc(f.label)));
  if(f.type==='bool'){ const cb=el('input'); cb.type='checkbox'; cb.checked=!!S.vals[f.k];
    cb.onchange=()=>{ S.vals[f.k]=cb.checked; persist(); renderBody(); }; row.append(cb); }
  else if(f.type==='enum'){ const s=el('select');
    f.opts.forEach(([v,l])=>{ const o=el('option','',esc(l)); o.value=v; if(S.vals[f.k]===v)o.selected=true; s.append(o); });
    s.onchange=()=>{ S.vals[f.k]=s.value; persist(); renderBody(); }; row.append(s); }
  else if(f.type==='date'){ const i=el('input'); i.type='date'; i.value=S.vals[f.k]||'';
    i.onchange=()=>{ S.vals[f.k]=i.value; persist(); renderBody(); }; row.append(i); }
  else if(f.type==='range'){ const a=el('input'),b=el('input'); a.type=b.type='number';
    a.value=S.vals[f.k][0]; b.value=S.vals[f.k][1];
    a.onchange=b.onchange=()=>{ S.vals[f.k]=[+a.value,+b.value]; persist(); renderBody(); };
    const d=el('div','inline'); d.append(a,el('span','suf','to'),b); row.append(d); }
  else { const r=el('input'); r.type='range'; r.min=f.min; r.max=f.max; r.step=f.step; r.value=S.vals[f.k];
    const v=el('span','num',String(S.vals[f.k])); r.oninput=()=>{v.textContent=r.value;};
    r.onchange=()=>{ S.vals[f.k]=+r.value; persist(); renderBody(); }; row.append(r,v); }
  row.append(impCtl(f.k)); return row;
}
function impCtl(k){
  const wrap=el('div','imp');
  [['req','R','Required, excludes'],['strong','S','Strong preference'],['nice','N','Nice to have'],['off','–','Ignore']]
   .forEach(([v,t,title])=>{ const b=el('button',S.imps[k]===v?'on':'',t); b.dataset.v=v; b.title=title;
     b.onclick=()=>{ S.imps[k]=v; persist(); renderBody(); }; wrap.append(b); });
  return wrap;
}

function rankBar(m){
  const w=el('div','rankbar');
  w.append(el('span','rlabel','Rank by'));
  Object.entries(MODES).forEach(([k,v])=>{ const b=el('button',S.mode===k?'on':'',esc(v.label));
    b.onclick=()=>{ S.mode=k; S.weights={...v.w}; persist(); signal('mode',k); renderBody(); }; w.append(b); });
  m.append(w);
}

/* Proactive callouts. Agent-supplied, plus two the interface can derive itself. */
function discoveries(m){
  const list=[...((S.data&&S.data.discoveries)||[])];
  const R=results();
  const gem=R.find(r=>(r.L.discount_pct??0)>=12);
  if(gem) list.push({kind:'Exceptional value',
    text:`${gem.L.address||''}${gem.L.unit?' #'+gem.L.unit:''} is about ${Math.abs(gem.L.discount_pct)}% below estimated market for comparable inventory nearby.`,
    listing_id:gem.L.id});
  const lead=R.find(r=>['highly_likely','possible'].includes(r.L.stabilization?.class)&&r.L.listing_grade==='building_indicated');
  if(lead) list.push({kind:'Rent-stabilized lead',
    text:`${lead.L.building_name||lead.L.address} has stabilization evidence and a two-bedroom advertised directly. Unit status needs confirmation by phone.`,
    listing_id:lead.L.id});
  if(!list.length) return;
  const w=el('div','discs');
  list.slice(0,4).forEach(d=>{
    const c=el('div','disc');
    c.append(el('div','dkind',esc(d.kind||'Discovery')));
    c.append(el('div','dtext',esc(d.text||'')));
    if(d.listing_id){ const b=el('button','linkbtn','Open');
      b.onclick=()=>{ const r=results().find(x=>x.L.id===d.listing_id); if(r) openDetail(r); }; c.append(b); }
    w.append(c);
  });
  m.append(w);
}

function subTabs(m,items){
  const w=el('div','subtabs');
  items.forEach(([k,label])=>{ const b=el('button',S.sub===k?'on':'',esc(label));
    b.onclick=()=>{ S.sub=k; renderBody(); }; w.append(b); });
  m.append(w);
}

/* --------------------------------------------------------------- result list */
function resultsList(m, R){
  const cov=S.data.coverage;
  if(S.demo) m.append(el('div','notice','<b>Demo data.</b> Fabricated examples so you can try the interface. Nothing here is a real apartment.'));
  if(!R.length){
    m.append(el('div','empty','<h3>Nothing currently available matches</h3>'+
      '<p>No verified live unit clears your required filters. Try raising max rent, lowering minimum size, '+
      'setting Rent stabilized to Preferred rather than Required, or adding neighborhoods.</p>'));
  } else {
    m.append(el('div','rescount',`Showing the ${Math.min(R.length,20)} strongest of ${R.length} available`));
    R.slice(0,20).forEach(r=>m.append(simpleCard(r)));
    if(R.length>20){ const b=el('button','linkbtn wide',`Show all ${R.length}`);
      b.onclick=()=>{ R.slice(20).forEach(r=>m.append(simpleCard(r))); b.remove(); }; m.append(b); }
  }
  const nm=nearMisses();
  if(nm.length){
    const w=el('div','nearwrap');
    const h=el('button','morebtn',`${nm.length} one filter away`);
    h.onclick=()=>{ S.showNear=!S.showNear; renderBody(); };
    w.append(h);
    if(S.showNear){
      w.append(el('p','hint','Not in your results. Each is blocked by geography alone or by exactly one required filter, shown so a single preference never silently deletes a good apartment.'));
      nm.slice(0,10).forEach(r=>{ const c=simpleCard(r); c.classList.add('dim');
        c.append(el('div','nearwhy',esc(r.nearReason))); w.append(c); });
    }
    m.append(w);
  }
  if(cov&&cov.sources_blocked&&cov.sources_blocked.length)
    m.append(el('div','covnote',`<b>Coverage gap.</b> ${cov.sources_blocked.length} source(s) blocked automated access on the last run: ${esc(cov.sources_blocked.join(', '))}. Inventory covered only by those is missing, not absent.`));
}

function simpleCard(r){
  const L=r.L, av=availability(L), sc=L.stabilization?.class||'unknown';
  const n=el('div','rcard'+(S.compare.includes(L.id)?' sel':''));
  const top=el('div','rtop');
  const left=el('div','rleft');
  left.append(el('div','raddr',esc(L.address||'address n/a')+(L.unit?` <span>#${esc(L.unit)}</span>`:'')));
  left.append(el('div','rsub',[L.building_name,L.neighborhood].filter(Boolean).map(esc).join(' · ')));
  const facts=el('div','rfacts');
  facts.innerHTML=[`${L.beds??'?'}BR`,`${L.baths??'?'} bath`,
    L.sf?`${L.sf.toLocaleString()} sq ft`:'<em>size not published</em>'].join('<i>|</i>');
  left.append(facts);
  const tags=el('div','rtags');
  tags.append(tag('Rent stabilized: '+STAB_SHORT[sc], 'stab-'+sc, ()=>openStabWhy(L)));
  tags.append(tag('Building: '+buildingLabel(L),'plain'));
  tags.append(tag('Value: '+VALUE_LABEL(r.value),'val-'+VALUE_LABEL(r.value).toLowerCase()));
  tags.append(tag('Available: '+(av.level==='Low'?'Unconfirmed':'Yes'),'av-'+av.level.toLowerCase(),()=>alert('Availability confidence: '+av.level+'\n\n'+av.why)));
  left.append(tags);
  const right=el('div','rright');
  right.append(el('div','rrent',L.rent!=null?money(L.rent):'rent n/a'));
  if(r.eff!=null&&r.eff!==L.rent) right.append(el('div','reff','effective '+money(r.eff)));
  right.append(el('div','rver','Last verified '+esc((L.last_verified||'unknown').slice(0,10))));
  right.append(el('div','rver','Confidence: '+av.level));
  top.append(left,right); n.append(top);
  const acts=el('div','racts');
  const A=(t,cls,fn)=>{ const b=el('button',cls||'',t); b.onclick=e=>{e.stopPropagation();fn();}; acts.append(b); };
  A('View Details','primary',()=>openDetail(r));
  A(S.compare.includes(L.id)?'Comparing':'Compare', S.compare.includes(L.id)?'on':'',
    ()=>{ const i=S.compare.indexOf(L.id); i<0?S.compare.push(L.id):S.compare.splice(i,1); signal('compare',L.id); renderAll(); });
  A(S.saved[L.id]?'Saved':'Save', S.saved[L.id]?'on':'',
    ()=>{ if(S.saved[L.id]) delete S.saved[L.id]; else S.saved[L.id]={id:L.id,building_id:L.building_id,at:Date.now()};
      save('saved',S.saved); signal('save',L.id); renderAll(); });
  n.append(acts);
  n.onclick=()=>{ signal('view',L.id); openDetail(r); };
  return n;
}
function tag(text,cls,onclick){
  const b=el(onclick?'button':'span','tg '+(cls||''),esc(text));
  if(onclick) b.onclick=e=>{e.stopPropagation();onclick();};
  return b;
}

/* ------------------------------------------------------------- detail drawer */
function openDetail(r){
  const L=r.L, b=bldgOf(L)||{}, sc=L.stabilization?.class||'unknown', av=availability(L);
  $('#drawerTitle').innerHTML = esc(L.address||'')+(L.unit?` <span class="unit">#${esc(L.unit)}</span>`:'');
  const d=$('#drawerBody'); d.innerHTML='';

  // Agent Take goes first. It is the reason to read the rest.
  const take=el('div','take');
  take.append(el('h5','','Agent Take'));
  take.append(el('div','tl','Why I would consider it'));
  take.append(el('p','',esc(L.why_matches||'The agent did not supply a recommendation for this listing.')));
  take.append(el('div','tl','Main tradeoff'));
  take.append(el('p','',esc(L.tradeoffs||'None recorded. Ask what is wrong with it on the call.')));
  d.append(take);

  if(L.photos&&L.photos.length){
    const g=el('div','gal');
    L.photos.slice(0,8).forEach(u=>{ const i=el('img'); i.src=u; i.loading='lazy'; i.onerror=()=>i.remove(); g.append(i); });
    d.append(g);
  }
  if(L.floorplan_url){ const a=el('a','linkbtn','Open floor plan'); a.href=L.floorplan_url; a.target='_blank'; d.append(a); }
  else d.append(el('p','hint','No floor plan published. Worth requesting from the leasing office.'));

  const put=(dl,k,v)=>{ if(v==null||v==='')return; dl.append(el('dt','',esc(k)),el('dd','',v)); };
  d.append(el('h5','','The numbers'));
  const n1=el('dl','kv');
  put(n1,'Asking rent', L.rent!=null?`<b>${money(L.rent)}</b>`:'not published');
  put(n1,'Effective rent', r.eff!=null?money(r.eff)+(L.concessions_text?` <span class="sub">${esc(L.concessions_text)}</span>`:''):null);
  put(n1,'Square footage', L.sf?L.sf.toLocaleString()+(L.sf_source?` <span class="sub">(${esc(L.sf_source)})</span>`:'')
      :`<span class="neg">not published</span>${b.avg_sf_per_unit?` <span class="sub">building averages ${b.avg_sf_per_unit} sq ft/unit across all sizes</span>`:''}`);
  put(n1,'Rent per sq ft', L.sf?'$'+num(L.rent/L.sf,2):'not computable without a size');
  put(n1,'Estimated market rent', L.est_market_rent?money(L.est_market_rent):null);
  put(n1,'Versus market', L.discount_pct!=null?`<b class="${L.discount_pct>0?'pos':'neg'}">${L.discount_pct>0?'-':'+'}${Math.abs(L.discount_pct)}%</b>${L.comps_count?` <span class="sub">against ${L.comps_count} comparable unit(s)</span>`:''}`:null);
  put(n1,'Bedrooms / baths', `${L.beds??'?'} / ${L.baths??'?'}`);
  put(n1,'Floor', L.floor??null);
  put(n1,'Broker fee', L.fee?esc(L.fee)+(L.fee_paid_by?` (${esc(L.fee_paid_by)} pays)`:''):null);
  put(n1,'Concessions', esc(L.concessions_text||''));
  put(n1,'Move-in', esc(L.available_date||''));
  d.append(n1);

  d.append(el('h5','','The building'));
  const n2=el('dl','kv');
  put(n2,'Building', esc(b.name||L.building_name||''));
  put(n2,'Neighborhood', esc(L.neighborhood||''));
  put(n2,'Built', b.year_built);
  put(n2,'Renovated', b.year_renovated);
  put(n2,'Units', b.units);
  put(n2,'Classification', buildingLabel(L));
  put(n2,'Management', esc(b.management||''));
  put(n2,'Tax program', esc(b.program||''));
  put(n2,'Benefit status', esc(b.benefit_status||''));
  put(n2,'Transit', esc(b.transit||''));
  d.append(n2);
  const am=AMEN_KEYS.filter(k=>hasAmen(L,k));
  if(am.length){ d.append(el('h5','','Amenities'));
    d.append(el('p','',am.map(k=>esc(k.replace(/_/g,' '))).join(' · '))); }

  d.append(el('h5','','Availability'));
  const n3=el('dl','kv');
  put(n3,'Confidence', `<b class="av-${av.level.toLowerCase()}">${av.level}</b>`);
  put(n3,'Why', esc(av.why));
  put(n3,'Last verified', esc(L.last_verified||'unknown'));
  put(n3,'Listed', esc(L.listed_date||'unknown')+(L.days_on_market!=null?` &middot; ${L.days_on_market} days on market`:''));
  put(n3,'Found on', L.url?`<a href="${esc(L.url)}" target="_blank">${esc(L.source||'listing')}</a>`:esc(L.source||''));
  const other=(L.cross_check&&L.cross_check.sources_confirming)||[];
  put(n3,'Other sources confirming', other.length?other.map(esc).join(', '):'<span class="sub">none found. Single-source availability.</span>');
  d.append(n3);

  d.append(el('h5','','Rent stabilization'));
  const lab=el('div','stabbig stab-'+sc, ({confirmed:'Confirmed Rent Stabilized',highly_likely:'Strong Evidence',
    possible:'Possible',market:'Market Rate',unknown:'Unknown'})[sc]);
  d.append(lab);
  const ul=el('ul','evlist');
  (L.stabilization?.reasons||['No reasoning supplied.']).forEach(x=>ul.append(el('li','',esc(x))));
  d.append(ul);
  if(sc!=='confirmed') d.append(el('p','hint','Not confirmed. For any individual apartment the standing position is: potentially stabilized, tenant-specific DHCR verification required. Pull the unit rent history from HCR before signing.'));

  const comps=(L.comparables||[]);
  d.append(el('h5','','Comparable apartments'));
  if(!comps.length) d.append(el('p','hint','The agent did not attach a comparable set to this listing. Use Find More Like This below.'));
  else { const t=el('table','cmp');
    t.innerHTML='<tr><th>Address</th><th>Rent</th><th>Sq ft</th><th>$/sf</th></tr>'+
      comps.map(c=>`<tr><td>${esc(c.address||'')}</td><td>${money(c.rent)}</td><td>${c.sf?c.sf.toLocaleString():'-'}</td><td>${c.sf?'$'+num(c.rent/c.sf,2):'-'}</td></tr>`).join('');
    d.append(t); }
  if(L.value_reasons){ d.append(el('h5','','Why this is or is not good value')); d.append(el('p','',esc(L.value_reasons))); }

  d.append(el('h5','','Fit and value'));
  d.append(el('div','scorerow',`<div><div class="sn">${r.fit}</div><div class="sl">Fit Score</div></div>`+
    `<div><div class="sn">${Math.round(r.value)}</div><div class="sl">Value Score</div></div>`));
  const bd=el('div','breakdown');
  WEIGHT_KEYS.forEach(([k,label])=>{ const v=r.comp[k]??50;
    bd.append(el('div','brow',`<span>${esc(label)}</span><i style="width:${Math.max(0,Math.min(100,v))}%"></i><b>${Math.round(v)}</b>`)); });
  d.append(bd);

  d.append(el('h5','','Actions'));
  const acts=el('div','dacts');
  const A=(t,cls,fn)=>{ const b=el('button',cls||'',t); b.onclick=fn; acts.append(b); };
  A('Find More Like This','primary',()=>findMoreLikeThis(r));
  A('Deep Search this building','',()=>deepSearch('building',L.building_id,b.name||L.address));
  A(S.saved[L.id]?'Saved':'Save', S.saved[L.id]?'on':'', ()=>{
    if(S.saved[L.id]) delete S.saved[L.id]; else S.saved[L.id]={id:L.id,building_id:L.building_id,at:Date.now()};
    save('saved',S.saved); signal('save',L.id); openDetail(r); renderNav(); });
  A(S.followed[L.building_id]?'Following building':'Follow building', S.followed[L.building_id]?'on':'', ()=>{
    if(S.followed[L.building_id]) delete S.followed[L.building_id]; else S.followed[L.building_id]={at:Date.now()};
    save('followed',S.followed); signal('follow',L.building_id); openDetail(r); renderNav(); });
  A('Hide','',()=>{ S.hidden[L.id]=L.building_id; save('hidden',S.hidden); closeOverlays(); renderBody(); });
  if(L.url) A('Open listing','',()=>{ window.open(L.url,'_blank'); signal('open',L.id); });
  d.append(acts);
  d.append(el('h5','','Private notes'));
  const ta=el('textarea'); ta.rows=3; ta.value=S.notes[L.id]||''; ta.placeholder='Stays on this machine.';
  ta.onchange=()=>{ S.notes[L.id]=ta.value; save('notes',S.notes); }; d.append(ta);

  $('#scrim').classList.add('on'); $('#drawer').classList.add('on');
}

function openStabWhy(L){
  const sc=L.stabilization?.class||'unknown';
  const label={confirmed:'Confirmed Rent Stabilized',highly_likely:'Strong Evidence',possible:'Possible',
    market:'Market Rate',unknown:'Unknown'}[sc];
  alert(label+'\n\n'+(L.stabilization?.reasons||['No reasoning supplied.']).map(x=>'• '+x).join('\n')+
    (sc!=='confirmed'?'\n\nNot confirmed. Potentially stabilized, tenant-specific DHCR verification required.':''));
}

/* ------------------------------------------------- find more like this / deep */
function findMoreLikeThis(r){
  const L=r.L;
  const opts=['Similar, but cheaper','Similar, but West Village','Similar, but 1,300+ sq ft',
              'Similar, but rent stabilized','Similar, but newer building','Just similar'];
  const pick=prompt('Find more like '+(L.address||'this')+'.\n\n'+
    opts.map((o,i)=>(i+1)+'. '+o).join('\n')+'\n\nEnter 1-6, or type your own.');
  if(!pick) return;
  const n=parseInt(pick,10);
  const q=(n>=1&&n<=6)?opts[n-1]:pick;
  // Apply what can be applied locally, then queue the web research for the next run.
  S.vals.beds=L.beds||S.vals.beds;
  if(L.sf) S.vals.sf=Math.max(1000,Math.round(L.sf*0.9/50)*50);
  if(L.rent) S.vals.rent=[S.vals.rent[0], Math.round(L.rent*1.05/250)*250];
  if(/cheaper/i.test(q) && L.rent) S.vals.rent=[S.vals.rent[0], Math.max(1000,L.rent-500)];
  if(/1,?300/.test(q)) S.vals.sf=1300;
  if(/stabili/i.test(q)){ S.vals.stab='only'; S.imps.stab='req'; }
  if(/newer/i.test(q)) S.vals.construction='reno';
  const hood=HOODS.find(h=>new RegExp(h.name.split(' (')[0],'i').test(q));
  if(hood){ HOODS.forEach(h=>S.hoodsOn[h.id]=false); S.hoodsOn[hood.id]=true; delete S.hoodsEx[hood.id]; }
  persist();
  queueRequest({type:'find_more_like', seed:{id:L.id,address:L.address,rent:L.rent,sf:L.sf,
    neighborhood:L.neighborhood,building_id:L.building_id}, instruction:q});
  closeOverlays(); S.tab='search'; renderAll();
  alert(`Filters shifted to match "${q}" against the inventory already loaded.\n\n`+
    `A web search for genuinely new matches has been queued for the next agent run, since finding `+
    `listings that are not in today's dataset needs a live search.`);
}
function deepSearch(kind,id,label){
  queueRequest({type:'deep_search', target_kind:kind, target_id:id, target_label:label});
  const b=(S.data.buildings||[]).find(x=>x.id===id);
  let known='';
  if(b) known='\n\nAlready on file:\n'+[
    b.address&&('Address: '+b.address), b.management&&('Management: '+b.management),
    b.owner&&('Owner: '+b.owner), b.program&&('Tax program: '+b.program),
    b.benefit_status&&('Benefit status: '+b.benefit_status), b.bbl&&('BBL: '+b.bbl),
    (b.contact&&b.contact.phone)&&('Phone: '+b.contact.phone),
  ].filter(Boolean).map(x=>'• '+x).join('\n');
  alert(`Deep Search queued for ${label}.\n\nThe next agent run will investigate current listings, `+
    `management and owner, direct leasing contact, archived leasing pages, stabilized-unit evidence, `+
    `tax-benefit history, regulatory records, small-broker listings, and other properties held by the `+
    `same landlord.\n\nThis cannot run in the browser: it needs the agent's web access.`+known);
}
function queueRequest(req){
  const q=load('requests',[]); q.push({...req,at:new Date().toISOString()});
  save('requests',q);
}

/* ----------------------------------------------------- rent-stabilized view */
function viewStabilized(m){
  searchBar(m,'Rent-stabilized 2BR, 1,200+ sq ft, Chelsea or West Village, under $7,000');
  m.append(el('div','lead','<b>Rent-Stabilized Opportunities.</b> This mode does not look for listings containing the words "rent stabilized". It works building-first: identify buildings likely to hold regulated units from building age, unit count, J-51 and 421-a or 421-g history, prior stabilized listings, regulatory agreements and owner portfolios, then check whether anything qualifying is actually available. Being in a regulated building does not make a specific apartment regulated.'));
  primaryControls(m);
  if(!S.data){ m.append(emptyState()); return; }
  const keep={stab:S.vals.stab,imp:S.imps.stab,mode:S.mode};
  S.vals.stab='preferred'; S.imps.stab='strong'; S.mode='stab'; S.weights={...MODES.stab.w};
  const R=results().filter(r=>STAB_ORDER[r.L.stabilization?.class||'unknown']>=2);
  subTabs(m,[['apts','Available Apartments'],['watch','Buildings to Watch'],['off','Off-Market / Under-the-Radar']]);
  if(S.sub==='apts'){
    m.append(el('div','rescount',`${R.length} available unit(s) with stabilization evidence`));
    if(!R.length) m.append(el('div','empty','<h3>No stabilized units available right now</h3><p>This is normal. Regulated inventory in good buildings turns over rarely. Use Buildings to Watch and follow the strongest candidates so the next run flags them the morning something appears.</p>'));
    R.forEach(r=>m.append(simpleCard(r)));
  } else if(S.sub==='watch') buildingsToWatch(m);
  else offMarket(m);
  S.vals.stab=keep.stab; S.imps.stab=keep.imp; S.mode=keep.mode; S.weights={...MODES[keep.mode].w};
}

/* Buildings with no qualifying availability. Deliberately never in apartment results. */
function buildingsToWatch(m){
  const all=(S.data.buildings||[]);
  const live=new Set((S.data.listings||[]).filter(isLive).map(x=>x.building_id));
  const rows=all.filter(b=>!live.has(b.id))
    .sort((a,b)=>(b.fit_seed??0)-(a.fit_seed??0));
  m.append(el('div','lead','Promising buildings with <b>nothing currently available</b> that meets your criteria. Kept out of apartment results on purpose, so a building never reads as inventory it does not have.'));
  m.append(el('div','rescount',`${rows.length} building(s) with no qualifying availability today`));
  rows.forEach(b=>m.append(buildingRow(b)));
}
function offMarket(m){
  const flagged=(S.data.off_market_buildings)||[];
  m.append(el('div','lead','Buildings that are hard to find by normal search: no polished leasing site, owner markets directly, leasing runs through a phone number or a management portal, inventory appears briefly on small brokerage sites, or units fill by referral. This is where inventory the major platforms never carry tends to sit.'));
  if(!flagged.length){
    m.append(el('div','empty','<h3>None identified yet</h3>'+
      '<p>The agent populates this from the off-market sweep: management portals, direct-landlord pages, small brokerages, and buildings with stabilization history but no marketing presence. Run the agent to fill it.</p>'+
      '<p>Meanwhile, the strongest proxies already on file are watchlist buildings whose only recorded contact is an owning LLC rather than a leasing office, listed below.</p>'));
    const all=(S.data.buildings||[]).filter(b=>!(b.contact&&b.contact.phone));
    all.slice(0,12).forEach(b=>m.append(buildingRow(b,true)));
    return;
  }
  flagged.forEach(b=>m.append(buildingRow(b,true)));
}
function buildingRow(b,offMarketMode){
  const n=el('div','bcard');
  const t=el('div','btop');
  const l=el('div','bleft');
  l.append(el('div','baddr',esc(b.name||b.address||b.id)));
  l.append(el('div','rsub',[b.address,b.neighborhood].filter(Boolean).map(esc).join(' · ')));
  const bits=[];
  if(b.year_built) bits.push('built '+b.year_built);
  if(b.units) bits.push(b.units+' units');
  if(b.avg_sf_per_unit) bits.push('avg '+b.avg_sf_per_unit+' sq ft/unit');
  if(b.program) bits.push(esc(b.program));
  l.append(el('div','rfacts',bits.join('<i>|</i>')));
  if(b.benefit_status) l.append(el('div','bwhy','<b>Regulatory status:</b> '+esc(b.benefit_status)));
  if(b.stabilization_note||b.why_stabilized)
    l.append(el('div','bwhy','<b>Why it may hold stabilized units:</b> '+esc(b.why_stabilized||b.stabilization_note)));
  const c=b.contact||{};
  const contact = c.phone ? `${esc(c.name||'')} ${esc(c.phone)}${c.verified?'':' (unverified)'}`
    : (c.name?esc(c.name)+', no published phone found':'No leasing contact identified');
  l.append(el('div','bcontact','<b>Leasing:</b> '+contact));
  if(offMarketMode) l.append(el('div','bwhy','<b>Availability:</b> nothing qualifying found today. '+
    (b.availability_source?'Last seen via '+esc(b.availability_source)+'. ':'')+
    'Last checked '+esc((b.last_checked||S.data.date||'').slice(0,10))+'.'));
  t.append(l);
  const rt=el('div','bright');
  if(b.fit_seed!=null) rt.append(el('div','bfit',`<div class="sn">${b.fit_seed}</div><div class="sl">Building fit</div>`));
  t.append(rt); n.append(t);
  const acts=el('div','racts');
  const f=el('button',S.followed[b.id]?'on':'',S.followed[b.id]?'Following':'Follow building');
  f.onclick=()=>{ if(S.followed[b.id]) delete S.followed[b.id]; else S.followed[b.id]={at:Date.now()};
    save('followed',S.followed); signal('follow',b.id); renderAll(); };
  const ds=el('button','','Deep Search');
  ds.onclick=()=>deepSearch('building',b.id,b.name||b.address||b.id);
  acts.append(f,ds); n.append(acts);
  return n;
}

/* -------------------------------------------------------------------- saved */
function viewSaved(m){
  m.append(el('h2','pt','Saved'));
  const all=(S.data&&S.data.listings)||[];
  const ids=Object.keys(S.saved), fol=Object.keys(S.followed);
  m.append(el('div','lead',`${ids.length} apartment(s) and ${fol.length} building(s) saved. Change detection runs against the previous dataset.`));
  m.append(el('h3','sh','Saved apartments'));
  if(!ids.length) m.append(el('p','hint','Nothing saved yet.'));
  ids.forEach(id=>{ const L=all.find(x=>x.id===id);
    if(!L){ m.append(el('div','bcard','<div class="btop"><div class="bleft"><div class="baddr">'+esc(id)+
      '</div><div class="bwhy">No longer in the live dataset. Most likely rented or delisted.</div></div></div>')); return; }
    const ev=evaluate(L),comp=components(L);
    m.append(simpleCard({L,ev,comp,fit:fitOf(L,ev,comp),value:L.value_score??comp.value,
      eff:effRent(L),fresh:freshnessOf(L),sizeUnknown:L.sf==null}));
  });
  m.append(el('h3','sh','Followed buildings'));
  if(!fol.length) m.append(el('p','hint','Follow a building to be told the morning qualifying inventory appears there.'));
  fol.forEach(id=>{ const b=(S.data.buildings||[]).find(x=>x.id===id); if(b) m.append(buildingRow(b)); });

  // change detection
  const snap=S.snapshot||{}, now={};
  all.filter(isLive).forEach(L=>{ now[L.id]={rent:L.rent,conc:L.concessions_text||''}; });
  const drops=[],gone=[];
  Object.entries(now).forEach(([id,v])=>{ const o=snap[id];
    if(o&&o.rent!=null&&v.rent!=null&&v.rent<o.rent) drops.push({id,from:o.rent,to:v.rent}); });
  Object.keys(snap).forEach(id=>{ if(id!=='__seen'&&!now[id]) gone.push(id); });
  const nameOf=id=>{ const L=all.find(x=>x.id===id); return L?((L.address||'')+(L.unit?' #'+L.unit:'')):id; };
  m.append(el('h3','sh','Changes since the last run'));
  if(!drops.length&&!gone.length) m.append(el('p','hint','No price reductions and nothing left the market.'));
  drops.forEach(d=>m.append(el('div','chg',`<b>${esc(nameOf(d.id))}</b> reduced ${money(d.from)} to <span class="pos">${money(d.to)}</span>`)));
  gone.forEach(id=>m.append(el('div','chg',`<span class="sub">${esc(nameOf(id))} is no longer live</span>`)));
  const seen=[...new Set([...(snap.__seen||[]),...Object.keys(now)])];
  S.snapshot=Object.assign({__seen:seen},now); save('snapshot',S.snapshot);

  const q=load('requests',[]);
  if(q.length){
    m.append(el('h3','sh','Queued for the next agent run'));
    q.slice(-10).forEach(x=>m.append(el('div','chg',
      esc(x.type==='deep_search'?`Deep Search: ${x.target_label}`:`Find more like: ${x.seed&&x.seed.address} (${x.instruction})`))));
    const b=el('button','linkbtn','Export queue and signals for the agent'); b.onclick=exportSignals; m.append(b);
  }
}
function exportSignals(){
  const payload={exported_at:new Date().toISOString(), vals:S.vals, imps:S.imps, weights:S.weights,
    hoodsOn:S.hoodsOn, hoodsEx:S.hoodsEx, saved:S.saved, hidden:Object.keys(S.hidden),
    followed:Object.keys(S.followed), notes:S.notes, requests:load('requests',[]), signals:S.signals};
  const a=el('a'); a.href=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
  a.download='signals.json'; a.click();
  alert('Saved signals.json.\n\nDrop it in ~/scripts/nyc-apartment-watch/data/signals.json.\n\nThe next run reads your queued Deep Searches and Find More Like This requests, and biases ranking toward what you have been saving. It never overrides a required filter.');
}

/* ------------------------------------------------------------------ compare */
const CMP_ROWS=[
  ['Rent', r=>money(r.L.rent), r=>-(r.L.rent??1e9)],
  ['Effective rent', r=>r.eff!=null?money(r.eff):'-', r=>-(r.eff??1e9)],
  ['Square feet', r=>r.L.sf?r.L.sf.toLocaleString():'not published', r=>r.L.sf??0],
  ['Rent per sq ft', r=>r.L.sf?'$'+num(r.L.rent/r.L.sf,2):'-', r=>-(r.L.sf?r.L.rent/r.L.sf:1e9)],
  ['Neighborhood', r=>esc(r.L.neighborhood||'-'), null],
  ['Building', r=>esc(r.L.building_name||'-'), null],
  ['Built', r=>(bldgOf(r.L)||{}).year_built??'-', r=>(bldgOf(r.L)||{}).year_built??0],
  ['Classification', r=>buildingLabel(r.L), null],
  ['Rent stabilized', r=>STAB_SHORT[r.L.stabilization?.class||'unknown'], r=>STAB_ORDER[r.L.stabilization?.class||'unknown']],
  ['Availability', r=>availability(r.L).level, r=>({High:3,Medium:2,Low:1})[availability(r.L).level]],
  ['Amenities', r=>AMEN_KEYS.filter(k=>hasAmen(r.L,k)).map(k=>k.replace(/_/g,' ')).join(', ')||'-', r=>AMEN_KEYS.filter(k=>hasAmen(r.L,k)).length],
  ['Floor', r=>r.L.floor??'-', r=>r.L.floor??0],
  ['Fees / concessions', r=>[r.L.fee,r.L.concessions_text].filter(Boolean).map(esc).join('; ')||'-', null],
  ['Value', r=>VALUE_LABEL(r.value), r=>r.value],
  ['Fit Score', r=>r.fit, r=>r.fit],
  ['Value Score', r=>Math.round(r.value), r=>r.value],
  ['Pros', r=>esc(r.L.why_matches||'-'), null],
  ['Cons', r=>esc(r.L.tradeoffs||'-'), null],
];
function viewCompare(m){
  m.append(el('h2','pt','Compare'));
  const R=results().concat(nearMisses()).filter(r=>S.compare.includes(r.L.id));
  if(R.length<2){ m.append(el('div','empty','<h3>Pick at least two apartments</h3><p>Use Compare on any result card, then come back here.</p>')); return; }
  const t=el('table','cmp');
  t.innerHTML='<tr><th></th>'+R.map(r=>`<th>${esc(r.L.address||'')}${r.L.unit?' #'+esc(r.L.unit):''}</th>`).join('')+'</tr>';
  CMP_ROWS.forEach(([label,fmt,cmp])=>{
    let best=-1; if(cmp){ let hi=-Infinity; R.forEach((r,i)=>{ const v=cmp(r); if(v>hi){hi=v;best=i;} }); }
    t.innerHTML+='<tr><td class="rowh">'+esc(label)+'</td>'+
      R.map((r,i)=>`<td class="${i===best?'best':''}">${fmt(r)}</td>`).join('')+'</tr>';
  });
  m.append(t);
  const pick=(label,sortFn,why)=>{ const w=R.slice().sort(sortFn)[0]; const v=el('div','verdict');
    v.innerHTML=`<div class="vl">${esc(label)}</div><div class="vv">${esc(w.L.address||'')}${w.L.unit?' #'+esc(w.L.unit):''}</div><div class="vr">${esc(why(w))}</div>`;
    return v; };
  const vd=el('div','verdicts');
  vd.append(
    pick('Best overall',(a,b)=>b.fit-a.fit,w=>`Highest fit at ${w.fit} using your current weights.`),
    pick('Best value',(a,b)=>b.value-a.value,w=>`Value ${VALUE_LABEL(w.value)}${w.L.discount_pct?`, ${Math.abs(w.L.discount_pct)}% ${w.L.discount_pct>0?'below':'above'} estimated market`:''}.`),
    pick('Best stabilized opportunity',(a,b)=>STAB_ORDER[b.L.stabilization?.class||'unknown']-STAB_ORDER[a.L.stabilization?.class||'unknown']||b.fit-a.fit,
      w=>`${STAB_SHORT[w.L.stabilization?.class||'unknown']}. ${esc((w.L.stabilization?.reasons||[])[0]||'')}`),
    pick('Best building',(a,b)=>((bldgOf(b.L)||{}).quality_score??0)-((bldgOf(a.L)||{}).quality_score??0),
      w=>`${buildingLabel(w.L)}${(bldgOf(w.L)||{}).year_built?', built '+(bldgOf(w.L)||{}).year_built:''}.`),
    pick('Most space',(a,b)=>(b.L.sf??0)-(a.L.sf??0),w=>w.L.sf?`${w.L.sf.toLocaleString()} sq ft.`:'Size unpublished; confirm by phone.'),
    pick('Most certain to be available',(a,b)=>({High:3,Medium:2,Low:1})[availability(b.L).level]-({High:3,Medium:2,Low:1})[availability(a.L).level],
      w=>availability(w.L).why)
  );
  m.append(el('h3','sh','Agent ranking'),vd);
  const c=el('button','linkbtn','Clear comparison'); c.onclick=()=>{ S.compare=[]; renderAll(); }; m.append(c);
}

/* ------------------------------------------------------- neighborhood picker */
function openHoodPicker(){
  $('#drawerTitle').textContent='Neighborhoods';
  const d=$('#drawerBody'); d.innerHTML='';
  d.append(el('p','hint','Click to include or remove. Ranking still weighs the specific block, transit, restaurants, parks and noise, so two apartments in the same neighborhood do not score the same.'));
  const byRegion={}; HOODS.forEach(h=>{(byRegion[h.region]=byRegion[h.region]||[]).push(h);});
  Object.entries(byRegion).forEach(([region,hs])=>{
    d.append(el('h5','',esc(region)));
    const c=el('div','chips');
    hs.forEach(h=>{ const on=S.hoodsOn[h.id]&&!S.hoodsEx[h.id];
      const b=el('button',on?'chip on':'chip',esc(h.name)+(h.caveat?' *':''));
      b.title=h.caveat?h.name+', '+h.caveat:h.name;
      b.onclick=()=>{ if(on){ S.hoodsOn[h.id]=false; } else { S.hoodsOn[h.id]=true; delete S.hoodsEx[h.id]; }
        persist(); signal('hood',h.id); openHoodPicker(); renderBody(); };
      c.append(b); });
    d.append(c);
  });
  d.append(el('p','hint','* lower tier: surfaced only when the specific building is compelling.'));
  const all=el('button','linkbtn','Select all'); all.onclick=()=>{ HOODS.forEach(h=>{S.hoodsOn[h.id]=true; delete S.hoodsEx[h.id];}); persist(); openHoodPicker(); renderBody(); };
  const none=el('button','linkbtn','Clear all'); none.onclick=()=>{ HOODS.forEach(h=>S.hoodsOn[h.id]=false); persist(); openHoodPicker(); renderBody(); };
  const def=el('button','linkbtn','My defaults'); def.onclick=()=>{ S.hoodsOn=Object.fromEntries(HOODS.map(h=>[h.id,h.on])); S.hoodsEx={}; persist(); openHoodPicker(); renderBody(); };
  d.append(all,none,def);
  $('#scrim').classList.add('on'); $('#drawer').classList.add('on');
}

/* ---------------------------------------------------------------------- map */
let MAP=null,LAYER=null,POLYLAYER=null,drawPts=[];
function mapPanel(m){
  const w=el('div','mapwrap');
  const h=el('button','morebtn',(S.mapOpen?'Hide':'Show')+' map');
  h.onclick=()=>{ S.mapOpen=!S.mapOpen; renderBody(); };
  w.append(h);
  if(S.mapOpen){
    const box=el('div','mapbox'); box.innerHTML='<div id="map"></div>'+
      '<div class="maptools"><button id="btnDraw">Draw boundary</button>'+
      '<button id="btnClearDraw">Clear</button><button id="btnSearchArea">Search this area</button></div>';
    w.append(box); m.append(w);
    setTimeout(()=>{ initMap(); drawMarkers(); if(MAP) MAP.invalidateSize(); },30);
    return;
  }
  m.append(w);
}
function initMap(){
  if(MAP){ return; }
  if(!document.getElementById('map')) return;
  MAP=L.map('map',{zoomControl:true,preferCanvas:true}).setView([40.7360,-73.9950],13);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    {maxZoom:19,attribution:'&copy; OpenStreetMap, &copy; CARTO',subdomains:'abcd'}).addTo(MAP);
  LAYER=L.layerGroup().addTo(MAP); POLYLAYER=L.layerGroup().addTo(MAP);
  MAP.on('click',e=>{ if(!S.drawing)return; drawPts.push([e.latlng.lng,e.latlng.lat]); paintPoly(true); });
  MAP.on('dblclick',()=>{ if(S.drawing) finishDraw(); });
  $('#btnDraw').onclick=()=>{ if(S.drawing){finishDraw();return;} S.drawing=true; drawPts=[];
    $('#btnDraw').textContent='Click map, double-click to close'; $('#btnDraw').classList.add('on'); };
  $('#btnClearDraw').onclick=()=>{ S.poly=null; drawPts=[]; S.drawing=false; paintPoly(); renderBody(); };
  $('#btnSearchArea').onclick=()=>{ S.viewportOnly=!S.viewportOnly;
    $('#btnSearchArea').classList.toggle('on',S.viewportOnly); renderBody(); };
}
function finishDraw(){ S.drawing=false; S.poly=drawPts.length>=3?drawPts.slice():null;
  paintPoly(); signal('draw','poly'); renderBody(); }
function paintPoly(preview){
  if(!POLYLAYER)return; POLYLAYER.clearLayers();
  const pts=preview?drawPts:(S.poly||[]); if(!pts.length)return;
  L.polygon(pts.map(p=>[p[1],p[0]]),{color:'#000',weight:1,fillColor:'#000',fillOpacity:.04,
    dashArray:preview?'3 3':null}).addTo(POLYLAYER);
}
function drawMarkers(){
  if(!LAYER)return; LAYER.clearLayers();
  results().forEach(r=>{ const L2=r.L; if(L2.lat==null)return;
    const stab=STAB_ORDER[L2.stabilization?.class||'unknown']>=3;
    const icon=L.divIcon({className:'',iconSize:[52,20],iconAnchor:[26,20],
      html:`<div class="rentmark${stab?' stab':''}">${L2.rent!=null?money(L2.rent).replace('$',''):'n/a'}</div>`});
    const mk=L.marker([L2.lat,L2.lon],{icon});
    mk.bindTooltip(`<b>${esc(L2.address||'')}</b>${L2.unit?' #'+esc(L2.unit):''}<br>${money(L2.rent)} &middot; ${L2.sf?L2.sf+' sq ft':'size n/a'}<br>Fit ${r.fit} &middot; ${STAB_SHORT[L2.stabilization?.class||'unknown']}`,{direction:'top'});
    mk.on('click',()=>openBuildingUnits(L2.building_id,r));
    mk.addTo(LAYER); });
  paintPoly();
}
function openBuildingUnits(bid,fallback){
  const inv=results().filter(r=>r.L.building_id===bid);
  if(inv.length<=1){ openDetail(fallback); return; }
  const b=(S.data.buildings||[]).find(x=>x.id===bid)||{};
  $('#drawerTitle').textContent=(b.name||b.address||bid)+', available units';
  const d=$('#drawerBody'); d.innerHTML='';
  inv.forEach(r=>{ const c=simpleCard(r); d.append(c); });
  $('#scrim').classList.add('on'); $('#drawer').classList.add('on');
}

/* ------------------------------------------------------------------- shared */
function emptyState(){
  const n=el('div','empty');
  n.innerHTML=`<h3>No dataset loaded</h3>
   <p>This screen renders <code>inventory-&lt;date&gt;.json</code> from the nightly agent run. Nothing has been generated yet, or the file is not beside this page.</p>
   <p>Generate it with <code>~/scripts/nyc-apartment-watch/run.sh</code>. The agent searches broadly, verifies each unit is genuinely available, scores it, and writes the dataset.</p>`;
  const b=el('button','primary','Load demo data'); b.onclick=()=>{ S.data=demoData(); S.demo=true; renderAll(); };
  n.append(b); return n;
}
function closeOverlays(){ $('#scrim').classList.remove('on'); $('#drawer').classList.remove('on'); }
/* ======================= ASK THE AGENT ====================================
   Client-side intent parsing over the loaded dataset. Every change is shown
   explicitly so nothing moves silently. Anything this cannot resolve locally
   is queued for the next agent run rather than guessed at. ==================*/
function runAsk(q){
  if(!q||!q.trim()) return;
  const raw=q.trim(), s=raw.toLowerCase(), changes=[], notes=[];
  const set=(k,v,desc)=>{ const f=FILTER_BY_K[k]; const before=JSON.stringify(S.vals[k]);
    S.vals[k]=v; if(JSON.stringify(v)!==before) changes.push(desc||`${f.label} → ${JSON.stringify(v)}`); };
  const imp=(k,v)=>{ if(S.imps[k]!==v){ S.imps[k]=v; changes.push(`${FILTER_BY_K[k].label} requirement → ${v}`); } };
  const money_=t=>{ const m=t.match(/\$?\s?([\d,]+)\s?(k\b)?/); if(!m)return null;
    let n=+m[1].replace(/,/g,''); if(m[2])n*=1000; return n; };

  // --- rent
  let m;
  if((m=s.match(/(?:under|below|less than|max|up to|<)\s*\$?([\d,]+k?)/))) { const n=money_(m[1]); if(n) set('rent',[S.vals.rent[0],n],`Max rent → ${money(n)}`); }
  if((m=s.match(/(?:over|above|more than|min|at least|>)\s*\$?([\d,]+k?)\s*(?:\/|per)?\s*(?:mo|month)/))) { const n=money_(m[1]); if(n) set('rent',[n,S.vals.rent[1]],`Min rent → ${money(n)}`); }
  if((m=s.match(/between\s*\$?([\d,]+k?)\s*(?:and|to|-)\s*\$?([\d,]+k?)/))) { const a=money_(m[1]),b=money_(m[2]); if(a&&b) set('rent',[a,b],`Rent range → ${money(a)} to ${money(b)}`); }
  // --- size
  if((m=s.match(/(?:over|above|at least|more than|minimum|min|\+)\s*([\d,]{3,5})\s*(?:sq\.?\s?f|sf|square)/))) { const n=+m[1].replace(/,/g,''); set('sf',n,`Min square feet → ${n.toLocaleString()}`); imp('sf','req'); }
  else if((m=s.match(/([\d,]{3,5})\s*\+?\s*(?:sq\.?\s?f|sf|square feet)/))) { const n=+m[1].replace(/,/g,''); set('sf',n,`Min square feet → ${n.toLocaleString()}`); }
  // --- beds / baths
  if((m=s.match(/(\d)\s*(?:br|bed|bedroom)/))) set('beds',+m[1],`Bedrooms → ${m[1]}+`);
  if((m=s.match(/(\d(?:\.5)?)\s*(?:ba\b|bath)/))) set('baths',+m[1],`Bathrooms → ${m[1]}+`);
  // --- stabilization
  if(/rent[- ]?stabili/.test(s)){
    if(/only|just|restrict/.test(s)){ set('stab','only','Stabilization → only stabilized'); imp('stab','req'); }
    else { set('stab','preferred','Stabilization → preferred'); imp('stab','strong');
      S.mode='stab'; S.weights={...MODES.stab.w}; changes.push('Rank by → Rent Stabilized'); }
  }
  if(/market rate|not stabili|ignore stabili/.test(s)){ set('stab','irrelevant','Stabilization → irrelevant'); imp('stab','off'); }
  // --- condition / construction
  if(/renovat/.test(s)){ set('construction','reno','Condition → new or renovated'); imp('construction','strong'); }
  if(/new construction|brand new|newly built|newer building/.test(s)){ set('construction','reno','Condition → new or renovated'); imp('construction','strong'); }
  if(/luxur|high[- ]end/.test(s)) set('bq','luxury','Building quality → Luxury');
  if(/doorman/.test(s)) set('doorman',true,'Doorman → wanted');
  if(/nice|good building|well[- ]maintained/.test(s)) set('bq','nice','Building quality → Nice');
  // --- freshness
  if(/last 24|past 24|today/.test(s)){ set('freshness',/today/.test(s)?'today':'h24','Freshness → '+(/today/.test(s)?'listed today':'last 24 hours')); imp('freshness','req'); }
  else if(/last 48|past 48|two days|2 days/.test(s)){ set('freshness','d3','Freshness → last 3 days (48h not separately tracked)'); imp('freshness','req'); notes.push('Freshness buckets are today / 24h / 3 days, so 48 hours maps to the 3 day bucket.'); }
  else if(/last (?:3|three) days|this week/.test(s)){ set('freshness','d3','Freshness → last 3 days'); imp('freshness','req'); }
  // --- amenities
  [['laundry','laundry_in_unit'],['washer','laundry_in_unit'],['central air','central_air'],['a\\/c','central_air'],
   ['outdoor','outdoor_space'],['terrace','outdoor_space'],['balcony','outdoor_space'],['roof','roof_deck'],
   ['gym','gym'],['concierge','concierge'],['parking','parking'],['pet','pets'],['package','package_room'],['elevator','elevator']
  ].forEach(([w,k])=>{ if(new RegExp(w).test(s)&&!/no |without /.test(s.slice(Math.max(0,s.indexOf(w)-8),s.indexOf(w)))){
    if(S.vals[k]!==true){ S.vals[k]=true; changes.push(`${FILTER_BY_K[k].label} → wanted`); } } });
  if(/no[- ]fee|without a fee|no broker fee/.test(s)){ set('noFee',true,'No broker fee → wanted'); }
  // --- neighborhoods
  const hoodHits=HOODS.filter(h=>{ const n=h.name.toLowerCase().replace(/ \(ues\)| \(other\)| \/.*$/,''); return n.length>3&&s.includes(n); });
  if(hoodHits.length){
    HOODS.forEach(h=>S.hoodsOn[h.id]=false);
    hoodHits.forEach(h=>{ S.hoodsOn[h.id]=true; delete S.hoodsEx[h.id]; });
    changes.push('Neighborhoods → '+hoodHits.map(h=>h.name).join(', ')+' only');
  }
  if(/west side/.test(s)){
    HOODS.forEach(h=>S.hoodsOn[h.id]=/West/.test(h.region));
    changes.push('Neighborhoods → West Side only, capped at W 38th St');
  }
  // --- modes
  if(/best value|good value|underpriced|cheap for/.test(s)){ S.mode='value'; S.weights={...MODES.value.w}; changes.push('Rank by → Best Value'); }
  if(/newest|just listed|new listing/.test(s)){ S.mode='newest'; S.weights={...MODES.newest.w}; changes.push('Rank by → Newest Listings'); }
  if(/most space|biggest|largest/.test(s)){ S.mode='space'; S.weights={...MODES.space.w}; changes.push('Rank by → Most Space'); }
  if(/best building|nicest building/.test(s)){ S.mode='building'; S.weights={...MODES.building.w}; changes.push('Rank by → Best Buildings'); }

  // --- "everything at this building"
  if(/(everything|all).*(this|that) building|show me this building/.test(s)){
    const R=results(); if(R.length){ S.onlyBuildings=[R[0].L.building_id]; changes.push('Locked to building '+R[0].L.building_id); }
    else notes.push('No current result to infer a building from. Open a card and use "Show only this building".');
  }
  // --- "similar but $X cheaper"
  if((m=s.match(/similar.*\$?([\d,]+)\s*cheaper/))){
    const d=+m[1].replace(/,/g,''), R=results();
    if(R.length){ const base=R[0].L.rent; set('rent',[Math.max(0,S.vals.rent[0]-d),Math.max(1,base-d)],
      `Rent capped at ${money(base-d)}, which is ${money(d)} under the current top result`); }
  }
  // --- counterfactual question
  if(/what am i giving up|what do i lose|tradeoff of/.test(s)){
    const before=results().length;
    const keep={stab:S.vals.stab, imp:S.imps.stab};
    S.vals.stab='irrelevant'; S.imps.stab='off';
    const open=results();
    S.vals.stab=keep.stab; S.imps.stab=keep.imp;
    const now=results();
    const lost=open.filter(o=>!now.some(n=>n.L.id===o.L.id)).sort((a,b)=>b.fit-a.fit);
    notes.push(`Restricting to stabilized leaves ${now.length} of ${open.length} live units. You give up ${lost.length}.`
      + (lost.length?` The best you lose: ${lost.slice(0,3).map(r=>`${r.L.address||''}${r.L.unit?' #'+r.L.unit:''} at ${money(r.L.rent)} (fit ${r.fit})`).join('; ')}.`:''));
  }

  persist(); signal('ask','',{q:raw}); S.lastQuery=raw; save('lastQuery',raw); renderAll();
  const R=results();
  const parts=[];
  if(changes.length) parts.push('Applied:\n  '+changes.join('\n  '));
  else parts.push('No filter changes could be derived from that phrasing.');
  if(notes.length) parts.push('\nNotes:\n  '+notes.join('\n  '));
  parts.push(`\nNow showing ${R.length} live listing(s).`);
  if(!changes.length){
    queueRequest({type:'freeform_query', instruction:raw});
    parts.push('\nThis box maps requests onto filters over the inventory already loaded. Finding apartments that are not in today\'s dataset needs a live web search, so your request has been queued for the next agent run.');
  }
  alert(parts.join('\n'));
  const box=$('#bigAsk'); if(box) box.blur();
}


/* ============================ DEMO DATA ===================================
   Fabricated. Exists only so the interface can be exercised before a real run.
   Nothing here is a real apartment. ======================================= */
function demoData(){
  const iso=d=>new Date(Date.now()-d*864e5).toISOString();
  const B=[
   {id:'demo-bt',name:'DEMO Barclay Tower',address:'10 Barclay St',neighborhood:'Tribeca',hood_id:'tribeca',
    lat:40.7128,lon:-74.0083,year_built:2005,units:441,avg_sf_per_unit:1250,quality_score:88,
    ownership_type:'Rental',management:'DEMO Glenwood',program:'421-A (1-15)',benefit_status:'LIVE, phasing down',
    transit:'2/3 Park Pl, R/W Cortlandt',fit_seed:90,contact:{name:'DEMO leasing',phone:'000-000-0000',verified:false},
    amenities:{doorman:true,concierge:true,elevator:true,gym:true,roof_deck:true,package_room:true,parking:true,pets:true,laundry_in_unit:true,central_air:true},
    stabilization_note:'DEMO. Under 421-a (1-15) all rental units are stabilized for the benefit term.'},
   {id:'demo-lt',name:'DEMO London Terrace Gardens',address:'435 W 23rd St',neighborhood:'Chelsea',hood_id:'chelsea',
    lat:40.7466,lon:-74.0009,year_built:1934,year_renovated:2016,units:964,avg_sf_per_unit:945,quality_score:76,
    ownership_type:'Rental',management:'DEMO Rose Associates',program:'Pre-1974 + J-51',benefit_status:'Pre-1974, permanent',
    transit:'C/E 23rd St',fit_seed:88,contact:{name:'DEMO management LLC',phone:null,verified:false},
    amenities:{doorman:true,elevator:true,gym:true,package_room:true,pets:true,laundry_in_unit:false,central_air:false}},
   {id:'demo-ues',name:'DEMO Lenox Hill tower',address:'200 E 72nd St',neighborhood:'Lenox Hill (UES)',hood_id:'lenox-hill',
    lat:40.7690,lon:-73.9600,year_built:2019,units:180,avg_sf_per_unit:1100,quality_score:91,
    ownership_type:'Rental',program:'421-A (16)',benefit_status:'LIVE',transit:'Q 72nd St, 6 68th St',fit_seed:74,
    amenities:{doorman:true,concierge:true,elevator:true,gym:true,roof_deck:true,package_room:true,parking:true,pets:true,laundry_in_unit:true,central_air:true}},
  ];
  const base={availability_status:'available',lease_months:12,fee:'none',fee_paid_by:'landlord',photos:[]};
  return {date:new Date().toISOString().slice(0,10),demo:true,
   coverage:{sources_blocked:[],buildings_searched:3,notes:'Fabricated demo dataset.'},
   discoveries:[{kind:'Potential hidden gem',text:'DEMO. A management company has a renovated 2BR available through its own leasing portal that does not appear on StreetEasy.',listing_id:'d1'}],
   off_market_buildings:[{id:'demo-lt',name:'DEMO London Terrace Gardens',address:'435 W 23rd St',
     neighborhood:'Chelsea',year_built:1934,units:964,program:'Pre-1974 + J-51',fit_seed:88,
     why_stabilized:'DEMO. Pre-1974 with a J-51 class action that re-regulated units. No expiration risk.',
     contact:{name:'DEMO management office',phone:null,verified:false},
     availability_source:'management office phone enquiry',last_checked:new Date().toISOString().slice(0,10)}],
   buildings:B,
   listings:[
    {...base,id:'d1',building_id:'demo-bt',building_name:'DEMO Barclay Tower',address:'10 Barclay St',unit:'42C',
     neighborhood:'Tribeca',hood_id:'tribeca',lat:40.7128,lon:-74.0083,rent:8250,months_free:1,
     concessions_text:'1 month free on 13 months',beds:2,baths:2,sf:1284,sf_source:'published',
     est_market_rent:9100,discount_pct:9,comps_count:4,floor:42,light_score:88,views_score:85,ceiling_ft:9.5,
     condition:'Renovated 2021',condition_score:84,kitchen_score:82,bathroom_score:80,
     amenities:{laundry_in_unit:true,central_air:true,outdoor_space:false},
     available_date:'2026-10-01',lease_terms:'12 or 24 months',listed_date:iso(0),days_on_market:0,
     last_verified:new Date().toISOString(),listing_grade:'unit_verified',
     cross_check:{status:'confirmed',sources_confirming:['DEMO source A','DEMO source B']},
     source:'DEMO',value_score:86,
     comparables:[{address:'DEMO 101 Warren St',rent:8900,sf:1250},{address:'DEMO 200 Chambers',rent:9400,sf:1310}],
     stabilization:{class:'highly_likely',reasons:[
       'DEMO. Building carries a live 421-a (1-15) exemption on the current DOF roll.',
       'Under 421-a (1-15) every rental unit is stabilized for the benefit term regardless of rent.',
       'Not confirmed at unit level; DHCR registration history required.']},
     components:{location:95,size:96,price:72,building_quality:88,apartment_quality:84,stabilization:82,amenities:90,value:86},
     why_matches:'DEMO. A 1,284 sq ft two-bedroom clearing your 1,200 target, in a building whose 421-a exemption is still live, at roughly 9 percent under estimated market with a month free.',
     tradeoffs:'DEMO. The exemption is phasing down, so confirm the expiration year before signing a long lease.',
     value_reasons:'DEMO. $6.43/sf against a $7.09/sf set of four renovated Tribeca two-bedrooms.'},
    {...base,id:'d2',building_id:'demo-lt',building_name:'DEMO London Terrace Gardens',address:'435 W 23rd St',unit:'8H',
     neighborhood:'Chelsea',hood_id:'chelsea',lat:40.7466,lon:-74.0009,rent:6450,beds:2,baths:2,sf:null,
     est_market_rent:7100,discount_pct:9,comps_count:6,floor:8,light_score:72,condition:'Renovated prewar',condition_score:70,
     amenities:{laundry_in_unit:false,central_air:false},available_date:'2026-09-15',listed_date:iso(1),
     days_on_market:1,last_verified:iso(1),listing_grade:'unit_verified',
     cross_check:{status:'confirmed',sources_confirming:['DEMO source A']},source:'DEMO',value_score:78,
     stabilization:{class:'confirmed',reasons:[
       'DEMO. Pre-1974 building on the DHCR registration list.',
       'A J-51 class action re-regulated units at this address.',
       'Post-HSTPA there is no vacancy deregulation, so a regulated unit stays regulated.']},
     components:{location:95,size:60,price:88,building_quality:76,apartment_quality:70,stabilization:100,amenities:55,value:78},
     why_matches:'DEMO. Confirmed stabilized prewar two-bedroom in prime Chelsea with no expiration risk at all.',
     tradeoffs:'DEMO. Size is not published and this line may fall under 1,200 sq ft. No in-unit laundry, no central air.'},
    {...base,id:'d3',building_id:'demo-ues',building_name:'DEMO Lenox Hill tower',address:'200 E 72nd St',unit:'27B',
     neighborhood:'Lenox Hill (UES)',hood_id:'lenox-hill',lat:40.7690,lon:-73.9600,rent:8900,beds:2,baths:2,sf:1210,
     sf_source:'published',est_market_rent:8800,discount_pct:-1,comps_count:11,floor:27,light_score:92,views_score:90,
     ceiling_ft:10,condition:'New construction 2019',condition_score:95,kitchen_score:94,bathroom_score:93,
     amenities:{laundry_in_unit:true,central_air:true,outdoor_space:true},available_date:'2026-09-01',
     listed_date:iso(4),days_on_market:4,last_verified:iso(4),listing_grade:'unit_verified',
     cross_check:{status:'confirmed',sources_confirming:['DEMO source A']},source:'DEMO',value_score:58,
     stabilization:{class:'market',reasons:[
       'DEMO. 421-a(16) building.',
       'Under 421-a(16) high-rent market units are permanently exempt from stabilization.',
       'Only the income-restricted set-aside units are regulated, and you are over income for those.']},
     components:{location:80,size:92,price:40,building_quality:91,apartment_quality:95,stabilization:18,amenities:95,value:58},
     why_matches:'DEMO. The best physical apartment here: new construction, 10 ft ceilings, private outdoor space.',
     tradeoffs:'DEMO. Market rate with no stabilization path, priced at market, and at $8,900 it needs roughly $356,000 of income at 40x.'},
   ]};
}

/* ================================ BOOT ==================================== */
$('#scrim').onclick=closeOverlays; $('#drawerX').onclick=closeOverlays;
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeOverlays(); });
S.lastQuery=load('lastQuery','');

(async function boot(){
  if(window.__AW_DATA__){ S.data=window.__AW_DATA__; S.demo=!!S.data.demo; }
  else {
    const qs=new URLSearchParams(location.search);
    for(const u of [qs.get('data'),'inventory-latest.json'].filter(Boolean)){
      try{ const r=await fetch(u,{cache:'no-store'}); if(!r.ok) continue;
        S.data=await r.json(); S.demo=!!S.data.demo; break; }catch(e){}
    }
  }
  if(S.data){ S.data.buildings=S.data.buildings||[]; S.data.listings=S.data.listings||[]; }
  renderAll();
  save('lastVisit',new Date().toISOString());
})();
