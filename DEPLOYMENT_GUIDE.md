# Deployment Guide - 316 Auto Mobile API

This guide will help you push the standalone mobile API to your GitHub repository and deploy it to Railway.

## 📋 Prerequisites

1. Git installed on your local machine
2. GitHub account with access to: https://github.com/sirsmithdev/Express.JsAPI.git
3. Railway account (for deployment)

## 🔧 Step 1: Prepare Local Environment

```bash
# Clone your GitHub repository
git clone https://github.com/sirsmithdev/Express.JsAPI.git
cd Express.JsAPI

# Create directory structure
mkdir -p server shared
```

## 📁 Step 2: Copy Files from Replit

Copy the following files from your Replit project to your local repository:

### Core Server Files
```
server/
├── api-server.ts          # Main entry point for standalone API
├── auth.ts                # Authentication logic
├── jwtUtils.ts            # JWT token utilities
├── jwtMiddleware.ts       # JWT authentication middleware
├── middleware.ts          # Authorization middleware
├── routes.ts              # All API routes
├── db.ts                  # Database connection
├── storage/               # All storage modules (copy entire folder)
│   ├── index.ts
│   ├── base.ts
│   ├── users.storage.ts
│   ├── appointments.storage.ts
│   └── ... (all other storage files)
├── storageAdapters.ts     # Storage adapter configuration
├── objectStorage.ts       # Object storage service
├── objectAcl.ts          # Access control for files
└── email.ts              # Email service (if needed)
```

### Shared Schema
```
shared/
└── schema.ts             # Database schema and types
```

### Configuration Files
```
.env.example              # Environment template
package.json              # Dependencies (from deployment folder)
tsconfig.json             # TypeScript configuration
drizzle.config.ts         # Database configuration
```

### Documentation
```
README.md                      # API overview (from deployment folder)
MOBILE_API_DOCUMENTATION.md   # Complete API reference
RAILWAY_DEPLOYMENT.md         # Railway deployment instructions
```

## 🚀 Step 3: Push to GitHub

```bash
# Initialize git (if not already initialized)
git init

# Add all files
git add .

# Commit
git commit -m "Initial commit: Standalone mobile API with JWT authentication"

# Add your GitHub repository as remote (if not already added)
git remote add origin https://github.com/sirsmithdev/Express.JsAPI.git

# Push to GitHub
git push -u origin main
```

If the main branch already exists, you might need to force push:
```bash
git push -u origin main --force
```

Or create a new branch:
```bash
git checkout -b mobile-api-v1
git push -u origin mobile-api-v1
```

## 🚂 Step 4: Deploy to Railway

### Option A: Deploy from GitHub (Recommended)

1. Go to [Railway](https://railway.app)
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Choose `sirsmithdev/Express.JsAPI`
5. Railway will auto-detect the configuration

### Option B: Manual Railway Setup

1. Create new Railway project
2. Add PostgreSQL database service
3. Add environment variables (see .env.example)
4. Configure build settings:
   - Build Command: `npm install && npm run build`
   - Start Command: `npm start`
5. Deploy

### Required Environment Variables on Railway

Set these in your Railway project settings:

```
DATABASE_URL=${DATABASE_URL}  # Auto-populated by Railway PostgreSQL
JWT_SECRET=<generate-secure-32char-secret>
SESSION_SECRET=<generate-secure-secret>
ALLOWED_ORIGINS=https://your-mobile-app.com
AWS_ACCESS_KEY_ID=<your-aws-key>
AWS_SECRET_ACCESS_KEY=<your-aws-secret>
AWS_REGION=us-east-1
AWS_S3_BUCKET=<your-bucket-name>
PORT=5000
```

## 🧪 Step 5: Test Your API

```bash
# Health check
curl https://your-api.railway.app/api/health

# Test login
curl -X POST https://your-api.railway.app/api/mobile/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'

# Test protected endpoint (use token from login)
curl https://your-api.railway.app/api/appointments \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

## 🔄 Step 6: Continuous Deployment

Railway automatically redeploys when you push to GitHub:

```bash
# Make changes
git add .
git commit -m "Update API endpoints"
git push origin main

# Railway will automatically detect and deploy
```

## 📱 Step 7: Configure Mobile App

Update your mobile app configuration:

```typescript
// config.ts
export const API_BASE_URL = 'https://your-api.railway.app';

// Use in your app
import { API_BASE_URL } from './config';

const response = await fetch(`${API_BASE_URL}/api/mobile/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password })
});
```

## 🆘 Troubleshooting

### Build Fails
- Check `package.json` has all required dependencies
- Verify TypeScript configuration is correct
- Check Railway build logs for specific errors

### Database Connection Issues
- Verify DATABASE_URL is set correctly
- Run database migrations: `npm run db:push`
- Check PostgreSQL service is running

### Authentication Errors
- Verify JWT_SECRET is at least 32 characters
- Check token expiry settings
- Ensure CORS origins include your mobile app domain

### CORS Errors
- Add your mobile app domain to ALLOWED_ORIGINS
- For development, you can temporarily allow all origins (not recommended for production)

## 📚 Additional Resources

- [Railway Documentation](https://docs.railway.app)
- [Express.js Guide](https://expressjs.com)
- [JWT Best Practices](https://tools.ietf.org/html/rfc8725)
- [API Documentation](./MOBILE_API_DOCUMENTATION.md)

## 🔗 Related Repositories

- Main Application: https://github.com/sirsmithdev/316-gaarage-webapp
- Mobile API: https://github.com/sirsmithdev/Express.JsAPI.git

---

Need help? Check the detailed documentation in MOBILE_API_DOCUMENTATION.md and RAILWAY_DEPLOYMENT.md
