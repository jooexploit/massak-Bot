const makeWASocket = require("@whiskeysockets/baileys").default;
const {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  generateWAMessageFromContent,
  proto,
} = require("@whiskeysockets/baileys");
const P = require("pino");
const QRCode = require("qrcode");
const fs = require("fs");
const path = require("path");
const aiService = require("../services/aiService");
const {
  processMessage,
  generateWhatsAppMessage,
  sanitizeWordPressDraftData,
  sanitizeWordPressDataForStorage,
} = aiService;
const messageQueue = require("../services/messageQueue");
const privateChatService = require("../services/privateChatService");
const linkPreviewService = require("../services/linkPreviewService");
const adminCommandService = require("../services/adminCommandService");
const reminderScheduler = require("../services/reminderScheduler");
const waseetDetector = require("../services/waseetDetector");
const websiteConfig = require("../config/website.config");
const duplicateService = require("../services/duplicateService");
const {
  DEFAULT_WP_BEFORE_CITY_OPTIONS,
  DEFAULT_WP_CITY_OPTIONS,
} = require("../config/locationHierarchy");
const dataSync = require("../utils/dataSync");
const {
  normalizeGroupJids: normalizeAutoPostGroupJids,
  hasAutoPostGroupSelection: hasConfiguredAutoPostGroups,
  isAutoPostAllowedForGroup: isGroupAllowedForAutoPostRule,
  isAutoPostGroupSelected: isFixedAutoPostGroup,
  prepareWpDataForAutoPost,
} = require("../utils/autoPostGroupRules");

let sock;
let qrCodeData = null;
let connectionStatus = "disconnected";
let currentQR = null;

// Reconnection tracking
let reconnectAttempts = 0;
let maxReconnectAttempts = 10;
let reconnectTimeout = null;
let isReconnecting = false;
let groupsFetchTimeout = null;
// Guard: prevent concurrent initializeBot calls that can create duplicate sessions
let initInProgress = false;
// Cross-process init lock (prevents two Node processes from opening the same Baileys session)
const AUTH_DIR = path.join(__dirname, "..", "auth_info_baileys");
const INIT_LOCK_FILE = path.join(AUTH_DIR, ".init.lock");

function acquireInitLock() {
  try {
    if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
    const fd = fs.openSync(INIT_LOCK_FILE, "wx"); // atomic create
    const payload = JSON.stringify({ pid: process.pid, ts: Date.now() });
    fs.writeFileSync(fd, payload);
    fs.closeSync(fd);
    return true;
  } catch (err) {
    if (err.code === "EEXIST") {
      try {
        const raw = fs.readFileSync(INIT_LOCK_FILE, "utf8");
        const { pid, ts } = JSON.parse(raw || "{}");
        let ownerAlive = false;
        if (pid) {
          try {
            process.kill(pid, 0);
            ownerAlive = true;
          } catch {
            ownerAlive = false;
          }
        }
        const stale = !ts || Date.now() - ts > 120000; // 2 min
        if (!ownerAlive || stale) {
          fs.rmSync(INIT_LOCK_FILE, { force: true });
          return acquireInitLock();
        }
      } catch {
        try {
          fs.rmSync(INIT_LOCK_FILE, { force: true });
        } catch {}
        return acquireInitLock();
      }
    }
    return false;
  }
}

function releaseInitLock() {
  try {
    fs.rmSync(INIT_LOCK_FILE, { force: true });
  } catch {}
}

function isSocketOpen() {
  if (!sock || !sock.ws) return false;
  return sock.ws.readyState === sock.ws.OPEN;
}

function scheduleGroupsFetch() {
  if (groupsFetchTimeout) {
    clearTimeout(groupsFetchTimeout);
    groupsFetchTimeout = null;
  }

  groupsFetchTimeout = setTimeout(async () => {
    if (connectionStatus !== "connected" || isReconnecting || !isSocketOpen()) {
      console.log("⚠️ Skipping group fetch: socket not ready");
      return;
    }

    try {
      const groups = await sock.groupFetchAllParticipating();
      console.log(`Found ${Object.keys(groups).length} groups`);

      Object.values(groups).forEach((group) => {
        const jid = group.id;
        seenGroups.add(jid);
        groupsMetadata[jid] = {
          jid: jid,
          name: group.subject || jid,
        };
      });

      console.log("All groups loaded successfully");
    } catch (err) {
      console.error("Failed to fetch groups:", err);
    }
  }, 2000);
}

// Use centralized data sync utility
const ADS_FILE = dataSync.getFilePath("ADS");
const COLLECTIONS_FILE = dataSync.getFilePath("COLLECTIONS");
const CATEGORIES_FILE = dataSync.getFilePath("CATEGORIES");
const RECYCLE_BIN_FILE = dataSync.getFilePath("RECYCLE_BIN");
const SETTINGS_FILE = dataSync.getFilePath("SETTINGS");
let ads = [];
let recycleBin = []; // Messages rejected by AI
let settings = {
  recycleBinDays: 7,
  excludedGroups: [],
  autoApproveWordPressGroups: [],
  requestMatchingEnabled: true,
  wpBeforeCityOptions: [...DEFAULT_WP_BEFORE_CITY_OPTIONS],
  wpCityOptions: [...DEFAULT_WP_CITY_OPTIONS],
}; // Default: auto-delete after 7 days, no excluded groups, no auto-post group filter
let seenGroups = new Set();
let groupsMetadata = {}; // Store group metadata (jid -> {name, jid})
let collections = []; // Store group collections
let categories = []; // Store custom categories
// Pending admin actions waiting for confirmation: { [adminJid]: { type: 'stop'|'start'|'waseet', phones: ["9665..."], createdAt } }
const pendingActions = {};
const AUTO_POST_FIXED_CATEGORY_IDS = [131];

function normalizeGroupSelection(groupIds) {
  return normalizeAutoPostGroupJids(groupIds);
}

function normalizeSmartLocationOptions(options, fallback = []) {
  const fallbackList = Array.isArray(fallback) ? fallback : [];
  const source = Array.isArray(options) ? options : fallbackList;

  const normalized = source
    .filter((value) => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 300);

  const uniqueValues = [...new Set(normalized)];

  if (uniqueValues.length === 0) {
    return [
      ...new Set(
        fallbackList
          .filter((value) => typeof value === "string")
          .map((v) => v.trim())
          .filter(Boolean),
      ),
    ];
  }

  return uniqueValues;
}

function normalizeSettingsForCompatibility() {
  if (!settings || typeof settings !== "object") {
    settings = {};
  }

  if (typeof settings.requestMatchingEnabled !== "boolean") {
    settings.requestMatchingEnabled = true;
  }

  settings.excludedGroups = normalizeGroupSelection(settings.excludedGroups);
  settings.autoApproveWordPressGroups = normalizeGroupSelection(
    settings.autoApproveWordPressGroups,
  );
  settings.wpBeforeCityOptions = normalizeSmartLocationOptions(
    settings.wpBeforeCityOptions,
    DEFAULT_WP_BEFORE_CITY_OPTIONS,
  );
  settings.wpCityOptions = normalizeSmartLocationOptions(
    settings.wpCityOptions,
    DEFAULT_WP_CITY_OPTIONS,
  );
}

function shouldAutoPostFromSourceGroup(sourceGroupJid) {
  return isGroupAllowedForAutoPostRule(settings, sourceGroupJid);
}

function hasAutoPostGroupSelection() {
  return hasConfiguredAutoPostGroups(settings);
}

function shouldUseFixedCategoryForSourceGroup(sourceGroupJid) {
  return isFixedAutoPostGroup(settings, sourceGroupJid);
}

function isAutoPostEnabled() {
  return settings.autoApproveWordPress === true;
}

function buildAutoPostWpData(baseWpData, shouldApplyFixedCategory = true) {
  return prepareWpDataForAutoPost(
    baseWpData,
    AUTO_POST_FIXED_CATEGORY_IDS,
    shouldApplyFixedCategory,
  );
}

function sanitizeStoredAdWordPressData(ad) {
  if (!ad || typeof ad !== "object") {
    return { ad, changed: false };
  }

  const withAuditDefaults = {
    ...ad,
    rawAiResponse: ad.rawAiResponse || null,
    sanitizationSteps: Array.isArray(ad.sanitizationSteps)
      ? ad.sanitizationSteps
      : [],
  };
  const auditChanged =
    withAuditDefaults.rawAiResponse !== ad.rawAiResponse ||
    JSON.stringify(withAuditDefaults.sanitizationSteps) !==
      JSON.stringify(ad.sanitizationSteps || []);

  if (!ad.wpData || typeof ad.wpData !== "object") {
    const changed = auditChanged;
    return { ad: withAuditDefaults, changed };
  }

  const inferredTargetWebsite =
    withAuditDefaults.targetWebsite ||
    withAuditDefaults.wpData?.targetWebsite ||
    aiService.__private.inferTargetWebsiteFromData(
      withAuditDefaults.wpData,
      withAuditDefaults.originalText || withAuditDefaults.enhancedText || "",
    ) ||
    "masaak";

  const sanitizedWpData = sanitizeWordPressDataForStorage(
    withAuditDefaults.wpData,
    inferredTargetWebsite,
  );
  const wpDataChanged =
    JSON.stringify(sanitizedWpData) !==
    JSON.stringify(withAuditDefaults.wpData);

  let nextWhatsAppMessage = withAuditDefaults.whatsappMessage;
  if (withAuditDefaults.whatsappMessage) {
    const wpLink =
      withAuditDefaults.wordpressLink ||
      withAuditDefaults.wordpressUrl ||
      withAuditDefaults.wordpressFullUrl ||
      withAuditDefaults.wordpressPost?.link ||
      withAuditDefaults.wordpressPost?.guid?.rendered ||
      null;
    nextWhatsAppMessage = generateWhatsAppMessage(
      sanitizedWpData,
      wpLink,
      inferredTargetWebsite,
      settings,
    );
  }

  const messageChanged =
    nextWhatsAppMessage !== withAuditDefaults.whatsappMessage;
  const targetChanged =
    inferredTargetWebsite !== withAuditDefaults.targetWebsite;

  if (!wpDataChanged && !messageChanged && !targetChanged && !auditChanged) {
    return { ad: withAuditDefaults, changed: false };
  }

  return {
    ad: {
      ...withAuditDefaults,
      targetWebsite: inferredTargetWebsite,
      wpData: sanitizedWpData,
      whatsappMessage: nextWhatsAppMessage,
    },
    changed: true,
  };
}

function loadAds() {
  try {
    // Initialize data directory
    dataSync.initializeDataDir();

    // Load data using dataSync (always fresh reads)
    ads = dataSync.readDataSync("ADS", []);
    collections = dataSync.readDataSync("COLLECTIONS", []);
    categories = dataSync.readDataSync("CATEGORIES", []);
    recycleBin = dataSync.readDataSync("RECYCLE_BIN", []);
    settings = dataSync.readDataSync("SETTINGS", {
      recycleBinDays: 7,
      excludedGroups: [],
      autoApproveWordPressGroups: [],
      requestMatchingEnabled: true,
      wpBeforeCityOptions: [...DEFAULT_WP_BEFORE_CITY_OPTIONS],
      wpCityOptions: [...DEFAULT_WP_CITY_OPTIONS],
    });

    let sanitizedAdsCount = 0;
    ads = ads.map((ad) => {
      const result = sanitizeStoredAdWordPressData(ad);
      if (result.changed) {
        sanitizedAdsCount += 1;
      }
      return result.ad;
    });

    ads.forEach((a) => seenGroups.add(a.fromGroup));
    console.log(`✅ Loaded ${collections.length} collections from file`);

    normalizeSettingsForCompatibility();

    if (sanitizedAdsCount > 0) {
      console.log(
        `🧹 Sanitized ${sanitizedAdsCount} stored ads while loading dashboard data`,
      );
      saveAds();
    }

    // Clean old recycle bin items
    cleanRecycleBin();
  } catch (err) {
    console.error("Failed to load ads:", err);
    ads = [];
    collections = [];
    categories = [];
    recycleBin = [];
  }
}

// Helper: extract phone-like tokens and normalize to '9665xxxxxxxx' (no plus)
function extractAndNormalizePhoneNumbers(text) {
  if (!text) return [];

  // Broad pattern: match sequences that look like a phone including +, digits, spaces, dashes, parentheses
  const loosePattern = /(?:\+?\d[\d\s\-()]{6,}\d)/g;
  const matches = text.match(loosePattern) || [];

  const normalized = matches
    .map((raw) => {
      // Remove all non-digit characters
      let digits = raw.replace(/[^\d]/g, "");

      // If it starts with country code like 966..., keep it
      if (digits.startsWith("966") && digits.length >= 11) {
        // ensure Saudi mobile format: 966 + 9 digits => 12 digits total
        return digits;
      }

      // If starts with leading 0 (e.g., 05xxxxxxxx)
      if (digits.startsWith("0") && digits.length >= 9) {
        // drop leading 0 and add 966
        return "966" + digits.replace(/^0+/, "");
      }

      // If starts with 5 and length 9 (5xxxxxxxx)
      if (digits.startsWith("5") && digits.length === 9) {
        return "966" + digits;
      }

      // If starts with 9 and looks like 9xxxxxxxxx (rare), try to add country
      if (digits.length === 9) {
        return "966" + digits;
      }

      // If it's full international with leading country but not 966, keep raw digits
      if (digits.length >= 10) return digits;

      return null;
    })
    .filter((v) => v)
    .map((v) => v.replace(/^\+/, ""))
    // Deduplicate and normalize length to remove obvious invalids
    .filter(
      (v, i, a) => a.indexOf(v) === i && v.length >= 11 && v.length <= 15,
    );

  return normalized;
}

function formatPhoneForDisplay(normalized) {
  if (!normalized) return normalized;
  // Ensure starts with country code
  if (!normalized.startsWith("+") && normalized.startsWith("966")) {
    return "+" + normalized;
  }
  if (!normalized.startsWith("+")) return "+" + normalized;
  return normalized;
}

/**
 * Check if two ads are duplicates based on property details
 * (category, price, area, neighborhood) instead of text style
 */
function isDuplicateByDetails(ad1, ad2) {
  if (!ad1 || !ad2) return false;

  // Extract details from both ads
  const details1 = {
    category:
      ad1.category ||
      ad1.wpData?.meta?.parent_catt ||
      ad1.wpData?.meta?.arc_category ||
      "",
    subcategory:
      ad1.wpData?.meta?.sub_catt || ad1.wpData?.meta?.arc_subcategory || "",
    price: ad1.wpData?.meta?.price_amount || "",
    area: ad1.wpData?.meta?.arc_space || ad1.wpData?.meta?.area || "",
    neighborhood:
      ad1.wpData?.meta?.location || ad1.wpData?.meta?.neighborhood || "",
    city: ad1.wpData?.meta?.City || ad1.wpData?.meta?.subcity || "",
  };

  const details2 = {
    category:
      ad2.category ||
      ad2.wpData?.meta?.parent_catt ||
      ad2.wpData?.meta?.arc_category ||
      "",
    subcategory:
      ad2.wpData?.meta?.sub_catt || ad2.wpData?.meta?.arc_subcategory || "",
    price: ad2.wpData?.meta?.price_amount || "",
    area: ad2.wpData?.meta?.arc_space || ad2.wpData?.meta?.area || "",
    neighborhood:
      ad2.wpData?.meta?.location || ad2.wpData?.meta?.neighborhood || "",
    city: ad2.wpData?.meta?.City || ad2.wpData?.meta?.subcity || "",
  };

  // Normalize values for comparison
  const normalize = (str) =>
    String(str || "")
      .toLowerCase()
      .trim();

  const category1 = normalize(details1.category);
  const category2 = normalize(details2.category);
  const price1 = normalize(details1.price);
  const price2 = normalize(details2.price);
  const area1 = normalize(details1.area);
  const area2 = normalize(details2.area);
  const neighborhood1 = normalize(details1.neighborhood);
  const neighborhood2 = normalize(details2.neighborhood);

  // Must match: category, area, and neighborhood
  const categoryMatches = category1 && category2 && category1 === category2;
  const areaMatches = area1 && area2 && area1 === area2;
  const neighborhoodMatches =
    neighborhood1 && neighborhood2 && neighborhood1 === neighborhood2;

  // Price can be similar (within 10% range) or exact match
  let priceMatches = false;
  if (price1 && price2) {
    const priceNum1 = parseFloat(price1);
    const priceNum2 = parseFloat(price2);
    if (!isNaN(priceNum1) && !isNaN(priceNum2)) {
      const priceDiff = Math.abs(priceNum1 - priceNum2);
      const priceAvg = (priceNum1 + priceNum2) / 2;
      priceMatches = priceDiff <= priceAvg * 0.1; // Within 10%
    } else {
      priceMatches = price1 === price2; // Exact match for non-numeric
    }
  } else {
    priceMatches = true; // If one or both missing price, ignore this check
  }

  // Consider duplicate if:
  // - Same category AND same area AND same neighborhood AND similar price
  const isDuplicate =
    categoryMatches && areaMatches && neighborhoodMatches && priceMatches;

  if (isDuplicate) {
    console.log("🔍 Duplicate detected by details:");
    console.log(`   Category: ${category1} = ${category2}`);
    console.log(`   Area: ${area1} = ${area2}`);
    console.log(`   Neighborhood: ${neighborhood1} = ${neighborhood2}`);
    console.log(`   Price: ${price1} ≈ ${price2}`);
  }

  return isDuplicate;
}

// Quick keyword-based category detection (before AI)
// This saves AI tokens by checking category limits early
function quickDetectCategory(text) {
  const lowerText = text.toLowerCase();

  // Define keyword patterns for each category
  const categoryKeywords = {
    // Masaak Categories (Real Estate)
    أرض: ["أرض", "ارض", "قطعة", "قطعه", "بطن", "ركنية", "زاوية"],
    شقة: ["شقة", "شقه", "apartment"],
    فيلا: ["فيلا", "فيله", "villa"],
    بيت: ["بيت", "منزل", "house"],
    عمارة: ["عمارة", "عماره", "building"],
    دبلكس: ["دبلكس", "duplex"],
    استراحة: ["استراحة", "استراحه"],
    مزرعة: ["مزرعة", "مزرعه", "farm"],
    محل: ["محل", "محل تجاري", "shop"],
    مستودع: ["مستودع"],

    // Hasak Categories (Events & Marketplace)
    "فعاليات و أنشطة": [
      "فعالية",
      "فعاليات",
      "معرض",
      "مؤتمر",
      "ورشة",
      "دورة",
      "نشاط",
      "أنشطة",
      "احتفال",
      "مهرجان",
    ],
    "حراج الحسا": ["حراج", "حراجات", "مستعمل", "مستعملة", "used"],
    "كوفيهات أو مطاعم": [
      "كوفي",
      "كوفيه",
      "مطعم",
      "مطاعم",
      "مقهى",
      "كافيه",
      "cafe",
      "coffee",
      "restaurant",
    ],
    "محلات تجارية": ["محلات", "متجر", "متاجر", "معرض تجاري"],
    "أسر منتجة": ["أسرة منتجة", "اسرة منتجة", "أسر منتجة", "منتجات يدوية"],
    "برامج ووظائف": [
      "وظيفة",
      "وظائف",
      "توظيف",
      "برنامج",
      "تدريب",
      "دورة تدريبية",
    ],
    "مركز ترفيهي": ["ترفيهي", "ترفيه", "ملاهي", "العاب"],
    "منتجعات وإستراحات": ["منتجع", "منتجعات"],
    "توصيل سيارات": ["توصيل"],
  };

  // Check each category
  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    for (const keyword of keywords) {
      if (lowerText.includes(keyword)) {
        return category;
      }
    }
  }

  return null; // No category detected
}

function normalizeCategoryValueForLimit(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ـ/g, "")
    .replace(/\s+/g, " ");
}

const CATEGORY_LIMIT_ALIAS_MAP = {
  ارض: "ارض",
  "قطعه ارض": "ارض",
  قطعه: "ارض",
  شقه: "شقه",
  شقق: "شقه",
  "شقه دبلكسيه": "شقه دبلكسيه",
  فيله: "فيلا",
  فله: "فيلا",
  منزل: "بيت",
  بيوت: "بيت",
  عماره: "عماره",
  استراحه: "استراحه",
  مزرعه: "مزرعه",
  شاليه: "شاليه",
  "الفعاليات والانشطه": "فعاليات و انشطه",
  "فعاليات والانشطه": "فعاليات و انشطه",
  "فعاليات و انشطه": "فعاليات و انشطه",
  "اسر منتجه": "اسر منتجه",
};

function canonicalizeCategoryForLimit(value) {
  const normalized = normalizeCategoryValueForLimit(value);
  if (!normalized) return "";

  return CATEGORY_LIMIT_ALIAS_MAP[normalized] || normalized;
}

function stripTransactionHintsFromCategory(value) {
  const normalized = canonicalizeCategoryForLimit(value);
  if (!normalized) return "";

  const withoutHints = normalized
    .replace(
      /\b(?:للبيع|للايجار|للتقبيل|للتمليك|ايجار|اجار|بيع|for sale|for rent|sale|rent)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();

  if (!withoutHints) return "";
  return CATEGORY_LIMIT_ALIAS_MAP[withoutHints] || withoutHints;
}

function categoriesMatchForLimit(limitCategory, adCategory) {
  const limitCanonical = canonicalizeCategoryForLimit(limitCategory);
  const adCanonical = canonicalizeCategoryForLimit(adCategory);

  if (!limitCanonical || !adCanonical) return false;
  if (limitCanonical === adCanonical) return true;

  const limitBase = stripTransactionHintsFromCategory(limitCanonical);
  const adBase = stripTransactionHintsFromCategory(adCanonical);

  if (!limitBase || !adBase || limitBase !== adBase) return false;

  // Allow broad-to-specific matching (e.g., "فيلا" matches "فيلا للبيع"),
  // but avoid forcing specific-to-specific cross-matching (sale vs rent).
  return limitCanonical === limitBase || adCanonical === adBase;
}

function getCategoryFromMeta(meta) {
  if (!meta || typeof meta !== "object") return "";

  const candidates = [meta.category, meta.arc_category, meta.parent_catt];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return "";
}

function resolveCategoryForLimit(aiResult, fallbackCategory = null) {
  if (!aiResult || typeof aiResult !== "object") {
    return fallbackCategory;
  }

  const candidates = [
    aiResult.category,
    aiResult.wpData?.category,
    getCategoryFromMeta(aiResult.meta),
    getCategoryFromMeta(aiResult.wpData?.meta),
    fallbackCategory,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

function resolveAdCategoryForLimit(ad) {
  if (!ad || typeof ad !== "object") return "";

  const candidates = [
    ad.category,
    ad.wpData?.category,
    getCategoryFromMeta(ad.meta),
    getCategoryFromMeta(ad.wpData?.meta),
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return "";
}

// Check if category has reached its daily limit
function isCategoryLimitReached(category) {
  if (!category) return false;

  const categoryLimits = Array.isArray(settings.categoryLimits)
    ? settings.categoryLimits
    : [];
  const enabledLimits = categoryLimits.filter(
    (limit) =>
      limit &&
      typeof limit.category === "string" &&
      typeof limit.maxAds === "number" &&
      limit.maxAds > 0 &&
      limit.enabled !== false,
  );

  const normalizedCategory = canonicalizeCategoryForLimit(category);
  if (!normalizedCategory) return false;

  const exactMatches = enabledLimits.filter(
    (limit) =>
      canonicalizeCategoryForLimit(limit.category) === normalizedCategory,
  );
  const matchedLimits =
    exactMatches.length > 0
      ? exactMatches
      : enabledLimits.filter((limit) =>
          categoriesMatchForLimit(limit.category, category),
        );

  if (matchedLimits.length === 0) return false;

  // If multiple limits match, enforce the strictest one.
  const limitConfig = matchedLimits.reduce((strictest, current) =>
    current.maxAds < strictest.maxAds ? current : strictest,
  );

  if (!limitConfig) return false;

  // Get start of today (00:00:00)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTimestamp = today.getTime();

  // Count ads from TODAY in this category (excluding rejected/deleted)
  const todayCount = ads.filter(
    (ad) =>
      categoriesMatchForLimit(
        limitConfig.category,
        resolveAdCategoryForLimit(ad),
      ) &&
      ad.status !== "rejected" &&
      ad.timestamp >= todayTimestamp,
  ).length;

  console.log(
    `📊 Category "${limitConfig.category}" TODAY: ${todayCount}/${limitConfig.maxAds} ads (incoming: "${category}")`,
  );

  return todayCount >= limitConfig.maxAds;
}

function saveAds() {
  try {
    ads = ads.map((ad) => sanitizeStoredAdWordPressData(ad).ad);
    dataSync.writeDataSync("ADS", ads);
  } catch (err) {
    console.error("Failed to save ads:", err);
  }
}

function saveRecycleBin() {
  try {
    dataSync.writeDataSync("RECYCLE_BIN", recycleBin);
  } catch (err) {
    console.error("Failed to save recycle bin:", err);
  }
}

function saveSettings() {
  try {
    dataSync.writeDataSync("SETTINGS", settings);
  } catch (err) {
    console.error("Failed to save settings:", err);
  }
}

function cleanRecycleBin() {
  try {
    const daysMs = settings.recycleBinDays * 24 * 60 * 60 * 1000;
    const cutoffTime = Date.now() - daysMs;
    const beforeCount = recycleBin.length;

    console.log("\n♻️ Cleaning Recycle Bin...");
    console.log("Current time:", new Date().toISOString());
    console.log("Cutoff time:", new Date(cutoffTime).toISOString());
    console.log("Retention days:", settings.recycleBinDays);
    console.log("Items before cleanup:", beforeCount);

    // Log each item's age
    recycleBin.forEach((item, index) => {
      const ageMs = Date.now() - item.rejectedAt;
      const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
      console.log(
        `  Item ${index + 1}: ${ageDays} days old, rejected at ${new Date(
          item.rejectedAt,
        ).toISOString()}, will ${
          item.rejectedAt > cutoffTime ? "KEEP" : "DELETE"
        }`,
      );
    });

    recycleBin = recycleBin.filter((item) => item.rejectedAt > cutoffTime);

    console.log("Items after cleanup:", recycleBin.length);

    if (beforeCount !== recycleBin.length) {
      saveRecycleBin();
      console.log(
        `♻️ Cleaned ${
          beforeCount - recycleBin.length
        } old items from recycle bin\n`,
      );
    } else {
      console.log("♻️ No items removed\n");
    }
  } catch (err) {
    console.error("Failed to clean recycle bin:", err);
  }
}

function saveCollections() {
  try {
    dataSync.writeDataSync("COLLECTIONS", collections);
  } catch (err) {
    console.error("Failed to save collections:", err);
  }
}

function saveCategories() {
  try {
    dataSync.writeDataSync("CATEGORIES", categories);
  } catch (err) {
    console.error("Failed to save categories:", err);
  }
}

function normalizeText(text) {
  if (!text) return "";
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function detectTargetWebsiteEarly(messageText = "") {
  const safeText = String(messageText || "").trim();
  if (!safeText) return "masaak";

  const quickCategory = resolveTrustedMainCategory(
    quickDetectCategory(safeText) || "",
  );

  if (quickCategory && websiteConfig.hasak.categories?.[quickCategory]) {
    return "hasak";
  }

  const detected = websiteConfig.detectWebsite(
    safeText,
    quickCategory || "",
    {},
  );
  return detected === "hasak" ? "hasak" : "masaak";
}

/**
 * Process a message from the queue
 * This function is called by the message queue for each queued message
 */
async function processMessageFromQueue(messageData) {
  const {
    messageText,
    from,
    groupSubject,
    senderName,
    senderPhone,
    imageUrl,
    participant,
    remoteJid,
    source,
  } = messageData;

  console.log(`⚙️ Processing queued message from: ${groupSubject}`);

  // ✅ CHECK FOR DUPLICATES FIRST (before using AI tokens!)
  const normalized = normalizeText(messageText);
  const isDuplicate = ads.some(
    (a) => a.fromGroup === from && normalizeText(a.text) === normalized,
  );

  if (isDuplicate) {
    console.log(`⚠️ Duplicate ad detected, skipping AI processing...`);
    return { success: false, reason: "duplicate" };
  }

  // ✅ CHECK CATEGORY LIMITS BEFORE USING AI TOKENS!
  // Quick keyword-based category detection to check if limit is reached
  const quickCategory = quickDetectCategory(messageText);
  if (quickCategory && isCategoryLimitReached(quickCategory)) {
    console.log(
      `🚫 Category "${quickCategory}" has reached its limit. Blocking BEFORE AI processing.`,
    );

    // Move to recycle bin without using AI
    const recycleBinItem = {
      id: `rb_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      text: messageText,
      fromGroup: from,
      fromGroupName: groupSubject,
      author: participant || remoteJid || null,
      senderName: senderName,
      senderPhone: senderPhone,
      rejectedAt: Date.now(),
      aiConfidence: null,
      aiReason: `Category limit reached: ${quickCategory}`,
      category: quickCategory,
      blockReason: "category_limit_reached_pre_check",
      imageUrl: imageUrl || null, // Save image for later use
    };

    recycleBin.unshift(recycleBinItem);
    if (recycleBin.length > 500) recycleBin = recycleBin.slice(0, 500);
    saveRecycleBin();

    console.log(
      `🗑️ Moved to recycle bin (category limit - no AI used): ${recycleBinItem.id}`,
    );
    return {
      success: false,
      reason: "category_limit_reached",
      category: quickCategory,
    };
  }

  // AI-powered ad detection and enhancement
  try {
    const earlyTargetWebsite = detectTargetWebsiteEarly(messageText);
    const aiResult = await processMessage(messageText, {
      targetWebsite: earlyTargetWebsite,
    });

    console.log(
      `🔍 AI Result: isAd=${aiResult.isAd}, confidence=${aiResult.confidence}%`,
    );

    // If not detected as an ad, move to recycle bin
    if (!aiResult.isAd) {
      console.log(
        `❌ Not an ad (confidence: ${aiResult.confidence}%): ${aiResult.reason}`,
      );

      // Add to recycle bin - include image for later use
      const recycleBinItem = {
        id: `rb_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        text: messageText,
        fromGroup: from,
        fromGroupName: groupSubject,
        author: participant || remoteJid || null,
        senderName: senderName,
        senderPhone: senderPhone,
        rejectedAt: Date.now(),
        aiConfidence: aiResult.confidence,
        aiReason: aiResult.reason,
        imageUrl: imageUrl || null, // Save image for later use
      };

      recycleBin.unshift(recycleBinItem);
      if (recycleBin.length > 500) recycleBin = recycleBin.slice(0, 500); // Keep max 500
      saveRecycleBin();

      console.log(`🗑️ Moved to recycle bin: ${recycleBinItem.id}`);
      return { success: false, reason: "not_an_ad" };
    }

    console.log(
      `✅ Ad detected (confidence: ${aiResult.confidence}%): ${aiResult.reason}`,
    );

    const recentAdsWindow = Date.now() - 60 * 60 * 1000;
    const similarDuplicate = duplicateService.findNearDuplicate(
      messageText,
      ads.filter(
        (ad) => ad.timestamp >= recentAdsWindow && ad.fromGroup === from,
      ),
      { threshold: 0.7 },
    );

    if (similarDuplicate?.candidate) {
      console.log(
        `⚠️ Near-duplicate detected by similarity (${similarDuplicate.score.toFixed(3)}), existing ad: ${similarDuplicate.candidate.id}`,
      );
      return { success: false, reason: "duplicate_by_similarity" };
    }

    const aiCategoryForLimit = resolveCategoryForLimit(aiResult, quickCategory);

    // Check if category limit is reached
    if (aiCategoryForLimit && isCategoryLimitReached(aiCategoryForLimit)) {
      console.log(
        `🚫 Category "${aiCategoryForLimit}" has reached its limit. Ad blocked and moved to recycle bin.`,
      );

      // Move to recycle bin instead of saving - include image for later use
      const recycleBinItem = {
        id: `rb_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        text: messageText,
        fromGroup: from,
        fromGroupName: groupSubject,
        author: participant || remoteJid || null,
        senderName: senderName,
        senderPhone: senderPhone,
        rejectedAt: Date.now(),
        aiConfidence: aiResult.confidence,
        aiReason: `Category limit reached: ${aiCategoryForLimit}`,
        category: aiCategoryForLimit,
        blockReason: "category_limit_reached",
        imageUrl: imageUrl || null, // Save image for later use
      };

      recycleBin.unshift(recycleBinItem);
      if (recycleBin.length > 500) recycleBin = recycleBin.slice(0, 500);
      saveRecycleBin();

      console.log(
        `🗑️ Moved to recycle bin (category limit): ${recycleBinItem.id}`,
      );
      return {
        success: false,
        reason: "category_limit_reached",
        category: aiCategoryForLimit,
      };
    }

    // Log extracted phone number if available
    if (aiResult.meta && aiResult.meta.phone_number) {
      console.log(
        `📞 Phone number extracted from message: ${aiResult.meta.phone_number}`,
      );
    }

    // Log WordPress data generation
    if (aiResult.wpData) {
      console.log("✅ WordPress data automatically generated");
    }

    // Log WhatsApp message generation
    if (aiResult.whatsappMessage) {
      console.log("✅ WhatsApp message automatically generated");
    }

    // ✅ CHECK FOR DUPLICATE BY PROPERTY DETAILS (after AI processing)
    // This prevents duplicate properties even if message text is different
    const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000;
    const detailsDuplicate = ads.find((a) => {
      if (a.timestamp < thirtyMinutesAgo) return false;
      return isDuplicateByDetails(aiResult, a);
    });

    if (detailsDuplicate) {
      console.log(
        `⚠️ Duplicate property detected! Ad ${detailsDuplicate.id} has same details`,
      );
      console.log(
        `   Same category, area, neighborhood, and price - Skipping save`,
      );
      return { success: false, reason: "duplicate_by_details" };
    }

    // Detect target website based on category
    const websiteConfig = require("../config/website.config");
    let targetWebsite = null;

    if (aiResult.wpData && aiResult.wpData.meta) {
      const meta = aiResult.wpData.meta;
      const effectiveCategory =
        meta.arc_category ||
        meta.parent_catt ||
        meta.category ||
        aiResult.category ||
        "";

      // Check if it's a Hasak category
      if (
        effectiveCategory &&
        websiteConfig.hasak.categories[effectiveCategory]
      ) {
        targetWebsite = "hasak";
        console.log(
          `🌐 Detected Hasak category "${effectiveCategory}" → Target: Hasak`,
        );
      } else {
        // Use detectWebsite for other cases
        targetWebsite = websiteConfig.detectWebsite(
          messageText,
          effectiveCategory,
          meta,
        );
        console.log(
          `🌐 Auto-detected target website: ${targetWebsite} (category: ${effectiveCategory})`,
        );
      }
    }

    // Create the ad (duplicate already checked before AI)
    // Check if WordPress data was generated - if not, move to recycle bin
    if (
      !aiResult.wpData ||
      !aiResult.wpData.title ||
      aiResult.wpData.title === "إعلان عقاري"
    ) {
      console.log(
        "⚠️ WordPress data extraction failed - moving to recycle bin",
      );

      const recycleBinItem = {
        id: `rb_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        text: messageText,
        fromGroup: from,
        fromGroupName: groupSubject,
        author: participant || remoteJid || null,
        senderName: senderName,
        senderPhone: senderPhone,
        rejectedAt: Date.now(),
        aiConfidence: aiResult.confidence,
        aiReason: "فشل في استخراج بيانات ووردبريس - يرجى إعادة المحاولة لاحقاً",
        blockReason: "wpdata_extraction_failed",
        imageUrl: imageUrl || null,
      };

      recycleBin.unshift(recycleBinItem);
      if (recycleBin.length > 500) recycleBin = recycleBin.slice(0, 500);
      saveRecycleBin();

      console.log(
        `🗑️ Moved to recycle bin (wpData failed): ${recycleBinItem.id}`,
      );
      return {
        success: false,
        reason: "wpdata_extraction_failed",
        message: "فشل في استخراج بيانات الإعلان",
      };
    }

    const finalizedWpData = aiResult.wpData
      ? sanitizeWordPressDataForStorage(
          aiResult.wpData,
          targetWebsite || aiResult.wpData?.targetWebsite || "masaak",
        )
      : null;

    const ad = {
      id: `${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      text: messageText, // Original text
      enhancedText: aiResult.enhancedText, // Same as original (no emojis)
      normalizedText: normalized, // Already calculated above
      fromGroup: from,
      fromGroupName: groupSubject,
      author: participant || remoteJid || null,
      senderName: senderName, // WhatsApp sender name (pushName)
      senderPhone: senderPhone, // WhatsApp sender ID (for reference)
      imageUrl: imageUrl, // Image data if present
      messageKey: messageData.messageKey || null, // Store message key for full image download
      timestamp: Date.now(),
      status: "new", // new | accepted | rejected | posted
      category: aiCategoryForLimit || aiResult.category || null, // AI-detected category
      aiConfidence: aiResult.confidence,
      aiReason: aiResult.reason,
      improvements: aiResult.improvements || [],
      isEdited: false, // Track if manually edited
      meta: aiResult.meta || {}, // AI-extracted metadata (includes phone_number from message text)
      wpData: finalizedWpData, // Auto-generated WordPress data
      whatsappMessage: aiResult.whatsappMessage || null, // Auto-generated WhatsApp message
      rawAiResponse: aiResult.rawAiResponse || null,
      sanitizationSteps: Array.isArray(aiResult.sanitizationSteps)
        ? aiResult.sanitizationSteps
        : [],
      source: source || null,
      targetWebsite: targetWebsite || finalizedWpData?.targetWebsite || null, // Set target website from detection
    };

    ads.unshift(ad); // newest first
    // Keep size reasonable
    if (ads.length > 1000) ads = ads.slice(0, 1000);
    saveAds();

    console.log(
      `✨ Ad saved successfully! ID: ${ad.id}, Group: ${ad.fromGroupName}`,
    );

    // Check if auto-approve is enabled and auto-post to WordPress
    const settings = getSettings();
    const isGroupAllowedForAutoPost = shouldAutoPostFromSourceGroup(
      ad.fromGroup,
    );
    const autoPostEnabled = isAutoPostEnabled();
    const shouldUseFixedAutoPostCategory = shouldUseFixedCategoryForSourceGroup(
      ad.fromGroup,
    );

    if (autoPostEnabled && ad.wpData && isGroupAllowedForAutoPost) {
      console.log(
        "🚀 Auto-approve enabled, posting new ad to WordPress automatically...",
      );

      // Auto-post to WordPress using the SAME function as manual posting
      (async () => {
        try {
          // Import the WordPress posting function from routes
          const { postAdToWordPress } = require("../routes/bot");

          console.log(
            "🔵 Starting WordPress auto-post using manual posting function...",
          );
          console.log("🔵 Ad ID:", ad.id);

          const wpDataForAutoPost = buildAutoPostWpData(
            ad.wpData,
            shouldUseFixedAutoPostCategory,
          );

          // Call the same function used for manual posting
          const result = await postAdToWordPress(
            ad,
            sock,
            wpDataForAutoPost,
            false,
          );

          if (result.success) {
            console.log(
              "✅ ✅ ✅ Auto-posted to WordPress successfully! ✅ ✅ ✅",
            );
            console.log("📌 Post ID:", result.wordpressPost.id);
            console.log("📌 Short Link:", result.wordpressPost.link);
            console.log("🌐 Website:", result.targetWebsite);

            // Update ad status to "accepted" (not "posted")
            ad.status = "accepted";
            ad.wordpressPostId = result.wordpressPost.id;
            ad.wordpressUrl = result.wordpressPost.link;
            ad.wordpressFullUrl = result.wordpressPost.fullLink;
            ad.whatsappMessage = result.whatsappMessage;
            ad.wpData = result.extractedData;
            ad.targetWebsite = result.targetWebsite;

            // Save updated ad
            saveAds();
            console.log(
              "✅ Ad updated with WordPress info and marked as accepted",
            );

            // Send WhatsApp message to the group with the ad details
            if (result.whatsappMessage && ad.fromGroup) {
              try {
                await sock.sendMessage(ad.fromGroup, {
                  text: result.whatsappMessage,
                });
                console.log("✅ WhatsApp message sent to group:", ad.fromGroup);
              } catch (msgError) {
                console.error(
                  "❌ Failed to send WhatsApp message to group:",
                  msgError,
                );
              }
            }
          } else {
            console.error("❌ WordPress posting returned unsuccessful result");
          }
        } catch (error) {
          console.error(
            "❌ ❌ ❌ Error during auto-post to WordPress ❌ ❌ ❌",
          );
          console.error("Error message:", error.message);
          console.error("Error details:", error.response?.data || error);
        }
      })();
    } else if (autoPostEnabled && ad.wpData && !isGroupAllowedForAutoPost) {
      console.log(
        `⏭️ Auto-post skipped: group "${ad.fromGroup}" is not in selected auto-post groups`,
      );
    } else if (autoPostEnabled && !ad.wpData) {
      console.log(
        "⚠️ Auto-approve enabled but ad has no wpData, skipping auto-post",
      );
    }

    return { success: true, adId: ad.id };
  } catch (error) {
    console.error("❌ Error processing message with AI:", error);

    // Check if it's an overload/rate limit error
    const errorMessage = error.message || error.toString();
    const isOverloadError =
      error.status === 503 ||
      errorMessage.includes("overloaded") ||
      errorMessage.includes("503");
    const isRateLimitError =
      error.status === 429 ||
      errorMessage.includes("429") ||
      errorMessage.includes("rate limit");

    if (isOverloadError || isRateLimitError) {
      console.log(
        "⚠️ All API keys failed due to overload/rate limit. Ad will be saved for retry.",
      );

      // Fallback: save with retry flag
      const normalized = normalizeText(messageText);
      const isDuplicate = ads.some(
        (a) => a.fromGroup === from && normalizeText(a.text) === normalized,
      );

      if (!isDuplicate) {
        const ad = {
          id: `${Date.now()}_${Math.floor(Math.random() * 10000)}`,
          text: messageText,
          enhancedText: null,
          normalizedText: normalized,
          fromGroup: from,
          fromGroupName: groupSubject,
          author: participant || remoteJid || null,
          senderName: senderName,
          senderPhone: senderPhone,
          imageUrl: imageUrl,
          timestamp: Date.now(),
          status: "pending_retry", // Special status for retry
          category: null,
          aiConfidence: 0,
          aiReason: "Pending AI retry - API overloaded",
          improvements: [],
          isEdited: false,
          meta: {},
          wpData: null,
          whatsappMessage: null,
          rawAiResponse: null,
          sanitizationSteps: [],
          retryCount: 0,
          lastRetryAt: null,
        };

        ads.unshift(ad);
        if (ads.length > 1000) ads = ads.slice(0, 1000);
        saveAds();

        console.log(`📝 Ad saved with retry flag: ${ad.id}`);

        // Schedule a retry after 5 minutes
        setTimeout(() => retryFailedAd(ad.id), 5 * 60 * 1000);

        return { success: true, adId: ad.id, needsRetry: true };
      }

      return { success: false, reason: "duplicate" };
    }

    // For other errors, fallback: save without AI processing
    const normalized = normalizeText(messageText);
    const isDuplicate = ads.some(
      (a) => a.fromGroup === from && normalizeText(a.text) === normalized,
    );

    if (!isDuplicate) {
      const ad = {
        id: `${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        text: messageText,
        enhancedText: null,
        normalizedText: normalized,
        fromGroup: from,
        fromGroupName: groupSubject,
        author: participant || remoteJid || null,
        senderName: senderName,
        senderPhone: senderPhone,
        imageUrl: imageUrl,
        timestamp: Date.now(),
        status: "new",
        category: null,
        aiConfidence: 0,
        aiReason: "AI processing failed",
        improvements: [],
        isEdited: false,
        rawAiResponse: null,
        sanitizationSteps: [],
      };

      ads.unshift(ad);
      if (ads.length > 1000) ads = ads.slice(0, 1000);
      saveAds();

      console.log(`⚠️ Ad saved without AI processing: ${ad.id}`);
      return { success: true, adId: ad.id, aiProcessed: false };
    }

    return { success: false, reason: "duplicate_after_error" };
  }
}

async function initializeBot() {
  // Strong guards to prevent duplicate sessions/sockets
  if (sock && connectionStatus === "connected") {
    console.log("⚠️ Bot already connected, skipping reinitialization");
    return sock;
  }
  if (initInProgress) {
    console.log(
      "⚠️ Bot initialization already in progress, skipping new attempt",
    );
    return null;
  }
  // Allow initialize during reconnect timer as long as lock isn't held
  initInProgress = true;
  const haveLock = acquireInitLock();
  if (!haveLock) {
    console.log(
      "🛡️ Init lock held by another process/instance. Skipping initializeBot.",
    );
    initInProgress = false;
    return null;
  }

  try {
    // Prevent multiple simultaneous initializations
    if (isReconnecting && connectionStatus === "reconnecting") {
      console.log("⚠️ Already reconnecting, skipping duplicate initialization");
      return null;
    }

    // Check if we're already connected
    if (connectionStatus === "connected" && sock) {
      console.log("ℹ️ Bot already connected, skipping initialization");
      return sock;
    }

    // CRITICAL: Close and cleanup old socket before creating new one
    if (sock) {
      console.log("🧹 Cleaning up old socket before reinitializing...");
      try {
        // CRITICAL FIX: Remove ALL listeners at once to prevent ghost handlers
        sock.ev.removeAllListeners();

        // Close websocket if still open
        if (sock.ws && sock.ws.readyState === sock.ws.OPEN) {
          sock.ws.close();
        }
      } catch (cleanupError) {
        console.warn("⚠️ Error during socket cleanup:", cleanupError.message);
      }
      sock = null;
      console.log("✅ Old socket cleaned up");
    }

    // CRITICAL: Add delay to allow old socket to be fully garbage collected
    // This prevents race conditions where old handlers fire alongside new ones
    if (reconnectAttempts > 0) {
      console.log(
        "⏳ Waiting 1 second for socket cleanup before creating new one...",
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.log("🚀 Starting bot initialization...");
    loadAds();

    // Check if auth folder exists and has creds.json
    const authPath = path.join(__dirname, "..", "auth_info_baileys");
    const credsPath = path.join(authPath, "creds.json");

    if (fs.existsSync(authPath) && fs.existsSync(credsPath)) {
      console.log("✅ Found existing session credentials");
      try {
        const creds = JSON.parse(fs.readFileSync(credsPath, "utf-8"));
        if (!creds || !creds.me || !creds.me.id) {
          console.log("⚠️ Session credentials are invalid, clearing...");
          fs.rmSync(authPath, { recursive: true, force: true });
        }
      } catch (error) {
        console.log("⚠️ Failed to read session credentials, clearing...");
        fs.rmSync(authPath, { recursive: true, force: true });
      }
    } else {
      console.log("ℹ️ No existing session found, will generate QR code");
    }

    const { state, saveCreds } =
      await useMultiFileAuthState("auth_info_baileys");
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      logger: P({ level: "silent" }),
      auth: state,
      printQRInTerminal: false, // We handle QR display via web dashboard
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
      markOnlineOnConnect: true,
      syncFullHistory: false,
      retryRequestDelayMs: 2000,
      connectTimeoutMs: 60000,
      qrTimeout: 60000,
      emitOwnEvents: false,
      // CRITICAL: Provide getMessage to prevent "Stream Errored" on retry
      getMessage: async (key) => {
        // Return undefined if message not found in store
        // This prevents Baileys from failing on retry attempts
        return undefined;
      },
    });

    // CRITICAL: Register creds.update BEFORE connection.update
    // This ensures credentials are saved immediately when they change
    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        currentQR = qr;
        // Generate QR code as data URL
        try {
          qrCodeData = await QRCode.toDataURL(qr);
          connectionStatus = "qr";
          console.log("QR Code generated");
        } catch (err) {
          console.error("Error generating QR code:", err);
        }
      }

      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const errorMessage = lastDisconnect?.error?.message || "Unknown error";

        console.log("🔌 Connection closed");
        console.log("📊 Status Code:", statusCode);
        console.log("❌ Error:", errorMessage);
        console.log("🔍 Reconnect attempts:", reconnectAttempts);

        // Clear any pending reconnect timeout
        if (reconnectTimeout) {
          clearTimeout(reconnectTimeout);
          reconnectTimeout = null;
        }
        if (groupsFetchTimeout) {
          clearTimeout(groupsFetchTimeout);
          groupsFetchTimeout = null;
        }

        // Check if this is a conflict error (401 with "conflict" message)
        const isConflict =
          (statusCode === DisconnectReason.loggedOut || statusCode === 401) &&
          errorMessage.toLowerCase().includes("conflict");

        // Check if session is corrupted and needs clearing
        // 405 = Connection Failure, 408 = Timeout, 440 = Connection Lost
        const sessionCorrupted =
          statusCode === DisconnectReason.badSession ||
          statusCode === 440 || // connection lost
          statusCode === 428 || // reconnect required
          statusCode === 401 || // unauthorized
          (statusCode === 515 && reconnectAttempts >= 1); // stream errored after initial attempt

        // Determine if we should reconnect
        const shouldReconnect =
          statusCode !== DisconnectReason.loggedOut &&
          reconnectAttempts < maxReconnectAttempts &&
          !isReconnecting &&
          !initInProgress;

        console.log("🔄 Should reconnect:", shouldReconnect);

        if (isConflict) {
          console.log("⚠️ CONFLICT DETECTED: Another session is active!");
          console.log("💡 This usually means:");
          console.log("   1. The bot is running in another process");
          console.log("   2. WhatsApp Web is open in a browser");
          console.log(
            "   3. Multiple reconnection attempts happened simultaneously",
          );
          console.log("   4. Old socket handlers weren't cleaned up properly");
          console.log(
            "🛑 Clearing session and stopping reconnection attempts...",
          );

          // Clear the corrupted session
          const authPath = path.join(__dirname, "..", "auth_info_baileys");
          try {
            if (fs.existsSync(authPath)) {
              fs.rmSync(authPath, { recursive: true, force: true });
              console.log("✅ Session cleared successfully");
            }
          } catch (error) {
            console.error("❌ Error clearing session:", error);
          }

          connectionStatus = "disconnected";
          qrCodeData = null;
          isReconnecting = false;
          reconnectAttempts = 0;

          // CRITICAL: Release the init lock before retrying
          releaseInitLock();
          initInProgress = false;

          // Try one more time with fresh QR after clearing
          // IMPORTANT: Longer delay to ensure old socket is fully cleaned up
          console.log("🔄 Will generate fresh QR code in 5 seconds...");
          setTimeout(() => {
            initializeBot();
          }, 5000);

          return;
        }

        // Auto-clear corrupted session
        if (sessionCorrupted && reconnectAttempts > 0) {
          console.log("🔥 SESSION CORRUPTION DETECTED!");
          console.log("📊 Error Code:", statusCode);
          console.log("💡 Likely causes:");
          console.log("   - Session became invalid/expired");
          console.log("   - WhatsApp servers can't validate credentials");
          console.log("   - Network issues during authentication");
          console.log("🗑️ Auto-clearing session to allow fresh QR login...");

          // Delete auth folder
          const authPath = path.join(__dirname, "..", "auth_info_baileys");
          try {
            if (fs.existsSync(authPath)) {
              fs.rmSync(authPath, { recursive: true, force: true });
              console.log("✅ Session cleared successfully");
            }
          } catch (error) {
            console.error("❌ Error clearing session:", error);
          }

          // Reset and try one more time with fresh session
          reconnectAttempts = 0;
          isReconnecting = false;
          connectionStatus = "disconnected";

          // CRITICAL: Release the init lock before retrying
          releaseInitLock();
          initInProgress = false;

          // IMPORTANT: Longer delay to ensure old socket is fully cleaned up
          console.log(
            "🔄 Attempting fresh connection with QR code in 5 seconds...",
          );
          setTimeout(() => {
            initializeBot();
          }, 5000);

          return;
        }

        if (shouldReconnect) {
          // Immediate attempt for first failure (fast path), then backoff
          reconnectAttempts++;
          let delay;
          if (reconnectAttempts === 1) {
            delay = 2000; // 2s first retry
          } else {
            delay = Math.min(5000 * Math.pow(2, reconnectAttempts - 2), 60000);
          }

          console.log(
            `⏳ Scheduling reconnect in ${
              delay / 1000
            }s (Attempt ${reconnectAttempts}/${maxReconnectAttempts})`,
          );

          isReconnecting = true;
          connectionStatus = "reconnecting";

          // CRITICAL: Remove ALL event listeners before reconnect to prevent ghost handlers
          reconnectTimeout = setTimeout(async () => {
            console.log(
              `🔄 Attempting reconnection #${reconnectAttempts} (statusCode=${statusCode})`,
            );

            // Clean up old socket completely
            if (sock) {
              try {
                sock.ev.removeAllListeners();
                if (sock.ws && sock.ws.readyState === sock.ws.OPEN) {
                  sock.ws.close();
                }
              } catch (e) {
                console.warn("Socket cleanup warning:", e.message);
              }
              sock = null;
            }

            // CRITICAL: Release the init lock before reinitializing
            releaseInitLock();
            initInProgress = false;
            isReconnecting = false;

            // Now reinitialize (this will create fresh event handlers)
            await initializeBot();
          }, delay);
        } else {
          connectionStatus = "disconnected";
          qrCodeData = null;
          isReconnecting = false;

          if (reconnectAttempts >= maxReconnectAttempts) {
            console.log("❌ Max reconnection attempts reached. Stopping.");
          } else {
            console.log("❌ Bot disconnected. Reason:", errorMessage);
          }

          reconnectAttempts = 0;
        }
      } else if (connection === "open") {
        console.log("WhatsApp connection opened successfully!");
        connectionStatus = "connected";
        qrCodeData = null;
        currentQR = null;

        // Reset reconnection tracking on successful connection
        reconnectAttempts = 0;
        isReconnecting = false;
        if (reconnectTimeout) {
          clearTimeout(reconnectTimeout);
          reconnectTimeout = null;
        }

        // Initialize reminder scheduler
        reminderScheduler.initScheduler(sock);

        // Start message queue processor for reliable delivery
        const adminCommandService = require("../services/adminCommandService");
        adminCommandService.startQueueProcessor();
        console.log("✅ Message queue processor initialized");

        // Fetch all groups when connected (guarded)
        scheduleGroupsFetch();
      }
    });

    // Message handler: fetch messages from groups and store as 'ads'
    console.log("🎧 Setting up messages.upsert event listener...");
    sock.ev.on("messages.upsert", async ({ messages }) => {
      console.log(
        `🔔 messages.upsert event triggered! Messages count: ${messages.length}`,
      );
      try {
        const msg = messages[0];

        // Log all incoming messages for debugging
        console.log(
          `📨 Message received - fromMe: ${
            msg.key.fromMe
          }, hasMessage: ${!!msg.message}, remoteJid: ${msg.key.remoteJid}`,
        );

        // Skip messages without content
        if (!msg.message) {
          console.log(`⏩ Skipping message - no message content`);
          return;
        }

        const messageText =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption ||
          msg.message?.videoMessage?.caption ||
          null;

        // Check if it's media without text (voice, image without caption, video without caption, sticker, document, etc.)
        const isMediaOnly =
          !messageText &&
          (msg.message?.audioMessage ||
            msg.message?.imageMessage ||
            msg.message?.videoMessage ||
            msg.message?.documentMessage ||
            msg.message?.stickerMessage ||
            msg.message?.contactMessage ||
            msg.message?.locationMessage);

        const from = msg.key.remoteJid;

        // Extract sender name (pushName) from WhatsApp
        const senderName = msg.pushName || msg.verifiedBisName || "Unknown";

        // Extract sender phone number
        const senderJid = msg.key.participant || msg.key.remoteJid || null;
        // Extract actual phone number from JID (e.g., "240917902585982@lid" -> "240917902585982")
        const senderPhone = senderJid ? senderJid.split("@")[0] : null;

        // Extract image URL if present
        let imageUrl = null;
        if (msg.message?.imageMessage) {
          imageUrl = msg.message.imageMessage;
        }

        // Accept messages from groups (@g.us) and communities (@broadcast)
        if (!from) return;

        const isGroup = from.endsWith("@g.us");
        const isCommunity = from.includes("@broadcast");
        // Handle regular WhatsApp IDs (@s.whatsapp.net) and @lid (WhatsApp Business/linked devices)
        const isPrivate =
          from.endsWith("@s.whatsapp.net") || from.endsWith("@lid");
        const isLid = from.endsWith("@lid");

        // ============================================
        // 🚫 IGNORE STATUS & UNWANTED BROADCASTS
        // ============================================
        // Filter out status@broadcast (WhatsApp statuses)
        if (from === "status@broadcast" || from.startsWith("status@")) {
          console.log(`⏭️ Ignoring status broadcast message`);
          return; // Completely ignore WhatsApp status messages
        }

        // Filter out ALL broadcast channels except groups and private chats
        // You can whitelist specific broadcast channels here if needed
        if (isCommunity && !isGroup && !isPrivate) {
          console.log(`⏭️ Ignoring broadcast channel: ${from}`);
          return; // Ignore all broadcast channels (communities) - only process groups and private chats
        }

        // ============================================
        // PRIVATE CHAT SYSTEM - Handle all private messages
        // ============================================
        if (isPrivate && (messageText || isMediaOnly)) {
          console.log(
            `💬 Private message from: ${senderName} (${senderPhone}), JID: ${from}`,
          );

          try {
            const phoneNumber = privateChatService.extractPhoneNumber(from);
            console.log(`📱 Extracted phone number: ${phoneNumber}`);

            // ============================================
            // 🔒 ADMIN-ONLY MODE - Only respond to admins
            // ============================================
            // NOTE: The bot cannot see messages sent from its own WhatsApp account
            // So we use admin numbers from adminCommandService instead
            const isAdmin = adminCommandService.isAdmin(from);

            // ✋ If not an admin, ignore the message completely
            if (!isAdmin) {
              console.log(
                `🚫 Message ignored - sender is not an admin: ${senderName} (${senderPhone})`,
              );
              return; // Don't respond to non-admins
            }

            console.log(
              `✅ Admin message detected from: ${senderName} (${senderPhone})`,
            );

            // Admin commands to control bot responses (with confirmation)
            if (messageText) {
              const command = messageText.trim();
              const commandParts = command.split(/\s+/);
              const rawMain = commandParts[0] || "";
              const mainCommand = rawMain.replace(
                /[^\u0600-\u06FFa-zA-Z]/g,
                "",
              );

              // First check if admin is confirming or cancelling a pending action
              const bare = command
                .replace(/[^\u0600-\u06FFa-zA-Z]/g, "")
                .toLowerCase();
              const confirmWords = [
                "تأكيد",
                "تأكيداً",
                "نعم",
                "confirm",
                "yes",
                "موافق",
                "ok",
              ];
              const cancelWords = ["الغاء", "الغاءً", "إلغاء", "لا", "cancel"];

              if (pendingActions[from]) {
                if (confirmWords.includes(bare)) {
                  const action = pendingActions[from];
                  delete pendingActions[from];

                  // Perform the pending action now
                  if (action.type === "stop") {
                    let successCount = 0;
                    let alreadyBlockedCount = 0;
                    const blockedList = [];
                    for (const targetPhone of action.phones) {
                      const client = privateClientModel.getClient(targetPhone);
                      if (client.botBlocked) {
                        alreadyBlockedCount++;
                      } else {
                        privateClientModel.updateClient(targetPhone, {
                          botBlocked: true,
                          botBlockedAt: Date.now(),
                          botBlockedBy: from,
                        });
                        successCount++;
                        blockedList.push(`📱 +${targetPhone}`);
                      }
                    }
                    let responseMsg = "";
                    if (successCount > 0) {
                      responseMsg += `✅ تم إيقاف البوت عن الرد مع ${successCount} عميل:\n\n`;
                      responseMsg += blockedList.join("\n");
                      responseMsg += `\n\n💬 الآن يمكنك التحدث مباشرة مع العملاء\n\nلإعادة التشغيل، أرسل: تشغيل`;
                    }
                    if (alreadyBlockedCount > 0) {
                      if (responseMsg) responseMsg += "\n\n";
                      responseMsg += `⚠️ ${alreadyBlockedCount} عميل كان موقوفاً بالفعل`;
                    }
                    await sendMessage(
                      from,
                      responseMsg || "✅ لا تغييرات مطلوبة",
                    );
                    return;
                  } else if (action.type === "start") {
                    let successCount = 0;
                    let notBlockedCount = 0;
                    const unblockedList = [];
                    for (const targetPhone of action.phones) {
                      const targetClient =
                        privateClientModel.getClient(targetPhone);
                      if (targetClient.botBlocked) {
                        privateClientModel.updateClient(targetPhone, {
                          botBlocked: false,
                          botBlockedAt: null,
                          botBlockedBy: null,
                        });
                        successCount++;
                        unblockedList.push(
                          `📱 +${targetPhone} (${
                            targetClient.name || "غير محدد"
                          })`,
                        );
                      } else {
                        notBlockedCount++;
                      }
                    }
                    let responseMsg = "";
                    if (successCount > 0) {
                      responseMsg += `✅ تم تشغيل البوت مع ${successCount} عميل:\n\n`;
                      responseMsg += unblockedList.join("\n");
                      responseMsg += `\n\n🤖 البوت سيستأنف الردود التلقائية الآن`;
                    }
                    if (notBlockedCount > 0) {
                      if (responseMsg) responseMsg += "\n\n";
                      responseMsg += `⚠️ ${notBlockedCount} عميل لم يكن موقوفاً`;
                    }
                    await sendMessage(
                      from,
                      responseMsg || "✅ لا تغييرات مطلوبة",
                    );
                    return;
                  } else if (action.type === "waseet") {
                    let successCount = 0;
                    let alreadyWaseetCount = 0;
                    const waseetList = [];
                    for (const targetPhone of action.phones) {
                      const client = privateClientModel.getClient(targetPhone);
                      if (client.isWaseet) {
                        alreadyWaseetCount++;
                      } else {
                        privateClientModel.updateClient(targetPhone, {
                          isWaseet: true,
                          waseetAddedAt: Date.now(),
                          waseetAddedBy: from,
                        });
                        successCount++;
                        waseetList.push(
                          `📱 +${targetPhone} (${client.name || "غير محدد"})`,
                        );
                      }
                    }
                    let responseMsg = "";
                    if (successCount > 0) {
                      responseMsg += `✅ تم إضافة ${successCount} وسيط جديد:\n\n`;
                      responseMsg += waseetList.join("\n");
                    }
                    if (alreadyWaseetCount > 0) {
                      if (responseMsg) responseMsg += "\n\n";
                      responseMsg += `⚠️ ${alreadyWaseetCount} عميل كان وسيطاً بالفعل`;
                    }
                    await sendMessage(
                      from,
                      responseMsg || "✅ لا تغييرات مطلوبة",
                    );
                    return;
                  }
                }

                if (cancelWords.includes(bare)) {
                  delete pendingActions[from];
                  await sendMessage(from, "❌ تم إلغاء العملية.");
                  return;
                }
              }

              // If no pending action or not a confirmation, parse the admin command and prepare an action
              // Extract phone numbers more flexibly (supports spaces/dashes/parentheses)
              const targetPhones = extractAndNormalizePhoneNumbers(command);

              console.log(
                `🔍 DEBUG - Admin command: ${mainCommand}, extracted phones: ${targetPhones.join(
                  ", ",
                )}`,
              );

              if (mainCommand === "ايقاف" || mainCommand === "توقف") {
                if (targetPhones.length === 0) {
                  await sendMessage(
                    from,
                    `❌ يرجى تحديد أرقام الهواتف\n\nمثال:\nتوقف +966508007053\n\nأو عدة أرقام:\nتوقف\n+966508007053\n+966508007054\n+966508007055`,
                  );
                  return;
                }

                // Ask for confirmation before applying
                pendingActions[from] = {
                  type: "stop",
                  phones: targetPhones,
                  createdAt: Date.now(),
                };
                const display = targetPhones
                  .map(formatPhoneForDisplay)
                  .join("\n");
                await sendMessage(
                  from,
                  `🛑 طلب إيقاف البوت للأرقام التالية:\n\n${display}\n\nللمتابعة أرسل: تأكيد\nللإلغاء أرسل: إلغاء`,
                );
                return;
              } else if (mainCommand === "تشغيل" || mainCommand === "تفعيل") {
                if (targetPhones.length === 0) {
                  await sendMessage(
                    from,
                    `❌ يرجى تحديد أرقام الهواتف\n\nمثال:\nتشغيل +966508007053\n\nأو عدة أرقام:\nتشغيل\n+966508007053\n+966508007054\n+966508007055`,
                  );
                  return;
                }
                pendingActions[from] = {
                  type: "start",
                  phones: targetPhones,
                  createdAt: Date.now(),
                };
                const display = targetPhones
                  .map(formatPhoneForDisplay)
                  .join("\n");
                await sendMessage(
                  from,
                  `✅ طلب تشغيل البوت للأرقام التالية:\n\n${display}\n\nللمتابعة أرسل: تأكيد\nللإلغاء أرسل: إلغاء`,
                );
                return;
              } else if (mainCommand === "وسيط" || mainCommand === "وسطاء") {
                if (targetPhones.length === 0) {
                  await sendMessage(
                    from,
                    `❌ يرجى تحديد أرقام الهواتف\n\nمثال:\nوسيط +966508007053\n\nأو عدة أرقام:\nوسيط\n+966508007053\n+966508007054\n+966508007055`,
                  );
                  return;
                }
                pendingActions[from] = {
                  type: "waseet",
                  phones: targetPhones,
                  createdAt: Date.now(),
                };
                const display = targetPhones
                  .map(formatPhoneForDisplay)
                  .join("\n");
                await sendMessage(
                  from,
                  `🤝 طلب إضافة وسطاء للأرقام التالية:\n\n${display}\n\nللمتابعة أرسل: تأكيد\nللإلغاء أرسل: إلغاء`,
                );
                return;
              }
            }

            // ============================================
            // ADMIN COMMANDS - Check if other admin commands
            // ============================================
            const adminResponse = await adminCommandService.handleAdminCommand(
              sock,
              messageText,
              from,
            );

            // If it's an admin command, send response and return
            if (adminResponse) {
              await sendMessage(from, adminResponse);
              console.log(`✅ Admin command executed by ${senderName}`);
              return;
            }

            // ============================================
            // WASEET (وسيط) DETECTION - Filter messages before dashboard
            // ============================================
            if (waseetDetector.isWaseet(from)) {
              console.log(`🔍 Message from waseet: ${senderName}`);

              // Skip media-only messages
              if (isMediaOnly && !messageText) {
                console.log(
                  `⏭️ Ignoring media-only message from waseet ${senderName}`,
                );
                return;
              }

              // Stage 1: Quick local check (FREE - no tokens)
              if (!waseetDetector.isLikelyAd(messageText)) {
                console.log(
                  `❌ Not likely an ad from waseet ${senderName}, ignoring...`,
                );
                return; // Don't send to dashboard or AI
              }

              // Stage 2: Only use AI if it passes basic check
              console.log(
                `✅ Potential ad from waseet ${senderName}, processing with AI...`,
              );

              const queueResult = await messageQueue.add(
                {
                  messageText,
                  from,
                  groupSubject: `وسيط: ${senderName}`,
                  senderName,
                  senderPhone,
                  imageUrl: imageUrl || null,
                  participant: from,
                  remoteJid: from,
                  source: "waseet",
                },
                processMessageFromQueue,
              );

              if (queueResult?.success) {
                waseetDetector.incrementAdCount(from);
                await sendMessage(
                  from,
                  "✅ تم استلام الإعلان ومعالجته بنفس مسار الجروبات بنجاح.",
                );
              }
              return;

              // Process through AI
              const earlyTargetWebsite = detectTargetWebsiteEarly(messageText);
              const aiResult = await processMessage(messageText, {
                targetWebsite: earlyTargetWebsite,
              });

              console.log(
                `🔍 AI Result for waseet: isAd=${aiResult.isAd}, confidence=${aiResult.confidence}%`,
              );

              // If not confirmed as ad, ignore
              if (!aiResult.isAd) {
                console.log(
                  `❌ AI confirmed not an ad from waseet ${senderName} (confidence: ${aiResult.confidence}%)`,
                );
                return;
              }

              // ✅ Confirmed ad from waseet - Add to dashboard
              console.log(
                `✅ Confirmed ad from waseet ${senderName}, adding to dashboard...`,
              );

              const waseetQuickCategory = quickDetectCategory(messageText);
              const waseetCategoryForLimit = resolveCategoryForLimit(
                aiResult,
                waseetQuickCategory,
              );

              if (
                waseetCategoryForLimit &&
                isCategoryLimitReached(waseetCategoryForLimit)
              ) {
                console.log(
                  `🚫 Waseet ad blocked: category "${waseetCategoryForLimit}" reached daily limit.`,
                );

                const recycleBinItem = {
                  id: `rb_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
                  text: messageText,
                  fromGroup: from,
                  fromGroupName: `وسيط: ${senderName}`,
                  author: from,
                  senderName: senderName,
                  senderPhone: senderPhone,
                  rejectedAt: Date.now(),
                  aiConfidence: aiResult.confidence,
                  aiReason: `Category limit reached: ${waseetCategoryForLimit}`,
                  category: waseetCategoryForLimit,
                  blockReason: "category_limit_reached_waseet",
                  imageUrl: imageUrl || null,
                  source: "waseet",
                };

                recycleBin.unshift(recycleBinItem);
                if (recycleBin.length > 500)
                  recycleBin = recycleBin.slice(0, 500);
                saveRecycleBin();

                await sendMessage(
                  from,
                  `🚫 تم إيقاف الإعلان لأن تصنيف "${waseetCategoryForLimit}" وصل للحد اليومي. حاول مرة أخرى بعد 00:00.`,
                );
                return;
              }

              // Create ad object (similar to group ads)
              const normalized = normalizeText(messageText);
              const ad = {
                id: `${Date.now()}_${Math.floor(Math.random() * 10000)}`,
                text: messageText,
                enhancedText: aiResult.enhancedText,
                normalizedText: normalized,
                fromGroup: from,
                fromGroupName: `وسيط: ${senderName}`,
                author: from,
                senderName: senderName,
                senderPhone: senderPhone,
                imageUrl: imageUrl,
                timestamp: Date.now(),
                status: "new",
                category: waseetCategoryForLimit || aiResult.category || null,
                aiConfidence: aiResult.confidence,
                aiReason: aiResult.reason,
                improvements: aiResult.improvements || [],
                isEdited: false,
                meta: aiResult.meta || {},
                wpData: aiResult.wpData || null,
                whatsappMessage: aiResult.whatsappMessage || null,
                rawAiResponse: aiResult.rawAiResponse || null,
                sanitizationSteps: Array.isArray(aiResult.sanitizationSteps)
                  ? aiResult.sanitizationSteps
                  : [],
                source: "waseet", // Mark as waseet ad
              };

              ads.unshift(ad);
              if (ads.length > 1000) ads = ads.slice(0, 1000);
              saveAds();

              // Increment ad counter for this waseet
              waseetDetector.incrementAdCount(from);

              console.log(
                `✨ Waseet ad saved successfully! ID: ${ad.id}, From: ${senderName}`,
              );

              // Check if auto-approve is enabled and auto-post to WordPress
              const settings = getSettings();
              const isGroupAllowedForAutoPost = shouldAutoPostFromSourceGroup(
                ad.fromGroup,
              );
              const autoPostEnabled = isAutoPostEnabled();
              const shouldUseFixedAutoPostCategory =
                shouldUseFixedCategoryForSourceGroup(ad.fromGroup);

              if (autoPostEnabled && ad.wpData && isGroupAllowedForAutoPost) {
                console.log(
                  "🚀 Auto-approve enabled, posting waseet ad to WordPress automatically...",
                );

                // Auto-post to WordPress using the SAME function as manual posting
                (async () => {
                  try {
                    // Import the WordPress posting function from routes
                    const { postAdToWordPress } = require("../routes/bot");

                    console.log(
                      "🔵 Starting WordPress auto-post for waseet ad using manual function...",
                    );
                    console.log("🔵 Ad ID:", ad.id);

                    const wpDataForAutoPost = buildAutoPostWpData(
                      ad.wpData,
                      shouldUseFixedAutoPostCategory,
                    );

                    // Call the same function used for manual posting
                    const result = await postAdToWordPress(
                      ad,
                      sock,
                      wpDataForAutoPost,
                      false,
                    );

                    if (result.success) {
                      console.log(
                        "✅ ✅ ✅ Waseet ad auto-posted to WordPress successfully! ✅ ✅ ✅",
                      );
                      console.log("📌 Post ID:", result.wordpressPost.id);
                      console.log("📌 Short Link:", result.wordpressPost.link);

                      // Update ad status to "accepted" (not "posted")
                      ad.status = "accepted";
                      ad.wordpressPostId = result.wordpressPost.id;
                      ad.wordpressUrl = result.wordpressPost.link;
                      ad.wordpressFullUrl = result.wordpressPost.fullLink;
                      ad.whatsappMessage = result.whatsappMessage;
                      ad.wpData = result.extractedData;

                      // Save updated ad
                      saveAds();
                      console.log(
                        "✅ Waseet ad updated with WordPress info and marked as accepted",
                      );
                    } else {
                      console.error(
                        "❌ WordPress posting returned unsuccessful result",
                      );
                    }
                  } catch (error) {
                    console.error(
                      "❌ ❌ ❌ Error during waseet auto-post to WordPress ❌ ❌ ❌",
                    );
                    console.error("Error message:", error.message);
                    console.error(
                      "Error details:",
                      error.response?.data || error,
                    );
                  }
                })();
              } else if (
                autoPostEnabled &&
                ad.wpData &&
                !isGroupAllowedForAutoPost
              ) {
                console.log(
                  `⏭️ Auto-post skipped: source "${ad.fromGroup}" is not in selected auto-post groups`,
                );
              }

              // Send confirmation to waseet
              await sendMessage(
                from,
                `✅ تم استلام إعلانك بنجاح وإضافته إلى قائمة الانتظار.\n\n📊 التصنيف: ${
                  aiResult.category || "غير محدد"
                }\n🎯 الدقة: ${aiResult.confidence}%\n\nشكراً لك! 🙏`,
              );

              return; // Don't process through regular private chat system
            }

            // ============================================
            // REGULAR PRIVATE CHAT - For admins only
            // ============================================
            const privateClientModel = require("../models/privateClient");

            // Get client to check state
            const clientData = privateClientModel.getClient(phoneNumber);

            // If it's media only without text, handle based on state
            if (isMediaOnly && !messageText) {
              console.log(`📎 Media-only message detected from: ${senderName}`);

              // Only warn if waiting for name or awaiting_requirements (when text is needed)
              const needsTextInput =
                clientData.state === "awaiting_name" ||
                clientData.state === "awaiting_requirements";

              if (needsTextInput) {
                // Check if we already warned this user about media (use a flag in client object)
                if (!clientData.mediaWarningShown) {
                  await sendMessage(
                    from,
                    "عذراً، لا أستطيع معالجة الرسائل الصوتية أو الوسائط بدون نص حالياً. 📎\n\nمن فضلك اكتب رسالة نصية، أو تواصل معنا مباشرة:\n📱 *0508001475*",
                  );
                  // Mark that we've shown the warning
                  privateClientModel.updateClient(phoneNumber, {
                    mediaWarningShown: true,
                  });
                } else {
                  console.log(
                    `⏭️ Already warned about media, ignoring subsequent media from ${senderName}`,
                  );
                }
              } else {
                // In other states (completed, awaiting_role, etc.), just ignore media silently
                console.log(`⏭️ Media ignored in state: ${clientData.state}`);
              }
              return;
            }

            // Reset media warning flag when user sends text (they're following instructions now)
            if (messageText && clientData.mediaWarningShown) {
              privateClientModel.updateClient(phoneNumber, {
                mediaWarningShown: false,
              });
            }

            // Create sendReply function that uses sendMessage
            const sendReply = async (message) => {
              await sendMessage(from, message);
            };

            // Create sendImageReply function that uses sendImage
            const sendImageReply = async (imageData, caption) => {
              await sendImage(from, imageData, caption);
            };

            // Handle the private message with the conversation system
            await privateChatService.handlePrivateMessage(
              phoneNumber,
              messageText,
              sendReply,
              sendImageReply,
            );

            console.log(`✅ Private chat response sent to ${senderName}`);
            return; // Don't process as regular message
          } catch (error) {
            console.error("❌ Private chat system error:", error);
            await sendMessage(
              from,
              "عذراً، حدث خطأ. يرجى المحاولة مرة أخرى لاحقاً. 🙏",
            );
          }
        }

        // ============================================
        // ORIGINAL AD PROCESSING - Only for groups
        // ============================================
        if (!isGroup) return; // Only process groups (@g.us) for ads, ignore everything else

        // ============================================
        // CHECK EXCLUDED GROUPS - Skip if excluded
        // ============================================
        if (settings.excludedGroups && settings.excludedGroups.includes(from)) {
          console.log(`⏭️ Skipping excluded group: ${from}`);
          // Still save the group metadata but don't process messages
          seenGroups.add(from);

          // Try to get group/community subject (best-effort)
          try {
            const metadata = await sock.groupMetadata(from).catch(() => null);
            if (metadata && metadata.subject) {
              groupsMetadata[from] = {
                jid: from,
                name: metadata.subject,
                type: isCommunity ? "Community" : "Group",
                isCommunity: isCommunity,
              };
            }
          } catch (e) {
            // ignore
          }
          return; // Don't process messages from this group
        }

        // Save ALL groups/communities for receiving messages
        seenGroups.add(from);

        // Try to get group/community subject (best-effort)
        let groupSubject = from;
        try {
          const metadata = await sock.groupMetadata(from).catch(() => null);
          if (metadata && metadata.subject) {
            groupSubject = metadata.subject;
            // Cache metadata for ALL groups (even if bot can't send)
            groupsMetadata[from] = {
              jid: from,
              name: groupSubject,
              type: isCommunity ? "Community" : "Group",
              isCommunity: isCommunity,
            };
          }
        } catch (e) {
          // ignore
        }

        if (!messageText) return;

        console.log(`📨 New message received from Group:`, groupSubject);

        // Add message to queue for processing
        messageQueue
          .add(
            {
              messageText,
              from,
              groupSubject,
              senderName,
              senderPhone,
              imageUrl,
              participant: msg.key.participant,
              remoteJid: msg.key.remoteJid,
              messageKey: msg.key, // Store message key for full image download
            },
            processMessageFromQueue,
          )
          .catch((error) => {
            console.error("❌ Failed to process message from queue:", error);
          });
      } catch (error) {
        console.error("❌ Error in message handler:", error);
      }
    });

    // Retry any pending ads from previous runs
    console.log("🔍 Checking for pending ads to retry...");
    setTimeout(() => retryPendingAds(), 30000); // Wait 30 seconds after startup

    // Return sock instance for use in routes
    return sock;
  } catch (error) {
    console.error("Error initializing bot:", error);
    connectionStatus = "error";
    return null;
  } finally {
    // Release cross-process lock
    try {
      releaseInitLock();
    } catch {}
    initInProgress = false;
  }
}

function getQRCode() {
  return qrCodeData;
}

function getConnectionStatus() {
  return connectionStatus;
}

async function disconnectBot() {
  console.log("🛑 Disconnecting bot and clearing session...");
  if (sock) {
    try {
      // Send a final logout signal to WhatsApp servers
      await sock.logout();
      console.log("✅ Successfully logged out from WhatsApp");
    } catch (error) {
      console.warn(
        "⚠️ Error during logout (connection likely already closed):",
        error.message,
      );
    } finally {
      // Ensure all listeners are removed to prevent memory leaks
      sock.ev.removeAllListeners();
      sock = null;
    }
  }

  connectionStatus = "disconnected";
  qrCodeData = null;
  currentQR = null;
  reconnectAttempts = 0; // Reset reconnect counter
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  // Delete auth_info_baileys folder to force a new QR on next startup
  const authPath = path.join(__dirname, "..", "auth_info_baileys");
  try {
    if (fs.existsSync(authPath)) {
      console.log("🗑️ Deleting auth_info_baileys folder for a clean start...");
      fs.rmSync(authPath, { recursive: true, force: true });
      console.log("✅ auth_info_baileys folder deleted successfully");
    } else {
      console.log(
        "ℹ️ auth_info_baileys folder does not exist, nothing to clear.",
      );
    }
  } catch (error) {
    console.error("❌ Error deleting auth_info_baileys folder:", error);
    throw error; // Propagate error to the API caller
  }
}
async function sendMessage(numberOrJid, message) {
  if (connectionStatus !== "connected" || !sock) {
    throw new Error("Bot is not connected");
  }

  let jid = numberOrJid;
  // If it's a plain number, convert to s.whatsapp.net
  if (!jid.includes("@")) {
    jid = `${jid}@s.whatsapp.net`;
  }

  // Check if message contains URLs and generate link preview
  const urls = linkPreviewService.extractUrls(message);

  if (urls.length > 0) {
    console.log(
      `🔗 Message contains ${urls.length} URL(s), generating link preview...`,
    );

    try {
      // Generate link preview for the first URL
      const linkPreview = await linkPreviewService.generateLinkPreview(message);

      if (linkPreview) {
        console.log(`✅ Link preview generated successfully`);
        console.log(`📋 Preview data:`, {
          canonicalUrl: linkPreview.canonicalUrl,
          title: linkPreview.title,
          hasImage: !!linkPreview.jpegThumbnail,
        });

        // Send message with link preview using Baileys v6 contextInfo format
        const messageContent = {
          text: message,
        };

        // Add link preview with thumbnail
        if (linkPreview.jpegThumbnail) {
          messageContent.contextInfo = {
            externalAdReply: {
              title: linkPreview.title,
              body: linkPreview.description || "",
              thumbnailUrl: linkPreview.canonicalUrl,
              sourceUrl: linkPreview.canonicalUrl,
              mediaType: 1,
              thumbnail: linkPreview.jpegThumbnail,
              renderLargerThumbnail: true,
              showAdAttribution: false,
            },
          };
          console.log(
            `📎 Added thumbnail to link preview (${linkPreview.jpegThumbnail.length} bytes)`,
          );
        } else {
          // Fallback: Add link preview without thumbnail
          messageContent.contextInfo = {
            externalAdReply: {
              title: linkPreview.title,
              body: linkPreview.description || "",
              sourceUrl: linkPreview.canonicalUrl,
              mediaType: 1,
              showAdAttribution: false,
            },
          };
          console.log(`📎 Added link preview without thumbnail`);
        }

        await sock.sendMessage(jid, messageContent);
        console.log(`✅ Message sent with link preview to ${jid}`);
        return; // Exit after successful send
      } else {
        console.warn(`⚠️ Failed to generate link preview, sending without it`);
      }
    } catch (error) {
      console.error(`❌ Error generating link preview:`, error.message);
      console.error(`📍 Error details:`, error);
      // Fall through to send without link preview
    }
  }

  // Send message without link preview (no URLs or preview generation failed)
  await sock.sendMessage(jid, { text: message });
}

/**
 * Send image with caption
 * @param {string} numberOrJid - Recipient number or JID
 * @param {Buffer|string} imageData - Image buffer or URL
 * @param {string} caption - Image caption
 */
async function sendImage(numberOrJid, imageData, caption = "") {
  if (connectionStatus !== "connected" || !sock) {
    throw new Error("Bot is not connected");
  }

  let jid = numberOrJid;
  // If it's a plain number, convert to s.whatsapp.net
  if (!jid.includes("@")) {
    jid = `${jid}@s.whatsapp.net`;
  }

  try {
    await sock.sendMessage(jid, {
      image: imageData,
      caption: caption,
    });
    console.log(`📸 Image sent to ${jid}`);
  } catch (error) {
    console.error(`❌ Error sending image to ${jid}:`, error);
    throw error;
  }
}

function getFetchedAds() {
  return ads;
}

function updateAdStatus(id, status, rejectionReason = null) {
  const idx = ads.findIndex((a) => a.id === id);
  if (idx === -1) return false;

  // If status is "rejected", keep in ads but mark as rejected with reason
  if (status === "rejected") {
    ads[idx].status = "rejected";
    ads[idx].rejectionReason = rejectionReason || "مرفوض من قبل المستخدم";
    ads[idx].rejectedAt = Date.now();
    saveAds();
    console.log(
      `❌ Ad marked as rejected: ${id} - Reason: ${
        rejectionReason || "Not specified"
      }`,
    );
    return true;
  }

  ads[idx].status = status;
  saveAds();
  return true;
}

// Move rejected ad to recycle bin (second step after rejection)
function moveAdToRecycleBin(id) {
  const idx = ads.findIndex((a) => a.id === id);
  if (idx === -1) return false;

  const ad = ads[idx];

  // Only allow moving rejected ads to recycle bin
  if (ad.status !== "rejected") {
    console.log(`⚠️ Cannot move non-rejected ad to recycle bin: ${id}`);
    return false;
  }

  // Save ALL ad data for complete restoration
  const recycleBinItem = {
    id: `rb_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
    // Basic info
    text: ad.text,
    originalText: ad.originalText,
    enhancedText: ad.enhancedText,
    fromGroup: ad.fromGroup,
    fromGroupName: ad.fromGroupName,
    author: ad.author,
    senderName: ad.senderName,
    senderPhone: ad.senderPhone,
    // Rejection info
    rejectedAt: ad.rejectedAt || Date.now(),
    rejectionReason: ad.rejectionReason,
    aiConfidence: ad.aiConfidence,
    aiReason: ad.rejectionReason || "مرفوض من قبل المستخدم",
    originalAdId: ad.id,
    originalTimestamp: ad.timestamp,
    // AI-generated data
    wpData: ad.wpData,
    whatsappMessage: ad.whatsappMessage,
    rawAiResponse: ad.rawAiResponse,
    sanitizationSteps: Array.isArray(ad.sanitizationSteps)
      ? ad.sanitizationSteps
      : [],
    category: ad.category,
    meta: ad.meta,
    improvements: ad.improvements,
    // WordPress data
    wordpressPostId: ad.wordpressPostId,
    wordpressUrl: ad.wordpressUrl,
    wordpressFullUrl: ad.wordpressFullUrl,
    wordpressPostedAt: ad.wordpressPostedAt,
    targetWebsite: ad.targetWebsite,
    // Image data
    imageUrl: ad.imageUrl,
  };

  recycleBin.unshift(recycleBinItem);
  if (recycleBin.length > 500) recycleBin = recycleBin.slice(0, 500);
  saveRecycleBin();

  // Remove from ads
  ads.splice(idx, 1);
  saveAds();

  console.log(`🗑️ Ad moved to recycle bin: ${id}`);
  return true;
}

function updateAdCategory(id, category) {
  const idx = ads.findIndex((a) => a.id === id);
  if (idx === -1) return false;
  ads[idx].category = category;
  saveAds();
  return true;
}

function updateAdText(id, text) {
  const idx = ads.findIndex((a) => a.id === id);
  if (idx === -1) return false;
  ads[idx].enhancedText = text;
  ads[idx].isEdited = true;
  saveAds();
  return true;
}

function updateAdEnhancedText(id, enhancedText, improvements) {
  const idx = ads.findIndex((a) => a.id === id);
  if (idx === -1) return false;
  ads[idx].enhancedText = enhancedText;
  ads[idx].improvements = improvements || [];
  ads[idx].isEdited = false; // Reset edited flag when regenerated
  saveAds();
  return true;
}

function updateAdWordPressData(id, wpData, whatsappMessage) {
  const idx = ads.findIndex((a) => a.id === id);
  if (idx === -1) return false;
  const targetWebsite =
    wpData?.targetWebsite ||
    ads[idx].targetWebsite ||
    aiService.__private.inferTargetWebsiteFromData(
      wpData,
      ads[idx].text || "",
    ) ||
    "masaak";
  ads[idx].wpData = sanitizeWordPressDataForStorage(wpData, targetWebsite);
  ads[idx].targetWebsite = targetWebsite;
  ads[idx].whatsappMessage = whatsappMessage;
  ads[idx].isEdited = false; // Reset edited flag when regenerated
  ads[idx].wpDataManuallyEdited = false;
  delete ads[idx].wpDataEditedAt;
  delete ads[idx].wpDataEditedBy;
  saveAds();
  return true;
}

// Retry failed ad processing
async function retryFailedAd(adId) {
  const ad = ads.find((a) => a.id === adId);
  if (!ad || ad.status !== "pending_retry") {
    console.log(`⚠️ Ad ${adId} not found or not in retry status`);
    return;
  }

  // Check retry limit (max 3 retries)
  if (ad.retryCount >= 3) {
    console.log(`❌ Ad ${adId} exceeded retry limit (3 attempts)`);
    ad.status = "failed";
    ad.aiReason = "Failed after 3 retry attempts";
    saveAds();
    return;
  }

  console.log(
    `🔄 Retrying AI processing for ad ${adId} (attempt ${ad.retryCount + 1}/3)`,
  );

  try {
    const earlyTargetWebsite = detectTargetWebsiteEarly(ad.text || "");
    const aiResult = await processMessage(ad.text, {
      targetWebsite: earlyTargetWebsite,
    });

    if (aiResult.isAd) {
      const retryQuickCategory = quickDetectCategory(ad.text);
      const retryCategoryForLimit = resolveCategoryForLimit(
        aiResult,
        retryQuickCategory,
      );

      if (
        retryCategoryForLimit &&
        isCategoryLimitReached(retryCategoryForLimit)
      ) {
        const idx = ads.findIndex((a) => a.id === adId);
        if (idx !== -1) {
          const recycleBinItem = {
            id: `rb_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
            text: ad.text,
            enhancedText: ad.enhancedText,
            fromGroup: ad.fromGroup,
            fromGroupName: ad.fromGroupName,
            author: ad.author,
            senderName: ad.senderName,
            senderPhone: ad.senderPhone,
            rejectedAt: Date.now(),
            aiConfidence: aiResult.confidence,
            aiReason: `Category limit reached: ${retryCategoryForLimit}`,
            category: retryCategoryForLimit,
            blockReason: "category_limit_reached_retry",
            originalAdId: ad.id,
            imageUrl: ad.imageUrl || null,
            rawAiResponse: aiResult.rawAiResponse || null,
            sanitizationSteps: Array.isArray(aiResult.sanitizationSteps)
              ? aiResult.sanitizationSteps
              : [],
          };

          recycleBin.unshift(recycleBinItem);
          if (recycleBin.length > 500) recycleBin = recycleBin.slice(0, 500);
          saveRecycleBin();

          ads.splice(idx, 1);
          saveAds();
          console.log(
            `🗑️ Ad ${adId} moved to recycle bin after retry (category limit reached)`,
          );
        }
        return;
      }

      // Update ad with AI results
      ad.enhancedText = aiResult.enhancedText;
      ad.aiConfidence = aiResult.confidence;
      ad.aiReason = aiResult.reason;
      ad.improvements = aiResult.improvements || [];
      ad.category = retryCategoryForLimit || aiResult.category || null;
      ad.meta = aiResult.meta || {};
      ad.wpData = aiResult.wpData || null;
      ad.whatsappMessage = aiResult.whatsappMessage || null;
      ad.rawAiResponse = aiResult.rawAiResponse || null;
      ad.sanitizationSteps = Array.isArray(aiResult.sanitizationSteps)
        ? aiResult.sanitizationSteps
        : [];
      ad.status = "new"; // Change status to new
      ad.retryCount = (ad.retryCount || 0) + 1;
      ad.lastRetryAt = Date.now();

      saveAds();
      console.log(`✅ Ad ${adId} processed successfully after retry`);
    } else {
      // Not an ad, move to recycle bin
      const idx = ads.findIndex((a) => a.id === adId);
      if (idx !== -1) {
        const recycleBinItem = {
          id: `rb_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
          text: ad.text,
          enhancedText: ad.enhancedText,
          fromGroup: ad.fromGroup,
          fromGroupName: ad.fromGroupName,
          author: ad.author,
          rejectedAt: Date.now(),
          aiConfidence: aiResult.confidence,
          aiReason: aiResult.reason,
          originalAdId: ad.id,
          rawAiResponse: aiResult.rawAiResponse || null,
          sanitizationSteps: Array.isArray(aiResult.sanitizationSteps)
            ? aiResult.sanitizationSteps
            : [],
        };

        recycleBin.unshift(recycleBinItem);
        if (recycleBin.length > 500) recycleBin = recycleBin.slice(0, 500);
        saveRecycleBin();

        ads.splice(idx, 1);
        saveAds();

        console.log(
          `🗑️ Ad ${adId} moved to recycle bin after retry (not an ad)`,
        );
      }
    }
  } catch (error) {
    console.error(`❌ Retry failed for ad ${adId}:`, error);

    ad.retryCount = (ad.retryCount || 0) + 1;
    ad.lastRetryAt = Date.now();

    const errorMessage = error.message || error.toString();
    const isOverloadError =
      error.status === 503 ||
      errorMessage.includes("overloaded") ||
      errorMessage.includes("503");

    if (isOverloadError && ad.retryCount < 3) {
      // Schedule another retry after longer delay (exponential backoff)
      const delayMinutes = Math.pow(2, ad.retryCount) * 5; // 10, 20, 40 minutes
      console.log(
        `⏳ Scheduling retry ${ad.retryCount + 1} after ${delayMinutes} minutes`,
      );
      setTimeout(() => retryFailedAd(adId), delayMinutes * 60 * 1000);
    } else {
      ad.status = "failed";
      ad.aiReason = `Failed after ${ad.retryCount} retry attempts`;
    }

    saveAds();
  }
}

// Auto-retry all pending ads on startup
function retryPendingAds() {
  const pendingAds = ads.filter((a) => a.status === "pending_retry");

  if (pendingAds.length > 0) {
    console.log(
      `🔄 Found ${pendingAds.length} ads pending retry. Starting retry process...`,
    );

    // Stagger retries to avoid overwhelming the API
    pendingAds.forEach((ad, index) => {
      setTimeout(() => {
        retryFailedAd(ad.id);
      }, index * 10000); // 10 seconds apart
    });
  }
}

function getAdById(id) {
  return ads.find((a) => a.id === id);
}

async function resendAd(id, targetGroups = []) {
  const ad = ads.find((a) => a.id === id);
  if (!ad) throw new Error("Ad not found");

  // Use enhanced text if available, otherwise use original
  const textToSend = ad.enhancedText || ad.text;

  // Build message template
  const message = `📢 *Repost from ${
    ad.fromGroupName || ad.fromGroup
  }*\n\n${textToSend}`;

  const results = [];
  for (const groupJid of targetGroups) {
    try {
      // ensure jid format for groups (they usually already end with @g.us)
      const jid = groupJid.includes("@") ? groupJid : `${groupJid}@g.us`;
      await sendMessage(jid, message);
      results.push({ group: jid, ok: true });
    } catch (err) {
      results.push({ group: groupJid, ok: false, error: err.message });
    }
  }

  // Optionally mark as posted
  ad.status = "posted";
  saveAds();

  return results;
}

function getSeenGroups() {
  // return as array
  return Array.from(seenGroups);
}

async function getGroupsWithMetadata(forceRefresh = false) {
  // Return ALL groups with type information (Group vs Community)
  const groupsList = [];

  // If force refresh, fetch all groups directly from WhatsApp
  if (forceRefresh && sock && connectionStatus === "connected") {
    try {
      console.log("🔄 Force refreshing groups from WhatsApp...");

      // Fetch all groups the bot is part of
      const groups = await sock.groupFetchAllParticipating();

      console.log(`📊 Raw groups fetched: ${Object.keys(groups).length}`);

      // Clear and rebuild metadata for ALL groups (no filtering)
      groupsMetadata = {};
      // Clear seenGroups and rebuild from fresh data
      seenGroups.clear();

      for (const groupId in groups) {
        const group = groups[groupId];

        // Determine if it's a group or community
        const isCommunity =
          groupId.includes("@broadcast") || group.isCommunity || false;
        const groupType = isCommunity ? "Community" : "Group";

        // Add ALL groups to metadata (no filtering by send permission)
        groupsMetadata[groupId] = {
          jid: groupId,
          name: group.subject || groupId,
          type: groupType,
          isCommunity: isCommunity,
        };

        // IMPORTANT: Add to seenGroups so they persist
        seenGroups.add(groupId);

        groupsList.push(groupsMetadata[groupId]);
      }

      console.log(
        `✅ Found and saved ${groupsList.length} groups/communities total`,
      );
      console.log(`✅ seenGroups now has ${seenGroups.size} groups`);
      console.log(
        `✅ groupsMetadata now has ${Object.keys(groupsMetadata).length} groups`,
      );

      return groupsList;
    } catch (err) {
      console.error("❌ Error fetching groups from WhatsApp:", err);
      // Fall through to normal logic if refresh fails
    }
  }

  // Normal logic: use cached data, return ALL groups without fetching metadata individually
  // This is optimized to avoid timeout issues
  console.log(
    `📋 Normal fetch - seenGroups size: ${
      seenGroups.size
    }, groupsMetadata keys: ${Object.keys(groupsMetadata).length}`,
  );

  for (const jid of seenGroups) {
    if (groupsMetadata[jid]) {
      groupsList.push(groupsMetadata[jid]);
    } else {
      // Don't fetch metadata individually - use fallback immediately to avoid timeout
      groupsList.push({
        jid,
        name: jid,
        type: "Group",
        isCommunity: false,
      });
    }
  }

  console.log(`✅ Returning ${groupsList.length} groups from cache`);
  return groupsList;
}

// Helper function to check if bot can send messages in a group// Helper function to check if bot can send messages in a group
async function canSendInGroup(groupId, groupMetadata = null) {
  try {
    if (!sock || connectionStatus !== "connected") {
      return true; // Default to true if not connected
    }

    // Get full metadata if not provided
    let metadata = groupMetadata;
    if (!metadata || !metadata.participants) {
      metadata = await sock.groupMetadata(groupId).catch(() => null);
    }

    if (!metadata) {
      return true; // If we can't get metadata, assume we can send
    }

    // Get bot's phone number
    const botNumber = sock.user?.id?.split(":")[0] || sock.user?.id;
    if (!botNumber) {
      return true;
    }

    // Find bot in participants
    const botParticipant = metadata.participants?.find(
      (p) => p.id.includes(botNumber) || p.id.split("@")[0] === botNumber,
    );

    if (!botParticipant) {
      return false; // Bot is not a participant
    }

    // Check group settings
    const announce = metadata.announce; // true = only admins can send messages

    if (!announce) {
      // Group is open, anyone can send
      return true;
    }

    // Group is announcement-only, check if bot is admin
    const isAdmin =
      botParticipant.admin === "admin" || botParticipant.admin === "superadmin";

    return isAdmin;
  } catch (err) {
    console.error(`Error checking send permission for group ${groupId}:`, err);
    return true; // Default to true on error
  }
}

function getCollections() {
  console.log(
    `📦 getCollections() called - returning ${collections.length} collections`,
  );
  return collections;
}

function saveCollection(name, groupIds) {
  const existing = collections.findIndex((c) => c.name === name);
  const collection = {
    id: existing >= 0 ? collections[existing].id : `col_${Date.now()}`,
    name,
    groups: groupIds,
    createdAt: existing >= 0 ? collections[existing].createdAt : Date.now(),
    updatedAt: Date.now(),
  };

  if (existing >= 0) {
    collections[existing] = collection;
  } else {
    collections.push(collection);
  }

  saveCollections();
  return collection;
}

function updateCollection(collectionId, name, groupIds) {
  const idx = collections.findIndex((c) => c.id === collectionId);
  if (idx === -1) return null;

  collections[idx] = {
    ...collections[idx],
    name,
    groups: groupIds,
    updatedAt: Date.now(),
  };

  saveCollections();
  return collections[idx];
}

function deleteCollection(id) {
  const idx = collections.findIndex((c) => c.id === id);
  if (idx === -1) return false;
  collections.splice(idx, 1);
  saveCollections();
  return true;
}

function getCategories() {
  return categories;
}

function saveCategory(name, color) {
  const existing = categories.findIndex((c) => c.name === name);
  if (existing >= 0) {
    categories[existing].color = color || categories[existing].color;
    saveCategories();
    return categories[existing];
  }

  const category = {
    id: `cat_${Date.now()}`,
    name,
    color: color || "#9b59b6",
  };

  categories.push(category);
  saveCategories();
  return category;
}

function updateCategory(categoryId, name, color) {
  const idx = categories.findIndex((c) => c.id === categoryId);
  if (idx === -1) return null;

  categories[idx] = {
    ...categories[idx],
    name,
    color: color || categories[idx].color,
  };

  saveCategories();
  return categories[idx];
}

function deleteCategory(id) {
  const idx = categories.findIndex((c) => c.id === id);
  if (idx === -1) return false;
  categories.splice(idx, 1);
  saveCategories();
  return true;
}

// ============ Recycle Bin Functions ============

function getRecycleBin() {
  console.log(
    "📋 getRecycleBin() called - returning",
    recycleBin.length,
    "items",
  );
  return recycleBin;
}

function restoreFromRecycleBin(id) {
  const idx = recycleBin.findIndex((item) => item.id === id);
  if (idx === -1) {
    return { success: false, error: "Item not found" };
  }

  const item = recycleBin[idx];

  // Restore ALL ad data that was saved
  const ad = {
    id:
      item.originalAdId ||
      `ad_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
    // Basic info
    text: item.text,
    originalText: item.originalText || item.text,
    enhancedText: item.enhancedText,
    fromGroup: item.fromGroup,
    fromGroupName: item.fromGroupName,
    author: item.author,
    senderName: item.senderName,
    senderPhone: item.senderPhone,
    // Status
    status: "new", // Restore as new so it can be processed again
    timestamp: item.originalTimestamp || Date.now(),
    isEdited: false,
    // AI data
    aiConfidence: item.aiConfidence,
    aiReason: "تم استعادته من سلة المحذوفات / Restored from recycle bin",
    // AI-generated data (restore if available)
    wpData: item.wpData || null,
    whatsappMessage: item.whatsappMessage || null,
    rawAiResponse: item.rawAiResponse || null,
    sanitizationSteps: Array.isArray(item.sanitizationSteps)
      ? item.sanitizationSteps
      : [],
    category: item.category || null,
    meta: item.meta || {},
    improvements: item.improvements || [],
    // WordPress data
    wordpressPostId: item.wordpressPostId || null,
    wordpressUrl: item.wordpressUrl || null,
    wordpressFullUrl: item.wordpressFullUrl || null,
    wordpressPostedAt: item.wordpressPostedAt || null,
    targetWebsite: item.targetWebsite || null,
    // Image data
    imageUrl: item.imageUrl || null,
    messageKey: item.messageKey || null,
  };

  // Add to ads
  ads.unshift(ad);
  saveAds();

  // Remove from recycle bin
  recycleBin.splice(idx, 1);
  saveRecycleBin();

  console.log(
    `♻️ Ad restored from recycle bin: ${
      ad.id
    } with all data (wpData: ${!!item.wpData}, imageUrl: ${!!item.imageUrl})`,
  );
  return { success: true, ad };
}

function deleteFromRecycleBin(id) {
  const idx = recycleBin.findIndex((item) => item.id === id);
  if (idx === -1) return false;

  recycleBin.splice(idx, 1);
  saveRecycleBin();
  return true;
}

function emptyRecycleBin() {
  recycleBin = [];
  saveRecycleBin();
}

// ============ Settings Functions ============

function getSettings() {
  return settings;
}

function updateSettings(newSettings) {
  const updates = { ...(newSettings || {}) };

  if (Object.prototype.hasOwnProperty.call(updates, "excludedGroups")) {
    updates.excludedGroups = normalizeGroupSelection(updates.excludedGroups);
  }

  if (
    Object.prototype.hasOwnProperty.call(updates, "autoApproveWordPressGroups")
  ) {
    updates.autoApproveWordPressGroups = normalizeGroupSelection(
      updates.autoApproveWordPressGroups,
    );
  }

  if (Object.prototype.hasOwnProperty.call(updates, "wpBeforeCityOptions")) {
    updates.wpBeforeCityOptions = normalizeSmartLocationOptions(
      updates.wpBeforeCityOptions,
      settings.wpBeforeCityOptions || DEFAULT_WP_BEFORE_CITY_OPTIONS,
    );
  }

  if (Object.prototype.hasOwnProperty.call(updates, "wpCityOptions")) {
    updates.wpCityOptions = normalizeSmartLocationOptions(
      updates.wpCityOptions,
      settings.wpCityOptions || DEFAULT_WP_CITY_OPTIONS,
    );
  }

  Object.assign(settings, updates);
  normalizeSettingsForCompatibility();
  saveSettings();
}

/**
 * Reload ads from file (for when ads are added externally)
 */
function reloadAds() {
  try {
    // Always read fresh data from shared folder
    ads = dataSync.readDataSync("ADS", []);
    collections = dataSync.readDataSync("COLLECTIONS", []);
    categories = dataSync.readDataSync("CATEGORIES", []);
    settings = dataSync.readDataSync("SETTINGS", {
      recycleBinDays: 7,
      excludedGroups: [],
      autoApproveWordPressGroups: [],
      requestMatchingEnabled: true,
      wpBeforeCityOptions: [...DEFAULT_WP_BEFORE_CITY_OPTIONS],
      wpCityOptions: [...DEFAULT_WP_CITY_OPTIONS],
    });
    let sanitizedAdsCount = 0;
    ads = ads.map((ad) => {
      const result = sanitizeStoredAdWordPressData(ad);
      if (result.changed) {
        sanitizedAdsCount += 1;
      }
      return result.ad;
    });

    normalizeSettingsForCompatibility();

    if (sanitizedAdsCount > 0) {
      saveAds();
    }

    console.log(`🔄 Reloaded ${ads.length} ads from file`);
    return true;
  } catch (err) {
    console.error("Failed to reload ads:", err);
    return false;
  }
}

/**
 * Remove image from an ad
 * @param {string} adId - The ad ID
 * @returns {boolean} - true if removed successfully
 */
function removeAdImage(adId) {
  const adIndex = ads.findIndex((a) => a.id === adId);
  if (adIndex === -1) {
    console.error(`❌ Ad not found: ${adId}`);
    return false;
  }

  ads[adIndex].imageUrl = null;
  saveAds();
  console.log(`✅ Removed image from ad: ${adId}`);
  return true;
}

module.exports = {
  initializeBot,
  getQRCode,
  getConnectionStatus,
  disconnectBot,
  sendMessage,
  sendImage,
  // ads API
  getFetchedAds,
  reloadAds,
  updateAdStatus,
  updateAdCategory,
  updateAdText,
  updateAdEnhancedText,
  updateAdWordPressData,
  getAdById,
  resendAd,
  removeAdImage,
  moveAdToRecycleBin,
  getSeenGroups,
  getGroupsWithMetadata,
  // collections API
  getCollections,
  saveCollection,
  updateCollection,
  deleteCollection,
  // categories API
  getCategories,
  saveCategory,
  updateCategory,
  deleteCategory,
  // recycle bin API
  getRecycleBin,
  restoreFromRecycleBin,
  deleteFromRecycleBin,
  emptyRecycleBin,
  // settings API
  getSettings,
  updateSettings,
  // Export ads for admin commands
  ads,
};
