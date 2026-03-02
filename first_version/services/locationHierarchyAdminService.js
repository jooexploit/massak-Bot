const areaNormalizer = require("./areaNormalizer");
const {
  LOCATION_HIERARCHY,
  AL_AHSA_GOVERNORATE,
  saveLocationHierarchy,
} = require("../config/locationHierarchy");

const ROOT_COMMANDS = new Set(["مواقع", "المواقع", "location", "locations", "loc"]);
const ALLOWED_CITY_TYPES = new Set(["city", "town", "village", "area", "bucket"]);

function normalizeLookupKey(value = "") {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .toLowerCase();
}

function normalizeAction(value = "") {
  const key = normalizeLookupKey(value);
  if (["عرض", "اظهار", "show", "list"].includes(key)) return "show";
  if (["اضف", "اضافة", "اضافه", "add", "create", "+"].includes(key)) {
    return "add";
  }
  if (["تعديل", "تحديث", "حدث", "update", "edit", "set", "~"].includes(key)) {
    return "edit";
  }
  if (["حذف", "ازالة", "ازاله", "remove", "delete", "-"].includes(key)) {
    return "delete";
  }
  return "";
}

function normalizeEntity(value = "") {
  const key = normalizeLookupKey(value);

  if (["محافظة", "محافظه", "governorate", "gov"].includes(key)) {
    return "governorate";
  }

  if (["مدينة", "مدينه", "city"].includes(key)) {
    return "city";
  }

  if (["حي", "منطقة", "منطقه", "area", "neighborhood"].includes(key)) {
    return "area";
  }

  if (["مرادف", "alias"].includes(key)) {
    return "alias";
  }

  if (["نوع", "type"].includes(key)) {
    return "type";
  }

  return "";
}

function isLocationHierarchyCommand(command = "") {
  const token = String(command || "").trim();
  if (!token) return false;
  const lower = token.toLowerCase();
  return ROOT_COMMANDS.has(token) || ROOT_COMMANDS.has(lower);
}

function splitPipeArgs(raw = "") {
  return String(raw || "")
    .split(/\|/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseShowArgs(raw = "") {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return [];

  if (trimmed.includes("|")) {
    return splitPipeArgs(trimmed);
  }

  if (trimmed.includes("/")) {
    return trimmed
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean);
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) {
    return tokens;
  }

  return [tokens[0], tokens.slice(1).join(" ")];
}

function extractActionPayload(lines, rootToken, actionToken) {
  const firstLine = lines[0] || "";
  const prefix = `${rootToken} ${actionToken}`;
  let payload = firstLine.startsWith(prefix)
    ? firstLine.slice(prefix.length).trim()
    : firstLine.replace(rootToken, "").trim();

  if (lines.length > 1) {
    payload = [payload, ...lines.slice(1)]
      .map((line) => line.trim())
      .filter(Boolean)
      .join(" | ");
  }

  return payload.trim();
}

function ensureGovernorateShape(governorateData) {
  if (!governorateData || typeof governorateData !== "object") {
    return;
  }

  if (!Array.isArray(governorateData.aliases)) {
    governorateData.aliases = [];
  }

  if (
    !governorateData.cities ||
    typeof governorateData.cities !== "object" ||
    Array.isArray(governorateData.cities)
  ) {
    governorateData.cities = {};
  }
}

function ensureCityShape(cityData, fallbackCityName = "") {
  if (!cityData || typeof cityData !== "object") {
    return;
  }

  if (!Array.isArray(cityData.aliases)) {
    cityData.aliases = fallbackCityName ? [fallbackCityName] : [];
  }

  if (!Array.isArray(cityData.areas)) {
    cityData.areas = [];
  }

  if (!cityData.type || typeof cityData.type !== "string") {
    cityData.type = "city";
  }
}

function findGovernorateKey(input = "") {
  const target = normalizeLookupKey(input);
  if (!target) return "";

  for (const [governorateKey, governorateData] of Object.entries(LOCATION_HIERARCHY)) {
    if (normalizeLookupKey(governorateKey) === target) {
      return governorateKey;
    }

    const aliases = Array.isArray(governorateData?.aliases)
      ? governorateData.aliases
      : [];
    const hasAlias = aliases.some((alias) => normalizeLookupKey(alias) === target);
    if (hasAlias) {
      return governorateKey;
    }
  }

  return "";
}

function findCityKey(governorateData, input = "") {
  const target = normalizeLookupKey(input);
  if (!target || !governorateData?.cities) return "";

  for (const [cityKey, cityData] of Object.entries(governorateData.cities)) {
    if (normalizeLookupKey(cityKey) === target) {
      return cityKey;
    }

    const aliases = Array.isArray(cityData?.aliases) ? cityData.aliases : [];
    const hasAlias = aliases.some((alias) => normalizeLookupKey(alias) === target);
    if (hasAlias) {
      return cityKey;
    }
  }

  return "";
}

function normalizeCityType(input = "") {
  const type = String(input || "city").trim().toLowerCase();
  if (!type) return "city";
  return ALLOWED_CITY_TYPES.has(type) ? type : "";
}

function addUniqueValue(targetArray, value) {
  const nextValue = String(value || "").trim();
  if (!nextValue) {
    return { changed: false, reason: "empty" };
  }

  const targetKey = normalizeLookupKey(nextValue);
  const alreadyExists = targetArray.some(
    (item) => normalizeLookupKey(item) === targetKey,
  );

  if (alreadyExists) {
    return { changed: false, reason: "exists" };
  }

  targetArray.push(nextValue);
  return { changed: true, value: nextValue };
}

function updateArrayValue(targetArray, oldValue, newValue) {
  const oldKey = normalizeLookupKey(oldValue);
  const normalizedNew = String(newValue || "").trim();
  const newKey = normalizeLookupKey(normalizedNew);

  if (!oldKey || !newKey) {
    return { changed: false, reason: "invalid" };
  }

  const targetIndex = targetArray.findIndex(
    (item) => normalizeLookupKey(item) === oldKey,
  );
  if (targetIndex === -1) {
    return { changed: false, reason: "not_found" };
  }

  const duplicateIndex = targetArray.findIndex(
    (item) => normalizeLookupKey(item) === newKey,
  );
  if (duplicateIndex !== -1 && duplicateIndex !== targetIndex) {
    return { changed: false, reason: "duplicate" };
  }

  targetArray[targetIndex] = normalizedNew;
  return { changed: true, value: normalizedNew };
}

function removeArrayValue(targetArray, value) {
  const targetKey = normalizeLookupKey(value);
  if (!targetKey) {
    return { changed: false, reason: "invalid" };
  }

  const index = targetArray.findIndex((item) => normalizeLookupKey(item) === targetKey);
  if (index === -1) {
    return { changed: false, reason: "not_found" };
  }

  const removed = targetArray.splice(index, 1)[0];
  return { changed: true, value: removed };
}

function cloneHierarchy() {
  return JSON.parse(JSON.stringify(LOCATION_HIERARCHY));
}

function restoreHierarchy(snapshot) {
  Object.keys(LOCATION_HIERARCHY).forEach((key) => {
    delete LOCATION_HIERARCHY[key];
  });
  Object.assign(LOCATION_HIERARCHY, snapshot);
}

function persistAndRefresh() {
  saveLocationHierarchy();
  if (typeof areaNormalizer.refreshLocationNormalizationData === "function") {
    areaNormalizer.refreshLocationNormalizationData();
  }
}

function applyMutation(mutator) {
  const snapshot = cloneHierarchy();

  const result = mutator();
  if (!result?.ok) {
    return result?.message || "❌ تعذر تنفيذ العملية";
  }

  try {
    persistAndRefresh();
    return `${result.message}\n\n🔄 تم تحديث LOCATION_HIERARCHY وحفظه بنجاح`;
  } catch (error) {
    restoreHierarchy(snapshot);
    try {
      persistAndRefresh();
    } catch (rollbackError) {
      console.error("❌ Rollback failed after location update error:", rollbackError);
    }
    return `❌ فشل حفظ التعديل: ${error.message || "Unknown error"}`;
  }
}

function buildHelpMessage() {
  return [
    "🗺️ *إدارة LOCATION_HIERARCHY*",
    "",
    "*العرض:*",
    "• مواقع عرض",
    "• مواقع عرض | الأحساء",
    "• مواقع عرض | الأحساء | الهفوف",
    "",
    "*الإضافة (Create):*",
    "• مواقع اضف | محافظة | اسم_المحافظة | المنطقة (اختياري)",
    "• مواقع اضف | مدينة | المحافظة | اسم_المدينة | city",
    "• مواقع اضف | حي | المحافظة | المدينة | اسم_الحي",
    "• مواقع اضف | مرادف | المحافظة | المرادف",
    "• مواقع اضف | مرادف | المحافظة | المدينة | المرادف",
    "",
    "*التعديل (Update):*",
    "• مواقع تعديل | محافظة | القديم | الجديد",
    "• مواقع تعديل | مدينة | المحافظة | القديم | الجديد",
    "• مواقع تعديل | نوع | المحافظة | المدينة | city/town/village/area/bucket",
    "• مواقع تعديل | حي | المحافظة | المدينة | القديم | الجديد",
    "• مواقع تعديل | مرادف | المحافظة | القديم | الجديد",
    "• مواقع تعديل | مرادف | المحافظة | المدينة | القديم | الجديد",
    "",
    "*الحذف (Delete):*",
    "• مواقع حذف | محافظة | اسم_المحافظة",
    "• مواقع حذف | مدينة | المحافظة | اسم_المدينة",
    "• مواقع حذف | حي | المحافظة | المدينة | اسم_الحي",
    "• مواقع حذف | مرادف | المحافظة | المرادف",
    "• مواقع حذف | مرادف | المحافظة | المدينة | المرادف",
    "",
    "💡 استخدم الفاصل | بين العناصر لتجنب أخطاء التحليل",
  ].join("\n");
}

function buildSummaryMessage() {
  const governorates = Object.keys(LOCATION_HIERARCHY);
  const lines = [`📍 *المحافظات الحالية (${governorates.length})*`, ""];

  governorates.forEach((governorateName, index) => {
    const governorateData = LOCATION_HIERARCHY[governorateName] || {};
    const citiesCount = Object.keys(governorateData.cities || {}).length;
    lines.push(`${index + 1}. ${governorateName} (${citiesCount} مدينة)`);
  });

  if (governorates.length === 0) {
    lines.push("لا توجد محافظات حالياً");
  }

  return lines.join("\n");
}

function formatGovernorateDetails(governorateKey) {
  const governorateData = LOCATION_HIERARCHY[governorateKey] || {};
  ensureGovernorateShape(governorateData);

  const cityEntries = Object.entries(governorateData.cities);
  const lines = [`🏛️ *${governorateKey}*`, ""];

  lines.push(`🗺️ *المنطقة:* ${governorateData.region || "غير محددة"}`);

  const aliases = governorateData.aliases || [];
  lines.push(`🔁 *المرادفات (${aliases.length}):* ${aliases.join("، ") || "-"}`);

  lines.push(`🏙️ *المدن (${cityEntries.length}):*`);
  if (cityEntries.length === 0) {
    lines.push("- لا توجد مدن");
  } else {
    cityEntries.slice(0, 50).forEach(([cityName, cityData], index) => {
      ensureCityShape(cityData, cityName);
      lines.push(
        `${index + 1}. ${cityName} (${cityData.type || "city"}) - ${cityData.areas.length} حي`,
      );
    });

    if (cityEntries.length > 50) {
      lines.push(`... وباقي ${cityEntries.length - 50} مدينة`);
    }
  }

  return lines.join("\n");
}

function formatCityDetails(governorateKey, cityKey) {
  const governorateData = LOCATION_HIERARCHY[governorateKey] || {};
  ensureGovernorateShape(governorateData);

  const cityData = governorateData.cities[cityKey] || {};
  ensureCityShape(cityData, cityKey);

  const areas = cityData.areas || [];
  const aliases = cityData.aliases || [];

  const lines = [
    `🏙️ *${cityKey}*`,
    `🏛️ المحافظة: ${governorateKey}`,
    `🏷️ النوع: ${cityData.type || "city"}`,
    `🔁 المرادفات (${aliases.length}): ${aliases.join("، ") || "-"}`,
    `📌 الأحياء (${areas.length}):`,
  ];

  if (areas.length === 0) {
    lines.push("- لا توجد أحياء");
  } else {
    areas.slice(0, 120).forEach((area, index) => {
      lines.push(`${index + 1}. ${area}`);
    });

    if (areas.length > 120) {
      lines.push(`... وباقي ${areas.length - 120} حي`);
    }
  }

  return lines.join("\n");
}

function handleShow(payload = "") {
  const args = parseShowArgs(payload);

  if (args.length === 0) {
    return `${buildSummaryMessage()}\n\n${buildHelpMessage()}`;
  }

  const governorateInput = args[0];
  const governorateKey = findGovernorateKey(governorateInput);

  if (!governorateKey) {
    return `❌ المحافظة غير موجودة: ${governorateInput}`;
  }

  if (args.length === 1) {
    return formatGovernorateDetails(governorateKey);
  }

  const cityInput = args.slice(1).join(" ");
  const governorateData = LOCATION_HIERARCHY[governorateKey] || {};
  ensureGovernorateShape(governorateData);

  const cityKey = findCityKey(governorateData, cityInput);
  if (!cityKey) {
    return `❌ المدينة غير موجودة داخل ${governorateKey}: ${cityInput}`;
  }

  return formatCityDetails(governorateKey, cityKey);
}

function handleAdd(entity, params) {
  if (entity === "governorate") {
    const [newGovernorateName, region = ""] = params;
    if (!newGovernorateName) {
      return "❌ الصيغة: مواقع اضف | محافظة | اسم_المحافظة | المنطقة (اختياري)";
    }

    return applyMutation(() => {
      if (findGovernorateKey(newGovernorateName)) {
        return { ok: false, message: `❌ المحافظة موجودة بالفعل: ${newGovernorateName}` };
      }

      LOCATION_HIERARCHY[newGovernorateName.trim()] = {
        region: String(region || "").trim(),
        aliases: [newGovernorateName.trim()],
        cities: {},
      };

      return { ok: true, message: `✅ تمت إضافة محافظة جديدة: ${newGovernorateName}` };
    });
  }

  if (entity === "city") {
    const [governorateInput, newCityName, cityTypeRaw = "city"] = params;
    if (!governorateInput || !newCityName) {
      return "❌ الصيغة: مواقع اضف | مدينة | المحافظة | اسم_المدينة | city";
    }

    const cityType = normalizeCityType(cityTypeRaw || "city");
    if (!cityType) {
      return "❌ نوع المدينة غير مدعوم. الأنواع: city/town/village/area/bucket";
    }

    return applyMutation(() => {
      const governorateKey = findGovernorateKey(governorateInput);
      if (!governorateKey) {
        return { ok: false, message: `❌ المحافظة غير موجودة: ${governorateInput}` };
      }

      const governorateData = LOCATION_HIERARCHY[governorateKey];
      ensureGovernorateShape(governorateData);

      if (findCityKey(governorateData, newCityName)) {
        return { ok: false, message: `❌ المدينة موجودة بالفعل: ${newCityName}` };
      }

      governorateData.cities[newCityName.trim()] = {
        type: cityType,
        aliases: [newCityName.trim()],
        areas: [],
      };

      return {
        ok: true,
        message: `✅ تمت إضافة مدينة ${newCityName} داخل ${governorateKey}`,
      };
    });
  }

  if (entity === "area") {
    const [governorateInput, cityInput, newAreaName] = params;
    if (!governorateInput || !cityInput || !newAreaName) {
      return "❌ الصيغة: مواقع اضف | حي | المحافظة | المدينة | اسم_الحي";
    }

    return applyMutation(() => {
      const governorateKey = findGovernorateKey(governorateInput);
      if (!governorateKey) {
        return { ok: false, message: `❌ المحافظة غير موجودة: ${governorateInput}` };
      }

      const governorateData = LOCATION_HIERARCHY[governorateKey];
      ensureGovernorateShape(governorateData);

      const cityKey = findCityKey(governorateData, cityInput);
      if (!cityKey) {
        return {
          ok: false,
          message: `❌ المدينة غير موجودة داخل ${governorateKey}: ${cityInput}`,
        };
      }

      const cityData = governorateData.cities[cityKey];
      ensureCityShape(cityData, cityKey);

      const updateResult = addUniqueValue(cityData.areas, newAreaName);
      if (!updateResult.changed) {
        return { ok: false, message: `⚠️ الحي موجود بالفعل: ${newAreaName}` };
      }

      return {
        ok: true,
        message: `✅ تمت إضافة الحي ${newAreaName} داخل ${cityKey}`,
      };
    });
  }

  if (entity === "alias") {
    if (params.length === 2) {
      const [governorateInput, alias] = params;

      return applyMutation(() => {
        const governorateKey = findGovernorateKey(governorateInput);
        if (!governorateKey) {
          return { ok: false, message: `❌ المحافظة غير موجودة: ${governorateInput}` };
        }

        const governorateData = LOCATION_HIERARCHY[governorateKey];
        ensureGovernorateShape(governorateData);

        const updateResult = addUniqueValue(governorateData.aliases, alias);
        if (!updateResult.changed) {
          return { ok: false, message: `⚠️ المرادف موجود بالفعل: ${alias}` };
        }

        return {
          ok: true,
          message: `✅ تمت إضافة مرادف للمحافظة ${governorateKey}: ${alias}`,
        };
      });
    }

    if (params.length >= 3) {
      const [governorateInput, cityInput, alias] = params;

      return applyMutation(() => {
        const governorateKey = findGovernorateKey(governorateInput);
        if (!governorateKey) {
          return { ok: false, message: `❌ المحافظة غير موجودة: ${governorateInput}` };
        }

        const governorateData = LOCATION_HIERARCHY[governorateKey];
        ensureGovernorateShape(governorateData);

        const cityKey = findCityKey(governorateData, cityInput);
        if (!cityKey) {
          return {
            ok: false,
            message: `❌ المدينة غير موجودة داخل ${governorateKey}: ${cityInput}`,
          };
        }

        const cityData = governorateData.cities[cityKey];
        ensureCityShape(cityData, cityKey);

        const updateResult = addUniqueValue(cityData.aliases, alias);
        if (!updateResult.changed) {
          return { ok: false, message: `⚠️ المرادف موجود بالفعل: ${alias}` };
        }

        return {
          ok: true,
          message: `✅ تمت إضافة مرادف لمدينة ${cityKey}: ${alias}`,
        };
      });
    }

    return "❌ الصيغة: مواقع اضف | مرادف | المحافظة | المرادف (أو أضف المدينة قبل المرادف)";
  }

  return `❌ كيان غير مدعوم في الإضافة: ${entity || "غير محدد"}`;
}

function handleEdit(entity, params) {
  if (entity === "governorate") {
    const [oldGovernorateName, newGovernorateName] = params;
    if (!oldGovernorateName || !newGovernorateName) {
      return "❌ الصيغة: مواقع تعديل | محافظة | الاسم_القديم | الاسم_الجديد";
    }

    return applyMutation(() => {
      const oldGovernorateKey = findGovernorateKey(oldGovernorateName);
      if (!oldGovernorateKey) {
        return { ok: false, message: `❌ المحافظة غير موجودة: ${oldGovernorateName}` };
      }

      const nextName = newGovernorateName.trim();
      if (!nextName) {
        return { ok: false, message: "❌ الاسم الجديد غير صالح" };
      }

      const existingGovernorate = findGovernorateKey(nextName);
      if (existingGovernorate && existingGovernorate !== oldGovernorateKey) {
        return { ok: false, message: `❌ يوجد محافظة بنفس الاسم: ${nextName}` };
      }

      if (oldGovernorateKey !== nextName) {
        LOCATION_HIERARCHY[nextName] = LOCATION_HIERARCHY[oldGovernorateKey];
        delete LOCATION_HIERARCHY[oldGovernorateKey];
      }

      const governorateData = LOCATION_HIERARCHY[nextName];
      ensureGovernorateShape(governorateData);
      addUniqueValue(governorateData.aliases, nextName);

      return {
        ok: true,
        message: `✅ تم تعديل اسم المحافظة من ${oldGovernorateKey} إلى ${nextName}`,
      };
    });
  }

  if (entity === "city") {
    const [governorateInput, oldCityName, newCityName] = params;
    if (!governorateInput || !oldCityName || !newCityName) {
      return "❌ الصيغة: مواقع تعديل | مدينة | المحافظة | الاسم_القديم | الاسم_الجديد";
    }

    return applyMutation(() => {
      const governorateKey = findGovernorateKey(governorateInput);
      if (!governorateKey) {
        return { ok: false, message: `❌ المحافظة غير موجودة: ${governorateInput}` };
      }

      const governorateData = LOCATION_HIERARCHY[governorateKey];
      ensureGovernorateShape(governorateData);

      const oldCityKey = findCityKey(governorateData, oldCityName);
      if (!oldCityKey) {
        return {
          ok: false,
          message: `❌ المدينة غير موجودة داخل ${governorateKey}: ${oldCityName}`,
        };
      }

      const nextCityName = newCityName.trim();
      if (!nextCityName) {
        return { ok: false, message: "❌ الاسم الجديد للمدينة غير صالح" };
      }

      const existingCity = findCityKey(governorateData, nextCityName);
      if (existingCity && existingCity !== oldCityKey) {
        return { ok: false, message: `❌ توجد مدينة بنفس الاسم: ${nextCityName}` };
      }

      if (oldCityKey !== nextCityName) {
        governorateData.cities[nextCityName] = governorateData.cities[oldCityKey];
        delete governorateData.cities[oldCityKey];
      }

      const cityData = governorateData.cities[nextCityName];
      ensureCityShape(cityData, nextCityName);
      addUniqueValue(cityData.aliases, nextCityName);

      return {
        ok: true,
        message: `✅ تم تعديل اسم المدينة من ${oldCityKey} إلى ${nextCityName}`,
      };
    });
  }

  if (entity === "type") {
    const [governorateInput, cityInput, typeInput] = params;
    if (!governorateInput || !cityInput || !typeInput) {
      return "❌ الصيغة: مواقع تعديل | نوع | المحافظة | المدينة | النوع";
    }

    const cityType = normalizeCityType(typeInput);
    if (!cityType) {
      return "❌ نوع المدينة غير مدعوم. الأنواع: city/town/village/area/bucket";
    }

    return applyMutation(() => {
      const governorateKey = findGovernorateKey(governorateInput);
      if (!governorateKey) {
        return { ok: false, message: `❌ المحافظة غير موجودة: ${governorateInput}` };
      }

      const governorateData = LOCATION_HIERARCHY[governorateKey];
      ensureGovernorateShape(governorateData);

      const cityKey = findCityKey(governorateData, cityInput);
      if (!cityKey) {
        return {
          ok: false,
          message: `❌ المدينة غير موجودة داخل ${governorateKey}: ${cityInput}`,
        };
      }

      const cityData = governorateData.cities[cityKey];
      ensureCityShape(cityData, cityKey);
      cityData.type = cityType;

      return {
        ok: true,
        message: `✅ تم تعديل نوع ${cityKey} إلى ${cityType}`,
      };
    });
  }

  if (entity === "area") {
    const [governorateInput, cityInput, oldAreaName, newAreaName] = params;
    if (!governorateInput || !cityInput || !oldAreaName || !newAreaName) {
      return "❌ الصيغة: مواقع تعديل | حي | المحافظة | المدينة | القديم | الجديد";
    }

    return applyMutation(() => {
      const governorateKey = findGovernorateKey(governorateInput);
      if (!governorateKey) {
        return { ok: false, message: `❌ المحافظة غير موجودة: ${governorateInput}` };
      }

      const governorateData = LOCATION_HIERARCHY[governorateKey];
      ensureGovernorateShape(governorateData);

      const cityKey = findCityKey(governorateData, cityInput);
      if (!cityKey) {
        return {
          ok: false,
          message: `❌ المدينة غير موجودة داخل ${governorateKey}: ${cityInput}`,
        };
      }

      const cityData = governorateData.cities[cityKey];
      ensureCityShape(cityData, cityKey);

      const updateResult = updateArrayValue(cityData.areas, oldAreaName, newAreaName);
      if (!updateResult.changed) {
        if (updateResult.reason === "duplicate") {
          return {
            ok: false,
            message: `❌ الاسم الجديد موجود بالفعل داخل ${cityKey}: ${newAreaName}`,
          };
        }

        return {
          ok: false,
          message: `❌ لم يتم العثور على الحي: ${oldAreaName}`,
        };
      }

      return {
        ok: true,
        message: `✅ تم تعديل الحي من ${oldAreaName} إلى ${newAreaName}`,
      };
    });
  }

  if (entity === "alias") {
    if (params.length === 3) {
      const [governorateInput, oldAlias, newAlias] = params;

      return applyMutation(() => {
        const governorateKey = findGovernorateKey(governorateInput);
        if (!governorateKey) {
          return { ok: false, message: `❌ المحافظة غير موجودة: ${governorateInput}` };
        }

        const governorateData = LOCATION_HIERARCHY[governorateKey];
        ensureGovernorateShape(governorateData);

        const updateResult = updateArrayValue(governorateData.aliases, oldAlias, newAlias);
        if (!updateResult.changed) {
          if (updateResult.reason === "duplicate") {
            return { ok: false, message: `❌ المرادف الجديد موجود بالفعل: ${newAlias}` };
          }
          return { ok: false, message: `❌ المرادف غير موجود: ${oldAlias}` };
        }

        return {
          ok: true,
          message: `✅ تم تعديل مرادف المحافظة ${governorateKey}`,
        };
      });
    }

    if (params.length >= 4) {
      const [governorateInput, cityInput, oldAlias, newAlias] = params;

      return applyMutation(() => {
        const governorateKey = findGovernorateKey(governorateInput);
        if (!governorateKey) {
          return { ok: false, message: `❌ المحافظة غير موجودة: ${governorateInput}` };
        }

        const governorateData = LOCATION_HIERARCHY[governorateKey];
        ensureGovernorateShape(governorateData);

        const cityKey = findCityKey(governorateData, cityInput);
        if (!cityKey) {
          return {
            ok: false,
            message: `❌ المدينة غير موجودة داخل ${governorateKey}: ${cityInput}`,
          };
        }

        const cityData = governorateData.cities[cityKey];
        ensureCityShape(cityData, cityKey);

        const updateResult = updateArrayValue(cityData.aliases, oldAlias, newAlias);
        if (!updateResult.changed) {
          if (updateResult.reason === "duplicate") {
            return { ok: false, message: `❌ المرادف الجديد موجود بالفعل: ${newAlias}` };
          }
          return { ok: false, message: `❌ المرادف غير موجود: ${oldAlias}` };
        }

        return {
          ok: true,
          message: `✅ تم تعديل مرادف مدينة ${cityKey}`,
        };
      });
    }

    return "❌ الصيغة: مواقع تعديل | مرادف | المحافظة | القديم | الجديد (أو أضف المدينة)";
  }

  return `❌ كيان غير مدعوم في التعديل: ${entity || "غير محدد"}`;
}

function handleDelete(entity, params) {
  if (entity === "governorate") {
    const [governorateInput] = params;
    if (!governorateInput) {
      return "❌ الصيغة: مواقع حذف | محافظة | اسم_المحافظة";
    }

    return applyMutation(() => {
      const governorateKey = findGovernorateKey(governorateInput);
      if (!governorateKey) {
        return { ok: false, message: `❌ المحافظة غير موجودة: ${governorateInput}` };
      }

      delete LOCATION_HIERARCHY[governorateKey];
      return { ok: true, message: `✅ تم حذف المحافظة: ${governorateKey}` };
    });
  }

  if (entity === "city") {
    const [governorateInput, cityInput] = params;
    if (!governorateInput || !cityInput) {
      return "❌ الصيغة: مواقع حذف | مدينة | المحافظة | اسم_المدينة";
    }

    return applyMutation(() => {
      const governorateKey = findGovernorateKey(governorateInput);
      if (!governorateKey) {
        return { ok: false, message: `❌ المحافظة غير موجودة: ${governorateInput}` };
      }

      const governorateData = LOCATION_HIERARCHY[governorateKey];
      ensureGovernorateShape(governorateData);

      const cityKey = findCityKey(governorateData, cityInput);
      if (!cityKey) {
        return {
          ok: false,
          message: `❌ المدينة غير موجودة داخل ${governorateKey}: ${cityInput}`,
        };
      }

      delete governorateData.cities[cityKey];
      return { ok: true, message: `✅ تم حذف المدينة ${cityKey} من ${governorateKey}` };
    });
  }

  if (entity === "area") {
    const [governorateInput, cityInput, areaName] = params;
    if (!governorateInput || !cityInput || !areaName) {
      return "❌ الصيغة: مواقع حذف | حي | المحافظة | المدينة | اسم_الحي";
    }

    return applyMutation(() => {
      const governorateKey = findGovernorateKey(governorateInput);
      if (!governorateKey) {
        return { ok: false, message: `❌ المحافظة غير موجودة: ${governorateInput}` };
      }

      const governorateData = LOCATION_HIERARCHY[governorateKey];
      ensureGovernorateShape(governorateData);

      const cityKey = findCityKey(governorateData, cityInput);
      if (!cityKey) {
        return {
          ok: false,
          message: `❌ المدينة غير موجودة داخل ${governorateKey}: ${cityInput}`,
        };
      }

      const cityData = governorateData.cities[cityKey];
      ensureCityShape(cityData, cityKey);

      const removeResult = removeArrayValue(cityData.areas, areaName);
      if (!removeResult.changed) {
        return { ok: false, message: `❌ الحي غير موجود: ${areaName}` };
      }

      return {
        ok: true,
        message: `✅ تم حذف الحي ${removeResult.value} من ${cityKey}`,
      };
    });
  }

  if (entity === "alias") {
    if (params.length === 2) {
      const [governorateInput, alias] = params;

      return applyMutation(() => {
        const governorateKey = findGovernorateKey(governorateInput);
        if (!governorateKey) {
          return { ok: false, message: `❌ المحافظة غير موجودة: ${governorateInput}` };
        }

        const governorateData = LOCATION_HIERARCHY[governorateKey];
        ensureGovernorateShape(governorateData);

        const removeResult = removeArrayValue(governorateData.aliases, alias);
        if (!removeResult.changed) {
          return { ok: false, message: `❌ المرادف غير موجود: ${alias}` };
        }

        return {
          ok: true,
          message: `✅ تم حذف مرادف المحافظة ${governorateKey}: ${removeResult.value}`,
        };
      });
    }

    if (params.length >= 3) {
      const [governorateInput, cityInput, alias] = params;

      return applyMutation(() => {
        const governorateKey = findGovernorateKey(governorateInput);
        if (!governorateKey) {
          return { ok: false, message: `❌ المحافظة غير موجودة: ${governorateInput}` };
        }

        const governorateData = LOCATION_HIERARCHY[governorateKey];
        ensureGovernorateShape(governorateData);

        const cityKey = findCityKey(governorateData, cityInput);
        if (!cityKey) {
          return {
            ok: false,
            message: `❌ المدينة غير موجودة داخل ${governorateKey}: ${cityInput}`,
          };
        }

        const cityData = governorateData.cities[cityKey];
        ensureCityShape(cityData, cityKey);

        const removeResult = removeArrayValue(cityData.aliases, alias);
        if (!removeResult.changed) {
          return { ok: false, message: `❌ المرادف غير موجود: ${alias}` };
        }

        return {
          ok: true,
          message: `✅ تم حذف مرادف مدينة ${cityKey}: ${removeResult.value}`,
        };
      });
    }

    return "❌ الصيغة: مواقع حذف | مرادف | المحافظة | المرادف (أو أضف المدينة)";
  }

  return `❌ كيان غير مدعوم في الحذف: ${entity || "غير محدد"}`;
}

function handleLocationHierarchyCommand(text = "") {
  const lines = String(text || "")
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return buildHelpMessage();
  }

  const firstLine = lines[0];
  const firstTokens = firstLine.split(/\s+/).filter(Boolean);

  const rootToken = firstTokens[0] || "";
  if (!isLocationHierarchyCommand(rootToken)) {
    return null;
  }

  const actionToken = firstTokens[1] || "";
  const action = normalizeAction(actionToken);

  if (!action) {
    return `${buildSummaryMessage()}\n\n${buildHelpMessage()}`;
  }

  const payload = extractActionPayload(lines, rootToken, actionToken);

  if (action === "show") {
    return handleShow(payload);
  }

  const args = splitPipeArgs(payload);
  if (args.length === 0) {
    return buildHelpMessage();
  }

  const entity = normalizeEntity(args[0]);
  if (!entity) {
    return `❌ كيان غير معروف: ${args[0]}\n\n${buildHelpMessage()}`;
  }

  const params = args.slice(1);

  if (action === "add") {
    return handleAdd(entity, params);
  }

  if (action === "edit") {
    return handleEdit(entity, params);
  }

  if (action === "delete") {
    return handleDelete(entity, params);
  }

  return buildHelpMessage();
}

function getShortHelpLine() {
  return "• مواقع - إدارة LOCATION_HIERARCHY (عرض/إضافة/تعديل/حذف)";
}

module.exports = {
  isLocationHierarchyCommand,
  handleLocationHierarchyCommand,
  getShortHelpLine,
  buildHelpMessage,
  buildSummaryMessage,
  DEFAULT_GOVERNORATE: AL_AHSA_GOVERNORATE,
};
