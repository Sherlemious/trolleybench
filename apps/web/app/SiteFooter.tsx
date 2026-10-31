import Link from "next/link";
import { NAV_LINKS, REPO } from "./SiteNav";

/** One footer for every page: where to go next, where the code is, what the licences are. */
export default function SiteFooter() {
  const explore = NAV_LINKS.filter((l) => ["play", "results", "workbench", "sources"].includes(l.key));
  const build = NAV_LINKS.filter((l) => ["run", "docs"].includes(l.key));
  return (
    <footer className="site-foot">
      <div className="site-foot-inner">
        <div className="site-foot-brand">
          <Link href="/" className="wordmark">
            <span className="wm-mark" aria-hidden="true" />
            <span>trolley<b>bench</b></span>
          </Link>
          <p>An open, reproducible benchmark of how language models answer moral dilemmas, set beside published human responses.</p>
        </div>
        <nav aria-label="Explore">
          <h2>Explore</h2>
          <ul>
            {explore.map((l) => (
              <li key={l.key}>
                <Link href={l.href}>{l.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Build">
          <h2>Benchmark a model</h2>
          <ul>
            {build.map((l) => (
              <li key={l.key}>
                <Link href={l.href}>{l.label}</Link>
              </li>
            ))}
            <li>
              <Link href="/docs#mcp">Over MCP</Link>
            </li>
            <li>
              <Link href="/docs#api">HTTP API</Link>
            </li>
            <li>
              <a href={REPO}>Source on GitHub</a>
            </li>
          </ul>
        </nav>
      </div>
      <div className="site-foot-base">
        <span>Code Apache-2.0 · scenarios CC-BY-4.0</span>
        <span>Refusals are outcomes, never dropped. Modes are never pooled.</span>
      </div>
    </footer>
  );
}
