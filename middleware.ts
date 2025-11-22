import type { RequestHandler } from "express";
import { storage } from "./storage";
import {
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
} from "./permissionService";
import type { AuthenticatedRequest } from "./types";

// Helper to get user ID from both auth types
export function getUserId(req: AuthenticatedRequest): string | undefined {
  // OAuth user (from Replit Auth)
  if (req.user?.claims?.sub) {
    return req.user.claims.sub;
  }
  // Local auth user (email/password)
  if (req.user?.id) {
    return req.user.id;
  }
  return undefined;
}

// Helper to get user ID from authenticated requests (throws if not found)
// Use this after isAuthenticated middleware where user is guaranteed to exist
export function getAuthenticatedUserId(req: AuthenticatedRequest): string {
  const userId = getUserId(req);
  if (!userId) {
    throw new Error("User ID not found in authenticated request");
  }
  return userId;
}

// Role-based authorization middleware
export const requireRole = (allowedRoles: string[]): RequestHandler => {
  return async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        console.log("[requireRole] No userId found");
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        console.log("[requireRole] User not found for userId:", userId);
        return res.status(401).json({ message: "User not found" });
      }

      console.log(`[requireRole] User role: "${user.role}", Required roles: [${allowedRoles.join(", ")}]`);

      if (!allowedRoles.includes(user.role)) {
        console.log(`[requireRole] Permission denied - user role "${user.role}" not in allowed roles`);
        return res.status(403).json({
          message: "Forbidden: Insufficient permissions",
          userRole: user.role,
          requiredRoles: allowedRoles
        });
      }

      req.currentUser = user;
      next();
    } catch (error) {
      if (error instanceof Error) {
        console.error("Role check error:", error);
        res.status(500).json({ message: "Authorization failed" });
      } else {
        console.error("Unknown role check error:", error);
        res.status(500).json({ message: "Authorization failed" });
      }
    }
  };
};

// Check if user owns the resource or has elevated permissions
export const requireOwnershipOrRole = (allowedRoles: string[]): RequestHandler => {
  return async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }

      // Check if user has allowed role OR owns the resource
      const hasRole = allowedRoles.includes(user.role);
      const isOwner = req.params.customerId === userId || req.params.userId === userId;

      if (!hasRole && !isOwner) {
        return res.status(403).json({ message: "Forbidden: Access denied" });
      }

      req.currentUser = user;
      next();
    } catch (error) {
      if (error instanceof Error) {
        console.error("Ownership check error:", error);
        res.status(500).json({ message: "Authorization failed" });
      } else {
        console.error("Unknown ownership check error:", error);
        res.status(500).json({ message: "Authorization failed" });
      }
    }
  };
};

// ============================================================
// PERMISSION-BASED AUTHORIZATION MIDDLEWARE
// ============================================================

/**
 * Require a specific permission to access a route
 * @param permissionCode - The permission code required (e.g., 'invoices.create')
 */
export const requirePermission = (permissionCode: string): RequestHandler => {
  return async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        console.log("[requirePermission] No userId found");
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        console.log("[requirePermission] User not found for userId:", userId);
        return res.status(401).json({ message: "User not found" });
      }

      const hasAccess = await hasPermission(userId, permissionCode);

      console.log(`[requirePermission] User "${user.email}" permission check: "${permissionCode}" = ${hasAccess}`);

      if (!hasAccess) {
        console.log(`[requirePermission] Permission denied - user lacks "${permissionCode}"`);
        return res.status(403).json({
          message: "Forbidden: Insufficient permissions",
          requiredPermission: permissionCode,
        });
      }

      req.currentUser = user;
      next();
    } catch (error) {
      if (error instanceof Error) {
        console.error("Permission check error:", error);
        res.status(500).json({ message: "Authorization failed" });
      } else {
        console.error("Unknown permission check error:", error);
        res.status(500).json({ message: "Authorization failed" });
      }
    }
  };
};

/**
 * Require ANY of the specified permissions to access a route
 * @param permissionCodes - Array of permission codes (user needs at least one)
 */
export const requireAnyPermission = (permissionCodes: string[]): RequestHandler => {
  return async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        console.log("[requireAnyPermission] No userId found");
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        console.log("[requireAnyPermission] User not found for userId:", userId);
        return res.status(401).json({ message: "User not found" });
      }

      const hasAccess = await hasAnyPermission(userId, permissionCodes);

      console.log(`[requireAnyPermission] User "${user.email}" check: [${permissionCodes.join(", ")}] = ${hasAccess}`);

      if (!hasAccess) {
        console.log(`[requireAnyPermission] Permission denied - user lacks any of: [${permissionCodes.join(", ")}]`);
        return res.status(403).json({
          message: "Forbidden: Insufficient permissions",
          requiredPermissions: permissionCodes,
          requirementType: "any",
        });
      }

      req.currentUser = user;
      next();
    } catch (error) {
      if (error instanceof Error) {
        console.error("Permission check error:", error);
        res.status(500).json({ message: "Authorization failed" });
      } else {
        console.error("Unknown permission check error:", error);
        res.status(500).json({ message: "Authorization failed" });
      }
    }
  };
};

/**
 * Require ALL of the specified permissions to access a route
 * @param permissionCodes - Array of permission codes (user needs all of them)
 */
export const requireAllPermissions = (permissionCodes: string[]): RequestHandler => {
  return async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        console.log("[requireAllPermissions] No userId found");
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        console.log("[requireAllPermissions] User not found for userId:", userId);
        return res.status(401).json({ message: "User not found" });
      }

      const hasAccess = await hasAllPermissions(userId, permissionCodes);

      console.log(`[requireAllPermissions] User "${user.email}" check: [${permissionCodes.join(", ")}] = ${hasAccess}`);

      if (!hasAccess) {
        console.log(`[requireAllPermissions] Permission denied - user lacks all of: [${permissionCodes.join(", ")}]`);
        return res.status(403).json({
          message: "Forbidden: Insufficient permissions",
          requiredPermissions: permissionCodes,
          requirementType: "all",
        });
      }

      req.currentUser = user;
      next();
    } catch (error) {
      if (error instanceof Error) {
        console.error("Permission check error:", error);
        res.status(500).json({ message: "Authorization failed" });
      } else {
        console.error("Unknown permission check error:", error);
        res.status(500).json({ message: "Authorization failed" });
      }
    }
  };
};

/**
 * Dual-check middleware: Passes if user has EITHER the required role OR the required permission
 * This is useful during migration period to maintain backward compatibility
 * @param allowedRoles - Array of allowed roles
 * @param permissionCode - The permission code that can also grant access
 */
export const requireRoleOrPermission = (allowedRoles: string[], permissionCode: string): RequestHandler => {
  return async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        console.log("[requireRoleOrPermission] No userId found");
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        console.log("[requireRoleOrPermission] User not found for userId:", userId);
        return res.status(401).json({ message: "User not found" });
      }

      // Check role first (fast check, no DB query needed)
      const hasRole = allowedRoles.includes(user.role);

      // Check permission if role check fails
      let hasAccess = hasRole;
      if (!hasRole) {
        hasAccess = await hasPermission(userId, permissionCode);
      }

      console.log(`[requireRoleOrPermission] User "${user.email}": role="${user.role}" (${hasRole}), permission="${permissionCode}" (${hasAccess})`);

      if (!hasAccess) {
        console.log(`[requireRoleOrPermission] Access denied - user role "${user.role}" not in [${allowedRoles.join(", ")}] and lacks permission "${permissionCode}"`);
        return res.status(403).json({
          message: "Forbidden: Insufficient permissions",
          userRole: user.role,
          requiredRoles: allowedRoles,
          requiredPermission: permissionCode,
        });
      }

      req.currentUser = user;
      next();
    } catch (error) {
      if (error instanceof Error) {
        console.error("Role/Permission check error:", error);
        res.status(500).json({ message: "Authorization failed" });
      } else {
        console.error("Unknown role/permission check error:", error);
        res.status(500).json({ message: "Authorization failed" });
      }
    }
  };
};
