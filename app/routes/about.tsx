export default function About() {
  return (
    <main
      style={{
        color: "#1f2933",
        fontFamily:
          "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        lineHeight: 1.6,
        margin: "0 auto",
        maxWidth: "760px",
        padding: "48px 20px",
      }}
    >
      <p style={{ color: "#52606d", fontSize: "0.95rem", margin: "0 0 8px" }}>
        SyncBay
      </p>
      <h1 style={{ fontSize: "2rem", lineHeight: 1.2, margin: "0 0 24px" }}>
        Informazioni su SyncBay
      </h1>
      <p>
        SyncBay è una Shopify app in fase pilota pensata per collegare un
        account eBay.it a Shopify e mantenere il catalogo Shopify allineato ai
        listing eBay.
      </p>
      <h2>Cosa fa</h2>
      <p>
        L&apos;app importa e sincronizza prodotti, immagini, descrizioni, prezzi
        e disponibilità partendo da eBay, che resta la sorgente principale del
        catalogo.
      </p>
      <h2>Per chi è pensata</h2>
      <p>
        SyncBay è pensata per negozianti italiani che hanno già un catalogo su
        eBay.it e vogliono portarlo su Shopify con un flusso controllato,
        diagnostica chiara e gestione esplicita dei conflitti.
      </p>
      <h2>Stato del servizio</h2>
      <p>
        Il servizio è in pilota controllato. Non è ancora pubblicato nello
        Shopify App Store e non è una soluzione ufficiale eBay o Shopify.
      </p>
      <p style={{ color: "#697586", fontSize: "0.9rem", marginTop: "32px" }}>
        Ultimo aggiornamento: 25 maggio 2026.
      </p>
    </main>
  );
}
