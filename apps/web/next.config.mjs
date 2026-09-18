/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // Scenario packs are read from content/ at build time, which sits outside this app.
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
};
