import js from "@eslint/js";

export default [
  {
    ignores: [
      "node_modules/**",
      ".venv/**",
      ".vscode/**",
      ".wrangler/**",
      "public/**",
      "frontend/**",
      "UltimateArbitrageHFT/**",
      "money-transfer-project-template-java/**",
      "backup_*/**",
      "logs/**",
      "oracleJdk-26/**",
      "proxy-gateway/**",
      "archive/**",
      ".tmp-*.js",
      "*.tmp.js",
      "tmp-*.js",
      "aimaster_skills_list/**",
      "aimaster_council_temp/**",
      "aimaster/**",
      // This file is an INI config template (not JavaScript) that happens to be
      // named index.js — ESLint cannot parse it.
      "UnifiedArbitrageBot/index.js",
    ],
  },
  // Base rules for all JS files
  {
    files: ["**/*.{js,mjs,cjs}"],
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": [
        "error",
        {
          varsIgnorePattern: "^_",
          argsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
  },
  // CommonJS files need commonjs sourceType
  {
    files: ["**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
    },
  },
  // Node.js environment for scripts and temporal worker
  {
    files: [
      "**/*.cjs",
      "temporal-worker.js",
      "scripts/**/*.js",
      "src/ai-client.js",
      "tests/**/*.js",
      "test-ide-integration.js",
    ],
    languageOptions: {
      globals: {
        process: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        require: "readonly",
        module: "readonly",
        exports: "readonly",
        Buffer: "readonly",
        console: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        fetch: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        crypto: "readonly",
      },
    },
  },
  // index.js imports many modules for side effects / dynamic usage
  {
    files: ["index.js"],
    rules: {
      "no-unused-vars": [
        "warn",
        {
          varsIgnorePattern: "^_",
          argsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  // Cloudflare Worker / browser environment — applies to all JS files so that
  // Worker scripts in any subdirectory (ArbitrageBots/, nexus/, ip-locator/,
  // UltimateArbitrageBot/, etc.) get the required globals without per-directory
  // overrides.
  {
    files: ["**/*.{js,mjs}"],
    languageOptions: {
      globals: {
        console: "readonly",
        fetch: "readonly",
        Request: "readonly",
        Response: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        crypto: "readonly",
        btoa: "readonly",
        atob: "readonly",
        setTimeout: "readonly",
        AbortController: "readonly",
        AbortSignal: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        Promise: "readonly",
        JSON: "readonly",
        Date: "readonly",
        Math: "readonly",
        parseInt: "readonly",
        parseFloat: "readonly",
        isNaN: "readonly",
        Boolean: "readonly",
        Number: "readonly",
        String: "readonly",
        Array: "readonly",
        Object: "readonly",
        Error: "readonly",
        Map: "readonly",
        Set: "readonly",
        Symbol: "readonly",
        Uint8Array: "readonly",
        ArrayBuffer: "readonly",
        // Cloudflare Workers specific globals
        WebSocketPair: "readonly",
        ReadableStream: "readonly",
        WritableStream: "readonly",
        TransformStream: "readonly",
        Headers: "readonly",
        FormData: "readonly",
        Blob: "readonly",
        File: "readonly",
        DurableObjectNamespace: "readonly",
        DurableObjectState: "readonly",
        DurableObject: "readonly",
        WebSocket: "readonly",
        addEventListener: "readonly",
        removeEventListener: "readonly",
        dispatchEvent: "readonly",
        structuredClone: "readonly",
        queueMicrotask: "readonly",
        self: "readonly",
      },
    },
  },
];
