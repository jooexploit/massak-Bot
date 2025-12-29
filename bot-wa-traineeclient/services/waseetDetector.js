/**
 * Waseet (وسيط) Detection Service
 * Detects if private messages are real estate ads using smart filtering
 * Saves tokens by using local checks before AI processing
 */

const fs = require("fs");
const path = require("path");

// Real estate keywords from your database
const AD_KEYWORDS = {
  // Property types
  propertyTypes: [
    "بيت",
    "فيلا",
    "شقة",
    "عمارة",
    "دور",
    "دبلكس",
    "أرض",
    "مزرعة",
    "استراحة",
    "شالية",
    "محل",
    "مستودع",
  ],

  // Property status
  status: ["للبيع", "للإيجار", "للتقبيل", "للاستثمار"],

  // Land types
  landTypes: ["سكنية", "تجارية", "زراعية"],

  // Document types
  documentTypes: ["صك", "عرق", "مشاع", "وقف"],

  // Property features
  features: [
    "غرف",
    "دورات مياه",
    "مجلس",
    "صالة",
    "مطبخ",
    "حوش",
    "موقف",
    "زاوية",
    "شارع",
    "مساحة",
    "متر",
    "دورين",
  ],

  // Contact keywords
  contact: ["للتواصل", "للاستفسار", "للحجز", "رقم", "جوال", "واتساب", "اتصال"],

  // Location indicators
  location: ["حي", "شارع", "منطقة", "مخطط", "بلك", "رقم"],

  // Commercial types from your database
  commercial: [
    "مطعم",
    "كوفي",
    "بقالة",
    "سوبر ماركت",
    "صيدلية",
    "محطة بنزين",
    "مغسلة",
    "حلاق",
    "مشغل",
    "فود ترك",
  ],
};

// Patterns that strongly indicate real estate ads
const AD_PATTERNS = [
  // Property with location
  /(بيت|فيلا|شقة|عمارة|دور|أرض|مزرعة)\s*(في|ب|حي)/,

  // For sale/rent pattern
  /(للبيع|للإيجار|للتقبيل)\s*(بيت|فيلا|شقة|عمارة|دور|أرض)/,

  // Size pattern (متر + number)
  /\d+\s*(متر|م²|م\s*٢)/,

  // Price pattern (ريال + number or number + ألف)
  /\d+\s*(ريال|ألف|مليون|ر\.س)/,

  // Rooms pattern
  /\d+\s*(غرف|غرفة|دورات|دورة|صالة|مجلس)/,

  // Street pattern
  /شارع\s*\d+/,

  // Phone number pattern (Saudi/Egyptian)
  /(05|966|011|012|20)\d{8,10}/,

  // Contact with number
  /(للتواصل|للاستفسار|جوال|واتساب).*\d{9,}/,
];

// Data files
const { getDataPath } = require("../config/dataPath");

const WASEET_FILE = getDataPath("waseet_contacts.json");

// In-memory storage
let waseetContacts = {};

/**
 * Load waseet contacts from file
 */
function loadWaseetContacts() {
  try {
    if (fs.existsSync(WASEET_FILE)) {
      const data = fs.readFileSync(WASEET_FILE, "utf8");
      waseetContacts = JSON.parse(data);
    } else {
      waseetContacts = {};
      saveWaseetContacts();
    }
  } catch (error) {
    console.error("❌ Error loading waseet contacts:", error);
    waseetContacts = {};
  }
}

/**
 * Save waseet contacts to file
 */
function saveWaseetContacts() {
  try {
    fs.writeFileSync(WASEET_FILE, JSON.stringify(waseetContacts, null, 2));
  } catch (error) {
    console.error("❌ Error saving waseet contacts:", error);
  }
}

/**
 * Add/mark contact as waseet
 * @param {string} phoneNumber - Phone number (with or without @s.whatsapp.net)
 * @param {string} name - Optional name of the waseet
 */
function markAsWaseet(phoneNumber, name = null) {
  const cleanNumber = phoneNumber
    .replace("@s.whatsapp.net", "")
    .replace(/^\+/, "");

  waseetContacts[cleanNumber] = {
    isWaseet: true,
    name: name,
    addedAt: Date.now(),
    totalAdsReceived: waseetContacts[cleanNumber]?.totalAdsReceived || 0,
  };
  saveWaseetContacts();

  // Add/Update in private_clients.json so they appear in dashboard
  // Mark them as "وسيط" role with completed state
  try {
    const privateClient = require("../models/privateClient");

    // Get or create client (getClient automatically creates if doesn't exist)
    const client = privateClient.getClient(cleanNumber);

    // Update to waseet role with completed state
    console.log(
      `🔄 Setting ${cleanNumber} as وسيط in private clients dashboard`
    );
    privateClient.updateClient(cleanNumber, {
      role: "وسيط",
      name: name || client.name || "وسيط",
      state: "completed", // Completed state so they don't get conversation prompts
    });
  } catch (error) {
    console.error("⚠️ Could not add/update in private clients:", error.message);
  }

  console.log(`✅ Marked ${cleanNumber} as waseet`);
}

/**
 * Remove contact from waseet list
 * @param {string} phoneNumber - Phone number (with or without @s.whatsapp.net)
 */
function unmarkAsWaseet(phoneNumber) {
  const cleanNumber = phoneNumber
    .replace("@s.whatsapp.net", "")
    .replace(/^\+/, "");
  delete waseetContacts[cleanNumber];
  saveWaseetContacts();
  console.log(`❌ Removed ${cleanNumber} from waseet list`);
}

/**
 * Check if contact is a waseet
 * @param {string} phoneNumber - Phone number (with or without @s.whatsapp.net)
 * @returns {boolean}
 */
function isWaseet(phoneNumber) {
  const cleanNumber = phoneNumber
    .replace("@s.whatsapp.net", "")
    .replace(/^\+/, "");
  return waseetContacts[cleanNumber]?.isWaseet === true;
}

/**
 * Get waseet info
 * @param {string} phoneNumber - Phone number
 * @returns {object|null}
 */
function getWaseetInfo(phoneNumber) {
  const cleanNumber = phoneNumber
    .replace("@s.whatsapp.net", "")
    .replace(/^\+/, "");
  return waseetContacts[cleanNumber] || null;
}

/**
 * List all waseet contacts
 * @returns {array}
 */
function listAllWaseet() {
  return Object.entries(waseetContacts).map(([phone, data]) => ({
    phone: phone,
    ...data,
  }));
}

/**
 * Quick local check if message is likely a real estate ad
 * This runs BEFORE AI to save tokens
 * @param {string} message - Message text
 * @returns {boolean} - True if likely an ad
 */
function isLikelyAd(message) {
  if (!message || message.trim().length < 20) {
    return false; // Too short to be an ad
  }

  const text = message.toLowerCase();
  let score = 0;

  // Check keywords (each category match adds points)
  Object.keys(AD_KEYWORDS).forEach((category) => {
    const matches = AD_KEYWORDS[category].filter((keyword) =>
      text.includes(keyword.toLowerCase())
    );
    if (matches.length > 0) {
      score += matches.length;
    }
  });

  // Check patterns (strong indicators)
  const patternMatches = AD_PATTERNS.filter((pattern) => pattern.test(message));
  if (patternMatches.length > 0) {
    score += patternMatches.length * 3; // Patterns are stronger indicators
  }

  // Check for phone numbers (strong indicator)
  const hasPhone = /\d{9,}/.test(message);
  if (hasPhone) {
    score += 2;
  }

  // Decision: If score >= 4, it's likely an ad
  const isAd = score >= 4;

  console.log(
    `🔍 Local ad check - Score: ${score}/4 - Result: ${
      isAd ? "✅ Likely ad" : "❌ Not likely ad"
    }`
  );

  return isAd;
}

/**
 * Increment ad counter for waseet
 * @param {string} phoneNumber - Phone number
 */
function incrementAdCount(phoneNumber) {
  const cleanNumber = phoneNumber
    .replace("@s.whatsapp.net", "")
    .replace(/^\+/, "");
  if (waseetContacts[cleanNumber]) {
    waseetContacts[cleanNumber].totalAdsReceived =
      (waseetContacts[cleanNumber].totalAdsReceived || 0) + 1;
    waseetContacts[cleanNumber].lastAdAt = Date.now();
    saveWaseetContacts();
  }
}

// Initialize on load
loadWaseetContacts();

module.exports = {
  markAsWaseet,
  unmarkAsWaseet,
  isWaseet,
  getWaseetInfo,
  listAllWaseet,
  isLikelyAd,
  incrementAdCount,
};
