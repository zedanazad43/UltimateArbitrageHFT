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
      // named index.js — ESLint cannot parse it. Both paths cover lowercase and
      // capital-A casing (submodule checkout on Windows CI).
      "arbitragebot/UnifiedArbitrageBot/index.js",
      "ArbitrageBot/UnifiedArbitrageBot/index.js",
      // Reorg merged reference bots/ and the vendored agents/awesome/ gstack
      // skill library (~1.7k files of browser-global JS) into the linted tree.
      // They are not part of the production Worker bundle and cannot pass
      // no-undef — ignore them like the other vendored dirs above.
      "bots/**",
      "agents/awesome/**",
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
  // Test files use ESM imports
  {
    files: ["tests/**/*.js", "test-ide-integration.js"],
    languageOptions: {
      sourceType: "module",
      globals: {
        describe: "readonly",
        test: "readonly",
        expect: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
      },
    },
  },
  // Node.js environment for scripts and temporal worker
  {
    files: [
      "**/*.cjs",
      "hero-super-agent/hero-agent/**/*.js",
      "hero-super-agent/packages/**/*.js",
      "agents/hero-agent/**/*.js",
      "orchestrator.js",
      "temporal-worker.js",
      "scripts/**/*.js",
      "scripts/**/*.mjs",
      "agents/api/**/*.js",
      "src/ai-client.js",
      "tools/**/*.cjs",
    ],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        require: "readonly",
        module: "readonly",
        exports: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
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
  // Worker scripts in any subdirectory (arbitragebot/ArbitrageBots/, nexus/,
  // ip-locator/, arbitragebot/UltimateArbitrageBot/, etc.) get the required
  // globals without per-directory
  // overrides.
  {
    files: ["**/*.{js,mjs,cjs}"],
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
        process: "readonly",
        Buffer: "readonly",
      },
    },
  },
];
