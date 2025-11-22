import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, decimal, boolean, pgEnum, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Enums
export const userRoleEnum = pgEnum("user_role", ["admin", "manager", "mechanic", "receptionist", "customer"]);
export const customerTypeEnum = pgEnum("customer_type", ["individual", "business"]);
export const appointmentStatusEnum = pgEnum("appointment_status", ["scheduled", "confirmed", "in_progress", "completed", "cancelled"]);
export const appointmentTypeEnum = pgEnum("appointment_type", ["in_shop", "remote"]);
// Legacy enum name from work_orders -> job_cards migration, kept for compatibility
export const jobCardStatusEnum = pgEnum("work_order_status", ["scheduled", "in_progress", "awaiting_parts", "completed", "cancelled"]);
export const approvalStatusEnum = pgEnum("approval_status", ["pending", "approved", "denied"]);
export const invoiceStatusEnum = pgEnum("invoice_status", ["draft", "sent", "paid", "partially_paid", "overdue", "cancelled"]);
export const estimateStatusEnum = pgEnum("estimate_status", ["draft", "sent", "approved", "rejected", "expired", "converted"]);
export const paymentMethodEnum = pgEnum("payment_method", ["cash", "credit_card", "debit_card", "check", "bank_transfer"]);
export const itemTypeEnum = pgEnum("item_type", ["parts", "labour"]);
export const inspectionStatusEnum = pgEnum("inspection_status", ["draft", "completed", "sent"]);
export const itemConditionEnum = pgEnum("item_condition", ["good", "fair", "poor", "critical"]);
export const staffRoleTypeEnum = pgEnum("staff_role_type", ["mechanic", "receptionist", "manager", "admin"]);
export const rentalCategoryEnum = pgEnum("rental_category", ["economy", "compact", "midsize", "fullsize", "suv", "van", "luxury"]);
export const rentalStatusEnum = pgEnum("rental_status", ["available", "rented", "maintenance", "retired"]);
export const reservationStatusEnum = pgEnum("reservation_status", ["pending", "confirmed", "active", "completed", "cancelled"]);
export const rentalPaymentTypeEnum = pgEnum("rental_payment_type", ["deposit", "rental_fee", "insurance", "extra", "damage_charge", "late_fee", "refund"]);
export const bannerMediaTypeEnum = pgEnum("banner_media_type", ["image", "video"]);
export const vehicleDocumentTypeEnum = pgEnum("vehicle_document_type", ["registration", "insurance", "generic"]);
export const agentStatusEnum = pgEnum("agent_status", ["available", "away", "busy", "offline", "break", "training"]);
export const chatPriorityEnum = pgEnum("chat_priority", ["normal", "high", "urgent"]);
export const chatAssignmentMethodEnum = pgEnum("chat_assignment_method", ["round_robin", "least_busy", "manual_claim", "return_customer"]);
export const leadStatusEnum = pgEnum("lead_status", ["new", "contacted", "qualified", "unqualified", "converted", "lost"]);
export const leadSourceEnum = pgEnum("lead_source", ["web_form", "phone", "email", "referral", "walk_in", "chat", "social_media", "other"]);
export const leadActivityTypeEnum = pgEnum("lead_activity_type", ["call", "email", "meeting", "note", "status_change", "assignment"]);

// Session storage table for Replit Auth
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// Users table (both staff and customers)
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").unique(),
  password: text("password"),
  emailVerified: boolean("email_verified").default(false).notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  profileImageUrl: text("profile_image_url"),
  role: userRoleEnum("role").notNull().default("customer"),
  customerType: customerTypeEnum("customer_type").default("individual"),
  accountNumber: text("account_number").unique(),
  phone: text("phone"),
  address: text("address"),
  billingEmail: text("billing_email"),
  ccEmail: text("cc_email"),
  permissions: text("permissions").array().default(sql`ARRAY[]::text[]`),
  reviewRequestsEnabled: boolean("review_requests_enabled").default(true),
  isActive: boolean("is_active").default(true).notNull(),
  pushToken: text("push_token"),

  // Referral system
  referralCode: text("referral_code").unique(), // Unique code for sharing (e.g., "JOHN8X4Z")

  // Accounting fields
  paymentTerms: text("payment_terms").default("Net 30"), // Net 30, Net 60, Due on Receipt, etc.
  creditLimit: decimal("credit_limit", { precision: 10, scale: 2 }), // Maximum outstanding balance

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_users_referral_code").on(table.referralCode),
]);

// Email verification tokens table
export const emailVerificationTokens = pgTable("email_verification_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_email_verification_tokens_token").on(table.token),
  index("idx_email_verification_tokens_user_id").on(table.userId),
]);

// Password reset tokens table
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_password_reset_tokens_token").on(table.token),
  index("idx_password_reset_tokens_user_id").on(table.userId),
]);

// Permissions & Roles System
// Permissions table - defines all available permissions in the system
export const permissions = pgTable("permissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  code: varchar("code", { length: 100 }).notNull().unique(), // e.g., 'invoices.create'
  name: varchar("name", { length: 255 }).notNull(), // e.g., 'Create Invoices'
  description: text("description"), // Detailed description of what this permission allows
  category: varchar("category", { length: 100 }).notNull(), // e.g., 'invoices', 'users', 'reports'
  isSystem: boolean("is_system").default(false).notNull(), // System permissions cannot be deleted
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_permissions_code").on(table.code),
  index("idx_permissions_category").on(table.category),
]);

// Roles table - custom and system roles
export const roles = pgTable("roles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 100 }).notNull().unique(), // e.g., 'Senior Mechanic', 'admin'
  description: text("description"),
  isSystem: boolean("is_system").default(false).notNull(), // System roles (admin, manager, etc.) - editable
  isActive: boolean("is_active").default(true).notNull(), // Can temporarily disable roles
  createdBy: varchar("created_by").references(() => users.id, { onDelete: "set null" }),
  updatedBy: varchar("updated_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_roles_name").on(table.name),
  index("idx_roles_is_active").on(table.isActive),
]);

// Role Permissions mapping - which permissions each role has
export const rolePermissions = pgTable("role_permissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  roleId: varchar("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  permissionId: varchar("permission_id").notNull().references(() => permissions.id, { onDelete: "cascade" }),
  grantedBy: varchar("granted_by").references(() => users.id, { onDelete: "set null" }),
  grantedAt: timestamp("granted_at").defaultNow().notNull(),
}, (table) => [
  index("idx_role_permissions_role").on(table.roleId),
  index("idx_role_permissions_permission").on(table.permissionId),
  // Composite unique index to prevent duplicate mappings
  index("idx_role_permissions_unique").on(table.roleId, table.permissionId),
]);

// User Permission Overrides - individual permissions granted or revoked for specific users
export const userPermissionOverrides = pgTable("user_permission_overrides", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  permissionId: varchar("permission_id").notNull().references(() => permissions.id, { onDelete: "cascade" }),
  granted: boolean("granted").notNull(), // true = grant permission, false = revoke permission
  grantedBy: varchar("granted_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  reason: text("reason"), // Optional reason for the grant/revoke
  expiresAt: timestamp("expires_at"), // Optional expiration for temporary permissions
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_user_overrides_user").on(table.userId),
  index("idx_user_overrides_permission").on(table.permissionId),
  index("idx_user_overrides_granted").on(table.granted),
  index("idx_user_overrides_expires").on(table.expiresAt),
  // Composite unique index to prevent duplicate overrides
  index("idx_user_overrides_unique").on(table.userId, table.permissionId),
]);

// Permission Audit Log - track all permission changes
export const permissionAuditLog = pgTable("permission_audit_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  action: varchar("action", { length: 50 }).notNull(), // grant, revoke, role_created, role_updated, role_deleted
  entityType: varchar("entity_type", { length: 50 }).notNull(), // user, role, permission
  entityId: varchar("entity_id").notNull(), // ID of the affected entity
  permissionCode: varchar("permission_code", { length: 100 }), // Permission code if applicable
  roleId: varchar("role_id").references(() => roles.id, { onDelete: "set null" }), // Role if applicable
  performedBy: varchar("performed_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  metadata: jsonb("metadata"), // Additional context (e.g., reason, old values, new values)
  ipAddress: varchar("ip_address", { length: 45 }), // IPv4 or IPv6
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_audit_entity").on(table.entityType, table.entityId),
  index("idx_audit_action").on(table.action),
  index("idx_audit_performed_by").on(table.performedBy),
  index("idx_audit_created_at").on(table.createdAt),
]);

// Vehicles table
export const vehicles = pgTable("vehicles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  customerId: varchar("customer_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  make: text("make").notNull(),
  model: text("model").notNull(),
  year: integer("year").notNull(),
  vin: text("vin"),
  engineNumber: text("engine_number"),
  licensePlate: text("license_plate"),
  photos: text("photos").array().default(sql`ARRAY[]::text[]`),
  currentMileage: integer("current_mileage").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  // QR Code fields (nullable for existing vehicles, required for new ones)
  vehicleCode: varchar("vehicle_code", { length: 11 }).unique(),
  branchCode: varchar("branch_code", { length: 2 }),
  qrToken: varchar("qr_token", { length: 32 }).unique(),
  qrGeneratedAt: timestamp("qr_generated_at"),
  // Tier 1 - Essential vehicle details
  color: text("color"),
  transmission: text("transmission"), // automatic, manual, CVT
  fuelType: text("fuel_type"), // gasoline, diesel, electric, hybrid, plug-in hybrid
  bodyStyle: text("body_style"), // sedan, SUV, truck, coupe, wagon, van, hatchback, pick-up
  // Tier 2 - Important specifications
  trim: text("trim"), // Trim level (e.g., LX, Sport, Limited)
  engineType: text("engine_type"), // Descriptive (e.g., "2.5L 4-Cylinder Turbo")
  driveType: text("drive_type"), // FWD, RWD, AWD, 4WD
  doors: integer("doors"), // Number of doors (2, 4, 5)
  // Tier 3 - Optional details
  seats: integer("seats"), // Number of seats
  cylinders: integer("cylinders"), // Number of cylinders
  engineDisplacement: decimal("engine_displacement", { precision: 3, scale: 1 }), // Engine size in liters
  insuranceProvider: text("insurance_provider"),
  policyNumber: text("policy_number"),
  registrationExpiry: timestamp("registration_expiry"),
  condition: text("condition"), // excellent, good, fair, poor
  notes: text("notes"), // Additional notes/remarks
}, (table) => [
  index("idx_vehicles_customer_id").on(table.customerId),
  index("idx_vehicles_vin").on(table.vin),
  index("idx_vehicles_license_plate").on(table.licensePlate),
  index("idx_vehicles_vehicle_code").on(table.vehicleCode),
  index("idx_vehicles_qr_token").on(table.qrToken),
]);

// Vehicle Code Sequence table (for atomic counter per branch)
export const vehicleCodeSequence = pgTable("vehicle_code_sequence", {
  branchCode: varchar("branch_code", { length: 2 }).primaryKey(),
  lastNumber: integer("last_number").notNull().default(0),
});

// Vehicle Documents table
export const vehicleDocuments = pgTable("vehicle_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vehicleId: varchar("vehicle_id").notNull().references(() => vehicles.id, { onDelete: "cascade" }),
  documentType: vehicleDocumentTypeEnum("document_type").notNull(),
  title: text("title").notNull(),
  documentUrl: text("document_url").notNull(), // Stored in object storage
  expiryDate: timestamp("expiry_date"), // Nullable for generic documents
  reminderDays: integer("reminder_days").array().default(sql`ARRAY[30, 14, 7, 3, 1]::integer[]`), // Days before expiry to send reminders
  notes: text("notes"),
  uploadedBy: varchar("uploaded_by").notNull().references(() => users.id, { onDelete: "set null" }),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_vehicle_documents_vehicle_id").on(table.vehicleId),
  index("idx_vehicle_documents_expiry_date").on(table.expiryDate),
  index("idx_vehicle_documents_document_type").on(table.documentType),
]);

// Vehicle Document Reminder History table
export const vehicleDocumentReminderHistory = pgTable("vehicle_document_reminder_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  documentId: varchar("document_id").notNull().references(() => vehicleDocuments.id, { onDelete: "cascade" }),
  customerId: varchar("customer_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  vehicleId: varchar("vehicle_id").notNull().references(() => vehicles.id, { onDelete: "cascade" }),
  reminderDaysOut: integer("reminder_days_out").notNull(), // How many days before expiry was this reminder sent
  sentAt: timestamp("sent_at").defaultNow().notNull(),
  status: text("status").notNull().default("sent"), // sent, failed, bounced
  errorMessage: text("error_message"),
  emailSubject: text("email_subject").notNull(),
  emailBody: text("email_body").notNull(),
});

// Service Catalog table - Admin-configurable services for appointments
export const serviceCatalog = pgTable("service_catalog", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  description: text("description"),
  category: text("category"), // e.g., "Maintenance", "Repair", "Inspection", "Diagnostic"
  estimatedDurationMinutes: integer("estimated_duration_minutes"), // Duration for this service
  requiresApproval: boolean("requires_approval"), // null = use default, true/false = override
  // Pricing configuration
  pricingType: text("pricing_type"), // "hourly" | "fixed" | null (no preset pricing)
  defaultRate: decimal("default_rate", { precision: 10, scale: 2 }), // Hourly rate or fixed price
  isActive: boolean("is_active").notNull().default(true),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_service_catalog_active").on(table.isActive),
  index("idx_service_catalog_display_order").on(table.displayOrder),
]);

// Appointments table
export const appointments = pgTable("appointments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  customerId: varchar("customer_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  vehicleId: varchar("vehicle_id").notNull().references(() => vehicles.id, { onDelete: "cascade" }),
  scheduledDate: timestamp("scheduled_date").notNull(),
  status: appointmentStatusEnum("status").notNull().default("scheduled"),
  appointmentType: appointmentTypeEnum("appointment_type").notNull().default("in_shop"),
  services: text("services").array().notNull().default(sql`ARRAY[]::text[]`), // Array of service names
  serviceLocation: jsonb("service_location"), // For remote appointments: { streetAddress, parish, specialInstructions, gpsCoordinates? }
  // Legacy field - kept for backward compatibility during migration
  serviceType: text("service_type"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_appointments_customer_id").on(table.customerId),
  index("idx_appointments_vehicle_id").on(table.vehicleId),
  index("idx_appointments_status").on(table.status),
  index("idx_appointments_customer_status").on(table.customerId, table.status),
  index("idx_appointments_scheduled_date").on(table.scheduledDate),
  index("idx_appointments_type").on(table.appointmentType),
]);

// Job Cards table
export const jobCards = pgTable("job_cards", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  customerId: varchar("customer_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  vehicleId: varchar("vehicle_id").notNull().references(() => vehicles.id, { onDelete: "cascade" }),
  mechanicId: varchar("mechanic_id").references(() => users.id, { onDelete: "set null" }),
  appointmentId: varchar("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
  status: jobCardStatusEnum("status").notNull().default("scheduled"),
  scheduledDate: timestamp("scheduled_date").notNull(),
  description: text("description").notNull(),
  laborHours: decimal("labor_hours", { precision: 5, scale: 2 }).default("0"),
  laborRate: decimal("labor_rate", { precision: 10, scale: 2 }).default("0"),
  totalCost: decimal("total_cost", { precision: 10, scale: 2 }).default("0"),
  photos: text("photos").array().default(sql`ARRAY[]::text[]`),
  reviewSubmitted: boolean("review_submitted").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
}, (table) => [
  index("idx_job_cards_customer_id").on(table.customerId),
  index("idx_job_cards_vehicle_id").on(table.vehicleId),
  index("idx_job_cards_mechanic_id").on(table.mechanicId),
  index("idx_job_cards_appointment_id").on(table.appointmentId),
  index("idx_job_cards_status").on(table.status),
  index("idx_job_cards_customer_status").on(table.customerId, table.status),
  index("idx_job_cards_mechanic_status").on(table.mechanicId, table.status),
]);

// Parts Inventory table
export const partsInventory = pgTable("parts_inventory", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  partNumber: text("part_number").notNull().unique(),
  barcode: text("barcode").unique(),
  quantity: integer("quantity").notNull().default(0),
  purchasePrice: decimal("purchase_price", { precision: 10, scale: 2 }).notNull(),
  salePrice: decimal("sale_price", { precision: 10, scale: 2 }).notNull(),
  lowStockThreshold: integer("low_stock_threshold").notNull().default(10),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_parts_barcode").on(table.barcode),
  index("idx_parts_part_number").on(table.partNumber),
]);

// Job Card Parts (junction table for parts used in job cards)
export const jobCardParts = pgTable("job_card_parts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jobCardId: varchar("job_card_id").notNull().references(() => jobCards.id, { onDelete: "cascade" }),
  partId: varchar("part_id").notNull().references(() => partsInventory.id, { onDelete: "cascade" }),
  quantity: integer("quantity").notNull(),
  priceAtTime: decimal("price_at_time", { precision: 10, scale: 2 }).notNull(),
}, (table) => [
  index("idx_job_card_parts_job_card_id").on(table.jobCardId),
  index("idx_job_card_parts_part_id").on(table.partId),
]);

// Job Card Tasks table
export const jobCardTasks = pgTable("job_card_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jobCardId: varchar("job_card_id").notNull().references(() => jobCards.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  isCompleted: boolean("is_completed").default(false).notNull(),
  completedBy: varchar("completed_by").references(() => users.id, { onDelete: "set null" }),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_job_card_tasks_job_card_id").on(table.jobCardId),
]);

// Approval Requests table
export const approvalRequests = pgTable("approval_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  customerId: varchar("customer_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  appointmentId: varchar("appointment_id").references(() => appointments.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // "reschedule" or "new_appointment"
  requestedDate: timestamp("requested_date").notNull(),
  currentDate: timestamp("current_date"),
  reason: text("reason"),
  status: approvalStatusEnum("status").notNull().default("pending"),
  reviewedBy: varchar("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  reviewNotes: text("review_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  reviewedAt: timestamp("reviewed_at"),
});

// Customer Notes table
export const customerNotes = pgTable("customer_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  customerId: varchar("customer_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  authorId: varchar("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  note: text("note").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Enhanced Email Campaigns table
export const emailCampaigns = pgTable("email_campaigns", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(), // Campaign name for internal tracking
  subject: text("subject").notNull(),
  htmlContent: text("html_content").notNull(), // Rich HTML content
  plainText: text("plain_text"), // Plain text fallback
  recipientFilter: jsonb("recipient_filter"), // Filter criteria: {customerType, minSpent, maxSpent, etc}
  recipientIds: text("recipient_ids").array().notNull(),
  status: text("status").notNull().default("draft"), // draft, scheduled, sending, sent, failed
  scheduledFor: timestamp("scheduled_for"), // When to send (null = send immediately)
  sentBy: varchar("sent_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  sentAt: timestamp("sent_at"),
  sentCount: integer("sent_count").default(0),
  openCount: integer("open_count").default(0),
  clickCount: integer("click_count").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Coupons table
export const coupons = pgTable("coupons", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  code: text("code").unique().notNull(), // Unique coupon code (e.g., SAVE20)
  type: text("type").notNull(), // "percentage" or "fixed"
  value: decimal("value", { precision: 10, scale: 2 }).notNull(), // 20 for 20% or 50.00 for $50
  minPurchase: decimal("min_purchase", { precision: 10, scale: 2 }).default("0"), // Minimum invoice total
  expiryDate: timestamp("expiry_date").notNull(),
  isActive: boolean("is_active").default(true),
  usedBy: varchar("used_by").references(() => users.id, { onDelete: "set null" }), // Customer who used it
  usedAt: timestamp("used_at"),
  appliedToInvoice: varchar("applied_to_invoice").references(() => invoices.id, { onDelete: "set null" }),
  createdBy: varchar("created_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Loyalty Points Transactions table
export const loyaltyPointsTransactions = pgTable("loyalty_points_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  customerId: varchar("customer_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  points: integer("points").notNull(), // Positive for earn, negative for redeem
  type: text("type").notNull(), // "visit", "referral", "spend", "redeem"
  description: text("description").notNull(),
  relatedId: varchar("related_id"), // Invoice ID, referral ID, etc.
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Loyalty Settings table (singleton config)
export const loyaltySettings = pgTable("loyalty_settings", {
  id: integer("id").primaryKey().default(1), // Single row config
  pointsPerDollar: decimal("points_per_dollar", { precision: 5, scale: 2 }).default("1"), // Points per dollar spent
  pointsPerVisit: integer("points_per_visit").default(10), // Flat points per completed service
  referralBonusReferrer: integer("referral_bonus_referrer").default(100), // Points for referrer
  referralBonusReferred: integer("referral_bonus_referred").default(50), // Points for new customer
  pointsToCouponRate: integer("points_to_coupon_rate").default(100), // Points needed for $1 coupon
  minRedemptionPoints: integer("min_redemption_points").default(500), // Minimum points to redeem
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Customer Referrals table
export const customerReferrals = pgTable("customer_referrals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  referrerId: varchar("referrer_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  referredId: varchar("referred_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  pointsAwarded: integer("points_awarded").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Job Card Timer Sessions table
export const jobCardTimerSessions = pgTable("job_card_timer_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jobCardId: varchar("job_card_id").notNull().references(() => jobCards.id, { onDelete: "cascade" }),
  mechanicId: varchar("mechanic_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time"),
  totalSeconds: integer("total_seconds").default(0),
  isActive: boolean("is_active").default(false),
});

// Landing Page Settings table
export const landingPageSettings = pgTable("landing_page_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // Branding
  appName: text("app_name").notNull().default("316 Auto"), // App name shown in sidebar/header
  businessName: text("business_name").notNull().default("316 Automotive"), // Business name shown publicly
  logoUrl: text("logo_url"), // Logo image URL
  faviconUrl: text("favicon_url"), // Favicon URL
  loginBackgroundUrl: text("login_background_url"), // Login page background image URL
  // Hero Section
  heroTitle: text("hero_title").notNull().default("Your Trusted Partner for Auto Repair & Maintenance"),
  heroDescription: text("hero_description").notNull().default("Quality service, honest pricing, and expert care for your vehicle. Book your appointment online today."),
  heroButtonText: text("hero_button_text").default("Book Appointment"),
  heroButtonUrl: text("hero_button_url").default("/register"),
  heroImageUrl: text("hero_image_url"), // Hero background/featured image
  // Services Section
  servicesTitle: text("services_title").default("Our Services"),
  servicesDescription: text("services_description").default("Comprehensive automotive services to keep your vehicle running smoothly"),
  services: jsonb("services").notNull().default(sql`'[]'::jsonb`), // Array of {icon, title, description}
  // About Section
  aboutTitle: text("about_title").default("About Us"),
  aboutDescription: text("about_description").default("We are a family-owned automotive repair shop committed to providing exceptional service."),
  // Features Section
  featuresTitle: text("features_title").default("Why Choose Us"),
  features: jsonb("features").default(sql`'[]'::jsonb`), // Array of {icon, title, description}
  // Contact Info
  address: text("address").default("316 Auto Street, Your City, ST 12345"),
  phone: text("phone").default("(316) 555-0100"),
  email: text("email").default("service@316automotive.com"),
  hours: text("hours").default("Mon-Fri: 7:00 AM - 6:00 PM, Sat: 8:00 AM - 4:00 PM"),
  // Social Media
  facebookUrl: text("facebook_url"),
  twitterUrl: text("twitter_url"),
  instagramUrl: text("instagram_url"),
  linkedinUrl: text("linkedin_url"),
  googlePlaceId: text("google_place_id"), // Google Business Place ID for reviews widget
  // Footer
  footerText: text("footer_text").default("© 2024 316 Automotive. All rights reserved."),
  // Invoice/Document Settings
  invoiceTagline: text("invoice_tagline").default("Full Vehicle Maintenance & Repair Services"),
  invoicePaymentInstructions: text("invoice_payment_instructions").default("Please make payments to the bank account referencing the invoice number."),
  invoiceTermsConditions: text("invoice_terms_conditions").default("All repairs carry a warranty. Storage fees may apply if vehicle is not picked up within 3 days after completion."),
  invoiceTemplate: text("invoice_template").default("professional"), // professional, modern, classic, minimal
  // Meta
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Pricing Settings table (singleton config)
export const pricingSettings = pgTable("pricing_settings", {
  id: integer("id").primaryKey().default(1), // Single row config
  // Business Settings
  currency: text("currency").notNull().default("USD"), // Currency code (USD, JMD, EUR, GBP, etc.)
  currencySymbol: text("currency_symbol").notNull().default("$"), // Currency symbol for display
  // Pricing
  defaultLaborRate: decimal("default_labor_rate", { precision: 10, scale: 2 }).default("75.00"), // Default hourly labor rate
  partsMarkupPercent: decimal("parts_markup_percent", { precision: 5, scale: 2 }).default("30.00"), // Default parts markup %
  taxRate: decimal("tax_rate", { precision: 5, scale: 2 }).default("8.00"), // Sales tax rate %
  taxName: text("tax_name").default("Sales Tax"), // Tax label (e.g., "GCT", "VAT", "Sales Tax")
  shopSuppliesPercent: decimal("shop_supplies_percent", { precision: 5, scale: 2 }).default("5.00"), // Shop supplies fee %
  // Labor rate tiers
  diagnosticRate: decimal("diagnostic_rate", { precision: 10, scale: 2 }).default("95.00"), // Diagnostic hourly rate
  bodyworkRate: decimal("bodywork_rate", { precision: 10, scale: 2 }).default("85.00"), // Body work hourly rate
  performanceRate: decimal("performance_rate", { precision: 10, scale: 2 }).default("100.00"), // Performance work hourly rate
  // Parts markup tiers
  lowValuePartsMarkup: decimal("low_value_parts_markup", { precision: 5, scale: 2 }).default("40.00"), // < $50
  mediumValuePartsMarkup: decimal("medium_value_parts_markup", { precision: 5, scale: 2 }).default("30.00"), // $50-$200
  highValuePartsMarkup: decimal("high_value_parts_markup", { precision: 5, scale: 2 }).default("20.00"), // > $200
  lowValueThreshold: decimal("low_value_threshold", { precision: 10, scale: 2 }).default("50.00"), // Threshold for low value parts
  highValueThreshold: decimal("high_value_threshold", { precision: 10, scale: 2 }).default("200.00"), // Threshold for high value parts
  // Additional fees
  environmentalFee: decimal("environmental_fee", { precision: 10, scale: 2 }).default("3.50"), // Per service environmental fee
  minimumServiceCharge: decimal("minimum_service_charge", { precision: 10, scale: 2 }).default("50.00"), // Minimum charge per service
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Vehicle Inspections table
export const inspections = pgTable("inspections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  inspectionNumber: text("inspection_number").unique().notNull(),
  vehicleId: varchar("vehicle_id").notNull().references(() => vehicles.id, { onDelete: "cascade" }),
  customerId: varchar("customer_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  mechanicId: varchar("mechanic_id").references(() => users.id, { onDelete: "set null" }),
  status: inspectionStatusEnum("status").notNull().default("draft"),
  inspectionDate: timestamp("inspection_date").notNull().defaultNow(),
  mileage: integer("mileage"),
  overallCondition: text("overall_condition"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Inspection Items table (individual inspection findings)
export const inspectionItems = pgTable("inspection_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  inspectionId: varchar("inspection_id").notNull().references(() => inspections.id, { onDelete: "cascade" }),
  category: text("category").notNull(), // "Brakes", "Tires", "Engine", "Exterior", "Interior", etc.
  item: text("item").notNull(), // "Front Brake Pads", "Front Left Tire", etc.
  condition: itemConditionEnum("condition").notNull().default("good"),
  notes: text("notes"),
  photos: text("photos").array().default(sql`ARRAY[]::text[]`),
  recommendedAction: text("recommended_action"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Invoices table
export const invoices = pgTable("invoices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceNumber: text("invoice_number").unique().notNull(),
  jobCardId: varchar("work_order_id").references(() => jobCards.id, { onDelete: "set null" }),
  inspectionId: varchar("inspection_id").references(() => inspections.id, { onDelete: "set null" }),
  customerId: varchar("customer_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: invoiceStatusEnum("status").notNull().default("draft"),
  issueDate: timestamp("issue_date").notNull().defaultNow(),
  dueDate: timestamp("due_date").notNull(),
  serviceDate: timestamp("service_date"),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull().default("0"),
  tax: decimal("tax", { precision: 10, scale: 2 }).notNull().default("0"),
  total: decimal("total", { precision: 10, scale: 2 }).notNull().default("0"),
  paidAmount: decimal("paid_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  balance: decimal("balance", { precision: 10, scale: 2 }).notNull().default("0"),
  lastPaymentDate: timestamp("last_payment_date"),
  notes: text("notes"),
  reviewSubmitted: boolean("review_submitted").default(false),
  shareToken: text("share_token").unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_invoices_customer_id").on(table.customerId),
  index("idx_invoices_job_card_id").on(table.jobCardId),
  index("idx_invoices_status").on(table.status),
  index("idx_invoices_customer_status").on(table.customerId, table.status),
  index("idx_invoices_share_token").on(table.shareToken),
]);

// Invoice Items table
export const invoiceItems = pgTable("invoice_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceId: varchar("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  type: itemTypeEnum("type").notNull().default("parts"),
  quantity: decimal("quantity", { precision: 10, scale: 2 }).notNull().default("1"),
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }).notNull(),
  total: decimal("total", { precision: 10, scale: 2 }).notNull(),
}, (table) => [
  index("idx_invoice_items_invoice_id").on(table.invoiceId),
]);

// Payments table
export const payments = pgTable("payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  paymentNumber: text("payment_number").unique(),
  invoiceId: varchar("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  paymentMethod: paymentMethodEnum("payment_method").notNull(),
  paymentDate: timestamp("payment_date").notNull().defaultNow(),
  transactionId: text("transaction_id"),
  notes: text("notes"),
  createdBy: varchar("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_payments_invoice_id").on(table.invoiceId),
  index("idx_payments_payment_number").on(table.paymentNumber),
]);

// Invoice Number Sequence table (for atomic counter)
export const invoiceNumberSequence = pgTable("invoice_number_sequence", {
  year: integer("year").primaryKey(),
  lastNumber: integer("last_number").notNull().default(0),
});

// Customer Account Number Sequence table (for atomic counter)
export const customerAccountSequence = pgTable("customer_account_sequence", {
  id: integer("id").primaryKey().default(1),
  lastNumber: integer("last_number").notNull().default(0),
});

// Estimates table
export const estimates = pgTable("estimates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  estimateNumber: text("estimate_number").unique().notNull(),
  jobCardId: varchar("work_order_id").references(() => jobCards.id, { onDelete: "set null" }),
  inspectionId: varchar("inspection_id").references(() => inspections.id, { onDelete: "set null" }),
  customerId: varchar("customer_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  vehicleId: varchar("vehicle_id").references(() => vehicles.id, { onDelete: "set null" }),
  status: estimateStatusEnum("status").notNull().default("draft"),
  issueDate: timestamp("issue_date").notNull().defaultNow(),
  expiryDate: timestamp("expiry_date").notNull(),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull().default("0"),
  tax: decimal("tax", { precision: 10, scale: 2 }).notNull().default("0"),
  total: decimal("total", { precision: 10, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  convertedToInvoice: varchar("converted_to_invoice").references(() => invoices.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_estimates_customer_id").on(table.customerId),
  index("idx_estimates_vehicle_id").on(table.vehicleId),
  index("idx_estimates_status").on(table.status),
  index("idx_estimates_customer_status").on(table.customerId, table.status),
]);

// Estimate Items table
export const estimateItems = pgTable("estimate_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  estimateId: varchar("estimate_id").notNull().references(() => estimates.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  type: itemTypeEnum("type").notNull().default("parts"),
  quantity: decimal("quantity", { precision: 10, scale: 2 }).notNull().default("1"),
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }).notNull(),
  total: decimal("total", { precision: 10, scale: 2 }).notNull(),
}, (table) => [
  index("idx_estimate_items_estimate_id").on(table.estimateId),
]);

// Estimate Number Sequence table (for atomic counter)
export const estimateNumberSequence = pgTable("estimate_number_sequence", {
  year: integer("year").primaryKey(),
  lastNumber: integer("last_number").notNull().default(0),
});

// Staff Reviews table
export const staffReviews = pgTable("staff_reviews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceId: varchar("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  jobCardId: varchar("job_card_id").references(() => jobCards.id, { onDelete: "set null" }),
  customerId: varchar("customer_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  mechanicId: varchar("mechanic_id").references(() => users.id, { onDelete: "set null" }),
  receptionistId: varchar("receptionist_id").references(() => users.id, { onDelete: "set null" }),
  // Ratings (1-5 stars)
  mechanicWorkQuality: integer("mechanic_work_quality"), // Technical skill rating
  mechanicCustomerService: integer("mechanic_customer_service"), // Mechanic communication/service
  officeStaffService: integer("office_staff_service"), // Receptionist/office experience
  overallExperience: integer("overall_experience").notNull(), // Required overall rating
  // Feedback
  comments: text("comments"),
  wouldRecommend: boolean("would_recommend").default(true),
  // Staff response
  responseText: text("response_text"),
  respondedBy: varchar("responded_by").references(() => users.id, { onDelete: "set null" }),
  respondedAt: timestamp("responded_at"),
  // Moderation
  status: varchar("status").default("published").notNull(), // published, hidden, flagged
  moderatedBy: varchar("moderated_by").references(() => users.id, { onDelete: "set null" }),
  moderatedAt: timestamp("moderated_at"),
  moderationNote: text("moderation_note"),
  // Metadata
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ========================================
// RENTAL SYSTEM TABLES
// ========================================

// Rental Vehicles table - Fleet inventory
export const rentalVehicles = pgTable("rental_vehicles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  make: text("make").notNull(),
  model: text("model").notNull(),
  year: integer("year").notNull(),
  vin: text("vin").unique(),
  licensePlate: text("license_plate").unique().notNull(),
  color: text("color"),
  category: rentalCategoryEnum("category").notNull().default("economy"),
  photos: text("photos").array().default(sql`ARRAY[]::text[]`),
  dailyRate: decimal("daily_rate", { precision: 10, scale: 2 }).notNull(),
  weeklyRate: decimal("weekly_rate", { precision: 10, scale: 2 }).notNull(),
  monthlyRate: decimal("monthly_rate", { precision: 10, scale: 2 }).notNull(),
  status: rentalStatusEnum("status").notNull().default("available"),
  seats: integer("seats").notNull().default(5),
  transmission: text("transmission").notNull().default("automatic"), // automatic, manual
  fuelType: text("fuel_type").notNull().default("gasoline"), // gasoline, diesel, electric, hybrid
  features: text("features").array().default(sql`ARRAY[]::text[]`), // GPS, Bluetooth, Backup Camera, etc.
  currentMileage: integer("current_mileage").default(0),
  isAvailableAsLoaner: boolean("is_available_as_loaner").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Rental Extras table - Available add-ons
export const rentalExtras = pgTable("rental_extras", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  dailyPrice: decimal("daily_price", { precision: 10, scale: 2 }).notNull(),
  category: text("category").notNull().default("equipment"), // insurance, equipment, service
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Rental Reservations table - Customer bookings
export const rentalReservations = pgTable("rental_reservations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  reservationNumber: text("reservation_number").unique().notNull(),
  customerId: varchar("customer_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  rentalVehicleId: varchar("rental_vehicle_id").notNull().references(() => rentalVehicles.id, { onDelete: "cascade" }),
  pickupDate: timestamp("pickup_date").notNull(),
  returnDate: timestamp("return_date").notNull(),
  actualReturnDate: timestamp("actual_return_date"),
  status: reservationStatusEnum("status").notNull().default("pending"),
  basePrice: decimal("base_price", { precision: 10, scale: 2 }).notNull(),
  insurancePrice: decimal("insurance_price", { precision: 10, scale: 2 }).default("0"),
  extrasPrice: decimal("extras_price", { precision: 10, scale: 2 }).default("0"),
  taxAmount: decimal("tax_amount", { precision: 10, scale: 2 }).default("0"),
  totalPrice: decimal("total_price", { precision: 10, scale: 2 }).notNull(),
  depositAmount: decimal("deposit_amount", { precision: 10, scale: 2 }).notNull(),
  depositPaid: boolean("deposit_paid").default(false),
  specialRequests: text("special_requests"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Rental Reservation Extras - Junction table for extras selected with reservation
export const rentalReservationExtras = pgTable("rental_reservation_extras", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  reservationId: varchar("reservation_id").notNull().references(() => rentalReservations.id, { onDelete: "cascade" }),
  extraId: varchar("extra_id").notNull().references(() => rentalExtras.id, { onDelete: "cascade" }),
  quantity: integer("quantity").notNull().default(1),
  priceAtTime: decimal("price_at_time", { precision: 10, scale: 2 }).notNull(),
});

// Rental Contracts table - Rental agreements
export const rentalContracts = pgTable("rental_contracts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractNumber: text("contract_number").unique().notNull(),
  reservationId: varchar("reservation_id").notNull().references(() => rentalReservations.id, { onDelete: "cascade" }),
  customerId: varchar("customer_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  driverLicenseNumber: text("driver_license_number").notNull(),
  licenseExpiry: timestamp("license_expiry").notNull(),
  licenseVerified: boolean("license_verified").default(false),
  additionalDrivers: jsonb("additional_drivers").default(sql`'[]'::jsonb`), // [{name, license, licenseExpiry}]
  checkoutMileage: integer("checkout_mileage"),
  checkinMileage: integer("checkin_mileage"),
  checkoutFuelLevel: text("checkout_fuel_level"), // full, 3/4, 1/2, 1/4, empty
  checkinFuelLevel: text("checkin_fuel_level"),
  checkoutPhotos: text("checkout_photos").array().default(sql`ARRAY[]::text[]`),
  checkinPhotos: text("checkin_photos").array().default(sql`ARRAY[]::text[]`),
  checkoutConditionNotes: text("checkout_condition_notes"),
  checkinConditionNotes: text("checkin_condition_notes"),
  checkoutBy: varchar("checkout_by").references(() => users.id, { onDelete: "set null" }), // Staff who processed checkout
  checkinBy: varchar("checkin_by").references(() => users.id, { onDelete: "set null" }), // Staff who processed checkin
  checkoutAt: timestamp("checkout_at"),
  checkinAt: timestamp("checkin_at"),
  agreedAt: timestamp("agreed_at"), // When customer accepted terms
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Rental Payments table - Payment tracking
export const rentalPayments = pgTable("rental_payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  reservationId: varchar("reservation_id").notNull().references(() => rentalReservations.id, { onDelete: "cascade" }),
  customerId: varchar("customer_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: rentalPaymentTypeEnum("type").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  paymentMethod: paymentMethodEnum("payment_method").notNull(),
  transactionId: text("transaction_id"),
  status: text("status").notNull().default("completed"), // pending, completed, failed, refunded
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Rental Maintenance Log table - Fleet maintenance tracking
export const rentalMaintenanceLog = pgTable("rental_maintenance_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  rentalVehicleId: varchar("rental_vehicle_id").notNull().references(() => rentalVehicles.id, { onDelete: "cascade" }),
  mechanicId: varchar("mechanic_id").references(() => users.id, { onDelete: "set null" }),
  type: text("type").notNull(), // routine, repair, inspection, cleaning
  description: text("description").notNull(),
  cost: decimal("cost", { precision: 10, scale: 2 }).default("0"),
  scheduledDate: timestamp("scheduled_date"),
  completedDate: timestamp("completed_date"),
  nextServiceMileage: integer("next_service_mileage"),
  nextServiceDate: timestamp("next_service_date"),
  attachments: text("attachments").array().default(sql`ARRAY[]::text[]`), // Receipts, invoices
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Rental Availability Blocks table - Manual availability control
export const rentalAvailabilityBlocks = pgTable("rental_availability_blocks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  rentalVehicleId: varchar("rental_vehicle_id").notNull().references(() => rentalVehicles.id, { onDelete: "cascade" }),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  reason: text("reason").notNull().default("maintenance"), // maintenance, reserved, blocked, other
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Rental Reservation Number Sequence table (for atomic counter)
export const rentalReservationSequence = pgTable("rental_reservation_sequence", {
  year: integer("year").primaryKey(),
  lastNumber: integer("last_number").notNull().default(0),
});

// Rental Contract Number Sequence table (for atomic counter)
export const rentalContractSequence = pgTable("rental_contract_sequence", {
  year: integer("year").primaryKey(),
  lastNumber: integer("last_number").notNull().default(0),
});

// Zod schemas for inserts
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCustomerSchema = z.object({
  email: z.string().email().optional(),
  password: z.string().min(8).optional(), // Optional password for staff-created accounts
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  customerType: z.enum(["individual", "business"]).optional(),
});
export const upsertUserSchema = createInsertSchema(users).omit({ createdAt: true, updatedAt: true });
export const insertEmailVerificationTokenSchema = createInsertSchema(emailVerificationTokens).omit({ id: true, createdAt: true });
export const insertPasswordResetTokenSchema = createInsertSchema(passwordResetTokens).omit({ id: true, createdAt: true });
// VIN validation regex: 17 characters, alphanumeric excluding I, O, Q
const vinRegex = /^[A-HJ-NPR-Z0-9]{17}$/i;

export const insertVehicleSchema = createInsertSchema(vehicles)
  .omit({ id: true, createdAt: true })
  .extend({
    // Enhanced validation for existing fields
    year: z.number().int()
      .min(1900, "Year must be 1900 or later")
      .max(new Date().getFullYear() + 2, `Year cannot be more than ${new Date().getFullYear() + 2}`),
    vin: z.string()
      .regex(vinRegex, "VIN must be exactly 17 characters (A-Z, 0-9, excluding I, O, Q)")
      .optional()
      .or(z.literal("")),
    currentMileage: z.number().int()
      .min(0, "Mileage cannot be negative")
      .max(999999, "Mileage seems unrealistic")
      .optional()
      .default(0),
    // New field validations
    transmission: z.enum(["automatic", "manual", "CVT", "other"]).optional().or(z.literal("")),
    fuelType: z.enum(["gasoline", "diesel", "electric", "hybrid", "plug-in hybrid", "other"]).optional().or(z.literal("")),
    bodyStyle: z.enum(["sedan", "SUV", "truck", "coupe", "wagon", "van", "hatchback", "pick-up", "convertible", "other"]).optional().or(z.literal("")),
    driveType: z.enum(["FWD", "RWD", "AWD", "4WD"]).optional().or(z.literal("")),
    condition: z.enum(["excellent", "good", "fair", "poor"]).optional().or(z.literal("")),
    doors: z.number().int().min(2).max(6).optional(),
    seats: z.number().int().min(2).max(12).optional(),
    cylinders: z.number().int().min(2).max(16).optional(),
    engineDisplacement: z.string().optional(), // Stored as decimal in DB
  });

// Customer update schema - excludes 'make' field (cannot be changed after creation)
export const updateVehicleSchema = z.object({
  model: z.string().optional(),
  year: z.number().int()
    .min(1900, "Year must be 1900 or later")
    .max(new Date().getFullYear() + 2, `Year cannot be more than ${new Date().getFullYear() + 2}`)
    .optional(),
  vin: z.string()
    .regex(vinRegex, "VIN must be exactly 17 characters (A-Z, 0-9, excluding I, O, Q)")
    .optional()
    .or(z.literal("")),
  engineNumber: z.string().optional(),
  licensePlate: z.string().optional(),
  photos: z.array(z.string()).optional(),
  currentMileage: z.number().int()
    .min(0, "Mileage cannot be negative")
    .max(999999, "Mileage seems unrealistic")
    .optional(),
  // New fields
  color: z.string().optional(),
  transmission: z.enum(["automatic", "manual", "CVT", "other"]).optional().or(z.literal("")),
  fuelType: z.enum(["gasoline", "diesel", "electric", "hybrid", "plug-in hybrid", "other"]).optional().or(z.literal("")),
  bodyStyle: z.enum(["sedan", "SUV", "truck", "coupe", "wagon", "van", "hatchback", "pick-up", "convertible", "other"]).optional().or(z.literal("")),
  trim: z.string().optional(),
  engineType: z.string().optional(),
  driveType: z.enum(["FWD", "RWD", "AWD", "4WD"]).optional().or(z.literal("")),
  doors: z.number().int().min(2).max(6).optional(),
  seats: z.number().int().min(2).max(12).optional(),
  cylinders: z.number().int().min(2).max(16).optional(),
  engineDisplacement: z.string().optional(),
  insuranceProvider: z.string().optional(),
  policyNumber: z.string().optional(),
  registrationExpiry: z.date().optional(),
  condition: z.enum(["excellent", "good", "fair", "poor"]).optional().or(z.literal("")),
  notes: z.string().optional(),
});

// Vehicle Documents schemas
export const insertVehicleDocumentSchema = createInsertSchema(vehicleDocuments).omit({ id: true, createdAt: true, uploadedAt: true });
export const updateVehicleDocumentSchema = createInsertSchema(vehicleDocuments).omit({ id: true, createdAt: true, uploadedAt: true, vehicleId: true, documentUrl: true, uploadedBy: true }).partial();

// Vehicle Document Reminder History schema
export const insertVehicleDocumentReminderHistorySchema = createInsertSchema(vehicleDocumentReminderHistory).omit({ id: true, sentAt: true });

// Service Catalog schemas
export const insertServiceCatalogSchema = createInsertSchema(serviceCatalog).omit({ id: true, createdAt: true, updatedAt: true });
export const updateServiceCatalogSchema = createInsertSchema(serviceCatalog).omit({ id: true, createdAt: true, updatedAt: true }).partial();

// Staff can update all fields including make and customerId
export const staffUpdateVehicleSchema = z.object({
  make: z.string().optional(),
  model: z.string().optional(),
  year: z.number().int().optional(),
  vin: z.string().optional(),
  engineNumber: z.string().optional(),
  licensePlate: z.string().optional(),
  photos: z.array(z.string()).optional(),
  customerId: z.string().optional(),
});
export const insertAppointmentSchema = createInsertSchema(appointments).omit({ id: true, createdAt: true });
export const insertJobCardSchema = createInsertSchema(jobCards).omit({ id: true, createdAt: true, completedAt: true });
export const insertJobCardTaskSchema = createInsertSchema(jobCardTasks).omit({ id: true, createdAt: true, completedAt: true, completedBy: true });
export const insertPartSchema = createInsertSchema(partsInventory).omit({ id: true, createdAt: true });

// Update schemas (field-whitelisted)
export const updateAppointmentSchema = z.object({
  status: z.enum(["scheduled", "confirmed", "in_progress", "completed", "cancelled"]).optional(),
  notes: z.string().optional(),
  scheduledDate: z.date().optional(),
});

export const updateJobCardSchema = z.object({
  status: z.enum(["scheduled", "in_progress", "awaiting_parts", "completed", "cancelled"]).optional(),
  mechanicId: z.string().optional().nullable(),
  description: z.string().optional(),
  laborHours: z.string().optional(),
  laborRate: z.string().optional(),
  totalCost: z.string().optional(),
});

export const updateJobCardTaskSchema = z.object({
  description: z.string().optional(),
  isCompleted: z.boolean().optional(),
  completedBy: z.string().optional().nullable(),
  completedAt: z.date().optional().nullable(),
});

export const updatePartSchema = z.object({
  quantity: z.number().int().optional(),
  purchasePrice: z.string().optional(),
  salePrice: z.string().optional(),
  lowStockThreshold: z.number().int().optional(),
});

export const updateApprovalSchema = z.object({
  status: z.enum(["approved", "denied"]),
  reviewNotes: z.string().optional(),
});

export const updateInvoiceSchema = z.object({
  status: z.enum(["draft", "sent", "paid", "overdue", "cancelled"]).optional(),
  dueDate: z.date().optional(),
  notes: z.string().optional(),
});
export const insertJobCardPartSchema = createInsertSchema(jobCardParts).omit({ id: true });
export const insertApprovalRequestSchema = createInsertSchema(approvalRequests).omit({ id: true, createdAt: true, reviewedAt: true });
export const insertCustomerNoteSchema = createInsertSchema(customerNotes).omit({ id: true, createdAt: true });
export const insertEmailCampaignSchema = createInsertSchema(emailCampaigns).omit({ id: true, createdAt: true, updatedAt: true, sentAt: true });
export const updateEmailCampaignSchema = createInsertSchema(emailCampaigns).omit({ id: true, createdAt: true, updatedAt: true }).partial();
export const insertCouponSchema = createInsertSchema(coupons).omit({ id: true, createdAt: true, usedBy: true, usedAt: true, appliedToInvoice: true });
export const insertLoyaltyPointsTransactionSchema = createInsertSchema(loyaltyPointsTransactions).omit({ id: true, createdAt: true });
export const insertLoyaltySettingsSchema = createInsertSchema(loyaltySettings).omit({ updatedAt: true });
export const updateLoyaltySettingsSchema = createInsertSchema(loyaltySettings).omit({ id: true, updatedAt: true }).partial();
export const insertCustomerReferralSchema = createInsertSchema(customerReferrals).omit({ id: true, createdAt: true });
export const insertJobCardTimerSessionSchema = createInsertSchema(jobCardTimerSessions).omit({ id: true });
export const insertLandingPageSettingsSchema = createInsertSchema(landingPageSettings).omit({ id: true, updatedAt: true });
export const updateLandingPageSettingsSchema = createInsertSchema(landingPageSettings).omit({ id: true, updatedAt: true }).partial();
export const insertPricingSettingsSchema = createInsertSchema(pricingSettings).omit({ updatedAt: true });
export const updatePricingSettingsSchema = createInsertSchema(pricingSettings).omit({ id: true, updatedAt: true }).partial();
export const insertInvoiceSchema = createInsertSchema(invoices).omit({ id: true, createdAt: true, updatedAt: true });
export const insertInvoiceItemSchema = createInsertSchema(invoiceItems).omit({ id: true });
export const insertPaymentSchema = createInsertSchema(payments).omit({ id: true, createdAt: true });
export const insertEstimateSchema = createInsertSchema(estimates).omit({ id: true, createdAt: true, updatedAt: true, convertedToInvoice: true });
export const insertEstimateItemSchema = createInsertSchema(estimateItems).omit({ id: true });
export const updateEstimateSchema = z.object({
  status: z.enum(["draft", "sent", "approved", "rejected", "expired", "converted"]).optional(),
  expiryDate: z.date().optional(),
  notes: z.string().optional(),
});
export const insertInspectionSchema = createInsertSchema(inspections).omit({ id: true, createdAt: true, updatedAt: true }).extend({
  inspectionDate: z.coerce.date(),
  mileage: z.coerce.number().int().optional(),
});
export const insertInspectionItemSchema = createInsertSchema(inspectionItems).omit({ id: true, createdAt: true, inspectionId: true });
export const updateInspectionSchema = z.object({
  status: z.enum(["draft", "completed", "sent"]).optional(),
  mileage: z.coerce.number().int().optional(),
  overallCondition: z.string().optional(),
  notes: z.string().optional(),
});

// Staff Review schemas
export const insertStaffReviewSchema = createInsertSchema(staffReviews).omit({ id: true, createdAt: true, updatedAt: true }).extend({
  mechanicWorkQuality: z.number().int().min(1).max(5).optional(),
  mechanicCustomerService: z.number().int().min(1).max(5).optional(),
  officeStaffService: z.number().int().min(1).max(5).optional(),
  overallExperience: z.number().int().min(1).max(5),
  comments: z.string().optional(),
  wouldRecommend: z.boolean().optional(),
});

// TypeScript types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type UpsertUser = z.infer<typeof upsertUserSchema>;
export type User = typeof users.$inferSelect;

export type InsertEmailVerificationToken = z.infer<typeof insertEmailVerificationTokenSchema>;
export type EmailVerificationToken = typeof emailVerificationTokens.$inferSelect;

export type InsertPasswordResetToken = z.infer<typeof insertPasswordResetTokenSchema>;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;

export type InsertVehicle = z.infer<typeof insertVehicleSchema>;
export type Vehicle = typeof vehicles.$inferSelect;

export type InsertVehicleDocument = z.infer<typeof insertVehicleDocumentSchema>;
export type VehicleDocument = typeof vehicleDocuments.$inferSelect;

export type InsertVehicleDocumentReminderHistory = z.infer<typeof insertVehicleDocumentReminderHistorySchema>;
export type VehicleDocumentReminderHistory = typeof vehicleDocumentReminderHistory.$inferSelect;

export type InsertServiceCatalog = z.infer<typeof insertServiceCatalogSchema>;
export type ServiceCatalog = typeof serviceCatalog.$inferSelect;

export type InsertAppointment = z.infer<typeof insertAppointmentSchema>;
export type Appointment = typeof appointments.$inferSelect;

export type InsertJobCard = z.infer<typeof insertJobCardSchema>;
export type JobCard = typeof jobCards.$inferSelect;

export type InsertJobCardTask = z.infer<typeof insertJobCardTaskSchema>;
export type JobCardTask = typeof jobCardTasks.$inferSelect;

export type InsertPart = z.infer<typeof insertPartSchema>;
export type Part = typeof partsInventory.$inferSelect;

export type InsertJobCardPart = z.infer<typeof insertJobCardPartSchema>;
export type JobCardPart = typeof jobCardParts.$inferSelect;

export type InsertApprovalRequest = z.infer<typeof insertApprovalRequestSchema>;
export type ApprovalRequest = typeof approvalRequests.$inferSelect;

export type InsertCustomerNote = z.infer<typeof insertCustomerNoteSchema>;
export type CustomerNote = typeof customerNotes.$inferSelect;

export type InsertEmailCampaign = z.infer<typeof insertEmailCampaignSchema>;
export type EmailCampaign = typeof emailCampaigns.$inferSelect;

export type InsertJobCardTimerSession = z.infer<typeof insertJobCardTimerSessionSchema>;
export type JobCardTimerSession = typeof jobCardTimerSessions.$inferSelect;

export type InsertLandingPageSettings = z.infer<typeof insertLandingPageSettingsSchema>;
export type LandingPageSettings = typeof landingPageSettings.$inferSelect;

export type InsertPricingSettings = z.infer<typeof insertPricingSettingsSchema>;
export type PricingSettings = typeof pricingSettings.$inferSelect;

export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoices.$inferSelect;

export type InsertInvoiceItem = z.infer<typeof insertInvoiceItemSchema>;
export type InvoiceItem = typeof invoiceItems.$inferSelect;

export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof payments.$inferSelect;

export type InsertEstimate = z.infer<typeof insertEstimateSchema>;
export type Estimate = typeof estimates.$inferSelect;

export type InsertEstimateItem = z.infer<typeof insertEstimateItemSchema>;
export type EstimateItem = typeof estimateItems.$inferSelect;

export type InsertCoupon = z.infer<typeof insertCouponSchema>;
export type Coupon = typeof coupons.$inferSelect;

export type InsertLoyaltyPointsTransaction = z.infer<typeof insertLoyaltyPointsTransactionSchema>;
export type LoyaltyPointsTransaction = typeof loyaltyPointsTransactions.$inferSelect;

export type InsertLoyaltySettings = z.infer<typeof insertLoyaltySettingsSchema>;
export type LoyaltySettings = typeof loyaltySettings.$inferSelect;

export type InsertCustomerReferral = z.infer<typeof insertCustomerReferralSchema>;
export type CustomerReferral = typeof customerReferrals.$inferSelect;

export type InsertInspection = z.infer<typeof insertInspectionSchema>;
export type Inspection = typeof inspections.$inferSelect;

export type InsertInspectionItem = z.infer<typeof insertInspectionItemSchema>;
export type InspectionItem = typeof inspectionItems.$inferSelect;

export type InsertStaffReview = z.infer<typeof insertStaffReviewSchema>;
export type StaffReview = typeof staffReviews.$inferSelect;

// ========================================
// RENTAL SYSTEM SCHEMAS & TYPES
// ========================================

// Rental Vehicle schemas
export const insertRentalVehicleSchema = createInsertSchema(rentalVehicles).omit({ id: true, createdAt: true, updatedAt: true });
export const updateRentalVehicleSchema = createInsertSchema(rentalVehicles).omit({ id: true, createdAt: true, updatedAt: true }).partial();

// Rental Extra schemas
export const insertRentalExtraSchema = createInsertSchema(rentalExtras).omit({ id: true, createdAt: true });
export const updateRentalExtraSchema = createInsertSchema(rentalExtras).omit({ id: true, createdAt: true }).partial();

// Rental Reservation schemas
export const insertRentalReservationSchema = createInsertSchema(rentalReservations).omit({ id: true, createdAt: true, updatedAt: true });
export const updateRentalReservationSchema = z.object({
  status: z.enum(["pending", "confirmed", "active", "completed", "cancelled"]).optional(),
  pickupDate: z.date().optional(),
  returnDate: z.date().optional(),
  actualReturnDate: z.date().optional(),
  specialRequests: z.string().optional(),
  notes: z.string().optional(),
  depositPaid: z.boolean().optional(),
});

// Rental Reservation Extra schemas
export const insertRentalReservationExtraSchema = createInsertSchema(rentalReservationExtras).omit({ id: true });

// Rental Contract schemas
export const insertRentalContractSchema = createInsertSchema(rentalContracts).omit({ id: true, createdAt: true });
export const updateRentalContractSchema = z.object({
  licenseVerified: z.boolean().optional(),
  checkoutMileage: z.number().int().optional(),
  checkinMileage: z.number().int().optional(),
  checkoutFuelLevel: z.string().optional(),
  checkinFuelLevel: z.string().optional(),
  checkoutPhotos: z.array(z.string()).optional(),
  checkinPhotos: z.array(z.string()).optional(),
  checkoutConditionNotes: z.string().optional(),
  checkinConditionNotes: z.string().optional(),
  checkoutBy: z.string().optional(),
  checkinBy: z.string().optional(),
  checkoutAt: z.date().optional(),
  checkinAt: z.date().optional(),
  agreedAt: z.date().optional(),
});

// Rental Payment schemas
export const insertRentalPaymentSchema = createInsertSchema(rentalPayments).omit({ id: true, createdAt: true });

// Rental Maintenance schemas
export const insertRentalMaintenanceSchema = createInsertSchema(rentalMaintenanceLog).omit({ id: true, createdAt: true });
export const updateRentalMaintenanceSchema = createInsertSchema(rentalMaintenanceLog).omit({ id: true, createdAt: true }).partial();

// Rental Availability Block schemas
export const insertRentalAvailabilityBlockSchema = createInsertSchema(rentalAvailabilityBlocks).omit({ id: true, createdAt: true });

// TypeScript types
export type InsertRentalVehicle = z.infer<typeof insertRentalVehicleSchema>;
export type RentalVehicle = typeof rentalVehicles.$inferSelect;

export type InsertRentalExtra = z.infer<typeof insertRentalExtraSchema>;
export type RentalExtra = typeof rentalExtras.$inferSelect;

export type InsertRentalReservation = z.infer<typeof insertRentalReservationSchema>;
export type RentalReservation = typeof rentalReservations.$inferSelect;

export type InsertRentalReservationExtra = z.infer<typeof insertRentalReservationExtraSchema>;
export type RentalReservationExtra = typeof rentalReservationExtras.$inferSelect;

export type InsertRentalContract = z.infer<typeof insertRentalContractSchema>;
export type RentalContract = typeof rentalContracts.$inferSelect;

export type InsertRentalPayment = z.infer<typeof insertRentalPaymentSchema>;
export type RentalPayment = typeof rentalPayments.$inferSelect;

export type InsertRentalMaintenance = z.infer<typeof insertRentalMaintenanceSchema>;
export type RentalMaintenance = typeof rentalMaintenanceLog.$inferSelect;

export type InsertRentalAvailabilityBlock = z.infer<typeof insertRentalAvailabilityBlockSchema>;
export type RentalAvailabilityBlock = typeof rentalAvailabilityBlocks.$inferSelect;

// ========================================
// TOWING & RECOVERY SERVICE TABLES
// ========================================

// Towing Enums
export const wreckerTypeEnum = pgEnum("wrecker_type", ["company_owned", "third_party"]);
export const towRequestStatusEnum = pgEnum("tow_request_status", [
  "pending",
  "dispatched",
  "en_route",
  "arrived",
  "towing",
  "completed",
  "cancelled"
]);
export const vehicleSizeCategoryEnum = pgEnum("vehicle_size_category", [
  "small",
  "medium",
  "large",
  "oversized"
]);

// Tow Trucks table - Company fleet
export const towTrucks = pgTable("tow_trucks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  truckNumber: text("truck_number").unique().notNull(), // e.g., "TOW-01"
  licensePlate: text("license_plate").unique().notNull(),
  make: text("make").notNull(),
  model: text("model").notNull(),
  year: integer("year").notNull(),
  vin: text("vin").unique(),
  capacity: integer("capacity").notNull().default(5000), // Max towing capacity in lbs
  towType: text("tow_type").notNull().default("flatbed"), // flatbed, wheel_lift, integrated
  equipment: text("equipment").array().default(sql`ARRAY[]::text[]`), // winch, dolly, straps, etc.
  isAvailable: boolean("is_available").default(true),
  currentLocation: text("current_location"), // Last known GPS coordinates
  lastMaintenanceDate: timestamp("last_maintenance_date"),
  nextMaintenanceDate: timestamp("next_maintenance_date"),
  odometer: integer("odometer").default(0),
  photos: text("photos").array().default(sql`ARRAY[]::text[]`),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Wrecker Drivers table - Driver information
export const wreckerDrivers = pgTable("wrecker_drivers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  licenseNumber: text("license_number").notNull(),
  licenseExpiry: timestamp("license_expiry").notNull(),
  licenseVerified: boolean("license_verified").default(false),
  assignedTruckId: varchar("assigned_truck_id").references(() => towTrucks.id, { onDelete: "set null" }),
  isAvailable: boolean("is_available").default(true),
  currentLocation: text("current_location"), // GPS coordinates
  phone: text("phone").notNull(),
  emergencyContact: text("emergency_contact"),
  emergencyPhone: text("emergency_phone"),
  certifications: text("certifications").array().default(sql`ARRAY[]::text[]`), // CDL, etc.
  hireDate: timestamp("hire_date").notNull(),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Third Party Wreckers table - External towing companies
export const thirdPartyWreckers = pgTable("third_party_wreckers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyName: text("company_name").notNull(),
  contactName: text("contact_name").notNull(),
  phone: text("phone").notNull(),
  email: text("email"),
  address: text("address"),
  serviceArea: text("service_area").notNull(), // Geographic coverage area
  baseRate: decimal("base_rate", { precision: 10, scale: 2 }).notNull(),
  perMileRate: decimal("per_mile_rate", { precision: 10, scale: 2 }).notNull(),
  isPreferred: boolean("is_preferred").default(false),
  isActive: boolean("is_active").default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Tow Pricing Zones table - Geographic pricing zones
export const towPricingZones = pgTable("tow_pricing_zones", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  zoneName: text("zone_name").notNull(),
  zoneCode: text("zone_code").unique().notNull(), // e.g., "ZONE-A"
  description: text("description"),
  baseRate: decimal("base_rate", { precision: 10, scale: 2 }).notNull(), // Flat pickup fee
  perMileRate: decimal("per_mile_rate", { precision: 10, scale: 2 }).notNull(),
  afterHoursSurcharge: decimal("after_hours_surcharge", { precision: 10, scale: 2 }).default("0"), // 6pm-6am surcharge
  weekendSurcharge: decimal("weekend_surcharge", { precision: 10, scale: 2 }).default("0"),
  vehicleSizeMultipliers: jsonb("vehicle_size_multipliers").default(sql`'{"small": 1.0, "medium": 1.5, "large": 2.0, "oversized": 3.0}'::jsonb`),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Tow Requests table - Customer service requests
export const towRequests = pgTable("tow_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  requestNumber: text("request_number").unique().notNull(),
  customerId: varchar("customer_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  vehicleId: varchar("vehicle_id").references(() => vehicles.id, { onDelete: "set null" }),

  // Vehicle details (in case not in our system)
  vehicleMake: text("vehicle_make"),
  vehicleModel: text("vehicle_model"),
  vehicleYear: integer("vehicle_year"),
  vehicleColor: text("vehicle_color"),
  licensePlate: text("license_plate"),
  vehicleSize: vehicleSizeCategoryEnum("vehicle_size").notNull().default("medium"),

  // Location details
  pickupLocation: text("pickup_location").notNull(),
  pickupLatitude: decimal("pickup_latitude", { precision: 10, scale: 7 }),
  pickupLongitude: decimal("pickup_longitude", { precision: 10, scale: 7 }),
  dropoffLocation: text("dropoff_location").notNull(),
  dropoffLatitude: decimal("dropoff_latitude", { precision: 10, scale: 7 }),
  dropoffLongitude: decimal("dropoff_longitude", { precision: 10, scale: 7 }),

  // Service details
  status: towRequestStatusEnum("status").notNull().default("pending"),
  urgency: text("urgency").notNull().default("normal"), // emergency, normal, scheduled
  serviceType: text("service_type").notNull().default("tow"), // tow, jumpstart, tire_change, lockout, fuel_delivery
  problemDescription: text("problem_description"),
  specialInstructions: text("special_instructions"),
  photoPath: text("photo_path"), // Optional photo of the vehicle

  // Assignment
  wreckerType: wreckerTypeEnum("wrecker_type"),
  assignedDriverId: varchar("assigned_driver_id").references(() => wreckerDrivers.id, { onDelete: "set null" }),
  assignedTruckId: varchar("assigned_truck_id").references(() => towTrucks.id, { onDelete: "set null" }),
  thirdPartyWreckerId: varchar("third_party_wrecker_id").references(() => thirdPartyWreckers.id, { onDelete: "set null" }),

  // Timing
  requestedAt: timestamp("requested_at").notNull().defaultNow(),
  dispatchedAt: timestamp("dispatched_at"),
  arrivedAt: timestamp("arrived_at"),
  completedAt: timestamp("completed_at"),
  estimatedArrival: timestamp("estimated_arrival"),

  // Pricing
  estimatedDistance: decimal("estimated_distance", { precision: 10, scale: 2 }), // Miles
  actualDistance: decimal("actual_distance", { precision: 10, scale: 2 }),
  basePrice: decimal("base_price", { precision: 10, scale: 2 }),
  distanceCharge: decimal("distance_charge", { precision: 10, scale: 2 }),
  surcharges: decimal("surcharges", { precision: 10, scale: 2 }).default("0"),
  totalPrice: decimal("total_price", { precision: 10, scale: 2 }),
  customPriceAdjustment: decimal("custom_price_adjustment", { precision: 10, scale: 2 }).default("0"),
  priceNotes: text("price_notes"),

  // Integration
  jobCardId: varchar("job_card_id").references(() => jobCards.id, { onDelete: "set null" }), // Created when tow completes
  invoiceId: varchar("invoice_id").references(() => invoices.id, { onDelete: "set null" }),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Tow Request Locations table - GPS tracking history
export const towRequestLocations = pgTable("tow_request_locations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  towRequestId: varchar("tow_request_id").notNull().references(() => towRequests.id, { onDelete: "cascade" }),
  driverId: varchar("driver_id").notNull().references(() => wreckerDrivers.id, { onDelete: "cascade" }),
  latitude: decimal("latitude", { precision: 10, scale: 7 }).notNull(),
  longitude: decimal("longitude", { precision: 10, scale: 7 }).notNull(),
  speed: decimal("speed", { precision: 5, scale: 2 }), // mph
  heading: decimal("heading", { precision: 5, scale: 2 }), // Degrees
  accuracy: decimal("accuracy", { precision: 5, scale: 2 }), // Meters
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

// Tow Request Number Sequence table
export const towRequestSequence = pgTable("tow_request_sequence", {
  year: integer("year").primaryKey(),
  lastNumber: integer("last_number").notNull().default(0),
});

// ========================================
// TOWING SERVICE SCHEMAS & TYPES
// ========================================

// Tow Truck schemas
export const insertTowTruckSchema = createInsertSchema(towTrucks).omit({ id: true, createdAt: true, updatedAt: true });
export const updateTowTruckSchema = createInsertSchema(towTrucks).omit({ id: true, createdAt: true, updatedAt: true }).partial();

// Wrecker Driver schemas
export const insertWreckerDriverSchema = createInsertSchema(wreckerDrivers).omit({ id: true, createdAt: true, updatedAt: true });
export const updateWreckerDriverSchema = createInsertSchema(wreckerDrivers).omit({ id: true, createdAt: true, updatedAt: true }).partial();

// Chat Conversations table
export const chatConversations = pgTable("chat_conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: text("session_id").notNull(), // For anonymous users
  customerId: varchar("customer_id").references(() => users.id, { onDelete: "cascade" }), // Nullable for anonymous
  assignedStaffId: varchar("assigned_staff_id").references(() => users.id, { onDelete: "set null" }),
  status: text("status").notNull().default("active"), // active, resolved, abandoned
  authenticatedAt: timestamp("authenticated_at"), // When anonymous user signs in
  shareToken: text("share_token").unique(), // For shareable conversation links
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastMessageAt: timestamp("last_message_at").defaultNow().notNull(),
  closedAt: timestamp("closed_at"),

  // Contact center enhancements
  priority: chatPriorityEnum("priority").notNull().default("normal"),
  queuedAt: timestamp("queued_at"), // When chat entered queue
  firstResponseAt: timestamp("first_response_at"), // When staff sent first message
  averageResponseTime: decimal("average_response_time", { precision: 8, scale: 2 }), // Average seconds
  resolutionTime: decimal("resolution_time", { precision: 10, scale: 2 }), // Total seconds from start to close
  dispositionCode: text("disposition_code"), // resolved, no_response, spam, escalated, etc.
  dispositionNotes: text("disposition_notes"), // Agent notes on closure
  closedBy: varchar("closed_by").references(() => users.id, { onDelete: "set null" }), // Who closed it
  tags: text("tags").array().default(sql`ARRAY[]::text[]`), // billing, technical, complaint, etc.
  assignmentMethod: text("assignment_method"), // How it was assigned: auto_round_robin, auto_least_busy, manual, etc.
});

// Chat Messages table
export const chatMessages = pgTable("chat_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").notNull().references(() => chatConversations.id, { onDelete: "cascade" }),
  senderId: text("sender_id").notNull(), // Can be userId or sessionId
  senderType: text("sender_type").notNull(), // 'customer' or 'staff' or 'system'
  senderName: text("sender_name"), // Display name, especially for anonymous users
  message: text("message").notNull(),
  attachments: text("attachments").array().default(sql`ARRAY[]::text[]`),
  attachmentMetadata: jsonb("attachment_metadata"), // Store file info: [{type, name, size, url}]
  replyToMessageId: varchar("reply_to_message_id").references((): any => chatMessages.id, { onDelete: "set null" }),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),

  // Contact center enhancements
  responseTime: integer("response_time"), // Seconds from previous customer message (for staff messages only)
});

// Chat Assignments History table (for tracking who handled what)
export const chatAssignments = pgTable("chat_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").notNull().references(() => chatConversations.id, { onDelete: "cascade" }),
  staffId: varchar("staff_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  assignedAt: timestamp("assigned_at").defaultNow().notNull(),
  unassignedAt: timestamp("unassigned_at"),
  notes: text("notes"),
});

// Chat Quick Responses table (for staff to use)
export const chatQuickResponses = pgTable("chat_quick_responses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  category: text("category").notNull(), // greeting, pricing, hours, etc.
  title: text("title").notNull(),
  message: text("message").notNull(),
  createdBy: varchar("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Chat Agent Status table - Track agent availability and capacity
export const chatAgentStatus = pgTable("chat_agent_status", {
  userId: varchar("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  status: agentStatusEnum("status").notNull().default("offline"),
  maxConcurrentChats: integer("max_concurrent_chats").notNull().default(3),
  currentChatCount: integer("current_chat_count").notNull().default(0),
  lastActivityAt: timestamp("last_activity_at").defaultNow().notNull(),
  lastStatusChangeAt: timestamp("last_status_change_at").defaultNow().notNull(),
  statusChangedBy: varchar("status_changed_by"), // userId of who changed it (self or supervisor)
});

// Chat Routing Settings table - Configure how chats are assigned
export const chatRoutingSettings = pgTable("chat_routing_settings", {
  id: integer("id").primaryKey().default(1), // Single row config
  assignmentMethod: chatAssignmentMethodEnum("assignment_method").notNull().default("least_busy"),
  autoAssignEnabled: boolean("auto_assign_enabled").notNull().default(true),
  returnCustomerRouting: boolean("return_customer_routing").notNull().default(true), // Route returning customers to previous agent
  maxWaitTimeMinutes: integer("max_wait_time_minutes").notNull().default(5), // Alert if chat waits this long
  roundRobinIndex: integer("round_robin_index").notNull().default(0), // Track position for round-robin
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Chat Ratings table - Customer satisfaction ratings (CSAT)
export const chatRatings = pgTable("chat_ratings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").notNull().references(() => chatConversations.id, { onDelete: "cascade" }),
  customerId: varchar("customer_id").references(() => users.id, { onDelete: "set null" }),
  staffId: varchar("staff_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  rating: integer("rating").notNull(), // 1-5 stars
  comment: text("comment"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_chat_ratings_conversation").on(table.conversationId),
  index("idx_chat_ratings_staff").on(table.staffId),
]);

// Third Party Wrecker schemas
export const insertThirdPartyWreckerSchema = createInsertSchema(thirdPartyWreckers).omit({ id: true, createdAt: true });
export const updateThirdPartyWreckerSchema = createInsertSchema(thirdPartyWreckers).omit({ id: true, createdAt: true }).partial();

// Tow Pricing Zone schemas
export const insertTowPricingZoneSchema = createInsertSchema(towPricingZones).omit({ id: true, createdAt: true, updatedAt: true });
export const updateTowPricingZoneSchema = createInsertSchema(towPricingZones).omit({ id: true, createdAt: true, updatedAt: true }).partial();

// Tow Request schemas
export const insertTowRequestSchema = createInsertSchema(towRequests).omit({ id: true, createdAt: true, updatedAt: true });
export const updateTowRequestSchema = z.object({
  status: z.enum(["pending", "dispatched", "en_route", "arrived", "towing", "completed", "cancelled"]).optional(),
  assignedDriverId: z.string().optional().nullable(),
  assignedTruckId: z.string().optional().nullable(),
  thirdPartyWreckerId: z.string().optional().nullable(),
  wreckerType: z.enum(["company_owned", "third_party"]).optional(),
  dispatchedAt: z.date().optional().nullable(),
  arrivedAt: z.date().optional().nullable(),
  completedAt: z.date().optional().nullable(),
  estimatedArrival: z.date().optional().nullable(),
  actualDistance: z.string().optional(),
  totalPrice: z.string().optional(),
  customPriceAdjustment: z.string().optional(),
  priceNotes: z.string().optional(),
  jobCardId: z.string().optional().nullable(),
  invoiceId: z.string().optional().nullable(),
});

// Tow Request Location schemas
export const insertTowRequestLocationSchema = createInsertSchema(towRequestLocations).omit({ id: true });

// Chat schemas
export const insertChatConversationSchema = createInsertSchema(chatConversations).omit({ id: true, createdAt: true, lastMessageAt: true });
export const updateChatConversationSchema = createInsertSchema(chatConversations).omit({ id: true, createdAt: true }).partial();

export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({ id: true, createdAt: true });
export const updateChatMessageSchema = createInsertSchema(chatMessages).omit({ id: true, createdAt: true }).partial();

export const insertChatAssignmentSchema = createInsertSchema(chatAssignments).omit({ id: true, assignedAt: true });
export const updateChatAssignmentSchema = createInsertSchema(chatAssignments).omit({ id: true, assignedAt: true }).partial();

export const insertChatQuickResponseSchema = createInsertSchema(chatQuickResponses).omit({ id: true, createdAt: true, updatedAt: true });
export const updateChatQuickResponseSchema = createInsertSchema(chatQuickResponses).omit({ id: true, createdAt: true, updatedAt: true }).partial();

export const insertChatAgentStatusSchema = createInsertSchema(chatAgentStatus).omit({ lastActivityAt: true, lastStatusChangeAt: true });
export const updateChatAgentStatusSchema = createInsertSchema(chatAgentStatus).partial();

export const insertChatRoutingSettingsSchema = createInsertSchema(chatRoutingSettings).omit({ id: true, updatedAt: true });
export const updateChatRoutingSettingsSchema = createInsertSchema(chatRoutingSettings).omit({ id: true, updatedAt: true }).partial();

export const insertChatRatingSchema = createInsertSchema(chatRatings).omit({ id: true, createdAt: true });
export const updateChatRatingSchema = createInsertSchema(chatRatings).omit({ id: true, createdAt: true }).partial();

// TypeScript types
export type InsertTowTruck = z.infer<typeof insertTowTruckSchema>;
export type TowTruck = typeof towTrucks.$inferSelect;

export type InsertWreckerDriver = z.infer<typeof insertWreckerDriverSchema>;
export type WreckerDriver = typeof wreckerDrivers.$inferSelect;

export type InsertThirdPartyWrecker = z.infer<typeof insertThirdPartyWreckerSchema>;
export type ThirdPartyWrecker = typeof thirdPartyWreckers.$inferSelect;

export type InsertTowPricingZone = z.infer<typeof insertTowPricingZoneSchema>;
export type TowPricingZone = typeof towPricingZones.$inferSelect;

export type InsertTowRequest = z.infer<typeof insertTowRequestSchema>;
export type TowRequest = typeof towRequests.$inferSelect;

export type InsertTowRequestLocation = z.infer<typeof insertTowRequestLocationSchema>;
export type TowRequestLocation = typeof towRequestLocations.$inferSelect;

export type InsertChatConversation = z.infer<typeof insertChatConversationSchema>;
export type ChatConversation = typeof chatConversations.$inferSelect;

export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessages.$inferSelect;

export type InsertChatAssignment = z.infer<typeof insertChatAssignmentSchema>;
export type ChatAssignment = typeof chatAssignments.$inferSelect;

export type InsertChatQuickResponse = z.infer<typeof insertChatQuickResponseSchema>;
export type ChatQuickResponse = typeof chatQuickResponses.$inferSelect;

export type InsertChatAgentStatus = z.infer<typeof insertChatAgentStatusSchema>;
export type ChatAgentStatus = typeof chatAgentStatus.$inferSelect;

export type InsertChatRoutingSettings = z.infer<typeof insertChatRoutingSettingsSchema>;
export type ChatRoutingSettings = typeof chatRoutingSettings.$inferSelect;

export type InsertChatRating = z.infer<typeof insertChatRatingSchema>;
export type ChatRating = typeof chatRatings.$inferSelect;

// ========================================
// SERVICE REMINDER SYSTEM TABLES
// ========================================

// Service Reminder Enums
export const reminderTypeEnum = pgEnum("reminder_type", ["appointment", "maintenance", "custom"]);
export const reminderStatusEnum = pgEnum("reminder_status", ["active", "paused", "completed"]);
export const maintenanceServiceTypeEnum = pgEnum("maintenance_service_type", [
  "oil_change",
  "tire_rotation",
  "brake_inspection",
  "air_filter",
  "transmission_service",
  "coolant_flush",
  "spark_plugs",
  "battery_check",
  "alignment",
  "inspection",
  "custom"
]);

// Service Reminders table - Reminder rule configurations
export const serviceReminders = pgTable("service_reminders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(), // e.g., "Appointment Reminder - 24h", "Oil Change - 3 months"
  type: reminderTypeEnum("type").notNull(),
  status: reminderStatusEnum("status").notNull().default("active"),

  // Filters (null = applies to all)
  customerId: varchar("customer_id").references(() => users.id, { onDelete: "cascade" }),
  vehicleId: varchar("vehicle_id").references(() => vehicles.id, { onDelete: "cascade" }),

  // Appointment reminder config
  appointmentLeadTimeDays: integer("appointment_lead_time_days"), // Days before appointment

  // Maintenance reminder config
  maintenanceServiceType: maintenanceServiceTypeEnum("maintenance_service_type"),
  intervalMonths: integer("interval_months"), // Time-based interval
  intervalMiles: integer("interval_miles"), // Mileage-based interval

  // Custom reminder config
  scheduledDate: timestamp("scheduled_date"), // For one-time custom reminders

  // Email template
  emailSubject: text("email_subject").notNull(),
  emailBody: text("email_body").notNull(), // HTML content

  // Metadata
  isRecurring: boolean("is_recurring").default(true),
  lastProcessedAt: timestamp("last_processed_at"),
  createdBy: varchar("created_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Service Reminder History table - Log of sent reminders
export const serviceReminderHistory = pgTable("service_reminder_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  reminderId: varchar("reminder_id").notNull().references(() => serviceReminders.id, { onDelete: "cascade" }),
  customerId: varchar("customer_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  vehicleId: varchar("vehicle_id").references(() => vehicles.id, { onDelete: "set null" }),
  appointmentId: varchar("appointment_id").references(() => appointments.id, { onDelete: "set null" }),

  reminderType: reminderTypeEnum("reminder_type").notNull(),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
  status: text("status").notNull().default("sent"), // sent, failed, bounced
  errorMessage: text("error_message"),

  // Next scheduled reminder (for recurring)
  nextReminderDate: timestamp("next_reminder_date"),

  emailSubject: text("email_subject").notNull(),
  emailBody: text("email_body").notNull(),
});

// Maintenance Schedules table - Track vehicle maintenance history and schedules
export const maintenanceSchedules = pgTable("maintenance_schedules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vehicleId: varchar("vehicle_id").notNull().references(() => vehicles.id, { onDelete: "cascade" }),
  serviceType: maintenanceServiceTypeEnum("service_type").notNull(),

  // Last service info
  lastServiceDate: timestamp("last_service_date"),
  lastServiceMileage: integer("last_service_mileage"),
  lastServiceJobCardId: varchar("last_service_job_card_id").references(() => jobCards.id, { onDelete: "set null" }),

  // Next service due
  nextServiceDueDate: timestamp("next_service_due_date"),
  nextMileageDue: integer("next_mileage_due"),

  // Intervals
  intervalMonths: integer("interval_months").default(3), // Default: 3 months
  intervalMiles: integer("interval_miles").default(3000), // Default: 3000 miles

  // Status
  isActive: boolean("is_active").default(true),
  notes: text("notes"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Service Reminder schemas
export const insertServiceReminderSchema = createInsertSchema(serviceReminders).omit({ id: true, createdAt: true, updatedAt: true });
export const updateServiceReminderSchema = createInsertSchema(serviceReminders).omit({ id: true, createdAt: true, updatedAt: true }).partial();

export const insertServiceReminderHistorySchema = createInsertSchema(serviceReminderHistory).omit({ id: true });

export const insertMaintenanceScheduleSchema = createInsertSchema(maintenanceSchedules).omit({ id: true, createdAt: true, updatedAt: true });
export const updateMaintenanceScheduleSchema = createInsertSchema(maintenanceSchedules).omit({ id: true, createdAt: true, updatedAt: true }).partial();

// TypeScript types
export type InsertServiceReminder = z.infer<typeof insertServiceReminderSchema>;
export type ServiceReminder = typeof serviceReminders.$inferSelect;

export type InsertServiceReminderHistory = z.infer<typeof insertServiceReminderHistorySchema>;
export type ServiceReminderHistory = typeof serviceReminderHistory.$inferSelect;

export type InsertMaintenanceSchedule = z.infer<typeof insertMaintenanceScheduleSchema>;
export type MaintenanceSchedule = typeof maintenanceSchedules.$inferSelect;

// ========================================
// CHAT SETTINGS TABLE
// ========================================

// Chat Settings table - Business hours configuration
export const chatSettings = pgTable("chat_settings", {
  id: integer("id").primaryKey().default(1), // Single row config
  isEnabled: boolean("is_enabled").default(false).notNull(), // Enable/disable business hours checking
  closedMessage: text("closed_message").default(
    "Thank you for contacting us! We're currently closed. Our support team will respond to your message when we're back online."
  ).notNull(),

  // Monday
  mondayEnabled: boolean("monday_enabled").default(true).notNull(),
  mondayOpenTime: text("monday_open_time").default("09:00").notNull(),
  mondayCloseTime: text("monday_close_time").default("17:00").notNull(),

  // Tuesday
  tuesdayEnabled: boolean("tuesday_enabled").default(true).notNull(),
  tuesdayOpenTime: text("tuesday_open_time").default("09:00").notNull(),
  tuesdayCloseTime: text("tuesday_close_time").default("17:00").notNull(),

  // Wednesday
  wednesdayEnabled: boolean("wednesday_enabled").default(true).notNull(),
  wednesdayOpenTime: text("wednesday_open_time").default("09:00").notNull(),
  wednesdayCloseTime: text("wednesday_close_time").default("17:00").notNull(),

  // Thursday
  thursdayEnabled: boolean("thursday_enabled").default(true).notNull(),
  thursdayOpenTime: text("thursday_open_time").default("09:00").notNull(),
  thursdayCloseTime: text("thursday_close_time").default("17:00").notNull(),

  // Friday
  fridayEnabled: boolean("friday_enabled").default(true).notNull(),
  fridayOpenTime: text("friday_open_time").default("09:00").notNull(),
  fridayCloseTime: text("friday_close_time").default("17:00").notNull(),

  // Saturday
  saturdayEnabled: boolean("saturday_enabled").default(false).notNull(),
  saturdayOpenTime: text("saturday_open_time").default("10:00").notNull(),
  saturdayCloseTime: text("saturday_close_time").default("14:00").notNull(),

  // Sunday
  sundayEnabled: boolean("sunday_enabled").default(false).notNull(),
  sundayOpenTime: text("sunday_open_time").default("10:00").notNull(),
  sundayCloseTime: text("sunday_close_time").default("14:00").notNull(),

  timezone: text("timezone").default("America/New_York").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Appointment Settings table - Appointment booking configuration
export const appointmentSettings = pgTable("appointment_settings", {
  id: integer("id").primaryKey().default(1), // Single row config

  // Business Hours for Appointments (separate from chat hours)
  mondayEnabled: boolean("monday_enabled").default(true).notNull(),
  mondayOpenTime: text("monday_open_time").default("08:00").notNull(),
  mondayCloseTime: text("monday_close_time").default("17:00").notNull(),

  tuesdayEnabled: boolean("tuesday_enabled").default(true).notNull(),
  tuesdayOpenTime: text("tuesday_open_time").default("08:00").notNull(),
  tuesdayCloseTime: text("tuesday_close_time").default("17:00").notNull(),

  wednesdayEnabled: boolean("wednesday_enabled").default(true).notNull(),
  wednesdayOpenTime: text("wednesday_open_time").default("08:00").notNull(),
  wednesdayCloseTime: text("wednesday_close_time").default("17:00").notNull(),

  thursdayEnabled: boolean("thursday_enabled").default(true).notNull(),
  thursdayOpenTime: text("thursday_open_time").default("08:00").notNull(),
  thursdayCloseTime: text("thursday_close_time").default("17:00").notNull(),

  fridayEnabled: boolean("friday_enabled").default(true).notNull(),
  fridayOpenTime: text("friday_open_time").default("08:00").notNull(),
  fridayCloseTime: text("friday_close_time").default("17:00").notNull(),

  saturdayEnabled: boolean("saturday_enabled").default(false).notNull(),
  saturdayOpenTime: text("saturday_open_time").default("09:00").notNull(),
  saturdayCloseTime: text("saturday_close_time").default("13:00").notNull(),

  sundayEnabled: boolean("sunday_enabled").default(false).notNull(),
  sundayOpenTime: text("sunday_open_time").default("10:00").notNull(),
  sundayCloseTime: text("sunday_close_time").default("13:00").notNull(),

  // Appointment Configuration
  defaultDurationMinutes: integer("default_duration_minutes").default(60).notNull(),
  bufferTimeMinutes: integer("buffer_time_minutes").default(15).notNull(),
  maxAdvanceBookingDays: integer("max_advance_booking_days").default(30).notNull(),

  // Policy Text (informational only - not enforced)
  cancellationPolicyText: text("cancellation_policy_text").default(
    "Appointments can be cancelled or rescheduled at any time by contacting our service team."
  ),
  reschedulingPolicyText: text("rescheduling_policy_text").default(
    "You can reschedule your appointment by contacting us or submitting a reschedule request through your customer portal."
  ),

  // Email Reminder Configuration
  emailReminder24Hours: boolean("email_reminder_24_hours").default(true).notNull(),
  emailReminder48Hours: boolean("email_reminder_48_hours").default(true).notNull(),
  emailReminder1Week: boolean("email_reminder_1_week").default(false).notNull(),

  // SMS Reminder Configuration (placeholders for future implementation)
  smsReminderEnabled: boolean("sms_reminder_enabled").default(false).notNull(), // Master toggle
  smsReminder24Hours: boolean("sms_reminder_24_hours").default(false).notNull(),
  smsReminder48Hours: boolean("sms_reminder_48_hours").default(false).notNull(),

  // Auto-Approval Configuration (multiple criteria)
  defaultRequiresApproval: boolean("default_requires_approval").default(true).notNull(),
  autoApproveReturningCustomers: boolean("auto_approve_returning_customers").default(false).notNull(),

  timezone: text("timezone").default("America/Jamaica").notNull(),

  // Remote Appointment Geographic Restrictions
  allowedRemoteParishes: text("allowed_remote_parishes").array().default(sql`ARRAY[]::text[]`), // Empty array = all parishes allowed
  restrictedAreas: jsonb("restricted_areas").default(sql`'[]'::jsonb`), // Array of GeoJSON polygon features

  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Chat Settings schemas
export const insertChatSettingsSchema = createInsertSchema(chatSettings).omit({ id: true, updatedAt: true });
export const updateChatSettingsSchema = createInsertSchema(chatSettings).omit({ id: true, updatedAt: true }).partial();

// Appointment Settings schemas
export const insertAppointmentSettingsSchema = createInsertSchema(appointmentSettings).omit({ id: true, updatedAt: true });
export const updateAppointmentSettingsSchema = createInsertSchema(appointmentSettings).omit({ id: true, updatedAt: true }).partial();

// TypeScript types
export type InsertChatSettings = z.infer<typeof insertChatSettingsSchema>;
export type ChatSettings = typeof chatSettings.$inferSelect;
export type InsertAppointmentSettings = z.infer<typeof insertAppointmentSettingsSchema>;
export type AppointmentSettings = typeof appointmentSettings.$inferSelect;

// ========================================
// ACCOUNTING & EXPENSE TRACKING TABLES
// ========================================

// Expense Category Enum
export const expenseCategoryEnum = pgEnum("expense_category", [
  "parts_inventory",       // Parts purchases for inventory
  "rental_operations",     // Rental vehicle maintenance, insurance, etc.
  "towing_operations",     // Towing fuel, maintenance, third party costs
  "labor_costs",           // Staff wages, benefits
  "utilities",             // Electric, water, internet
  "rent_lease",            // Facility rent or lease payments
  "insurance",             // Business insurance
  "marketing",             // Advertising, campaigns
  "office_supplies",       // Administrative supplies
  "equipment",             // Tools, machinery
  "professional_services", // Legal, accounting fees
  "other"                  // Miscellaneous expenses
]);

// Service Type Enum for revenue categorization
export const serviceTypeEnum = pgEnum("service_type_revenue", [
  "parts_sales",           // Revenue from parts sold
  "repair_services",       // Revenue from job cards/labor
  "rental_services",       // Revenue from vehicle rentals
  "towing_services",       // Revenue from towing operations
  "inspection_services",   // Revenue from inspections
  "other_services"         // Other revenue
]);

// Expenses table - Track all business expenses
export const expenses = pgTable("expenses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  expenseNumber: text("expense_number").unique().notNull(), // EXP-YYYY-####
  category: expenseCategoryEnum("category").notNull(),
  serviceType: serviceTypeEnum("service_type"), // Link expense to revenue stream (nullable)
  description: text("description").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  expenseDate: timestamp("expense_date").notNull().defaultNow(),
  paymentMethod: paymentMethodEnum("payment_method").notNull(),
  vendor: text("vendor"), // Supplier/vendor name
  invoiceReference: text("invoice_reference"), // Vendor invoice number
  receiptUrl: text("receipt_url"), // Stored receipt image/PDF
  notes: text("notes"),
  // Optional links to related records
  partId: varchar("part_id").references(() => partsInventory.id, { onDelete: "set null" }),
  rentalVehicleId: varchar("rental_vehicle_id").references(() => rentalVehicles.id, { onDelete: "set null" }),
  towTruckId: varchar("tow_truck_id").references(() => towTrucks.id, { onDelete: "set null" }),
  recordedBy: varchar("recorded_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_expenses_category").on(table.category),
  index("idx_expenses_service_type").on(table.serviceType),
  index("idx_expenses_expense_date").on(table.expenseDate),
  index("idx_expenses_expense_number").on(table.expenseNumber),
]);

// Expense Number Sequence table (for atomic counter)
export const expenseNumberSequence = pgTable("expense_number_sequence", {
  year: integer("year").primaryKey(),
  lastNumber: integer("last_number").notNull().default(0),
});

// ========================================
// VENDOR MANAGEMENT (AP - Accounts Payable)
// ========================================

// Vendors table - Companies/people we buy from
export const vendors = pgTable("vendors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vendorNumber: text("vendor_number").unique().notNull(), // VEN-####
  vendorName: text("vendor_name").notNull(),
  contactPerson: text("contact_person"),
  email: text("email"),
  phone: text("phone"),
  fax: text("fax"),
  website: text("website"),

  // Address
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  city: text("city"),
  state: text("state"),
  postalCode: text("postal_code"),
  country: text("country").default("Jamaica"),

  // Business details
  taxId: text("tax_id"), // TRN or EIN
  accountNumber: text("account_number"), // Our account number with this vendor

  // Payment terms
  paymentTerms: text("payment_terms").default("Net 30"), // Net 30, Net 60, Due on Receipt, etc.
  creditLimit: decimal("credit_limit", { precision: 10, scale: 2 }),

  // Banking details (for payments)
  bankName: text("bank_name"),
  bankAccountNumber: text("bank_account_number"),
  bankRoutingNumber: text("bank_routing_number"),

  // Status
  isActive: boolean("is_active").default(true).notNull(),

  // Notes
  notes: text("notes"),

  // QuickBooks integration
  quickbooksId: text("quickbooks_id"), // QuickBooks Vendor ID for sync

  createdBy: varchar("created_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_vendors_vendor_number").on(table.vendorNumber),
  index("idx_vendors_vendor_name").on(table.vendorName),
  index("idx_vendors_is_active").on(table.isActive),
]);

// Vendor Number Sequence table (for atomic counter)
export const vendorNumberSequence = pgTable("vendor_number_sequence", {
  id: integer("id").primaryKey().default(1),
  lastNumber: integer("last_number").notNull().default(0),
});

// Vendor Bills table - Bills/invoices from vendors (AP)
export const vendorBills = pgTable("vendor_bills", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  billNumber: text("bill_number").unique().notNull(), // BILL-YYYY-####
  vendorId: varchar("vendor_id").notNull().references(() => vendors.id, { onDelete: "cascade" }),
  vendorInvoiceNumber: text("vendor_invoice_number"), // Vendor's invoice number

  // Amounts
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull(),
  tax: decimal("tax", { precision: 10, scale: 2 }).default("0").notNull(),
  total: decimal("total", { precision: 10, scale: 2 }).notNull(),
  amountPaid: decimal("amount_paid", { precision: 10, scale: 2 }).default("0").notNull(),

  // Dates
  billDate: timestamp("bill_date").notNull(),
  dueDate: timestamp("due_date"),

  // Status
  status: text("status").notNull().default("unpaid"), // unpaid, partially_paid, paid, overdue

  // Categories
  category: expenseCategoryEnum("category").notNull(),
  description: text("description"),
  notes: text("notes"),

  // Attachments
  receiptUrl: text("receipt_url"), // Stored bill/receipt image/PDF

  // QuickBooks integration
  quickbooksId: text("quickbooks_id"), // QuickBooks Bill ID for sync

  recordedBy: varchar("recorded_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_vendor_bills_vendor_id").on(table.vendorId),
  index("idx_vendor_bills_bill_number").on(table.billNumber),
  index("idx_vendor_bills_status").on(table.status),
  index("idx_vendor_bills_due_date").on(table.dueDate),
]);

// Vendor Bill Number Sequence table (for atomic counter)
export const vendorBillNumberSequence = pgTable("vendor_bill_number_sequence", {
  year: integer("year").primaryKey(),
  lastNumber: integer("last_number").notNull().default(0),
});

// Vendor Bill Line Items table
export const vendorBillLineItems = pgTable("vendor_bill_line_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  billId: varchar("bill_id").notNull().references(() => vendorBills.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  quantity: integer("quantity").default(1).notNull(),
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }).notNull(),
  total: decimal("total", { precision: 10, scale: 2 }).notNull(),

  // Optional link to parts inventory
  partId: varchar("part_id").references(() => partsInventory.id, { onDelete: "set null" }),

  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_vendor_bill_line_items_bill_id").on(table.billId),
]);

// Vendor Payments table - Payments made to vendors
export const vendorPayments = pgTable("vendor_payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  paymentNumber: text("payment_number").unique().notNull(), // VPM-YYYY-####
  vendorId: varchar("vendor_id").notNull().references(() => vendors.id, { onDelete: "cascade" }),
  billId: varchar("bill_id").references(() => vendorBills.id, { onDelete: "set null" }), // Optional link to specific bill

  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  paymentMethod: paymentMethodEnum("payment_method").notNull(),
  paymentDate: timestamp("payment_date").notNull().defaultNow(),

  // Reference numbers
  checkNumber: text("check_number"), // If paid by check
  transactionId: text("transaction_id"), // Bank transaction ID

  notes: text("notes"),

  // QuickBooks integration
  quickbooksId: text("quickbooks_id"), // QuickBooks VendorPayment ID for sync

  recordedBy: varchar("recorded_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_vendor_payments_vendor_id").on(table.vendorId),
  index("idx_vendor_payments_bill_id").on(table.billId),
  index("idx_vendor_payments_payment_number").on(table.paymentNumber),
]);

// Vendor Payment Number Sequence table (for atomic counter)
export const vendorPaymentNumberSequence = pgTable("vendor_payment_number_sequence", {
  year: integer("year").primaryKey(),
  lastNumber: integer("last_number").notNull().default(0),
});

// ========================================
// PAYMENT GATEWAY INTEGRATION SETTINGS
// ========================================

// Payment Gateway Settings - Configuration for payment processors
export const paymentGatewaySettings = pgTable("payment_gateway_settings", {
  id: integer("id").primaryKey().default(1), // Single row config

  // First Atlantic Configuration
  firstAtlanticEnabled: boolean("first_atlantic_enabled").default(false).notNull(),
  firstAtlanticTestMode: boolean("first_atlantic_test_mode").default(true).notNull(),
  firstAtlanticMerchantId: text("first_atlantic_merchant_id"),
  firstAtlanticMerchantPassword: text("first_atlantic_merchant_password"), // Encrypted
  firstAtlanticPageSetId: text("first_atlantic_page_set_id"),
  firstAtlanticCurrency: text("first_atlantic_currency").default("USD"),
  firstAtlanticProductionUrl: text("first_atlantic_production_url").default("https://ecm.firstatlantic.com/sentry/PaymentForm"),
  firstAtlanticTestUrl: text("first_atlantic_test_url").default("https://ecm.firstat.com/sentry/PaymentForm"),

  // Stripe Configuration (for future use)
  stripeEnabled: boolean("stripe_enabled").default(false).notNull(),
  stripeTestMode: boolean("stripe_test_mode").default(true).notNull(),
  stripePublishableKey: text("stripe_publishable_key"),
  stripeSecretKey: text("stripe_secret_key"), // Encrypted

  // PayPal Configuration (for future use)
  paypalEnabled: boolean("paypal_enabled").default(false).notNull(),
  paypalTestMode: boolean("paypal_test_mode").default(true).notNull(),
  paypalClientId: text("paypal_client_id"),
  paypalSecret: text("paypal_secret"), // Encrypted

  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Customer Payment Methods - Saved payment methods for online payments
export const customerPaymentMethods = pgTable("customer_payment_methods", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  customerId: varchar("customer_id").notNull().references(() => users.id, { onDelete: "cascade" }),

  // Payment method type (stripe, first_atlantic, paypal)
  provider: text("provider").notNull(), // 'stripe', 'first_atlantic', 'paypal'

  // Tokenized payment method identifiers (never store actual card numbers)
  providerPaymentMethodId: text("provider_payment_method_id").notNull(), // e.g., Stripe pm_xxx or First Atlantic token

  // Display information (for customer UI)
  cardBrand: text("card_brand"), // e.g., 'visa', 'mastercard', 'amex'
  cardLast4: text("card_last4"), // Last 4 digits
  cardExpMonth: integer("card_exp_month"),
  cardExpYear: integer("card_exp_year"),

  // Payment method metadata
  isDefault: boolean("is_default").default(false).notNull(),
  isActive: boolean("is_active").default(true).notNull(),

  // Billing details
  billingName: text("billing_name"),
  billingEmail: text("billing_email"),
  billingAddress: text("billing_address"),
  billingCity: text("billing_city"),
  billingState: text("billing_state"),
  billingZip: text("billing_zip"),
  billingCountry: text("billing_country").default("US"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_customer_payment_methods_customer_id").on(table.customerId),
  index("idx_customer_payment_methods_provider").on(table.provider),
]);

// Online Payment Transactions - Track all online payment attempts
export const onlinePaymentTransactions = pgTable("online_payment_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  customerId: varchar("customer_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  invoiceId: varchar("invoice_id").references(() => invoices.id, { onDelete: "set null" }),

  // Payment provider details
  provider: text("provider").notNull(), // 'stripe', 'first_atlantic', 'paypal'
  providerTransactionId: text("provider_transaction_id"), // Provider's transaction/intent ID
  providerPaymentMethodId: text("provider_payment_method_id"), // Payment method used

  // Transaction details
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").default("USD").notNull(),
  status: text("status").notNull(), // 'pending', 'processing', 'succeeded', 'failed', 'cancelled', 'refunded'

  // Error handling
  errorCode: text("error_code"),
  errorMessage: text("error_message"),

  // Payment receipt info
  receiptUrl: text("receipt_url"), // Provider receipt URL
  receiptNumber: text("receipt_number"), // Our internal receipt number

  // Metadata
  metadata: jsonb("metadata"), // Additional provider-specific data
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),

  // Linked to payments table when successful
  paymentId: varchar("payment_id").references(() => payments.id, { onDelete: "set null" }),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_online_payment_transactions_customer_id").on(table.customerId),
  index("idx_online_payment_transactions_invoice_id").on(table.invoiceId),
  index("idx_online_payment_transactions_provider").on(table.provider),
  index("idx_online_payment_transactions_status").on(table.status),
  index("idx_online_payment_transactions_payment_id").on(table.paymentId),
]);

// QuickBooks Integration Settings
export const quickbooksSettings = pgTable("quickbooks_settings", {
  id: integer("id").primaryKey().default(1), // Single row config

  enabled: boolean("enabled").default(false).notNull(),
  testMode: boolean("test_mode").default(true).notNull(),

  // OAuth credentials
  clientId: text("client_id"),
  clientSecret: text("client_secret"), // Encrypted
  realmId: text("realm_id"), // QuickBooks Company ID

  // OAuth tokens (encrypted)
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at"),

  // Sync settings
  autoSyncEnabled: boolean("auto_sync_enabled").default(false).notNull(),
  syncFrequency: text("sync_frequency").default("daily"), // hourly, daily, weekly
  lastSyncAt: timestamp("last_sync_at"),
  lastSyncStatus: text("last_sync_status"), // success, error, in_progress
  lastSyncError: text("last_sync_error"),

  // Mapping settings
  syncInvoices: boolean("sync_invoices").default(true).notNull(),
  syncPayments: boolean("sync_payments").default(true).notNull(),
  syncExpenses: boolean("sync_expenses").default(true).notNull(),
  syncCustomers: boolean("sync_customers").default(true).notNull(),
  syncVendors: boolean("sync_vendors").default(true).notNull(),

  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Payment Transactions table - Track all online payment attempts
export const paymentTransactions = pgTable("payment_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceId: varchar("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  customerId: varchar("customer_id").references(() => users.id, { onDelete: "set null" }),

  // Payment details
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").default("USD").notNull(),

  // Gateway information
  gateway: text("gateway").notNull(), // first_atlantic, stripe, paypal
  gatewayTransactionId: text("gateway_transaction_id"), // Transaction ID from payment gateway
  gatewayOrderId: text("gateway_order_id"), // Order ID sent to gateway

  // Status tracking
  status: text("status").notNull().default("pending"), // pending, processing, completed, failed, cancelled
  errorMessage: text("error_message"),

  // Gateway response data (store raw response for debugging)
  gatewayResponse: jsonb("gateway_response"),

  // Customer information
  customerEmail: text("customer_email"),
  customerName: text("customer_name"),

  // Payment method details (last 4 digits, card type, etc.)
  paymentMethodDetails: jsonb("payment_method_details"),

  // Timestamps
  initiatedAt: timestamp("initiated_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_payment_transactions_invoice_id").on(table.invoiceId),
  index("idx_payment_transactions_customer_id").on(table.customerId),
  index("idx_payment_transactions_status").on(table.status),
  index("idx_payment_transactions_gateway_transaction_id").on(table.gatewayTransactionId),
]);

// ========================================
// LATE PAYMENT FEES
// ========================================

// Late Fee Settings - Configuration for automated late fee calculation
export const lateFeeSettings = pgTable("late_fee_settings", {
  id: integer("id").primaryKey().default(1), // Single row config

  enabled: boolean("enabled").default(false).notNull(),

  // Fee calculation method
  feeType: text("fee_type").notNull().default("percentage"), // percentage or fixed
  feeAmount: decimal("fee_amount", { precision: 10, scale: 2 }).notNull().default("25.00"), // $25 or 2.5% depending on type
  feePercentage: decimal("fee_percentage", { precision: 5, scale: 2 }).notNull().default("2.50"), // Used if feeType is 'percentage'

  // When to apply late fees
  gracePeriodDays: integer("grace_period_days").default(7).notNull(), // Days after due date before applying fee
  applyRecurring: boolean("apply_recurring").default(false).notNull(), // Apply fee every month
  recurringIntervalDays: integer("recurring_interval_days").default(30), // Days between recurring fees

  // Fee caps
  maxFeeAmount: decimal("max_fee_amount", { precision: 10, scale: 2 }), // Maximum fee per invoice
  maxFeePercentage: decimal("max_fee_percentage", { precision: 5, scale: 2 }), // Maximum fee as % of invoice total

  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Late Fees Log - Track late fees applied to invoices
export const lateFees = pgTable("late_fees", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceId: varchar("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  customerId: varchar("customer_id").notNull().references(() => users.id, { onDelete: "cascade" }),

  // Fee details
  feeAmount: decimal("fee_amount", { precision: 10, scale: 2 }).notNull(),
  feeType: text("fee_type").notNull(), // percentage or fixed
  calculationBasis: text("calculation_basis"), // For percentage: what amount was used for calculation

  // Timing
  daysOverdue: integer("days_overdue").notNull(),
  appliedDate: timestamp("applied_date").defaultNow().notNull(),

  // Status
  status: text("status").notNull().default("applied"), // applied, waived, paid
  waivedBy: varchar("waived_by").references(() => users.id, { onDelete: "set null" }),
  waivedAt: timestamp("waived_at"),
  waivedReason: text("waived_reason"),

  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_late_fees_invoice_id").on(table.invoiceId),
  index("idx_late_fees_customer_id").on(table.customerId),
  index("idx_late_fees_status").on(table.status),
]);

// ========================================
// PAYMENT PLANS
// ========================================

// Payment Plans - Allow customers to pay invoices in installments
export const paymentPlans = pgTable("payment_plans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceId: varchar("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  customerId: varchar("customer_id").notNull().references(() => users.id, { onDelete: "cascade" }),

  // Plan details
  planName: text("plan_name").notNull(), // e.g., "3-Month Payment Plan"
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull(),
  numberOfInstallments: integer("number_of_installments").notNull(),
  installmentAmount: decimal("installment_amount", { precision: 10, scale: 2 }).notNull(),
  frequency: text("frequency").notNull().default("monthly"), // weekly, biweekly, monthly

  // Dates
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  nextDueDate: timestamp("next_due_date"),

  // Status
  status: text("status").notNull().default("active"), // active, completed, cancelled, defaulted
  installmentsPaid: integer("installments_paid").default(0).notNull(),
  totalPaid: decimal("total_paid", { precision: 10, scale: 2 }).default("0").notNull(),

  // Terms
  downPayment: decimal("down_payment", { precision: 10, scale: 2 }).default("0"),
  lateFeePerMissedPayment: decimal("late_fee_per_missed_payment", { precision: 10, scale: 2 }),
  notes: text("notes"),

  createdBy: varchar("created_by").notNull().references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_payment_plans_invoice_id").on(table.invoiceId),
  index("idx_payment_plans_customer_id").on(table.customerId),
  index("idx_payment_plans_status").on(table.status),
]);

// Payment Plan Installments - Track individual installment payments
export const paymentPlanInstallments = pgTable("payment_plan_installments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  planId: varchar("plan_id").notNull().references(() => paymentPlans.id, { onDelete: "cascade" }),

  installmentNumber: integer("installment_number").notNull(), // 1, 2, 3, etc.
  dueDate: timestamp("due_date").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),

  status: text("status").notNull().default("pending"), // pending, paid, late, missed
  paidAmount: decimal("paid_amount", { precision: 10, scale: 2 }).default("0"),
  paidDate: timestamp("paid_date"),
  paymentId: varchar("payment_id").references(() => payments.id, { onDelete: "set null" }),

  lateFee: decimal("late_fee", { precision: 10, scale: 2 }).default("0"),
  notes: text("notes"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_payment_plan_installments_plan_id").on(table.planId),
  index("idx_payment_plan_installments_status").on(table.status),
  index("idx_payment_plan_installments_due_date").on(table.dueDate),
]);

// ========================================
// TAX REPORTING AND TRACKING
// ========================================

// Tax Rates - Configure sales tax rates by jurisdiction
export const taxRates = pgTable("tax_rates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),

  name: text("name").notNull(), // e.g., "Jamaica GCT", "State Sales Tax"
  jurisdiction: text("jurisdiction").notNull(), // Country, state, county, city
  taxType: text("tax_type").notNull().default("sales"), // sales, vat, gst, gct

  rate: decimal("rate", { precision: 5, scale: 4 }).notNull(), // e.g., 0.15 for 15%
  isCompound: boolean("is_compound").default(false).notNull(), // Tax on tax

  isActive: boolean("is_active").default(true).notNull(),
  effectiveDate: timestamp("effective_date").notNull(),
  expiryDate: timestamp("expiry_date"),

  description: text("description"),
  taxIdentificationNumber: text("tax_identification_number"), // TIN for remittance

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_tax_rates_jurisdiction").on(table.jurisdiction),
  index("idx_tax_rates_is_active").on(table.isActive),
]);

// Tax Collected Log - Track tax collected on each invoice
export const taxCollected = pgTable("tax_collected", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),

  invoiceId: varchar("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  taxRateId: varchar("tax_rate_id").notNull().references(() => taxRates.id, { onDelete: "restrict" }),

  taxableAmount: decimal("taxable_amount", { precision: 10, scale: 2 }).notNull(),
  taxRate: decimal("tax_rate", { precision: 5, scale: 4 }).notNull(), // Snapshot of rate at time of collection
  taxAmount: decimal("tax_amount", { precision: 10, scale: 2 }).notNull(),

  collectionDate: timestamp("collection_date").notNull(),
  taxPeriod: text("tax_period").notNull(), // e.g., "2025-Q1", "2025-01"

  // Remittance tracking
  remitted: boolean("remitted").default(false).notNull(),
  remittanceId: varchar("remittance_id").references(() => taxRemittances.id, { onDelete: "set null" }),

  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_tax_collected_invoice_id").on(table.invoiceId),
  index("idx_tax_collected_tax_rate_id").on(table.taxRateId),
  index("idx_tax_collected_tax_period").on(table.taxPeriod),
  index("idx_tax_collected_remitted").on(table.remitted),
]);

// Tax Remittances - Track tax payments to authorities
export const taxRemittances = pgTable("tax_remittances", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),

  taxRateId: varchar("tax_rate_id").notNull().references(() => taxRates.id, { onDelete: "restrict" }),
  taxPeriod: text("tax_period").notNull(), // e.g., "2025-Q1", "2025-01"

  totalTaxCollected: decimal("total_tax_collected", { precision: 10, scale: 2 }).notNull(),
  totalTaxRemitted: decimal("total_tax_remitted", { precision: 10, scale: 2 }).notNull(),

  remittanceDate: timestamp("remittance_date").notNull(),
  dueDate: timestamp("due_date"),

  // Payment details
  paymentMethod: text("payment_method"), // check, wire, eft, online
  paymentReference: text("payment_reference"), // Check number, transaction ID

  status: text("status").notNull().default("pending"), // pending, paid, late
  lateFee: decimal("late_fee", { precision: 10, scale: 2 }).default("0"),

  filedBy: varchar("filed_by").references(() => users.id, { onDelete: "set null" }),
  filingConfirmation: text("filing_confirmation"), // Confirmation number from tax authority

  notes: text("notes"),
  attachments: text("attachments").array().default(sql`ARRAY[]::text[]`), // URLs to receipts/confirmations

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_tax_remittances_tax_rate_id").on(table.taxRateId),
  index("idx_tax_remittances_tax_period").on(table.taxPeriod),
  index("idx_tax_remittances_status").on(table.status),
  index("idx_tax_remittances_due_date").on(table.dueDate),
]);

// ========================================
// PAYMENT REMINDER AUTOMATION
// ========================================

// Payment Reminder Settings - Configuration for automated payment reminders
export const paymentReminderSettings = pgTable("payment_reminder_settings", {
  id: integer("id").primaryKey().default(1), // Single row config

  enabled: boolean("enabled").default(false).notNull(),

  // Reminder timing (days after due date)
  firstReminderDays: integer("first_reminder_days").default(7).notNull(),
  secondReminderDays: integer("second_reminder_days").default(15).notNull(),
  thirdReminderDays: integer("third_reminder_days").default(30).notNull(),
  finalReminderDays: integer("final_reminder_days").default(45).notNull(),

  // Email template settings
  fromEmail: text("from_email"),
  fromName: text("from_name"),

  // First reminder template
  firstReminderSubject: text("first_reminder_subject").default("Payment Reminder: Invoice {{invoiceNumber}} is Overdue"),
  firstReminderBody: text("first_reminder_body").default("Dear {{customerName}},\n\nThis is a friendly reminder that Invoice {{invoiceNumber}} for {{invoiceAmount}} is now {{daysOverdue}} days overdue.\n\nPlease arrange payment at your earliest convenience.\n\nThank you,\n{{companyName}}"),

  // Second reminder template
  secondReminderSubject: text("second_reminder_subject").default("Second Notice: Invoice {{invoiceNumber}} Payment Overdue"),
  secondReminderBody: text("second_reminder_body").default("Dear {{customerName}},\n\nThis is a second reminder that Invoice {{invoiceNumber}} for {{invoiceAmount}} remains unpaid and is now {{daysOverdue}} days overdue.\n\nPlease contact us if you have any questions about this invoice.\n\nThank you,\n{{companyName}}"),

  // Third reminder template
  thirdReminderSubject: text("third_reminder_subject").default("Urgent: Invoice {{invoiceNumber}} Seriously Overdue"),
  thirdReminderBody: text("third_reminder_body").default("Dear {{customerName}},\n\nInvoice {{invoiceNumber}} for {{invoiceAmount}} is now {{daysOverdue}} days overdue.\n\nPlease arrange immediate payment to avoid further action.\n\nThank you,\n{{companyName}}"),

  // Final reminder template
  finalReminderSubject: text("final_reminder_subject").default("Final Notice: Invoice {{invoiceNumber}} Payment Required"),
  finalReminderBody: text("final_reminder_body").default("Dear {{customerName}},\n\nThis is a final notice that Invoice {{invoiceNumber}} for {{invoiceAmount}} is now {{daysOverdue}} days overdue.\n\nImmediate payment is required. Please contact us to arrange payment.\n\nThank you,\n{{companyName}}"),

  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Payment Reminders Log - Track which reminders have been sent
export const paymentRemindersLog = pgTable("payment_reminders_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceId: varchar("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  customerId: varchar("customer_id").notNull().references(() => users.id, { onDelete: "cascade" }),

  // Reminder details
  reminderType: text("reminder_type").notNull(), // first, second, third, final
  daysOverdue: integer("days_overdue").notNull(),

  // Email details
  emailTo: text("email_to").notNull(),
  emailSubject: text("email_subject").notNull(),
  emailBody: text("email_body").notNull(),

  // Status
  status: text("status").notNull().default("sent"), // sent, failed
  errorMessage: text("error_message"),

  sentAt: timestamp("sent_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_payment_reminders_log_invoice_id").on(table.invoiceId),
  index("idx_payment_reminders_log_customer_id").on(table.customerId),
  index("idx_payment_reminders_log_reminder_type").on(table.reminderType),
]);

// ========================================
// EMAIL SETTINGS
// ========================================

// Email Settings - Configuration for Resend email service
export const emailSettings = pgTable("email_settings", {
  id: integer("id").primaryKey().default(1), // Single row config
  resendApiKey: text("resend_api_key"), // Encrypted Resend API key
  fromEmail: text("from_email"), // Default from email address
  fromName: text("from_name").default("316 Auto"), // Default from name
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ========================================
// PUSH NOTIFICATION TABLES
// ========================================

// Notification Preferences table - User preferences for notification types
export const notificationPreferences = pgTable("notification_preferences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  
  // Customer notification preferences
  appointmentCreated: boolean("appointment_created").default(true).notNull(),
  appointmentConfirmed: boolean("appointment_confirmed").default(true).notNull(),
  appointmentCancelled: boolean("appointment_cancelled").default(true).notNull(),
  jobCardCompleted: boolean("job_card_completed").default(true).notNull(),
  invoiceGenerated: boolean("invoice_generated").default(true).notNull(),
  towDriverAssigned: boolean("tow_driver_assigned").default(true).notNull(),
  towEnRoute: boolean("tow_en_route").default(true).notNull(),
  towCompleted: boolean("tow_completed").default(true).notNull(),
  
  // Staff notification preferences
  newAppointment: boolean("new_appointment").default(true).notNull(),
  approvalPending: boolean("approval_pending").default(true).notNull(),
  lowStockAlert: boolean("low_stock_alert").default(true).notNull(),
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_notification_preferences_user_id").on(table.userId),
]);

// Notification History table - Log of all sent notifications
export const notificationHistory = pgTable("notification_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  data: jsonb("data"),
  channelId: text("channel_id"),
  status: text("status").notNull(), // "sent", "failed"
  errorMessage: text("error_message"),
  expoTicketId: text("expo_ticket_id"),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
}, (table) => [
  index("idx_notification_history_user_id").on(table.userId),
  index("idx_notification_history_sent_at").on(table.sentAt),
  index("idx_notification_history_status").on(table.status),
]);

// Badge Counts table - Track unread counts per user
export const badgeCounts = pgTable("badge_counts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  appointments: integer("appointments").default(0).notNull(),
  jobCards: integer("job_cards").default(0).notNull(),
  invoices: integer("invoices").default(0).notNull(),
  towRequests: integer("tow_requests").default(0).notNull(),
  approvals: integer("approvals").default(0).notNull(),
  lowStock: integer("low_stock").default(0).notNull(),
  total: integer("total").default(0).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_badge_counts_user_id").on(table.userId),
]);

// Promotional Banners table - Marketing banners/videos for customer portal
export const promotionalBanners = pgTable("promotional_banners", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  description: text("description"),
  mediaType: bannerMediaTypeEnum("media_type").notNull(),
  mediaUrl: text("media_url").notNull(),
  linkUrl: text("link_url"), // Optional click-through URL
  displayOrder: integer("display_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  startDate: timestamp("start_date"), // Optional scheduling
  endDate: timestamp("end_date"),     // Optional scheduling
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_promotional_banners_active").on(table.isActive),
  index("idx_promotional_banners_display_order").on(table.displayOrder),
]);

// Notification Preferences schemas
export const insertNotificationPreferencesSchema = createInsertSchema(notificationPreferences).omit({ id: true, createdAt: true, updatedAt: true });
export const updateNotificationPreferencesSchema = createInsertSchema(notificationPreferences).omit({ id: true, createdAt: true, updatedAt: true }).partial();

// Notification History schemas
export const insertNotificationHistorySchema = createInsertSchema(notificationHistory).omit({ id: true, sentAt: true });

// Badge Counts schemas
export const insertBadgeCountsSchema = createInsertSchema(badgeCounts).omit({ id: true, updatedAt: true });
export const updateBadgeCountsSchema = createInsertSchema(badgeCounts).omit({ id: true, updatedAt: true }).partial();

// TypeScript types
export type InsertNotificationPreferences = z.infer<typeof insertNotificationPreferencesSchema>;
export type UpdateNotificationPreferences = z.infer<typeof updateNotificationPreferencesSchema>;
export type NotificationPreferences = typeof notificationPreferences.$inferSelect;

export type InsertNotificationHistory = z.infer<typeof insertNotificationHistorySchema>;
export type NotificationHistory = typeof notificationHistory.$inferSelect;

export type InsertBadgeCounts = z.infer<typeof insertBadgeCountsSchema>;
export type UpdateBadgeCounts = z.infer<typeof updateBadgeCountsSchema>;
export type BadgeCounts = typeof badgeCounts.$inferSelect;

// Promotional Banners schemas
export const insertPromotionalBannerSchema = createInsertSchema(promotionalBanners).omit({ id: true, createdAt: true, updatedAt: true });
export const updatePromotionalBannerSchema = createInsertSchema(promotionalBanners).omit({ id: true, createdAt: true, updatedAt: true }).partial();

export type InsertPromotionalBanner = z.infer<typeof insertPromotionalBannerSchema>;
export type UpdatePromotionalBanner = z.infer<typeof updatePromotionalBannerSchema>;
export type PromotionalBanner = typeof promotionalBanners.$inferSelect;

// Expense schemas
export const insertExpenseSchema = createInsertSchema(expenses).omit({ 
  id: true, 
  expenseNumber: true, 
  createdAt: true, 
  updatedAt: true 
});
export const updateExpenseSchema = createInsertSchema(expenses).omit({ 
  id: true, 
  expenseNumber: true, 
  createdAt: true, 
  updatedAt: true 
}).partial();

export type InsertExpense = z.infer<typeof insertExpenseSchema>;
export type UpdateExpense = z.infer<typeof updateExpenseSchema>;
export type Expense = typeof expenses.$inferSelect;

// Payment Gateway Settings schemas
export const insertPaymentGatewaySettingsSchema = createInsertSchema(paymentGatewaySettings).omit({ id: true, updatedAt: true });
export const updatePaymentGatewaySettingsSchema = createInsertSchema(paymentGatewaySettings).omit({ id: true, updatedAt: true }).partial();

export type InsertPaymentGatewaySettings = z.infer<typeof insertPaymentGatewaySettingsSchema>;
export type PaymentGatewaySettings = typeof paymentGatewaySettings.$inferSelect;

// QuickBooks Settings schemas
export const insertQuickBooksSettingsSchema = createInsertSchema(quickbooksSettings).omit({ id: true, updatedAt: true });
export const updateQuickBooksSettingsSchema = createInsertSchema(quickbooksSettings).omit({ id: true, updatedAt: true }).partial();

export type InsertQuickBooksSettings = z.infer<typeof insertQuickBooksSettingsSchema>;
export type QuickBooksSettings = typeof quickbooksSettings.$inferSelect;

// Payment Transactions schemas
export const insertPaymentTransactionSchema = createInsertSchema(paymentTransactions).omit({ id: true, createdAt: true, updatedAt: true });
export const updatePaymentTransactionSchema = createInsertSchema(paymentTransactions).omit({ id: true, createdAt: true, updatedAt: true }).partial();

export type InsertPaymentTransaction = z.infer<typeof insertPaymentTransactionSchema>;
export type PaymentTransaction = typeof paymentTransactions.$inferSelect;

// Late Fee Settings schemas
export const insertLateFeeSettingsSchema = createInsertSchema(lateFeeSettings).omit({ id: true, updatedAt: true });
export const updateLateFeeSettingsSchema = createInsertSchema(lateFeeSettings).omit({ id: true, updatedAt: true }).partial();

export type InsertLateFeeSettings = z.infer<typeof insertLateFeeSettingsSchema>;
export type LateFeeSettings = typeof lateFeeSettings.$inferSelect;

// Late Fees schemas
export const insertLateFeeSchema = createInsertSchema(lateFees).omit({ id: true, createdAt: true });
export const updateLateFeeSchema = createInsertSchema(lateFees).omit({ id: true, createdAt: true }).partial();

export type InsertLateFee = z.infer<typeof insertLateFeeSchema>;
export type LateFee = typeof lateFees.$inferSelect;

// Payment Plans schemas
export const insertPaymentPlanSchema = createInsertSchema(paymentPlans).omit({ id: true, createdAt: true, updatedAt: true });
export const updatePaymentPlanSchema = createInsertSchema(paymentPlans).omit({ id: true, createdAt: true, updatedAt: true }).partial();

export type InsertPaymentPlan = z.infer<typeof insertPaymentPlanSchema>;
export type PaymentPlan = typeof paymentPlans.$inferSelect;

// Payment Plan Installments schemas
export const insertPaymentPlanInstallmentSchema = createInsertSchema(paymentPlanInstallments).omit({ id: true, createdAt: true });
export const updatePaymentPlanInstallmentSchema = createInsertSchema(paymentPlanInstallments).omit({ id: true, createdAt: true }).partial();

export type InsertPaymentPlanInstallment = z.infer<typeof insertPaymentPlanInstallmentSchema>;
export type PaymentPlanInstallment = typeof paymentPlanInstallments.$inferSelect;

// Tax Rates schemas
export const insertTaxRateSchema = createInsertSchema(taxRates).omit({ id: true, createdAt: true, updatedAt: true });
export const updateTaxRateSchema = createInsertSchema(taxRates).omit({ id: true, createdAt: true, updatedAt: true }).partial();

export type InsertTaxRate = z.infer<typeof insertTaxRateSchema>;
export type TaxRate = typeof taxRates.$inferSelect;

// Tax Collected schemas
export const insertTaxCollectedSchema = createInsertSchema(taxCollected).omit({ id: true, createdAt: true });
export const updateTaxCollectedSchema = createInsertSchema(taxCollected).omit({ id: true, createdAt: true }).partial();

export type InsertTaxCollected = z.infer<typeof insertTaxCollectedSchema>;
export type TaxCollected = typeof taxCollected.$inferSelect;

// Tax Remittances schemas
export const insertTaxRemittanceSchema = createInsertSchema(taxRemittances).omit({ id: true, createdAt: true, updatedAt: true });
export const updateTaxRemittanceSchema = createInsertSchema(taxRemittances).omit({ id: true, createdAt: true, updatedAt: true }).partial();

export type InsertTaxRemittance = z.infer<typeof insertTaxRemittanceSchema>;
export type TaxRemittance = typeof taxRemittances.$inferSelect;

// Payment Reminder Settings schemas
export const insertPaymentReminderSettingsSchema = createInsertSchema(paymentReminderSettings).omit({ id: true, updatedAt: true });
export const updatePaymentReminderSettingsSchema = createInsertSchema(paymentReminderSettings).omit({ id: true, updatedAt: true }).partial();

export type InsertPaymentReminderSettings = z.infer<typeof insertPaymentReminderSettingsSchema>;
export type PaymentReminderSettings = typeof paymentReminderSettings.$inferSelect;

// Payment Reminders Log schemas
export const insertPaymentReminderLogSchema = createInsertSchema(paymentRemindersLog).omit({ id: true, createdAt: true });
export const updatePaymentReminderLogSchema = createInsertSchema(paymentRemindersLog).omit({ id: true, createdAt: true }).partial();

export type InsertPaymentReminderLog = z.infer<typeof insertPaymentReminderLogSchema>;
export type PaymentReminderLog = typeof paymentRemindersLog.$inferSelect;

// Email Settings schemas
export const insertEmailSettingsSchema = createInsertSchema(emailSettings).omit({ id: true, updatedAt: true });
export const updateEmailSettingsSchema = createInsertSchema(emailSettings).omit({ id: true, updatedAt: true }).partial();

export type InsertEmailSettings = z.infer<typeof insertEmailSettingsSchema>;
export type EmailSettings = typeof emailSettings.$inferSelect;

// Vendor schemas
export const insertVendorSchema = createInsertSchema(vendors).omit({ id: true, createdAt: true, updatedAt: true });
export const updateVendorSchema = createInsertSchema(vendors).omit({ id: true, createdAt: true, updatedAt: true }).partial();

export type InsertVendor = z.infer<typeof insertVendorSchema>;
export type Vendor = typeof vendors.$inferSelect;

// Vendor Bill schemas
export const insertVendorBillSchema = createInsertSchema(vendorBills).omit({ id: true, createdAt: true, updatedAt: true });
export const updateVendorBillSchema = createInsertSchema(vendorBills).omit({ id: true, createdAt: true, updatedAt: true }).partial();

export type InsertVendorBill = z.infer<typeof insertVendorBillSchema>;
export type VendorBill = typeof vendorBills.$inferSelect;

// Vendor Bill Line Item schemas
export const insertVendorBillLineItemSchema = createInsertSchema(vendorBillLineItems).omit({ id: true, createdAt: true });

export type InsertVendorBillLineItem = z.infer<typeof insertVendorBillLineItemSchema>;
export type VendorBillLineItem = typeof vendorBillLineItems.$inferSelect;

// Vendor Payment schemas
export const insertVendorPaymentSchema = createInsertSchema(vendorPayments).omit({ id: true, createdAt: true });

export type InsertVendorPayment = z.infer<typeof insertVendorPaymentSchema>;
export type VendorPayment = typeof vendorPayments.$inferSelect;

// Customer Payment Method schemas
export const insertCustomerPaymentMethodSchema = createInsertSchema(customerPaymentMethods).omit({ id: true, createdAt: true, updatedAt: true });
export const updateCustomerPaymentMethodSchema = createInsertSchema(customerPaymentMethods).omit({ id: true, createdAt: true, updatedAt: true }).partial();

export type InsertCustomerPaymentMethod = z.infer<typeof insertCustomerPaymentMethodSchema>;
export type CustomerPaymentMethod = typeof customerPaymentMethods.$inferSelect;

// Online Payment Transaction schemas
export const insertOnlinePaymentTransactionSchema = createInsertSchema(onlinePaymentTransactions).omit({ id: true, createdAt: true, updatedAt: true });
export const updateOnlinePaymentTransactionSchema = createInsertSchema(onlinePaymentTransactions).omit({ id: true, createdAt: true, updatedAt: true }).partial();

export type InsertOnlinePaymentTransaction = z.infer<typeof insertOnlinePaymentTransactionSchema>;
export type OnlinePaymentTransaction = typeof onlinePaymentTransactions.$inferSelect;

// ============================================
// CRM SYSTEM TABLES
// ============================================

// Leads table - potential customers in sales pipeline
export const leads = pgTable("leads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),

  // Basic information
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  company: text("company"), // For business leads

  // Lead details
  source: leadSourceEnum("source").notNull().default("other"),
  status: leadStatusEnum("status").notNull().default("new"),
  qualificationScore: integer("qualification_score").default(0), // 0-100 score

  // Vehicle and service interest
  vehicleMake: text("vehicle_make"),
  vehicleModel: text("vehicle_model"),
  vehicleYear: integer("vehicle_year"),
  vehicleVin: text("vehicle_vin"),
  serviceInterest: text("service_interest"), // What service they're interested in

  // Assignment and ownership
  assignedToId: varchar("assigned_to_id").references(() => users.id, { onDelete: "set null" }),

  // Conversion tracking
  convertedToCustomerId: varchar("converted_to_customer_id").references(() => users.id, { onDelete: "set null" }),
  convertedAt: timestamp("converted_at"),

  // Additional data
  notes: text("notes"),
  estimatedValue: decimal("estimated_value", { precision: 10, scale: 2 }), // Potential deal value
  expectedCloseDate: timestamp("expected_close_date"),

  // Metadata
  lostReason: text("lost_reason"), // Why the lead was lost (if applicable)
  tags: text("tags").array().default(sql`ARRAY[]::text[]`), // Quick tags like "hot", "follow-up-needed"
  customFields: jsonb("custom_fields"), // Flexible data storage

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_leads_status").on(table.status),
  index("idx_leads_source").on(table.source),
  index("idx_leads_assigned_to").on(table.assignedToId),
  index("idx_leads_email").on(table.email),
  index("idx_leads_phone").on(table.phone),
  index("idx_leads_created_at").on(table.createdAt),
]);

// Lead activities table - timeline of interactions with leads
export const leadActivities = pgTable("lead_activities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),

  activityType: leadActivityTypeEnum("activity_type").notNull(),
  subject: text("subject").notNull(), // Short description
  description: text("description"), // Detailed notes

  // User who performed the activity
  performedById: varchar("performed_by_id").references(() => users.id, { onDelete: "set null" }),

  // Additional metadata
  outcome: text("outcome"), // Result of call/meeting
  nextStepDate: timestamp("next_step_date"), // When to follow up

  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_lead_activities_lead_id").on(table.leadId),
  index("idx_lead_activities_type").on(table.activityType),
  index("idx_lead_activities_created_at").on(table.createdAt),
]);

// Customer tags table - labels for organizing customers
export const customerTags = pgTable("customer_tags", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  color: text("color").notNull().default("#3b82f6"), // Hex color for display
  description: text("description"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_customer_tags_name").on(table.name),
]);

// Customer tag assignments table - many-to-many relationship
export const customerTagAssignments = pgTable("customer_tag_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  customerId: varchar("customer_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tagId: varchar("tag_id").notNull().references(() => customerTags.id, { onDelete: "cascade" }),

  assignedById: varchar("assigned_by_id").references(() => users.id, { onDelete: "set null" }), // Who added the tag

  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_customer_tag_assignments_customer").on(table.customerId),
  index("idx_customer_tag_assignments_tag").on(table.tagId),
]);

// Customer segments table - saved filter configurations for customer lists
export const customerSegments = pgTable("customer_segments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),

  // Filter configuration stored as JSON
  filterConfig: jsonb("filter_config").notNull(), // Stores the filter criteria

  // Segment type
  isDynamic: boolean("is_dynamic").notNull().default(true), // Auto-updates vs static snapshot

  // Ownership
  createdById: varchar("created_by_id").references(() => users.id, { onDelete: "set null" }),
  isPublic: boolean("is_public").default(false), // Visible to all staff or just creator

  // Metadata
  customerCount: integer("customer_count").default(0), // Cached count for performance
  lastCalculatedAt: timestamp("last_calculated_at"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_customer_segments_created_by").on(table.createdById),
  index("idx_customer_segments_is_public").on(table.isPublic),
]);

// ============================================
// CRM SYSTEM ZORD SCHEMAS & TYPES
// ============================================

// Leads schemas
export const insertLeadSchema = createInsertSchema(leads).omit({ id: true, createdAt: true, updatedAt: true });
export const updateLeadSchema = createInsertSchema(leads).omit({ id: true, createdAt: true, updatedAt: true }).partial();

export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Lead = typeof leads.$inferSelect;

// Lead Activities schemas
export const insertLeadActivitySchema = createInsertSchema(leadActivities).omit({ id: true, createdAt: true });

export type InsertLeadActivity = z.infer<typeof insertLeadActivitySchema>;
export type LeadActivity = typeof leadActivities.$inferSelect;

// Customer Tags schemas
export const insertCustomerTagSchema = createInsertSchema(customerTags).omit({ id: true, createdAt: true, updatedAt: true });
export const updateCustomerTagSchema = createInsertSchema(customerTags).omit({ id: true, createdAt: true, updatedAt: true }).partial();

export type InsertCustomerTag = z.infer<typeof insertCustomerTagSchema>;
export type CustomerTag = typeof customerTags.$inferSelect;

// Customer Tag Assignments schemas
export const insertCustomerTagAssignmentSchema = createInsertSchema(customerTagAssignments).omit({ id: true, createdAt: true });

export type InsertCustomerTagAssignment = z.infer<typeof insertCustomerTagAssignmentSchema>;
export type CustomerTagAssignment = typeof customerTagAssignments.$inferSelect;

// Customer Segments schemas
export const insertCustomerSegmentSchema = createInsertSchema(customerSegments).omit({ id: true, createdAt: true, updatedAt: true, customerCount: true, lastCalculatedAt: true });
export const updateCustomerSegmentSchema = createInsertSchema(customerSegments).omit({ id: true, createdAt: true, updatedAt: true, customerCount: true, lastCalculatedAt: true }).partial();

export type InsertCustomerSegment = z.infer<typeof insertCustomerSegmentSchema>;
export type CustomerSegment = typeof customerSegments.$inferSelect;

// Permissions & Roles System schemas
export const insertPermissionSchema = createInsertSchema(permissions).omit({ id: true, createdAt: true });
export const updatePermissionSchema = insertPermissionSchema.partial();

export type InsertPermission = z.infer<typeof insertPermissionSchema>;
export type Permission = typeof permissions.$inferSelect;

export const insertRoleSchema = createInsertSchema(roles).omit({ id: true, createdAt: true, updatedAt: true });
export const updateRoleSchema = insertRoleSchema.omit({ isSystem: true }).partial();

export type InsertRole = z.infer<typeof insertRoleSchema>;
export type Role = typeof roles.$inferSelect;

export const insertRolePermissionSchema = createInsertSchema(rolePermissions).omit({ id: true, grantedAt: true });

export type InsertRolePermission = z.infer<typeof insertRolePermissionSchema>;
export type RolePermission = typeof rolePermissions.$inferSelect;

export const insertUserPermissionOverrideSchema = createInsertSchema(userPermissionOverrides).omit({ id: true, createdAt: true });

export type InsertUserPermissionOverride = z.infer<typeof insertUserPermissionOverrideSchema>;
export type UserPermissionOverride = typeof userPermissionOverrides.$inferSelect;

export const insertPermissionAuditLogSchema = createInsertSchema(permissionAuditLog).omit({ id: true, createdAt: true });

export type InsertPermissionAuditLog = z.infer<typeof insertPermissionAuditLogSchema>;
export type PermissionAuditLog = typeof permissionAuditLog.$inferSelect;

// Password Reset Form Validation Schema
// Shared schema for password reset form to ensure consistent validation across frontend and backend
export const resetPasswordFormSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters long"),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

export type ResetPasswordForm = z.infer<typeof resetPasswordFormSchema>;
