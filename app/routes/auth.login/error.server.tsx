import type { LoginError } from "@shopify/shopify-app-react-router/server";
import { LoginErrorType } from "@shopify/shopify-app-react-router/server";

interface LoginErrorMessage {
  shop?: string;
}

export function loginErrorMessage(loginErrors: LoginError): LoginErrorMessage {
  if (loginErrors?.shop === LoginErrorType.MissingShop) {
    return { shop: "Inserisci il dominio dello shop per accedere" };
  } else if (loginErrors?.shop === LoginErrorType.InvalidShop) {
    return { shop: "Inserisci un dominio shop valido" };
  }

  return {};
}
