/** @type {import("jest").Config} */
export default {
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/**/*.test.mjs"],
  testPathIgnorePatterns: ["/node_modules/", "/tests/integration/"],
  transform: {},
  clearMocks: true,
  restoreMocks: true,
};
