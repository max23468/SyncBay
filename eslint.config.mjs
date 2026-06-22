import eslintReact from "@eslint-react/eslint-plugin";
import js from "@eslint/js";
import tsEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import globals from "globals";
import importX from "eslint-plugin-import-x";
import jsxA11yX from "eslint-plugin-jsx-a11y-x";
import reactHooks from "eslint-plugin-react-hooks";

const sourceFiles = ["**/*.{js,jsx,ts,tsx}"];
const jsxFiles = ["**/*.{jsx,tsx}"];
const tsFiles = ["**/*.{ts,tsx}"];
const nodeFiles = [
  "eslint.config.mjs",
  ".github/scripts/**/*.mjs",
  "vite.config.{js,ts}",
  ".graphqlrc.{js,ts}",
  "shopify.server.{js,ts}",
  "scripts/**/*.mjs",
  "**/*.server.{js,ts}",
];

const applyTo = (config, files) => ({
  ...config,
  files: config.files ?? files,
});

export default [
  {
    ignores: [
      "node_modules/**",
      "build/**",
      "public/build/**",
      "audits/**",
      "**/*.yml",
      ".react-router/**",
      ".shopify/**",
      ".vercel/**",
    ],
  },
  {
    files: sourceFiles,
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.commonjs,
        ...globals.es2021,
        shopify: "readonly",
      },
    },
    settings: {
      react: {
        version: "detect",
      },
      formComponents: ["Form"],
      linkComponents: [
        { name: "Link", linkAttribute: "to" },
        { name: "NavLink", linkAttribute: "to" },
      ],
    },
  },
  {
    files: tsFiles,
    languageOptions: {
      parser: tsParser,
    },
  },
  js.configs.recommended,
  ...tsEslint.configs["flat/recommended"].map((config) =>
    applyTo(config, tsFiles),
  ),
  applyTo(importX.flatConfigs.recommended, sourceFiles),
  applyTo(
    {
      ...importX.flatConfigs.typescript,
      settings: {
        ...importX.flatConfigs.typescript.settings,
        "import-x/internal-regex": "^~/",
        "import-x/resolver": {
          node: {
            extensions: [".ts", ".tsx"],
          },
          typescript: {
            alwaysTryTypes: true,
          },
        },
      },
    },
    tsFiles,
  ),
  applyTo(eslintReact.configs["recommended-typescript"], sourceFiles),
  {
    files: sourceFiles,
    ...reactHooks.configs.flat.recommended,
  },
  applyTo(jsxA11yX.configs.recommended, jsxFiles),
  {
    files: sourceFiles,
    rules: {
      "@eslint-react/dom-no-unknown-property": [
        "error",
        { ignore: ["variant"] },
      ],
    },
  },
  {
    files: nodeFiles,
    languageOptions: {
      globals: globals.node,
    },
  },
];
