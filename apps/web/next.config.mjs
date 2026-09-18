import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // Scenario packs are read from content/ at build time, which sits outside this app.
  // fileURLToPath, not URL.pathname: the latter yields "/I:/..." on Windows.
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
};
