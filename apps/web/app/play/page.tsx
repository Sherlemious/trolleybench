import { pageMeta } from "../../lib/site";
import { loadPlayData } from "../../lib/play";
import SiteNav from "../SiteNav";
import Play from "./Play";

export const revalidate = 300;

export const metadata = pageMeta(
  "Play the trolley problem",
  "/play",
  "Answer five classic trolley dilemmas — the switch, the footbridge, the loop, the trapdoor and the surgeon — then see how people and AI models answered the same questions.",
);

export default async function PlayPage() {
  const { steps } = await loadPlayData();
  return (
    <main className="wrap">
      <SiteNav current="play" />
      <Play steps={steps} />
    </main>
  );
}
