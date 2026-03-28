const test = require("node:test");
const assert = require("node:assert/strict");

const aiService = require("../services/aiService");
const wordpressCategoryService = require("../services/wordpressCategoryService");

const mockedMasaakTerms = [
  { id: 390, name: "أرض", parent: 0 },
  { id: 450, name: "سكنية", parent: 390 },
  { id: 472, name: "تجارية", parent: 390 },
  { id: 370, name: "عمارة", parent: 0 },
  { id: 720, name: "تجارية", parent: 370 },
  { id: 330, name: "فيلا", parent: 0 },
  { id: 180, name: "طلبات", parent: 0 },
  { id: 1130, name: "محل تجاري", parent: 74 },
  { id: 31, name: "عن مسعاك", parent: 0 },
  { id: 999, name: "test", parent: 0 },
];

const mockedHasakTerms = [
  { id: 1800, name: "حراج الحسا", parent: 0 },
  { id: 2100, name: "كوفيهات أو مطاعم", parent: 0 },
  { id: 1900, name: "الفعاليات والانشطة", parent: 0 },
  { id: 2700, name: "فريق حساك", parent: 0 },
];

function createHttpGetMock({ masaak = mockedMasaakTerms, hasak = mockedHasakTerms } = {}) {
  return async (url) => {
    if (url.includes("masaak.com")) {
      return { data: masaak };
    }

    if (url.includes("hsaak.com")) {
      return { data: hasak };
    }

    throw new Error(`Unexpected URL: ${url}`);
  };
}

async function primeTrustedTaxonomy(mock = createHttpGetMock()) {
  wordpressCategoryService.__private.clearCache();
  await wordpressCategoryService.getTrustedTaxonomy({
    forceRefresh: true,
    httpGet: mock,
  });
}

test("trusted taxonomy filters non-posting live terms and refreshes IDs", async () => {
  await primeTrustedTaxonomy();

  const taxonomy = wordpressCategoryService.getTrustedTaxonomySync();

  assert.ok(taxonomy.masaak.mainCategoryNames.includes("أرض"));
  assert.ok(taxonomy.masaak.mainCategoryNames.includes("محل تجاري"));
  assert.ok(!taxonomy.masaak.mainCategoryNames.includes("عن مسعاك"));
  assert.ok(!taxonomy.masaak.mainCategoryNames.includes("test"));
  assert.equal(
    wordpressCategoryService.resolveCategoryIdSync("masaak", "أرض"),
    390,
  );
  assert.equal(
    wordpressCategoryService.resolveCategoryIdSync("masaak", "محل تجاري"),
    1130,
  );
  assert.equal(
    wordpressCategoryService.resolveSubcategorySync("أرض", "تجارية"),
    "تجارية",
  );
  assert.equal(
    wordpressCategoryService.resolveSubcategorySync("", "تجارية"),
    "",
  );
});

test("trusted taxonomy falls back to config when live fetch fails", async () => {
  wordpressCategoryService.__private.clearCache();

  await wordpressCategoryService.getTrustedTaxonomy({
    forceRefresh: true,
    httpGet: async () => {
      throw new Error("offline");
    },
  });

  assert.equal(
    wordpressCategoryService.resolveCategoryIdSync("masaak", "أرض"),
    39,
  );
  assert.ok(
    wordpressCategoryService
      .getTrustedTaxonomySync()
      .masaak.mainCategoryNames.includes("أرض"),
  );
});

test("prompt builders expose only trusted posting taxonomy", async () => {
  await primeTrustedTaxonomy();

  const extractionPrompt =
    await aiService.__private.buildWordPressExtractionPrompt(
      "أرض سكنية للبيع في الهفوف",
      "لا يوجد رقم هاتف واضح في النص.",
      false,
    );
  const recoveryPrompt =
    await aiService.__private.buildRecoverMissingFieldsPrompt(
      "أرض سكنية للبيع في الهفوف",
      { meta: {}, category: "", subcategory: "" },
      ["category", "subcategory"],
    );

  for (const prompt of [extractionPrompt, recoveryPrompt]) {
    assert.match(prompt, /أرض/);
    assert.match(prompt, /حراج الحسا/);
    assert.match(prompt, /صف العقار فقط/);
    assert.match(prompt, /"مسعاك" أو "حساك"/);
    assert.match(prompt, /owner_name/);
    assert.doesNotMatch(prompt, /عن مسعاك/);
    assert.doesNotMatch(prompt, /\btest\b/i);
  }
});

test("masaak normalization keeps only trusted category and subcategory values", async () => {
  await primeTrustedTaxonomy();

  const meta = {
    category: "عن مسعاك",
    parent_catt: "",
    arc_category: "",
    subcategory: "تصنيف غير موجود",
    sub_catt: "",
    arc_subcategory: "",
    category_id: "",
    ad_type: "عرض",
    order_type: "",
    offer_type: "",
    order_status: "عرض جديد",
    offer_status: "عرض جديد",
  };

  aiService.__private.normalizeWordPressCategoryMeta(
    meta,
    "أرض سكنية للبيع في الهفوف",
  );

  assert.equal(meta.category, "أرض");
  assert.equal(meta.parent_catt, "أرض");
  assert.equal(meta.arc_category, "أرض");
  assert.equal(meta.subcategory, "سكنية");
  assert.equal(meta.sub_catt, "سكنية");
  assert.equal(meta.arc_subcategory, "سكنية");
  assert.equal(meta.category_id, 390);
});

test("hasak normalization clears subcategory fields and keeps trusted category only", async () => {
  await primeTrustedTaxonomy();

  const meta = {
    category: "حراج",
    parent_catt: "",
    arc_category: "",
    subcategory: "أي شيء",
    sub_catt: "أي شيء",
    arc_subcategory: "أي شيء",
    category_id: "",
    ad_type: "عرض",
    order_type: "",
    offer_type: "",
    order_status: "عرض جديد",
    offer_status: "عرض جديد",
  };

  aiService.__private.normalizeWordPressCategoryMeta(
    meta,
    "جمس للبيع موديل 2020 ممشى قليل",
  );

  assert.equal(meta.category, "حراج الحسا");
  assert.equal(meta.arc_category, "حراج الحسا");
  assert.equal(meta.parent_catt, "");
  assert.equal(meta.subcategory, "");
  assert.equal(meta.sub_catt, "");
  assert.equal(meta.arc_subcategory, "");
  assert.equal(meta.category_id, 1800);
});

test("fallback category detection no longer returns out-of-scope labels", async () => {
  await primeTrustedTaxonomy();

  assert.equal(
    aiService.__private.detectCategoryFallback("نقدم خدمات تنظيف للمنازل"),
    null,
  );
});

test("forbidden description cleanup applies only to masaak", async () => {
  const sourceText =
    "للتواصل 0501234567 واتساب\nفعالية مميزة اليوم في الأحساء\nsnap: demo\nمكتب عقاري مرخص ترخيص رقم 12345";

  const cleanedForMasaak = aiService.__private.removeForbiddenInlineContent(
    sourceText,
    "masaak",
  );
  const cleanedForHasak = aiService.__private.removeForbiddenInlineContent(
    sourceText,
    "hasak",
  );

  assert.doesNotMatch(cleanedForMasaak, /واتساب/i);
  assert.doesNotMatch(cleanedForMasaak, /snap/i);
  assert.doesNotMatch(cleanedForMasaak, /مكتب/i);
  assert.doesNotMatch(cleanedForMasaak, /ترخيص/i);
  assert.match(cleanedForHasak, /واتساب/i);
  assert.match(cleanedForHasak, /snap/i);
  assert.match(cleanedForHasak, /مكتب/i);
  assert.equal(
    aiService.__private.hasForbiddenDescriptionContent(
      "<p>للتواصل 0501234567</p>",
      "masaak",
    ),
    true,
  );
  assert.equal(
    aiService.__private.hasForbiddenDescriptionContent(
      "<p>للتواصل 0501234567</p>",
      "hasak",
    ),
    false,
  );
  assert.match(
    aiService.__private.buildCleanMainAdText(sourceText, "hasak"),
    /0501234567/,
  );
  assert.doesNotMatch(
    aiService.__private.buildCleanMainAdText(sourceText, "masaak"),
    /0501234567/,
  );
});

test("location normalization rejects weak fragments and recovers clean values from text", () => {
  const meta = {
    before_City: "ال",
    before_city: "ال",
    city: "ال",
    City: "ال",
    subcity: "",
    location: "حي ال",
    neighborhood: "ال",
    category: "أرض",
    subcategory: "سكنية",
  };

  aiService.__private.normalizeLocationMeta(
    meta,
    "الدولة: السعودية\nالمدينة: الهفوف\nالحي: حي الخالدية\nأرض للبيع",
    "masaak",
  );

  assert.equal(meta.before_City, "السعودية");
  assert.equal(meta.city, "الهفوف");
  assert.equal(meta.City, "الهفوف");
  assert.equal(meta.location, "الخالدية");
  assert.equal(meta.neighborhood, "الخالدية");
});

test("location normalization trims long noisy phrases down to compact city and neighborhood values", () => {
  const meta = {
    before_City: "الدولة: السعودية بجوار البحر",
    before_city: "الدولة: السعودية بجوار البحر",
    city: "المدينة: الهفوف حي الخالدية شقة للبيع بسعر مناسب",
    City: "المدينة: الهفوف حي الخالدية شقة للبيع بسعر مناسب",
    subcity: "",
    location: "الموقع: حي الخالدية بجوار المطار وقريب من الخدمات",
    neighborhood: "الموقع: حي الخالدية بجوار المطار وقريب من الخدمات",
    category: "أرض",
    subcategory: "سكنية",
  };

  aiService.__private.normalizeLocationMeta(
    meta,
    "الدولة: السعودية\nالمدينة: الهفوف\nالحي: حي الخالدية\nشقة للبيع",
    "masaak",
  );

  assert.equal(meta.before_City, "السعودية");
  assert.equal(meta.city, "الهفوف");
  assert.equal(meta.location, "الخالدية");
});

test("location fallback keeps valid cities and countries that are not in the saved hints", () => {
  const extracted = aiService.__private.extractLocationFromTextFallback(
    "الدولة: مصر\nالمدينة: العلمين الجديدة\nالحي: حي اللوتس الجديدة\nشقة للبيع",
  );

  assert.equal(extracted.governorate, "مصر");
  assert.equal(extracted.city, "العلمين الجديدة");
  assert.equal(extracted.neighborhood, "اللوتس الجديدة");
  assert.equal(
    aiService.__private.sanitizeLocationCandidate("ال", { type: "city" }),
    "",
  );
});
