/**
 * Settings Storage Module
 * Handles all application settings and configuration:
 * - Chat settings
 * - Appointment settings
 * - Payment gateway settings
 * - QuickBooks integration settings
 * - Landing page settings
 * - Pricing settings
 * - Email settings
 */

import {
  db,
  eq,
  chatSettings,
  type ChatSettings,
  type InsertChatSettings,
  appointmentSettings,
  type AppointmentSettings,
  type InsertAppointmentSettings,
  paymentGatewaySettings,
  type PaymentGatewaySettings,
  type InsertPaymentGatewaySettings,
  quickbooksSettings,
  type QuickBooksSettings,
  type InsertQuickBooksSettings,
  landingPageSettings,
  type LandingPageSettings,
  type InsertLandingPageSettings,
  pricingSettings,
  type PricingSettings,
  type InsertPricingSettings,
  emailSettings,
  type EmailSettings,
  type InsertEmailSettings,
} from "./base";

class SettingsStorage {
  // ============================================================
  // CHAT SETTINGS
  // ============================================================

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

  // ============================================================
  // APPOINTMENT SETTINGS
  // ============================================================

  async getAppointmentSettings(): Promise<AppointmentSettings> {
    // Try to get existing settings
    const [existing] = await db
      .select()
      .from(appointmentSettings)
      .where(eq(appointmentSettings.id, 1))
      .limit(1);

    // If no settings exist, create default settings
    if (!existing) {
      const [created] = await db
        .insert(appointmentSettings)
        .values({ id: 1 })
        .returning();
      return created;
    }

    return existing;
  }

  async updateAppointmentSettings(updates: Partial<AppointmentSettings>): Promise<AppointmentSettings> {
    const [updated] = await db
      .update(appointmentSettings)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(appointmentSettings.id, 1))
      .returning();

    return updated;
  }

  // ============================================================
  // PAYMENT GATEWAY SETTINGS
  // ============================================================

  async getPaymentGatewaySettings(): Promise<PaymentGatewaySettings> {
    const [existing] = await db
      .select()
      .from(paymentGatewaySettings)
      .where(eq(paymentGatewaySettings.id, 1))
      .limit(1);

    if (!existing) {
      const [created] = await db
        .insert(paymentGatewaySettings)
        .values({ id: 1 })
        .returning();
      return created;
    }

    return existing;
  }

  async updatePaymentGatewaySettings(updates: Partial<PaymentGatewaySettings>): Promise<PaymentGatewaySettings> {
    const [updated] = await db
      .update(paymentGatewaySettings)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(paymentGatewaySettings.id, 1))
      .returning();

    return updated;
  }

  // ============================================================
  // QUICKBOOKS SETTINGS
  // ============================================================

  async getQuickBooksSettings(): Promise<QuickBooksSettings> {
    const [existing] = await db
      .select()
      .from(quickbooksSettings)
      .where(eq(quickbooksSettings.id, 1))
      .limit(1);

    if (!existing) {
      const [created] = await db
        .insert(quickbooksSettings)
        .values({ id: 1 })
        .returning();
      return created;
    }

    return existing;
  }

  async updateQuickBooksSettings(updates: Partial<QuickBooksSettings>): Promise<QuickBooksSettings> {
    const [updated] = await db
      .update(quickbooksSettings)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(quickbooksSettings.id, 1))
      .returning();

    return updated;
  }

  // ============================================================
  // LANDING PAGE SETTINGS
  // ============================================================

  async getLandingPageSettings(): Promise<LandingPageSettings | undefined> {
    const result = await db.select().from(landingPageSettings).limit(1);
    return result[0];
  }

  async upsertLandingPageSettings(settings: InsertLandingPageSettings): Promise<LandingPageSettings> {
    const existing = await this.getLandingPageSettings();
    if (existing) {
      return (await this.updateLandingPageSettings(existing.id, settings))!;
    }
    const result = await db.insert(landingPageSettings).values(settings).returning();
    return result[0];
  }

  async updateLandingPageSettings(id: string, settings: Partial<InsertLandingPageSettings>): Promise<LandingPageSettings | undefined> {
    try {
      // Filter out undefined values and prepare update data
      const updateData: any = {};
      for (const [key, value] of Object.entries(settings)) {
        if (value !== undefined) {
          updateData[key] = value;
        }
      }
      updateData.updatedAt = new Date();

      const result = await db
        .update(landingPageSettings)
        .set(updateData)
        .where(eq(landingPageSettings.id, id))
        .returning();
      return result[0];
    } catch (error) {
      console.error("Error updating landing page settings:", error);
      throw error;
    }
  }

  // ============================================================
  // PRICING SETTINGS
  // ============================================================

  async getPricingSettings(): Promise<PricingSettings | undefined> {
    const result = await db.select().from(pricingSettings).where(eq(pricingSettings.id, 1)).limit(1);
    return result[0];
  }

  async updatePricingSettings(settings: Partial<InsertPricingSettings>): Promise<PricingSettings | undefined> {
    const updateData = { ...settings, updatedAt: new Date() };
    const result = await db.update(pricingSettings).set(updateData).where(eq(pricingSettings.id, 1)).returning();
    return result[0];
  }

  // ============================================================
  // EMAIL SETTINGS
  // ============================================================

  async getEmailSettings(): Promise<EmailSettings | undefined> {
    const result = await db.select().from(emailSettings).where(eq(emailSettings.id, 1)).limit(1);
    return result[0];
  }

  async updateEmailSettings(settings: Partial<InsertEmailSettings>): Promise<EmailSettings | undefined> {
    // Build update data, excluding undefined fields to prevent overwriting existing values with NULL
    const updateData: any = { updatedAt: new Date() };

    if (settings.resendApiKey !== undefined) updateData.resendApiKey = settings.resendApiKey;
    if (settings.fromEmail !== undefined) updateData.fromEmail = settings.fromEmail;
    if (settings.fromName !== undefined) updateData.fromName = settings.fromName;

    // Check if row exists
    const existing = await this.getEmailSettings();

    if (existing) {
      // Update existing row
      const result = await db.update(emailSettings).set(updateData).where(eq(emailSettings.id, 1)).returning();
      return result[0];
    } else {
      // Insert new row
      const result = await db.insert(emailSettings).values({ id: 1, ...updateData }).returning();
      return result[0];
    }
  }
}

// Export singleton instance
export const settingsStorage = new SettingsStorage();
