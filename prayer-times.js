/* ============================================================
   prayer-times.js
   Offline astronomical prayer time calculator.
   Computes solar position (declination + equation of time) from
   first principles, then derives the six daily prayer times from
   the sun's geometry relative to the observer's latitude/longitude.
   No network or external API required.
   ============================================================ */

const CALC_METHODS = {
  egypt:  { fajr: 19.5, isha: 17.5, name: "الهيئة المصرية العامة للمساحة" },
  mwl:    { fajr: 18,   isha: 17,   name: "رابطة العالم الإسلامي" },
  isna:   { fajr: 15,   isha: 15,   name: "الجمعية الإسلامية لأمريكا الشمالية" },
  makkah: { fajr: 18.5, ishaMinutes: 90, name: "أم القرى (مكة)" }
};

const ASR_FACTOR = 1; // 1 = standard (Shafi'i/Maliki/Hanbali), 2 = Hanafi

function degToRad(d){ return d * Math.PI / 180; }
function radToDeg(r){ return r * 180 / Math.PI; }
function fixHour(h){ h = h - 24 * Math.floor(h / 24); return h < 0 ? h + 24 : h; }
function fixAngle(a){ a = a - 360 * Math.floor(a / 360); return a < 0 ? a + 360 : a; }

// Julian Day from a JS Date (uses UTC components)
function julianDay(date){
  let y = date.getUTCFullYear();
  let m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  if (m <= 2){ y -= 1; m += 12; }
  const A = Math.floor(y / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
}

// Returns { decl, eqt } — sun declination (deg) and equation of time (hours)
// for a given Julian Day, using a low-precision solar position model.
function sunPosition(jd){
  const D = jd - 2451545.0; // days since J2000.0
  const gDeg = fixAngle(357.529 + 0.98560028 * D);
  const qDeg = fixAngle(280.459 + 0.98564736 * D);
  const g = degToRad(gDeg);
  const LDeg = fixAngle(qDeg + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g));
  const L = degToRad(LDeg);
  const e = degToRad(23.439 - 0.00000036 * D);

  let RA = radToDeg(Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L))) / 15;
  RA = fixHour(RA);
  const decl = radToDeg(Math.asin(Math.sin(e) * Math.sin(L)));
  let eqt = qDeg / 15 - RA;
  // normalize to [-12, 12] hours
  if (eqt > 12) eqt -= 24;
  if (eqt < -12) eqt += 24;
  return { decl, eqt };
}

// Hour angle for a sun altitude/depression "angle" (degrees), at latitude lat, declination decl
function hourAngle(angle, lat, decl){
  const a = degToRad(angle), l = degToRad(lat), d = degToRad(decl);
  const val = (-Math.sin(a) - Math.sin(l) * Math.sin(d)) / (Math.cos(l) * Math.cos(d));
  if (val > 1 || val < -1) return null; // sun never reaches this angle (polar edge cases)
  return radToDeg(Math.acos(val)) / 15;
}


// Asr hour angle: shadow length factor based
function asrHourAngle(factor, lat, decl){
  const altitudeDeg = radToDeg(Math.atan(1 / (factor + Math.tan(degToRad(Math.abs(lat - decl))))));
  return hourAngle(-altitudeDeg, lat, decl);
}

/**
 * Compute today's prayer times.
 * @param {Date} date - local date to compute for
 * @param {number} lat
 * @param {number} lng
 * @param {number} tzOffsetHours - e.g. 2 for Egypt (UTC+2), 3 for UTC+3 (auto from device if not given)
 * @param {string} methodKey - key into CALC_METHODS
 * @returns {object} times in decimal hours { fajr, sunrise, dhuhr, asr, maghrib, isha }
 */
function computePrayerTimes(date, lat, lng, tzOffsetHours, methodKey){
  const method = CALC_METHODS[methodKey] || CALC_METHODS.egypt;
  const jd = julianDay(new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0)));

  const { eqt: eqtNoon } = sunPosition(jd);
  const dhuhr = fixHour(12 + tzOffsetHours - lng / 15 - eqtNoon);

  function computeForAngle(angleDeg, beforeNoon){
    const { decl, eqt } = sunPosition(jd);
    const ha = hourAngle(angleDeg, lat, decl);
    if (ha === null) return null;
    const t = beforeNoon ? dhuhr - ha : dhuhr + ha;
    return fixHour(t);
  }

  const fajr = computeForAngle(method.fajr, true);
  const sunrise = computeForAngle(0.833, true);
  const maghrib = computeForAngle(0.833, false);
  let isha;
  if (method.ishaMinutes){
    isha = maghrib !== null ? fixHour(maghrib + method.ishaMinutes / 60) : null;
  } else {
    isha = computeForAngle(method.isha, false);
  }

  const { decl: declA } = sunPosition(jd);
  const asrHa = asrHourAngle(ASR_FACTOR, lat, declA);
  const asr = asrHa !== null ? fixHour(dhuhr + asrHa) : null;

  return { fajr, sunrise, dhuhr, asr, maghrib, isha };
}

function decimalHourToHHMM(h){
  if (h === null || h === undefined || isNaN(h)) return "--:--";
  let totalMin = Math.round(h * 60);
  totalMin = ((totalMin % 1440) + 1440) % 1440;
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
}

function decimalHourTo12h(h){
  if (h === null || h === undefined || isNaN(h)) return "--:--";
  let totalMin = Math.round(h * 60);
  totalMin = ((totalMin % 1440) + 1440) % 1440;
  let hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  const period = hh >= 12 ? "م" : "ص";
  hh = hh % 12; if (hh === 0) hh = 12;
  return `${hh}:${String(mm).padStart(2,'0')} ${period}`;
}

// Qibla bearing (degrees from true north) from observer lat/lng to the Kaaba
function qiblaBearing(lat, lng){
  const kaabaLat = degToRad(21.4225);
  const kaabaLng = degToRad(39.8262);
  const phi1 = degToRad(lat);
  const lambda1 = degToRad(lng);
  const dLambda = kaabaLng - lambda1;
  const y = Math.sin(dLambda) * Math.cos(kaabaLat);
  const x = Math.cos(phi1) * Math.sin(kaabaLat) - Math.sin(phi1) * Math.cos(kaabaLat) * Math.cos(dLambda);
  const bearing = radToDeg(Math.atan2(y, x));
  return ((bearing % 360) + 360) % 360;
}
