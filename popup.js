
"use strict";

const $ = id => document.getElementById(id);
const RAW = $("rawMetar");
const DEC = $("decodedContent");
const ISSUED = $("issuedTime");
const UPDATED = $("lastUpdated");
const SOURCE = $("sourceInfo");
const REFRESH = $("refreshBtn");
const TITLE = document.querySelector(".title");
const TAB_TRACK = $("tabTrack");
const PREV = $("prevAirports");
const NEXT = $("nextAirports");
const SEARCH = $("airportSearch");
const RESULTS = $("airportSearchResults");

const AIRPORTS = [
  "NZWN (WLG)", "NZAA (AKL)", "NZCH (CHC)", "NZQN (ZQN)",
  "YBBN (BNE)", "EGLL (LHR)", "RJTT (HND)", "KATL (ATL)", "OMDB (DXB)"
];

const PAGE_SIZE = 3;
const AIRPORT_CSV =
  "https://davidmegginson.github.io/ourairports-data/airports.csv";
const CACHE_KEY = "webmetarAirportDatabaseV1";

let currentAirport = AIRPORTS[0];
let pageStart = 0;
let requestId = 0;
let airportDb = null;
let airportLoad = null;
let searchMatches = [];
let selectedSearchIndex = 0;

REFRESH.addEventListener("click", fetchAndRender);
PREV.addEventListener("click", () => moveAirportPage(-1));
NEXT.addEventListener("click", () => moveAirportPage(1));
SEARCH.addEventListener("input", renderSearch);
SEARCH.addEventListener("keydown", searchKeydown);

document.addEventListener("click", event => {
  if (!event.target.closest(".airport-search")) closeSearch();
});

renderTabs();
updateTitle();
fetchAndRender();

function icaoOf(label) {
  return label.split("(")[0].trim().toUpperCase();
}

function updateTitle() {
  TITLE.textContent = `✈️ ${currentAirport} METAR`;
}

function moveAirportPage(direction) {
  pageStart = Math.max(
    0,
    Math.min(AIRPORTS.length - PAGE_SIZE, pageStart + direction)
  );
  renderTabs();
}

function renderTabs() {
  TAB_TRACK.innerHTML = "";

  AIRPORTS.slice(pageStart, pageStart + PAGE_SIZE).forEach(label => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tab" +
      (label === currentAirport ? " active" : "");
    button.textContent = label;
    button.setAttribute("aria-pressed", String(label === currentAirport));
    button.addEventListener("click", () => switchAirport(label));
    TAB_TRACK.appendChild(button);
  });

  PREV.disabled = pageStart === 0;
  NEXT.disabled = pageStart >= AIRPORTS.length - PAGE_SIZE;
}

function switchAirport(label) {
  if (!label) return;

  currentAirport = label;

  const presetIndex = AIRPORTS.indexOf(label);
  if (presetIndex >= 0) {
    pageStart = Math.min(presetIndex, AIRPORTS.length - PAGE_SIZE);
  }

  renderTabs();
  updateTitle();
  closeSearch();
  fetchAndRender();
}

function closeSearch() {
  RESULTS.hidden = true;
  RESULTS.innerHTML = "";
  SEARCH.setAttribute("aria-expanded", "false");
  searchMatches = [];
  selectedSearchIndex = 0;
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function parseCsvLine(line) {
  const result = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === "," && !quoted) {
      result.push(value);
      value = "";
    } else {
      value += ch;
    }
  }

  result.push(value);
  return result;
}

async function loadAirportDb() {
  if (airportDb) return airportDb;
  if (airportLoad) return airportLoad;

  airportLoad = (async () => {
    try {
      const saved = localStorage.getItem(CACHE_KEY);

      if (saved) {
        const parsed = JSON.parse(saved);

        if (Array.isArray(parsed) && parsed.length > 100) {
          airportDb = parsed;
          return parsed;
        }
      }
    } catch (_) {
      // Continue to download a fresh list if the cache is unavailable.
    }

    const response = await fetch(AIRPORT_CSV, {
      cache: "force-cache"
    });

    if (!response.ok) {
      throw new Error(`Airport list returned HTTP ${response.status}`);
    }

    const lines = (await response.text()).split(/\r?\n/);
    const headers = parseCsvLine(lines.shift() || "");
    const col = name => headers.indexOf(name);

    const ix = {
      type: col("type"),
      name: col("name"),
      city: col("municipality"),
      country: col("iso_country"),
      scheduled: col("scheduled_service"),
      icao: col("icao_code"),
      iata: col("iata_code"),
      keywords: col("keywords")
    };

    if (ix.type < 0 || ix.icao < 0 || ix.name < 0) {
      throw new Error("Airport list format was not recognised");
    }

    const list = [];

    for (const line of lines) {
      if (!line) continue;

      const row = parseCsvLine(line);
      const type = (row[ix.type] || "").toLowerCase();
      const icao = (row[ix.icao] || "").trim().toUpperCase();

      if (
        !icao ||
        !["large_airport", "medium_airport"].includes(type) ||
        (row[ix.scheduled] || "").toLowerCase() !== "yes"
      ) {
        continue;
      }

      list.push({
        icao,
        iata: (row[ix.iata] || "").trim().toUpperCase(),
        name: (row[ix.name] || "").trim(),
        city: (row[ix.city] || "").trim(),
        country: (row[ix.country] || "").trim().toUpperCase(),
        keywords: (row[ix.keywords] || "").trim().slice(0, 180),
        size: type === "large_airport" ? 2 : 1
      });
    }

    if (!list.length) {
      throw new Error("No airports were found");
    }

    airportDb = list;

    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(list));
    } catch (_) {
      // Storage is optional; the list remains available in memory.
    }

    return list;
  })();

  try {
    return await airportLoad;
  } catch (error) {
    airportLoad = null;
    throw error;
  }
}

function fallbackAirports() {
  return AIRPORTS.map(label => {
    const icao = icaoOf(label);
    const match = label.match(/\(([^)]+)\)/);
    const iata = match ? match[1] : "";

    const details = {
      NZWN: ["Wellington International Airport", "Wellington", "NZ"],
      NZAA: ["Auckland Airport", "Auckland", "NZ"],
      NZCH: ["Christchurch International Airport", "Christchurch", "NZ"],
      NZQN: ["Queenstown Airport", "Queenstown", "NZ"],
      YBBN: ["Brisbane Airport", "Brisbane", "AU"],
      EGLL: ["London Heathrow Airport", "London", "GB"],
      RJTT: ["Tokyo Haneda Airport", "Tokyo", "JP"],
      KATL: ["Hartsfield-Jackson Atlanta International Airport", "Atlanta", "US"],
      OMDB: ["Dubai International Airport", "Dubai", "AE"]
    }[icao] || [label, "", ""];

    return {
      icao,
      iata,
      name: details[0],
      city: details[1],
      country: details[2],
      keywords: "",
      size: 1
    };
  });
}

function findAirports(query) {
  const q = normalize(query);
  if (!q) return [];

  const list = airportDb || fallbackAirports();

  return list
    .map(airport => {
      const icao = normalize(airport.icao);
      const iata = normalize(airport.iata);
      const name = normalize(airport.name);
      const city = normalize(airport.city);
      const keywords = normalize(airport.keywords);

      let score = 0;

      if (icao === q || (iata && iata === q)) score = 1200;
      else if (name === q) score = 1100;
      else if (city === q) score = 1000;
      else if (icao.startsWith(q) || (iata && iata.startsWith(q))) score = 900;
      else if (name.startsWith(q)) score = 850;
      else if (city.startsWith(q)) score = 800;
      else if (name.includes(q)) score = 650;
      else if (city.includes(q)) score = 600;
      else if (keywords.includes(q)) score = 500;

      return { ...airport, score };
    })
    .filter(airport => airport.score > 0)
    .sort((a, b) =>
      b.score - a.score ||
      b.size - a.size ||
      a.name.localeCompare(b.name)
    )
    .filter((airport, index, all) =>
      all.findIndex(item => item.icao === airport.icao) === index
    )
    .slice(0, 8);
}

function airportLabel(airport) {
  return airport.iata
    ? `${airport.icao} (${airport.iata})`
    : airport.icao;
}

function countryName(code) {
  try {
    return code
      ? new Intl.DisplayNames(["en"], { type: "region" }).of(code)
      : "";
  } catch (_) {
    return code || "";
  }
}

async function renderSearch() {
  const query = SEARCH.value.trim();

  if (!query) {
    closeSearch();
    return;
  }

  RESULTS.hidden = false;
  RESULTS.innerHTML =
    '<p class="search-message">Searching airports…</p>';
  SEARCH.setAttribute("aria-expanded", "true");

  try {
    await loadAirportDb();
  } catch (error) {
    console.warn("Airport search list could not load:", error);
  }

  if (!SEARCH.value.trim()) {
    closeSearch();
    return;
  }

  searchMatches = findAirports(SEARCH.value);
  selectedSearchIndex = 0;
  RESULTS.innerHTML = "";

  if (!searchMatches.length) {
    const message = document.createElement("p");
    message.className = "search-message";
    message.textContent = airportDb
      ? "No matching major airports. Try an ICAO/IATA code, city or airport name."
      : "Airport search data could not load. Check your connection and try again.";

    RESULTS.appendChild(message);
    return;
  }

  searchMatches.forEach((airport, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className =
      "search-result" + (index === 0 ? " selected" : "");
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(index === 0));

    const top = document.createElement("span");
    top.className = "search-result-top";

    const code = document.createElement("strong");
    code.className = "search-result-code";
    code.textContent = airportLabel(airport);

    const name = document.createElement("span");
    name.className = "search-result-name";
    name.textContent = airport.name;

    top.append(code, name);

    const detail = document.createElement("span");
    detail.className = "search-result-detail";
    detail.textContent = [
      airport.city,
      countryName(airport.country)
    ].filter(Boolean).join(", ") || "Airport";

    button.append(top, detail);
    button.addEventListener("click", () => chooseSearchAirport(airport));
    RESULTS.appendChild(button);
  });
}

function chooseSearchAirport(airport) {
  const preset = AIRPORTS.find(label => {
    const match = label.match(/\(([^)]+)\)/);

    return icaoOf(label) === airport.icao ||
      (airport.iata && match && match[1] === airport.iata);
  });

  SEARCH.value = "";
  switchAirport(preset || airportLabel(airport));
}

function searchKeydown(event) {
  if (event.key === "Escape") {
    closeSearch();
    return;
  }

  if (
    ["ArrowDown", "ArrowUp"].includes(event.key) &&
    !RESULTS.hidden &&
    searchMatches.length
  ) {
    event.preventDefault();

    selectedSearchIndex = (
      selectedSearchIndex +
      (event.key === "ArrowDown" ? 1 : -1) +
      searchMatches.length
    ) % searchMatches.length;

    [...RESULTS.querySelectorAll(".search-result")].forEach(
      (button, index) => {
        button.classList.toggle(
          "selected",
          index === selectedSearchIndex
        );
        button.setAttribute(
          "aria-selected",
          String(index === selectedSearchIndex)
        );
      }
    );

    RESULTS.querySelectorAll(".search-result")[selectedSearchIndex]
      ?.scrollIntoView({ block: "nearest" });
  } else if (event.key === "Enter" && SEARCH.value.trim()) {
    event.preventDefault();

    if (searchMatches.length) {
      chooseSearchAirport(
        searchMatches[selectedSearchIndex] || searchMatches[0]
      );
    } else {
      renderSearch();
    }
  }
}

async function fetchAndRender() {
  const thisRequest = ++requestId;
  const airport = icaoOf(currentAirport);

  RAW.textContent = "Loading…";
  DEC.innerHTML =
    '<p class="placeholder">Fetching the latest report…</p>';

  ISSUED.textContent = "";
  UPDATED.textContent = "";
  SOURCE.textContent = "";
  REFRESH.disabled = true;

  try {
    const response = await fetch(
      `https://metar.vatsim.net/${airport.toLowerCase()}`,
      { cache: "no-store" }
    );

    if (!response.ok) {
      throw new Error(`METAR service returned HTTP ${response.status}`);
    }

    const report = (await response.text()).trim();

    if (thisRequest !== requestId) return;

    if (!report || !report.toUpperCase().includes(airport)) {
      throw new Error(`No usable METAR was returned for ${airport}.`);
    }

    RAW.textContent = report;

    const decoded = decodeMetar(report);
    DEC.innerHTML = buildDecodedHtml(decoded);

    SOURCE.textContent =
      `Source: metar.vatsim.net/${airport.toLowerCase()} • ` +
      `${/\bAUTO\b/.test(report) ? "AUTO" : "MANUAL"}`;

    const issue = report.match(/\b(\d{6})Z\b/);
    const notes = [
      decoded.stationType,
      decoded.maintenance
    ].filter(Boolean);

    if (decoded.runwayStatus) {
      notes.push(`Runway status:<br>${decoded.runwayStatus}`);
    }

    ISSUED.innerHTML =
      (notes.length
        ? `<div class="small">${notes.join("<br>")}</div>`
        : "") +
      (issue
        ? `<span class="footer-label">METAR issued:</span><br>` +
          `${escapeHtml(formatNZTime(parseMetarTime(issue[1])))}` 
        : "");

    UPDATED.innerHTML =
      `Last updated:<br>${escapeHtml(formatNZTime(new Date()))}`;
  } catch (error) {
    if (thisRequest !== requestId) return;

    RAW.textContent = "Could not load METAR.";
    DEC.innerHTML =
      `<p class="placeholder">${escapeHtml(error.message || String(error))}</p>`;
    SOURCE.textContent =
      `Source: metar.vatsim.net/${airport.toLowerCase()}`;
  } finally {
    if (thisRequest === requestId) {
      REFRESH.disabled = false;
    }
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function row(label, value, extraClass = "") {
  return `<div class="decoded-row ${extraClass}">` +
    `<b class="label">${label}:</b> ${value}</div>`;
}

function listRow(label, value) {
  return `<div class="decoded-row full-row">` +
    `<b class="label">${label}:</b>` +
    `<div class="cloud-indent">${value}</div></div>`;
}

function buildDecodedHtml(o) {
  let html = "";

  if (o.wind) html += row("Wind", o.wind);
  if (o.windVariation) {
    html += row("Wind direction variation", o.windVariation);
  }
  if (o.visibility) html += row("Visibility", o.visibility);
  if (o.weatherHtml) html += listRow("Weather", o.weatherHtml);
  if (o.cloudsHtml) html += listRow("Clouds", o.cloudsHtml);
  if (o.temperature) html += row("Temperature", o.temperature);

  if (o.preciseTemperature) {
    html += row("Precise temperature", o.preciseTemperature);
  }

  if (o.sixHourTemps) {
    html += row("6-hour temperature range", o.sixHourTemps);
  }

  if (o.qnhValue !== undefined) {
    html += row(
      "QNH",
      `<span class="${o.qnhClass}">${o.qnhValue} hPa` +
      `${o.qnhLabel ? ` — ${o.qnhLabel}` : ""}</span>`
    );
  }

  if (o.altimeter) html += row("Altimeter", o.altimeter);
  if (o.seaLevelPressure) {
    html += row("Sea-level pressure", o.seaLevelPressure);
  }
  if (o.extremeTemps) {
    html += row("24-hour temperature extremes", o.extremeTemps);
  }
  if (o.kaukau) html += row("Mt Kaukau wind", o.kaukau);
  if (o.sugarloaf) html += row("Sugarloaf wind", o.sugarloaf);
  if (o.trend) html += row("Trend", o.trend);

  return html ||
    '<p class="placeholder">No additional details were decoded from this report.</p>';
}

function decodeMetar(report) {
  const out = {};
  const parts = report.split(/\sRMK\s/);
  const main = parts[0];
  const remarks = parts[1] || "";
  const tokens = main.trim().split(/\s+/);

  // Wind: knots or metres per second, including gusts.
  const wind = main.match(
    /\b(\d{3}|VRB)(P?\d{2,3})(?:G(P?\d{2,3}))?(KT|MPS)\b/
  );

  if (wind) {
    const direction =
      wind[1] === "VRB" ? null : Number(wind[1]);
    const speed = Number(wind[2].replace("P", ""));
    const gust = wind[3]
      ? Number(wind[3].replace("P", ""))
      : null;
    const mps = wind[4] === "MPS";

    const kmh = value =>
      mps ? (value * 3.6).toFixed(1) : Math.round(value * 1.852);

    const knots = value => value * (mps ? 1.943844 : 1);
    const classification = classifyWind(knots(gust ?? speed));

    const directionText = direction === null
      ? "Variable direction"
      : `${direction}° (${degToCompass(direction)})`;

    const speedText =
      `${wind[2].startsWith("P") ? "more than " : ""}${speed} ` +
      `${mps ? "m/s" : "knots"} (${kmh(speed)} km/h)`;

    const gustText = gust === null
      ? ""
      : `, gusting ${wind[3].startsWith("P") ? "more than " : ""}` +
        `${gust} ${mps ? "m/s" : "knots"} (${kmh(gust)} km/h)`;

    out.wind =
      `<span class="${classification}">${directionText} at ` +
      `${speedText}${gustText}</span>`;
  }

  const variation = main.match(/\b(\d{3})V(\d{3})\b/);
  if (variation) {
    out.windVariation = `${variation[1]}° to ${variation[2]}°`;
  }

  // Visibility.
  const timeIndex = tokens.findIndex(token => /^\d{6}Z$/.test(token));
  let visToken = null;

  for (const token of tokens.slice(Math.max(0, timeIndex + 1))) {
    if (/^(?:AUTO|COR)$/.test(token)) continue;

    if (/^(?:\d{3}|VRB)P?\d{2,3}(?:GP?\d{2,3})?(?:KT|MPS)$/.test(token)) {
      continue;
    }

    if (
      token === "CAVOK" ||
      /^\d{4}$/.test(token) ||
      /^(?:P|M)?(?:\d+(?:\.\d+)?|\d+\/\d+)SM$/.test(token)
    ) {
      visToken = token;
      break;
    }

    if (
      /^(?:\+|-)?(?:VC|MI|PR|BC|DR|BL|SH|TS|FZ)?(?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|FG|BR|SA|DU|HZ|FU|VA|SQ|PO|DS|SS|FC|TS)$/.test(token) ||
      /^(?:FEW|SCT|BKN|OVC|SKC|NSC|NCD|CLR|VV)\S*$/.test(token) ||
      /^M?\d{2}\/(?:M?\d{2}|\/\/\/)$/.test(token) ||
      /^Q\d{4}$/.test(token) ||
      /^A\d{4}$/.test(token)
    ) {
      break;
    }
  }

  if (visToken && /^\d{4}$/.test(visToken)) {
    const metres = Number(visToken);

    out.visibility = metres === 9999
      ? "10 km or more (9999)"
      : `${metres} metres (${(metres / 1000).toFixed(1)} km)`;
  } else if (visToken && /SM$/.test(visToken)) {
    const original = visToken.slice(0, -2);
    const number = parseFraction(original.replace(/^[PM]/, ""));
    const km = number * 1.609344;

    out.visibility = original.startsWith("P")
      ? `${km.toFixed(1)} km or more (${visToken})`
      : original.startsWith("M")
        ? `less than ${km.toFixed(1)} km (${visToken})`
        : `${km.toFixed(1)} km (${visToken})`;
  } else if (visToken === "CAVOK") {
    out.visibility = "10 km or more (CAVOK)";
  }

  // Present weather, including smoke (FU).
  const weatherPattern =
    /^(?:\+|-)?(?:VC)?(?:(?:MI|PR|BC|DR|BL|SH|TS|FZ)?(?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|FG|BR|SA|DU|HZ|FU|VA|SQ|PO|DS|SS|FC)|TS)$/;

  const wx = tokens.filter(token => weatherPattern.test(token));
  const has = suffix => wx.some(token => token.endsWith(suffix));
  const weather = [];

  if (has("TSRA")) {
    weather.push("• Thunderstorm with rain");
  } else if (wx.some(token => token.endsWith("RA") && token.startsWith("+"))) {
    weather.push("• Heavy rain");
  } else if (wx.some(token => token.endsWith("RA") && token.startsWith("-"))) {
    weather.push("• Light rain");
  } else if (has("RA")) {
    weather.push("• Rain");
  }

  if (wx.some(token => token.endsWith("DZ") && token.startsWith("-"))) {
    weather.push("• Light drizzle");
  } else if (has("DZ")) {
    weather.push("• Drizzle");
  }

  if (wx.some(token => /(?:SN|SG|IC|PL|GR|GS|UP)$/.test(token))) {
    weather.push("• Snow / frozen precipitation");
  }

  // Smoke goes after visibility, on the same line, when visibility is present.
  if (has("FU") && out.visibility) {
    out.visibility += " • Smoke";
  } else if (has("FU")) {
    weather.push("• Smoke");
  }

  if (has("HZ")) weather.push("• Haze");
  if (has("FG")) weather.push("• Fog");
  if (has("BR")) weather.push("• Mist");
  if (has("SA")) weather.push("• Sand");
  if (has("DU")) weather.push("• Widespread dust");
  if (has("VA")) weather.push("• Volcanic ash");

  if (
    wx.some(token => /^(?:\+|-)?(?:VC)?TS(?:RA|SN|GS|GR|DZ)?$/.test(token)) &&
    !has("TSRA")
  ) {
    weather.push(
      wx.some(token => token.startsWith("VC"))
        ? "• Thunderstorm nearby"
        : "• Thunderstorm"
    );
  }

  const recent = tokens.find(token => /^RE(?:RA|DZ|SN|TS)$/.test(token));

  if (recent) {
    weather.push(({
      RERA: "• Recent rain",
      REDZ: "• Recent drizzle",
      RESN: "• Recent snow",
      RETS: "• Recent thunderstorm"
    })[recent]);
  }

  if (weather.length) {
    out.weatherHtml = [...new Set(weather)].join("<br>");
  }

  // Clouds and vertical visibility.
  const clouds = [...main.matchAll(
    /\b(FEW|SCT|BKN|OVC)(\d{3})(CB|TCU)?\b/g
  )];

  const cloudLines = clouds.map(match =>
    `• ${{ FEW: "Few", SCT: "Scattered", BKN: "Broken", OVC: "Overcast" }[match[1]]} at ${Number(match[2]) * 100} ft${match[3] ? ` (${match[3]})` : ""}`
  );

  for (const vv of main.matchAll(/\bVV(\d{3}|\/\/\/)\b/g)) {
    cloudLines.push(
      vv[1] === "///"
        ? "• Vertical visibility: height unavailable"
        : `• Vertical visibility at ${Number(vv[1]) * 100} ft`
    );
  }

  if (cloudLines.length) {
    out.cloudsHtml = cloudLines.join("<br>");
  } else if (/\b(NCD|NSC|SKC|CLR)\b/.test(main)) {
    out.cloudsHtml = "• No clouds detected";
  }

  // Standard temperature and dew point.
  const temp = main.match(
    /\b(M?\d{2})\/(M?\d{2}|\/\/\/)(?=\s|$)/
  );

  if (temp) {
    out.temperature = temp[2] === "///"
      ? `${parseTemp(temp[1])}°C, dew point not reported`
      : `${parseTemp(temp[1])}°C, dew point ${parseTemp(temp[2])}°C`;
  }

  // Precise temperature and dew point in US remarks.
  const precise = remarks.match(/\bT([01])(\d{3})([01])(\d{3})\b/);

  if (precise) {
    out.preciseTemperature =
      `${signedTenths(precise[1], precise[2]).toFixed(1)}°C, ` +
      `dew point ${signedTenths(precise[3], precise[4]).toFixed(1)}°C`;
  }

  // Six-hour maximum and minimum temperature groups.
  const sixMax = remarks.match(/(?:^|\s)1([01])(\d{3})(?=\s|$)/);
  const sixMin = remarks.match(/(?:^|\s)2([01])(\d{3})(?=\s|$)/);

  if (sixMax || sixMin) {
    out.sixHourTemps = [
      sixMax && `max ${signedTenths(sixMax[1], sixMax[2]).toFixed(1)}°C`,
      sixMin && `min ${signedTenths(sixMin[1], sixMin[2]).toFixed(1)}°C`
    ].filter(Boolean).join(", ");
  }

  // 24-hour temperature extremes.
  const extremes = remarks.match(/\b4([01])(\d{3})([01])(\d{3})\b/);

  if (extremes) {
    out.extremeTemps =
      `max ${signedTenths(extremes[1], extremes[2]).toFixed(1)}°C, ` +
      `min ${signedTenths(extremes[3], extremes[4]).toFixed(1)}°C`;
  }

  // QNH.
  const qnh = main.match(/\bQ(\d{4})\b/);

  if (qnh) {
    out.qnhValue = Number(qnh[1]);
    const q = out.qnhValue;

    out.qnhClass =
      q < 980 ? "qnh-very-low" :
      q < 1000 ? "qnh-low" :
      q <= 1024 ? "qnh-normal" :
      q <= 1039 ? "qnh-high" :
      "qnh-very-high";

    out.qnhLabel =
      q < 990 ? "Very low" :
      q < 1000 ? "Low" :
      q <= 1024 ? "Normal" :
      q <= 1039 ? "High" :
      "Very high";
  }

  // US altimeter setting A####.
  const altimeter = main.match(/\bA(\d{4})\b/);

  if (altimeter) {
    const inHg = Number(altimeter[1]) / 100;
    out.altimeter =
      `${(inHg * 33.8638866667).toFixed(1)} hPa (${inHg.toFixed(2)} inHg)`;
  }

  // Sea-level pressure SLPddd.
  const slp = remarks.match(/\bSLP(\d{3})\b/);

  if (slp) {
    const digits = Number(slp[1]);
    out.seaLevelPressure =
      `${((digits < 500 ? 1000 : 900) + digits / 10).toFixed(1)} hPa`;
  }

  // Runway visual range.
  const runwayLines = [];

  for (const match of main.matchAll(
    /\bR(\d{2}[LCR]?)\/(M|P)?(\d{4})(?:V(M|P)?(\d{4}))?([UDN])?(FT)?\b/g
  )) {
    const runway = match[1];
    const unit = match[7] ? " ft" : " m";

    const value =
      `${match[2] === "M" ? "less than " : match[2] === "P" ? "more than " : ""}` +
      `${match[3]}${unit}`;

    const tendency = ({
      U: "increasing",
      D: "decreasing",
      N: "no significant change"
    })[match[6]];

    runwayLines.push(
      `• Runway ${runway}: runway visual range ${value}` +
      `${match[4] && match[5] ? ` to ${match[5]}${unit}` : ""}` +
      `${tendency ? `; ${tendency}` : ""}`
    );
  }

  // Runway surface-condition groups.
  for (const match of main.matchAll(
    /\bR(\d{2}[LCR]?)\/(CLRD[A-Z0-9/]*|SNOCLO|[0-9/]{6})\b/g
  )) {
    const code = match[2];

    if (code === "SNOCLO") {
      runwayLines.push(`• Runway ${match[1]}: closed due to snow`);
    } else if (code.startsWith("CLRD")) {
      runwayLines.push(
        `• Runway ${match[1]}: runway deposits cleared (${code})`
      );
    } else if (/^[0-9/]{6}$/.test(code)) {
      const deposits = {
        "0": "clear and dry",
        "1": "damp",
        "2": "wet or water patches",
        "3": "rime or frost",
        "4": "dry snow",
        "5": "wet snow",
        "6": "slush",
        "7": "ice",
        "8": "compacted snow",
        "9": "frozen ruts or ridges",
        "/": "not reported"
      };

      runwayLines.push(
        `• Runway ${match[1]}: ${deposits[code[0]] || "unknown deposit"}; ` +
        `deposit code ${code}`
      );
    }
  }

  if (runwayLines.length) {
    out.runwayStatus = [...new Set(runwayLines)].join("<br>");
  }

  // Trend.
  if (/\bNOSIG\b/.test(main)) {
    out.trend =
      "No significant change expected during the trend period (NOSIG)";
  } else {
    const trend = main.match(/\b(BECMG|TEMPO|PROB\d{2})\b/);

    if (trend) {
      out.trend =
        `Trend group reported: ${trend[0]} ` +
        "(see the raw METAR for its full period and conditions)";
    }
  }

  // Automated station type and maintenance indicator.
  const ao = remarks.match(/\bAO([12])\b/);

  if (ao) {
    out.stationType = ao[1] === "2"
      ? "Station type: AO2 — automated station with precipitation discriminator"
      : "Station type: AO1 — automated station without precipitation discriminator";
  }

  if (/(?:^|\s)\$(?:\s|$)/.test(remarks)) {
    out.maintenance = "Maintenance indicator: $";
  }

  // Mt Kaukau and Sugarloaf wind remarks.
  const kau = report.match(
    /\bKAUKAU\s+(\d{3})(\d{2,3})(?:G(\d{2,3}))?KT\b/i
  );

  if (kau) {
    out.kaukau = windRemark(kau[1], kau[2], kau[3]);
  }

  const sugar = report.match(
    /\bSUGARLOAF\s+(\d{3})(\d{2,3})(?:G(\d{2,3}))?KT\b/i
  );

  if (sugar) {
    out.sugarloaf = windRemark(sugar[1], sugar[2], sugar[3]);
  }

  return out;
}

function windRemark(direction, speed, gust) {
  const s = Number(speed);
  const g = gust ? Number(gust) : null;

  return `<span class="${classifyWind(g ?? s)}">` +
    `${direction}° (${degToCompass(Number(direction))}) at ${s} knots ` +
    `(${Math.round(s * 1.852)} km/h)` +
    `${g ? `, gusting ${g} knots (${Math.round(g * 1.852)} km/h)` : ""}` +
    `</span>`;
}

function classifyWind(knots) {
  return knots >= 55 ? "severe" :
    knots >= 40 ? "strong" :
    knots >= 25 ? "breezy" :
    "good";
}

function parseTemp(value) {
  return value.startsWith("M")
    ? -Number(value.slice(1))
    : Number(value);
}

function parseFraction(value) {
  if (!value.includes("/")) return Number(value);

  const [numerator, denominator] = value.split("/").map(Number);
  return denominator ? numerator / denominator : 0;
}

function signedTenths(sign, digits) {
  const value = Number(digits) / 10;
  return sign === "1" ? -value : value;
}

function degToCompass(degrees) {
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][
    Math.round(degrees / 45) % 8
  ];
}

function parseMetarTime(group) {
  const now = new Date();

  let date = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    Number(group.slice(0, 2)),
    Number(group.slice(2, 4)),
    Number(group.slice(4, 6))
  ));

  if (date - now > 15 * 86400000) {
    date.setUTCMonth(date.getUTCMonth() - 1);
  } else if (now - date > 15 * 86400000) {
    date.setUTCMonth(date.getUTCMonth() + 1);
  }

  return date;
}

function formatNZTime(date) {
  const parts = new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short"
  }).formatToParts(date);

  const get = type =>
    parts.find(part => part.type === type)?.value || "";

  return `${get("day")}/${get("month")}/${get("year")} ` +
    `${get("hour")}:${get("minute")}:${get("second")} ` +
    `${get("timeZoneName")}`;
}
