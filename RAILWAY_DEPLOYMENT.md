# Railway Deployment Guide for 316 Auto

## Overview
This application is configured for dual-environment deployment:
- **Development**: Replit (with Replit PostgreSQL and Object Storage)
- **Production**: Railway (with Railway PostgreSQL and Railway Object Storage)

## Railway Setup Instructions

### 1. Create Railway Project
1. Go to [Railway.app](https://railway.app)
2. Click "New Project" → "Deploy from GitHub repo"
3. Select your `garage-management` repository
4. Railway will automatically detect the Node.js application

### 2. Add PostgreSQL Database
1. In your Railway project, click "New" → "Database" → "Add PostgreSQL"
2. Railway will automatically create a PostgreSQL database and set `DATABASE_URL`
3. The database will be automatically linked to your application

### 3. Configure Environment Variables

#### Required Environment Variables

Add these in Railway's "Variables" tab:

**Session & Authentication:**
```
SESSION_SECRET=your-secure-random-string-here
NODE_ENV=production
PORT=5000
```

**Mobile API - JWT Authentication:**
```
JWT_SECRET=your-jwt-secret-min-32-chars
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
```

**CORS Configuration:**
```
WEB_APP_URL=https://your-web-app.railway.app
MOBILE_APP_ORIGIN=capacitor://localhost  # For Capacitor mobile apps
```

**Google Maps (for appointment booking location features):**
```
VITE_GOOGLE_MAPS_API_KEY=your-google-maps-api-key
```

**Email Service (Resend - for email marketing and notifications):**
```
RESEND_API_KEY=your-resend-api-key
RESEND_FROM_EMAIL=noreply@yourdomain.com
```

**Stripe (for payment processing):**
```
STRIPE_SECRET_KEY=sk_live_...
VITE_STRIPE_PUBLIC_KEY=pk_live_...
```

**Railway Object Storage:**

✅ **READY**: The application now includes environment-aware storage adapters that automatically detect and use the appropriate storage backend.

**Storage Options Available:**

The application supports three storage backends via the `STORAGE_TYPE` environment variable:
1. **`replit-gcs`** (default) - Replit Google Cloud Storage (development)
2. **`s3`** - S3-compatible storage (recommended for Railway production)
3. **`local`** - Local filesystem with Railway volumes (simple alternative)

---

### Option A: AWS S3 or S3-Compatible Storage (Recommended for Production)

**Supported Providers:**
- AWS S3
- DigitalOcean Spaces
- Cloudflare R2
- Backblaze B2
- Any S3-compatible service

**Setup Steps:**
1. Create a bucket in your chosen provider
2. Generate access credentials (Access Key ID and Secret Access Key)
3. Configure Railway environment variables (see below)

**Required Environment Variables:**
```bash
STORAGE_TYPE=s3
AWS_REGION=us-east-1                    # Your region
AWS_ACCESS_KEY_ID=your-access-key       # From your provider
AWS_SECRET_ACCESS_KEY=your-secret-key   # From your provider
AWS_BUCKET_NAME=your-bucket-name        # Your bucket name
```

**For Non-AWS S3-Compatible Services (Optional):**
```bash
AWS_ENDPOINT=https://your-endpoint      # e.g., https://nyc3.digitaloceanspaces.com
```

**Features:**
- ✅ Automatic presigned URL generation
- ✅ Public and private file management
- ✅ CDN-friendly URLs
- ✅ Scalable for high traffic

---

### Option B: Railway Volumes with Local Filesystem (Simple Alternative)

**Setup Steps:**
1. In your Railway project: Click "New" → "Volume"
2. Set mount path to `/app/uploads`
3. Configure environment variables (see below)

**Required Environment Variables:**
```bash
STORAGE_TYPE=local
UPLOAD_DIR=/app/uploads                 # Must match Railway volume mount path
APP_URL=https://your-app.railway.app    # Your Railway app URL
```

**Features:**
- ✅ Simple setup, no external service needed
- ✅ Lower cost for small-scale deployments
- ⚠️ Limited scalability (single server)
- ⚠️ Backups require manual configuration

---

### Implementation Details

The storage layer is fully implemented in:
- **`server/storageAdapters.ts`** - Three adapters (Replit GCS, S3, Local)
- **`server/objectStorage.ts`** - Adapter factory and unified interface

**No code changes required!** The application automatically:
1. Detects the `STORAGE_TYPE` environment variable
2. Initializes the appropriate storage adapter
3. Routes all file operations through the adapter

**Storage Adapter Features:**
- Upload URL generation (presigned for cloud, direct for local)
- File downloads with proper streaming
- File existence checks
- Public/private file separation

**Push Notifications (Expo):**
```
EXPO_ACCESS_TOKEN=your-expo-access-token
```

### 4. Database Migration

After deployment, Railway will automatically:
1. Install dependencies
2. Run the build script (`npm run build`)
3. Start the application (`npm start`)

To push your database schema to Railway PostgreSQL:
```bash
# Railway will use the DATABASE_URL from environment
npm run db:push
```

### 5. Custom Domain (Optional)

1. In Railway project settings, go to "Settings" → "Domains"
2. Click "Generate Domain" for a free `.railway.app` subdomain
3. Or add your custom domain and configure DNS records as shown

## Environment-Aware Configuration

The application automatically detects the environment:

**Development (Replit):**
- Uses Replit's PostgreSQL database
- Uses Replit's Object Storage
- Runs with `NODE_ENV=development`
- Hot reload enabled with Vite

**Production (Railway):**
- Uses Railway's PostgreSQL database
- Uses configured storage (local volume or S3)
- Runs with `NODE_ENV=production`
- Serves pre-built static assets

## Storage Migration

### Migrating from Replit Object Storage to Railway

If you have existing files in Replit Object Storage that need to be migrated:

1. **Export from Replit:**
   - Download files from Replit Object Storage pane
   - Or use the GCS client to export programmatically

2. **Import to Railway Storage:**
   - Upload to Railway Volume, or
   - Upload to your S3-compatible bucket

3. **Update database references:**
   - Run a migration script to update file paths in database
   - Update object path references from Replit format to Railway format

## Health Checks

The application includes a health check endpoint at `/api/health` that Railway uses to verify the application is running correctly.

## Mobile API - Separate Deployment (Optional)

For mobile applications, you can deploy a standalone API server to Railway that serves only the REST API endpoints without the frontend.

### Benefits of Separate API Deployment
- Lightweight server optimized for API traffic
- Independent scaling from web application
- Cleaner separation of concerns
- Reduced resource usage for API-only workload

### Setup Steps

1. **Create a New Railway Service:**
   - In your Railway project, click "New" → "GitHub Repo"
   - Select the same repository
   - This creates a second service for the API server

2. **Configure API Server:**
   In the new service's settings:
   - **Start Command**: `tsx server/api-server.ts`
   - **Build Command**: `npm install && npm run db:push --force`

3. **Environment Variables:**
   Copy all required environment variables from the main service, plus:
   ```bash
   # Core Settings
   NODE_ENV=production
   PORT=5000
   
   # Database (shared with main app)
   DATABASE_URL=postgresql://user:pass@host:5432/dbname
   
   # JWT Authentication
   JWT_SECRET=your-jwt-secret-min-32-chars
   JWT_ACCESS_EXPIRY=15m
   JWT_REFRESH_EXPIRY=7d
   
   # CORS Configuration
   WEB_APP_URL=https://your-web-app.railway.app
   MOBILE_APP_ORIGIN=capacitor://localhost
   
   # Storage (same as main app)
   STORAGE_TYPE=s3
   AWS_REGION=us-east-1
   AWS_ACCESS_KEY_ID=your-access-key
   AWS_SECRET_ACCESS_KEY=your-secret-key
   AWS_BUCKET_NAME=your-bucket-name
   ```

4. **Domain Configuration:**
   - Railway auto-generates a domain like `api-production.up.railway.app`
   - Optionally add a custom domain: `api.yourdomain.com`

5. **Test API Server:**
   ```bash
   # Health check
   curl https://your-api.railway.app/health
   
   # API info
   curl https://your-api.railway.app/api
   
   # Login test
   curl -X POST https://your-api.railway.app/api/mobile/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"test@example.com","password":"password123"}'
   ```

### Architecture: Dual Deployment

```
┌─────────────────────────────────────────────────┐
│              Railway Project                     │
├─────────────────────────────────────────────────┤
│                                                  │
│  ┌──────────────────┐  ┌──────────────────┐     │
│  │   Web Service    │  │   API Service    │     │
│  │   (Full Stack)   │  │  (API Only)      │     │
│  │                  │  │                  │     │
│  │ - Frontend       │  │ - REST API       │     │
│  │ - Backend        │  │ - JWT Auth       │     │
│  │ - Socket.io      │  │ - Mobile Ready   │     │
│  │ - Session Auth   │  │                  │     │
│  └────────┬─────────┘  └────────┬─────────┘     │
│           │                     │               │
│           └──────────┬──────────┘               │
│                      │                          │
│           ┌──────────▼──────────┐               │
│           │  PostgreSQL DB      │               │
│           │  (Shared)           │               │
│           └─────────────────────┘               │
│                                                  │
│           ┌─────────────────────┐               │
│           │  Object Storage     │               │
│           │  (S3 or Volume)     │               │
│           └─────────────────────┘               │
└─────────────────────────────────────────────────┘
```

### When to Use Separate API Deployment

**Use separate deployment when:**
- Building native mobile apps (iOS/Android)
- Need independent scaling for API traffic
- Want to optimize costs by right-sizing each service
- Require API-only endpoints for third-party integrations

**Use single deployment when:**
- Building a web-only application
- Traffic is primarily web-based
- Simpler deployment preferred
- Cost optimization for low-traffic scenarios

## Continuous Deployment

Railway automatically deploys when you push to your GitHub repository:
1. Push changes to your repository
2. Railway detects the changes
3. Railway builds and deploys automatically
4. Zero-downtime deployment with health checks

## Troubleshooting

### Application won't start
- Check Railway logs: "Deployments" → Click latest deployment → "View Logs"
- Verify all required environment variables are set
- Ensure `DATABASE_URL` is properly configured

### Database connection issues
- Verify PostgreSQL service is running in Railway
- Check `DATABASE_URL` format: `postgresql://user:password@host:port/database`
- Ensure database is in the same Railway project

### File upload issues
- Verify storage environment variables are correctly set
- Check volume is properly mounted (if using Railway Volume)
- Verify S3 credentials and bucket permissions (if using S3)

## Monitoring

Railway provides:
- **Logs**: Real-time application logs
- **Metrics**: CPU, Memory, Network usage
- **Alerts**: Configure alerts for downtime or errors

## Backup Strategy

### Database Backups
Railway doesn't provide automatic backups on free tier. For production:
1. Use Railway's paid plan for automatic backups, or
2. Set up a cron job to backup PostgreSQL to external storage:
   ```bash
   pg_dump $DATABASE_URL > backup-$(date +%Y%m%d).sql
   ```

### File Storage Backups
- For S3: Enable versioning and lifecycle policies
- For Railway Volumes: Regular snapshots to external storage

## Costs

Railway pricing is usage-based:
- **Hobby Plan**: $5/month (includes $5 credit)
- **Pro Plan**: $20/month (includes $20 credit)
- Additional usage billed per resource (compute, memory, network)

Estimate for this application:
- Web service: ~$5-10/month
- PostgreSQL: ~$5/month
- Total: ~$10-15/month for moderate traffic

## Support

- Railway Documentation: https://docs.railway.app
- Railway Discord: https://discord.gg/railway
- Application Issues: Open issue on GitHub repository
