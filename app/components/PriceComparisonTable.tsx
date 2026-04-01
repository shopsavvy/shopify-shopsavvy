import {
  IndexTable,
  Text,
  Badge,
  Link,
  BlockStack,
  InlineStack,
} from "@shopify/polaris";

export interface PriceComparisonOffer {
  id: string;
  retailer?: string;
  price?: number;
  currency?: string;
  condition?: string;
  availability?: string;
  URL?: string;
  seller?: string;
  timestamp?: string;
}

interface PriceComparisonTableProps {
  offers: PriceComparisonOffer[];
  merchantPrice?: number | null;
}

function formatPrice({ price, currency }: {
  price?: number;
  currency?: string;
}): string {
  if (price == null) return "N/A";
  const curr = currency || "USD";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: curr,
  }).format(price);
}

function formatTimestamp({ timestamp }: {
  timestamp?: string
}): string {
  if (!timestamp) return "Unknown";
  try {
    return new Date(timestamp).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return timestamp;
  }
}

function getConditionBadge({ condition }: {
  condition?: string
}): React.ReactNode {
  if (!condition) return null;

  const normalized = condition.toLowerCase();
  if (normalized === "new") {
    return <Badge tone="success">New</Badge>;
  } else if (normalized.includes("refurb")) {
    return <Badge tone="warning">Refurbished</Badge>;
  } else if (normalized.includes("used")) {
    return <Badge tone="attention">Used</Badge>;
  }

  return <Badge>{condition}</Badge>;
}

function getAvailabilityBadge({ availability }: {
  availability?: string
}): React.ReactNode {
  if (!availability) return null;

  const normalized = availability.toLowerCase();
  if (normalized.includes("in stock") || normalized.includes("instock")) {
    return <Badge tone="success">In Stock</Badge>;
  } else if (normalized.includes("out of stock") || normalized.includes("outofstock")) {
    return <Badge tone="critical">Out of Stock</Badge>;
  }

  return <Badge>{availability}</Badge>;
}

function getPriceDelta({ offerPrice, merchantPrice }: {
  offerPrice?: number;
  merchantPrice?: number | null;
}): React.ReactNode {
  if (offerPrice == null || merchantPrice == null) return null;

  const delta = offerPrice - merchantPrice;
  const percent = ((delta / merchantPrice) * 100).toFixed(1);

  if (delta < 0) {
    return (
      <Text as="span" tone="critical" variant="bodySm">
        {formatPrice({ price: delta })} ({percent}%)
      </Text>
    );
  } else if (delta > 0) {
    return (
      <Text as="span" tone="success" variant="bodySm">
        +{formatPrice({ price: delta })} (+{percent}%)
      </Text>
    );
  }

  return (
    <Text as="span" tone="subdued" variant="bodySm">
      Same price
    </Text>
  );
}

export function PriceComparisonTable({ offers, merchantPrice }: PriceComparisonTableProps) {
  if (!offers.length) {
    return (
      <BlockStack gap="200">
        <Text as="p" tone="subdued">
          No competitor offers found for this product. This can happen if the product is very niche or
          the barcode/identifier did not match any known products.
        </Text>
      </BlockStack>
    );
  }

  // Sort by price ascending, nulls at the end
  const sorted = [...offers].sort((a, b) => {
    if (a.price == null && b.price == null) return 0;
    if (a.price == null) return 1;
    if (b.price == null) return -1;
    return a.price - b.price;
  });

  const resourceName = {
    singular: "offer",
    plural: "offers",
  };

  const rowMarkup = sorted.map((offer, index) => (
    <IndexTable.Row id={offer.id} key={offer.id} position={index}>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd" fontWeight="semibold">
          {offer.retailer || "Unknown Retailer"}
        </Text>
        {offer.seller && (
          <Text as="span" tone="subdued" variant="bodySm">
            {" "}
            (via {offer.seller})
          </Text>
        )}
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd" fontWeight="semibold">
          {formatPrice({ price: offer.price, currency: offer.currency })}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        {getPriceDelta({ offerPrice: offer.price, merchantPrice })}
      </IndexTable.Cell>
      <IndexTable.Cell>
        <InlineStack gap="100">
          {getConditionBadge({ condition: offer.condition })}
          {getAvailabilityBadge({ availability: offer.availability })}
        </InlineStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" tone="subdued" variant="bodySm">
          {formatTimestamp({ timestamp: offer.timestamp })}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        {offer.URL ? (
          <Link url={offer.URL} target="_blank" removeUnderline>
            View
          </Link>
        ) : (
          <Text as="span" tone="subdued">--</Text>
        )}
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <IndexTable
      resourceName={resourceName}
      itemCount={sorted.length}
      headings={[
        { title: "Retailer" },
        { title: "Price" },
        { title: "vs. You" },
        { title: "Condition / Availability" },
        { title: "Last Updated" },
        { title: "" },
      ]}
      selectable={false}
    >
      {rowMarkup}
    </IndexTable>
  );
}
