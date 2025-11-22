/**
 * Vehicles Storage Module
 * Handles all database operations for vehicles, maintenance status, and document expiries
 */

import {
  db,
  eq,
  and,
  desc,
  vehicles,
  maintenanceSchedules,
  vehicleDocuments,
  type Vehicle,
  type InsertVehicle,
} from "./base";

// Vehicles CRUD Operations

export async function getVehicle(id: string): Promise<Vehicle | undefined> {
  const result = await db.select().from(vehicles).where(eq(vehicles.id, id)).limit(1);
  return result[0];
}

export async function getAllVehicles(): Promise<Vehicle[]> {
  return await db.select().from(vehicles).orderBy(desc(vehicles.createdAt));
}

export async function getVehiclesByCustomer(customerId: string): Promise<Vehicle[]> {
  return await db.select().from(vehicles).where(eq(vehicles.customerId, customerId));
}

export async function createVehicle(vehicle: InsertVehicle): Promise<Vehicle> {
  const result = await db.insert(vehicles).values(vehicle).returning();
  return result[0];
}

export async function updateVehicle(id: string, vehicle: Partial<InsertVehicle>): Promise<Vehicle | undefined> {
  const result = await db.update(vehicles).set(vehicle).where(eq(vehicles.id, id)).returning();
  return result[0];
}

export async function deleteVehicle(id: string): Promise<void> {
  await db.delete(vehicles).where(eq(vehicles.id, id));
}

// Vehicle Lookup by QR Code

export async function getVehicleByCodeAndToken(vehicleCode: string, qrToken: string): Promise<Vehicle | undefined> {
  const result = await db
    .select()
    .from(vehicles)
    .where(and(eq(vehicles.vehicleCode, vehicleCode), eq(vehicles.qrToken, qrToken)))
    .limit(1);
  return result[0];
}

// Vehicle Maintenance Status

export async function getVehicleMaintenanceStatus(vehicleId: string): Promise<{
  currentMileage: number;
  lastOilChangeDate: Date | null;
  lastOilChangeMileage: number | null;
  nextOilChangeMileage: number | null;
  oilChangeProgress: number; // Percentage (0-100)
}> {
  const vehicle = await getVehicle(vehicleId);
  if (!vehicle) {
    throw new Error("Vehicle not found");
  }

  // Get the most recent maintenance schedule for oil change
  const schedules = await db
    .select()
    .from(maintenanceSchedules)
    .where(eq(maintenanceSchedules.vehicleId, vehicleId))
    .orderBy(desc(maintenanceSchedules.lastServiceDate));

  const oilChangeSchedule = schedules.find((s) => s.serviceType.toLowerCase().includes("oil"));

  return {
    currentMileage: vehicle.currentMileage || 0,
    lastOilChangeDate: oilChangeSchedule?.lastServiceDate || null,
    lastOilChangeMileage: oilChangeSchedule?.lastServiceMileage || null,
    nextOilChangeMileage: oilChangeSchedule?.nextMileageDue || null,
    oilChangeProgress: oilChangeSchedule?.nextMileageDue
      ? Math.min(
          100,
          Math.max(
            0,
            ((vehicle.currentMileage || 0) - (oilChangeSchedule.lastServiceMileage || 0)) /
              ((oilChangeSchedule.nextMileageDue || 1) - (oilChangeSchedule.lastServiceMileage || 0)) *
              100
          )
        )
      : 0,
  };
}

// Vehicle Document Expiries

export async function getVehicleDocumentExpiries(vehicleId: string): Promise<{
  registration: { expiryDate: Date | null; daysUntilExpiry: number | null };
  insurance: { expiryDate: Date | null; daysUntilExpiry: number | null };
  inspection: { expiryDate: Date | null; daysUntilExpiry: number | null };
}> {
  const docs = await db
    .select()
    .from(vehicleDocuments)
    .where(eq(vehicleDocuments.vehicleId, vehicleId))
    .orderBy(desc(vehicleDocuments.expiryDate));

  const today = new Date();
  const calculateDaysUntil = (date: Date | null): number | null => {
    if (!date) return null;
    const diff = new Date(date).getTime() - today.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  };

  const registration = docs.find((d) => d.documentType === "registration");
  const insurance = docs.find((d) => d.documentType === "insurance");
  const inspection = docs.find((d) => d.documentType === "inspection_report");

  return {
    registration: {
      expiryDate: registration?.expiryDate || null,
      daysUntilExpiry: calculateDaysUntil(registration?.expiryDate || null),
    },
    insurance: {
      expiryDate: insurance?.expiryDate || null,
      daysUntilExpiry: calculateDaysUntil(insurance?.expiryDate || null),
    },
    inspection: {
      expiryDate: inspection?.expiryDate || null,
      daysUntilExpiry: calculateDaysUntil(inspection?.expiryDate || null),
    },
  };
}
