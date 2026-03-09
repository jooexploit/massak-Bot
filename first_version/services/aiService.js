const { GoogleGenerativeAI } = require("@google/generative-ai");
const OpenAI = require("openai");

const apiKeyManager = require("./apiKeyManager");
const areaNormalizer = require("./areaNormalizer");
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
const MASAAK_CATEGORIES = [
  ...new Set(
    Object.keys(websiteConfig.masaak.categories || {})
      .map((name) => String(name || "").trim())
      .filter((name) => name && name !== "default" && name !== "Uncategorized"),
  ),
];
const HASAK_CATEGORIES = [
  ...new Set(
    Object.keys(websiteConfig.hasak.categories || {})
      .map((name) => String(name || "").trim())
      .filter((name) => name && name !== "default" && name !== "Uncategorized"),
  ),
];
const MASAAK_SUBCATEGORY_MAP = websiteConfig.masaak.subcategories || {};
const MASAAK_SUBCATEGORY_LINES_FOR_PROMPT = Object.entries(MASAAK_SUBCATEGORY_MAP)
  .map(([main, subMap]) => {
    const parent = String(main || "").trim();
    const children = Object.keys(subMap || {})
      .map((name) => String(name || "").trim())
      .filter(Boolean);

    if (!parent || children.length === 0) return "";
    return `${parent}: ${children.join("، ")}`;
  })
  .filter(Boolean);
const DEFAULT_DYNAMIC_BEFORE_CITIES = [...DEFAULT_WP_BEFORE_CITY_OPTIONS];
const DEFAULT_DYNAMIC_CITIES = [...DEFAULT_WP_CITY_OPTIONS];
const DYNAMIC_LOCATION_CACHE_TTL_MS = 30000;

let dynamicLocationHintsCache = {
  loadedAt: 0,
  beforeCities: [...DEFAULT_DYNAMIC_BEFORE_CITIES],
  cities: [...DEFAULT_DYNAMIC_CITIES],
};

const CATEGORY_LIST = [
  ...new Set(
    [
      "شقق للبيع",
      "شقق للإيجار",
      "فيلا للبيع",
      "فيلا للإيجار",
      "عمارة للبيع",
      "عمارة للإيجار",
      "أرض للبيع",
      "أرض للإيجار",
      "محل للبيع",
      "محل للإيجار",
      "محل للتقبيل",
      "استراحة للبيع",
      "استراحة للإيجار",
      "شاليه للإيجار",
      "مزرعة للبيع",
      "مزرعة للإيجار",
      "فعاليات",
      "حراج",
      "أسر منتجة",
      "خدمات",
      "طلبات",
      ...MASAAK_CATEGORIES,
      ...Object.keys(MASAAK_SUBCATEGORY_MAP || {}),
      ...Object.values(MASAAK_SUBCATEGORY_MAP || {}).flatMap((subMap) =>
        Object.keys(subMap || {}),
      ),
      ...HASAK_CATEGORIES,
    ]
      .map((name) => String(name || "").trim())
      .filter(Boolean),
  ),
];

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
  before_City: "",
  before_city: "",
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
      if (typeof unwrapped === "string" && normalizeWhitespace(unwrapped) === "") {
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
    .replace(
      /قطعة\s*[:：-]?\s*[0-9٠-٩]+(?:\s*[A-Za-z\u0600-\u06FF]+)?/gi,
      "",
    )
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
    .slice(0, 300);

  const uniqueValues = unique(normalized);
  if (uniqueValues.length > 0) return uniqueValues;

  return unique(
    (Array.isArray(fallback) ? fallback : [])
      .filter((value) => typeof value === "string")
      .map((value) => normalizeArabicText(value))
      .filter(Boolean),
  );
}

function getDynamicLocationHints(forceRefresh = false) {
  const isFresh =
    !forceRefresh &&
    dynamicLocationHintsCache.loadedAt > 0 &&
    Date.now() - dynamicLocationHintsCache.loadedAt < DYNAMIC_LOCATION_CACHE_TTL_MS;

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
  const normalizedText = normalizeArabicText(text || "").toLowerCase();
  if (!normalizedText || !Array.isArray(options) || options.length === 0) {
    return "";
  }

  const sortedOptions = normalizeLocationHintList(options)
    .sort((a, b) => b.length - a.length);

  for (const option of sortedOptions) {
    const normalizedOption = normalizeArabicText(option).toLowerCase();
    if (!normalizedOption) continue;

    if (
      normalizedText === normalizedOption ||
      normalizedText.includes(` ${normalizedOption} `) ||
      normalizedText.includes(normalizedOption)
    ) {
      return option;
    }
  }

  return "";
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
${citiesLine}`;
}

function inferCityGovernorateFromText(adText) {
  const text = normalizeArabicText(adText || "");
  if (!text) {
    return { city: "", governorate: "" };
  }

  let city = "";
  let governorate = "";

  const match = text.match(
    /(?:^|[\s(])(في|ب)\s*([^،,\n]{2,40})\s*[،,]\s*([^،,\n]{2,40})/i,
  );
  if (match) {
    city = normalizeArabicText(match[2]);
    governorate = normalizeArabicText(match[3]);
  }

  if (!city) {
    const cityMatch = text.match(
      /(?:المدينة|المدينه|مدينة|مدينه)\s*[:：-]?\s*([^\n،,]{2,35})/i,
    );
    if (cityMatch) {
      city = normalizeArabicText(cityMatch[1]);
    }
  }

  if (areaNormalizer.normalizeCityName) {
    city = normalizeArabicText(areaNormalizer.normalizeCityName(city) || city);
    governorate = normalizeArabicText(
      areaNormalizer.normalizeCityName(governorate) || governorate,
    );
  }

  const dynamicHints = getDynamicLocationHints(false);
  if (!city) {
    city = inferLocationFromKnownOptions(text, dynamicHints.cities);
  }
  if (!governorate) {
    governorate = inferLocationFromKnownOptions(text, dynamicHints.beforeCities);
  }

  if (!city) {
    const neighborhoodHints = areaNormalizer.extractNeighborhoods(text);
    for (const hint of neighborhoodHints) {
      const inferredCity = normalizeArabicText(
        areaNormalizer.inferCityFromArea ? areaNormalizer.inferCityFromArea(hint) : "",
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

function normalizeContactList(rawContact, extractedPhones = []) {
  const contacts = [];

  if (Array.isArray(rawContact)) {
    for (const item of rawContact) {
      if (typeof item === "string") {
        contacts.push({ value: normalizePhoneNumber(item), type: "phone", confidence: 1 });
        continue;
      }

      if (isObject(item)) {
        const value = normalizePhoneNumber(item.value || item.phone || "");
        if (!value) continue;

        const confidenceRaw = extractNumericValue(item.confidence);
        const confidence =
          typeof confidenceRaw === "number"
            ? clamp(confidenceRaw <= 1 ? confidenceRaw : confidenceRaw / 100, 0, 1)
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

  return raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
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

  const withoutTrailingCommas = normalizedCandidate.replace(/,\s*([}\]])/g, "$1");
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
    /(timeout|timed out|ECONNRESET|ECONNREFUSED|ENOTFOUND|network)/i.test(message)
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
  const template = schema?.template ? JSON.stringify(schema.template, null, 2) : "";
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
  const choice = Array.isArray(completion?.choices) ? completion.choices[0] : null;
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
        return firstNonEmpty(part.text, part.output_text, part.content, part.value, "");
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
          firstNonEmpty(toolCall?.function?.arguments, toolCall?.custom?.input, ""),
        )
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    : [];

  if (toolCallPayloads.length > 0) {
    return toolCallPayloads.join("\n");
  }

  const functionCallArguments = firstNonEmpty(message.function_call?.arguments, "");
  if (typeof functionCallArguments === "string" && functionCallArguments.trim()) {
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
            completion = await client.chat.completions.create(completionRequest);
          } else if (reasoningEffortUnsupported) {
            delete completionRequest.reasoning_effort;
            completion = await client.chat.completions.create(completionRequest);
          } else {
            throw error;
          }
        }

        const choice = Array.isArray(completion?.choices)
          ? completion.choices[0]
          : null;
        const message = choice?.message;
        const extractedText = extractTextFromGptMessage(message);

        if (!extractedText && typeof message?.refusal === "string" && message.refusal.trim()) {
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
        attempt === 1 || !schema ? prompt : buildStrictJsonPrompt(prompt, schema);

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
          normalized.type === "invalid_json" && attempt === 1 && Boolean(schema);

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

    let confidence = extractNumericValue(firstNonEmpty(obj.confidence, obj.score));
    if (confidence === "") {
      confidence = isAd ? 70 : 20;
    }

    if (typeof confidence === "number" && confidence <= 1) {
      confidence *= 100;
    }

    const reason =
      normalizeArabicText(firstNonEmpty(obj.reason, obj.explanation, obj.note)) ||
      (isAd ? "تم تصنيف الرسالة كإعلان" : "الرسالة ليست إعلاناً واضحاً");

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
  match: (obj) => isObject(obj) && ("category" in obj || "classification" in obj),
  sanitize: (obj) => {
    const category = normalizeArabicText(
      firstNonEmpty(obj.category, obj.classification, obj.label, obj.result),
    );

    const confidenceRaw = extractNumericValue(firstNonEmpty(obj.confidence, obj.score));
    const confidence =
      typeof confidenceRaw === "number"
        ? clamp(confidenceRaw <= 1 ? confidenceRaw : confidenceRaw / 100, 0, 1)
        : undefined;

    const reason = normalizeArabicText(firstNonEmpty(obj.reason, obj.explanation));

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
      before_City: "",
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
    const confidenceRaw = extractNumericValue(firstNonEmpty(obj.confidence, obj.score));
    const confidence =
      typeof confidenceRaw === "number"
        ? clamp(confidenceRaw <= 1 ? confidenceRaw : confidenceRaw / 100, 0, 1)
        : 0.8;

    return {
      area: firstNonEmpty(obj.area, obj.arc_space, obj.order_space, ""),
      price: firstNonEmpty(obj.price, ""),
      price_method: firstNonEmpty(obj.price_method, obj.payment_method, obj.priceMethod, ""),
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
      governorate: firstNonEmpty(obj.governorate, obj.before_City, obj.before_city, ""),
      category: firstNonEmpty(obj.category, obj.arc_category, obj.parent_catt, ""),
      subcategory: firstNonEmpty(
        obj.subcategory,
        obj.arc_subcategory,
        obj.sub_catt,
        "",
      ),
      notes: normalizeArabicText(firstNonEmpty(obj.notes, obj.reason, obj.explanation, "")),
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
    suggestion: normalizeArabicText(firstNonEmpty(obj.suggestion, obj.fix)) || "",
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

function resolveCategoryId(category) {
  const normalized = normalizeArabicText(category);
  if (!normalized) return "";

  return (
    websiteConfig.masaak.categories[normalized] ||
    websiteConfig.hasak.categories[normalized] ||
    ""
  );
}

function normalizeCategoryLabel(label) {
  const normalized = normalizeArabicText(label);
  if (!normalized) return "";

  if (CATEGORY_LIST.includes(normalized)) {
    return normalized;
  }

  const found = CATEGORY_LIST.find((category) => normalized.includes(category));
  return found || normalized;
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
      normalizeArabicText(firstNonEmpty(meta.location, meta.neighborhood, "")),
      normalizeArabicText(firstNonEmpty(meta.City, meta.subcity, meta.city, "")),
      normalizeArabicText(firstNonEmpty(meta.before_City, meta.before_city, "")),
    ].filter(
      (value) =>
        value && value !== "لم يذكر" && value !== "لا يوجد",
    ),
  );

  if (parts.length > 0) {
    return parts.join(" - ");
  }

  return normalizeArabicText(fallback || "");
}

function hasDetailedLocation(meta = {}) {
  const fullLocation = normalizeArabicText(meta.full_location || "");
  if (fullLocation && !["الأحساء", "لم يذكر", "لا يوجد"].includes(fullLocation)) {
    return true;
  }

  const beforeCity = normalizeArabicText(firstNonEmpty(meta.before_City, meta.before_city, ""));
  const city = normalizeArabicText(firstNonEmpty(meta.City, meta.subcity, meta.city, ""));
  const neighborhood = normalizeArabicText(firstNonEmpty(meta.location, meta.neighborhood, ""));

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

  let city = normalizeArabicText(firstNonEmpty(meta.city, meta.City, meta.subcity));
  let beforeCity = normalizeArabicText(
    firstNonEmpty(
      meta.before_City,
      meta.before_city,
      inferred.governorate,
      "",
    ),
  );
  let subcity = normalizeArabicText(firstNonEmpty(meta.subcity, city));

  let neighborhood = normalizeArabicText(
    firstNonEmpty(meta.neighborhood, meta.location, ""),
  );
  neighborhood = normalizeNeighborhoodName(neighborhood);

  if (areaNormalizer.normalizeCityName) {
    city = normalizeArabicText(areaNormalizer.normalizeCityName(city) || city);
    beforeCity = normalizeArabicText(
      areaNormalizer.normalizeCityName(beforeCity) || beforeCity,
    );
    subcity = normalizeArabicText(areaNormalizer.normalizeCityName(subcity) || subcity);
  }

  if (
    !neighborhood ||
    neighborhood === "غير محدد" ||
    neighborhood === "لا يوجد"
  ) {
    neighborhood = isHasak ? "" : "لم يذكر";
  }

  if (!city) {
    city = inferLocationFromKnownOptions(adText, dynamicHints.cities);
  }
  if (!beforeCity) {
    beforeCity = inferLocationFromKnownOptions(adText, dynamicHints.beforeCities);
  }

  if (neighborhood.includes("،") || neighborhood.includes(",")) {
    const parts = neighborhood
      .split(/[،,]/)
      .map((part) => normalizeArabicText(part))
      .filter(Boolean);

    if (parts.length >= 2) {
      const [firstPart, secondPart] = parts;
      if (secondPart === beforeCity || secondPart === city) {
        neighborhood = firstPart;
      } else if (firstPart === beforeCity && secondPart) {
        neighborhood = secondPart;
      }
    }
  }

  if (neighborhood && neighborhood !== "لم يذكر" && areaNormalizer.normalizeAreaName) {
    neighborhood = normalizeArabicText(
      areaNormalizer.normalizeAreaName(neighborhood) || neighborhood,
    );
    neighborhood = normalizeNeighborhoodName(neighborhood);
  }

  const inferredCityFromNeighborhood = normalizeArabicText(
    neighborhood && neighborhood !== "لم يذكر" && areaNormalizer.inferCityFromArea
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
  const uniqueNeighborhoodCandidates = [...new Set(cityCandidatesFromNeighborhood)];
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
    city = normalizeArabicText(
      areaNormalizer.normalizeCityName
        ? areaNormalizer.normalizeCityName(inferred.city) || inferred.city
        : inferred.city,
    );
  }

  if ((!subcity || subcity === beforeCity) && city) {
    subcity = city;
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

  if (/(?:تقسيط|أقساط|اقساط|دفعة|دفعات|شهري|شهرياً|سنوي|سنوياً)/i.test(normalized)) {
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
  const normalized = normalizeCategoryLabel(label);
  if (!normalized) return "";

  const aliases = {
    ارض: "أرض",
    شقه: "شقة",
    عماره: "عمارة",
    مزرعه: "مزرعة",
    استراحه: "استراحة",
    شاليه: "شالية",
    فيله: "فيلا",
    فلة: "فيلا",
    منزل: "بيت",
    بيوت: "بيت",
    طلب: "طلبات",
  };

  if (aliases[normalized]) {
    return aliases[normalized];
  }

  return normalized;
}

function normalizeWordPressCategoryMeta(meta, adText = "") {
  const normalizedAdText = normalizeArabicText(adText || "");
  const offerInText = hasOfferIntent(normalizedAdText);
  const requestInText = hasRequestIntent(normalizedAdText);
  const realEstateInText = hasRealEstateCue(normalizedAdText);
  const inferredPropertyCategory = canonicalizeMasaakCategory(
    detectPropertyTypeFromText(normalizedAdText),
  );

  let candidateCategory = canonicalizeMasaakCategory(
    firstNonEmpty(meta.category, meta.arc_category, meta.parent_catt),
  );
  if (!candidateCategory && inferredPropertyCategory) {
    candidateCategory = inferredPropertyCategory;
  }

  const candidateSubCategory = normalizeCategoryLabel(
    firstNonEmpty(meta.subcategory, meta.arc_subcategory, meta.sub_catt),
  );

  if (!meta.category) meta.category = candidateCategory;
  if (!meta.subcategory) meta.subcategory = candidateSubCategory;

  const shouldPreferRealEstateFromText =
    offerInText && realEstateInText && !!inferredPropertyCategory;
  const hasakCategory = [meta.category, meta.parent_catt, meta.arc_category].find((c) =>
    HASAK_CATEGORIES.includes(c),
  );

  if (hasakCategory && !shouldPreferRealEstateFromText) {
    meta.category = hasakCategory;
    meta.arc_category = hasakCategory;
    if (!meta.arc_subcategory) {
      meta.arc_subcategory = candidateSubCategory || meta.sub_catt || "";
    }

    meta.parent_catt = "";
    meta.sub_catt = "";

    if (!meta.category_id) {
      meta.category_id = resolveCategoryId(hasakCategory);
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
  const forceOfferFromText =
    offerInText && realEstateInText && !requestInText;

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
    meta.sub_catt = candidateSubCategory || meta.sub_catt || "";
    meta.arc_category = "";
    meta.arc_subcategory = "";
    meta.order_status = meta.order_status || "طلب جديد";
    meta.offer_status = meta.offer_status || "طلب جديد";
    return;
  }

  meta.parent_catt = meta.parent_catt || candidateCategory;
  meta.sub_catt = meta.sub_catt || candidateSubCategory;
  meta.arc_category = meta.arc_category || meta.parent_catt || candidateCategory;
  meta.arc_subcategory =
    meta.arc_subcategory || meta.sub_catt || candidateSubCategory;
  meta.category = meta.category || meta.parent_catt || meta.arc_category;
  meta.subcategory = meta.subcategory || meta.sub_catt || meta.arc_subcategory;

  if (!meta.category_id) {
    meta.category_id = resolveCategoryId(meta.category || meta.parent_catt || meta.arc_category);
  }
}

const FORBIDDEN_DESCRIPTION_PATTERNS = [
  /https?:\/\/[^\s<]+/gi,
  /(?:chat\.whatsapp\.com|wa\.me|t\.me|tiktok\.com|instagram\.com|snapchat|youtube\.com)/gi,
  /(?:رقم\s*الترخيص|ترخيص|رخصة|معلن\s*معتمد|الهيئة\s*العامة\s*للعقار)[^<\n]{0,40}[0-9٠-٩]{4,}/gi,
  /(?:برقم)\s*[0-9٠-٩]{4,}/gi,
  /(?:مكتب|وسيط|سمسار|ترخيص|رخصة|قروب|مجموعة واتساب|انضمام|شركة\s*عقارية|مؤسسة\s*عقارية|وكيل|الوكيل)/gi,
  /(?:للتواصل|للاستفسار|اتصال|واتساب|جوال|هاتف|موبايل|محمول)/gi,
  /(?:رقم\s*(?:التواصل|الجوال|الهاتف|الموبايل|المحمول)?\s*[:：-]?\s*)(?:\+?\d[\d\s\-()]{6,}\d)/gi,
  /(?:مباشر(?:ة)?|من\s*الوكيل|من\s*المالك|طرف)/gi,
  /\b(?:\+?966|0)?5[0-9٠-٩]{8}\b/g,
];

const OWNER_ADMIN_DETAIL_PATTERNS = [
  /(?:اسم\s*المالك|المالك|مالك\s*العقار|صاحب\s*العقار|صاحب\s*الإعلان|اسم\s*المعلن|المعلن)/i,
  /(?:مكتب|وسيط|سمسار|ترخيص|رخصة|رقم\s*الترخيص|رقم\s*المعلن|شركة\s*عقارية|مؤسسة\s*عقارية|وكيل|الوكيل)/i,
  /(?:للتواصل|للاستفسار|اتصال|واتساب|جوال|هاتف|موبايل|محمول|رقم\s*التواصل|رقم\s*الجوال|رقم\s*الموبايل|رقم\s*المحمول)/i,
  /(?:مباشر(?:ة)?|من\s*الوكيل|من\s*المالك|طرف)/i,
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

function removeForbiddenInlineContent(text) {
  let cleaned = String(text ?? "");
  FORBIDDEN_DESCRIPTION_PATTERNS.forEach((pattern) => {
    cleaned = cleaned.replace(pattern, "");
  });

  return normalizeArabicText(
    cleaned
      .replace(/[*`#]+/g, "")
      .replace(/[ \t]{2,}/g, " ")
      .trim(),
  );
}

function isOwnerOrAdministrativeDetailLine(line = "") {
  const normalized = normalizeArabicText(line || "");
  if (!normalized) return false;

  return OWNER_ADMIN_DETAIL_PATTERNS.some((pattern) => pattern.test(normalized));
}

function extractCleanDescriptionLines(adText) {
  const source = String(adText ?? "")
    .replace(/<[^>]+>/g, "\n")
    .replace(/\r/g, "\n");

  const lines = source
    .split(/\n+/)
    .map((line) => stripAdReferenceNumbers(removeForbiddenInlineContent(line)))
    .map((line) => line.replace(/^[\-*•:]+/g, "").trim())
    .filter(Boolean)
    .filter((line) => !isOwnerOrAdministrativeDetailLine(line))
    .filter((line) => line.length >= 3);

  return unique(lines).slice(0, 20);
}

function hasForbiddenDescriptionContent(text) {
  const value = String(text ?? "");
  return FORBIDDEN_DESCRIPTION_PATTERNS.some((pattern) => {
    const safePattern = new RegExp(pattern.source, pattern.flags.replace(/g/g, ""));
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

  const isRequestsBucket = Number(meta.category_id) === 83 || categoriesBlob.includes("طلبات");
  const hasRealEstateKeyword = REAL_ESTATE_KEYWORDS.some((keyword) =>
    categoriesBlob.includes(normalizeArabicText(keyword)),
  );
  const hasArea = extractNumericValue(firstNonEmpty(meta.arc_space, meta.area)) !== "";
  const textBlob = normalizeArabicText(adText || "");
  const hasRealEstateKeywordInText = REAL_ESTATE_KEYWORDS.some((keyword) =>
    textBlob.includes(normalizeArabicText(keyword)),
  );

  if (isRequestsBucket && !hasRealEstateKeyword && !hasRealEstateKeywordInText) {
    return false;
  }

  return hasRealEstateKeyword || hasArea || hasRealEstateKeywordInText;
}

function detectPropertyTypeFromText(adText = "") {
  const text = normalizeArabicText(adText);
  if (!text) return "";

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
    "مزرعة",
    "مزرعه",
    "استراحة",
    "استراحه",
    "شاليه",
    "محل",
    "مستودع",
  ];

  const found = priority.find((keyword) => text.includes(normalizeArabicText(keyword)));
  if (!found) return "";

  const aliases = {
    عماره: "عمارة",
    فيله: "فيلا",
    منزل: "بيت",
    بيوت: "بيت",
    شقه: "شقة",
    ارض: "أرض",
    مزرعه: "مزرعة",
    استراحه: "استراحة",
    شاليه: "شالية",
  };

  return aliases[found] || found;
}

function formatPriceSummary(meta = {}) {
  const priceType = normalizeArabicText(meta.price_type || "");
  const priceAmount = extractNumericValue(meta.price_amount);
  const fromPrice = extractNumericValue(meta.from_price);
  const toPrice = extractNumericValue(meta.to_price);

  if (
    priceType.includes("عند التواصل") ||
    priceType.includes("على السوم")
  ) {
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

  const freeTextPrice = removeForbiddenInlineContent(meta.price || "");
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

  if (normalized.includes("(") && normalized.includes(")") && matchedHints.length >= 3) {
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
          !["لم يذكر", "لا يوجد", "غير محدد", "n/a", "na", "none"].includes(value),
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
      new RegExp(`\\s*[\\(\\[]?\\s*ب(?:مدينة|محافظة)?\\s*${escaped}\\s*[\\)\\]]?`, "gi"),
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

  if (!locationLabel || ["لم يذكر", "لا يوجد", "غير محدد"].includes(locationLabel)) {
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

  const titleHasLocation = locationParts.some((part) => normalizedTitle.includes(part));
  if (titleHasLocation) {
    return sanitized;
  }

  return sanitizeTitle(`${sanitized} في ${locationLabel}`);
}

function buildRealEstateHtmlDescription({ title, meta, adText }) {
  const cleanLines = extractCleanDescriptionLines(adText);
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
  const priceSummary = formatPriceSummary(meta);
  const locationSummary = formatLocationSummary(meta);

  const intro =
    removeForbiddenInlineContent(
      cleanLines.find((line) => line.length >= 12) || "",
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

  const featureHintKeywords = /(ميزة|مميزات|فرصة|جديد|مؤجر|مدخول|مرهون|صك|عداد|خزان)/i;
  cleanLines.forEach((line) => {
    if (featureHintKeywords.test(line) && features.length < 10) {
      features.push(line);
      consumedLines.add(line);
    }
  });

  // Preserve additional property details that are not owner/admin/contact details.
  cleanLines.forEach((line) => {
    if (consumedLines.has(line)) return;
    if (isOwnerOrAdministrativeDetailLine(line)) return;

    if (/[:\-]/.test(line) && specs.length < 12) {
      specs.push(line);
      return;
    }

    if (features.length < 10) {
      features.push(line);
    }
  });

  const safeSpecs = unique(specs.map(removeForbiddenInlineContent).filter(Boolean));
  const safeFeatures = unique(features.map(removeForbiddenInlineContent).filter(Boolean));

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

  return sanitizeHtml(html);
}

function buildNonRealEstateHtmlDescription({ title, meta, adText }) {
  const cleanLines = extractCleanDescriptionLines(adText);
  const rawItemName = normalizeArabicText(
    firstNonEmpty(meta.sub_catt, meta.subcategory, meta.category, meta.parent_catt),
  );
  const titleHint = removeForbiddenInlineContent(
    stripAdReferenceNumbers(String(title || "")),
  )
    .replace(/^(?:عرض|طلب)\s*/i, "")
    .replace(/^(?:للبيع|للإيجار|للايجار|للتقبيل|مطلوب)\s*/i, "")
    .trim();
  const itemName = rawItemName || normalizeArabicText(titleHint);
  const adType = normalizeArabicText(meta.ad_type || "");
  const orderType = normalizeArabicText(firstNonEmpty(meta.order_type, meta.offer_type, ""));
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

  const priceSummary = formatPriceSummary(meta);
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
    if (isOwnerOrAdministrativeDetailLine(line)) return;
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
    detailParts.map(removeForbiddenInlineContent).filter(Boolean),
  ).slice(0, 14);
  const intro = safeDetailParts[0] || `${itemLabel} مع تفاصيل واضحة حسب المعلومات المتاحة.`;
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
  return sanitizeHtml(html);
}

function buildDeterministicDescription({ title, meta, adText }) {
  if (isLikelyRealEstateMeta(meta, adText)) {
    return buildRealEstateHtmlDescription({ title, meta, adText });
  }

  return buildNonRealEstateHtmlDescription({ title, meta, adText });
}

function normalizeWordPressData(rawData, adText, extractedPhones, isRegeneration) {
  const titleValue = firstNonEmpty(rawData.title, rawData.title?.rendered, rawData.title?.value);
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

  meta.category = normalizeCategoryLabel(firstNonEmpty(rawData.category, meta.category));
  meta.subcategory = normalizeCategoryLabel(
    firstNonEmpty(rawData.subcategory, meta.subcategory),
  );

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
  meta.order_owner = normalizeArabicText(meta.order_owner || meta.owner_type || "");
  meta.offer_owner = normalizeArabicText(meta.offer_owner || meta.owner_type || "");
  meta.owner_type = normalizeArabicText(meta.owner_type || meta.offer_owner || meta.order_owner || "");
  meta.order_type = normalizeArabicText(meta.order_type || meta.offer_type || meta.ad_type || "");
  meta.offer_type = normalizeArabicText(meta.offer_type || meta.order_type || "");
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

  const confidenceOverall = extractNumericValue(
    firstNonEmpty(rawData.confidence_overall, meta.confidence_overall),
  );
  meta.confidence_overall =
    typeof confidenceOverall === "number"
      ? clamp(confidenceOverall <= 1 ? confidenceOverall : confidenceOverall / 100, 0, 1)
      : 1;

  if (rawData.parse_error) {
    meta.parse_notes = normalizeArabicText(rawData.parse_error);
  }

  // Keep main_ad deterministic while stripping contact/admin/office phrases.
  meta.main_ad = removeForbiddenInlineContent(
    stripAdReferenceNumbers(adText || ""),
  );

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
    removeForbiddenInlineContent(titleValue || DEFAULT_WP_TITLE) || DEFAULT_WP_TITLE;
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
  });

  let finalContent = manualContent;

  if (!finalContent || hasForbiddenDescriptionContent(finalContent)) {
    const cleanedAdText = removeForbiddenInlineContent(
      stripAdReferenceNumbers(adText || ""),
    );
    finalContent = buildDeterministicDescription({
      title: normalizedTitle,
      meta,
      adText: cleanedAdText,
    });
  }

  if (!finalContent || hasForbiddenDescriptionContent(finalContent)) {
    const fallbackPlainText =
      removeForbiddenInlineContent(
        stripAdReferenceNumbers(contentValue || adText || ""),
      ) || "وصف مختصر للإعلان.";
    finalContent = sanitizeHtml(
      `<h1>${escapeHtml(normalizedTitle)}</h1><p>${escapeHtml(fallbackPlainText)}</p>`,
    );
  }

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
    firstNonEmpty(wpData?.category, meta.category, meta.arc_category, meta.parent_catt),
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
      HASAK_CATEGORIES.includes(value),
    )
  ) {
    return "hasak";
  }

  if (normalizedCategory && MASAAK_CATEGORIES.includes(normalizedCategory)) {
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
  const areaTextHasNumber = /[0-9]/.test(convertArabicDigitsToEnglish(areaText));
  const priceAmount = extractNumericValue(
    firstNonEmpty(meta.price_amount, meta.from_price, meta.to_price),
  );
  const priceText = normalizeArabicText(firstNonEmpty(meta.price_type, meta.price, ""));
  const priceMethod = normalizeArabicText(firstNonEmpty(meta.price_method, meta.payment_method, ""));
  const category = normalizeCategoryLabel(
    firstNonEmpty(wpData?.category, meta.category, meta.arc_category, meta.parent_catt),
  );
  const subcategory = normalizeCategoryLabel(
    firstNonEmpty(
      wpData?.subcategory,
      meta.subcategory,
      meta.arc_subcategory,
      meta.sub_catt,
    ),
  );
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
      neighborhood: normalizeNeighborhoodName(parts[0]),
      city: parts[1],
      governorate: parts.slice(2).join(" - "),
    };
  }

  if (parts.length === 2) {
    return {
      neighborhood: normalizeNeighborhoodName(parts[0]),
      city: parts[1],
      governorate: "",
    };
  }

  return {
    neighborhood: normalizeNeighborhoodName(parts[0] || ""),
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
    /(?:الحي|المنطقة|الموقع|المكان)\s*[:：-]?\s*([^\n،,]{2,40})/i,
    /في\s*حي\s*([^\n،,]{2,40})/i,
  ];

  for (const pattern of neighborhoodPatterns) {
    const match = normalizedText.match(pattern);
    if (!match) continue;
    neighborhood = normalizeNeighborhoodName(match[1]);
    if (neighborhood) break;
  }

  const cityPatterns = [
    /(?:المدينة|المدينه|مدينة|مدينه)\s*[:：-]?\s*([^\n،,]{2,35})/i,
    /(?:في|ب)\s*([^\n،,]{2,35})\s*[،,]\s*([^\n،,]{2,35})/i,
  ];

  for (const pattern of cityPatterns) {
    const match = normalizedText.match(pattern);
    if (!match) continue;

    if (!city) {
      city = normalizeArabicText(match[1]);
    }

    if (!governorate && match[2]) {
      governorate = normalizeArabicText(match[2]);
    }

    if (city) break;
  }

  if (!neighborhood) {
    const extractedNeighborhoods = areaNormalizer.extractNeighborhoods(normalizedText);
    if (extractedNeighborhoods.length > 0) {
      neighborhood = normalizeNeighborhoodName(extractedNeighborhoods[0]);
    }
  }

  if (neighborhood && areaNormalizer.normalizeAreaName) {
    neighborhood = normalizeNeighborhoodName(
      areaNormalizer.normalizeAreaName(neighborhood) || neighborhood,
    );
  }

  if (city && areaNormalizer.normalizeCityName) {
    city = normalizeArabicText(areaNormalizer.normalizeCityName(city) || city);
  }

  if (!city) {
    city = inferLocationFromKnownOptions(normalizedText, dynamicHints.cities);
  }
  if (!governorate) {
    governorate = inferLocationFromKnownOptions(
      normalizedText,
      dynamicHints.beforeCities,
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
    city = normalizeArabicText(
      areaNormalizer.normalizeCityName
        ? areaNormalizer.normalizeCityName(inferred.city) || inferred.city
        : inferred.city,
    );
  }
  if (!governorate && inferred.governorate) {
    governorate = normalizeArabicText(
      areaNormalizer.normalizeCityName
        ? areaNormalizer.normalizeCityName(inferred.governorate) || inferred.governorate
        : inferred.governorate,
    );
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
  const text = normalizeArabicText(adText || "");
  const patterns = [
    { regex: /دور\s*أول|الدور\s*الأول/i, value: "دور أول" },
    { regex: /دور\s*ثاني|الدور\s*الثاني/i, value: "دور ثاني" },
    { regex: /دور\s*أرضي|الدور\s*الأرضي/i, value: "دور أرضي" },
    { regex: /دبلكس|دوبلكس/i, value: "دبلكس" },
    { regex: /شقة\s*دبلكسية|شقه\s*دبلكسيه/i, value: "شقة دبلكسية" },
  ];

  const detected = patterns.find(({ regex }) => regex.test(text));
  if (detected) {
    return detected.value;
  }

  const normalizedCategory = normalizeCategoryLabel(category);
  if (normalizedCategory === "طلبات") {
    return "عام";
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

  const recoveredArea = extractNumericValue(firstNonEmpty(patch.area, patch.arc_space));
  if (typeof recoveredArea === "number" && recoveredArea > 0) {
    meta.arc_space = recoveredArea;
    meta.area = recoveredArea;
    meta.order_space = meta.order_space || `${recoveredArea} متر مربع`;
  }

  const recoveredPriceAmount = extractNumericValue(
    firstNonEmpty(patch.price_amount, patch.from_price, patch.to_price, patch.price),
  );
  const recoveredPriceType = normalizeArabicText(firstNonEmpty(patch.price_type, ""));
  const recoveredPriceText = normalizeArabicText(firstNonEmpty(patch.price, recoveredPriceType, ""));

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

  const parsedLocation = parseFullLocationText(firstNonEmpty(patch.fullLocation, ""));
  const recoveredNeighborhood = normalizeArabicText(
    firstNonEmpty(patch.neighborhood, patch.location, parsedLocation.neighborhood),
  );
  const recoveredCity = normalizeArabicText(firstNonEmpty(patch.city, parsedLocation.city));
  const recoveredGovernorate = normalizeArabicText(
    firstNonEmpty(patch.governorate, parsedLocation.governorate),
  );

  if (recoveredNeighborhood) {
    const cleanRecoveredNeighborhood = normalizeNeighborhoodName(recoveredNeighborhood);
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

  const recoveredCategory = canonicalizeMasaakCategory(
    firstNonEmpty(patch.category, patch.arc_category, patch.parent_catt),
  );
  if (recoveredCategory) {
    merged.category = recoveredCategory;
    meta.category = recoveredCategory;
    meta.arc_category = recoveredCategory;
    if (!HASAK_CATEGORIES.includes(recoveredCategory)) {
      meta.parent_catt = recoveredCategory;
    }
    if (!meta.category_id) {
      meta.category_id = resolveCategoryId(recoveredCategory);
    }
  }

  const recoveredSubcategory = normalizeCategoryLabel(
    firstNonEmpty(patch.subcategory, patch.arc_subcategory, patch.sub_catt),
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

  meta.full_location = buildFullLocationValue(meta, "") || meta.full_location || "";

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
    if (typeof priceData.price_amount === "number" && priceData.price_amount > 0) {
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
    const inferredCategory = canonicalizeMasaakCategory(
      firstNonEmpty(
        meta.category,
        meta.arc_category,
        meta.parent_catt,
        detectPropertyTypeFromText(adText),
        detectCategoryFallback(adText),
      ),
    );
    const fallbackDetectedCategory = normalizeCategoryLabel(detectCategoryFallback(adText));
    const safeCategory =
      inferredCategory ||
      (targetWebsite === "hasak"
        ? HASAK_CATEGORIES.includes(fallbackDetectedCategory)
          ? fallbackDetectedCategory
          : "حراج الحسا"
        : fallbackDetectedCategory || "عقار");

    updated.category = safeCategory;
    meta.category = safeCategory;
    meta.arc_category = safeCategory;
    if (!HASAK_CATEGORIES.includes(safeCategory)) {
      meta.parent_catt = safeCategory;
    }
    meta.category_id = meta.category_id || resolveCategoryId(safeCategory);
  }

  if (missingState.missing.includes("subcategory")) {
    const sourceCategory = firstNonEmpty(
      updated.category,
      meta.category,
      meta.arc_category,
      meta.parent_catt,
    );
    const fallbackSubcategory = inferSubcategoryFallback(adText, sourceCategory);

    updated.subcategory = fallbackSubcategory;
    meta.subcategory = fallbackSubcategory;
    meta.arc_subcategory = fallbackSubcategory;
    meta.sub_catt = fallbackSubcategory;
  }

  if (targetWebsite === "hasak") {
    meta.full_location = buildFullLocationValue(meta, "") || meta.full_location || "";
  } else {
    meta.full_location = buildFullLocationValue(meta, "") || meta.full_location || "";
  }
  normalizePriceMethodMeta(meta, adText);
  return updated;
}

function buildRecoverMissingFieldsPrompt(adText, currentData, missingFields) {
  const currentSummary = summarizeRequiredMetadata(currentData);
  const targetWebsite = inferTargetWebsiteFromData(currentData, adText);
  const requiredFields = getRequiredMetadataFieldsForAd(currentData, adText);
  const missingLines = missingFields
    .filter((field) => requiredFields.includes(field))
    .map((field) => `- ${field}: ${getRequiredFieldLabel(field)}`)
    .join("\n");
  const websiteInstruction =
    targetWebsite === "hasak"
      ? 'سياق الإعلان: حساك (فعاليات/مستعمل/خدمات). لا تُجبر حقول السعر أو المساحة، ولا تملأ price_method/payment_method إطلاقاً.'
      : 'سياق الإعلان: مسعاك (عقار). إذا وردت مساحة رقمية في النص (مثل 350 متر أو 400م) فيجب تعبئة area رقمياً، وسننسخها لاحقاً إلى arc_space. لا تملأ price_method/payment_method إطلاقاً.';

  return `أنت مدقق جودة لاستخراج بيانات إعلان.
${websiteInstruction}

المطلوب: أكمل فقط الحقول الناقصة التالية:
${missingLines || "- لا يوجد"}

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

async function recoverMissingWordPressFields(adText, currentData, missingFields) {
  const requiredFields = getRequiredMetadataFieldsForAd(currentData, adText);
  const relevantMissing = unique(
    missingFields.filter((field) => requiredFields.includes(field)),
  );

  if (relevantMissing.length === 0) {
    return {};
  }

  const prompt = buildRecoverMissingFieldsPrompt(adText, currentData, relevantMissing);
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
      return normalizeWordPressData(merged, adText, extractedPhones, isRegeneration);
    }

    try {
      const recovered = await recoverMissingWordPressFields(
        adText,
        merged,
        checkAfterFallback.missing,
      );

      merged = mergeRecoveredWordPressMetadata(merged, recovered);
      merged = applyRequiredFieldFallbacks(merged, adText);
      current = normalizeWordPressData(merged, adText, extractedPhones, isRegeneration);
    } catch (error) {
      console.error(
        `⚠️ Required metadata recovery attempt ${pass} failed:`,
        error?.message || error,
      );
      current = normalizeWordPressData(merged, adText, extractedPhones, isRegeneration);
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

function buildWordPressExtractionPrompt(adText, contactHint, isRegeneration) {
  const dynamicLocationHintsText = buildDynamicLocationHintsPromptText();
  const masaakCategoriesText = MASAAK_CATEGORIES.join("، ");
  const hasakCategoriesText = HASAK_CATEGORIES.join("، ");
  const masaakSubcategoryHints = MASAAK_SUBCATEGORY_LINES_FOR_PROMPT.join("\n- ");

  return `أنت مساعد متخصص في استخراج بيانات إعلان عربي للنشر في WordPress لموقعين:
- مسعاك (عقارات)
- حساك (فعاليات، مستعمل، أنشطة، خدمات)

النص:
"""
${adText}
"""

${contactHint}
${dynamicLocationHintsText ? `\n${dynamicLocationHintsText}` : ""}

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
11) احذف أي بيانات تسويقية/تعريفية للمكتب أو الوسيط أو الوكيل (مثل: اسم المكتب، اسم الشركة، بيانات المكتب، الترخيص، الروابط).
12) اكتب العنوان والمحتوى بالعربية بشكل واضح واحترافي.
13) المحتوى HTML آمن ومختصر (بدون script/iframe).
14) للمحتوى العقاري استخدم HTML منظم: h1 ثم p افتتاحي ثم h2+ul للمواصفات ثم h2+ul للمميزات ثم h2+p للسعر ثم h2+p للموقع.
15) للمحتوى غير العقاري (حساك) استخدم HTML نظيف ودقيق مع أكبر قدر من التفاصيل المتاحة: h1 ثم p افتتاحي ثم h2+ul للتفاصيل/الحالة/المواصفات ثم h2+ul للمزايا أو المتطلبات.
16) لإعلانات مسعاك فقط: يمكن تضمين الموقع في title إذا كان مذكوراً بوضوح. لإعلانات حساك لا تضف موقعاً غير مذكور صراحة في النص.
17) الوصف content يجب أن يشمل كل التفاصيل المتاحة من النص بدون اختراع معلومات.
18) ممنوع داخل content: أرقام الاتصال/الموبايل، اسم المالك، اسم المكتب، بيانات المكتب، أسماء الوسطاء/الوكلاء، التراخيص، القروبات، الروابط، الملاحظات الإدارية.
19) املأ meta بحقول ثابتة حتى لو كانت فارغة.
20) phone_number بصيغة 9665xxxxxxxx إذا متاح.
21) status دائماً "publish".
22) احذف أي أرقام مرجعية مثل: رقم القطعة، قطعة 11 أ، رقم الإعلان من العنوان والمحتوى و main_ad.
${
  isRegeneration
    ? "23) هذه إعادة توليد لإعلان موجود بالفعل، لذلك IsItAd يجب أن يكون true."
    : "23) إذا لم يكن إعلاناً واضحاً ضع IsItAd=false مع parse_error."
}
24) لمسعاك فقط: إذا توفر الحي بدون المدينة فاستنتج المدينة المناسبة (مثل الهفوف/المبرز/القرى/العيون)، ولا تكتب before_City/before_city إلا إذا كانت المحافظة مذكورة في النص. في كل الحالات: location/neighborhood تكون اسم الحي فقط بدون كلمة "حي". في حساك لا تستنتج مدينة/محافظة غير مذكورة.
25) ممنوع نهائياً داخل title/content/main_ad ظهور الكلمات أو العبارات التالية: "مباشر" و"من الوكيل" و"طرف" وأي صياغة مكافئة لها.
26) لا تكتب ولا تعبئ حقول طريقة الدفع نهائياً: price_method و payment_method يجب أن تبقى "" دائماً.

الفئات المعتمدة:
- فئات مسعاك: ${masaakCategoriesText}
${
  masaakSubcategoryHints
    ? `- فئات مسعاك الفرعية الشائعة:
- ${masaakSubcategoryHints}`
    : ""
}
- فئات حساك: ${hasakCategoriesText}

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
    "before_City": "",
    "before_city": "",
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

  // Remove all non-digit characters except + for initial cleaning
  const cleanText = normalizedText.replace(/[^\d+\s]/g, " ");

  // Pattern 1: Saudi numbers starting with 05 (10 digits)
  const pattern1 = /\b(05\d{8})\b/g;
  let matches = cleanText.matchAll(pattern1);
  for (const match of matches) {
    const number = match[1];
    phoneNumbers.push({
      original: number,
      normalized: `966${number.substring(1)}`,
      confidence: 1.0,
      type: "saudi_mobile",
    });
  }

  // Pattern 2: Saudi numbers starting with 966 (12 digits)
  const pattern2 = /\b(9665\d{8})\b/g;
  matches = cleanText.matchAll(pattern2);
  for (const match of matches) {
    const number = match[1];
    if (!phoneNumbers.find((p) => p.normalized === number)) {
      phoneNumbers.push({
        original: number,
        normalized: number,
        confidence: 1.0,
        type: "saudi_mobile_intl",
      });
    }
  }

  // Pattern 3: Numbers with + prefix (+9665xxxxxxxx)
  const pattern3 = /\+?(9665\d{8})\b/g;
  matches = normalizedText.matchAll(pattern3);
  for (const match of matches) {
    const number = match[1];
    if (!phoneNumbers.find((p) => p.normalized === number)) {
      phoneNumbers.push({
        original: match[0],
        normalized: number,
        confidence: 1.0,
        type: "saudi_mobile_plus",
      });
    }
  }

  // Pattern 4: Numbers with spaces or dashes (055 123 4567 or 055-123-4567)
  const pattern4 = /\b(05\d)\s*[\s-]?\s*(\d{3})\s*[\s-]?\s*(\d{4})\b/g;
  matches = normalizedText.matchAll(pattern4);
  for (const match of matches) {
    const number = match[1] + match[2] + match[3];
    const normalized = `966${number.substring(1)}`;
    if (!phoneNumbers.find((p) => p.normalized === normalized)) {
      phoneNumbers.push({
        original: match[0],
        normalized,
        confidence: 0.95,
        type: "saudi_mobile_formatted",
      });
    }
  }

  // Pattern 5: Landline numbers (013xxxxxxx - 9 digits)
  const pattern5 = /\b(01[0-9]\d{7})\b/g;
  matches = cleanText.matchAll(pattern5);
  for (const match of matches) {
    const number = match[1];
    const normalized = `966${number.substring(1)}`;
    if (!phoneNumbers.find((p) => p.normalized === normalized)) {
      phoneNumbers.push({
        original: number,
        normalized,
        confidence: 0.9,
        type: "saudi_landline",
      });
    }
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

  const masaakCategoriesText = MASAAK_CATEGORIES.join("، ");
  const hasakCategoriesText = HASAK_CATEGORIES.join("، ");

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

    const category = normalizeCategoryLabel(data.category);
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
        console.log(`🏷️ Fallback detected category: ${category} (matched: ${keyword})`);
        return category;
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
      settings && settings.hasakFooter ? settings.hasakFooter : defaultHasakFooter;
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
      settings && settings.masaakFooter ? settings.masaakFooter : defaultMasaakFooter;
    message += `\n${masaakFooter}`;
  }

  return message.trim();
}

/**
 * Extract WordPress-ready data from ad text.
 * @param {string} adText
 * @param {boolean} isRegeneration
 */
async function extractWordPressData(adText, isRegeneration = false) {
  const normalizedAdText = String(adText || "").trim();
  const extractedPhones = extractPhoneNumbers(normalizedAdText);

  if (!hasAnyEnabledProvider()) {
    throw new Error("❌ No enabled API keys available for WordPress extraction");
  }

  const contactHint =
    extractedPhones.length > 0
      ? `أرقام الهاتف المستخرجة من النص: ${extractedPhones
          .map((phone) => phone.normalized)
          .join(", ")}`
      : "لا يوجد رقم هاتف واضح في النص.";

  const prompt = buildWordPressExtractionPrompt(
    normalizedAdText,
    contactHint,
    isRegeneration,
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

      return ensureRequiredMetadataCoverage({
        wpData: normalizedData,
        adText: normalizedAdText,
        extractedPhones,
        isRegeneration,
        maxPasses: 2,
      });
    } catch (error) {
      lastError = error;
      console.error(
        `❌ WordPress extraction failed for provider order [${order.join(" -> ")}]:`,
        error?.message || error,
      );
    }
  }

  const errorMessage = lastError?.message || String(lastError || "Unknown error");
  throw new Error(`فشل في استخراج بيانات الإعلان: ${errorMessage}`);
}

/**
 * Process a message: detect if it's an ad and generate WordPress data.
 * @param {string} text
 */
async function processMessage(text) {
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
      wpData = await extractWordPressData(text);
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
  validateUserInput,
  getApiKeysStatus,
};
