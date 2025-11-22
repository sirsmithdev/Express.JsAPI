/**
 * Estimates Storage Module
 * Handles all database operations related to estimates and estimate items
 */

import {
  db,
  eq,
  desc,
  sql,
  estimates,
  estimateItems,
  estimateNumberSequence,
  invoices,
  invoiceItems,
  invoiceNumberSequence,
  type Estimate,
  type InsertEstimate,
  type EstimateItem,
  type InsertEstimateItem,
  type Invoice,
  type InsertInvoice,
} from "./base";

export class EstimatesStorage {
  // ========================================
  // ESTIMATE METHODS
  // ========================================

  async getEstimate(id: string): Promise<Estimate | undefined> {
    const result = await db.select().from(estimates).where(eq(estimates.id, id)).limit(1);
    return result[0];
  }

  async getEstimateByNumber(estimateNumber: string): Promise<Estimate | undefined> {
    const result = await db.select().from(estimates).where(eq(estimates.estimateNumber, estimateNumber)).limit(1);
    return result[0];
  }

  async getAllEstimates(): Promise<Estimate[]> {
    return await db.select().from(estimates).orderBy(desc(estimates.createdAt));
  }

  async getEstimatesByCustomer(customerId: string): Promise<Estimate[]> {
    return await db.select().from(estimates).where(eq(estimates.customerId, customerId)).orderBy(desc(estimates.createdAt));
  }

  async getEstimatesByJobCard(jobCardId: string): Promise<Estimate[]> {
    return await db.select().from(estimates).where(eq(estimates.jobCardId, jobCardId)).orderBy(desc(estimates.createdAt));
  }

  async createEstimate(estimate: InsertEstimate): Promise<Estimate> {
    const result = await db.insert(estimates).values(estimate).returning();
    return result[0];
  }

  async createEstimateWithItems(estimate: InsertEstimate, items: InsertEstimateItem[]): Promise<Estimate> {
    return await db.transaction(async (tx) => {
      const result = await tx.insert(estimates).values(estimate).returning();
      const createdEstimate = result[0];

      if (items && items.length > 0) {
        await tx.insert(estimateItems).values(
          items.map((item) => ({ ...item, estimateId: createdEstimate.id }))
        );
      }

      return createdEstimate;
    });
  }

  async updateEstimate(id: string, estimate: Partial<InsertEstimate>): Promise<Estimate | undefined> {
    const updateData = { ...estimate, updatedAt: new Date() };
    const result = await db.update(estimates).set(updateData).where(eq(estimates.id, id)).returning();
    return result[0];
  }

  async generateEstimateNumber(): Promise<string> {
    return await db.transaction(async (tx) => {
      const currentYear = new Date().getFullYear();
      const prefix = `EST-${currentYear}-`;

      const result = await tx
        .insert(estimateNumberSequence)
        .values({ year: currentYear, lastNumber: 1 })
        .onConflictDoUpdate({
          target: estimateNumberSequence.year,
          set: { lastNumber: sql`${estimateNumberSequence.lastNumber} + 1` },
        })
        .returning();

      const nextNumber = result[0].lastNumber;
      const paddedNumber = String(nextNumber).padStart(4, "0");
      return `${prefix}${paddedNumber}`;
    });
  }

  async convertEstimateToInvoice(estimateId: string): Promise<Invoice> {
    return await db.transaction(async (tx) => {
      // Get the estimate and its items
      const estimate = await this.getEstimate(estimateId);
      if (!estimate) {
        throw new Error("Estimate not found");
      }

      const items = await this.getEstimateItems(estimateId);

      // Generate invoice number
      const currentYear = new Date().getFullYear();
      const prefix = `INV-${currentYear}-`;

      const invoiceResult = await tx
        .insert(invoiceNumberSequence)
        .values({ year: currentYear, lastNumber: 1 })
        .onConflictDoUpdate({
          target: invoiceNumberSequence.year,
          set: { lastNumber: sql`${invoiceNumberSequence.lastNumber} + 1` },
        })
        .returning();

      const nextNumber = invoiceResult[0].lastNumber;
      const invoiceNumber = `${prefix}${String(nextNumber).padStart(4, "0")}`;

      // Create invoice from estimate
      const invoiceData: InsertInvoice = {
        invoiceNumber,
        customerId: estimate.customerId,
        jobCardId: estimate.jobCardId || undefined,
        status: "draft",
        issueDate: new Date(),
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
        subtotal: estimate.subtotal,
        tax: estimate.tax,
        total: estimate.total,
        notes: estimate.notes || undefined,
      };

      const invoiceInsertResult = await tx.insert(invoices).values(invoiceData).returning();
      const invoice = invoiceInsertResult[0];

      // Copy estimate items to invoice items
      if (items.length > 0) {
        await tx.insert(invoiceItems).values(
          items.map((item) => ({
            invoiceId: invoice.id,
            description: item.description,
            type: item.type,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            total: item.total,
          }))
        );
      }

      // Update estimate to mark as converted
      await tx.update(estimates)
        .set({
          status: "converted",
          convertedToInvoice: invoice.id,
          updatedAt: new Date(),
        })
        .where(eq(estimates.id, estimateId));

      return invoice;
    });
  }

  // ========================================
  // ESTIMATE ITEMS METHODS
  // ========================================

  async getEstimateItems(estimateId: string): Promise<EstimateItem[]> {
    return await db.select().from(estimateItems).where(eq(estimateItems.estimateId, estimateId));
  }

  async createEstimateItem(item: InsertEstimateItem): Promise<EstimateItem> {
    const result = await db.insert(estimateItems).values(item).returning();
    return result[0];
  }

  async deleteEstimateItems(estimateId: string): Promise<void> {
    await db.delete(estimateItems).where(eq(estimateItems.estimateId, estimateId));
  }
}

// Export singleton instance
export const estimatesStorage = new EstimatesStorage();
