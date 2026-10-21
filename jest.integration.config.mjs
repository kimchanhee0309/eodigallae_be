import baseConfig from "./jest.config.mjs";

/** @type {import("jest").Config} */
export default {
  ...baseConfig,

  testMatch: ["<rootDir>/tests/integration/**/*.test.mjs"],

  testPathIgnorePatterns: ["/node_modules/"],

  setupFiles: ["<rootDir>/tests/helpers/assert-test-env.mjs"],

  testTimeout: 30_000,
};
