import React from "react";
import { hydrateRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";

import App from "../app/routes/app";
import Activity from "../app/routes/app.activity";
import Catalog from "../app/routes/app.catalog";
import Conflicts from "../app/routes/app.conflicts";
import ImportPreview from "../app/routes/app.import-preview";
import Overview from "../app/routes/app._index";
import Settings from "../app/routes/app.settings";
import {
  getUiFixture,
  type UiFixturePage,
  type UiFixtureState,
} from "./syncbay-ui-fixtures";

declare global {
  interface Window {
    __SYNCBAY_UI_HARNESS__?: {
      page: UiFixturePage;
      state: UiFixtureState;
    };
    __SYNCBAY_UI_HYDRATED__?: boolean;
  }
}

const pageConfig = {
  attivita: { Component: Activity, path: "/app/activity" },
  catalogo: { Component: Catalog, path: "/app/catalog" },
  conflitti: { Component: Conflicts, path: "/app/conflicts" },
  importazione: { Component: ImportPreview, path: "/app/import-preview" },
  impostazioni: { Component: Settings, path: "/app/settings" },
  panoramica: { Component: Overview, path: "/app" },
} satisfies Record<
  UiFixturePage,
  { Component: React.ComponentType; path: string }
>;

const harness = window.__SYNCBAY_UI_HARNESS__;
const root = document.querySelector<HTMLElement>("#syncbay-ui-root");

if (!harness || !root) {
  throw new Error("Configurazione hydration fixture non disponibile.");
}

const config = pageConfig[harness.page];
const data = getUiFixture(harness.page, harness.state);
const childRoutes = Object.entries(pageConfig).map(
  ([page, pageRoute]) => ({
    action: async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 80));
      return {
        intent: "saveSyncTarget",
        message: "Intervallo salvato nella fixture isolata.",
        status: "saved",
        syncTargetSeconds: 300,
      };
    },
    Component: pageRoute.Component,
    id: page,
    loader: async () => {
      if (window.__SYNCBAY_UI_HYDRATED__) {
        await new Promise((resolve) => window.setTimeout(resolve, 80));
      }
      return getUiFixture(
        page as UiFixturePage,
        page === harness.page ? harness.state : "healthy",
      );
    },
    ...(page === "panoramica"
      ? { index: true }
      : { path: pageRoute.path.replace("/app/", "") }),
  }),
);
const router = createMemoryRouter(
  [
    {
      children: childRoutes,
      Component: App,
      id: "app",
      loader: () => ({ apiKey: "render-only" }),
      path: "/app",
    },
  ],
  {
    hydrationData: {
      loaderData: { app: { apiKey: "render-only" }, [harness.page]: data },
    },
    initialEntries: [config.path],
  },
);

hydrateRoot(root, <RouterProvider router={router} />, {
  onRecoverableError(error) {
    console.error("Errore hydration recuperabile:", error);
  },
});

window.setTimeout(() => {
  upgradePolarisPreviewControls();
  window.__SYNCBAY_UI_HYDRATED__ = true;
  root.dataset.hydrated = "true";
  window.dispatchEvent(new Event("syncbay:hydrated"));
  router.subscribe((state) => {
    if (state.navigation.state === "idle") {
      requestAnimationFrame(upgradePolarisPreviewControls);
    }
  });
}, 100);

function upgradePolarisPreviewControls() {
  const selectors = [
    "s-button",
    "s-link",
    "s-text-field",
    "s-select",
    "s-checkbox",
    "s-switch",
  ];

  for (const element of document.querySelectorAll<HTMLElement>(
    selectors.join(","),
  )) {
    const tagName = element.tagName.toLowerCase();
    const label =
      element.getAttribute("aria-label") ??
      element.getAttribute("label") ??
      element.textContent?.trim();
    const role =
      tagName === "s-text-field"
        ? "textbox"
        : tagName === "s-select"
          ? "combobox"
          : tagName === "s-checkbox"
            ? "checkbox"
            : tagName === "s-switch"
              ? "switch"
              : element.hasAttribute("href")
                ? "link"
                : "button";

    element.dataset.syncbayHarnessControl = "true";
    element.setAttribute("role", role);
    element.tabIndex = element.hasAttribute("disabled") ? -1 : 0;
    if (label) element.setAttribute("aria-label", label);
    const href = element.getAttribute("href");
    if (href && !element.dataset.syncbayHarnessNavigation) {
      element.dataset.syncbayHarnessNavigation = "true";
      element.addEventListener("click", (event) => {
        event.preventDefault();
        void router.navigate(href);
      });
    }
    if (
      tagName === "s-button" &&
      element.getAttribute("type") === "submit" &&
      !element.dataset.syncbayHarnessSubmit
    ) {
      element.dataset.syncbayHarnessSubmit = "true";
      element.addEventListener("click", () => {
        element.closest("form")?.requestSubmit();
      });
    }
  }

  for (const grid of document.querySelectorAll<HTMLElement>("s-grid")) {
    const columns = grid.getAttribute("gridtemplatecolumns");
    const rows = grid.getAttribute("gridtemplaterows");
    if (columns) grid.style.gridTemplateColumns = columns;
    if (rows) grid.style.gridTemplateRows = rows;
  }
}
