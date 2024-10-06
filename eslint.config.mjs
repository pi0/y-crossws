import unjs from "eslint-config-unjs";

export default unjs({
  ignores: [],
  rules: {
    "unicorn/no-null": 0,
    "@typescript-eslint/no-empty-object-type": 0,
    "@typescript-eslint/no-non-null-asserted-optional-chain": 0,
  },
});
