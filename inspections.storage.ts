/**
 * Inspections Storage Module
 * Handles all database operations related to vehicle inspections and inspection items
 */

import {
  db,
  eq,
  desc,
  sql,
  inspections,
  inspectionItems,
  type Inspection,
  type InsertInspection,
  type InspectionItem,
  type InsertInspectionItem,
} from "./base";

export class InspectionsStorage {
  // ========================================
  // INSPECTION METHODS
  // ========================================

  async getInspection(id: string): Promise<Inspection | undefined> {
    const result = await db.select().from(inspections).where(eq(inspections.id, id)).limit(1);
    return result[0];
  }

  async getInspectionByNumber(inspectionNumber: string): Promise<Inspection | undefined> {
    const result = await db.select().from(inspections).where(eq(inspections.inspectionNumber, inspectionNumber)).limit(1);
    return result[0];
  }

  async getAllInspections(): Promise<Inspection[]> {
    return await db.select().from(inspections).orderBy(desc(inspections.createdAt));
  }

  async getInspectionsByCustomer(customerId: string): Promise<Inspection[]> {
    return await db.select().from(inspections).where(eq(inspections.customerId, customerId)).orderBy(desc(inspections.createdAt));
  }

  async getInspectionsByVehicle(vehicleId: string): Promise<Inspection[]> {
    return await db.select().from(inspections).where(eq(inspections.vehicleId, vehicleId)).orderBy(desc(inspections.createdAt));
  }

  async createInspection(inspection: InsertInspection): Promise<Inspection> {
    const result = await db.insert(inspections).values(inspection).returning();
    return result[0];
  }

  async createInspectionWithItems(inspection: InsertInspection, items: Omit<InsertInspectionItem, 'inspectionId'>[]): Promise<Inspection> {
    return await db.transaction(async (tx) => {
      const inspectionResult = await tx.insert(inspections).values(inspection).returning();
      const createdInspection = inspectionResult[0];

      if (items.length > 0) {
        const itemsWithInspectionId = items.map(item => ({
          ...item,
          inspectionId: createdInspection.id,
        }));
        await tx.insert(inspectionItems).values(itemsWithInspectionId);
      }

      return createdInspection;
    });
  }

  async updateInspection(id: string, inspection: Partial<InsertInspection>): Promise<Inspection | undefined> {
    const result = await db.update(inspections)
      .set({ ...inspection, updatedAt: new Date() })
      .where(eq(inspections.id, id))
      .returning();
    return result[0];
  }

  async generateInspectionNumber(): Promise<string> {
    return await db.transaction(async (tx) => {
      const currentYear = new Date().getFullYear();

      // Query for the last inspection number for this year
      const lastInspection = await tx
        .select({ inspectionNumber: inspections.inspectionNumber })
        .from(inspections)
        .where(sql`${inspections.inspectionNumber} LIKE ${`INS-${currentYear}-%`}`)
        .orderBy(desc(inspections.inspectionNumber))
        .limit(1);

      let nextNumber = 1;
      if (lastInspection.length > 0) {
        const lastNum = parseInt(lastInspection[0].inspectionNumber.split('-')[2]);
        nextNumber = lastNum + 1;
      }

      return `INS-${currentYear}-${String(nextNumber).padStart(4, '0')}`;
    });
  }

  // ========================================
  // INSPECTION ITEMS METHODS
  // ========================================

  async getInspectionItems(inspectionId: string): Promise<InspectionItem[]> {
    return await db.select().from(inspectionItems).where(eq(inspectionItems.inspectionId, inspectionId));
  }

  async createInspectionItem(inspectionId: string, item: InsertInspectionItem): Promise<InspectionItem> {
    const result = await db.insert(inspectionItems).values({ ...item, inspectionId }).returning();
    return result[0];
  }

  async deleteInspectionItems(inspectionId: string): Promise<void> {
    await db.delete(inspectionItems).where(eq(inspectionItems.inspectionId, inspectionId));
  }
}

// Export singleton instance
export const inspectionsStorage = new InspectionsStorage();
