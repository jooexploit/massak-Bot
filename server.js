const express = require("express");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const bodyParser = require("body-parser");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

const authRoutes = require("./routes/auth");
const botRoutes = require("./routes/bot");
const webhookRoutes = require("./routes/webhook");
const { initializeBot } = require("./whatsapp/bot");
const {
  startDailySummaryScheduler,
} = require("./services/dailySummaryScheduler");

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// 🛡️ GLOBAL ERROR HANDLERS (CRITICAL!)
// ============================================
process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Promise Rejection:", reason);
  console.error("Promise:", promise);
  // Don't crash the process - just log the error
});

process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error);
  // Log but don't exit immediately - give time for cleanup
});

// Middleware
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "your-session-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  })
);

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// ============================================
// 📊 DATA EDITOR ROUTES
// ============================================
const DATA_EDIT_DIR = path.join(__dirname, "data_edit");
const CLIENTS_FILE = path.join(DATA_EDIT_DIR, "clients.json");

// Serve data editor UI
app.use("/data", express.static(DATA_EDIT_DIR));

// API: Get clients data
app.get("/api/data/clients", (req, res) => {
  try {
    if (!fs.existsSync(CLIENTS_FILE)) {
      return res.status(404).json({ error: "Clients file not found" });
    }
    const data = fs.readFileSync(CLIENTS_FILE, "utf8");
    res.json(JSON.parse(data));
  } catch (error) {
    console.error("Error reading clients:", error);
    res.status(500).json({ error: "Failed to read clients data" });
  }
});

// API: Save clients data
app.post("/api/data/clients", (req, res) => {
  try {
    const data = req.body;
    if (!data || typeof data !== "object") {
      return res.status(400).json({ error: "Invalid data format" });
    }
    
    // Create backup before saving
    if (fs.existsSync(CLIENTS_FILE)) {
      const backupPath = CLIENTS_FILE.replace(".json", `_backup_${Date.now()}.json`);
      fs.copyFileSync(CLIENTS_FILE, backupPath);
      console.log(`📦 Backup created: ${backupPath}`);
    }
    
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify(data, null, 2), "utf8");
    console.log("✅ Clients data saved successfully");
    res.json({ success: true, message: "Data saved successfully" });
  } catch (error) {
    console.error("Error saving clients:", error);
    res.status(500).json({ error: "Failed to save clients data" });
  }
});

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/bot", botRoutes);
app.use("/api/webhook", webhookRoutes);

// Root route
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});


// Initialize WhatsApp Bot once (singleton guard)
if (!app.get("botInitialized")) {
  app.set("botInitialized", true);
  console.log("🤖 Initializing WhatsApp bot...");
  initializeBot()
    .then((sock) => {
      // Store WhatsApp socket in app for routes to access
      if (sock) {
        app.set("whatsappSock", sock);
        console.log("✅ WhatsApp socket stored in app");
      } else {
        console.warn(
          "⚠️ Bot initialization returned null - bot may not be connected"
        );
      }
    })
    .catch((err) => {
      console.error("❌ Failed to initialize bot:", err);
      console.log(
        "⚠️ Server will continue running, but bot features may be unavailable"
      );
    });

  // Start the daily summary scheduler (independent of WhatsApp connection)
  console.log("📊 Starting daily summary scheduler...");
  startDailySummaryScheduler();
} else {
  console.log("⚠️ Bot already initialized, skipping duplicate start.");
}

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
  console.log(`Dashboard available at http://0.0.0.0:${PORT}`);
  console.log(`✅ Server accessible from external networks`);
});
