import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import type { ProductWithOffers, Offer } from "@shopsavvy/sdk";
import { getShopSavvyClient } from "./shopsavvy.server";
import db from "../db.server";

interface ShopifyProduct {
  id: string;
  title: string;
  variants: {
    edges: Array<{
      node: {
        id: string;
        price: string;
        barcode: string | null;
        sku: string | null;
      };
    }>;
  };
}

interface ShopifyProductsResponse {
  data: {
    products: {
      edges: Array<{
        node: ShopifyProduct;
        cursor: string;
      }>;
      pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
    };
  };
}

/**
 * Fetch the merchant's products from their Shopify store via the Admin GraphQL API.
 */
export async function fetchMerchantProducts({ admin, first = 50, after }: {
  admin: AdminApiContext;
  first?: number;
  after?: string;
}): Promise<{
  products: ShopifyProduct[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}> {
  const response = await admin.graphql(
    `#graphql
    query getProducts($first: Int!, $after: String) {
      products(first: $first, after: $after) {
        edges {
          node {
            id
            title
            variants(first: 10) {
              edges {
                node {
                  id
                  price
                  barcode
                  sku
                }
              }
            }
          }
          cursor
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }`,
    {
      variables: { first, after },
    }
  );

  const json = (await response.json()) as ShopifyProductsResponse;
  const edges = json.data.products.edges;

  return {
    products: edges.map((edge) => edge.node),
    pageInfo: json.data.products.pageInfo,
  };
}

/**
 * Build a search identifier for a Shopify product.
 * Prefers barcode (UPC/EAN), falls back to SKU, then product title.
 */
function getSearchIdentifier({ product }: {
  product: ShopifyProduct
}): string | null {
  // Try the first variant's barcode
  for (const edge of product.variants.edges) {
    if (edge.node.barcode) {
      return edge.node.barcode;
    }
  }

  // Try the first variant's SKU
  for (const edge of product.variants.edges) {
    if (edge.node.sku) {
      return edge.node.sku;
    }
  }

  // Fall back to title search
  return product.title;
}

/**
 * Get the merchant's price for a product (from the first variant).
 */
function getMerchantPrice({ product }: {
  product: ShopifyProduct
}): number | null {
  const firstVariant = product.variants.edges[0]?.node;
  if (!firstVariant?.price) return null;
  return parseFloat(firstVariant.price);
}

/**
 * Find the lowest-priced offer from a list of offers.
 */
function findLowestOffer({ offers }: {
  offers: Offer[]
}): Offer | null {
  let lowest: Offer | null = null;

  for (const offer of offers) {
    if (offer.price != null && (lowest == null || offer.price < (lowest.price ?? Infinity))) {
      lowest = offer;
    }
  }

  return lowest;
}

/**
 * Sync competitor prices for a single Shopify product.
 * Looks up the product in ShopSavvy using barcode/SKU/title and caches the results.
 *
 * Returns the number of ShopSavvy API credits used (1 per product lookup).
 */
export async function syncProductCompetitorPrices({ shop, product }: {
  shop: string;
  product: ShopifyProduct;
}): Promise<{ creditsUsed: number; success: boolean }> {
  const client = await getShopSavvyClient({ shop });
  if (!client) {
    return { creditsUsed: 0, success: false };
  }

  const identifier = getSearchIdentifier({ product });
  if (!identifier) {
    return { creditsUsed: 0, success: false };
  }

  try {
    const result = await client.getCurrentOffers(identifier);
    const creditsUsed = result.meta?.credits_used ?? 1;

    // Find the best match from the results
    const matched: ProductWithOffers | undefined = result.data?.[0];

    const merchantPrice = getMerchantPrice({ product });
    const lowestOffer = matched ? findLowestOffer({ offers: matched.offers }) : null;

    // Upsert the cache entry
    await db.productCompetitorCache.upsert({
      where: {
        shop_shopifyProductId: {
          shop,
          shopifyProductId: product.id,
        },
      },
      create: {
        shop,
        shopifyProductId: product.id,
        shopifyVariantId: product.variants.edges[0]?.node.id ?? null,
        productTitle: product.title,
        merchantPrice,
        lowestPrice: lowestOffer?.price ?? null,
        lowestRetailer: lowestOffer?.retailer ?? null,
        offerCount: matched?.offers?.length ?? 0,
        offersJson: JSON.stringify(matched?.offers ?? []),
        shopsavvyId: matched?.shopsavvy ?? null,
        lastSyncedAt: new Date(),
      },
      update: {
        productTitle: product.title,
        merchantPrice,
        lowestPrice: lowestOffer?.price ?? null,
        lowestRetailer: lowestOffer?.retailer ?? null,
        offerCount: matched?.offers?.length ?? 0,
        offersJson: JSON.stringify(matched?.offers ?? []),
        shopsavvyId: matched?.shopsavvy ?? null,
        lastSyncedAt: new Date(),
      },
    });

    return { creditsUsed, success: true };
  } catch (error) {
    console.error(`Failed to sync competitor prices for ${product.title}:`, error);
    return { creditsUsed: 0, success: false };
  }
}

/**
 * Sync competitor prices for all of a merchant's products.
 * Fetches products page by page and looks each up in ShopSavvy.
 *
 * This is expensive in credits - 1 credit per product. Should be used sparingly
 * and ideally with user confirmation before running.
 */
export async function syncAllProducts({ shop, admin, maxProducts = 50 }: {
  shop: string;
  admin: AdminApiContext;
  maxProducts?: number;
}): Promise<{ totalSynced: number; totalCreditsUsed: number; errors: number }> {
  let totalSynced = 0;
  let totalCreditsUsed = 0;
  let errors = 0;
  let after: string | undefined;

  while (totalSynced < maxProducts) {
    const batchSize = Math.min(50, maxProducts - totalSynced);
    const { products, pageInfo } = await fetchMerchantProducts({
      admin,
      first: batchSize,
      after,
    });

    for (const product of products) {
      const result = await syncProductCompetitorPrices({ shop, product });
      totalCreditsUsed += result.creditsUsed;

      if (result.success) {
        totalSynced++;
      } else {
        errors++;
      }
    }

    if (!pageInfo.hasNextPage) break;
    after = pageInfo.endCursor ?? undefined;
  }

  return { totalSynced, totalCreditsUsed, errors };
}
