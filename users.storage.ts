/**
 * User and Customer Storage Module
 * Contains all user-related database operations including:
 * - User CRUD operations
 * - Customer management
 * - Staff management
 * - Account number generation
 * - Customer statistics and filtering
 * - Authentication helpers (password, email verification)
 */

import {
  db,
  eq,
  and,
  or,
  desc,
  sql,
  ilike,
  gte,
  lte,
  inArray,
  users,
  appointments,
  invoices,
  loyaltyPointsTransactions,
  vehicles,
  staffReviews,
  jobCards,
  customerAccountSequence,
  type User,
  type InsertUser,
  type UpsertUser,
} from "./base";

// ==================== TYPES & INTERFACES ====================

export interface CustomerFilters {
  // Existing filters
  customerType?: "individual" | "business";
  minSpent?: number;
  maxSpent?: number;
  minVisits?: number;
  maxVisits?: number;
  visitDateFrom?: Date;
  visitDateTo?: Date;

  // Quick Wins - Customer Status
  registrationDateFrom?: Date;
  registrationDateTo?: Date;
  accountStatus?: "active" | "inactive" | "all";
  minOutstandingBalance?: number;
  maxOutstandingBalance?: number;
  minLoyaltyPoints?: number;
  maxLoyaltyPoints?: number;
  minVehicles?: number;
  maxVehicles?: number;

  // Financial Intelligence
  minOverdueInvoices?: number;
  maxOverdueInvoices?: number;
  paymentTerms?: string;
  minCreditLimit?: number;
  maxCreditLimit?: number;
  minAvgInvoice?: number;
  maxAvgInvoice?: number;

  // Engagement Tracking
  emailVerified?: boolean;
  hasMobileApp?: boolean;
  hasSubmittedReviews?: boolean;
  reviewRequestsEnabled?: boolean;

  // Activity Patterns
  lastActivityFrom?: Date;
  lastActivityTo?: Date;
  minNoShowRate?: number;
  maxNoShowRate?: number;
  minCancellationRate?: number;
  maxCancellationRate?: number;
  serviceTypePreference?: "in_shop" | "remote";
}

export interface CustomerStats {
  totalSpent: number;
  totalVisits: number;
  lastVisitDate: Date | null;
}

// ==================== BASIC USER OPERATIONS ====================

export async function getUser(id: string): Promise<User | undefined> {
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0];
}

export async function getUserByEmail(email: string): Promise<User | undefined> {
  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return result[0];
}

export async function getUserByReferralCode(referralCode: string): Promise<User | undefined> {
  const result = await db.select()
    .from(users)
    .where(eq(users.referralCode, referralCode))
    .limit(1);
  return result[0];
}

export async function createUser(user: InsertUser): Promise<User> {
  const result = await db.insert(users).values(user).returning();
  return result[0];
}

export async function updateUser(id: string, user: Partial<InsertUser>): Promise<User | undefined> {
  const result = await db.update(users).set(user).where(eq(users.id, id)).returning();
  return result[0];
}

export async function deleteUser(id: string): Promise<void> {
  await db.delete(users).where(eq(users.id, id));
}

// ==================== UPSERT USER (OAUTH SUPPORT) ====================

export async function upsertUser(user: UpsertUser): Promise<User> {
  const { id, ...userWithoutId } = user;

  // First check if user exists by ID (most reliable)
  let existingUser: User | undefined;
  if (id) {
    existingUser = await getUser(id);
  }

  // If not found by ID, check by email
  if (!existingUser && user.email) {
    existingUser = await getUserByEmail(user.email);
  }

  if (existingUser) {
    // User exists - update profile info and role if provided
    // Preserve: id, permissions, accountNumber, createdAt
    // Don't update email if it already exists (prevents unique constraint errors)
    const updateFields: Record<string, unknown> = {
      firstName: userWithoutId.firstName,
      lastName: userWithoutId.lastName,
      profileImageUrl: userWithoutId.profileImageUrl,
      updatedAt: new Date(),
    };

    // Update role if explicitly provided (e.g., from OIDC claims)
    if (userWithoutId.role) {
      updateFields.role = userWithoutId.role;
    }

    const result = await db
      .update(users)
      .set(updateFields)
      .where(eq(users.id, existingUser.id))
      .returning();
    return result[0];
  } else {
    // New user - wrap everything in transaction including account number generation
    return await db.transaction(async (tx) => {
      // Double-check user doesn't exist (race condition protection)
      let existingInTx: User | undefined;
      if (id) {
        const result = await tx.select().from(users).where(eq(users.id, id)).limit(1);
        existingInTx = result[0];
      }
      if (!existingInTx && user.email) {
        const result = await tx.select().from(users).where(eq(users.email, user.email)).limit(1);
        existingInTx = result[0];
      }

      if (existingInTx) {
        // User was created by concurrent request, just return it
        return existingInTx;
      }

      // Generate account number for customers only
      let accountNumber: string | undefined;
      if (user.role === "customer") {
        const prefix = "316-";

        // Get max account number from existing users within transaction (with lock)
        const maxAccountResult = await tx
          .select({ accountNumber: users.accountNumber })
          .from(users)
          .where(sql`${users.accountNumber} LIKE '316-%'`)
          .orderBy(sql`CAST(SUBSTRING(${users.accountNumber} FROM 5) AS INTEGER) DESC`)
          .limit(1)
          .for('update');

        let nextNumber = 1;
        if (maxAccountResult.length > 0 && maxAccountResult[0].accountNumber) {
          const numPart = maxAccountResult[0].accountNumber.replace('316-', '');
          const currentMax = parseInt(numPart, 10) || 0;
          nextNumber = currentMax + 1;
        }

        accountNumber = `${prefix}${nextNumber.toString().padStart(4, '0')}`;
      }

      // Insert new user
      const result = await tx
        .insert(users)
        .values({
          ...user,
          accountNumber,
        })
        .returning();
      return result[0];
    });
  }
}

// ==================== CUSTOMER OPERATIONS ====================

export async function getAllCustomers(): Promise<User[]> {
  return await db
    .select()
    .from(users)
    .where(eq(users.role, "customer"))
    .orderBy(desc(users.createdAt));
}

export async function getCustomerById(id: string): Promise<User | undefined> {
  const result = await db
    .select()
    .from(users)
    .where(and(eq(users.id, id), eq(users.role, "customer")))
    .limit(1);
  return result[0];
}

export async function generateCustomerAccountNumber(): Promise<string> {
  return await db.transaction(async (tx) => {
    const prefix = "316-";

    // Upsert to ensure sequence row exists and increment atomically
    const result = await tx
      .insert(customerAccountSequence)
      .values({ id: 1, lastNumber: 1 })
      .onConflictDoUpdate({
        target: customerAccountSequence.id,
        set: { lastNumber: sql`${customerAccountSequence.lastNumber} + 1` },
      })
      .returning();

    const nextNumber = result[0].lastNumber;

    return `${prefix}${nextNumber.toString().padStart(4, '0')}`;
  });
}

export async function createCustomer(customer: InsertUser): Promise<User> {
  const accountNumber = await generateCustomerAccountNumber();
  const result = await db.insert(users).values({
    ...customer,
    role: "customer",
    accountNumber,
  }).returning();
  return result[0];
}

export async function deleteCustomer(id: string): Promise<void> {
  await db.delete(users).where(eq(users.id, id));
}

export async function bulkDeleteCustomers(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.delete(users).where(inArray(users.id, ids));
}

// ==================== STAFF OPERATIONS ====================

export async function getAllStaff(): Promise<User[]> {
  return await db
    .select()
    .from(users)
    .where(inArray(users.role, ["admin", "manager", "mechanic", "receptionist"]))
    .orderBy(desc(users.createdAt));
}

// ==================== CUSTOMER SEARCH & FILTERING ====================

export async function searchCustomers(query: string, filters?: CustomerFilters): Promise<User[]> {
  const conditions = [eq(users.role, "customer")];

  if (query) {
    conditions.push(
      or(
        ilike(users.firstName, `%${query}%`),
        ilike(users.lastName, `%${query}%`),
        ilike(users.email, `%${query}%`),
        ilike(users.phone, `%${query}%`)
      )!
    );
  }

  // Simple direct filters
  if (filters?.customerType) {
    conditions.push(eq(users.customerType, filters.customerType));
  }

  if (filters?.accountStatus && filters.accountStatus !== "all") {
    conditions.push(eq(users.isActive, filters.accountStatus === "active"));
  }

  if (filters?.registrationDateFrom) {
    conditions.push(gte(users.createdAt, filters.registrationDateFrom));
  }

  if (filters?.registrationDateTo) {
    conditions.push(lte(users.createdAt, filters.registrationDateTo));
  }

  if (filters?.paymentTerms) {
    conditions.push(eq(users.paymentTerms, filters.paymentTerms));
  }

  if (filters?.minCreditLimit !== undefined) {
    conditions.push(gte(users.creditLimit, filters.minCreditLimit.toString()));
  }

  if (filters?.maxCreditLimit !== undefined) {
    conditions.push(lte(users.creditLimit, filters.maxCreditLimit.toString()));
  }

  if (filters?.emailVerified !== undefined) {
    conditions.push(eq(users.emailVerified, filters.emailVerified));
  }

  if (filters?.hasMobileApp !== undefined) {
    if (filters.hasMobileApp) {
      conditions.push(sql`${users.pushToken} IS NOT NULL`);
    } else {
      conditions.push(sql`${users.pushToken} IS NULL`);
    }
  }

  if (filters?.reviewRequestsEnabled !== undefined) {
    conditions.push(eq(users.reviewRequestsEnabled, filters.reviewRequestsEnabled));
  }

  // Check if we need complex aggregations
  const needsAggregation =
    filters?.visitDateFrom || filters?.visitDateTo || filters?.minVisits || filters?.maxVisits ||
    filters?.minSpent !== undefined || filters?.maxSpent !== undefined ||
    filters?.minOutstandingBalance !== undefined || filters?.maxOutstandingBalance !== undefined ||
    filters?.minOverdueInvoices !== undefined || filters?.maxOverdueInvoices !== undefined ||
    filters?.minAvgInvoice !== undefined || filters?.maxAvgInvoice !== undefined ||
    filters?.minLoyaltyPoints !== undefined || filters?.maxLoyaltyPoints !== undefined ||
    filters?.minVehicles !== undefined || filters?.maxVehicles !== undefined ||
    filters?.hasSubmittedReviews !== undefined ||
    filters?.lastActivityFrom || filters?.lastActivityTo ||
    filters?.minNoShowRate !== undefined || filters?.maxNoShowRate !== undefined ||
    filters?.minCancellationRate !== undefined || filters?.maxCancellationRate !== undefined ||
    filters?.serviceTypePreference;

  if (needsAggregation) {
    const customersWithStats = await db
      .select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        profileImageUrl: users.profileImageUrl,
        role: users.role,
        customerType: users.customerType,
        phone: users.phone,
        address: users.address,
        permissions: users.permissions,
        accountNumber: users.accountNumber,
        isActive: users.isActive,
        emailVerified: users.emailVerified,
        reviewRequestsEnabled: users.reviewRequestsEnabled,
        paymentTerms: users.paymentTerms,
        creditLimit: users.creditLimit,
        pushToken: users.pushToken,
        referralCode: users.referralCode,
        billingEmail: users.billingEmail,
        ccEmail: users.ccEmail,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,

        // Financial metrics
        totalSpent: sql<number>`COALESCE(SUM(CASE WHEN ${invoices.status} = 'paid' THEN ${invoices.total} ELSE 0 END), 0)`.as('total_spent'),
        outstandingBalance: sql<number>`COALESCE(SUM(CASE WHEN ${invoices.status} IN ('sent', 'overdue', 'partially_paid') THEN ${invoices.total} - COALESCE(${invoices.paidAmount}, 0) ELSE 0 END), 0)`.as('outstanding_balance'),
        overdueInvoicesCount: sql<number>`COALESCE(SUM(CASE WHEN ${invoices.status} = 'overdue' THEN 1 ELSE 0 END), 0)`.as('overdue_invoices_count'),
        avgInvoiceAmount: sql<number>`CASE WHEN COUNT(${invoices.id}) > 0 THEN COALESCE(AVG(${invoices.total}), 0) ELSE 0 END`.as('avg_invoice_amount'),

        // Visit metrics
        visitCount: sql<number>`COALESCE(COUNT(DISTINCT ${appointments.id}), 0)`.as('visit_count'),
        lastVisitDate: sql<Date>`MAX(${appointments.scheduledDate})`.as('last_visit_date'),
        completedVisits: sql<number>`COALESCE(SUM(CASE WHEN ${appointments.status} = 'completed' THEN 1 ELSE 0 END), 0)`.as('completed_visits'),
        cancelledVisits: sql<number>`COALESCE(SUM(CASE WHEN ${appointments.status} = 'cancelled' THEN 1 ELSE 0 END), 0)`.as('cancelled_visits'),
        noShowVisits: sql<number>`COALESCE(SUM(CASE WHEN ${appointments.status} = 'no_show' THEN 1 ELSE 0 END), 0)`.as('no_show_visits'),
        inShopVisits: sql<number>`COALESCE(SUM(CASE WHEN ${appointments.appointmentType} = 'in_shop' THEN 1 ELSE 0 END), 0)`.as('in_shop_visits'),
        remoteVisits: sql<number>`COALESCE(SUM(CASE WHEN ${appointments.appointmentType} = 'remote' THEN 1 ELSE 0 END), 0)`.as('remote_visits'),

        // Loyalty and engagement
        loyaltyPoints: sql<number>`COALESCE((SELECT SUM(points) FROM ${loyaltyPointsTransactions} WHERE ${loyaltyPointsTransactions.customerId} = ${users.id}), 0)`.as('loyalty_points'),
        vehicleCount: sql<number>`COALESCE((SELECT COUNT(*) FROM ${vehicles} WHERE ${vehicles.customerId} = ${users.id}), 0)`.as('vehicle_count'),
        hasSubmittedReviews: sql<boolean>`EXISTS(SELECT 1 FROM ${staffReviews} WHERE ${staffReviews.customerId} = ${users.id})`.as('has_submitted_reviews'),

        // Last activity calculation (max of last invoice, appointment, or job card date)
        lastActivity: sql<Date>`GREATEST(
          COALESCE(MAX(${invoices.createdAt}), '1970-01-01'),
          COALESCE(MAX(${appointments.createdAt}), '1970-01-01'),
          COALESCE((SELECT MAX(created_at) FROM ${jobCards} WHERE ${jobCards.customerId} = ${users.id}), '1970-01-01')
        )`.as('last_activity'),
      })
      .from(users)
      .leftJoin(invoices, eq(invoices.customerId, users.id))
      .leftJoin(appointments, eq(appointments.customerId, users.id))
      .where(and(...conditions))
      .groupBy(users.id);

    let filteredCustomers = customersWithStats;

    // Existing filters
    if (filters.minSpent !== undefined) {
      filteredCustomers = filteredCustomers.filter(c => Number(c.totalSpent) >= filters.minSpent!);
    }
    if (filters.maxSpent !== undefined) {
      filteredCustomers = filteredCustomers.filter(c => Number(c.totalSpent) <= filters.maxSpent!);
    }
    if (filters.minVisits !== undefined) {
      filteredCustomers = filteredCustomers.filter(c => c.visitCount >= filters.minVisits!);
    }
    if (filters.maxVisits !== undefined) {
      filteredCustomers = filteredCustomers.filter(c => c.visitCount <= filters.maxVisits!);
    }
    if (filters.visitDateFrom) {
      filteredCustomers = filteredCustomers.filter(c => c.lastVisitDate && c.lastVisitDate >= filters.visitDateFrom!);
    }
    if (filters.visitDateTo) {
      filteredCustomers = filteredCustomers.filter(c => c.lastVisitDate && c.lastVisitDate <= filters.visitDateTo!);
    }

    // Financial filters
    if (filters.minOutstandingBalance !== undefined) {
      filteredCustomers = filteredCustomers.filter(c => Number(c.outstandingBalance) >= filters.minOutstandingBalance!);
    }
    if (filters.maxOutstandingBalance !== undefined) {
      filteredCustomers = filteredCustomers.filter(c => Number(c.outstandingBalance) <= filters.maxOutstandingBalance!);
    }
    if (filters.minOverdueInvoices !== undefined) {
      filteredCustomers = filteredCustomers.filter(c => Number(c.overdueInvoicesCount) >= filters.minOverdueInvoices!);
    }
    if (filters.maxOverdueInvoices !== undefined) {
      filteredCustomers = filteredCustomers.filter(c => Number(c.overdueInvoicesCount) <= filters.maxOverdueInvoices!);
    }
    if (filters.minAvgInvoice !== undefined) {
      filteredCustomers = filteredCustomers.filter(c => Number(c.avgInvoiceAmount) >= filters.minAvgInvoice!);
    }
    if (filters.maxAvgInvoice !== undefined) {
      filteredCustomers = filteredCustomers.filter(c => Number(c.avgInvoiceAmount) <= filters.maxAvgInvoice!);
    }

    // Loyalty and engagement filters
    if (filters.minLoyaltyPoints !== undefined) {
      filteredCustomers = filteredCustomers.filter(c => Number(c.loyaltyPoints) >= filters.minLoyaltyPoints!);
    }
    if (filters.maxLoyaltyPoints !== undefined) {
      filteredCustomers = filteredCustomers.filter(c => Number(c.loyaltyPoints) <= filters.maxLoyaltyPoints!);
    }
    if (filters.minVehicles !== undefined) {
      filteredCustomers = filteredCustomers.filter(c => Number(c.vehicleCount) >= filters.minVehicles!);
    }
    if (filters.maxVehicles !== undefined) {
      filteredCustomers = filteredCustomers.filter(c => Number(c.vehicleCount) <= filters.maxVehicles!);
    }
    if (filters.hasSubmittedReviews !== undefined) {
      filteredCustomers = filteredCustomers.filter(c => c.hasSubmittedReviews === filters.hasSubmittedReviews!);
    }

    // Activity filters
    if (filters.lastActivityFrom) {
      filteredCustomers = filteredCustomers.filter(c => c.lastActivity && c.lastActivity >= filters.lastActivityFrom!);
    }
    if (filters.lastActivityTo) {
      filteredCustomers = filteredCustomers.filter(c => c.lastActivity && c.lastActivity <= filters.lastActivityTo!);
    }

    // Behavioral pattern filters (rates calculated as percentages)
    if (filters.minNoShowRate !== undefined) {
      filteredCustomers = filteredCustomers.filter(c => {
        const totalVisits = Number(c.visitCount);
        if (totalVisits === 0) return false;
        const noShowRate = (Number(c.noShowVisits) / totalVisits) * 100;
        return noShowRate >= filters.minNoShowRate!;
      });
    }
    if (filters.maxNoShowRate !== undefined) {
      filteredCustomers = filteredCustomers.filter(c => {
        const totalVisits = Number(c.visitCount);
        if (totalVisits === 0) return true; // Include customers with no visits
        const noShowRate = (Number(c.noShowVisits) / totalVisits) * 100;
        return noShowRate <= filters.maxNoShowRate!;
      });
    }
    if (filters.minCancellationRate !== undefined) {
      filteredCustomers = filteredCustomers.filter(c => {
        const totalVisits = Number(c.visitCount);
        if (totalVisits === 0) return false;
        const cancellationRate = (Number(c.cancelledVisits) / totalVisits) * 100;
        return cancellationRate >= filters.minCancellationRate!;
      });
    }
    if (filters.maxCancellationRate !== undefined) {
      filteredCustomers = filteredCustomers.filter(c => {
        const totalVisits = Number(c.visitCount);
        if (totalVisits === 0) return true; // Include customers with no visits
        const cancellationRate = (Number(c.cancelledVisits) / totalVisits) * 100;
        return cancellationRate <= filters.maxCancellationRate!;
      });
    }

    // Service type preference filter
    if (filters.serviceTypePreference) {
      filteredCustomers = filteredCustomers.filter(c => {
        if (filters.serviceTypePreference === "in_shop") {
          return Number(c.inShopVisits) > Number(c.remoteVisits);
        } else if (filters.serviceTypePreference === "remote") {
          return Number(c.remoteVisits) > Number(c.inShopVisits);
        }
        return true;
      });
    }

    // Strip computed fields before returning
    return filteredCustomers.map(({
      totalSpent, visitCount, lastVisitDate, outstandingBalance, overdueInvoicesCount,
      avgInvoiceAmount, loyaltyPoints, vehicleCount, hasSubmittedReviews, lastActivity,
      completedVisits, cancelledVisits, noShowVisits, inShopVisits, remoteVisits,
      ...customer
    }) => customer as User);
  }

  return await db
    .select()
    .from(users)
    .where(and(...conditions))
    .orderBy(desc(users.createdAt));
}

// ==================== CUSTOMER STATISTICS ====================

export async function getCustomerStats(customerId: string): Promise<CustomerStats> {
  const result = await db
    .select({
      totalSpent: sql<number>`COALESCE((
        SELECT SUM(${invoices.total})
        FROM ${invoices}
        WHERE ${invoices.customerId} = ${users.id}
      ), 0)`,
      totalVisits: sql<number>`COALESCE((
        SELECT COUNT(*)
        FROM ${appointments}
        WHERE ${appointments.customerId} = ${users.id}
      ), 0)`,
      lastVisitDate: sql<Date>`(
        SELECT MAX(${appointments.scheduledDate})
        FROM ${appointments}
        WHERE ${appointments.customerId} = ${users.id}
      )`,
    })
    .from(users)
    .where(eq(users.id, customerId))
    .limit(1);

  if (result.length === 0) {
    return {
      totalSpent: 0,
      totalVisits: 0,
      lastVisitDate: null,
    };
  }

  return {
    totalSpent: Number(result[0].totalSpent) || 0,
    totalVisits: result[0].totalVisits || 0,
    lastVisitDate: result[0].lastVisitDate || null,
  };
}

export async function getBulkCustomerStats(customerIds?: string[]): Promise<Map<string, CustomerStats>> {
  const conditions = [eq(users.role, "customer")];
  if (customerIds && customerIds.length > 0) {
    conditions.push(inArray(users.id, customerIds));
  }

  const results = await db
    .select({
      customerId: users.id,
      totalSpent: sql<number>`COALESCE((
        SELECT SUM(${invoices.total})
        FROM ${invoices}
        WHERE ${invoices.customerId} = ${users.id}
      ), 0)`,
      totalVisits: sql<number>`COALESCE((
        SELECT COUNT(*)
        FROM ${appointments}
        WHERE ${appointments.customerId} = ${users.id}
      ), 0)`,
      lastVisitDate: sql<Date>`(
        SELECT MAX(${appointments.scheduledDate})
        FROM ${appointments}
        WHERE ${appointments.customerId} = ${users.id}
      )`,
    })
    .from(users)
    .where(and(...conditions));

  const statsMap = new Map<string, CustomerStats>();

  for (const result of results) {
    statsMap.set(result.customerId, {
      totalSpent: Number(result.totalSpent) || 0,
      totalVisits: result.totalVisits || 0,
      lastVisitDate: result.lastVisitDate || null,
    });
  }

  return statsMap;
}

// ==================== AUTHENTICATION HELPERS ====================

export async function markEmailAsVerified(userId: string): Promise<void> {
  await db.update(users).set({ emailVerified: true }).where(eq(users.id, userId));
}

export async function updateUserPassword(userId: string, hashedPassword: string): Promise<void> {
  await db.update(users).set({ password: hashedPassword }).where(eq(users.id, userId));
}

export async function updateUserReferralCode(userId: string, referralCode: string): Promise<User | undefined> {
  const result = await db.update(users)
    .set({ referralCode })
    .where(eq(users.id, userId))
    .returning();
  return result[0];
}
