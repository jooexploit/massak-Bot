/**
 * Marketing System Configuration
 * Customize the marketing system behavior here
 */

module.exports = {
  // ============================================
  // SEARCH KEYWORDS
  // ============================================
  searchKeywords: [
    "ابحث",
    "أبحث",
    "ابي",
    "ودي",
    "أريد",
    "اريد",
    "محتاج",
    "اشتري",
  ],

  // ============================================
  // PROPERTY TYPES
  // ============================================
  propertyTypes: [
    "أرض",
    "بيت",
    "شقة",
    "فيلا",
    "عمارة",
    "دبلكس",
    "استراحة",
    "محل",
    "محل تجاري",
    "مستودع",
    "مزرعة",
    "شاليه",
  ],

  // ============================================
  // TRANSACTION TYPES
  // ============================================
  transactionTypes: ["بيع", "شراء", "إيجار", "استئجار"],

  // ============================================
  // EMOJIS FOR PROPERTY TYPES
  // ============================================
  propertyEmojis: {
    أرض: "🏞️",
    بيت: "🏠",
    شقة: "🏢",
    فيلا: "🏰",
    عمارة: "🏛️",
    دبلكس: "🏘️",
    استراحة: "🏕️",
    محل: "🏪",
    "محل تجاري": "🏬",
    مستودع: "🏭",
    مزرعة: "🌾",
    شاليه: "🏖️",
  },

  // ============================================
  // QUESTION TEMPLATES
  // ============================================
  questions: {
    propertyType: {
      text: (userName) =>
        `أهلاً ${userName} 👋\n\n` +
        `أفهم أنك تبحث عن عقار، بإمكاني مساعدتك! 😊\n\n` +
        `ما نوع العقار الذي تبحث عنه؟\n` +
        `مثال: شقة، فيلا، أرض، محل تجاري، بيت، إلخ...`,
    },

    location: {
      text: (data) =>
        `رائع! ${
          data.propertyType ? `أنت تبحث عن ${data.propertyType}` : ""
        } 🏘️\n\n` +
        `في أي منطقة أو حي تفضل؟\n` +
        `مثال: حي العزيزية، حي النهضة، وسط المدينة، إلخ...`,
    },

    transactionType: {
      text: () =>
        `ممتاز! 👍\n\n` +
        `هل تبحث عن:\n` +
        `• بيع (للشراء)\n` +
        `• إيجار (للاستئجار)`,
    },

    priceRange: {
      text: () =>
        `تمام! 💰\n\n` +
        `ما هو نطاق السعر المناسب لك؟\n` +
        `مثال:\n` +
        `• من 500,000 إلى 700,000\n` +
        `• حتى مليون\n` +
        `• بين 2000-3000 شهرياً (للإيجار)`,
    },

    area: {
      text: () =>
        `عظيم! 📐\n\n` +
        `ما المساحة التقريبية التي تفضلها؟\n` +
        `مثال: 200 متر، من 150 إلى 250 متر، إلخ...`,
    },

    additionalDetails: {
      text: () =>
        `ممتاز! ✨\n\n` +
        `هل لديك أي متطلبات إضافية؟\n` +
        `مثال: عدد الغرف، مواقف السيارات، قريب من الخدمات، إلخ...\n\n` +
        `أو اكتب "لا" إذا كنت راضياً بالمعلومات الحالية.`,
    },
  },

  // ============================================
  // RESULTS MESSAGE TEMPLATE
  // ============================================
  resultsTemplate: {
    header: (count, data) =>
      `رائع! 🎉 وجدت ${count} ${count === 1 ? "عرض" : "عروض"} ${
        count <= 10 ? "مناسبة" : "من أفضل العروض"
      } لك:\n\n` +
      `📍 البحث عن: ${data.propertyType || "عقار"}` +
      (data.location ? ` في ${data.location}` : "") +
      "\n",

    priceInfo: (data) => {
      if (!data.priceMin && !data.priceMax) return "";
      let text = `💰 السعر: `;
      if (data.priceMin && data.priceMax) {
        text += `${data.priceMin.toLocaleString()} - ${data.priceMax.toLocaleString()} ريال`;
      } else if (data.priceMax) {
        text += `حتى ${data.priceMax.toLocaleString()} ريال`;
      } else {
        text += `من ${data.priceMin.toLocaleString()} ريال`;
      }
      return text + "\n";
    },

    areaInfo: (data) => {
      if (!data.areaMin && !data.areaMax) return "";
      let text = `📐 المساحة: `;
      if (data.areaMin && data.areaMax) {
        text += `${data.areaMin} - ${data.areaMax} م²`;
      } else if (data.areaMax) {
        text += `حتى ${data.areaMax} م²`;
      } else {
        text += `من ${data.areaMin} م²`;
      }
      return text + "\n";
    },

    noResults: () =>
      `عذراً 😔\n\n` +
      `لم أجد أي عروض تطابق متطلباتك حالياً.\n\n` +
      `💡 جرب:\n` +
      `• توسيع نطاق البحث\n` +
      `• البحث في منطقة أخرى\n` +
      `• تغيير نطاق السعر\n\n` +
      `يمكنك إرسال "ابحث" في أي وقت لبدء بحث جديد! 🔍`,

    footer: (websiteUrl = "https://yourwebsite.com") =>
      `━━━━━━━━━━━━━━━━━\n\n` +
      `✨ نتمنى أن تجد ما يناسبك!\n` +
      `📱 للمزيد من المساعدة، اكتب "ابحث" لبدء بحث جديد\n\n` +
      `🌐 زر موقعنا: ${websiteUrl}`,

    adItem: (ad, index) => {
      let text = `${index}. `;
      if (ad.category) text += `${ad.category}\n`;
      if (ad.price) text += `💵 السعر: ${ad.price.toLocaleString()} ريال\n`;
      if (ad.area) text += `📐 المساحة: ${ad.area} م²\n`;
      if (ad.text) {
        const excerpt =
          ad.text.substring(0, 80) + (ad.text.length > 80 ? "..." : "");
        text += `📝 ${excerpt}\n`;
      }
      if (ad.contact) text += `📞 للتواصل: ${ad.contact}\n`;
      if (ad.link) text += `🔗 رابط الإعلان: ${ad.link}\n`;
      return text + "\n";
    },
  },

  // ============================================
  // SEARCH SETTINGS
  // ============================================
  search: {
    maxResults: 10, // Maximum number of results to show
    sortBy: "newest", // 'newest', 'price', 'area', 'relevance'
    fuzzyLocationMatch: true, // Allow partial location matches
    priceFlexibility: 0.1, // 10% flexibility in price range
    areaFlexibility: 0.15, // 15% flexibility in area range
  },

  // ============================================
  // SESSION SETTINGS
  // ============================================
  session: {
    timeout: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
    cleanupInterval: 60 * 60 * 1000, // Clean every hour
    maxActiveSessions: 1000, // Maximum concurrent sessions
  },

  // ============================================
  // BEHAVIOR SETTINGS
  // ============================================
  behavior: {
    sendToPrivateFromGroup: true, // Send marketing responses to private messages when detected in groups
    allowGroupResponses: false, // Allow responses directly in groups (not recommended)
    enableTypingIndicator: true, // Show typing indicator (if supported)
    responseDelay: 1000, // Delay before sending response (ms)
  },

  // ============================================
  // ERROR MESSAGES
  // ============================================
  errorMessages: {
    general: "عذراً، حدث خطأ. يرجى المحاولة مرة أخرى لاحقاً. 🙏",
    sessionExpired: 'انتهت صلاحية جلستك. يرجى بدء بحث جديد بكتابة "ابحث". 🔄',
    tooManyRequests: "الرجاء الانتظار قليلاً قبل بدء بحث جديد. ⏳",
    invalidInput: "عذراً، لم أفهم إجابتك. يرجى المحاولة مرة أخرى. 🤔",
  },

  // ============================================
  // WEBSITE URL (customize this!)
  // ============================================
  websiteUrl: "https://yourwebsite.com",

  // Contact info
  contactInfo: {
    phone: "0501234567",
    email: "info@yourwebsite.com",
    whatsapp: "966501234567",
  },
};
