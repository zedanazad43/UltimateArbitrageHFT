import js from "@eslint/js";
import globals from "globals";
import reactPlugin from "eslint-plugin-react";

export default [
  // Base recommended rules
  js.configs.recommended,
  reactPlugin.configs.flat.recommended,

  // General settings
  {
    settings: {
      react: { version: "detect" },
    },
    rules: {
      // Allow unused variables that start with underscore (common placeholder)
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },

  // Browser / React source (src/*, index.js, etc.)
  {
    files: ["src/**/*.{js,jsx,mjs}", "index.js"],
    languageOptions: {
      globals: globals.browser,
    },
  },

  // Node.js / CommonJS scripts (scripts/*, *.cjs)
  {
    files: ["scripts/**/*.js", "sign.cjs", "*.cjs"],
    languageOptions: {
      globals: {
        ...globals.node,
        process: "readonly",   // explicitly allow global process
      },
    },
  },
];