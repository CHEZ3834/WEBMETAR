"use strict";

// ============================================================
// DOM ELEMENTS
// ============================================================

const RAW = document.getElementById("rawMetar");
const DEC = document.getElementById("decodedContent");
const ISSUED = document.getElementById("issuedTime");
const UPDATED = document.getElementById("lastUpdated");
const SOURCE = document.getElementById("sourceInfo");
const REF = document.getElementById("refreshBtn");
const TITLE = document.querySelector(".title");

const TAB_TRACK =
  document.getElementById("tabTrack") ||
  document.getElementById("airportTabs");

const PREV_PAGE = document.getElementById("prevAirports");
const NEXT_PAGE = document.getElementById("nextAirports");

const SEARCH_INPUT = document.getElementById("airportSearch");
const SEARCH_RESULTS = document.getElementById("airportSearchResults");

// ============================================================
// AIRPORTS AND STATE
// ============================================================

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

const AIRPORT_DATA_URL =
  "https://davidmegginson.github.io/ourairports-data/airports.csv";

const AIRPORT_CACHE_KEY = "metarMajorAirportSearchV1";

let currentAirport = "NZWN (WLG)";
let airportPage = 0;
let requestNumber = 0;

let airportDatabase = null;
let airportLoadPromise = null;
let searchMatches = [];
let activeSearchIndex = 0;

// ============================================================
// INITIALISATION
// ============================================================

if (REF) {
  REF.addEventListener("click", fetchAndRender);
}

if (PREV_PAGE) {
  PREV_PAGE.addEventListener("click", () => changeAirportPage(-1));
}

if (NEXT_PAGE) {
  NEXT_PAGE.addEventListener("click", () => changeAirportPage(1));
}

if (SEARCH_INPUT) {
  SEARCH_INPUT.addEventListener("input", renderAirportSearch);
  SEARCH_INPUT.addEventListener("keydown", handleAirportSearchKeydown);
}

document.addEventListener("click", event => {
  if (!event.target.closest(".airport-search")) {
    closeAirportSearch();
  }
});

renderAirportTabs();
updateTitle();
fetchAndRender();

// ============================================================
// AIRPORT TABS
// ============================================================

function getIcao(airportEntry) {
  return airportEntry
    .split("(")[0]
    .trim()
    .toUpperCase();
}

function formatAirportLabel(airport) {
  return airport.iata
    ? `${airport.icao} (${airport.iata})`
    : airport.icao;
}

function changeAirportPage(direction) {
  const maxStart = Math.max(0, AIRPORTS.length - PAGE_SIZE);

  airportPage = Math.max(
    0,
    Math.min(maxStart, airportPage + direction)
  );

  renderAirportTabs();
}

function renderAirportTabs() {
  if (!TAB_TRACK) return;

  TAB_TRACK.innerHTML = "";

  const visibleAirports = AIRPORTS.slice(
    airportPage,
    airportPage + PAGE_SIZE
  );

  visibleAirports.forEach(airportEntry => {
    const tab = document.createElement("button");

    tab.type = "button";
    tab.className =
      "tab" +
      (airportEntry === currentAirport ? " active" : "");

    tab.textContent = airportEntry;

    tab.setAttribute(
      "aria-pressed",
      String(airportEntry === currentAirport)
    );

    tab.addEventListener("click", () => {
      switchAirport(airportEntry);
    });

    TAB_TRACK.appendChild(tab);
  });

  TAB_TRACK.classList.toggle(
    "single-tab",
    visibleAirports.length === 1
  );

  if (PREV_PAGE) {
    PREV_PAGE.disabled = airportPage === 0;
  }

  if (NEXT_PAGE) {
    NEXT_PAGE.disabled =
      airportPage >= Math.max(0, AIRPORTS.length - PAGE_SIZE);
  }
}

function updateTitle() {
  if (TITLE) {
    TITLE.textContent = `✈️ ${currentAirport} METAR`;
  }
}

function switchAirport(airportEntry) {
  if (!airportEntry) return;

  if (airportEntry === currentAirport) {
    renderAirportTabs();
    updateTitle();
    closeAirportSearch();
    return;
  }

  currentAirport = airportEntry;

  const index = AIRPORTS.indexOf(airportEntry);

  if (index >= 0) {
    airportPage = Math.min(
      Math.max(0, index),
      Math.max(0, AIRPORTS.length - PAGE_SIZE)
    );
  }

  renderAirportTabs();
  updateTitle();
  closeAirportSearch();
  fetchAndRender();
}

// ============================================================
// WORLDWIDE AIRPORT SEARCH
// ============================================================

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
      // Continue without the cache.
    }

    const response = await fetch(AIRPORT_DATA_URL, {
      cache: "force-cache"
    });

    if (!response.ok) {
      throw new Error(
        `Airport database returned HTTP ${response.status}`
      );
    }

    const csv = await response.text();
    const lines = csv.split(/\r?\n/);

    if (!lines.length) {
      throw new Error("Airport database was empty");
    }

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

    if (
      indexes.type < 0 ||
      indexes.icao < 0 ||
      indexes.name < 0
    ) {
      throw new Error(
        "Airport database format was not recognised"
      );
    }

    const airports = [];

    for (let i = 1; i < lines.length; i++) {
      if (!lines[i]) continue;

      const row = parseCsvLine(lines[i]);

      const type = (row[indexes.type] || "").toLowerCase();
      const scheduled =
        (row[indexes.scheduled] || "").toLowerCase();

      const icao =
        (row[indexes.icao] || "").trim().toUpperCase();

      if (
        !icao ||
        !["large_airport", "medium_airport"].includes(type) ||
        scheduled !== "yes"
      ) {
        continue;
      }

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

    if (!airports.length) {
      throw new Error("No major airports were found");
    }

    airportDatabase = airports;

    try {
      localStorage.setItem(
        AIRPORT_CACHE_KEY,
        JSON.stringify(airports)
      );
    } catch (_) {
      // Search can still work if storage is unavailable.
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

  const fallbackDetails = {
    NZWN: {
      name: "Wellington International Airport",
      city: "Wellington",
      country: "NZ"
    },
    NZAA: {
      name: "Auckland Airport",
      city: "Auckland",
      country: "NZ"
    },
    NZCH: {
      name: "Christchurch International Airport",
      city: "Christchurch",
      country: "NZ"
    },
    NZQN: {
      name: "Queenstown Airport",
      city: "Queenstown",
      country: "NZ"
    },
    YBBN: {
      name: "Brisbane Airport",
      city: "Brisbane",
      country: "AU"
    },
    EGLL: {
      name: "London Heathrow Airport",
      city: "London",
      country: "GB"
    },
    RJTT: {
      name: "Tokyo Haneda Airport",
      city: "Tokyo",
      country: "JP"
    },
    KATL: {
      name: "Hartsfield-Jackson Atlanta International Airport",
      city: "Atlanta",
      country: "US"
    },
    OMDB: {
      name: "Dubai International Airport",
      city: "Dubai",
      country: "AE"
    }
  };

  const airports = airportDatabase || AIRPORTS.map(entry => {
    const icao = getIcao(entry);
    const match = entry.match(/\(([^)]+)\)/);

    return {
      icao,
      iata: match ? match[1].toUpperCase() : "",
      name: fallbackDetails[icao]?.name || entry,
      city: fallbackDetails[icao]?.city || "",
      country: fallbackDetails[icao]?.country || "",
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
    else if (
      keywords.split(/[;,]/).some(item => item.trim() === q)
    ) score = 750;
    else if (name.includes(q)) score = 650;
    else if (city.includes(q)) score = 600;
    else if (keywords.includes(q)) score = 500;

    if (score) {
      ranked.push({ ...airport, score });
    }
  }

  ranked.sort((a, b) =>
    b.score - a.score ||
    b.size - a.size ||
    a.name.localeCompare(b.name)
  );

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
    return new Intl.DisplayNames(["en"], {
      type: "region"
    }).of(code) || code;
  } catch (_) {
    return code;
  }
}

function getPresetForAirport(airport) {
  return AIRPORTS.find(entry => {
    const icao = getIcao(entry);
    const match = entry.match(/\(([^)]+)\)/);
    const iata = match ? match[1].toUpperCase() : "";

    return icao === airport.icao ||
      (airport.iata && iata === airport.iata);
  });
}

function closeAirportSearch() {
  if (!SEARCH_RESULTS || !SEARCH_INPUT) return;

  SEARCH_RESULTS.hidden = true;
  SEARCH_RESULTS.innerHTML = "";

  searchMatches = [];
  activeSearchIndex = 0;

  SEARCH_INPUT.setAttribute("aria-expanded", "false");
}

async function renderAirportSearch() {
  if (!SEARCH_INPUT || !SEARCH_RESULTS) return;

  const query = SEARCH_INPUT.value.trim();

  if (!query) {
    closeAirportSearch();
    return;
  }

  SEARCH_RESULTS.hidden = false;
  SEARCH_RESULTS.innerHTML =
    '<div class="search-message">Searching airports…</div>';

  SEARCH_INPUT.setAttribute("aria-expanded", "true");

  try {
    await loadAirportDatabase();
  } catch (error) {
    console.warn(
      "Could not load worldwide airport database:",
      error
    );
  }

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
    result.className =
      "search-result" +
      (index === activeSearchIndex ? " selected" : "");

    result.setAttribute("role", "option");
    result.setAttribute(
      "aria-selected",
      String(index === activeSearchIndex)
    );

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

    detail.textContent = [
      airport.city,
      airportCountryName(airport.country)
    ].filter(Boolean).join(", ") || "Airport";

    result.append(top, detail);

    result.addEventListener("click", () => {
      selectAirportSearchResult(airport);
    });

    SEARCH_RESULTS.appendChild(result);
  });
}

function selectAirportSearchResult(airport) {
  const preset = getPresetForAirport(airport);
  const entry = preset || formatAirportLabel(airport);

  if (SEARCH_INPUT) SEARCH_INPUT.value = "";

  switchAirport(entry);
}

function updateActiveSearchResult() {
  if (!SEARCH_RESULTS) return;

  const buttons =
    SEARCH_RESULTS.querySelectorAll(".search-result");

  buttons.forEach((button, index) => {
    const active = index === activeSearchIndex;

    button.classList.toggle("selected", active);
    button.setAttribute("aria-selected", String(active));
  });

  if (buttons[activeSearchIndex]) {
    buttons[activeSearchIndex].scrollIntoView({
      block: "nearest"
    });
  }
}

async function handleAirportSearchKeydown(event) {
  if (event.key === "Escape") {
    closeAirportSearch();
    return;
  }

  if (
    event.key === "ArrowDown" ||
    event.key === "ArrowUp"
  ) {
    if (
      !SEARCH_RESULTS ||
      SEARCH_RESULTS.hidden ||
      !searchMatches.length
    ) {
      return;
    }

    event.preventDefault();

    const delta = event.key === "ArrowDown" ? 1 : -1;

    activeSearchIndex =
      (activeSearchIndex + delta + searchMatches.length) %
      searchMatches.length;

    updateActiveSearchResult();
    return;
  }

  if (event.key === "Enter") {
    const query = SEARCH_INPUT.value.trim();

    if (!query) return;

    event.preventDefault();

    if (!searchMatches.length) {
      try {
        await loadAirportDatabase();
      } catch (_) {
        // Use the preset fallback if necessary.
      }

      searchMatches = searchAirports(query);
      activeSearchIndex = 0;
    }

    if (searchMatches.length) {
      selectAirportSearchResult(
        searchMatches[activeSearchIndex] || searchMatches[0]
      );
    } else {
      await renderAirportSearch();
    }
  }
}

// ============================================================
// FETCH AND DISPLAY METAR
// ============================================================

async function fetchAndRender() {
  const thisRequest = ++requestNumber;
  const airport = getIcao(currentAirport);

  RAW.textContent = "Loading…";
  DEC.innerHTML = "";
  ISSUED.textContent = "";
  UPDATED.textContent = "";
  SOURCE.textContent = "";

  try {
    // Preserve the existing loading delay.
    await new Promise(resolve => setTimeout(resolve, 1100));

    if (thisRequest !== requestNumber) return;

    const url =
      `https://metar.vatsim.net/${airport.toLowerCase()}`;

    const response = await fetch(url, {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(
        `METAR service returned HTTP ${response.status}`
      );
    }

    const metarText = (await response.text()).trim();

    if (thisRequest !== requestNumber) return;

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
      footerNotes.push(
        `Runway status:<br>${decoded.runwayStatus}`
      );
    }

    ISSUED.innerHTML = footerNotes.length
      ? `<div style="opacity:0.62;font-size:inherit;font-weight:normal;line-height:1.35;margin-bottom:4px;">${footerNotes.join("<br>")}</div>`
      : "";

    if (issueMatch) {
      const date = parseMetarTime(issueMatch[1]);

      ISSUED.innerHTML +=
        `<span class="footer-label">METAR issued:</span><br>` +
        `${formatNZTime(date)}`;
    }

    UPDATED.innerHTML =
      `Last updated:<br>${formatNZTime(new Date())}`;

  } catch (error) {
    if (thisRequest !== requestNumber) return;

    RAW.textContent = "Failed to fetch METAR.";

    DEC.textContent =
      `${error.message || error}. METAR could not be fetched.`;

    SOURCE.textContent =
      `Source: metar.vatsim.net/${airport.toLowerCase()}`;

    console.error(error);
  }
}

// ============================================================
// BUILD DECODED HTML
// ============================================================

function buildDecodedHtml(obj) {
  let html = "";

  if (obj.wind) {
    html +=
      `<div><b class="label">Wind:</b> ${obj.wind}</div>`;
  }

  if (obj.windVariation) {
    html +=
      `<div><b class="label">Wind direction variation:</b> ${obj.windVariation}</div>`;
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

  if (obj.preciseTemperature) {
    html +=
      `<div><b class="label">Precise temperature:</b> ${obj.preciseTemperature}</div>`;
  }

  if (obj.sixHourTemps) {
    html +=
      `<div><b class="label">6-hour temperature range:</b> ${obj.sixHourTemps}</div>`;
  }

  if (obj.qnhValue !== undefined) {
    html +=
      `<div><b class="label">QNH:</b> ` +
      `<span class="${obj.qnhClass || ""}">${obj.qnhValue} hPa ${obj.qnhLabel || ""}</span></div>`;
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
    html +=
      `<div><b class="label">Trend:</b> ${obj.trend}</div>`;
  }

  return html || "<div>No detailed data decoded.</div>";
}

// ============================================================
// METAR DECODER
// ============================================================

function decodeMetar(metar) {
  const out = {};

  if (!metar) return out;

  const parts = metar.split(/\sRMK\s/);
  const mainPart = parts[0];
  const remarksPart = parts[1] || "";
  const mainTokens = mainPart.trim().split(/\s+/);

  // ----------------------------------------------------------
  // WIND
  // ----------------------------------------------------------

  const wind = mainPart.match(
    /\b(\d{3}|VRB)(P?\d{2,3})(?:G(P?\d{2,3}))?(KT|MPS|KMH)\b/
  );

  if (wind) {
    const dir = wind[1] === "VRB" ? null : Number(wind[1]);

    const speedOverRange = wind[2].startsWith("P");
    const speed = Number(wind[2].replace(/^P/, ""));

    const gustOverRange =
      Boolean(wind[3]) && wind[3].startsWith("P");

    const gust = wind[3]
      ? Number(wind[3].replace(/^P/, ""))
      : null;

    const unit = wind[4];

    const factorToKmh = {
      KT: 1.852,
      MPS: 3.6,
      KMH: 1
    }[unit];

    const speedKmh = Math.round(speed * factorToKmh);

    const gustKmh = gust !== null
      ? Math.round(gust * factorToKmh)
      : null;

    const speedKnots = {
      KT: speed,
      MPS: speed * 1.943844,
      KMH: speed / 1.852
    }[unit];

    const gustKnots = gust !== null
      ? {
          KT: gust,
          MPS: gust * 1.943844,
          KMH: gust / 1.852
        }[unit]
      : null;

    const classValue =
      gustKnots !== null ? gustKnots : speedKnots;

    const windClass = classifyWind(classValue);

    const directionText = dir === null
      ? "Variable direction"
      : `${dir}° (${degToCompass(dir)})`;

    const speedText =
      `${speedOverRange ? "more than " : ""}${speed}`;

    let unitText;

    if (unit === "MPS") {
      unitText = `${speedText} m/s (${speedKmh} km/h)`;
    } else if (unit === "KMH") {
      unitText = `${speedText} km/h`;
    } else {
      unitText = `${speedText} knots (${speedKmh} km/h)`;
    }

    let gustText = "";

    if (gust !== null) {
      const gustValue =
        `${gustOverRange ? "more than " : ""}${gust}`;

      if (unit === "MPS") {
        gustText =
          `, gusting ${gustValue} m/s (${gustKmh} km/h)`;
      } else if (unit === "KMH") {
        gustText = `, gusting ${gustValue} km/h`;
      } else {
        gustText =
          `, gusting ${gustValue} knots (${gustKmh} km/h)`;
      }
    }

    out.wind =
      `<span class="${windClass}">${directionText} at ${unitText}${gustText}</span>`;
  }

  const windVariation = mainPart.match(
    /\b(\d{3})V(\d{3})\b/
  );

  if (windVariation) {
    out.windVariation =
      `${windVariation[1]}° to ${windVariation[2]}°`;
  }

  // ----------------------------------------------------------
  // VISIBILITY
  // ----------------------------------------------------------

  let visibilityToken = null;

  const timestampIndex = mainTokens.findIndex(
    token => /^\d{6}Z$/.test(token)
  );

  if (timestampIndex >= 0) {
    for (const token of mainTokens.slice(timestampIndex + 1)) {
      if (/^(AUTO|COR)$/.test(token)) continue;

      if (
        /^(?:\d{3}|VRB)P?\d{2,3}(?:GP?\d{2,3})?(KT|MPS|KMH)$/.test(token)
      ) {
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
        /^(?:\+|-)?(?:VC)?(?:(?:MI|PR|BC|DR|BL|SH|TS|FZ)?(?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|FG|BR|SA|DU|HZ|FU|VA|SQ|PO|DS|SS|FC)|TS)$/.test(token) ||
        /^(?:FEW|SCT|BKN|OVC)\d{3}(?:CB|TCU)?$/.test(token) ||
        /^(?:VV\d{3}|VV\/\/\/|SKC|NSC|NCD|CLR)$/.test(token) ||
        /^(?:M?\d{2})\/(?:M?\d{2}|\/\/\/)$/.test(token) ||
        /^Q\d{4}$/.test(token) ||
        /^A\d{4}$/.test(token)
      ) {
        break;
      }
    }
  }

  if (visibilityToken && /^\d{4}$/.test(visibilityToken)) {
    const value = Number(visibilityToken);
    const conditions = [];

    if (/\bHZ\b/.test(mainPart)) conditions.push("Haze");
    if (/\bBR\b/.test(mainPart)) conditions.push("Mist");
    if (/\bFG\b/.test(mainPart)) conditions.push("Fog");
    if (/\bFU\b/.test(mainPart)) conditions.push("Smoke");
    if (/\bDU\b/.test(mainPart)) conditions.push("Dust");
    if (/\bSA\b/.test(mainPart)) conditions.push("Sand");

    let visibilityText = value === 9999
      ? "10 km or more (9999)"
      : `${value} metres (${(value / 1000).toFixed(1)} km)`;

    if (conditions.length) {
      visibilityText += ` • ${conditions.join(", ")}`;
    }

    out.visibility = visibilityText;

  } else if (
    visibilityToken &&
    /SM$/.test(visibilityToken)
  ) {
    const milesToken = visibilityToken.slice(0, -2);
    const prefix = /^[PM]/.test(milesToken)
      ? milesToken[0]
      : "";

    const miles = parseUsFraction(
      milesToken.replace(/^[PM]/, "")
    );

    const kilometres = miles * 1.609344;

    if (prefix === "P") {
      out.visibility =
        `${kilometres.toFixed(1)} km or more (${visibilityToken})`;
    } else if (prefix === "M") {
      out.visibility =
        `less than ${kilometres.toFixed(1)} km (${visibilityToken})`;
    } else {
      out.visibility =
        `${kilometres.toFixed(1)} km (${visibilityToken})`;
    }

  } else if (visibilityToken === "CAVOK") {
    out.visibility =
      "10 km or more; no significant weather or low cloud (CAVOK)";
  }

  // ----------------------------------------------------------
  // WEATHER
  // ----------------------------------------------------------

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

    const intensity = rainCode.startsWith("+")
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
    weather.push("• Snow or frozen precipitation");
  }

  if (
    thunderTokens.length &&
    !thunderstormWithRain
  ) {
    if (thunderTokens.some(token => token.startsWith("VC"))) {
      weather.push("• Thunderstorm nearby");
    } else {
      weather.push("• Thunderstorm");
    }
  }

  const weatherDescriptions = [
    ["FG", "• Fog"],
    ["BR", "• Mist"],
    ["HZ", "• Haze"],
    ["FU", "• Smoke"],
    ["DU", "• Dust"],
    ["SA", "• Sand"],
    ["VA", "• Volcanic ash"],
    ["SQ", "• Squalls"],
    ["FC", "• Funnel cloud or tornado"],
    ["PO", "• Dust or sand whirls"],
    ["DS", "• Duststorm"],
    ["SS", "• Sandstorm"],
    ["PL", "• Ice pellets"],
    ["GR", "• Hail"],
    ["GS", "• Small hail or snow pellets"],
    ["IC", "• Ice crystals"]
  ];

  for (const [code, description] of weatherDescriptions) {
    if (
      weatherTokens.some(token =>
        new RegExp(`${code}$`).test(token)
      )
    ) {
      weather.push(description);
    }
  }

  const recent = mainTokens.find(
    token => /^RE(?:RA|DZ|SN|TS)$/i.test(token)
  );

  if (recent === "RERA") weather.push("• Recent rain");
  if (recent === "REDZ") weather.push("• Recent drizzle");
  if (recent === "RESN") weather.push("• Recent snow");
  if (recent === "RETS") weather.push("• Recent thunderstorm");

  if (weather.length) {
    out.weatherHtml = [...new Set(weather)].join("<br>");
  }

  // ----------------------------------------------------------
  // CLOUDS AND VERTICAL VISIBILITY
  // ----------------------------------------------------------

  const clouds = [
    ...mainPart.matchAll(
      /\b(FEW|SCT|BKN|OVC)(\d{3})(CB|TCU)?\b/g
    )
  ];

  const verticalVisibility = [
    ...mainPart.matchAll(/\bVV(\d{3}|\/{3})\b/g)
  ];

  const cloudNames = {
    FEW: "Few",
    SCT: "Scattered",
    BKN: "Broken",
    OVC: "Overcast"
  };

  const cloudLines = clouds.map(cloud =>
    `• ${cloudNames[cloud[1]]} at ${Number(cloud[2]) * 100} ft` +
    `${cloud[3] ? ` (${cloud[3]})` : ""}`
  );

  verticalVisibility.forEach(group => {
    cloudLines.push(
      group[1] === "///"
        ? "• Vertical visibility: height unavailable (VV///)"
        : `• Vertical visibility at ${Number(group[1]) * 100} ft`
    );
  });

  if (cloudLines.length) {
    out.cloudsHtml = cloudLines.join("<br>");
  } else if (/\b(NCD|NSC|SKC|CLR)\b/.test(mainPart)) {
    out.cloudsHtml = "• No clouds detected";
  }

  // ----------------------------------------------------------
  // TEMPERATURE AND DEW POINT
  // ----------------------------------------------------------

  const temperature = mainPart.match(
    /\b(M?\d{2})\/(M?\d{2}|\/\/\/)(?=\s|$)/
  );

  if (temperature) {
    out.temperature = temperature[2] === "///"
      ? `${parseTemp(temperature[1])}°C, dew point not reported`
      : `${parseTemp(temperature[1])}°C, dew point: ${parseTemp(temperature[2])}°C`;
  }

  // Precise temperature and dew point: TsnTTTsnTTT.
  const precise = remarksPart.match(
    /\bT([01])(\d{3})([01])(\d{3})\b/
  );

  if (precise) {
    const air = parseSignedTenths(precise[1], precise[2]);
    const dew = parseSignedTenths(precise[3], precise[4]);

    out.preciseTemperature =
      `${air.toFixed(1)}°C, dew point ${dew.toFixed(1)}°C`;
  }

  // Six-hour maximum and minimum temperatures.
  const sixHourMax = remarksPart.match(
    /(?:^|\s)1([01])(\d{3})(?=\s|$)/
  );

  const sixHourMin = remarksPart.match(
    /(?:^|\s)2([01])(\d{3})(?=\s|$)/
  );

  if (sixHourMax || sixHourMin) {
    const maximum = sixHourMax
      ? `max ${parseSignedTenths(
          sixHourMax[1],
          sixHourMax[2]
        ).toFixed(1)}°C`
      : null;

    const minimum = sixHourMin
      ? `min ${parseSignedTenths(
          sixHourMin[1],
          sixHourMin[2]
        ).toFixed(1)}°C`
      : null;

    out.sixHourTemps =
      [maximum, minimum].filter(Boolean).join(", ");
  }

  // 24-hour maximum/minimum temperatures.
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

  // ----------------------------------------------------------
  // PRESSURE
  // ----------------------------------------------------------

  const qnh = mainPart.match(/\bQ(\d{4})\b/);

  if (qnh) {
    out.qnhValue = Number(qnh[1]);

    const value = out.qnhValue;

    if (value < 980) {
      out.qnhLabel = "Very low";
      out.qnhClass = "qnh-very-low";
    } else if (value < 1000) {
      out.qnhLabel = "Low";
      out.qnhClass = "qnh-low";
    } else if (value <= 1024) {
      out.qnhLabel = "Normal";
      out.qnhClass = "qnh-normal";
    } else if (value <= 1039) {
      out.qnhLabel = "High";
      out.qnhClass = "qnh-high";
    } else {
      out.qnhLabel = "Very high";
      out.qnhClass = "qnh-very-high";
    }
  }

  // US altimeter setting in inches of mercury.
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
    const digits = Number(slp[1]);

    const hPa =
      (digits < 500 ? 1000 : 900) + digits / 10;

    out.seaLevelPressure =
      `${hPa.toFixed(1)} hPa (${slp[0]})`;
  }

  // ----------------------------------------------------------
  // RUNWAY VISUAL RANGE AND RUNWAY CONDITIONS
  // ----------------------------------------------------------

  const decodedRunways = [];

  // RVR groups, for example R27/1200, R27/M0600 or R27/0800V1200U.
  const rvrGroups = [
    ...mainPart.matchAll(
      /\bR(\d{2}[LCR]?)\/(M|P)?(\d{4})(?:V(M|P)?(\d{4}))?([UDN])?(FT)?\b/g
    )
  ];

  for (const match of rvrGroups) {
    const runway = match[1];
    const runwayLabel = formatRunwayLabel(runway);
    const unit = match[7] ? " ft" : " m";

    const formatRvr = (prefix, value) => {
      const qualifier =
        prefix === "M"
          ? "less than "
          : prefix === "P"
            ? "more than "
            : "";

      return `${qualifier}${Number(value)}${unit}`;
    };

    let range = formatRvr(match[2] || "", match[3]);

    if (match[4] && match[5]) {
      range += ` to ${formatRvr(match[4], match[5])}`;
    }

    const tendency = {
      U: "increasing",
      D: "decreasing",
      N: "no significant change"
    }[match[6]];

    decodedRunways.push(
      `• Runway ${runwayLabel}: visual range ${range}` +
      `${tendency ? `; ${tendency}` : ""}`
    );
  }

  // Runway deposits and braking-action groups.
  const runwayGroups = [
    ...mainPart.matchAll(
      /\bR(\d{2}[LCR]?)\/(CLRD[A-Z0-9/]*|SNOCLO|[0-9/]{6})\b/g
    )
  ];

  for (const match of runwayGroups) {
    const runway = match[1];
    const code = match[2];
    const runwayLabel = formatRunwayLabel(runway);

    if (code.startsWith("CLRD")) {
      const brakingCode = code.slice(4);
      let braking = "braking action not reported";

      const brakingNames = {
        "91": "poor braking action",
        "92": "medium to poor braking action",
        "93": "medium braking action",
        "94": "medium to good braking action",
        "95": "good braking action",
        "99": "braking-action figures unreliable"
      };

      if (/^\d{2}$/.test(brakingCode)) {
        braking =
          brakingNames[brakingCode] ||
          `braking-action code ${brakingCode}`;
      }

      decodedRunways.push(
        `• Runway ${runwayLabel}: cleared of runway deposits; ${braking}`
      );

    } else if (code === "SNOCLO") {
      decodedRunways.push(
        `• Runway ${runwayLabel}: closed due to snow (SNOCLO)`
      );

    } else if (/^[0-9/]{6}$/.test(code)) {
      const depositNames = {
        "0": "clear and dry",
        "1": "damp",
        "2": "wet or water patches",
        "3": "rime or frost",
        "4": "dry snow",
        "5": "wet snow",
        "6": "slush",
        "7": "ice",
        "8": "compacted or rolled snow",
        "9": "frozen ruts or ridges",
        "/": "not reported"
      };

      const extentNames = {
        "1": "less than 10%",
        "2": "11–25%",
        "3": "26–50%",
        "4": "51–100%",
        "/": "not reported"
      };

      const deposit =
        depositNames[code[0]] || `deposit code ${code[0]}`;

      const extent =
        extentNames[code[1]] || `extent code ${code[1]}`;

      const depthCode = code.slice(2, 4);

      let depth;

      if (depthCode === "//") {
        depth = "depth not reported";
      } else if (depthCode === "00") {
        depth = "less than 1 mm";
      } else if (
        Number(depthCode) >= 92 &&
        Number(depthCode) <= 98
      ) {
        depth = `${(Number(depthCode) - 90) * 5} cm`;
      } else {
        depth = `${Number(depthCode)} mm`;
      }

      const brakingCode = code.slice(4, 6);

      const brakingNames = {
        "91": "poor",
        "92": "medium to poor",
        "93": "medium",
        "94": "medium to good",
        "95": "good",
        "99": "unreliable figures",
        "//": "not reported"
      };

      const braking =
        brakingNames[brakingCode] ||
        (/^\d{2}$/.test(brakingCode) &&
        Number(brakingCode) <= 90
          ? `friction coefficient ${(Number(brakingCode) / 100).toFixed(2)}`
          : `code ${brakingCode}`);

      decodedRunways.push(
        `• Runway ${runwayLabel}: ${deposit}; contamination ${extent}; ` +
        `deposit depth ${depth}; braking ${braking}`
      );
    }
  }

  if (decodedRunways.length) {
    out.runwayStatus = [...new Set(decodedRunways)].join("<br>");
  }

  // ----------------------------------------------------------
  // TREND
  // ----------------------------------------------------------

  if (/\bNOSIG\b/.test(mainPart)) {
    out.trend =
      "No significant change expected during the trend period (NOSIG)";
  }

  // ----------------------------------------------------------
  // STATION TYPE AND MAINTENANCE
  // ----------------------------------------------------------

  const stationType = remarksPart.match(/\bAO([12])\b/);

  if (stationType) {
    out.stationType = stationType[0] === "AO2"
      ? "Station type: AO2 — automated station with precipitation discriminator"
      : "Station type: AO1 — automated station without precipitation discriminator";
  }

  if (/(?:^|\s)\$(?:\s|$)/.test(remarksPart)) {
    out.maintenance = "Maintenance indicator: $";
  }

  // ----------------------------------------------------------
  // MT KAUKAU WIND
  // ----------------------------------------------------------

  const kau = metar.match(
    /\bKAUKAU\s+(\d{3})(\d{2,3})(?:G(\d{2,3}))?KT\b/i
  );

  if (kau) {
    const direction = Number(kau[1]);
    const speed = Number(kau[2]);
    const gust = kau[3] ? Number(kau[3]) : null;

    const speedKmh = Math.round(speed * 1.852);
    const gustKmh =
      gust !== null ? Math.round(gust * 1.852) : null;

    const windClass = classifyWind(gust ?? speed);

    out.kaukau =
      `<span class="${windClass}">` +
      `${direction}° (${degToCompass(direction)}) at ` +
      `${speed} knots (${speedKmh} km/h)` +
      `${gust !== null
        ? `, gusting ${gust} knots (${gustKmh} km/h)`
        : ""}` +
      `</span>`;
  }

  // ----------------------------------------------------------
  // SUGARLOAF WIND
  // ----------------------------------------------------------

  const sugarloaf = metar.match(
    /\bSUGARLOAF\s+(\d{3})(\d{2,3})(?:G(\d{2,3}))?KT\b/i
  );

  if (sugarloaf) {
    const direction = Number(sugarloaf[1]);
    const speed = Number(sugarloaf[2]);
    const gust = sugarloaf[3]
      ? Number(sugarloaf[3])
      : null;

    const speedKmh = Math.round(speed * 1.852);
    const gustKmh =
      gust !== null ? Math.round(gust * 1.852) : null;

    const windClass = classifyWind(gust ?? speed);

    out.sugarloaf =
      `<span class="${windClass}">` +
      `${direction}° (${degToCompass(direction)}) at ` +
      `${speed} knots (${speedKmh} km/h)` +
      `${gust !== null
        ? `, gusting ${gust} knots (${gustKmh} km/h)`
        : ""}` +
      `</span>`;
  }

  return out;
}

// ============================================================
// HELPERS
// ============================================================

function formatRunwayLabel(runway) {
  return runway
    .replace(/L$/, " Left")
    .replace(/C$/, " Centre")
    .replace(/R$/, " Right");
}

function classifyWind(speedKnots) {
  if (speedKnots >= 55) return "severe";
  if (speedKnots >= 40) return "strong";
  if (speedKnots >= 25) return "breezy";
  return "good";
}

function parseTemp(value) {
  return value.startsWith("M")
    ? -Number(value.slice(1))
    : Number(value);
}

function parseUsFraction(value) {
  if (value.includes("/")) {
    const [numerator, denominator] =
      value.split("/").map(Number);

    return denominator ? numerator / denominator : 0;
  }

  return Number(value);
}

function parseSignedTenths(sign, digits) {
  const value = Number(digits) / 10;

  // METAR temperature groups use 1 to indicate a negative value.
  return sign === "1" ? -value : value;
}

function degToCompass(degrees) {
  const directions = [
    "N", "NE", "E", "SE",
    "S", "SW", "W", "NW"
  ];

  return directions[
    Math.round(degrees / 45) % 8
  ];
}

// ============================================================
// METAR TIMESTAMP
// ============================================================

function parseMetarTime(group) {
  const day = Number(group.slice(0, 2));
  const hour = Number(group.slice(2, 4));
  const minute = Number(group.slice(4, 6));

  const now = new Date();

  let year = now.getUTCFullYear();
  let month = now.getUTCMonth();

  let candidate = new Date(
    Date.UTC(year, month, day, hour, minute)
  );

  const difference = candidate.getTime() - now.getTime();

  // METAR timestamps can fall in the previous or next month.
  if (difference > 15 * 24 * 60 * 60 * 1000) {
    candidate = new Date(
      Date.UTC(year, month - 1, day, hour, minute)
    );
  } else if (difference < -15 * 24 * 60 * 60 * 1000) {
    candidate = new Date(
      Date.UTC(year, month + 1, day, hour, minute)
    );
  }

  return candidate;
}

// ============================================================
// NEW ZEALAND TIME FORMATTING
// ============================================================

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
