/**
 * Towing Storage Module
 * Handles all towing and recovery service operations including trucks, drivers, wreckers, zones, and requests
 */

import {
  db,
  eq,
  and,
  or,
  desc,
  sql,
  // Towing-related tables
  towTrucks,
  wreckerDrivers,
  thirdPartyWreckers,
  towPricingZones,
  towRequests,
} from "./base";

// Import additional tables and types from schema
import {
  towRequestLocations,
  towRequestSequence,
  type TowTruck,
  type InsertTowTruck,
  type WreckerDriver,
  type InsertWreckerDriver,
  type ThirdPartyWrecker,
  type InsertThirdPartyWrecker,
  type TowPricingZone,
  type InsertTowPricingZone,
  type TowRequest,
  type InsertTowRequest,
  type TowRequestLocation,
  type InsertTowRequestLocation,
} from "@shared/schema";

class TowingStorage {
  // ========================================
  // TOW TRUCKS
  // ========================================

  async getAllTowTrucks(): Promise<TowTruck[]> {
    return await db
      .select()
      .from(towTrucks)
      .orderBy(desc(towTrucks.createdAt));
  }

  async getAvailableTowTrucks(): Promise<TowTruck[]> {
    return await db
      .select()
      .from(towTrucks)
      .where(eq(towTrucks.isAvailable, true))
      .orderBy(desc(towTrucks.createdAt));
  }

  async getTowTruck(id: string): Promise<TowTruck | undefined> {
    const [truck] = await db
      .select()
      .from(towTrucks)
      .where(eq(towTrucks.id, id))
      .limit(1);
    return truck;
  }

  async createTowTruck(truck: InsertTowTruck): Promise<TowTruck> {
    const [newTruck] = await db
      .insert(towTrucks)
      .values(truck)
      .returning();
    return newTruck;
  }

  async updateTowTruck(id: string, truck: Partial<InsertTowTruck>): Promise<TowTruck | undefined> {
    const [updated] = await db
      .update(towTrucks)
      .set({ ...truck, updatedAt: new Date() })
      .where(eq(towTrucks.id, id))
      .returning();
    return updated;
  }

  async deleteTowTruck(id: string): Promise<void> {
    await db.delete(towTrucks).where(eq(towTrucks.id, id));
  }

  // ========================================
  // WRECKER DRIVERS
  // ========================================

  async getAllWreckerDrivers(): Promise<WreckerDriver[]> {
    return await db
      .select()
      .from(wreckerDrivers)
      .orderBy(desc(wreckerDrivers.createdAt));
  }

  async getAvailableWreckerDrivers(): Promise<WreckerDriver[]> {
    return await db
      .select()
      .from(wreckerDrivers)
      .where(and(
        eq(wreckerDrivers.isAvailable, true),
        eq(wreckerDrivers.isActive, true)
      ))
      .orderBy(desc(wreckerDrivers.createdAt));
  }

  async getWreckerDriver(id: string): Promise<WreckerDriver | undefined> {
    const [driver] = await db
      .select()
      .from(wreckerDrivers)
      .where(eq(wreckerDrivers.id, id))
      .limit(1);
    return driver;
  }

  async getWreckerDriverByUserId(userId: string): Promise<WreckerDriver | undefined> {
    const [driver] = await db
      .select()
      .from(wreckerDrivers)
      .where(eq(wreckerDrivers.userId, userId))
      .limit(1);
    return driver;
  }

  async createWreckerDriver(driver: InsertWreckerDriver): Promise<WreckerDriver> {
    const [newDriver] = await db
      .insert(wreckerDrivers)
      .values(driver)
      .returning();
    return newDriver;
  }

  async updateWreckerDriver(id: string, driver: Partial<InsertWreckerDriver>): Promise<WreckerDriver | undefined> {
    const [updated] = await db
      .update(wreckerDrivers)
      .set({ ...driver, updatedAt: new Date() })
      .where(eq(wreckerDrivers.id, id))
      .returning();
    return updated;
  }

  async deleteWreckerDriver(id: string): Promise<void> {
    await db.delete(wreckerDrivers).where(eq(wreckerDrivers.id, id));
  }

  // ========================================
  // THIRD PARTY WRECKERS
  // ========================================

  async getAllThirdPartyWreckers(): Promise<ThirdPartyWrecker[]> {
    return await db
      .select()
      .from(thirdPartyWreckers)
      .orderBy(desc(thirdPartyWreckers.createdAt));
  }

  async getActiveThirdPartyWreckers(): Promise<ThirdPartyWrecker[]> {
    return await db
      .select()
      .from(thirdPartyWreckers)
      .where(eq(thirdPartyWreckers.isActive, true))
      .orderBy(desc(thirdPartyWreckers.isPreferred), desc(thirdPartyWreckers.createdAt));
  }

  async getThirdPartyWrecker(id: string): Promise<ThirdPartyWrecker | undefined> {
    const [wrecker] = await db
      .select()
      .from(thirdPartyWreckers)
      .where(eq(thirdPartyWreckers.id, id))
      .limit(1);
    return wrecker;
  }

  async createThirdPartyWrecker(wrecker: InsertThirdPartyWrecker): Promise<ThirdPartyWrecker> {
    const [newWrecker] = await db
      .insert(thirdPartyWreckers)
      .values(wrecker)
      .returning();
    return newWrecker;
  }

  async updateThirdPartyWrecker(id: string, wrecker: Partial<InsertThirdPartyWrecker>): Promise<ThirdPartyWrecker | undefined> {
    const [updated] = await db
      .update(thirdPartyWreckers)
      .set(wrecker)
      .where(eq(thirdPartyWreckers.id, id))
      .returning();
    return updated;
  }

  async deleteThirdPartyWrecker(id: string): Promise<void> {
    await db.delete(thirdPartyWreckers).where(eq(thirdPartyWreckers.id, id));
  }

  // ========================================
  // TOW PRICING ZONES
  // ========================================

  async getAllTowPricingZones(): Promise<TowPricingZone[]> {
    return await db
      .select()
      .from(towPricingZones)
      .orderBy(desc(towPricingZones.createdAt));
  }

  async getActiveTowPricingZones(): Promise<TowPricingZone[]> {
    return await db
      .select()
      .from(towPricingZones)
      .where(eq(towPricingZones.isActive, true))
      .orderBy(desc(towPricingZones.createdAt));
  }

  async getTowPricingZone(id: string): Promise<TowPricingZone | undefined> {
    const [zone] = await db
      .select()
      .from(towPricingZones)
      .where(eq(towPricingZones.id, id))
      .limit(1);
    return zone;
  }

  async createTowPricingZone(zone: InsertTowPricingZone): Promise<TowPricingZone> {
    const [newZone] = await db
      .insert(towPricingZones)
      .values(zone)
      .returning();
    return newZone;
  }

  async updateTowPricingZone(id: string, zone: Partial<InsertTowPricingZone>): Promise<TowPricingZone | undefined> {
    const [updated] = await db
      .update(towPricingZones)
      .set({ ...zone, updatedAt: new Date() })
      .where(eq(towPricingZones.id, id))
      .returning();
    return updated;
  }

  async deleteTowPricingZone(id: string): Promise<void> {
    await db.delete(towPricingZones).where(eq(towPricingZones.id, id));
  }

  // ========================================
  // TOW REQUESTS
  // ========================================

  async getAllTowRequests(): Promise<TowRequest[]> {
    return await db
      .select()
      .from(towRequests)
      .orderBy(desc(towRequests.requestedAt));
  }

  async getActiveTowRequests(): Promise<TowRequest[]> {
    return await db
      .select()
      .from(towRequests)
      .where(or(
        eq(towRequests.status, 'pending'),
        eq(towRequests.status, 'dispatched'),
        eq(towRequests.status, 'en_route'),
        eq(towRequests.status, 'arrived'),
        eq(towRequests.status, 'towing')
      ))
      .orderBy(desc(towRequests.requestedAt));
  }

  async getTowRequest(id: string): Promise<TowRequest | undefined> {
    const [request] = await db
      .select()
      .from(towRequests)
      .where(eq(towRequests.id, id))
      .limit(1);
    return request;
  }

  async getTowRequestByNumber(requestNumber: string): Promise<TowRequest | undefined> {
    const [request] = await db
      .select()
      .from(towRequests)
      .where(eq(towRequests.requestNumber, requestNumber))
      .limit(1);
    return request;
  }

  async getTowRequestsByCustomer(customerId: string): Promise<TowRequest[]> {
    return await db
      .select()
      .from(towRequests)
      .where(eq(towRequests.customerId, customerId))
      .orderBy(desc(towRequests.requestedAt));
  }

  async getTowRequestsByDriver(driverId: string): Promise<TowRequest[]> {
    return await db
      .select()
      .from(towRequests)
      .where(eq(towRequests.assignedDriverId, driverId))
      .orderBy(desc(towRequests.requestedAt));
  }

  async createTowRequest(request: InsertTowRequest): Promise<TowRequest> {
    const [newRequest] = await db
      .insert(towRequests)
      .values(request)
      .returning();
    return newRequest;
  }

  async updateTowRequest(id: string, request: Partial<InsertTowRequest>): Promise<TowRequest | undefined> {
    const [updated] = await db
      .update(towRequests)
      .set({ ...request, updatedAt: new Date() })
      .where(eq(towRequests.id, id))
      .returning();
    return updated;
  }

  async deleteTowRequest(id: string): Promise<void> {
    await db.delete(towRequests).where(eq(towRequests.id, id));
  }

  async generateTowRequestNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const [sequence] = await db
      .insert(towRequestSequence)
      .values({ year, lastNumber: 1 })
      .onConflictDoUpdate({
        target: towRequestSequence.year,
        set: { lastNumber: sql`${towRequestSequence.lastNumber} + 1` }
      })
      .returning();

    const paddedNumber = sequence.lastNumber.toString().padStart(5, '0');
    return `TOW-${year}-${paddedNumber}`;
  }

  // ========================================
  // TOW REQUEST LOCATIONS
  // ========================================

  async getTowRequestLocations(requestId: string): Promise<TowRequestLocation[]> {
    return await db
      .select()
      .from(towRequestLocations)
      .where(eq(towRequestLocations.towRequestId, requestId))
      .orderBy(desc(towRequestLocations.timestamp));
  }

  async getLatestTowRequestLocation(requestId: string): Promise<TowRequestLocation | undefined> {
    const [location] = await db
      .select()
      .from(towRequestLocations)
      .where(eq(towRequestLocations.towRequestId, requestId))
      .orderBy(desc(towRequestLocations.timestamp))
      .limit(1);
    return location;
  }

  async createTowRequestLocation(location: InsertTowRequestLocation): Promise<TowRequestLocation> {
    const [newLocation] = await db
      .insert(towRequestLocations)
      .values(location)
      .returning();
    return newLocation;
  }
}

// Export singleton instance
export const towingStorage = new TowingStorage();
