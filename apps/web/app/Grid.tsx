import type { ResultsData } from "../lib/analysis";

const FRAMEWORK_LABEL: Record<string, string> = {
  none: "no framework",
  act_utilitarian: "utilitarian",
  kantian_deontological: "Kantian",
  contractualist: "contractualist",
};

/**
 * Act rate for every scenario x framework cell, as a heat table.
 *
 * Sequential encoding in a single hue (the act colour), light to dark, with the number
 * printed in every cell - a heat table is a table first, and the shading only helps the
 * eye find the pattern. Rows are in pack order and columns in design order; neither is
 * sorted by the values, for the same reason the forest plot is not.
 *
 * A cell with no valid answers is hatched and says so, rather than being shaded as 0%.
 */
export default function Grid({ grid }: { grid: ResultsData["grid"] }) {
  const templates = grid.templates.filter((t) =>
    grid.frameworks.some((f) => grid.cells[`${t.id}|${f}`]),
  );

  return (
    <div className="heat-wrap">
      <table className="heat">
        <thead>
          <tr>
            <th scope="col">scenario</th>
            {grid.frameworks.map((f) => (
              <th scope="col" key={f}>
                {FRAMEWORK_LABEL[f] ?? f}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {templates.map((t) => (
            <tr key={t.id}>
              <th scope="row">
                <span className="t">{t.title}</span>
                <code>{t.id}</code>
              </th>
              {grid.frameworks.map((f) => {
                const cell = grid.cells[`${t.id}|${f}`];
                if (!cell || cell.actRate === null) {
                  return (
                    <td key={f} className="na" title="no valid answers in this cell">
                      <span className="v">n/a</span>
                      <span className="n">{cell ? `${cell.refusal} refused` : "not run"}</span>
                    </td>
                  );
                }
                const v = cell.actRate;
                return (
                  <td
                    key={f}
                    style={{ ["--v" as string]: v.toFixed(3) }}
                    className={v > 0.82 ? "dark" : undefined}
                    title={`${t.title}, ${FRAMEWORK_LABEL[f] ?? f}: act on ${Math.round(v * 100)}% of ${cell.nValid} valid answers${cell.refusal ? `, ${cell.refusal} refused` : ""}`}
                  >
                    <span className="v">{Math.round(v * 100)}%</span>
                    <span className="n">
                      n={cell.nValid}
                      {cell.refusal ? ` · ${cell.refusal}✕` : ""}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="heat-scale" aria-hidden="true">
        <span>0%</span>
        <span className="ramp" />
        <span>100% act</span>
        <span className="sep">·</span>
        <span>✕ = refusals, excluded from the rate</span>
      </div>
    </div>
  );
}
