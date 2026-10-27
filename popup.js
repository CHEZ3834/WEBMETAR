// ===== DOM =====
const RAW = document.getElementById("rawMetar");
const DEC = document.getElementById("decodedContent");
const ISSUED = document.getElementById("issuedTime");
const UPDATED = document.getElementById("lastUpdated");
const SOURCE = document.getElementById("sourceInfo");
const REF = document.getElementById("refreshBtn");
const TITLE = document.querySelector(".title");
const TABS = [...document.querySelectorAll(".tab[data-airport]")];
const PREV = document.getElementById("prevAirports");
const NEXT = document.getElementById("nextAirports");

const AIRPORTS = ["NZWN", "NZAA", "NZCH"];
let currentAirport = "NZWN";
let tabStart = 0;
let requestNumber = 0;
const LOADING_DELAY_MS = 1100;

TABS.forEach(tab => tab.addEventListener("click", () => switchAirport(tab.dataset.airport)));
PREV.addEventListener("click", () => moveTabWindow(-1));
NEXT.addEventListener("click", () => moveTabWindow(1));
REF.addEventListener("click", fetchAndRender);
renderTabs();
fetchAndRender();

function moveTabWindow(direction) {
  tabStart = Math.max(0, Math.min(AIRPORTS.length - 2, tabStart + direction));
  renderTabs();
}

function renderTabs() {
  TABS.forEach(tab => {
    const airport = tab.dataset.airport;
    tab.hidden = !AIRPORTS.slice(tabStart, tabStart + 2).includes(airport);
    tab.classList.toggle("active", airport === currentAirport);
    tab.setAttribute("aria-pressed", String(airport === currentAirport));
  });
  PREV.disabled = tabStart === 0;
  NEXT.disabled = tabStart >= AIRPORTS.length - 2;
}

function switchAirport(icao) {
  if (!AIRPORTS.includes(icao) || icao === currentAirport) return;
  currentAirport = icao;
  const index = AIRPORTS.indexOf(icao);
  if (index < tabStart) tabStart = index;
  if (index > tabStart + 1) tabStart = index - 1;
  renderTabs();
  TITLE.textContent = `✈️ ${icao} METAR`;
  fetchAndRender();
}

async function fetchAndRender() {
  const thisRequest = ++requestNumber;
  const airport = currentAirport;
  RAW.textContent = "Loading…";
  DEC.innerHTML = "";
  ISSUED.textContent = "";
  UPDATED.textContent = "";
  SOURCE.textContent = "";
  await new Promise(resolve => setTimeout(resolve, LOADING_DELAY_MS));
  if (thisRequest !== requestNumber) return;

  try {
    const url = `https://metar.vatsim.net/${airport.toLowerCase()}`;
    const resp = await fetch(url, { cache: "no-store" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const metarText = (await resp.text()).trim();
    if (thisRequest !== requestNumber) return;
    RAW.textContent = metarText || "No METAR received.";
    if (!metarText) throw new Error("The METAR source returned an empty report.");
    const isAuto = /\bAUTO\b/.test(metarText);
    SOURCE.textContent = `• Data from metar.vatsim.net/${airport.toLowerCase()} • ${isAuto ? "AUTO" : "MANUAL"} •`;
    DEC.innerHTML = buildDecodedHtml(decodeMetar(metarText));

    const issueMatch = metarText.match(/\b(\d{6}Z)\b/);
    if (issueMatch) ISSUED.innerHTML = `<span class="footer-label">METAR issued:</span><br>${formatNZTime(parseMetarTime(issueMatch[1]))}`;
    UPDATED.innerHTML = `Last updated:<br>${formatNZTime(new Date())}`;
  } catch (error) {
    if (thisRequest !== requestNumber) return;
    RAW.textContent = "Failed to fetch METAR.";
    DEC.textContent = error.message || String(error);
    console.error(error);
  }
}

function formatNZTime(date) {
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZoneName: "short"
  }).format(date);
}

function buildDecodedHtml(obj) {
  let html = "";
  if (obj.wind) html += `<div><b class="label">Wind:</b> ${obj.wind}</div>`;
  if (obj.visibility) html += `<div><b class="label">Visibility:</b> ${obj.visibility}</div>`;
  if (obj.weatherHtml) html += `<div><b class="label">Rain:</b><br><div class="cloud-indent">${obj.weatherHtml}</div></div>`;
  if (obj.cloudsHtml) html += `<div><b class="label">Clouds:</b><br><div class="cloud-indent">${obj.cloudsHtml}</div></div>`;
  if (obj.temperature) html += `<div><b class="label">Temperature:</b> ${obj.temperature}</div>`;
  if (obj.qnhValue !== undefined) html += `<div><b class="label">QNH:</b> <span class="${obj.qnhClass}">${obj.qnhValue} hPa (${obj.qnhLabel})</span></div>`;
  if (obj.kaukau) html += `<div><b class="label">Mt Kaukau Wind:</b> ${obj.kaukau}</div>`;
  if (obj.sugarloaf) html += `<div><b class="label">Sugarloaf Wind:</b> ${obj.sugarloaf}</div>`;
  return html || "<div>No detailed data decoded.</div>";
}

function decodeMetar(metar) {
  const out = {};
  if (!metar) return out;
  const tokens = metar.trim().split(/\s+/);
  const rmkIndex = tokens.indexOf("RMK");
  const mainTokens = rmkIndex >= 0 ? tokens.slice(0, rmkIndex) : tokens;
  const remarks = rmkIndex >= 0 ? tokens.slice(rmkIndex + 1) : [];

  const windToken = mainTokens.find(token => /^(?:\d{3}|VRB)\d{2,3}(?:G\d{2,3})?KT$/.test(token));
  if (windToken) out.wind = formatWind(windToken);

  const visibilityToken = mainTokens.find(token => /^\d{4}$/.test(token));
  if (mainTokens.includes("CAVOK")) {
    out.visibility = "10 km or more (CAVOK)";
  } else if (visibilityToken) {
    const metres = Number(visibilityToken);
    const conditions = [];
    if (mainTokens.includes("HZ")) conditions.push("Haze");
    if (mainTokens.includes("BR")) conditions.push("Mist");
    if (mainTokens.includes("FG")) conditions.push("Fog");
    const extra = conditions.length ? ` • ${conditions.join(", ")}` : "";
    out.visibility = metres === 9999 ? `10 km or more (9999)${extra}` : `${metres} metres (${(metres / 1000).toFixed(1)} km)${extra}`;
  }

  // Match actual METAR weather-group tokens only; never substring-match VATSIM.
  const weatherGroups = mainTokens.filter(isWeatherToken);
  const weatherLines = [];
  const hasTS = weatherGroups.some(token => /TS/.test(token));
  const rainToken = weatherGroups.find(token => /RA/.test(token));
  const drizzleToken = weatherGroups.find(token => /DZ/.test(token));
  if (hasTS) weatherLines.push(rainToken ? "• Thunderstorm with rain" : "• Thunderstorm");
  else {
    if (rainToken) weatherLines.push(rainToken.startsWith("-") ? "• Light rain" : rainToken.startsWith("+") ? "• Heavy rain" : "• Rain");
    if (drizzleToken) weatherLines.push(drizzleToken.startsWith("-") ? "• Light drizzle" : drizzleToken.startsWith("+") ? "• Heavy drizzle" : "• Drizzle");
  }
  if (weatherGroups.some(token => /SN/.test(token))) weatherLines.push("• Snow");
  if (/\bRERA\b/.test(metar)) weatherLines.push("• Recent rain");
  if (weatherLines.length) out.weatherHtml = weatherLines.join("<br>");

  const cloudMap = { FEW: "Few", SCT: "Scattered", BKN: "Broken", OVC: "Overcast" };
  const clouds = [...mainTokens.join(" ").matchAll(/\b(FEW|SCT|BKN|OVC)(\d{3})\b/g)];
  if (clouds.length) out.cloudsHtml = clouds.map(match => `• ${cloudMap[match[1]]} at ${Number(match[2]) * 100} ft`).join("<br>");
  else if (mainTokens.includes("NCD")) out.cloudsHtml = "• No clouds detected";
  else if (mainTokens.includes("SKC") || mainTokens.includes("CLR")) out.cloudsHtml = "• Clear skies";

  const tempToken = mainTokens.find(token => /^(?:M?\d{2})\/(?:M?\d{2})$/.test(token));
  if (tempToken) {
    const [temperature, dewPoint] = tempToken.split("/");
    out.temperature = `${parseTemp(temperature)}°C, Dew Point: ${parseTemp(dewPoint)}°C`;
  }

  const qnhMatch = metar.match(/(?:^|\s)Q(\d{4})(?=\s|$)/);
  if (qnhMatch) {
    out.qnhValue = Number(qnhMatch[1]);
    const pressure = out.qnhValue;
    if (pressure < 980) [out.qnhLabel, out.qnhClass] = ["Very Low", "qnh-very-low"];
    else if (pressure < 990) [out.qnhLabel, out.qnhClass] = ["Low", "qnh-low"];
    else if (pressure <= 1020) [out.qnhLabel, out.qnhClass] = ["Mild", "qnh-mild"];
    else if (pressure <= 1030) [out.qnhLabel, out.qnhClass] = ["High", "qnh-high"];
    else [out.qnhLabel, out.qnhClass] = ["Very High", "qnh-very-high"];
  }

  const kaukauIndex = remarks.indexOf("KAUKAU");
  if (kaukauIndex >= 0 && remarks[kaukauIndex + 1]) {
    const token = remarks[kaukauIndex + 1];
    if (/^\d{3}\d{2,3}(?:G\d{2,3})?KT$/.test(token)) out.kaukau = formatWind(token);
  }
  const sugarloafIndex = remarks.findIndex(token => /^SUGARLOAF$/i.test(token));
  if (sugarloafIndex >= 0 && remarks[sugarloafIndex + 1]) {
    const token = remarks[sugarloafIndex + 1];
    if (/^\d{3}\d{2,3}(?:G\d{2,3})?KT$/.test(token)) out.sugarloaf = formatWind(token);
  }
  return out;
}

function isWeatherToken(token) {
  return /^(?:\+|-)?(?:VC)?(?:(?:MI|PR|BC|DR|BL|SH|TS|FZ)?(?:DZ|RA|SN|SG|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)+|TS)$/.test(token);
}

function formatWind(token) {
  const match = token.match(/^(VRB|\d{3})(\d{2,3})(?:G(\d{2,3}))?KT$/);
  if (!match) return "";
  const direction = match[1] === "VRB" ? null : Number(match[1]);
  const speed = Number(match[2]);
  const gust = match[3] ? Number(match[3]) : null;
  const speedKmh = Math.round(speed * 1.852);
  const gustKmh = gust === null ? null : Math.round(gust * 1.852);
  const classification = classifyWind(gust === null ? speed : gust);
  const directionText = direction === null ? "Variable direction" : `${direction}° (${degToCompass(direction)})`;
  return `<span class="${classification}">${directionText} at ${speed} knots (${speedKmh} km/h)${gust === null ? "" : ` gusting ${gust} (${gustKmh} km/h)`}</span>`;
}

function classifyWind(speed) {
  if (speed >= 55) return "severe";
  if (speed >= 40) return "strong";
  if (speed >= 25) return "breezy";
  return "";
}
function parseTemp(value) { return value.startsWith("M") ? -parseInt(value.slice(1), 10) : Number(value); }
function degToCompass(degrees) { return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(degrees / 45) % 8]; }
function parseMetarTime(group) {
  const day = Number(group.slice(0, 2));
  const hour = Number(group.slice(2, 4));
  const minute = Number(group.slice(4, 6));
  const now = new Date();
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth();
  if (day > now.getUTCDate() + 1) month--;
  else if (day < now.getUTCDate() - 27) month++;
  return new Date(Date.UTC(year, month, day, hour, minute));
}
