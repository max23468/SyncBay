import type { EbayConnection } from "@prisma/client";

import {
  asEbayTradingRecord,
  buildEbayTradingHeaders,
  buildGetItemRequest,
  getEbayTradingBaseUrl,
  parseEbayTradingResponse,
  type EbayTradingCallName,
} from "../lib/syncbay-ebay-trading";

type EbayTradingConnection = Pick<EbayConnection, "environment" | "marketplaceId">;

export async function callEbayTradingApi(input: {
  accessToken: string;
  callName: EbayTradingCallName;
  connection: EbayTradingConnection;
  requestXml: string;
}) {
  // react-doctor-disable-next-line react-doctor/no-fetch-response-used-without-status-check -- il corpo XML serve anche per gli errori eBay Trading; lo status è verificato subito dopo la lettura.
  const response = await fetch(getEbayTradingBaseUrl(input.connection.environment), {
    body: input.requestXml,
    headers: buildEbayTradingHeaders({
      accessToken: input.accessToken,
      callName: input.callName,
      marketplaceId: input.connection.marketplaceId,
    }),
    method: "POST",
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`eBay Trading API ${input.callName} ha risposto con HTTP ${response.status}.`);
  }

  return parseEbayTradingResponse(input.callName, responseText);
}

export async function getEbayTradingItem(input: {
  accessToken: string;
  connection: EbayTradingConnection;
  includeItemSpecifics?: boolean;
  itemId: string;
}) {
  const body = await callEbayTradingApi({
    accessToken: input.accessToken,
    callName: "GetItem",
    connection: input.connection,
    requestXml: buildGetItemRequest(input),
  });

  return asEbayTradingRecord(body.Item);
}
