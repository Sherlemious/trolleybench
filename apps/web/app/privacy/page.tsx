import { GA_ID, pageMeta } from "../../lib/site";
import { REPO } from "../SiteNav";
import SiteNav from "../SiteNav";

export const dynamic = "force-static";

export const metadata = pageMeta(
  "Privacy: what this site collects",
  "/privacy",
  "What trolleybench stores and what it does not: your Play answers stay in your browser, API keys never reach the site, and the only analytics are page views.",
);

const UPDATED = "2026-11-01";

const TOC = [
  ["short", "In short"],
  ["browser", "Kept in your browser"],
  ["analytics", "Analytics"],
  ["hosted", "Hosted runs (API, MCP, browser runner)"],
  ["hosting", "Hosting and logs"],
  ["keys", "API keys"],
  ["choices", "Your choices"],
  ["contact", "Contact and changes"],
] as const;

export default function PrivacyPage() {
  return (
    <main className="wrap">
      <SiteNav current="privacy" />
      <header className="page-head">
        <div>
          <p className="eyebrow">Privacy</p>
          <h1>What this site collects</h1>
          <p className="lede">
            trolleybench is a benchmark of language models. It has no accounts and does not ask who you
            are. This page says what is stored, where, and for what. Last updated {UPDATED}.
          </p>
        </div>
      </header>

      <div className="docs">
        <nav className="docs-toc" aria-label="On this page">
          <ol>
            {TOC.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`}>{label}</a>
              </li>
            ))}
          </ol>
        </nav>

        <article className="docs-body">
          <section id="short">
            <h2>In short</h2>
            <ul className="docs-points">
              <li>
                <b>Your answers in Play and the Workbench stay in your browser.</b> They are not sent to
                this site.
              </li>
              <li>
                <b>Your API keys never reach this site.</b> The browser runner talks to the model provider
                directly.
              </li>
              <li>
                <b>Page views are counted with Google Analytics.</b> That is the only third-party tracker.
              </li>
              <li>
                <b>Hosted runs are public.</b> When a model is run through the API, MCP or the browser
                runner and submitted, its answers are stored and shown next to its name.
              </li>
              <li>
                <b>There are no accounts, no email collection, no ads and no sale of data.</b>
              </li>
            </ul>
          </section>

          <section id="browser">
            <h2>Kept in your browser</h2>
            <p>
              The site uses your browser&rsquo;s <code>localStorage</code> for conveniences that never
              leave your device:
            </p>
            <ul className="docs-points">
              <li>
                <b>Your Play answers</b>, so the comparison with people and models can be shown after the
                last dilemma and survives a reload.
              </li>
              <li>
                <b>Your Workbench picks</b> and the models you highlight on the results page.
              </li>
              <li>
                <b>Your theme and accent colour.</b>
              </li>
              <li>
                <b>A resume link for an unfinished browser run</b> (the run&rsquo;s id, its token and the
                model name), in <code>sessionStorage</code>, which the browser drops when you close the
                tab. Your API key is not part of it.
              </li>
            </ul>
            <p>
              Clear your site data in the browser to remove all of it. If your browser blocks storage the
              site still works; it just forgets these choices.
            </p>
          </section>

          <section id="analytics">
            <h2>Analytics</h2>
            <p>
              Every page loads Google Analytics 4 (measurement ID <code>{GA_ID}</code>) so the
              maintainers can see which pages are read. The site sends a page view for each route you
              open, with its path, title and address. It does not send your Play answers, your API keys
              or anything you type into a form.
            </p>
            <p>
              Google sets cookies (such as <code>_ga</code>) and receives your IP address and browser
              details as part of that request, under{" "}
              <a href="https://policies.google.com/privacy">Google&rsquo;s privacy policy</a>. GA4 does
              not keep IP addresses in its reports. The site does not currently ask for consent before
              loading the tag. See <a href="#choices">your choices</a> for how to opt out.
            </p>
            <p>
              Fonts are served from this site, not from Google, so loading them tells Google nothing.
            </p>
          </section>

          <section id="hosted">
            <h2>Hosted runs (API, MCP, browser runner)</h2>
            <p>
              These features test a <em>model</em>, not you. When one is used, the database stores:
            </p>
            <ul className="docs-points">
              <li>
                <b>Each answer as it arrives:</b> the prompt, the reply text, how it was scored, and
                timing.
              </li>
              <li>
                <b>The model name you give</b>, marked as self-reported.
              </li>
              <li>
                <b>A salted hash of your IP address.</b> It is used to rate-limit runs (20 an hour) and to
                group one submitter&rsquo;s sessions together. The address itself is not stored with the
                run, the hash is never shown, and on the site a submitter appears only as &ldquo;community
                N&rdquo;.
              </li>
            </ul>
            <p>
              Results are public. Do not put anything in a model name, a system prompt or a reply that you
              would not want published. Maintainers review submitted runs, and a run can be hidden or
              removed on request (see <a href="#contact">contact</a>).
            </p>
          </section>

          <section id="hosting">
            <h2>Hosting and logs</h2>
            <p>
              The site runs on Vercel and its database is on Neon. Like any host, they process requests
              and may keep short-lived server logs that include IP addresses and request paths. This site
              does not read those logs for anything beyond debugging and abuse prevention.
            </p>
          </section>

          <section id="keys">
            <h2>API keys</h2>
            <p>
              A key you type into the browser runner is held in the page&rsquo;s memory and sent only to
              the provider you chose. It is not sent to this site, not written to storage and not logged.
              The API and MCP routes never involve a key. Use a key with a spend limit, and revoke it
              afterwards if you share your screen.
            </p>
          </section>

          <section id="choices">
            <h2>Your choices</h2>
            <ul className="docs-points">
              <li>
                <b>Opt out of analytics</b> with Google&rsquo;s{" "}
                <a href="https://tools.google.com/dlpage/gaoptout">browser add-on</a>, or by blocking
                <code> googletagmanager.com</code> in your browser or content blocker. The site works the
                same without it.
              </li>
              <li>
                <b>Remove local data</b> by clearing this site&rsquo;s storage in your browser.
              </li>
              <li>
                <b>Ask for a run to be removed.</b> Open an issue with the run&rsquo;s address and we will
                hide or delete it. Because the stored hash cannot be reversed to an address, we cannot
                look up &ldquo;your&rdquo; runs for you; send the run links.
              </li>
              <li>
                <b>Run it yourself.</b> The CLI works fully offline with no database, and nothing leaves
                your machine except calls to the model providers you configure.
              </li>
            </ul>
          </section>

          <section id="contact">
            <h2>Contact and changes</h2>
            <p>
              Questions or removal requests: open an issue at{" "}
              <a href={`${REPO}/issues`}>{REPO.replace("https://", "")}/issues</a>. Do not post secrets
              there. If this page changes, the date at the top changes and the history is in the{" "}
              <a href={`${REPO}/commits/main/apps/web/app/privacy/page.tsx`}>repository</a>.
            </p>
            <p>
              This is a plain-language description of how the site works, not legal advice.
            </p>
          </section>
        </article>
      </div>
    </main>
  );
}
