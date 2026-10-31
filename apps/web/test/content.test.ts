import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// content.ts resolves content/ from the web app's directory; point it at the repo.
beforeAll(() => {
  process.env["TROLLEYBENCH_ROOT"] = resolve(__dirname, "..", "..", "..");
});

describe("content-driven packs and suites", () => {
  it("lists every public suite with the sizes a hosted run will have", async () => {
    const { listSuites } = await import("../lib/content");
    const suites = await listSuites();
    const byId = Object.fromEntries(suites.map((s) => [s.id, s]));
    expect(suites[0]?.id).toBe("canon.v0");
    expect(byId["canon.v0"]).toMatchObject({ full: 144, quick: 36, scenarios: 5, label: "Trolley canon" });
    expect(byId["machine.v0"]).toMatchObject({ full: 238, quick: 238, packs: ["ai-agent"] });
  });

  it("reads every pack's site.yaml, and the canon's tour names real templates", async () => {
    const { packSites } = await import("../lib/content");
    const { loadPackDir } = await import("@trolleybench/scenarios");
    const sites = await packSites();
    expect(Object.keys(sites).sort()).toEqual(["ai-agent", "classic"]);
    const packs = await loadPackDir(resolve(process.env["TROLLEYBENCH_ROOT"]!, "content", "packs"));
    const templates = new Set(packs.flatMap((p) => p.pack.templates.map((t) => t.id)));
    for (const step of sites["classic"]!.tour ?? []) expect(templates.has(step.template)).toBe(true);
    expect(sites["classic"]!.tour).toHaveLength(5);
  });
});
