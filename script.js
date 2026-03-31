// ─── State ───────────────────────────────────────────────────────────────────
let office = null,
  todayRec = null,
  todayEvts = [];

let watchId = null,
  monitoring = false,
  insideOffice = false;

let graceTimer = null,
  graceInterval = null,
  graceStart = null,
  graceDur = 3 * 60 * 1000;

// ─── Constants ───────────────────────────────────────────────────────────────
const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const MONS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const SMON = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ─── Utils ───────────────────────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, "0");

const fmtT = (ts) => {
  if (!ts) return "--:--";
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const fmtDur = (ci, co) => {
  const ms = (co || Date.now()) - ci;
  return (
    pad(Math.floor(ms / 3600000)) +
    ":" +
    pad(Math.floor((ms % 3600000) / 60000))
  );
};

// ✅ Local timezone-safe date
const getLocalDateParts = () => {
  const d = new Date();
  return {
    year: d.getFullYear(),
    month: pad(d.getMonth() + 1),
    day: pad(d.getDate()),
  };
};

const tDate = () => {
  const { year, month, day } = getLocalDateParts();
  return `${year}-${month}-${day}`;
};

const tKey = () => `att_${tDate()}`;
const eKey = () => `evts_${tDate()}`;

const haversine = (la1, lo1, la2, lo2) => {
  const R = 6371000;
  const dLa = ((la2 - la1) * Math.PI) / 180;
  const dLo = ((lo2 - lo1) * Math.PI) / 180;

  const a =
    Math.sin(dLa / 2) ** 2 +
    Math.cos((la1 * Math.PI) / 180) *
      Math.cos((la2 * Math.PI) / 180) *
      Math.sin(dLo / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// ─── Storage (localStorage) ──────────────────────────────────────────────────
const sGet = async (k) => {
  try {
    const raw = localStorage.getItem(k);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const sSet = async (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};

const sList = async (prefix) => {
  try {
    return Object.keys(localStorage).filter((k) => k.startsWith(prefix));
  } catch {
    return [];
  }
};

// ─── Clock ───────────────────────────────────────────────────────────────────
function tick() {
  const n = new Date();

  document.getElementById("liveClock").textContent =
    `${pad(n.getHours())}:${pad(n.getMinutes())}:${pad(n.getSeconds())}`;

  document.getElementById("liveDate").textContent =
    `${DAYS[n.getDay()]}, ${n.getDate()} ${MONS[n.getMonth()]} ${n.getFullYear()}`;

  // live duration update every second
  if (todayRec && todayRec.checkIn && !todayRec.checkOut) {
    document.getElementById("durVal").textContent = fmtDur(
      todayRec.checkIn,
      null,
    );
    document.getElementById("durVal").className = "tc-val tcv-g";
  }
}

// ─── View Switch ─────────────────────────────────────────────────────────────
function switchView(name, btn) {
  document
    .querySelectorAll(".view")
    .forEach((v) => v.classList.remove("active"));
  document
    .querySelectorAll(".nav-btn")
    .forEach((b) => b.classList.remove("active"));

  document.getElementById("view" + name).classList.add("active");
  btn.classList.add("active");

  if (name === "History") renderHistory();
  if (name === "Setup") populateSetup();
}

// ─── Alerts ──────────────────────────────────────────────────────────────────
const _aT = {};

function showAlert(id, msg, type) {
  const b = document.getElementById(id);
  if (!b) return;

  b.className = "alert al-" + type;
  b.textContent = msg;
  b.style.display = "";

  clearTimeout(_aT[id]);
  _aT[id] = setTimeout(() => {
    b.style.display = "none";
  }, 5000);
}

// ─── Monitor Toggle ──────────────────────────────────────────────────────────
function toggleMonitor() {
  if (!office) {
    showAlert("alertHome", "Set your office location in Setup first.", "warn");
    return;
  }

  monitoring ? stopMonitor() : startMonitor();
}

function startMonitor() {
  if (!navigator.geolocation) {
    showAlert(
      "alertHome",
      "Geolocation not supported in this browser.",
      "error",
    );
    return;
  }

  if (watchId !== null) return;

  monitoring = true;
  updateToggleUI();
  setBadge("seeking");
  setStatus("seeking", "Locating…", "Getting your GPS position");
  setRadar("seeking", "◌", "—");

  watchId = navigator.geolocation.watchPosition(onPosition, onGpsErr, {
    enableHighAccuracy: true,
    timeout: 15000,
    maximumAge: 8000,
  });
}

function stopMonitor() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  monitoring = false;
  insideOffice = false;
  clearGrace();

  updateToggleUI();
  setBadge("idle");
  setStatus("idle", "Idle", "Monitoring stopped");
  setRadar("idle", "◌", "—");

  document.getElementById("locDot").className = "ldot ld-gray";
  document.getElementById("locTxt").textContent = "Monitoring stopped";
  document.getElementById("distBadge").innerHTML = "";
}

function updateToggleUI() {
  document.getElementById("togglePill").className =
    "pill" + (monitoring ? " on" : "");

  document.getElementById("toggleTitle").textContent = monitoring
    ? "Auto Monitoring ON"
    : "Auto Monitoring";

  document.getElementById("toggleSub").textContent = monitoring
    ? "Watching your location continuously"
    : "Tap to enable location tracking";
}

// ─── Badge ───────────────────────────────────────────────────────────────────
function setBadge(state) {
  const b = document.getElementById("hBadge");
  const map = {
    idle: ["hb-idle", "● IDLE"],
    seeking: ["hb-seeking", "◌ LOCATING"],
    inside: ["hb-inside", "● INSIDE"],
    grace: ["hb-grace", "⏳ LEAVING"],
    done: ["hb-inside", "✓ DONE"],
  };

  const [cls, txt] = map[state] || map.idle;
  b.className = "hbadge " + cls;
  b.textContent = txt;
}

// ─── Status / Radar ──────────────────────────────────────────────────────────
function setStatus(state, lbl, desc) {
  const sl = document.getElementById("sLabel");
  const sd = document.getElementById("sDesc");

  sl.className = "status-lbl sl-" + state;
  sl.textContent = lbl;
  sd.textContent = desc;
}

function setRadar(state, icon, dist) {
  const ro = document.getElementById("radarOuter");
  const rp = document.getElementById("radarPulse");

  ro.className = "radar-outer ro-" + state;
  rp.className = "radar-pulse" + (state !== "idle" ? " rp-" + state : "");

  document.getElementById("radarIcon").textContent = icon;
  document.getElementById("radarDist").textContent = dist;
}

// ─── GPS Position Handler ────────────────────────────────────────────────────
function onPosition(pos) {
  if (!office) return;

  const lat = pos.coords.latitude;
  const lng = pos.coords.longitude;
  const acc = Math.round(pos.coords.accuracy);

  const dist = Math.round(haversine(lat, lng, office.lat, office.lng));
  const nowInside = dist <= office.radius;
  const dStr = dist >= 1000 ? (dist / 1000).toFixed(1) + "km" : dist + "m";

  document.getElementById("locTxt").textContent =
    `${lat.toFixed(5)}, ${lng.toFixed(5)} (±${acc}m)`;

  document.getElementById("locDot").className =
    "ldot " +
    (nowInside
      ? "ld-green"
      : dist < office.radius * 1.8
        ? "ld-amber"
        : "ld-red");

  document.getElementById("distBadge").innerHTML = `<span class="dbadge ${
    nowInside ? "db-in" : dist < office.radius * 1.5 ? "db-near" : "db-out"
  }">${dStr}</span>`;

  document.getElementById("radarDist").textContent = dStr;

  // entered office
  if (nowInside && !insideOffice) {
    insideOffice = true;
    clearGrace();

    setBadge("inside");
    setRadar("inside", "📍", dStr);
    setStatus("inside", "Inside Office", "You are within the office zone");

    if (!todayRec || !todayRec.checkIn) autoCheckIn();
  }

  // left office
  if (!nowInside && insideOffice) {
    if (!graceTimer) startGrace(dStr);

    setRadar("grace", "🚶", dStr);
    setStatus("grace", "Left Office Zone", "Waiting before auto check-out…");
    setBadge("grace");
  }

  // still outside before arriving
  if (!nowInside && !insideOffice && !graceTimer) {
    setRadar("seeking", "◌", dStr);
    setBadge("seeking");

    if (!todayRec || !todayRec.checkOut) {
      setStatus(
        "seeking",
        "Monitoring",
        `You are ${dStr} from ${office.name || "office"}`,
      );
    }
  }
}

function onGpsErr(err) {
  document.getElementById("locTxt").textContent = "GPS error — " + err.message;
}

// ─── Auto Check-In / Out ─────────────────────────────────────────────────────
async function autoCheckIn() {
  if (todayRec && todayRec.checkIn) return;

  todayRec = {
    date: tDate(),
    checkIn: Date.now(),
    checkOut: null,
  };

  await sSet(tKey(), todayRec);
  await addEvt("in", "Auto checked in at " + fmtT(todayRec.checkIn));

  showAlert(
    "alertHome",
    "✓ Checked in automatically at " + fmtT(todayRec.checkIn),
    "success",
  );

  refreshTimeRow();
}

async function autoCheckOut() {
  if (!todayRec || !todayRec.checkIn || todayRec.checkOut) return;

  todayRec.checkOut = Date.now();
  await sSet(tKey(), todayRec);

  const dur = fmtDur(todayRec.checkIn, todayRec.checkOut);

  await addEvt(
    "out",
    "Auto checked out at " +
      fmtT(todayRec.checkOut) +
      " · " +
      dur +
      " hrs total",
  );

  showAlert(
    "alertHome",
    "✓ Checked out automatically at " +
      fmtT(todayRec.checkOut) +
      " (" +
      dur +
      " hrs)",
    "success",
  );

  refreshTimeRow();
  setStatus("done", "Day Complete", "Attendance recorded — great work!");
  setRadar("done", "✓", "Done");
  setBadge("done");
}

// ─── Manual Controls ─────────────────────────────────────────────────────────
async function manualCheckIn() {
  if (todayRec && todayRec.checkIn) {
    showAlert("alertHome", "You are already checked in today.", "warn");
    return;
  }

  const now = Date.now();

  todayRec = {
    date: tDate(),
    checkIn: now,
    checkOut: null,
    manual: true,
  };

  await sSet(tKey(), todayRec);
  await addEvt("in", "Manual check-in at " + fmtT(now));

  insideOffice = true;

  refreshTimeRow();
  setBadge("inside");
  setRadar("inside", "📍", "Manual");
  setStatus("inside", "Checked In", "Manually checked in");

  showAlert("alertHome", "✓ Manual check-in saved at " + fmtT(now), "success");
}

async function manualCheckOut() {
  if (!todayRec || !todayRec.checkIn) {
    showAlert("alertHome", "You have not checked in yet today.", "warn");
    return;
  }

  if (todayRec.checkOut) {
    showAlert("alertHome", "You are already checked out today.", "warn");
    return;
  }

  const now = Date.now();
  todayRec.checkOut = now;
  todayRec.manual = true;

  await sSet(tKey(), todayRec);

  const dur = fmtDur(todayRec.checkIn, todayRec.checkOut);
  await addEvt(
    "out",
    "Manual check-out at " + fmtT(now) + " · " + dur + " hrs total",
  );

  insideOffice = false;
  clearGrace();

  refreshTimeRow();
  setBadge("done");
  setRadar("done", "✓", "Done");
  setStatus("done", "Day Complete", "Manually checked out");

  showAlert(
    "alertHome",
    "✓ Manual check-out saved at " + fmtT(now) + " (" + dur + " hrs)",
    "success",
  );
}

async function resetToday() {
  const ok = confirm("Reset today's attendance and activity log?");
  if (!ok) return;

  todayRec = null;
  todayEvts = [];

  localStorage.removeItem(tKey());
  localStorage.removeItem(eKey());

  insideOffice = false;
  clearGrace();

  refreshTimeRow();
  renderEvts();

  if (monitoring) {
    setBadge("seeking");
    setStatus("seeking", "Monitoring", "Waiting for office location trigger");
    setRadar("seeking", "◌", "—");
  } else {
    setBadge("idle");
    setStatus("idle", "Idle", "Monitoring stopped");
    setRadar("idle", "◌", "—");
  }

  showAlert("alertHome", "Today's attendance has been reset.", "success");
}

// ─── Grace Period ────────────────────────────────────────────────────────────
function startGrace(dStr) {
  graceStart = Date.now();
  document.getElementById("graceWrap").style.display = "";

  addEvt("warn", `Left office zone (${dStr} away) — grace period started`);

  graceInterval = setInterval(() => {
    const elapsed = Date.now() - graceStart;
    const pct = Math.max(0, 100 - (elapsed / graceDur) * 100);
    const remSec = Math.ceil((graceDur - elapsed) / 1000);

    document.getElementById("graceFill").style.width = pct + "%";
    document.getElementById("graceCountdown").textContent =
      remSec > 60 ? Math.ceil(remSec / 60) + "m" : remSec + "s";

    if (elapsed >= graceDur) {
      clearGrace();
      insideOffice = false;
      autoCheckOut();
    }
  }, 500);

  graceTimer = true;
}

function clearGrace() {
  clearInterval(graceInterval);
  graceTimer = null;
  graceInterval = null;
  graceStart = null;

  document.getElementById("graceWrap").style.display = "none";
  document.getElementById("graceFill").style.width = "100%";
  document.getElementById("graceCountdown").textContent = "—";
}

// ─── Events ──────────────────────────────────────────────────────────────────
async function addEvt(type, msg) {
  todayEvts.push({ type, msg, ts: Date.now() });
  await sSet(eKey(), todayEvts);
  renderEvts();
}

function renderEvts() {
  const wrap = document.getElementById("evtLog");
  const list = document.getElementById("evtList");

  if (!todayEvts.length) {
    wrap.style.display = "none";
    return;
  }

  wrap.style.display = "";
  list.innerHTML = [...todayEvts]
    .reverse()
    .map(
      (e) => `
        <div class="evt-item">
          <div class="edot ed-${e.type === "in" ? "in" : e.type === "out" ? "out" : "warn"}"></div>
          <div class="emsg">${e.msg}</div>
          <div class="ets">${fmtT(e.ts)}</div>
        </div>
      `,
    )
    .join("");
}

// ─── Time Row ────────────────────────────────────────────────────────────────
function refreshTimeRow() {
  const ci = document.getElementById("ciVal");
  const co = document.getElementById("coVal");
  const dur = document.getElementById("durVal");

  if (!todayRec || !todayRec.checkIn) {
    ci.textContent = "--:--";
    ci.className = "tc-val tcv-e";

    co.textContent = "--:--";
    co.className = "tc-val tcv-e";

    dur.textContent = "--:--";
    dur.className = "tc-val tcv-e";
  } else if (!todayRec.checkOut) {
    ci.textContent = fmtT(todayRec.checkIn);
    ci.className = "tc-val tcv-g";

    co.textContent = "--:--";
    co.className = "tc-val tcv-e";

    dur.textContent = fmtDur(todayRec.checkIn, null);
    dur.className = "tc-val tcv-g";
  } else {
    ci.textContent = fmtT(todayRec.checkIn);
    ci.className = "tc-val tcv-g";

    co.textContent = fmtT(todayRec.checkOut);
    co.className = "tc-val tcv-r";

    dur.textContent = fmtDur(todayRec.checkIn, todayRec.checkOut);
    dur.className = "tc-val tcv-b";
  }
}

// ─── History ─────────────────────────────────────────────────────────────────
async function renderHistory() {
  const list = document.getElementById("histList");

  list.innerHTML =
    '<div style="text-align:center;padding:16px;font-size:13px;color:var(--muted)">Loading…</div>';

  const monthStr = tDate().slice(0, 7);
  const allKeys = (await sList("att_")).sort().reverse();
  const mKeys = allKeys.filter((k) => k.includes(monthStr));

  let present = 0;
  let totalMs = 0;
  const recs = [];

  for (const k of allKeys.slice(0, 60)) {
    const r = await sGet(k);
    if (!r) continue;

    recs.push({ key: k, ...r });

    if (k.includes(monthStr)) {
      if (r.checkIn) present++;
      if (r.checkIn && r.checkOut) totalMs += r.checkOut - r.checkIn;
    }
  }

  document.getElementById("stP").textContent = present;
  document.getElementById("stD").textContent = mKeys.length;
  document.getElementById("stH").textContent = (totalMs / 3600000).toFixed(1);

  if (!recs.length) {
    list.innerHTML =
      '<div class="empty-state"><div class="empty-icon">📋</div><p>No records yet.<br>Enable monitoring to start tracking.</p></div>';
    return;
  }

  list.innerHTML = recs
    .map((r) => {
      const d = new Date(r.date + "T00:00:00");
      const lbl = `${d.getDate()} ${MONS[d.getMonth()]} ${d.getFullYear()}`;
      const day = SMON[d.getDay()];

      let dotC, badC, badT;

      if (r.checkIn && r.checkOut) {
        dotC = "var(--green)";
        badC = "hb-p";
        badT = "Present";
      } else {
        dotC = "var(--amber)";
        badC = "hb-x";
        badT = r.checkIn ? "Partial" : "—";
      }

      const dur =
        r.checkIn && r.checkOut ? fmtDur(r.checkIn, r.checkOut) : null;

      return `
        <div class="hist-item">
          <div class="hdot" style="background:${dotC}"></div>
          <div class="hinfo">
            <div class="hdate">${lbl}</div>
            <div class="hday">${day}</div>
          </div>
          <div class="htimes">
            <div class="hpair">${fmtT(r.checkIn)} → ${fmtT(r.checkOut)}</div>
            ${dur ? `<div class="hdur">${dur} hrs</div>` : ""}
          </div>
          <span class="hbadge ${badC}">${badT}</span>
        </div>
      `;
    })
    .join("");
}

// ─── Setup ───────────────────────────────────────────────────────────────────
function populateSetup() {
  updateGraceLabel();

  if (!office) return;

  document.getElementById("inLat").value = office.lat;
  document.getElementById("inLng").value = office.lng;
  document.getElementById("inRadius").value = office.radius;
  document.getElementById("inName").value = office.name || "";
  document.getElementById("graceSlider").value = office.graceMin || 3;

  updateGraceLabel();
  showCurOffice();
}

function updateGraceLabel() {
  const v = document.getElementById("graceSlider").value;
  document.getElementById("graceLabel").textContent =
    v + " minute" + (v > 1 ? "s" : "");
}

function useCurrentGPS() {
  if (!navigator.geolocation) {
    showAlert("alertSetup", "Geolocation not supported.", "error");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (p) => {
      document.getElementById("inLat").value = p.coords.latitude.toFixed(6);
      document.getElementById("inLng").value = p.coords.longitude.toFixed(6);
      showAlert("alertSetup", "GPS captured! Review and save.", "info");
    },
    (e) => {
      showAlert("alertSetup", "Could not get location: " + e.message, "error");
    },
    { timeout: 12000, enableHighAccuracy: true },
  );
}

async function saveOffice() {
  const lat = parseFloat(document.getElementById("inLat").value);
  const lng = parseFloat(document.getElementById("inLng").value);
  const radius = parseInt(document.getElementById("inRadius").value) || 200;
  const name = document.getElementById("inName").value.trim() || "My Office";
  const graceMin = parseInt(document.getElementById("graceSlider").value) || 3;

  if (isNaN(lat) || isNaN(lng)) {
    showAlert("alertSetup", "Enter valid coordinates.", "error");
    return;
  }

  office = { lat, lng, radius, name, graceMin };
  graceDur = graceMin * 60 * 1000;

  await sSet("office", office);

  showAlert("alertSetup", "Saved successfully!", "success");
  showCurOffice();
  document.getElementById("officeWarn").style.display = "none";

  // auto start monitoring after saving
  if (!monitoring) startMonitor();
}

function showCurOffice() {
  if (!office) return;

  document.getElementById("curOfficeSec").style.display = "";
  document.getElementById("curOfficeTxt").textContent =
    `${office.name || "Office"} · ${office.lat.toFixed(5)}, ${office.lng.toFixed(5)} · ±${office.radius}m · grace ${office.graceMin || 3}min`;
}

// ─── Init ────────────────────────────────────────────────────────────────────
async function init() {
  tick();
  setInterval(tick, 1000);

  office = await sGet("office");
  todayRec = await sGet(tKey());
  todayEvts = (await sGet(eKey())) || [];

  if (office) {
    graceDur = (office.graceMin || 3) * 60 * 1000;
    showCurOffice();
  }

  document.getElementById("officeWarn").style.display = office ? "none" : "";

  refreshTimeRow();
  renderEvts();

  if (todayRec && todayRec.checkIn && !todayRec.checkOut) {
    setStatus("inside", "Checked In", "Auto monitoring is active");
    setBadge("inside");
  }

  if (todayRec && todayRec.checkIn && todayRec.checkOut) {
    setStatus("done", "Day Complete", "Great work today!");
    setRadar("done", "✓", "Done");
    setBadge("done");
  }

  // ✅ AUTO MONITORING ON BY DEFAULT
  if (office) {
    startMonitor();
  } else {
    updateToggleUI();
  }
}

// ─── Service Worker ──────────────────────────────────────────────────────────
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("service-worker.js");
}

// ─── Start App ───────────────────────────────────────────────────────────────
init();
