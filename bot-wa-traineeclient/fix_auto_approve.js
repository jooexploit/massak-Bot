const fs = require("fs");
const path = require("path");

const botJsPath = path.join(__dirname, "whatsapp", "bot.js");
let content = fs.readFileSync(botJsPath, "utf8");

// The clean auto-approve code to insert
const cleanAutoApprove = `    // Check if auto-approve is enabled and auto-post to WordPress
    const settings = getSettings();
    if (settings.autoApproveWordPress === true && ad.wpData) {
      console.log(
        "🚀 Auto-approve enabled, posting new ad to WordPress automatically..."
      );

      // Auto-post to WordPress using the SAME function as manual posting
      (async () => {
        try {
          // Import the WordPress posting function from routes
          const { postAdToWordPress } = require("../routes/bot");
          
          console.log("🔵 Starting WordPress auto-post using manual posting function...");
          console.log("🔵 Ad ID:", ad.id);
          
          // Call the same function used for manual posting
          const result = await postAdToWordPress(ad, sock, ad.wpData, false);
          
          if (result.success) {
            console.log("✅ ✅ ✅ Auto-posted to WordPress successfully! ✅ ✅ ✅");
            console.log("📌 Post ID:", result.wordpressPost.id);
            console.log("📌 Short Link:", result.wordpressPost.link);
            
            // Update ad status to "accepted" (not "posted")
            ad.status = "accepted";
            ad.wordpressPostId = result.wordpressPost.id;
            ad.wordpressUrl = result.wordpressPost.link;
            ad.wordpressFullUrl = result.wordpressPost.fullLink;
            ad.whatsappMessage = result.whatsappMessage;
            ad.wpData = result.extractedData;
            
            // Save updated ad
            saveAds();
            console.log("✅ Ad updated with WordPress info and marked as accepted");
          } else {
            console.error("❌ WordPress posting returned unsuccessful result");
          }
        } catch (error) {
          console.error("❌ ❌ ❌ Error during auto-post to WordPress ❌ ❌ ❌");
          console.error("Error message:", error.message);
          console.error("Error details:", error.response?.data || error);
        }
      })();
    } else if (settings.autoApproveWordPress === true && !ad.wpData) {
      console.log(
        "⚠️ Auto-approve enabled but ad has no wpData, skipping auto-post"
      );
    }`;

// Find and replace the first occurrence (after group ad save)
const regex1 =
  /\/\/ Check if auto-approve is enabled and auto-post to WordPress[\s\S]*?else if \(settings\.autoApproveWordPress === true && !ad\.wpData\) \{[\s\S]*?\}\s*\}/;

if (regex1.test(content)) {
  content = content.replace(regex1, cleanAutoApprove);
  console.log("✅ Fixed first auto-approve block (group ads)");
} else {
  console.error("❌ Could not find first auto-approve block");
}

// Now write the fixed content
fs.writeFileSync(botJsPath, content, "utf8");
console.log("✅ File fixed and saved!");
