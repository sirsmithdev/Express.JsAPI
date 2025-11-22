/**
 * CRM Storage Module
 * Handles all database operations related to CRM functionality:
 * - Leads and lead activities
 * - Customer tags and tag assignments
 * - Customer segments
 */

import {
  db,
  eq,
  and,
  or,
  desc,
  ilike,
  leads,
  leadActivities,
  customerTags,
  customerTagAssignments,
  customerSegments,
  users,
  type Lead,
  type InsertLead,
  type LeadActivity,
  type InsertLeadActivity,
  type CustomerTag,
  type InsertCustomerTag,
  type CustomerTagAssignment,
  type InsertCustomerTagAssignment,
  type CustomerSegment,
  type InsertCustomerSegment,
  type User,
  type InsertUser,
} from "./base";

export class CrmStorage {
  // ========================================
  // LEADS METHODS
  // ========================================

  async createLead(data: InsertLead): Promise<Lead> {
    const [lead] = await db.insert(leads).values(data).returning();
    return lead;
  }

  async getLeadById(id: string): Promise<Lead | undefined> {
    const [lead] = await db
      .select()
      .from(leads)
      .where(eq(leads.id, id))
      .limit(1);
    return lead;
  }

  async getAllLeads(filters?: {
    status?: string;
    source?: string;
    assignedToId?: string;
    search?: string;
  }): Promise<Lead[]> {
    const conditions = [];

    if (filters?.status) {
      conditions.push(eq(leads.status, filters.status as any));
    }
    if (filters?.source) {
      conditions.push(eq(leads.source, filters.source as any));
    }
    if (filters?.assignedToId) {
      conditions.push(eq(leads.assignedToId, filters.assignedToId));
    }
    if (filters?.search) {
      const searchPattern = `%${filters.search}%`;
      conditions.push(
        or(
          ilike(leads.firstName, searchPattern),
          ilike(leads.lastName, searchPattern),
          ilike(leads.email, searchPattern),
          ilike(leads.phone, searchPattern),
          ilike(leads.company, searchPattern)
        )
      );
    }

    let query = db.select().from(leads);

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }

    const results = await query.orderBy(desc(leads.createdAt));
    return results;
  }

  async updateLead(id: string, data: Partial<InsertLead>): Promise<Lead | undefined> {
    const [updated] = await db
      .update(leads)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(leads.id, id))
      .returning();
    return updated;
  }

  async deleteLead(id: string): Promise<void> {
    await db.delete(leads).where(eq(leads.id, id));
  }

  async convertLeadToCustomer(leadId: string, customerData: InsertUser): Promise<{ customer: User; lead: Lead }> {
    return await db.transaction(async (tx) => {
      // Create customer
      const [customer] = await tx.insert(users).values(customerData).returning();

      // Update lead with conversion info
      const [updatedLead] = await tx
        .update(leads)
        .set({
          status: "converted" as any,
          convertedToCustomerId: customer.id,
          convertedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(leads.id, leadId))
        .returning();

      return { customer, lead: updatedLead };
    });
  }

  async getLeadsByAssignedUser(userId: string): Promise<Lead[]> {
    return await db
      .select()
      .from(leads)
      .where(eq(leads.assignedToId, userId))
      .orderBy(desc(leads.createdAt));
  }

  async getLeadStats(): Promise<{
    total: number;
    byStatus: Record<string, number>;
    bySource: Record<string, number>;
  }> {
    const allLeads = await db.select().from(leads);

    const byStatus: Record<string, number> = {};
    const bySource: Record<string, number> = {};

    allLeads.forEach((lead) => {
      byStatus[lead.status] = (byStatus[lead.status] || 0) + 1;
      bySource[lead.source] = (bySource[lead.source] || 0) + 1;
    });

    return {
      total: allLeads.length,
      byStatus,
      bySource,
    };
  }

  // ========================================
  // LEAD ACTIVITIES METHODS
  // ========================================

  async createLeadActivity(data: InsertLeadActivity): Promise<LeadActivity> {
    const [activity] = await db.insert(leadActivities).values(data).returning();
    return activity;
  }

  async getLeadActivitiesByLeadId(leadId: string): Promise<LeadActivity[]> {
    return await db
      .select()
      .from(leadActivities)
      .where(eq(leadActivities.leadId, leadId))
      .orderBy(desc(leadActivities.createdAt));
  }

  async getLeadActivityById(id: string): Promise<LeadActivity | undefined> {
    const [activity] = await db
      .select()
      .from(leadActivities)
      .where(eq(leadActivities.id, id))
      .limit(1);
    return activity;
  }

  async deleteLeadActivity(id: string): Promise<void> {
    await db.delete(leadActivities).where(eq(leadActivities.id, id));
  }

  // ========================================
  // CUSTOMER TAGS METHODS
  // ========================================

  async createCustomerTag(data: InsertCustomerTag): Promise<CustomerTag> {
    const [tag] = await db.insert(customerTags).values(data).returning();
    return tag;
  }

  async getAllCustomerTags(): Promise<CustomerTag[]> {
    return await db.select().from(customerTags).orderBy(customerTags.name);
  }

  async getCustomerTagById(id: string): Promise<CustomerTag | undefined> {
    const [tag] = await db
      .select()
      .from(customerTags)
      .where(eq(customerTags.id, id))
      .limit(1);
    return tag;
  }

  async updateCustomerTag(id: string, data: Partial<InsertCustomerTag>): Promise<CustomerTag | undefined> {
    const [updated] = await db
      .update(customerTags)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(customerTags.id, id))
      .returning();
    return updated;
  }

  async deleteCustomerTag(id: string): Promise<void> {
    await db.delete(customerTags).where(eq(customerTags.id, id));
  }

  // ========================================
  // CUSTOMER TAG ASSIGNMENTS METHODS
  // ========================================

  async assignTagToCustomer(data: InsertCustomerTagAssignment): Promise<CustomerTagAssignment> {
    const [assignment] = await db.insert(customerTagAssignments).values(data).returning();
    return assignment;
  }

  async removeTagFromCustomer(customerId: string, tagId: string): Promise<void> {
    await db
      .delete(customerTagAssignments)
      .where(
        and(
          eq(customerTagAssignments.customerId, customerId),
          eq(customerTagAssignments.tagId, tagId)
        )
      );
  }

  async getCustomerTags(customerId: string): Promise<CustomerTag[]> {
    const result = await db
      .select({
        id: customerTags.id,
        name: customerTags.name,
        color: customerTags.color,
        description: customerTags.description,
        createdAt: customerTags.createdAt,
        updatedAt: customerTags.updatedAt,
      })
      .from(customerTagAssignments)
      .innerJoin(customerTags, eq(customerTagAssignments.tagId, customerTags.id))
      .where(eq(customerTagAssignments.customerId, customerId));

    return result;
  }

  async getCustomersByTag(tagId: string): Promise<User[]> {
    const result = await db
      .select({
        id: users.id,
        email: users.email,
        password: users.password,
        emailVerified: users.emailVerified,
        firstName: users.firstName,
        lastName: users.lastName,
        profileImageUrl: users.profileImageUrl,
        role: users.role,
        customerType: users.customerType,
        accountNumber: users.accountNumber,
        phone: users.phone,
        address: users.address,
        billingEmail: users.billingEmail,
        ccEmail: users.ccEmail,
        permissions: users.permissions,
        reviewRequestsEnabled: users.reviewRequestsEnabled,
        isActive: users.isActive,
        pushToken: users.pushToken,
        referralCode: users.referralCode,
        paymentTerms: users.paymentTerms,
        creditLimit: users.creditLimit,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(customerTagAssignments)
      .innerJoin(users, eq(customerTagAssignments.customerId, users.id))
      .where(eq(customerTagAssignments.tagId, tagId));

    return result;
  }

  // ========================================
  // CUSTOMER SEGMENTS METHODS
  // ========================================

  async createCustomerSegment(data: InsertCustomerSegment): Promise<CustomerSegment> {
    const [segment] = await db.insert(customerSegments).values(data).returning();
    return segment;
  }

  async getAllCustomerSegments(userId?: string): Promise<CustomerSegment[]> {
    if (userId) {
      // Return public segments and user's private segments
      return await db
        .select()
        .from(customerSegments)
        .where(
          or(
            eq(customerSegments.isPublic, true),
            eq(customerSegments.createdById, userId)
          )
        )
        .orderBy(customerSegments.name);
    }

    // Return all public segments
    return await db
      .select()
      .from(customerSegments)
      .where(eq(customerSegments.isPublic, true))
      .orderBy(customerSegments.name);
  }

  async getCustomerSegmentById(id: string): Promise<CustomerSegment | undefined> {
    const [segment] = await db
      .select()
      .from(customerSegments)
      .where(eq(customerSegments.id, id))
      .limit(1);
    return segment;
  }

  async updateCustomerSegment(id: string, data: Partial<InsertCustomerSegment>): Promise<CustomerSegment | undefined> {
    const [updated] = await db
      .update(customerSegments)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(customerSegments.id, id))
      .returning();
    return updated;
  }

  async deleteCustomerSegment(id: string): Promise<void> {
    await db.delete(customerSegments).where(eq(customerSegments.id, id));
  }

  async updateSegmentCustomerCount(segmentId: string, count: number): Promise<void> {
    await db
      .update(customerSegments)
      .set({
        customerCount: count,
        lastCalculatedAt: new Date(),
      })
      .where(eq(customerSegments.id, segmentId));
  }
}

// Export singleton instance
export const crmStorage = new CrmStorage();
