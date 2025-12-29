const jwt = require("jsonwebtoken");

const authenticateToken = (req, res, next) => {
  const token =
    req.cookies.token || req.headers["authorization"]?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Access denied. No token provided." });
  }

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "your-secret-key"
    );
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ error: "Invalid or expired token." });
  }
};

const authorizeRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      console.log("⚠️ Authorization failed: User not authenticated");
      return res.status(401).json({ error: "User not authenticated." });
    }

    if (!roles.includes(req.user.role)) {
      console.log(
        `⚠️ Authorization failed: User role '${req.user.role}' not in allowed roles:`,
        roles
      );
      return res
        .status(403)
        .json({ error: "Access denied. Insufficient permissions." });
    }

    console.log(
      `✅ Authorization successful: User role '${req.user.role}' allowed`
    );
    next();
  };
};

module.exports = {
  authenticateToken,
  authorizeRole,
};
