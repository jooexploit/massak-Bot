const axios = require("axios");

const websiteConfig = require("../config/website.config");

const CACHE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15000;
const WORDPRESS_CATEGORY_ENDPOINT =
  "/wp-json/wp/v2/categories?per_page=100&_fields=id,name,parent";

const MASAAK_EXCLUDED_MAIN_CATEGORIES = new Set([
  "default",
  "Uncategorized",
  "اعلانات مسعاك المميزة",
  "شركاء مسعاك",
  "للإيجار",
  "للبيع",
  "طلب",
]);
const HASAK_EXCLUDED_MAIN_CATEGORIES = new Set(["default", "Uncategorized"]);

const GENERIC_CATEGORY_ALIASES = {
  ارض: "أرض",
  اراضي: "أرض",
  أراضي: "أرض",
  شقه: "شقة",
  شقق: "شقة",
  عماره: "عمارة",
  عمارات: "عمارة",
  مزرعه: "مزرعة",
  مزارع: "مزرعة",
  استراحه: "استراحة",
  استراحات: "استراحة",
  شاليه: "شالية",
  شاليهات: "شالية",
  فيله: "فيلا",
  فله: "فيلا",
  فلة: "فيلا",
  فلل: "فيلا",
  دوبلكس: "دبلكس",
  منازل: "بيت",
  منزل: "بيت",
  بيوت: "بيت",
  مطلوب: "طلبات",
  طلب: "طلبات",
  "كوفيهات او مطاعم": "كوفيهات أو مطاعم",
  "كوفيهات ومطاعم": "كوفيهات أو مطاعم",
  "منتجعات واستراحات": "منتجعات وإستراحات",
  "منتجعات و استراحات": "منتجعات وإستراحات",
};

let taxonomyCache = {
  loadedAt: 0,
  taxonomy: null,
};

function normalizeWhitespace(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function convertArabicDigitsToEnglish(text) {
  if (text === null || text === undefined) return "";

  const map = {
    "٠": "0",
    "١": "1",
    "٢": "2",
    "٣": "3",
    "٤": "4",
    "٥": "5",
    "٦": "6",
    "٧": "7",
    "٨": "8",
    "٩": "9",
  };

  return String(text).replace(/[٠-٩]/g, (char) => map[char] || char);
}

function normalizeArabicText(text) {
  return normalizeWhitespace(
    convertArabicDigitsToEnglish(text)
      .replace(/[،]+/g, "،")
      .replace(/[!]{2,}/g, "!")
      .replace(/[؟]{2,}/g, "؟"),
  );
}

function toLookupKey(text) {
  return normalizeArabicText(text)
    .replace(/[أإآ]/g, "ا")
    .replace(/[ؤ]/g, "و")
    .replace(/[ئ]/g, "ي")
    .replace(/[ى]/g, "ي")
    .replace(/[ة]/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

function getExcludedMainCategories(websiteName) {
  return websiteName === "masaak"
    ? MASAAK_EXCLUDED_MAIN_CATEGORIES
    : HASAK_EXCLUDED_MAIN_CATEGORIES;
}

function uniqueByName(entries = []) {
  const seen = new Set();

  return entries.filter((entry) => {
    const key = toLookupKey(entry?.name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getConfigMainCategorySpecs(websiteName) {
  const excluded = getExcludedMainCategories(websiteName);
  const categories = websiteConfig?.[websiteName]?.categories || {};

  return uniqueByName(
    Object.entries(categories)
      .map(([name, id]) => ({
        name: normalizeArabicText(name),
        id: Number(id) || id || "",
      }))
      .filter(
        ({ name }) => name && !excluded.has(name) && name !== "default",
      ),
  );
}

function getConfigSubcategorySpecs(websiteName) {
  const subcategories = websiteConfig?.[websiteName]?.subcategories || {};
  const result = {};

  Object.entries(subcategories).forEach(([parentName, children]) => {
    const normalizedParent = normalizeArabicText(parentName);
    if (!normalizedParent) return;

    result[normalizedParent] = uniqueByName(
      Object.entries(children || {})
        .map(([name, id]) => ({
          name: normalizeArabicText(name),
          id: Number(id) || id || "",
        }))
        .filter(({ name }) => Boolean(name)),
    );
  });

  return result;
}

function indexTermsByLookupKey(terms = []) {
  const index = new Map();

  terms.forEach((term) => {
    const name = normalizeArabicText(term?.name);
    const key = toLookupKey(name);
    if (!key) return;

    if (!index.has(key)) {
      index.set(key, []);
    }

    index.get(key).push({
      id: Number(term.id) || term.id || "",
      name,
      parent: Number(term.parent) || 0,
    });
  });

  return index;
}

function pickPreferredTerm(name, configuredId, liveIndex) {
  const matches = liveIndex.get(toLookupKey(name)) || [];
  if (matches.length === 0) return null;

  return (
    matches.find((term) => Number(term.id) === Number(configuredId)) ||
    matches[0]
  );
}

function buildWebsiteTaxonomy(websiteName, liveTerms = []) {
  const mainCategorySpecs = getConfigMainCategorySpecs(websiteName);
  const subcategorySpecsByParent = getConfigSubcategorySpecs(websiteName);
  const liveIndex = indexTermsByLookupKey(liveTerms);

  const mainCategories = uniqueByName(
    mainCategorySpecs.map((spec) => {
      const liveTerm = pickPreferredTerm(spec.name, spec.id, liveIndex);

      return {
        name: liveTerm?.name || spec.name,
        id: liveTerm?.id || spec.id || "",
      };
    }),
  );

  const subcategoriesByParent = {};
  Object.entries(subcategorySpecsByParent).forEach(([parentName, specs]) => {
    subcategoriesByParent[parentName] = uniqueByName(
      specs.map((spec) => {
        const liveTerm = pickPreferredTerm(spec.name, spec.id, liveIndex);

        return {
          name: liveTerm?.name || spec.name,
          id: liveTerm?.id || spec.id || "",
        };
      }),
    );
  });

  const mainCategoryNames = mainCategories.map((entry) => entry.name);
  const mainCategoryIdByName = {};
  const subcategoryNamesByParent = {};
  const subcategoryIdByParent = {};

  mainCategories.forEach((entry) => {
    mainCategoryIdByName[entry.name] = entry.id || "";
  });

  Object.entries(subcategoriesByParent).forEach(([parentName, entries]) => {
    subcategoryNamesByParent[parentName] = entries.map((entry) => entry.name);
    subcategoryIdByParent[parentName] = {};

    entries.forEach((entry) => {
      subcategoryIdByParent[parentName][entry.name] = entry.id || "";
    });
  });

  return {
    mainCategories,
    mainCategoryNames,
    mainCategoryIdByName,
    subcategoriesByParent,
    subcategoryNamesByParent,
    subcategoryIdByParent,
  };
}

function buildTaxonomyFromTerms(termsByWebsite = {}) {
  const masaak = buildWebsiteTaxonomy("masaak", termsByWebsite.masaak || []);
  const hasak = buildWebsiteTaxonomy("hasak", termsByWebsite.hasak || []);

  return {
    loadedAt: Date.now(),
    masaak,
    hasak,
    termIdsByWebsiteAndName: {
      masaak: { ...masaak.mainCategoryIdByName },
      hasak: { ...hasak.mainCategoryIdByName },
    },
  };
}

function buildConfigFallbackTaxonomy() {
  return buildTaxonomyFromTerms({});
}

async function fetchWordPressTerms(websiteName, httpGet = axios.get) {
  const website = websiteConfig?.[websiteName];
  if (!website?.url) {
    throw new Error(`Missing URL for website ${websiteName}`);
  }

  const response = await httpGet(
    `${website.url.replace(/\/$/, "")}${WORDPRESS_CATEGORY_ENDPOINT}`,
    {
      timeout: REQUEST_TIMEOUT_MS,
      headers: { Accept: "application/json" },
    },
  );

  return Array.isArray(response?.data) ? response.data : [];
}

function getCurrentTaxonomy() {
  if (!taxonomyCache.taxonomy) {
    taxonomyCache.taxonomy = buildConfigFallbackTaxonomy();
  }

  return taxonomyCache.taxonomy;
}

function getTrustedTaxonomySync() {
  return getCurrentTaxonomy();
}

async function getTrustedTaxonomy(options = {}) {
  const { forceRefresh = false, httpGet = axios.get } = options;
  const cached = getCurrentTaxonomy();

  if (!forceRefresh && Date.now() - taxonomyCache.loadedAt < CACHE_TTL_MS) {
    return cached;
  }

  const liveTermsByWebsite = {};

  for (const websiteName of ["masaak", "hasak"]) {
    try {
      liveTermsByWebsite[websiteName] = await fetchWordPressTerms(
        websiteName,
        httpGet,
      );
    } catch (error) {
      console.error(
        `⚠️ Failed to refresh ${websiteName} WordPress categories:`,
        error?.message || error,
      );
      liveTermsByWebsite[websiteName] = [];
    }
  }

  taxonomyCache = {
    loadedAt: Date.now(),
    taxonomy: buildTaxonomyFromTerms(liveTermsByWebsite),
  };

  return taxonomyCache.taxonomy;
}

function findCanonicalName(input, allowedNames = []) {
  const normalizedInput = normalizeArabicText(input);
  if (!normalizedInput) return "";

  const allowedByKey = new Map(
    allowedNames.map((name) => [toLookupKey(name), name]),
  );
  const inputKey = toLookupKey(normalizedInput);

  if (allowedByKey.has(inputKey)) {
    return allowedByKey.get(inputKey) || "";
  }

  const aliased = GENERIC_CATEGORY_ALIASES[normalizedInput];
  if (aliased && allowedNames.includes(aliased)) {
    return aliased;
  }

  const partialMatches = allowedNames.filter((name) => {
    const nameKey = toLookupKey(name);
    return inputKey.includes(nameKey) || nameKey.includes(inputKey);
  });

  return partialMatches.length === 1 ? partialMatches[0] : "";
}

function resolveMainCategoryFromTaxonomy(taxonomy, input, websiteHint = null) {
  if (!input) return "";

  const websites =
    websiteHint && ["masaak", "hasak"].includes(websiteHint)
      ? [websiteHint]
      : ["masaak", "hasak"];

  const matches = websites
    .map((websiteName) =>
      findCanonicalName(input, taxonomy?.[websiteName]?.mainCategoryNames || []),
    )
    .filter(Boolean);

  return matches.length === 1 ? matches[0] : matches[0] || "";
}

function resolveSubcategoryFromTaxonomy(
  taxonomy,
  parentCategory,
  input,
  websiteHint = "masaak",
) {
  const parentName = resolveMainCategoryFromTaxonomy(
    taxonomy,
    parentCategory,
    websiteHint,
  );
  if (!parentName || !input) return "";

  const allowedNames =
    taxonomy?.[websiteHint]?.subcategoryNamesByParent?.[parentName] || [];

  return findCanonicalName(input, allowedNames);
}

function resolveCategoryIdFromTaxonomy(taxonomy, websiteName, mainCategory) {
  const canonicalName = resolveMainCategoryFromTaxonomy(
    taxonomy,
    mainCategory,
    websiteName,
  );
  if (!canonicalName) return "";

  return taxonomy?.[websiteName]?.mainCategoryIdByName?.[canonicalName] || "";
}

function resolveMainCategorySync(input, websiteHint = null) {
  return resolveMainCategoryFromTaxonomy(getCurrentTaxonomy(), input, websiteHint);
}

function resolveSubcategorySync(parentCategory, input, websiteHint = "masaak") {
  return resolveSubcategoryFromTaxonomy(
    getCurrentTaxonomy(),
    parentCategory,
    input,
    websiteHint,
  );
}

function resolveCategoryIdSync(websiteName, mainCategory) {
  return resolveCategoryIdFromTaxonomy(
    getCurrentTaxonomy(),
    websiteName,
    mainCategory,
  );
}

function clearCache() {
  taxonomyCache = {
    loadedAt: 0,
    taxonomy: buildConfigFallbackTaxonomy(),
  };
}

module.exports = {
  getTrustedTaxonomy,
  getTrustedTaxonomySync,
  resolveMainCategorySync,
  resolveSubcategorySync,
  resolveCategoryIdSync,
  __private: {
    CACHE_TTL_MS,
    buildConfigFallbackTaxonomy,
    buildTaxonomyFromTerms,
    clearCache,
    fetchWordPressTerms,
    findCanonicalName,
    normalizeArabicText,
    toLookupKey,
  },
};
