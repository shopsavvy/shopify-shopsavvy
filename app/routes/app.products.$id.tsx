import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, useNavigate } from "@remix-run/react";
import { useEffect, useCallback } from "react";
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
  Spinner,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { getShopSavvyClient } from "../lib/shopsavvy.server";
import { syncProductCompetitorPrices, fetchMerchantProducts } from "../lib/sync.server";
import { PriceComparisonTable, type PriceComparisonOffer } from "../components/PriceComparisonTable";
import db from "../db.server";

interface LoaderData {
  shop: string;
  hasApiKey: boolean;
  productId: string;
  productTitle: string;
  merchantPrice: number | null;
  lowestPrice: number | null;
  lowestRetailer: string | null;
  offerCount: number;
  offers: PriceComparisonOffer[];
  lastSyncedAt: string | null;
  shopsavvyId: string | null;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const productNumericId = params.id;
  const shopifyProductId = `gid://shopify/Product/${productNumericId}`;

  const client = await getShopSavvyClient({ shop });
  const hasApiKey = client !== null;

  // Look up cached data for this product
  const cached = await db.productCompetitorCache.findUnique({
    where: {
      shop_shopifyProductId: {
        shop,
        shopifyProductId,
      },
    },
  });

  let offers: PriceComparisonOffer[] = [];
  try {
    offers = cached?.offersJson ? JSON.parse(cached.offersJson) : [];
  } catch {
    offers = [];
  }

  return json<LoaderData>({
    shop,
    hasApiKey,
    productId: productNumericId!,
    productTitle: cached?.productTitle ?? "Unknown Product",
    merchantPrice: cached?.merchantPrice ?? null,
    lowestPrice: cached?.lowestPrice ?? null,
    lowestRetailer: cached?.lowestRetailer ?? null,
    offerCount: cached?.offerCount ?? 0,
    offers,
    lastSyncedAt: cached?.lastSyncedAt?.toISOString() ?? null,
    shopsavvyId: cached?.shopsavvyId ?? null,
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const productNumericId = params.id;
  const shopifyProductId = `gid://shopify/Product/${productNumericId}`;

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "refresh") {
    // Fetch the specific product from Shopify to get current price/barcode
    const response = await admin.graphql(
      `#graphql
      query getProduct($id: ID!) {
        product(id: $id) {
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
      }`,
      { variables: { id: shopifyProductId } }
    );

    const productJson = await response.json() as any;
    const product = productJson.data?.product;

    if (!product) {
      return json({ intent: "refresh", success: false, error: "Product not found in Shopify" });
    }

    const result = await syncProductCompetitorPrices({ shop, product });

    return json({
      intent: "refresh",
      success: result.success,
      creditsUsed: result.creditsUsed,
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

export default function ProductDetail() {
  const data = useLoaderData<LoaderData>();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const shopify = useAppBridge();

  const isRefreshing =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  const refreshResult = fetcher.data?.intent === "refresh" ? fetcher.data : null;

  useEffect(() => {
    if (refreshResult?.success) {
      shopify.toast.show("Competitor prices refreshed");
    }
  }, [refreshResult, shopify]);

  const handleRefresh = useCallback(() => {
    fetcher.submit({ intent: "refresh" }, { method: "POST" });
  }, [fetcher]);

  if (!data.hasApiKey) {
    return (
      <Page
        backAction={{ content: "Dashboard", onAction: () => navigate("/app") }}
        title={data.productTitle}
      >
        <Layout>
          <Layout.Section>
            <Banner
              title="API key required"
              tone="warning"
              action={{ content: "Go to Settings", url: "/app/settings" }}
            >
              <p>
                Configure your ShopSavvy API key in Settings to see competitor prices.
              </p>
            </Banner>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page
      backAction={{ content: "Dashboard", onAction: () => navigate("/app") }}
      title={data.productTitle}
    >
      <TitleBar title={data.productTitle}>
        <button variant="primary" onClick={handleRefresh} disabled={isRefreshing}>
          {isRefreshing ? "Refreshing..." : "Refresh Prices"}
        </button>
      </TitleBar>

      <BlockStack gap="500">
        <Layout>
          {refreshResult && !refreshResult.success && (
            <Layout.Section>
              <Banner title="Refresh failed" tone="critical">
                <p>Could not refresh competitor prices. Please try again.</p>
              </Banner>
            </Layout.Section>
          )}

          {/* Summary cards */}
          <Layout.Section>
            <InlineStack gap="500" wrap>
              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm" tone="subdued">
                    Your Price
                  </Text>
                  <Text as="p" variant="headingLg">
                    {formatPrice({ price: data.merchantPrice })}
                  </Text>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm" tone="subdued">
                    Lowest Competitor
                  </Text>
                  <Text as="p" variant="headingLg">
                    {formatPrice({ price: data.lowestPrice })}
                  </Text>
                  {data.lowestRetailer && (
                    <Text as="span" variant="bodySm" tone="subdued">
                      at {data.lowestRetailer}
                    </Text>
                  )}
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm" tone="subdued">
                    Price Position
                  </Text>
                  {data.merchantPrice != null && data.lowestPrice != null ? (
                    <>
                      {data.merchantPrice > data.lowestPrice ? (
                        <Badge tone="warning" size="large">
                          Above market ({formatPrice({ price: data.merchantPrice - data.lowestPrice })} higher)
                        </Badge>
                      ) : data.merchantPrice < data.lowestPrice ? (
                        <Badge tone="success" size="large">
                          Below market ({formatPrice({ price: data.lowestPrice - data.merchantPrice })} lower)
                        </Badge>
                      ) : (
                        <Badge tone="info" size="large">
                          At market price
                        </Badge>
                      )}
                    </>
                  ) : (
                    <Badge>No data</Badge>
                  )}
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm" tone="subdued">
                    Competitor Offers
                  </Text>
                  <Text as="p" variant="headingLg">
                    {data.offerCount}
                  </Text>
                </BlockStack>
              </Card>
            </InlineStack>
          </Layout.Section>

          {/* Full price comparison table */}
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    All Competitor Offers
                  </Text>
                  {isRefreshing && (
                    <InlineStack gap="200" blockAlign="center">
                      <Spinner size="small" />
                      <Text as="span" tone="subdued">Refreshing...</Text>
                    </InlineStack>
                  )}
                </InlineStack>

                <PriceComparisonTable
                  offers={data.offers}
                  merchantPrice={data.merchantPrice}
                />

                {data.lastSyncedAt && (
                  <Text as="p" variant="bodySm" tone="subdued">
                    Last synced:{" "}
                    {new Date(data.lastSyncedAt).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </Text>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          {data.shopsavvyId && (
            <Layout.Section>
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    ShopSavvy Product Link
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    View this product's full price history and details on ShopSavvy.
                  </Text>
                  <Button
                    url={`https://shopsavvy.com/products/${data.shopsavvyId}`}
                    target="_blank"
                  >
                    View on ShopSavvy
                  </Button>
                </BlockStack>
              </Card>
            </Layout.Section>
          )}
        </Layout>
      </BlockStack>
    </Page>
  );
}
