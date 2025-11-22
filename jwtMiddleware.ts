import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "./jwtUtils";
import { storage } from "./storage";

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

/**
 * Middleware that supports both session-based and JWT-based authentication
 * Checks for JWT token in Authorization header first, falls back to session
 */
export function hybridAuth(req: Request, res: Response, next: NextFunction) {
  // Check for JWT token in Authorization header
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    const payload = verifyAccessToken(token);
    
    if (payload) {
      // Attach user info to request from JWT
      req.user = {
        id: payload.userId,
        email: payload.email,
        role: payload.role,
      };
      return next();
    }
    
    // Invalid or expired JWT token
    return res.status(401).json({ message: "Invalid or expired token" });
  }
  
  // Fall back to session-based authentication
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  
  // No valid authentication found
  return res.status(401).json({ message: "Authentication required" });
}

/**
 * Middleware that only accepts JWT authentication (for mobile-specific routes)
 */
export function jwtAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Authorization header required" });
  }
  
  const token = authHeader.substring(7);
  const payload = verifyAccessToken(token);
  
  if (!payload) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
  
  // Attach user info to request
  req.user = {
    id: payload.userId,
    email: payload.email,
    role: payload.role,
  };
  
  next();
}

/**
 * Get user ID from either session or JWT
 */
export function getUserIdFromRequest(req: Request): string | null {
  // Check JWT first
  if (req.user && req.user.id) {
    return req.user.id;
  }
  
  // Fall back to session
  if (req.isAuthenticated && req.isAuthenticated() && req.user) {
    return (req.user as any).id;
  }
  
  return null;
}

/**
 * Get full user from either session or JWT
 * For JWT, fetches full user from database
 */
export async function getFullUserFromRequest(req: Request): Promise<any | null> {
  const userId = getUserIdFromRequest(req);
  
  if (!userId) {
    return null;
  }
  
  // If using JWT, we only have basic info - fetch full user from DB
  if (req.user && !req.user.createdAt) {
    try {
      const fullUser = await storage.getUser(userId);
      return fullUser;
    } catch (error) {
      return null;
    }
  }
  
  // Session auth already has full user
  return req.user;
}
