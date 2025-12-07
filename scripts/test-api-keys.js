/**
 * API Key Test Script
 * Tests all configured Gemini API keys to check their status
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");
const path = require("path");

const SETTINGS_FILE = path.join(__dirname, "..", "data", "settings.json");

// Load settings
function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    }
  } catch (error) {
    console.error("Error loading settings:", error);
  }
  return { geminiApiKeys: [] };
}

// Test a single API key
async function testApiKey(keyObj) {
  const startTime = Date.now();
  
  try {
    const genAI = new GoogleGenerativeAI(keyObj.key);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
    
    // Simple test prompt
    const result = await model.generateContent("Say 'API OK' in 2 words max.");
    const response = await result.response;
    const text = response.text().trim();
    
    const duration = Date.now() - startTime;
    
    return {
      name: keyObj.name,
      priority: keyObj.priority,
      enabled: keyObj.enabled,
      status: "✅ WORKING",
      response: text.substring(0, 50),
      duration: `${duration}ms`,
      error: null,
      canUse: true
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error.message || error.toString();
    
    // Determine error type
    let status = "❌ FAILED";
    let canUse = false;
    
    if (errorMessage.includes("429") || errorMessage.includes("quota")) {
      status = "🔴 QUOTA EXHAUSTED (Free tier limit reached)";
    } else if (errorMessage.includes("403") || errorMessage.includes("Forbidden")) {
      status = "🟠 FORBIDDEN (Key may be leaked/flagged)";
    } else if (errorMessage.includes("401") || errorMessage.includes("API key not valid")) {
      status = "⛔ INVALID API KEY";
    } else if (errorMessage.includes("503") || errorMessage.includes("overloaded")) {
      status = "⚠️ SERVICE OVERLOADED (Temporary)";
      canUse = true; // Can retry later
    }
    
    return {
      name: keyObj.name,
      priority: keyObj.priority,
      enabled: keyObj.enabled,
      status: status,
      response: null,
      duration: `${duration}ms`,
      error: errorMessage.substring(0, 200),
      canUse: canUse
    };
  }
}

// Main test function
async function testAllKeys() {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║             🔑 GEMINI API KEYS TEST REPORT                     ║");
  console.log("╠════════════════════════════════════════════════════════════════╣");
  console.log(`║ Test Time: ${new Date().toISOString()}          ║`);
  console.log("╚════════════════════════════════════════════════════════════════╝\n");
  
  const settings = loadSettings();
  const allKeys = settings.geminiApiKeys || [];
  const enabledKeys = allKeys.filter(k => k.enabled).sort((a, b) => a.priority - b.priority);
  
  if (allKeys.length === 0) {
    console.log("❌ No API keys configured!");
    console.log("   Add API keys in Dashboard → Settings → Gemini API Keys Management");
    return;
  }
  
  console.log(`📊 Total Keys: ${allKeys.length} | Enabled: ${enabledKeys.length} | Disabled: ${allKeys.length - enabledKeys.length}\n`);
  
  // Test enabled keys
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("                     TESTING ENABLED KEYS                          ");
  console.log("═══════════════════════════════════════════════════════════════════\n");
  
  const results = [];
  
  for (const keyObj of enabledKeys) {
    console.log(`⏳ Testing: ${keyObj.name} (Priority: ${keyObj.priority})...`);
    const result = await testApiKey(keyObj);
    results.push(result);
    
    console.log(`   ${result.status}`);
    if (result.response) {
      console.log(`   Response: "${result.response}" (${result.duration})`);
    }
    if (result.error) {
      console.log(`   Error: ${result.error.substring(0, 100)}...`);
    }
    console.log("");
    
    // Small delay between tests to avoid rate limiting the tests themselves
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // Summary
  console.log("\n═══════════════════════════════════════════════════════════════════");
  console.log("                         SUMMARY                                   ");
  console.log("═══════════════════════════════════════════════════════════════════\n");
  
  const workingKeys = results.filter(r => r.canUse);
  const exhaustedKeys = results.filter(r => r.status.includes("QUOTA EXHAUSTED"));
  const forbiddenKeys = results.filter(r => r.status.includes("FORBIDDEN"));
  const invalidKeys = results.filter(r => r.status.includes("INVALID"));
  
  console.log(`✅ Working Keys:       ${workingKeys.length}/${enabledKeys.length}`);
  console.log(`🔴 Quota Exhausted:    ${exhaustedKeys.length}/${enabledKeys.length}`);
  console.log(`🟠 Forbidden/Leaked:   ${forbiddenKeys.length}/${enabledKeys.length}`);
  console.log(`⛔ Invalid:            ${invalidKeys.length}/${enabledKeys.length}`);
  
  // Show request counts
  console.log("\n───────────────────────────────────────────────────────────────────");
  console.log("                   REQUEST HISTORY                                 ");
  console.log("───────────────────────────────────────────────────────────────────\n");
  
  for (const keyObj of enabledKeys) {
    const requestCount = keyObj.requestCount || 0;
    const lastError = keyObj.lastError 
      ? `Last Error: ${new Date(keyObj.lastError.timestamp).toLocaleString()}`
      : "No recent errors";
    
    console.log(`📌 ${keyObj.name}: ${requestCount} requests | ${lastError}`);
  }
  
  // Recommendations
  console.log("\n═══════════════════════════════════════════════════════════════════");
  console.log("                    RECOMMENDATIONS                                ");
  console.log("═══════════════════════════════════════════════════════════════════\n");
  
  if (exhaustedKeys.length === enabledKeys.length) {
    console.log("⚠️  ALL KEYS EXHAUSTED! Your bot cannot process AI requests.\n");
    console.log("   Solutions:");
    console.log("   1. Wait until quotas reset (usually midnight UTC)");
    console.log("   2. Add more API keys from different Google Cloud projects");
    console.log("   3. Upgrade to a paid Gemini API plan for higher quotas");
    console.log("   4. Create new free API keys from: https://aistudio.google.com/app/apikey");
    console.log("");
    console.log("   💡 Free tier limits:");
    console.log("      - 1,500 requests per day per model per project");
    console.log("      - 15 requests per minute per model per project");
    console.log("      - 1,000,000 tokens per minute per model per project");
  } else if (exhaustedKeys.length > 0) {
    console.log(`⚠️  ${exhaustedKeys.length} key(s) exhausted. Consider adding more keys.`);
    console.log("   Working keys will handle requests, but may exhaust soon.");
  } else {
    console.log("✅ All keys are working! Your bot should function normally.");
  }
  
  if (forbiddenKeys.length > 0) {
    console.log("\n🟠 Some keys returned 403 Forbidden:");
    console.log("   - These keys may have been flagged as leaked");
    console.log("   - Delete and create new keys from Google AI Studio");
  }
  
  if (invalidKeys.length > 0) {
    console.log("\n⛔ Some keys are invalid:");
    console.log("   - Check if keys were copied correctly");
    console.log("   - Regenerate keys from Google AI Studio");
  }
  
  console.log("\n═══════════════════════════════════════════════════════════════════");
  console.log("                       TEST COMPLETE                               ");
  console.log("═══════════════════════════════════════════════════════════════════\n");
  
  return results;
}

// Run the test
testAllKeys()
  .then(() => {
    process.exit(0);
  })
  .catch(error => {
    console.error("Test failed:", error);
    process.exit(1);
  });
