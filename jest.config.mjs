/** @type {import("jest").Config} */
export default {
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/**/*.test.mjs"],
  transform: {},
  clearMocks: true,
  restoreMocks: true,
};
