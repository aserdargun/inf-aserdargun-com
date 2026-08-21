import babelParser from "@babel/eslint-parser";
import js from "@eslint/js";

export default [
  {
    ignores: [
      ".next/",
      "api-dist/",
      "api/dist/",
      "out/",
      "node_modules/",
      "playwright-report/",
      "test-results/"
    ]
  },
  js.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: babelParser,
      globals: {
        console: "readonly",
        process: "readonly"
      },
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          babelrc: false,
          configFile: false,
          parserOpts: {
            plugins: ["typescript", "jsx"]
          }
        }
      }
    },
    rules: {
      "no-unused-vars": "off"
    }
  },
  {
    files: ["app/login/**/*.tsx", "components/**/*.{ts,tsx}", "e2e/**/*.ts", "features/**/*.{ts,tsx}", "lib/**/*.ts", "tools/api-client.test.ts", "tools/pwa-contract.test.ts", "tools/service-worker-policy.test.ts", "public/view/sw.js"],
    rules: { "no-undef": "off" }
  },
  {
    files: ["api/**/*.ts", "packages/contracts/**/*.ts", "packages/domain/**/*.ts"],
    rules: {
      "no-undef": "off"
    }
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        Headers: "readonly",
        Request: "readonly",
        URL: "readonly"
      }
    }
  },
  {
    files: ["tools/**/*.mjs"],
    languageOptions: { globals: { process: "readonly", fetch: "readonly" } }
  }
];
