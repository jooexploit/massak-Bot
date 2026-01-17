const path = require("path");

/**
 * Shared Data Directory Configuration
 *
 * This configuration file defines the path to the shared data directory
 * that can be accessed by multiple bots. The data folder is located
 * outside the main project directory to enable data synchronization
 * between different bot instances.
 *
 * Structure:
 * - Project: /path/to/bot-wa-traineeclient/
 * - Shared Data: /path/to/mostaql-bots-data/
 */

// Get the parent directory of the current project
// This assumes the structure: /path/to/mostaql/bot-wa-traineeclient/
const projectRoot = path.join(__dirname, "..");
const parentDir = path.join(projectRoot, "..");

// Define the shared data directory (outside the project folder)
const SHARED_DATA_DIR = path.join(parentDir, "data");

/**
 * Helper function to get a data file path
 * @param {string} filename - The name of the data file (e.g., "ads.json")
 * @returns {string} - The full path to the data file
 */
function getDataPath(filename) {
  return path.join(SHARED_DATA_DIR, filename);
}

/**
 * Helper function to read JSON data with fresh file reads (no caching)
 * This ensures data is always synchronized between multiple bots
 * @param {string} filepath - Full path to the JSON file
 * @param {*} defaultValue - Default value if file doesn't exist or has errors
 * @returns {*} - Parsed JSON data or default value
 */
function readDataSync(filepath, defaultValue = {}) {
  const fs = require("fs");
  try {
    // Always read fresh from disk - no caching
    delete require.cache[filepath];
    const data = fs.readFileSync(filepath, "utf8");
    return JSON.parse(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      // File doesn't exist, create with default value
      writeDataSync(filepath, defaultValue);
      return defaultValue;
    }
    console.error(`Error reading ${filepath}:`, error.message);
    return defaultValue;
  }
}

/**
 * Helper function to write JSON data
 * @param {string} filepath - Full path to the JSON file
 * @param {*} data - Data to write
 */
function writeDataSync(filepath, data) {
  const fs = require("fs");
  try {
    // Ensure directory exists
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Create backup of existing file before overwriting
    if (fs.existsSync(filepath)) {
      const backupPath = filepath + ".backup";
      try {
        fs.copyFileSync(filepath, backupPath);
      } catch (backupErr) {
        console.warn(
          `⚠️ Warning: Could not create backup for ${filepath}:`,
          backupErr.message,
        );
      }
    }

    // Write with pretty formatting
    const jsonData = JSON.stringify(data, null, 2);
    fs.writeFileSync(filepath, jsonData, "utf8");

    // Verify write was successful by reading back
    const verifyData = fs.readFileSync(filepath, "utf8");
    if (verifyData !== jsonData) {
      throw new Error("Data verification failed after write");
    }
  } catch (error) {
    console.error(`❌ CRITICAL: Error writing ${filepath}:`, error.message);

    // Special handling for disk space errors
    if (error.code === "ENOSPC" || error.message.includes("no space")) {
      console.error(`\n🚨 DISK FULL ERROR DETECTED! 🚨`);
      console.error(`Failed to save ${filepath} - NO DISK SPACE LEFT`);
      console.error(`Data is NOT lost - still in memory`);
      console.error(`Please free up disk space immediately!\n`);

      // Try to restore from backup
      const backupPath = filepath + ".backup";
      if (fs.existsSync(backupPath)) {
        try {
          fs.copyFileSync(backupPath, filePath);
          console.log(`✅ Restored ${filepath} from backup`);
        } catch (restoreErr) {
          console.error(`❌ Could not restore backup:`, restoreErr.message);
        }
      }
    }

    throw error;
  }
}

module.exports = {
  SHARED_DATA_DIR,
  getDataPath,
  readDataSync,
  writeDataSync,
};
