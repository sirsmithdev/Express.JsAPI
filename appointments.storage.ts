/**
 * Appointments Storage Module
 * Handles all database operations for appointments
 */

import {
  db,
  eq,
  desc,
  appointments,
  type Appointment,
  type InsertAppointment,
} from "./base";

// Appointments CRUD Operations

export async function getAppointment(id: string): Promise<Appointment | undefined> {
  const result = await db.select().from(appointments).where(eq(appointments.id, id)).limit(1);
  return result[0];
}

export async function getAppointmentsByCustomer(customerId: string): Promise<Appointment[]> {
  return await db.select().from(appointments).where(eq(appointments.customerId, customerId)).orderBy(desc(appointments.scheduledDate));
}

export async function getAllAppointments(): Promise<Appointment[]> {
  return await db.select().from(appointments).orderBy(desc(appointments.scheduledDate));
}

export async function createAppointment(appointment: InsertAppointment): Promise<Appointment> {
  const result = await db.insert(appointments).values(appointment).returning();
  return result[0];
}

export async function updateAppointment(id: string, appointment: Partial<InsertAppointment>): Promise<Appointment | undefined> {
  const result = await db.update(appointments).set(appointment).where(eq(appointments.id, id)).returning();
  return result[0];
}
