/**
 * Marketing Storage Module
 * Handles email campaigns, coupons, loyalty points, customer referrals, and promotional banners
 */

import {
  db,
  eq,
  and,
  desc,
  sql,
  // Marketing-related tables
  emailCampaigns,
  coupons,
  loyaltyPointsTransactions,
  loyaltySettings,
  customerReferrals,
  users,
  // Marketing-related types
  type EmailCampaign,
  type InsertEmailCampaign,
  type Coupon,
  type InsertCoupon,
  type LoyaltyPointsTransaction,
  type InsertLoyaltyPointsTransaction,
  type LoyaltySettings,
  type InsertLoyaltySettings,
  type CustomerReferral,
  type InsertCustomerReferral,
  type User,
} from "./base";

// Import sum function from drizzle-orm
import { sum } from "drizzle-orm";

class MarketingStorage {
  // ========================================
  // EMAIL CAMPAIGNS
  // ========================================

  async getEmailCampaign(id: string): Promise<EmailCampaign | undefined> {
    const result = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, id)).limit(1);
    return result[0];
  }

  async getAllEmailCampaigns(): Promise<EmailCampaign[]> {
    return await db.select().from(emailCampaigns).orderBy(desc(emailCampaigns.createdAt));
  }

  async getEmailCampaignsByStatus(status: string): Promise<EmailCampaign[]> {
    return await db.select().from(emailCampaigns).where(eq(emailCampaigns.status, status)).orderBy(desc(emailCampaigns.createdAt));
  }

  async createEmailCampaign(campaign: InsertEmailCampaign): Promise<EmailCampaign> {
    const result = await db.insert(emailCampaigns).values(campaign).returning();
    return result[0];
  }

  async updateEmailCampaign(id: string, campaign: Partial<InsertEmailCampaign>): Promise<EmailCampaign | undefined> {
    const updateData = { ...campaign, updatedAt: new Date() };
    const result = await db.update(emailCampaigns).set(updateData).where(eq(emailCampaigns.id, id)).returning();
    return result[0];
  }

  // ========================================
  // COUPONS
  // ========================================

  async getCoupon(id: string): Promise<Coupon | undefined> {
    const result = await db.select().from(coupons).where(eq(coupons.id, id)).limit(1);
    return result[0];
  }

  async getCouponByCode(code: string): Promise<Coupon | undefined> {
    const result = await db.select().from(coupons).where(eq(coupons.code, code)).limit(1);
    return result[0];
  }

  async getAllCoupons(): Promise<Coupon[]> {
    return await db.select().from(coupons).orderBy(desc(coupons.createdAt));
  }

  async getActiveCoupons(): Promise<Coupon[]> {
    return await db.select().from(coupons)
      .where(and(
        eq(coupons.isActive, true),
        sql`${coupons.expiryDate} > NOW()`,
        sql`${coupons.usedBy} IS NULL`
      ))
      .orderBy(desc(coupons.createdAt));
  }

  async createCoupon(coupon: InsertCoupon): Promise<Coupon> {
    const result = await db.insert(coupons).values(coupon).returning();
    return result[0];
  }

  async redeemCoupon(code: string, customerId: string, invoiceId: string): Promise<Coupon | undefined> {
    const result = await db.update(coupons)
      .set({
        usedBy: customerId,
        usedAt: new Date(),
        appliedToInvoice: invoiceId,
      })
      .where(eq(coupons.code, code))
      .returning();
    return result[0];
  }

  // ========================================
  // LOYALTY POINTS
  // ========================================

  async getCustomerPointsBalance(customerId: string): Promise<number> {
    const result = await db.select({ total: sum(loyaltyPointsTransactions.points) })
      .from(loyaltyPointsTransactions)
      .where(eq(loyaltyPointsTransactions.customerId, customerId));
    return Number(result[0]?.total || 0);
  }

  async getPointsTransactions(customerId: string): Promise<LoyaltyPointsTransaction[]> {
    return await db.select().from(loyaltyPointsTransactions)
      .where(eq(loyaltyPointsTransactions.customerId, customerId))
      .orderBy(desc(loyaltyPointsTransactions.createdAt));
  }

  async addPointsTransaction(transaction: InsertLoyaltyPointsTransaction): Promise<LoyaltyPointsTransaction> {
    const result = await db.insert(loyaltyPointsTransactions).values(transaction).returning();
    return result[0];
  }

  async getLoyaltySettings(): Promise<LoyaltySettings | undefined> {
    const result = await db.select().from(loyaltySettings).where(eq(loyaltySettings.id, 1)).limit(1);
    return result[0];
  }

  async updateLoyaltySettings(settings: Partial<InsertLoyaltySettings>): Promise<LoyaltySettings | undefined> {
    const updateData = { ...settings, updatedAt: new Date() };
    const result = await db.update(loyaltySettings).set(updateData).where(eq(loyaltySettings.id, 1)).returning();
    return result[0];
  }

  // ========================================
  // CUSTOMER REFERRALS
  // ========================================

  async createReferral(referral: InsertCustomerReferral): Promise<CustomerReferral> {
    const result = await db.insert(customerReferrals).values(referral).returning();
    return result[0];
  }

  async getReferralsByReferrer(referrerId: string): Promise<CustomerReferral[]> {
    return await db.select().from(customerReferrals)
      .where(eq(customerReferrals.referrerId, referrerId))
      .orderBy(desc(customerReferrals.createdAt));
  }

  async getReferralByReferred(referredId: string): Promise<CustomerReferral | undefined> {
    const result = await db.select().from(customerReferrals)
      .where(eq(customerReferrals.referredId, referredId))
      .limit(1);
    return result[0];
  }

  // ========================================
  // REFERRAL CODE OPERATIONS
  // ========================================

  async getUserByReferralCode(referralCode: string): Promise<User | undefined> {
    const result = await db.select()
      .from(users)
      .where(eq(users.referralCode, referralCode))
      .limit(1);
    return result[0];
  }

  async updateUserReferralCode(userId: string, referralCode: string): Promise<User | undefined> {
    const result = await db.update(users)
      .set({ referralCode })
      .where(eq(users.id, userId))
      .returning();
    return result[0];
  }

  async getReferralStats(userId: string): Promise<{
    totalReferrals: number;
    totalPointsEarned: number;
  }> {
    const referrals = await this.getReferralsByReferrer(userId);
    const totalReferrals = referrals.length;
    const totalPointsEarned = referrals.reduce((sum, ref) => sum + (ref.pointsAwarded || 0), 0);

    return {
      totalReferrals,
      totalPointsEarned,
    };
  }
}

// Export singleton instance
export const marketingStorage = new MarketingStorage();
