import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>SyncBay</h1>
        <p className={styles.text}>
          Dal tuo negozio eBay a Shopify, pronto a vendere.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Dominio shop</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Accedi
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Catalogo eBay.</strong> Import guidato dei listing attivi in
            Shopify.
          </li>
          <li>
            <strong>Disponibilità protetta.</strong> Aggiornamento stock e retry
            prioritari.
          </li>
          <li>
            <strong>Controllo operativo.</strong> Conflitti, diagnostica e log
            pensati per il negoziante.
          </li>
        </ul>
      </div>
    </div>
  );
}
