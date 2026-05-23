import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
});

export default [
  {
    ignores: [
      "node_modules/**",
      "build/**",
      "public/build/**",
      "**/*.yml",
      ".react-router/**",
      ".shopify/**",
      ".vercel/**",
    ],
  },
  ...compat.config({
    parserOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      ecmaFeatures: {
        jsx: true,
      },
    },
    env: {
      browser: true,
      commonjs: true,
      es6: true,
    },
    ignorePatterns: ["!**/.server", "!**/.client"],
    extends: ["eslint:recommended"],
    overrides: [
      {
        files: ["**/*.{js,jsx,ts,tsx}"],
        plugins: ["react", "jsx-a11y"],
        extends: [
          "plugin:react/recommended",
          "plugin:react/jsx-runtime",
          "plugin:react-hooks/recommended",
          "plugin:jsx-a11y/recommended",
        ],
        settings: {
          react: {
            version: "detect",
          },
          formComponents: ["Form"],
          linkComponents: [
            { name: "Link", linkAttribute: "to" },
            { name: "NavLink", linkAttribute: "to" },
          ],
          "import/resolver": {
            typescript: {},
          },
        },
        rules: {
          "react/no-unknown-property": ["error", { ignore: ["variant"] }],
        },
      },
      {
        files: ["**/*.{ts,tsx}"],
        plugins: ["@typescript-eslint", "import"],
        parser: "@typescript-eslint/parser",
        settings: {
          "import/internal-regex": "^~/",
          "import/resolver": {
            node: {
              extensions: [".ts", ".tsx"],
            },
            typescript: {
              alwaysTryTypes: true,
            },
          },
        },
        extends: [
          "plugin:@typescript-eslint/recommended",
          "plugin:import/recommended",
          "plugin:import/typescript",
        ],
      },
      {
        files: [
          "eslint.config.mjs",
          "vite.config.{js,ts}",
          ".graphqlrc.{js,ts}",
          "shopify.server.{js,ts}",
          "scripts/**/*.mjs",
          "**/*.server.{js,ts}",
        ],
        env: {
          node: true,
        },
      },
    ],
    globals: {
      shopify: "readonly",
    },
  }),
];
