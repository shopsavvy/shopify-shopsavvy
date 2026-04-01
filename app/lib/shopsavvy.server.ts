import { ShopSavvyDataAPI } from "@shopsavvy/sdk";
import db from "../db.server";

// Cache of ShopSavvy API clients per shop, keyed by shop domain
const clientCache = new Map<string, ShopSavvyDataAPI>();

/**
 * Get or create a ShopSavvy API client for a given shop.
 * Reads the API key from the ShopSettings table in the database.
 * Returns null if no API key is configured.
 */
export async function getShopSavvyClient({ shop }: {
  shop: string
}): Promise<ShopSavvyDataAPI | null> {
  // Check if we already have a cached client for this shop
  const cached = clientCache.get(shop);
  if (cached) {
    return cached;
  }

  // Look up the shop's API key from the database
  const settings = await db.shopSettings.findUnique({
    where: { shop },
  });

  if (!settings?.apiKey) {
    return null;
  }

  try {
    const client = new ShopSavvyDataAPI({
      apiKey: settings.apiKey,
    });

    clientCache.set(shop, client);
    return client;
  } catch {
    // Invalid API key format or other initialization error
    return null;
  }
}

/**
 * Invalidate the cached client for a shop (e.g., when they update their API key).
 */
export function invalidateClientCache({ shop }: {
  shop: string
}): void {
  clientCache.delete(shop);
}

/**
 * Validate an API key by attempting to call getUsage().
 * Returns the usage info on success, or an error message on failure.
 */
export async function validateApiKey({ apiKey }: {
  apiKey: string
}): Promise<{ valid: boolean; error?: string; creditsRemaining?: number }> {
  try {
    const client = new ShopSavvyDataAPI({ apiKey });
    const usage = await client.getUsage();

    return {
      valid: true,
      creditsRemaining: usage.data.current_period.credits_remaining,
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Invalid API key",
    };
  }
}
