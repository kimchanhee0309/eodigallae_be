import baseConfig from "./jest.config.mjs";

/** @type {import("jest").Config} */
export default {
  ...baseConfig,

  testMatch: ["<rootDir>/tests/cache-integration/**/*.test.mjs"],

  testPathIgnorePatterns: ["/node_modules/"],

  setupFiles: [
    "<rootDir>/tests/helpers/assert-test-env.mjs",
    "<rootDir>/tests/helpers/assert-cache-env.mjs",
  ],

  testTimeout: 30_000,
};
