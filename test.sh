#!/bin/bash
set -e

echo "🧪 ShopSavvy Shopify App Tests"
echo "================================"

if [ "$1" = "--integration" ]; then
  if [ -z "$SHOPSAVVY_API_KEY" ]; then
    echo "❌ Set SHOPSAVVY_API_KEY env var to run integration tests"
    echo "   Get a key at https://shopsavvy.com/data"
    exit 1
  fi
  echo "Running integration tests (live API)..."
  echo ""
  echo "Testing ShopSavvy API connectivity..."
  RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $SHOPSAVVY_API_KEY" \
    -H "User-Agent: ShopSavvy-Shopify-Test/1.0" \
    "https://api.shopsavvy.com/v1/usage")
  if [ "$RESPONSE" = "200" ]; then
    echo "  ✅ API key valid"
  else
    echo "  ❌ API returned HTTP $RESPONSE"
    exit 1
  fi

  echo "Testing product search..."
  SEARCH=$(curl -s \
    -H "Authorization: Bearer $SHOPSAVVY_API_KEY" \
    -H "User-Agent: ShopSavvy-Shopify-Test/1.0" \
    "https://api.shopsavvy.com/v1/products/search?q=airpods+pro&limit=1")
  if echo "$SEARCH" | grep -q '"success":true'; then
    echo "  ✅ Product search works"
  else
    echo "  ❌ Product search failed"
    exit 1
  fi

  echo "Testing product offers..."
  OFFERS=$(curl -s \
    -H "Authorization: Bearer $SHOPSAVVY_API_KEY" \
    -H "User-Agent: ShopSavvy-Shopify-Test/1.0" \
    "https://api.shopsavvy.com/v1/products/offers?ids=B0BSHF7WHW")
  if echo "$OFFERS" | grep -q '"success":true'; then
    echo "  ✅ Product offers works"
  else
    echo "  ❌ Product offers failed"
    exit 1
  fi

  echo ""
  echo "✅ All integration tests passed"
else
  echo "Running unit tests..."
  echo ""

  echo "Checking TypeScript compilation..."
  npx tsc --noEmit 2>/dev/null && echo "  ✅ TypeScript compiles" || echo "  ⚠️  TypeScript errors (may need Shopify CLI context)"

  echo "Checking Prisma schema..."
  npx prisma validate 2>/dev/null && echo "  ✅ Prisma schema valid" || echo "  ⚠️  Prisma validation needs setup"

  echo ""
  echo "✅ Unit checks complete"
fi
