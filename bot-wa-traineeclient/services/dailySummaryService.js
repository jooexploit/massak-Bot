const fs = require("fs");
const path = require("path");
const { getDataPath } = require("../config/dataPath");

const SUMMARY_FILE = getDataPath("daily_summaries.json");

// Arabic month names for formatting
const ARABIC_MONTHS = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

// Arabic day names
const ARABIC_DAYS = [
  "الأحد",
  "الإثنين",
  "الثلاثاء",
  "الأربعاء",
  "الخميس",
  "الجمعة",
  "السبت",
];

/**
 * Convert number to Arabic numerals
 */
function toArabicNumerals(num) {
  const arabicNumerals = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
  return String(num)
    .split("")
    .map((digit) => arabicNumerals[parseInt(digit)] || digit)
    .join("");
}

/**
 * Format date in Arabic
 */
function formatArabicDate(date) {
  const day = date.getDate();
  const month = ARABIC_MONTHS[date.getMonth()];
  const year = date.getFullYear();
  const dayName = ARABIC_DAYS[date.getDay()];

  return `${dayName} ${toArabicNumerals(day)} ${month} ${toArabicNumerals(
    year
  )}`;
}

/**
 * Get all summaries from file
 */
function getSummaries() {
  try {
    if (!fs.existsSync(SUMMARY_FILE)) {
      return [];
    }
    const data = fs.readFileSync(SUMMARY_FILE, "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.error("Error reading summaries:", error);
    return [];
  }
}

/**
 * Save summaries to file
 */
function saveSummaries(summaries) {
  try {
    fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summaries, null, 2));
  } catch (error) {
    console.error("Error saving summaries:", error);
  }
}

/**
 * Get ads that were sent to groups today
 */
function getAdsSentToday(targetWebsite = "masaak", category = null) {
  try {
    const adsFile = getDataPath("ads.json");
    if (!fs.existsSync(adsFile)) {
      return [];
    }

    const adsData = JSON.parse(fs.readFileSync(adsFile, "utf8"));
    const adsArray = Array.isArray(adsData) ? adsData : adsData.ads || [];

    // Get start and end of today in KSA timezone
    const now = new Date();
    const ksaDateStr = now.toLocaleString("en-US", { timeZone: "Asia/Riyadh" });
    const ksaNow = new Date(ksaDateStr);

    const startOfDay = new Date(
      ksaNow.getFullYear(),
      ksaNow.getMonth(),
      ksaNow.getDate(),
      0,
      0,
      0
    );
    const endOfDay = new Date(
      ksaNow.getFullYear(),
      ksaNow.getMonth(),
      ksaNow.getDate(),
      23,
      59,
      59
    );

    // Filter ads that were sent today to WhatsApp groups
    const sentToday = adsArray.filter((ad) => {
      // Check if ad was sent to groups (has postedToGroups flag)
      if (!ad.postedToGroups) return false;

      // Check if it's accepted status
      if (ad.status !== "accepted") return false;

      // Check website
      const adWebsite =
        ad.targetWebsite || ad.wpData?.targetWebsite || "masaak";
      if (adWebsite !== targetWebsite) return false;

      // Check category if specified (supports multiple categories with | separator)
      if (category) {
        const adCategory =
          ad.category ||
          ad.wpData?.meta?.arc_category ||
          ad.wpData?.meta?.parent_catt ||
          "";

        // Support multiple categories separated by |
        const allowedCategories = category.split("|");
        if (!allowedCategories.includes(adCategory)) return false;
      }

      // Check if sent today using sentAt timestamp
      if (!ad.sentAt) return false;
      const sentAt = new Date(ad.sentAt);
      return sentAt >= startOfDay && sentAt <= endOfDay;
    });

    return sentToday;
  } catch (error) {
    console.error("Error getting ads sent today:", error);
    return [];
  }
}

/**
 * Generate summary message for a specific category
 */
function generateCategorySummary(config, ads, targetWebsite) {
  if (ads.length === 0) return null;

  const now = new Date();
  const arabicDate = formatArabicDate(now);

  // Build message with bold date
  let message = `${config.title} *يوم ${arabicDate}*\n\n`;

  ads.forEach((ad, index) => {
    const wpUrl = ad.wordpressUrl || ad.wordpressFullUrl || "";
    const title =
      ad.wpData?.title || ad.enhancedText?.substring(0, 100) || "عرض مميز";
    const area = ad.wpData?.meta?.area || ad.wpData?.meta?.arc_space || "";
    const price = ad.wpData?.meta?.price_amount || ad.wpData?.meta?.price || "";

    // Build the item line - just title with emoji
    let itemLine = `${toArabicNumerals(index + 1)}- ${title.trim()}`;

    // Add area and price if available
    if (area && price) {
      itemLine += ` ${area}م - ${price.toLocaleString("ar-SA")} ريال`;
    } else if (area) {
      itemLine += ` ${area}م`;
    } else if (price) {
      itemLine += ` - ${price.toLocaleString("ar-SA")} ريال`;
    }

    message += `${itemLine}\n`;

    if (wpUrl) {
      message += `🔗 رابط: ${wpUrl}\n`;
    }

    message += `........................🔰.......................\n`;
  });

  // Add category link at the end
  const emoji = targetWebsite === "hasak" ? "🌴" : "🔰";
  const categoryText =
    targetWebsite === "hasak"
      ? `تتوفر المزيد من ${config.name} على: ${config.link}`
      : `تتوفر المزيد من ${config.name} على: ${config.link}`;

  message += `\n${categoryText}`;

  return message;
}

/**
 * Get category configurations based on website
 */
function getCategoryConfigs(targetWebsite) {
  if (targetWebsite === "hasak") {
    return [
      {
        name: "فعاليات الأحساء",
        slug: "الفعاليات-والانشطة",
        category: "فعاليات",
        link: "https://hsaak.com/category/الفعاليات-والانشطة/",
        title: "ملخص فعاليات الأحساء في منصة 🌴حساك",
      },
      {
        name: "المستعمل",
        slug: "حراج-الحسا",
        category: "حراج الحسا",
        link: "https://hsaak.com/category/حراج-الحسا/",
        title: "عروض المستعمل في منصة 🌴حساك",
      },
    ];
  } else {
    // masaak categories
    return [
      {
        name: "الأراضي والمزارع",
        slug: "أراضي-للبيع",
        category: "أرض|مزرعة",
        link: "https://masaak.com/category/أراضي-للبيع/",
        title: "ملخص عروض الأراضي والمزارع في منصة 🔰مسعاك",
      },
      {
        name: "الفلل والبيوت",
        slug: "فلل-للبيع",
        category: "فيلا|بيت",
        link: "https://masaak.com/category/فلل-للبيع/",
        title: "عروض الفلل والبيوت في منصة 🔰مسعاك",
      },
      {
        name: "الشقق والشقق الدبلكسية",
        slug: "شقق-للبيع",
        category: "شقة|شقة دبلكسية",
        link: "https://masaak.com/category/شقق-للبيع/",
        title: "عروض الشقق والشقق الدبلكسية في منصة 🔰مسعاك",
      },
      {
        name: "الدبلكسات",
        slug: "دبلكسات-للبيع",
        category: "دبلكس",
        link: "https://masaak.com/category/دبلكسات-للبيع/",
        title: "ملخص عروض الدبلكسات في منصة 🔰مسعاك",
      },
      {
        name: "العمارات",
        slug: "عمارات-للبيع",
        category: "عمارة",
        link: "https://masaak.com/category/عمارات-للبيع/",
        title: "ملخص عروض العمارات في منصة 🔰مسعاك",
      },
      {
        name: "الاستراحات والشاليهات",
        slug: "استراحات-للبيع",
        category: "استراحة|شالية",
        link: "https://masaak.com/category/استراحات-للبيع/",
        title: "عروض الاستراحات والشاليهات في منصة 🔰مسعاك",
      },
      {
        name: "المحلات التجارية",
        slug: "محلات-تجارية",
        category: "محل تجاري|محل",
        link: "https://masaak.com/category/محلات-تجارية/",
        title: "عروض المحلات التجارية في منصة 🔰مسعاك",
      },
      {
        name: "المستودعات",
        slug: "مستودعات",
        category: "مستودع",
        link: "https://masaak.com/category/مستودعات/",
        title: "عروض المستودعات في منصة 🔰مسعاك",
      },
      {
        name: "عقارات للإيجار",
        slug: "للإيجار",
        category: "إيجار| للإيجار",
        link: "https://masaak.com/category/للإيجار/",
        title: "عروض عقارات للإيجار في منصة 🔰مسعاك",
      },
      {
        name: "الاستثمار والتقبيل",
        slug: "للاستثمار",
        category: "استثمار|للاستثمار|للتقبيل",
        link: "https://masaak.com/category/للاستثمار/",
        title: "عروض للاستثمار والتقبيل في منصة 🔰مسعاك",
      },
    ];
  }
}

/**
 * Generate all daily summaries for both websites
 * @param {Object} filters - Optional filters
 * @param {string} filters.website - Filter by specific website (masaak/hasak)
 * @param {string} filters.category - Filter by specific category
 */
function generateDailySummaries(filters = {}) {
  const summaries = [];
  const websites = filters.website ? [filters.website] : ["masaak", "hasak"];

  websites.forEach((website) => {
    let configs = getCategoryConfigs(website);

    // Apply category filter if specified
    if (filters.category) {
      configs = configs.filter(
        (c) =>
          c.category === filters.category ||
          c.category.includes(filters.category)
      );
    }

    configs.forEach((config) => {
      const ads = getAdsSentToday(website, config.category);

      if (ads.length > 0) {
        const message = generateCategorySummary(config, ads, website);

        if (message) {
          summaries.push({
            id: `summary_${Date.now()}_${Math.random()
              .toString(36)
              .substr(2, 9)}`,
            website: website,
            category: config.category,
            categoryName: config.name,
            message: message,
            adsCount: ads.length,
            adIds: ads.map((ad) => ad.id),
            createdAt: new Date().toISOString(),
            date: new Date().toISOString().split("T")[0], // YYYY-MM-DD
            sent: false, // Track if summary was sent to groups
            sentAt: null, // When it was sent
          });
        }
      }
    });
  });

  return summaries;
}

/**
 * Generate and save daily summaries (no WhatsApp sending)
 */
async function generateAndSaveDailySummaries() {
  try {
    // Generate summaries
    const summaries = generateDailySummaries();

    if (summaries.length === 0) {
      console.log("ℹ️ No ads sent today, skipping daily summary");
      return { success: true, message: "No summaries to generate", count: 0 };
    }

    console.log(`📊 Generated ${summaries.length} daily summaries`);

    const results = summaries.map((s) => ({
      category: s.categoryName,
      website: s.website,
      adsCount: s.adsCount,
    }));

    // Save summaries to file
    const allSummaries = getSummaries();
    allSummaries.unshift(...summaries);

    // Keep only last 5 days - group by date and keep only 5 unique dates
    const uniqueDates = [...new Set(allSummaries.map((s) => s.date))];
    const last5Dates = uniqueDates.slice(0, 5);
    const filtered = allSummaries.filter((s) => last5Dates.includes(s.date));

    saveSummaries(filtered);

    console.log(`💾 Saved ${filtered.length} summaries (last 5 days)`);

    return {
      success: true,
      count: summaries.length,
      summaries: results,
    };
  } catch (error) {
    console.error("❌ Error generating daily summaries:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Get summary for a specific date
 */
function getSummaryByDate(date) {
  const summaries = getSummaries();
  return summaries.filter((s) => s.date === date);
}

/**
 * Get total count of ads sent today across all categories and websites
 */
function getTodaysAdsCount() {
  try {
    const adsFile = getDataPath("ads.json");
    if (!fs.existsSync(adsFile)) {
      return 0;
    }

    const adsData = JSON.parse(fs.readFileSync(adsFile, "utf8"));
    const adsArray = Array.isArray(adsData) ? adsData : adsData.ads || [];

    // Get start and end of today in KSA timezone
    const now = new Date();
    const ksaDateStr = now.toLocaleString("en-US", { timeZone: "Asia/Riyadh" });
    const ksaNow = new Date(ksaDateStr);

    const startOfDay = new Date(
      ksaNow.getFullYear(),
      ksaNow.getMonth(),
      ksaNow.getDate(),
      0,
      0,
      0
    );
    const endOfDay = new Date(
      ksaNow.getFullYear(),
      ksaNow.getMonth(),
      ksaNow.getDate(),
      23,
      59,
      59
    );

    // Count all ads sent today
    const count = adsArray.filter((ad) => {
      if (!ad.postedToGroups || ad.status !== "accepted" || !ad.sentAt) {
        return false;
      }
      const sentAt = new Date(ad.sentAt);
      return sentAt >= startOfDay && sentAt <= endOfDay;
    }).length;

    return count;
  } catch (error) {
    console.error("Error getting today's ads count:", error);
    return 0;
  }
}

// =====================================
// SMART SUMMARY - ADVANCED FILTERING
// =====================================

const {
  getCategoriesForWebsite,
  getMainCategoryNames,
  getSubcategoriesForCategory,
  getSubcategoriesForCategories,
  categoryMatchesFilter,
  isCommercialAd,
  getDateRangeFromPreset,
  getCategoryDisplayInfo,
  DATE_PRESETS,
} = require("./smartSummaryFilters");

/**
 * Get ads with advanced filtering options
 * @param {Object} filters - Advanced filter options
 * @param {string} filters.website - Filter by website (masaak/hasak)
 * @param {string} filters.presetPeriod - Date preset (today, yesterday, last7days, custom)
 * @param {Date|string} filters.startDate - Custom start date
 * @param {Date|string} filters.endDate - Custom end date
 * @param {string[]} filters.mainCategories - Main category names to filter
 * @param {string[]} filters.subCategories - Subcategory names to filter
 * @param {string[]} filters.sourceGroups - Source group JIDs to filter
 * @param {boolean} filters.includeCommercial - Include commercial ads (default: true)
 */
function getAdsWithAdvancedFilters(filters = {}) {
  try {
    const adsFile = getDataPath("ads.json");
    if (!fs.existsSync(adsFile)) {
      return [];
    }

    const adsData = JSON.parse(fs.readFileSync(adsFile, "utf8"));
    const adsArray = Array.isArray(adsData) ? adsData : adsData.ads || [];

    // Get date range
    const dateRange = getDateRangeFromPreset(
      filters.presetPeriod || "today",
      filters.startDate,
      filters.endDate
    );
    const startOfRange = dateRange.startDate;
    const endOfRange = dateRange.endDate;

    console.log(
      `📊 Filtering ads from ${startOfRange.toISOString()} to ${endOfRange.toISOString()}`
    );

    // Filter ads based on all criteria
    const filteredAds = adsArray.filter((ad) => {
      // Must be sent to groups
      if (!ad.postedToGroups) return false;

      // Must be accepted
      if (ad.status !== "accepted") return false;

      // Must have sentAt timestamp
      if (!ad.sentAt) return false;

      // Check date range
      const sentAt = new Date(ad.sentAt);
      if (sentAt < startOfRange || sentAt > endOfRange) return false;

      // Check website filter
      if (filters.website) {
        const adWebsite =
          ad.targetWebsite || ad.wpData?.targetWebsite || "masaak";
        if (adWebsite !== filters.website) return false;
      }

      // Check main category filter
      if (filters.mainCategories && filters.mainCategories.length > 0) {
        const adCategory =
          ad.category ||
          ad.wpData?.meta?.arc_category ||
          ad.wpData?.meta?.parent_catt ||
          "";
        if (!categoryMatchesFilter(adCategory, filters.mainCategories))
          return false;
      }

      // Check subcategory filter
      if (filters.subCategories && filters.subCategories.length > 0) {
        const adSubCategory =
          ad.subCategory ||
          ad.wpData?.meta?.sub_category ||
          ad.wpData?.meta?.child_catt ||
          "";
        if (!categoryMatchesFilter(adSubCategory, filters.subCategories))
          return false;
      }

      // Check source group filter
      if (filters.sourceGroups && filters.sourceGroups.length > 0) {
        const adFromGroup = ad.fromGroup || "";
        if (!filters.sourceGroups.includes(adFromGroup)) return false;
      }

      // Check commercial ads filter
      if (filters.includeCommercial === false) {
        if (isCommercialAd(ad)) return false;
      }

      return true;
    });

    console.log(`📊 Found ${filteredAds.length} ads matching filters`);
    return filteredAds;
  } catch (error) {
    console.error("Error getting ads with advanced filters:", error);
    return [];
  }
}

/**
 * Get all unique source groups from ads
 */
function getUniqueSourceGroups() {
  try {
    const adsFile = getDataPath("ads.json");
    if (!fs.existsSync(adsFile)) {
      return [];
    }

    const adsData = JSON.parse(fs.readFileSync(adsFile, "utf8"));
    const adsArray = Array.isArray(adsData) ? adsData : adsData.ads || [];

    // Get unique groups with names
    const groupsMap = new Map();
    adsArray.forEach((ad) => {
      if (ad.fromGroup && !groupsMap.has(ad.fromGroup)) {
        groupsMap.set(ad.fromGroup, {
          jid: ad.fromGroup,
          name: ad.fromGroupName || ad.fromGroup,
        });
      }
    });

    return Array.from(groupsMap.values()).sort((a, b) =>
      (a.name || "").localeCompare(b.name || "")
    );
  } catch (error) {
    console.error("Error getting unique source groups:", error);
    return [];
  }
}

/**
 * Get available filter options for smart summary
 */
function getAvailableFilters() {
  const masaakCategories = getMainCategoryNames("masaak");
  const hasakCategories = getMainCategoryNames("hasak");
  const sourceGroups = getUniqueSourceGroups();

  // Build categories with display info
  const masaakCatInfo = masaakCategories.map((cat) =>
    getCategoryDisplayInfo(cat, "masaak")
  );
  const hasakCatInfo = hasakCategories.map((cat) =>
    getCategoryDisplayInfo(cat, "hasak")
  );

  return {
    websites: [
      { value: "masaak", label: "🔰 مسعاك", labelEn: "Masaak" },
      { value: "hasak", label: "🌴 حساك", labelEn: "Hasak" },
    ],
    datePresets: Object.entries(DATE_PRESETS).map(([key, preset]) => ({
      value: key,
      label: preset.label,
      labelEn: preset.labelEn,
    })),
    categories: {
      masaak: masaakCatInfo,
      hasak: hasakCatInfo,
    },
    sourceGroups: sourceGroups,
  };
}

/**
 * Generate custom summary with advanced filters
 */
function generateCustomSummary(filters = {}) {
  const ads = getAdsWithAdvancedFilters(filters);

  if (ads.length === 0) {
    return {
      success: true,
      count: 0,
      message: "No ads found matching the selected filters",
      summary: null,
    };
  }

  // Determine date range for title
  const dateRange = getDateRangeFromPreset(
    filters.presetPeriod || "today",
    filters.startDate,
    filters.endDate
  );

  // Format dates for display
  const startDateStr = formatArabicDate(dateRange.startDate);
  const endDateStr = formatArabicDate(dateRange.endDate);
  const isSameDay =
    dateRange.startDate.toDateString() === dateRange.endDate.toDateString();

  // Build title
  let title = "";
  const website = filters.website || "all";
  const websiteEmoji =
    website === "hasak" ? "🌴" : website === "masaak" ? "🔰" : "📊";
  const websiteName =
    website === "hasak" ? "حساك" : website === "masaak" ? "مسعاك" : "";

  if (isSameDay) {
    title = `ملخص إعلانات ${websiteName} *يوم ${startDateStr}*`;
  } else {
    title = `ملخص إعلانات ${websiteName} *من ${startDateStr} إلى ${endDateStr}*`;
  }

  // Add category info to title if specific categories selected
  if (
    filters.mainCategories &&
    filters.mainCategories.length > 0 &&
    filters.mainCategories.length <= 3
  ) {
    title += `\n📂 ${filters.mainCategories.join(" | ")}`;
  }

  // Build message
  let message = `${websiteEmoji} ${title}\n\n`;

  ads.forEach((ad, index) => {
    const wpUrl = ad.wordpressUrl || ad.wordpressFullUrl || "";
    const adTitle =
      ad.wpData?.title || ad.enhancedText?.substring(0, 100) || "عرض مميز";
    const area = ad.wpData?.meta?.area || ad.wpData?.meta?.arc_space || "";
    const price = ad.wpData?.meta?.price_amount || ad.wpData?.meta?.price || "";

    let itemLine = `${toArabicNumerals(index + 1)}- ${adTitle.trim()}`;

    if (area && price) {
      itemLine += ` ${area}م - ${price.toLocaleString("ar-SA")} ريال`;
    } else if (area) {
      itemLine += ` ${area}م`;
    } else if (price) {
      itemLine += ` - ${price.toLocaleString("ar-SA")} ريال`;
    }

    message += `${itemLine}\n`;

    if (wpUrl) {
      message += `🔗 رابط: ${wpUrl}\n`;
    }

    message += `........................${websiteEmoji}.......................\n`;
  });

  // Add footer
  if (website === "masaak") {
    message += `\n\n🔰 للمزيد من العروض: https://masaak.com`;
  } else if (website === "hasak") {
    message += `\n\n🌴 للمزيد من العروض: https://hsaak.com`;
  }

  // Create summary object
  const summary = {
    id: `custom_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    website: website,
    category: filters.mainCategories?.join("|") || "all",
    categoryName: filters.mainCategories?.join(" | ") || "الكل",
    message: message,
    adsCount: ads.length,
    adIds: ads.map((ad) => ad.id),
    createdAt: new Date().toISOString(),
    date: new Date().toISOString().split("T")[0],
    sent: false,
    sentAt: null,
    filters: {
      presetPeriod: filters.presetPeriod,
      startDate: dateRange.startDate.toISOString(),
      endDate: dateRange.endDate.toISOString(),
      mainCategories: filters.mainCategories,
      subCategories: filters.subCategories,
      sourceGroups: filters.sourceGroups,
      includeCommercial: filters.includeCommercial,
    },
  };

  return {
    success: true,
    count: ads.length,
    message: `Generated summary with ${ads.length} ads`,
    summary: summary,
  };
}

/**
 * Preview custom summary (returns count and sample without saving)
 */
function previewCustomSummary(filters = {}) {
  const ads = getAdsWithAdvancedFilters(filters);

  return {
    count: ads.length,
    previewAds: ads.slice(0, 5).map((ad) => ({
      id: ad.id,
      title: ad.wpData?.title || ad.enhancedText?.substring(0, 50) || "عرض",
      category: ad.category,
      fromGroup: ad.fromGroupName || ad.fromGroup,
      sentAt: ad.sentAt,
    })),
    filters: filters,
  };
}

/**
 * Get summary statistics
 */
function getSummaryStats() {
  try {
    const summaries = getSummaries();
    const ksaDateStr = new Date().toLocaleString("en-US", {
      timeZone: "Asia/Riyadh",
    });
    const ksaNow = new Date(ksaDateStr);
    const today = ksaNow.toISOString().split("T")[0];

    const todaySummaries = summaries.filter((s) => s.date === today);
    const todayAdsCount = getTodaysAdsCount(); // Use actual count from ads.json

    return {
      total: summaries.length,
      today: todaySummaries.length,
      todayAdsCount: todayAdsCount,
      lastGenerated: summaries.length > 0 ? summaries[0].createdAt : null,
    };
  } catch (error) {
    console.error("Error getting summary stats:", error);
    return { total: 0, today: 0, todayAdsCount: 0, lastGenerated: null };
  }
}

module.exports = {
  generateDailySummaries,
  generateAndSaveDailySummaries,
  getSummaries,
  getSummaryByDate,
  getSummaryStats,
  getAdsSentToday,
  formatArabicDate,
  toArabicNumerals,
  getTodaysAdsCount,
  getCategoryConfigs,
  saveSummaries,
  // Smart Summary exports
  getAdsWithAdvancedFilters,
  getUniqueSourceGroups,
  getAvailableFilters,
  generateCustomSummary,
  previewCustomSummary,
};
