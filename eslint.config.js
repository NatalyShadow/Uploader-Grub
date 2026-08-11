import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";

export default tseslint.config(
    js.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,
    {
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
    {
        files: ["src/**/*.ts"],
        plugins: {
            import: importPlugin,
        },
        rules: {
            "@typescript-eslint/no-floating-promises": "error",
            "@typescript-eslint/await-thenable": "error",
            "@typescript-eslint/no-misused-promises": "error",
            "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
            "import/no-cycle": "error",
            "@typescript-eslint/consistent-type-imports": "warn",
            "no-console": "off",
            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/no-non-null-assertion": "off",
        },
    },
    {
        // Test files routinely build mocks and spies; the type-aware
        // unsafe-* rules would otherwise flag every mock fixture.
        files: ["src/**/*.test.ts"],
        rules: {
            "@typescript-eslint/no-unsafe-assignment": "off",
            "@typescript-eslint/no-unsafe-call": "off",
            "@typescript-eslint/no-unsafe-member-access": "off",
            "@typescript-eslint/no-unsafe-argument": "off",
            "@typescript-eslint/no-unsafe-return": "off",
            "@typescript-eslint/no-empty-function": "off",
        },
    },
    {
        ignores: [
            "dist/",
            "node_modules/",
            "*.js",
            "*.cjs",
            "*.mjs",
            // Config files live outside tsconfig `include`, so type-aware
            // rules would fail to find a matching program for them.
            "vitest.config.ts",
            "*.config.ts",
        ],
    }
);
