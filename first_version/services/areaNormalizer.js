/**
 * Area Name Normalizer Service
 * Handles common spelling variations and typos in Arabic area/neighborhood names
 * Also handles city vs neighborhood distinction
 */

const {
  LOCATION_HIERARCHY,
  AL_AHSA_GOVERNORATE: LOCATION_GOVERNORATE,
} = require("../config/locationHierarchy");

const seenAreaCorrectionLogs = new Set();

function normalizeAliasKey(value = "") {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .toLowerCase();
}

function logAreaCorrection(reason, fromValue, toValue) {
  const from = String(fromValue || "");
  const to = String(toValue || "");
  const key = `${reason}|${from}|${to}`;
  if (seenAreaCorrectionLogs.has(key)) return;
  seenAreaCorrectionLogs.add(key);
  console.log(`📍 Area name corrected (${reason}): "${from}" → "${to}"`);
}

function buildCityNeighborhoodMap() {
  const governorateData = LOCATION_HIERARCHY[LOCATION_GOVERNORATE] || {};
  const cityEntries = Object.entries(governorateData.cities || {});

  return Object.fromEntries(
    cityEntries.map(([city, config]) => {
      const areas = Array.isArray(config?.areas)
        ? config.areas
            .filter((value) => typeof value === "string")
            .map((value) => value.trim())
            .filter(Boolean)
        : [];

      return [city, [...new Set(areas)]];
    }),
  );
}

function buildCityAliasMap(cityNeighborhoods) {
  const aliases = {};
  const governorateData = LOCATION_HIERARCHY[LOCATION_GOVERNORATE] || {};

  const registerAlias = (alias, canonical) => {
    const key = normalizeAliasKey(alias);
    if (!key || !canonical) return;
    aliases[key] = canonical;
  };

  registerAlias(LOCATION_GOVERNORATE, LOCATION_GOVERNORATE);

  (governorateData.aliases || []).forEach((alias) => {
    registerAlias(alias, LOCATION_GOVERNORATE);
  });

  Object.keys(cityNeighborhoods).forEach((city) => {
    registerAlias(city, city);
    const cityConfig = governorateData.cities?.[city] || {};
    (cityConfig.aliases || []).forEach((alias) => {
      registerAlias(alias, city);
    });
  });

  return aliases;
}

/**
 * City to Neighborhoods mapping
 * Defines which neighborhoods belong to which city
 */
let CITY_NEIGHBORHOODS = {};

/**
 * List of city names for detection
 */
const AL_AHSA_GOVERNORATE = LOCATION_GOVERNORATE;
let CITIES = [];
let AL_AHSA_SUB_CITIES = new Set();
let CITY_NAME_ALIASES = {};

/**
 * Common prefixes that often start compound neighborhood/area names
 * These should prevent splitting on spaces following them.
 */
const COMPOUND_PREFIXES = [
  "حي",
  "شارع",
  "طريق",
  "مجمع",
  "خلف",
  "مقابل",
  "بجوار",
  "دوار",
  "ميدان",
  "مركز",
  "نهاية",
  "مخطط",
];

/**
 * Common area name variations and corrections
 * Maps incorrect spellings to the correct official name
 */
const BASE_AREA_CORRECTIONS = {
  // الخالدية variations
  الخالديه: "الخالدية",
  الخالديه: "الخالدية",
  الخالديةأ: "الخالدية أ",
  الخالديةب: "الخالدية ب",
  الخالديةج: "الخالدية ج",
  "الخالدية أ": "الخالدية أ",
  "الخالدية ب": "الخالدية ب",
  "الخالدية ج": "الخالدية ج",

  // المحمدية variations
  المحمديه: "المحمدية",
  المحمديةأ: "المحمدية أ",
  المحمديةب: "المحمدية ب",

  // الفيصلية variations
  الفيصليه: "الفيصلية",
  الفيصليةأ: "الفيصلية أ",
  الفيصليةب: "الفيصلية ب",

  // العزيزية variations
  العزيزيه: "العزيزية",
  العزيزيةأ: "العزيزية أ",

  // المنصورة variations
  المنصوره: "المنصورة",
  المنصورهأ: "المنصورة أ",

  // الراشدية variations
  الراشديه: "الراشدية",
  الراشديةأ: "الراشدية أ",

  // الصالحية variations
  الصالحيه: "الصالحية",
  الصالحيةأ: "الصالحية أ",

  // المبرز variations
  المبرزأ: "المبرز أ",
  المبرزب: "المبرز ب",

  // الهفوف variations
  الهفوفأ: "الهفوف أ",
  الهفوفب: "الهفوف ب",

  // العمران variations
  العمرانأ: "العمران أ",
  العمرانب: "العمران ب",

  // المثلث variations
  المثلثأ: "المثلث أ",
  المثلثب: "المثلث ب",

  // الملك فهد variations
  "الملك فهد": "الملك فهد",
  "الملك فهدأ": "الملك فهد أ",

  // Common typos with ه vs ة
  الجامعيه: "الجامعية",
  التعاونيه: "التعاونية",
  السلمانيه: "السلمانية",
  الناصريه: "الناصرية",
  الروضه: "الروضة",
  البستانيه: "البستانية",
  العليه: "العلية",
  المطيرفيه: "المطيرفية",
  اليحيه: "اليحيى",

  // Spaces and formatting
  "الخالدية  ": "الخالدية",
  " الخالدية": "الخالدية",
  "  الخالدية  ": "الخالدية",
};

let AREA_CORRECTIONS = {};
let VALID_AREAS = [];

/**
 * Known valid area names (for validation)
 */
const STATIC_VALID_AREAS = [
  "الخالدية",
  "الخالدية أ",
  "الخالدية ب",
  "الخالدية ج",
  "المحمدية",
  "المحمدية أ",
  "المحمدية ب",
  "الفيصلية",
  "الفيصلية أ",
  "الفيصلية ب",
  "العزيزية",
  "العزيزية أ",
  "المنصورة",
  "المنصورة أ",
  "الراشدية",
  "الراشدية أ",
  "الصالحية",
  "الصالحية أ",
  "المبرز",
  "المبرز أ",
  "المبرز ب",
  "الهفوف",
  "الهفوف أ",
  "الهفوف ب",
  "العمران",
  "العمران أ",
  "العمران ب",
  "المثلث",
  "المثلث أ",
  "المثلث ب",
  "الملك فهد",
  "الملك فهد أ",
  "الجامعية",
  "التعاونية",
  "السلمانية",
  "الناصرية",
  "الروضة",
  "البستانية",
  "العلية",
  "المطيرفية",
  "اليحيى",
  "المزروعية",
  "الشهابية",
  "عين موسى",
  "البطالية",
  "الطرف",
  "الجفر",
  "القارة",
  "الشعبة",
  "الحليلة",
  "الدالوة",
  "أم الساهك",
  "الكلابية",
  "المنيزلة",
  "الجشة",
  "التويثير",
  "الحفيرة",
  "المركز",
];

function addGeneratedAreaCorrections(areaCorrections, validAreas) {
  const generated = {};
  const allAreasSet = new Set(validAreas);

  const toArabicDigits = (value = "") =>
    String(value || "")
      .replace(/0/g, "٠")
      .replace(/1/g, "١")
      .replace(/2/g, "٢")
      .replace(/3/g, "٣")
      .replace(/4/g, "٤")
      .replace(/5/g, "٥")
      .replace(/6/g, "٦")
      .replace(/7/g, "٧")
      .replace(/8/g, "٨")
      .replace(/9/g, "٩");

  const toEnglishDigits = (value = "") =>
    String(value || "")
      .replace(/٠/g, "0")
      .replace(/١/g, "1")
      .replace(/٢/g, "2")
      .replace(/٣/g, "3")
      .replace(/٤/g, "4")
      .replace(/٥/g, "5")
      .replace(/٦/g, "6")
      .replace(/٧/g, "7")
      .replace(/٨/g, "8")
      .replace(/٩/g, "9");

  const add = (fromValue, toValue) => {
    const from = String(fromValue || "").trim();
    const to = String(toValue || "").trim();
    if (!from || !to || from === to) return;
    if (Object.prototype.hasOwnProperty.call(generated, from)) return;
    generated[from] = to;
  };

  validAreas.forEach((area) => {
    const canonical = String(area || "").trim();
    if (!canonical) return;

    // Normalize spacing around parentheses.
    if (canonical.includes("(") || canonical.includes(")")) {
      add(canonical.replace(/\s*\(\s*/g, " (").replace(/\s*\)\s*/g, ")"), canonical);
      add(canonical.replace(/\s*\(\s*/g, "(").replace(/\s*\)\s*/g, ")"), canonical);
      add(canonical.replace(/[()]/g, "").replace(/\s+/g, " ").trim(), canonical);
    }

    // Arabic/English digits variants for names like "ضاحية هجر ١٢".
    const arabicDigits = toArabicDigits(canonical);
    const englishDigits = toEnglishDigits(canonical);
    const hasArabicVariant = allAreasSet.has(arabicDigits);
    const hasEnglishVariant = allAreasSet.has(englishDigits);
    const preferredDigitCanonical = hasArabicVariant
      ? arabicDigits
      : hasEnglishVariant
        ? englishDigits
        : canonical;

    add(arabicDigits, preferredDigitCanonical);
    add(englishDigits, preferredDigitCanonical);
    add(canonical.replace(/[أإآ]/g, "ا"), canonical);
  });

  Object.assign(areaCorrections, generated);
}

function refreshLocationNormalizationData() {
  CITY_NEIGHBORHOODS = buildCityNeighborhoodMap();
  CITIES = Object.keys(CITY_NEIGHBORHOODS);
  AL_AHSA_SUB_CITIES = new Set(CITIES);
  CITY_NAME_ALIASES = buildCityAliasMap(CITY_NEIGHBORHOODS);

  const dynamicValidAreas = [
    AL_AHSA_GOVERNORATE,
    ...CITIES,
    ...Object.values(CITY_NEIGHBORHOODS).flat(),
  ];

  VALID_AREAS = [...new Set([...STATIC_VALID_AREAS, ...dynamicValidAreas])];
  AREA_CORRECTIONS = { ...BASE_AREA_CORRECTIONS };
  addGeneratedAreaCorrections(AREA_CORRECTIONS, VALID_AREAS);

  return {
    cities: CITIES.length,
    areas: VALID_AREAS.length,
  };
}

refreshLocationNormalizationData();

/**
 * Normalize area name by correcting common typos and variations
 * @param {string} areaName - The area name to normalize
 * @returns {string} The corrected area name
 */
function normalizeAreaName(areaName) {
  if (!areaName) return "";

  // Trim whitespace
  let normalized = areaName.trim();

  // Check if it's a known variation
  if (AREA_CORRECTIONS[normalized]) {
    const corrected = AREA_CORRECTIONS[normalized];
    if (corrected !== normalized) {
      logAreaCorrection("exact", areaName, corrected);
    }
    return corrected;
  }

  // Try case-insensitive match
  const lowerInput = normalized.toLowerCase();
  for (const [wrong, correct] of Object.entries(AREA_CORRECTIONS)) {
    if (wrong.toLowerCase() === lowerInput) {
      if (correct !== normalized) {
        logAreaCorrection("case", areaName, correct);
      }
      return correct;
    }
  }

  // Check if it ends with ه and try replacing with ة
  if (normalized.endsWith("ه")) {
    const withTaMarbuta = normalized.slice(0, -1) + "ة";
    if (VALID_AREAS.includes(withTaMarbuta)) {
      logAreaCorrection("ه→ة", areaName, withTaMarbuta);
      return withTaMarbuta;
    }
  }

  // Check if it ends with ة and try replacing with ه (reverse)
  if (normalized.endsWith("ة")) {
    const withHa = normalized.slice(0, -1) + "ه";
    if (AREA_CORRECTIONS[withHa]) {
      const corrected = AREA_CORRECTIONS[withHa];
      if (corrected !== normalized) {
        logAreaCorrection("ة→ه", areaName, corrected);
      }
      return corrected;
    }
  }

  // No correction found - return as is
  return normalized;
}

/**
 * Advanced extraction of neighborhoods from a raw string.
 * Handles compound names and smarter splitting.
 * @param {string} text - The input text containing neighborhood names.
 * @returns {Array<string>} List of extracted and normalized neighborhoods.
 */
function extractNeighborhoods(text) {
  if (!text) return [];

  // 1. Initial cleanup
  let cleanText = text
    .replace(/\*+/g, " ")
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // 2. Split by major separators: comma, slash, "أو", "-"
  // We handle "و" separately because it can be part of a name (e.g., "أبو")
  // or a connector for compound names ("شارع الحيات").
  let parts = cleanText.split(/[،,\/\-]|(?:\s+أو\s+)/);

  let finalNeighborhoods = [];

  for (let part of parts) {
    part = part.trim();
    if (!part) continue;

    // 3. Smart handle "و" connector
    // "البطالية وشارع الحيات" -> ["البطالية", "شارع الحيات"]
    // "المبرز والهفوف" -> ["المبرز", "الهفوف"]
    // We split on " و" (space then "و") if it's a connector.
    let subParts = [];
    if (part.includes(" و")) {
      // Split on space followed by "و"
      // This handles both " و " and " وشارع"
      let chunks = part.split(/\s+و/);
      for (let chunk of chunks) {
        let trimmed = chunk.trim();
        if (trimmed) subParts.push(trimmed);
      }
    } else {
      subParts.push(part);
    }

    for (let subPart of subParts) {
      const normalized = normalizeAreaName(subPart);
      if (normalized && normalized.length > 2 && !/^\d+$/.test(normalized)) {
        finalNeighborhoods.push(normalized);
      }
    }
  }

  // Deduplicate
  return [...new Set(finalNeighborhoods)];
}

/**
 * Normalize multiple area names
 * @param {Array<string>} areas - Array of area names
 * @returns {Array<string>} Array of normalized area names
 */
function normalizeAreaNames(areas) {
  if (!Array.isArray(areas)) return [];
  return areas.map(normalizeAreaName).filter((area) => area.length > 0);
}

/**
 * Check if an area name is valid (exists in our database)
 * @param {string} areaName - The area name to validate
 * @returns {boolean} True if valid
 */
function isValidArea(areaName) {
  const normalized = normalizeAreaName(areaName);
  return VALID_AREAS.includes(normalized);
}

/**
 * Get suggestions for similar area names (fuzzy match)
 * @param {string} areaName - The area name to find suggestions for
 * @returns {Array<string>} Array of suggested area names
 */
function getSuggestions(areaName) {
  if (!areaName) return [];

  const normalized = normalizeAreaName(areaName);
  const suggestions = [];

  // Already valid
  if (VALID_AREAS.includes(normalized)) {
    return [normalized];
  }

  // Find areas that contain the search term
  const searchTerm = normalized.toLowerCase();
  for (const validArea of VALID_AREAS) {
    if (validArea.toLowerCase().includes(searchTerm)) {
      suggestions.push(validArea);
    }
  }

  // If no suggestions, try partial matches
  if (suggestions.length === 0) {
    const words = normalized.split(/\s+/);
    for (const word of words) {
      if (word.length < 3) continue; // Skip very short words
      for (const validArea of VALID_AREAS) {
        if (
          validArea.toLowerCase().includes(word.toLowerCase()) &&
          !suggestions.includes(validArea)
        ) {
          suggestions.push(validArea);
        }
      }
    }
  }

  return suggestions.slice(0, 5); // Return max 5 suggestions
}

/**
 * Check if an area is a city (not a neighborhood)
 * @param {string} areaName - Area name to check
 * @returns {boolean} True if it's a city
 */
function isCity(areaName) {
  if (!areaName) return false;
  const normalized = normalizeCityName(areaName).toLowerCase();
  if (!normalized) return false;

  if (AL_AHSA_SUB_CITIES.has(normalizeCityName(areaName))) {
    return true;
  }

  return CITIES.some((city) => normalizeCityName(city).toLowerCase() === normalized);
}

/**
 * Get neighborhoods for a city
 * @param {string} cityName - City name
 * @returns {Array<string>} Array of neighborhood names, or empty array if not a city
 */
function getNeighborhoodsForCity(cityName) {
  if (!cityName) return [];
  const normalized = normalizeCityName(cityName);

  for (const [city, neighborhoods] of Object.entries(CITY_NEIGHBORHOODS)) {
    if (normalizeCityName(city) === normalized) {
      return neighborhoods;
    }
  }

  return [];
}

/**
 * Normalize city aliases to one canonical display name.
 * @param {string} cityName
 * @returns {string}
 */
function normalizeCityName(cityName) {
  if (!cityName) return "";

  const normalized = normalizeAreaName(cityName).replace(/\s+/g, " ").trim();
  if (!normalized) return "";

  const aliasMatch = CITY_NAME_ALIASES[normalizeAliasKey(normalized)];
  if (aliasMatch) {
    return aliasMatch;
  }

  return normalized;
}

/**
 * Get candidate cities for an area/neighborhood.
 * @param {string} areaName
 * @returns {Array<string>}
 */
function getCitiesForArea(areaName) {
  if (!areaName) return [];

  const normalizedArea = normalizeAreaName(
    String(areaName).replace(/^حي\s+/i, "").trim(),
  );
  if (!normalizedArea) return [];

  const areaLower = normalizedArea.toLowerCase();
  const candidates = [];

  for (const [city, neighborhoods] of Object.entries(CITY_NEIGHBORHOODS)) {
    const normalizedCity = normalizeCityName(city);
    const hasMatch = neighborhoods.some((neighborhood) => {
      const normalizedNeighborhood = normalizeAreaName(
        String(neighborhood || "").trim(),
      )
        .toLowerCase()
        .trim();

      if (!normalizedNeighborhood) return false;

      const exactMatch = areaLower === normalizedNeighborhood;
      const partialMatch =
        areaLower.length >= 4 &&
        (areaLower.includes(normalizedNeighborhood) ||
          normalizedNeighborhood.includes(areaLower));

      return exactMatch || partialMatch;
    });

    if (hasMatch) {
      candidates.push(normalizedCity);
    }
  }

  return [...new Set(candidates)];
}

/**
 * Infer city from an area/neighborhood name.
 * Returns empty string if city cannot be inferred.
 * @param {string} areaName
 * @returns {string}
 */
function inferCityFromArea(areaName) {
  if (!areaName) return "";

  const normalizedArea = normalizeAreaName(
    String(areaName).replace(/^حي\s+/i, "").trim(),
  );
  if (!normalizedArea) return "";

  const cityCandidate = normalizeCityName(normalizedArea);
  if (isCity(cityCandidate)) {
    return cityCandidate;
  }

  const candidates = getCitiesForArea(normalizedArea);
  if (candidates.length === 1) {
    return candidates[0];
  }
  if (candidates.length > 1) {
    return "";
  }

  // Retry with fuzzy suggestions when there is a typo in the neighborhood name.
  const suggestions = getSuggestions(normalizedArea);
  for (const suggestion of suggestions) {
    const suggestionCandidates = getCitiesForArea(suggestion);
    if (suggestionCandidates.length === 1) {
      return suggestionCandidates[0];
    }
  }

  return "";
}

/**
 * Expand area to include neighborhoods if it's a city
 * If user specifies a city, return list of popular neighborhoods in that city
 * @param {string} areaName - Area name (could be city or neighborhood)
 * @returns {Array<string>} Array of areas to search (original + neighborhoods if city)
 */
function expandCityToNeighborhoods(areaName) {
  if (!areaName) return [];

  const normalized = normalizeAreaName(areaName);

  // Check if it's a city
  if (isCity(normalized)) {
    const neighborhoods = getNeighborhoodsForCity(normalized);
    console.log(
      `🏙️  "${normalized}" is a CITY - expanding to ${neighborhoods.length} neighborhoods`
    );
    // Return top 5 most popular neighborhoods for the city
    return neighborhoods.slice(0, 5);
  }

  // It's a neighborhood, return as-is
  console.log(`🏘️  "${normalized}" is a NEIGHBORHOOD - using as-is`);
  return [normalized];
}

/**
 * Validate and normalize search results to ensure they match the requested area
 * @param {Array} results - Search results from API
 * @param {string} requestedArea - The area name that was requested
 * @returns {Array} Filtered results that match the requested area
 */
function filterResultsByArea(results, requestedArea) {
  if (!requestedArea || !Array.isArray(results)) {
    return results;
  }

  const normalizedRequested = normalizeAreaName(requestedArea).toLowerCase();

  const filtered = results.filter((result) => {
    // Check multiple location fields
    const resultLocation = (
      result.location ||
      result.meta?.neighborhood ||
      result.meta?.location ||
      ""
    )
      .toLowerCase()
      .trim();

    const resultCity = (result.city || result.meta?.City || "")
      .toLowerCase()
      .trim();

    // Normalize the result location
    const normalizedResultLocation = normalizeAreaName(resultLocation);

    // Match if the location matches the requested area
    const locationMatches =
      normalizedResultLocation.toLowerCase() === normalizedRequested;

    // Also check if result location contains the requested area (for sub-areas)
    const containsArea = normalizedResultLocation
      .toLowerCase()
      .includes(normalizedRequested);

    // Check reverse - requested contains result (for broader searches)
    const requestedContainsResult = normalizedRequested.includes(
      normalizedResultLocation.toLowerCase()
    );

    return locationMatches || containsArea || requestedContainsResult;
  });

  if (filtered.length < results.length) {
    console.log(
      `🔍 Filtered results: ${results.length} → ${filtered.length} (matching "${requestedArea}")`
    );
  }

  return filtered;
}

module.exports = {
  normalizeAreaName,
  normalizeCityName,
  inferCityFromArea,
  getCitiesForArea,
  normalizeAreaNames,
  isValidArea,
  getSuggestions,
  filterResultsByArea,
  isCity,
  getNeighborhoodsForCity,
  expandCityToNeighborhoods,
  extractNeighborhoods, // Export new extraction logic
  refreshLocationNormalizationData,
  get VALID_AREAS() {
    return VALID_AREAS;
  },
  get AREA_CORRECTIONS() {
    return AREA_CORRECTIONS;
  },
  get CITY_NEIGHBORHOODS() {
    return CITY_NEIGHBORHOODS;
  },
  get CITIES() {
    return CITIES;
  },
};
