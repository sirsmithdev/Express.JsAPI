import jwt from "jsonwebtoken";

// JWT configuration - Using a single JWT_SECRET for both access and refresh tokens
// In production, ensure JWT_SECRET is a strong, randomly generated secret (min 32 chars)
// Generate secure secret: openssl rand -base64 32
const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  
  if (!secret) {
    throw new Error("CRITICAL: JWT_SECRET environment variable is required but not set. Please configure it in your environment.");
  }
  
  if (secret.length < 32) {
    throw new Error(`CRITICAL: JWT_SECRET must be at least 32 characters long for security. Current length: ${secret.length}`);
  }
  
  return secret;
};

const ACCESS_TOKEN_EXPIRY = process.env.JWT_ACCESS_EXPIRY || "15m"; // 15 minutes
const REFRESH_TOKEN_EXPIRY = process.env.JWT_REFRESH_EXPIRY || "7d"; // 7 days

/**
 * Validate JWT configuration at application startup.
 * Call this during server bootstrap to ensure JWT_SECRET is properly configured.
 * This allows the module to be imported without immediate crashes for testing/tooling.
 */
export function validateJwtConfig(): void {
  try {
    getJwtSecret();
    console.log("✓ JWT configuration validated successfully");
  } catch (error) {
    console.error("✗ JWT configuration validation failed:", error instanceof Error ? error.message : error);
    throw error;
  }
}

export interface JWTPayload {
  userId: string;
  email: string;
  role: string;
  type: "access" | "refresh";
}

export function generateAccessToken(userId: string, email: string, role: string): string {
  const payload: JWTPayload = {
    userId,
    email,
    role,
    type: "access",
  };
  
  return jwt.sign(payload, getJwtSecret(), { expiresIn: ACCESS_TOKEN_EXPIRY });
}

export function generateRefreshToken(userId: string, email: string, role: string): string {
  const payload: JWTPayload = {
    userId,
    email,
    role,
    type: "refresh",
  };
  
  return jwt.sign(payload, getJwtSecret(), { expiresIn: REFRESH_TOKEN_EXPIRY });
}

export function verifyAccessToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as JWTPayload;
    if (decoded.type !== "access") {
      return null;
    }
    return decoded;
  } catch (error) {
    return null;
  }
}

export function verifyRefreshToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as JWTPayload;
    if (decoded.type !== "refresh") {
      return null;
    }
    return decoded;
  } catch (error) {
    return null;
  }
}
