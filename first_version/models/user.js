const bcrypt = require("bcryptjs");

// Default users - In production, use a database
const users = [
  {
    id: 1,
    username: "admin",
    password: "$2a$10$rVZ4qH7gH7qH7gH7qH7gH.rVZ4qH7gH7qH7gH7qH7gH7qH7gH7qH7a", // 'admin123'
    role: "admin",
  },
  {
    id: 2,
    username: "author",
    password: "$2a$10$rVZ4qH7gH7qH7gH7qH7gH.rVZ4qH7gH7qH7gH7qH7gH7qH7gH7qH7a", // 'author123'
    role: "author",
  },
];

// Hash password for initial setup
async function createDefaultUsers() {
  const adminHash = await bcrypt.hash("admin123", 10);
  const authorHash = await bcrypt.hash("author123", 10);

  return [
    {
      id: 1,
      username: "admin",
      password: adminHash,
      role: "admin",
    },
    {
      id: 2,
      username: "author",
      password: authorHash,
      role: "author",
    },
  ];
}

let defaultUsers = [];

// Initialize default users
createDefaultUsers().then((users) => {
  defaultUsers = users;
});

const findUserByUsername = (username) => {
  return defaultUsers.find((user) => user.username === username);
};

const findUserById = (id) => {
  return defaultUsers.find((user) => user.id === id);
};

const validatePassword = async (password, hashedPassword) => {
  return await bcrypt.compare(password, hashedPassword);
};

// Get all users (without passwords)
const getAllUsers = () => {
  return defaultUsers.map((user) => ({
    id: user.id,
    username: user.username,
    role: user.role,
  }));
};

// Add new user
const addUser = async (username, password, role) => {
  // Check if username already exists
  if (findUserByUsername(username)) {
    return null;
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const newId = Math.max(...defaultUsers.map((u) => u.id), 0) + 1;

  const newUser = {
    id: newId,
    username,
    password: hashedPassword,
    role,
  };

  defaultUsers.push(newUser);

  return {
    id: newUser.id,
    username: newUser.username,
    role: newUser.role,
  };
};

// Update user
const updateUser = async (id, username, password, role) => {
  const userIndex = defaultUsers.findIndex((user) => user.id === id);

  if (userIndex === -1) {
    return null;
  }

  const user = defaultUsers[userIndex];

  // Check if new username conflicts with another user
  if (username && username !== user.username) {
    const existingUser = findUserByUsername(username);
    if (existingUser && existingUser.id !== id) {
      return null;
    }
    user.username = username;
  }

  if (password) {
    user.password = await bcrypt.hash(password, 10);
  }

  if (role) {
    user.role = role;
  }

  return {
    id: user.id,
    username: user.username,
    role: user.role,
  };
};

// Delete user
const deleteUser = (id) => {
  const userIndex = defaultUsers.findIndex((user) => user.id === id);

  if (userIndex === -1) {
    return false;
  }

  defaultUsers.splice(userIndex, 1);
  return true;
};

module.exports = {
  findUserByUsername,
  findUserById,
  validatePassword,
  getAllUsers,
  addUser,
  updateUser,
  deleteUser,
};
