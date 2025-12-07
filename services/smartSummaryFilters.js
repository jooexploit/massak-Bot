/**
 * Smart Summary Filters - Category hierarchies and filter utilities
 * for advanced daily summary generation
 */

// =====================================
// MASAAK CATEGORIES (Real Estate)
// =====================================
const MASAAK_CATEGORIES = {
  // Property Types
  "أرض": {
    name: "أرض",
    displayName: "الأراضي",
    icon: "🏞️",
    subcategories: ["صك", "عرق", "مشاع", "وقف", "زراعية", "سكنية", "تجارية", "سكنية تجارية"],
    wpCategoryIds: [39, 40, 41, 42, 43, 44, 45, 46, 71, 72, 73]
  },
  "فيلا": {
    name: "فيلا",
    displayName: "الفلل",
    icon: "🏡",
    subcategories: [],
    wpCategoryIds: [33]
  },
  "بيت": {
    name: "بيت",
    displayName: "البيوت",
    icon: "🏠",
    subcategories: [],
    wpCategoryIds: [34]
  },
  "شقة": {
    name: "شقة",
    displayName: "الشقق",
    icon: "🏢",
    subcategories: ["دبلكسية"],
    wpCategoryIds: [35, 36, 68]
  },
  "دبلكس": {
    name: "دبلكس",
    displayName: "الدبلكسات",
    icon: "🏘️",
    subcategories: [],
    wpCategoryIds: [38, 69]
  },
  "عمارة": {
    name: "عمارة",
    displayName: "العمارات",
    icon: "🏗️",
    subcategories: [],
    wpCategoryIds: [37]
  },
  "دور": {
    name: "دور",
    displayName: "الأدوار",
    icon: "🏛️",
    subcategories: ["أرضي", "أول", "ثاني", "ثالث", "وشقق", "وملحق", "دورين"],
    wpCategoryIds: [48, 53, 55, 56, 57, 58, 59, 60, 61, 62, 49, 50, 51, 52, 54]
  },
  "استراحة": {
    name: "استراحة",
    displayName: "الاستراحات",
    icon: "🏕️",
    subcategories: [],
    wpCategoryIds: [115]
  },
  "شالية": {
    name: "شالية",
    displayName: "الشاليهات",
    icon: "🏖️",
    subcategories: [],
    wpCategoryIds: [114]
  },
  "مزرعة": {
    name: "مزرعة",
    displayName: "المزارع",
    icon: "🌾",
    subcategories: [],
    wpCategoryIds: [32]
  },
  "محل": {
    name: "محل",
    displayName: "المحلات",
    icon: "🏪",
    subcategories: ["تجاري", "أثاث", "زينة", "سباكة", "عصاير", "فواكه", "كماليات", "كهرباء", "ملابس", "جوالات"],
    wpCategoryIds: [64, 67, 113, 107, 96, 95, 109, 110, 108, 102, 105, 111]
  },
  "مستودع": {
    name: "مستودع",
    displayName: "المستودعات",
    icon: "🏭",
    subcategories: [],
    wpCategoryIds: [70, 77]
  },
  // Transaction Types
  "للإيجار": {
    name: "للإيجار",
    displayName: "للإيجار",
    icon: "🔑",
    subcategories: [],
    wpCategoryIds: [66]
  },
  "للاستثمار": {
    name: "للاستثمار",
    displayName: "للاستثمار",
    icon: "📈",
    subcategories: [],
    wpCategoryIds: [87]
  },
  "للتقبيل": {
    name: "للتقبيل",
    displayName: "للتقبيل",
    icon: "🤝",
    subcategories: [],
    wpCategoryIds: [88, 63]
  },
  // Commercial
  "محطة بنزين": {
    name: "محطة بنزين",
    displayName: "محطات البنزين",
    icon: "⛽",
    subcategories: ["كبير", "صغير"],
    wpCategoryIds: [65, 78, 79, 80]
  },
  // Services
  "مغسلة": {
    name: "مغسلة",
    displayName: "المغاسل",
    icon: "🧺",
    subcategories: ["سيارات", "ملابس"],
    wpCategoryIds: [91, 92]
  },
  "مطعم": {
    name: "مطعم",
    displayName: "المطاعم",
    icon: "🍽️",
    subcategories: ["كوفي", "بوفية", "فود ترك"],
    wpCategoryIds: [97, 99, 98, 112]
  }
};

// =====================================
// HASAK CATEGORIES (Events & Used Items)
// =====================================
const HASAK_CATEGORIES = {
  "فعاليات": {
    name: "فعاليات",
    displayName: "الفعاليات والأنشطة",
    icon: "🎉",
    subcategories: ["مجانية", "مميزة"],
    wpCategoryIds: [19, 17]
  },
  "حراج الحسا": {
    name: "حراج الحسا",
    displayName: "حراج الأحساء",
    icon: "🛒",
    subcategories: [],
    wpCategoryIds: [18]
  },
  "أسر منتجة": {
    name: "أسر منتجة",
    displayName: "الأسر المنتجة",
    icon: "👨‍👩‍👧‍👦",
    subcategories: [],
    wpCategoryIds: [10]
  },
  "إعلان تجاري": {
    name: "إعلان تجاري",
    displayName: "الإعلانات التجارية",
    icon: "📢",
    subcategories: ["ربحي مميز"],
    wpCategoryIds: [24]
  },
  "برامج ووظائف": {
    name: "برامج ووظائف",
    displayName: "البرامج والوظائف",
    icon: "💼",
    subcategories: [],
    wpCategoryIds: [30]
  },
  "توصيل سيارات": {
    name: "توصيل سيارات",
    displayName: "توصيل السيارات",
    icon: "🚗",
    subcategories: [],
    wpCategoryIds: [25]
  },
  "كوفيهات أو مطاعم": {
    name: "كوفيهات أو مطاعم",
    displayName: "الكوفيهات والمطاعم",
    icon: "☕",
    subcategories: [],
    wpCategoryIds: [21]
  },
  "محلات تجارية": {
    name: "محلات تجارية",
    displayName: "المحلات التجارية",
    icon: "🏬",
    subcategories: [],
    wpCategoryIds: [23]
  },
  "مركز ترفيهي": {
    name: "مركز ترفيهي",
    displayName: "المراكز الترفيهية",
    icon: "🎢",
    subcategories: [],
    wpCategoryIds: [20]
  },
  "منتجعات وإستراحات": {
    name: "منتجعات وإستراحات",
    displayName: "المنتجعات والاستراحات",
    icon: "🏨",
    subcategories: [],
    wpCategoryIds: [22]
  }
};

// =====================================
// COMMERCIAL AD INDICATORS
// =====================================
const COMMERCIAL_INDICATORS = [
  "إعلان تجاري",
  "ربحي",
  "تجاري مميز",
  "إعلان مدفوع",
  "إعلان ممول",
  "sponsored",
  "اعلانات مسعاك المميزة",
  "شركاء مسعاك",
  "شركاء حساك"
];

// =====================================
// DATE PRESETS
// =====================================
const DATE_PRESETS = {
  today: {
    label: "اليوم",
    labelEn: "Today",
    getRange: () => {
      const now = new Date();
      const ksaDateStr = now.toLocaleString("en-US", { timeZone: "Asia/Riyadh" });
      const ksaNow = new Date(ksaDateStr);
      const start = new Date(ksaNow.getFullYear(), ksaNow.getMonth(), ksaNow.getDate(), 0, 0, 0);
      const end = new Date(ksaNow.getFullYear(), ksaNow.getMonth(), ksaNow.getDate(), 23, 59, 59);
      return { startDate: start, endDate: end };
    }
  },
  yesterday: {
    label: "أمس",
    labelEn: "Yesterday",
    getRange: () => {
      const now = new Date();
      const ksaDateStr = now.toLocaleString("en-US", { timeZone: "Asia/Riyadh" });
      const ksaNow = new Date(ksaDateStr);
      const yesterday = new Date(ksaNow);
      yesterday.setDate(yesterday.getDate() - 1);
      const start = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 0, 0, 0);
      const end = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59);
      return { startDate: start, endDate: end };
    }
  },
  last7days: {
    label: "آخر 7 أيام",
    labelEn: "Last 7 Days",
    getRange: () => {
      const now = new Date();
      const ksaDateStr = now.toLocaleString("en-US", { timeZone: "Asia/Riyadh" });
      const ksaNow = new Date(ksaDateStr);
      const end = new Date(ksaNow.getFullYear(), ksaNow.getMonth(), ksaNow.getDate(), 23, 59, 59);
      const start = new Date(ksaNow);
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      return { startDate: start, endDate: end };
    }
  },
  last30days: {
    label: "آخر 30 يوم",
    labelEn: "Last 30 Days",
    getRange: () => {
      const now = new Date();
      const ksaDateStr = now.toLocaleString("en-US", { timeZone: "Asia/Riyadh" });
      const ksaNow = new Date(ksaDateStr);
      const end = new Date(ksaNow.getFullYear(), ksaNow.getMonth(), ksaNow.getDate(), 23, 59, 59);
      const start = new Date(ksaNow);
      start.setDate(start.getDate() - 29);
      start.setHours(0, 0, 0, 0);
      return { startDate: start, endDate: end };
    }
  },
  custom: {
    label: "مخصص",
    labelEn: "Custom",
    getRange: (startDate, endDate) => {
      // Parse the dates properly and set time boundaries
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      
      return { startDate: start, endDate: end };
    }
  }
};

// =====================================
// UTILITY FUNCTIONS
// =====================================

/**
 * Get all categories for a specific website
 */
function getCategoriesForWebsite(website) {
  if (website === "hasak") {
    return HASAK_CATEGORIES;
  } else if (website === "masaak") {
    return MASAAK_CATEGORIES;
  } else {
    // Return all categories
    return { ...MASAAK_CATEGORIES, ...HASAK_CATEGORIES };
  }
}

/**
 * Get main category names for a website
 */
function getMainCategoryNames(website) {
  const categories = getCategoriesForWebsite(website);
  return Object.keys(categories);
}

/**
 * Get subcategories for a main category
 */
function getSubcategoriesForCategory(mainCategory, website = null) {
  let categories;
  if (website) {
    categories = getCategoriesForWebsite(website);
  } else {
    categories = { ...MASAAK_CATEGORIES, ...HASAK_CATEGORIES };
  }
  
  if (categories[mainCategory]) {
    return categories[mainCategory].subcategories || [];
  }
  return [];
}

/**
 * Get all subcategories for multiple main categories
 */
function getSubcategoriesForCategories(mainCategories, website = null) {
  const subcategories = new Set();
  mainCategories.forEach(mainCat => {
    const subs = getSubcategoriesForCategory(mainCat, website);
    subs.forEach(sub => subcategories.add(sub));
  });
  return Array.from(subcategories);
}

/**
 * Check if an ad category matches the filter
 */
function categoryMatchesFilter(adCategory, filterCategories) {
  if (!filterCategories || filterCategories.length === 0) {
    return true;
  }
  
  const adCatNormalized = (adCategory || "").trim().toLowerCase();
  
  return filterCategories.some(filterCat => {
    const filterNormalized = filterCat.trim().toLowerCase();
    return adCatNormalized.includes(filterNormalized) || filterNormalized.includes(adCatNormalized);
  });
}

/**
 * Check if an ad is commercial
 */
function isCommercialAd(ad) {
  const text = (ad.text || ad.enhancedText || "").toLowerCase();
  const category = (ad.category || "").toLowerCase();
  
  return COMMERCIAL_INDICATORS.some(indicator => {
    const indicatorLower = indicator.toLowerCase();
    return text.includes(indicatorLower) || category.includes(indicatorLower);
  });
}

/**
 * Get date range from preset
 */
function getDateRangeFromPreset(preset, customStartDate = null, customEndDate = null) {
  if (DATE_PRESETS[preset]) {
    if (preset === "custom" && customStartDate && customEndDate) {
      return DATE_PRESETS.custom.getRange(customStartDate, customEndDate);
    }
    return DATE_PRESETS[preset].getRange();
  }
  // Default to today
  return DATE_PRESETS.today.getRange();
}

/**
 * Format date for display
 */
function formatDateForDisplay(date) {
  return date.toISOString().split("T")[0];
}

/**
 * Get category display info
 */
function getCategoryDisplayInfo(categoryName, website = null) {
  let categories;
  if (website) {
    categories = getCategoriesForWebsite(website);
  } else {
    categories = { ...MASAAK_CATEGORIES, ...HASAK_CATEGORIES };
  }
  
  if (categories[categoryName]) {
    return {
      name: categoryName,
      displayName: categories[categoryName].displayName,
      icon: categories[categoryName].icon,
      subcategories: categories[categoryName].subcategories
    };
  }
  
  return {
    name: categoryName,
    displayName: categoryName,
    icon: "📁",
    subcategories: []
  };
}

module.exports = {
  MASAAK_CATEGORIES,
  HASAK_CATEGORIES,
  COMMERCIAL_INDICATORS,
  DATE_PRESETS,
  getCategoriesForWebsite,
  getMainCategoryNames,
  getSubcategoriesForCategory,
  getSubcategoriesForCategories,
  categoryMatchesFilter,
  isCommercialAd,
  getDateRangeFromPreset,
  formatDateForDisplay,
  getCategoryDisplayInfo
};
