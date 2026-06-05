# Cloudflare D1/R2 Provisioning Guide

Last updated: 2026-06-04

## Prerequisites

- Cloudflare account with Workers paid plan (required for D1/R2)
- Wrangler CLI authenticated: `npx wrangler login`
- Node.js 18+

## Step 1: Create D1 Database

```bash
# Production database
npx wrangler d1 create zero-vault-db

# Staging database (optional)
npx wrangler d1 create zero-vault-db --env staging
```

This outputs a `database_id`. Update `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "zero-vault-db"
database_id = "<your-actual-database-id>"
```

## Step 2: Create R2 Bucket

```bash
# Production bucket
npx wrangler r2 bucket create zero-vault-exports

# Staging bucket (optional)
npx wrangler r2 bucket create zero-vault-exports-staging
```

Update `wrangler.toml`:

```toml
[[r2_buckets]]
binding = "R2"
bucket_name = "zero-vault-exports"
```

## Step 3: Run Migrations

```bash
# Apply migrations to production D1
npx wrangler d1 migrations apply zero-vault-db

# Apply to staging
npx wrangler d1 migrations apply zero-vault-db --env staging
```

## Step 4: Set Production Secrets

```bash
# Generate a stable OPAQUE server setup key (run once, keep secret)
# The key must be valid base64. Generate with:
node -e "console.log(Buffer.from(require('crypto').randomBytes(32)).toString('base64'))"

# Set secrets for production
npx wrangler secret put OPAQUE_SERVER_SETUP
npx wrangler secret put SESSION_SECRET
npx wrangler secret put MAINTENANCE_TOKEN

# Set for staging
npx wrangler secret put OPAQUE_SERVER_SETUP --env staging
npx wrangler secret put SESSION_SECRET --env staging
npx wrangler secret put MAINTENANCE_TOKEN --env staging
```

## Step 5: Configure Environment Variables

Update `wrangler.toml` production environment:

```toml
[env.production]
name = "zero-vault-api-production"

[env.production.vars]
ENVIRONMENT = "production"
CORS_ORIGIN = "https://zero-vault.dev"
```

## Step 6: Deploy

```bash
# Deploy to staging
npx wrangler deploy --env staging

# Deploy to production
npx wrangler deploy
```

## Step 7: Update Web App Environment

Update the web app's environment to point to the deployed Worker:

```env
NEXT_PUBLIC_API_URL=https://zero-vault-api.your-subdomain.workers.dev
```

## Verification

After deployment, verify the endpoints:

```bash
# Health check
curl https://zero-vault-api.your-subdomain.workers.dev/health

# Should return: {"ok":true}
```

## Important Notes

- **OPAQUE_SERVER_SETUP**: Must be a stable, valid base64 string. Changing it invalidates all existing user registrations.
- **SESSION_SECRET**: Must be at least 32 bytes of random data. Changing it invalidates all sessions.
- **D1 Limits**: Free tier allows 5M reads/day, 100K writes/day. Paid tier is usage-based.
- **R2 Limits**: Free tier allows 10M reads/month, 1M writes/month. Paid tier is usage-based.
- **Workers Limits**: Free tier allows 100K requests/day. Paid tier is $0.15/million requests.
