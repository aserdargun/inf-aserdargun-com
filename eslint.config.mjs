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
    files: ["packages/contracts/**/*.ts", "packages/domain/**/*.ts"],
    rules: {
      "no-undef": "off"
    }
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly"
      }
    }
  }
];
