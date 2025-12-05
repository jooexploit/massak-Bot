/**
 * Website Configuration
 * Defines configuration for multiple websites (Masaak and Hasak)
 */

module.exports = {
  // ============================================
  // MASAAK CONFIGURATION (Real Estate)
  // ============================================
  masaak: {
    name: "مسعاك",
    url: "https://masaak.com",
    username: "Abdulrahman-admin",
    password: "YVb6 w9Tj 21Bl vvEF LYK3 ghtH",
    type: "real_estate", // Type of website

    // Main categories with their WordPress IDs
    categories: {
      // Rental/Sale Types
      " للإيجار": 66,
      للإيجار: 66,
      " للبيع": 65,
      للبيع: 65,

      // Property Types
      أرض: 39,
      بيت: 34,
      تجاري: 74,
      دبلكس: 38,
      شقة: 35,
      "شقة دبلكسية": 36,
      عمارة: 37,
      فيلا: 33,
      "محطة بنزين": 80,
      مزرعة: 32,
      مستودع: 77,
      محل: 64,
      "محل تجاري": 113,
      استراحة: 115,
      شالية: 114,
      طلبات: 83,
      طلب: 83,
      default: 1,
    },

    // Subcategories mapping
    subcategories: {
      أرض: {
        تجارية: 46,
        زراعية: 44,
        سكنية: 45,
      },
      بيت: {
        دور: 48,
        "دور وشقق": 49,
        "دور وملحق": 50,
        دورين: 51,
        عربي: 47,
      },
      دبلكس: {
        بطن: 84,
        زاوية: 85,
      },
      "شقة دبلكسية": {
        "دور أرضي": 55,
        "دور أول": 56,
        "دور ثاني": 57,
        "دور ثالث": 58,
      },
      شقة: {
        "دور أرضي": 59,
        "دور أول": 60,
        "دور ثاني": 61,
        "دور ثالث": 62,
      },
      عمارة: {
        تجارية: 72,
        سكنية: 71,
        "سكنية تجارية": 73,
      },
      فيلا: {
        دور: 53,
        "دور وشقق": 54,
        دورين: 52,
      },
      "محطة بنزين": {
        "بدون محلات": 82,
        "مع محلات": 81,
      },
      "محل تجاري": {
        حلاق: 90,
        "مغسلة سيارات": 91,
        "مغسلة ملابس": 92,
        بقالة: 93,
        "سوبر ماركت": 94,
        "محل سباكة": 95,
        "محل زينة": 96,
        مطعم: 97,
        بوفية: 98,
        كوفي: 99,
        "مشغل نسائي": 100,
        حلويات: 101,
        "محل كهرباء": 102,
        "أدوات صحية": 103,
        صيدلية: 104,
        "محل ملابس": 105,
        "قطع سيارات": 106,
        "محل أثاث": 107,
        "محل كماليات": 108,
        "محل عصاير": 109,
        "محل فواكه": 110,
        جوالات: 111,
        "فود ترك": 112,
        "محل تجاري": 113,
      },
      مزرعة: {
        صك: 40,
        عرق: 41,
        مشاع: 42,
        وقف: 43,
      },
      استراحة: {
        صك: 116,
        عرق: 117,
        مشاع: 118,
        وقف: 119,
      },
      شالية: {
        صك: 120,
        عرق: 121,
        مشاع: 122,
        وقف: 123,
      },
      مستودع: {
        كبير: 79,
        صغير: 78,
      },
    },

    // Default phone number
    defaultPhone: "0508001475",
  },

  // ============================================
  // HASAK CONFIGURATION (Events & Used Items)
  // ============================================
  hasak: {
    name: "حساك",
    url: "https://hsaak.com",
    username: "Abdulrahman-admin",
    password: "jEXM bNPa GQuH OFsE Jllv O96F",
    type: "events_marketplace", // Type of website

    // Main categories with their WordPress IDs
    categories: {
      Uncategorized: 1,
      "أسر منتجة": 10,
      "إعلان تجاري ربحي مميز": 24,
      "الفعاليات والانشطة": 19,
      "برامج ووظائف": 30,
      "توصيل سيارات": 25,
      "حراج الحسا": 18,
      "فعاليات و أنشطة": 19,
      "فعالية مجانية مميزة": 17,
      "كوفيهات أو مطاعم": 21,
      "مجتمع حساك": 28,
      "محلات تجارية": 23,
      "مركز ترفيهي": 20,
      "منتجعات وإستراحات": 22,
      default: 1,
    },

    // Hasak doesn't have subcategories structure like Masaak
    subcategories: {},

    // Default phone number
    defaultPhone: "0508001475",
  },

  // ============================================
  // CATEGORY DETECTION KEYWORDS
  // ============================================
  categoryDetectionKeywords: {
    // Masaak (Real Estate) Keywords
    masaak: [
      "أرض",
      "ارض",
      "قطعة",
      "شقة",
      "شقه",
      "فيلا",
      "فيله",
      "بيت",
      "منزل",
      "عمارة",
      "عماره",
      "دبلكس",
      "استراحة",
      "استراحه",
      "شالية",
      "شاليه",
      "محل",
      "محل تجاري",
      "مزرعة",
      "مزرعه",
      "مستودع",
      "عقار",
      "عقارات",
      "للبيع",
      "للإيجار",
      "متر",
      "م²",
    ],

    // Hasak (Events & Used Items) Keywords
    hasak: [
      "فعالية",
      "فعاليات",
      "حراج",
      "حراجات",
      "مستعمل",
      "مستعملة",
      "أسرة منتجة",
      "اسرة منتجة",
      "كوفي",
      "كوفيه",
      "مطعم",
      "ترفيهي",
      "ترفيه",
      "منتجع",
      "نشاط",
      "أنشطة",
      "وظيفة",
      "وظائف",
      "توصيل",
      "ورشة",
      "ورش",
      "دورة",
      "دورات",
      // Used-item / car market hints
      "سيارة",
      "سيارات",
      "جمس",
      "جيب",
      "صالون",
      "كورولا",
      "النترا",
      "كامري",
      "سوناتا",
      "بانوراما",
      "حساك",
    ],
  },

  // ============================================
  // HELPER METHODS
  // ============================================

  /**
   * Detect which website to use based on content
   * @param {string} text - The text to analyze
   * @param {string} category - The detected category
   * @param {Object} meta - Optional metadata object (e.g., wpData.meta with order_type)
   * @returns {string} - 'masaak' or 'hasak'
   */
  detectWebsite: function (text, category, meta = {}) {
    const lowerText = text.toLowerCase();
    const lowerCategory = (category || "").toLowerCase();
    const orderType = (meta.order_type || "").toLowerCase();
    const offerType = (meta.offer_type || "").toLowerCase();

    // ⚠️ PRIORITY CHECK 0: Check for car/حراج keywords - HIGHEST PRIORITY
    // Car ads should ALWAYS go to Hasak even if category is "طلبات"
    const carKeywords = [
      "سيارة",
      "سيارات",
      "حراج",
      "جمس",
      "جيب",
      "كامري",
      "كورولا",
      "النترا",
      "سوناتا",
      "بانوراما",
      "موديل",
      "معرض سيارات",
    ];
    const hasCarKeyword = carKeywords.some((kw) => lowerText.includes(kw));
    if (hasCarKeyword) {
      console.log(
        `✅ Car/حراج keyword found in text → Forcing route to Hasak (حراج الحسا)`
      );
      return "hasak";
    }

    // ⚠️ PRIORITY CHECK 1: Check order_type/offer_type for فعالية
    if (
      orderType === "فعالية" ||
      offerType === "فعالية" ||
      orderType === "فعاليات" ||
      offerType === "فعاليات"
    ) {
      console.log(
        `✅ order_type/offer_type is "فعالية" → Forcing route to Hasak`
      );
      return "hasak";
    }

    // ⚠️ PRIORITY CHECK 2: Check if category exists in Hasak FIRST
    // Hasak categories should take priority over Masaak for events/activities
    if (this.hasak.categories[category]) {
      console.log(
        `✅ Category "${category}" found in Hasak → Routing to Hasak`
      );
      return "hasak";
    }

    // Check if category exists in Masaak
    if (this.masaak.categories[category]) {
      console.log(
        `✅ Category "${category}" found in Masaak → Routing to Masaak`
      );
      return "masaak";
    }

    // Count keyword matches for each website
    let masaakScore = 0;
    let hasakScore = 0;

    this.categoryDetectionKeywords.masaak.forEach((keyword) => {
      if (lowerText.includes(keyword) || lowerCategory.includes(keyword)) {
        masaakScore++;
      }
    });

    this.categoryDetectionKeywords.hasak.forEach((keyword) => {
      if (lowerText.includes(keyword) || lowerCategory.includes(keyword)) {
        hasakScore++;
      }
    });

    console.log(
      `🔍 Website Detection Scores - Masaak: ${masaakScore}, Hasak: ${hasakScore}`
    );

    // If Hasak score is higher OR equal (give priority to Hasak for ties)
    if (hasakScore > masaakScore) {
      return "hasak";
    } else if (hasakScore === masaakScore && hasakScore > 0) {
      // On tie with positive scores, check if it's event-related
      const eventKeywords = [
        "فعالية",
        "معرض",
        "نشاط",
        "ورشة",
        "دورة",
        "مؤتمر",
        "احتفال",
        "مهرجان",
      ];
      const isEvent = eventKeywords.some(
        (kw) => lowerText.includes(kw) || lowerCategory.includes(kw)
      );
      if (isEvent) {
        console.log(
          "⚠️ Tie detected but event keywords found → Routing to Hasak"
        );
        return "hasak";
      }
    }

    // Default to masaak only if masaak score is higher or no scores at all
    return "masaak";
  },

  /**
   * Get website configuration
   * @param {string} websiteName - 'masaak' or 'hasak'
   * @returns {Object} Website configuration
   */
  getWebsite: function (websiteName) {
    return this[websiteName] || this.masaak;
  },

  /**
   * Get category ID for a website
   * @param {string} websiteName - 'masaak' or 'hasak'
   * @param {string} category - Category name
   * @returns {number} Category ID
   */
  getCategoryId: function (websiteName, category) {
    const website = this.getWebsite(websiteName);
    return website.categories[category] || website.categories.default;
  },

  /**
   * Get subcategory ID for a website
   * @param {string} websiteName - 'masaak' or 'hasak'
   * @param {string} category - Main category name
   * @param {string} subcategory - Subcategory name
   * @returns {number|null} Subcategory ID or null
   */
  getSubcategoryId: function (websiteName, category, subcategory) {
    const website = this.getWebsite(websiteName);
    if (website.subcategories[category]) {
      return website.subcategories[category][subcategory] || null;
    }
    return null;
  },
};
