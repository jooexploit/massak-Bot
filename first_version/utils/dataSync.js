/**
 * Data Synchronization Utility
 * Provides centralized access to shared data folder outside the project
 * Ensures multiple bots can read/write with latest data synchronization
 */

const fs = require("fs");
const path = require("path");

// Data folder is now outside the project in the parent directory
const DATA_DIR = path.join(__dirname, "..", "..", "data");

// Data file paths
const DATA_FILES = {
  ADS: path.join(DATA_DIR, "ads.json"),
  COLLECTIONS: path.join(DATA_DIR, "collections.json"),
  CATEGORIES: path.join(DATA_DIR, "categories.json"),
  RECYCLE_BIN: path.join(DATA_DIR, "recycle_bin.json"),
  SETTINGS: path.join(DATA_DIR, "settings.json"),
  ADMINS: path.join(DATA_DIR, "admins.json"),
  REMINDERS: path.join(DATA_DIR, "reminders.json"),
  PRIVATE_CLIENTS: path.join(DATA_DIR, "private_clients.json"),
  USER_SESSIONS: path.join(DATA_DIR, "user_sessions.json"),
  WASEET_CONTACTS: path.join(DATA_DIR, "waseet_contacts.json"),
  CUSTOM_NUMBERS: path.join(DATA_DIR, "custom_numbers.json"),
  DAILY_SUMMARIES: path.join(DATA_DIR, "daily_summaries.json"),
};

/**
 * Read data from a file synchronously with fresh read
 * @param {string} fileKey - Key from DATA_FILES
 * @param {*} defaultValue - Default value if file doesn't exist
 * @returns {*} Parsed JSON data
 */
function readDataSync(fileKey, defaultValue = null) {
  const filePath = DATA_FILES[fileKey];

  if (!filePath) {
    throw new Error(`Unknown data file key: ${fileKey}`);
  }

  try {
    // Always read from disk to get latest data
    if (!fs.existsSync(filePath)) {
      // Create file with default value if it doesn't exist
      if (defaultValue !== null) {
        writeDataSync(fileKey, defaultValue);
        return defaultValue;
      }
      return null;
    }

    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw || "null");
  } catch (err) {
    console.error(`Error reading ${fileKey}:`, err.message);
    return defaultValue;
  }
}

/**
 * Write data to a file synchronously
 * @param {string} fileKey - Key from DATA_FILES
 * @param {*} data - Data to write (will be JSON.stringify'd)
 */
function writeDataSync(fileKey, data) {
  const filePath = DATA_FILES[fileKey];

  if (!filePath) {
    throw new Error(`Unknown data file key: ${fileKey}`);
  }

  try {
    // Ensure data directory exists
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    // Write data to file
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error(`Error writing ${fileKey}:`, err.message);
    throw err;
  }
}

/**
 * Read data from a file asynchronously with fresh read
 * @param {string} fileKey - Key from DATA_FILES
 * @param {*} defaultValue - Default value if file doesn't exist
 * @returns {Promise<*>} Parsed JSON data
 */
async function readDataAsync(fileKey, defaultValue = null) {
  const filePath = DATA_FILES[fileKey];

  if (!filePath) {
    throw new Error(`Unknown data file key: ${fileKey}`);
  }

  try {
    // Always read from disk to get latest data
    const exists = await fs.promises
      .access(filePath, fs.constants.F_OK)
      .then(() => true)
      .catch(() => false);

    if (!exists) {
      // Create file with default value if it doesn't exist
      if (defaultValue !== null) {
        await writeDataAsync(fileKey, defaultValue);
        return defaultValue;
      }
      return null;
    }

    const raw = await fs.promises.readFile(filePath, "utf8");
    return JSON.parse(raw || "null");
  } catch (err) {
    console.error(`Error reading ${fileKey}:`, err.message);
    return defaultValue;
  }
}

/**
 * Write data to a file asynchronously
 * @param {string} fileKey - Key from DATA_FILES
 * @param {*} data - Data to write (will be JSON.stringify'd)
 */
async function writeDataAsync(fileKey, data) {
  const filePath = DATA_FILES[fileKey];

  if (!filePath) {
    throw new Error(`Unknown data file key: ${fileKey}`);
  }

  try {
    // Ensure data directory exists
    await fs.promises.mkdir(DATA_DIR, { recursive: true });

    // Write data to file
    await fs.promises.writeFile(
      filePath,
      JSON.stringify(data, null, 2),
      "utf8"
    );
  } catch (err) {
    console.error(`Error writing ${fileKey}:`, err.message);
    throw err;
  }
}

/**
 * Get the absolute path to a data file
 * @param {string} fileKey - Key from DATA_FILES
 * @returns {string} Absolute file path
 */
function getFilePath(fileKey) {
  const filePath = DATA_FILES[fileKey];

  if (!filePath) {
    throw new Error(`Unknown data file key: ${fileKey}`);
  }

  return filePath;
}

/**
 * Initialize data directory and default files
 */
function initializeDataDir() {
  try {
    // Ensure data directory exists
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      console.log(`✅ Created data directory: ${DATA_DIR}`);
    }

    // Initialize default files if they don't exist
    const defaults = {
      ADS: [],
      COLLECTIONS: [],
      RECYCLE_BIN: [],
      SETTINGS: { recycleBinDays: 7, excludedGroups: [] },
      PRIVATE_CLIENTS: {},
      USER_SESSIONS: {},
      WASEET_CONTACTS: { waseet: [] },
      CUSTOM_NUMBERS: [],
      DAILY_SUMMARIES: [],
      REMINDERS: [],
      ADMINS: { admins: [] },
      CATEGORIES: [
        { id: "cat_default_1", name: "أرض", color: "#8B4513" },
        { id: "cat_default_2", name: "بيت", color: "#FF6347" },
        { id: "cat_default_3", name: "دبلكس", color: "#4682B4" },
        { id: "cat_default_4", name: "شقة دبلكسية", color: "#9370DB" },
        { id: "cat_default_5", name: "شقة", color: "#3498db" },
        { id: "cat_default_6", name: "عمارة", color: "#DC143C" },
        { id: "cat_default_7", name: "فيلا", color: "#FFD700" },
        { id: "cat_default_8", name: "محطة بنزين", color: "#FF4500" },
        { id: "cat_default_9", name: "محل تجاري", color: "#32CD32" },
        { id: "cat_default_10", name: "مزرعة", color: "#228B22" },
        { id: "cat_default_11", name: "مستودع", color: "#696969" },
        { id: "cat_default_12", name: "شالية", color: "#00CED1" },
        { id: "cat_default_13", name: "استراحة", color: "#20B2AA" },
        { id: "cat_default_14", name: "إيجار", color: "#FF1493" },
        { id: "cat_default_15", name: "طلبات", color: "#00BFFF" },
        { id: "cat_default_16", name: "وظائف", color: "#2ecc71" },
        { id: "cat_default_17", name: "فعاليات", color: "#e74c3c" },
        { id: "cat_default_18", name: "خدمات", color: "#f39c12" },
        { id: "cat_default_19", name: "أخرى", color: "#95a5a6" },
      ],
    };

    Object.keys(defaults).forEach((key) => {
      const filePath = DATA_FILES[key];
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify(defaults[key], null, 2));
        console.log(`✅ Created ${key} file`);
      }
    });

    console.log(`✅ Data directory initialized at: ${DATA_DIR}`);
  } catch (err) {
    console.error("Error initializing data directory:", err);
    throw err;
  }
}

module.exports = {
  DATA_DIR,
  DATA_FILES,
  readDataSync,
  writeDataSync,
  readDataAsync,
  writeDataAsync,
  getFilePath,
  initializeDataDir,
};
