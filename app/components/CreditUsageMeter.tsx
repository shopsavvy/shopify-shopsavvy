import {
  Card,
  Text,
  BlockStack,
  ProgressBar,
  InlineStack,
} from "@shopify/polaris";

interface CreditUsageMeterProps {
  creditsUsed: number;
  creditsLimit: number;
  periodStart?: string;
  periodEnd?: string;
}

function formatDate({ date }: { date?: string }): string {
  if (!date) return "";
  try {
    return new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return date;
  }
}

export function CreditUsageMeter({
  creditsUsed,
  creditsLimit,
  periodStart,
  periodEnd,
}: CreditUsageMeterProps) {
  const remaining = Math.max(0, creditsLimit - creditsUsed);
  const usagePercent = creditsLimit > 0 ? Math.min(100, (creditsUsed / creditsLimit) * 100) : 0;

  let tone: "success" | "warning" | "critical" = "success";
  if (usagePercent >= 90) {
    tone = "critical";
  } else if (usagePercent >= 70) {
    tone = "warning";
  }

  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">
          API Usage
        </Text>

        <ProgressBar progress={usagePercent} tone={tone} size="small" />

        <InlineStack align="space-between">
          <Text as="span" variant="bodySm" tone="subdued">
            {creditsUsed.toLocaleString()} / {creditsLimit.toLocaleString()} credits used
          </Text>
          <Text as="span" variant="bodySm" fontWeight="semibold">
            {remaining.toLocaleString()} remaining
          </Text>
        </InlineStack>

        {(periodStart || periodEnd) && (
          <Text as="p" variant="bodySm" tone="subdued">
            Billing period: {formatDate({ date: periodStart })} &mdash; {formatDate({ date: periodEnd })}
          </Text>
        )}

        {usagePercent >= 90 && (
          <Text as="p" variant="bodySm" tone="critical">
            You are running low. Visit shopsavvy.com/data to manage your account.
          </Text>
        )}
      </BlockStack>
    </Card>
  );
}
