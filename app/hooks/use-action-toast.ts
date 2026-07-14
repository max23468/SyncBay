import { useEffect, useEffectEvent, useRef } from "react";

import { showSyncBayToast } from "../components/syncbay-toast";

type ActionToastResult = { isError?: boolean; message: string } | null;

/**
 * Mostra una sola volta il feedback di un'azione completata. `useEffectEvent`
 * mantiene aggiornato il formatter senza trasformare una callback creata nel
 * render in una dipendenza instabile dell'effetto.
 */
export function useActionToast<T>(
  fetcher: { data: T | undefined; state: string },
  getToast: (data: T) => ActionToastResult,
) {
  const lastDataRef = useRef<T | undefined>(undefined);
  const getToastEvent = useEffectEvent(getToast);

  useEffect(() => {
    if (
      fetcher.state !== "idle" ||
      fetcher.data === undefined ||
      fetcher.data === lastDataRef.current
    ) {
      return;
    }
    lastDataRef.current = fetcher.data;
    const result = getToastEvent(fetcher.data);
    if (result) {
      showSyncBayToast(result.message, { isError: result.isError });
    }
  }, [fetcher.state, fetcher.data]);
}
