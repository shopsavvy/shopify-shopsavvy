import { useState, useCallback } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  TextField,
  Button,
  Banner,
  InlineStack,
  Link,
  List,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { validateApiKey, invalidateClientCache } from "../lib/shopsavvy.server";
import { CreditUsageMeter } from "../components/CreditUsageMeter";
import db from "../db.server";

interface LoaderData {
  shop: string;
  apiKey: string;
  hasApiKey: boolean;
  usage: {
    creditsUsed: number;
    creditsLimit: number;
    periodStart?: string;
    periodEnd?: string;
  } | null;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const settings = await db.shopSettings.findUnique({
    where: { shop },
  });

  const apiKey = settings?.apiKey ?? "";
  const hasApiKey = !!apiKey;

  // Fetch usage if key exists
  let usage: LoaderData["usage"] = null;
  if (hasApiKey) {
    try {
      const { ShopSavvyDataAPI } = await import("@shopsavvy/sdk");
      const client = new ShopSavvyDataAPI({ apiKey });
      const usageResult = await client.getUsage();
      const period = usageResult.data.current_period;
      usage = {
        creditsUsed: period.credits_used,
        creditsLimit: period.credits_limit,
        periodStart: period.start_date,
        periodEnd: period.end_date,
      };
    } catch {
      // Could not fetch usage
    }
  }

  // Mask API key for display (show first 8 chars + last 4)
  const maskedKey = apiKey
    ? apiKey.slice(0, 8) + "..." + apiKey.slice(-4)
    : "";

  return json<LoaderData>({
    shop,
    apiKey: maskedKey,
    hasApiKey,
    usage,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "save-key") {
    const newApiKey = (formData.get("apiKey") as string)?.trim() ?? "";

    if (!newApiKey) {
      return json({
        intent: "save-key",
        success: false,
        error: "API key is required.",
      });
    }

    // Validate the key before saving
    const validation = await validateApiKey({ apiKey: newApiKey });

    if (!validation.valid) {
      return json({
        intent: "save-key",
        success: false,
        error: validation.error ?? "Invalid API key.",
      });
    }

    // Upsert the settings
    await db.shopSettings.upsert({
      where: { shop },
      create: { shop, apiKey: newApiKey },
      update: { apiKey: newApiKey },
    });

    // Invalidate the cached client so the next request uses the new key
    invalidateClientCache({ shop });

    return json({
      intent: "save-key",
      success: true,
      creditsRemaining: validation.creditsRemaining,
    });
  }

  if (intent === "remove-key") {
    await db.shopSettings.deleteMany({ where: { shop } });
    invalidateClientCache({ shop });

    return json({
      intent: "remove-key",
      success: true,
    });
  }

  return json({ intent: "unknown", success: false });
};

export default function Settings() {
  const { shop, apiKey, hasApiKey, usage } = useLoaderData<LoaderData>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [newApiKey, setNewApiKey] = useState("");

  const isSubmitting = ["loading", "submitting"].includes(fetcher.state);

  const saveResult = fetcher.data?.intent === "save-key" ? fetcher.data : null;
  const removeResult = fetcher.data?.intent === "remove-key" ? fetcher.data : null;

  const handleSave = useCallback(() => {
    fetcher.submit(
      { intent: "save-key", apiKey: newApiKey },
      { method: "POST" }
    );
  }, [fetcher, newApiKey]);

  const handleRemove = useCallback(() => {
    fetcher.submit({ intent: "remove-key" }, { method: "POST" });
  }, [fetcher]);

  return (
    <Page>
      <TitleBar title="Settings" />

      <BlockStack gap="500">
        <Layout>
          {saveResult?.success && (
            <Layout.Section>
              <Banner
                title="API key saved"
                tone="success"
                onDismiss={() => {}}
              >
                <p>
                  Your ShopSavvy API key has been validated and saved.
                  {saveResult.creditsRemaining != null &&
                    ` You have ${saveResult.creditsRemaining.toLocaleString()} credits remaining.`}
                </p>
              </Banner>
            </Layout.Section>
          )}

          {saveResult && !saveResult.success && (
            <Layout.Section>
              <Banner title="Could not save API key" tone="critical">
                <p>{saveResult.error}</p>
              </Banner>
            </Layout.Section>
          )}

          {removeResult?.success && (
            <Layout.Section>
              <Banner
                title="API key removed"
                tone="info"
                onDismiss={() => {}}
              >
                <p>Your ShopSavvy API key has been removed.</p>
              </Banner>
            </Layout.Section>
          )}

          {/* API Key Configuration */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  ShopSavvy Data API Key
                </Text>

                <Text as="p" variant="bodyMd">
                  Enter your ShopSavvy Data API key to enable competitor price monitoring.
                  Your API key is used to look up competitor prices for your products.
                </Text>

                {hasApiKey && (
                  <Banner tone="info">
                    <p>
                      Current key: <strong>{apiKey}</strong>
                    </p>
                  </Banner>
                )}

                <TextField
                  label="API Key"
                  value={newApiKey}
                  onChange={setNewApiKey}
                  placeholder="ss_live_your_api_key_here"
                  helpText="API keys start with ss_live_ or ss_test_"
                  autoComplete="off"
                  type="password"
                />

                <InlineStack gap="300">
                  <Button
                    variant="primary"
                    onClick={handleSave}
                    loading={isSubmitting && fetcher.formData?.get("intent") === "save-key"}
                    disabled={!newApiKey.trim()}
                  >
                    {hasApiKey ? "Update API Key" : "Save API Key"}
                  </Button>

                  {hasApiKey && (
                    <Button
                      tone="critical"
                      onClick={handleRemove}
                      loading={isSubmitting && fetcher.formData?.get("intent") === "remove-key"}
                    >
                      Remove Key
                    </Button>
                  )}
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Usage meter */}
          {usage && (
            <Layout.Section>
              <CreditUsageMeter
                creditsUsed={usage.creditsUsed}
                creditsLimit={usage.creditsLimit}
                periodStart={usage.periodStart}
                periodEnd={usage.periodEnd}
              />
            </Layout.Section>
          )}

          {/* Info section */}
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  About ShopSavvy Data API
                </Text>

                <Text as="p" variant="bodyMd">
                  The ShopSavvy Data API provides access to real-time pricing data
                  from thousands of retailers and millions of products.
                </Text>

                <InlineStack gap="300">
                  <Button url="https://shopsavvy.com/data" target="_blank">
                    Get an API Key
                  </Button>
                  <Button
                    url="https://shopsavvy.com/data/documentation"
                    target="_blank"
                    variant="plain"
                  >
                    View Documentation
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
