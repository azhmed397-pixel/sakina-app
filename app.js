/* ============================================================
   app.js — application state & UI wiring
   ============================================================ */

const STORE_KEY = "sakina_state_v1";

let state = loadState();

function loadState(){
  try{
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch(e){}
  return {
    lat: null, lng: null, tz: -(new Date().getTimezoneOffset())/60,
    method: "egypt",
    tasbih: { dhikr: "سُبْحَانَ اللَّهِ", count: 0, history: [], dailyDate: todayKey(), dailyTotal: 0 },
    dhikrProgress: {}, // adhkar item progress, keyed by category-index
    dhikrDate: todayKey(),
    settings: { notif: true, adhkarNotif: true, vibrate: true }
  };
}
function saveState(){ localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
function todayKey(){ const d = new Date(); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }

/* ---------------- Navigation ---------------- */
function showScreen(name){
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  document.querySelectorAll('.bottom-nav button').forEach(b => b.classList.remove('active'));
  document.querySelector(`.bottom-nav button[data-screen="${name}"]`).classList.add('active');
  document.querySelector('.hero').classList.toggle('compact', name !== 'prayers');
}

function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(()=> t.classList.remove('show'), 1800);
}

/* ---------------- Location & Prayer Times ---------------- */
function initLocation(){
  const pill = document.getElementById('locPill');
  if (!navigator.geolocation){
    pill.innerHTML = `تعذّر الوصول للموقع — يمكنك إدخاله يدويًا <button onclick="initLocation()">إعادة محاولة</button>`;
    return;
  }
  pill.innerHTML = `📍 جارٍ تحديد الموقع... <button onclick="initLocation()">تحديث</button>`;
  navigator.geolocation.getCurrentPosition(pos => {
    state.lat = pos.coords.latitude;
    state.lng = pos.coords.longitude;
    saveState();
    pill.innerHTML = `📍 تم تحديد موقعك بدقة <button onclick="initLocation()">تحديث</button>`;
    renderPrayerTimes();
  }, err => {
    pill.innerHTML = `تعذّر تحديد الموقع (${err.code === 1 ? 'تم رفض الإذن' : 'خطأ'}) <button onclick="initLocation()">إعادة محاولة</button>`;
    // fallback: Cairo coordinates so the app remains usable
    if (state.lat === null){
      state.lat = 30.0444; state.lng = 31.2357;
      renderPrayerTimes();
    }
  }, { enableHighAccuracy: true, timeout: 10000 });
}

let todayTimes = null;

function renderPrayerTimes(){
  if (state.lat === null) return;
  const now = new Date();
  todayTimes = computePrayerTimes(now, state.lat, state.lng, state.tz, state.method);

  const rows = [
    { key:'fajr', label:'الفجر' },
    { key:'sunrise', label:'الشروق' },
    { key:'dhuhr', label:'الظهر' },
    { key:'asr', label:'العصر' },
    { key:'maghrib', label:'المغرب' },
    { key:'isha', label:'العشاء' }
  ];

  const nowDec = now.getHours() + now.getMinutes()/60 + now.getSeconds()/3600;
  let activeIdx = -1;
  for (let i = 0; i < rows.length; i++){
    if (rows[i].key === 'sunrise') continue;
    if (todayTimes[rows[i].key] !== null && nowDec >= todayTimes[rows[i].key]) activeIdx = i;
  }

  const list = document.getElementById('prayerList');
  list.innerHTML = rows.map((r,i) => `
    <div class="prayer-row ${i===activeIdx ? 'active-now':''}">
      <div class="pname"><span class="dot"></span>${r.label}</div>
      <div class="ptime">${decimalHourTo12h(todayTimes[r.key])}</div>
    </div>
  `).join('');

  updateCountdown();
  document.getElementById('methodSelect').value = state.method;
}

const PRAYER_ORDER = ['fajr','dhuhr','asr','maghrib','isha'];
const PRAYER_LABELS = { fajr:'الفجر', dhuhr:'الظهر', asr:'العصر', maghrib:'المغرب', isha:'العشاء' };

function updateCountdown(){
  if (!todayTimes) return;
  const now = new Date();
  const nowDec = now.getHours() + now.getMinutes()/60 + now.getSeconds()/3600;

  let next = null, nextTime = null;
  for (const k of PRAYER_ORDER){
    if (todayTimes[k] !== null && todayTimes[k] > nowDec){ next = k; nextTime = todayTimes[k]; break; }
  }
  let secsLeft;
  if (next === null){
    // after Isha -> count to tomorrow's Fajr (approximate using today's Fajr time)
    next = 'fajr';
    nextTime = todayTimes.fajr;
    secsLeft = ((24 - nowDec) + nextTime) * 3600;
  } else {
    secsLeft = (nextTime - nowDec) * 3600;
  }

  document.getElementById('nextPrayerName').textContent = PRAYER_LABELS[next];
  const h = Math.floor(secsLeft/3600), m = Math.floor((secsLeft%3600)/60), s = Math.floor(secsLeft%60);
  document.getElementById('countdown').textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;

  // arc progress: based on elapsed fraction of the current prayer interval
  const circumference = 553;
  const idx = PRAYER_ORDER.indexOf(next);
  const prevKey = idx > 0 ? PRAYER_ORDER[idx-1] : 'isha';
  let prevTime = todayTimes[prevKey];
  let span = nextTime - prevTime;
  if (span <= 0) span += 24;
  let elapsed = nowDec - prevTime;
  if (elapsed < 0) elapsed += 24;
  const frac = Math.min(Math.max(elapsed / span, 0), 1);
  document.getElementById('arcProgress').style.strokeDashoffset = circumference * (1 - frac);
}
setInterval(updateCountdown, 1000);

function onMethodChange(){
  state.method = document.getElementById('methodSelect').value;
  saveState();
  renderPrayerTimes();
}

/* ---------------- Hijri date (approximate, offline) ---------------- */
function renderHijriDate(){
  const g = new Date();
  // Kuwaiti algorithm (tabular Islamic calendar, civil) — offline approximation
  let jd = Math.floor((1461 * (g.getFullYear() + 4800 + Math.floor((g.getMonth()+1 - 14)/12)))/4) +
           Math.floor((367 * (g.getMonth()+1 - 2 - 12 * (Math.floor((g.getMonth()+1 - 14)/12))))/12) -
           Math.floor((3 * Math.floor((g.getFullYear() + 4900 + Math.floor((g.getMonth()+1 - 14)/12))/100))/4) +
           g.getDate() - 32075;
  let l = jd - 1948440 + 10632;
  let n = Math.floor((l - 1) / 10631);
  l = l - 10631 * n + 354;
  let j = (Math.floor((10985 - l) / 5316)) * (Math.floor((50 * l) / 17719)) + (Math.floor(l / 5670)) * (Math.floor((43 * l) / 15238));
  l = l - (Math.floor((30 - j) / 15)) * (Math.floor((17719 * j) / 50)) - (Math.floor(j / 16)) * (Math.floor((15238 * j) / 43)) + 29;
  const hMonth = Math.floor((24 * l) / 709);
  const hDay = l - Math.floor((709 * hMonth) / 24);
  const hYear = 30 * n + j - 30;
  const months = ["محرم","صفر","ربيع الأول","ربيع الآخر","جمادى الأولى","جمادى الآخرة","رجب","شعبان","رمضان","شوال","ذو القعدة","ذو الحجة"];
  document.getElementById('hijriDate').textContent = `${hDay} ${months[hMonth-1]} ${hYear}هـ`;
}

/* ---------------- Tasbih ---------------- */
function checkDailyReset(){
  if (state.tasbih.dailyDate !== todayKey()){
    state.tasbih.dailyDate = todayKey();
    state.tasbih.dailyTotal = 0;
  }
}
function renderTasbih(){
  checkDailyReset();
  document.getElementById('tasbihCount').textContent = state.tasbih.count;
  document.getElementById('dailyTotal').textContent = state.tasbih.dailyTotal;
  const sel = document.getElementById('dhikrSelect');
  const known = Array.from(sel.options).some(o => o.value === state.tasbih.dhikr);
  if (known) sel.value = state.tasbih.dhikr;
}
function tapTasbih(){
  state.tasbih.count++;
  state.tasbih.dailyTotal++;
  state.tasbih.history.push(state.tasbih.dhikr);
  saveState();
  renderTasbih();
  if (state.settings.vibrate && navigator.vibrate) navigator.vibrate(15);
}
function undoTasbih(){
  if (state.tasbih.count > 0){
    state.tasbih.count--;
    if (state.tasbih.dailyTotal > 0) state.tasbih.dailyTotal--;
    saveState();
    renderTasbih();
  }
}
function resetTasbih(){
  state.tasbih.count = 0;
  saveState();
  renderTasbih();
  showToast("تم تصفير العداد");
}
function switchDhikr(){
  const sel = document.getElementById('dhikrSelect');
  if (sel.value === 'custom'){
    const v = prompt("اكتب الذكر المخصص:");
    if (v){
      state.tasbih.dhikr = v;
      const opt = document.createElement('option');
      opt.value = v; opt.textContent = v; opt.selected = true;
      sel.insertBefore(opt, sel.lastElementChild);
    }
  } else {
    state.tasbih.dhikr = sel.value;
  }
  state.tasbih.count = 0;
  saveState();
  renderTasbih();
}

/* ---------------- Adhkar ---------------- */
let currentAdhkarCat = 'morning';
function renderAdhkarTabs(){
  const tabs = document.getElementById('adhkarTabs');
  tabs.innerHTML = ADHKAR_CATEGORIES.map(c =>
    `<button class="${c.key===currentAdhkarCat?'active':''}" onclick="switchAdhkarCat('${c.key}')">${c.label}</button>`
  ).join('');
}
function switchAdhkarCat(key){
  currentAdhkarCat = key;
  renderAdhkarTabs();
  renderAdhkarList();
}
function checkAdhkarDailyReset(){
  if (state.dhikrDate !== todayKey()){
    state.dhikrDate = todayKey();
    state.dhikrProgress = {};
  }
}
function renderAdhkarList(){
  checkAdhkarDailyReset();
  const items = ADHKAR_DATA[currentAdhkarCat] || [];
  const list = document.getElementById('adhkarList');
  list.innerHTML = items.map((item, i) => {
    const pkey = `${currentAdhkarCat}-${i}`;
    const done = state.dhikrProgress[pkey] || 0;
    const remaining = Math.max(item.count - done, 0);
    return `
      <div class="dhikr-card">
        <div class="dhikr-text">${item.text}</div>
        <div class="dhikr-meta">
          <span class="dhikr-count">التكرار: ${item.count}</span>
          <div style="display:flex; align-items:center; gap:10px;">
            <span class="dhikr-progress">${remaining === 0 ? 'تم ✓' : `متبقٍ ${remaining}`}</span>
            <button class="dhikr-counter-btn" onclick="tickAdhkar('${pkey}', ${item.count})">+</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}
function tickAdhkar(pkey, max){
  const cur = state.dhikrProgress[pkey] || 0;
  if (cur < max){
    state.dhikrProgress[pkey] = cur + 1;
    saveState();
    renderAdhkarList();
    if (state.settings.vibrate && navigator.vibrate) navigator.vibrate(10);
  }
}

/* ---------------- Qibla ---------------- */
let compassActive = false;
function enableCompass(){
  if (state.lat === null){
    showToast("لازم نحدد موقعك الأول من شاشة المواقيت");
    return;
  }
  const bearing = qiblaBearing(state.lat, state.lng);
  document.getElementById('qiblaInfo').innerHTML =
    `اتجاه القبلة من موقعك: <span class="qibla-deg">${bearing.toFixed(1)}°</span> من الشمال<br><br>
     <span style="font-size:12px;">حرّك هاتفك أفقيًا، السهم سيشير لاتجاه الكعبة</span>`;

  function handleOrientation(e){
    let heading = e.webkitCompassHeading !== undefined ? e.webkitCompassHeading : (360 - e.alpha);
    if (heading == null || isNaN(heading)) return;
    const rotation = bearing - heading;
    document.getElementById('qiblaNeedle').style.transform = `translate(-50%,-100%) rotate(${rotation}deg)`;
  }

  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function'){
    DeviceOrientationEvent.requestPermission().then(resp => {
      if (resp === 'granted'){
        window.addEventListener('deviceorientation', handleOrientation, true);
        compassActive = true;
      } else {
        showToast("لم يتم منح إذن استخدام المستشعرات");
      }
    }).catch(()=> showToast("تعذّر تفعيل البوصلة على هذا الجهاز"));
  } else {
    window.addEventListener('deviceorientationabsolute', handleOrientation, true);
    window.addEventListener('deviceorientation', handleOrientation, true);
    compassActive = true;
  }
}

/* ---------------- Settings ---------------- */
function renderSettings(){
  document.getElementById('toggleNotif').classList.toggle('on', state.settings.notif);
  document.getElementById('toggleAdhkarNotif').classList.toggle('on', state.settings.adhkarNotif);
  document.getElementById('toggleVibrate').classList.toggle('on', state.settings.vibrate);
}
function toggleSetting(key){
  state.settings[key] = !state.settings[key];
  saveState();
  renderSettings();
  if (key === 'notif' && state.settings.notif && 'Notification' in window){
    Notification.requestPermission();
  }
}
function resetAllData(){
  if (confirm("هل أنت متأكد من إعادة ضبط جميع البيانات؟ لا يمكن التراجع عن هذا.")){
    localStorage.removeItem(STORE_KEY);
    location.reload();
  }
}

/* ---------------- Init ---------------- */
function init(){
  renderHijriDate();
  renderTasbih();
  renderAdhkarTabs();
  renderAdhkarList();
  renderSettings();
  initLocation();

  if (state.lat !== null) renderPrayerTimes();

  if ('serviceWorker' in navigator){
    navigator.serviceWorker.register('service-worker.js').catch(()=>{});
  }
}
document.addEventListener('DOMContentLoaded', init);
