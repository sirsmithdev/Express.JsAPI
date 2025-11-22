/**
 * Miscellaneous Storage Module
 * Handles various utility and helper data operations:
 * - Dashboard statistics
 * - Job card timer sessions
 * - Approval requests
 * - Customer notes
 * - Notifications (placeholder for future implementation)
 */

import {
  db,
  eq,
  and,
  or,
  desc,
  sql,
  gte,
  lte,
  inArray,
  count,
  sum,
  jobCards,
  jobCardTimerSessions,
  type JobCardTimerSession,
  type InsertJobCardTimerSession,
  approvalRequests,
  type ApprovalRequest,
  type InsertApprovalRequest,
  customerNotes,
  type CustomerNote,
  type InsertCustomerNote,
  users,
  invoices,
  appointments,
  vehicles,
  partsInventory,
} from "./base";

// Dashboard Stats Interface
export interface DashboardStats {
  totalRevenue: number;
  pendingApprovals: number;
  activeJobCards: number;
  lowStockItems: number;
  todayAppointments: number;
  totalCustomers: number;
  overdueInvoices: number;
  revenueThisWeek: number;
  jobCardsByStatus: {
    scheduled: number;
    in_progress: number;
    awaiting_parts: number;
    completed: number;
  };
  recentJobCards: Array<{
    id: string;
    customerName: string;
    vehicleInfo: string;
    status: string;
    scheduledDate: Date;
    mechanicName: string | null;
  }>;
  upcomingAppointments: Array<{
    id: string;
    customerName: string;
    vehicleInfo: string;
    scheduledDate: Date;
    serviceType: string;
  }>;
}

class MiscStorage {
  // ============================================================
  // DASHBOARD STATISTICS
  // ============================================================

  async getDashboardStats(): Promise<DashboardStats> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    // Get total revenue (sum of paid invoices)
    const revenueResult = await db
      .select({ total: sum(invoices.total) })
      .from(invoices)
      .where(eq(invoices.status, 'paid'));
    const totalRevenue = Number(revenueResult[0]?.total || 0);

    // Get revenue this week
    const weekRevenueResult = await db
      .select({ total: sum(invoices.total) })
      .from(invoices)
      .where(and(
        eq(invoices.status, 'paid'),
        gte(invoices.issueDate, weekAgo)
      ));
    const revenueThisWeek = Number(weekRevenueResult[0]?.total || 0);

    // Get pending approvals count
    const pendingApprovalsResult = await db
      .select({ count: count() })
      .from(approvalRequests)
      .where(eq(approvalRequests.status, 'pending'));
    const pendingApprovals = Number(pendingApprovalsResult[0]?.count || 0);

    // Get active job cards count
    const activeJobCardsResult = await db
      .select({ count: count() })
      .from(jobCards)
      .where(or(
        eq(jobCards.status, 'in_progress'),
        eq(jobCards.status, 'scheduled'),
        eq(jobCards.status, 'awaiting_parts')
      ));
    const activeJobCards = Number(activeJobCardsResult[0]?.count || 0);

    // Get low stock items count
    const lowStockItemsResult = await db
      .select({ count: count() })
      .from(partsInventory)
      .where(sql`${partsInventory.quantity} < ${partsInventory.lowStockThreshold}`);
    const lowStockItems = Number(lowStockItemsResult[0]?.count || 0);

    // Get today's appointments count
    const todayAppointmentsResult = await db
      .select({ count: count() })
      .from(appointments)
      .where(and(
        gte(appointments.scheduledDate, today),
        lte(appointments.scheduledDate, tomorrow)
      ));
    const todayAppointments = Number(todayAppointmentsResult[0]?.count || 0);

    // Get total customers count
    const totalCustomersResult = await db
      .select({ count: count() })
      .from(users)
      .where(eq(users.role, 'customer'));
    const totalCustomers = Number(totalCustomersResult[0]?.count || 0);

    // Get overdue invoices count
    const overdueInvoicesResult = await db
      .select({ count: count() })
      .from(invoices)
      .where(and(
        inArray(invoices.status, ['sent', 'overdue']),
        lte(invoices.dueDate, new Date())
      ));
    const overdueInvoices = Number(overdueInvoicesResult[0]?.count || 0);

    // Get job cards by status
    const scheduledCount = await db
      .select({ count: count() })
      .from(jobCards)
      .where(eq(jobCards.status, 'scheduled'));
    const inProgressCount = await db
      .select({ count: count() })
      .from(jobCards)
      .where(eq(jobCards.status, 'in_progress'));
    const awaitingPartsCount = await db
      .select({ count: count() })
      .from(jobCards)
      .where(eq(jobCards.status, 'awaiting_parts'));
    const completedCount = await db
      .select({ count: count() })
      .from(jobCards)
      .where(eq(jobCards.status, 'completed'));

    const jobCardsByStatus = {
      scheduled: Number(scheduledCount[0]?.count || 0),
      in_progress: Number(inProgressCount[0]?.count || 0),
      awaiting_parts: Number(awaitingPartsCount[0]?.count || 0),
      completed: Number(completedCount[0]?.count || 0),
    };

    // Get recent job cards (last 5)
    const recentJobCardsData = await db
      .select({
        id: jobCards.id,
        status: jobCards.status,
        scheduledDate: jobCards.scheduledDate,
        customerFirstName: users.firstName,
        customerLastName: users.lastName,
        vehicleMake: vehicles.make,
        vehicleModel: vehicles.model,
        vehicleYear: vehicles.year,
        mechanicFirstName: sql<string>`mechanic.first_name`,
        mechanicLastName: sql<string>`mechanic.last_name`,
      })
      .from(jobCards)
      .leftJoin(users, eq(jobCards.customerId, users.id))
      .leftJoin(vehicles, eq(jobCards.vehicleId, vehicles.id))
      .leftJoin(sql`users as mechanic`, sql`${jobCards.mechanicId} = mechanic.id`)
      .orderBy(desc(jobCards.createdAt))
      .limit(5);

    const recentJobCards = recentJobCardsData.map(jc => ({
      id: jc.id,
      customerName: `${jc.customerFirstName || ''} ${jc.customerLastName || ''}`.trim() || 'Unknown',
      vehicleInfo: `${jc.vehicleYear || ''} ${jc.vehicleMake || ''} ${jc.vehicleModel || ''}`.trim() || 'Unknown',
      status: jc.status,
      scheduledDate: jc.scheduledDate,
      mechanicName: jc.mechanicFirstName && jc.mechanicLastName
        ? `${jc.mechanicFirstName} ${jc.mechanicLastName}`
        : null,
    }));

    // Get upcoming appointments (next 5)
    const upcomingAppointmentsData = await db
      .select({
        id: appointments.id,
        scheduledDate: appointments.scheduledDate,
        serviceType: appointments.serviceType,
        customerFirstName: users.firstName,
        customerLastName: users.lastName,
        vehicleMake: vehicles.make,
        vehicleModel: vehicles.model,
        vehicleYear: vehicles.year,
      })
      .from(appointments)
      .leftJoin(users, eq(appointments.customerId, users.id))
      .leftJoin(vehicles, eq(appointments.vehicleId, vehicles.id))
      .where(gte(appointments.scheduledDate, new Date()))
      .orderBy(appointments.scheduledDate)
      .limit(5);

    const upcomingAppointments = upcomingAppointmentsData.map(apt => ({
      id: apt.id,
      customerName: `${apt.customerFirstName || ''} ${apt.customerLastName || ''}`.trim() || 'Unknown',
      vehicleInfo: `${apt.vehicleYear || ''} ${apt.vehicleMake || ''} ${apt.vehicleModel || ''}`.trim() || 'Unknown',
      scheduledDate: apt.scheduledDate,
      serviceType: apt.serviceType,
    }));

    return {
      totalRevenue,
      pendingApprovals,
      activeJobCards,
      lowStockItems,
      todayAppointments,
      totalCustomers,
      overdueInvoices,
      revenueThisWeek,
      jobCardsByStatus,
      recentJobCards,
      upcomingAppointments,
    };
  }

  // ============================================================
  // JOB CARD TIMER SESSIONS
  // ============================================================

  async getActiveTimerSession(jobCardId: string): Promise<JobCardTimerSession | undefined> {
    const result = await db.select().from(jobCardTimerSessions)
      .where(and(
        eq(jobCardTimerSessions.jobCardId, jobCardId),
        eq(jobCardTimerSessions.isActive, true)
      ))
      .limit(1);
    return result[0];
  }

  async getJobCardTimerSessions(sessionId: string): Promise<JobCardTimerSession[]> {
    return await db.select().from(jobCardTimerSessions).where(eq(jobCardTimerSessions.id, sessionId));
  }

  async createTimerSession(session: InsertJobCardTimerSession): Promise<JobCardTimerSession> {
    const result = await db.insert(jobCardTimerSessions).values(session).returning();
    return result[0];
  }

  async updateTimerSession(id: string, session: Partial<InsertJobCardTimerSession>): Promise<JobCardTimerSession | undefined> {
    const result = await db.update(jobCardTimerSessions).set(session).where(eq(jobCardTimerSessions.id, id)).returning();
    return result[0];
  }

  // ============================================================
  // APPROVAL REQUESTS
  // ============================================================

  async getApprovalRequest(id: string): Promise<ApprovalRequest | undefined> {
    const result = await db.select().from(approvalRequests).where(eq(approvalRequests.id, id)).limit(1);
    return result[0];
  }

  async getPendingApprovals(): Promise<any[]> {
    const results = await db
      .select({
        id: approvalRequests.id,
        customerId: approvalRequests.customerId,
        appointmentId: approvalRequests.appointmentId,
        type: approvalRequests.type,
        requestedDate: approvalRequests.requestedDate,
        currentDate: approvalRequests.currentDate,
        reason: approvalRequests.reason,
        status: approvalRequests.status,
        reviewedBy: approvalRequests.reviewedBy,
        reviewNotes: approvalRequests.reviewNotes,
        createdAt: approvalRequests.createdAt,
        reviewedAt: approvalRequests.reviewedAt,
        customerFirstName: users.firstName,
        customerLastName: users.lastName,
        customerEmail: users.email,
      })
      .from(approvalRequests)
      .leftJoin(users, eq(approvalRequests.customerId, users.id))
      .where(eq(approvalRequests.status, 'pending'))
      .orderBy(desc(approvalRequests.createdAt));

    // For each approval, get appointment and vehicle info if appointmentId exists
    const enrichedResults = await Promise.all(
      results.map(async (approval) => {
        let vehicleInfo = null;
        let appointment = null;

        if (approval.appointmentId) {
          // Fetch appointment
          const [appt] = await db.select().from(appointments).where(eq(appointments.id, approval.appointmentId)).limit(1);
          if (appt && appt.vehicleId) {
            appointment = appt;
            // Fetch vehicle
            const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.id, appt.vehicleId)).limit(1);
            if (vehicle) {
              vehicleInfo = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
            }
          }
        }

        return {
          ...approval,
          customerName: approval.customerFirstName && approval.customerLastName
            ? `${approval.customerFirstName} ${approval.customerLastName}`
            : approval.customerEmail,
          vehicleInfo: vehicleInfo || 'Vehicle information not available',
          appointment,
        };
      })
    );

    return enrichedResults;
  }

  async createApprovalRequest(request: InsertApprovalRequest): Promise<ApprovalRequest> {
    const result = await db.insert(approvalRequests).values(request).returning();
    return result[0];
  }

  async updateApprovalRequest(id: string, request: Partial<InsertApprovalRequest>): Promise<ApprovalRequest | undefined> {
    const updateData: any = { ...request };
    if (request.status === "approved" || request.status === "denied") {
      updateData.reviewedAt = new Date();
    }
    const result = await db.update(approvalRequests).set(updateData).where(eq(approvalRequests.id, id)).returning();
    return result[0];
  }

  // ============================================================
  // CUSTOMER NOTES
  // ============================================================

  async getNotesByCustomer(customerId: string): Promise<CustomerNote[]> {
    return await db.select().from(customerNotes).where(eq(customerNotes.customerId, customerId)).orderBy(desc(customerNotes.createdAt));
  }

  async createCustomerNote(note: InsertCustomerNote): Promise<CustomerNote> {
    const result = await db.insert(customerNotes).values(note).returning();
    return result[0];
  }

  // ============================================================
  // NOTIFICATIONS (Placeholder for future implementation)
  // ============================================================

  // Notification methods can be added here when needed
  // Examples:
  // - createNotification
  // - getNotificationsByUser
  // - markNotificationAsRead
  // - deleteNotification
  // - getBadgeCount
}

// Export singleton instance
export const miscStorage = new MiscStorage();
