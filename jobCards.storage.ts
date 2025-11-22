/**
 * Job Cards Storage Module
 * Handles all database operations for job cards, tasks, parts inventory, and job card parts
 */

import {
  db,
  eq,
  sql,
  jobCards,
  jobCardTasks,
  partsInventory,
  jobCardParts,
  type JobCard,
  type InsertJobCard,
  type JobCardTask,
  type InsertJobCardTask,
  type Part,
  type InsertPart,
  type JobCardPart,
  type InsertJobCardPart,
} from "./base";
import { getAppointment } from "./appointments.storage";

// Job Cards CRUD Operations

export async function getJobCard(id: string): Promise<JobCard | undefined> {
  const result = await db.select().from(jobCards).where(eq(jobCards.id, id)).limit(1);
  return result[0];
}

export async function getAllJobCards(): Promise<JobCard[]> {
  return await db.select().from(jobCards).orderBy(jobCards.scheduledDate);
}

export async function getJobCardsByMechanic(mechanicId: string): Promise<JobCard[]> {
  return await db.select().from(jobCards).where(eq(jobCards.mechanicId, mechanicId)).orderBy(jobCards.scheduledDate);
}

export async function getJobCardsByCustomer(customerId: string): Promise<JobCard[]> {
  return await db.select().from(jobCards).where(eq(jobCards.customerId, customerId)).orderBy(jobCards.scheduledDate);
}

export async function getJobCardsByVehicle(vehicleId: string): Promise<JobCard[]> {
  return await db.select().from(jobCards).where(eq(jobCards.vehicleId, vehicleId)).orderBy(jobCards.scheduledDate);
}

export async function createJobCard(jobCard: InsertJobCard): Promise<JobCard> {
  const result = await db.insert(jobCards).values(jobCard).returning();
  return result[0];
}

export async function updateJobCard(id: string, jobCard: Partial<InsertJobCard>): Promise<JobCard | undefined> {
  const result = await db.update(jobCards).set(jobCard).where(eq(jobCards.id, id)).returning();
  return result[0];
}

// Appointment Conversion

export async function convertAppointmentToJobCard(appointmentId: string): Promise<JobCard> {
  const appointment = await getAppointment(appointmentId);
  if (!appointment) {
    throw new Error("Appointment not found");
  }

  // Format services array into a description
  const description = appointment.services.length > 0
    ? `Services: ${appointment.services.join(", ")}`
    : "General service";

  const jobCardData: InsertJobCard = {
    customerId: appointment.customerId,
    vehicleId: appointment.vehicleId,
    appointmentId: appointmentId,
    scheduledDate: appointment.scheduledDate,
    description: description,
    status: "scheduled",
    laborHours: "0",
    laborRate: "0",
    totalCost: "0",
  };

  return await createJobCard(jobCardData);
}

// Job Card Tasks

export async function getTask(id: string): Promise<JobCardTask | undefined> {
  const result = await db.select().from(jobCardTasks).where(eq(jobCardTasks.id, id)).limit(1);
  return result[0];
}

export async function getTasksByJobCard(jobCardId: string): Promise<JobCardTask[]> {
  return await db.select().from(jobCardTasks).where(eq(jobCardTasks.jobCardId, jobCardId)).orderBy(jobCardTasks.createdAt);
}

export async function createTask(task: InsertJobCardTask): Promise<JobCardTask> {
  const result = await db.insert(jobCardTasks).values(task).returning();
  return result[0];
}

export async function updateTask(id: string, task: Partial<InsertJobCardTask>): Promise<JobCardTask | undefined> {
  const result = await db.update(jobCardTasks).set(task).where(eq(jobCardTasks.id, id)).returning();
  return result[0];
}

export async function deleteTask(id: string): Promise<void> {
  await db.delete(jobCardTasks).where(eq(jobCardTasks.id, id));
}

// Parts Inventory

export async function getPart(id: string): Promise<Part | undefined> {
  const result = await db.select().from(partsInventory).where(eq(partsInventory.id, id)).limit(1);
  return result[0];
}

export async function getPartByBarcode(barcode: string): Promise<Part | undefined> {
  const result = await db.select().from(partsInventory).where(eq(partsInventory.barcode, barcode)).limit(1);
  return result[0];
}

export async function getAllParts(): Promise<Part[]> {
  return await db.select().from(partsInventory).orderBy(partsInventory.name);
}

export async function getLowStockParts(): Promise<Part[]> {
  return await db.select().from(partsInventory)
    .where(sql`${partsInventory.quantity} <= ${partsInventory.lowStockThreshold}`)
    .orderBy(partsInventory.quantity);
}

export async function createPart(part: InsertPart): Promise<Part> {
  const result = await db.insert(partsInventory).values(part).returning();
  return result[0];
}

export async function updatePart(id: string, part: Partial<InsertPart>): Promise<Part | undefined> {
  const result = await db.update(partsInventory).set(part).where(eq(partsInventory.id, id)).returning();
  return result[0];
}

// Job Card Parts

export async function getJobCardParts(jobCardId: string): Promise<JobCardPart[]> {
  return await db.select().from(jobCardParts).where(eq(jobCardParts.jobCardId, jobCardId));
}

export async function addPartToJobCard(jobCardPart: InsertJobCardPart): Promise<JobCardPart> {
  return await db.transaction(async (tx) => {
    // Check current stock
    const part = await tx.select().from(partsInventory).where(eq(partsInventory.id, jobCardPart.partId)).limit(1);
    if (!part[0]) {
      throw new Error("Part not found");
    }

    if (part[0].quantity < jobCardPart.quantity) {
      throw new Error(`Insufficient stock. Available: ${part[0].quantity}, Required: ${jobCardPart.quantity}`);
    }

    // Create job card part record
    const result = await tx.insert(jobCardParts).values(jobCardPart).returning();

    // Deduct stock
    await tx.update(partsInventory)
      .set({ quantity: sql`${partsInventory.quantity} - ${jobCardPart.quantity}` })
      .where(eq(partsInventory.id, jobCardPart.partId));

    return result[0];
  });
}

export async function removePartFromJobCard(jobCardPartId: string): Promise<void> {
  await db.transaction(async (tx) => {
    // Get the job card part to know how much stock to add back
    const jobCardPart = await tx.select().from(jobCardParts).where(eq(jobCardParts.id, jobCardPartId)).limit(1);
    if (!jobCardPart[0]) {
      throw new Error("Job card part not found");
    }

    // Add stock back
    await tx.update(partsInventory)
      .set({ quantity: sql`${partsInventory.quantity} + ${jobCardPart[0].quantity}` })
      .where(eq(partsInventory.id, jobCardPart[0].partId));

    // Delete the job card part
    await tx.delete(jobCardParts).where(eq(jobCardParts.id, jobCardPartId));
  });
}

export async function updateJobCardPartQuantity(jobCardPartId: string, newQuantity: number): Promise<JobCardPart> {
  return await db.transaction(async (tx) => {
    // Get current job card part
    const currentPart = await tx.select().from(jobCardParts).where(eq(jobCardParts.id, jobCardPartId)).limit(1);
    if (!currentPart[0]) {
      throw new Error("Job card part not found");
    }

    const quantityDiff = newQuantity - currentPart[0].quantity;

    if (quantityDiff > 0) {
      // Need to deduct more stock
      const part = await tx.select().from(partsInventory).where(eq(partsInventory.id, currentPart[0].partId)).limit(1);
      if (!part[0]) {
        throw new Error("Part not found");
      }

      if (part[0].quantity < quantityDiff) {
        throw new Error(`Insufficient stock. Available: ${part[0].quantity}, Required: ${quantityDiff}`);
      }

      await tx.update(partsInventory)
        .set({ quantity: sql`${partsInventory.quantity} - ${quantityDiff}` })
        .where(eq(partsInventory.id, currentPart[0].partId));
    } else if (quantityDiff < 0) {
      // Add stock back
      const stockToReturn = Math.abs(quantityDiff);
      await tx.update(partsInventory)
        .set({ quantity: sql`${partsInventory.quantity} + ${stockToReturn}` })
        .where(eq(partsInventory.id, currentPart[0].partId));
    }

    // Update the job card part quantity
    const result = await tx.update(jobCardParts)
      .set({ quantity: newQuantity })
      .where(eq(jobCardParts.id, jobCardPartId))
      .returning();

    return result[0];
  });
}
