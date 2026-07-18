import assert from "node:assert/strict";
import { test } from "vitest";

import {
  cleanEbayDescriptionHtml,
  SYNCBAY_CLEAN_DESCRIPTION_MODE,
} from "./syncbay-description-cleanup.ts";

test("removes inline colors and visual attributes from eBay descriptions", () => {
  assert.deepEqual(
    cleanEbayDescriptionHtml(
      '<p style="color:red" class="rosso"><font color="#ff0000">Moneta rara</font></p>',
    ),
    {
      html: "<p>Moneta rara</p>",
      mode: SYNCBAY_CLEAN_DESCRIPTION_MODE,
      wasChanged: true,
    },
  );
});

test("drops obvious eBay store template blocks", () => {
  assert.equal(
    cleanEbayDescriptionHtml(
      "<p>2 Lire 1914 SPL.</p><table><tr><td>Visita il nostro negozio eBay. Spedizione e pagamenti. Feedback.</td></tr></table>",
    ).html,
    "<p>2 Lire 1914 SPL.</p>",
  );
});

test("drops store navigation lists before the product description", () => {
  assert.equal(
    cleanEbayDescriptionHtml(
      "<ul><li>Visita il negozio</li><li>Aggiungi ai preferiti</li><li>Feedback</li><li>Contatti</li></ul><ul><li>Promozioni</li></ul><p>1000 Lire Argento 1996.</p>",
    ).html,
    "<p>1000 Lire Argento 1996.</p>",
  );
});

test("keeps allowed leading block tags outside generated paragraphs", () => {
  assert.equal(
    cleanEbayDescriptionHtml(
      "<ul><li>Conservazione SPL</li><li>Periziata</li></ul>",
    ).html,
    "<ul><li>Conservazione SPL</li><li>Periziata</li></ul>",
  );

  assert.equal(
    cleanEbayDescriptionHtml("<h2>Dettagli prodotto</h2><p>Moneta rara.</p>")
      .html,
    "<h2>Dettagli prodotto</h2><p>Moneta rara.</p>",
  );
});

test("keeps product details from neutral tables while removing table markup", () => {
  assert.equal(
    cleanEbayDescriptionHtml(
      "<table><tr><td>Anno 1914</td><td>Conservazione SPL</td></tr></table>",
    ).html,
    "<p>Anno 1914 Conservazione SPL</p>",
  );
});

test("cuts the commercial template tail after product details", () => {
  assert.equal(
    cleanEbayDescriptionHtml(
      "<p>REPUBBLICA ITALIANA 1000 Lire Argento 1996.</p><p>Conservazione: FDC SET ZECCA.</p><p>VISITA IL NOSTRO SITO!</p><p>Metodi di Pagamento, spedizione, recesso e privacy.</p>",
    ).html,
    "<p>REPUBBLICA ITALIANA 1000 Lire Argento 1996.</p><p>Conservazione: FDC SET ZECCA.</p>",
  );
});

test("removes repeated commercial trust slogans before product details", () => {
  assert.equal(
    cleanEbayDescriptionHtml(
      "<p>CON LA GARANZIA DI UN PERITO NUMISMATICO PROFESSIONISTA</p><p>TUTELATE I VOSTRI ACQUISTI!</p><p>ACQUISTATE DA VENDITORI SERI E PROFESSIONALI!</p><p>REGNO D'ITALIA 5 LIRE 1930.</p>",
    ).html,
    "<p>REGNO D'ITALIA 5 LIRE 1930.</p>",
  );
});

test("removes commercial trust slogans when they share a product paragraph", () => {
  assert.equal(
    cleanEbayDescriptionHtml(
      "<p>CON LA GARANZIA DI UN PERITO NUMISMATICO PROFESSIONISTA TUTELATE I VOSTRI ACQUISTI! ACQUISTATE DA VENDITORI SERI E PROFESSIONALI! PRODOTTO TEST 1000 LIRE ARGENTO.</p>",
    ).html,
    "<p>PRODOTTO TEST 1000 LIRE ARGENTO.</p>",
  );
});

test("removes commercial trust slogans separated by punctuation", () => {
  assert.equal(
    cleanEbayDescriptionHtml(
      "<p>CON LA GARANZIA DI UN PERITO NUMISMATICO PROFESSIONISTA! TUTELATE I VOSTRI ACQUISTI! - ACQUISTATE DA VENDITORI SERI E PROFESSIONALI! PRODOTTO TEST 500 LIRE.</p>",
    ).html,
    "<p>PRODOTTO TEST 500 LIRE.</p>",
  );
});

test("removes commercial trust slogans with noisy html spacing", () => {
  assert.equal(
    cleanEbayDescriptionHtml(
      "<p>CON&nbsp; LA   GARANZIA DI UN PERITO NUMISMATICO PROFESSIONISTA TUTELATE I VOSTRI ACQUISTI! ACQUISTATE DA VENDITORI SERI E PROFESSIONALI! PRODOTTO TEST 200 LIRE.</p>",
    ).html,
    "<p>PRODOTTO TEST 200 LIRE.</p>",
  );
});

test("removes commercial trust slogans split by line breaks", () => {
  assert.equal(
    cleanEbayDescriptionHtml(
      "<p>CON LA GARANZIA<br>DI UN PERITO NUMISMATICO PROFESSIONISTA TUTELATE I VOSTRI ACQUISTI! ACQUISTATE DA VENDITORI SERI E PROFESSIONALI! PRODOTTO TEST 100 LIRE.</p>",
    ).html,
    "<p>PRODOTTO TEST 100 LIRE.</p>",
  );
});

test("removes commercial trust slogans split by formatting tags", () => {
  assert.equal(
    cleanEbayDescriptionHtml(
      "<p><strong>CON LA GARANZIA DI UN PERITO NUMISMATICO PROFESSIONISTA</strong> <strong>TUTELATE I VOSTRI ACQUISTI!</strong> <strong>ACQUISTATE DA VENDITORI SERI E PROFESSIONALI!</strong> PRODOTTO TEST 50 LIRE.</p>",
    ).html,
    "<p>PRODOTTO TEST 50 LIRE.</p>",
  );
});

test("removes commercial trust slogans after dropping template navigation", () => {
  assert.equal(
    cleanEbayDescriptionHtml(
      "<ul><li>Visita il negozio</li><li>Feedback</li></ul><p>CON LA GARANZIA DI UN PERITO NUMISMATICO PROFESSIONISTA TUTELATE I VOSTRI ACQUISTI! ACQUISTATE DA VENDITORI SERI E PROFESSIONALI! PRODOTTO TEST 20 LIRE.</p>",
    ).html,
    "<p>PRODOTTO TEST 20 LIRE.</p>",
  );
});

test("removes commercial trust slogans inside leading heading tags", () => {
  assert.equal(
    cleanEbayDescriptionHtml(
      "<h2>CON LA GARANZIA DI UN PERITO NUMISMATICO PROFESSIONISTA TUTELATE I VOSTRI ACQUISTI! ACQUISTATE DA VENDITORI SERI E PROFESSIONALI! PRODOTTO TEST 10 LIRE.</h2>",
    ).html,
    "<p>PRODOTTO TEST 10 LIRE.</p>",
  );
});

test("preserves spacing around inline semantic tags", () => {
  assert.equal(
    cleanEbayDescriptionHtml("<p>Rara <strong>moneta</strong> italiana</p>")
      .html,
    "<p>Rara <strong>moneta</strong> italiana</p>",
  );
});

test("removes empty formatting tags and empty break paragraphs", () => {
  assert.equal(
    cleanEbayDescriptionHtml(
      "<p><strong>Moneta</strong><strong></strong></p><p><br></p>",
    ).html,
    "<p><strong>Moneta</strong></p>",
  );
});

test("formats consecutive product heading fragments as separate paragraphs", () => {
  assert.equal(
    cleanEbayDescriptionHtml(
      "<strong> REPUBBLICA ITALIANA </strong><strong><br>1000 LIRE ARGENTO 1996</strong><strong>OLIMPIADI DI ATLANTA</strong><strong>IN VERSIONE FDC</strong><p>Conservazione: FDC <b>SET ZECCA</b></p>",
    ).html,
    "<p><strong>REPUBBLICA ITALIANA</strong></p><p><strong>1000 LIRE ARGENTO 1996</strong></p><p><strong>OLIMPIADI DI ATLANTA</strong></p><p><strong>IN VERSIONE FDC</strong></p><p>Conservazione: FDC <b>SET ZECCA</b></p>",
  );
});

test("removes unsafe script and style blocks", () => {
  assert.equal(
    cleanEbayDescriptionHtml(
      "<style>.red{color:red}</style><script>alert(1)</script><p>Descrizione pulita</p>",
    ).html,
    "<p>Descrizione pulita</p>",
  );
});

test("truncates cross-sell, social and legal footer tails", () => {
  assert.equal(
    cleanEbayDescriptionHtml(
      "<p>Moneta da 2 euro commemorativa in conservazione FDC.</p><p>Potrebbe interessarti anche il nostro album da collezione.</p>",
    ).html,
    "<p>Moneta da 2 euro commemorativa in conservazione FDC.</p>",
  );

  assert.equal(
    cleanEbayDescriptionHtml(
      "<p>Francobollo raro del 1950 in ottimo stato.</p><p>Seguici su Facebook e Instagram per le novita.</p>",
    ).html,
    "<p>Francobollo raro del 1950 in ottimo stato.</p>",
  );

  assert.equal(
    cleanEbayDescriptionHtml(
      "<p>Orologio vintage funzionante e revisionato.</p><p>Tutti i diritti riservati. Partita IVA 01234567890.</p>",
    ).html,
    "<p>Orologio vintage funzionante e revisionato.</p>",
  );
});

test("drops cross-sell template blocks", () => {
  assert.equal(
    cleanEbayDescriptionHtml(
      "<p>Vaso in ceramica decorato a mano.</p><table><tr><td>Altri nostri oggetti in vendita</td></tr></table>",
    ).html,
    "<p>Vaso in ceramica decorato a mano.</p>",
  );
});
