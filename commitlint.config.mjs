export default {
    extends: ["@commitlint/config-conventional"],
    rules: {
        // Match the allowed types in llm_files/rules/git.md (no `style`).
        "type-enum": [
            2,
            "always",
            ["feat", "fix", "refactor", "docs", "test", "chore", "perf", "build", "ci", "revert"],
        ],
    },
};
