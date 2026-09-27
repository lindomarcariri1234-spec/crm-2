const { getDefaultConfig } = require("expo/metro-config");

// Replit injects the active Clerk development key as CLERK_PUBLISHABLE_KEY.
// Expo only exposes EXPO_PUBLIC_* variables to the client bundle, so map it
// before Metro starts transforming files. Never fall back to the live VITE key.
if (process.env.REPL_ID && process.env.CLERK_PUBLISHABLE_KEY) {
  process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = process.env.CLERK_PUBLISHABLE_KEY;
}

module.exports = getDefaultConfig(__dirname);
