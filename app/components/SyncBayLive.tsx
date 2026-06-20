/**
 * Comportamento "vivo" della Panoramica (ADR 0014). Non rende nulla: vive solo
 * lato client dentro l'admin embedded.
 *
 * - Polling leggero: rivalida il loader a intervalli SOLO mentre c'è lavoro in
 *   corso e la tab è in primo piano; si ferma da solo quando il lavoro finisce
 *   o la tab passa in background. Nessuna chiamata provider, solo le query DB
 *   del loader.
 * - Toast: quando una sincronizzazione in corso si completa tra due
 *   revalidation, mostra un toast App Bridge. Usa il global `window.shopify`
 *   (iniettato da App Bridge) per restare sicuro in SSR/preview, dove `window`
 *   non esiste e l'effetto non viene eseguito.
 */
import { useEffect, useRef } from "react";
import { useRevalidator } from "react-router";

import { showSyncBayToast } from "./syncbay-toast";

type ActionToastResult = { isError?: boolean; message: string } | null;

/**
 * Hook condiviso per il feedback delle azioni (ADR 0014): quando una `fetcher`
 * di azione si completa, deriva il messaggio dal risultato e mostra un toast.
 * Da usare nelle superfici con azioni (Conflitti, Attività, ...): evita di
 * reinventare il pattern pagina per pagina. Si attiva una sola volta per
 * risultato nuovo.
 */
export function useActionToast<T>(
  fetcher: { data: T | undefined; state: string },
  getToast: (data: T) => ActionToastResult,
) {
  const lastData = useRef<T | undefined>(undefined);

  useEffect(() => {
    if (
      fetcher.state !== "idle" ||
      fetcher.data === undefined ||
      fetcher.data === lastData.current
    ) {
      return;
    }
    lastData.current = fetcher.data;
    const result = getToast(fetcher.data);
    if (result) {
      showSyncBayToast(result.message, { isError: result.isError });
    }
  }, [fetcher.state, fetcher.data, getToast]);
}

type LiveSyncProps = {
  intervalMs?: number;
  nextRevalidateAt?: string | null;
  working: boolean;
};

export function LiveSync({
  intervalMs = 15000,
  nextRevalidateAt,
  working,
}: LiveSyncProps) {
  const revalidator = useRevalidator();
  const revalidateRef = useRef(revalidator.revalidate);
  const wasWorking = useRef(working);

  useEffect(() => {
    revalidateRef.current = revalidator.revalidate;
  });

  useEffect(() => {
    if (wasWorking.current && !working && !nextRevalidateAt) {
      showSyncBayToast("Sincronizzazione completata");
    }
    wasWorking.current = working;
  }, [nextRevalidateAt, working]);

  useEffect(() => {
    if (!working) return undefined;

    const tick = () => {
      if (document.visibilityState === "visible") {
        revalidateRef.current();
      }
    };
    const id = window.setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);

    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [working, intervalMs]);

  useEffect(() => {
    if (working || !nextRevalidateAt) return undefined;

    const wakeAt = Date.parse(nextRevalidateAt);
    if (Number.isNaN(wakeAt)) return undefined;

    const wake = () => {
      if (document.visibilityState === "visible" && Date.now() >= wakeAt) {
        revalidateRef.current();
      }
    };
    const id = window.setTimeout(wake, Math.max(0, wakeAt - Date.now()));
    document.addEventListener("visibilitychange", wake);

    return () => {
      window.clearTimeout(id);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [nextRevalidateAt, working]);

  return null;
}
