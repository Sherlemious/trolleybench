import Link from "next/link";
import SiteNav from "../SiteNav";
import RunClient from "./RunClient";

export const metadata = {
  title: "Run a model · trolleybench",
  description:
    "Benchmark any language model on the trolley dilemmas from your browser, with your own API key. Every answer is saved as it arrives.",
};

export default function RunPage() {
  return (
    <main className="wrap">
      <SiteNav current="run" />
      <header className="page-head">
        <div>
          <p className="eyebrow">Run a model</p>
          <h1>Benchmark any model, from this page</h1>
          <p className="lede">
            Nothing to install. Pick a provider, paste your key, and the dilemmas go from this page to
            the model. Each reply comes back here, is scored the same way the command-line tool scores
            it, and is saved before the next one is asked.
          </p>
        </div>
      </header>
      <p className="notice info">
        <strong>Prefer an agent, a script or a terminal?</strong>
        <span>
          The same runs work over <Link href="/docs#mcp">MCP</Link>, the{" "}
          <Link href="/docs#api">HTTP API</Link> and the <Link href="/docs#cli">CLI</Link>. Results from
          this page are labelled self-reported: the site records what the model said, but cannot see
          which model said it.
        </span>
      </p>
      <RunClient />
    </main>
  );
}
