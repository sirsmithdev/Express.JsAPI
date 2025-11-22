/**
 * Rental Storage Module
 * Handles all rental vehicle operations including vehicles, extras, reservations, contracts, payments, and maintenance
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
  // Rental-related tables
  rentalVehicles,
  rentalExtras,
  rentalReservations,
  rentalReservationExtras,
  rentalContracts,
  rentalPayments,
  rentalMaintenanceLog,
  rentalAvailabilityBlocks,
  rentalReservationSequence,
  rentalContractSequence,
  // Rental-related types
  type RentalVehicle,
  type InsertRentalVehicle,
  type RentalExtra,
  type InsertRentalExtra,
  type RentalReservation,
  type InsertRentalReservation,
  type RentalReservationExtra,
  type InsertRentalReservationExtra,
  type RentalContract,
  type InsertRentalContract,
  type RentalPayment,
  type InsertRentalPayment,
  type RentalMaintenance,
  type InsertRentalMaintenance,
  type RentalAvailabilityBlock,
  type InsertRentalAvailabilityBlock,
} from "./base";

class RentalStorage {
  // ========================================
  // RENTAL VEHICLES
  // ========================================

  async getAllRentalVehicles(): Promise<RentalVehicle[]> {
    return await db
      .select()
      .from(rentalVehicles)
      .orderBy(desc(rentalVehicles.createdAt));
  }

  async getRentalVehicle(id: string): Promise<RentalVehicle | undefined> {
    const [vehicle] = await db
      .select()
      .from(rentalVehicles)
      .where(eq(rentalVehicles.id, id))
      .limit(1);
    return vehicle;
  }

  async getAvailableRentalVehicles(startDate?: Date, endDate?: Date): Promise<RentalVehicle[]> {
    // Get all vehicles with status 'available'
    const query = db
      .select()
      .from(rentalVehicles)
      .where(eq(rentalVehicles.status, 'available'));

    const vehicles = await query;

    // If dates provided, filter out vehicles with overlapping reservations
    if (startDate && endDate) {
      const vehicleIds = vehicles.map(v => v.id);
      if (vehicleIds.length === 0) return [];

      const overlappingReservations = await db
        .select()
        .from(rentalReservations)
        .where(
          and(
            inArray(rentalReservations.rentalVehicleId, vehicleIds),
            or(
              eq(rentalReservations.status, 'confirmed'),
              eq(rentalReservations.status, 'active')
            ),
            or(
              and(
                lte(rentalReservations.pickupDate, endDate),
                gte(rentalReservations.returnDate, startDate)
              )
            )
          )
        );

      const reservedVehicleIds = new Set(overlappingReservations.map(r => r.rentalVehicleId));
      return vehicles.filter(v => !reservedVehicleIds.has(v.id));
    }

    return vehicles;
  }

  async createRentalVehicle(vehicle: InsertRentalVehicle): Promise<RentalVehicle> {
    const [newVehicle] = await db
      .insert(rentalVehicles)
      .values(vehicle)
      .returning();
    return newVehicle;
  }

  async updateRentalVehicle(id: string, vehicle: Partial<InsertRentalVehicle>): Promise<RentalVehicle | undefined> {
    const [updated] = await db
      .update(rentalVehicles)
      .set({ ...vehicle, updatedAt: new Date() })
      .where(eq(rentalVehicles.id, id))
      .returning();
    return updated;
  }

  async deleteRentalVehicle(id: string): Promise<void> {
    await db.delete(rentalVehicles).where(eq(rentalVehicles.id, id));
  }

  // ========================================
  // RENTAL EXTRAS
  // ========================================

  async getAllRentalExtras(): Promise<RentalExtra[]> {
    return await db
      .select()
      .from(rentalExtras)
      .orderBy(desc(rentalExtras.createdAt));
  }

  async getActiveRentalExtras(): Promise<RentalExtra[]> {
    return await db
      .select()
      .from(rentalExtras)
      .where(eq(rentalExtras.isActive, true))
      .orderBy(desc(rentalExtras.createdAt));
  }

  async getRentalExtra(id: string): Promise<RentalExtra | undefined> {
    const [extra] = await db
      .select()
      .from(rentalExtras)
      .where(eq(rentalExtras.id, id))
      .limit(1);
    return extra;
  }

  async createRentalExtra(extra: InsertRentalExtra): Promise<RentalExtra> {
    const [newExtra] = await db
      .insert(rentalExtras)
      .values(extra)
      .returning();
    return newExtra;
  }

  async updateRentalExtra(id: string, extra: Partial<InsertRentalExtra>): Promise<RentalExtra | undefined> {
    const [updated] = await db
      .update(rentalExtras)
      .set(extra)
      .where(eq(rentalExtras.id, id))
      .returning();
    return updated;
  }

  async deleteRentalExtra(id: string): Promise<void> {
    await db.delete(rentalExtras).where(eq(rentalExtras.id, id));
  }

  // ========================================
  // RENTAL RESERVATIONS
  // ========================================

  async getAllRentalReservations(): Promise<RentalReservation[]> {
    return await db
      .select()
      .from(rentalReservations)
      .orderBy(desc(rentalReservations.createdAt));
  }

  async getRentalReservation(id: string): Promise<RentalReservation | undefined> {
    const [reservation] = await db
      .select()
      .from(rentalReservations)
      .where(eq(rentalReservations.id, id))
      .limit(1);
    return reservation;
  }

  async getRentalReservationByNumber(reservationNumber: string): Promise<RentalReservation | undefined> {
    const [reservation] = await db
      .select()
      .from(rentalReservations)
      .where(eq(rentalReservations.reservationNumber, reservationNumber))
      .limit(1);
    return reservation;
  }

  async getRentalReservationsByCustomer(customerId: string): Promise<RentalReservation[]> {
    return await db
      .select()
      .from(rentalReservations)
      .where(eq(rentalReservations.customerId, customerId))
      .orderBy(desc(rentalReservations.createdAt));
  }

  async getRentalReservationsByVehicle(vehicleId: string): Promise<RentalReservation[]> {
    return await db
      .select()
      .from(rentalReservations)
      .where(eq(rentalReservations.rentalVehicleId, vehicleId))
      .orderBy(desc(rentalReservations.pickupDate));
  }

  async createRentalReservation(reservation: InsertRentalReservation): Promise<RentalReservation> {
    const [newReservation] = await db
      .insert(rentalReservations)
      .values(reservation)
      .returning();
    return newReservation;
  }

  async updateRentalReservation(id: string, reservation: Partial<InsertRentalReservation>): Promise<RentalReservation | undefined> {
    const [updated] = await db
      .update(rentalReservations)
      .set({ ...reservation, updatedAt: new Date() })
      .where(eq(rentalReservations.id, id))
      .returning();
    return updated;
  }

  async deleteRentalReservation(id: string): Promise<void> {
    await db.delete(rentalReservations).where(eq(rentalReservations.id, id));
  }

  async generateRentalReservationNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const [sequence] = await db
      .insert(rentalReservationSequence)
      .values({ year, lastNumber: 1 })
      .onConflictDoUpdate({
        target: rentalReservationSequence.year,
        set: { lastNumber: sql`${rentalReservationSequence.lastNumber} + 1` }
      })
      .returning();

    const paddedNumber = sequence.lastNumber.toString().padStart(5, '0');
    return `RR-${year}-${paddedNumber}`;
  }

  // ========================================
  // RENTAL RESERVATION EXTRAS
  // ========================================

  async getRentalReservationExtras(reservationId: string): Promise<RentalReservationExtra[]> {
    return await db
      .select()
      .from(rentalReservationExtras)
      .where(eq(rentalReservationExtras.reservationId, reservationId));
  }

  async createRentalReservationExtra(extra: InsertRentalReservationExtra): Promise<RentalReservationExtra> {
    const [newExtra] = await db
      .insert(rentalReservationExtras)
      .values(extra)
      .returning();
    return newExtra;
  }

  async deleteRentalReservationExtra(id: string): Promise<void> {
    await db.delete(rentalReservationExtras).where(eq(rentalReservationExtras.id, id));
  }

  // ========================================
  // RENTAL CONTRACTS
  // ========================================

  async getAllRentalContracts(): Promise<RentalContract[]> {
    return await db
      .select()
      .from(rentalContracts)
      .orderBy(desc(rentalContracts.createdAt));
  }

  async getRentalContract(id: string): Promise<RentalContract | undefined> {
    const [contract] = await db
      .select()
      .from(rentalContracts)
      .where(eq(rentalContracts.id, id))
      .limit(1);
    return contract;
  }

  async getRentalContractByReservation(reservationId: string): Promise<RentalContract | undefined> {
    const [contract] = await db
      .select()
      .from(rentalContracts)
      .where(eq(rentalContracts.reservationId, reservationId))
      .limit(1);
    return contract;
  }

  async createRentalContract(contract: InsertRentalContract): Promise<RentalContract> {
    const [newContract] = await db
      .insert(rentalContracts)
      .values(contract)
      .returning();
    return newContract;
  }

  async updateRentalContract(id: string, contract: Partial<InsertRentalContract>): Promise<RentalContract | undefined> {
    const [updated] = await db
      .update(rentalContracts)
      .set(contract)
      .where(eq(rentalContracts.id, id))
      .returning();
    return updated;
  }

  async generateRentalContractNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const [sequence] = await db
      .insert(rentalContractSequence)
      .values({ year, lastNumber: 1 })
      .onConflictDoUpdate({
        target: rentalContractSequence.year,
        set: { lastNumber: sql`${rentalContractSequence.lastNumber} + 1` }
      })
      .returning();

    const paddedNumber = sequence.lastNumber.toString().padStart(5, '0');
    return `RC-${year}-${paddedNumber}`;
  }

  // ========================================
  // RENTAL PAYMENTS
  // ========================================

  async getRentalPaymentsByReservation(reservationId: string): Promise<RentalPayment[]> {
    return await db
      .select()
      .from(rentalPayments)
      .where(eq(rentalPayments.reservationId, reservationId))
      .orderBy(desc(rentalPayments.createdAt));
  }

  async getRentalPaymentsByCustomer(customerId: string): Promise<RentalPayment[]> {
    return await db
      .select()
      .from(rentalPayments)
      .where(eq(rentalPayments.customerId, customerId))
      .orderBy(desc(rentalPayments.createdAt));
  }

  async createRentalPayment(payment: InsertRentalPayment): Promise<RentalPayment> {
    const [newPayment] = await db
      .insert(rentalPayments)
      .values(payment)
      .returning();
    return newPayment;
  }

  // ========================================
  // RENTAL MAINTENANCE
  // ========================================

  async getRentalMaintenanceByVehicle(vehicleId: string): Promise<RentalMaintenance[]> {
    return await db
      .select()
      .from(rentalMaintenanceLog)
      .where(eq(rentalMaintenanceLog.rentalVehicleId, vehicleId))
      .orderBy(desc(rentalMaintenanceLog.createdAt));
  }

  async createRentalMaintenance(maintenance: InsertRentalMaintenance): Promise<RentalMaintenance> {
    const [newMaintenance] = await db
      .insert(rentalMaintenanceLog)
      .values(maintenance)
      .returning();
    return newMaintenance;
  }

  async updateRentalMaintenance(id: string, maintenance: Partial<InsertRentalMaintenance>): Promise<RentalMaintenance | undefined> {
    const [updated] = await db
      .update(rentalMaintenanceLog)
      .set(maintenance)
      .where(eq(rentalMaintenanceLog.id, id))
      .returning();
    return updated;
  }

  // ========================================
  // RENTAL AVAILABILITY BLOCKS
  // ========================================

  async getRentalAvailabilityBlocksByVehicle(vehicleId: string): Promise<RentalAvailabilityBlock[]> {
    return await db
      .select()
      .from(rentalAvailabilityBlocks)
      .where(eq(rentalAvailabilityBlocks.rentalVehicleId, vehicleId))
      .orderBy(desc(rentalAvailabilityBlocks.startDate));
  }

  async createRentalAvailabilityBlock(block: InsertRentalAvailabilityBlock): Promise<RentalAvailabilityBlock> {
    const [newBlock] = await db
      .insert(rentalAvailabilityBlocks)
      .values(block)
      .returning();
    return newBlock;
  }

  async deleteRentalAvailabilityBlock(id: string): Promise<void> {
    await db.delete(rentalAvailabilityBlocks).where(eq(rentalAvailabilityBlocks.id, id));
  }
}

// Export singleton instance
export const rentalStorage = new RentalStorage();
