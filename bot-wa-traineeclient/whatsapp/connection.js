const makeWASocket = require("@whiskeysockets/baileys").default;
const {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const P = require("pino");
const QRCode = require("qrcode");
const fs = require("fs");
const path = require("path");

let sock;
let qrCodeData = null;
let connectionStatus = "disconnected";
let reconnectAttempts = 0;
const maxReconnectAttempts = 10;
let isReconnecting = false;
let reconnectTimeout = null;

// Auth state that persists across reconnections
let authState = null;
let saveCreds = null;

/**
 * Connect to WhatsApp using Baileys
 * This function is called recursively on disconnect (as per Baileys docs pattern)
 */
async function connectToWhatsApp() {
  try {
    // Clear reconnect flag
    isReconnecting = false;

    console.log("🚀 Connecting to WhatsApp...");

    // Initialize auth state only once
    if (!authState) {
      const auth = await useMultiFileAuthState("auth_info_baileys");
      authState = auth.state;
      saveCreds = auth.saveCreds;
      console.log("✅ Auth state initialized");
    }

    const { version } = await fetchLatestBaileysVersion();

    // Create socket
    sock = makeWASocket({
      version,
      logger: P({ level: "silent" }),
      auth: authState,
      printQRInTerminal: false,
      browser: ["WhatsApp Bot", "Chrome", "1.0.0"],
      markOnlineOnConnect: true,
      syncFullHistory: false,
      getMessage: async (key) => undefined, // Required for proper retry handling
    });

    // Register creds.update handler (called when credentials change)
    sock.ev.on("creds.update", saveCreds);

    // Handle connection updates
    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // QR code for pairing
      if (qr) {
        try {
          qrCodeData = await QRCode.toDataURL(qr);
          connectionStatus = "qr";
          console.log("📱 QR Code generated");
        } catch (err) {
          console.error("Error generating QR code:", err);
        }
      }

      // Connection closed - handle reconnection
      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const errorMessage = lastDisconnect?.error?.message || "Unknown error";

        console.log("🔌 Connection closed");
        console.log("📊 Status Code:", statusCode);
        console.log("❌ Error:", errorMessage);

        // Clear any pending reconnect
        if (reconnectTimeout) {
          clearTimeout(reconnectTimeout);
          reconnectTimeout = null;
        }

        // Check if logged out (don't reconnect)
        const shouldReconnect =
          statusCode !== DisconnectReason.loggedOut &&
          reconnectAttempts < maxReconnectAttempts;

        if (!shouldReconnect) {
          console.log(
            "❌ Not reconnecting (logged out or max attempts reached)"
          );
          connectionStatus = "disconnected";
          reconnectAttempts = 0;
          return;
        }

        // Increment attempts
        reconnectAttempts++;

        // Exponential backoff
        const delay = Math.min(
          5000 * Math.pow(2, reconnectAttempts - 1),
          60000
        );

        console.log(
          `⏳ Reconnecting in ${
            delay / 1000
          }s (Attempt ${reconnectAttempts}/${maxReconnectAttempts})`
        );

        isReconnecting = true;
        connectionStatus = "reconnecting";

        // Schedule reconnect (as per Baileys docs pattern)
        reconnectTimeout = setTimeout(() => {
          console.log(`🔄 Attempting reconnection #${reconnectAttempts}`);
          connectToWhatsApp(); // Recursive call (Baileys pattern)
        }, delay);
      }

      // Connection opened successfully
      else if (connection === "open") {
        console.log("✅ WhatsApp connection opened successfully!");
        connectionStatus = "connected";
        qrCodeData = null;
        reconnectAttempts = 0; // Reset on successful connection
        isReconnecting = false;

        if (reconnectTimeout) {
          clearTimeout(reconnectTimeout);
          reconnectTimeout = null;
        }
      }
    });

    return sock;
  } catch (error) {
    console.error("❌ Error connecting to WhatsApp:", error);
    connectionStatus = "error";
    return null;
  }
}

/**
 * Disconnect and clear session
 */
async function disconnect() {
  if (sock) {
    try {
      if (sock.ws && sock.ws.readyState === sock.ws.OPEN) {
        await sock.logout();
      }
      sock = null;
    } catch (error) {
      console.error("Error during disconnect:", error);
    }
  }

  // Clear auth state
  authState = null;
  saveCreds = null;

  // Delete auth folder
  const authPath = path.join(__dirname, "..", "auth_info_baileys");
  try {
    if (fs.existsSync(authPath)) {
      fs.rmSync(authPath, { recursive: true, force: true });
      console.log("✅ Session cleared");
    }
  } catch (error) {
    console.error("Error clearing session:", error);
  }

  connectionStatus = "disconnected";
  qrCodeData = null;
}

/**
 * Get current socket instance
 */
function getSocket() {
  return sock;
}

/**
 * Get QR code data
 */
function getQRCode() {
  return qrCodeData;
}

/**
 * Get connection status
 */
function getConnectionStatus() {
  return connectionStatus;
}

module.exports = {
  connectToWhatsApp,
  disconnect,
  getSocket,
  getQRCode,
  getConnectionStatus,
};
