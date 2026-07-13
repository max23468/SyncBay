import type { ExistingCatalogTakeoverReport } from "../lib/syncbay-existing-catalog-takeover";
import { formatItNumber } from "../lib/syncbay-datetime-format";
import { MetricTile } from "./SyncBayUi";

export function ExistingCatalogTakeoverSection({ report }: { report: ExistingCatalogTakeoverReport }) {
  return (
    <s-section heading="Collega catalogo esistente">
      <s-stack gap="base">
        <div className="syncbay-existing-catalog-grid">
          <s-grid gap="base" gridTemplateColumns="repeat(auto-fit, minmax(132px, 1fr))">
            <MetricTile detail="Righe con match forte e dati eBay validi." icon="check-circle" label="Applicabili" tone={report.summary.applicable > 0 ? "success" : "neutral"} value={formatItNumber(report.summary.applicable)} />
            <MetricTile detail="Casi da classificare prima dell'applicazione." icon="alert-triangle" label="Da rivedere" tone={report.summary.review > 0 ? "warning" : "neutral"} value={formatItNumber(report.summary.review)} />
            <MetricTile detail="Casi che bloccano la messa online automatica." icon="alert-circle" label="Bloccanti" tone={report.summary.blocked > 0 ? "critical" : "neutral"} value={formatItNumber(report.summary.blocked)} />
            <MetricTile detail="Mapping già gestiti da SyncBay." icon="link" label="Già collegati" tone="neutral" value={formatItNumber(report.summary.alreadyLinked)} />
          </s-grid>
        </div>
        <s-text color="subdued">SyncBay collega solo righe con segnali forti. I casi incerti restano da rivedere e non vengono scritti dalla simulazione.</s-text>
        <s-text color="subdued">Le collezioni automatiche non vengono modificate: SyncBay aggiorna solo i campi prodotto usati dalle regole esistenti.</s-text>
      </s-stack>
    </s-section>
  );
}
