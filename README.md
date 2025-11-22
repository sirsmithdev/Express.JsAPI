# 316 Auto - Mobile API Backend

Standalone REST API backend for 316 Auto mobile applications. This API provides JWT-based authentication and full access to garage management features.

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ or Bun
- PostgreSQL database
- AWS S3 bucket (for production file storage)

### Installation

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration

# Run database migrations (if using Drizzle)
npm run db:push

# Start development server
npm run dev

# Start production server
npm start
```

## 📡 API Endpoints

### Authentication
- `POST /api/mobile/auth/login` - Login with email/password
- `POST /api/mobile/auth/register` - Register new user
- `POST /api/mobile/auth/refresh` - Refresh access token
- `GET /api/mobile/auth/user` - Get authenticated user info

### Protected Routes
All other `/api/*` endpoints require Bearer token authentication.

See [MOBILE_API_DOCUMENTATION.md](./MOBILE_API_DOCUMENTATION.md) for complete API reference.

## 🔐 Security

- JWT tokens with access (15min) and refresh (7 days) expiry
- Bcrypt password hashing
- Role-based access control
- Secure environment variable management

## 📦 Environment Variables

Required environment variables (see `.env.example`):

- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - Secret for JWT signing (min 32 chars)
- `SESSION_SECRET` - Session encryption key
- `AWS_*` - S3 credentials for file storage
- `PORT` - Server port (default: 5000)

## 🚂 Railway Deployment

This API is designed for Railway deployment:

1. Create new Railway project
2. Add PostgreSQL database service
3. Set environment variables
4. Deploy from GitHub
5. Railway will automatically detect and build

See [RAILWAY_DEPLOYMENT.md](./RAILWAY_DEPLOYMENT.md) for detailed instructions.

## 📱 Mobile App Integration

Example authentication flow:

```typescript
// Login
const response = await fetch('https://your-api.railway.app/api/mobile/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password })
});
const { accessToken, refreshToken, user } = await response.json();

// Use access token for requests
const data = await fetch('https://your-api.railway.app/api/appointments', {
  headers: { 'Authorization': `Bearer ${accessToken}` }
});

// Refresh when access token expires
const newTokens = await fetch('https://your-api.railway.app/api/mobile/auth/refresh', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ refreshToken })
});
```

## 🏗️ Architecture

- **Framework**: Express.js
- **Database**: PostgreSQL (Drizzle ORM)
- **Authentication**: JWT (jsonwebtoken)
- **File Storage**: AWS S3 / Replit Object Storage
- **Validation**: Zod schemas

## 📄 License

Proprietary - 316 Auto

## 🔗 Related Repositories

- Main Web Application: [316-gaarage-webapp](https://github.com/sirsmithdev/316-gaarage-webapp)
- Mobile App: Coming soon
