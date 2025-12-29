const express = require("express");
const jwt = require("jsonwebtoken");
const {
  findUserByUsername,
  validatePassword,
  getAllUsers,
  addUser,
  updateUser,
  deleteUser,
} = require("../models/user");
const { authenticateToken, authorizeRole } = require("../middleware/auth");

const router = express.Router();

// Login route
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res
        .status(400)
        .json({ error: "Username and password are required." });
    }

    const user = findUserByUsername(username);

    if (!user) {
      return res.status(401).json({ error: "Invalid credentials." });
    }

    const isValidPassword = await validatePassword(password, user.password);

    if (!isValidPassword) {
      return res.status(401).json({ error: "Invalid credentials." });
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET || "your-secret-key",
      { expiresIn: "24h" }
    );

    // Set token in cookie
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    });

    res.json({
      success: true,
      message: "Login successful",
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
      token,
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Logout route
router.post("/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ success: true, message: "Logged out successfully" });
});

// Check authentication status
router.get("/me", authenticateToken, (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user.id,
      username: req.user.username,
      role: req.user.role,
    },
  });
});

// Get all users (admin only)
router.get(
  "/users",
  authenticateToken,
  authorizeRole(["admin"]),
  (req, res) => {
    try {
      const users = getAllUsers();
      res.json({ success: true, users });
    } catch (error) {
      console.error("Get users error:", error);
      res.status(500).json({ error: "Failed to get users" });
    }
  }
);

// Add new user (admin only)
router.post(
  "/users",
  authenticateToken,
  authorizeRole(["admin"]),
  async (req, res) => {
    try {
      const { username, password, role } = req.body;

      if (!username || !password || !role) {
        return res
          .status(400)
          .json({ error: "Username, password, and role are required" });
      }

      if (!["admin", "author"].includes(role)) {
        return res
          .status(400)
          .json({ error: "Invalid role. Must be 'admin' or 'author'" });
      }

      const newUser = await addUser(username, password, role);

      if (!newUser) {
        return res.status(400).json({ error: "Username already exists" });
      }

      res.json({
        success: true,
        user: newUser,
        message: "User created successfully",
      });
    } catch (error) {
      console.error("Add user error:", error);
      res.status(500).json({ error: "Failed to add user" });
    }
  }
);

// Update user (admin only)
router.put(
  "/users/:id",
  authenticateToken,
  authorizeRole(["admin"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { username, password, role } = req.body;

      if (role && !["admin", "author"].includes(role)) {
        return res
          .status(400)
          .json({ error: "Invalid role. Must be 'admin' or 'author'" });
      }

      const updatedUser = await updateUser(
        parseInt(id),
        username,
        password,
        role
      );

      if (!updatedUser) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json({
        success: true,
        user: updatedUser,
        message: "User updated successfully",
      });
    } catch (error) {
      console.error("Update user error:", error);
      res.status(500).json({ error: "Failed to update user" });
    }
  }
);

// Delete user (admin only)
router.delete(
  "/users/:id",
  authenticateToken,
  authorizeRole(["admin"]),
  (req, res) => {
    try {
      const { id } = req.params;
      const userId = parseInt(id);

      // Prevent deleting yourself
      if (userId === req.user.id) {
        return res
          .status(400)
          .json({ error: "Cannot delete your own account" });
      }

      const success = deleteUser(userId);

      if (!success) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json({ success: true, message: "User deleted successfully" });
    } catch (error) {
      console.error("Delete user error:", error);
      res.status(500).json({ error: "Failed to delete user" });
    }
  }
);

module.exports = router;
