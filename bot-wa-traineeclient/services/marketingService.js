/**
 * Marketing Service
 * Smart conversational system to collect user requirements and show relevant ads
 * Now uses the new custom search API instead of local ads.json
 */

const userSession = require("../models/userSession");
const masaakSearchService = require("./masaakSearchService");
const fs = require("fs");
const path = require("path");

const { getDataPath } = require("../config/dataPath");

const ADS_FILE = getDataPath("ads.json");

// Property types mapping (Arabic) - matches categories.json
// NOTE: Order matters! Check longer phrases before shorter ones
const PROPERTY_TYPES = [
  // Multi-word types FIRST (to match before single words)
  "شقة دبلكسية",
  "محل تجاري",
  "محطة بنزين",
  "محطة وقود",

  // Real estate types (singular and plural)
  "أرض",
  "ارض",
  "أراضي",
  "اراضي",
  "قطعة",
  "قطعه",
  "قطع",
  "بيت",
  "بيوت",
  "منزل",
  "منازل",
  "دار",
  "ديار",
  "شقة",
  "شقه",
  "شقق",
  "دبلكس",
  "دوبلكس",
  "عمارة",
  "عماره",
  "عمارات",
  "بناية",
  "فيلا",
  "فيله",
  "فلل",
  "فيلات",
  "قصر",
  "قصور",

  // Recreational
  "استراحة",
  "استراحه",
  "اسراحة",
  "شالية",
  "شاليه",

  // Commercial
  "محل",
  "دكان",
  "مكتب",
  "معرض",
  "محطه",

  // Industrial/Agricultural
  "مستودع",
  "مخزن",
  "مزرعة",
  "مزرعه",
  "مرعى",

  // Services
  "خدمات",
  "خدمة",
  "خدمه",
  "وظائف",
  "وظيفة",
  "وظيفه",
  "طلبات",
  "طلب",
  "فعاليات",
  "فعالية",
  "فعاليه",
];

// Property type synonyms with Saudi dialect - map ALL variations to standard types
const PROPERTY_SYNONYMS = {
  // بيت variations (singular and plural)
  منزل: "بيت",
  بيت: "بيت",
  دار: "بيت",
  بيوت: "بيت",
  منازل: "بيت",
  ديار: "بيت",

  // شقة variations (singular and plural)
  شقة: "شقة",
  شقه: "شقة",
  شقق: "شقة",
  شقتين: "شقة",

  // شقة دبلكسية
  "شقة دبلكسية": "شقة دبلكسية",
  "شقة دبلكس": "شقة دبلكسية",
  "شقه دبلكس": "شقة دبلكسية",

  // دبلكس variations
  دبلكس: "دبلكس",
  دوبلكس: "دبلكس",
  دوبليكس: "دبلكس",
  دبلوكس: "دبلكس",

  // فيلا variations (singular and plural)
  فيلا: "فيلا",
  فيله: "فيلا",
  فلة: "فيلا",
  فله: "فيلا",
  قصر: "فيلا",
  فلل: "فيلا",
  فيلات: "فيلا",
  قصور: "فيلا",

  // عمارة variations (singular and plural)
  عمارة: "عمارة",
  عماره: "عمارة",
  بناية: "عمارة",
  بنايه: "عمارة",
  عمارات: "عمارة",
  مبنى: "عمارة",

  // أرض variations (singular and plural)
  أرض: "أرض",
  ارض: "أرض",
  ارضي: "أرض",
  ارضيه: "أرض",
  قطعة: "أرض",
  قطعه: "أرض",
  قطع: "أرض",
  اراضي: "أرض",
  أراضي: "أرض",

  // استراحة variations
  استراحة: "استراحة",
  استراحه: "استراحة",
  اسراحة: "استراحة",
  اسراحه: "استراحة",
  مقر: "استراحة",

  // شالية variations
  شالية: "شالية",
  شاليه: "شالية",
  شاليهات: "شالية",

  // محل variations
  محل: "محل تجاري",
  "محل تجاري": "محل تجاري",
  دكان: "محل تجاري",
  محلات: "محل تجاري",
  مكتب: "محل تجاري",
  معرض: "محل تجاري",

  // مستودع variations
  مستودع: "مستودع",
  مخزن: "مستودع",
  مستودعات: "مستودع",

  // مزرعة variations
  مزرعة: "مزرعة",
  مزرعه: "مزرعة",
  مرعى: "مزرعة",
  مزارع: "مزرعة",

  // محطة بنزين
  "محطة بنزين": "محطة بنزين",
  "محطة وقود": "محطة بنزين",
  محطه: "محطة بنزين",
  "محطه بنزين": "محطة بنزين",

  // Other categories
  خدمات: "خدمات",
  خدمة: "خدمات",
  خدمه: "خدمات",
  وظائف: "وظائف",
  وظيفة: "وظائف",
  وظيفه: "وظائف",
  طلبات: "طلبات",
  طلب: "طلبات",
  فعاليات: "فعاليات",
  فعالية: "فعاليات",
  فعاليه: "فعاليات",
};

/**
 * Check if two property types match (considering synonyms)
 */
function propertyTypesMatch(type1, type2) {
  if (!type1 || !type2) return false;

  const normalized1 =
    PROPERTY_SYNONYMS[type1.toLowerCase()] || type1.toLowerCase();
  const normalized2 =
    PROPERTY_SYNONYMS[type2.toLowerCase()] || type2.toLowerCase();

  return (
    normalized1 === normalized2 ||
    normalized1.includes(normalized2) ||
    normalized2.includes(normalized1)
  );
}

// Transaction types with Saudi dialect
const TRANSACTION_TYPES = [
  "بيع",
  "ابيع",
  "ابغى ابيع",
  "للبيع",
  "شراء",
  "شري",
  "اشتري",
  "اشري",
  "ابغى اشتري",
  "ابي اشتري",
  "إيجار",
  "ايجار",
  "تأجير",
  "تاجير",
  "للإيجار",
  " للإيجار",
  "استئجار",
  "استاجر",
  "اجر",
  "أجر",
];

// Comprehensive Saudi dialect search keywords
const SEARCH_KEYWORDS = [
  // ابحث variations
  "ابحث",
  "أبحث",
  "بحث",
  "دور",
  "دوّر",
  "ادور",

  // ارسل/وريني (send/show me)
  "ارسل",
  "أرسل",
  "ارسل لي",
  "ارسلي",
  "وريني",
  "ورني",
  "اعطني",
  "أعطني",
  "اعرض",
  "اعرضلي",

  // ابي/ابغى (I want) - very common in Saudi
  "ابي",
  "ابى",
  "ابغى",
  "ابغا",
  "أبي",
  "أبغى",
  "ابغاه",

  // ودي (I wish) - Saudi dialect
  "ودي",
  "ودى",
  "وّدي",
  "ودني",

  // أريد variations
  "أريد",
  "اريد",
  "عايز",
  "عاوز",

  // محتاج (need)
  "محتاج",
  "محتاجة",
  "احتاج",

  // شراء keywords
  "اشتري",
  "اشري",
  "شراء",
  "شري",
  "اخذ",
  "آخذ",

  // بيع keywords
  "ابيع",
  "بيع",
  "اسوق",
  "اسوّق",

  // إيجار keywords
  "استأجر",
  "استاجر",
  "اجر",
  "أجر",
  "استاجره",

  // عرض keywords
  "عندي",
  "لدي",
  "معي",
  "متوفر",
  "موجود",

  // طلب keywords
  "اطلب",
  "طلب",
  "طالب",
  "مطلوب",

  // General
  "بغيت",
  "بغيته",
  "حاب",
  "حابب",
];

/**
 * Extract information from initial message using keywords (no AI needed)
 */
function extractInitialInfo(message) {
  const lowerMessage = message.toLowerCase();
  const extracted = {
    propertyType: null,
    transactionType: null,
    location: null,
    isSearching: false,
    priceMin: null,
    priceMax: null,
    areaMin: null,
    areaMax: null,
    contact: null,
    rooms: null,
  };

  // Check if it's a search request
  extracted.isSearching = SEARCH_KEYWORDS.some((keyword) =>
    lowerMessage.includes(keyword)
  );

  // Extract property type
  for (const type of PROPERTY_TYPES) {
    const lowerType = type.toLowerCase();

    // Create variations: original, with ه, without ة
    const variations = [lowerType];
    if (lowerType.endsWith("ة")) {
      variations.push(lowerType.slice(0, -1) + "ه"); // شقة -> شقه
      variations.push(lowerType.slice(0, -1)); // شقة -> شق (for شقه)
    }
    if (lowerType.endsWith("ه")) {
      variations.push(lowerType.slice(0, -1) + "ة"); // شقه -> شقة
    }

    // Check if any variation exists in message
    if (variations.some((v) => lowerMessage.includes(v))) {
      // Normalize to standard type (e.g., منزل -> بيت)
      extracted.propertyType = PROPERTY_SYNONYMS[type] || type;
      break;
    }
  }

  // Extract transaction type
  for (const type of TRANSACTION_TYPES) {
    if (lowerMessage.includes(type.toLowerCase())) {
      extracted.transactionType = type;
      break;
    }
  }

  // Extract location - comprehensive Saudi cities and patterns
  const locationPatterns = [
    // Major cities
    /(?:في|ب)\s+(الرياض|رياض|الريادh|جدة|جده|مكة|مكه|المكرمة|المدينة|المدينه|المنورة|الدمام|دمام|الخبر|خبر|الجبيل|جبيل|الأحساء|احساء|الهفوف|هفوف|القطيف|قطيف|حفر الباطن|حفرالباطن)/gi,
    // Western region
    /(?:في|ب)\s+(الطائف|طائف|ينبع|ينبوع|رابغ|رابغه|الليث|القنفذة|قنفذة|الباحة|باحة|بلجرشي)/gi,
    // Southern region
    /(?:في|ب)\s+(أبها|ابها|خميس مشيط|خميس|جيزان|جازان|نجران|نجران|بيشة|بيشه|الباحة)/gi,
    // Northern region
    /(?:في|ب)\s+(تبوك|تبوك|حائل|حايل|عرعر|عرعر|سكاكا|الجوف|جوف|القريات|قريات)/gi,
    // Eastern region
    /(?:في|ب)\s+(القرى|قرى|المبرز|مبرز|عين موسى|عين موسي|الضاحية|ضاحية|الهفوف|هفوف)/gi,
    // Riyadh neighborhoods
    /(?:في|ب)\s*(?:حي)?\s*(العليا|عليا|الملز|ملز|النخيل|نخيل|الروضة|روضة|الياسمين|ياسمين|النرجس|نرجس|الورود|ورود|الربيع|ربيع|المروج|مروج|الملقا|ملقا|الصحافة|صحافة|النسيم|نسيم|العريجاء|عريجاء|السويدي|سويدي|شبرا|الشفا|شفا|الدرعية|درعية)/gi,
    // Jeddah neighborhoods
    /(?:في|ب)\s*(?:حي)?\s*(الحمراء|حمراء|الروضة|روضة|الصفا|صفا|المروة|مروة|الشاطئ|شاطي|البلد|بلد|الكورنيش|كورنيش|الفيصلية|فيصلية|الخالدية|خالدية|السلامة|سلامة|النعيم|نعيم|الربوة|ربوة|أبحر|ابحر|الزهراء|زهراء|البساتين|بساتين)/gi,
    // Generic neighborhood pattern
    /(?:في|ب)\s+حي\s+([^\d\s]+(?:\s+[^\d\s]+)?)/gi,
    // Fallback - anything after في or ب before numbers
    /(?:في|ب)\s+([^\d]+?)(?:\s+\d|\s*$)/gi,
  ];

  for (const pattern of locationPatterns) {
    const matches = [...message.matchAll(pattern)];
    if (matches.length > 0) {
      extracted.location = matches[0][1].trim().replace(/\s+/g, " ");
      break;
    }
  }

  // Extract price - multiple patterns
  const pricePatterns = [
    /(\d+(?:,\d+)*)\s*(?:ألف|الف|k)/gi, // 500 ألف
    /(\d+(?:,\d+)*)\s*(?:مليون|ملیون)/gi, // 2 مليون
    /(\d{5,}(?:,\d+)*)/g, // 500000 or 500,000 (at least 5 digits to avoid "400 ريال")
  ];

  for (const pattern of pricePatterns) {
    const match = message.match(pattern);
    if (match) {
      let price = match[0].replace(/,/g, "");

      // Convert ألف to thousands
      if (/ألف|الف|k/i.test(match[0])) {
        price = parseInt(price.replace(/\D/g, "")) * 1000;
      }
      // Convert مليون to millions
      else if (/مليون|ملیون/i.test(match[0])) {
        price = parseInt(price.replace(/\D/g, "")) * 1000000;
      } else {
        price = parseInt(price);
      }

      // Only set price if it's realistic for real estate (>= 50,000)
      if (price >= 50000) {
        // Set as max price by default (assume "up to X")
        if (!extracted.priceMax || price > extracted.priceMax) {
          extracted.priceMax = price;
        }
      }
      break;
    }
  }

  // Extract number of rooms
  const roomsMatch = message.match(/(\d+)\s*(?:غرف|غرفة)/i);
  if (roomsMatch) {
    extracted.rooms = parseInt(roomsMatch[1]);
  }

  // Extract area
  const areaPatterns = [/(\d+)\s*(?:متر|م²|م)/i];

  for (const pattern of areaPatterns) {
    const match = message.match(pattern);
    if (match) {
      const area = parseInt(match[1]);
      if (!extracted.areaMax || area > extracted.areaMax) {
        extracted.areaMax = area;
      }
      break;
    }
  }

  // Extract phone number
  const phoneMatch = message.match(/05\d{8}/);
  if (phoneMatch) {
    extracted.contact = phoneMatch[0];
  }

  return extracted;
}

/**
 * Generate next question based on missing information
 */
function generateNextQuestion(session, userName) {
  const data = session.data;
  const asked = session.questionsAsked;

  // Question priority order - shorter versions without greeting
  const questions = [
    {
      key: "propertyType",
      condition: !data.propertyType,
      text: `ما نوع العقار الذي تبحث عنه؟\nمثال: شقة، فيلا، أرض، محل تجاري، بيت، إلخ...`,
    },
    {
      key: "location",
      condition: !data.location,
      text: `في أي منطقة أو حي تفضل؟\nمثال: الرياض، جدة، حي العزيزية، حي النهضة، إلخ...`,
    },
    {
      key: "transactionType",
      condition: !data.transactionType,
      text: `هل تبحث عن:\n• بيع (للشراء)\n• إيجار (للاستئجار)`,
    },
    {
      key: "priceRange",
      condition: !data.priceMin && !data.priceMax,
      text: `ما هو نطاق السعر المناسب لك؟ 💰\nمثال:\n• 500 ألف\n• من 500 ألف إلى 700 ألف\n• حتى مليون`,
    },
    {
      key: "area",
      condition:
        !data.areaMin &&
        !data.areaMax &&
        data.propertyType !== "محل" &&
        data.propertyType !== "محل تجاري",
      text: `ما المساحة التقريبية التي تفضلها؟ 📐\nمثال: 200 متر، من 150 إلى 250 متر`,
    },
    {
      key: "additionalDetails",
      condition: !data.additionalDetails, // Only check if not already asked
      text: data.rooms
        ? `لديك أي متطلبات إضافية؟ ✨\nمثال: مواقف السيارات، قريب من الخدمات، دور معين\n\nأو اكتب "لا" للبحث الآن`
        : `هل لديك أي متطلبات إضافية؟ ✨\nمثال: عدد الغرف، مواقف السيارات، قريب من الخدمات\n\nأو اكتب "لا" للبحث الآن`,
    },
  ];

  // Find first unanswered question
  for (const q of questions) {
    if (q.condition && !asked.includes(q.key)) {
      return { key: q.key, text: q.text };
    }
  }

  return null; // All questions answered
}

/**
 * Process user's answer to current question
 * Returns: { valid: boolean, errorMessage: string|null }
 */
function processAnswer(session, answer) {
  const currentQuestion = session.currentQuestion;
  const lowerAnswer = answer.toLowerCase();

  if (!currentQuestion) return { valid: true };

  switch (currentQuestion) {
    case "propertyType":
      // Extract property type from answer
      let foundType = false;
      for (const type of PROPERTY_TYPES) {
        if (lowerAnswer.includes(type.toLowerCase())) {
          session.data.propertyType = type;
          foundType = true;
          break;
        }
      }

      if (!foundType) {
        return {
          valid: false,
          errorMessage:
            "عذراً، لم أفهم نوع العقار 🤔\n\nالرجاء اختيار من الأنواع التالية:\n• شقة\n• بيت / منزل\n• فيلا\n• أرض\n• محل تجاري\n• عمارة\n• استراحة\n• مزرعة\n\nمثال: شقة",
        };
      }
      break;

    case "location":
      // Clean up location (remove common words)
      let location = answer.replace(/حي|في|ب|منطقة/gi, "").trim();

      if (!location || location.length < 2) {
        return {
          valid: false,
          errorMessage:
            "عذراً، لم أفهم الموقع 🤔\n\nالرجاء كتابة اسم المدينة أو الحي:\n\nأمثلة:\n• الرياض\n• جدة\n• حي العليا\n• حي الملز\n• الخبر",
        };
      }

      session.data.location = location;
      break;

    case "transactionType":
      // Detect transaction type
      if (lowerAnswer.includes("بيع") || lowerAnswer.includes("شراء")) {
        session.data.transactionType = "بيع";
      } else if (
        lowerAnswer.includes("إيجار") ||
        lowerAnswer.includes("ايجار") ||
        lowerAnswer.includes("استئجار")
      ) {
        session.data.transactionType = "إيجار";
      } else {
        return {
          valid: false,
          errorMessage:
            "عذراً، لم أفهم نوع المعاملة 🤔\n\nالرجاء الاختيار:\n• بيع (للشراء)\n• إيجار (للاستئجار)\n\nمثال: بيع",
        };
      }
      break;

    case "priceRange":
      // Extract price range using patterns
      const pricePatterns = [
        /(\d+(?:,\d+)*)\s*(?:إلى|الى|-)\s*(\d+(?:,\d+)*)/, // from X to Y
        /(?:حتى|اقل من|أقل من)\s*(\d+(?:,\d+)*)/, // up to X
        /(?:أكثر من|اكثر من|فوق)\s*(\d+(?:,\d+)*)/, // more than X
        /(\d+(?:,\d+)*)/, // single number
      ];

      let foundPrice = false;
      for (const pattern of pricePatterns) {
        const match = answer.match(pattern);
        if (match) {
          let priceMin = null;
          let priceMax = null;

          if (match[2]) {
            // Range: from X to Y
            priceMin = parseInt(match[1].replace(/,/g, ""));
            priceMax = parseInt(match[2].replace(/,/g, ""));
          } else if (
            lowerAnswer.includes("حتى") ||
            lowerAnswer.includes("اقل") ||
            lowerAnswer.includes("أقل")
          ) {
            // Up to X
            priceMax = parseInt(match[1].replace(/,/g, ""));
          } else if (
            lowerAnswer.includes("أكثر") ||
            lowerAnswer.includes("اكثر") ||
            lowerAnswer.includes("فوق")
          ) {
            // More than X
            priceMin = parseInt(match[1].replace(/,/g, ""));
          } else {
            // Single number - assume it's max
            priceMax = parseInt(match[1].replace(/,/g, ""));
          }

          // Check for "ألف" (thousands) or "مليون" (millions) multipliers
          if (/ألف|الف|k/i.test(answer)) {
            if (priceMin) priceMin *= 1000;
            if (priceMax) priceMax *= 1000;
          } else if (/مليون|ملیون/i.test(answer)) {
            if (priceMin) priceMin *= 1000000;
            if (priceMax) priceMax *= 1000000;
          }

          // Validate realistic price (at least 10,000 for real estate)
          if (
            (priceMin && priceMin >= 10000) ||
            (priceMax && priceMax >= 10000)
          ) {
            // Set the values
            if (priceMin) session.data.priceMin = priceMin;
            if (priceMax) session.data.priceMax = priceMax;
            foundPrice = true;
          }

          break;
        }
      }

      if (!foundPrice) {
        return {
          valid: false,
          errorMessage:
            "عذراً، لم أفهم نطاق السعر 🤔\n\nالرجاء كتابة السعر بالريال:\n\nأمثلة:\n• 500 ألف\n• 800000\n• من 500 ألف إلى 700 ألف\n• حتى مليون\n• أكثر من 300 ألف",
        };
      }
      break;
    case "area":
      // Extract area using similar logic to price
      const areaPatterns = [
        /(\d+(?:,\d+)*)\s*(?:إلى|الى|-)\s*(\d+(?:,\d+)*)/,
        /(?:حتى|اقل من|أقل من)\s*(\d+(?:,\d+)*)/,
        /(?:أكثر من|اكثر من|فوق)\s*(\d+(?:,\d+)*)/,
        /(\d+(?:,\d+)*)/,
      ];

      let foundArea = false;
      for (const pattern of areaPatterns) {
        const match = answer.match(pattern);
        if (match) {
          let areaMin = null;
          let areaMax = null;

          if (match[2]) {
            areaMin = parseInt(match[1].replace(/,/g, ""));
            areaMax = parseInt(match[2].replace(/,/g, ""));
          } else if (
            lowerAnswer.includes("حتى") ||
            lowerAnswer.includes("اقل") ||
            lowerAnswer.includes("أقل")
          ) {
            areaMax = parseInt(match[1].replace(/,/g, ""));
          } else if (
            lowerAnswer.includes("أكثر") ||
            lowerAnswer.includes("اكثر") ||
            lowerAnswer.includes("فوق")
          ) {
            areaMin = parseInt(match[1].replace(/,/g, ""));
          } else {
            areaMax = parseInt(match[1].replace(/,/g, ""));
          }

          // Validate realistic area (10 to 100,000 square meters)
          if (
            (areaMin && areaMin >= 10 && areaMin <= 100000) ||
            (areaMax && areaMax >= 10 && areaMax <= 100000)
          ) {
            if (areaMin) session.data.areaMin = areaMin;
            if (areaMax) session.data.areaMax = areaMax;
            foundArea = true;
          }

          break;
        }
      }

      if (!foundArea) {
        return {
          valid: false,
          errorMessage:
            "عذراً، لم أفهم المساحة 🤔\n\nالرجاء كتابة المساحة بالمتر المربع:\n\nأمثلة:\n• 200 متر\n• 150\n• من 200 إلى 300\n• حتى 500 متر",
        };
      }
      break;

    case "additionalDetails":
      // Check if user said no (various ways)
      const noVariations = [
        "لا",
        "no",
        "لا شكرا",
        "لا شكراً",
        "لاشكرا",
        "لاشكراً",
        "مافي",
        "ما فيه",
        "مافيه",
      ];
      const saidNo = noVariations.some((v) =>
        lowerAnswer.includes(v.toLowerCase())
      );

      if (saidNo) {
        session.data.additionalDetails = "none"; // Mark as answered with "none"
        console.log(`✅ User declined additional details`);
      } else {
        // Store the additional details
        session.data.additionalDetails = answer;
        console.log(`✅ Saved additional details: ${answer}`);

        // Try to extract rooms if not already set
        if (!session.data.rooms) {
          const roomsMatch = answer.match(/(\d+)\s*(?:غرف|غرفة|غرفه)/i);
          if (roomsMatch) {
            session.data.rooms = parseInt(roomsMatch[1]);
            console.log(
              `✅ Extracted ${session.data.rooms} rooms from additional details`
            );
          }
        }
      }
      break;
  }

  // Mark question as asked
  if (!session.questionsAsked.includes(currentQuestion)) {
    session.questionsAsked.push(currentQuestion);
  }

  return { valid: true }; // Successfully processed
}

/**
 * Search for matching ads using NEW CUSTOM API
 * Smart search with scoring and flexible matching
 * @param {Object} sessionData - User session data with search criteria
 * @returns {Promise<Array>} Array of matching ads
 */
async function searchAds(sessionData) {
  try {
    console.log(`🔍 Searching with NEW CUSTOM API`);
    console.log(`📊 Search criteria:`, JSON.stringify(sessionData, null, 2));

    // Map sessionData to API requirements format
    const requirements = {
      propertyType: sessionData.propertyType,
      location: sessionData.location,
      purpose: sessionData.transactionType,
      transactionType: sessionData.transactionType,
      priceMin: sessionData.priceMin || 0,
      priceMax: sessionData.priceMax || 10000000,
      areaMin: sessionData.areaMin || 0,
      areaMax: sessionData.areaMax || 100000,
      rooms: sessionData.rooms,
      contact: sessionData.contact,
    };

    // Use the new custom API
    const results = await masaakSearchService.searchWithRequirements(
      requirements
    );

    console.log(`✅ API returned ${results.length} results`);

    if (results.length === 0) {
      console.log("⚠️ No ads found matching criteria");
      return [];
    }

    // Convert API results to the expected ad format
    const ads = results.map((result) => {
      const apiData = result.apiData || {};
      return {
        id: result.id,
        title: apiData.title || "",
        text: apiData.excerpt || apiData.title || "",
        category: Array.isArray(apiData.type)
          ? apiData.type[0]
          : apiData.type || "",
        location: apiData.district || apiData.city || "",
        price: apiData.price?.value || 0,
        priceText: apiData.price?.text || "",
        area: apiData.area?.value || 0,
        areaText: apiData.area?.text || "",
        contact:
          apiData.phones && apiData.phones.length > 0
            ? apiData.phones[0]
            : null,
        imageUrl: apiData.thumbnail || null,
        link: apiData.link || "",
        timestamp: apiData.date ? new Date(apiData.date).getTime() : Date.now(),
        status: "approved", // API only returns approved ads
        wpData: {
          meta: result.meta || {},
        },
        apiData: apiData, // Keep original API data
      };
    });

    // Score and filter ads
    const scoredAds = ads.map((ad) => {
      let score = 50; // Base score for API matches (already filtered by API)
      let reasons = [];

      // Property type matching
      if (sessionData.propertyType) {
        const userType = sessionData.propertyType.toLowerCase();
        const adCategory = (ad.category || "").toLowerCase();

        if (adCategory.includes(userType) || userType.includes(adCategory)) {
          score += 30;
          reasons.push("✅ نوع العقار مطابق");
        }
      }

      // Transaction type bonus
      if (sessionData.transactionType) {
        const userTransaction = sessionData.transactionType.toLowerCase();
        const apiPurpose = ad.apiData?.purpose || [];
        const purposeText = Array.isArray(apiPurpose)
          ? apiPurpose.join(" ")
          : apiPurpose;

        if (userTransaction.includes("بيع") && purposeText.includes("بيع")) {
          score += 15;
          reasons.push("✅ للبيع");
        } else if (
          userTransaction.includes("إيجار") &&
          purposeText.includes("إيجار")
        ) {
          score += 15;
          reasons.push("✅ للإيجار");
        }
      }

      // Location matching
      if (sessionData.location) {
        const userLocation = sessionData.location.toLowerCase();
        const adLocation = (ad.location || "").toLowerCase();

        if (
          adLocation.includes(userLocation) ||
          userLocation.includes(adLocation)
        ) {
          score += 20;
          reasons.push(`✅ الموقع: ${ad.location}`);
        }
      }

      // Price range matching
      if (ad.price && ad.price > 0) {
        if (sessionData.priceMax && ad.price <= sessionData.priceMax) {
          score += 15;
          reasons.push("✅ السعر ضمن الميزانية");
        } else if (
          sessionData.priceMax &&
          ad.price <= sessionData.priceMax * 1.2
        ) {
          score += 7;
          reasons.push("⚠️ السعر أعلى قليلاً");
        }
      }

      // Area matching
      if (ad.area && ad.area > 0) {
        if (sessionData.areaMax && ad.area <= sessionData.areaMax) {
          score += 10;
          reasons.push("✅ المساحة مناسبة");
        }
      }

      // Bonus for having images
      if (ad.imageUrl) {
        score += 5;
        reasons.push("📷 يحتوي على صورة");
      }

      // Bonus for having contact info
      if (ad.contact) {
        score += 5;
        reasons.push("📞 يحتوي على رقم تواصل");
      }

      // Recency bonus
      if (ad.timestamp) {
        const daysSincePosted =
          (Date.now() - ad.timestamp) / (1000 * 60 * 60 * 24);
        if (daysSincePosted < 7) {
          score += 10;
          reasons.push("🆕 إعلان جديد");
        } else if (daysSincePosted < 30) {
          score += 5;
          reasons.push("📅 إعلان حديث");
        }
      }

      return { ad, score, reasons };
    });

    // Sort by score and return top results
    scoredAds.sort((a, b) => b.score - a.score);

    console.log(`\n📊 Search Results:`);
    scoredAds.slice(0, 5).forEach((item, i) => {
      console.log(`\n${i + 1}. Score: ${item.score}`);
      console.log(`   النوع: ${item.ad.category || "N/A"}`);
      console.log(`   الموقع: ${item.ad.location || "N/A"}`);
      console.log(`   السعر: ${item.ad.priceText || "N/A"}`);
      console.log(`   المساحة: ${item.ad.areaText || "N/A"}`);
      console.log(`   الأسباب: ${item.reasons.join(", ")}`);
    });

    // Return top 10 ads
    const topAds = scoredAds.slice(0, 10).map((item) => item.ad);
    console.log(`\n✅ Returning ${topAds.length} matching ads\n`);

    return topAds;
  } catch (err) {
    console.error("❌ Error searching ads with new API:", err);

    // Fallback to local ads.json if API fails
    console.log("⚠️ Falling back to local ads.json...");
    return searchAdsFromFile(sessionData);
  }
}

/**
 * FALLBACK: Search from local ads.json file (legacy method)
 * This is used only if the new API fails
 */
function searchAdsFromFile(sessionData) {
  try {
    if (!fs.existsSync(ADS_FILE)) {
      console.log("⚠️ Ads file not found");
      return [];
    }

    const adsRaw = fs.readFileSync(ADS_FILE, "utf8");
    const allAds = JSON.parse(adsRaw || "[]");

    console.log(`🔍 Searching in ${allAds.length} local ads (FALLBACK)`);

    // Filter and score ads (simplified version)
    let scoredAds = allAds
      .filter((ad) => {
        if (ad.status && ad.status === "rejected") return false;

        // Exclude requests
        const adCategory = (ad.category || "").toLowerCase();
        if (adCategory === "طلبات" || adCategory === "طلب") return false;

        return true;
      })
      .map((ad) => {
        let score = 50;
        let reasons = [];

        // Basic scoring
        if (
          sessionData.propertyType &&
          (ad.category || "")
            .toLowerCase()
            .includes(sessionData.propertyType.toLowerCase())
        ) {
          score += 30;
          reasons.push("✅ نوع مطابق");
        }

        if (
          sessionData.location &&
          (ad.location || "")
            .toLowerCase()
            .includes(sessionData.location.toLowerCase())
        ) {
          score += 20;
          reasons.push("✅ موقع مطابق");
        }

        return { ad, score, reasons };
      })
      .filter((item) => item.score > 50)
      .sort((a, b) => b.score - a.score);

    const topAds = scoredAds.slice(0, 10).map((item) => item.ad);
    console.log(
      `✅ Returning ${topAds.length} ads from local file (FALLBACK)\n`
    );

    return topAds;
  } catch (err) {
    console.error("❌ Error in fallback search:", err);
    return [];
  }
}

/**
 * Generate formatted results message with emojis
 */
function generateResultsMessage(ads, sessionData) {
  if (ads.length === 0) {
    let message = `عذراً 😔\n\nلم أجد أي عروض تطابق متطلباتك حالياً.\n\n`;

    // Show what we searched for
    message += `🔍 بحثت عن:\n`;
    if (sessionData.propertyType) message += `• ${sessionData.propertyType}\n`;
    if (sessionData.location) message += `• في ${sessionData.location}\n`;
    if (sessionData.priceMax)
      message += `• سعر: حتى ${sessionData.priceMax.toLocaleString()} ريال\n`;
    if (sessionData.areaMax)
      message += `• مساحة: حتى ${sessionData.areaMax} م²\n`;
    message += "\n";

    message += `💡 اقتراحات:\n`;
    if (sessionData.location) {
      message += `• جرب البحث في مناطق قريبة من ${sessionData.location}\n`;
    }
    if (sessionData.priceMax) {
      message += `• توسيع نطاق السعر (مثلاً: حتى ${(
        sessionData.priceMax * 1.5
      ).toLocaleString()} ريال)\n`;
    }
    if (sessionData.propertyType) {
      message += `• جرب نوع عقار آخر (فيلا، شقة، أرض، إلخ)\n`;
    }
    if (sessionData.areaMax || sessionData.areaMin) {
      message += `• تعديل المساحة المطلوبة\n`;
    }
    message += `\n📱 يمكنك تصفح جميع العروض على موقعنا:\n`;
    message += `🌐 https://masaak.com\n\n`;
    message += `أو أرسل "ابحث" لبدء بحث جديد! 🔍`;

    return message;
  }

  let message = `رائع! 🎉 وجدت ${ads.length} ${
    ads.length === 1 ? "عرض" : "عروض"
  } ${ads.length <= 10 ? "مناسبة" : "من أفضل العروض"} لك:\n\n`;
  message += `📍 البحث عن: ${sessionData.propertyType || "عقار"}`;

  if (sessionData.location) {
    message += ` في ${sessionData.location}`;
  }
  message += "\n";

  if (sessionData.priceMin || sessionData.priceMax) {
    message += `💰 السعر: `;
    if (sessionData.priceMin && sessionData.priceMax) {
      message += `${sessionData.priceMin.toLocaleString()} - ${sessionData.priceMax.toLocaleString()} ريال`;
    } else if (sessionData.priceMax) {
      message += `حتى ${sessionData.priceMax.toLocaleString()} ريال`;
    } else {
      message += `من ${sessionData.priceMin.toLocaleString()} ريال`;
    }
    message += "\n";
  }

  message += "\n━━━━━━━━━━━━━━━━━\n\n";

  // Add each ad with title and link only
  ads.forEach((ad, index) => {
    const emoji = getPropertyEmoji(ad.category);

    // Get title from WordPress data or generate from ad
    let title =
      ad.wpData?.title || ad.wpData?.meta?.main_ad || ad.category || "عقار";
    if (title.length > 60) {
      title = title.substring(0, 60) + "...";
    }

    message += `${emoji} *${index + 1}. ${title}*\n`;

    // Add WordPress URL or default website
    const wpUrl = ad.wordpressUrl || ad.wordpressFullUrl;
    if (wpUrl) {
      message += `� ${wpUrl}\n\n`;
    } else {
      message += `🔗 https://masaak.com\n\n`;
    }
  });

  message += `━━━━━━━━━━━━━━━━━\n\n`;
  message += `✨ نتمنى أن تجد ما يناسبك!\n`;
  message += `📱 للمزيد من المساعدة، اكتب "ابحث" لبدء بحث جديد\n\n`;
  message += `🌐 زر موقعنا: https://masaak.com`;

  return message;
}

/**
 * Get emoji for property type
 */
function getPropertyEmoji(category) {
  // Comprehensive emoji map for ALL categories from categories.json
  const emojiMap = {
    // Real estate
    أرض: "🏞️",
    ارض: "🏞️",
    بيت: "🏠",
    منزل: "🏠",
    دار: "🏠",
    شقة: "🏢",
    شقه: "🏢",
    "شقة دبلكسية": "🏬",
    دبلكس: "🏘️",
    دوبلكس: "🏘️",
    فيلا: "🏰",
    فيله: "🏰",
    قصر: "🏰",
    عمارة: "🏛️",
    عماره: "🏛️",
    بناية: "🏛️",

    // Recreational
    استراحة: "�️",
    استراحه: "🏕️",
    شالية: "�️",
    شاليه: "🏖️",

    // Commercial
    محل: "🏪",
    "محل تجاري": "🏬",
    دكان: "🏪",
    مكتب: "�",
    معرض: "�🏬",
    "محطة بنزين": "⛽",
    "محطة وقود": "⛽",
    محطه: "⛽",

    // Industrial
    مستودع: "🏭",
    مخزن: "🏭",

    // Agricultural
    مزرعة: "🌾",
    مزرعه: "🌾",
    مرعى: "🌾",

    // Categories
    إيجار: "🔑",
    ايجار: "🔑",
    طلبات: "📋",
    طلب: "📋",
    وظائف: "💼",
    وظيفة: "💼",
    فعاليات: "🎉",
    فعالية: "🎉",
    خدمات: "🛠️",
    خدمة: "🛠️",
    أخرى: "📌",
  };

  // Check category and return matching emoji
  if (category) {
    const lowerCategory = category.toLowerCase();
    for (const [type, emoji] of Object.entries(emojiMap)) {
      if (lowerCategory.includes(type.toLowerCase())) {
        return emoji;
      }
    }
  }

  return "🏘️"; // Default emoji
}

/**
 * Handle marketing conversation
 */
async function handleMarketingConversation(
  userId,
  message,
  userName,
  isFromGroup = false
) {
  let session = userSession.getSession(userId);

  // If new conversation or idle state
  if (session.state === "idle") {
    // Extract initial info from message
    const initialInfo = extractInitialInfo(message);

    // Check if it's a search request
    if (
      !initialInfo.isSearching &&
      !initialInfo.propertyType &&
      !initialInfo.location
    ) {
      // Not a marketing-related message - send helpful default response
      const defaultMessage = `مرحباً ${userName}! 👋\n\n`;
      const helpMessage =
        `أنا بوت خاص بالبحث عن العقارات 🏠\n\n` +
        `يمكنني مساعدتك في إيجاد:\n` +
        `• شقق 🏢\n` +
        `• فلل وبيوت 🏠\n` +
        `• أراضي 🏞️\n` +
        `• محلات تجارية 🏪\n` +
        `• وأكثر...\n\n` +
        `📝 كيف تبدأ البحث؟\n` +
        `أرسل رسالة مثل:\n` +
        `• "ابحث عن شقة في الرياض"\n` +
        `• "ابي فيلا للبيع"\n` +
        `• "ارسل لي بيوت في جدة"\n` +
        `• "ودي أرض في الخبر"\n\n` +
        `🌐 موقعنا: https://masaak.com`;

      return {
        type: "help",
        message: defaultMessage + helpMessage,
      };
    }

    // Start collecting information
    session.data = initialInfo;
    session.state = "collecting";
    session.questionsAsked = [];

    // Build greeting message
    let greetingMessage = "";

    // Special greeting for group messages
    if (isFromGroup) {
      greetingMessage = `✨ أهلاً ${userName}! 👋\n\n`;
      greetingMessage += `🤖 أنا بوت خاص بموقع **masaak.com**\n\n`;

      // Acknowledge what we understood from the group message
      const understood = [];
      if (initialInfo.propertyType)
        understood.push(`${initialInfo.propertyType}`);
      if (initialInfo.location) understood.push(`في ${initialInfo.location}`);
      if (
        initialInfo.transactionType &&
        (initialInfo.transactionType === "بيع" ||
          initialInfo.transactionType === "شراء")
      ) {
        understood.push("للبيع");
      } else if (initialInfo.transactionType === "إيجار") {
        understood.push("للإيجار");
      }

      if (understood.length > 0) {
        greetingMessage += `🔍 لقد رأيت أنك تبحث عن:\n`;
        greetingMessage += `   • ${understood.join(" ")}\n\n`;
      } else {
        greetingMessage += `🔍 لقد رأيت أنك تبحث عن عقار\n\n`;
      }

      greetingMessage += `📝 لكي أساعدك بشكل أفضل، هل يمكنك إعطائي معلومات أكثر؟\n\n`;
      greetingMessage += `💬 يمكنك الرد هنا مباشرة، أو اكتب "ابحث" للبدء! 😊\n\n`;
      greetingMessage += `━━━━━━━━━━━━━━━\n`;
      greetingMessage += `🌐 *موقعنا:* https://masaak.com`;
    } else {
      // Normal private message greeting
      greetingMessage = `أهلاً ${userName} 👋\n\n`;

      // Acknowledge what we understood
      const understood = [];
      if (initialInfo.propertyType)
        understood.push(`${initialInfo.propertyType}`);
      if (initialInfo.location) understood.push(`في ${initialInfo.location}`);
      if (
        initialInfo.transactionType &&
        (initialInfo.transactionType === "بيع" ||
          initialInfo.transactionType === "شراء")
      ) {
        understood.push("للبيع");
      } else if (initialInfo.transactionType === "إيجار") {
        understood.push("للإيجار");
      }

      if (understood.length > 0) {
        greetingMessage += `أفهم أنك تبحث عن ${understood.join(
          " "
        )}، بإمكاني مساعدتك! 😊\n\n`;
      } else {
        greetingMessage += `أفهم أنك تبحث عن عقار، بإمكاني مساعدتك! 😊\n\n`;
      }
    }

    // Generate first question
    const nextQ = generateNextQuestion(session, userName);
    if (nextQ) {
      // For group messages, send greeting only (they'll continue in private)
      // DON'T set currentQuestion yet - wait for them to reply in private
      if (isFromGroup) {
        // Keep currentQuestion null so we can ask it when they reply
        session.currentQuestion = null;
        userSession.updateSession(userId, session);
        return { type: "question", message: greetingMessage };
      } else {
        // For private messages, set question and combine with greeting
        session.currentQuestion = nextQ.key;
        userSession.updateSession(userId, session);
        return { type: "question", message: greetingMessage + nextQ.text };
      }
    } else {
      // All info already extracted! Search directly
      session.state = "completed";
      userSession.updateSession(userId, session);

      const matchingAds = searchAds(session.data);
      const resultsMessage = generateResultsMessage(matchingAds, session.data);

      // Clear session after showing results
      setTimeout(() => {
        userSession.clearSession(userId);
      }, 5000);

      return {
        type: "results",
        message: greetingMessage + resultsMessage,
        ads: matchingAds,
      };
    }
  }

  // If in collecting state
  if (session.state === "collecting") {
    // If currentQuestion is null, this is their first reply after group introduction
    // Extract any new info from their message and ask the first real question
    if (!session.currentQuestion) {
      console.log(
        `📝 First reply after group introduction, extracting info...`
      );

      // Extract additional info from their reply
      const additionalInfo = extractInitialInfo(message);

      // Merge with existing data (keep existing values if no new info)
      if (additionalInfo.propertyType && !session.data.propertyType) {
        session.data.propertyType = additionalInfo.propertyType;
      }
      if (additionalInfo.location && !session.data.location) {
        session.data.location = additionalInfo.location;
      }
      if (additionalInfo.transactionType && !session.data.transactionType) {
        session.data.transactionType = additionalInfo.transactionType;
      }
      if (additionalInfo.priceMax && !session.data.priceMax) {
        session.data.priceMax = additionalInfo.priceMax;
      }
      if (additionalInfo.rooms && !session.data.rooms) {
        session.data.rooms = additionalInfo.rooms;
      }

      userSession.updateSession(userId, session);

      console.log(
        `📊 Updated session data:`,
        JSON.stringify(session.data, null, 2)
      );

      // Now generate and ask the first question
      const nextQ = generateNextQuestion(session, userName);

      if (nextQ) {
        session.currentQuestion = nextQ.key;
        userSession.updateSession(userId, session);

        // Acknowledge their message and ask question
        const acknowledgment = "تمام! 👍\n\n";
        return { type: "question", message: acknowledgment + nextQ.text };
      } else {
        // All info complete! Search now
        session.state = "completed";
        userSession.updateSession(userId, session);

        const matchingAds = searchAds(session.data);
        const resultsMessage = generateResultsMessage(
          matchingAds,
          session.data
        );

        setTimeout(() => {
          userSession.clearSession(userId);
        }, 5000);

        return {
          type: "results",
          message: "ممتاز! 🎉 دعني أبحث لك الآن...\n\n" + resultsMessage,
          ads: matchingAds,
        };
      }
    }

    console.log(
      `📝 Processing answer for question: ${session.currentQuestion}`
    );

    // Process the answer with validation
    const validation = processAnswer(session, message);

    // If validation failed, ask the same question again with error message
    if (!validation.valid) {
      console.log(`❌ Validation failed: ${validation.errorMessage}`);
      // Don't update session or mark question as asked
      // Just return error message and re-ask
      return {
        type: "question",
        message: validation.errorMessage,
      };
    }

    userSession.updateSession(userId, session);

    console.log(
      `📊 Updated session data:`,
      JSON.stringify(session.data, null, 2)
    );

    // Generate next question
    const nextQ = generateNextQuestion(session, userName);

    if (nextQ) {
      console.log(`❓ Next question: ${nextQ.key}`);

      // More questions to ask
      session.currentQuestion = nextQ.key;
      userSession.updateSession(userId, session);

      // Add friendly acknowledgment based on what was answered
      const acknowledgments = [
        "تمام! 👍\n\n",
        "ممتاز! ✨\n\n",
        "رائع! 😊\n\n",
        "عظيم! 👌\n\n",
      ];

      const randomAck =
        acknowledgments[Math.floor(Math.random() * acknowledgments.length)];

      return { type: "question", message: randomAck + nextQ.text };
    } else {
      console.log(`✅ All questions answered! Searching for ads...`);

      // All questions answered - search for ads
      session.state = "completed";
      userSession.updateSession(userId, session);

      const matchingAds = searchAds(session.data);
      const resultsMessage = generateResultsMessage(matchingAds, session.data);

      // Build summary
      let summaryMessage = "ممتاز! 🎉 دعني أبحث لك الآن...\n\n";
      summaryMessage += "📋 ملخص بحثك:\n";
      if (session.data.propertyType)
        summaryMessage += `• النوع: ${session.data.propertyType}\n`;
      if (session.data.location)
        summaryMessage += `• الموقع: ${session.data.location}\n`;
      if (session.data.transactionType)
        summaryMessage += `• المعاملة: ${session.data.transactionType}\n`;
      if (session.data.priceMax)
        summaryMessage += `• السعر: حتى ${session.data.priceMax.toLocaleString()} ريال\n`;
      if (session.data.areaMax)
        summaryMessage += `• المساحة: حتى ${session.data.areaMax} م²\n`;
      if (session.data.rooms)
        summaryMessage += `• الغرف: ${session.data.rooms}\n`;
      summaryMessage += "\n━━━━━━━━━━━━━━━━━\n\n";

      // Clear session after showing results
      setTimeout(() => {
        userSession.clearSession(userId);
      }, 5000);

      return {
        type: "results",
        message: summaryMessage + resultsMessage,
        ads: matchingAds,
      };
    }
  }

  return null;
}

/**
 * Detect if message is a "طلب" (request/looking to buy) or "عرض" (offer/for sale)
 * Returns: "طلب" | "عرض" | null
 */
function detectAdType(message) {
  const lowerMessage = message.toLowerCase();

  // 🔴 HIGH PRIORITY: Check for "عرض" (offer) keywords first
  // These indicate someone is OFFERING/SELLING something
  const offerKeywords = [
    "للبيع",
    "للإيجار",
    " للإيجار",
    "للأجار",
    "للاجار",
    "متوفر",
    "يوجد",
    "عندي",
    "عندنا",
    "متاح",
    "معروض",
    "للتنازل",
    "للتقبيل",
    "فرصة للبيع",
    "فرصة شرائية",
    "available",
    "for sale",
    "for rent",
  ];

  // Check if it's an offer
  const isOffer = offerKeywords.some((keyword) =>
    lowerMessage.includes(keyword)
  );

  if (isOffer) {
    // Extra verification: if they say "ابغى ابيع" it means they want to sell (طلب)
    // But if it's just "للبيع" without "ابغى", it's an offer
    const wantToSellPhrases = [
      "ابغى ابيع",
      "ابغا ابيع",
      "ابي ابيع",
      "أبغى أبيع",
      "أبغا أبيع",
      "أبي أبيع",
      "ودي ابيع",
      "محتاج ابيع",
      "احتاج ابيع",
    ];

    const isWantToSell = wantToSellPhrases.some((phrase) =>
      lowerMessage.includes(phrase)
    );

    // If they say "ابغى ابيع", it's a طلب (request to find a buyer)
    if (isWantToSell) {
      return "طلب";
    }

    // Otherwise, it's an عرض (offer)
    return "عرض";
  }

  // 🟢 Check for "طلب" (request) keywords
  // These indicate someone is LOOKING FOR/WANTING TO BUY something
  const requestKeywords = [
    "مطلوب",
    "ابحث عن",
    "ابحث",
    "بحث عن",
    "ادور على",
    "ادور",
    "من عنده",
    "مين عنده",
    "حد عنده",
    "احتاج",
    "محتاج",
    "ابغى اشتري",
    "ابغا اشتري",
    "ابي اشتري",
    "أبغى أشتري",
    "أبغا أشتري",
    "أبي أشتري",
    "ودي اشتري",
    "أريد شراء",
    "اريد شراء",
    "طالب",
    "يا ليت",
    "تكفون",
    "الله يخليكم",
    "ياخوان",
    "looking for",
    "need",
    "want to buy",
  ];

  const isRequest = requestKeywords.some((keyword) =>
    lowerMessage.includes(keyword)
  );

  if (isRequest) {
    return "طلب";
  }

  return null;
}

/**
 * Check if message should trigger marketing system
 * Only trigger for "طلب" (requests), not for "عرض" (offers)
 */
function shouldTriggerMarketing(message) {
  const lowerMessage = message.toLowerCase();

  // First, detect if it's a طلب or عرض
  const adType = detectAdType(message);

  // ⚠️ IMPORTANT: Only trigger marketing for "طلب" (requests)
  // Do NOT trigger for "عرض" (offers) - people advertising their properties
  if (adType === "عرض") {
    console.log("🚫 Detected 'عرض' (offer) - not triggering marketing");
    return false;
  }

  // Check for search keywords
  const hasSearchKeyword = SEARCH_KEYWORDS.some((keyword) =>
    lowerMessage.includes(keyword)
  );

  // Check for property types
  const hasPropertyType = PROPERTY_TYPES.some((type) =>
    lowerMessage.includes(type.toLowerCase())
  );

  // Check for location indicators
  const hasLocation = /(?:ب|في)\s+حي|منطقة/.test(lowerMessage);

  const shouldTrigger = hasSearchKeyword || (hasPropertyType && hasLocation);

  // Extra check: if it's a طلب, allow triggering
  if (adType === "طلب") {
    console.log("✅ Detected 'طلب' (request) - triggering marketing");
    return true;
  }

  return shouldTrigger;
}

module.exports = {
  handleMarketingConversation,
  shouldTriggerMarketing,
  detectAdType,
  extractInitialInfo,
  searchAds,
  generateResultsMessage,
};
