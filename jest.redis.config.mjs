import baseConfig from "./jest.config.mjs";

/** @type {import("jest").Config} */
export default {
  ...baseConfig,

  testMatch: ["<rootDir>/tests/redis/**/*.test.mjs"],

  testPathIgnorePatterns: ["/node_modules/"],

  testTimeout: 10_000,
};
