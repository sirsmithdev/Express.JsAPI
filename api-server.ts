/**
 * Standalone API Server for Mobile Apps and External Integrations
 * 
 * This is a lightweight server designed for Railway deployment that serves
 * only the REST API endpoints without the frontend or Socket.io chat server.
 * 
 * Usage: NODE_ENV=production tsx server/api-server.ts
 */

import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import { registerRoutes } from "./routes";
import { log } from "./vite";
import { validateJwtConfig } from "./jwtUtils";

// Validate JWT configuration at startup
validateJwtConfig();

const app = express();

// CORS configuration for mobile apps and external API access
const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // In development, allow all origins
    if (process.env.NODE_ENV === 'development') {
      callback(null, true);
      return;
    }
    
    // In production, allow specific origins
    const allowedOrigins = [
      process.env.WEB_APP_URL, // Web app URL
      process.env.MOBILE_APP_ORIGIN, // Mobile app origin if needed
    ].filter(Boolean);
    
    // Allow requests with no origin (mobile apps, Postman, etc)
    if (!origin) {
      callback(null, true);
      return;
    }
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      log(`CORS blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

// Health check endpoint for Railway
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    service: 'api-server',
  });
});

// API info endpoint
app.get('/api', (_req, res) => {
  res.json({
    name: '316 Auto REST API',
    version: '1.0.0',
    description: 'Mobile API for 316 Auto garage management system',
    documentation: '/api/docs',
    endpoints: {
      auth: {
        login: 'POST /api/mobile/auth/login',
        register: 'POST /api/mobile/auth/register',
        refresh: 'POST /api/mobile/auth/refresh',
        user: 'GET /api/mobile/auth/user',
      },
      customer: {
        appointments: 'GET/POST /api/appointments',
        vehicles: 'GET/POST /api/vehicles',
        jobCards: 'GET /api/job-cards',
        invoices: 'GET /api/invoices',
        loyalty: 'GET /api/loyalty/points',
      },
    },
  });
});

(async () => {
  // Register all API routes (includes authentication, appointments, vehicles, etc.)
  const server = await registerRoutes(app);

  // Global error handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    log(`Error: ${status} - ${message}`);
    
    res.status(status).json({ message });
    
    // In development, log full error for debugging
    if (process.env.NODE_ENV === 'development') {
      console.error(err);
    }
  });

  // 404 handler for undefined routes
  app.use((_req, res) => {
    res.status(404).json({
      message: 'Endpoint not found',
      documentation: '/api',
    });
  });

  // Start server
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`🚀 316 Auto API Server running on port ${port}`);
    log(`📱 Mobile API ready at http://0.0.0.0:${port}/api`);
    log(`❤️  Health check at http://0.0.0.0:${port}/health`);
    log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
})();
