# ShopSavvy for Shopify

Competitor price intelligence for Shopify merchants. Monitor what your competitors charge for the same products across thousands of retailers, all from within your Shopify admin.

## What It Does

ShopSavvy for Shopify connects your store to the [ShopSavvy Data API](https://shopsavvy.com/data) to provide real-time competitor price monitoring:

- **Dashboard** -- See all your products alongside the lowest competitor price, the price delta, and which retailer has the best price
- **Product Detail** -- Drill into any product to see a full comparison table with every retailer offer (price, condition, availability, seller)
- **Automatic Matching** -- Products are matched using barcodes (UPC/EAN), SKUs, or product titles
- **API Usage Meter** -- Track your API usage directly in the app

## How It Works

1. Install the app in your Shopify store
2. Enter your ShopSavvy Data API key in Settings
3. Click "Sync Products" to look up competitor prices for your catalog
4. View the dashboard to see where you stand vs. competitors

## Requirements

- A Shopify store
- A [ShopSavvy Data API key](https://shopsavvy.com/data)
- Node.js >= 20.19

## Setup & Development

### 1. Install dependencies

```bash
npm install
```

### 2. Set up the database

```bash
npx prisma migrate dev
```

### 3. Configure Shopify CLI

You need a [Shopify Partner](https://partners.shopify.com/) account and an app created in the Partner Dashboard.

```bash
# Link to your app in the Partner Dashboard
npm run config:link
```

### 4. Start development

```bash
npm run dev
```

This starts the Shopify CLI dev server, which handles the OAuth tunnel and app embedding.

## Project Structure

```
app/
  components/
    CreditUsageMeter.tsx      -- API usage progress bar
    PriceComparisonTable.tsx   -- Retailer/price/condition comparison table
  lib/
    shopsavvy.server.ts        -- ShopSavvy SDK client singleton & validation
    sync.server.ts             -- Background sync logic for fetching competitor prices
  routes/
    app._index.tsx             -- Dashboard (product list with competitor prices)
    app.products.$id.tsx       -- Product detail with full price comparison
    app.settings.tsx           -- API key configuration
    app.tsx                    -- App layout with navigation
    auth.$.tsx                 -- Shopify OAuth callback
    auth.login/                -- Login page
    webhooks.*.tsx             -- Shopify webhook handlers
prisma/
  schema.prisma                -- Database schema (sessions, settings, price cache)
```

## Tech Stack

- [Remix](https://remix.run/) -- Full-stack React framework
- [Shopify App Remix](https://shopify.dev/docs/apps/tools/shopify-app-remix) -- Shopify app framework
- [Polaris](https://polaris.shopify.com/) -- Shopify design system
- [Prisma](https://www.prisma.io/) -- Database ORM (SQLite for dev)
- [@shopsavvy/sdk](https://www.npmjs.com/package/@shopsavvy/sdk) -- ShopSavvy Data API client

## Deployment

Follow the [Shopify app deployment guide](https://shopify.dev/docs/apps/deployment) to deploy to production. The app can be hosted on any Node.js hosting provider.

```bash
npm run build
npm run start
```

## License

MIT
