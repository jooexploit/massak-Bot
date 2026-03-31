const { GoogleGenerativeAI } = require("@google/generative-ai");
const OpenAI = require("openai");

const apiKeyManager = require("./apiKeyManager");
const areaNormalizer = require("./areaNormalizer");
const wordpressCategoryService = require("./wordpressCategoryService");
const websiteConfig = require("../config/website.config");
const {
  AL_AHSA_GOVERNORATE,
  DEFAULT_WP_BEFORE_CITY_OPTIONS,
  DEFAULT_WP_CITY_OPTIONS,
} = require("../config/locationHierarchy");
const dataSync = require("../utils/dataSync");

const { PROVIDERS } = apiKeyManager;

const DEFAULT_WP_TITLE = "إعلان عقاري مميز";
const REQUIRED_METADATA_FIELDS = [
  "area",
  "price",
  "fullLocation",
  "category",
  "subcategory",
];
const MASAAK_FORCE_EMPTY_SUBCATEGORY_CATEGORIES = new Set([
  "دبلكس",
  "فيلا",
  "شقة",
  "شقة دبلكسية",
]);
const MASAAK_STRICT_SUBCATEGORY_RULES = {
  بيت: ["دورين", "دور", "عربي"],
  أرض: ["تجارية", "سكنية"],
  عمارة: ["تجارية", "سكنية"],
  مزرعة: ["صك", "مشاع", "وقف", "عرق", "أرض زراعية"],
};
const MASAAK_REFERENCE_RULE_LINES_FOR_PROMPT = [
  "بيت: دورين، دور، عربي فقط.",
  "دبلكس و فيلا و شقة و شقة دبلكسية: بدون فرعي (subcategory/sub_catt/arc_subcategory تكون فارغة).",
  "أرض: تجارية أو سكنية فقط.",
  "عمارة: تجارية أو سكنية فقط.",
  "مزرعة: صك أو مشاع أو وقف أو عرق أو أرض زراعية.",
  'إذا كان النص يذكر "أرض" فقط فلا تحوّلها إلى "مزرعة" إلا عند وجود دليل زراعي واضح مثل "أرض زراعية" أو وصف صريح لمزرعة.',
];
const DEFAULT_DYNAMIC_BEFORE_CITIES = [...DEFAULT_WP_BEFORE_CITY_OPTIONS];
const DEFAULT_DYNAMIC_CITIES = [...DEFAULT_WP_CITY_OPTIONS];
const DYNAMIC_LOCATION_CACHE_TTL_MS = 30000;

let dynamicLocationHintsCache = {
  loadedAt: 0,
  beforeCities: [...DEFAULT_DYNAMIC_BEFORE_CITIES],
  cities: [...DEFAULT_DYNAMIC_CITIES],
};

const WP_META_DEFAULTS = {
  ad_type: "عرض",
  owner_name: "",
  phone_number: "",
  phone: "",
  contact: [],
  price: "",
  price_type: "",
  price_amount: "",
  from_price: "",
  to_price: "",
  price_method: "",
  payment_method: "",
  arc_space: "",
  order_space: "",
  area: "",
  parent_catt: "",
  sub_catt: "",
  arc_category: "",
  arc_subcategory: "",
  category: "",
  subcategory: "",
  category_id: "",
  before_City: AL_AHSA_GOVERNORATE,
  before_city: AL_AHSA_GOVERNORATE,
  City: "",
  city: "",
  subcity: "",
  location: "",
  full_location: "",
  neighborhood: "",
  neighborhood1: "",
  neighborhood2: "",
  neighborhood3: "",
  age: "",
  order_status: "عرض جديد",
  offer_status: "عرض جديد",
  order_owner: "",
  offer_owner: "",
  owner_type: "",
  order_type: "",
  offer_type: "",
  main_ad: "",
  google_location: null,
  youtube_link: null,
  tags: "",
  confidence_overall: 1,
  parse_notes: "",
};

class AIServiceError extends Error {
  constructor(message, type = "provider_failure", details = {}) {
    super(message);
    this.name = "AIServiceError";
    this.type = type;
    this.details = details;
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeWhitespace(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function isPlaceholderLocationValue(value = "") {
  const normalized = normalizeArabicText(value || "").toLowerCase();
  if (!normalized) return true;

  return [
    "لم يذكر",
    "لا يوجد",
    "غير محدد",
    "غير معروف",
    "n/a",
    "na",
    "none",
    "null",
    "-",
  ].includes(normalized);
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

function normalizeNeighborhoodName(value = "") {
  const normalized = normalizeArabicText(value || "");
  if (!normalized) return "";
  if (isPlaceholderLocationValue(normalized)) return normalized;

  return normalizeArabicText(normalized.replace(/^(?:(?:ال)?حي)\s+/i, ""));
}

const LOCATION_GENERIC_REJECT_VALUES = new Set(
  [
    "ال",
    "حي",
    "الحي",
    "المدينة",
    "المدينه",
    "مدينة",
    "مدينه",
    "الموقع",
    "المكان",
    "المنطقة",
    "المنطقه",
    "منطقة",
    "منطقه",
    "المحافظة",
    "المحافظه",
    "محافظة",
    "محافظه",
    "الدولة",
    "الدوله",
    "دولة",
    "دوله",
    "في",
    "ب",
    "داخل",
    "ضمن",
  ].map((value) => normalizeArabicText(value).toLowerCase()),
);

const LOCATION_HARD_NOISE_PATTERN =
  /(?:للبيع|للايجار|للإيجار|للتقبيل|السعر|بسعر|مساحة|المساحة|بمساحة|غرف|غرفة|حمام|صالة|مطبخ|مجلس|واجهة|مواقف|موقف|مدخل|مصعد|عداد|خزان|شقة|شقه|فيلا|أرض|ارض|عمارة|عماره|دبلكس|محل|مزرعة|مزرعه|بيت|جوال|هاتف|واتساب|رقم|تواصل|التواصل|مكتب|شركة|ترخيص|قروب|سناب|انستغرام|تلغرام|يوتيوب)/i;

const LOCATION_RELATIONAL_SPLIT_PATTERN =
  /\s+(?:قريب من|بالقرب من|بجوار|خلف|مقابل|جنب|عند)(?=\s|$)/i;

const LOCATION_TRAILING_CONTEXT_SPLIT_PATTERN =
  /\s+(?:للبيع|للايجار|للإيجار|للتقبيل|مطلوب|بسعر|السعر|بمساحة|مساحة|المساحة|غرف|غرفة|حمام|صالة|مطبخ|مجلس|واجهة|مواقف|موقف|مدخل|مصعد|عداد|خزان|شقة|شقه|فيلا|أرض|ارض|عمارة|عماره|دبلكس|محل|مزرعة|مزرعه|بيت|واتساب|جوال|هاتف|رقم|التواصل|للتواصل)(?=\s|$)/i;

const LOCATION_SEPARATOR_PATTERN = /[\n\r،,;؛/|]+|\s[-–—]+\s/g;

function normalizeLocationLookupKey(value = "") {
  return normalizeWhitespace(
    convertArabicDigitsToEnglish(String(value || ""))
      .replace(/[\u064B-\u065F\u0670]/g, "")
      .replace(/[أإآ]/g, "ا")
      .replace(/ؤ/g, "و")
      .replace(/ئ/g, "ي")
      .replace(/ى/g, "ي")
      .replace(/ة/g, "ه")
      .replace(/[^\dA-Za-z\u0600-\u06FF\s]/g, " "),
  ).toLowerCase();
}

function containsNormalizedLocation(haystack = "", needle = "") {
  const haystackKey = normalizeLocationLookupKey(haystack);
  const needleKey = normalizeLocationLookupKey(needle);

  if (!haystackKey || !needleKey) {
    return false;
  }

  return (
    haystackKey === needleKey ||
    ` ${haystackKey} `.includes(` ${needleKey} `)
  );
}

function normalizeLocationOptions(values = []) {
  return unique(
    (Array.isArray(values) ? values : [])
      .filter((value) => typeof value === "string")
      .map((value) => normalizeArabicText(value))
      .filter(Boolean),
  );
}

function getKnownLocationOptions(type = "generic") {
  const dynamicHints = getDynamicLocationHints(false);

  if (type === "city") {
    return normalizeLocationOptions([
      ...DEFAULT_WP_CITY_OPTIONS,
      ...(dynamicHints.cities || []),
    ]);
  }

  if (type === "governorate") {
    return normalizeLocationOptions([
      AL_AHSA_GOVERNORATE,
      ...DEFAULT_WP_BEFORE_CITY_OPTIONS,
      ...(dynamicHints.beforeCities || []),
    ]);
  }

  if (type === "neighborhood") {
    const governorateKey = normalizeLocationLookupKey(AL_AHSA_GOVERNORATE);

    return normalizeLocationOptions(
      (Array.isArray(areaNormalizer.VALID_AREAS) ? areaNormalizer.VALID_AREAS : [])
        .filter((value) => {
          const normalized = normalizeArabicText(value);
          if (!normalized) return false;
          if (normalizeLocationLookupKey(normalized) === governorateKey) {
            return false;
          }
          return !(areaNormalizer.isCity && areaNormalizer.isCity(normalized));
        }),
    );
  }

  return [];
}

function findKnownLocationMatch(text, options = []) {
  const sourceKey = normalizeLocationLookupKey(text);
  if (!sourceKey || !Array.isArray(options) || options.length === 0) {
    return "";
  }

  const normalizedOptions = normalizeLocationOptions(options).sort(
    (a, b) =>
      normalizeLocationLookupKey(b).length - normalizeLocationLookupKey(a).length,
  );
  const paddedSourceKey = ` ${sourceKey} `;

  for (const option of normalizedOptions) {
    const optionKey = normalizeLocationLookupKey(option);
    if (!optionKey) continue;

    if (sourceKey === optionKey || paddedSourceKey.includes(` ${optionKey} `)) {
      return option;
    }
  }

  return "";
}

function stripLocationFieldLabel(value = "", type = "generic") {
  let cleaned = normalizeArabicText(value || "");
  if (!cleaned) return "";

  cleaned = cleaned.replace(
    /^(?:الموقع الكامل|العنوان|location|address)\s*[:：-]?\s*/i,
    "",
  );

  if (type === "neighborhood") {
    cleaned = cleaned.replace(
      /^(?:الحي|حي|المنطقة|المنطقه|منطقة|منطقه|الموقع|المكان|district|neighborhood)\s*[:：-]?\s*/i,
      "",
    );
  } else if (type === "city") {
    cleaned = cleaned.replace(
      /^(?:المدينة|المدينه|مدينة|مدينه|city)\s*[:：-]?\s*/i,
      "",
    );
  } else if (type === "governorate") {
    cleaned = cleaned.replace(
      /^(?:المحافظة|المحافظه|محافظة|محافظه|المنطقة|المنطقه|منطقة|منطقه|الدولة|الدوله|دولة|دوله|country|state|governorate)\s*[:：-]?\s*/i,
      "",
    );
  }

  cleaned = cleaned.replace(/^(?:في|ب|داخل|ضمن)\s+/i, "");

  return normalizeArabicText(cleaned);
}

function trimLocationCandidateByType(value = "", type = "generic") {
  let cleaned = normalizeArabicText(value || "")
    .replace(/[()[\]{}]/g, " ")
    .replace(/^[,،;؛:：\-–—/|'"`]+/, "")
    .replace(/[,،;؛:：\-–—/|'"`]+$/, "")
    .trim();

  if (!cleaned) return "";

  if (type === "city") {
    cleaned = cleaned.replace(
      /\s+(?:حي|الحي|المحافظة|المحافظه|محافظة|محافظه|الدولة|الدوله|دولة|دوله)\s*[:：-]?\s*.*$/i,
      "",
    ).trim();
  } else if (type === "neighborhood") {
    cleaned = cleaned.replace(
      /\s+(?:المدينة|المدينه|مدينة|مدينه|المحافظة|المحافظه|محافظة|محافظه|الدولة|الدوله|دولة|دوله)\s*[:：-]?\s*.*$/i,
      "",
    ).trim();
  } else if (type === "governorate") {
    cleaned = cleaned.replace(
      /\s+(?:المدينة|المدينه|مدينة|مدينه|حي|الحي)\s*[:：-]?\s*.*$/i,
      "",
    ).trim();
  }

  cleaned = cleaned.split(LOCATION_RELATIONAL_SPLIT_PATTERN)[0].trim();
  cleaned = cleaned.split(LOCATION_TRAILING_CONTEXT_SPLIT_PATTERN)[0].trim();

  return normalizeArabicText(cleaned);
}

function getMeaningfulLocationCore(value = "") {
  return normalizeLocationLookupKey(value)
    .replace(
      /\b(?:ال|حي|الحي|المدينة|المدينه|مدينة|مدينه|الموقع|المكان|المنطقة|المنطقه|منطقة|منطقه|المحافظة|المحافظه|محافظة|محافظه|الدولة|الدوله|دولة|دوله)\b/gi,
      " ",
    )
    .replace(/\s+/g, "");
}

function looksWeakLocationValue(value = "", type = "generic") {
  const normalized = normalizeArabicText(value || "");
  if (!normalized || isPlaceholderLocationValue(normalized)) {
    return true;
  }

  const lookup = normalizeLocationLookupKey(normalized);
  if (!lookup || LOCATION_GENERIC_REJECT_VALUES.has(lookup)) {
    return true;
  }

  if (!/[A-Za-z\u0600-\u06FF]/.test(normalized)) {
    return true;
  }

  if (getMeaningfulLocationCore(normalized).length < 2) {
    return true;
  }

  if (LOCATION_HARD_NOISE_PATTERN.test(normalized)) {
    return true;
  }

  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  const maxWords = type === "city" ? 4 : 5;
  if (wordCount > maxWords) {
    return true;
  }

  if (type === "city" && /\b(?:حي|الحي)\b/i.test(normalized)) {
    return true;
  }

  if (
    type === "neighborhood" &&
    /\b(?:المدينة|المدينه|مدينة|مدينه|المحافظة|المحافظه|محافظة|محافظه|الدولة|الدوله|دولة|دوله)\b/i.test(
      normalized,
    )
  ) {
    return true;
  }

  return false;
}

function finalizeLocationCandidate(value = "", type = "generic") {
  let cleaned = trimLocationCandidateByType(
    stripLocationFieldLabel(value, type),
    type,
  );
  if (!cleaned) return "";

  if (type === "neighborhood") {
    cleaned = normalizeNeighborhoodName(cleaned);
    cleaned = normalizeArabicText(
      areaNormalizer.normalizeAreaName
        ? areaNormalizer.normalizeAreaName(cleaned) || cleaned
        : cleaned,
    );
    cleaned = normalizeNeighborhoodName(cleaned);
  } else {
    cleaned = normalizeArabicText(
      areaNormalizer.normalizeCityName
        ? areaNormalizer.normalizeCityName(cleaned) || cleaned
        : cleaned,
    );
  }

  return looksWeakLocationValue(cleaned, type) ? "" : cleaned;
}

function buildLocationCandidateList(rawValue = "", type = "generic") {
  const raw = normalizeArabicText(rawValue || "");
  if (!raw) return [];

  const candidates = [
    raw,
    stripLocationFieldLabel(raw, type),
    trimLocationCandidateByType(raw, type),
  ];

  raw.split(LOCATION_SEPARATOR_PATTERN).forEach((fragment) => {
    const cleanedFragment = normalizeArabicText(fragment);
    if (!cleanedFragment) return;
    candidates.push(cleanedFragment);
    candidates.push(stripLocationFieldLabel(cleanedFragment, type));
    candidates.push(trimLocationCandidateByType(cleanedFragment, type));
  });

  if (type === "neighborhood") {
    const extractedNeighborhoods = areaNormalizer.extractNeighborhoods(raw);
    extractedNeighborhoods.forEach((item) => candidates.push(item));

    const labeledMatch = raw.match(
      /(?:الحي|حي|المنطقة|المنطقه|منطقة|منطقه|الموقع|المكان)\s*[:：-]?\s*([^\n]{2,80})/i,
    );
    if (labeledMatch) {
      candidates.push(labeledMatch[1]);
    }
  }

  if (type === "city") {
    const cityMatch = raw.match(
      /(?:المدينة|المدينه|مدينة|مدينه)\s*[:：-]?\s*([^\n]{2,80})/i,
    );
    if (cityMatch) {
      candidates.push(cityMatch[1]);
    }
  }

  if (type === "governorate") {
    const governorateMatch = raw.match(
      /(?:المحافظة|المحافظه|محافظة|محافظه|المنطقة|المنطقه|منطقة|منطقه|الدولة|الدوله|دولة|دوله)\s*[:：-]?\s*([^\n]{2,80})/i,
    );
    if (governorateMatch) {
      candidates.push(governorateMatch[1]);
    }
  }

  return unique(
    candidates
      .map((candidate) => finalizeLocationCandidate(candidate, type))
      .filter(Boolean),
  );
}

function sanitizeLocationCandidate(
  rawValue = "",
  { type = "generic", adText = "", knownOptions = [] } = {},
) {
  const normalizedRaw = normalizeArabicText(rawValue || "");
  if (!normalizedRaw || isPlaceholderLocationValue(normalizedRaw)) {
    return "";
  }

  const availableKnownOptions =
    Array.isArray(knownOptions) && knownOptions.length > 0
      ? normalizeLocationOptions(knownOptions)
      : getKnownLocationOptions(type);

  const preparedRaw = trimLocationCandidateByType(
    stripLocationFieldLabel(normalizedRaw, type),
    type,
  );
  const directKnownMatch = findKnownLocationMatch(
    preparedRaw || normalizedRaw,
    availableKnownOptions,
  );
  if (directKnownMatch) {
    return finalizeLocationCandidate(directKnownMatch, type);
  }

  const normalizedAdText = normalizeArabicText(adText || "");
  const directPreparedCandidate = finalizeLocationCandidate(
    preparedRaw || normalizedRaw,
    type,
  );
  if (
    directPreparedCandidate &&
    (!normalizedAdText ||
      containsNormalizedLocation(normalizedAdText, directPreparedCandidate))
  ) {
    return directPreparedCandidate;
  }

  const candidates = buildLocationCandidateList(normalizedRaw, type);

  for (const candidate of candidates) {
    const knownMatch = findKnownLocationMatch(candidate, availableKnownOptions);
    if (knownMatch) {
      return finalizeLocationCandidate(knownMatch, type);
    }

    if (!normalizedAdText || containsNormalizedLocation(normalizedAdText, candidate)) {
      return candidate;
    }
  }

  return "";
}

function extractNumericValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (value === null || value === undefined || value === "") {
    return "";
  }

  const normalized = convertArabicDigitsToEnglish(String(value))
    .replace(/[,_\s]/g, "")
    .match(/-?\d+(?:\.\d+)?/);

  if (!normalized) return "";

  const numberValue = Number(normalized[0]);
  return Number.isFinite(numberValue) ? numberValue : "";
}

function toBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;

  const normalized = normalizeWhitespace(String(value ?? "")).toLowerCase();
  if (["true", "yes", "1", "صح", "نعم"].includes(normalized)) return true;
  if (["false", "no", "0", "خطأ", "لا"].includes(normalized)) return false;

  return false;
}

function unwrapValue(value) {
  if (isObject(value)) {
    if (Object.prototype.hasOwnProperty.call(value, "value")) {
      return value.value;
    }
    if (Object.prototype.hasOwnProperty.call(value, "rendered")) {
      return value.rendered;
    }
  }
  return value;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const unwrapped = unwrapValue(value);
    if (unwrapped !== null && unwrapped !== undefined) {
      if (
        typeof unwrapped === "string" &&
        normalizeWhitespace(unwrapped) === ""
      ) {
        continue;
      }
      return unwrapped;
    }
  }
  return "";
}

function collapseRepeatedWords(text) {
  return normalizeWhitespace(String(text ?? "")).replace(
    /\b(\S+)(?:\s+\1){2,}/gi,
    "$1",
  );
}

function sanitizeTitle(title) {
  let normalized = collapseRepeatedWords(normalizeArabicText(title))
    .replace(/[<>]/g, "")
    .trim();

  if (!normalized) {
    return DEFAULT_WP_TITLE;
  }

  if (normalized.length > 120) {
    normalized = normalized.slice(0, 120).trim();
  }

  return normalized;
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripHtml(text) {
  return String(text ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function sanitizeHtml(content) {
  let html = String(content ?? "").trim();

  html = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/<\/?(?:html|head|body)[^>]*>/gi, "")
    .trim();

  if (!html) {
    return "";
  }

  if (!/<[a-z][\s\S]*>/i.test(html)) {
    return `<p>${escapeHtml(html)}</p>`;
  }

  return html;
}

function stripAdReferenceNumbers(text) {
  const cleaned = String(text || "")
    .replace(
      /رقم\s*(?:القطعة|الإعلان|الاعلان|العرض|الطلب)\s*[:：-]?\s*[0-9٠-٩]+(?:\s*[A-Za-z\u0600-\u06FF]+)?/gi,
      "",
    )
    .replace(/قطعة\s*[:：-]?\s*[0-9٠-٩]+(?:\s*[A-Za-z\u0600-\u06FF]+)?/gi, "")
    .replace(/\s+[:：]\s+/g, " ")
    .replace(/[,:،]\s*(?=\n|$)/g, "");

  return cleaned
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeLocationHintList(values, fallback = []) {
  const source = Array.isArray(values) ? values : fallback;
  const normalized = source
    .filter((value) => typeof value === "string")
    .map((value) => normalizeArabicText(value))
    .map((value) =>
      normalizeArabicText(
        areaNormalizer.normalizeCityName
          ? areaNormalizer.normalizeCityName(value) || value
          : value,
      ),
    )
    .filter(Boolean)
    .filter((value) => isValidLocationHintValue(value))
    .slice(0, 300);

  const uniqueValues = unique(normalized);
  if (uniqueValues.length > 0) return uniqueValues;

  return unique(
    (Array.isArray(fallback) ? fallback : [])
      .filter((value) => typeof value === "string")
      .map((value) => normalizeArabicText(value))
      .filter((value) => isValidLocationHintValue(value))
      .filter(Boolean),
  );
}

function isValidLocationHintValue(value = "") {
  const normalized = normalizeArabicText(value || "");
  if (!normalized) return false;
  if (isPlaceholderLocationValue(normalized)) return false;

  if (
    /(?:https?:\/\/|wa\.me|chat\.whatsapp\.com|api\.whatsapp\.com|t\.me|telegram|instagram|snap(?:chat)?|youtube|twitter|x\.com|facebook|\.(?:com|net|org|sa|me|co|io|app|info)\b|☎|📞|📱|@)/iu.test(
      normalized,
    )
  ) {
    return false;
  }

  if (LOCATION_HARD_NOISE_PATTERN.test(normalized)) {
    return false;
  }

  if (
    /(?:موقع|واضح|قريب|بالقرب|بجوار|خلف|مقابل|غرفة|غرف|صالة|صاله|مجلس|حمام|مطبخ|متر|ريال|سعر|ملاحظة|معتمد|مؤجر|للبيع|للإيجار|للايجار)/i.test(
      normalized,
    )
  ) {
    return false;
  }

  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  if (wordCount > 4 || normalized.length > 35) {
    return false;
  }

  if (/[0-9٠-٩]/.test(normalized)) {
    return false;
  }

  return /^[A-Za-z\u0600-\u06FF\s-]+$/u.test(normalized);
}

function getDynamicLocationHints(forceRefresh = false) {
  const isFresh =
    !forceRefresh &&
    dynamicLocationHintsCache.loadedAt > 0 &&
    Date.now() - dynamicLocationHintsCache.loadedAt <
      DYNAMIC_LOCATION_CACHE_TTL_MS;

  if (isFresh) {
    return dynamicLocationHintsCache;
  }

  try {
    const settings = dataSync.readDataSync("SETTINGS", {}) || {};
    const beforeCities = normalizeLocationHintList(
      settings.wpBeforeCityOptions,
      DEFAULT_DYNAMIC_BEFORE_CITIES,
    );
    const cities = normalizeLocationHintList(
      settings.wpCityOptions,
      DEFAULT_DYNAMIC_CITIES,
    );

    dynamicLocationHintsCache = {
      loadedAt: Date.now(),
      beforeCities,
      cities,
    };
  } catch (error) {
    dynamicLocationHintsCache = {
      ...dynamicLocationHintsCache,
      loadedAt: Date.now(),
      beforeCities: normalizeLocationHintList(
        dynamicLocationHintsCache.beforeCities,
        DEFAULT_DYNAMIC_BEFORE_CITIES,
      ),
      cities: normalizeLocationHintList(
        dynamicLocationHintsCache.cities,
        DEFAULT_DYNAMIC_CITIES,
      ),
    };
  }

  return dynamicLocationHintsCache;
}

function inferLocationFromKnownOptions(text, options = []) {
  return findKnownLocationMatch(text, normalizeLocationHintList(options));
}

function buildDynamicLocationHintsPromptText() {
  const hints = getDynamicLocationHints(false);
  const beforeCities = hints.beforeCities.slice(0, 40);
  const cities = hints.cities.slice(0, 40);

  const beforeCitiesLine =
    beforeCities.length > 0
      ? `- المحافظات/المناطق الكبرى المحدثة: ${beforeCities.join("، ")}`
      : "";
  const citiesLine =
    cities.length > 0 ? `- المدن المحدثة: ${cities.join("، ")}` : "";

  if (!beforeCitiesLine && !citiesLine) {
    return "";
  }

  return `مرجع جغرافي داخلي (استخدمه للاستنتاج عند غياب الحقول الصريحة):
${beforeCitiesLine}
${citiesLine}
- قارن الموقع أولاً بهذا المرجع، لكن إذا ظهرت مدينة أو دولة واضحة في النص وغير موجودة هنا فاحتفظ بها كما وردت بعد تنظيفها.
- location/neighborhood = اسم الحي فقط بدون كلمة "حي" وبدون أي وصف إضافي، city = اسم المدينة فقط بدون كلمة "مدينة"، before_City = اسم المحافظة أو الدولة أو المنطقة الكبرى فقط.
- القيم المرفوضة: "ال" أو "حي" أو "مدينة" أو أي جملة طويلة عن الموقع. إذا لم تجد قيمة دقيقة فاترك الحقل فارغاً.`;
}

function inferCityGovernorateFromText(adText) {
  const text = normalizeArabicText(adText || "");
  if (!text) {
    return { city: "", governorate: "" };
  }

  let city = "";
  let governorate = "";

  const governorateMatch = text.match(
    /(?:المحافظة|المحافظه|محافظة|محافظه|الدولة|الدوله|دولة|دوله|المنطقة|المنطقه|منطقة|منطقه)\s*[:：-]?\s*([^\n]{2,80})/i,
  );
  if (governorateMatch) {
    governorate = sanitizeLocationCandidate(governorateMatch[1], {
      type: "governorate",
      adText: text,
    });
  }

  if (!city) {
    const cityMatch = text.match(
      /(?:المدينة|المدينه|مدينة|مدينه)\s*[:：-]?\s*([^\n]{2,80})/i,
    );
    if (cityMatch) {
      city = sanitizeLocationCandidate(cityMatch[1], {
        type: "city",
        adText: text,
      });
    }
  }

  if (!city) {
    const inlineMatch = text.match(
      /(?:^|[\s(])(في|ب)\s*([^،,\n]{2,80})\s*[،,]\s*([^،,\n]{2,80})/i,
    );
    if (inlineMatch) {
      city = sanitizeLocationCandidate(inlineMatch[2], {
        type: "city",
        adText: text,
      });

      if (!governorate) {
        governorate = sanitizeLocationCandidate(inlineMatch[3], {
          type: "governorate",
          adText: text,
        });
      }
    }
  }

  const dynamicHints = getDynamicLocationHints(false);
  if (!city) {
    city = sanitizeLocationCandidate(
      inferLocationFromKnownOptions(text, dynamicHints.cities),
      {
        type: "city",
        adText: text,
        knownOptions: dynamicHints.cities,
      },
    );
  }
  if (!governorate) {
    governorate = sanitizeLocationCandidate(
      inferLocationFromKnownOptions(text, dynamicHints.beforeCities),
      {
        type: "governorate",
        adText: text,
        knownOptions: dynamicHints.beforeCities,
      },
    );
  }

  if (!city) {
    const neighborhoodHints = areaNormalizer.extractNeighborhoods(text);
    for (const hint of neighborhoodHints) {
      const inferredCity = normalizeArabicText(
        areaNormalizer.inferCityFromArea
          ? areaNormalizer.inferCityFromArea(hint)
          : "",
      );
      if (inferredCity) {
        city = inferredCity;
        break;
      }
    }
  }

  if (!governorate && /(?:الأحساء|الاحساء|الحسا)/i.test(text)) {
    governorate = AL_AHSA_GOVERNORATE;
  }

  return { city, governorate };
}

function normalizePhoneNumber(rawPhone) {
  const digits = convertArabicDigitsToEnglish(String(rawPhone ?? "")).replace(
    /\D/g,
    "",
  );

  if (!digits) return "";
  if (/^009665\d{8}$/.test(digits)) return digits.slice(2);
  if (/^9665\d{8}$/.test(digits)) return digits;
  if (/^05\d{8}$/.test(digits)) return `966${digits.slice(1)}`;
  if (/^5\d{8}$/.test(digits)) return `966${digits}`;

  return digits;
}

function isSaudiMobilePhoneNumber(rawPhone) {
  return /^9665\d{8}$/.test(normalizePhoneNumber(rawPhone));
}

function stripPhoneLikeNumbers(text) {
  return String(text ?? "").replace(
    /(?:\+?\d[\d\s\-()]{7,}\d)/g,
    (match) => (isSaudiMobilePhoneNumber(match) ? "" : match),
  );
}

function enforceWordPressPhonePolicy(meta = {}, targetWebsite = "masaak") {
  const normalizedMeta = isObject(meta) ? { ...meta } : {};
  const contact = normalizeContactList(normalizedMeta.contact || []);
  const directPhone = normalizePhoneNumber(
    firstNonEmpty(normalizedMeta.phone_number, normalizedMeta.phone),
  );

  normalizedMeta.contact = contact;

  if (targetWebsite === "masaak") {
    const defaultPhone = String(
      websiteConfig.getWebsite(targetWebsite)?.defaultPhone || "",
    ).trim();
    normalizedMeta.phone_number = defaultPhone || "";
    normalizedMeta.phone = defaultPhone || "";
    return normalizedMeta;
  }

  const preferredPhone = directPhone || (contact[0] ? contact[0].value : "");
  normalizedMeta.phone_number = preferredPhone || "";
  normalizedMeta.phone = preferredPhone || "";

  return normalizedMeta;
}

function normalizeContactList(rawContact, extractedPhones = []) {
  const contacts = [];

  if (Array.isArray(rawContact)) {
    for (const item of rawContact) {
      if (typeof item === "string") {
        contacts.push({
          value: normalizePhoneNumber(item),
          type: "phone",
          confidence: 1,
        });
        continue;
      }

      if (isObject(item)) {
        const value = normalizePhoneNumber(item.value || item.phone || "");
        if (!value) continue;

        const confidenceRaw = extractNumericValue(item.confidence);
        const confidence =
          typeof confidenceRaw === "number"
            ? clamp(
                confidenceRaw <= 1 ? confidenceRaw : confidenceRaw / 100,
                0,
                1,
              )
            : 1;

        contacts.push({
          value,
          type: normalizeWhitespace(item.type || "phone") || "phone",
          confidence,
        });
      }
    }
  }

  if (contacts.length === 0 && extractedPhones.length > 0) {
    extractedPhones.forEach((phone) => {
      contacts.push({
        value: normalizePhoneNumber(phone.normalized || phone.original || ""),
        type: "phone",
        confidence: clamp(phone.confidence || 1, 0, 1),
      });
    });
  }

  const deduped = [];
  const seen = new Set();

  for (const contact of contacts) {
    if (!contact.value || seen.has(contact.value)) continue;
    seen.add(contact.value);
    deduped.push(contact);
  }

  return deduped;
}

function stripCodeFences(text) {
  const raw = String(text ?? "").trim();
  const fencedBlocks = [...raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map(
    (match) => match[1].trim(),
  );

  if (fencedBlocks.length > 0) {
    return fencedBlocks.join("\n").trim();
  }

  return raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

function extractBalancedJsonSnippets(text) {
  const source = String(text ?? "");
  const snippets = [];

  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{" || char === "[") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }

    if (char === "}" || char === "]") {
      if (depth > 0) depth -= 1;
      if (depth === 0 && start >= 0) {
        snippets.push(source.slice(start, i + 1).trim());
        start = -1;
      }
    }
  }

  const firstBrace = source.indexOf("{");
  const lastBrace = source.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    snippets.push(source.slice(firstBrace, lastBrace + 1).trim());
  }

  return unique(snippets);
}

function collectJsonCandidates(rawText) {
  const cleaned = stripCodeFences(rawText);
  const candidates = [];

  const pushCandidate = (value) => {
    const normalized = String(value ?? "").trim();
    if (normalized && !candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  };

  pushCandidate(cleaned);
  extractBalancedJsonSnippets(rawText).forEach(pushCandidate);
  extractBalancedJsonSnippets(cleaned).forEach(pushCandidate);

  return candidates;
}

function parseJson(candidate) {
  const tryParse = (value) => {
    try {
      return JSON.parse(value);
    } catch (error) {
      return null;
    }
  };

  const maybeParseNestedString = (parsedValue) => {
    if (typeof parsedValue !== "string") {
      return parsedValue;
    }

    const nested = parsedValue.trim();
    const looksLikeJson =
      (nested.startsWith("{") && nested.endsWith("}")) ||
      (nested.startsWith("[") && nested.endsWith("]"));

    if (!looksLikeJson) {
      return parsedValue;
    }

    return tryParse(nested) ?? parsedValue;
  };

  const rawCandidate = String(candidate ?? "");

  let parsed = tryParse(rawCandidate);
  if (parsed !== null) {
    return maybeParseNestedString(parsed);
  }

  // Defensive cleanup for model output artifacts.
  const normalizedCandidate = rawCandidate
    .replace(/^\uFEFF/, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\u0000/g, "");

  parsed = tryParse(normalizedCandidate);
  if (parsed !== null) {
    return maybeParseNestedString(parsed);
  }

  const withoutTrailingCommas = normalizedCandidate.replace(
    /,\s*([}\]])/g,
    "$1",
  );
  parsed = tryParse(withoutTrailingCommas);
  if (parsed !== null) {
    return maybeParseNestedString(parsed);
  }

  try {
    return JSON.parse(candidate);
  } catch (error) {
    return null;
  }
}

function expandPayloadCandidates(parsed) {
  const queue = [parsed];
  const collected = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (Array.isArray(current)) {
      current.forEach((item) => queue.push(item));
      continue;
    }

    if (!isObject(current)) continue;

    collected.push(current);

    [
      "data",
      "result",
      "output",
      "response",
      "payload",
      "json",
      "arguments",
      "content",
    ].forEach((key) => {
      const nested = current[key];

      if (isObject(nested)) {
        queue.push(nested);
        return;
      }

      if (Array.isArray(nested)) {
        nested.forEach((item) => queue.push(item));
        return;
      }

      // Some providers wrap the JSON object as an escaped string inside these keys.
      if (typeof nested === "string") {
        const nestedCandidates = collectJsonCandidates(nested);

        nestedCandidates.forEach((candidate) => {
          const reparsed = parseJson(candidate);
          if (isObject(reparsed) || Array.isArray(reparsed)) {
            queue.push(reparsed);
          }
        });
      }
    });
  }

  return collected;
}

function parseWithSchema(rawText, schema, taskName) {
  const candidates = collectJsonCandidates(rawText);

  for (const candidate of candidates) {
    const parsed = parseJson(candidate);
    if (parsed === null) continue;

    const payloadCandidates = expandPayloadCandidates(parsed);

    for (const payload of payloadCandidates) {
      if (!schema.match(payload)) continue;
      return schema.sanitize(payload);
    }
  }

  throw new AIServiceError(
    `${taskName}: failed to parse valid JSON response`,
    "invalid_json",
    {
      preview: String(rawText ?? "").slice(0, 600),
    },
  );
}

function classifyProviderError(error) {
  const message = String(error?.message || error || "Unknown error");
  const status = error?.status || error?.statusCode || error?.response?.status;

  if (
    status === 429 ||
    message.includes("429") ||
    message.toLowerCase().includes("rate limit") ||
    message.includes("Resource exhausted")
  ) {
    return "rate_limit";
  }

  if (
    [408, 500, 502, 503, 504].includes(status) ||
    /(timeout|timed out|ECONNRESET|ECONNREFUSED|ENOTFOUND|network)/i.test(
      message,
    )
  ) {
    return "network_error";
  }

  if (
    status === 401 ||
    status === 403 ||
    /(unauthorized|forbidden|invalid api key|permission)/i.test(message)
  ) {
    return "provider_failure";
  }

  return "provider_failure";
}

function normalizeError(error, taskName, provider, attempt) {
  if (error instanceof AIServiceError) {
    return {
      type: error.type,
      taskName,
      provider,
      attempt,
      message: error.message,
      details: error.details,
    };
  }

  return {
    type: classifyProviderError(error),
    taskName,
    provider,
    attempt,
    message: String(error?.message || error || "Unknown provider error"),
    details: {
      status: error?.status || error?.response?.status,
    },
  };
}

function buildStrictJsonPrompt(prompt, schema) {
  const template = schema?.template
    ? JSON.stringify(schema.template, null, 2)
    : "";
  return `${prompt}\n\nIMPORTANT OUTPUT RULES:\n1) Return ONLY one valid JSON object.\n2) No markdown fences.\n3) No additional explanation text.\n${template ? `4) Use this shape:\n${template}` : ""}`;
}

function getProviderOrder(providerOrder = []) {
  const requested =
    Array.isArray(providerOrder) && providerOrder.length > 0
      ? providerOrder
      : [PROVIDERS.GPT, PROVIDERS.GEMINI];

  const uniqueRequested = [];
  requested.forEach((provider) => {
    if (
      [PROVIDERS.GPT, PROVIDERS.GEMINI].includes(provider) &&
      !uniqueRequested.includes(provider)
    ) {
      uniqueRequested.push(provider);
    }
  });

  const available = uniqueRequested.filter(
    (provider) => apiKeyManager.getEnabledKeysByProvider(provider).length > 0,
  );

  if (available.length > 0) {
    return available;
  }

  return [PROVIDERS.GPT, PROVIDERS.GEMINI].filter(
    (provider) => apiKeyManager.getEnabledKeysByProvider(provider).length > 0,
  );
}

function shouldUseMaxCompletionTokens(modelName = "") {
  const normalized = String(modelName).toLowerCase();
  return (
    normalized.startsWith("gpt-5") ||
    normalized.startsWith("o1") ||
    normalized.startsWith("o3") ||
    normalized.startsWith("o4")
  );
}

function shouldOmitTemperature(modelName = "") {
  const normalized = String(modelName).toLowerCase();
  return (
    normalized.startsWith("gpt-5") ||
    normalized.startsWith("o1") ||
    normalized.startsWith("o3") ||
    normalized.startsWith("o4")
  );
}

function shouldUseMinimalReasoningEffort(modelName = "") {
  const normalized = String(modelName).toLowerCase();
  return (
    normalized.startsWith("gpt-5") ||
    normalized.startsWith("o1") ||
    normalized.startsWith("o3") ||
    normalized.startsWith("o4")
  );
}

function summarizeGptCompletion(completion) {
  const choice = Array.isArray(completion?.choices)
    ? completion.choices[0]
    : null;
  const message = choice?.message;
  const content = message?.content;

  const toolCallTypes = Array.isArray(message?.tool_calls)
    ? message.tool_calls.map((toolCall) => toolCall?.type).filter(Boolean)
    : [];

  return {
    id: completion?.id || null,
    model: completion?.model || null,
    finish_reason: choice?.finish_reason || null,
    has_message: Boolean(message),
    content_kind: Array.isArray(content) ? "array" : typeof content,
    content_length: typeof content === "string" ? content.length : null,
    refusal_length:
      typeof message?.refusal === "string" ? message.refusal.length : null,
    tool_call_types: toolCallTypes,
    usage: completion?.usage || null,
  };
}

function extractTextFromGptMessage(message) {
  if (!isObject(message)) return "";

  const content = message.content;

  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    const parts = content
      .map((part) => {
        if (typeof part === "string") return part;
        if (!isObject(part)) return "";
        return firstNonEmpty(
          part.text,
          part.output_text,
          part.content,
          part.value,
          "",
        );
      })
      .map((part) => String(part ?? "").trim())
      .filter(Boolean);

    if (parts.length > 0) {
      return parts.join("\n");
    }
  }

  if (isObject(content)) {
    return JSON.stringify(content);
  }

  if (isObject(message.parsed)) {
    return JSON.stringify(message.parsed);
  }

  const toolCallPayloads = Array.isArray(message.tool_calls)
    ? message.tool_calls
        .map((toolCall) =>
          firstNonEmpty(
            toolCall?.function?.arguments,
            toolCall?.custom?.input,
            "",
          ),
        )
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    : [];

  if (toolCallPayloads.length > 0) {
    return toolCallPayloads.join("\n");
  }

  const functionCallArguments = firstNonEmpty(
    message.function_call?.arguments,
    "",
  );
  if (
    typeof functionCallArguments === "string" &&
    functionCallArguments.trim()
  ) {
    return functionCallArguments.trim();
  }

  return "";
}

async function callProviderRaw({
  provider,
  prompt,
  taskName,
  temperature = 0.2,
  maxTokens = 1200,
  model,
  schema = null,
  maxRetries = null,
}) {
  const modelName =
    model || apiKeyManager.getModelConfig(provider, "efficient").model;

  return apiKeyManager.retryWithKeyRotation(
    provider,
    async (apiKey) => {
      if (provider === PROVIDERS.GPT) {
        const client = new OpenAI({ apiKey });
        const completionRequest = {
          model: modelName,
          messages: [{ role: "user", content: prompt }],
        };

        if (!shouldOmitTemperature(modelName)) {
          completionRequest.temperature = temperature;
        }

        if (shouldUseMaxCompletionTokens(modelName)) {
          completionRequest.max_completion_tokens = maxTokens;
        } else {
          completionRequest.max_tokens = maxTokens;
        }

        if (schema) {
          completionRequest.response_format = { type: "json_object" };
        }
        if (schema && shouldUseMinimalReasoningEffort(modelName)) {
          completionRequest.reasoning_effort = "minimal";
        }

        let completion;
        try {
          completion = await client.chat.completions.create(completionRequest);
        } catch (error) {
          const message = String(error?.message || error || "");
          const responseFormatUnsupported =
            schema &&
            /response_format/i.test(message) &&
            /(unsupported|not supported|invalid)/i.test(message);
          const reasoningEffortUnsupported =
            schema &&
            /reasoning[_\s-]*effort/i.test(message) &&
            /(unsupported|not supported|invalid)/i.test(message);

          if (responseFormatUnsupported) {
            delete completionRequest.response_format;
            completion =
              await client.chat.completions.create(completionRequest);
          } else if (reasoningEffortUnsupported) {
            delete completionRequest.reasoning_effort;
            completion =
              await client.chat.completions.create(completionRequest);
          } else {
            throw error;
          }
        }

        const choice = Array.isArray(completion?.choices)
          ? completion.choices[0]
          : null;
        const message = choice?.message;
        const extractedText = extractTextFromGptMessage(message);

        if (
          !extractedText &&
          typeof message?.refusal === "string" &&
          message.refusal.trim()
        ) {
          throw new AIServiceError(
            `${taskName}: model refused to return content`,
            "provider_failure",
            { refusal: message.refusal.slice(0, 400) },
          );
        }

        if (!extractedText) {
          throw new AIServiceError(
            `${taskName}: empty response from GPT`,
            "provider_failure",
            {
              gpt_debug: summarizeGptCompletion(completion),
            },
          );
        }

        return extractedText;
      }

      const genAI = new GoogleGenerativeAI(apiKey);
      const geminiModel = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
        },
      });

      const result = await geminiModel.generateContent(prompt);
      const response = await result.response;
      return response.text();
    },
    taskName,
    maxRetries,
  );
}

/**
 * Unified LLM wrapper with provider fallback + schema validation.
 * @param {Object} params
 * @param {string} params.taskName
 * @param {string} params.prompt
 * @param {Object|null} params.schema
 * @param {string[]} params.providerOrder
 * @param {number} params.temperature
 * @param {number} params.maxTokens
 * @param {Object} params.modelByProvider
 * @param {number|null} params.maxRetries
 */
async function callLLM({
  taskName,
  prompt,
  schema,
  providerOrder,
  temperature = 0.2,
  maxTokens = 1200,
  modelByProvider = {},
  maxRetries = null,
}) {
  const providers = getProviderOrder(providerOrder);

  if (providers.length === 0) {
    throw new AIServiceError(
      `${taskName}: no enabled API keys for Gemini or GPT`,
      "provider_failure",
    );
  }

  const normalizedErrors = [];

  for (const provider of providers) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const promptToUse =
        attempt === 1 || !schema
          ? prompt
          : buildStrictJsonPrompt(prompt, schema);

      try {
        console.log(`🤖 [${taskName}] provider=${provider} attempt=${attempt}`);

        const rawText = await callProviderRaw({
          provider,
          prompt: promptToUse,
          taskName: `${taskName} (${provider})`,
          temperature,
          maxTokens,
          model: modelByProvider[provider],
          schema,
          maxRetries,
        });

        if (!schema) {
          return { provider, rawText, data: rawText };
        }

        const data = parseWithSchema(rawText, schema, taskName);
        return { provider, rawText, data };
      } catch (error) {
        const normalized = normalizeError(error, taskName, provider, attempt);
        normalizedErrors.push(normalized);

        console.error(
          `❌ [${taskName}] provider=${provider} attempt=${attempt} type=${normalized.type}: ${normalized.message}`,
        );
        if (normalized.type === "invalid_json") {
          const preview =
            typeof normalized.details?.preview === "string" &&
            normalized.details.preview.trim()
              ? normalized.details.preview
              : "<empty response>";
          console.error(`🧪 [${taskName}] invalid_json preview: ${preview}`);
        }
        if (normalized.details?.gpt_debug) {
          console.error(
            `🧪 [${taskName}] gpt_debug: ${JSON.stringify(normalized.details.gpt_debug)}`,
          );
        }

        const shouldRetryJson =
          normalized.type === "invalid_json" &&
          attempt === 1 &&
          Boolean(schema);

        if (shouldRetryJson) {
          console.log(
            `🔁 [${taskName}] retrying ${provider} with strict JSON-only instruction...`,
          );
          continue;
        }

        break;
      }
    }
  }

  throw new AIServiceError(
    `${taskName}: all providers failed`,
    "provider_failure",
    {
      errors: normalizedErrors,
    },
  );
}

function hasAnyEnabledProvider() {
  return (
    apiKeyManager.getEnabledKeysByProvider(PROVIDERS.GEMINI).length > 0 ||
    apiKeyManager.getEnabledKeysByProvider(PROVIDERS.GPT).length > 0
  );
}

function getApiKeysStatus() {
  const status = apiKeyManager.getApiKeysStatus();

  const mapProviderStatus = (providerStatus) => ({
    totalCount: providerStatus.totalKeys,
    workingCount: providerStatus.workingKeys,
    exhaustedCount: providerStatus.exhaustedKeys,
    details: providerStatus.details,
  });

  return {
    gemini: mapProviderStatus(status.gemini),
    gpt: mapProviderStatus(status.gpt),
    totalKeys: status.combined.totalKeys,
    workingKeys: status.combined.workingKeys,
    exhaustedKeys: status.combined.exhaustedKeys,
    allExhausted: status.combined.allExhausted,
  };
}

const DETECT_AD_SCHEMA = {
  template: {
    isAd: true,
    confidence: 90,
    reason: "سبب مختصر",
  },
  match: (obj) =>
    isObject(obj) &&
    ("isAd" in obj || "is_ad" in obj || "confidence" in obj || "reason" in obj),
  sanitize: (obj) => {
    const isAd = toBoolean(firstNonEmpty(obj.isAd, obj.is_ad, obj.ad));

    let confidence = extractNumericValue(
      firstNonEmpty(obj.confidence, obj.score),
    );
    if (confidence === "") {
      confidence = isAd ? 70 : 20;
    }

    if (typeof confidence === "number" && confidence <= 1) {
      confidence *= 100;
    }

    const reason =
      normalizeArabicText(
        firstNonEmpty(obj.reason, obj.explanation, obj.note),
      ) || (isAd ? "تم تصنيف الرسالة كإعلان" : "الرسالة ليست إعلاناً واضحاً");

    return {
      isAd,
      confidence: clamp(Math.round(confidence), 0, 100),
      reason,
    };
  },
};

const ENHANCE_AD_SCHEMA = {
  template: {
    enhancedText: "النص المحسن",
    improvements: ["تحسين 1", "تحسين 2"],
  },
  match: (obj) =>
    isObject(obj) &&
    ("enhanced" in obj || "enhancedText" in obj || "improvements" in obj),
  sanitize: (obj) => {
    const enhanced =
      firstNonEmpty(obj.enhanced, obj.enhancedText, obj.text, obj.output) || "";

    const improvements = Array.isArray(obj.improvements)
      ? obj.improvements
          .map((item) => normalizeArabicText(item))
          .filter(Boolean)
          .slice(0, 12)
      : [];

    return {
      enhanced: String(enhanced),
      enhancedText: String(enhanced),
      improvements,
    };
  },
};

const DETECT_CATEGORY_SCHEMA = {
  template: {
    category: "شقق للبيع",
    confidence: 0.9,
    reason: "سبب مختصر",
  },
  match: (obj) =>
    isObject(obj) && ("category" in obj || "classification" in obj),
  sanitize: (obj) => {
    const category = normalizeArabicText(
      firstNonEmpty(obj.category, obj.classification, obj.label, obj.result),
    );

    const confidenceRaw = extractNumericValue(
      firstNonEmpty(obj.confidence, obj.score),
    );
    const confidence =
      typeof confidenceRaw === "number"
        ? clamp(confidenceRaw <= 1 ? confidenceRaw : confidenceRaw / 100, 0, 1)
        : undefined;

    const reason = normalizeArabicText(
      firstNonEmpty(obj.reason, obj.explanation),
    );

    return {
      category,
      confidence,
      reason,
    };
  },
};

const WORDPRESS_SCHEMA = {
  template: {
    IsItAd: true,
    status: "publish",
    title: "عنوان الإعلان",
    content: "<h1>عنوان</h1><p>وصف</p>",
    excerpt: "وصف مختصر",
    category: "شقة",
    subcategory: "دور أول",
    category_id: 35,
    tags: ["عقارات"],
    meta: {
      ad_type: "عرض",
      owner_name: "المالك",
      phone_number: "9665xxxxxxxx",
      price_amount: 880000,
      arc_space: 600,
      parent_catt: "شقة",
      sub_catt: "دور أول",
      arc_category: "شقة",
      arc_subcategory: "دور أول",
      before_City: AL_AHSA_GOVERNORATE,
      City: "الهفوف",
      location: "الرابية",
      full_location: "الرابية - الهفوف",
    },
  },
  match: (obj) =>
    isObject(obj) &&
    ("meta" in obj || "title" in obj || "content" in obj || "IsItAd" in obj),
  sanitize: (obj) => obj,
};

const RECOVER_MISSING_WORDPRESS_FIELDS_SCHEMA = {
  template: {
    area: "",
    price: "",
    price_method: "",
    price_type: "",
    price_amount: "",
    from_price: "",
    to_price: "",
    fullLocation: "",
    neighborhood: "",
    city: "",
    governorate: "",
    category: "",
    subcategory: "",
    notes: "",
    confidence: 0.9,
  },
  match: (obj) =>
    isObject(obj) &&
    ("area" in obj ||
      "price" in obj ||
      "price_method" in obj ||
      "fullLocation" in obj ||
      "category" in obj ||
      "subcategory" in obj),
  sanitize: (obj) => {
    const confidenceRaw = extractNumericValue(
      firstNonEmpty(obj.confidence, obj.score),
    );
    const confidence =
      typeof confidenceRaw === "number"
        ? clamp(confidenceRaw <= 1 ? confidenceRaw : confidenceRaw / 100, 0, 1)
        : 0.8;

    return {
      area: firstNonEmpty(obj.area, obj.arc_space, obj.order_space, ""),
      price: firstNonEmpty(obj.price, ""),
      price_method: firstNonEmpty(
        obj.price_method,
        obj.payment_method,
        obj.priceMethod,
        "",
      ),
      price_type: firstNonEmpty(obj.price_type, obj.priceType, ""),
      price_amount: firstNonEmpty(obj.price_amount, obj.priceAmount, ""),
      from_price: firstNonEmpty(obj.from_price, obj.fromPrice, ""),
      to_price: firstNonEmpty(obj.to_price, obj.toPrice, ""),
      fullLocation: firstNonEmpty(
        obj.fullLocation,
        obj.full_location,
        obj.location_full,
        "",
      ),
      neighborhood: firstNonEmpty(obj.neighborhood, obj.location, ""),
      city: firstNonEmpty(obj.city, obj.City, obj.subcity, ""),
      governorate: firstNonEmpty(
        obj.governorate,
        obj.before_City,
        obj.before_city,
        "",
      ),
      category: firstNonEmpty(
        obj.category,
        obj.arc_category,
        obj.parent_catt,
        "",
      ),
      subcategory: firstNonEmpty(
        obj.subcategory,
        obj.arc_subcategory,
        obj.sub_catt,
        "",
      ),
      notes: normalizeArabicText(
        firstNonEmpty(obj.notes, obj.reason, obj.explanation, ""),
      ),
      confidence,
    };
  },
};

const VALIDATION_SCHEMA = {
  template: {
    isValid: true,
    reason: "سبب",
    suggestion: "اقتراح",
  },
  match: (obj) => isObject(obj) && ("isValid" in obj || "valid" in obj),
  sanitize: (obj) => ({
    isValid: toBoolean(firstNonEmpty(obj.isValid, obj.valid)),
    reason: normalizeArabicText(firstNonEmpty(obj.reason, obj.message)) || "",
    suggestion:
      normalizeArabicText(firstNonEmpty(obj.suggestion, obj.fix)) || "",
  }),
};

function parseTags(value) {
  if (Array.isArray(value)) {
    return value.map((tag) => normalizeArabicText(tag)).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/[،,]/)
      .map((tag) => normalizeArabicText(tag))
      .filter(Boolean);
  }

  return [];
}

function flattenMeta(meta) {
  if (!isObject(meta)) return {};

  const flat = {};
  Object.entries(meta).forEach(([key, value]) => {
    flat[key] = unwrapValue(value);
  });

  return flat;
}

function getTrustedTaxonomySync() {
  return wordpressCategoryService.getTrustedTaxonomySync();
}

function formatTrustedMasaakSubcategoryLines(taxonomy = getTrustedTaxonomySync()) {
  return Object.entries(taxonomy?.masaak?.subcategoryNamesByParent || {})
    .map(([parent, children]) => {
      const safeParent = normalizeArabicText(parent);
      const safeChildren = (children || [])
        .map((child) => normalizeArabicText(child))
        .filter(Boolean);

      if (!safeParent || safeChildren.length === 0) return "";
      return `${safeParent}: ${safeChildren.join("، ")}`;
    })
    .filter(Boolean);
}

function resolveTrustedMainCategory(input, websiteHint = null) {
  return wordpressCategoryService.resolveMainCategorySync(input, websiteHint);
}

function resolveTrustedSubcategory(
  parentCategory,
  input,
  websiteHint = "masaak",
) {
  return wordpressCategoryService.resolveSubcategorySync(
    parentCategory,
    input,
    websiteHint,
  );
}

function getCategoryWebsite(category) {
  if (resolveTrustedMainCategory(category, "hasak")) {
    return "hasak";
  }

  if (resolveTrustedMainCategory(category, "masaak")) {
    return "masaak";
  }

  return "";
}

function isTrustedHasakCategory(value) {
  return Boolean(resolveTrustedMainCategory(value, "hasak"));
}

function isTrustedMasaakCategory(value) {
  return Boolean(resolveTrustedMainCategory(value, "masaak"));
}

function resolveCategoryId(category, websiteHint = null) {
  const websiteName = websiteHint || getCategoryWebsite(category);
  if (!websiteName) return "";

  return wordpressCategoryService.resolveCategoryIdSync(websiteName, category);
}

function normalizeCategoryLabel(label) {
  return normalizeArabicText(label);
}

function appendParseNote(existingNotes, note) {
  const base = normalizeArabicText(existingNotes || "");
  const addition = normalizeArabicText(note || "");

  if (!addition) {
    return base;
  }

  if (!base) {
    return addition;
  }

  if (base.includes(addition)) {
    return base;
  }

  return `${base} | ${addition}`;
}

function buildFullLocationValue(meta = {}, fallback = "") {
  const parts = unique(
    [
      sanitizeLocationCandidate(firstNonEmpty(meta.location, meta.neighborhood, ""), {
        type: "neighborhood",
      }),
      sanitizeLocationCandidate(
        firstNonEmpty(meta.City, meta.subcity, meta.city, ""),
        {
          type: "city",
        },
      ),
      sanitizeLocationCandidate(
        firstNonEmpty(meta.before_City, meta.before_city, ""),
        {
          type: "governorate",
        },
      ),
    ].filter((value) => value && value !== "لم يذكر" && value !== "لا يوجد"),
  );

  if (parts.length > 0) {
    return parts.join(" - ");
  }

  return normalizeArabicText(fallback || "");
}

function hasDetailedLocation(meta = {}) {
  const fullLocation = buildFullLocationValue(meta, "");
  if (
    fullLocation &&
    !["الأحساء", "لم يذكر", "لا يوجد"].includes(fullLocation)
  ) {
    return true;
  }

  const beforeCity = sanitizeLocationCandidate(
    firstNonEmpty(meta.before_City, meta.before_city, ""),
    {
      type: "governorate",
    },
  );
  const city = sanitizeLocationCandidate(
    firstNonEmpty(meta.City, meta.subcity, meta.city, ""),
    {
      type: "city",
    },
  );
  const neighborhood = sanitizeLocationCandidate(
    firstNonEmpty(meta.location, meta.neighborhood, ""),
    {
      type: "neighborhood",
    },
  );

  const hasNeighborhood =
    Boolean(neighborhood) &&
    neighborhood !== "لم يذكر" &&
    neighborhood !== "لا يوجد";
  const hasDistinctCity = Boolean(city) && city !== beforeCity;

  return hasNeighborhood || hasDistinctCity;
}

function normalizeLocationMeta(meta, adText = "", targetWebsiteHint = null) {
  const targetWebsite =
    targetWebsiteHint ||
    inferTargetWebsiteFromData(
      {
        category: meta.category,
        subcategory: meta.subcategory,
        meta,
      },
      adText,
    );
  const isHasak = targetWebsite === "hasak";
  const inferred = inferCityGovernorateFromText(adText);
  const dynamicHints = getDynamicLocationHints(false);
  const parsedFullLocation = parseFullLocationText(meta.full_location || "");
  const fallbackLocation = extractLocationFromTextFallback(adText);

  let city = sanitizeLocationCandidate(
    firstNonEmpty(meta.city, meta.City, meta.subcity, parsedFullLocation.city),
    {
      type: "city",
      adText,
      knownOptions: dynamicHints.cities,
    },
  );
  let beforeCity = sanitizeLocationCandidate(
    firstNonEmpty(
      meta.before_City,
      meta.before_city,
      parsedFullLocation.governorate,
      inferred.governorate,
      AL_AHSA_GOVERNORATE,
    ),
    {
      type: "governorate",
      adText,
      knownOptions: dynamicHints.beforeCities,
    },
  );
  let subcity = sanitizeLocationCandidate(firstNonEmpty(meta.subcity, city), {
    type: "city",
    adText,
    knownOptions: dynamicHints.cities,
  });

  let neighborhood = sanitizeLocationCandidate(
    firstNonEmpty(
      meta.neighborhood,
      meta.location,
      parsedFullLocation.neighborhood,
      "",
    ),
    {
      type: "neighborhood",
      adText,
    },
  );

  if (
    !neighborhood ||
    neighborhood === "غير محدد" ||
    neighborhood === "لا يوجد"
  ) {
    neighborhood = isHasak ? "" : "لم يذكر";
  }

  if (!city) {
    city =
      sanitizeLocationCandidate(inferLocationFromKnownOptions(adText, dynamicHints.cities), {
        type: "city",
        adText,
        knownOptions: dynamicHints.cities,
      }) || fallbackLocation.city;
  }
  if (!beforeCity) {
    beforeCity =
      fallbackLocation.governorate ||
      sanitizeLocationCandidate(
        inferLocationFromKnownOptions(adText, dynamicHints.beforeCities),
        {
          type: "governorate",
          adText,
          knownOptions: dynamicHints.beforeCities,
        },
      );
  }

  if (
    (!neighborhood || neighborhood === "لم يذكر") &&
    fallbackLocation.neighborhood
  ) {
    neighborhood = fallbackLocation.neighborhood;
  }

  const inferredCityFromNeighborhood = normalizeArabicText(
    neighborhood &&
      neighborhood !== "لم يذكر" &&
      areaNormalizer.inferCityFromArea
      ? areaNormalizer.inferCityFromArea(neighborhood)
      : "",
  );
  const cityCandidatesFromNeighborhood =
    neighborhood &&
    neighborhood !== "لم يذكر" &&
    areaNormalizer.getCitiesForArea
      ? areaNormalizer
          .getCitiesForArea(neighborhood)
          .map((candidate) => normalizeArabicText(candidate))
          .filter(Boolean)
      : [];
  const uniqueNeighborhoodCandidates = [
    ...new Set(cityCandidatesFromNeighborhood),
  ];
  const hasSingleNeighborhoodCityCandidate =
    uniqueNeighborhoodCandidates.length === 1;
  const onlyNeighborhoodCityCandidate = hasSingleNeighborhoodCityCandidate
    ? uniqueNeighborhoodCandidates[0]
    : "";

  if (
    city &&
    city !== beforeCity &&
    hasSingleNeighborhoodCityCandidate &&
    city !== onlyNeighborhoodCityCandidate
  ) {
    // Deterministic fix: when one clear city owns the neighborhood, trust it over AI guess.
    city = onlyNeighborhoodCityCandidate;
  }

  if ((!city || city === beforeCity) && inferredCityFromNeighborhood) {
    city = inferredCityFromNeighborhood;
  }

  if ((!city || city === beforeCity) && inferred.city) {
    city = sanitizeLocationCandidate(inferred.city, {
      type: "city",
      adText,
      knownOptions: dynamicHints.cities,
    });
  }

  if ((!subcity || subcity === beforeCity) && city) {
    subcity = city;
  }

  if (!subcity && fallbackLocation.city) {
    subcity = fallbackLocation.city;
  }

  if (neighborhood === city || neighborhood === beforeCity) {
    neighborhood = isHasak ? "" : "لم يذكر";
  }

  if (isHasak) {
    const cleanNeighborhood =
      neighborhood && !["لم يذكر", "لا يوجد", "غير محدد"].includes(neighborhood)
        ? neighborhood
        : "";

    meta.before_City = beforeCity || "";
    meta.before_city = beforeCity || "";
    meta.city = city || "";
    meta.subcity = subcity || city || "";
    meta.City = meta.subcity || meta.city || "";
    meta.neighborhood = cleanNeighborhood;
    meta.location = cleanNeighborhood;
    meta.full_location = buildFullLocationValue(meta, "") || "";
    return;
  }

  meta.before_City = beforeCity || "";
  meta.before_city = beforeCity || "";
  meta.city = city || beforeCity || "";
  meta.subcity = subcity || city || "";
  meta.City = meta.subcity || meta.city;
  meta.neighborhood = normalizeNeighborhoodName(neighborhood) || "لم يذكر";
  meta.location = meta.neighborhood;
  meta.full_location = buildFullLocationValue(meta, "") || "";
}

function normalizePriceMeta(meta) {
  ["price_amount", "from_price", "to_price", "arc_space", "area"].forEach(
    (field) => {
      meta[field] = extractNumericValue(meta[field]);
    },
  );

  meta.price_type = normalizeArabicText(meta.price_type || meta.price || "");

  if (
    meta.price_type.includes("عند التواصل") ||
    meta.price_type.includes("على السوم")
  ) {
    meta.price_amount = "";
    meta.from_price = "";
    meta.to_price = "";
  }

  if (!meta.order_space && meta.arc_space !== "") {
    meta.order_space = `${meta.arc_space} متر مربع`;
  }

  if (meta.price_amount !== "" && !meta.from_price && !meta.to_price) {
    meta.from_price = meta.price_amount;
    meta.to_price = meta.price_amount;
  }
}

function inferPriceMethodFromText(adText = "", meta = {}) {
  const normalized = normalizeArabicText(
    [
      adText,
      firstNonEmpty(meta.price_method, ""),
      firstNonEmpty(meta.payment_method, ""),
      firstNonEmpty(meta.price_type, ""),
      firstNonEmpty(meta.price, ""),
    ]
      .filter(Boolean)
      .join(" "),
  );

  if (!normalized) return "";

  if (
    /(?:تقسيط|أقساط|اقساط|دفعة|دفعات|شهري|شهرياً|سنوي|سنوياً)/i.test(normalized)
  ) {
    return "تقسيط";
  }

  if (/(?:كاش|نقد|نقدا|نقدًا|فوري)/i.test(normalized)) {
    return "كاش";
  }

  if (/(?:على\s*السوم|السوم\s*وصل)/i.test(normalized)) {
    return "على السوم";
  }

  if (/(?:عند\s*التواصل)/i.test(normalized)) {
    return "عند التواصل";
  }

  if (/(?:للمتر|للمتر\s*المربع|ريال\s*للمتر)/i.test(normalized)) {
    return "ريال للمتر";
  }

  if (/(?:إجمالي|اجمالي|صافي|نهائي)/i.test(normalized)) {
    return "إجمالي";
  }

  return "";
}

function normalizePriceMethodMeta(meta, adText = "") {
  // Business rule: do not fill payment method fields from AI or fallbacks.
  meta.price_method = "";
  meta.payment_method = "";
}

function hasRequestIntent(text = "") {
  const normalized = normalizeArabicText(text);
  if (!normalized) return false;

  return /(?:مطلوب|ابحث عن|ادور|أدور|احتاج|محتاج|من عنده|مين عنده|حد عنده|تكفون|ابغى اشتري|ابغا اشتري|ابي اشتري|ودي اشتري)/i.test(
    normalized,
  );
}

function hasOfferIntent(text = "") {
  const normalized = normalizeArabicText(text);
  if (!normalized) return false;

  return /(?:للبيع|للإيجار|للايجار|للأجار|للتقبيل|للتمليك|ابغى ابيع|ابغا ابيع|ابي ابيع|ودي ابيع|for sale|for rent)/i.test(
    normalized,
  );
}

function hasRealEstateCue(text = "") {
  const normalized = normalizeArabicText(text);
  if (!normalized) return false;

  if (detectPropertyTypeFromText(normalized)) {
    return true;
  }

  return /(?:عقار|عقارات|منزل|بيوت|قطعة\s*ارض|قطعة\s*أرض)/i.test(normalized);
}

function canonicalizeMasaakCategory(label) {
  const normalizedRaw = normalizeArabicText(label);
  if (!normalizedRaw) return "";

  if (/(?:شقة|شقه)\s*(?:دبلكسية|دبلكسيه|دبلكس|دوبلكس)/i.test(normalizedRaw)) {
    return "شقة دبلكسية";
  }
  if (/(?:أرض|ارض)\s*زراع(?:ي|ية|يه)/i.test(normalizedRaw)) {
    return "مزرعة";
  }

  const trustedCategory = resolveTrustedMainCategory(normalizedRaw, "masaak");
  if (trustedCategory) {
    return trustedCategory;
  }

  const aliases = {
    ارض: "أرض",
    شقه: "شقة",
    عماره: "عمارة",
    مزرعه: "مزرعة",
    استراحه: "استراحة",
    شاليه: "شالية",
    فيله: "فيلا",
    فلة: "فيلا",
    فله: "فيلا",
    دوبلكس: "دبلكس",
    منزل: "بيت",
    بيوت: "بيت",
    طلب: "طلبات",
  };

  const aliasedCategory = aliases[normalizedRaw];
  if (aliasedCategory) {
    return resolveTrustedMainCategory(aliasedCategory, "masaak");
  }

  return "";
}

function hasStrongFarmCategoryCue(adText = "", subcategory = "") {
  const text = normalizeArabicText(adText || "");
  const sub = normalizeArabicText(subcategory || "");
  const combined = normalizeArabicText([text, sub].filter(Boolean).join(" "));

  if (!combined) return false;

  if (/(?:أرض|ارض)\s*زراع(?:ي|ية|يه)/i.test(combined)) {
    return true;
  }

  if (
    /\bزراع(?:ي|ية|يه)\b/i.test(combined) &&
    /(?:أرض|ارض|مزرعة|مزرعه)/i.test(combined)
  ) {
    return true;
  }

  if (
    /(?:مزرعة|مزرعه)\b/i.test(combined) &&
    !/(?:التصنيف|التصنيف\s*الفرعي|الفئة|الفئة\s*الفرعية|category|subcategory)/i.test(
      combined,
    )
  ) {
    if (!/(?:أرض|ارض|قطعة\s*أرض|قطعة\s*ارض)/i.test(text)) {
      return true;
    }

    if (
      /(?:مزرعة|مزرعه)\s*(?:للبيع|للإيجار|للايجار|مسورة|مسوّرة|مسيجة|نخيل|بئر|بير|آبار|صك|مشاع|وقف|عرق|ري|رشاش|استثمارية|سكنية|مثمرة)/i.test(
        combined,
      )
    ) {
      return true;
    }
  }

  return false;
}

function inferStrictMasaakCategoryFromText(adText = "") {
  const text = normalizeArabicText(adText || "");
  if (!text) return "";

  if (/(?:شقة|شقه)\s*(?:دبلكسية|دبلكسيه|دبلكس|دوبلكس)/i.test(text)) {
    return "شقة دبلكسية";
  }
  if (hasStrongFarmCategoryCue(text)) {
    return "مزرعة";
  }
  if (/(?:دبلكس|دوبلكس)/i.test(text)) {
    return "دبلكس";
  }
  if (/(?:فيلا|فله|فلة|فيله)/i.test(text)) {
    return "فيلا";
  }
  if (/(?:شقة|شقه)/i.test(text)) {
    return "شقة";
  }
  if (/(?:بيت|منزل|بيوت)/i.test(text)) {
    return "بيت";
  }
  if (/(?:عمارة|عماره)/i.test(text)) {
    return "عمارة";
  }
  if (/(?:أرض|ارض|قطعة\s*أرض|قطعة\s*ارض)/i.test(text)) {
    return "أرض";
  }

  return "";
}

function normalizeMasaakSubcategory(
  category = "",
  subcategory = "",
  adText = "",
) {
  const normalizedCategory = canonicalizeMasaakCategory(category);
  if (!normalizedCategory) return "";

  if (MASAAK_FORCE_EMPTY_SUBCATEGORY_CATEGORIES.has(normalizedCategory)) {
    return "";
  }

  const normalizedSubcategory = normalizeArabicText(subcategory || "");
  const text = normalizeArabicText(adText || "");
  const findByPatterns = (patterns = []) => {
    const fromSubcategory = patterns.find(({ regex }) =>
      regex.test(normalizedSubcategory),
    );
    if (fromSubcategory) return fromSubcategory.value;

    const fromText = patterns.find(({ regex }) => regex.test(text));
    if (fromText) return fromText.value;

    return "";
  };

  if (normalizedCategory === "بيت") {
    return findByPatterns([
      { regex: /دورين/i, value: "دورين" },
      { regex: /عربي/i, value: "عربي" },
      { regex: /دور/i, value: "دور" },
    ]);
  }

  if (normalizedCategory === "أرض" || normalizedCategory === "عمارة") {
    return findByPatterns([
      { regex: /تجار(?:ي|ية)/i, value: "تجارية" },
      { regex: /سكن(?:ي|ية)/i, value: "سكنية" },
    ]);
  }

  if (normalizedCategory === "مزرعة") {
    return findByPatterns([
      { regex: /صك/i, value: "صك" },
      { regex: /مشاع/i, value: "مشاع" },
      { regex: /وقف/i, value: "وقف" },
      { regex: /عرق/i, value: "عرق" },
      { regex: /(?:(?:أرض|ارض)\s*)?زراع(?:ي|ية|يه)/i, value: "أرض زراعية" },
    ]);
  }

  return resolveTrustedSubcategory(normalizedCategory, subcategory, "masaak");
}

function enforceMasaakCategorySubcategoryReference(meta, adText = "") {
  if (!isObject(meta)) return;

  const textCategoryHint = inferStrictMasaakCategoryFromText(adText);
  const currentSubcategory = firstNonEmpty(
    meta.sub_catt,
    meta.subcategory,
    meta.arc_subcategory,
    "",
  );
  let category = canonicalizeMasaakCategory(
    firstNonEmpty(meta.parent_catt, meta.category, meta.arc_category),
  );
  const hasFarmCue = hasStrongFarmCategoryCue(adText, currentSubcategory);

  if (!category && textCategoryHint) {
    category = textCategoryHint;
  } else if (textCategoryHint && isTrustedHasakCategory(category)) {
    category = textCategoryHint;
  }

  if (category === "أرض" && hasFarmCue) {
    category = "مزرعة";
  }

  if (
    category === "مزرعة" &&
    !hasFarmCue &&
    /(?:أرض|ارض|قطعة\s*أرض|قطعة\s*ارض)/i.test(normalizeArabicText(adText))
  ) {
    category = "أرض";
  }

  if (!category) return;

  const normalizedSubcategory = normalizeMasaakSubcategory(
    category,
    currentSubcategory,
    adText,
  );

  meta.category = category;
  meta.parent_catt = category;
  meta.arc_category = category;

  if (MASAAK_FORCE_EMPTY_SUBCATEGORY_CATEGORIES.has(category)) {
    meta.subcategory = "";
    meta.sub_catt = "";
    meta.arc_subcategory = "";
  } else if (
    Object.prototype.hasOwnProperty.call(
      MASAAK_STRICT_SUBCATEGORY_RULES,
      category,
    )
  ) {
    meta.subcategory = normalizedSubcategory || "";
    meta.sub_catt = normalizedSubcategory || "";
    meta.arc_subcategory = normalizedSubcategory || "";
  }

  const categoryId = resolveCategoryId(category, "masaak");
  if (categoryId) {
    meta.category_id = categoryId;
  }
}

function normalizeWordPressCategoryMeta(meta, adText = "") {
  const normalizedAdText = normalizeArabicText(adText || "");
  const offerInText = hasOfferIntent(normalizedAdText);
  const requestInText = hasRequestIntent(normalizedAdText);
  const realEstateInText = hasRealEstateCue(normalizedAdText);
  const inferredPropertyCategory = canonicalizeMasaakCategory(
    detectPropertyTypeFromText(normalizedAdText),
  );

  const rawCategoryCandidate = normalizeCategoryLabel(
    firstNonEmpty(meta.category, meta.arc_category, meta.parent_catt),
  );
  const trustedHasakCategoryFromMeta = resolveTrustedMainCategory(
    rawCategoryCandidate,
    "hasak",
  );
  let candidateCategory = canonicalizeMasaakCategory(rawCategoryCandidate);
  if (!candidateCategory && inferredPropertyCategory) {
    candidateCategory = inferredPropertyCategory;
  }

  const candidateSubCategory = candidateCategory
    ? resolveTrustedSubcategory(
        candidateCategory,
        firstNonEmpty(meta.subcategory, meta.arc_subcategory, meta.sub_catt),
        "masaak",
      )
    : "";

  if (!meta.category) {
    meta.category = candidateCategory || trustedHasakCategoryFromMeta || "";
  }
  if (!meta.subcategory) meta.subcategory = candidateSubCategory;

  const shouldPreferRealEstateFromText =
    offerInText && realEstateInText && !!inferredPropertyCategory;
  const hasakCategory = [
    meta.category,
    meta.parent_catt,
    meta.arc_category,
    rawCategoryCandidate,
  ]
    .map((value) => resolveTrustedMainCategory(value, "hasak"))
    .find(Boolean);

  if (hasakCategory && !shouldPreferRealEstateFromText) {
    meta.category = hasakCategory;
    meta.arc_category = hasakCategory;
    meta.parent_catt = "";
    meta.sub_catt = "";
    meta.subcategory = "";
    meta.arc_subcategory = "";

    if (!meta.category_id) {
      meta.category_id = resolveCategoryId(hasakCategory, "hasak");
    }

    return;
  }

  const requestByMetaCategory =
    meta.category === "طلبات" ||
    meta.parent_catt === "طلبات" ||
    Number(meta.category_id) === 83;
  const requestByTypeHint =
    /طلب/.test(normalizeArabicText(meta.ad_type)) ||
    /طلب/.test(
      normalizeArabicText(firstNonEmpty(meta.order_type, meta.offer_type)),
    );

  const requestFromText = requestInText && !offerInText;
  const forceOfferFromText = offerInText && realEstateInText && !requestInText;

  const isRequestCategory =
    (requestByMetaCategory || requestByTypeHint || requestFromText) &&
    !forceOfferFromText;

  if (!isRequestCategory && requestByMetaCategory) {
    meta.category = "";
    meta.parent_catt = "";
    meta.category_id = "";
    if (normalizeArabicText(meta.order_status).includes("طلب")) {
      meta.order_status = "عرض جديد";
    }
    if (normalizeArabicText(meta.offer_status).includes("طلب")) {
      meta.offer_status = "عرض جديد";
    }
  }

  if (isRequestCategory) {
    meta.category = "طلبات";
    meta.category_id = 83;
    meta.parent_catt = "طلبات";
    meta.sub_catt = "";
    meta.subcategory = "";
    meta.arc_category = "";
    meta.arc_subcategory = "";
    meta.order_status = meta.order_status || "طلب جديد";
    meta.offer_status = meta.offer_status || "طلب جديد";
    return;
  }

  meta.parent_catt = meta.parent_catt || candidateCategory;
  meta.sub_catt = meta.sub_catt || candidateSubCategory;
  meta.arc_category =
    meta.arc_category || meta.parent_catt || candidateCategory;
  meta.arc_subcategory =
    meta.arc_subcategory || meta.sub_catt || candidateSubCategory;
  meta.category = meta.category || meta.parent_catt || meta.arc_category;
  meta.subcategory = meta.subcategory || meta.sub_catt || meta.arc_subcategory;
  enforceMasaakCategorySubcategoryReference(meta, normalizedAdText);

  if (!meta.category_id) {
    meta.category_id = resolveCategoryId(
      meta.category || meta.parent_catt || meta.arc_category,
      "masaak",
    );
  }
}

const FORBIDDEN_DESCRIPTION_PATTERNS = [
  // روابط مباشرة
  /https?:\/\/[^\s<]+/giu,
  // نطاقات مباشرة حتى بدون http/https
  /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|sa|me|co|info|app|dev|io|biz|ws|ly)(?:\/[^\s<]*)?/giu,
  // روابط ومنصات تواصل
  /\b(?:chat\.whatsapp\.com|wa\.me|api\.whatsapp\.com|t\.me|telegram\.me|instagram\.com|instagr\.am|snapchat\.com|youtube\.com|youtu\.be|twitter\.com|x\.com|tiktok\.com|facebook\.com|fb\.com)\b/giu,

  // كلمات تدل على حسابات / سوشيال
  /(?:سناب|سنابي|snap(?:chat)?|انستا(?:غرام)?|instagram|insta|تل(?:ي)?جرام|telegram|تويتر|twitter|تيك\s*توك|tiktok|يوتيوب|youtube|فيس(?:بوك)?|facebook|معرف|يوزر(?:\s*نيم)?|اسم\s*المستخدم|الحساب|حساب(?:نا)?|تابعنا|follow\s*us)/giu,

  // وساطة / وكالة / كيانات عقارية / ترخيص
  /(?:مكتب\s*عقار(?:ي|يه)?|شركة\s*عقاري(?:ة|ه)|مؤسسة\s*عقاري(?:ة|ه)|الهي(?:ي|ئ)ة\s*العامة\s*للعقار|معلن\s*معتمد|مرخ[صس]|ترخيص|رخص(?:ة|ه)|رقم\s*(?:الترخيص|الرخص(?:ة|ه)|فال)|فال|وسيط|وساطة|وساطه|سمسار|التسويق\s*العقاري|تسويق\s*عقاري|ادارة\s*املاك|إدارة\s*أملاك|مفوض|مفوّض|وكيل|الوكيل)/giu,

  // صيغ تسويقية خليجية/عقارية مش مرغوبة
  /(?:مباشر(?:ة)?|من\s*المالك|من\s*الوكيل|من\s*المعلن|طرف\s*(?:اول|أول)|بدون\s*وسيط|بدون\s*عمولة|بدون\s*سعي|لا\s*يوجد\s*سعي)/giu,

  // جروبات ودعوات تواصل
  /(?:(?:قروب|جروب|مجموعة)\s*(?:واتساب|تل(?:ي)?جرام)?|انضم(?:ام)?|لل?انضمام|join)/giu,

  // عبارات تواصل
  /(?:للتواصل|للاستفسار|اتصال|اتصل|راسلنا|كلمنا|تواصل(?:وا)?(?:\s*معنا)?|واتساب|واتس(?:اب)?|جوال|هاتف|موبايل|محمول)/giu,

  // عبارات تسويقية/مكتبية يجب حذفها من الوصف
  /(?:مستعد(?:ون)?\s*لتسويق(?:\s*عقاراتكم|\s*عقارك)?|نسوق(?:\s*عقاراتكم|\s*عقارك)?|نستقبل(?:\s*عروض)?|استقبال\s*عروض|تسويق\s*عقاراتكم|تسويق\s*عقارك|عرضك\s*علينا|لدينا\s*عروض|يوجد\s*لدينا\s*عروض|مجموعة\s*عروضات?|عروضات|للإعلانات|للاعلانات|للنشر)/giu,

  // أرقام ترخيص / فال / أرقام بعد "برقم"
  /(?:رقم\s*(?:الترخيص|الرخص(?:ة|ه)|فال)|برقم)\s*[:：-]?\s*[0-9٠-٩]{4,}/giu,

  // أرقام جوالات سعودية
  /(?:(?:\+?966|00966|966)[\s\-()]*5[0-9٠-٩](?:[\s\-()]*[0-9٠-٩]){7}\b|0[\s\-()]*5[0-9٠-٩](?:[\s\-()]*[0-9٠-٩]){7}\b|\b5[0-9٠-٩](?:[\s\-()]*[0-9٠-٩]){7}\b)/gu,

  // أي رقم تواصل بعد كلمة دالة
  /(?:رقم\s*(?:التواصل|الجوال|الهاتف|الموبايل|المحمول)?\s*[:：-]?\s*)(?:\+?[0-9٠-٩][0-9٠-٩\s\-()]{6,}[0-9٠-٩])/giu,

  // صيغ أسماء المالك داخل السطور
  /(?:اسم\s*المالك\s*[:：-]?\s*|(?:^|[\s:：-])مالك\s+)(?:[\u0600-\u06FFA-Za-z]{2,}(?:\s+|$)){1,3}/giu,
];

const OWNER_ADMIN_DETAIL_PATTERNS = [
  /(?:اسم\s*المالك|المالك|مالك\s*العقار|صاحب\s*العقار|صاحب\s*الإعلان|اسم\s*المعلن|المعلن)/i,
  /(?:^|[\s:：-])مالك(?:\s+|$)/i,
  /(?:مكتب|وسيط|سمسار|ترخيص|رخصة|رقم\s*الترخيص|رقم\s*المعلن|شركة(?:\s*عقارية)?|مؤسسة(?:\s*عقارية)?|وكيل|الوكيل)/i,
  /(?:وساطة|وساطه|التسويق\s*العقاري|تسويق\s*عقاري|إدارة\s*أملاك|ادارة\s*املاك)/i,
  /(?:سناب|snap(?:chat)?|انستا(?:غرام)?|instagram|insta|تل(?:ي)?جرام|telegram|تويتر|twitter|x\.com|تيك\s*توك|tiktok|يوتيوب|youtube|فيس(?:بوك)?|facebook|معرف|يوزر|الحساب|حساب(?:نا)?)/i,
  /(?:قروب|جروب|مجموعة(?:\s*واتساب)?|انضمام)/i,
  /(?:للتواصل|للاستفسار|اتصال|واتساب|جوال|هاتف|موبايل|محمول|رقم\s*التواصل|رقم\s*الجوال|رقم\s*الموبايل|رقم\s*المحمول|☎|📞|📱)/i,
  /(?:مباشر(?:ة)?|من\s*الوكيل|من\s*المالك|طرف)/i,
  /(?:مستعد(?:ون)?\s*لتسويق(?:\s*عقاراتكم|\s*عقارك)?|نسوق(?:\s*عقاراتكم|\s*عقارك)?|نستقبل(?:\s*عروض)?|استقبال\s*عروض|تسويق\s*عقاراتكم|تسويق\s*عقارك|عرضك\s*علينا|لدينا\s*عروض|يوجد\s*لدينا\s*عروض|مجموعة\s*عروضات?|عروضات|للإعلانات|للاعلانات|للنشر)/i,
];

const FULLY_REMOVABLE_SOURCE_LINE_PATTERNS = [
  /(?:^|[\s:：-])مالك(?:\s+|$)/i,
  /(?:مكتب|وسيط|وساطة|وساطه|سمسار|شركة(?:\s*عقارية)?|مؤسسة(?:\s*عقارية)?|وكيل|الوكيل|التسويق\s*العقاري|تسويق\s*عقاري|إدارة\s*أملاك|ادارة\s*املاك)/i,
  /(?:رقم\s*الترخيص|ترخيص|رخصة|معلن\s*معتمد|الهيئة\s*العامة\s*للعقار|فال)/i,
  /(?:قروب|جروب|مجموعة(?:\s*واتساب)?|انضمام|join\s+group)/i,
  /(?:chat\.whatsapp\.com|wa\.me|t\.me|سناب|snap(?:chat)?|انستا(?:غرام)?|instagram|insta|تل(?:ي)?جرام|telegram|تويتر|twitter|x\.com|تيك\s*توك|tiktok|يوتيوب|youtube|فيس(?:بوك)?|facebook)/i,
  /(?:للتواصل|للاستفسار|اتصال|واتساب|جوال|هاتف|موبايل|محمول|رقم\s*(?:التواصل|الجوال|الهاتف|الموبايل|المحمول)?)/i,
  /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|sa|me|co|info|app|dev|io|biz|ws|ly)(?:\/[^\s<]*)?/i,
  /(?:مستعد(?:ون)?\s*لتسويق(?:\s*عقاراتكم|\s*عقارك)?|نسوق(?:\s*عقاراتكم|\s*عقارك)?|نستقبل(?:\s*عروض)?|استقبال\s*عروض|تسويق\s*عقاراتكم|تسويق\s*عقارك|عرضك\s*علينا|لدينا\s*عروض|يوجد\s*لدينا\s*عروض|مجموعة\s*عروضات?|عروضات|للإعلانات|للاعلانات|للنشر)/i,
  /(?:☎|📞|📱)/i,
];

const REAL_ESTATE_KEYWORDS = [
  "أرض",
  "ارض",
  "شقة",
  "شقه",
  "فيلا",
  "فلة",
  "بيت",
  "عمارة",
  "عماره",
  "دبلكس",
  "مزرعة",
  "مزرعه",
  "استراحة",
  "استراحه",
  "شاليه",
  "محل",
  "مستودع",
  "عقار",
];

function shouldApplyForbiddenDescriptionRules(targetWebsite = "masaak") {
  return true;
}

function removeForbiddenInlineContent(text, targetWebsite = "masaak") {
  let cleaned = String(text ?? "");

  if (shouldApplyForbiddenDescriptionRules(targetWebsite)) {
    FORBIDDEN_DESCRIPTION_PATTERNS.forEach((pattern) => {
      cleaned = cleaned.replace(pattern, "");
    });
    cleaned = stripPhoneLikeNumbers(cleaned);
  }

  return normalizeArabicText(
    cleaned
      .replace(/[*`#]+/g, "")
      .replace(/[~]{2,}/g, " ")
      .replace(/[ \t]{2,}/g, " ")
      .trim(),
  );
}

function isDecorativeOrNoiseLine(line = "") {
  const normalized = normalizeWhitespace(line || "");
  if (!normalized) return true;

  const compact = normalized.replace(/\s+/g, "");
  if (!compact) return true;

  if (/^[\-–—_.*~،,;:\/\\|+=(){}\[\]<>•·▪▫⬅➡↩♦️]+$/u.test(compact)) {
    return true;
  }

  const alphaNumericCount = (
    normalized.match(/[\u0600-\u06FFA-Za-z0-9٠-٩]/gu) || []
  ).length;

  if (alphaNumericCount === 0) {
    return true;
  }

  return alphaNumericCount <= 2 && compact.length >= alphaNumericCount + 4;
}

function isOwnerOrAdministrativeDetailLine(line = "", targetWebsite = "masaak") {
  if (!shouldApplyForbiddenDescriptionRules(targetWebsite)) return false;

  const normalized = normalizeArabicText(line || "");
  if (!normalized) return false;

  return OWNER_ADMIN_DETAIL_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
}

function hasPropertyDetailSignals(line = "") {
  const normalized = normalizeArabicText(line || "");
  if (!normalized) return false;

  if (
    REAL_ESTATE_KEYWORDS.some((keyword) =>
      normalized.includes(normalizeArabicText(keyword)),
    )
  ) {
    return true;
  }

  return /(?:المساحة|مساحة|السعر|العمر|واجهة|شارع|غرف|غرفة|صالة|حمام|مطبخ|مجلس|دور|مدخل|مواقف|مصعد|مؤجر|دخل|صك|عداد|خزان|حي|مخطط|متر|مليون|ألف|ريال|للبيع|للإيجار|للايجار|للتقبيل)/i.test(
    normalized,
  );
}

function isLikelyContactNameLine(line = "") {
  const normalized = normalizeArabicText(line || "");
  if (!normalized || hasPropertyDetailSignals(normalized)) return false;
  if (/[0-9٠-٩]/.test(normalized)) return false;

  const stripped = normalizeWhitespace(normalized.replace(/[☎📞📱]/gu, ""));
  if (!stripped) return false;

  const wordCount = stripped.split(/\s+/).filter(Boolean).length;
  if (wordCount === 0 || wordCount > 3 || stripped.length > 30) {
    return false;
  }

  if (!/^[\u0600-\u06FF\s]+$/u.test(stripped)) {
    return false;
  }

  return /[☎📞📱]/u.test(normalized);
}

function looksLikeResidualAdministrativeLine(
  line = "",
  previousLineWasAdministrative = false,
  targetWebsite = "masaak",
) {
  if (!shouldApplyForbiddenDescriptionRules(targetWebsite)) return false;

  const normalized = normalizeArabicText(line || "");
  if (!normalized) return false;

  if (
    /(?:سناب|snap(?:chat)?|انستا(?:غرام)?|instagram|insta|تل(?:ي)?جرام|telegram|تويتر|twitter|x\.com|تيك\s*توك|tiktok|يوتيوب|youtube|فيس(?:بوك)?|facebook|معرف|يوزر|الحساب|حساب(?:نا)?)/i.test(
      normalized,
    )
  ) {
    return true;
  }

  if (!previousLineWasAdministrative) return false;

  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  const looksLikeShortNameOrHandle =
    wordCount <= 4 &&
    normalized.length <= 30 &&
    /^[\u0600-\u06FFa-z0-9_.@+\-~\s☎📞📱]+$/iu.test(normalized);

  return looksLikeShortNameOrHandle && !hasPropertyDetailSignals(normalized);
}

function shouldDropDescriptionLine(
  line = "",
  previousLineWasAdministrative = false,
  targetWebsite = "masaak",
) {
  if (!shouldApplyForbiddenDescriptionRules(targetWebsite)) return false;

  const normalized = normalizeArabicText(line || "");
  if (!normalized) return false;

  if (isDecorativeOrNoiseLine(normalized) || isLikelyContactNameLine(normalized)) {
    return true;
  }

  if (
    looksLikeResidualAdministrativeLine(
      normalized,
      previousLineWasAdministrative,
      targetWebsite,
    )
  ) {
    return true;
  }

  const isAdministrativeLine = FULLY_REMOVABLE_SOURCE_LINE_PATTERNS.some(
    (pattern) => pattern.test(normalized),
  );

  return isAdministrativeLine && !hasPropertyDetailSignals(normalized);
}

function collectSanitizedAdLines(
  adText,
  limit = 20,
  targetWebsite = "masaak",
) {
  const source = String(adText ?? "")
    .replace(/<[^>]+>/g, "\n")
    .replace(/\r/g, "\n");

  const sanitizedLines = [];
  let previousLineWasAdministrative = false;

  for (const rawLine of source.split(/\n+/)) {
    const candidate = stripAdReferenceNumbers(rawLine)
      .replace(/^[\-*•:]+/g, "")
      .trim();

    if (!candidate) {
      previousLineWasAdministrative = false;
      continue;
    }

    if (isDecorativeOrNoiseLine(candidate)) {
      previousLineWasAdministrative = false;
      continue;
    }

    if (
      shouldDropDescriptionLine(
        candidate,
        previousLineWasAdministrative,
        targetWebsite,
      )
    ) {
      previousLineWasAdministrative = true;
      continue;
    }

    const cleaned = stripAdReferenceNumbers(
      removeForbiddenInlineContent(candidate, targetWebsite),
    )
      .replace(/^[\-*•:]+/g, "")
      .replace(/[↩⬅➡]+/g, " ")
      .trim();

    if (
      !cleaned ||
      isOwnerOrAdministrativeDetailLine(cleaned, targetWebsite) ||
      looksLikeResidualAdministrativeLine(
        cleaned,
        previousLineWasAdministrative,
        targetWebsite,
      )
    ) {
      previousLineWasAdministrative = true;
      continue;
    }

    sanitizedLines.push(cleaned);
    previousLineWasAdministrative = false;

    if (sanitizedLines.length >= limit) {
      break;
    }
  }

  return unique(sanitizedLines);
}

function buildCleanMainAdText(adText, targetWebsite = "masaak") {
  const cleanedLines = collectSanitizedAdLines(adText, 40, targetWebsite);
  if (cleanedLines.length > 0) {
    return cleanedLines.join("\n");
  }

  return removeForbiddenInlineContent(
    stripAdReferenceNumbers(adText || ""),
    targetWebsite,
  );
}

function extractCleanDescriptionLines(adText, targetWebsite = "masaak") {
  return collectSanitizedAdLines(adText, 20, targetWebsite).filter(
    (line) => line.length >= 3,
  );
}

function shouldDropSanitizedDescriptionText(text, targetWebsite = "masaak") {
  const original = stripAdReferenceNumbers(stripHtml(String(text ?? "")))
    .replace(/^[\-*•:]+/g, "")
    .trim();
  if (!original) {
    return true;
  }

  if (
    isDecorativeOrNoiseLine(original) ||
    isOwnerOrAdministrativeDetailLine(original, targetWebsite) ||
    isLikelyContactNameLine(original) ||
    shouldDropDescriptionLine(original, false, targetWebsite)
  ) {
    return true;
  }

  const normalized = stripAdReferenceNumbers(
    removeForbiddenInlineContent(
      original,
      targetWebsite,
    ),
  )
    .replace(/^[\-*•:]+/g, "")
    .replace(/[↩⬅➡]+/g, " ")
    .trim();

  if (!normalized || isDecorativeOrNoiseLine(normalized)) {
    return true;
  }

  return (
    isOwnerOrAdministrativeDetailLine(normalized, targetWebsite) ||
    isLikelyContactNameLine(normalized) ||
    shouldDropDescriptionLine(normalized, false, targetWebsite) ||
    looksLikeResidualAdministrativeLine(normalized, false, targetWebsite)
  );
}

function sanitizeGeneratedHtmlDescription(html, targetWebsite = "masaak") {
  let cleanedHtml = sanitizeHtml(html);
  if (!cleanedHtml || !shouldApplyForbiddenDescriptionRules(targetWebsite)) {
    return cleanedHtml;
  }

  cleanedHtml = cleanedHtml.replace(
    /<(li|p)>([\s\S]*?)<\/\1>/giu,
    (match, tagName, innerHtml) => {
      if (shouldDropSanitizedDescriptionText(innerHtml, targetWebsite)) {
        return "";
      }

      const safeText = stripAdReferenceNumbers(
        removeForbiddenInlineContent(stripHtml(innerHtml), targetWebsite),
      )
        .replace(/^[\-*•:]+/g, "")
        .replace(/[↩⬅➡]+/g, " ")
        .trim();

      if (!safeText || isDecorativeOrNoiseLine(safeText)) {
        return "";
      }

      return `<${tagName}>${escapeHtml(safeText)}</${tagName}>`;
    },
  );

  cleanedHtml = cleanedHtml
    .replace(/<ul>\s*<\/ul>/gi, "")
    .replace(/<p>\s*<\/p>/gi, "")
    .replace(/<h2>\s*[^<]+\s*<\/h2>\s*(?=(?:<h2>|$))/gi, "")
    .replace(/\n{2,}/g, "\n")
    .trim();

  return sanitizeHtml(cleanedHtml);
}

function sanitizeWordPressDraftData(wpData, targetWebsite = "masaak") {
  const safeData = isObject(wpData)
    ? {
        ...wpData,
        meta: isObject(wpData.meta) ? { ...wpData.meta } : {},
      }
    : { meta: {} };

  const safeTitle = removeForbiddenInlineContent(
    stripAdReferenceNumbers(firstNonEmpty(safeData.title, DEFAULT_WP_TITLE)),
    targetWebsite,
  );
  safeData.title = sanitizeTitle(safeTitle || DEFAULT_WP_TITLE);

  const rawContent = firstNonEmpty(safeData.content, safeData.description, "");
  safeData.content = rawContent
    ? sanitizeGeneratedHtmlDescription(rawContent, targetWebsite)
    : "";

  const rawExcerpt = stripHtml(firstNonEmpty(safeData.excerpt, ""));
  safeData.excerpt = normalizeArabicText(
    removeForbiddenInlineContent(
      stripAdReferenceNumbers(rawExcerpt),
      targetWebsite,
    ),
  );

  if (safeData.meta.main_ad) {
    safeData.meta.main_ad = normalizeArabicText(
      removeForbiddenInlineContent(
        stripAdReferenceNumbers(stripHtml(safeData.meta.main_ad)),
        targetWebsite,
      ),
    );
  }

  if (isOwnerOrAdministrativeDetailLine(safeData.meta.owner_name, targetWebsite)) {
    safeData.meta.owner_name = "المالك";
  }

  safeData.meta = enforceWordPressPhonePolicy(safeData.meta, targetWebsite);
  safeData.targetWebsite = targetWebsite;

  return safeData;
}

function sanitizeWordPressDataForStorage(wpData, targetWebsite = "masaak") {
  const safeTargetWebsite = normalizeArabicText(targetWebsite) || "masaak";
  const sanitized = sanitizeWordPressDraftData(wpData, safeTargetWebsite);

  sanitized.title = sanitizeTitle(
    removeForbiddenInlineContent(
      stripAdReferenceNumbers(firstNonEmpty(sanitized.title, DEFAULT_WP_TITLE)),
      safeTargetWebsite,
    ) || DEFAULT_WP_TITLE,
  );

  const normalizedMainAd = removeForbiddenInlineContent(
    stripAdReferenceNumbers(stripHtml(sanitized.meta?.main_ad || "")),
    safeTargetWebsite,
  );
  sanitized.meta.main_ad = normalizeArabicText(normalizedMainAd || "");

  if (sanitized.content) {
    sanitized.content = sanitizeGeneratedHtmlDescription(
      sanitized.content,
      safeTargetWebsite,
    );
  }

  sanitized.targetWebsite = safeTargetWebsite;

  return sanitized;
}

function hasForbiddenDescriptionContent(text, targetWebsite = "masaak") {
  if (!shouldApplyForbiddenDescriptionRules(targetWebsite)) return false;

  const value = String(text ?? "");
  if (value !== stripPhoneLikeNumbers(value)) {
    return true;
  }
  return FORBIDDEN_DESCRIPTION_PATTERNS.some((pattern) => {
    const safePattern = new RegExp(
      pattern.source,
      pattern.flags.replace(/g/g, ""),
    );
    return safePattern.test(value);
  });
}

function isLikelyRealEstateMeta(meta = {}, adText = "") {
  const categoriesBlob = normalizeArabicText(
    [
      meta.parent_catt,
      meta.arc_category,
      meta.category,
      meta.sub_catt,
      meta.arc_subcategory,
      meta.subcategory,
    ]
      .filter(Boolean)
      .join(" "),
  );

  const isRequestsBucket =
    Number(meta.category_id) === 83 || categoriesBlob.includes("طلبات");
  const hasRealEstateKeyword = REAL_ESTATE_KEYWORDS.some((keyword) =>
    categoriesBlob.includes(normalizeArabicText(keyword)),
  );
  const hasArea =
    extractNumericValue(firstNonEmpty(meta.arc_space, meta.area)) !== "";
  const textBlob = normalizeArabicText(adText || "");
  const hasRealEstateKeywordInText = REAL_ESTATE_KEYWORDS.some((keyword) =>
    textBlob.includes(normalizeArabicText(keyword)),
  );

  if (
    isRequestsBucket &&
    !hasRealEstateKeyword &&
    !hasRealEstateKeywordInText
  ) {
    return false;
  }

  return hasRealEstateKeyword || hasArea || hasRealEstateKeywordInText;
}

function detectPropertyTypeFromText(adText = "") {
  const text = normalizeArabicText(adText);
  if (!text) return "";

  if (/(?:شقة|شقه)\s*(?:دبلكسية|دبلكسيه|دبلكس|دوبلكس)/i.test(text)) {
    return "شقة دبلكسية";
  }
  if (/(?:أرض|ارض)\s*زراع(?:ي|ية|يه)/i.test(text)) {
    return "مزرعة";
  }

  const priority = [
    "عمارة",
    "عماره",
    "فيلا",
    "فيله",
    "بيت",
    "منزل",
    "بيوت",
    "شقة",
    "شقه",
    "أرض",
    "ارض",
    "دبلكس",
    "دوبلكس",
    "مزرعة",
    "مزرعه",
    "استراحة",
    "استراحه",
    "شاليه",
    "محل",
    "مستودع",
  ];

  const found = priority.find((keyword) =>
    text.includes(normalizeArabicText(keyword)),
  );
  if (!found) return "";

  const aliases = {
    عماره: "عمارة",
    فيله: "فيلا",
    منزل: "بيت",
    بيوت: "بيت",
    شقه: "شقة",
    ارض: "أرض",
    دوبلكس: "دبلكس",
    مزرعه: "مزرعة",
    استراحه: "استراحة",
    شاليه: "شالية",
  };

  return aliases[found] || found;
}

function formatPriceSummary(meta = {}, targetWebsite = "masaak") {
  const priceType = normalizeArabicText(meta.price_type || "");
  const priceAmount = extractNumericValue(meta.price_amount);
  const fromPrice = extractNumericValue(meta.from_price);
  const toPrice = extractNumericValue(meta.to_price);

  if (priceType.includes("عند التواصل") || priceType.includes("على السوم")) {
    return priceType || "عند التواصل";
  }

  if (
    typeof fromPrice === "number" &&
    typeof toPrice === "number" &&
    fromPrice > 0 &&
    toPrice > 0 &&
    fromPrice !== toPrice
  ) {
    return `من ${fromPrice} إلى ${toPrice} ريال`;
  }

  if (typeof priceAmount === "number" && priceAmount > 0) {
    return `${priceAmount} ريال`;
  }

  const freeTextPrice = removeForbiddenInlineContent(
    meta.price || "",
    targetWebsite,
  );
  return freeTextPrice || "لم يذكر";
}

function formatLocationSummary(meta = {}) {
  return buildFullLocationValue(meta, "") || "لم يذكر";
}

function pickTitleLocationLabel(meta = {}) {
  const fullLocation = normalizeArabicText(
    firstNonEmpty(meta.full_location, buildFullLocationValue(meta, "")),
  );
  if (fullLocation) {
    return fullLocation;
  }

  const fallback = normalizeArabicText(
    firstNonEmpty(
      meta.location,
      meta.neighborhood,
      meta.City,
      meta.subcity,
      meta.city,
      meta.before_City,
      meta.before_city,
      "",
    ),
  );
  return fallback;
}

function isGenericAutoLocationLabel(locationLabel = "") {
  const normalized = normalizeArabicText(locationLabel || "");
  if (!normalized) return false;

  const knownHints = [AL_AHSA_GOVERNORATE, ...DEFAULT_WP_CITY_OPTIONS];
  const matchedHints = knownHints.filter((hint) =>
    normalized.includes(normalizeArabicText(hint)),
  );
  const separatorsCount = (normalized.match(/[\/\\|]/g) || []).length;

  if (separatorsCount >= 1 && matchedHints.length >= 3) {
    return true;
  }

  if (
    normalized.includes("(") &&
    normalized.includes(")") &&
    matchedHints.length >= 3
  ) {
    return true;
  }

  return false;
}

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectLikelyLocationTokens(meta = {}) {
  const dynamicHints = getDynamicLocationHints(false);
  const knownDefaults = [
    AL_AHSA_GOVERNORATE,
    "الاحساء",
    ...DEFAULT_WP_CITY_OPTIONS,
  ];

  return unique(
    [
      meta.location,
      meta.neighborhood,
      meta.City,
      meta.subcity,
      meta.city,
      meta.before_City,
      meta.before_city,
      ...knownDefaults,
      ...(dynamicHints.beforeCities || []),
      ...(dynamicHints.cities || []),
    ]
      .map((value) => normalizeArabicText(value))
      .filter(
        (value) =>
          value &&
          !["لم يذكر", "لا يوجد", "غير محدد", "n/a", "na", "none"].includes(
            value,
          ),
      ),
  );
}

function stripInjectedHasakLocationFromTitle(title, meta = {}, adText = "") {
  const sanitized = sanitizeTitle(title || DEFAULT_WP_TITLE);
  let updated = normalizeArabicText(sanitized);
  const normalizedAdText = normalizeArabicText(adText || "");
  const locationTokens = collectLikelyLocationTokens(meta);

  if (locationTokens.length === 0 || !updated) {
    return sanitized;
  }

  locationTokens.forEach((token) => {
    if (!token || normalizedAdText.includes(token)) {
      return;
    }

    const escaped = escapeRegExp(token);
    const patterns = [
      new RegExp(`\\s*[\\(\\[]?\\s*في\\s+${escaped}\\s*[\\)\\]]?`, "gi"),
      new RegExp(
        `\\s*[\\(\\[]?\\s*ب(?:مدينة|محافظة)?\\s*${escaped}\\s*[\\)\\]]?`,
        "gi",
      ),
      new RegExp(`\\s*[\\(\\[]\\s*${escaped}\\s*[\\)\\]]`, "gi"),
      new RegExp(`\\s*[\\-–—،,/]\\s*${escaped}(?=\\s|$)`, "gi"),
      new RegExp(`\\s+${escaped}(?=\\s*$)`, "gi"),
    ];

    patterns.forEach((pattern) => {
      updated = updated.replace(pattern, " ");
    });
  });

  updated = normalizeWhitespace(
    updated
      .replace(/\(\s*\)/g, " ")
      .replace(/\[\s*\]/g, " ")
      .replace(/[،,/\-–—]{2,}/g, " ")
      .replace(/\s+[،,/\-–—]/g, " ")
      .replace(/[،,/\-–—]\s*$/g, ""),
  );

  return sanitizeTitle(updated || sanitized);
}

function ensureTitleContainsLocation(
  title,
  meta = {},
  adText = "",
  targetWebsiteHint = null,
) {
  const sanitized = sanitizeTitle(title || DEFAULT_WP_TITLE);
  const targetWebsite =
    targetWebsiteHint ||
    inferTargetWebsiteFromData(
      {
        category: meta.category,
        subcategory: meta.subcategory,
        meta,
      },
      adText,
    );

  if (targetWebsite === "hasak") {
    return stripInjectedHasakLocationFromTitle(sanitized, meta, adText);
  }

  const locationLabel = pickTitleLocationLabel(meta);

  if (
    !locationLabel ||
    ["لم يذكر", "لا يوجد", "غير محدد"].includes(locationLabel)
  ) {
    return sanitized;
  }

  if (isGenericAutoLocationLabel(locationLabel)) {
    return sanitized;
  }

  const normalizedTitle = normalizeArabicText(sanitized);
  const locationParts = locationLabel
    .split(/[-،,]/)
    .map((part) => normalizeArabicText(part))
    .filter(Boolean);

  const titleHasLocation = locationParts.some((part) =>
    normalizedTitle.includes(part),
  );
  if (titleHasLocation) {
    return sanitized;
  }

  return sanitizeTitle(`${sanitized} في ${locationLabel}`);
}

function buildRealEstateHtmlDescription({
  title,
  meta,
  adText,
  targetWebsite = "masaak",
}) {
  const cleanLines = extractCleanDescriptionLines(adText, targetWebsite);
  let propertyType = normalizeArabicText(
    firstNonEmpty(meta.parent_catt, meta.arc_category, meta.category, ""),
  );
  const detectedTypeFromText = detectPropertyTypeFromText(adText);
  const hasRealEstateType = REAL_ESTATE_KEYWORDS.some((keyword) =>
    propertyType.includes(normalizeArabicText(keyword)),
  );
  if (!propertyType || propertyType === "طلبات" || !hasRealEstateType) {
    propertyType = detectedTypeFromText || "عقار";
  }
  const subType = normalizeArabicText(
    firstNonEmpty(meta.sub_catt, meta.arc_subcategory, meta.subcategory),
  );
  const area = firstNonEmpty(meta.arc_space, meta.area);
  const priceSummary = formatPriceSummary(meta, targetWebsite);
  const locationSummary = formatLocationSummary(meta);

  const intro =
    removeForbiddenInlineContent(
      cleanLines.find((line) => line.length >= 12) || "",
      targetWebsite,
    ) ||
    `${propertyType || "عقار"} ${normalizeArabicText(meta.order_type || meta.offer_type || "للبيع")} في ${locationSummary}`;

  const specs = [];
  const consumedLines = new Set();
  if (propertyType) specs.push(`نوع العقار: ${propertyType}`);
  if (subType) specs.push(`التصنيف الفرعي: ${subType}`);
  if (area !== "") specs.push(`المساحة: ${area} متر مربع`);
  if (meta.age) specs.push(`عمر العقار: ${normalizeArabicText(meta.age)}`);
  if (meta.order_type || meta.offer_type) {
    specs.push(
      `نوع العملية: ${normalizeArabicText(firstNonEmpty(meta.order_type, meta.offer_type))}`,
    );
  }

  const specHintKeywords =
    /(واجهة|شارع|غرف|غرفة|صالة|حمام|مطبخ|مجلس|دور|مصعد|مواقف|أطوال|ارتداد|تشطيب|مؤثث|مكيف)/i;
  cleanLines.forEach((line) => {
    if (specHintKeywords.test(line) && specs.length < 12) {
      specs.push(line);
      consumedLines.add(line);
    }
  });

  const features = [];
  const adTextNormalized = normalizeArabicText(adText || "");
  const incomeMatch = convertArabicDigitsToEnglish(adTextNormalized).match(
    /(?:الدخل|الدخل السنوي|مدخول|الإيجار السنوي)[^0-9]{0,12}([0-9][0-9,\.]*)/i,
  );
  if (incomeMatch) {
    features.push(`الدخل السنوي: ${incomeMatch[1].replace(/,/g, "")} ريال`);
  }

  if (/غير\s*مرهون|بدون\s*رهن/i.test(adTextNormalized)) {
    features.push("حالة الرهن: غير مرهون");
  } else if (/مرهون|رهن/i.test(adTextNormalized)) {
    features.push("حالة الرهن: مرهون");
  }

  const featureHintKeywords =
    /(ميزة|مميزات|فرصة|جديد|مؤجر|مدخول|مرهون|صك|عداد|خزان)/i;
  cleanLines.forEach((line) => {
    if (featureHintKeywords.test(line) && features.length < 10) {
      features.push(line);
      consumedLines.add(line);
    }
  });

  // Preserve additional property details that are not owner/admin/contact details.
  cleanLines.forEach((line) => {
    if (consumedLines.has(line)) return;
    if (isOwnerOrAdministrativeDetailLine(line, targetWebsite)) return;

    if (/[:\-]/.test(line) && specs.length < 12) {
      specs.push(line);
      return;
    }

    if (features.length < 10) {
      features.push(line);
    }
  });

  const safeSpecs = unique(
    specs
      .map((item) => removeForbiddenInlineContent(item, targetWebsite))
      .filter(Boolean),
  );
  const safeFeatures = unique(
    features
      .map((item) => removeForbiddenInlineContent(item, targetWebsite))
      .filter(Boolean),
  );

  const specsHtml =
    safeSpecs.length > 0
      ? safeSpecs.map((item) => `<li>${escapeHtml(item)}</li>`).join("")
      : `<li>${escapeHtml("لم يتم ذكر تفاصيل إضافية")}</li>`;

  const featuresHtml =
    safeFeatures.length > 0
      ? safeFeatures.map((item) => `<li>${escapeHtml(item)}</li>`).join("")
      : `<li>${escapeHtml("فرصة مناسبة حسب المعطيات المتوفرة")}</li>`;

  const html = [
    `<h1>${escapeHtml(sanitizeTitle(title || DEFAULT_WP_TITLE))}</h1>`,
    `<p>${escapeHtml(intro)}</p>`,
    `<h2>${escapeHtml("المواصفات")}</h2>`,
    `<ul>${specsHtml}</ul>`,
    `<h2>${escapeHtml("المميزات")}</h2>`,
    `<ul>${featuresHtml}</ul>`,
    `<h2>${escapeHtml("السعر")}</h2>`,
    `<p>${escapeHtml(priceSummary)}</p>`,
    `<h2>${escapeHtml("الموقع")}</h2>`,
    `<p>${escapeHtml(locationSummary)}</p>`,
  ].join("");

  return sanitizeGeneratedHtmlDescription(html, targetWebsite);
}

function buildNonRealEstateHtmlDescription({
  title,
  meta,
  adText,
  targetWebsite = "masaak",
}) {
  const cleanLines = extractCleanDescriptionLines(adText, targetWebsite);
  const rawItemName = normalizeArabicText(
    firstNonEmpty(
      meta.sub_catt,
      meta.subcategory,
      meta.category,
      meta.parent_catt,
    ),
  );
  const titleHint = removeForbiddenInlineContent(
    stripAdReferenceNumbers(String(title || "")),
    targetWebsite,
  )
    .replace(/^(?:عرض|طلب)\s*/i, "")
    .replace(/^(?:للبيع|للإيجار|للايجار|للتقبيل|مطلوب)\s*/i, "")
    .trim();
  const itemName = rawItemName || normalizeArabicText(titleHint);
  const adType = normalizeArabicText(meta.ad_type || "");
  const orderType = normalizeArabicText(
    firstNonEmpty(meta.order_type, meta.offer_type, ""),
  );
  const isRequest = adType.includes("طلب") || Number(meta.category_id) === 83;
  const isBuyRequest = isRequest && orderType.includes("شراء");
  const isSellRequest = isRequest && orderType.includes("بيع");
  const itemLabel = itemName || "منتج";

  let heading = sanitizeTitle(title || DEFAULT_WP_TITLE);
  if (isBuyRequest) {
    heading = `مطلوب ${itemLabel} للشراء`;
  } else if (isSellRequest) {
    heading = `طلب بيع ${itemLabel}`;
  } else if (isRequest) {
    heading = `مطلوب ${itemLabel}`;
  }

  const detailParts = [];
  const consumedDetailLines = new Set();
  const goodsHintKeywords =
    /(حالة|مستعمل|جديد|نظيف|موديل|ماركة|ضمان|سبب البيع|ميزانية|سعر|مواصفات|استخدام|موعد|تاريخ|وقت|مكان|عدد|الحضور|الحجز|الاشتراك|برنامج|نشاط)/i;
  cleanLines.forEach((line) => {
    if (goodsHintKeywords.test(line) && detailParts.length < 8) {
      detailParts.push(line);
      consumedDetailLines.add(line);
    }
  });

  const priceSummary = formatPriceSummary(meta, targetWebsite);
  if (priceSummary && priceSummary !== "لم يذكر") {
    const hasPriceMention = detailParts.some((line) => {
      const normalizedLine = normalizeArabicText(line);
      return (
        normalizedLine.includes(normalizeArabicText(priceSummary)) ||
        normalizedLine.includes("السعر")
      );
    });

    if (!hasPriceMention) {
      detailParts.push(`السعر: ${priceSummary}`);
    }
  }

  // Keep as many product/property-specific details as possible.
  cleanLines.forEach((line) => {
    if (consumedDetailLines.has(line)) return;
    if (isOwnerOrAdministrativeDetailLine(line, targetWebsite)) return;
    if (detailParts.length < 14) {
      detailParts.push(line);
    }
  });

  if (detailParts.length === 0) {
    if (isBuyRequest) {
      detailParts.push(
        `أبحث عن ${itemLabel} بحالة جيدة مع مواصفات مناسبة للاستخدام المطلوب وميزانية واضحة.`,
      );
    } else if (isSellRequest || isRequest) {
      detailParts.push(
        `طلب يتعلق بـ ${itemLabel} مع توضيح الحالة والمواصفات والسعر المطلوب أو القابل للتفاوض.`,
      );
    } else {
      detailParts.push(
        `${itemLabel} بحالة مناسبة مع توضيح المميزات والحالة والسعر والتفاصيل الأساسية بشكل واضح.`,
      );
    }
  }

  const safeDetailParts = unique(
    detailParts
      .map((item) => removeForbiddenInlineContent(item, targetWebsite))
      .filter(Boolean),
  ).slice(0, 14);
  const intro =
    safeDetailParts[0] || `${itemLabel} مع تفاصيل واضحة حسب المعلومات المتاحة.`;
  const details = safeDetailParts.slice(1, 9);
  const extras = safeDetailParts.slice(9, 14);

  const detailsHtml =
    details.length > 0
      ? details.map((item) => `<li>${escapeHtml(item)}</li>`).join("")
      : `<li>${escapeHtml("لم يتم ذكر تفاصيل إضافية واضحة")}</li>`;
  const extrasHtml =
    extras.length > 0
      ? `<h2>${escapeHtml("معلومات إضافية")}</h2><ul>${extras
          .map((item) => `<li>${escapeHtml(item)}</li>`)
          .join("")}</ul>`
      : "";

  const html = `<h1>${escapeHtml(heading)}</h1><p>${escapeHtml(intro)}</p><h2>${escapeHtml(
    "التفاصيل",
  )}</h2><ul>${detailsHtml}</ul>${extrasHtml}`;
  return sanitizeGeneratedHtmlDescription(html, targetWebsite);
}

function buildDeterministicDescription({
  title,
  meta,
  adText,
  targetWebsite = "masaak",
}) {
  if (isLikelyRealEstateMeta(meta, adText)) {
    return buildRealEstateHtmlDescription({ title, meta, adText, targetWebsite });
  }

  return buildNonRealEstateHtmlDescription({
    title,
    meta,
    adText,
    targetWebsite,
  });
}

function normalizeWordPressData(
  rawData,
  adText,
  extractedPhones,
  isRegeneration,
) {
  const titleValue = firstNonEmpty(
    rawData.title,
    rawData.title?.rendered,
    rawData.title?.value,
  );
  const contentValue = firstNonEmpty(
    rawData.content,
    rawData.content?.rendered,
    rawData.content?.value,
    rawData.description,
  );
  const excerptValue = firstNonEmpty(
    rawData.excerpt,
    rawData.excerpt?.rendered,
    rawData.excerpt?.value,
  );

  const rawMeta = flattenMeta(rawData.meta);
  const meta = { ...WP_META_DEFAULTS };

  Object.keys(WP_META_DEFAULTS).forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(rawMeta, key)) {
      meta[key] = rawMeta[key];
    }
  });

  const initialCategoryInput = normalizeCategoryLabel(
    firstNonEmpty(rawData.category, meta.category),
  );
  meta.category = resolveTrustedMainCategory(initialCategoryInput) || "";
  meta.subcategory = isTrustedMasaakCategory(meta.category)
    ? resolveTrustedSubcategory(
        meta.category,
        firstNonEmpty(rawData.subcategory, meta.subcategory),
        "masaak",
      )
    : "";

  const adType = normalizeArabicText(
    firstNonEmpty(meta.ad_type, rawData.ad_type, "عرض"),
  );
  meta.ad_type = adType || "عرض";

  meta.owner_name = normalizeArabicText(
    firstNonEmpty(meta.owner_name, "المالك"),
  );

  const contact = normalizeContactList(
    firstNonEmpty(meta.contact, rawData.contact),
    extractedPhones,
  );
  meta.contact = contact;

  const primaryPhone =
    normalizePhoneNumber(firstNonEmpty(meta.phone_number, meta.phone)) ||
    (contact[0] ? contact[0].value : "") ||
    (extractedPhones[0] ? extractedPhones[0].normalized : "");

  meta.phone_number = primaryPhone || "";
  meta.phone = primaryPhone || "";

  meta.price = normalizeArabicText(meta.price || "");
  meta.price_type = normalizeArabicText(meta.price_type || meta.price || "");
  meta.price_method = "";
  meta.payment_method = "";
  meta.order_owner = normalizeArabicText(
    meta.order_owner || meta.owner_type || "",
  );
  meta.offer_owner = normalizeArabicText(
    meta.offer_owner || meta.owner_type || "",
  );
  meta.owner_type = normalizeArabicText(
    meta.owner_type || meta.offer_owner || meta.order_owner || "",
  );
  meta.order_type = normalizeArabicText(
    meta.order_type || meta.offer_type || meta.ad_type || "",
  );
  meta.offer_type = normalizeArabicText(
    meta.offer_type || meta.order_type || "",
  );
  meta.age = normalizeArabicText(meta.age || "");
  meta.google_location = meta.google_location || null;
  meta.youtube_link = meta.youtube_link || null;

  normalizePriceMeta(meta);
  normalizePriceMethodMeta(meta, adText);
  normalizeWordPressCategoryMeta(meta, adText);
  const initialTargetWebsite = inferTargetWebsiteFromData(
    {
      category: meta.category,
      subcategory: meta.subcategory,
      meta,
    },
    adText,
  );
  normalizeLocationMeta(meta, adText, initialTargetWebsite);
  if (isOwnerOrAdministrativeDetailLine(meta.owner_name, initialTargetWebsite)) {
    meta.owner_name = "المالك";
  }
  const phonePolicyMeta = enforceWordPressPhonePolicy(
    meta,
    initialTargetWebsite,
  );
  meta.contact = phonePolicyMeta.contact;
  meta.phone_number = phonePolicyMeta.phone_number;
  meta.phone = phonePolicyMeta.phone;

  const confidenceOverall = extractNumericValue(
    firstNonEmpty(rawData.confidence_overall, meta.confidence_overall),
  );
  meta.confidence_overall =
    typeof confidenceOverall === "number"
      ? clamp(
          confidenceOverall <= 1 ? confidenceOverall : confidenceOverall / 100,
          0,
          1,
        )
      : 1;

  if (rawData.parse_error) {
    meta.parse_notes = normalizeArabicText(rawData.parse_error);
  }

  // Keep main_ad deterministic while stripping contact/admin/office phrases.
  meta.main_ad = buildCleanMainAdText(adText || "", initialTargetWebsite);

  const tags = parseTags(firstNonEmpty(rawData.tags, meta.tags));
  meta.tags = tags.join(", ");

  const isAd =
    Object.prototype.hasOwnProperty.call(rawData, "IsItAd") ||
    Object.prototype.hasOwnProperty.call(rawData, "isAd")
      ? toBoolean(firstNonEmpty(rawData.IsItAd, rawData.isAd))
      : true;

  if (!isRegeneration && !isAd) {
    throw new AIServiceError(
      "AI response marked content as non-ad",
      "schema_mismatch",
    );
  }

  const safeTitleSeed =
    removeForbiddenInlineContent(
      titleValue || DEFAULT_WP_TITLE,
      initialTargetWebsite,
    ) ||
    DEFAULT_WP_TITLE;
  const normalizedTitle = ensureTitleContainsLocation(
    safeTitleSeed,
    meta,
    adText,
    initialTargetWebsite,
  );
  const manualContent = buildDeterministicDescription({
    title: normalizedTitle,
    meta,
    adText,
    targetWebsite: initialTargetWebsite,
  });

  let finalContent = manualContent;

  if (!finalContent || hasForbiddenDescriptionContent(finalContent, initialTargetWebsite)) {
    const cleanedAdText = removeForbiddenInlineContent(
      stripAdReferenceNumbers(adText || ""),
      initialTargetWebsite,
    );
    finalContent = buildDeterministicDescription({
      title: normalizedTitle,
      meta,
      adText: cleanedAdText,
      targetWebsite: initialTargetWebsite,
    });
  }

  if (!finalContent || hasForbiddenDescriptionContent(finalContent, initialTargetWebsite)) {
    const fallbackPlainText =
      removeForbiddenInlineContent(
        stripAdReferenceNumbers(contentValue || adText || ""),
        initialTargetWebsite,
      ) || "وصف مختصر للإعلان.";
    finalContent = sanitizeGeneratedHtmlDescription(
      `<h1>${escapeHtml(normalizedTitle)}</h1><p>${escapeHtml(fallbackPlainText)}</p>`,
      initialTargetWebsite,
    );
  }

  finalContent = sanitizeGeneratedHtmlDescription(
    finalContent,
    initialTargetWebsite,
  );

  return {
    title: normalizedTitle,
    content: finalContent,
    excerpt: normalizeArabicText(excerptValue || ""),
    status: "publish",
    meta,
    taxonomies: isObject(rawData.taxonomies) ? rawData.taxonomies : {},
    images: Array.isArray(rawData.images) ? rawData.images : [],
    IsItAd: true,
  };
}

function inferTargetWebsiteFromData(wpData, adText = "") {
  const meta = isObject(wpData?.meta) ? wpData.meta : {};
  const normalizedCategory = normalizeCategoryLabel(
    firstNonEmpty(
      wpData?.category,
      meta.category,
      meta.arc_category,
      meta.parent_catt,
    ),
  );
  const normalizedSubcategory = normalizeCategoryLabel(
    firstNonEmpty(
      wpData?.subcategory,
      meta.subcategory,
      meta.arc_subcategory,
      meta.sub_catt,
    ),
  );

  if (
    [normalizedCategory, normalizedSubcategory].some((value) =>
      isTrustedHasakCategory(value),
    )
  ) {
    return "hasak";
  }

  if (normalizedCategory && isTrustedMasaakCategory(normalizedCategory)) {
    return "masaak";
  }

  const adTypeBlob = normalizeArabicText(
    [meta.ad_type, meta.order_type, meta.offer_type].filter(Boolean).join(" "),
  );
  if (
    /(?:فعالية|فعاليات|خدمة|خدمات|وظيفة|وظائف|برنامج|برامج|حراج|مستعمل|منتجعات|ترفيهي)/i.test(
      adTypeBlob,
    )
  ) {
    return "hasak";
  }

  return websiteConfig.detectWebsite(
    normalizeArabicText(adText || ""),
    normalizedCategory || "",
    meta,
  );
}

function getRequiredMetadataFieldsForAd(wpData, adText = "") {
  const targetWebsite = inferTargetWebsiteFromData(wpData, adText);
  if (targetWebsite === "hasak") {
    return ["category"];
  }

  const meta = isObject(wpData?.meta) ? wpData.meta : {};
  const normalizedCategory = canonicalizeMasaakCategory(
    firstNonEmpty(
      wpData?.category,
      meta.category,
      meta.parent_catt,
      meta.arc_category,
      detectPropertyTypeFromText(adText),
    ),
  );

  if (
    normalizedCategory &&
    (normalizedCategory === "طلبات" ||
      MASAAK_FORCE_EMPTY_SUBCATEGORY_CATEGORIES.has(normalizedCategory))
  ) {
    return REQUIRED_METADATA_FIELDS.filter((field) => field !== "subcategory");
  }

  return [...REQUIRED_METADATA_FIELDS];
}

function getRequiredFieldLabel(field) {
  const labels = {
    area: "المساحة",
    price: "السعر",
    priceMethod: "طريقة السعر",
    fullLocation: "الموقع الكامل",
    category: "التصنيف",
    subcategory: "التصنيف الفرعي",
  };

  return labels[field] || field;
}

function summarizeRequiredMetadata(wpData) {
  const meta = isObject(wpData?.meta) ? wpData.meta : {};
  const areaNumber = extractNumericValue(
    firstNonEmpty(meta.arc_space, meta.area, meta.order_space),
  );
  const areaText = normalizeArabicText(
    firstNonEmpty(meta.order_space, meta.area, meta.arc_space, ""),
  );
  const areaTextHasNumber = /[0-9]/.test(
    convertArabicDigitsToEnglish(areaText),
  );
  const priceAmount = extractNumericValue(
    firstNonEmpty(meta.price_amount, meta.from_price, meta.to_price),
  );
  const priceText = normalizeArabicText(
    firstNonEmpty(meta.price_type, meta.price, ""),
  );
  const priceMethod = normalizeArabicText(
    firstNonEmpty(meta.price_method, meta.payment_method, ""),
  );
  const category = resolveTrustedMainCategory(
    firstNonEmpty(
      wpData?.category,
      meta.category,
      meta.arc_category,
      meta.parent_catt,
    ),
  );
  const subcategory = category
    ? resolveTrustedSubcategory(
        category,
        firstNonEmpty(
          wpData?.subcategory,
          meta.subcategory,
          meta.arc_subcategory,
          meta.sub_catt,
        ),
        "masaak",
      )
    : "";
  const fullLocation = buildFullLocationValue(meta, "");

  return {
    area:
      typeof areaNumber === "number" && areaNumber > 0
        ? String(areaNumber)
        : areaTextHasNumber
          ? areaText
          : "",
    price:
      typeof priceAmount === "number" && priceAmount > 0
        ? String(priceAmount)
        : priceText,
    priceMethod,
    fullLocation,
    category,
    subcategory,
  };
}

function getMissingRequiredMetadataFields(wpData, adText = "") {
  const meta = isObject(wpData?.meta) ? wpData.meta : {};
  const values = summarizeRequiredMetadata(wpData);
  const requiredFields = getRequiredMetadataFieldsForAd(wpData, adText);
  const missing = [];

  if (requiredFields.includes("area") && !values.area) {
    missing.push("area");
  }

  if (requiredFields.includes("price") && !values.price) {
    missing.push("price");
  }

  if (requiredFields.includes("fullLocation") && !hasDetailedLocation(meta)) {
    missing.push("fullLocation");
  }

  if (requiredFields.includes("category") && !values.category) {
    missing.push("category");
  }

  if (requiredFields.includes("subcategory") && !values.subcategory) {
    missing.push("subcategory");
  }

  return {
    missing,
    requiredFields,
    values,
  };
}

function parseFullLocationText(fullLocation) {
  const normalized = normalizeArabicText(fullLocation || "");
  if (!normalized) {
    return { neighborhood: "", city: "", governorate: "" };
  }

  const parts = normalized
    .split(/[-،,]/)
    .map((part) => normalizeArabicText(part))
    .filter(Boolean);

  if (parts.length >= 3) {
    return {
      neighborhood: sanitizeLocationCandidate(parts[0], {
        type: "neighborhood",
        adText: normalized,
      }),
      city: sanitizeLocationCandidate(parts[1], {
        type: "city",
        adText: normalized,
      }),
      governorate: sanitizeLocationCandidate(parts.slice(2).join(" - "), {
        type: "governorate",
        adText: normalized,
      }),
    };
  }

  if (parts.length === 2) {
    return {
      neighborhood: sanitizeLocationCandidate(parts[0], {
        type: "neighborhood",
        adText: normalized,
      }),
      city: sanitizeLocationCandidate(parts[1], {
        type: "city",
        adText: normalized,
      }),
      governorate: "",
    };
  }

  return {
    neighborhood: sanitizeLocationCandidate(parts[0] || "", {
      type: "neighborhood",
      adText: normalized,
    }),
    city: "",
    governorate: "",
  };
}

function extractAreaFromTextFallback(adText = "") {
  const text = convertArabicDigitsToEnglish(String(adText || ""));
  const patterns = [
    /(?:المساحة|المساحه|مساحة|مساحه|بمساحة|بمساحه|مساحته|مساحتها|مساحة\s*الأرض|مساحه\s*الارض)\s*[:：-]?\s*([0-9][0-9,\.]*)/i,
    /([0-9][0-9,\.]*)\s*(?:متر(?:\s*مربع)?|م(?:\s*مربع)?|م²|m2)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const value = extractNumericValue(match[1]);
    if (typeof value === "number" && value > 0) {
      return value;
    }
  }

  return "";
}

function extractPriceFromTextFallback(adText = "") {
  const text = convertArabicDigitsToEnglish(String(adText || ""));
  const normalized = normalizeArabicText(text);

  if (/على\s*السوم/i.test(normalized)) {
    return {
      price: "على السوم",
      price_method: "",
      price_type: "على السوم",
      price_amount: "",
      from_price: "",
      to_price: "",
    };
  }

  if (/عند\s*التواصل/i.test(normalized)) {
    return {
      price: "عند التواصل",
      price_method: "",
      price_type: "عند التواصل",
      price_amount: "",
      from_price: "",
      to_price: "",
    };
  }

  const scaledPatterns = [
    { pattern: /([0-9][0-9,\.]*)\s*مليون/i, multiplier: 1000000 },
    { pattern: /([0-9][0-9,\.]*)\s*ألف/i, multiplier: 1000 },
  ];

  for (const { pattern, multiplier } of scaledPatterns) {
    const match = text.match(pattern);
    if (!match) continue;

    const base = extractNumericValue(match[1]);
    if (typeof base === "number" && base > 0) {
      const price = Math.round(base * multiplier);
      return {
        price: String(price),
        price_method: "",
        price_type: "",
        price_amount: price,
        from_price: price,
        to_price: price,
      };
    }
  }

  const numericPatterns = [
    /(?:السعر|المبلغ|المطلوب|القيمة|بسعر)\s*[:：-]?\s*([0-9][0-9,\.]*)/i,
    /([0-9][0-9,\.]{2,})\s*(?:ريال|﷼|sar|سار)/i,
  ];

  for (const pattern of numericPatterns) {
    const match = text.match(pattern);
    if (!match) continue;

    const value = extractNumericValue(match[1]);
    if (typeof value === "number" && value > 0) {
      return {
        price: String(value),
        price_method: "",
        price_type: "",
        price_amount: value,
        from_price: value,
        to_price: value,
      };
    }
  }

  return {
    price: "",
    price_method: "",
    price_type: "",
    price_amount: "",
    from_price: "",
    to_price: "",
  };
}

function extractLocationFromTextFallback(adText = "") {
  const normalizedText = normalizeArabicText(adText || "");
  const dynamicHints = getDynamicLocationHints(false);
  let neighborhood = "";
  let city = "";
  let governorate = "";

  const neighborhoodPatterns = [
    /(?:الحي|حي|المنطقة|المنطقه|منطقة|منطقه|الموقع|المكان)\s*[:：-]?\s*([^\n]{2,80})/i,
    /في\s*حي\s*([^\n]{2,80})/i,
  ];

  for (const pattern of neighborhoodPatterns) {
    const match = normalizedText.match(pattern);
    if (!match) continue;
    neighborhood = sanitizeLocationCandidate(match[1], {
      type: "neighborhood",
      adText: normalizedText,
    });
    if (neighborhood) break;
  }

  const governoratePatterns = [
    /(?:المحافظة|المحافظه|محافظة|محافظه|الدولة|الدوله|دولة|دوله|المنطقة|المنطقه|منطقة|منطقه)\s*[:：-]?\s*([^\n]{2,80})/i,
  ];

  for (const pattern of governoratePatterns) {
    const match = normalizedText.match(pattern);
    if (!match) continue;
    governorate = sanitizeLocationCandidate(match[1], {
      type: "governorate",
      adText: normalizedText,
      knownOptions: dynamicHints.beforeCities,
    });
    if (governorate) break;
  }

  const cityPatterns = [
    /(?:المدينة|المدينه|مدينة|مدينه)\s*[:：-]?\s*([^\n]{2,80})/i,
    /(?:في|ب)\s*([^،,\n]{2,80})\s*[،,]\s*([^،,\n]{2,80})/i,
  ];

  for (const pattern of cityPatterns) {
    const match = normalizedText.match(pattern);
    if (!match) continue;

    if (!city) {
      city = sanitizeLocationCandidate(match[1], {
        type: "city",
        adText: normalizedText,
        knownOptions: dynamicHints.cities,
      });
    }

    if (!governorate && match[2]) {
      governorate = sanitizeLocationCandidate(match[2], {
        type: "governorate",
        adText: normalizedText,
        knownOptions: dynamicHints.beforeCities,
      });
    }

    if (city) break;
  }

  if (!neighborhood) {
    const extractedNeighborhoods =
      areaNormalizer.extractNeighborhoods(normalizedText);
    if (extractedNeighborhoods.length > 0) {
      neighborhood = sanitizeLocationCandidate(extractedNeighborhoods[0], {
        type: "neighborhood",
        adText: normalizedText,
      });
    }
  }

  if (!city) {
    city = sanitizeLocationCandidate(
      inferLocationFromKnownOptions(normalizedText, dynamicHints.cities),
      {
        type: "city",
        adText: normalizedText,
        knownOptions: dynamicHints.cities,
      },
    );
  }
  if (!governorate) {
    governorate = sanitizeLocationCandidate(
      inferLocationFromKnownOptions(normalizedText, dynamicHints.beforeCities),
      {
        type: "governorate",
        adText: normalizedText,
        knownOptions: dynamicHints.beforeCities,
      },
    );
  }

  const inferredCityFromNeighborhood = normalizeArabicText(
    neighborhood && areaNormalizer.inferCityFromArea
      ? areaNormalizer.inferCityFromArea(neighborhood)
      : "",
  );

  const inferred = inferCityGovernorateFromText(normalizedText);
  if (!city && inferredCityFromNeighborhood) {
    city = inferredCityFromNeighborhood;
  }
  if (!city && inferred.city) {
    city = sanitizeLocationCandidate(inferred.city, {
      type: "city",
      adText: normalizedText,
      knownOptions: dynamicHints.cities,
    });
  }
  if (!governorate && inferred.governorate) {
    governorate = sanitizeLocationCandidate(inferred.governorate, {
      type: "governorate",
      adText: normalizedText,
      knownOptions: dynamicHints.beforeCities,
    });
  }

  if (neighborhood && (neighborhood === city || neighborhood === governorate)) {
    neighborhood = "";
  }

  return {
    neighborhood: neighborhood || "",
    city: city || "",
    governorate: governorate || "",
  };
}

function inferSubcategoryFallback(adText = "", category = "") {
  const normalizedCategory = canonicalizeMasaakCategory(category);
  const strictSubcategory = normalizeMasaakSubcategory(
    normalizedCategory,
    "",
    adText,
  );
  if (strictSubcategory) {
    return strictSubcategory;
  }

  if (MASAAK_FORCE_EMPTY_SUBCATEGORY_CATEGORIES.has(normalizedCategory)) {
    return "";
  }

  const text = normalizeArabicText(adText || "");
  const genericPatterns = [
    { regex: /صك/i, value: "صك" },
    { regex: /مشاع/i, value: "مشاع" },
    { regex: /وقف/i, value: "وقف" },
    { regex: /عرق/i, value: "عرق" },
  ];
  const detected = genericPatterns.find(({ regex }) => regex.test(text));
  if (detected) {
    return detected.value;
  }

  if (normalizedCategory === "طلبات") {
    return "عام";
  }

  if (
    Object.prototype.hasOwnProperty.call(
      MASAAK_STRICT_SUBCATEGORY_RULES,
      normalizedCategory,
    )
  ) {
    return "";
  }

  return normalizedCategory || "عام";
}

function mergeRecoveredWordPressMetadata(wpData, recoveredData) {
  const merged = {
    ...wpData,
    meta: isObject(wpData?.meta) ? { ...wpData.meta } : {},
  };
  const meta = merged.meta;
  const patch = isObject(recoveredData) ? recoveredData : {};

  const recoveredArea = extractNumericValue(
    firstNonEmpty(patch.area, patch.arc_space),
  );
  if (typeof recoveredArea === "number" && recoveredArea > 0) {
    meta.arc_space = recoveredArea;
    meta.area = recoveredArea;
    meta.order_space = meta.order_space || `${recoveredArea} متر مربع`;
  }

  const recoveredPriceAmount = extractNumericValue(
    firstNonEmpty(
      patch.price_amount,
      patch.from_price,
      patch.to_price,
      patch.price,
    ),
  );
  const recoveredPriceType = normalizeArabicText(
    firstNonEmpty(patch.price_type, ""),
  );
  const recoveredPriceText = normalizeArabicText(
    firstNonEmpty(patch.price, recoveredPriceType, ""),
  );

  if (typeof recoveredPriceAmount === "number" && recoveredPriceAmount > 0) {
    meta.price_amount = recoveredPriceAmount;
    meta.from_price = meta.from_price || recoveredPriceAmount;
    meta.to_price = meta.to_price || recoveredPriceAmount;
    meta.price = meta.price || String(recoveredPriceAmount);
  }

  if (recoveredPriceType) {
    meta.price_type = recoveredPriceType;
  } else if (!meta.price_type && recoveredPriceText) {
    meta.price = recoveredPriceText;
  }

  const parsedLocation = parseFullLocationText(
    firstNonEmpty(patch.fullLocation, ""),
  );
  const recoveredNeighborhood = normalizeArabicText(
    firstNonEmpty(
      patch.neighborhood,
      patch.location,
      parsedLocation.neighborhood,
    ),
  );
  const recoveredCity = normalizeArabicText(
    firstNonEmpty(patch.city, parsedLocation.city),
  );
  const recoveredGovernorate = normalizeArabicText(
    firstNonEmpty(patch.governorate, parsedLocation.governorate),
  );

  if (recoveredNeighborhood) {
    const cleanRecoveredNeighborhood = normalizeNeighborhoodName(
      recoveredNeighborhood,
    );
    meta.neighborhood = cleanRecoveredNeighborhood;
    meta.location = cleanRecoveredNeighborhood;
  }
  if (recoveredCity) {
    meta.city = recoveredCity;
    meta.subcity = recoveredCity;
    meta.City = recoveredCity;
  }
  if (recoveredGovernorate) {
    meta.before_City = recoveredGovernorate;
    meta.before_city = recoveredGovernorate;
  }

  const recoveredCategory = resolveTrustedMainCategory(
    firstNonEmpty(patch.category, patch.arc_category, patch.parent_catt),
  );
  if (recoveredCategory) {
    merged.category = recoveredCategory;
    meta.category = recoveredCategory;
    meta.arc_category = recoveredCategory;
    if (!isTrustedHasakCategory(recoveredCategory)) {
      meta.parent_catt = recoveredCategory;
      if (!meta.category_id) {
        meta.category_id = resolveCategoryId(recoveredCategory, "masaak");
      }
    } else {
      meta.parent_catt = "";
      meta.sub_catt = "";
      meta.subcategory = "";
      meta.arc_subcategory = "";
      if (!meta.category_id) {
        meta.category_id = resolveCategoryId(recoveredCategory, "hasak");
      }
    }
  }

  const recoveredSubcategory = isTrustedHasakCategory(recoveredCategory)
    ? ""
    : resolveTrustedSubcategory(
        recoveredCategory,
        firstNonEmpty(patch.subcategory, patch.arc_subcategory, patch.sub_catt),
        "masaak",
      );
  if (recoveredSubcategory) {
    merged.subcategory = recoveredSubcategory;
    meta.subcategory = recoveredSubcategory;
    meta.arc_subcategory = recoveredSubcategory;
    meta.sub_catt = recoveredSubcategory;
  }

  if (patch.notes) {
    meta.parse_notes = appendParseNote(meta.parse_notes, patch.notes);
  }

  meta.full_location =
    buildFullLocationValue(meta, "") || meta.full_location || "";

  return merged;
}

function applyRequiredFieldFallbacks(wpData, adText) {
  const updated = {
    ...wpData,
    meta: isObject(wpData?.meta) ? { ...wpData.meta } : {},
  };
  const meta = updated.meta;
  const targetWebsite = inferTargetWebsiteFromData(updated, adText);
  const missingState = getMissingRequiredMetadataFields(updated, adText);

  if (missingState.missing.length > 0) {
    meta.parse_notes = appendParseNote(
      meta.parse_notes,
      `تطبيق معالجة تلقائية للحقول: ${missingState.missing.join(", ")}`,
    );
  }

  const currentAreaNumeric = extractNumericValue(
    firstNonEmpty(meta.arc_space, meta.area, meta.order_space),
  );
  const shouldFillAreaForMasaak =
    targetWebsite !== "hasak" &&
    !(typeof currentAreaNumeric === "number" && currentAreaNumeric > 0);

  if (shouldFillAreaForMasaak) {
    const areaValue = extractAreaFromTextFallback(adText);
    if (typeof areaValue === "number" && areaValue > 0) {
      meta.arc_space = areaValue;
      meta.area = areaValue;
      meta.order_space = `${areaValue} متر مربع`;
    } else if (missingState.missing.includes("area") && !meta.order_space) {
      meta.order_space = "غير محدد";
    }
  }

  if (missingState.missing.includes("price")) {
    const priceData = extractPriceFromTextFallback(adText);
    if (
      typeof priceData.price_amount === "number" &&
      priceData.price_amount > 0
    ) {
      meta.price_amount = priceData.price_amount;
      meta.from_price = priceData.from_price || priceData.price_amount;
      meta.to_price = priceData.to_price || priceData.price_amount;
      meta.price = String(priceData.price_amount);
    }
    if (priceData.price_type) {
      meta.price_type = priceData.price_type;
    } else if (!meta.price_type && priceData.price) {
      meta.price = priceData.price;
    } else if (!meta.price_type && !meta.price) {
      meta.price_type = "عند التواصل";
      meta.price = "عند التواصل";
    }
  }

  if (missingState.missing.includes("fullLocation")) {
    const locationData = extractLocationFromTextFallback(adText);
    if (locationData.neighborhood) {
      const cleanLocationNeighborhood = normalizeNeighborhoodName(
        locationData.neighborhood,
      );
      meta.neighborhood = cleanLocationNeighborhood;
      meta.location = cleanLocationNeighborhood;
    } else if (!meta.location || meta.location === "لم يذكر") {
      meta.location = "غير محدد";
      meta.neighborhood = "غير محدد";
    }

    if (locationData.city) {
      meta.city = locationData.city;
      meta.subcity = locationData.city;
      meta.City = locationData.city;
    }
    if (locationData.governorate) {
      meta.before_City = locationData.governorate;
      meta.before_city = locationData.governorate;
    }
  }

  if (missingState.missing.includes("category")) {
    const inferredMasaakCategory = canonicalizeMasaakCategory(
      firstNonEmpty(
        meta.category,
        meta.arc_category,
        meta.parent_catt,
        detectPropertyTypeFromText(adText),
        detectCategoryFallback(adText),
      ),
    );
    const fallbackDetectedCategory = resolveTrustedMainCategory(
      detectCategoryFallback(adText),
      targetWebsite === "hasak" ? "hasak" : null,
    );
    const safeCategory =
      targetWebsite === "hasak"
        ? fallbackDetectedCategory
        : inferredMasaakCategory || fallbackDetectedCategory;

    if (safeCategory) {
      updated.category = safeCategory;
      meta.category = safeCategory;
      meta.arc_category = safeCategory;
      if (!isTrustedHasakCategory(safeCategory)) {
        meta.parent_catt = safeCategory;
        meta.category_id =
          meta.category_id || resolveCategoryId(safeCategory, "masaak");
      } else {
        meta.parent_catt = "";
        meta.sub_catt = "";
        meta.subcategory = "";
        meta.arc_subcategory = "";
        meta.category_id =
          meta.category_id || resolveCategoryId(safeCategory, "hasak");
      }
    }
  }

  if (missingState.missing.includes("subcategory")) {
    const sourceCategory = firstNonEmpty(
      updated.category,
      meta.category,
      meta.arc_category,
      meta.parent_catt,
    );
    const fallbackSubcategory = inferSubcategoryFallback(
      adText,
      sourceCategory,
    );
    const safeSubcategory = isTrustedHasakCategory(sourceCategory)
      ? ""
      : resolveTrustedSubcategory(
          sourceCategory,
          fallbackSubcategory,
          "masaak",
        );

    updated.subcategory = safeSubcategory;
    meta.subcategory = safeSubcategory;
    meta.arc_subcategory = safeSubcategory;
    meta.sub_catt = safeSubcategory;
  }

  if (targetWebsite === "hasak") {
    meta.full_location =
      buildFullLocationValue(meta, "") || meta.full_location || "";
  } else {
    meta.full_location =
      buildFullLocationValue(meta, "") || meta.full_location || "";
  }
  normalizePriceMethodMeta(meta, adText);
  return updated;
}

function buildTrustedCategoryPromptSection(taxonomy = getTrustedTaxonomySync()) {
  const masaakCategoriesText =
    (taxonomy?.masaak?.mainCategoryNames || []).join("، ") || "غير متوفر";
  const hasakCategoriesText =
    (taxonomy?.hasak?.mainCategoryNames || []).join("، ") || "غير متوفر";
  const masaakSubcategoryHints =
    formatTrustedMasaakSubcategoryLines(taxonomy).join("\n- ");

  return `الفئات المعتمدة:
- فئات مسعاك: ${masaakCategoriesText}
${
  masaakSubcategoryHints
    ? `- فئات مسعاك الفرعية الشائعة:
- ${masaakSubcategoryHints}`
    : ""
}
- فئات حساك: ${hasakCategoriesText}`;
}

function buildMasaakPropertyOnlyRulesPrompt() {
  return `⚠️ قواعد التنظيف الإجبارية لإعلانات مسعاك - يجب تطبيقها قبل أي شيء:
- قبل تكوين title أو content أو main_ad: نظّف النص ذهنياً أولاً سطراً سطراً، واستخرج فقط السطور التي تصف العقار نفسه.
- عند كتابة title أو content أو main_ad لإعلان عقاري في مسعاك: صف العقار فقط، ولا تصف المكتب العقاري أو الجهة الناشرة أو مصدر النص.
- ممنوع إدراج أو ذكر أسماء المكاتب العقارية أو الشركات أو المؤسسات أو الوسطاء أو السماسرة في أي حقل من حقول WordPress. الاستثناء الوحيد للأسماء المسموح بها: "مسعاك" أو "حساك".
- ممنوع إدراج أرقام التراخيص أو الرخص أو أرقام فال أو بيانات المكاتب أو أرقام هواتف الوسطاء أو المكاتب.
- ممنوع إدراج أسماء القروبات أو المجموعات أو أي إشارة لمصدر النص مثل: "من قروب..." أو "من مجموعة..." أو "نشر في...".
- ممنوع إدراج الروابط بجميع أنواعها حتى لو كانت بدون http/https، مثل: wa.me أو chat.whatsapp.com أو أي دومين مثل example.com.
- ممنوع إدراج أسماء الأشخاص أو الوسطاء أو الأسماء القصيرة المنفصلة التي تأتي كسطر تواصل مثل: "بومحمد" أو "عبدالعزيز" أو "أبو..." عندما تكون جزءاً من بيانات تواصل أو تسويق.
- ممنوع إدراج السطور التسويقية/الإدارية مثل: "مستعدون لتسويق عقاراتكم" أو "لدينا عروض" أو "مجموعة عروضات" أو "للإعلانات والنشر".
- احذف السطور الزخرفية أو الفواصل أو الأسطر المليئة بالرموز مثل: "---" أو "♦️♦️" أو ".-.-.-.".
- احذف تماماً أي جملة أو عبارة تحتوي على اسم مكتب أو ترخيص أو قروب أو وسيط أو مصدر نص، بدون استبدالها بنقاط أو "...".
- إذا احتوى السطر على معلومة عقارية صحيحة مع جزء إداري/تواصلي، فاحتفظ بالمعلومة العقارية فقط واحذف الجزء الإداري.
- أعد صياغة الوصف ليكون نظيفاً ومهنياً ويركز على معلومات العقار الفعلية فقط.
- إذا ظهر اسم مكتب أو جهة في owner_name فاستبدله بـ "المالك" أو "معلن" ولا تحتفظ بالاسم التجاري.
- فحص نهائي إلزامي قبل الإخراج: تأكد أن title و content و main_ad لا تحتوي على روابط أو أرقام تواصل أو أسماء مكاتب أو أسماء وسطاء أو أسماء قروبات أو عبارات تسويقية أو رموز تواصل مثل ☎ أو 📞 أو 📱.
- أمثلة حذف فوري:
  "~~مكتب سيول هجر~~" => احذف السطر بالكامل.
  "♦️مجموعة عروضات♦️" => احذف السطر بالكامل.
  "مستعدون لتسويق عقاراتكم" => احذف السطر بالكامل.
  "بومحمد ☎" => احذف السطر بالكامل.
  "wa.me/966509961002" => احذف السطر بالكامل.
  "https://chat.whatsapp.com/..." => احذف السطر بالكامل.
  "شارع 20 جنوب" => احتفظ بها لأنها معلومة عن العقار.
- المسموح فقط: معلومات العقار الفعلية مثل النوع والسعر والمساحة والموقع والعمر والمزايا.`;
}

async function buildRecoverMissingFieldsPrompt(adText, currentData, missingFields) {
  const taxonomy = await wordpressCategoryService.getTrustedTaxonomy();
  const currentSummary = summarizeRequiredMetadata(currentData);
  const targetWebsite = inferTargetWebsiteFromData(currentData, adText);
  const requiredFields = getRequiredMetadataFieldsForAd(currentData, adText);
  const missingLines = missingFields
    .filter((field) => requiredFields.includes(field))
    .map((field) => `- ${field}: ${getRequiredFieldLabel(field)}`)
    .join("\n");
  const websiteInstruction =
    targetWebsite === "hasak"
      ? "سياق الإعلان: حساك (فعاليات/مستعمل/خدمات). لا تُجبر حقول السعر أو المساحة، ولا تملأ price_method/payment_method إطلاقاً. category يجب أن يكون من فئات حساك المعتمدة فقط و subcategory تبقى فارغة."
      : "سياق الإعلان: مسعاك (عقار). إذا وردت مساحة رقمية في النص (مثل 350 متر أو 400م) فيجب تعبئة area رقمياً، وسننسخها لاحقاً إلى arc_space. لا تملأ price_method/payment_method إطلاقاً. category و subcategory يجب أن يكونا من فئات مسعاك المعتمدة فقط.";
  const locationInstruction =
    'قواعد الموقع: neighborhood/location = اسم الحي فقط بدون كلمة "حي" وبدون وصف إضافي، city = اسم المدينة فقط بدون كلمة "مدينة"، governorate = اسم المحافظة أو الدولة فقط. قارن أولاً مع المرجع الجغرافي الداخلي عند توفره، لكن إذا ورد اسم مدينة أو دولة واضح في النص وغير موجود في المرجع فاحتفظ به كما هو بعد تنظيفه. القيم المرفوضة: "ال" و"حي" و"مدينة" وأي جملة طويلة عن الموقع.';
  const trustedCategorySection = buildTrustedCategoryPromptSection(taxonomy);
  const propertyOnlyRules =
    targetWebsite === "masaak" ? `\n\n${buildMasaakPropertyOnlyRulesPrompt()}` : "";

  return `أنت مدقق جودة لاستخراج بيانات إعلان.
${websiteInstruction}
${locationInstruction}${propertyOnlyRules}

المطلوب: أكمل فقط الحقول الناقصة التالية:
${missingLines || "- لا يوجد"}

${trustedCategorySection}

النص الأصلي:
"""
${adText}
"""

البيانات الحالية (لا تُعدّل القيم الصحيحة):
${JSON.stringify(currentSummary, null, 2)}

أعد JSON واحد فقط بدون Markdown وبدون أي شرح.
إذا تعذر استنتاج قيمة حقل ضع "".

الشكل المطلوب:
{
  "area": "",
  "price": "",
  "price_method": "",
  "price_type": "",
  "price_amount": "",
  "from_price": "",
  "to_price": "",
  "fullLocation": "",
  "neighborhood": "",
  "city": "",
  "governorate": "",
  "category": "",
  "subcategory": "",
  "notes": "",
  "confidence": 0.9
}`;
}

async function recoverMissingWordPressFields(
  adText,
  currentData,
  missingFields,
) {
  const requiredFields = getRequiredMetadataFieldsForAd(currentData, adText);
  const relevantMissing = unique(
    missingFields.filter((field) => requiredFields.includes(field)),
  );

  if (relevantMissing.length === 0) {
    return {};
  }

  const prompt = await buildRecoverMissingFieldsPrompt(
    adText,
    currentData,
    relevantMissing,
  );
  const providerOrders = unique([
    `${PROVIDERS.GPT},${PROVIDERS.GEMINI}`,
    `${PROVIDERS.GEMINI},${PROVIDERS.GPT}`,
  ]).map((order) => order.split(","));

  let lastError = null;

  for (const order of providerOrders) {
    try {
      const { data } = await callLLM({
        taskName: "Recover Missing WordPress Fields",
        prompt,
        schema: RECOVER_MISSING_WORDPRESS_FIELDS_SCHEMA,
        providerOrder: order,
        temperature: 0,
        maxTokens: 900,
        maxRetries: null,
      });

      return data;
    } catch (error) {
      lastError = error;
      console.error(
        `⚠️ Missing-field recovery failed for provider order [${order.join(" -> ")}]:`,
        error?.message || error,
      );
    }
  }

  throw lastError || new Error("Missing-field recovery failed");
}

async function ensureRequiredMetadataCoverage({
  wpData,
  adText,
  extractedPhones,
  isRegeneration,
  maxPasses = 2,
}) {
  let current = wpData;

  for (let pass = 1; pass <= maxPasses; pass += 1) {
    const initialCheck = getMissingRequiredMetadataFields(current, adText);
    if (initialCheck.missing.length === 0) {
      return current;
    }

    console.log(
      `⚠️ Required metadata missing (pass ${pass}): ${initialCheck.missing.join(", ")}`,
    );

    let merged = applyRequiredFieldFallbacks(current, adText);
    let checkAfterFallback = getMissingRequiredMetadataFields(merged, adText);

    if (checkAfterFallback.missing.length === 0) {
      return normalizeWordPressData(
        merged,
        adText,
        extractedPhones,
        isRegeneration,
      );
    }

    try {
      const recovered = await recoverMissingWordPressFields(
        adText,
        merged,
        checkAfterFallback.missing,
      );

      merged = mergeRecoveredWordPressMetadata(merged, recovered);
      merged = applyRequiredFieldFallbacks(merged, adText);
      current = normalizeWordPressData(
        merged,
        adText,
        extractedPhones,
        isRegeneration,
      );
    } catch (error) {
      console.error(
        `⚠️ Required metadata recovery attempt ${pass} failed:`,
        error?.message || error,
      );
      current = normalizeWordPressData(
        merged,
        adText,
        extractedPhones,
        isRegeneration,
      );
    }

    checkAfterFallback = getMissingRequiredMetadataFields(current, adText);
    if (checkAfterFallback.missing.length === 0) {
      return current;
    }
  }

  const finalized = applyRequiredFieldFallbacks(current, adText);
  const finalNormalized = normalizeWordPressData(
    finalized,
    adText,
    extractedPhones,
    isRegeneration,
  );
  const finalCheck = getMissingRequiredMetadataFields(finalNormalized, adText);

  if (finalCheck.missing.length > 0) {
    finalNormalized.meta.parse_notes = appendParseNote(
      finalNormalized.meta.parse_notes,
      `حقول ناقصة بعد التحقق النهائي: ${finalCheck.missing.join(", ")}`,
    );
  }

  return finalNormalized;
}

async function buildWordPressExtractionPrompt(
  adText,
  contactHint,
  isRegeneration,
  preferredTargetWebsite = null,
) {
  const taxonomy = await wordpressCategoryService.getTrustedTaxonomy();
  const dynamicLocationHintsText = buildDynamicLocationHintsPromptText();
  const trustedCategorySection = buildTrustedCategoryPromptSection(taxonomy);
  const masaakReferenceRulesText =
    MASAAK_REFERENCE_RULE_LINES_FOR_PROMPT.join("\n- ");
  const propertyOnlyRules = buildMasaakPropertyOnlyRulesPrompt();
  const preferredTarget = normalizeArabicText(preferredTargetWebsite || "");
  const targetWebsiteInstruction =
    preferredTarget === "masaak"
      ? "توجيه نظامي: المسار المستهدف لهذا الإعلان هو مسعاك. التزم بقواعد مسعاك واستخدم تصنيفاته فقط إلا إذا كان النص غير عقاري بشكل صريح جداً."
      : preferredTarget === "hasak"
        ? "توجيه نظامي: المسار المستهدف لهذا الإعلان هو حساك. التزم بقواعد حساك واستخدم تصنيفاته فقط إلا إذا كان النص عقارياً واضحاً جداً."
        : "";

  return `أنت مساعد متخصص في استخراج بيانات إعلان عربي للنشر في WordPress لموقعين:
- مسعاك (عقارات)
- حساك (فعاليات، مستعمل، أنشطة، خدمات)

النص:
"""
${adText}
"""

${contactHint}
${targetWebsiteInstruction ? `\n${targetWebsiteInstruction}` : ""}
${dynamicLocationHintsText ? `\n${dynamicLocationHintsText}` : ""}
${propertyOnlyRules ? `\n\n${propertyOnlyRules}` : ""}

القواعد الإلزامية:
1) أعد JSON واحد فقط بدون Markdown.
2) اختر فئة واحدة دقيقة من القوائم المعتمدة أدناه فقط.
3) حدّد نوع الإعلان: "عرض" أو "طلب" أو "فعالية" أو "خدمة" أو "وظيفة".
4) إذا كان النص عن فعالية/نشاط/حراج/مستعمل/وظائف/خدمات فاختر فئة من حساك.
5) إذا كان النص عن عقار (شقة/فيلا/أرض/عمارة/محل/مستودع...) فاختر فئة من مسعاك.
6) إذا كان طلب شراء/بحث عام: category = "طلبات" و category_id = 83 و parent_catt = "طلبات".
7) عند اختيار فئة حساك: استخدم arc_category/arc_subcategory، واجعل parent_catt/sub_catt فارغين.
8) عند اختيار فئة مسعاك: استخدم parent_catt/sub_catt، ويمكن عكسها في arc_category/arc_subcategory.
9) في حساك لا تُجبر حقول السعر أو المساحة. إذا غير مذكورة اترك price/price_amount/price_type/area/arc_space فارغة.
10) في مسعاك: إذا وردت مساحة رقمية في النص (مثل 350 متر أو 400م أو مساحة 500) يجب تعبئة area و arc_space بنفس الرقم، ولا تتركهما فارغين عند وجود المساحة في النص. إضافةً إلى ذلك عبّئ الحقول الحرجة: price أو price_type، location/city، category، subcategory.
11) في إعلانات مسعاك العقارية: title و content و main_ad يجب أن تصف العقار فقط، وليس المكتب أو الشركة أو الوسيط أو الجهة الناشرة أو مصدر النص.
12) احذف بالكامل أي سطر أو جملة أو عبارة تحتوي على بيانات مكتب أو وسيط أو وكيل أو شركة أو ترخيص أو قروب أو رابط أو حساب سوشال أو أي إشارة لمصدر النص. لا تضع بدلاً منها نقاطاً أو "...".
13) أعد صياغة العنوان والمحتوى بالعربية بشكل واضح واحترافي مع التركيز على بيانات العقار/العرض فقط وبدون أي إشارة للمرسل أو العميل أو مصدر الإعلان.
14) المحتوى HTML آمن ومختصر (بدون script/iframe).
15) للمحتوى العقاري استخدم HTML منظم: h1 ثم p افتتاحي ثم h2+ul للمواصفات ثم h2+ul للمميزات ثم h2+p للسعر ثم h2+p للموقع.
16) للمحتوى غير العقاري (حساك) استخدم HTML نظيف ودقيق مع أكبر قدر من التفاصيل المتاحة: h1 ثم p افتتاحي ثم h2+ul للتفاصيل/الحالة/المواصفات ثم h2+ul للمزايا أو المتطلبات.
17) لإعلانات مسعاك فقط: يمكن تضمين الموقع في title إذا كان مذكوراً بوضوح. لإعلانات حساك لا تضف موقعاً غير مذكور صراحة في النص.
18) الوصف content يجب أن يشمل كل التفاصيل المتاحة من النص بدون اختراع معلومات.
19) ممنوع داخل content: أرقام الاتصال/الموبايل، أسماء الأشخاص الحقيقيين، اسم المالك، اسم المكتب، بيانات المكتب، أسماء الوسطاء/الوكلاء، التراخيص، القروبات، الروابط، حسابات سناب/انستغرام/تلغرام/إكس/يوتيوب، وأي ملاحظات إدارية أو تسويقية.
20) طبّق هذا التنظيف على title و content و main_ad فقط. إذا وُجدت بيانات مالك/معلن في حقول مستقلة داخل meta فاتركها في حقولها المناسبة ولا تُدخلها في الوصف.
21) إذا ظهر اسم مكتب أو اسم جهة غير "مسعاك" أو "حساك" في owner_name فاستبدله بقيمة عامة مثل "المالك" أو "معلن".
22) املأ meta بحقول ثابتة حتى لو كانت فارغة.
23) phone_number بصيغة 9665xxxxxxxx إذا متاح.
24) status دائماً "publish".
25) احذف أي أرقام مرجعية مثل: رقم القطعة، قطعة 11 أ، رقم الإعلان من العنوان والمحتوى و main_ad.
${
  isRegeneration
    ? "26) هذه إعادة توليد لإعلان موجود بالفعل، لذلك IsItAd يجب أن يكون true."
    : "26) إذا لم يكن إعلاناً واضحاً ضع IsItAd=false مع parse_error."
}
27) لمسعاك فقط: إذا توفر الحي بدون المدينة فاستنتج المدينة المناسبة (مثل الهفوف/المبرز/القرى/العيون). وإذا لم تُذكر المحافظة صراحة فاجعل before_City و before_city = "الأحساء" كقيمة افتراضية. في كل الحالات: location/neighborhood تكون اسم الحي فقط بدون كلمة "حي". في حساك لا تستنتج مدينة غير مذكورة، لكن اجعل before_City و before_city = "الأحساء" إذا كانتا فارغتين.
28) ممنوع نهائياً داخل title/content/main_ad ظهور الكلمات أو العبارات التالية: "مباشر" و"من الوكيل" و"طرف" وأي صياغة مكافئة لها.
29) لا تكتب ولا تعبئ حقول طريقة الدفع نهائياً: price_method و payment_method يجب أن تبقى "" دائماً.
30) مرجع إلزامي لمسعاك (له أولوية على أي تخمين فرعي):
- ${masaakReferenceRulesText}
31) قواعد الموقع الإلزامية: city = اسم المدينة فقط بدون كلمة "مدينة"، location/neighborhood = اسم الحي فقط بدون كلمة "حي"، before_City = اسم المحافظة أو الدولة أو المنطقة الكبرى فقط. لا تنسخ جملة طويلة مثل "المدينة: الرياض حي النرجس بجوار..." داخل أي حقل.
32) قارن أولاً مع المرجع الجغرافي الداخلي عند توفره، لكن إذا وردت مدينة أو دولة واضحة في النص وغير موجودة في المرجع فاحتفظ بها كما هي بعد تنظيفها، ولا تستبدلها عشوائياً بقيمة من المرجع.
33) القيم المرفوضة في حقول الموقع: "ال" أو "حي" أو "مدينة" أو أي قيمة ناقصة/عامة. عند الشك اترك الحقل فارغاً.
34) قبل إعادة JSON نفّذ مراجعة نهائية على title و content و main_ad: إذا وجدت فيها أي رابط أو اسم مكتب أو اسم وسيط أو اسم قروب أو رقم تواصل أو اسم شخص قصير للتواصل أو عبارة تسويقية أو سطر زخرفي فاحذف هذا الجزء ثم أعد الصياغة.
35) أمثلة يجب حذفها إذا ظهرت في النص: "مكتب ...", "شركة ...", "مستعدون لتسويق عقاراتكم", "مجموعة عروضات", "بومحمد ☎", "عبدالعزيز ☎", "wa.me/...", "chat.whatsapp.com/...", "example.com".
36) أمثلة يجب الإبقاء عليها لأنها تفاصيل عقارية: "شارع 20 جنوب", "مساحة 780", "الأطوال 26 في 30", "السعر 325 ألف".

${trustedCategorySection}

أعد الشكل التالي فقط:
{
  "IsItAd": true,
  "status": "publish",
  "title": "عنوان نظيف ودقيق من النص",
  "content": "<h1>...</h1><p>...</p>",
  "excerpt": "وصف مختصر",
  "category": "",
  "subcategory": "",
  "category_id": "",
  "tags": [""],
  "meta": {
    "ad_type": "",
    "owner_name": "",
    "phone_number": "",
    "contact": [{"value": "", "type": "phone", "confidence": 1}],
    "price": "",
    "price_type": "",
    "price_amount": "",
    "from_price": "",
    "to_price": "",
    "price_method": "",
    "payment_method": "",
    "arc_space": "",
    "order_space": "",
    "area": "",
    "parent_catt": "",
    "sub_catt": "",
    "arc_category": "",
    "arc_subcategory": "",
    "before_City": "الأحساء",
    "before_city": "الأحساء",
    "City": "",
    "city": "",
    "subcity": "",
    "location": "",
    "full_location": "",
    "neighborhood": "",
    "order_status": "",
    "offer_status": "",
    "order_owner": "",
    "offer_owner": "",
    "owner_type": "",
    "order_type": "",
    "offer_type": "",
    "main_ad": "",
    "google_location": null,
    "youtube_link": null
  },
  "confidence_overall": 0.9,
  "parse_error": null
}`;
}

// -------------------------
// Smart Phone Number Extraction
// -------------------------
function extractPhoneNumbers(text) {
  const normalizedText = convertArabicDigitsToEnglish(String(text || ""));
  const phoneNumbers = [];
  const seen = new Set();

  const pushPhone = (original, normalized, confidence, type) => {
    const safeNormalized = normalizePhoneNumber(normalized || original || "");
    if (!/^9665\d{8}$/.test(safeNormalized) || seen.has(safeNormalized)) {
      return;
    }

    seen.add(safeNormalized);
    phoneNumbers.push({
      original: String(original || "").trim(),
      normalized: safeNormalized,
      confidence,
      type,
    });
  };

  // Remove all non-digit characters except + for initial cleaning
  const cleanText = normalizedText.replace(/[^\d+\s]/g, " ");

  // Pattern 1: Saudi numbers starting with 05 (10 digits)
  const pattern1 = /\b(05\d{8})\b/g;
  let matches = cleanText.matchAll(pattern1);
  for (const match of matches) {
    const number = match[1];
    pushPhone(number, `966${number.substring(1)}`, 1.0, "saudi_mobile");
  }

  // Pattern 2: Saudi numbers starting with 966 (12 digits)
  const pattern2 = /\b(9665\d{8})\b/g;
  matches = cleanText.matchAll(pattern2);
  for (const match of matches) {
    const number = match[1];
    pushPhone(number, number, 1.0, "saudi_mobile_intl");
  }

  // Pattern 3: Numbers with + prefix (+9665xxxxxxxx)
  const pattern3 = /\+?(9665\d{8})\b/g;
  matches = normalizedText.matchAll(pattern3);
  for (const match of matches) {
    const number = match[1];
    pushPhone(match[0], number, 1.0, "saudi_mobile_plus");
  }

  // Pattern 4: Numbers with spaces or dashes (055 123 4567 or 055-123-4567)
  const pattern4 = /\b(05\d)\s*[\s-]?\s*(\d{3})\s*[\s-]?\s*(\d{4})\b/g;
  matches = normalizedText.matchAll(pattern4);
  for (const match of matches) {
    const number = match[1] + match[2] + match[3];
    pushPhone(
      match[0],
      `966${number.substring(1)}`,
      0.95,
      "saudi_mobile_formatted",
    );
  }

  // Pattern 5: International formatted Saudi mobile numbers (+966 55 018 9262)
  const pattern5 =
    /(?:\+?966|00966)\s*[\s-]?\s*(5\d)\s*[\s-]?\s*(\d{3})\s*[\s-]?\s*(\d{4})\b/g;
  matches = normalizedText.matchAll(pattern5);
  for (const match of matches) {
    const number = `${match[1]}${match[2]}${match[3]}`;
    pushPhone(match[0], `966${number}`, 0.98, "saudi_mobile_intl_formatted");
  }

  // Pattern 6: Local formatted Saudi mobile without leading zero (55 018 9262)
  const pattern6 = /\b(5\d)\s*[\s-]?\s*(\d{3})\s*[\s-]?\s*(\d{4})\b/g;
  matches = normalizedText.matchAll(pattern6);
  for (const match of matches) {
    const number = `${match[1]}${match[2]}${match[3]}`;
    pushPhone(match[0], `966${number}`, 0.9, "saudi_mobile_short_formatted");
  }

  return phoneNumbers.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Fallback keyword-based ad detection when AI is unavailable.
 * @param {string} text
 * @returns {{isAd: boolean, confidence: number, reason: string}}
 */
function useFallbackDetection(text) {
  console.log("🔧 Using fallback keyword detection...");

  const keywords = [
    "للبيع",
    "للإيجار",
    "للتقبيل",
    "شقة",
    "شقه",
    "فيلا",
    "عقار",
    "أرض",
    "ارض",
    "محل",
    "مزرعة",
    "مزرعه",
    "بيت",
    "عمارة",
    "عماره",
    "دبلكس",
    "استراحة",
    "استراحه",
    "شاليه",
    "كومباوند",
    "ج.م",
    "جنيه",
    "ريال",
    "ألف",
    "مليون",
    "مقدم",
    "اقساط",
    "أقساط",
    "تقسيط",
    "دفعة",
    "السعر",
    "سعر",
    "بسعر",
    "ابغى ابيع",
    "ابغا ابيع",
    "ابي ابيع",
    "مطلوب",
    "ابحث عن",
    "من عنده",
    "مين عنده",
    "ودي ابيع",
    "ودي اشتري",
    "احتاج",
    "محتاج",
    "دور على",
    "ادور",
    "عايز",
    "حد عنده",
    "تكفون",
    "مطعم",
    "كوفيه",
    "كافيه",
    "منتجع",
    "فعالية",
    "فعاليه",
    "نشاط",
    "ترفيه",
    "توصيل",
    "حراج",
    "أسر منتجة",
    "وظيفة",
    "الأحساء",
    "الحسا",
    "التجمع",
    "القاهرة",
    "الرياض",
    "جدة",
    "متوفر",
    "متوفره",
    "يوجد",
    "للاستفسار",
    "للتواصل",
    "عرض",
    "خصم",
  ];

  const textLower = String(text || "").toLowerCase();
  let confidence = 0;

  const matchedKeywords = keywords.filter((keyword) =>
    textLower.includes(keyword.toLowerCase()),
  );

  if (matchedKeywords.length > 0) {
    confidence += matchedKeywords.length * 15;
  }

  const pricePatterns = [
    /\d+[\s,]*\d*[\s,]*\d*\s*(ج\.م|جنيه|ريال|ألف|مليون)/,
    /السعر[\s:]+\d+/,
    /\d+\s*(مقدم|اقساط|دفعة)/,
  ];

  if (pricePatterns.some((pattern) => pattern.test(textLower))) {
    confidence += 30;
  }

  const hasProperty = /(شقة|فيلا|بيت|عمارة|أرض|محل|مزرعة)/.test(textLower);
  const hasAction = /(للبيع|للإيجار|للتقبيل|متوفر|يوجد)/.test(textLower);

  if (hasProperty && hasAction) {
    confidence += 25;
  }

  confidence = Math.min(95, confidence);
  const isAd = confidence >= 40;

  const reason = isAd
    ? `كشف تلقائي - ${matchedKeywords.length} كلمة مفتاحية`
    : "لا توجد مؤشرات كافية للإعلان";

  return { isAd, confidence, reason };
}

/**
 * Detect if a message is an advertisement.
 * @param {string} text
 * @param {number|null} maxRetries
 * @param {number} currentRetry
 */
async function detectAd(text, maxRetries = null, currentRetry = 0) {
  void currentRetry;

  if (!hasAnyEnabledProvider()) {
    console.error("❌ No API key available. Using fallback keyword detection.");
    return useFallbackDetection(text);
  }

  const prompt = `You are an expert classifier for Arabic real-estate and marketplace ads.
Analyze the text and return strict JSON only:
{"isAd": boolean, "confidence": number(0-100), "reason": "short Arabic reason"}

Rules:
- Treat property offers, requests, and Saudi dialect intent messages as ads.
- Treat plain greetings and non-commercial chat as not ads.
- Confidence must be realistic and not always 100.

Text:\n"${text}"`;

  try {
    const { data } = await callLLM({
      taskName: "Detect Ad",
      prompt,
      schema: DETECT_AD_SCHEMA,
      providerOrder: [PROVIDERS.GPT, PROVIDERS.GEMINI],
      temperature: 0,
      maxTokens: 250,
      maxRetries,
    });

    return data;
  } catch (error) {
    console.error("Error in detectAd:", error.message || error);
    return useFallbackDetection(text);
  }
}

/**
 * Enhance/regenerate an advertisement using AI.
 * @param {string} originalText
 * @param {number|null} maxRetries
 * @param {number} currentRetry
 */
async function enhanceAd(originalText, maxRetries = null, currentRetry = 0) {
  void currentRetry;

  if (!hasAnyEnabledProvider()) {
    console.error("❌ No API key available for enhancement. Using fallback.");
    return enhanceWithSmartEmojis(originalText);
  }

  const prompt = `أنت كاتب إعلانات محترف. أعد صياغة النص التالي بالعربية بأسلوب جذاب وطبيعي مع توزيع إيموجي مناسب دون مبالغة.

النص:
"${originalText}"

أعد JSON فقط:
{
  "enhancedText": "...",
  "improvements": ["..."]
}`;

  try {
    const { data } = await callLLM({
      taskName: "Enhance Ad",
      prompt,
      schema: ENHANCE_AD_SCHEMA,
      providerOrder: [PROVIDERS.GEMINI, PROVIDERS.GPT],
      temperature: 0.7,
      maxTokens: 900,
      maxRetries,
    });

    if (!data.enhanced) {
      return enhanceWithSmartEmojis(originalText);
    }

    return data;
  } catch (error) {
    console.error("Error in enhanceAd:", error.message || error);
    return enhanceWithSmartEmojis(originalText);
  }
}

/**
 * Smart emoji enhancement fallback when AI fails.
 * @param {string} text
 */
function enhanceWithSmartEmojis(text) {
  let enhanced = String(text || "");

  const emojiMap = {
    للبيع: "للبيع 🏠",
    للإيجار: "للإيجار 🏡",
    للتقبيل: "للتقبيل 🏪",
    شقة: "شقة 🏢",
    شقه: "شقه 🏢",
    فيلا: "فيلا 🏰",
    بيت: "بيت 🏠",
    عمارة: "عمارة 🏢",
    عماره: "عماره 🏢",
    أرض: "أرض 🌳",
    ارض: "ارض 🌳",
    مزرعة: "مزرعة 🌾",
    مزرعه: "مزرعه 🌾",
    محل: "محل 🏪",
    استراحة: "استراحة 🏖️",
    استراحه: "استراحه 🏖️",
    شاليه: "شاليه 🏝️",
    دبلكس: "دبلكس 🏘️",
    الموقع: "الموقع 📍",
    موقع: "موقع 📍",
    المساحة: "المساحة 📏",
    مساحة: "مساحة 📏",
    الأحساء: "الأحساء 🌴",
    الحسا: "الحسا 🌴",
    حساك: "حساك 🌟",
    السعر: "السعر 💰",
    سعر: "سعر 💰",
    ريال: "ريال 💵",
    ألف: "ألف 💸",
    مليون: "مليون 💎",
    غرف: "غرف 🛏️",
    غرفة: "غرفة 🛏️",
    صالة: "صالة 🛋️",
    صاله: "صاله 🛋️",
    مطبخ: "مطبخ 🍳",
    حمام: "حمام 🚿",
    "دورات مياه": "دورات مياه 🚽",
    مسبح: "مسبح 🏊",
    حديقة: "حديقة 🌳",
    حديقه: "حديقه 🌳",
    مواقف: "مواقف 🚗",
    موقف: "موقف 🚗",
    مطعم: "مطعم 🍽️",
    كوفيه: "كوفيه ☕",
    كافيه: "كافيه ☕",
    كافية: "كافية ☕",
    قهوة: "قهوة ☕",
    طعام: "طعام 🍲",
    أكل: "أكل 🍴",
    وجبات: "وجبات 🍱",
    افتتاح: "افتتاح 🎉",
    خدمة: "خدمة ✅",
    خدمات: "خدمات ✅",
    توصيل: "توصيل 🚗",
    فعالية: "فعالية 🎊",
    فعاليه: "فعاليه 🎊",
    نشاط: "نشاط 🎯",
    منتجع: "منتجع 🏖️",
    ترفيه: "ترفيه 🎪",
    ترفيهي: "ترفيهي 🎪",
    وظيفة: "وظيفة 💼",
    وظيفه: "وظيفه 💼",
    عمل: "عمل 👔",
    راتب: "راتب 💵",
    "أسر منتجة": "أسر منتجة 🏺",
    "أسر منتجه": "أسر منتجه 🏺",
    منتج: "منتج 📦",
    منتجات: "منتجات 🛍️",
    جديد: "جديد ✨",
    جديده: "جديده ✨",
    مميز: "مميز ⭐",
    مميزة: "مميزة ⭐",
    مميزه: "مميزه ⭐",
    فاخر: "فاخر 👑",
    فاخرة: "فاخرة 👑",
    فاخره: "فاخره 👑",
    فرصة: "فرصة 🎯",
    فرصه: "فرصه 🎯",
    عرض: "عرض 🔥",
    خصم: "خصم 🔻",
    متوفر: "متوفر ✅",
    يوجد: "يوجد ✔️",
    للاستفسار: "للاستفسار 📞",
    للتواصل: "للتواصل 📱",
    واتساب: "واتساب 💬",
    واتس: "واتس 💬",
  };

  Object.keys(emojiMap).forEach((keyword) => {
    const regex = new RegExp(`\\b${keyword}\\b`, "g");
    let replaced = false;

    enhanced = enhanced.replace(regex, (match) => {
      if (!replaced && !enhanced.includes(emojiMap[keyword])) {
        replaced = true;
        return emojiMap[keyword];
      }
      return match;
    });
  });

  if (enhanced === text) {
    enhanced = `✨ ${enhanced}`;
  }

  return {
    enhanced,
    enhancedText: enhanced,
    improvements: ["تمت إضافة رموز تعبيرية بذكاء حسب المحتوى"],
  };
}

/**
 * Detect ad category from text using AI.
 * @param {string} text
 * @returns {Promise<string|null>}
 */
async function detectCategory(text) {
  if (!hasAnyEnabledProvider()) {
    return detectCategoryFallback(text);
  }

  const taxonomy = await wordpressCategoryService.getTrustedTaxonomy();
  const masaakCategoriesText =
    (taxonomy?.masaak?.mainCategoryNames || []).join("، ");
  const hasakCategoriesText =
    (taxonomy?.hasak?.mainCategoryNames || []).join("، ");

  const prompt = `صنّف النص التالي إلى تصنيف واحد مناسب فقط من القوائم المعتمدة.

النص:
"${text}"

قواعد التصنيف:
1) إذا كان الإعلان عقاري (شقة/فيلا/أرض/عمارة/محل/مستودع...) اختر من فئات مسعاك.
2) إذا كان الإعلان عن فعالية/حراج/مستعمل/وظائف/خدمات اختر من فئات حساك.
3) لا تستخدم "طلبات" إلا إذا النص طلب واضح (مطلوب/أبحث عن) وليس عرض بيع مباشر.

أعد JSON فقط:
{"category":"اسم التصنيف", "confidence":0.9, "reason":"سبب مختصر"}

فئات مسعاك:
${masaakCategoriesText}

فئات حساك:
${hasakCategoriesText}`;

  try {
    const { data } = await callLLM({
      taskName: "Detect Category",
      prompt,
      schema: DETECT_CATEGORY_SCHEMA,
      providerOrder: [PROVIDERS.GPT, PROVIDERS.GEMINI],
      temperature: 0,
      maxTokens: 250,
    });

    const category = resolveTrustedMainCategory(data.category);
    return category || detectCategoryFallback(text);
  } catch (error) {
    console.error("Error in detectCategory:", error.message || error);
    return detectCategoryFallback(text);
  }
}

/**
 * Fallback keyword-based category detection.
 * @param {string} text
 * @returns {string|null}
 */
function detectCategoryFallback(text) {
  const normalizedText = normalizeArabicText(text || "");
  const inferredPropertyCategory = canonicalizeMasaakCategory(
    detectPropertyTypeFromText(normalizedText),
  );

  // Prefer direct real-estate offer categories over "طلبات" when text says "للبيع/للإيجار".
  if (
    inferredPropertyCategory &&
    hasOfferIntent(normalizedText) &&
    !hasRequestIntent(normalizedText)
  ) {
    console.log(
      `🏷️ Fallback detected category: ${inferredPropertyCategory} (real-estate offer priority)`,
    );
    return inferredPropertyCategory;
  }

  const categoryKeywords = {
    "حراج الحسا": [
      "حراج الحسا",
      "حراج الأحساء",
      "حراج الحساء",
      "سيارة",
      "سيارات",
      "جمس",
      "جيب",
      "كورولا",
      "النترا",
      "كامري",
      "سوناتا",
      "بانوراما",
      "معرض سيارات",
      "سيارات مستعملة",
      "حراج",
    ],
    "أسر منتجة": [
      "أسر منتجة",
      "اسر منتجة",
      "أسر منتجه",
      "اسر منتجه",
      "منزلية",
      "منزليه",
      "معجنات",
      "حلويات منزلية",
      "أكل بيت",
      "اكل بيت",
      "منتجات منزلية",
      "سفرة",
      "سفره",
    ],
    "كوفيهات أو مطاعم": [
      "كوفي",
      "كوفيه",
      "كافيه",
      "قهوة",
      "مطعم",
      "مطاعم",
      "وجبات",
      "برجر",
      "بيتزا",
      "مشويات",
    ],
    "منتجعات وإستراحات": [
      "منتجع",
      "منتجعات",
      "استراحة",
      "استراحه",
      "شالية",
      "شاليه",
      "مسبح",
      "مناسبات",
    ],
    "الفعاليات والانشطة": [
      "فعالية",
      "فعاليات",
      "فعاليه",
      "نشاط",
      "أنشطة",
      "انشطة",
      "مهرجان",
      "احتفال",
      "معرض",
      "event",
    ],
    "برامج ووظائف": ["برنامج", "برامج", "وظيفة", "وظائف", "توظيف", "دوام"],
    "محلات تجارية": ["محل", "محلات", "متجر", "سوق", "مول", "بازار"],
    "مركز ترفيهي": ["ترفيهي", "ترفيه", "العاب", "ألعاب", "ملاهي"],
    طلبات: [
      "ابغى اشتري",
      "ابغا اشتري",
      "ابي اشتري",
      "ودي اشتري",
      "مطلوب",
      "ابحث عن",
      "ادور",
      "من عنده",
      "مين عنده",
      "حد عنده",
      "احتاج",
      "محتاج",
      "تكفون",
      "عايز",
    ],
    إيجار: [
      "للإيجار",
      "للأجار",
      "للاجار",
      "ايجار",
      "إيجار",
      "تأجير",
      "rent",
      "for rent",
    ],
    شقة: ["شقة", "شقه", "apartment"],
    فيلا: ["فيلا", "فله", "villa"],
    بيت: ["بيت", "منزل", "بيوت"],
    أرض: ["أرض", "ارض", "قطعة أرض", "قطعة ارض"],
    عمارة: ["عمارة", "عماره", "بناية"],
    دبلكس: ["دبلكس", "دوبلكس", "duplex"],
    مزرعة: ["مزرعة", "مزرعه", "farm"],
    استراحة: ["استراحة", "استراحه"],
    شالية: ["شالية", "شاليه"],
    "محل تجاري": ["محل تجاري", "shop", "سوبر ماركت"],
    مستودع: ["مستودع", "warehouse"],
    فعاليات: ["فعالية", "فعاليات", "مناسبة", "احتفال", "مهرجان"],
    خدمات: ["خدمة", "خدمات", "صيانة", "نقل", "توصيل"],
  };

  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    for (const keyword of keywords) {
      if (new RegExp(keyword, "i").test(normalizedText)) {
        const trustedCategory = resolveTrustedMainCategory(category);
        if (!trustedCategory) {
          continue;
        }
        console.log(
          `🏷️ Fallback detected category: ${trustedCategory} (matched: ${keyword})`,
        );
        return trustedCategory;
      }
    }
  }

  return null;
}

/**
 * Generate WhatsApp message from WordPress data.
 * @param {object} wpData
 * @param {string|null} wpLink
 * @param {string} website
 * @param {object|null} settings
 * @returns {string}
 */
function generateWhatsAppMessage(
  wpData,
  wpLink = null,
  website = "masaak",
  settings = null,
) {
  const meta = wpData?.meta || {};
  let message = "";

  const defaultHasakFooter = `┈┉━🔰 *منصة 🌴حساك* 🔰━┅┄
*✅إنضم في منصة حساك* 
https://chat.whatsapp.com/Ge3nhVs0MFT0ILuqDmuGYd?mode=ems_copy_t
 *✅للإعلانات في منصة حساك* 
0507667103`;

  const defaultMasaakFooter = `┈┉━━🔰 *مسعاك العقارية* 🔰━━┅┄
⭕ إبراء للذمة التواصل فقط مع مسعاك عند الشراء أو إذا عندك مشتري ✅ نتعاون مع جميع الوسطاء`;

  if (website === "hasak") {
    if (wpData?.title) {
      message += `*${wpData.title}*\n`;
    }

    if (wpLink) {
      message += `\n👈 *للتفاصيل اضغط على الرابط👇*\n${wpLink}`;
    }

    const hasakFooter =
      settings && settings.hasakFooter
        ? settings.hasakFooter
        : defaultHasakFooter;
    message += `\n${hasakFooter}`;
  } else {
    if (wpData?.title) {
      message += `*${wpData.title}*\n\n`;
    }

    if (meta.price_amount || meta.price || meta.price_type) {
      const priceType = String(meta.price_type || "").toLowerCase();
      const isContactPrice = priceType.includes("عند التواصل");
      const isNegotiable =
        priceType.includes("على السوم") || priceType.includes("السوم وصل");
      const hasNumericPrice = meta.price_amount || meta.price;

      if (hasNumericPrice || isContactPrice || isNegotiable) {
        message += "💰 *السعر:* ";

        if (isContactPrice && !hasNumericPrice) {
          message += "عند التواصل";
        } else if (isNegotiable && !hasNumericPrice) {
          message += meta.price_type;
        } else if (hasNumericPrice) {
          if (meta.price_type) {
            if (priceType.includes("متر") || priceType.includes("meter")) {
              message += `${meta.price_amount || meta.price} ريال للمتر`;
            } else if (
              priceType.includes("صافي") ||
              priceType.includes("total") ||
              priceType.includes("إجمالي")
            ) {
              message += `${meta.price_amount || meta.price} ريال`;
            } else {
              message += `${meta.price_amount || meta.price} ريال (${meta.price_type})`;
            }
          } else if (meta.from_price && meta.to_price) {
            message += `من ${meta.from_price} إلى ${meta.to_price} ريال`;
          } else {
            message += `${meta.price_amount || meta.price} ريال`;
          }
        }

        message += "\n";
      }
    }

    if (meta.arc_space || meta.order_space) {
      message += `📏 *المساحة:* ${meta.arc_space || meta.order_space} متر\n`;
    }

    if (meta.location || meta.City || meta.before_City) {
      const location = [meta.location, meta.City, meta.before_City]
        .map((value) => normalizeArabicText(value))
        .filter((value) => !isPlaceholderLocationValue(value))
        .join(" - ");
      if (location) {
        message += `📍 *الموقع:* ${location}\n`;
      }
    }

    message += "📲 *للتواصل:* 0508001475\n";

    if (wpLink) {
      message += `\n👈 *للتفاصيل اضغط على الرابط👇*\n${wpLink}`;
    }

    const masaakFooter =
      settings && settings.masaakFooter
        ? settings.masaakFooter
        : defaultMasaakFooter;
    message += `\n${masaakFooter}`;
  }

  return message.trim();
}

/**
 * Extract WordPress-ready data from ad text.
 * @param {string} adText
 * @param {boolean} isRegeneration
 */
async function extractWordPressData(
  adText,
  isRegeneration = false,
  options = {},
) {
  const normalizedAdText = String(adText || "").trim();
  const extractedPhones = extractPhoneNumbers(normalizedAdText);
  const preferredTargetWebsite = normalizeArabicText(
    options?.targetWebsite || "",
  );

  if (!hasAnyEnabledProvider()) {
    throw new Error(
      "❌ No enabled API keys available for WordPress extraction",
    );
  }

  const contactHint =
    extractedPhones.length > 0
      ? `أرقام الهاتف المستخرجة من النص: ${extractedPhones
          .map((phone) => phone.normalized)
          .join(", ")}`
      : "لا يوجد رقم هاتف واضح في النص.";

  const prompt = await buildWordPressExtractionPrompt(
    normalizedAdText,
    contactHint,
    isRegeneration,
    preferredTargetWebsite || null,
  );

  const providerOrders = unique([
    `${PROVIDERS.GPT},${PROVIDERS.GEMINI}`,
    `${PROVIDERS.GEMINI},${PROVIDERS.GPT}`,
  ]).map((order) => order.split(","));

  let lastError = null;

  for (const order of providerOrders) {
    try {
      const { data } = await callLLM({
        taskName: "Extract WordPress Data",
        prompt,
        schema: WORDPRESS_SCHEMA,
        providerOrder: order,
        temperature: 0.1,
        maxTokens: 2200,
        maxRetries: null,
      });

      const normalizedData = normalizeWordPressData(
        data,
        normalizedAdText,
        extractedPhones,
        isRegeneration,
      );

      const normalizedResult = await ensureRequiredMetadataCoverage({
        wpData: normalizedData,
        adText: normalizedAdText,
        extractedPhones,
        isRegeneration,
        maxPasses: 2,
      });

      if (preferredTargetWebsite === "masaak" || preferredTargetWebsite === "hasak") {
        normalizedResult.targetWebsite = preferredTargetWebsite;
      }

      return normalizedResult;
    } catch (error) {
      lastError = error;
      console.error(
        `❌ WordPress extraction failed for provider order [${order.join(" -> ")}]:`,
        error?.message || error,
      );
    }
  }

  const errorMessage =
    lastError?.message || String(lastError || "Unknown error");
  throw new Error(`فشل في استخراج بيانات الإعلان: ${errorMessage}`);
}

/**
 * Process a message: detect if it's an ad and generate WordPress data.
 * @param {string} text
 */
async function processMessage(text, options = {}) {
  try {
    const detection = await detectAd(text);

    if (!detection.isAd || detection.confidence < 40) {
      return {
        isAd: false,
        originalText: text,
        enhancedText: null,
        confidence: detection.confidence,
        reason: detection.reason,
        improvements: [],
        category: null,
        meta: {},
        wpData: null,
        whatsappMessage: null,
      };
    }

    const detectedCategory = await detectCategory(text);

    let wpData = null;

    try {
      console.log("🤖 Automatically generating WordPress data...");
      wpData = await extractWordPressData(text, false, {
        targetWebsite: options?.targetWebsite || "",
      });
      if (wpData) {
        const inferredTargetWebsite =
          wpData.targetWebsite || inferTargetWebsiteFromData(wpData, text);
        wpData = sanitizeWordPressDataForStorage(wpData, inferredTargetWebsite);
      }
      console.log("✅ WordPress data generated successfully");
    } catch (wpError) {
      console.error("⚠️ Failed to generate WordPress data:", wpError.message);
    }

    return {
      isAd: true,
      originalText: text,
      enhancedText: text,
      confidence: detection.confidence,
      reason: detection.reason,
      improvements: [],
      category: detectedCategory,
      meta: wpData?.meta || {},
      wpData,
      whatsappMessage: null,
    };
  } catch (error) {
    console.error("Error processing message:", error);
    return {
      isAd: false,
      originalText: text,
      enhancedText: null,
      confidence: 0,
      reason: "خطأ في المعالجة",
      improvements: [],
      category: null,
      meta: {},
      wpData: null,
      whatsappMessage: null,
    };
  }
}

/**
 * Validate user input using AI.
 * @param {string} input
 * @param {string} fieldName
 * @param {string} context
 */
async function validateUserInput(input, fieldName = "name", context = "") {
  if (!hasAnyEnabledProvider()) {
    return { isValid: true, reason: "لا توجد مفاتيح تفعيل", suggestion: "" };
  }

  let prompt = "";

  if (fieldName === "name") {
    prompt = `أنت مساعد تدقيق أسماء. تحقق إن كان المدخل اسم شخص فقط.

المدخل: "${input}"

ارفض إذا احتوى على تفاصيل عقارية، أسعار، أرقام كثيرة، أو رموز غير طبيعية.
أعد JSON فقط:
{"isValid": true, "reason": "", "suggestion": ""}`;
  } else {
    prompt = `تحقق من صحة المدخل للحقل "${fieldName}":
"${input}"
السياق: ${context}

أعد JSON فقط:
{"isValid": true, "reason": "", "suggestion": ""}`;
  }

  try {
    const { data } = await callLLM({
      taskName: `Validate ${fieldName}`,
      prompt,
      schema: VALIDATION_SCHEMA,
      providerOrder: [PROVIDERS.GPT, PROVIDERS.GEMINI],
      temperature: 0,
      maxTokens: 250,
    });

    return data;
  } catch (error) {
    console.error("Error in validateUserInput:", error.message || error);
    return { isValid: true, reason: "تعذر التحقق", suggestion: "" };
  }
}

module.exports = {
  detectAd,
  enhanceAd,
  processMessage,
  extractWordPressData,
  generateWhatsAppMessage,
  sanitizeGeneratedHtmlDescription,
  sanitizeWordPressDraftData,
  sanitizeWordPressDataForStorage,
  validateUserInput,
  getApiKeysStatus,
  __private: {
    buildRecoverMissingFieldsPrompt,
    buildWordPressExtractionPrompt,
    buildCleanMainAdText,
    canonicalizeMasaakCategory,
    detectCategoryFallback,
    enforceWordPressPhonePolicy,
    extractPhoneNumbers,
    extractLocationFromTextFallback,
    hasForbiddenDescriptionContent,
    inferTargetWebsiteFromData,
    normalizeLocationMeta,
    normalizeMasaakSubcategory,
    normalizeWordPressCategoryMeta,
    removeForbiddenInlineContent,
    resolveCategoryId,
    resolveTrustedMainCategory,
    resolveTrustedSubcategory,
    sanitizeGeneratedHtmlDescription,
    sanitizeLocationCandidate,
    shouldApplyForbiddenDescriptionRules,
    stripPhoneLikeNumbers,
    summarizeRequiredMetadata,
  },
};
