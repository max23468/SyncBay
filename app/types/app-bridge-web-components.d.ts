// Web components App Bridge (ui-*) caricati dallo script CDN iniettato da
// AppProvider: qui vive solo il typing JSX, non esiste un pacchetto npm.
import type { DetailedHTMLProps, HTMLAttributes } from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "ui-nav-menu": DetailedHTMLProps<
        HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
      "ui-title-bar": DetailedHTMLProps<
        HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
    }
  }
}
