function normalizeGroupJids(groupIds) {
  if (!Array.isArray(groupIds)) return [];

  return [...new Set(
    groupIds
      .filter((groupId) => typeof groupId === "string")
      .map((groupId) => groupId.trim())
      .filter(Boolean),
  )];
}

function getSelectedAutoPostGroups(settingsOrGroupIds) {
  if (Array.isArray(settingsOrGroupIds)) {
    return normalizeGroupJids(settingsOrGroupIds);
  }

  return normalizeGroupJids(
    settingsOrGroupIds?.autoApproveWordPressGroups || [],
  );
}

function hasAutoPostGroupSelection(settingsOrGroupIds) {
  return getSelectedAutoPostGroups(settingsOrGroupIds).length > 0;
}

function isAutoPostAllowedForGroup(settingsOrGroupIds, sourceGroupJid) {
  const selectedGroups = getSelectedAutoPostGroups(settingsOrGroupIds);

  // Backwards compatibility: when nothing is selected, keep legacy behavior.
  if (selectedGroups.length === 0) {
    return true;
  }

  const normalizedSourceGroupJid =
    typeof sourceGroupJid === "string" ? sourceGroupJid.trim() : "";

  return Boolean(
    normalizedSourceGroupJid && selectedGroups.includes(normalizedSourceGroupJid),
  );
}

function isAutoPostGroupSelected(settingsOrGroupIds, sourceGroupJid) {
  const selectedGroups = getSelectedAutoPostGroups(settingsOrGroupIds);
  const normalizedSourceGroupJid =
    typeof sourceGroupJid === "string" ? sourceGroupJid.trim() : "";

  return Boolean(
    selectedGroups.length > 0 &&
      normalizedSourceGroupJid &&
      selectedGroups.includes(normalizedSourceGroupJid),
  );
}

function normalizeCategoryIds(categoryIds) {
  if (!Array.isArray(categoryIds)) return [];

  return categoryIds
    .map((categoryId) => parseInt(categoryId, 10))
    .filter((categoryId) => Number.isInteger(categoryId) && categoryId > 0);
}

function areSameCategoryIds(leftIds, rightIds) {
  const normalizedLeft = [...normalizeCategoryIds(leftIds)].sort((a, b) => a - b);
  const normalizedRight = [...normalizeCategoryIds(rightIds)].sort((a, b) => a - b);

  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }

  return normalizedLeft.every((categoryId, index) => {
    return categoryId === normalizedRight[index];
  });
}

function prepareWpDataForAutoPost(
  baseWpData,
  fixedCategoryIds,
  shouldUseFixedCategory = false,
) {
  const normalizedFixedCategoryIds = normalizeCategoryIds(fixedCategoryIds);
  const safeWpData =
    baseWpData && typeof baseWpData === "object" ? baseWpData : {};
  const preparedWpData = {
    ...safeWpData,
    meta: safeWpData.meta ? { ...safeWpData.meta } : {},
  };

  if (shouldUseFixedCategory && normalizedFixedCategoryIds.length > 0) {
    preparedWpData.categories = [...normalizedFixedCategoryIds];
    preparedWpData.fixedCategoryIds = [...normalizedFixedCategoryIds];
    return preparedWpData;
  }

  delete preparedWpData.fixedCategoryIds;

  if (areSameCategoryIds(preparedWpData.categories, normalizedFixedCategoryIds)) {
    delete preparedWpData.categories;
  }

  return preparedWpData;
}

module.exports = {
  normalizeGroupJids,
  hasAutoPostGroupSelection,
  isAutoPostAllowedForGroup,
  isAutoPostGroupSelected,
  prepareWpDataForAutoPost,
};
