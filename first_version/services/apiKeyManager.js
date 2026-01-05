/**
 * API Key Manager Service
 * Unified management for GPT and Gemini API keys
 * Handles priority queue, rotation, status tracking, and provider routing
 */

const fs = require("fs");
const path = require("path");
const { getDataPath } = require("../config/dataPath");

const SETTINGS_FILE = getDataPath("settings.json");

// Provider constants
const PROVIDERS = {
  GEMINI: "gemini",
  GPT: "gpt",
};

// Model configurations for each provider
const MODEL_CONFIG = {
  [PROVIDERS.GEMINI]: {
    default: "gemini-2.0-flash-lite",
    efficient: "gemini-2.0-flash-lite", // Most token-efficient
    powerful: "gemini-2.5-flash",
    endpoint: "https://generativelanguage.googleapis.com/v1beta",
  },
  [PROVIDERS.GPT]: {
    default: "gpt-4o-mini",
    efficient: "gpt-4o-mini", // Most token-efficient for dashboard
    powerful: "gpt-4o",
    endpoint: "https://api.openai.com/v1",
  },
};

/**
 * Load settings from file
 */
function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    }
  } catch (error) {
    console.error("Error loading settings:", error);
  }
  return {
    geminiApiKeys: [],
    gptApiKeys: [],
    currentGeminiKeyIndex: 0,
    currentGptKeyIndex: 0,
  };
}

/**
 * Save settings to file
 */
function saveSettings(settings) {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch (error) {
    console.error("Error saving settings:", error);
  }
}

/**
 * Get all API keys for a specific provider
 * @param {string} provider - 'gemini' or 'gpt'
 * @returns {Array} Array of API keys
 */
function getKeysByProvider(provider) {
  const settings = loadSettings();
  if (provider === PROVIDERS.GEMINI) {
    return settings.geminiApiKeys || [];
  } else if (provider === PROVIDERS.GPT) {
    return settings.gptApiKeys || [];
  }
  return [];
}

/**
 * Get all API keys combined (for status display)
 */
function getAllApiKeys() {
  const settings = loadSettings();
  const geminiKeys = (settings.geminiApiKeys || []).map((k) => ({
    ...k,
    provider: PROVIDERS.GEMINI,
  }));
  const gptKeys = (settings.gptApiKeys || []).map((k) => ({
    ...k,
    provider: PROVIDERS.GPT,
  }));
  return [...geminiKeys, ...gptKeys];
}

/**
 * Get enabled keys for a provider sorted by priority
 * @param {string} provider - 'gemini' or 'gpt'
 */
function getEnabledKeysByProvider(provider) {
  const keys = getKeysByProvider(provider);
  return keys.filter((k) => k.enabled).sort((a, b) => a.priority - b.priority);
}

/**
 * Get the current active API key for a provider
 * @param {string} provider - 'gemini' or 'gpt'
 */
function getActiveApiKey(provider) {
  const settings = loadSettings();
  const enabledKeys = getEnabledKeysByProvider(provider);

  if (enabledKeys.length === 0) {
    console.error(`❌ No enabled ${provider.toUpperCase()} API keys found!`);
    return null;
  }

  const indexKey =
    provider === PROVIDERS.GEMINI
      ? "currentGeminiKeyIndex"
      : "currentGptKeyIndex";
  let currentIndex = settings[indexKey] || 0;

  if (currentIndex >= enabledKeys.length) {
    currentIndex = 0;
  }

  return {
    key: enabledKeys[currentIndex].key,
    keyData: enabledKeys[currentIndex],
    currentIndex,
    enabledKeys,
    provider,
    model: MODEL_CONFIG[provider].efficient,
    endpoint: MODEL_CONFIG[provider].endpoint,
  };
}

/**
 * Switch to the next API key for a provider
 * @param {string} provider - 'gemini' or 'gpt'
 */
function switchToNextKey(provider) {
  const settings = loadSettings();
  const enabledKeys = getEnabledKeysByProvider(provider);

  if (enabledKeys.length <= 1) {
    console.warn(`⚠️ No other ${provider.toUpperCase()} API keys to switch to`);
    return null;
  }

  const indexKey =
    provider === PROVIDERS.GEMINI
      ? "currentGeminiKeyIndex"
      : "currentGptKeyIndex";
  settings[indexKey] = ((settings[indexKey] || 0) + 1) % enabledKeys.length;
  saveSettings(settings);

  console.log(
    `🔄 Switched to ${provider.toUpperCase()} API key #${
      settings[indexKey] + 1
    }: ${enabledKeys[settings[indexKey]].name}`
  );
  return enabledKeys[settings[indexKey]];
}

/**
 * Update key statistics (request count, errors)
 * @param {string} provider - 'gemini' or 'gpt'
 * @param {string} keyId - The key ID
 * @param {Error|null} error - Error if request failed
 */
function updateKeyStats(provider, keyId, error = null) {
  const settings = loadSettings();
  const keysArray =
    provider === PROVIDERS.GEMINI ? "geminiApiKeys" : "gptApiKeys";

  const key = (settings[keysArray] || []).find((k) => k.id === keyId);
  if (key) {
    key.requestCount = (key.requestCount || 0) + 1;
    key.lastUsed = Date.now();

    if (error) {
      key.lastError = {
        message: error.message || error.toString(),
        timestamp: Date.now(),
      };
    } else {
      // Clear error on success
      key.lastError = null;
    }

    saveSettings(settings);
  }
}

/**
 * Add a new API key
 * @param {Object} keyData - Key data including provider, name, key value
 */
function addApiKey(keyData) {
  const settings = loadSettings();
  const { provider, name, key } = keyData;

  const keysArray =
    provider === PROVIDERS.GEMINI ? "geminiApiKeys" : "gptApiKeys";
  if (!settings[keysArray]) {
    settings[keysArray] = [];
  }

  const newKey = {
    id: `key_${Date.now()}`,
    name: name,
    key: key,
    provider: provider,
    priority: settings[keysArray].length + 1,
    enabled: true,
    requestCount: 0,
    lastError: null,
    lastUsed: null,
    createdAt: Date.now(),
  };

  settings[keysArray].push(newKey);
  saveSettings(settings);

  return newKey;
}

/**
 * Update an existing API key
 * @param {string} keyId - The key ID
 * @param {Object} updates - Fields to update
 */
function updateApiKey(keyId, updates) {
  const settings = loadSettings();

  // Search in both arrays
  let key = (settings.geminiApiKeys || []).find((k) => k.id === keyId);
  let keysArray = "geminiApiKeys";

  if (!key) {
    key = (settings.gptApiKeys || []).find((k) => k.id === keyId);
    keysArray = "gptApiKeys";
  }

  if (!key) {
    return { success: false, error: "Key not found" };
  }

  // Handle provider change
  if (updates.provider && updates.provider !== key.provider) {
    // Remove from current array
    settings[keysArray] = settings[keysArray].filter((k) => k.id !== keyId);

    // Add to new provider array
    const newKeysArray =
      updates.provider === PROVIDERS.GEMINI ? "geminiApiKeys" : "gptApiKeys";
    if (!settings[newKeysArray]) {
      settings[newKeysArray] = [];
    }

    key.provider = updates.provider;
    key.priority = settings[newKeysArray].length + 1;
    settings[newKeysArray].push(key);
  }

  // Apply other updates
  Object.keys(updates).forEach((field) => {
    if (field !== "provider" && field !== "id") {
      key[field] = updates[field];
    }
  });

  saveSettings(settings);
  return { success: true, key };
}

/**
 * Delete an API key
 * @param {string} keyId - The key ID
 */
function deleteApiKey(keyId) {
  const settings = loadSettings();

  // Search and remove from both arrays
  const geminiIndex = (settings.geminiApiKeys || []).findIndex(
    (k) => k.id === keyId
  );
  const gptIndex = (settings.gptApiKeys || []).findIndex((k) => k.id === keyId);

  if (geminiIndex !== -1) {
    settings.geminiApiKeys.splice(geminiIndex, 1);
    // Re-assign priorities
    settings.geminiApiKeys.forEach((k, i) => {
      k.priority = i + 1;
    });
  } else if (gptIndex !== -1) {
    settings.gptApiKeys.splice(gptIndex, 1);
    // Re-assign priorities
    settings.gptApiKeys.forEach((k, i) => {
      k.priority = i + 1;
    });
  } else {
    return { success: false, error: "Key not found" };
  }

  saveSettings(settings);
  return { success: true };
}

/**
 * Update priorities for keys after drag/drop reorder
 * @param {string} provider - 'gemini' or 'gpt'
 * @param {Array} keyIds - Ordered array of key IDs
 */
function updateKeyPriorities(provider, keyIds) {
  const settings = loadSettings();
  const keysArray =
    provider === PROVIDERS.GEMINI ? "geminiApiKeys" : "gptApiKeys";

  keyIds.forEach((id, index) => {
    const key = (settings[keysArray] || []).find((k) => k.id === id);
    if (key) {
      key.priority = index + 1;
    }
  });

  saveSettings(settings);
  return { success: true };
}

/**
 * Get comprehensive status of all API keys
 */
function getApiKeysStatus() {
  const settings = loadSettings();
  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;

  const processKeys = (keys, provider) => {
    const enabledKeys = keys.filter((k) => k.enabled);
    let exhaustedCount = 0;
    let workingCount = 0;

    const details = enabledKeys.map((key) => {
      const isExhausted =
        key.lastError &&
        key.lastError.message &&
        (key.lastError.message.includes("429") ||
          key.lastError.message.includes("quota") ||
          key.lastError.message.includes("rate limit")) &&
        now - key.lastError.timestamp < ONE_DAY;

      if (isExhausted) {
        exhaustedCount++;
      } else {
        workingCount++;
      }

      return {
        id: key.id,
        name: key.name,
        provider: provider,
        priority: key.priority,
        requestCount: key.requestCount || 0,
        isExhausted,
        lastUsed: key.lastUsed,
        lastError: key.lastError
          ? {
              message: key.lastError.message.substring(0, 100),
              timestamp: key.lastError.timestamp,
            }
          : null,
      };
    });

    return {
      totalKeys: enabledKeys.length,
      workingKeys: workingCount,
      exhaustedKeys: exhaustedCount,
      allExhausted:
        enabledKeys.length > 0 && exhaustedCount === enabledKeys.length,
      details,
    };
  };

  const geminiStatus = processKeys(
    settings.geminiApiKeys || [],
    PROVIDERS.GEMINI
  );
  const gptStatus = processKeys(settings.gptApiKeys || [], PROVIDERS.GPT);

  return {
    gemini: geminiStatus,
    gpt: gptStatus,
    combined: {
      totalKeys: geminiStatus.totalKeys + gptStatus.totalKeys,
      workingKeys: geminiStatus.workingKeys + gptStatus.workingKeys,
      exhaustedKeys: geminiStatus.exhaustedKeys + gptStatus.exhaustedKeys,
      allExhausted: geminiStatus.allExhausted && gptStatus.allExhausted,
      details: [...geminiStatus.details, ...gptStatus.details],
    },
  };
}

/**
 * Retry mechanism with API key rotation for a specific provider
 * @param {string} provider - 'gemini' or 'gpt'
 * @param {Function} operation - Async function to execute
 * @param {string} operationName - Name for logging
 * @param {number} maxRetries - Max retry attempts
 */
async function retryWithKeyRotation(
  provider,
  operation,
  operationName = "AI operation",
  maxRetries = null
) {
  const enabledKeys = getEnabledKeysByProvider(provider);

  if (enabledKeys.length === 0) {
    throw new Error(
      `❌ No enabled ${provider.toUpperCase()} API keys available`
    );
  }

  const totalRetries = maxRetries || enabledKeys.length;
  let lastError = null;
  let attemptCount = 0;
  let currentRotationIndex = 0;

  console.log(
    `🔄 Starting ${operationName} with ${
      enabledKeys.length
    } available ${provider.toUpperCase()} API keys`
  );

  for (let i = 0; i < totalRetries; i++) {
    try {
      attemptCount++;
      const currentKey = enabledKeys[currentRotationIndex];

      console.log(
        `🔑 [${provider.toUpperCase()}] Attempt ${attemptCount}/${totalRetries} - Using key: ${
          currentKey.name
        } (Priority: ${currentKey.priority})`
      );

      const result = await operation(
        currentKey.key,
        currentKey,
        currentRotationIndex
      );

      console.log(
        `✅ ${operationName} succeeded with ${provider.toUpperCase()} key: ${
          currentKey.name
        }`
      );
      updateKeyStats(provider, currentKey.id, null);

      return result;
    } catch (error) {
      lastError = error;
      const errorMessage = error.message || error.toString();
      const currentKey = enabledKeys[currentRotationIndex];

      const isOverloadError =
        error.status === 503 ||
        errorMessage.includes("overloaded") ||
        errorMessage.includes("503");
      const isRateLimitError =
        error.status === 429 ||
        errorMessage.includes("429") ||
        errorMessage.includes("rate limit") ||
        errorMessage.includes("Resource exhausted") ||
        errorMessage.includes("quota");
      const isAuthError =
        error.status === 401 ||
        error.status === 403 ||
        errorMessage.includes("401") ||
        errorMessage.includes("403") ||
        errorMessage.includes("invalid") ||
        errorMessage.includes("Unauthorized");

      console.error(
        `❌ [${provider.toUpperCase()}] Attempt ${attemptCount} failed:`,
        errorMessage
      );

      updateKeyStats(provider, currentKey.id, error);

      if (i < totalRetries - 1) {
        if (isOverloadError || isRateLimitError || isAuthError) {
          console.log(
            `⚠️ ${provider.toUpperCase()} key issue, switching to next key...`
          );
          currentRotationIndex =
            (currentRotationIndex + 1) % enabledKeys.length;

          const delayMs = Math.min(1000 * Math.pow(2, i), 10000);
          console.log(`⏳ Waiting ${delayMs}ms before retry...`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        } else {
          throw error;
        }
      }
    }
  }

  console.error(
    `💥 ${operationName} failed after ${attemptCount} attempts with all ${provider.toUpperCase()} API keys`
  );
  throw lastError;
}

/**
 * Smart provider selection - get the next provider to use based on round-robin or priority
 * @param {string} preferredProvider - Optional preferred provider
 */
function selectProvider(preferredProvider = null) {
  const settings = loadSettings();
  const geminiEnabled = getEnabledKeysByProvider(PROVIDERS.GEMINI).length > 0;
  const gptEnabled = getEnabledKeysByProvider(PROVIDERS.GPT).length > 0;

  // If preferred provider is specified and available, use it
  if (preferredProvider) {
    if (preferredProvider === PROVIDERS.GEMINI && geminiEnabled) {
      return PROVIDERS.GEMINI;
    }
    if (preferredProvider === PROVIDERS.GPT && gptEnabled) {
      return PROVIDERS.GPT;
    }
  }

  // If only one provider is available, use it
  if (geminiEnabled && !gptEnabled) return PROVIDERS.GEMINI;
  if (gptEnabled && !geminiEnabled) return PROVIDERS.GPT;
  if (!geminiEnabled && !gptEnabled) return null;

  // Both available - use round-robin based on last turn
  const lastTurn = settings.lastProviderTurn || PROVIDERS.GPT;
  const nextTurn =
    lastTurn === PROVIDERS.GEMINI ? PROVIDERS.GPT : PROVIDERS.GEMINI;

  settings.lastProviderTurn = nextTurn;
  saveSettings(settings);

  return nextTurn;
}

/**
 * Get model configuration for a provider
 * @param {string} provider - 'gemini' or 'gpt'
 * @param {string} modelType - 'efficient', 'default', or 'powerful'
 */
function getModelConfig(provider, modelType = "efficient") {
  const config = MODEL_CONFIG[provider];
  if (!config) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  return {
    model: config[modelType] || config.default,
    endpoint: config.endpoint,
  };
}

module.exports = {
  PROVIDERS,
  MODEL_CONFIG,
  loadSettings,
  saveSettings,
  getKeysByProvider,
  getAllApiKeys,
  getEnabledKeysByProvider,
  getActiveApiKey,
  switchToNextKey,
  updateKeyStats,
  addApiKey,
  updateApiKey,
  deleteApiKey,
  updateKeyPriorities,
  getApiKeysStatus,
  retryWithKeyRotation,
  selectProvider,
  getModelConfig,
};
