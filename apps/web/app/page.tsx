import { loadWorkbenchData } from "../lib/load";
import Workbench from "./Workbench";

/**
 * Packs are read from `content/` on the server, so the browser can never drift out of
 * sync with what the CLI actually runs. Rendered statically: the whole surface is a
 * pure function of committed content plus a committed results file, which is why this
 * deploys with no database and no worker.
 */
export const dynamic = "force-static";

export default async function Page() {
  const data = await loadWorkbenchData();

  return (
    <main className="wrap">
      <header className="mast">
        <div>
          <h1 className="wordmark">
            trolley<b>bench</b>
          </h1>
          <p className="tagline">
            A scenario is an experiment design, not a fixed string. Change a factor and watch the
            stimulus &mdash; and its content hash &mdash; recompute.
          </p>
        </div>
        <dl className="ident">
          <div>
            <dt>suite</dt>
            <dd>
              {data.meta.suite.id} @ {data.meta.suite.version}
            </dd>
          </div>
          <div>
            <dt>instances</dt>
            <dd>{data.meta.instanceCount}</dd>
          </div>
          <div>
            <dt>suite digest</dt>
            <dd>{data.meta.suite.digest.slice(0, 19)}&hellip;</dd>
          </div>
          <div>
            <dt>pack</dt>
            <dd>
              {data.meta.pack.id} @ {data.meta.pack.version}
              {data.meta.validationErrors > 0 ? ` · ${data.meta.validationErrors} errors` : ""}
            </dd>
          </div>
        </dl>
      </header>

      <p className="notice">
        <strong>Live content, echo subject.</strong>
        <span>
          Every scenario, hash and design matrix below is read from <code>content/</code> at build
          time. The response rates in &ldquo;Outcomes&rdquo; come from the built-in{" "}
          <code>echo</code> test double &mdash; a deterministic stub, <em>not</em> a language model.
          They show the shape of the analysis and mean nothing about any model.
        </span>
      </p>

      <Workbench data={data} />

      <footer className="foot">
        <span>
          Your own answers are kept in this browser only. They are never sent anywhere and are not
          collected as human baseline data &mdash; consented collection is a later phase with a
          proper consent flow behind it.
        </span>
        <a href="/results">results explorer &rarr;</a>
      </footer>
    </main>
  );
}
