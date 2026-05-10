export default function Privacy() {
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
        Informativa privacy provvisoria
      </h1>
      <p>
        SyncBay è una Shopify app in fase pilota che collega un negozio Shopify
        a un account eBay per importare e sincronizzare dati di catalogo,
        disponibilità e informazioni operative necessarie al servizio.
      </p>
      <h2>Quali dati tratta</h2>
      <p>
        L'app può trattare dati tecnici dello shop Shopify, dati del catalogo
        eBay, token di accesso dei provider, log operativi, audit log, stato
        delle connessioni e informazioni necessarie a import, sync, retry e
        diagnostica.
      </p>
      <h2>Come vengono usati</h2>
      <p>
        I dati sono usati solo per fornire il servizio SyncBay, mantenere
        allineato il catalogo, ridurre il rischio di vendere prodotti non
        disponibili, mostrare diagnostica e gestire errori, revoche e
        disinstallazioni.
      </p>
      <h2>Sicurezza</h2>
      <p>
        I token e i segreti non devono essere salvati nel repository. I token
        provider sono trattati lato server e cifrati a riposo quando vengono
        persistiti nel runtime applicativo.
      </p>
      <h2>Contatto</h2>
      <p>
        Per richieste privacy, revoca o rimozione dati durante il pilota,
        contattare il maintainer del progetto SyncBay.
      </p>
      <p style={{ color: "#697586", fontSize: "0.9rem", marginTop: "32px" }}>
        Ultimo aggiornamento: 10 maggio 2026.
      </p>
    </main>
  );
}
