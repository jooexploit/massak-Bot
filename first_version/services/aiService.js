const { GoogleGenerativeAI } = require("@google/generative-ai");
const OpenAI = require("openai");

const apiKeyManager = require("./apiKeyManager");
const websiteConfig = require("../config/website.config");

const { PROVIDERS } = apiKeyManager;

const DEFAULT_WP_TITLE = "إعلان عقاري مميز";
const HASAK_CATEGORIES = Object.keys(websiteConfig.hasak.categories || {}).filter(
  (name) => name !== "default" && name !== "Uncategorized",
);

const CATEGORY_LIST = [
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
  ...HASAK_CATEGORIES,
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
  before_City: "الأحساء",
  before_city: "الأحساء",
  City: "",
  city: "",
  subcity: "",
  location: "",
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
    if (!isObject(current)) continue;

    collected.push(current);

    ["data", "result", "output", "response", "payload"].forEach((key) => {
      if (isObject(current[key])) {
        queue.push(current[key]);
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

async function callProviderRaw({
  provider,
  prompt,
  taskName,
  temperature = 0.2,
  maxTokens = 1200,
  model,
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

        const completion = await client.chat.completions.create(
          completionRequest,
        );

        return completion?.choices?.[0]?.message?.content || "";
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
    tags: ["عقارات", "الأحساء"],
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
      before_City: "الأحساء",
      City: "الهفوف",
      location: "الرابية",
    },
  },
  match: (obj) =>
    isObject(obj) &&
    ("meta" in obj || "title" in obj || "content" in obj || "IsItAd" in obj),
  sanitize: (obj) => obj,
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

function normalizeLocationMeta(meta) {
  const city = normalizeArabicText(firstNonEmpty(meta.city, meta.City, meta.subcity));
  const beforeCity = normalizeArabicText(
    firstNonEmpty(meta.before_City, meta.before_city, city, "الأحساء"),
  );
  const subcity = normalizeArabicText(firstNonEmpty(meta.subcity, city));

  let neighborhood = normalizeArabicText(
    firstNonEmpty(meta.neighborhood, meta.location, "لم يذكر"),
  );

  if (neighborhood === city || neighborhood === beforeCity) {
    neighborhood = "لم يذكر";
  }

  meta.before_City = beforeCity || "الأحساء";
  meta.before_city = beforeCity || "الأحساء";
  meta.city = city || beforeCity || "الأحساء";
  meta.subcity = subcity || city || beforeCity || "";
  meta.City = meta.subcity || meta.city;
  meta.neighborhood = neighborhood || "لم يذكر";
  meta.location = neighborhood || "لم يذكر";
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

function normalizeWordPressCategoryMeta(meta) {
  const candidateCategory = normalizeCategoryLabel(
    firstNonEmpty(meta.category, meta.arc_category, meta.parent_catt),
  );
  const candidateSubCategory = normalizeCategoryLabel(
    firstNonEmpty(meta.subcategory, meta.arc_subcategory, meta.sub_catt),
  );

  if (!meta.category) meta.category = candidateCategory;
  if (!meta.subcategory) meta.subcategory = candidateSubCategory;

  const hasakCategory = [meta.category, meta.parent_catt, meta.arc_category].find((c) =>
    HASAK_CATEGORIES.includes(c),
  );

  if (hasakCategory) {
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

  const isRequestCategory =
    meta.category === "طلبات" ||
    meta.parent_catt === "طلبات" ||
    Number(meta.category_id) === 83 ||
    normalizeArabicText(meta.ad_type).includes("طلب") ||
    normalizeArabicText(meta.order_status).includes("طلب") ||
    normalizeArabicText(meta.offer_status).includes("طلب");

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
  meta.price_method = normalizeArabicText(meta.price_method || "");
  meta.payment_method = normalizeArabicText(meta.payment_method || meta.price_method || "");
  meta.order_owner = normalizeArabicText(meta.order_owner || meta.owner_type || "");
  meta.offer_owner = normalizeArabicText(meta.offer_owner || meta.owner_type || "");
  meta.owner_type = normalizeArabicText(meta.owner_type || meta.offer_owner || meta.order_owner || "");
  meta.order_type = normalizeArabicText(meta.order_type || meta.offer_type || meta.ad_type || "");
  meta.offer_type = normalizeArabicText(meta.offer_type || meta.order_type || "");
  meta.age = normalizeArabicText(meta.age || "");
  meta.google_location = meta.google_location || null;
  meta.youtube_link = meta.youtube_link || null;

  normalizePriceMeta(meta);
  normalizeLocationMeta(meta);
  normalizeWordPressCategoryMeta(meta);

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

  if (meta.ad_type.includes("عرض")) {
    meta.main_ad = adText || "";
  }

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

  return {
    title: sanitizeTitle(titleValue || DEFAULT_WP_TITLE),
    content: sanitizeHtml(contentValue || `<p>${escapeHtml(adText || "")}</p>`),
    excerpt: normalizeArabicText(excerptValue || ""),
    status: "publish",
    meta,
    taxonomies: isObject(rawData.taxonomies) ? rawData.taxonomies : {},
    images: Array.isArray(rawData.images) ? rawData.images : [],
    IsItAd: true,
  };
}

function buildWordPressExtractionPrompt(adText, contactHint, isRegeneration) {
  return `أنت مساعد متخصص في استخراج بيانات إعلان عربي للنشر في WordPress.

النص:
"""
${adText}
"""

${contactHint}

القواعد الإلزامية:
1) أعد JSON واحد فقط بدون Markdown.
2) احذف أي مكاتب عقارية أو تراخيص أو روابط قروبات أو وسطاء من المحتوى.
3) اكتب العنوان والمحتوى بالعربية بشكل واضح واحترافي.
4) المحتوى HTML آمن ومختصر (بدون script/iframe).
5) حدّد نوع الإعلان: "عرض" أو "طلب" أو "فعالية" أو "خدمة" أو "وظيفة".
6) إذا كان طلب شراء/بيع عام: category = "طلبات" و category_id = 83 و parent_catt = "طلبات".
7) لفئات حساك استخدم arc_category/arc_subcategory وتجنّب parent_catt/sub_catt.
8) املأ meta بحقول ثابتة حتى لو كانت فارغة.
9) phone_number بصيغة 9665xxxxxxxx إذا متاح.
10) status دائماً "publish".
${
  isRegeneration
    ? "11) هذه إعادة توليد لإعلان موجود بالفعل، لذلك IsItAd يجب أن يكون true."
    : "11) إذا لم يكن إعلاناً واضحاً ضع IsItAd=false مع parse_error."
}

أعد الشكل التالي فقط:
{
  "IsItAd": true,
  "status": "publish",
  "title": "عنوان نظيف",
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
 * Detect property category from text using AI.
 * @param {string} text
 * @returns {Promise<string|null>}
 */
async function detectCategory(text) {
  if (!hasAnyEnabledProvider()) {
    return detectCategoryFallback(text);
  }

  const prompt = `صنّف النص التالي إلى تصنيف واحد مناسب فقط.

النص:
"${text}"

أعد JSON فقط:
{"category":"اسم التصنيف", "confidence":0.9, "reason":"سبب مختصر"}

التصنيفات المحتملة:
${CATEGORY_LIST.join("، ")}`;

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
      "ابغى ابيع",
      "ابغا ابيع",
      "ابي ابيع",
      "ابغى اشتري",
      "ابغا اشتري",
      "ابي اشتري",
      "ودي ابيع",
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

  const normalizedText = String(text || "");

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
        .filter(Boolean)
        .join(" - ");
      message += `📍 *الموقع:* ${location}\n`;
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

      return normalizeWordPressData(
        data,
        normalizedAdText,
        extractedPhones,
        isRegeneration,
      );
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
