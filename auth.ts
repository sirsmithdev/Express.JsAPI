import { Strategy as LocalStrategy } from "passport-local";
import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import connectPg from "connect-pg-simple";
import bcrypt from "bcrypt";
import { storage } from "./storage";
import { sendEmail } from "./email";
import { generateToken, getTokenExpiration, isTokenExpired } from "./tokenUtils";

const SALT_ROUNDS = 10;

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);

  return session({
    secret: process.env.SESSION_SECRET!,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: sessionTtl,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
    store: new pgStore({
      conString: process.env.DATABASE_URL!,
      tableName: "sessions",
      createTableIfMissing: true,
    }),
  });
}

export async function hashPassword(password: string): Promise<string> {
  return await bcrypt.hash(password, SALT_ROUNDS);
}

export async function comparePasswords(supplied: string, stored: string): Promise<boolean> {
  return await bcrypt.compare(supplied, stored);
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  // ==================== Passport Local Strategy (Email/Password) ====================
  passport.use(
    new LocalStrategy(
      {
        usernameField: "email",
        passwordField: "password",
      },
      async (email, password, done) => {
        try {
          const user = await storage.getUserByEmail(email);

          if (!user || !user.password) {
            return done(null, false, { message: "Invalid email or password" });
          }

          // Check if account is deactivated
          if (user.isActive === false) {
            return done(null, false, { message: "Your account has been deactivated. Please contact an administrator." });
          }

          const isValidPassword = await comparePasswords(password, user.password);

          if (!isValidPassword) {
            return done(null, false, { message: "Invalid email or password" });
          }

          // Mark user as email/password authenticated
          const authUser = { ...user, authMethod: "local" };
          return done(null, authUser);
        } catch (error) {
          return done(error);
        }
      }
    )
  );

  // ==================== Passport Session Serialization ====================
  passport.serializeUser((user: Express.User, cb) => {
    const authenticatedUser = user as { id: string };
    cb(null, authenticatedUser.id);
  });

  passport.deserializeUser(async (id: string, cb) => {
    try {
      const user = await storage.getUser(id);
      if (!user) {
        return cb(null, false);
      }

      // Check if account is deactivated
      if (user.isActive === false) {
        // Account deactivated - clear session
        return cb(null, false);
      }
      cb(null, { ...user, authMethod: "local" });
    } catch (error) {
      cb(error);
    }
  });

  // ==================== Auth Routes ====================

  // Email/Password Registration
  app.post("/api/auth/register", async (req, res) => {
    try {
      const { email, password, firstName, lastName, phone, customerType, role, referralCode } = req.body;

      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ message: "Invalid email format" });
      }

      // Validate password strength
      if (password.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters long" });
      }

      // Check if user already exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ message: "Email already registered" });
      }

      // Validate referral code if provided
      let referrer = null;
      if (referralCode) {
        referrer = await storage.getUserByReferralCode(referralCode);
        if (!referrer) {
          return res.status(400).json({ message: "Invalid referral code" });
        }
      }

      // Generate referral code for new user
      const { generateUniqueReferralCode } = await import("./referralCodeGenerator");
      const newUserReferralCode = await generateUniqueReferralCode(firstName);

      // Hash password and create customer with account number
      const hashedPassword = await hashPassword(password);
      const newUser = await storage.createCustomer({
        email,
        password: hashedPassword,
        firstName: firstName || null,
        lastName: lastName || null,
        phone: phone || null,
        customerType: customerType || "individual",
        referralCode: newUserReferralCode,
      });

      // Create referral relationship and award points if referred
      if (referrer) {
        const referralPoints = 100; // Default referral points

        await storage.createReferral({
          referrerId: referrer.id,
          referredId: newUser.id,
          pointsAwarded: referralPoints,
        });

        // Award loyalty points to referrer
        await storage.addLoyaltyPoints(referrer.id, referralPoints, "referral", "Referred a new customer");
      }

      // Generate email verification token
      const token = generateToken();
      const expiresAt = getTokenExpiration(24); // 24 hours

      await storage.createEmailVerificationToken({
        userId: newUser.id,
        token,
        expiresAt,
      });

      // Send verification email
      const verificationLink = `${process.env.BASE_URL || 'http://localhost:5000'}/verify-email?token=${token}`;
      const customerName = `${firstName || ''} ${lastName || ''}`.trim() || 'Customer';

      try {
        await sendEmail({
          to: email,
          subject: "Verify your email address",
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2>Welcome to 316 Automotive!</h2>
              <p>Hi ${customerName},</p>
              <p>Thank you for registering with us. Please verify your email address by clicking the link below:</p>
              <p style="margin: 30px 0;">
                <a href="${verificationLink}" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Verify Email Address</a>
              </p>
              <p>Or copy and paste this link into your browser:</p>
              <p style="color: #666; word-break: break-all;">${verificationLink}</p>
              <p>This link will expire in 24 hours.</p>
              <p>If you didn't create an account, you can safely ignore this email.</p>
              <br>
              <p>Best regards,<br>316 Automotive Team</p>
            </div>
          `,
          plainText: `Welcome to 316 Automotive!\n\nHi ${customerName},\n\nThank you for registering with us. Please verify your email address by clicking the link below:\n\n${verificationLink}\n\nThis link will expire in 24 hours.\n\nIf you didn't create an account, you can safely ignore this email.\n\nBest regards,\n316 Automotive Team`,
        });
      } catch (emailError) {
        console.error("Failed to send verification email:", emailError);
        // Continue with registration even if email fails - user can resend later
      }

      res.status(201).json({
        message: "Registration successful! Please check your email to verify your account.",
        email: email,
      });
    } catch (error) {
      console.error("Registration error:", error);

      // Handle duplicate email error from database
      if (error instanceof Error && error.message && error.message.includes("duplicate")) {
        return res.status(400).json({ message: "Email already registered" });
      }

      res.status(500).json({ message: "Registration failed" });
    }
  });

  // Verify Email
  app.get("/api/auth/verify-email/:token", async (req, res) => {
    try {
      const { token } = req.params;

      // Find the token
      const verificationToken = await storage.getEmailVerificationTokenByToken(token);

      if (!verificationToken) {
        return res.status(400).json({ message: "Invalid or expired verification link" });
      }

      // Check if token is expired
      if (isTokenExpired(verificationToken.expiresAt)) {
        await storage.deleteEmailVerificationToken(verificationToken.id);
        return res.status(400).json({ message: "Verification link has expired. Please request a new one." });
      }

      // Mark email as verified
      await storage.markEmailAsVerified(verificationToken.userId);

      // Delete the used token
      await storage.deleteEmailVerificationToken(verificationToken.id);

      res.json({ message: "Email verified successfully! You can now log in." });
    } catch (error) {
      console.error("Email verification error:", error);
      res.status(500).json({ message: "Email verification failed" });
    }
  });

  // Resend Verification Email
  app.post("/api/auth/resend-verification", async (req, res) => {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      // Find the user
      const user = await storage.getUserByEmail(email);

      if (!user) {
        // Don't reveal if user exists or not for security
        return res.json({ message: "If an account exists with that email, a verification link has been sent." });
      }

      // Check if already verified
      if (user.emailVerified) {
        return res.status(400).json({ message: "Email is already verified" });
      }

      // Delete any existing tokens for this user
      await storage.deleteEmailVerificationTokensByUserId(user.id);

      // Generate new token
      const token = generateToken();
      const expiresAt = getTokenExpiration(24);

      await storage.createEmailVerificationToken({
        userId: user.id,
        token,
        expiresAt,
      });

      // Send verification email
      const verificationLink = `${process.env.BASE_URL || 'http://localhost:5000'}/verify-email?token=${token}`;
      const customerName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Customer';

      await sendEmail({
        to: email,
        subject: "Verify your email address",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Verify Your Email Address</h2>
            <p>Hi ${customerName},</p>
            <p>Please verify your email address by clicking the link below:</p>
            <p style="margin: 30px 0;">
              <a href="${verificationLink}" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Verify Email Address</a>
            </p>
            <p>Or copy and paste this link into your browser:</p>
            <p style="color: #666; word-break: break-all;">${verificationLink}</p>
            <p>This link will expire in 24 hours.</p>
            <br>
            <p>Best regards,<br>316 Automotive Team</p>
          </div>
        `,
        plainText: `Verify Your Email Address\n\nHi ${customerName},\n\nPlease verify your email address by clicking the link below:\n\n${verificationLink}\n\nThis link will expire in 24 hours.\n\nBest regards,\n316 Automotive Team`,
      });

      res.json({ message: "Verification email sent. Please check your inbox." });
    } catch (error) {
      console.error("Resend verification error:", error);
      res.status(500).json({ message: "Failed to send verification email" });
    }
  });

  // Email/Password Login
  app.post("/api/auth/login", (req, res, next) => {
    passport.authenticate("local", (err: Error | null, user: Express.User | false, info?: { message?: string }) => {
      if (err) {
        return res.status(500).json({ message: "Authentication error" });
      }

      if (!user) {
        return res.status(401).json({ message: info?.message || "Invalid credentials" });
      }

      req.login(user, (loginErr) => {
        if (loginErr) {
          return res.status(500).json({ message: "Login failed" });
        }

        // Handle "Stay signed in" / "Remember me" functionality
        const rememberMe = req.body.rememberMe === true;
        if (rememberMe && req.session) {
          // Extend session to 30 days if "Stay signed in" is checked
          const thirtyDays = 30 * 24 * 60 * 60 * 1000;
          req.session.cookie.maxAge = thirtyDays;
        }
        // Otherwise keep default 7 days from getSession()

        res.json(user);
      });
    })(req, res, next);
  });

  // Forgot Password
  app.post("/api/auth/forgot-password", async (req, res) => {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      // Find the user
      const user = await storage.getUserByEmail(email);

      if (!user) {
        // Don't reveal if user exists or not for security
        return res.json({ message: "If an account exists with that email, a password reset link has been sent." });
      }

      // Delete any existing reset tokens for this user
      await storage.deletePasswordResetTokensByUserId(user.id);

      // Generate new token
      const token = generateToken();
      const expiresAt = getTokenExpiration(1); // 1 hour for password resets

      await storage.createPasswordResetToken({
        userId: user.id,
        token,
        expiresAt,
      });

      // Send password reset email
      const resetLink = `${process.env.BASE_URL || 'http://localhost:5000'}/reset-password?token=${token}`;
      const customerName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Customer';

      await sendEmail({
        to: email,
        subject: "Reset your password",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Reset Your Password</h2>
            <p>Hi ${customerName},</p>
            <p>We received a request to reset your password. Click the button below to create a new password:</p>
            <p style="margin: 30px 0;">
              <a href="${resetLink}" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Reset Password</a>
            </p>
            <p>Or copy and paste this link into your browser:</p>
            <p style="color: #666; word-break: break-all;">${resetLink}</p>
            <p>This link will expire in 1 hour.</p>
            <p>If you didn't request a password reset, you can safely ignore this email.</p>
            <br>
            <p>Best regards,<br>316 Automotive Team</p>
          </div>
        `,
        plainText: `Reset Your Password\n\nHi ${customerName},\n\nWe received a request to reset your password. Click the link below to create a new password:\n\n${resetLink}\n\nThis link will expire in 1 hour.\n\nIf you didn't request a password reset, you can safely ignore this email.\n\nBest regards,\n316 Automotive Team`,
      });

      res.json({ message: "Password reset link sent. Please check your email." });
    } catch (error) {
      console.error("Forgot password error:", error);
      res.status(500).json({ message: "Failed to process password reset request" });
    }
  });

  // Reset Password
  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const { token, password, confirmPassword } = req.body;

      if (!token) {
        return res.status(400).json({ message: "Token is required" });
      }

      // Validate password using shared schema
      const { resetPasswordFormSchema } = await import("@shared/schema");
      const validationResult = resetPasswordFormSchema.safeParse({ password, confirmPassword });
      
      if (!validationResult.success) {
        const errors = validationResult.error.errors.map(e => e.message).join(", ");
        return res.status(400).json({ message: errors });
      }

      // Find the token
      const resetToken = await storage.getPasswordResetTokenByToken(token);

      if (!resetToken) {
        return res.status(400).json({ message: "Invalid or expired reset link" });
      }

      // Check if token is expired
      if (isTokenExpired(resetToken.expiresAt)) {
        await storage.deletePasswordResetToken(resetToken.id);
        return res.status(400).json({ message: "Reset link has expired. Please request a new one." });
      }

      // Hash new password
      const hashedPassword = await hashPassword(password);

      // Update user password
      await storage.updateUserPassword(resetToken.userId, hashedPassword);

      // Delete the used token
      await storage.deletePasswordResetToken(resetToken.id);

      // Delete all other reset tokens for this user
      await storage.deletePasswordResetTokensByUserId(resetToken.userId);

      res.json({ message: "Password reset successfully! You can now log in with your new password." });
    } catch (error) {
      console.error("Reset password error:", error);
      res.status(500).json({ message: "Failed to reset password" });
    }
  });

  // Logout
  app.post("/api/auth/logout", (req, res) => {
    req.logout((err) => {
      if (err) {
        return res.status(500).json({ message: "Logout failed" });
      }
      res.json({ success: true });
    });
  });

  // Get current user
  app.get("/api/auth/user", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    res.json(req.user);
  });

  // ==================== Mobile API - JWT Authentication ====================

  // Mobile Login - Returns JWT tokens
  app.post("/api/mobile/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }

      const user = await storage.getUserByEmail(email);

      if (!user || !user.password) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      // Check if account is deactivated
      if (user.isActive === false) {
        return res.status(403).json({ message: "Your account has been deactivated. Please contact an administrator." });
      }

      const isValidPassword = await comparePasswords(password, user.password);

      if (!isValidPassword) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      // Generate JWT tokens
      const { generateAccessToken, generateRefreshToken } = await import("./jwtUtils");
      const accessToken = generateAccessToken(user.id, user.email!, user.role);
      const refreshToken = generateRefreshToken(user.id, user.email!, user.role);

      // Remove password from response
      const { password: _, ...userWithoutPassword } = user;

      res.json({
        user: userWithoutPassword,
        accessToken,
        refreshToken,
      });
    } catch (error) {
      console.error("Mobile login error:", error);
      res.status(500).json({ message: "Login failed" });
    }
  });

  // Mobile Register - Returns JWT tokens
  app.post("/api/mobile/auth/register", async (req, res) => {
    try {
      const { email, password, firstName, lastName, phone, customerType, referralCode } = req.body;

      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ message: "Invalid email format" });
      }

      // Validate password strength
      if (password.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters long" });
      }

      // Check if user already exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ message: "Email already registered" });
      }

      // Validate referral code if provided
      let referrer = null;
      if (referralCode) {
        referrer = await storage.getUserByReferralCode(referralCode);
        if (!referrer) {
          return res.status(400).json({ message: "Invalid referral code" });
        }
      }

      // Generate referral code for new user
      const { generateUniqueReferralCode } = await import("./referralCodeGenerator");
      const newUserReferralCode = await generateUniqueReferralCode(firstName);

      // Hash password and create customer
      const hashedPassword = await hashPassword(password);
      const newUser = await storage.createCustomer({
        email,
        password: hashedPassword,
        firstName: firstName || null,
        lastName: lastName || null,
        phone: phone || null,
        customerType: customerType || "individual",
        referralCode: newUserReferralCode,
      });

      // Create referral relationship and award points if referred
      if (referrer) {
        const referralPoints = 100;

        await storage.createReferral({
          referrerId: referrer.id,
          referredId: newUser.id,
          pointsAwarded: referralPoints,
        });

        await storage.addLoyaltyPoints(referrer.id, referralPoints, "referral", "Referred a new customer");
      }

      // Generate JWT tokens
      const { generateAccessToken, generateRefreshToken } = await import("./jwtUtils");
      const accessToken = generateAccessToken(newUser.id, newUser.email!, newUser.role);
      const refreshToken = generateRefreshToken(newUser.id, newUser.email!, newUser.role);

      // Remove password from response
      const { password: _, ...userWithoutPassword } = newUser;

      res.status(201).json({
        user: userWithoutPassword,
        accessToken,
        refreshToken,
        message: "Registration successful!",
      });
    } catch (error) {
      console.error("Mobile registration error:", error);

      if (error instanceof Error && error.message && error.message.includes("duplicate")) {
        return res.status(400).json({ message: "Email already registered" });
      }

      res.status(500).json({ message: "Registration failed" });
    }
  });

  // Mobile Refresh Token
  app.post("/api/mobile/auth/refresh", async (req, res) => {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res.status(400).json({ message: "Refresh token is required" });
      }

      const { verifyRefreshToken, generateAccessToken, generateRefreshToken } = await import("./jwtUtils");
      const payload = verifyRefreshToken(refreshToken);

      if (!payload) {
        return res.status(401).json({ message: "Invalid or expired refresh token" });
      }

      // Verify user still exists and is active
      const user = await storage.getUser(payload.userId);
      if (!user || user.isActive === false) {
        return res.status(401).json({ message: "User account not found or deactivated" });
      }

      // Generate new tokens
      const newAccessToken = generateAccessToken(user.id, user.email!, user.role);
      const newRefreshToken = generateRefreshToken(user.id, user.email!, user.role);

      res.json({
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      });
    } catch (error) {
      console.error("Token refresh error:", error);
      res.status(500).json({ message: "Token refresh failed" });
    }
  });

  // Mobile Get Current User (using JWT)
  app.get("/api/mobile/auth/user", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ message: "Authorization header required" });
      }

      const token = authHeader.substring(7);
      const { verifyAccessToken } = await import("./jwtUtils");
      const payload = verifyAccessToken(token);

      if (!payload) {
        return res.status(401).json({ message: "Invalid or expired token" });
      }

      // Fetch full user from database
      const user = await storage.getUser(payload.userId);

      if (!user || user.isActive === false) {
        return res.status(401).json({ message: "User account not found or deactivated" });
      }

      // Remove password from response
      const { password: _, ...userWithoutPassword } = user;

      res.json(userWithoutPassword);
    } catch (error) {
      console.error("Get mobile user error:", error);
      res.status(500).json({ message: "Failed to get user" });
    }
  });
}

// Middleware to check if user is authenticated
export const isAuthenticated: RequestHandler = async (req, res, next) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  next();
};
