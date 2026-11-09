// ===== DOM =====
const RAW = document.getElementById("rawMetar");
const DEC = document.getElementById("decodedContent");
const ISSUED = document.getElementById("issuedTime");
const UPDATED = document.getElementById("lastUpdated");
const SOURCE = document.getElementById("sourceInfo");
const REF = document.getElementById("refreshBtn");
const TITLE = document.querySelector(".title");
const TAB_TRACK = document.getElementById("tabTrack");
const PREV_PAGE = document.getElementById("prevAirports");
const NEXT_PAGE = document.getElementById("nextAirports");
const SEARCH_INPUT = document.getElementById("airportSearch");
const SEARCH_RESULTS = document.getElementById("airportSearchResults");

// Format: ICAO (IATA)
// Only the ICAO code before the brackets is used for fetching METARs.
const AIRPORTS = [
  "NZWN (WLG)",
  "NZAA (AKL)",
  "NZCH (CHC)",
  "NZQN (ZQN)",
  "YBBN (BNE)",
  "EGLL (LHR)",
  "RJTT (HND)",
  "KATL (ATL)",
  "OMDB (DXB)"
];

const PAGE_SIZE = 3;
let currentAirport = "NZWN (WLG)";
let airportPage = 0;
let requestNumber = 0;

// Worldwide major-airport search data from OurAirports (large/medium airports
// with scheduled service). It is downloaded only when the search is first used
// and cached locally so it does not need to be downloaded on every popup open.
const AIRPORT_DATA_URL = "https://davidmegginson.github.io/ourairports-data/airports.csv";
const AIRPORT_CACHE_KEY = "metarMajorAirportSearchV1";
let airportDatabase = null;
let airportLoadPromise = null;
let searchMatches = [];
let activeSearchIndex = 0;

// Extract ICAO code from entries such as "EGLL (LHR)".
function getIcao(airportEntry) {
  return airportEntry.split("(")[0].trim().toUpperCase();
}

REF.addEventListener("click", fetchAndRender);
PREV_PAGE.addEventListener("click", () => changeAirportPage(-1));
NEXT_PAGE.addEventListener("click", () => changeAirportPage(1));
SEARCH_INPUT.addEventListener("input", renderAirportSearch);
SEARCH_INPUT.addEventListener("keydown", handleAirportSearchKeydown);
document.addEventListener("click", event => {
  if (!event.target.closest(".airport-search")) closeAirportSearch();
});

renderAirportTabs();
updateTitle();
fetchAndRender();

function changeAirportPage(direction) {
  // Scroll one airport at a time so the tabs remain in a single row.
  const maxStart = Math.max(0, AIRPORTS.length - PAGE_SIZE);
  airportPage = Math.max(
    0,
    Math.min(maxStart, airportPage + direction)
  );
  renderAirportTabs();
}

function renderAirportTabs() {
  TAB_TRACK.innerHTML = "";

  const visibleAirports = AIRPORTS.slice(
    airportPage,
    airportPage + PAGE_SIZE
  );

  visibleAirports.forEach(airportEntry => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className =
      "tab" + (airportEntry === currentAirport ? " active" : "");

    // Display the complete airport label, including the IATA code.
    tab.textContent = airportEntry;
    tab.setAttribute(
      "aria-pressed",
      String(airportEntry === currentAirport)
    );

    tab.addEventListener("click", () => switchAirport(airportEntry));
    TAB_TRACK.appendChild(tab);
  });

  TAB_TRACK.classList.toggle(
    "single-tab",
    visibleAirports.length === 1
  );

  PREV_PAGE.disabled = airportPage === 0;
  NEXT_PAGE.disabled =
    airportPage >= Math.max(0, AIRPORTS.length - PAGE_SIZE);
}

function updateTitle() {
  TITLE.textContent = `✈️ ${currentAirport} METAR`;
}

function switchAirport(airportEntry) {
  if (!airportEntry || airportEntry === currentAirport) {
    renderAirportTabs();
    updateTitle();
    closeAirportSearch();
    return;
  }

  // Search results may be airports outside the preset tabs. They become the
  // current airport without being permanently added to the preset carousel.
  currentAirport = airportEntry;
  renderAirportTabs();
  updateTitle();
  closeAirportSearch();
  fetchAndRender();
}

function formatAirportLabel(airport) {
  return airport.iata
    ? `${airport.icao} (${airport.iata})`
    : airport.icao;
}

function getPresetForAirport(airport) {
  return AIRPORTS.find(entry => {
    const icao = getIcao(entry);
    const iataMatch = entry.match(/\(([^)]+)\)/);
    return icao === airport.icao ||
      (airport.iata && iataMatch && iataMatch[1].toUpperCase() === airport.iata);
  });
}

function closeAirportSearch() {
  SEARCH_RESULTS.hidden = true;
  SEARCH_RESULTS.innerHTML = "";
  searchMatches = [];
  activeSearchIndex = 0;
  SEARCH_INPUT.setAttribute("aria-expanded", "false");
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function parseCsvLine(line) {
  const fields = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      fields.push(field);
      field = "";
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields;
}

async function loadAirportDatabase() {
  if (airportDatabase) return airportDatabase;
  if (airportLoadPromise) return airportLoadPromise;

  airportLoadPromise = (async () => {
    // localStorage is best-effort; the search still works if storage is blocked.
    try {
      const cached = localStorage.getItem(AIRPORT_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 100) {
          airportDatabase = parsed;
          return airportDatabase;
        }
      }
    } catch (_) {
      // Ignore corrupt or unavailable local storage and fetch fresh data.
    }

    const response = await fetch(AIRPORT_DATA_URL, { cache: "force-cache" });
    if (!response.ok) throw new Error(`Airport database returned HTTP ${response.status}`);
    const csv = await response.text();
    const lines = csv.split(/\r?\n/);
    if (!lines.length) throw new Error("Airport database was empty");

    const headers = parseCsvLine(lines[0]);
    const column = name => headers.indexOf(name);
    const indexes = {
      type: column("type"),
      name: column("name"),
      municipality: column("municipality"),
      country: column("iso_country"),
      scheduled: column("scheduled_service"),
      icao: column("icao_code"),
      iata: column("iata_code"),
      keywords: column("keywords")
    };

    if (indexes.type < 0 || indexes.icao < 0 || indexes.name < 0) {
      throw new Error("Airport database format was not recognised");
    }

    const airports = [];
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i]) continue;
      const row = parseCsvLine(lines[i]);
      const type = (row[indexes.type] || "").toLowerCase();
      const scheduled = (row[indexes.scheduled] || "").toLowerCase();
      const icao = (row[indexes.icao] || "").trim().toUpperCase();

      // Major/medium airports with scheduled airline service and an ICAO code
      // are the most useful matches for a METAR viewer.
      if (
        !icao ||
        (type !== "large_airport" && type !== "medium_airport") ||
        scheduled !== "yes"
      ) continue;

      airports.push({
        icao,
        iata: (row[indexes.iata] || "").trim().toUpperCase(),
        name: (row[indexes.name] || "").trim(),
        city: (row[indexes.municipality] || "").trim(),
        country: (row[indexes.country] || "").trim().toUpperCase(),
        keywords: (row[indexes.keywords] || "").trim().slice(0, 180),
        size: type === "large_airport" ? 2 : 1
      });
    }

    if (!airports.length) throw new Error("No major airports were found in the database");
    airportDatabase = airports;

    try {
      localStorage.setItem(AIRPORT_CACHE_KEY, JSON.stringify(airports));
    } catch (_) {
      // Storage quota errors are harmless; the fetched list remains in memory.
    }
    return airportDatabase;
  })();

  try {
    return await airportLoadPromise;
  } catch (error) {
    airportLoadPromise = null;
    throw error;
  }
}

function searchAirports(query) {
  const q = normalizeSearchText(query);
  if (!q) return [];

  const airports = airportDatabase || AIRPORTS.map(entry => {
    const icao = getIcao(entry);
    const match = entry.match(/\(([^)]+)\)/);
    const fallback = {
      NZWN: { name: "Wellington International Airport", city: "Wellington", country: "NZ" },
      NZAA: { name: "Auckland Airport", city: "Auckland", country: "NZ" },
      NZCH: { name: "Christchurch International Airport", city: "Christchurch", country: "NZ" },
      NZQN: { name: "Queenstown Airport", city: "Queenstown", country: "NZ" },
      EGLL: { name: "London Heathrow Airport", city: "London", country: "GB" },
      RJTT: { name: "Tokyo Haneda Airport", city: "Tokyo", country: "JP" },
      KATL: { name: "Hartsfield-Jackson Atlanta International Airport", city: "Atlanta", country: "US" },
      OMDB: { name: "Dubai International Airport", city: "Dubai", country: "AE" }
    }[icao] || {};
    return {
      icao,
      iata: match ? match[1].toUpperCase() : "",
      name: fallback.name || entry,
      city: fallback.city || "",
      country: fallback.country || "",
      keywords: "",
      size: 1
    };
  });

  const ranked = [];
  for (const airport of airports) {
    const icao = normalizeSearchText(airport.icao);
    const iata = normalizeSearchText(airport.iata);
    const name = normalizeSearchText(airport.name);
    const city = normalizeSearchText(airport.city);
    const keywords = normalizeSearchText(airport.keywords);
    let score = 0;

    if (icao === q || (iata && iata === q)) score = 1200;
    else if (name === q) score = 1100;
    else if (city === q) score = 1000;
    else if (icao.startsWith(q) || (iata && iata.startsWith(q))) score = 900;
    else if (name.startsWith(q)) score = 850;
    else if (city.startsWith(q)) score = 800;
    else if (keywords.split(/[;,]/).some(keyword => keyword.trim() === q)) score = 750;
    else if (name.includes(q)) score = 650;
    else if (city.includes(q)) score = 600;
    else if (keywords.includes(q)) score = 500;

    if (score) ranked.push({ ...airport, score });
  }

  ranked.sort((a, b) =>
    b.score - a.score ||
    b.size - a.size ||
    a.name.localeCompare(b.name)
  );

  // Remove duplicate ICAO entries and cap the overlay to a short useful list.
  const seen = new Set();
  return ranked.filter(airport => {
    if (seen.has(airport.icao)) return false;
    seen.add(airport.icao);
    return true;
  }).slice(0, 8);
}

function airportCountryName(code) {
  if (!code) return "";
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code;
  } catch (_) {
    return code;
  }
}

async function renderAirportSearch() {
  const query = SEARCH_INPUT.value.trim();
  if (!query) {
    closeAirportSearch();
    return;
  }

  SEARCH_RESULTS.hidden = false;
  searchMatches = [];
  activeSearchIndex = 0;
  SEARCH_RESULTS.innerHTML = '<div class="search-message">Searching airports…</div>';
  SEARCH_INPUT.setAttribute("aria-expanded", "true");

  try {
    await loadAirportDatabase();
  } catch (error) {
    // The existing presets remain searchable if the remote dataset is unavailable.
    console.warn("Could not load worldwide airport database:", error);
  }

  // Read the input again in case it changed while the database was loading.
  const currentQuery = SEARCH_INPUT.value.trim();
  if (!currentQuery) {
    closeAirportSearch();
    return;
  }

  searchMatches = searchAirports(currentQuery);
  activeSearchIndex = 0;
  SEARCH_RESULTS.innerHTML = "";

  if (!searchMatches.length) {
    const message = document.createElement("div");
    message.className = "search-message";
    message.textContent = airportDatabase
      ? "No matching major airports found. Try an ICAO/IATA code or airport name."
      : "Airport data could not load. Check your connection and try again.";
    SEARCH_RESULTS.appendChild(message);
    return;
  }

  searchMatches.forEach((airport, index) => {
    const result = document.createElement("button");
    result.type = "button";
    result.className = "search-result" + (index === activeSearchIndex ? " selected" : "");
    result.setAttribute("role", "option");
    result.setAttribute("aria-selected", String(index === activeSearchIndex));

    const top = document.createElement("span");
    top.className = "search-result-top";
    const code = document.createElement("strong");
    code.className = "search-result-code";
    code.textContent = formatAirportLabel(airport);
    const name = document.createElement("span");
    name.className = "search-result-name";
    name.textContent = airport.name;
    top.append(code, name);

    const detail = document.createElement("span");
    detail.className = "search-result-detail";
    const location = [airport.city, airportCountryName(airport.country)].filter(Boolean).join(", ");
    detail.textContent = location || "Airport";

    result.append(top, detail);
    result.addEventListener("click", () => selectAirportSearchResult(airport));
    SEARCH_RESULTS.appendChild(result);
  });
}

function selectAirportSearchResult(airport) {
  // If it is already one of the preset airports, use that exact preset entry.
  const preset = getPresetForAirport(airport);
  const entry = preset || formatAirportLabel(airport);
  SEARCH_INPUT.value = "";
  switchAirport(entry);
}

function updateActiveSearchResult() {
  const buttons = SEARCH_RESULTS.querySelectorAll(".search-result");
  buttons.forEach((button, index) => {
    const active = index === activeSearchIndex;
    button.classList.toggle("selected", active);
    button.setAttribute("aria-selected", String(active));
  });
  if (buttons[activeSearchIndex]) {
    buttons[activeSearchIndex].scrollIntoView({ block: "nearest" });
  }
}

async function handleAirportSearchKeydown(event) {
  if (event.key === "Escape") {
    closeAirportSearch();
    return;
  }

  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    if (SEARCH_RESULTS.hidden || !searchMatches.length) return;
    event.preventDefault();
    const delta = event.key === "ArrowDown" ? 1 : -1;
    activeSearchIndex = (activeSearchIndex + delta + searchMatches.length) % searchMatches.length;
    updateActiveSearchResult();
    return;
  }

  if (event.key === "Enter") {
    const query = SEARCH_INPUT.value.trim();
    if (!query) return;
    event.preventDefault();

    // Enter chooses the highlighted result; initially this is the best-ranked match.
    if (!searchMatches.length) {
      try {
        await loadAirportDatabase();
      } catch (_) {
        // Try the preset fallback below.
      }
      searchMatches = searchAirports(query);
      activeSearchIndex = 0;
    }

    if (searchMatches.length) {
      selectAirportSearchResult(searchMatches[activeSearchIndex] || searchMatches[0]);
    } else {
      await renderAirportSearch();
    }
  }
}

async function fetchAndRender() {
  const thisRequest = ++requestNumber;

  // Fetch using ICAO only, never the full display label.
  const airport = getIcao(currentAirport);

  RAW.textContent = "Loading…";
  DEC.innerHTML = "";
  ISSUED.textContent = "";
  UPDATED.textContent = "";
  SOURCE.textContent = "";

  try {
    // Preserve the original loading delay.
    await new Promise(resolve => setTimeout(resolve, 1100));

    if (thisRequest !== requestNumber) return;

    const url = `https://metar.vatsim.net/${airport.toLowerCase()}`;
    const resp = await fetch(url, { cache: "no-store" });

    if (!resp.ok) {
      throw new Error(`METAR service returned HTTP ${resp.status}`);
    }

    const metarText = (await resp.text()).trim();

    if (thisRequest !== requestNumber) return;

    // Check against ICAO only. The IATA code in brackets is ignored.
    if (
      !metarText ||
      !metarText.toUpperCase().includes(airport)
    ) {
      RAW.textContent =
        metarText || `No METAR received for ${airport}.`;

      DEC.textContent =
        `The METAR service did not return a usable ${airport} report. Try Refresh later.`;

      SOURCE.textContent =
        `Source: metar.vatsim.net/${airport.toLowerCase()}`;

      return;
    }

    RAW.textContent = metarText;

    const isAuto = /\bAUTO\b/.test(metarText);

    SOURCE.textContent =
      `• Data from metar.vatsim.net/${airport.toLowerCase()} • ` +
      `${isAuto ? "AUTO" : "MANUAL"} •`;

    const decoded = decodeMetar(metarText);
    DEC.innerHTML = buildDecodedHtml(decoded);

    const issueMatch = metarText.match(/\b(\d{6})Z\b/);
    const footerNotes = [];

    if (decoded.stationType) {
      footerNotes.push(decoded.stationType);
    }

    if (decoded.maintenance) {
      footerNotes.push(decoded.maintenance);
    }

    if (decoded.runwayStatus) {
      footerNotes.push(`Runway status:<br>${decoded.runwayStatus}`);
    }

    // Show station type, maintenance and runway status in faint text above the timestamps.
    ISSUED.innerHTML = footerNotes.length
      ? `<div style="opacity:0.62;font-size:inherit;font-weight:normal;line-height:1.35;margin-bottom:4px;">${footerNotes.join("<br>")}</div>`
      : "";

    if (issueMatch) {
      const dt = parseMetarTime(issueMatch[1]);

      ISSUED.innerHTML +=
        `<span class="footer-label">METAR issued:</span><br>` +
        `${formatNZTime(dt)}`;
    }

    UPDATED.innerHTML =
      `Last updated:<br>${formatNZTime(new Date())}`;

  } catch (e) {
    if (thisRequest !== requestNumber) return;

    RAW.textContent = "Failed to fetch METAR.";
    DEC.textContent =
      `${e.message || e}. Null | Metar could not be fetched.`;

    SOURCE.textContent =
      `Source: metar.vatsim.net/${airport.toLowerCase()}`;

    console.error(e);
  }
}

function buildDecodedHtml(obj) {
  let html = "";

  if (obj.wind) {
    html += `<div><b class="label">Wind:</b> ${obj.wind}</div>`;
  }

  if (obj.windVariation) {
    html += `<div><b class="label">Wind direction variation:</b> ${obj.windVariation}</div>`;
  }

  if (obj.visibility) {
    html +=
      `<div><b class="label">Visibility:</b> ${obj.visibility}</div>`;
  }

  if (obj.weatherHtml) {
    html +=
      `<div><b class="label">Weather:</b><br>` +
      `<div class="cloud-indent">${obj.weatherHtml}</div></div>`;
  }

  if (obj.cloudsHtml) {
    html +=
      `<div><b class="label">Clouds:</b><br>` +
      `<div class="cloud-indent">${obj.cloudsHtml}</div></div>`;
  }

  if (obj.temperature) {
    html +=
      `<div><b class="label">Temperature:</b> ${obj.temperature}</div>`;
  }

  // Higher-precision US temperature/dew-point group, decoded rather than
  // displaying the raw TsnTTTsnTTT code.
  if (obj.preciseTemperature) {
    html +=
      `<div><b class="label">Precise temperature:</b> ${obj.preciseTemperature}</div>`;
  }

  // Six-hour maximum and minimum temperature groups in US remarks.
  if (obj.sixHourTemps) {
    html +=
      `<div><b class="label">6-hour temperature range:</b> ${obj.sixHourTemps}</div>`;
  }

  if (obj.qnhValue !== undefined) {
    html +=
      `<div><b class="label">QNH:</b> ` +
      `<span class="${obj.qnhClass}">${obj.qnhValue} hPa ${obj.qnhLabel}</span></div>`;
  }

  if (obj.altimeter) {
    html +=
      `<div><b class="label">Altimeter:</b> ${obj.altimeter}</div>`;
  }

  if (obj.seaLevelPressure) {
    html +=
      `<div><b class="label">Sea-level pressure:</b> ${obj.seaLevelPressure}</div>`;
  }

  if (obj.extremeTemps) {
    html +=
      `<div><b class="label">24-hour temperature extremes:</b> ${obj.extremeTemps}</div>`;
  }

  if (obj.kaukau) {
    html +=
      `<div><b class="label">Mt Kaukau Wind:</b> ${obj.kaukau}</div>`;
  }

  if (obj.sugarloaf) {
    html +=
      `<div><b class="label">Sugarloaf Wind:</b> ${obj.sugarloaf}</div>`;
  }

  if (obj.trend) {
    html += `<div><b class="label">Trend:</b> ${obj.trend}</div>`;
  }

  return html || "<div>No detailed data decoded.</div>";
}

function decodeMetar(metar) {
  const out = {};
  if (!metar) return out;

  // Separate the main METAR body from its remarks.
  const parts = metar.split(/\sRMK\s/);
  const mainPart = parts[0];
  const remarksPart = parts[1] || "";

  // Airport wind.
  const wind = mainPart.match(
    /\b(\d{3}|VRB)(P?\d{2,3})(?:G(P?\d{2,3}))?(KT|MPS)\b/
  );

  if (wind) {
    const dir = wind[1] === "VRB" ? null : +wind[1];
    const speedIsOverRange = wind[2].startsWith("P");
    const spd = +wind[2].replace(/^P/, "");
    const gustIsOverRange = !!wind[3] && wind[3].startsWith("P");
    const gust = wind[3] ? +wind[3].replace(/^P/, "") : null;
    const unit = wind[4];
    const isMps = unit === "MPS";

    // Convert both supported METAR wind units to km/h. Classification uses
    // knot-equivalent speed so colour thresholds stay consistent worldwide.
    const factorToKmh = isMps ? 3.6 : 1.852;
    const spdKmh = isMps
      ? (spd * factorToKmh).toFixed(1)
      : Math.round(spd * factorToKmh);
    const gustKmh = gust !== null
      ? isMps
        ? (gust * factorToKmh).toFixed(1)
        : Math.round(gust * factorToKmh)
      : null;
    const speedKnotsEquivalent = spd * (isMps ? 1.943844 : 1);
    const gustKnotsEquivalent = gust !== null
      ? gust * (isMps ? 1.943844 : 1)
      : null;
    const cls = classifyWind(
      gustKnotsEquivalent !== null ? gustKnotsEquivalent : speedKnotsEquivalent
    );

    const directionText =
      dir === null
        ? "Variable direction"
        : `${dir}° (${degToCompass(dir)})`;
    const speedValue = speedIsOverRange ? `more than ${spd}` : `${spd}`;
    const gustValue = gust !== null
      ? (gustIsOverRange ? `more than ${gust}` : `${gust}`)
      : "";
    const speedText = isMps
      ? `${speedValue} m/s (${spdKmh} km/h)`
      : `${speedValue} knots (${spdKmh} km/h)`;
    const gustText = gust !== null
      ? isMps
        ? `, gusting ${gustValue} m/s (${gustKmh} km/h)`
        : `, gusting ${gustValue} knots (${gustKmh} km/h)`
      : "";

    out.wind = `<span class="${cls}">${directionText} at ${speedText}${gustText}</span>`;
  }

  // Significant variation in wind direction, e.g. 350V070.
  const windVariation = mainPart.match(/\b(\d{3})V(\d{3})\b/);
  if (windVariation) {
    out.windVariation = `${windVariation[1]}° to ${windVariation[2]}°`;
  }

  // Parse visibility from the main METAR body, excluding remarks.
  const mainTokens = mainPart.trim().split(/\s+/);
  const timestampIndex = mainTokens.findIndex(
    token => /^\d{6}Z$/.test(token)
  );

  let visibilityToken = null;

  if (timestampIndex >= 0) {
    for (const token of mainTokens.slice(timestampIndex + 1)) {
      if (/^(?:AUTO|COR)$/.test(token)) continue;

      if (/^(?:\d{3}|VRB)P?\d{2,3}(?:GP?\d{2,3})?(?:KT|MPS)$/.test(token)) {
        continue;
      }

      if (
        token === "CAVOK" ||
        /^\d{4}$/.test(token) ||
        /^(?:P|M)?(?:\d+(?:\.\d+)?|\d+\/\d+)SM$/.test(token)
      ) {
        visibilityToken = token;
        break;
      }

      if (
        /^(?:\+|-)?(?:VC|MI|PR|BC|DR|BL|SH|TS|FZ)?(?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|FG|BR|SA|DU|HZ|FU|VA|SQ|PO|DS|SS|FC|TS)$/.test(token) ||
        /^(?:FEW|SCT|BKN|OVC|SKC|NSC|NCD|CLR)\d{0,3}(?:CB|TCU)?$/.test(token) ||
        /^(?:M?\d{2})\/(?:M?\d{2})$/.test(token) ||
        /^Q\d{4}$/.test(token) ||
        /^A\d{4}$/.test(token)
      ) {
        break;
      }
    }
  }

  const vis =
    visibilityToken && /^(\d{4})$/.exec(visibilityToken);

  if (vis) {
    const v = +vis[1];
    const conditions = [];

    if (mainTokens.includes("HZ")) conditions.push("Haze");
    if (mainTokens.includes("BR")) conditions.push("Mist");
    if (mainTokens.includes("FG")) conditions.push("Fog");

    const conditionText =
      conditions.length ? " • " + conditions.join(", ") : "";

    out.visibility = v === 9999
      ? `10 km or more (9999)${conditionText}`
      : `${v} metres (${(v / 1000).toFixed(1)} km)${conditionText}`;

  } else if (visibilityToken && /STatureM$/.test(visibilityToken)) {
    const milesToken = visibilityToken.slice(0, -2);
    const miles = parseUsFraction(milesToken.replace(/^[PM]/, ""));

    if (milesToken.startsWith("P")) {
      out.visibility =
        `${(miles * 1.609344).toFixed(1)} km or more (${visibilityToken})`;
    } else if (milesToken.startsWith("M")) {
      out.visibility =
        `less than ${(miles * 1.609344).toFixed(1)} km (${visibilityToken})`;
    } else {
      out.visibility =
        `${(miles * 1.609344).toFixed(1)} km (${visibilityToken})`;
    }

  } else if (visibilityToken === "CAVOK") {
    out.visibility = "10 km or more (CAVOK)";
  }

  // Show smoke beside visibility when both are reported, e.g.
  // "3500 metres (3.5 km) • Smoke".
  const hasSmoke = mainTokens.includes("FU");
  if (hasSmoke && out.visibility) {
    out.visibility += " • Smoke";
  }

  // Match complete weather tokens, not text inside words such as VATSIM.
  const weatherCodePattern =
    /^(?:\+|-)?(?:VC)?(?:(?:MI|PR|BC|DR|BL|SH|TS|FZ)?(?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|FG|BR|SA|DU|HZ|FU|VA|SQ|PO|DS|SS|FC)|TS)$/;

  const weatherTokens = mainTokens.filter(
    token => weatherCodePattern.test(token)
  );

  const weather = [];

  const rainTokens = weatherTokens.filter(
    token => /RA$/.test(token)
  );

  const drizzleTokens = weatherTokens.filter(
    token => /DZ$/.test(token)
  );

  const snowTokens = weatherTokens.filter(
    token => /(?:SN|SG|IC|PL|GR|GS|UP)$/.test(token)
  );

  const thunderTokens = weatherTokens.filter(
    token => /^(?:\+|-)?(?:VC)?TS(?:RA|SN|GS|GR|DZ)?$/.test(token)
  );

  const thunderstormWithRain = thunderTokens.some(
    token => /TSRA$/.test(token)
  );

  if (thunderstormWithRain) {
    const rainCode = rainTokens[0] || "RA";

    const intensity =
      rainCode.startsWith("+")
        ? "heavy "
        : rainCode.startsWith("-")
          ? "light "
          : "";

    weather.push(`• Thunderstorm with ${intensity}rain`);

  } else if (rainTokens.some(token => token.startsWith("+"))) {
    weather.push("• Heavy rain");

  } else if (rainTokens.some(token => token.startsWith("-"))) {
    weather.push("• Light rain");

  } else if (rainTokens.length) {
    weather.push("• Rain");
  }

  if (drizzleTokens.some(token => token.startsWith("-"))) {
    weather.push("• Light drizzle");
  } else if (drizzleTokens.length) {
    weather.push("• Drizzle");
  }

  if (snowTokens.length) {
    weather.push("• Snow / frozen precipitation");
  }

  // Other present-weather codes that are not precipitation.
  // Smoke is shown beside visibility whenever visibility is available.
  if (weatherTokens.some(token => /FU$/.test(token)) && !out.visibility) {
    weather.push("• Smoke");
  }
  if (weatherTokens.some(token => /HZ$/.test(token))) {
    weather.push("• Haze");
  }
  if (weatherTokens.some(token => /FG$/.test(token))) {
    weather.push("• Fog");
  }
  if (weatherTokens.some(token => /BR$/.test(token))) {
    weather.push("• Mist");
  }
  if (weatherTokens.some(token => /SA$/.test(token))) {
    weather.push("• Sand");
  }
  if (weatherTokens.some(token => /DU$/.test(token))) {
    weather.push("• Widespread dust");
  }
  if (weatherTokens.some(token => /VA$/.test(token))) {
    weather.push("• Volcanic ash");
  }

  if (thunderTokens.length && !thunderstormWithRain) {
    if (thunderTokens.some(token => token.startsWith("VC"))) {
      weather.push("• Thunderstorm nearby");
    } else {
      weather.push("• Thunderstorm");
    }
  }

  // Recent weather is a separate group, not current weather.
  const recent = mainTokens.find(
    token => /^RE(?:RA|DZ|SN|TS)$/i.test(token)
  );

  if (recent === "RERA") weather.push("• Recent rain");
  else if (recent === "REDZ") weather.push("• Recent drizzle");
  else if (recent === "RESN") weather.push("• Recent snow");
  else if (recent === "RETS") weather.push("• Recent thunderstorm");

  if (weather.length) {
    out.weatherHtml = [...new Set(weather)].join("<br>");
  }

  // Clouds.
  const clouds = [...mainPart.matchAll(
    /\b(FEW|SCT|BKN|OVC)(\d{3})(CB|TCU)?\b/g
  )];
  const verticalVisibility = [...mainPart.matchAll(/\bVV(\d{3}|\/{3})(?=\s|$)/g)];

  const cloudLines = clouds.map(c =>
    `• ${{FEW:"Few",SCT:"Scattered",BKN:"Broken",OVC:"Overcast"}[c[1]]} at ${+c[2] * 100} ft${c[3] ? ` (${c[3]})` : ""}`
  );
  verticalVisibility.forEach(vv => {
    cloudLines.push(vv[1] === "///"
      ? "• Vertical visibility: height unavailable (VV///)"
      : `• Vertical visibility at ${+vv[1] * 100} ft`);
  });

  if (cloudLines.length) {
    out.cloudsHtml = cloudLines.join("<br>");
  } else if (/\b(NCD|NSC|SKC|CLR)\b/.test(mainPart)) {
    out.cloudsHtml = "• No Clouds Detected";
  }

  // Temperature and dew point. Some automated reports omit the dew point.
  const temp = mainPart.match(/\b(M?\d{2})\/(M?\d{2}|\/{3})(?=\s|$)/);

  if (temp) {
    out.temperature = temp[2] === "///"
      ? `${parseTemp(temp[1])}°C, Dew Point: not reported`
      : `${parseTemp(temp[1])}°C, Dew Point: ${parseTemp(temp[2])}°C`;
  }

  // US precise temperature/dew point in remarks: TsnTTTsnTTT.
  // Example T01560106 = 15.6°C temperature and 10.6°C dew point.
  const preciseTemp = remarksPart.match(/\bT([01])(\d{3})([01])(\d{3})\b/);
  if (preciseTemp) {
    const preciseT = parseSignedTenths(preciseTemp[1], preciseTemp[2]);
    const preciseDew = parseSignedTenths(preciseTemp[3], preciseTemp[4]);
    out.preciseTemperature =
      `${preciseT.toFixed(1)}°C, dew point ${preciseDew.toFixed(1)}°C`;
  }

  // US six-hour maximum/minimum temperatures: 1snTxTxTx and 2snTnTnTn.
  // These are decoded into values; the raw groups are not shown.
  const sixHourMax = remarksPart.match(/(?:^|\s)1([01])(\d{3})(?=\s|$)/);
  const sixHourMin = remarksPart.match(/(?:^|\s)2([01])(\d{3})(?=\s|$)/);
  if (sixHourMax || sixHourMin) {
    const maxText = sixHourMax
      ? `max ${parseSignedTenths(sixHourMax[1], sixHourMax[2]).toFixed(1)}°C`
      : null;
    const minText = sixHourMin
      ? `min ${parseSignedTenths(sixHourMin[1], sixHourMin[2]).toFixed(1)}°C`
      : null;
    out.sixHourTemps = [maxText, minText].filter(Boolean).join(", ");
  }

  // US altimeter setting, A####, converted from inHg to hPa.
  const altimeter = mainPart.match(/\bA(\d{4})\b/);

  if (altimeter) {
    const inHg = Number(altimeter[1]) / 100;
    const hPa = inHg * 33.8638866667;

    out.altimeter =
      `${hPa.toFixed(1)} hPa (${inHg.toFixed(2)} inHg)`;
  }

  // Sea-level pressure in remarks: SLPddd.
  const slp = remarksPart.match(/\bSLP(\d{3})\b/);

  if (slp) {
    const digits = slp[1];
    const hPa =
      (Number(digits) < 500 ? 1000 : 900) +
      Number(digits) / 10;

    out.seaLevelPressure =
      `${hPa.toFixed(1)} hPa (${slp[0]})`;
  }

  // US 24-hour maximum/minimum temperature group:
  // 4snTxTxTxsnTnTnTn
  const extremes = remarksPart.match(
    /\b4([01])(\d{3})([01])(\d{3})\b/
  );

  if (extremes) {
    const maximum = parseSignedTenths(
      extremes[1],
      extremes[2]
    );

    const minimum = parseSignedTenths(
      extremes[3],
      extremes[4]
    );

    out.extremeTemps =
      `max ${maximum.toFixed(1)}°C, min ${minimum.toFixed(1)}°C`;
  }

  // International runway state and runway visual range groups.
  // These are displayed in the faint footer notes, alongside AO1/AO2.
  const decodedRunways = [];
  const runwayGroups = [...mainPart.matchAll(/\bR(\d{2}[LCR]?)[/](CLRD[A-Z0-9/]*|SNOCLO|[0-9/]{6})\b/g)];

  for (const match of runwayGroups) {
    const runway = match[1];
    const code = match[2];
    const runwayLabel = runway.replace(/L$/, " Left").replace(/C$/, " Centre").replace(/R$/, " Right");

    if (code.startsWith("CLRD")) {
      const braking = code.slice(4);
      let brakingText = "braking action not reported";
      if (/^\d{2}$/.test(braking)) {
        const value = Number(braking);
        const action = {
          91: "Poor braking action",
          92: "Medium to poor braking action",
          93: "Medium braking action",
          94: "Medium to good braking action",
          95: "Good braking action",
          99: "braking-action figures unreliable"
        }[value];
        brakingText = action || (value <= 90
          ? `reported friction coefficient ${ (value / 100).toFixed(2) }`
          : `braking-action code ${braking}`);
      }
      decodedRunways.push(`• Runway ${runwayLabel}: cleared of runway deposits (CLRD); ${brakingText}`);
    } else if (code === "SNOCLO") {
      decodedRunways.push(`• Runway ${runwayLabel}: closed due to snow (SNOCLO)`);
    } else if (/^[0-9/]{6}$/.test(code)) {
      const depositNames = {
        "0": "clear and dry", "1": "damp", "2": "wet or water patches",
        "3": "rime or frost", "4": "dry snow", "5": "wet snow",
        "6": "slush", "7": "ice", "8": "compacted or rolled snow",
        "9": "frozen ruts or ridges", "/": "not reported"
      };
      const extentNames = {
        "1": "less than 10%", "2": "11–25%", "3": "26–50%",
        "4": "51–100%", "/": "not reported"
      };
      const deposit = depositNames[code[0]] || `deposit code ${code[0]}`;
      const extent = extentNames[code[1]] || `extent code ${code[1]}`;
      const depthCode = code.slice(2, 4);
      let depth = depthCode === "//" ? "depth not reported" : depthCode === "00" ? "less than 1 mm" : Number(depthCode) >= 92 && Number(depthCode) <= 98 ? `${(Number(depthCode) - 90) * 5} cm` : `${Number(depthCode)} mm`;
      const brakingCode = code.slice(4, 6);
      const brakingNames = {"91":"poor", "92":"medium to poor", "93":"medium", "94":"medium to good", "95":"good", "99":"unreliable figures", "//":"not reported"};
      const braking = brakingNames[brakingCode] || (/^\d{2}$/.test(brakingCode) && Number(brakingCode) <= 90 ? `friction coefficient ${(Number(brakingCode) / 100).toFixed(2)}` : `code ${brakingCode}`);
      decodedRunways.push(`• Runway ${runwayLabel}: ${deposit}; contamination ${extent}; deposit depth ${depth}; ${braking}`);
    }
  }

  // Runway visual range (RVR), distinct from runway surface-condition groups.
  const rvrGroups = [...mainPart.matchAll(/\bR(\d{2}[LCR]?)[/](M|P)?(\d{4})(?:V(M|P)?(\d{4}))?([UDN])?(FT)?\b/g)];
  for (const match of rvrGroups) {
    const runway = match[1];
    const runwayLabel = runway.replace(/L$/, " Left").replace(/C$/, " Centre").replace(/R$/, " Right");
    const unit = match[7] ? " ft" : " m";
    const formatRvr = (prefix, value) => `${prefix === "M" ? "less than " : prefix === "P" ? "more than " : ""}${Number(value)}${unit}`;
    let value = formatRvr(match[2] || "", match[3]);
    if (match[4] && match[5]) value += ` to ${formatRvr(match[4], match[5])}`;
    const tendency = {U: "increasing", D: "decreasing", N: "no significant change"}[match[6]];
    decodedRunways.push(`• Runway ${runwayLabel}: runway visual range ${value}${tendency ? `; ${tendency}` : ""}`);
  }

  if (decodedRunways.length) {
    out.runwayStatus = [...new Set(decodedRunways)].join("<br>");
  }

  // Trend indicator is often the final group in international METARs.
  if (/\bNOSIG\b/.test(mainPart)) {
    out.trend = "No significant change expected during the trend period (NOSIG)";
  }

  // Automated station type, displayed faintly above the timestamps.
  const stationType = remarksPart.match(/\bAO([12])\b/);

  if (stationType) {
    out.stationType = stationType[0] === "AO2"
      ? "Station type: AO2 — automated station with precipitation discriminator - Snow/Rain"
      : "Station type: AO1 — automated station without precipitation discriminator";
  }

  // Maintenance indicator, also displayed faintly above the timestamps.
  if (/(?:^|\s)\$(?:\s|$)/.test(remarksPart)) {
    out.maintenance = "Maintenance indicator: $";
  }

  // QNH in hPa. Existing NZ-style QNH decoding remains unchanged.
  const qnh = mainPart.match(/\bQ(\d{4})\b/);

  if (qnh) {
    out.qnhValue = +qnh[1];
    const q = out.qnhValue;

    if (q < 980) {
      out.qnhLabel = "";
      out.qnhClass = "";
    } else if (q < 1000) {
      out.qnhLabel = "";
      out.qnhClass = "";
    } else if (q <= 1024) {
      out.qnhLabel = "";
      out.qnhClass = "";
    } else if (q <= 1039) {
      out.qnhLabel = "";
      out.qnhClass = "";
    } else {
      out.qnhLabel = "";
      out.qnhClass = "";
    }
  }

  // Mt Kaukau wind in Wellington remarks.
  const kau = metar.match(
    /\bKAUKAU\s+(\d{3})(\d{2,3})(?:G(\d{2,3}))?KT\b/
  );

  if (kau) {
    const dir = +kau[1];
    const spd = +kau[2];
    const gust = kau[3] ? +kau[3] : null;

    const spdKmh = Math.round(spd * 1.852);
    const gustKmh = gust ? Math.round(gust * 1.852) : null;
    const cls = classifyWind(gust || spd);

    out.kaukau =
      `<span class="${cls}">${dir}° (${degToCompass(dir)}) at ${spd} knots ` +
      `(${spdKmh} km/h)` +
      `${gust ? `, gusting ${gust} knots (${gustKmh} km/h)` : ""}</span>`;
  }

  // Sugarloaf wind in Christchurch remarks.
  const sugarloaf = metar.match(
    /\bSUGARLOAF\s+(\d{3})(\d{2,3})(?:G(\d{2,3}))?KT\b/i
  );

  if (sugarloaf) {
    const dir = +sugarloaf[1];
    const spd = +sugarloaf[2];
    const gust = sugarloaf[3] ? +sugarloaf[3] : null;

    const spdKmh = Math.round(spd * 1.852);
    const gustKmh = gust ? Math.round(gust * 1.852) : null;
    const cls = classifyWind(gust || spd);

    out.sugarloaf =
      `<span class="${cls}">${dir}° (${degToCompass(dir)}) at ${spd} knots ` +
      `(${spdKmh} km/h)` +
      `${gust ? `, gusting ${gust} knots (${gustKmh} km/h)` : ""}</span>`;
  }

  return out;
}

function classifyWind(s) {
  if (s >= 55) return "severe";
  if (s >= 40) return "strong";
  if (s >= 25) return "breezy";
  return "good";
}

function parseTemp(t) {
  return t.startsWith("M")
    ? -parseInt(t.slice(1), 10)
    : +t;
}

function parseUsFraction(value) {
  if (value.includes("/")) {
    const [numerator, denominator] = value.split("/").map(Number);
    return denominator ? numerator / denominator : 0;
  }

  return Number(value);
}

function parseSignedTenths(sign, digits) {
  const value = Number(digits) / 10;
  return sign === "1" ? -value : value;
}

function degToCompass(d) {
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][
    Math.round(d / 45) % 8
  ];
}

function parseMetarTime(group) {
  const day = +group.slice(0, 2);
  const hour = +group.slice(2, 4);
  const minute = +group.slice(4, 6);

  const now = new Date();
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth();

  // METAR timestamps can refer to the previous or next month.
  let candidate = new Date(
    Date.UTC(year, month, day, hour, minute)
  );

  const diff = candidate.getTime() - now.getTime();

  if (diff > 15 * 24 * 60 * 60 * 1000) {
    candidate = new Date(
      Date.UTC(year, month - 1, day, hour, minute)
    );
  } else if (diff < -15 * 24 * 60 * 60 * 1000) {
    candidate = new Date(
      Date.UTC(year, month + 1, day, hour, minute)
    );
  }

  return candidate;
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

  return (
    `${get("day")}/${get("month")}/${get("year")} ` +
    `${get("hour")}:${get("minute")}:${get("second")} ` +
    `${get("timeZoneName")}`
  );
}
