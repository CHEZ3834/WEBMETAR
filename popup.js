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

const SEARCH = document.getElementById("airportSearch");
const SEARCH_RESULTS = document.getElementById("airportSearchResults");

const AIRPORTS = ["NZWN", "NZAA", "NZCH"];
const AIRPORTS_CSV =
  "https://davidmegginson.github.io/ourairports-data/airports.csv";

let currentAirport = "NZWN";
let tabStart = 0;
let requestNumber = 0;
let searchNumber = 0;
let airportDatabase = null;
let airportDatabasePromise = null;

const LOADING_DELAY_MS = 1100;
const AIRPORT_CACHE_KEY = "webmetar_airport_database_v1";
const AIRPORT_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

/* Preset airport controls */

TABS.forEach(tab => {
  tab.addEventListener("click", () => {
    switchAirport(tab.dataset.airport);
  });
});

PREV.addEventListener("click", () => moveTabWindow(-1));
NEXT.addEventListener("click", () => moveTabWindow(1));
REF.addEventListener("click", fetchAndRender);

/* Airport search */

SEARCH.addEventListener("input", () => {
  searchAirports(SEARCH.value);
});

SEARCH.addEventListener("focus", () => {
  if (SEARCH.value.trim().length >= 2) {
    searchAirports(SEARCH.value);
  }
});

document.addEventListener("click", event => {
  if (
    !SEARCH.contains(event.target) &&
    !SEARCH_RESULTS.contains(event.target)
  ) {
    hideSearchResults();
  }
});

SEARCH.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    hideSearchResults();
    SEARCH.blur();
  }

  if (event.key === "Enter") {
    const firstResult = SEARCH_RESULTS.querySelector(".search-result");

    if (firstResult && !SEARCH_RESULTS.hidden) {
      event.preventDefault();
      firstResult.click();
    }
  }
});

renderTabs();
fetchAndRender();

/* Preset tabs */

function moveTabWindow(direction) {
  const maxStart = Math.max(0, AIRPORTS.length - 2);

  tabStart = Math.max(
    0,
    Math.min(maxStart, tabStart + direction)
  );

  renderTabs();
}

function renderTabs() {
  TABS.forEach(tab => {
    const airport = tab.dataset.airport;

    tab.hidden = !AIRPORTS
      .slice(tabStart, tabStart + 2)
      .includes(airport);

    tab.classList.toggle("active", airport === currentAirport);

    tab.setAttribute(
      "aria-pressed",
      String(airport === currentAirport)
    );
  });

  PREV.disabled = tabStart === 0;
  NEXT.disabled = tabStart >= AIRPORTS.length - 2;
}

function switchAirport(icao) {
  if (!AIRPORTS.includes(icao)) return;

  selectAirport(icao);
}

function selectAirport(icao) {
  icao = String(icao || "").trim().toUpperCase();

  if (!/^[A-Z0-9]{4}$/.test(icao)) return;

  currentAirport = icao;

  const presetIndex = AIRPORTS.indexOf(icao);

  if (presetIndex >= 0) {
    if (presetIndex < tabStart) {
      tabStart = presetIndex;
    } else if (presetIndex > tabStart + 1) {
      tabStart = presetIndex - 1;
    }
  }

  renderTabs();

  TITLE.textContent = `✈️ ${icao} METAR`;

  hideSearchResults();

  fetchAndRender();
}

/* Fetch the selected airport's METAR */

async function fetchAndRender() {
  const thisRequest = ++requestNumber;
  const airport = currentAirport;

  RAW.textContent = "Loading…";
  DEC.innerHTML = "";
  ISSUED.textContent = "";
  UPDATED.textContent = "";
  SOURCE.textContent = "";

  await new Promise(resolve => {
    setTimeout(resolve, LOADING_DELAY_MS);
  });

  if (thisRequest !== requestNumber) return;

  try {
    const url = `https://metar.vatsim.net/${airport.toLowerCase()}`;

    const resp = await fetch(url, {
      cache: "no-store"
    });

    if (!resp.ok) {
      throw new Error(`METAR request failed: HTTP ${resp.status}`);
    }

    const metarText = (await resp.text()).trim();

    if (thisRequest !== requestNumber) return;

    if (!metarText) {
      throw new Error("The METAR source returned an empty report.");
    }

    RAW.textContent = metarText;

    const isAuto = /\bAUTO\b/.test(metarText);

    SOURCE.textContent =
      `Data from metar.vatsim.net/${airport.toLowerCase()} • ` +
      `${isAuto ? "AUTO" : "MANUAL"}`;

    DEC.innerHTML = buildDecodedHtml(decodeMetar(metarText));

    const issueMatch = metarText.match(/\b(\d{6}Z)\b/);

    if (issueMatch) {
      ISSUED.innerHTML =
        `<span class="footer-label">METAR issued:</span><br>` +
        escapeHtml(formatNZTime(parseMetarTime(issueMatch[1])));
    }

    UPDATED.innerHTML =
      `<span class="footer-label">Last updated:</span><br>` +
      escapeHtml(formatNZTime(new Date()));
  } catch (error) {
    if (thisRequest !== requestNumber) return;

    RAW.textContent = "Failed to fetch METAR.";

    DEC.textContent =
      error instanceof TypeError
        ? "The request could not reach the METAR server. Check your internet connection. If this persists, the server may be blocking browser requests."
        : error.message || String(error);

    console.error("METAR fetch error:", error);
  }
}

/* Worldwide airport database */

async function loadAirportDatabase() {
  if (airportDatabase) return airportDatabase;

  if (airportDatabasePromise) return airportDatabasePromise;

  airportDatabasePromise = (async () => {
    /* Use a recent local cache if one exists. */

    try {
      const cached = localStorage.getItem(AIRPORT_CACHE_KEY);

      if (cached) {
        const saved = JSON.parse(cached);

        if (
          saved &&
          Array.isArray(saved.airports) &&
          Date.now() - saved.savedAt < AIRPORT_CACHE_MAX_AGE
        ) {
          airportDatabase = saved.airports;
          return airportDatabase;
        }
      }
    } catch (error) {
      /* Continue to the network if local storage is unavailable. */
    }

    const response = await fetch(AIRPORTS_CSV, {
      cache: "force-cache"
    });

    if (!response.ok) {
      throw new Error(
        `Airport database request failed: HTTP ${response.status}`
      );
    }

    const csvText = await response.text();
    const lines = csvText.split(/\r?\n/);

    if (lines.length < 2) {
      throw new Error("The airport database was empty.");
    }

    const headers = parseCSVLine(lines[0]).map(header =>
      header.trim().toLowerCase()
    );

    const column = name => headers.indexOf(name);

    const identColumn = column("ident");
    const typeColumn = column("type");
    const nameColumn = column("name");
    const municipalityColumn = column("municipality");
    const countryColumn = column("iso_country");
    const iataColumn = column("iata_code");
    const closedColumn = column("closed");

    if (identColumn < 0 || nameColumn < 0) {
      throw new Error("The airport database format was not recognised.");
    }

    const airports = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];

      if (!line.trim()) continue;

      const fields = parseCSVLine(line);

      const ident = (fields[identColumn] || "").trim().toUpperCase();
      const name = (fields[nameColumn] || "").trim();
      const type = (fields[typeColumn] || "").trim().toLowerCase();
      const closed = (fields[closedColumn] || "").trim().toLowerCase();

      /*
       * METAR requests use ICAO-style four-character identifiers.
       * Exclude closed locations and non-airport facilities.
       */

      if (!/^[A-Z0-9]{4}$/.test(ident)) continue;
      if (!name || closed === "yes" || type === "closed") continue;

      if (
        type !== "large_airport" &&
        type !== "medium_airport" &&
        type !== "small_airport"
      ) {
        continue;
      }

      airports.push({
        ident,
        name,
        municipality: (
          fields[municipalityColumn] || ""
        ).trim(),
        country: (
          fields[countryColumn] || ""
        ).trim(),
        iata: (
          fields[iataColumn] || ""
        ).trim().toUpperCase()
      });
    }

    if (!airports.length) {
      throw new Error("No airports were found in the database.");
    }

    airportDatabase = airports;

    try {
      localStorage.setItem(
        AIRPORT_CACHE_KEY,
        JSON.stringify({
          savedAt: Date.now(),
          airports
        })
      );
    } catch (error) {
      /* Search still works if caching is unavailable. */
    }

    return airportDatabase;
  })();

  try {
    return await airportDatabasePromise;
  } finally {
    airportDatabasePromise = null;
  }
}

/*
 * Parse a CSV row while respecting quoted fields and commas
 * inside airport names.
 */

function parseCSVLine(line) {
  const fields = [];
  let field = "";
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (insideQuotes && line[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === "," && !insideQuotes) {
      fields.push(field);
      field = "";
    } else {
      field += char;
    }
  }

  fields.push(field);

  return fields;
}

/* Search and rank airport matches */

async function searchAirports(rawQuery) {
  const query = String(rawQuery || "").trim().toLowerCase();
  const thisSearch = ++searchNumber;

  if (query.length < 2) {
    hideSearchResults();
    return;
  }

  showSearchMessage("Searching airports…");

  try {
    const airports = await loadAirportDatabase();

    if (thisSearch !== searchNumber) return;

    const terms = query.split(/\s+/).filter(Boolean);

    const matches = airports
      .map(airport => {
        const ident = airport.ident.toLowerCase();
        const iata = airport.iata.toLowerCase();
        const name = airport.name.toLowerCase();
        const city = airport.municipality.toLowerCase();
        const country = airport.country.toLowerCase();

        const searchable =
          `${ident} ${iata} ${name} ${city} ${country}`;

        if (!terms.every(term => searchable.includes(term))) {
          return null;
        }

        let score = 0;

        if (ident === query) score += 1000;
        if (iata && iata === query) score += 950;
        if (ident.startsWith(query)) score += 500;
        if (iata && iata.startsWith(query)) score += 450;
        if (name.startsWith(query)) score += 250;
        if (city.startsWith(query)) score += 200;
        if (name.includes(query)) score += 100;
        if (city.includes(query)) score += 80;

        return {
          airport,
          score
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        return b.score - a.score ||
          a.airport.ident.localeCompare(b.airport.ident);
      })
      .slice(0, 8)
      .map(result => result.airport);

    if (thisSearch !== searchNumber) return;

    renderSearchResults(matches);
  } catch (error) {
    if (thisSearch !== searchNumber) return;

    console.error("Airport search error:", error);

    showSearchMessage(
      "Airport search could not load. Check your connection and try again."
    );
  }
}

function renderSearchResults(airports) {
  SEARCH_RESULTS.replaceChildren();

  if (!airports.length) {
    showSearchMessage("No matching airports found.");
    return;
  }

  airports.forEach(airport => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "search-result";
    button.setAttribute("role", "option");

    const code = document.createElement("span");
    code.className = "search-result-code";
    code.textContent = airport.iata
      ? `${airport.ident} · ${airport.iata}`
      : airport.ident;

    const name = document.createElement("span");
    name.className = "search-result-name";
    name.textContent = airport.name;

    const location = document.createElement("span");
    location.className = "search-result-location";

    const locationParts = [
      airport.municipality,
      airport.country
    ].filter(Boolean);

    location.textContent = locationParts.join(", ");

    button.append(code, name, location);

    button.addEventListener("click", () => {
      SEARCH.value = `${airport.ident} — ${airport.name}`;
      selectAirport(airport.ident);
    });

    SEARCH_RESULTS.appendChild(button);
  });

  SEARCH_RESULTS.hidden = false;
  SEARCH.setAttribute("aria-expanded", "true");
}

function showSearchMessage(message) {
  SEARCH_RESULTS.replaceChildren();

  const item = document.createElement("div");
  item.className = "search-message";
  item.textContent = message;

  SEARCH_RESULTS.appendChild(item);
  SEARCH_RESULTS.hidden = false;
  SEARCH.setAttribute("aria-expanded", "true");
}

function hideSearchResults() {
  SEARCH_RESULTS.hidden = true;
  SEARCH_RESULTS.replaceChildren();
  SEARCH.setAttribute("aria-expanded", "false");
}

/* New Zealand local time */

function formatNZTime(date) {
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short"
  }).format(date);
}

/* Decoded summary */

function buildDecodedHtml(obj) {
  let html = "";

  if (obj.wind) {
    html += `<div><b class="label">Wind:</b> ${obj.wind}</div>`;
  }

  if (obj.visibility) {
    html += `<div><b class="label">Visibility:</b> ${obj.visibility}</div>`;
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

  if (obj.qnhValue !== undefined) {
    html +=
      `<div><b class="label">QNH:</b> ` +
      `<span class="${obj.qnhClass}">` +
      `${obj.qnhValue} hPa (${obj.qnhLabel})</span></div>`;
  }

  if (obj.kaukau) {
    html +=
      `<div><b class="label">Mt Kaukau Wind:</b> ${obj.kaukau}</div>`;
  }

  if (obj.sugarloaf) {
    html +=
      `<div><b class="label">Sugarloaf Wind:</b> ${obj.sugarloaf}</div>`;
  }

  return html || "<div>No detailed data decoded.</div>";
}

/* METAR decoder */

function decodeMetar(metar) {
  const out = {};

  if (!metar) return out;

  const tokens = metar.trim().split(/\s+/);
  const rmkIndex = tokens.indexOf("RMK");

  const mainTokens = rmkIndex >= 0
    ? tokens.slice(0, rmkIndex)
    : tokens;

  const remarks = rmkIndex >= 0
    ? tokens.slice(rmkIndex + 1)
    : [];

  /* Wind */

  const windToken = mainTokens.find(token =>
    /^(?:\d{3}|VRB)\d{2,3}(?:G\d{2,3})?KT$/.test(token)
  );

  if (windToken) {
    out.wind = formatWind(windToken);
  }

  /* Visibility and visibility-related weather */

  const visibilityToken = mainTokens.find(token =>
    /^\d{4}$/.test(token)
  );

  const hasHaze = mainTokens.includes("HZ");
  const hasMist = mainTokens.includes("BR");
  const hasFog = mainTokens.includes("FG");
  const hasSmoke = mainTokens.includes("FU");

  if (mainTokens.includes("CAVOK")) {
    out.visibility = "10 km or more";
  } else if (visibilityToken) {
    const metres = Number(visibilityToken);
    const conditions = [];

    if (hasHaze) conditions.push("Haze");
    if (hasMist) conditions.push("Mist");
    if (hasFog) conditions.push("Fog");
    if (hasSmoke) conditions.push("Smoke");

    const extra = conditions.length
      ? ` • ${conditions.join(", ")}`
      : "";

    out.visibility = metres === 9999
      ? `9999 metres (10 km +)${extra}`
      : `${metres} metres (${(metres / 1000).toFixed(1)} km)${extra}`;
  }

  /* Actual weather groups */

  const weatherGroups = mainTokens.filter(isWeatherToken);
  const weatherLines = [];

  const hasTS = weatherGroups.some(token => /TS/.test(token));
  const rainToken = weatherGroups.find(token => /RA/.test(token));
  const drizzleToken = weatherGroups.find(token => /DZ/.test(token));

  if (hasTS) {
    weatherLines.push(
      rainToken
        ? "• Thunderstorm with rain"
        : "• Thunderstorm"
    );
  } else {
    if (rainToken) {
      weatherLines.push(
        rainToken.startsWith("-") ? "• Light rain" :
        rainToken.startsWith("+") ? "• Heavy rain" :
        "• Rain"
      );
    }

    if (drizzleToken) {
      weatherLines.push(
        drizzleToken.startsWith("-") ? "• Light drizzle" :
        drizzleToken.startsWith("+") ? "• Heavy drizzle" :
        "• Drizzle"
      );
    }
  }

  if (weatherGroups.some(token => /SN/.test(token))) {
    weatherLines.push("• Snow");
  }

  if (weatherGroups.some(token => /GR|GS/.test(token))) {
    weatherLines.push("• Hail or small hail");
  }

  if (weatherGroups.some(token => /FZ/.test(token))) {
    weatherLines.push("• Freezing precipitation");
  }

  if (weatherGroups.some(token => /VA/.test(token))) {
    weatherLines.push("• Volcanic ash");
  }

  if (weatherGroups.some(token => /DU|SA/.test(token))) {
    weatherLines.push("• Dust or sand");
  }

  if (hasSmoke && !out.visibility) {
    weatherLines.push("• Smoke");
  }

  if (/\bRERA\b/.test(metar)) {
    weatherLines.push("• Recent rain");
  }

  if (/\bRETS\b/.test(metar)) {
    weatherLines.push("• Recent thunderstorm");
  }

  if (weatherLines.length) {
    out.weatherHtml = weatherLines.join("<br>");
  }

  /* Clouds */

  const cloudMap = {
    FEW: "Few",
    SCT: "Scattered",
    BKN: "Broken",
    OVC: "Overcast"
  };

  const clouds = [
    ...mainTokens.join(" ").matchAll(
      /\b(FEW|SCT|BKN|OVC)(\d{3})(CB|TCU)?\b/g
    )
  ];

  if (clouds.length) {
    out.cloudsHtml = clouds
      .map(match => {
        const amount = cloudMap[match[1]];
        const height = Number(match[2]) * 100;
        const type = match[3] === "CB"
          ? " (Cumulonimbus)"
          : match[3] === "TCU"
            ? " (Towering cumulus)"
            : "";

        return `• ${amount} at ${height} ft${type}`;
      })
      .join("<br>");
  } else if (
    mainTokens.includes("NCD") ||
    mainTokens.includes("NSC")
  ) {
    out.cloudsHtml = "• No significant clouds detected";
  } else if (
    mainTokens.includes("SKC") ||
    mainTokens.includes("CLR")
  ) {
    out.cloudsHtml = "• Clear skies";
  }

  const verticalVisibility = mainTokens.find(token =>
    /^VV\d{3}$/.test(token)
  );

  if (verticalVisibility) {
    const height = Number(verticalVisibility.slice(2)) * 100;
    const verticalText = `• Vertical visibility ${height} ft`;

    out.cloudsHtml = out.cloudsHtml
      ? `${out.cloudsHtml}<br>${verticalText}`
      : verticalText;
  }

  /* Temperature and dew point */

  const tempToken = mainTokens.find(token =>
    /^(?:M?\d{2})\/(?:M?\d{2})$/.test(token)
  );

  if (tempToken) {
    const [temperature, dewPoint] = tempToken.split("/");

    out.temperature =
      `${parseTemp(temperature)}°C, ` +
      `Dew Point: ${parseTemp(dewPoint)}°C`;
  }

  /* QNH */

  const qnhMatch = metar.match(/(?:^|\s)Q(\d{4})(?=\s|$)/);

  if (qnhMatch) {
    out.qnhValue = Number(qnhMatch[1]);

    const pressure = out.qnhValue;

    if (pressure < 980) {
      [out.qnhLabel, out.qnhClass] = [
        "Very Low",
        "qnh-very-low"
      ];
    } else if (pressure < 990) {
      [out.qnhLabel, out.qnhClass] = [
        "Low",
        "qnh-low"
      ];
    } else if (pressure <= 1020) {
      [out.qnhLabel, out.qnhClass] = [
        "Mild",
        "qnh-mild"
      ];
    } else if (pressure <= 1030) {
      [out.qnhLabel, out.qnhClass] = [
        "High",
        "qnh-high"
      ];
    } else {
      [out.qnhLabel, out.qnhClass] = [
        "Very High",
        "qnh-very-high"
      ];
    }
  }

  /* Mt Kaukau wind in remarks */

  const kaukauIndex = remarks.indexOf("KAUKAU");

  if (kaukauIndex >= 0 && remarks[kaukauIndex + 1]) {
    const token = remarks[kaukauIndex + 1];

    if (/^\d{3}\d{2,3}(?:G\d{2,3})?KT$/.test(token)) {
      out.kaukau = formatWind(token);
    }
  }

  /* Sugarloaf wind in remarks */

  const sugarloafIndex = remarks.findIndex(token =>
    /^SUGARLOAF$/i.test(token)
  );

  if (
    sugarloafIndex >= 0 &&
    remarks[sugarloafIndex + 1]
  ) {
    const token = remarks[sugarloafIndex + 1];

    if (/^\d{3}\d{2,3}(?:G\d{2,3})?KT$/.test(token)) {
      out.sugarloaf = formatWind(token);
    }
  }

  return out;
}

/* Recognise complete METAR weather groups */

function isWeatherToken(token) {
  return /^(?:\+|-)?(?:VC)?(?:(?:MI|PR|BC|DR|BL|SH|TS|FZ)?(?:DZ|RA|SN|SG|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)+|TS)$/.test(token);
}

/* Wind direction, speed, gusts, and colours */

function formatWind(token) {
  const match = token.match(
    /^(VRB|\d{3})(\d{2,3})(?:G(\d{2,3}))?KT$/
  );

  if (!match) return "";

  const direction = match[1] === "VRB"
    ? null
    : Number(match[1]);

  const speed = Number(match[2]);
  const gust = match[3] ? Number(match[3]) : null;

  const speedKmh = Math.round(speed * 1.852);
  const gustKmh = gust === null
    ? null
    : Math.round(gust * 1.852);

  const classification = classifyWind(
    gust === null ? speed : gust
  );

  const directionText = direction === null
    ? "Variable direction"
    : `${direction}° (${degToCompass(direction)})`;

  return (
    `<span class="${classification}">` +
    `${directionText} at ${speed} knots (${speedKmh} km/h)` +
    `${gust === null
      ? ""
      : ` gusting ${gust} (${gustKmh} km/h)`}` +
    `</span>`
  );
}

function classifyWind(speed) {
  if (speed >= 55) return "severe";
  if (speed >= 40) return "strong";
  if (speed >= 25) return "breezy";
  return "";
}

function parseTemp(value) {
  return value.startsWith("M")
    ? -parseInt(value.slice(1), 10)
    : Number(value);
}

function degToCompass(degrees) {
  return [
    "N",
    "NE",
    "E",
    "SE",
    "S",
    "SW",
    "W",
    "NW"
  ][Math.round(degrees / 45) % 8];
}

/* Convert a METAR DDHHMMZ group to a Date */

function parseMetarTime(group) {
  const day = Number(group.slice(0, 2));
  const hour = Number(group.slice(2, 4));
  const minute = Number(group.slice(4, 6));

  const now = new Date();

  let year = now.getUTCFullYear();
  let month = now.getUTCMonth();

  if (day > now.getUTCDate() + 1) {
    month--;
  } else if (day < now.getUTCDate() - 27) {
    month++;
  }

  return new Date(Date.UTC(year, month, day, hour, minute));
}

/* Escape plain text before placing it inside HTML */

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => {
    const replacements = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };

    return replacements[character];
  });
}
