"use strict";

// ============================================================
// DOM ELEMENTS
// Supports both tabTrack and airportTabs.
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
// AIRPORT PRESETS AND SEARCH STATE
// ============================================================

const AIRPORTS = [
  "NZWN (WLG)",
  "NZAA (AKL)",
  "NZCH (CHC)",
  "NZQN (ZQN)",
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

if (REF) REF.addEventListener("click", fetchAndRender);

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
  return airportEntry.split("(")[0].trim().toUpperCase();
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
  if (!airportEntry || airportEntry === currentAirport) {
    renderAirportTabs();
    updateTitle();
    closeAirportSearch();
    return;
  }

  currentAirport = airportEntry;

  const presetIndex = AIRPORTS.indexOf(airportEntry);

  if (presetIndex >= 0) {
    airportPage = Math.min(
      presetIndex,
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

function formatAirportLabel(airport) {
  return airport.iata
    ? `${airport.icao} (${airport.iata})`
    : airport.icao;
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
      // Continue without cached data.
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
      throw new Error("Airport database format was not recognised");
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
      // Search remains usable without local storage.
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
    else if (keywords.split(/[;,]/).some(k => k.trim() === q)) score = 750;
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
    console.warn("Could not load worldwide airport database:", error);
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

  const buttons = SEARCH_RESULTS.querySelectorAll(".search-result");

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
  if (!SEARCH_INPUT || !SEARCH_RESULTS) return;

  if (event.key === "Escape") {
    closeAirportSearch();
    return;
  }

  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    if (SEARCH_RESULTS.hidden || !searchMatches.length) return;

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
        // Try the preset fallback.
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
  if (!RAW || !DEC) return;

  const thisRequest = ++requestNumber;
  const airport = getIcao(currentAirport);

  RAW.textContent = "Loading…";
  DEC.innerHTML = "";

  if (ISSUED) ISSUED.textContent = "";
  if (UPDATED) UPDATED.textContent = "";
  if (SOURCE) SOURCE.textContent = "";

  try {
    await new Promise(resolve => setTimeout(resolve, 1100));

    if (thisRequest !== requestNumber) return;

    const url = `https://metar.vatsim.net/${airport.toLowerCase()}`;

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

      if (SOURCE) {
        SOURCE.textContent =
          `Source: metar.vatsim.net/${airport.toLowerCase()}`;
      }

      return;
    }

    RAW.textContent = metarText;

    if (SOURCE) {
      const isAuto = /\bAUTO\b/.test(metarText);

      SOURCE.textContent =
        `• Data from metar.vatsim.net/${airport.toLowerCase()} • ` +
        `${isAuto ? "AUTO" : "MANUAL"} •`;
    }

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

    if (ISSUED) {
      ISSUED.innerHTML = footerNotes.length
        ? `<div style="opacity:0.62;font-size:inherit;font-weight:normal;line-height:1.35;margin-bottom:4px;">${footerNotes.join("<br>")}</div>`
        : "";

      if (issueMatch) {
        const issuedDate = parseMetarTime(issueMatch[1]);

        ISSUED.innerHTML +=
          `<span class="footer-label">METAR issued:</span><br>` +
          `${formatNZTime(issuedDate)}`;
      }
    }

    if (UPDATED) {
      UPDATED.innerHTML =
        `Last updated:<br>${formatNZTime(new Date())}`;
    }

  } catch (error) {
    if (thisRequest !== requestNumber) return;

    RAW.textContent = "Failed to fetch METAR.";

    DEC.textContent =
      `${error.message || error}. METAR could not be fetched.`;

    if (SOURCE) {
      SOURCE.textContent =
        `Source: metar.vatsim.net/${airport.toLowerCase()}`;
    }

    console.error(error);
  }
}

// ============================================================
// RENDER DECODED INFORMATION
// ============================================================

function buildDecodedHtml(obj) {
  let html = "";

  const add = (label, value) => {
    if (
      value === undefined ||
      value === null ||
      value === ""
    ) {
      return;
    }

    html +=
      `<div class="decoded-row">` +
      `<b class="label">${label}:</b> ${value}</div>`;
  };

  add("Wind", obj.wind);
  add("Wind direction variation", obj.windVariation);
  add("Visibility", obj.visibility);
  add("Visibility by direction", obj.visibilityByDirection);

  if (obj.weatherHtml) {
    html +=
      `<div class="decoded-row"><b class="label">Weather:</b><br>` +
      `<div class="cloud-indent">${obj.weatherHtml}</div></div>`;
  }

  if (obj.cloudsHtml) {
    html +=
      `<div class="decoded-row"><b class="label">Clouds:</b><br>` +
      `<div class="cloud-indent">${obj.cloudsHtml}</div></div>`;
  }

  add("Temperature", obj.temperature);
  add("Precise temperature / dew point", obj.preciseTemperature);
  add("6-hour temperature range", obj.sixHourTemps);
  add("24-hour temperature extremes", obj.extremeTemps);

  if (obj.qnhValue !== undefined) {
    html +=
      `<div class="decoded-row"><b class="label">QNH:</b> ` +
      `<span style="color:#000;font-weight:400">${obj.qnhValue} hPa</span> ` +
      `<span class="${obj.qnhClass || ""}">${obj.qnhLabel || ""}</span></div>`;
  }

  add("Altimeter setting", obj.altimeter);
  add("Sea-level pressure", obj.seaLevelPressure);
  add("Recent weather", obj.recentWeather);
  add("Precipitation", obj.precipitation);
  add("Peak wind", obj.peakWind);
  add("Wind shift", obj.windShift);
  add("Pressure tendency", obj.pressureTendency);
  add("Lightning", obj.lightning);
  add("Hail size", obj.hailSize);

  if (obj.rvrHtml) {
    html +=
      `<div class="decoded-row"><b class="label">Runway visual range:</b><br>` +
      `<div class="cloud-indent">${obj.rvrHtml}</div></div>`;
  }

  if (obj.runwayStatus) {
    html +=
      `<div class="decoded-row"><b class="label">Runway condition:</b><br>` +
      `<div class="cloud-indent">${obj.runwayStatus}</div></div>`;
  }

  add("Mt Kaukau Wind", obj.kaukau);
  add("Sugarloaf Wind", obj.sugarloaf);
  add("Trend", obj.trend);

  return html ||
    "<div>No decodable weather groups were found in this report.</div>";
}

// ============================================================
// METAR DECODER
// ============================================================

function decodeMetar(metar) {
  const out = {};

  if (!metar) return out;

  const parts = metar.split(/\sRMK\s/i);
  const mainPart = parts[0].trim();
  const remarksPart = parts.slice(1).join(" RMK ").trim();

  const mainTokens = mainPart.split(/\s+/).filter(Boolean);
  const remarkTokens = remarksPart.split(/\s+/).filter(Boolean);

  // ----------------------------------------------------------
  // WIND
  // ----------------------------------------------------------

  const wind = mainPart.match(
    /\b(\d{3}|VRB)(P?\d{2,3})(?:G(P?\d{2,3}))?(KT|MPS|KMH)\b/
  );

  if (wind) {
    const direction =
      wind[1] === "VRB" ? null : Number(wind[1]);

    const speed = Number(wind[2].replace(/^P/, ""));

    const gust = wind[3]
      ? Number(wind[3].replace(/^P/, ""))
      : null;

    const unit = wind[4];

    const toKmh =
      unit === "KT" ? 1.852 :
      unit === "MPS" ? 3.6 : 1;

    const toKnots =
      unit === "KT" ? 1 :
      unit === "MPS" ? 1.943844 : 1 / 1.852;

    const speedKmh = Math.round(speed * toKmh);

    const gustKmh = gust === null
      ? null
      : Math.round(gust * toKmh);

    const speedLabel =
      unit === "KT"
        ? `${speed} kt (${speedKmh} km/h)`
        : unit === "MPS"
          ? `${speed} m/s (${speedKmh} km/h)`
          : `${speed} km/h`;

    const gustLabel = gust === null
      ? ""
      : unit === "KT"
        ? `, gusting ${gust} kt (${gustKmh} km/h)`
        : unit === "MPS"
          ? `, gusting ${gust} m/s (${gustKmh} km/h)`
          : `, gusting ${gust} km/h`;

    const directionLabel =
      direction === null
        ? "Variable direction"
        : direction === 0 && speed === 0
          ? "Calm"
          : `${direction}° (${degToCompass(direction)})`;

    const classificationSpeed =
      (gust === null ? speed : gust) * toKnots;

    const windClass = classificationSpeed === 0
      ? "good"
      : classifyWind(classificationSpeed);

    out.wind =
      `<span class="${windClass}">` +
      `${directionLabel}` +
      `${speed === 0 && direction === 0
        ? ""
        : ` at ${speedLabel}${gustLabel}`}` +
      `</span>`;
  }

  const windVariation = mainPart.match(
    /\b(\d{3})V(\d{3})\b/
  );

  if (windVariation) {
    out.windVariation =
      `${windVariation[1]}° to ${windVariation[2]}° (direction varies)`;
  }

  // ----------------------------------------------------------
  // VISIBILITY
  // Supports metric visibility, CAVOK, US miles and fractions.
  // ----------------------------------------------------------

  const timeIndex = mainTokens.findIndex(
    token => /^\d{6}Z$/.test(token)
  );

  let visibilityToken = null;

  if (timeIndex >= 0) {
    for (let i = timeIndex + 1; i < mainTokens.length; i++) {
      const token = mainTokens[i];

      if (/^(AUTO|COR|AMD)$/.test(token)) continue;

      if (
        /^(\d{3}|VRB)P?\d{2,3}(?:GP?\d{2,3})?(KT|MPS|KMH)$/.test(token)
      ) {
        continue;
      }

      if (token === "CAVOK" || /^\d{4}$/.test(token)) {
        visibilityToken = token;
        break;
      }

      if (
        /^(?:P|M)?(?:\d+(?:\.\d+)?|\d+\/\d+)SM$/.test(token)
      ) {
        visibilityToken = token;

        if (
          i > 0 &&
          /^\d+$/.test(mainTokens[i - 1]) &&
          /^\d+\/\d+SM$/.test(token)
        ) {
          visibilityToken = `${mainTokens[i - 1]} ${token}`;
        }

        break;
      }

      if (/^\d+\/\d+SM$/.test(token)) {
        visibilityToken =
          i > 0 && /^\d+$/.test(mainTokens[i - 1])
            ? `${mainTokens[i - 1]} ${token}`
            : token;

        break;
      }

      if (
        /^(?:\+|-)?(?:VC)?(?:(?:MI|PR|BC|DR|BL|SH|TS|FZ)?(?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|FG|BR|SA|DU|HZ|FU|VA|SQ|PO|DS|SS|FC)|TS)$/.test(token) ||
        /^(FEW|SCT|BKN|OVC)\d{3}/.test(token) ||
        /^VV(?:\d{3}|\/\/\/)$/.test(token) ||
        /^(M?\d{2})\/(M?\d{2}|\/\/\/)$/.test(token) ||
        /^Q\d{4}$/.test(token) ||
        /^A\d{4}$/.test(token)
      ) {
        break;
      }
    }
  }

  if (visibilityToken === "CAVOK") {
    out.visibility =
      "10 km or more; no significant weather and no cloud below 5,000 ft (CAVOK)";

  } else if (
    visibilityToken &&
    /^\d{4}$/.test(visibilityToken)
  ) {
    const metres = Number(visibilityToken);

    out.visibility = metres === 9999
      ? "10 km or more (9999)"
      : `${metres.toLocaleString("en-NZ")} m (${(metres / 1000).toFixed(1)} km)`;

  } else if (visibilityToken && /SM$/.test(visibilityToken)) {
    const normalized = visibilityToken
      .replace(/SM$/, "")
      .trim();

    const prefix = /^[PM]/.test(normalized)
      ? normalized[0]
      : "";

    const value = normalized.replace(/^[PM]/, "");
    const pieces = value.split(/\s+/);

    let miles = 0;

    if (pieces.length === 2) {
      miles =
        Number(pieces[0]) + parseUsFraction(pieces[1]);
    } else {
      miles = parseUsFraction(pieces[0]);
    }

    const kilometres = miles * 1.609344;

    out.visibility =
      prefix === "P"
        ? `${kilometres.toFixed(1)} km or more (${visibilityToken})`
        : prefix === "M"
          ? `less than ${kilometres.toFixed(1)} km (${visibilityToken})`
          : `${kilometres.toFixed(1)} km (${visibilityToken})`;
  }

  const directionalVisibility = mainPart.match(
    /\b(\d{4})\s*(N|NE|E|SE|S|SW|W|NW)\b/
  );

  if (directionalVisibility) {
    out.visibilityByDirection =
      `${directionalVisibility[1]} m to the ${directionalVisibility[2]}`;
  }

  // ----------------------------------------------------------
  // PRESENT WEATHER
  // ----------------------------------------------------------

  const weatherPattern =
    /^(\+|-)?(VC)?(MI|PR|BC|DR|BL|SH|TS|FZ)?(DZ|RA|SN|SG|IC|PL|GR|GS|UP|FG|BR|SA|DU|HZ|FU|VA|SQ|PO|DS|SS|FC|TS)$/;

  const weatherDescriptions = {
    DZ: "drizzle",
    RA: "rain",
    SN: "snow",
    SG: "snow grains",
    IC: "ice crystals",
    PL: "ice pellets",
    GR: "hail",
    GS: "small hail / snow pellets",
    UP: "unknown precipitation",
    FG: "fog",
    BR: "mist",
    SA: "sand",
    DU: "dust",
    HZ: "haze",
    FU: "smoke",
    VA: "volcanic ash",
    SQ: "squalls",
    PO: "dust / sand whirls",
    DS: "duststorm",
    SS: "sandstorm",
    FC: "funnel cloud / tornado"
  };

  const descriptorDescriptions = {
    MI: "shallow",
    PR: "partial",
    BC: "patches of",
    DR: "low drifting",
    BL: "blowing",
    SH: "showers of",
    TS: "thunderstorm with",
    FZ: "freezing"
  };

  const weather = [];

  for (const token of mainTokens) {
    const match = token.match(weatherPattern);
    if (!match) continue;

    const intensity =
      match[1] === "+" ? "Heavy " :
      match[1] === "-" ? "Light " : "";

    const vicinity = match[2]
      ? "In the vicinity: "
      : "";

    const descriptor = match[3]
      ? `${descriptorDescriptions[match[3]]} `
      : "";

    const phenomenon =
      weatherDescriptions[match[4]] ||
      (match[4] === "TS" ? "thunderstorm" : match[4]);

    let description =
      `${vicinity}${intensity}${descriptor}${phenomenon}`;

    description = description.replace(
      /\b(thunderstorm with) thunderstorm\b/i,
      "thunderstorm"
    );

    if (match[3] === "TS" && match[4] !== "TS") {
      description =
        `${vicinity}${intensity}thunderstorm with ${phenomenon}`;
    }

    weather.push(`• ${description} (${token})`);
  }

  if (/\bNSW\b/.test(mainPart)) {
    weather.push("• No significant weather (NSW)");
  }

  if (weather.length) {
    out.weatherHtml = [...new Set(weather)].join("<br>");
  }

  // ----------------------------------------------------------
  // CLOUDS AND VERTICAL VISIBILITY
  // ----------------------------------------------------------

  const cloudLines = [];

  const cloudNames = {
    FEW: "Few",
    SCT: "Scattered",
    BKN: "Broken",
    OVC: "Overcast"
  };

  for (const match of mainPart.matchAll(
    /\b(FEW|SCT|BKN|OVC)(\d{3})(CB|TCU)?\b/g
  )) {
    const height = Number(match[2]) * 100;

    const cloudType = match[3]
      ? ` (${match[3] === "CB" ? "cumulonimbus" : "towering cumulus"}; ${match[3]})`
      : "";

    cloudLines.push(
      `• ${cloudNames[match[1]]} at ${height} ft${cloudType}`
    );
  }

  for (const match of mainPart.matchAll(
    /\bVV(\d{3}|\/\/\/)\b/g
  )) {
    cloudLines.push(
      match[1] === "///"
        ? "• Vertical visibility unavailable (VV///)"
        : `• Vertical visibility ${Number(match[1]) * 100} ft`
    );
  }

  if (
    !cloudLines.length &&
    /\b(NCD|NSC|SKC|CLR)\b/.test(mainPart)
  ) {
    const token = mainPart.match(
      /\b(NCD|NSC|SKC|CLR)\b/
    )[1];

    const descriptions = {
      NCD: "No cloud detected by automated equipment",
      NSC: "No significant cloud",
      SKC: "Sky clear",
      CLR: "Clear below 12,000 ft (US automated report)"
    };

    cloudLines.push(`• ${descriptions[token]} (${token})`);
  }

  if (cloudLines.length) {
    out.cloudsHtml = cloudLines.join("<br>");
  }

  // ----------------------------------------------------------
  // TEMPERATURE, DEW POINT AND TEMPERATURE EXTREMES
  // ----------------------------------------------------------

  const temperature = mainPart.match(
    /\b(M?\d{2})\/(M?\d{2}|\/\/\/)(?=\s|$)/
  );

  if (temperature) {
    const airC = parseTemp(temperature[1]);
    const airF = celsiusToF(airC);

    const dewText = temperature[2] === "///"
      ? "dew point not reported"
      : `dew point ${parseTemp(temperature[2])}°C (${celsiusToF(parseTemp(temperature[2]))}°F)`;

    out.temperature =
      `${airC}°C (${airF}°F); ${dewText}`;
  }

  const precise = remarksPart.match(
    /\bT([01])(\d{3})([01])(\d{3})\b/
  );

  if (precise) {
    const air = parseSignedTenths(precise[1], precise[2]);
    const dew = parseSignedTenths(precise[3], precise[4]);

    out.preciseTemperature =
      `${air.toFixed(1)}°C / ${dew.toFixed(1)}°C (${precise[0]})`;
  }

  const maximum6 = remarksPart.match(
    /(?:^|\s)1([01])(\d{3})(?=\s|$)/
  );

  const minimum6 = remarksPart.match(
    /(?:^|\s)2([01])(\d{3})(?=\s|$)/
  );

  if (maximum6 || minimum6) {
    out.sixHourTemps = [
      maximum6
        ? `maximum ${parseSignedTenths(maximum6[1], maximum6[2]).toFixed(1)}°C`
        : "",
      minimum6
        ? `minimum ${parseSignedTenths(minimum6[1], minimum6[2]).toFixed(1)}°C`
        : ""
    ].filter(Boolean).join("; ");
  }

  const extremes = remarksPart.match(
    /\b4([01])(\d{3})([01])(\d{3})\b/
  );

  if (extremes) {
    out.extremeTemps =
      `maximum ${parseSignedTenths(extremes[1], extremes[2]).toFixed(1)}°C; ` +
      `minimum ${parseSignedTenths(extremes[3], extremes[4]).toFixed(1)}°C ` +
      `(${extremes[0]})`;
  }

  // ----------------------------------------------------------
  // PRESSURE: QNH, US ALTIMETER, SLP AND PRESSURE TENDENCY
  // ----------------------------------------------------------

  const qnh = mainPart.match(/\bQ(\d{4})\b/);

  if (qnh) {
    out.qnhValue = Number(qnh[1]);

    const value = out.qnhValue;

    if (value < 980) {
      out.qnhLabel = "very low";
      out.qnhClass = "qnh-very-low";
    } else if (value < 1000) {
      out.qnhLabel = "low";
      out.qnhClass = "qnh-low";
    } else if (value <= 1024) {
      out.qnhLabel = "normal";
      out.qnhClass = "qnh-normal";
    } else if (value <= 1039) {
      out.qnhLabel = "high";
      out.qnhClass = "qnh-high";
    } else {
      out.qnhLabel = "very high";
      out.qnhClass = "qnh-very-high";
    }
  }

  const altimeter = mainPart.match(/\bA(\d{4})\b/);

  if (altimeter) {
    const inHg = Number(altimeter[1]) / 100;
    const hPa = inHg * 33.8638866667;

    out.altimeter =
      `${hPa.toFixed(1)} hPa (${inHg.toFixed(2)} inHg)`;
  }

  const slp = remarksPart.match(/\bSLP(\d{3})\b/);

  if (slp) {
    const digits = Number(slp[1]);
    const pressure =
      (digits < 500 ? 1000 : 900) + digits / 10;

    out.seaLevelPressure =
      `${pressure.toFixed(1)} hPa (${slp[0]})`;
  }

  const pressureTendency = remarksPart.match(
    /\b5([0-8])(\d{3})\b/
  );

  if (pressureTendency) {
    const tendencyNames = [
      "increasing, then steady",
      "increasing, then increasing more slowly",
      "increasing steadily or unsteadily",
      "decreasing, then increasing or steady",
      "steady",
      "decreasing, then decreasing more slowly",
      "decreasing steadily or unsteadily",
      "decreasing, then increasing more rapidly",
      "increasing, then decreasing"
    ];

    const amount =
      (Number(pressureTendency[2]) / 10).toFixed(1);

    out.pressureTendency =
      `${tendencyNames[Number(pressureTendency[1])]}; ` +
      `${amount} hPa over 3 hours (${pressureTendency[0]})`;
  }

  // ----------------------------------------------------------
  // RUNWAY VISUAL RANGE (RVR)
  // ----------------------------------------------------------

  const rvrLines = [];

  for (const match of mainPart.matchAll(
    /\bR(\d{2}[LCR]?)\/(M|P)?(\d{4})(?:V(M|P)?(\d{4}))?([UDN])?(FT)?\b/g
  )) {
    const runway = formatRunwayLabel(match[1]);
    const unit = match[7] ? "ft" : "m";

    const formatRange = (prefix, value) => {
      const qualifier =
        prefix === "M" ? "below " :
        prefix === "P" ? "above " : "";

      return `${qualifier}${Number(value)} ${unit}`;
    };

    let range = formatRange(match[2] || "", match[3]);

    if (match[4] && match[5]) {
      range += ` to ${formatRange(match[4], match[5])}`;
    }

    const tendency = {
      U: "increasing",
      D: "decreasing",
      N: "no significant change"
    }[match[6]];

    rvrLines.push(
      `• Runway ${runway}: ${range}` +
      `${tendency ? `; tendency ${tendency}` : ""} (${match[0]})`
    );
  }

  if (rvrLines.length) {
    out.rvrHtml = rvrLines.join("<br>");
  }

  // ----------------------------------------------------------
  // RUNWAY CONDITION GROUPS
  // ----------------------------------------------------------

  const runwayLines = [];

  const depositNames = {
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

  const extentNames = {
    "1": "less than 10%",
    "2": "11–25%",
    "3": "26–50%",
    "4": "51–100%",
    "/": "not reported"
  };

  const brakingNames = {
    "91": "poor",
    "92": "medium to poor",
    "93": "medium",
    "94": "medium to good",
    "95": "good",
    "99": "unreliable",
    "//": "not reported"
  };

  for (const match of mainPart.matchAll(
    /\bR(\d{2}[LCR]?)\/(CLRD[A-Z0-9/]*|SNOCLO|[0-9/]{6})\b/g
  )) {
    const runway = formatRunwayLabel(match[1]);
    const code = match[2];

    if (code.startsWith("CLRD")) {
      runwayLines.push(
        `• Runway ${runway}: cleared of runway deposits (${code})`
      );

    } else if (code === "SNOCLO") {
      runwayLines.push(
        `• Runway ${runway}: closed due to snow (SNOCLO)`
      );

    } else if (/^[0-9/]{6}$/.test(code)) {
      const deposit =
        depositNames[code[0]] || `deposit code ${code[0]}`;

      const extent =
        extentNames[code[1]] || `extent code ${code[1]}`;

      const depthCode = code.slice(2, 4);

      let depth;

      if (depthCode === "//") {
        depth = "not reported";
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

      const braking =
        brakingNames[brakingCode] ||
        (
          /^\d{2}$/.test(brakingCode) &&
          Number(brakingCode) <= 90
            ? `friction coefficient ${(Number(brakingCode) / 100).toFixed(2)}`
            : `braking code ${brakingCode}`
        );

      runwayLines.push(
        `• Runway ${runway}: ${deposit}; extent ${extent}; ` +
        `deposit depth ${depth}; braking ${braking} (${code})`
      );
    }
  }

  if (runwayLines.length) {
    out.runwayStatus = [...new Set(runwayLines)].join("<br>");
  }

  // ----------------------------------------------------------
  // REMARKS: PRECIPITATION, PEAK WIND AND WIND SHIFT
  // ----------------------------------------------------------

  const precipitation = remarksPart.match(/\bP(\d{4})\b/);

  if (precipitation) {
    const hundredths = Number(precipitation[1]);

    out.precipitation =
      `${(hundredths / 100).toFixed(2)} inches ` +
      `(${(hundredths * 0.254).toFixed(2)} mm) ` +
      `in the reported precipitation period (${precipitation[0]})`;
  }

  const sixHourPrecip = remarksPart.match(/\b6(\d{4})\b/);
  const twentyFourHourPrecip = remarksPart.match(/\b7(\d{4})\b/);

  const precipitationExtras = [];

  if (sixHourPrecip) {
    const amount = Number(sixHourPrecip[1]);

    precipitationExtras.push(
      `${(amount / 100).toFixed(2)} in / ` +
      `${(amount * 0.254).toFixed(2)} mm in 6 hours`
    );
  }

  if (twentyFourHourPrecip) {
    const amount = Number(twentyFourHourPrecip[1]);

    precipitationExtras.push(
      `${(amount / 100).toFixed(2)} in / ` +
      `${(amount * 0.254).toFixed(2)} mm in 24 hours`
    );
  }

  if (precipitationExtras.length) {
    out.precipitation = [
      out.precipitation,
      ...precipitationExtras
    ].filter(Boolean).join("; ");
  }

  const peakWind = remarksPart.match(
    /\bPK WND (\d{3})(\d{2,3})\/(\d{4})\b/
  );

  if (peakWind) {
    const direction = Number(peakWind[1]);
    const speed = Number(peakWind[2]);

    out.peakWind =
      `${direction}° (${degToCompass(direction)}) at ${speed} kt ` +
      `(${Math.round(speed * 1.852)} km/h), ` +
      `time ${peakWind[3].slice(0, 2)}:${peakWind[3].slice(2)} UTC`;
  }

  const windShift = remarksPart.match(
    /\bWSHFT\s*(\d{4})?(?:\s*(FROPA))?/
  );

  if (windShift) {
    out.windShift =
      `Wind shift` +
      `${windShift[1]
        ? ` at ${windShift[1].slice(0, 2)}:${windShift[1].slice(2)} UTC`
        : ""}` +
      `${windShift[2] ? "; frontal passage indicated" : ""}`;
  }

  // ----------------------------------------------------------
  // LIGHTNING AND HAIL
  // ----------------------------------------------------------

  const lightning = remarksPart.match(
    /\b(?:LTG|CG|IC|CC|CA|TS)\b.*?(?=\s(?:AO[12]|SLP\d{3}|T[01]\d{3}[01]\d{3}|\$)|$)/
  );

  if (lightning && /\bLTG\b/.test(remarksPart)) {
    out.lightning = `Lightning reported: ${lightning[0]}`;
  }

  const hail = remarksPart.match(/\bGR\s?(\d+(?:\.\d+)?)\b/);

  if (hail) {
    out.hailSize =
      `${hail[1]} inch (${(Number(hail[1]) * 25.4).toFixed(1)} mm) hailstones`;
  }

  // ----------------------------------------------------------
  // STATION TYPE, MAINTENANCE AND RECENT WEATHER
  // ----------------------------------------------------------

  const recent = remarkTokens.filter(token =>
    /^RE(?:TS|RA|DZ|SN|FG|FZRA|SHRA|BLSN|GS|GR)$/.test(token)
  );

  if (recent.length) {
    out.recentWeather = recent
      .map(token => `• ${token} = recent ${token.slice(2).toLowerCase()}`)
      .join("; ");
  }

  const stationType = remarksPart.match(/\bAO([12])\b/);

  if (stationType) {
    out.stationType = stationType[0] === "AO2"
      ? "Station type: AO2 — automated station with precipitation discriminator"
      : "Station type: AO1 — automated station without precipitation discriminator";
  }

  if (/(?:^|\s)\$(?:\s|$)/.test(remarksPart)) {
    out.maintenance =
      "Maintenance indicator: $ (automated station maintenance check)";
  }

  // ----------------------------------------------------------
  // TREND GROUPS
  // ----------------------------------------------------------

  const trendTokens = mainTokens.filter(token =>
    /^(NOSIG|BECMG|TEMPO|PROB\d{2}|FM\d{4}|TL\d{4}|AT\d{4})$/.test(token)
  );

  if (trendTokens.length) {
    const trendDescriptions = trendTokens.map(token => ({
      NOSIG: "no significant change expected",
      BECMG: "conditions becoming",
      TEMPO: "temporary fluctuations expected"
    }[token] || token));

    out.trend =
      `${trendDescriptions.join("; ")} (${trendTokens.join(" ")})`;
  }

  // ----------------------------------------------------------
  // MT KAUKAU AND SUGARLOAF WINDS
  // ----------------------------------------------------------

  const kau = metar.match(
    /\bKAUKAU\s+(\d{3})(\d{2,3})(?:G(\d{2,3}))?KT\b/i
  );

  if (kau) {
    const direction = Number(kau[1]);
    const speed = Number(kau[2]);
    const gust = kau[3] ? Number(kau[3]) : null;

    out.kaukau =
      `<span class="${classifyWind(gust ?? speed)}">` +
      `${direction}° (${degToCompass(direction)}) at ${speed} kt ` +
      `(${Math.round(speed * 1.852)} km/h)` +
      `${gust !== null
        ? `, gusting ${gust} kt (${Math.round(gust * 1.852)} km/h)`
        : ""}</span>`;
  }

  const sugarloaf = metar.match(
    /\bSUGARLOAF\s+(\d{3})(\d{2,3})(?:G(\d{2,3}))?KT\b/i
  );

  if (sugarloaf) {
    const direction = Number(sugarloaf[1]);
    const speed = Number(sugarloaf[2]);
    const gust = sugarloaf[3] ? Number(sugarloaf[3]) : null;

    out.sugarloaf =
      `<span class="${classifyWind(gust ?? speed)}">` +
      `${direction}° (${degToCompass(direction)}) at ${speed} kt ` +
      `(${Math.round(speed * 1.852)} km/h)` +
      `${gust !== null
        ? `, gusting ${gust} kt (${Math.round(gust * 1.852)} km/h)`
        : ""}</span>`;
  }

  return out;
}

// ============================================================
// DECODER HELPERS
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
    ? -parseInt(value.slice(1), 10)
    : Number(value);
}

function celsiusToF(celsius) {
  return Math.round((Number(celsius) * 9 / 5 + 32) * 10) / 10;
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
  return sign === "1" ? -value : value;
}

function degToCompass(degrees) {
  return [
    "N", "NE", "E", "SE",
    "S", "SW", "W", "NW"
  ][Math.round(degrees / 45) % 8];
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
// NEW ZEALAND LOCAL TIME
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
