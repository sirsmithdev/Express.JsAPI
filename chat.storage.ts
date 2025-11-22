/**
 * Chat Storage Module
 * Handles all database operations related to chat system:
 * - Chat conversations and messages
 * - Agent status and routing
 * - Quick responses and assignments
 * - Chat ratings and metrics
 * - Service reminders and maintenance schedules
 */

import {
  db,
  eq,
  and,
  or,
  desc,
  asc,
  sql,
  gte,
  lte,
  inArray,
  chatConversations,
  chatMessages,
  chatAssignments,
  chatQuickResponses,
  chatAgentStatus,
  chatRoutingSettings,
  chatSettings,
  chatRatings,
  serviceReminders,
  serviceReminderHistory,
  maintenanceSchedules,
  appointments,
  vehicles,
  users,
  type ChatConversation,
  type InsertChatConversation,
  type ChatMessage,
  type InsertChatMessage,
  type ChatAssignment,
  type ChatQuickResponse,
  type InsertChatQuickResponse,
  type ChatAgentStatus,
  type InsertChatAgentStatus,
  type ChatRoutingSettings,
  type ChatSettings,
  type ChatRating,
  type InsertChatRating,
  type ServiceReminder,
  type InsertServiceReminder,
  type ServiceReminderHistory,
  type InsertServiceReminderHistory,
  type MaintenanceSchedule,
  type InsertMaintenanceSchedule,
  type Appointment,
  type Vehicle,
  type User,
} from "./base";

export class ChatStorage {
  // ========================================
  // CHAT CONVERSATION METHODS
  // ========================================

  async createChatConversation(conversation: Partial<InsertChatConversation>): Promise<ChatConversation> {
    const [newConversation] = await db
      .insert(chatConversations)
      .values(conversation as InsertChatConversation)
      .returning();
    return newConversation;
  }

  async getChatConversation(id: string): Promise<ChatConversation | undefined> {
    const [conversation] = await db
      .select()
      .from(chatConversations)
      .where(eq(chatConversations.id, id));
    return conversation;
  }

  async getChatConversationByShareToken(shareToken: string): Promise<ChatConversation | undefined> {
    const [conversation] = await db
      .select()
      .from(chatConversations)
      .where(eq(chatConversations.shareToken, shareToken));
    return conversation;
  }

  async getActiveChatConversations(): Promise<ChatConversation[]> {
    return await db
      .select()
      .from(chatConversations)
      .where(eq(chatConversations.status, "active"))
      .orderBy(desc(chatConversations.lastMessageAt));
  }

  async getChatConversationsByCustomer(customerId: string): Promise<ChatConversation[]> {
    return await db
      .select()
      .from(chatConversations)
      .where(eq(chatConversations.customerId, customerId))
      .orderBy(desc(chatConversations.lastMessageAt));
  }

  async getChatConversationsBySession(sessionId: string): Promise<ChatConversation[]> {
    return await db
      .select()
      .from(chatConversations)
      .where(eq(chatConversations.sessionId, sessionId))
      .orderBy(desc(chatConversations.lastMessageAt));
  }

  async updateChatConversation(id: string, updates: Partial<ChatConversation>): Promise<ChatConversation> {
    const [updated] = await db
      .update(chatConversations)
      .set(updates)
      .where(eq(chatConversations.id, id))
      .returning();
    return updated;
  }

  async linkChatConversationsToCustomer(sessionId: string, customerId: string): Promise<void> {
    await db
      .update(chatConversations)
      .set({
        customerId,
        authenticatedAt: new Date(),
      })
      .where(and(
        eq(chatConversations.sessionId, sessionId),
        eq(chatConversations.status, "active")
      ));
  }

  async assignChatConversation(conversationId: string, staffId: string): Promise<ChatConversation> {
    // Update conversation
    const [updated] = await db
      .update(chatConversations)
      .set({ assignedStaffId: staffId })
      .where(eq(chatConversations.id, conversationId))
      .returning();

    // Create assignment record
    await db.insert(chatAssignments).values({
      conversationId,
      staffId,
    });

    return updated;
  }

  // ========================================
  // CHAT MESSAGE METHODS
  // ========================================

  async createChatMessage(message: Partial<InsertChatMessage>): Promise<ChatMessage> {
    const [newMessage] = await db
      .insert(chatMessages)
      .values(message as InsertChatMessage)
      .returning();
    return newMessage;
  }

  async getChatMessages(conversationId: string, limit = 100): Promise<ChatMessage[]> {
    return await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.conversationId, conversationId))
      .orderBy(chatMessages.createdAt)
      .limit(limit);
  }

  async markMessageAsRead(messageId: string): Promise<void> {
    await db
      .update(chatMessages)
      .set({ readAt: new Date() })
      .where(eq(chatMessages.id, messageId));
  }

  // ========================================
  // CHAT QUICK RESPONSE METHODS
  // ========================================

  async createChatQuickResponse(response: InsertChatQuickResponse): Promise<ChatQuickResponse> {
    const [newResponse] = await db
      .insert(chatQuickResponses)
      .values(response)
      .returning();
    return newResponse;
  }

  async getChatQuickResponses(): Promise<ChatQuickResponse[]> {
    return await db
      .select()
      .from(chatQuickResponses)
      .orderBy(chatQuickResponses.category, chatQuickResponses.title);
  }

  async updateChatQuickResponse(id: string, updates: Partial<ChatQuickResponse>): Promise<ChatQuickResponse> {
    const [updated] = await db
      .update(chatQuickResponses)
      .set(updates)
      .where(eq(chatQuickResponses.id, id))
      .returning();
    return updated;
  }

  async deleteChatQuickResponse(id: string): Promise<void> {
    await db
      .delete(chatQuickResponses)
      .where(eq(chatQuickResponses.id, id));
  }

  // ========================================
  // CHAT ASSIGNMENT METHODS
  // ========================================

  async getChatAssignmentHistory(conversationId: string): Promise<ChatAssignment[]> {
    return await db
      .select()
      .from(chatAssignments)
      .where(eq(chatAssignments.conversationId, conversationId))
      .orderBy(desc(chatAssignments.assignedAt));
  }

  // ========================================
  // CHAT SETTINGS METHODS
  // ========================================

  async getChatSettings(): Promise<ChatSettings> {
    // Try to get existing settings
    const [existing] = await db
      .select()
      .from(chatSettings)
      .where(eq(chatSettings.id, 1))
      .limit(1);

    // If no settings exist, create default settings
    if (!existing) {
      const [created] = await db
        .insert(chatSettings)
        .values({ id: 1 })
        .returning();
      return created;
    }

    return existing;
  }

  async updateChatSettings(updates: Partial<ChatSettings>): Promise<ChatSettings> {
    const [updated] = await db
      .update(chatSettings)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(chatSettings.id, 1))
      .returning();

    return updated;
  }

  // ========================================
  // CHAT AGENT STATUS METHODS
  // ========================================

  async getAgentStatus(userId: string): Promise<ChatAgentStatus | undefined> {
    const [status] = await db
      .select()
      .from(chatAgentStatus)
      .where(eq(chatAgentStatus.userId, userId))
      .limit(1);
    return status;
  }

  async getAllAgentStatuses(): Promise<ChatAgentStatus[]> {
    return await db
      .select()
      .from(chatAgentStatus)
      .orderBy(chatAgentStatus.lastActivityAt);
  }

  async getAvailableAgents(): Promise<ChatAgentStatus[]> {
    return await db
      .select()
      .from(chatAgentStatus)
      .where(eq(chatAgentStatus.status, "available"))
      .orderBy(chatAgentStatus.currentChatCount);
  }

  async upsertAgentStatus(userId: string, data: Partial<InsertChatAgentStatus>): Promise<ChatAgentStatus> {
    const existing = await this.getAgentStatus(userId);

    if (existing) {
      const [updated] = await db
        .update(chatAgentStatus)
        .set({
          ...data,
          lastActivityAt: new Date(),
          lastStatusChangeAt: data.status ? new Date() : existing.lastStatusChangeAt,
        })
        .where(eq(chatAgentStatus.userId, userId))
        .returning();
      return updated;
    } else {
      const [created] = await db
        .insert(chatAgentStatus)
        .values({
          userId,
          ...data,
          lastActivityAt: new Date(),
          lastStatusChangeAt: new Date(),
        })
        .returning();
      return created;
    }
  }

  async incrementAgentChatCount(userId: string): Promise<void> {
    await db
      .update(chatAgentStatus)
      .set({
        currentChatCount: sql`${chatAgentStatus.currentChatCount} + 1`,
        lastActivityAt: new Date(),
      })
      .where(eq(chatAgentStatus.userId, userId));
  }

  async decrementAgentChatCount(userId: string): Promise<void> {
    await db
      .update(chatAgentStatus)
      .set({
        currentChatCount: sql`GREATEST(${chatAgentStatus.currentChatCount} - 1, 0)`,
        lastActivityAt: new Date(),
      })
      .where(eq(chatAgentStatus.userId, userId));
  }

  async updateAgentActivity(userId: string): Promise<void> {
    await db
      .update(chatAgentStatus)
      .set({ lastActivityAt: new Date() })
      .where(eq(chatAgentStatus.userId, userId));
  }

  // ========================================
  // CHAT ROUTING SETTINGS METHODS
  // ========================================

  async getChatRoutingSettings(): Promise<ChatRoutingSettings> {
    const [existing] = await db
      .select()
      .from(chatRoutingSettings)
      .where(eq(chatRoutingSettings.id, 1))
      .limit(1);

    if (!existing) {
      const [created] = await db
        .insert(chatRoutingSettings)
        .values({ id: 1 })
        .returning();
      return created;
    }

    return existing;
  }

  async updateChatRoutingSettings(updates: Partial<ChatRoutingSettings>): Promise<ChatRoutingSettings> {
    const [updated] = await db
      .update(chatRoutingSettings)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(chatRoutingSettings.id, 1))
      .returning();

    return updated;
  }

  async incrementRoundRobinIndex(): Promise<number> {
    const [updated] = await db
      .update(chatRoutingSettings)
      .set({
        roundRobinIndex: sql`${chatRoutingSettings.roundRobinIndex} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(chatRoutingSettings.id, 1))
      .returning();

    return updated.roundRobinIndex;
  }

  // ========================================
  // CHAT RATINGS METHODS
  // ========================================

  async createChatRating(data: InsertChatRating): Promise<ChatRating> {
    const [rating] = await db
      .insert(chatRatings)
      .values(data)
      .returning();
    return rating;
  }

  async getChatRating(id: string): Promise<ChatRating | undefined> {
    const [rating] = await db
      .select()
      .from(chatRatings)
      .where(eq(chatRatings.id, id))
      .limit(1);
    return rating;
  }

  async getChatRatingByConversation(conversationId: string): Promise<ChatRating | undefined> {
    const [rating] = await db
      .select()
      .from(chatRatings)
      .where(eq(chatRatings.conversationId, conversationId))
      .limit(1);
    return rating;
  }

  async getChatRatingsByStaff(staffId: string): Promise<ChatRating[]> {
    return await db
      .select()
      .from(chatRatings)
      .where(eq(chatRatings.staffId, staffId))
      .orderBy(desc(chatRatings.createdAt));
  }

  async getAverageRatingForStaff(staffId: string): Promise<number> {
    const result = await db
      .select({ avgRating: sql<number>`AVG(${chatRatings.rating})` })
      .from(chatRatings)
      .where(eq(chatRatings.staffId, staffId));

    return result[0]?.avgRating || 0;
  }

  // ========================================
  // CHAT METRICS METHODS
  // ========================================

  async updateConversationFirstResponse(conversationId: string): Promise<void> {
    const conversation = await this.getChatConversation(conversationId);
    if (!conversation || conversation.firstResponseAt) return;

    await db
      .update(chatConversations)
      .set({
        firstResponseAt: new Date(),
      })
      .where(eq(chatConversations.id, conversationId));
  }

  async calculateConversationMetrics(conversationId: string): Promise<void> {
    // Get all messages for the conversation
    const messages = await this.getChatMessages(conversationId);

    const staffMessages = messages.filter(m => m.senderType === 'staff');
    const customerMessages = messages.filter(m => m.senderType === 'customer');

    if (staffMessages.length === 0) return;

    // Calculate average response time
    let totalResponseTime = 0;
    let responseCount = 0;

    for (let i = 0; i < staffMessages.length; i++) {
      const staffMsg = staffMessages[i];
      const prevCustomerMsg = customerMessages
        .filter(m => new Date(m.createdAt) < new Date(staffMsg.createdAt))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

      if (prevCustomerMsg) {
        const responseTime = new Date(staffMsg.createdAt).getTime() - new Date(prevCustomerMsg.createdAt).getTime();
        totalResponseTime += responseTime;
        responseCount++;
      }
    }

    const averageResponseTime = responseCount > 0 ? totalResponseTime / responseCount / 1000 : 0; // Convert to seconds

    await db
      .update(chatConversations)
      .set({ averageResponseTime: averageResponseTime.toFixed(2) })
      .where(eq(chatConversations.id, conversationId));
  }

  async getAgentPerformanceMetrics(staffId: string, startDate?: Date, endDate?: Date): Promise<{
    totalChats: number;
    averageFRT: number;
    averageART: number;
    averageResolutionTime: number;
    averageCSAT: number;
  }> {
    const conditions = [eq(chatConversations.assignedStaffId, staffId)];

    if (startDate) {
      conditions.push(gte(chatConversations.createdAt, startDate));
    }
    if (endDate) {
      conditions.push(lte(chatConversations.createdAt, endDate));
    }

    const [metrics] = await db
      .select({
        totalChats: sql<number>`COUNT(*)`,
        avgFRT: sql<number>`AVG(EXTRACT(EPOCH FROM (${chatConversations.firstResponseAt} - ${chatConversations.createdAt})))`,
        avgART: sql<number>`AVG(${chatConversations.averageResponseTime})`,
        avgResolutionTime: sql<number>`AVG(${chatConversations.resolutionTime})`,
      })
      .from(chatConversations)
      .where(and(...conditions));

    const avgCSAT = await this.getAverageRatingForStaff(staffId);

    return {
      totalChats: metrics?.totalChats || 0,
      averageFRT: metrics?.avgFRT || 0,
      averageART: metrics?.avgART || 0,
      averageResolutionTime: metrics?.avgResolutionTime || 0,
      averageCSAT: avgCSAT,
    };
  }

  // ========================================
  // SERVICE REMINDER METHODS
  // ========================================

  async createServiceReminder(reminder: InsertServiceReminder): Promise<ServiceReminder> {
    const [newReminder] = await db
      .insert(serviceReminders)
      .values(reminder)
      .returning();
    return newReminder;
  }

  async getServiceReminders(filters?: { status?: string; type?: string }): Promise<ServiceReminder[]> {
    const conditions = [];
    if (filters?.status) {
      conditions.push(eq(serviceReminders.status, filters.status as any));
    }
    if (filters?.type) {
      conditions.push(eq(serviceReminders.type, filters.type as any));
    }

    let query = db.select().from(serviceReminders);

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }

    return await query.orderBy(desc(serviceReminders.createdAt));
  }

  async getServiceReminderById(id: string): Promise<ServiceReminder | null> {
    const [reminder] = await db
      .select()
      .from(serviceReminders)
      .where(eq(serviceReminders.id, id));
    return reminder || null;
  }

  async updateServiceReminder(id: string, updates: Partial<ServiceReminder>): Promise<ServiceReminder> {
    const [updated] = await db
      .update(serviceReminders)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(serviceReminders.id, id))
      .returning();
    return updated;
  }

  async deleteServiceReminder(id: string): Promise<void> {
    await db
      .delete(serviceReminders)
      .where(eq(serviceReminders.id, id));
  }

  async getUpcomingAppointmentsForReminders(daysAhead: number): Promise<Appointment[]> {
    const now = new Date();
    const futureDate = new Date();
    futureDate.setDate(now.getDate() + daysAhead);

    return await db
      .select()
      .from(appointments)
      .where(
        and(
          gte(appointments.scheduledDate, now),
          lte(appointments.scheduledDate, futureDate),
          inArray(appointments.status, ["scheduled", "confirmed"])
        )
      );
  }

  // ========================================
  // SERVICE REMINDER HISTORY METHODS
  // ========================================

  async logReminderSent(history: InsertServiceReminderHistory): Promise<ServiceReminderHistory> {
    const [newHistory] = await db
      .insert(serviceReminderHistory)
      .values(history)
      .returning();
    return newHistory;
  }

  async getReminderHistory(filters?: {
    reminderId?: string;
    customerId?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<ServiceReminderHistory[]> {
    const conditions = [];
    if (filters?.reminderId) {
      conditions.push(eq(serviceReminderHistory.reminderId, filters.reminderId));
    }
    if (filters?.customerId) {
      conditions.push(eq(serviceReminderHistory.customerId, filters.customerId));
    }
    if (filters?.startDate) {
      conditions.push(gte(serviceReminderHistory.sentAt, filters.startDate));
    }
    if (filters?.endDate) {
      conditions.push(lte(serviceReminderHistory.sentAt, filters.endDate));
    }

    let query = db.select().from(serviceReminderHistory);

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }

    return await query.orderBy(desc(serviceReminderHistory.sentAt));
  }

  // ========================================
  // MAINTENANCE SCHEDULE METHODS
  // ========================================

  async createMaintenanceSchedule(schedule: InsertMaintenanceSchedule): Promise<MaintenanceSchedule> {
    const [newSchedule] = await db
      .insert(maintenanceSchedules)
      .values(schedule)
      .returning();
    return newSchedule;
  }

  async getVehicleMaintenanceSchedules(vehicleId: string): Promise<MaintenanceSchedule[]> {
    return await db
      .select()
      .from(maintenanceSchedules)
      .where(
        and(
          eq(maintenanceSchedules.vehicleId, vehicleId),
          eq(maintenanceSchedules.isActive, true)
        )
      )
      .orderBy(maintenanceSchedules.nextServiceDueDate);
  }

  async getAllMaintenanceSchedules(filters?: {
    overdue?: boolean;
    dueSoon?: boolean;
    daysAhead?: number;
  }): Promise<Array<MaintenanceSchedule & { vehicle?: Vehicle; customer?: User }>> {
    const conditions = [eq(maintenanceSchedules.isActive, true)];
    const now = new Date();

    if (filters?.overdue) {
      conditions.push(lte(maintenanceSchedules.nextServiceDueDate, now));
    }

    if (filters?.dueSoon && filters?.daysAhead) {
      const futureDate = new Date();
      futureDate.setDate(now.getDate() + filters.daysAhead);
      conditions.push(
        and(
          gte(maintenanceSchedules.nextServiceDueDate, now),
          lte(maintenanceSchedules.nextServiceDueDate, futureDate)
        ) as any
      );
    }

    const results = await db
      .select({
        maintenanceSchedule: maintenanceSchedules,
        vehicle: vehicles,
        customer: users,
      })
      .from(maintenanceSchedules)
      .leftJoin(vehicles, eq(maintenanceSchedules.vehicleId, vehicles.id))
      .leftJoin(users, eq(vehicles.customerId, users.id))
      .where(and(...conditions))
      .orderBy(maintenanceSchedules.nextServiceDueDate);

    return results.map((r) => ({
      ...r.maintenanceSchedule,
      vehicle: r.vehicle || undefined,
      customer: r.customer || undefined,
    }));
  }

  async updateMaintenanceSchedule(
    id: string,
    updates: Partial<MaintenanceSchedule>
  ): Promise<MaintenanceSchedule> {
    const [updated] = await db
      .update(maintenanceSchedules)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(maintenanceSchedules.id, id))
      .returning();
    return updated;
  }

  async deleteMaintenanceSchedule(id: string): Promise<void> {
    await db
      .delete(maintenanceSchedules)
      .where(eq(maintenanceSchedules.id, id));
  }

  async updateVehicleMileage(vehicleId: string, mileage: number): Promise<Vehicle> {
    const [updated] = await db
      .update(vehicles)
      .set({ currentMileage: mileage })
      .where(eq(vehicles.id, vehicleId))
      .returning();
    return updated;
  }
}

// Export singleton instance
export const chatStorage = new ChatStorage();
