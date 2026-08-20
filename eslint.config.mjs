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
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly"
      }
    }
  }
];
