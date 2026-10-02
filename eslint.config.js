import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", ".output", ".vinxi"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // Doar regulile clasice. Presetul `recommended` din react-hooks 7 aduce și
      // regulile React Compiler (refs, purity, set-state-in-effect), care ar
      // cere refactorizări fără legătură cu actualizarea pachetelor.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    // Rutele TanStack exportă doar `Route` și țin componentele local; HMR-ul
    // lor îl face pluginul routerului (code-splitting). react-refresh 0.5 le
    // raportează ca „localComponents”, fals pozitiv aici.
    files: ["src/routes/**/*.tsx"],
    rules: { "react-refresh/only-export-components": "off" },
  },
  eslintPluginPrettier,
);
