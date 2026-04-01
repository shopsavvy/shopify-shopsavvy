import { useEffect, useCallback } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Banner,
  IndexTable,
  Link,
  EmptyState,
  Spinner,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { getShopSavvyClient } from "../lib/shopsavvy.server";
import { fetchMerchantProducts, syncAllProducts } from "../lib/sync.server";
import { CreditUsageMeter } from "../components/CreditUsageMeter";
import db from "../db.server";

interface CachedProduct {
  shopifyProductId: string;
  productTitle: string;
  merchantPrice: number | null;
  lowestPrice: number | null;
  lowestRetailer: string | null;
  offerCount: number;
  lastSyncedAt: string | null;
}

interface LoaderData {
  shop: string;
  hasApiKey: boolean;
  products: CachedProduct[];
  totalShopifyProducts: number;
  usage: {
    creditsUsed: number;
    creditsLimit: number;
    periodStart?: string;
    periodEnd?: string;
  } | null;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  // Check if the merchant has configured their API key
  const client = await getShopSavvyClient({ shop });
  const hasApiKey = client !== null;

  // Fetch cached competitor data
  const cached = await db.productCompetitorCache.findMany({
    where: { shop },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  const products: CachedProduct[] = cached.map((c) => ({
    shopifyProductId: c.shopifyProductId,
    productTitle: c.productTitle,
    merchantPrice: c.merchantPrice,
    lowestPrice: c.lowestPrice,
    lowestRetailer: c.lowestRetailer,
    offerCount: c.offerCount,
    lastSyncedAt: c.lastSyncedAt?.toISOString() ?? null,
  }));

  // Get total product count from Shopify
  let totalShopifyProducts = 0;
  try {
    const countResponse = await admin.graphql(`#graphql
      query { productsCount { count } }
    `);
    const countJson = await countResponse.json() as any;
    totalShopifyProducts = countJson.data?.productsCount?.count ?? 0;
  } catch {
    totalShopifyProducts = products.length;
  }

  // Fetch usage info if API key is configured
  let usage: LoaderData["usage"] = null;
  if (client) {
    try {
      const usageResult = await client.getUsage();
      const period = usageResult.data.current_period;
      usage = {
        creditsUsed: period.credits_used,
        creditsLimit: period.credits_limit,
        periodStart: period.start_date,
        periodEnd: period.end_date,
      };
    } catch {
      // Usage fetch failed, will show null
    }
  }

  return json<LoaderData>({
    shop,
    hasApiKey,
    products,
    totalShopifyProducts,
    usage,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "sync") {
    const maxProducts = parseInt(formData.get("maxProducts") as string) || 25;

    const result = await syncAllProducts({
      shop,
      admin,
      maxProducts,
    });

    return json({
      intent: "sync",
      success: true,
      totalSynced: result.totalSynced,
      totalCreditsUsed: result.totalCreditsUsed,
      errors: result.errors,
    });
  }

  return json({ intent: "unknown", success: false });
};

function formatPrice({ price }: { price?: number | null }): string {
  if (price == null) return "--";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(price);
}

function getDeltaBadge({ merchantPrice, lowestPrice }: {
  merchantPrice: number | null;
  lowestPrice: number | null;
}): React.ReactNode {
  if (merchantPrice == null || lowestPrice == null) {
    return <Badge>No data</Badge>;
  }

  const delta = merchantPrice - lowestPrice;
  const percent = Math.abs((delta / merchantPrice) * 100).toFixed(0);

  if (delta > 0.01) {
    // Merchant price is higher than competitor
    return (
      <Badge tone="warning">
        You're {formatPrice({ price: delta })} higher ({percent}%)
      </Badge>
    );
  } else if (delta < -0.01) {
    // Merchant price is lower
    return (
      <Badge tone="success">
        You're {formatPrice({ price: Math.abs(delta) })} lower
      </Badge>
    );
  }

  return <Badge tone="info">Price matched</Badge>;
}

export default function Dashboard() {
  const { shop, hasApiKey, products, totalShopifyProducts, usage } =
    useLoaderData<LoaderData>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const isSyncing =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  const syncResult = fetcher.data?.intent === "sync" ? fetcher.data : null;

  useEffect(() => {
    if (syncResult?.success) {
      shopify.toast.show(
        `Synced ${syncResult.totalSynced} products (${syncResult.totalCreditsUsed} credits used)`
      );
    }
  }, [syncResult, shopify]);

  const handleSync = useCallback(() => {
    fetcher.submit(
      { intent: "sync", maxProducts: "25" },
      { method: "POST" }
    );
  }, [fetcher]);

  // Not configured state
  if (!hasApiKey) {
    return (
      <Page>
        <TitleBar title="ShopSavvy Price Intelligence" />
        <Layout>
          <Layout.Section>
            <Card>
              <EmptyState
                heading="Connect your ShopSavvy API key"
                action={{
                  content: "Go to Settings",
                  url: "/app/settings",
                }}
                secondaryAction={{
                  content: "Get an API key",
                  url: "https://shopsavvy.com/data",
                  target: "_blank",
                }}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>
                  To see competitor prices for your products, connect your ShopSavvy Data API key.
                  ShopSavvy monitors prices across thousands of retailers so you always
                  know where you stand.
                </p>
              </EmptyState>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  // No products synced yet
  if (products.length === 0) {
    return (
      <Page>
        <TitleBar title="ShopSavvy Price Intelligence" />
        <Layout>
          <Layout.Section>
            {usage && (
              <CreditUsageMeter
                creditsUsed={usage.creditsUsed}
                creditsLimit={usage.creditsLimit}
                periodStart={usage.periodStart}
                periodEnd={usage.periodEnd}
              />
            )}
          </Layout.Section>
          <Layout.Section>
            <Card>
              <EmptyState
                heading="Sync your products"
                action={{
                  content: isSyncing ? "Syncing..." : "Sync Products Now",
                  onAction: handleSync,
                  loading: isSyncing,
                }}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>
                  You have {totalShopifyProducts} products in your store. Click below to look up
                  competitor prices using ShopSavvy. This will use your ShopSavvy API to look up competitor prices.
                </p>
              </EmptyState>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  // Main dashboard with data
  const resourceName = {
    singular: "product",
    plural: "products",
  };

  const rowMarkup = products.map((product, index) => {
    const productNumericId = product.shopifyProductId.replace(
      "gid://shopify/Product/",
      ""
    );

    return (
      <IndexTable.Row
        id={product.shopifyProductId}
        key={product.shopifyProductId}
        position={index}
      >
        <IndexTable.Cell>
          <Link url={`/app/products/${productNumericId}`} removeUnderline>
            <Text as="span" variant="bodyMd" fontWeight="semibold">
              {product.productTitle}
            </Text>
          </Link>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodyMd">
            {formatPrice({ price: product.merchantPrice })}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <BlockStack gap="100">
            <Text as="span" variant="bodyMd">
              {formatPrice({ price: product.lowestPrice })}
            </Text>
            {product.lowestRetailer && (
              <Text as="span" variant="bodySm" tone="subdued">
                at {product.lowestRetailer}
              </Text>
            )}
          </BlockStack>
        </IndexTable.Cell>
        <IndexTable.Cell>
          {getDeltaBadge({
            merchantPrice: product.merchantPrice,
            lowestPrice: product.lowestPrice,
          })}
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodySm" tone="subdued">
            {product.offerCount} offer{product.offerCount !== 1 ? "s" : ""}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodySm" tone="subdued">
            {product.lastSyncedAt
              ? new Date(product.lastSyncedAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })
              : "Never"}
          </Text>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <Page>
      <TitleBar title="ShopSavvy Price Intelligence">
        <button variant="primary" onClick={handleSync} disabled={isSyncing}>
          {isSyncing ? "Syncing..." : "Sync Prices"}
        </button>
      </TitleBar>

      <BlockStack gap="500">
        <Layout>
          {syncResult && (
            <Layout.Section>
              <Banner
                title="Sync complete"
                tone="success"
                onDismiss={() => {}}
              >
                <p>
                  Synced {syncResult.totalSynced} products using{" "}
                  {syncResult.totalCreditsUsed} API credits.
                  {syncResult.errors > 0 &&
                    ` ${syncResult.errors} products could not be matched.`}
                </p>
              </Banner>
            </Layout.Section>
          )}

          <Layout.Section>
            <Card>
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Your Products vs. Competitors
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {products.length} of {totalShopifyProducts} products tracked
                  </Text>
                </InlineStack>

                {isSyncing && (
                  <InlineStack gap="200" blockAlign="center">
                    <Spinner size="small" />
                    <Text as="span" tone="subdued">
                      Fetching competitor prices...
                    </Text>
                  </InlineStack>
                )}
              </BlockStack>

              <IndexTable
                resourceName={resourceName}
                itemCount={products.length}
                headings={[
                  { title: "Product" },
                  { title: "Your Price" },
                  { title: "Lowest Competitor" },
                  { title: "Delta" },
                  { title: "Offers" },
                  { title: "Last Synced" },
                ]}
                selectable={false}
              >
                {rowMarkup}
              </IndexTable>
            </Card>
          </Layout.Section>

          {usage && (
            <Layout.Section variant="oneThird">
              <CreditUsageMeter
                creditsUsed={usage.creditsUsed}
                creditsLimit={usage.creditsLimit}
                periodStart={usage.periodStart}
                periodEnd={usage.periodEnd}
              />
            </Layout.Section>
          )}
        </Layout>
      </BlockStack>
    </Page>
  );
}
