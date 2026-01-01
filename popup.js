// ===== DOM =====
const RAW = document.getElementById("rawMetar");
const DEC = document.getElementById("decodedContent");
const ISSUED = document.getElementById("issuedTime");
const UPDATED = document.getElementById("lastUpdated");
const SOURCE = document.getElementById("sourceInfo");
const REF = document.getElementById("refreshBtn");

const TAB_NZWN = document.getElementById("tab-nzwn");
const TAB_NZAA = document.getElementById("tab-nzaa");
const TITLE = document.querySelector(".title");

// ===== STATE =====
let currentAirport = "NZWN";

// ===== EVENTS =====
TAB_NZWN.addEventListener("click", () => switchAirport("NZWN"));
TAB_NZAA.addEventListener("click", () => switchAirport("NZAA"));
REF.addEventListener("click", fetchAndRender);

// initial load
fetchAndRender();

// ===== FUNCTIONS =====
function switchAirport(icao) {
  if (icao === currentAirport) return;
  currentAirport = icao;

  TAB_NZWN.classList.toggle("active", icao === "NZWN");
  TAB_NZAA.classList.toggle("active", icao === "NZAA");

  TITLE.textContent = `✈️ ${icao} METAR`;
  fetchAndRender();
}

async function fetchAndRender() {
  try {
    RAW.textContent = "Loading…";
    DEC.innerHTML = "";
    ISSUED.textContent = "";
    UPDATED.textContent = "";
    SOURCE.textContent = "";

    // visible loading delay
    await new Promise(r => setTimeout(r, 1100));

    const url = `https://metar.vatsim.net/${currentAirport.toLowerCase()}`;
    const resp = await fetch(url, { cache: "no-store" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const metarText = (await resp.text()).trim();
    RAW.textContent = metarText || "No METAR received.";

    const isAuto = metarText.includes("AUTO");
    SOURCE.textContent =
      `• Data from metar.vatsim.net/${currentAirport.toLowerCase()} • ${isAuto ? "AUTO" : "MANUAL"} •`;

    const decoded = decodeMetar(metarText);
    DEC.innerHTML = buildDecodedHtml(decoded);

    const issueMatch = metarText.match(/\b(\d{6}Z)\b/);
    if (issueMatch) {
      const dt = parseMetarTime(issueMatch[1]);
      ISSUED.innerHTML =
        `<span style="color:var(--muted);">METAR issued:</span><br>` +
        dt.toLocaleString("en-NZ", { timeZone: "Pacific/Auckland", hour12: false }) +
        " NZDT";
    }

    const now = new Date();
    UPDATED.innerHTML =
      `Last updated:<br>` +
      now.toLocaleString("en-NZ", { timeZone: "Pacific/Auckland", hour12: false }) +
      " NZDT";

  } catch (e) {
    RAW.textContent = "Failed to fetch METAR.";
    DEC.textContent = e.toString();
    console.error(e);
  }
}

// ===== DECODE =====
function buildDecodedHtml(obj) {
  let html = "";
  if (obj.wind) html += `<div><b class="label">Wind:</b> ${obj.wind}</div>`;
  if (obj.visibility) html += `<div><b class="label">Visibility:</b> ${obj.visibility}</div>`;
  if (obj.weatherHtml) {
    html += `<div><b class="label">Rain:</b><br><div class="cloud-indent">${obj.weatherHtml}</div></div>`;
  }
  if (obj.cloudsHtml) {
    html += `<div><b class="label">Clouds:</b><br><div class="cloud-indent">${obj.cloudsHtml}</div></div>`;
  }
  if (obj.temperature) html += `<div><b class="label">Temperature:</b> ${obj.temperature}</div>`;
  if (obj.qnhValue) html += `<div><b class="label">QNH:</b> ${obj.qnhValue} hPa</div>`;
  if (obj.kaukau) html += `<div><b class="label">Mt Kaukau Wind:</b> ${obj.kaukau}</div>`;
  return html || "<div>No detailed data decoded.</div>";
}

function decodeMetar(metar) {
  const out = {};
  if (!metar) return out;

  const wind = metar.match(/(\d{3})(\d{2})(G(\d{2}))?KT/);
  if (wind) {
    const dir = +wind[1];
    const spd = +wind[2];
    const gust = wind[4] ? +wind[4] : null;
    const cls = gust ? classifyWind(gust) : classifyWind(spd);
    out.wind = `<span class="${cls}">${dir}° (${degToCompass(dir)}) at ${spd} knots${gust ? ` gusting ${gust}` : ""}</span>`;
  }

  const vis = metar.match(/\b(\d{4})\b/);
  if (vis) {
    const v = +vis[1];
    out.visibility = `${v} metres (${(v / 1000).toFixed(1)} km)`;
  }

  const weather = [];
  if (metar.includes("-RA")) weather.push("• Light rain");
  else if (metar.includes("+RA")) weather.push("• Heavy rain");
  else if (/\bRA\b/.test(metar)) weather.push("• Rain");
  if (metar.includes("RERA")) weather.push("• Recent rain");
  if (weather.length) out.weatherHtml = weather.join("<br>");

  const clouds = [...metar.matchAll(/(FEW|SCT|BKN|OVC)(\d{3})/g)];
  if (clouds.length) {
    out.cloudsHtml = clouds.map(c =>
      `• ${({FEW:"Few",SCT:"Scattered",BKN:"Broken",OVC:"Overcast"}[c[1]])} at ${+c[2]*100} ft`
    ).join("<br>");
  } else if (metar.includes("NCD")) {
    out.cloudsHtml = "• No clouds detected";
  }

  const temp = metar.match(/ (M?\d{2})\/(M?\d{2}) /);
  if (temp) {
    out.temperature = `${parseTemp(temp[1])}°C, Dew Point: ${parseTemp(temp[2])}°C`;
  }

  const qnh = metar.match(/Q(\d{4})/);
  if (qnh) out.qnhValue = +qnh[1];

  const kau = metar.match(/KAUKAU\s+(\d{3})(\d{2})(G(\d{2}))?KT/);
  if (kau) {
    const dir = +kau[1];
    const spd = +kau[2];
    const cls = classifyWind(spd);
    out.kaukau = `<span class="${cls}">${dir}° (${degToCompass(dir)}) at ${spd} knots</span>`;
  }

  return out;
}

// ===== HELPERS =====
function classifyWind(s) {
  if (s >= 55) return "severe";
  if (s >= 40) return "strong";
  if (s >= 25) return "breezy";
  return "";
}

function parseTemp(t) {
  return t.startsWith("M") ? -parseInt(t.slice(1)) : +t;
}

function degToCompass(d) {
  return ["N","NE","E","SE","S","SW","W","NW"][Math.round(d / 45) % 8];
}

function parseMetarTime(z) {
  const d = +z.slice(0,2), h = +z.slice(2,4), m = +z.slice(4,6);
  const now = new Date();
  let mo = now.getUTCMonth(), y = now.getUTCFullYear();
  if (d > now.getUTCDate()) mo--;
  return new Date(Date.UTC(y, mo, d, h, m));
}
