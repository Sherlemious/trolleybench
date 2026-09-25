import { loadPlayData } from "../../lib/play";
import SiteNav from "../SiteNav";
import Play from "./Play";

export const revalidate = 300;

export const metadata = {
  title: "Play · trolleybench",
  description: "Answer five classic trolley dilemmas, then see how people and language models answered the same questions.",
};

export default async function PlayPage() {
  const { steps } = await loadPlayData();
  return (
    <main className="wrap">
      <SiteNav current="play" />
      <Play steps={steps} />
    </main>
  );
}
