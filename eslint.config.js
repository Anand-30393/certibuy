// ESLint flat config for the CertiBuy workspace.
// The boundary rules below enforce docs/architecture.md §2 and CLAUDE.md §3:
// business logic never depends on a framework or on Supabase.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import { defineConfig, globalIgnores } from "eslint/config";

const FRAMEWORK_IMPORTS = ["next", "next/*", "react", "react/*", "react-dom", "react-dom/*"];
const SUPABASE_IMPORTS = ["@supabase/*"];

export default defineConfig([
  globalIgnores([
    "**/node_modules/**",
    "**/.next/**",
    "**/dist/**",
    "**/coverage/**",
    "docs/**",
    "packages/db/src/generated/**",
  ]),
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Pure business rules: no framework, no Supabase, no database, no adapters.
  {
    files: ["packages/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                ...FRAMEWORK_IMPORTS,
                ...SUPABASE_IMPORTS,
                "@prisma/*",
                "@certibuy/db",
                "@certibuy/application",
                "@certibuy/integrations",
              ],
              message:
                "packages/domain is pure: no framework, Supabase, database or adapter imports (docs/architecture.md §2).",
            },
          ],
        },
      ],
    },
  },

  // Use-cases: no framework and no Supabase (Supabase is reached only through integration ports).
  {
    files: ["packages/application/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [...FRAMEWORK_IMPORTS, ...SUPABASE_IMPORTS],
              message:
                "packages/application must not import Next.js, React or @supabase/* (docs/architecture.md §2).",
            },
          ],
        },
      ],
    },
  },

  // Supabase may be imported only inside packages/integrations/src/supabase.
  {
    files: ["packages/contracts/**/*.ts", "packages/db/**/*.ts", "packages/integrations/**/*.ts"],
    ignores: ["packages/integrations/src/supabase/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: SUPABASE_IMPORTS,
              message:
                "Only packages/integrations/src/supabase may import @supabase/* (docs/architecture.md §2).",
            },
          ],
        },
      ],
    },
  },

  // Keep formatting concerns in Prettier.
  prettier,
]);
