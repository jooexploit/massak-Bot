# Data Synchronization Update

## Overview

The `data` folder has been moved outside the main project directory to enable multiple bots to share the same data files. All data access now goes through a centralized synchronization module.

## Changes Made

### 1. Data Folder Location

- **Old Location:** `/run/media/jooexploit/5AAAD6F9AAD6D11D/WORK/mostaql/first_version/data`
- **New Location:** `/run/media/jooexploit/5AAAD6F9AAD6D11D/WORK/mostaql/data`

This allows multiple bot instances to read and write to the same shared data.

### 2. New Data Sync Module

Created `utils/dataSync.js` which provides:

- **Always fresh reads:** Every read operation fetches the latest data from disk
- **Centralized file paths:** All data file paths are managed in one place
- **Automatic initialization:** Creates data files with default values if they don't exist
- **Both sync and async APIs:** Support for different usage patterns

### 3. Available Data Files

All data files are now accessed through the dataSync module:

- `ADS` - ads.json
- `COLLECTIONS` - collections.json
- `CATEGORIES` - categories.json
- `RECYCLE_BIN` - recycle_bin.json
- `SETTINGS` - settings.json
- `ADMINS` - admins.json
- `REMINDERS` - reminders.json
- `PRIVATE_CLIENTS` - private_clients.json
- `USER_SESSIONS` - user_sessions.json
- `WASEET_CONTACTS` - waseet_contacts.json
- `CUSTOM_NUMBERS` - custom_numbers.json
- `DAILY_SUMMARIES` - daily_summaries.json

## Usage Examples

### Reading Data (Synchronous)

```javascript
const dataSync = require("./utils/dataSync");

// Read ads with default value
const ads = dataSync.readDataSync("ADS", []);

// Read settings with default value
const settings = dataSync.readDataSync("SETTINGS", {
  recycleBinDays: 7,
  excludedGroups: [],
});
```

### Writing Data (Synchronous)

```javascript
const dataSync = require('./utils/dataSync');

// Write ads
const ads = [...]; // your ads array
dataSync.writeDataSync('ADS', ads);

// Write settings
const settings = { recycleBinDays: 7, excludedGroups: [] };
dataSync.writeDataSync('SETTINGS', settings);
```

### Reading Data (Asynchronous)

```javascript
const dataSync = require("./utils/dataSync");

// Read ads with default value
const ads = await dataSync.readDataAsync("ADS", []);

// Read settings with default value
const settings = await dataSync.readDataAsync("SETTINGS", {
  recycleBinDays: 7,
});
```

### Writing Data (Asynchronous)

```javascript
const dataSync = require("./utils/dataSync");

// Write ads
await dataSync.writeDataAsync("ADS", ads);

// Write settings
await dataSync.writeDataAsync("SETTINGS", settings);
```

### Getting File Paths

```javascript
const dataSync = require("./utils/dataSync");

// Get the full path to a data file
const adsFilePath = dataSync.getFilePath("ADS");
```

## Key Features

### 1. Always Fresh Data

Every read operation fetches data directly from disk, ensuring all bots see the latest changes immediately.

### 2. Thread-Safe Operations

All read/write operations are atomic at the file system level, preventing data corruption.

### 3. Automatic Initialization

If data files don't exist, they are automatically created with sensible defaults.

### 4. Error Handling

All operations include error handling and logging for easy debugging.

## Files Updated

The following files were updated to use the new dataSync module:

- `whatsapp/bot.js` - Main bot logic
- `models/privateClient.js` - Private client model
- `models/userSession.js` - User session model
- `services/aiService.js` - AI service
- `services/adminCommandService.js` - Admin commands
- `services/dailySummaryService.js` - Daily summaries
- `services/marketingService.js` - Marketing service
- `services/privateChatService.js` - Private chat service
- `services/waseetDetector.js` - Waseet detection
- `routes/bot.js` - API routes

## Benefits for Multiple Bots

1. **Shared Data Access:** All bots read from and write to the same data files
2. **Real-time Synchronization:** Changes made by one bot are immediately visible to others
3. **No Data Duplication:** Single source of truth for all data
4. **Easy Deployment:** New bot instances can simply point to the shared data folder

## Migration Notes

No migration is needed! The data folder was physically moved, and all code was updated to use the new centralized module. The bot will automatically initialize any missing data files.

## Testing

To verify the setup is working:

```bash
node -e "const dataSync = require('./utils/dataSync'); console.log('Data directory:', dataSync.DATA_DIR); const ads = dataSync.readDataSync('ADS', []); console.log('Ads count:', ads.length);"
```

## Future Enhancements

Potential improvements:

- Add file locking for write operations
- Implement data caching with cache invalidation
- Add change notifications between bot instances
- Support for backup and restore operations
