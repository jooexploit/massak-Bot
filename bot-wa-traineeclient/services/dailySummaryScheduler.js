const cron = require("node-cron");
const {
  generateAndSaveDailySummaries,
  getSummaryStats,
} = require("./dailySummaryService");

let scheduledTask = null;

/**
 * Get current KSA time
 */
function getKSATime() {
  // Simply use toLocaleString with Asia/Riyadh timezone
  return new Date().toLocaleString("en-US", { timeZone: "Asia/Riyadh" });
}

/**
 * Get KSA Date object for comparison
 */
function getKSADateObject() {
  const now = new Date();
  // Get time string in KSA timezone
  const ksaTimeString = now.toLocaleString("en-US", {
    timeZone: "Asia/Riyadh",
  });
  // Create date object from that string
  return new Date(ksaTimeString);
}

/**
 * Start the daily summary scheduler
 * Runs at 11:30 PM KSA time every day
 */
function startDailySummaryScheduler() {
  if (scheduledTask) {
    console.log("⚠️ Daily summary scheduler already running");
    return;
  }

  // Check every minute to see if it's 23:30 in KSA time
  scheduledTask = cron.schedule("* * * * *", async () => {
    const ksaDate = getKSADateObject();
    const hours = ksaDate.getHours();
    const minutes = ksaDate.getMinutes();

    // Run at 23:30 KSA time
    if (hours === 23 && minutes === 30) {
      console.log("\n" + "=".repeat(70));
      console.log("📊 DAILY SUMMARY SCHEDULER - Starting");
      console.log(
        "⏰ KSA Time:",
        new Date().toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" })
      );
      console.log("=".repeat(70) + "\n");

      try {
        const result = await generateAndSaveDailySummaries();

        if (result.success) {
          console.log(`✅ Daily summaries generated and saved successfully!`);
          console.log(`📊 Total summaries: ${result.count}`);
          if (result.summaries) {
            result.summaries.forEach((s) => {
              console.log(
                `   - ${s.website}: ${s.categoryName} (${s.adsCount} ads)`
              );
            });
          }
        } else {
          console.error(
            `❌ Failed to generate daily summaries: ${result.error}`
          );
        }
      } catch (error) {
        console.error("❌ Error in daily summary scheduler:", error);
      }

      console.log("\n" + "=".repeat(70));
      console.log("📊 DAILY SUMMARY SCHEDULER - Completed");
      console.log("=".repeat(70) + "\n");
    }
  });

  console.log(
    "✅ Daily summary scheduler started (runs at 11:30 PM KSA time daily)"
  );
  const ksaTimeDisplay = new Date().toLocaleString("ar-SA", {
    timeZone: "Asia/Riyadh",
  });
  console.log(`🕐 Current KSA time: ${ksaTimeDisplay}`);

  // Show current stats
  const stats = getSummaryStats();
  console.log(
    `📊 Summary stats: ${stats.today} summaries today (${stats.todayAdsCount} ads)`
  );
}

/**
 * Stop the daily summary scheduler
 */
function stopDailySummaryScheduler() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    console.log("⏹️ Daily summary scheduler stopped");
  }
}

/**
 * Manually trigger daily summary (for testing or manual runs)
 */
async function triggerDailySummaryNow() {
  console.log("🔧 Manually triggering daily summary...");
  const { generateAndSaveDailySummaries } = require("./dailySummaryService");
  try {
    const result = await generateAndSaveDailySummaries();
    console.log("✅ Manual trigger completed:", result);
    return result;
  } catch (error) {
    console.error("❌ Error in manual trigger:", error);
    throw error;
  }
}

/**
 * Get scheduler status
 */
function getSchedulerStatus() {
  const ksaTimeDisplay = new Date().toLocaleString("ar-SA", {
    timeZone: "Asia/Riyadh",
  });
  return {
    running: scheduledTask !== null,
    schedule: "23:30 KSA Time (UTC+3)",
    currentKSATime: ksaTimeDisplay,
    nextRun: scheduledTask ? "Next run at 11:30 PM KSA time" : "Not scheduled",
  };
}

module.exports = {
  startDailySummaryScheduler,
  stopDailySummaryScheduler,
  triggerDailySummaryNow,
  getSchedulerStatus,
};
