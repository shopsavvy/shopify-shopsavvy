import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  // Also clean up shop settings and cached data on uninstall
  await db.shopSettings.deleteMany({ where: { shop: shop ?? undefined } }).catch(() => {});
  await db.productCompetitorCache.deleteMany({ where: { shop: shop ?? undefined } }).catch(() => {});

  return new Response();
};
